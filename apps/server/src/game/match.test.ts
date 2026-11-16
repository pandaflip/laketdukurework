import {
  COUNTDOWN_MS,
  MAX_ATTEMPTS_PER_ROUND,
  MAX_PLAYERS,
  MAX_ROUNDS,
  MIN_STEP_GAP_MS,
  normalizeName,
  REVEAL_MS,
  type RoomConfig,
} from '@app/shared';
import { describe, expect, it } from 'vitest';
import { Match, type AnswerOutcome } from './match';
import type { PreparedChallenge } from './types';

const T0 = 1_000_000;
const SECOND = 1_000;

interface FakeChallenge extends PreparedChallenge {
  released: boolean;
  readonly rendered: number[];
}

/** A challenge whose answer is "Ahri" (alias "LB", close typo "Ahrii"). */
function challenge(count = 4, answer = 'ahri'): FakeChallenge {
  const state = { released: false, rendered: [] as number[] };
  return {
    get released() {
      return state.released;
    },
    set released(value: boolean) {
      state.released = value;
    },
    rendered: state.rendered,
    clues: {
      count,
      render: (index) => {
        state.rendered.push(index);
        return Promise.resolve({ bytes: Buffer.from(`clue-${index}`), contentType: 'image/webp' });
      },
      renderReveal: () =>
        Promise.resolve({ bytes: Buffer.from('whole-picture'), contentType: 'image/webp' }),
      release: () => {
        state.released = true;
      },
    },
    answer: {
      names: { en: 'Ahri', fr: 'Ahri' },
      universe: 'League of Legends',
      accepts: (text, options) => {
        const value = normalizeName(text);
        return (
          value === answer ||
          (options.aliases && value === 'lb') ||
          (options.typoTolerance && value === 'ahrii')
        );
      },
      isRelated: (text) => [answer, 'lb', 'ahrii'].includes(normalizeName(text)),
    },
  };
}

let counter = 0;
const newMatch = (): Match => new Match({ newId: () => `id${(counter += 1)}` });

interface Game {
  readonly match: Match;
  readonly players: string[];
  readonly challenge: FakeChallenge;
  /** Time at which the first step of the round appeared. */
  readonly startedAt: number;
}

/** Players join, the host configures and starts, the first round begins. */
function begin(
  playerCount: number,
  config: Partial<RoomConfig> = {},
  count = 4,
  options: { pool?: number } = {},
): Game {
  const match = newMatch();
  const players = Array.from({ length: playerCount }, (_, index) => {
    const joined = match.addPlayer(`Player ${index + 1}`);
    if (!joined.ok) throw new Error(joined.reason);
    return joined.playerId;
  });
  const host = players[0] as string;
  expect(match.configure(host, { stepDelaySec: 2, steps: 3, ...config })).toEqual({ ok: true });
  expect(match.start(host, options.pool ?? 20, T0)).toEqual({ ok: true });
  const first = challenge(count);
  match.provideChallenge(first, T0);
  match.tick(T0 + COUNTDOWN_MS);
  return { match, players, challenge: first, startedAt: T0 + COUNTDOWN_MS };
}

const answerAs = (game: Game, who: number, text: string, at: number, step?: number) =>
  game.match.answer(
    game.players[who] as string,
    step ?? game.match.publicView(at).round?.stepIndex ?? 0,
    text,
    at,
  );

const round = (game: Game, at: number) => {
  const view = game.match.publicView(at).round;
  if (!view) throw new Error('no round');
  return view;
};

describe('lobby', () => {
  it('lets players join up to eight, with distinct valid nicknames', () => {
    const match = newMatch();
    expect(match.addPlayer('A').ok).toBe(false); // too short
    const first = match.addPlayer('Alice');
    expect(first.ok).toBe(true);
    expect(match.addPlayer('alice')).toEqual({ ok: false, reason: 'NICKNAME_TAKEN' });
    expect(match.addPlayer('x'.repeat(30))).toEqual({ ok: false, reason: 'BAD_NICKNAME' });
    for (let index = 1; index < MAX_PLAYERS; index++) {
      expect(match.addPlayer(`Guest ${index}`).ok).toBe(true);
    }
    expect(match.addPlayer('Late guest')).toEqual({ ok: false, reason: 'FULL' });
  });

  it('makes the first player the host and moves it to the next connected player on leaving', () => {
    const match = newMatch();
    const a = match.addPlayer('Alice');
    const b = match.addPlayer('Bob');
    const c = match.addPlayer('Carol');
    if (!a.ok || !b.ok || !c.ok) throw new Error('join failed');
    expect(match.hostId).toBe(a.playerId);
    match.removePlayer(a.playerId, T0);
    expect(match.hostId).toBe(b.playerId);
    match.setConnected(b.playerId, false, T0);
    expect(match.hostId).toBe(c.playerId);
  });

  it('refuses joining once the game started', () => {
    const game = begin(2);
    expect(game.match.addPlayer('Newcomer')).toEqual({ ok: false, reason: 'NOT_LOBBY' });
  });

  it('accepts configuration from the host only, in the lobby only, as a whole', () => {
    const match = newMatch();
    const host = match.addPlayer('Alice');
    const guest = match.addPlayer('Bob');
    if (!host.ok || !guest.ok) throw new Error('join failed');
    expect(match.configure(guest.playerId, { steps: 5 })).toEqual({
      ok: false,
      reason: 'NOT_HOST',
    });
    expect(match.configure(host.playerId, { steps: 99 })).toEqual({ ok: false, reason: 'INVALID' });
    expect(match.configure(host.playerId, { surprise: 1 })).toEqual({
      ok: false,
      reason: 'INVALID',
    });
    expect(match.configure(host.playerId, null)).toEqual({ ok: false, reason: 'INVALID' });
    expect(match.config.steps).toBe(10);
    expect(match.configure(host.playerId, { steps: 5, targetScore: 3000 })).toEqual({ ok: true });
    expect(match.config).toMatchObject({ steps: 5, targetScore: 3000, stepDelaySec: 6 });
    match.start(host.playerId, 10, T0);
    expect(match.configure(host.playerId, { steps: 6 })).toEqual({
      ok: false,
      reason: 'WRONG_PHASE',
    });
  });

  it('only lets the host start, and not with too few challenges', () => {
    const match = newMatch();
    const host = match.addPlayer('Alice');
    const guest = match.addPlayer('Bob');
    if (!host.ok || !guest.ok) throw new Error('join failed');
    expect(match.start(guest.playerId, 20, T0)).toEqual({ ok: false, reason: 'NOT_HOST' });
    expect(match.start(host.playerId, 4, T0)).toEqual({ ok: false, reason: 'POOL_TOO_SMALL' });
    expect(match.phase).toBe('lobby');
    expect(match.start(host.playerId, 5, T0)).toEqual({ ok: true });
    expect(match.phase).toBe('awaitingChallenge');
    expect(match.start(host.playerId, 5, T0)).toEqual({ ok: false, reason: 'WRONG_PHASE' });
  });
});

