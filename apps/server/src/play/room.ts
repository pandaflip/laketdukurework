import {
  clientMessageSchema,
  CLOSE_CODES,
  MAX_PLAYERS,
  type ClosingReason,
  type Locale,
  type ServerMessage,
} from '@app/shared';
import type { AppConfig } from '../config';
import { Match } from '../game/match';
import { MatchRuntime, type ChallengePoolHandle, type Timers } from '../game/runtime';
import { hashSecret, newOpaqueId, newSecret, secretMatches } from './codes';
import { TokenBucket } from './rate';

/** One live connection of a player, whatever carries it (a WebSocket, a test double). */
export interface Connection {
  /** Returns false when the message could not be queued (closed, or too far behind). */
  send(message: ServerMessage): boolean;
  close(code: number): void;
}

export interface RoomDeps {
  readonly code: string;
  readonly createdByIp: string;
  readonly config: AppConfig;
  readonly timers: Timers;
  readonly openPool: (config: Match['config']) => Promise<ChallengePoolHandle>;
  /** Number of challenges a configuration leaves (cached by the manager). */
  readonly poolSize: (config: Match['config']) => Promise<number>;
  readonly suggestions: (locale: Locale) => Promise<readonly string[]>;
  readonly onClosed: (room: Room) => void;
}

interface Member {
  readonly id: string;
  readonly secretHash: Buffer;
  readonly locale: Locale;
  connection: Connection | null;
  /** The welcome of the current connection was sent: state messages follow it, never precede it. */
  welcomed: boolean;
  graceCancel: (() => void) | null;
  leaveCancel: (() => void) | null;
}

interface ConnectionState {
  readonly bucket: TokenBucket;
  /** Recent offences (excess messages, invalid messages) and when the window opened. */
  offences: number;
  windowStart: number;
}

const ABUSE_LIMIT = 5;
const ABUSE_WINDOW_MS = 10_000;
const FLUSH_DELAY_MS = 30;
const POOL_MIN_INTERVAL_MS = 2_000;

export type JoinResult =
  | { readonly ok: true; readonly playerId: string; readonly secret: string }
  | { readonly ok: false; readonly reason: 'FULL' | 'STARTED' | 'BAD_NICKNAME' | 'NICKNAME_TAKEN' };

/**
 * One private room: a game, the people in it and their connections. Every
 * action of a connection is checked here against the identity that was
 * authenticated when the connection opened: the content of a message never
 * says who sends it.
 */
export class Room {
  readonly code: string;
  readonly createdByIp: string;
  readonly match: Match;
  readonly runtime: MatchRuntime;
  private readonly members = new Map<string, Member>();
  private readonly connections = new WeakMap<Connection, ConnectionState>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private poolAt = Number.NEGATIVE_INFINITY;
  private lastHostId = '';
  private closed = false;
  /** When the last connection left (null while someone is connected). */
  emptySince: number | null;
  finishedAt: number | null = null;
  lastActivity: number;

  constructor(private readonly deps: RoomDeps) {
    this.code = deps.code;
    this.createdByIp = deps.createdByIp;
    this.match = new Match({ newId: newOpaqueId });
    this.runtime = new MatchRuntime({
      match: this.match,
      timers: deps.timers,
      openPool: deps.openPool,
      onChange: () => {
        this.touch();
        this.markDirty();
      },
    });
    this.lastActivity = deps.timers.now();
    this.emptySince = this.lastActivity;
  }

  // ---------------------------------------------------------------- members

  /** Adds a player in the lobby. Their secret is returned once and only its hash is kept. */
  join(nickname: string, locale: Locale): JoinResult {
    const joined = this.match.addPlayer(nickname);
    if (!joined.ok) {
      const reason = joined.reason === 'NOT_LOBBY' ? 'STARTED' : joined.reason;
      return { ok: false, reason };
    }
    const secret = newSecret();
    const member: Member = {
      id: joined.playerId,
      secretHash: hashSecret(secret),
      locale,
      connection: null,
      welcomed: false,
      graceCancel: null,
      leaveCancel: null,
    };
    this.members.set(member.id, member);
    // Nobody is connected yet: the usual grace applies before they count as absent.
    this.startAbsence(member);
    this.touch();
    this.runtime.sync();
    this.markDirty();
    return { ok: true, playerId: member.id, secret };
  }

  /** Whether this identity belongs to a player of the room. */
  authenticate(playerId: string, secret: string): boolean {
    const member = this.members.get(playerId);
    return member !== undefined && secretMatches(member.secretHash, secret);
  }

