import {
  cleanNickname,
  COUNTDOWN_MS,
  finalHoldSec,
  MAX_ANSWER_LENGTH,
  MAX_ATTEMPTS_PER_ROUND,
  MAX_PLAYERS,
  MAX_ROUNDS,
  MIN_ANSWER_GAP_MS,
  MIN_POOL_SIZE,
  MIN_STEP_GAP_MS,
  parseRoomConfig,
  rankPoints,
  rankStandings,
  REVEAL_MS,
  roomConfigSchema,
  winnersOf,
  type AnswerBlock,
  type MatchPhase,
  type PrivateView,
  type PublicPlayer,
  type PublicReveal,
  type PublicRound,
  type PublicView,
  type RoomConfig,
  type Totals,
} from '@app/shared';
import type { PreparedChallenge, RenderedClue } from './types';

export type AnswerRejection =
  | 'NOT_IN_ROUND'
  | 'UNKNOWN_PLAYER'
  | 'ALREADY_FOUND'
  | 'STALE_STEP'
  | 'INVALID_ANSWER'
  | 'RATE_LIMITED'
  | 'COOLDOWN'
  | 'STEP_ATTEMPT_USED'
  | 'NO_ATTEMPTS_LEFT'
  | 'TECHNICAL_CAP';

export type AnswerOutcome =
  | { readonly status: 'correct'; readonly rank: number; readonly points: number }
  | { readonly status: 'wrong' }
  | {
      readonly status: 'rejected';
      readonly reason: AnswerRejection;
      /** Milliseconds before the same answer could be accepted, when waiting helps. */
      readonly retryAfterMs?: number;
    };

export type VoteRejection =
  | 'NOT_IN_ROUND'
  | 'UNKNOWN_PLAYER'
  | 'VOTES_DISABLED'
  | 'STALE_STEP'
  | 'LAST_STEP'
  | 'NOT_ELIGIBLE';

export type VoteOutcome =
  | { readonly status: 'counted' | 'already' }
  | { readonly status: 'rejected'; readonly reason: VoteRejection };

export type JoinResult =
  | { readonly ok: true; readonly playerId: string }
  | {
      readonly ok: false;
      readonly reason: 'FULL' | 'NOT_LOBBY' | 'BAD_NICKNAME' | 'NICKNAME_TAKEN';
    };

export type CommandResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'NOT_HOST' | 'WRONG_PHASE' | 'INVALID' | 'POOL_TOO_SMALL';
    };

/** Notifications for the network layer; they never contain an answer. */
export type MatchEvent =
  | { readonly type: 'phase'; readonly phase: MatchPhase }
  | { readonly type: 'step'; readonly index: number }
  | { readonly type: 'found'; readonly playerId: string; readonly rank: number }
  | { readonly type: 'votes'; readonly count: number; readonly needed: number }
  | { readonly type: 'players' }
  | { readonly type: 'config' };

export interface MatchDeps {
  /** Opaque, unguessable identifiers (players, frame addresses). */
  readonly newId: () => string;
}

interface PlayerState {
  readonly id: string;
  readonly nickname: string;
  readonly joinOrder: number;
  connected: boolean;
  score: number;
  firsts: number;
  found: number;
}

interface Attempts {
  total: number;
  inStep: number;
  lastAt: number | null;
  wrong: string[];
}

interface Finder {
  readonly rank: number;
  readonly points: number;
}

interface Round {
  readonly number: number;
  readonly challenge: PreparedChallenge;
  readonly count: number;
  stepIndex: number;
  stepRevealedAt: number;
  nextStepAt: number | null;
  /** When the round ends if nothing else happens; set on the last step. */
  endsAt: number | null;
  readonly finders: Map<string, Finder>;
  readonly attempts: Map<string, Attempts>;
  votes: Set<string>;
  readonly feed: { playerId: string; text: string }[];
  readonly tokens: Map<string, number | 'reveal'>;
  readonly clueTokens: string[];
  revealToken: string | null;
}

const stripControl = (value: string): boolean => /\p{Cc}/u.test(value);

/**
 * The rules of one game, with no network, no timer and no database: every
 * method takes the current time (milliseconds) and the caller schedules a
 * call to `tick` at `nextDeadline()`. The server is the only authority: the
 * order of the answers is the order of the calls, and nothing a client sends
 * decides a score, a rank, a step or who the host is.
 */
