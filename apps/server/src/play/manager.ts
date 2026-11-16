import type { ClosingReason, Locale, RoomConfig } from '@app/shared';
import type { AppConfig } from '../config';
import type { Db } from '../db';
import { loadCatalog } from '../game/candidates';
import type { Random } from '../game/deck';
import { ChallengePool } from '../game/pool';
import type { Timers } from '../game/runtime';
import type { FileStorage } from '../modules/images/storage';
import { newRoomCode } from './codes';
import { Room, type JoinResult } from './room';

export interface ManagerDeps {
  readonly config: AppConfig;
  readonly db: Db;
  readonly storage: FileStorage;
  readonly limit: <T>(task: () => Promise<T>) => Promise<T>;
  readonly random: Random;
  readonly timers: Timers;
}

export type CreateResult =
  | { readonly ok: true; readonly room: Room; readonly playerId: string; readonly secret: string }
  | { readonly ok: false; readonly reason: 'TOO_MANY_ROOMS' | 'BAD_NICKNAME' };

const SWEEP_INTERVAL_MS = 30_000;
const POOL_CACHE_MS = 30_000;
const SUGGESTION_CACHE_MS = 60_000;

/**
 * Every open room of this server instance. Rooms live in memory only: a
 * restart ends them. The number of rooms, in total and per address, is
 * limited by the configuration.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly poolCache = new Map<string, { at: number; size: Promise<number> }>();
  private suggestionCache: {
    at: number;
    lists: Promise<Awaited<ReturnType<typeof loadCatalog>>['suggestions']>;
  } | null = null;
  private cancelSweep: (() => void) | null = null;
  private stopped = false;

  constructor(private readonly deps: ManagerDeps) {
    this.scheduleSweep();
  }

  get count(): number {
    return this.rooms.size;
  }

  find(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  create(ip: string, nickname: string, locale: Locale): CreateResult {
    const { config } = this.deps;
    if (this.stopped || this.rooms.size >= config.MAX_ROOMS) {
      return { ok: false, reason: 'TOO_MANY_ROOMS' };
    }
    let owned = 0;
    for (const room of this.rooms.values()) if (room.createdByIp === ip) owned += 1;
    if (owned >= config.MAX_ROOMS_PER_IP) return { ok: false, reason: 'TOO_MANY_ROOMS' };

    let code = newRoomCode();
    for (let attempt = 0; this.rooms.has(code) && attempt < 20; attempt++) code = newRoomCode();
    if (this.rooms.has(code)) return { ok: false, reason: 'TOO_MANY_ROOMS' };

    const room = new Room({
      code,
      createdByIp: ip,
      config,
      timers: this.deps.timers,
      openPool: (roomConfig) =>
        ChallengePool.open(
          {
            db: this.deps.db,
            storage: this.deps.storage,
            limit: this.deps.limit,
            random: this.deps.random,
          },
          roomConfig,
        ),
      poolSize: (roomConfig) => this.poolSize(roomConfig),
      suggestions: (roomLocale) => this.suggestions(roomLocale),
      onClosed: (closed) => {
        if (this.rooms.get(closed.code) === closed) this.rooms.delete(closed.code);
      },
    });
    const joined: JoinResult = room.join(nickname, locale);
    if (!joined.ok) {
      room.close('ROOM_CLOSED');
      return { ok: false, reason: 'BAD_NICKNAME' };
    }
    this.rooms.set(code, room);
    return { ok: true, room, playerId: joined.playerId, secret: joined.secret };
  }

  /** The number of challenges a configuration leaves, cached briefly per filter. */
  poolSize(config: RoomConfig): Promise<number> {
    const key = JSON.stringify([config.modeId, config.filter]);
    const now = this.deps.timers.now();
    const cached = this.poolCache.get(key);
    if (cached && now - cached.at < POOL_CACHE_MS) return cached.size;
    const size = ChallengePool.open(
      {
        db: this.deps.db,
        storage: this.deps.storage,
        limit: this.deps.limit,
        random: this.deps.random,
      },
      config,
    ).then((pool) => pool.size);
    this.poolCache.set(key, { at: now, size });
    size.catch(() => this.poolCache.delete(key));
    if (this.poolCache.size > 200) this.poolCache.clear();
    return size;
  }

  /** What players may type, by language: names of the non-excluded catalog. */
  async suggestions(locale: Locale): Promise<readonly string[]> {
    const now = this.deps.timers.now();
    if (!this.suggestionCache || now - this.suggestionCache.at >= SUGGESTION_CACHE_MS) {
      const lists = loadCatalog(this.deps.db).then((catalog) => catalog.suggestions);
      this.suggestionCache = { at: now, lists };
      lists.catch(() => {
        this.suggestionCache = null;
      });
    }
    return (await this.suggestionCache.lists)[locale];
  }

  // ---------------------------------------------------------------- cleanup

  private scheduleSweep(): void {
    this.cancelSweep = this.deps.timers.setTimer(SWEEP_INTERVAL_MS, () => {
      this.sweep();
      if (!this.stopped) this.scheduleSweep();
    });
  }

  /** Closes the rooms nobody uses any more. */
  sweep(): void {
    const { config, timers } = this.deps;
    const now = timers.now();
    const minutes = (value: number): number => value * 60_000;
    for (const room of [...this.rooms.values()]) {
      const phase = room.match.phase;
      const emptyFor = room.emptySince === null ? 0 : now - room.emptySince;
      const emptyLimit = minutes(
        phase === 'lobby' ? config.ROOM_EMPTY_LOBBY_MINUTES : config.ROOM_EMPTY_GAME_MINUTES,
      );
      const finished =
        room.finishedAt !== null && now - room.finishedAt > minutes(config.ROOM_FINISHED_MINUTES);
      const idle = now - room.lastActivity > minutes(config.ROOM_IDLE_MINUTES);
      if ((room.emptySince !== null && emptyFor > emptyLimit) || finished || idle) {
        room.close('ROOM_CLOSED');
      }
    }
  }

  /** Closes everything, telling the players. Used when the server stops. */
  closeAll(reason: ClosingReason): void {
    this.stopped = true;
    this.cancelSweep?.();
    this.cancelSweep = null;
    for (const room of [...this.rooms.values()]) room.close(reason);
    this.rooms.clear();
  }
}