describe('progression of a round', () => {
  it('counts down, shows the first step at once, then one step per delay', () => {
    const game = begin(2, { stepDelaySec: 3, steps: 4 }, 4);
    const { match, startedAt } = game;
    expect(match.phase).toBe('round');
    expect(round(game, startedAt)).toMatchObject({ stepIndex: 0, stepCount: 4 });
    expect(round(game, startedAt).nextStepAt).toBe(startedAt + 3 * SECOND);

    match.tick(startedAt + 3 * SECOND - 1);
    expect(round(game, startedAt).stepIndex).toBe(0);
    match.tick(startedAt + 3 * SECOND);
    expect(round(game, startedAt).stepIndex).toBe(1);
    match.tick(startedAt + 6 * SECOND);
    match.tick(startedAt + 9 * SECOND);
    const last = round(game, startedAt);
    expect(last.stepIndex).toBe(3);
    expect(last.nextStepAt).toBeNull();
    // (steps - 1) * delay + max(delay, 8 s) after the start.
    expect(last.endsAt).toBe(startedAt + 9 * SECOND + 8 * SECOND);
  });

  it('catches up every step that is due when the tick is late', () => {
    const game = begin(2, { stepDelaySec: 2, steps: 4 }, 4);
    game.match.tick(game.startedAt + 7 * SECOND);
    expect(round(game, game.startedAt).stepIndex).toBe(3);
  });

  it('ends the round at the end of the final hold and reveals the answer', () => {
    const game = begin(2, { stepDelaySec: 2, steps: 3 }, 3);
    const end = game.startedAt + 2 * 2 * SECOND + 8 * SECOND;
    game.match.tick(end - 1);
    expect(game.match.phase).toBe('round');
    game.match.tick(end);
    expect(game.match.phase).toBe('reveal');
    const view = game.match.publicView(end);
    expect(view.reveal?.names.en).toBe('Ahri');
    expect(view.revealEndsAt).toBe(end + REVEAL_MS);
    expect(game.match.needsChallenge).toBe(false);
    game.match.tick(end + REVEAL_MS);
    expect(game.match.phase).toBe('awaitingChallenge');
    expect(game.match.needsChallenge).toBe(true);
  });

  it('uses the real number of steps of the image', () => {
    const game = begin(2, { steps: 10, stepDelaySec: 2 }, 4);
    expect(round(game, game.startedAt).stepCount).toBe(4);
  });

  it('exposes the next time the engine needs to run', () => {
    const game = begin(2, { stepDelaySec: 2, steps: 3 }, 3);
    expect(game.match.nextDeadline()).toBe(game.startedAt + 2 * SECOND);
  });
});