  get connectedCount(): number {
    let count = 0;
    for (const member of this.members.values()) if (member.connection) count += 1;
    return count;
  }

  get memberCount(): number {
    return this.members.size;
  }

  info(): { phase: string; players: number; capacity: number; joinable: boolean } {
    return {
      phase: this.match.phase,
      players: this.members.size,
      capacity: MAX_PLAYERS,
      joinable: this.match.phase === 'lobby' && this.members.size < MAX_PLAYERS,
    };
  }

  // ------------------------------------------------------------ connections

  /** A new connection takes over the player's place; an older one is told and closed. */
  attach(playerId: string, connection: Connection): void {
    const member = this.members.get(playerId);
    if (!member || this.closed) {
      connection.close(CLOSE_CODES.policy);
      return;
    }
    this.cancelAbsence(member);
    const previous = member.connection;
    if (previous && previous !== connection) {
      previous.send({ type: 'closing', reason: 'REPLACED' });
      previous.close(CLOSE_CODES.replaced);
    }
    member.connection = connection;
    member.welcomed = false;
    this.emptySince = null;
    this.touch();
    this.runtime.run((match, now) => {
      match.setConnected(playerId, true, now);
    });

    const welcome = (suggestions: readonly string[]): void => {
      if (member.connection !== connection) return;
      connection.send({ type: 'welcome', roomCode: this.code, playerId, suggestions });
      member.welcomed = true;
      this.markDirty();
      this.sendPool(member, true);
    };
    void this.deps.suggestions(member.locale).then(welcome, () => {
      welcome([]);
    });
  }

  /** A connection ended. The game hears of it only after the grace delay. */
  detach(playerId: string, connection: Connection): void {
    const member = this.members.get(playerId);
    if (!member || member.connection !== connection) return;
    member.connection = null;
    this.noteEmpty();
    this.startAbsence(member);
  }

  private startAbsence(member: Member): void {
    this.cancelAbsence(member);
    const { config, timers } = this.deps;
    member.graceCancel = timers.setTimer(config.PLAYER_GRACE_SECONDS * 1000, () => {
      member.graceCancel = null;
      if (member.connection || this.closed) return;
      this.runtime.run((match, now) => {
        match.setConnected(member.id, false, now);
      });
      if (this.match.phase !== 'lobby') return;
      const remaining = Math.max(0, config.LOBBY_LEAVE_SECONDS - config.PLAYER_GRACE_SECONDS);
      member.leaveCancel = timers.setTimer(remaining * 1000, () => {
        member.leaveCancel = null;
        if (member.connection || this.closed || this.match.phase !== 'lobby') return;
        this.runtime.run((match, now) => {
          match.removePlayer(member.id, now);
        });
        this.members.delete(member.id);
        this.noteEmpty();
        this.markDirty();
      });
    });
  }

  private cancelAbsence(member: Member): void {
    member.graceCancel?.();
    member.leaveCancel?.();
    member.graceCancel = null;
    member.leaveCancel = null;
  }

  private noteEmpty(): void {
    if (this.connectedCount === 0 && this.emptySince === null) {
      this.emptySince = this.deps.timers.now();
    }
  }

  // --------------------------------------------------------------- messages

  /** Handles one raw message of a connection, whose identity was fixed at the handshake. */
  receive(playerId: string, connection: Connection, raw: string): void {
    const member = this.members.get(playerId);
    if (!member || member.connection !== connection || this.closed) {
      // A connection that was replaced, or whose player is gone, may no longer act.
      connection.close(CLOSE_CODES.policy);
      return;
    }
    const state = this.stateOf(connection);
    if (!state.bucket.take()) {
      connection.send({ type: 'error', code: 'RATE_LIMITED' });
      this.offence(connection, state);
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.invalid(connection, state);
      return;
    }
    const parsed = clientMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.invalid(connection, state);
      return;
    }
    this.touch();
    const message = parsed.data;

