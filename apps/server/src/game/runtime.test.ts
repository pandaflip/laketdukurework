import { COUNTDOWN_MS, normalizeName, REVEAL_MS } from '@app/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Match, type MatchEvent } from './match';
import { MatchRuntime, systemTimers, type ChallengePoolHandle } from './runtime';
import type { PreparedChallenge } from './types';

function challenge(released: string[], name: string): PreparedChallenge {
  return {
    clues: {
      count: 3,
      render: () => Promise.resolve({ bytes: Buffer.from('x'), contentType: 'image/webp' }),
      renderReveal: () => Promise.resolve({ bytes: Buffer.from('y'), contentType: 'image/webp' }),
      release: () => {
        released.push(name);
      },
    },
    answer: {
      names: { en: name },
      universe: 'Universe',
      accepts: (text) => normalizeName(text) === normalizeName(name),
      isRelated: (text) => normalizeName(text) === normalizeName(name),
    },
  };
}

interface Setup {
  readonly runtime: MatchRuntime;
  readonly match: Match;
  readonly players: string[];
  readonly released: string[];
  readonly events: MatchEvent[];
  readonly calls: { count: number };
}

function setup(names: string[], playerCount = 2, size = 20): Setup {
  let counter = 0;
  const match = new Match({ newId: () => `id${(counter += 1)}` });
  const players = Array.from({ length: playerCount }, (_, index) => {
    const joined = match.addPlayer(`Player ${index + 1}`);
    if (!joined.ok) throw new Error(joined.reason);
    return joined.playerId;
  });
  const released: string[] = [];
  const events: MatchEvent[] = [];
  const calls = { count: 0 };
  const queue = [...names];
  const pool: ChallengePoolHandle = {
    size,
    next: () => {
      calls.count += 1;
      const name = queue.shift();
      return Promise.resolve(name === undefined ? null : challenge(released, name));
    },
  };
  const runtime = new MatchRuntime({
    match,
    timers: systemTimers,
    openPool: () => Promise.resolve(pool),
    onChange: (batch) => events.push(...batch),
  });
  match.configure(players[0] as string, { steps: 3, stepDelaySec: 2, targetScore: 1_000 });
  return { runtime, match, players, released, events, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('MatchRuntime', () => {
  it('runs rounds on its own: countdown, steps, end of round, next round', async () => {
    const game = setup(['Ahri', 'Zed', 'Karma']);
    const [host] = game.players as [string, string];
    expect(await game.runtime.start(host)).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(game.match.phase).toBe('countdown');

    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
    expect(game.match.phase).toBe('round');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(game.match.publicView(Date.now()).round?.stepIndex).toBe(1);

    // Nobody answers: 2 s + final hold of 8 s after the second step, then the reveal.
    await vi.advanceTimersByTimeAsync(2_000 + 8_000);
    expect(game.match.phase).toBe('reveal');
    await vi.advanceTimersByTimeAsync(REVEAL_MS + COUNTDOWN_MS);
    expect(game.match.publicView(Date.now()).round?.number).toBe(2);
    expect(game.released).toEqual(['Ahri']);
    expect(game.events.some((event) => event.type === 'step')).toBe(true);
  });

  it('prepares the next round during the reveal of the previous one', async () => {
    const game = setup(['Ahri', 'Zed']);
    const [host, guest] = game.players as [string, string];
    game.match.configure(host, { targetScore: 50_000 });
    await game.runtime.start(host);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
    expect(game.calls.count).toBe(1);

    game.runtime.run((match, now) => match.answer(host, 0, 'Ahri', now));
    expect(game.match.phase).toBe('round');
    await vi.advanceTimersByTimeAsync(1_000);
    game.runtime.run((match, now) => match.answer(guest, 0, 'Ahri', now));
    expect(game.match.phase).toBe('reveal');
    await vi.advanceTimersByTimeAsync(0);
    // The second round is already being prepared while the reveal is on screen.
    expect(game.calls.count).toBe(2);
    expect(game.match.phase).toBe('reveal');
  });

  it('does not prepare another round once the target is reached', async () => {
    const game = setup(['Ahri', 'Zed']);
    const [host, guest] = game.players as [string, string];
    await game.runtime.start(host);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
    game.runtime.run((match, now) => match.answer(host, 0, 'Ahri', now));
    game.runtime.run((match, now) => match.answer(guest, 0, 'Ahri', now));
    await vi.advanceTimersByTimeAsync(REVEAL_MS + 1_000);
    expect(game.match.phase).toBe('finished');
    expect(game.calls.count).toBe(1);
    expect(game.match.publicView(Date.now()).winners).toEqual([host]);
  });

  it('finishes when the pool runs dry', async () => {
    const game = setup(['Ahri'], 2, 20);
    const [host, guest] = game.players as [string, string];
    game.match.configure(host, { targetScore: 50_000 });
    await game.runtime.start(host);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
    game.runtime.run((match, now) => match.answer(host, 0, 'Ahri', now));
    game.runtime.run((match, now) => match.answer(guest, 0, 'Ahri', now));
    await vi.advanceTimersByTimeAsync(REVEAL_MS + 1_000);
    expect(game.match.phase).toBe('finished');
  });

  it('refuses a start from a guest, a second start, and a pool that is too small', async () => {
    const game = setup(['Ahri'], 2, 3);
    const [host, guest] = game.players as [string, string];
    expect(await game.runtime.start(guest)).toEqual({ ok: false, reason: 'NOT_HOST' });
    expect(await game.runtime.start(host)).toEqual({ ok: false, reason: 'POOL_TOO_SMALL' });
    expect(game.match.phase).toBe('lobby');

    const second = setup(['Ahri']);
    const secondHost = second.players[0] as string;
    const [first, again] = await Promise.all([
      second.runtime.start(secondHost),
      second.runtime.start(secondHost),
    ]);
    expect([first.ok, again.ok].sort()).toEqual([false, true]);
  });

  it('ranks simultaneous answers in the order the server handled them', async () => {
    const game = setup(['Ahri'], 8);
    const host = game.players[0] as string;
    await game.runtime.start(host);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
    const outcomes = await Promise.all(
      [...game.players]
        .reverse()
        .map((player) =>
          Promise.resolve().then(() =>
            game.runtime.run((match, now) => match.answer(player, 0, 'Ahri', now)),
          ),
        ),
    );
    const ranks = outcomes.map((outcome) => (outcome.status === 'correct' ? outcome.rank : 0));
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const view = game.match.publicView(Date.now());
    expect(view.players.filter((player) => player.found)).toHaveLength(8);
    expect(new Set(view.players.map((player) => player.foundRank)).size).toBe(8);
  });

  it('applies a vote at the engine deadline without a new command', async () => {
    const game = setup(['Ahri'], 2);
    const host = game.players[0] as string;
    await game.runtime.start(host);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS + 100);
    game.runtime.run((match, now) => match.vote(host, 0, now));
    expect(game.match.publicView(Date.now()).round?.stepIndex).toBe(0); // 1.5 s minimum gap
    await vi.advanceTimersByTimeAsync(1_400);
    expect(game.match.publicView(Date.now()).round?.stepIndex).toBe(1);
  });

  it('stops everything when closed and frees the prepared pictures', async () => {
    const game = setup(['Ahri', 'Zed']);
    const [host, guest] = game.players as [string, string];
    game.match.configure(host, { targetScore: 50_000 });
    await game.runtime.start(host);
    await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
    game.runtime.run((match, now) => match.answer(host, 0, 'Ahri', now));
    game.runtime.run((match, now) => match.answer(guest, 0, 'Ahri', now));
    await vi.advanceTimersByTimeAsync(0);
    game.runtime.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(game.released.sort()).toEqual(['Ahri', 'Zed']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