describe('scoring by order of answers', () => {
  it('awards 1000, 800, 640 in the order the server received the answers', () => {
    const game = begin(4);
    const at = game.startedAt + 500;
    expect(answerAs(game, 2, 'Ahri', at)).toEqual({ status: 'correct', rank: 1, points: 1000 });
    expect(answerAs(game, 0, 'ahri', at)).toEqual({ status: 'correct', rank: 2, points: 800 });
    expect(answerAs(game, 3, 'AHRI', at)).toEqual({ status: 'correct', rank: 3, points: 640 });
    const players = game.match.publicView(at).players;
    expect(players.map((player) => [player.nickname, player.score, player.place])).toEqual([
      ['Player 1', 800, 2],
      ['Player 2', 0, 4],
      ['Player 3', 1000, 1],
      ['Player 4', 640, 3],
    ]);
  });

  it('gives nothing for a wrong answer and refuses a second find', () => {
    const game = begin(2);
    const at = game.startedAt + 500;
    expect(answerAs(game, 0, 'Zed', at)).toEqual({ status: 'wrong' });
    expect(game.match.publicView(at).players[0]?.score).toBe(0);
    expect(answerAs(game, 0, 'Ahri', at + 3 * SECOND).status).toBe('correct');
    expect(answerAs(game, 0, 'Ahri', at + 6 * SECOND)).toMatchObject({
      status: 'rejected',
      reason: 'ALREADY_FOUND',
    });
    expect(game.match.publicView(at).players[0]?.score).toBe(1000);
  });

  it('breaks exact ties in arrival order, never giving the same rank twice', () => {
    const game = begin(8);
    const at = game.startedAt;
    const outcomes: AnswerOutcome[] = game.players.map((_, who) => answerAs(game, who, 'Ahri', at));
    const ranks = outcomes.map((outcome) => (outcome.status === 'correct' ? outcome.rank : -1));
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('ends the round as soon as every connected player has found', () => {
    const game = begin(3);
    const at = game.startedAt + SECOND;
    answerAs(game, 0, 'Ahri', at);
    answerAs(game, 1, 'Ahri', at);
    expect(game.match.phase).toBe('round');
    answerAs(game, 2, 'Ahri', at);
    expect(game.match.phase).toBe('reveal');
    const reveal = game.match.publicView(at).reveal;
    expect(reveal?.finders.map((finder) => finder.points)).toEqual([1000, 800, 640]);
  });

  it('does not wait for a disconnected player, and waits again if they come back', () => {
    const game = begin(3);
    const at = game.startedAt + SECOND;
    game.match.setConnected(game.players[2] as string, false, at);
    answerAs(game, 0, 'Ahri', at);
    expect(game.match.phase).toBe('round');
    answerAs(game, 1, 'Ahri', at);
    expect(game.match.phase).toBe('reveal');

    const other = begin(3);
    other.match.setConnected(other.players[2] as string, false, other.startedAt);
    answerAs(other, 0, 'Ahri', other.startedAt);
    other.match.setConnected(other.players[2] as string, true, other.startedAt + 1);
    answerAs(other, 1, 'Ahri', other.startedAt + 2);
    expect(other.match.phase).toBe('round');
  });

  it('finishes the game after the round where the target is reached', () => {
    const game = begin(2, { targetScore: 1_000 });
    answerAs(game, 0, 'Ahri', game.startedAt);
    answerAs(game, 1, 'Ahri', game.startedAt);
    expect(game.match.phase).toBe('reveal');
    expect(game.match.continuesAfterReveal).toBe(false);
    expect(game.match.publicView(game.startedAt).winners).toBeNull();
    game.match.tick(game.startedAt + REVEAL_MS);
    expect(game.match.phase).toBe('finished');
    expect(game.match.publicView(game.startedAt).winners).toEqual([game.players[0]]);
  });

  it('keeps playing when nobody reached the target', () => {
    const game = begin(2, { targetScore: 5_000 });
    answerAs(game, 0, 'Ahri', game.startedAt);
    answerAs(game, 1, 'Ahri', game.startedAt);
    expect(game.match.continuesAfterReveal).toBe(true);
    game.match.tick(game.startedAt + REVEAL_MS);
    expect(game.match.needsChallenge).toBe(true);
    game.match.provideChallenge(challenge(), game.startedAt + REVEAL_MS);
    expect(game.match.phase).toBe('countdown');
    expect(game.challenge.released).toBe(true);
    game.match.tick(game.startedAt + REVEAL_MS + COUNTDOWN_MS);
    expect(round(game, game.startedAt).number).toBe(2);
    expect(game.match.publicView(game.startedAt).players.map((player) => player.found)).toEqual([
      false,
      false,
    ]);
  });

  it('stops after the maximum number of rounds with no winner when nobody scored', () => {
    const game = begin(2, { stepDelaySec: 2, steps: 3 }, 3);
    let at = game.startedAt;
    for (let played = 1; played <= MAX_ROUNDS; played++) {
      at += 2 * 2 * SECOND + 8 * SECOND; // nobody answers: the round runs to its end
      game.match.tick(at);
      expect(game.match.phase).toBe('reveal');
      expect(game.match.continuesAfterReveal).toBe(played < MAX_ROUNDS);
      at += REVEAL_MS;
      game.match.tick(at);
      if (played < MAX_ROUNDS) {
        game.match.provideChallenge(challenge(3), at);
        at += COUNTDOWN_MS;
        game.match.tick(at);
      }
    }
    expect(game.match.phase).toBe('finished');
    expect(game.match.publicView(at).winners).toEqual([]);
    expect(game.match.publicView(at).roundsPlayed).toBe(MAX_ROUNDS);
  });

  it('returns to the lobby when nothing can be drawn at the start, and finishes when the pool runs dry', () => {
    const match = newMatch();
    const host = match.addPlayer('Alice');
    if (!host.ok) throw new Error('join failed');
    match.start(host.playerId, 10, T0);
    match.provideChallenge(null, T0);
    expect(match.phase).toBe('lobby');

    const game = begin(2);
    answerAs(game, 0, 'Ahri', game.startedAt);
    answerAs(game, 1, 'Ahri', game.startedAt);
    game.match.tick(game.startedAt + REVEAL_MS);
    game.match.provideChallenge(null, game.startedAt + REVEAL_MS);
    expect(game.match.phase).toBe('finished');
    expect(game.match.publicView(0).winners).toEqual([game.players[0]]);
  });
});

describe('attempts', () => {
  it('unlimited: waits for the cooldown and says how long', () => {
    const game = begin(2, { attempts: { kind: 'unlimited', cooldownSec: 2 }, stepDelaySec: 15 });
    const at = game.startedAt;
    expect(answerAs(game, 0, 'Zed', at)).toEqual({ status: 'wrong' });
    expect(answerAs(game, 0, 'Zac', at + 1_500)).toEqual({
      status: 'rejected',
      reason: 'COOLDOWN',
      retryAfterMs: 500,
    });
    expect(answerAs(game, 0, 'Zac', at + 2_000)).toEqual({ status: 'wrong' });
    expect(game.match.privateView(game.players[0] as string, at + 2_500)).toMatchObject({
      attemptsUsed: 2,
      attemptsLeft: null,
      nextAnswerAt: at + 4_000,
    });
  });

  it('unlimited: a refused answer does not restart the cooldown', () => {
    const game = begin(2, { attempts: { kind: 'unlimited', cooldownSec: 2 }, stepDelaySec: 15 });
    answerAs(game, 0, 'Zed', game.startedAt);
    answerAs(game, 0, 'Zac', game.startedAt + 1_900);
    expect(answerAs(game, 0, 'Zac', game.startedAt + 2_000).status).toBe('wrong');
  });

  it('per step: one answer per step, renewed at every step', () => {
    const game = begin(2, { attempts: { kind: 'perStep' }, stepDelaySec: 2, steps: 4 }, 4);
    const at = game.startedAt;
    expect(answerAs(game, 0, 'Zed', at)).toEqual({ status: 'wrong' });
    expect(answerAs(game, 0, 'Zac', at + 1_000)).toMatchObject({
      status: 'rejected',
      reason: 'STEP_ATTEMPT_USED',
    });
    expect(game.match.privateView(game.players[0] as string, at + 1_000)).toMatchObject({
      attemptsLeft: 0,
      blocked: 'STEP_ATTEMPT_USED',
    });
    expect(game.match.privateView(game.players[1] as string, at + 1_000)).toMatchObject({
      attemptsLeft: 1,
      blocked: null,
    });
    game.match.tick(at + 2 * SECOND);
    expect(answerAs(game, 0, 'Zac', at + 2 * SECOND)).toEqual({ status: 'wrong' });
  });

  it('per step: an answer for a step that is over is refused and costs nothing', () => {
    const game = begin(2, { attempts: { kind: 'perStep' }, stepDelaySec: 2, steps: 4 }, 4);
    const at = game.startedAt + 2 * SECOND;
    game.match.tick(at);
    expect(answerAs(game, 0, 'Ahri', at, 0)).toMatchObject({
      status: 'rejected',
      reason: 'STALE_STEP',
    });
    expect(answerAs(game, 0, 'Ahri', at, 1).status).toBe('correct');
  });

  it('limited: a maximum per round, shown as answers left', () => {
    const game = begin(2, { attempts: { kind: 'limited', max: 2 }, stepDelaySec: 15, steps: 4 });
    const at = game.startedAt;
    expect(answerAs(game, 0, 'Zed', at).status).toBe('wrong');
    expect(game.match.privateView(game.players[0] as string, at + SECOND)).toMatchObject({
      attemptsLeft: 1,
    });
    expect(answerAs(game, 0, 'Zac', at + SECOND).status).toBe('wrong');
    expect(answerAs(game, 0, 'Ahri', at + 2 * SECOND)).toMatchObject({
      status: 'rejected',
      reason: 'NO_ATTEMPTS_LEFT',
    });
    expect(answerAs(game, 1, 'Ahri', at + 2 * SECOND).status).toBe('correct');
  });

  it('limited: a right answer counts as an attempt too', () => {
    const game = begin(2, { attempts: { kind: 'limited', max: 1 }, stepDelaySec: 15 });
    expect(answerAs(game, 0, 'Ahri', game.startedAt).status).toBe('correct');
    expect(game.match.privateView(game.players[0] as string, game.startedAt)).toMatchObject({
      attemptsUsed: 1,
      blocked: 'ALREADY_FOUND',
    });
  });

  it('stops at the technical ceiling in every mode, with an explicit reason', () => {
    const game = begin(
      2,
      { attempts: { kind: 'unlimited', cooldownSec: 1 }, stepDelaySec: 15, steps: 20 },
      20,
    );
    let outcome: AnswerOutcome = { status: 'wrong' };
    for (let attempt = 0; attempt <= MAX_ATTEMPTS_PER_ROUND; attempt++) {
      const at = game.startedAt + attempt * SECOND;
      game.match.tick(at);
      outcome = answerAs(game, 0, `Nope ${attempt}`, at);
      if (attempt < MAX_ATTEMPTS_PER_ROUND) expect(outcome.status).toBe('wrong');
    }
    expect(outcome).toMatchObject({ status: 'rejected', reason: 'TECHNICAL_CAP' });
    expect(
      game.match.privateView(game.players[0] as string, game.startedAt + 101 * SECOND)?.blocked,
    ).toBe('TECHNICAL_CAP');
  });

  it('keeps the quotas across a disconnection and a reconnection', () => {
    const game = begin(2, { attempts: { kind: 'limited', max: 1 }, stepDelaySec: 15 });
    const player = game.players[0] as string;
    answerAs(game, 0, 'Zed', game.startedAt);
    game.match.setConnected(player, false, game.startedAt + SECOND);
    game.match.setConnected(player, true, game.startedAt + 2 * SECOND);
    expect(answerAs(game, 0, 'Zac', game.startedAt + 3 * SECOND)).toMatchObject({
      status: 'rejected',
      reason: 'NO_ATTEMPTS_LEFT',
    });
  });

  it('applies the minimum gap between answers even where there is no cooldown', () => {
    const game = begin(2, { attempts: { kind: 'limited', max: 5 }, stepDelaySec: 15 });
    answerAs(game, 0, 'Zed', game.startedAt);
    expect(answerAs(game, 0, 'Zac', game.startedAt + 100)).toMatchObject({
      status: 'rejected',
      reason: 'RATE_LIMITED',
    });
    expect(answerAs(game, 0, 'Zac', game.startedAt + 400).status).toBe('wrong');
  });

  it('refuses malformed answers without spending an attempt', () => {
    const game = begin(2, { attempts: { kind: 'limited', max: 1 }, stepDelaySec: 15 });
    for (const text of ['', '   ', 'x'.repeat(41), 'bad\u0000text']) {
      expect(answerAs(game, 0, text, game.startedAt)).toMatchObject({
        status: 'rejected',
        reason: 'INVALID_ANSWER',
      });
    }
    expect(answerAs(game, 0, 'Ahri', game.startedAt).status).toBe('correct');
  });

  it('refuses answers outside a round, from unknown players, and before the countdown ends', () => {
    const match = newMatch();
    const host = match.addPlayer('Alice');
    if (!host.ok) throw new Error('join failed');
    expect(match.answer(host.playerId, 0, 'Ahri', T0)).toMatchObject({ reason: 'NOT_IN_ROUND' });
    match.start(host.playerId, 10, T0);
    match.provideChallenge(challenge(), T0);
    expect(match.answer(host.playerId, 0, 'Ahri', T0 + 1)).toMatchObject({
      reason: 'NOT_IN_ROUND',
    });
    expect(match.answer('stranger', 0, 'Ahri', T0 + 1)).toMatchObject({
      reason: 'UNKNOWN_PLAYER',
    });
  });
});

describe('answer options', () => {
  it('honours the typo and alias options of the host', () => {
    const strict = begin(2, { typoTolerance: false, aliases: false, stepDelaySec: 15 });
    expect(answerAs(strict, 0, 'Ahrii', strict.startedAt).status).toBe('wrong');
    expect(answerAs(strict, 1, 'LB', strict.startedAt).status).toBe('wrong');

    const loose = begin(2, { typoTolerance: true, aliases: true, stepDelaySec: 15 });
    expect(answerAs(loose, 0, 'Ahrii', loose.startedAt).status).toBe('correct');
    expect(answerAs(loose, 1, 'LB', loose.startedAt).status).toBe('correct');
  });

  it('hides wrong answers by default, and shows the harmless ones when asked', () => {
    const hidden = begin(2, { stepDelaySec: 15 });
    answerAs(hidden, 0, 'Zed', hidden.startedAt);
    expect(round(hidden, hidden.startedAt).wrongAnswers).toBeNull();
    expect(hidden.match.privateView(hidden.players[0] as string, hidden.startedAt)).toMatchObject({
      myWrongAnswers: ['Zed'],
    });

    const shown = begin(2, { showWrongAnswers: true, stepDelaySec: 15 });
    answerAs(shown, 0, 'Zed', shown.startedAt);
    expect(round(shown, shown.startedAt).wrongAnswers).toEqual([
      { playerId: shown.players[0], text: 'Zed' },
    ]);
  });

  it('never displays a refused answer that names, abbreviates or misspells the answer', () => {
    const game = begin(2, {
      showWrongAnswers: true,
      aliases: false,
      typoTolerance: false,
      stepDelaySec: 15,
    });
    answerAs(game, 0, 'LB', game.startedAt); // the alias, refused because aliases are off
    answerAs(game, 1, 'Ahrii', game.startedAt); // a typo, refused because tolerance is off
    expect(round(game, game.startedAt).wrongAnswers).toEqual([]);
    // The authors still see their own attempts.
    expect(game.match.privateView(game.players[0] as string, game.startedAt)).toMatchObject({
      myWrongAnswers: ['LB'],
    });
  });
});

describe('who may act', () => {
  it('refuses answers and votes from a player who is not connected', () => {
    const game = begin(3, { stepDelaySec: 6, steps: 5 }, 5);
    const [a, b] = game.players as [string, string, string];
    const at = game.startedAt + 2 * SECOND;
    game.match.setConnected(a, false, at);
    expect(game.match.answer(a, 0, 'Ahri', at)).toEqual({
      status: 'rejected',
      reason: 'NOT_CONNECTED',
    });
    expect(game.match.vote(a, 0, at)).toEqual({ status: 'rejected', reason: 'NOT_CONNECTED' });
    // Nothing was spent or counted for them.
    expect(game.match.publicView(at).players[0]?.score).toBe(0);
    expect(round(game, at).votes).toEqual({ count: 0, needed: 1 });
    game.match.setConnected(a, true, at + 1);
    expect(game.match.answer(a, 0, 'Ahri', at + 2).status).toBe('correct');
    expect(game.match.vote(b, 0, at + 3).status).toBe('counted');
  });

  it('refuses everyone who is not in the game', () => {
    const game = begin(2);
    expect(game.match.answer('someone-else', 0, 'Ahri', game.startedAt)).toMatchObject({
      reason: 'UNKNOWN_PLAYER',
    });
    expect(game.match.vote('someone-else', 0, game.startedAt)).toMatchObject({
      reason: 'UNKNOWN_PLAYER',
    });
    expect(game.match.privateView('someone-else', game.startedAt)).toBeNull();
  });

  it('lets a registered player come back to their place, score and status', () => {
    const game = begin(
      3,
      {
        attempts: { kind: 'limited', max: 3 },
        vote: { enabled: true, threshold: 'unanimous' },
        stepDelaySec: 6,
        steps: 5,
      },
      5,
    );
    const [a, b] = game.players as [string, string, string];
    const at = game.startedAt + 2 * SECOND;
    answerAs(game, 1, 'Zed', at);
    answerAs(game, 1, 'Ahri', at + SECOND);
    game.match.vote(a, 0, at + SECOND);
    game.match.setConnected(b, false, at + 2 * SECOND);
    game.match.setConnected(a, false, at + 2 * SECOND);

    const gone = game.match.publicView(at + 3 * SECOND).players;
    expect(gone.map((player) => player.connected)).toEqual([false, false, true]);
    // A newcomer cannot take their place, whatever the nickname.
    expect(game.match.addPlayer('Player 2')).toMatchObject({ ok: false });

    game.match.setConnected(b, true, at + 3.5 * SECOND);
    game.match.setConnected(a, true, at + 3.5 * SECOND);
    const back = game.match.publicView(at + 3.5 * SECOND).players;
    expect(back[1]).toMatchObject({
      nickname: 'Player 2',
      connected: true,
      found: true,
      foundRank: 1,
      score: 1000,
      place: 1,
    });
    expect(game.match.privateView(b, at + 3.5 * SECOND)).toMatchObject({
      attemptsUsed: 2,
      attemptsLeft: 1,
      blocked: 'ALREADY_FOUND',
      myWrongAnswers: ['Zed'],
    });
    expect(game.match.privateView(a, at + 3.5 * SECOND)?.voted).toBe(true);
    expect(round(game, at).stepIndex).toBe(0);
  });

  it('gives the host back to the next connected player and keeps the game going', () => {
    const game = begin(3);
    const [host, second] = game.players as [string, string, string];
    game.match.setConnected(host, false, game.startedAt + SECOND);
    expect(game.match.hostId).toBe(second);
    game.match.setConnected(host, true, game.startedAt + 2 * SECOND);
    expect(game.match.hostId).toBe(second); // the role does not bounce back
    expect(game.match.phase).toBe('round');
  });
});

describe('votes to zoom out', () => {
  const config = { stepDelaySec: 6, steps: 5, vote: { enabled: true, threshold: 'half' } } as const;

  it('moves to the next step as soon as the threshold is reached, with the full delay again', () => {
    const game = begin(4, config, 5);
    const at = game.startedAt + 2 * SECOND;
    const [a, b, c] = game.players as [string, string, string];
    expect(game.match.vote(a, 0, at)).toEqual({ status: 'counted' });
    expect(round(game, at).votes).toEqual({ count: 1, needed: 2 });
    expect(game.match.vote(b, 0, at)).toEqual({ status: 'counted' });
    expect(round(game, at)).toMatchObject({ stepIndex: 1, nextStepAt: at + 6 * SECOND });
    // Votes start again from zero on the new step, and the third voter is on time for step 1 only.
    expect(round(game, at).votes).toEqual({ count: 0, needed: 2 });
    expect(game.match.vote(c, 0, at + 1)).toEqual({ status: 'rejected', reason: 'STALE_STEP' });
  });

  it('counts one vote per player and step, even after a reconnection', () => {
    const game = begin(4, { ...config, vote: { enabled: true, threshold: 'unanimous' } }, 5);
    const at = game.startedAt + 2 * SECOND;
    const a = game.players[0] as string;
    game.match.vote(a, 0, at);
    expect(game.match.vote(a, 0, at + 1)).toEqual({ status: 'already' });
    game.match.setConnected(a, false, at + 2);
    expect(round(game, at).votes).toEqual({ count: 0, needed: 3 });
    game.match.setConnected(a, true, at + 3);
    expect(round(game, at).votes).toEqual({ count: 1, needed: 4 });
    expect(game.match.vote(a, 0, at + 4)).toEqual({ status: 'already' });
  });

  it('computes the threshold from the players who can still vote', () => {
    const needed = (threshold: 'half' | 'threeQuarters' | 'unanimous', players: number) => {
      const game = begin(players, { ...config, vote: { enabled: true, threshold } }, 5);
      return round(game, game.startedAt).votes?.needed;
    };
    expect([1, 2, 3, 4, 5, 8].map((count) => needed('half', count))).toEqual([1, 1, 2, 2, 3, 4]);
    expect([1, 2, 3, 4, 5, 8].map((count) => needed('threeQuarters', count))).toEqual([
      1, 2, 3, 3, 4, 6,
    ]);
    expect([1, 2, 3, 4, 5, 8].map((count) => needed('unanimous', count))).toEqual([
      1, 2, 3, 4, 5, 8,
    ]);
  });

  it('does not count players who found the answer or who are disconnected', () => {
    const game = begin(4, { ...config, vote: { enabled: true, threshold: 'unanimous' } }, 5);
    const at = game.startedAt + 2 * SECOND;
    const [a, b, c, d] = game.players as [string, string, string, string];
    answerAs(game, 3, 'Ahri', at);
    expect(game.match.vote(d, 0, at)).toEqual({ status: 'rejected', reason: 'NOT_ELIGIBLE' });
    game.match.setConnected(c, false, at);
    expect(round(game, at).votes).toEqual({ count: 0, needed: 2 });
    game.match.vote(a, 0, at);
    expect(round(game, at).stepIndex).toBe(0);
    game.match.vote(b, 0, at);
    expect(round(game, at).stepIndex).toBe(1);
  });

  it('moves on when a player who did not vote finds the answer and the others already voted', () => {
    const game = begin(3, { ...config, vote: { enabled: true, threshold: 'unanimous' } }, 5);
    const at = game.startedAt + 2 * SECOND;
    const [a, b] = game.players as [string, string, string];
    game.match.vote(a, 0, at);
    game.match.vote(b, 0, at);
    expect(round(game, at).stepIndex).toBe(0);
    answerAs(game, 2, 'Ahri', at + 100);
    expect(round(game, at).stepIndex).toBe(1);
  });

  it('waits for the minimum gap between two steps', () => {
    const game = begin(2, { ...config, vote: { enabled: true, threshold: 'half' } }, 5);
    const at = game.startedAt + 100;
    const [a] = game.players as [string, string];
    game.match.vote(a, 0, at);
    expect(round(game, at).stepIndex).toBe(0);
    expect(game.match.nextDeadline()).toBe(game.startedAt + MIN_STEP_GAP_MS);
    game.match.tick(game.startedAt + MIN_STEP_GAP_MS - 1);
    expect(round(game, at).stepIndex).toBe(0);
    game.match.tick(game.startedAt + MIN_STEP_GAP_MS);
    expect(round(game, at).stepIndex).toBe(1);
    expect(round(game, at).nextStepAt).toBe(game.startedAt + MIN_STEP_GAP_MS + 6 * SECOND);
  });

  it('refuses votes when disabled and on the last step', () => {
    const off = begin(2, { ...config, vote: { enabled: false, threshold: 'half' } }, 5);
    expect(off.match.vote(off.players[0] as string, 0, off.startedAt)).toEqual({
      status: 'rejected',
      reason: 'VOTES_DISABLED',
    });
    expect(round(off, off.startedAt).votes).toBeNull();

    const game = begin(2, { stepDelaySec: 2, steps: 3 }, 3);
    game.match.tick(game.startedAt + 4 * SECOND);
    expect(round(game, game.startedAt).stepIndex).toBe(2);
    expect(game.match.vote(game.players[0] as string, 2, game.startedAt + 4 * SECOND)).toEqual({
      status: 'rejected',
      reason: 'LAST_STEP',
    });
    expect(game.match.privateView(game.players[0] as string, game.startedAt)?.canVote).toBe(false);
  });

  it('renews the per-step attempt allowance after a vote', () => {
    const game = begin(
      2,
      {
        attempts: { kind: 'perStep' },
        vote: { enabled: true, threshold: 'half' },
        stepDelaySec: 6,
      },
      4,
    );
    const at = game.startedAt + 2 * SECOND;
    answerAs(game, 0, 'Zed', at);
    expect(answerAs(game, 0, 'Zac', at + 1)).toMatchObject({ reason: 'STEP_ATTEMPT_USED' });
    game.match.vote(game.players[1] as string, 0, at + 2);
    expect(round(game, at).stepIndex).toBe(1);
    expect(answerAs(game, 0, 'Zac', at + 500).status).toBe('wrong');
  });

  it('handles simultaneous votes without counting any twice', () => {
    const game = begin(8, { ...config, vote: { enabled: true, threshold: 'half' } }, 5);
    const at = game.startedAt + 2 * SECOND;
    const results = game.players.flatMap((player) => [
      game.match.vote(player, 0, at),
      game.match.vote(player, 0, at),
    ]);
    expect(results.filter((result) => result.status === 'counted')).toHaveLength(4);
    expect(round(game, at).stepIndex).toBe(1);
  });
});

describe('what players may learn', () => {
  const secrets = ['Ahri', 'ahri', 'League of Legends', 'whole-picture'];

  it('never puts the answer in a view, a token or an event before the reveal', () => {
    const game = begin(3, { showWrongAnswers: true, aliases: false, stepDelaySec: 3 }, 4);
    const seen: string[] = [];
    const capture = (at: number): void => {
      seen.push(JSON.stringify(game.match.publicView(at)));
      for (const player of game.players) {
        seen.push(JSON.stringify(game.match.privateView(player, at)));
      }
      seen.push(JSON.stringify(game.match.drainEvents()));
    };
    capture(game.startedAt);
    answerAs(game, 0, 'Zed', game.startedAt);
    answerAs(game, 1, 'LB', game.startedAt + 100); // the alias, refused here: never published
    game.match.vote(game.players[2] as string, 0, game.startedAt + 200);
    capture(game.startedAt + 300);
    game.match.tick(game.startedAt + 3 * SECOND);
    capture(game.startedAt + 3 * SECOND);
    for (const text of seen) {
      for (const secret of secrets) {
        expect(text.toLowerCase(), secret).not.toContain(secret.toLowerCase());
      }
    }
    // A player's own refused attempt is theirs to see, and nobody else's.
    expect(seen.join('')).toContain('LB');
  });

  it('shows who found it and their rank, but not what they typed', () => {
    const game = begin(2, { stepDelaySec: 15 });
    answerAs(game, 0, 'AHRI!!', game.startedAt);
    const view = JSON.stringify(game.match.publicView(game.startedAt));
    expect(view).not.toMatch(/ahri/i);
    expect(game.match.publicView(game.startedAt).players[0]).toMatchObject({
      found: true,
      foundRank: 1,
      foundPoints: 1000,
    });
  });

  it('reveals the answer only after the round', () => {
    const game = begin(2, { stepDelaySec: 15 });
    answerAs(game, 0, 'Ahri', game.startedAt);
    answerAs(game, 1, 'Ahri', game.startedAt);
    const view = game.match.publicView(game.startedAt);
    expect(view.round).toBeNull();
    expect(view.reveal).toMatchObject({
      names: { en: 'Ahri', fr: 'Ahri' },
      universe: 'League of Legends',
    });
  });

  it('serves a frame only once its step is revealed, and only to players of the game', async () => {
    const game = begin(2, { stepDelaySec: 3 }, 4);
    const first = round(game, game.startedAt).frameToken;
    const stranger = 'stranger';
    expect((await game.match.openFrame(first, game.players[0] as string))?.bytes.toString()).toBe(
      'clue-0',
    );
    expect(await game.match.openFrame(first, stranger)).toBeNull();
    expect(await game.match.openFrame('not-a-token', game.players[0] as string)).toBeNull();
    // Nothing was rendered for the steps that are not revealed.
    expect(game.challenge.rendered).toEqual([0]);

    game.match.tick(game.startedAt + 3 * SECOND);
    const second = round(game, game.startedAt).frameToken;
    expect(second).not.toBe(first);
    expect((await game.match.openFrame(second, game.players[1] as string))?.bytes.toString()).toBe(
      'clue-1',
    );
  });

  it('serves the whole picture only after the round is over', async () => {
    const game = begin(2, { stepDelaySec: 15 });
    const player = game.players[0] as string;
    answerAs(game, 0, 'Ahri', game.startedAt);
    answerAs(game, 1, 'Ahri', game.startedAt);
    const reveal = game.match.publicView(game.startedAt).reveal;
    expect((await game.match.openFrame(reveal?.frameToken ?? '', player))?.bytes.toString()).toBe(
      'whole-picture',
    );
  });

  it('forgets the addresses of a round when the next one starts', async () => {
    const game = begin(2, { stepDelaySec: 15 });
    const old = round(game, game.startedAt).frameToken;
    answerAs(game, 0, 'Ahri', game.startedAt);
    answerAs(game, 1, 'Ahri', game.startedAt);
    game.match.tick(game.startedAt + REVEAL_MS);
    game.match.provideChallenge(challenge(), game.startedAt + REVEAL_MS);
    expect(await game.match.openFrame(old, game.players[0] as string)).toBeNull();
  });

  it('uses unguessable, distinct addresses for every step', () => {
    const game = begin(2, { stepDelaySec: 2, steps: 4 }, 4);
    const tokens = new Set<string>();
    for (let step = 0; step < 4; step++) {
      game.match.tick(game.startedAt + step * 2 * SECOND);
      tokens.add(round(game, game.startedAt).frameToken);
    }
    expect(tokens.size).toBe(4);
  });
});

describe('frame addresses', () => {
  it('belong to one game: another game does not know them', async () => {
    const one = begin(2, { stepDelaySec: 15 });
    const other = begin(2, { stepDelaySec: 15 });
    const token = round(one, one.startedAt).frameToken;
    expect(await one.match.openFrame(token, one.players[0] as string)).not.toBeNull();
    expect(await other.match.openFrame(token, other.players[0] as string)).toBeNull();
    // Even with a player identifier of the other game.
    expect(await other.match.openFrame(token, one.players[0] as string)).toBeNull();
  });

  it('are refused to a stranger even with a valid address, and give nothing before the countdown ends', async () => {
    const match = newMatch();
    const host = match.addPlayer('Alice');
    if (!host.ok) throw new Error('join failed');
    match.start(host.playerId, 10, T0);
    match.provideChallenge(challenge(), T0);
    // No address exists before the first step is shown.
    expect(match.publicView(T0).round).toBeNull();
    expect(await match.openFrame('id1', host.playerId)).toBeNull();
  });

  it('stop being served when the game is over', async () => {
    const game = begin(2, { targetScore: 1_000 });
    const token = round(game, game.startedAt).frameToken;
    answerAs(game, 0, 'Ahri', game.startedAt);
    answerAs(game, 1, 'Ahri', game.startedAt);
    const reveal = game.match.publicView(game.startedAt).reveal?.frameToken ?? '';
    expect(await game.match.openFrame(reveal, game.players[0] as string)).not.toBeNull();
    game.match.tick(game.startedAt + REVEAL_MS);
    expect(game.match.phase).toBe('finished');
    expect(game.challenge.released).toBe(true);
    expect(await game.match.openFrame(token, game.players[0] as string)).toBeNull();
    expect(await game.match.openFrame(reveal, game.players[0] as string)).toBeNull();
  });
});

describe('closing', () => {
  it('releases the pictures of the round', () => {
    const game = begin(2);
    game.match.close();
    expect(game.challenge.released).toBe(true);
    expect(game.match.closed).toBe(true);
  });
});