    switch (message.type) {
      case 'answer': {
        const result = this.runtime.run((match, now) =>
          match.answer(playerId, message.stepIndex, message.text, now),
        );
        connection.send({ type: 'answerResult', result });
        break;
      }
      case 'vote': {
        const result = this.runtime.run((match, now) =>
          match.vote(playerId, message.stepIndex, now),
        );
        connection.send({ type: 'voteResult', result });
        break;
      }
      case 'configure': {
        const result = this.runtime.run((match) => match.configure(playerId, message.config));
        connection.send(
          result.ok
            ? { type: 'commandResult', command: 'configure', ok: true }
            : { type: 'commandResult', command: 'configure', ok: false, reason: result.reason },
        );
        if (result.ok) this.sendPool(member, true);
        break;
      }
      case 'start': {
        void this.runtime.start(playerId).then(
          (result) => {
            connection.send(
              result.ok
                ? { type: 'commandResult', command: 'start', ok: true }
                : { type: 'commandResult', command: 'start', ok: false, reason: result.reason },
            );
          },
          () => {
            connection.send({
              type: 'commandResult',
              command: 'start',
              ok: false,
              reason: 'INVALID',
            });
          },
        );
        break;
      }
      case 'leave': {
        this.leave(member, connection);
        break;
      }
    }
  }

  private leave(member: Member, connection: Connection): void {
    member.connection = null;
    connection.send({ type: 'closing', reason: 'LEFT' });
    connection.close(CLOSE_CODES.normal);
    this.cancelAbsence(member);
    this.runtime.run((match, now) => {
      if (match.phase === 'lobby') match.removePlayer(member.id, now);
      else match.setConnected(member.id, false, now);
    });
    if (this.match.phase === 'lobby') this.members.delete(member.id);
    this.noteEmpty();
    this.markDirty();
  }

  private stateOf(connection: Connection): ConnectionState {
    let state = this.connections.get(connection);
    if (!state) {
      const rate = this.deps.config.WS_MESSAGES_PER_SECOND;
      state = {
        bucket: new TokenBucket(rate, rate * 2),
        offences: 0,
        windowStart: performance.now(),
      };
      this.connections.set(connection, state);
    }
    return state;
  }

  private invalid(connection: Connection, state: ConnectionState): void {
    connection.send({ type: 'error', code: 'INVALID_MESSAGE' });
    this.offence(connection, state);
  }

  private offence(connection: Connection, state: ConnectionState): void {
    const now = performance.now();
    if (now - state.windowStart > ABUSE_WINDOW_MS) {
      state.windowStart = now;
      state.offences = 0;
    }
    state.offences += 1;
    if (state.offences >= ABUSE_LIMIT) {
      connection.send({ type: 'closing', reason: 'ABUSE' });
      connection.close(CLOSE_CODES.policy);
    }
  }

  // ------------------------------------------------------------ broadcasting

  private touch(): void {
    this.lastActivity = this.deps.timers.now();
  }

  /** Changes are sent together, at most every few milliseconds. */
  markDirty(): void {
    if (this.flushTimer || this.closed) return;
    this.flushTimer = setTimeout(() => {
      this.flush();
    }, FLUSH_DELAY_MS);
    this.flushTimer.unref();
  }

  private flush(): void {
    this.flushTimer = null;
    if (this.closed) return;
    const now = this.deps.timers.now();
    const view = this.match.publicView(now);
    for (const member of this.members.values()) {
      const connection = member.connection;
      if (!connection || !member.welcomed) continue;
      const own = this.match.privateView(member.id, now);
      if (own) connection.send({ type: 'state', public: view, private: own });
    }
    if (view.phase === 'finished' && this.finishedAt === null) this.finishedAt = now;
    if (view.hostId !== this.lastHostId) {
      this.lastHostId = view.hostId;
      const host = this.members.get(view.hostId);
      if (host) this.sendPool(host, false);
    }
  }

  /** The host, in the lobby, learns how many challenges their filters leave. */
  private sendPool(member: Member, force: boolean): void {
    const connection = member.connection;
    if (!connection || this.match.phase !== 'lobby' || member.id !== this.match.hostId) return;
    const now = performance.now();
    if (!force && now - this.poolAt < POOL_MIN_INTERVAL_MS) return;
    this.poolAt = now;
    void this.deps.poolSize(this.match.config).then(
      (size) => {
        if (member.connection === connection && !this.closed) {
          connection.send({ type: 'pool', size });
        }
      },
      () => undefined,
    );
  }

  // ---------------------------------------------------------------- closing

  close(reason: ClosingReason): void {
    if (this.closed) return;
    this.closed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const member of this.members.values()) {
      this.cancelAbsence(member);
      member.connection?.send({ type: 'closing', reason });
      member.connection?.close(CLOSE_CODES.goingAway);
      member.connection = null;
    }
    this.runtime.close();
    this.deps.onClosed(this);
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