export class Match {
  private phase_: MatchPhase = 'lobby';
  private config_: RoomConfig = roomConfigSchema.parse({});
  private readonly players = new Map<string, PlayerState>();
  private hostId_ = '';
  private joinCounter = 0;
  private version = 0;
  private roundsPlayed = 0;
  private round: Round | null = null;
  private countdownEndsAt: number | null = null;
  private revealEndsAt: number | null = null;
  private gameOverAfterReveal = false;
  private winners: string[] | null = null;
  private events: MatchEvent[] = [];
  private ended = false;

  constructor(private readonly deps: MatchDeps) {}

  get phase(): MatchPhase {
    return this.phase_;
  }

  get config(): RoomConfig {
    return this.config_;
  }

  get hostId(): string {
    return this.hostId_;
  }

  /** True when the engine waits for the next round to be prepared. */
  get needsChallenge(): boolean {
    return this.phase_ === 'awaitingChallenge';
  }

  /** True while a round just ended and the game goes on: the next round may be prepared now. */
  get continuesAfterReveal(): boolean {
    return this.phase_ === 'reveal' && !this.gameOverAfterReveal;
  }

  drainEvents(): MatchEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  // -------------------------------------------------------------- players

  addPlayer(nickname: string): JoinResult {
    if (this.phase_ !== 'lobby') return { ok: false, reason: 'NOT_LOBBY' };
    if (this.players.size >= MAX_PLAYERS) return { ok: false, reason: 'FULL' };
    const clean = cleanNickname(nickname);
    if (clean === null) return { ok: false, reason: 'BAD_NICKNAME' };
    const taken = [...this.players.values()].some(
      (player) => player.nickname.toLocaleLowerCase() === clean.toLocaleLowerCase(),
    );
    if (taken) return { ok: false, reason: 'NICKNAME_TAKEN' };

    const id = this.deps.newId();
    this.players.set(id, {
      id,
      nickname: clean,
      joinOrder: this.joinCounter++,
      connected: true,
      score: 0,
      firsts: 0,
      found: 0,
    });
    if (this.hostId_ === '') this.hostId_ = id;
    this.changed({ type: 'players' });
    return { ok: true, playerId: id };
  }

  /**
   * A player leaves. In the lobby they disappear; once the game started they
   * stay in the standings, disconnected, so their score is kept.
   */
  removePlayer(playerId: string, now: number): void {
    if (!this.players.has(playerId)) return;
    if (this.phase_ === 'lobby') {
      this.players.delete(playerId);
      this.moveHost();
      this.changed({ type: 'players' });
    } else {
      this.setConnected(playerId, false, now);
    }
  }

  setConnected(playerId: string, connected: boolean, now: number): void {
    const player = this.players.get(playerId);
    if (!player || player.connected === connected) return;
    player.connected = connected;
    if (!connected && playerId === this.hostId_) this.moveHost();
    this.changed({ type: 'players' });
    this.tick(now);
  }

  /** The host passes to the connected player who arrived first. */
  private moveHost(): void {
    const current = this.players.get(this.hostId_);
    if (current?.connected) return;
    const next = [...this.players.values()]
      .filter((player) => player.connected)
      .sort((a, b) => a.joinOrder - b.joinOrder)[0];
    if (next) this.hostId_ = next.id;
    else if (!current) this.hostId_ = '';
  }

  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  // -------------------------------------------------------------- lobby

