import type { CommandResult, MatchEvent } from './match';
import type { Match } from './match';
import type { ChallengeSource, PreparedChallenge } from './types';

export interface Timers {
  now(): number;
  setTimer(delayMs: number, callback: () => void): () => void;
}

export const systemTimers: Timers = {
  now: () => Date.now(),
  setTimer: (delayMs, callback) => {
    const handle = setTimeout(callback, delayMs);
    return () => {
      clearTimeout(handle);
    };
  },
};

export interface ChallengePoolHandle extends ChallengeSource {
  readonly size: number;
}

export interface RuntimeDeps {
  readonly match: Match;
  readonly timers: Timers;
  /** Opens the pool of a game from its configuration (the lobby shows its size). */
  readonly openPool: (config: Match['config']) => Promise<ChallengePoolHandle>;
  /** Called after every change with the notifications to broadcast. */
  readonly onChange: (events: MatchEvent[]) => void;
}

/**
 * Connects a match to the clock and to the source of challenges: it calls
 * `tick` at the engine's next deadline and prepares each round, the next one
 * already during the reveal of the previous one. It adds no rule of its own.
 */
export class MatchRuntime {
  private cancelTimer: (() => void) | null = null;
  private pool: ChallengePoolHandle | null = null;
  private starting = false;
  /** The next round, in preparation or ready, not yet handed to the match. */
  private upcoming: Promise<PreparedChallenge | null> | null = null;
  private handing = false;
  private closed = false;

  constructor(private readonly deps: RuntimeDeps) {}

  get match(): Match {
    return this.deps.match;
  }

  /** Lobby: the number of challenges the current filters leave. */
  async poolSize(): Promise<number> {
    return (await this.deps.openPool(this.match.config)).size;
  }

  async start(playerId: string): Promise<CommandResult> {
    const { match, timers } = this.deps;
    if (this.starting) return { ok: false, reason: 'WRONG_PHASE' };
    if (playerId !== match.hostId) return { ok: false, reason: 'NOT_HOST' };
    if (match.phase !== 'lobby') return { ok: false, reason: 'WRONG_PHASE' };
    this.starting = true;
    try {
      const pool = await this.deps.openPool(match.config);
      if (this.closed) return { ok: false, reason: 'WRONG_PHASE' };
      const result = match.start(playerId, pool.size, timers.now());
      if (result.ok) this.pool = pool;
      this.sync();
      return result;
    } finally {
      this.starting = false;
    }
  }

  /** Every command goes through here so that the clock and the next round follow. */
  run<T>(command: (match: Match, now: number) => T): T {
    const result = command(this.deps.match, this.deps.timers.now());
    this.sync();
    return result;
  }

  sync(): void {
    if (this.closed) return;
    const { match, timers } = this.deps;
    match.tick(timers.now());

    // Prepare the next round as early as the previous one is over.
    if (
      this.pool &&
      !this.upcoming &&
      !this.handing &&
      (match.needsChallenge || match.continuesAfterReveal)
    ) {
      const preparing = this.pool.next().catch(() => null);
      this.upcoming = preparing;
      void preparing.then(() => {
        this.sync();
      });
    }
    if (match.needsChallenge && this.upcoming && !this.handing) {
      const ready = this.upcoming;
      this.upcoming = null;
      this.handing = true;
      void ready.then((challenge) => {
        this.handing = false;
        if (this.closed || !match.needsChallenge) challenge?.clues.release();
        else match.provideChallenge(challenge, timers.now());
        this.sync();
      });
    }

    this.cancelTimer?.();
    this.cancelTimer = null;
    const deadline = match.nextDeadline();
    if (deadline !== null) {
      this.cancelTimer = timers.setTimer(Math.max(0, deadline - timers.now()), () => {
        this.cancelTimer = null;
        this.sync();
      });
    }
    const events = match.drainEvents();
    if (events.length > 0) this.deps.onChange(events);
  }

  close(): void {
    this.closed = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
    void this.upcoming?.then((challenge) => challenge?.clues.release());
    this.upcoming = null;
    this.deps.match.close();
  }
}