  /** Host only, lobby only. Unknown or out-of-range options are refused as a whole. */
  configure(playerId: string, input: unknown): CommandResult {
    if (playerId !== this.hostId_) return { ok: false, reason: 'NOT_HOST' };
    if (this.phase_ !== 'lobby') return { ok: false, reason: 'WRONG_PHASE' };
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return { ok: false, reason: 'INVALID' };
    }
    const result = parseRoomConfig({ ...this.config_, ...input });
    if (!result.ok) return { ok: false, reason: 'INVALID' };
    this.config_ = result.config;
    this.changed({ type: 'config' });
    return { ok: true };
  }

  /** `poolSize` is the number of challenges the host's filters leave. */
  start(playerId: string, poolSize: number, now: number): CommandResult {
    if (playerId !== this.hostId_) return { ok: false, reason: 'NOT_HOST' };
    if (this.phase_ !== 'lobby') return { ok: false, reason: 'WRONG_PHASE' };
    if (poolSize < MIN_POOL_SIZE) return { ok: false, reason: 'POOL_TOO_SMALL' };
    this.setPhase('awaitingChallenge');
    this.tick(now);
    return { ok: true };
  }

  // -------------------------------------------------------------- rounds

  /**
   * Gives the engine the next round, already prepared (its first step is
   * rendered), or `null` when nothing eligible is left.
   */
  provideChallenge(challenge: PreparedChallenge | null, now: number): void {
    if (this.phase_ !== 'awaitingChallenge') {
      challenge?.clues.release();
      return;
    }
    if (challenge === null) {
      if (this.roundsPlayed === 0) {
        this.countdownEndsAt = null;
        this.setPhase('lobby');
      } else {
        this.finish();
      }
      return;
    }
    this.releaseRound();
    this.round = {
      number: this.roundsPlayed + 1,
      challenge,
      count: challenge.clues.count,
      stepIndex: 0,
      stepRevealedAt: now,
      nextStepAt: null,
      endsAt: null,
      finders: new Map(),
      attempts: new Map(),
      votes: new Set(),
      feed: [],
      tokens: new Map(),
      clueTokens: [],
      revealToken: null,
    };
    this.countdownEndsAt = now + COUNTDOWN_MS;
    this.setPhase('countdown');
  }

  answer(playerId: string, stepIndex: number, text: string, now: number): AnswerOutcome {
    const round = this.round;
    const player = this.players.get(playerId);
    if (!player) return reject('UNKNOWN_PLAYER');
    if (this.phase_ !== 'round' || !round) return reject('NOT_IN_ROUND');
    if (round.finders.has(playerId)) return reject('ALREADY_FOUND');
    if (stepIndex !== round.stepIndex) return reject('STALE_STEP');

    const clean = text.normalize('NFC').trim();
    if (clean === '' || Array.from(clean).length > MAX_ANSWER_LENGTH || stripControl(clean)) {
      return reject('INVALID_ANSWER');
    }

    const attempts = this.attemptsOf(round, playerId);
    const block = this.quota(attempts, now);
    if (block) return reject(block.reason, block.retryAfterMs);

    // The attempt is spent from here on, right or wrong.
    attempts.total += 1;
    attempts.inStep += 1;
    attempts.lastAt = now;

    const { answer } = round.challenge;
    const options = {
      typoTolerance: this.config_.typoTolerance,
      aliases: this.config_.aliases,
    };
    if (answer.accepts(clean, options)) {
      const rank = round.finders.size + 1;
      const points = rankPoints(rank);
      round.finders.set(playerId, { rank, points });
      player.score += points;
      player.found += 1;
      if (rank === 1) player.firsts += 1;
      round.votes.delete(playerId);
      this.changed({ type: 'found', playerId, rank });
      this.tick(now);
      return { status: 'correct', rank, points };
    }

    attempts.wrong.push(clean);
    // Anything that names, abbreviates or misspells the answer stays private:
    // showing it, even refused, would give the answer away.
    if (this.config_.showWrongAnswers && !answer.isRelated(clean)) {
      round.feed.push({ playerId, text: clean });
    }
    this.version += 1;
    return { status: 'wrong' };
  }

  vote(playerId: string, stepIndex: number, now: number): VoteOutcome {
    const round = this.round;
    if (!this.players.has(playerId)) return { status: 'rejected', reason: 'UNKNOWN_PLAYER' };
    if (this.phase_ !== 'round' || !round) return { status: 'rejected', reason: 'NOT_IN_ROUND' };
    if (!this.config_.vote.enabled) return { status: 'rejected', reason: 'VOTES_DISABLED' };
    if (stepIndex !== round.stepIndex) return { status: 'rejected', reason: 'STALE_STEP' };
    if (round.stepIndex >= round.count - 1) return { status: 'rejected', reason: 'LAST_STEP' };
    if (!this.electors(round).includes(playerId)) {
      return { status: 'rejected', reason: 'NOT_ELIGIBLE' };
    }
    if (round.votes.has(playerId)) return { status: 'already' };
    round.votes.add(playerId);
    const { count, needed } = this.voteCount(round);
    this.changed({ type: 'votes', count, needed });
    this.tick(now);
    return { status: 'counted' };
  }

  // -------------------------------------------------------------- time

  /** When the engine next needs `tick` to be called, or `null` when it waits for something else. */
  nextDeadline(): number | null {
    const round = this.round;
    switch (this.phase_) {
      case 'countdown':
        return this.countdownEndsAt;
      case 'round': {
        if (!round) return null;
        const times: number[] = [];
        if (round.nextStepAt !== null) times.push(round.nextStepAt);
        if (round.endsAt !== null) times.push(round.endsAt);
        if (this.voteSucceeds(round)) times.push(round.stepRevealedAt + MIN_STEP_GAP_MS);
        return times.length > 0 ? Math.min(...times) : null;
      }
      case 'reveal':
        return this.revealEndsAt;
      default:
        return null;
    }
  }

  /** Applies everything that is due at `now`, in order. Safe to call at any time. */
  tick(now: number): void {
    for (let guard = 0; guard < 1_000; guard++) {
      if (!this.step(now)) return;
    }
  }

  private step(now: number): boolean {
    const round = this.round;
    switch (this.phase_) {
      case 'awaitingChallenge':
        return false;
      case 'countdown': {
        if (this.countdownEndsAt === null || now < this.countdownEndsAt || !round) return false;
        this.beginRound(round, this.countdownEndsAt);
        return true;
      }
      case 'round': {
        if (!round) return false;
        if (this.allActiveFound(round)) {
          this.endRound(round, now);
          return true;
        }
        if (this.voteSucceeds(round) && now >= round.stepRevealedAt + MIN_STEP_GAP_MS) {
          this.revealStep(round, round.stepIndex + 1, now);
          return true;
        }
        if (round.nextStepAt !== null && now >= round.nextStepAt) {
          this.revealStep(round, round.stepIndex + 1, round.nextStepAt);
          return true;
        }
        if (round.endsAt !== null && now >= round.endsAt) {
          this.endRound(round, round.endsAt);
          return true;
        }
        return false;
      }
      case 'reveal': {
        if (this.revealEndsAt === null || now < this.revealEndsAt) return false;
        if (this.gameOverAfterReveal) this.finish();
        else {
          this.revealEndsAt = null;
          this.setPhase('awaitingChallenge');
        }
        return true;
      }
      default:
        return false;
    }
  }

  private beginRound(round: Round, at: number): void {
    this.countdownEndsAt = null;
    this.setPhase('round');
    this.revealStep(round, 0, at);
  }

  private revealStep(round: Round, index: number, at: number): void {
    round.stepIndex = index;
    round.stepRevealedAt = at;
    round.votes = new Set();
    for (const attempts of round.attempts.values()) attempts.inStep = 0;
    const token = this.deps.newId();
    round.tokens.set(token, index);
    round.clueTokens[index] = token;
    const last = round.count - 1;
    if (index < last) {
      round.nextStepAt = at + this.config_.stepDelaySec * 1000;
      round.endsAt = null;
    } else {
      round.nextStepAt = null;
      round.endsAt = at + finalHoldSec(this.config_.stepDelaySec) * 1000;
    }
    this.changed({ type: 'step', index });
  }

  private endRound(round: Round, at: number): void {
    round.revealToken = this.deps.newId();
    round.tokens.set(round.revealToken, 'reveal');
    round.nextStepAt = null;
    round.endsAt = null;
    this.roundsPlayed += 1;
    const target = this.config_.targetScore;
    this.gameOverAfterReveal =
      this.roundsPlayed >= MAX_ROUNDS ||
      [...this.players.values()].some((player) => player.score >= target);
    this.revealEndsAt = at + REVEAL_MS;
    this.setPhase('reveal');
  }

  private finish(): void {
    this.winners = winnersOf(this.totals());
    this.revealEndsAt = null;
    this.setPhase('finished');
  }

  // ----------------------------------------------------- electors, votes

  /** Connected players who have not found the answer yet. */
  private electors(round: Round): string[] {
    return [...this.players.values()]
      .filter((player) => player.connected && !round.finders.has(player.id))
      .map((player) => player.id);
  }

  private voteCount(round: Round): { count: number; needed: number } {
    const electors = this.electors(round);
    const total = electors.length;
    const needed =
      this.config_.vote.threshold === 'half'
        ? Math.ceil(total / 2)
        : this.config_.vote.threshold === 'threeQuarters'
          ? Math.ceil((3 * total) / 4)
          : total;
    const count = electors.filter((id) => round.votes.has(id)).length;
    return { count, needed };
  }

  private voteSucceeds(round: Round): boolean {
    if (!this.config_.vote.enabled || round.stepIndex >= round.count - 1) return false;
    const { count, needed } = this.voteCount(round);
    return needed > 0 && count >= needed;
  }

  /** The round ends early when everyone still connected has found the answer. */
  private allActiveFound(round: Round): boolean {
    const active = [...this.players.values()].filter((player) => player.connected);
    return active.length > 0 && active.every((player) => round.finders.has(player.id));
  }

  // ----------------------------------------------------------- attempts

  private attemptsOf(round: Round, playerId: string): Attempts {
    let attempts = round.attempts.get(playerId);
    if (!attempts) {
      attempts = { total: 0, inStep: 0, lastAt: null, wrong: [] };
      round.attempts.set(playerId, attempts);
    }
    return attempts;
  }

  /** Why an answer would be refused right now, or null when it is allowed. */
  private quota(
    attempts: Attempts,
    now: number,
  ): { reason: (AnswerRejection & AnswerBlock) | 'RATE_LIMITED'; retryAfterMs?: number } | null {
    if (attempts.total >= MAX_ATTEMPTS_PER_ROUND) return { reason: 'TECHNICAL_CAP' };
    const mode = this.config_.attempts;
    if (mode.kind === 'perStep' && attempts.inStep >= 1) return { reason: 'STEP_ATTEMPT_USED' };
    if (mode.kind === 'limited' && attempts.total >= mode.max)
      return { reason: 'NO_ATTEMPTS_LEFT' };
    if (attempts.lastAt !== null) {
      const gap = mode.kind === 'unlimited' ? mode.cooldownSec * 1000 : MIN_ANSWER_GAP_MS;
      const wait = attempts.lastAt + gap - now;
      if (wait > 0) {
        return {
          reason: mode.kind === 'unlimited' ? 'COOLDOWN' : 'RATE_LIMITED',
          retryAfterMs: wait,
        };
      }
    }
    return null;
  }

  // -------------------------------------------------------------- frames

  /**
   * The picture behind a frame address. Only addresses minted at a reveal
   * exist, and only for the players of this game: a step that has not been
   * revealed has no address at all.
   */
  async openFrame(token: string, playerId: string): Promise<RenderedClue | null> {
    const round = this.round;
    if (!round || !this.players.has(playerId)) return null;
    const target = round.tokens.get(token);
    if (target === undefined) return null;
    return target === 'reveal'
      ? round.challenge.clues.renderReveal()
      : round.challenge.clues.render(target);
  }

  // --------------------------------------------------------------- views

  private totals(): Totals[] {
    return [...this.players.values()].map((player) => ({
      playerId: player.id,
      score: player.score,
      firsts: player.firsts,
      found: player.found,
      joinOrder: player.joinOrder,
    }));
  }

  publicView(now: number): PublicView {
    const placed = new Map(
      rankStandings(this.totals()).map((entry) => [entry.playerId, entry.place]),
    );
    const round = this.round;
    const showRound = round !== null && (this.phase_ === 'round' || this.phase_ === 'reveal');
    const players: PublicPlayer[] = [...this.players.values()]
      .sort((a, b) => a.joinOrder - b.joinOrder)
      .map((player) => {
        const finder = showRound ? round.finders.get(player.id) : undefined;
        return {
          id: player.id,
          nickname: player.nickname,
          connected: player.connected,
          isHost: player.id === this.hostId_,
          score: player.score,
          place: placed.get(player.id) ?? 1,
          found: finder !== undefined,
          foundRank: finder?.rank ?? null,
          foundPoints: finder?.points ?? null,
        };
      });
    return {
      version: this.version,
      serverNow: now,
      phase: this.phase_,
      config: this.config_,
      hostId: this.hostId_,
      players,
      roundsPlayed: this.roundsPlayed,
      countdownEndsAt: this.phase_ === 'countdown' ? this.countdownEndsAt : null,
      round: this.phase_ === 'round' && round ? this.publicRound(round) : null,
      reveal: this.phase_ === 'reveal' && round ? this.publicReveal(round) : null,
      revealEndsAt: this.phase_ === 'reveal' ? this.revealEndsAt : null,
      winners: this.winners,
    };
  }

  private publicRound(round: Round): PublicRound {
    const remainingSteps = round.count - 1 - round.stepIndex;
    const delay = this.config_.stepDelaySec * 1000;
    const hold = finalHoldSec(this.config_.stepDelaySec) * 1000;
    const endsAt =
      round.endsAt ??
      (round.nextStepAt ?? round.stepRevealedAt) + (remainingSteps - 1) * delay + hold;
    const canVote = this.config_.vote.enabled && round.stepIndex < round.count - 1;
    return {
      number: round.number,
      stepIndex: round.stepIndex,
      stepCount: round.count,
      frameToken: round.clueTokens[round.stepIndex] ?? '',
      nextStepAt: round.nextStepAt,
      endsAt,
      votes: canVote ? this.voteCount(round) : null,
      wrongAnswers: this.config_.showWrongAnswers
        ? round.feed.map((entry) => ({ ...entry }))
        : null,
    };
  }

  private publicReveal(round: Round): PublicReveal {
    return {
      names: round.challenge.answer.names,
      universe: round.challenge.answer.universe,
      frameToken: round.revealToken ?? '',
      finders: [...round.finders.entries()]
        .map(([playerId, finder]) => ({ playerId, rank: finder.rank, points: finder.points }))
        .sort((a, b) => a.rank - b.rank),
    };
  }

  privateView(playerId: string, now: number): PrivateView | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    const round = this.phase_ === 'round' ? this.round : null;
    const mode = this.config_.attempts;
    const attempts = round?.attempts.get(playerId);
    const used = attempts?.total ?? 0;
    const block = round
      ? round.finders.has(playerId)
        ? ({ reason: 'ALREADY_FOUND' } as const)
        : this.quota(attempts ?? { total: 0, inStep: 0, lastAt: null, wrong: [] }, now)
      : ({ reason: 'NOT_IN_ROUND' } as const);
    const blocked: AnswerBlock | null =
      block && block.reason !== 'RATE_LIMITED' ? block.reason : null;
    const left =
      mode.kind === 'perStep'
        ? Math.max(0, 1 - (attempts?.inStep ?? 0))
        : mode.kind === 'limited'
          ? Math.max(0, mode.max - used)
          : null;
    const wait = block && 'retryAfterMs' in block ? block.retryAfterMs : undefined;
    return {
      playerId,
      isHost: playerId === this.hostId_,
      attempts: mode,
      attemptsUsed: used,
      attemptsLeft: left,
      nextAnswerAt: wait === undefined ? null : now + wait,
      blocked,
      voted: round?.votes.has(playerId) ?? false,
      canVote:
        round !== null &&
        this.config_.vote.enabled &&
        round.stepIndex < round.count - 1 &&
        this.electors(round).includes(playerId),
      myWrongAnswers: attempts ? [...attempts.wrong] : [],
    };
  }

  // ------------------------------------------------------------ internals

  private setPhase(phase: MatchPhase): void {
    this.phase_ = phase;
    this.changed({ type: 'phase', phase });
  }

  private changed(event: MatchEvent): void {
    this.version += 1;
    this.events.push(event);
  }

  private releaseRound(): void {
    this.round?.challenge.clues.release();
    this.round = null;
  }

  /** Frees the pictures held in memory. The match accepts nothing afterwards. */
  close(): void {
    this.ended = true;
    this.releaseRound();
  }

  get closed(): boolean {
    return this.ended;
  }
}

function reject(reason: AnswerRejection, retryAfterMs?: number): AnswerOutcome {
  return retryAfterMs === undefined
    ? { status: 'rejected', reason }
    : { status: 'rejected', reason, retryAfterMs };
}
