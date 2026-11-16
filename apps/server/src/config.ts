import { z } from 'zod';

const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

function isBareHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Exact origin of the web app, used for CORS. Required: there is no permissive default. */
  WEB_ORIGIN: z.string().refine(isBareHttpOrigin, {
    message: 'must be a bare http(s) origin (scheme://host[:port]) without path or trailing slash',
  }),
  /** Required even before the first migration so that a misconfigured deploy fails fast. */
  DATABASE_URL: z
    .url()
    .refine((value) => /^postgres(ql)?:\/\//.test(value), { message: 'must be a postgres:// URL' }),
  TRUST_PROXY: booleanFlag.default(false),
  /** Private directory holding the image files. Never served statically. */
  STORAGE_DIR: z.string().min(1).default('./storage'),
  /** Largest accepted upload, in bytes. */
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(200_000_000).default(15_000_000),
  /** Largest accepted image, in pixels (width x height). Protects memory and CPU. */
  IMAGE_MAX_PIXELS: z.coerce.number().int().min(10_000).max(400_000_000).default(40_000_000),
  /** Smallest accepted side, in pixels. */
  IMAGE_MIN_SIDE: z.coerce.number().int().min(24).max(10_000).default(256),
  /** Images processed at the same time. */
  IMAGE_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),

  // --- Game rooms (Phase 2B). Defaults suit a small single instance. ---
  /** Rooms open at the same time, in total. */
  MAX_ROOMS: z.coerce.number().int().min(1).max(10_000).default(50),
  /** Rooms one IP address may have open at the same time. */
  MAX_ROOMS_PER_IP: z.coerce.number().int().min(1).max(1_000).default(3),
  /** An empty room (nobody connected) is closed after this long, in the lobby. */
  ROOM_EMPTY_LOBBY_MINUTES: z.coerce.number().min(0.01).max(1_440).default(2),
  /** ... and after this long once the game has started. */
  ROOM_EMPTY_GAME_MINUTES: z.coerce.number().min(0.01).max(1_440).default(10),
  /** A finished game is closed after this long. */
  ROOM_FINISHED_MINUTES: z.coerce.number().min(0.01).max(1_440).default(10),
  /** A room with no activity at all is closed after this long. */
  ROOM_IDLE_MINUTES: z.coerce.number().min(0.01).max(1_440).default(30),
  /** A lost connection is only reported to the game after this many seconds. */
  PLAYER_GRACE_SECONDS: z.coerce.number().min(0).max(300).default(5),
  /** A player who stays away from the lobby this long (seconds) frees their seat. */
  LOBBY_LEAVE_SECONDS: z.coerce.number().min(1).max(3_600).default(60),
  /** Per IP address and per minute: rooms created, joins, connections opened. */
  PLAY_CREATE_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(10),
  PLAY_JOIN_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(20),
  PLAY_CONNECT_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(60),
  /** Messages per second one connection may send (a burst of twice that is tolerated). */
  WS_MESSAGES_PER_SECOND: z.coerce.number().min(1).max(1_000).default(10),
  /** A connection with more than this many bytes waiting to be sent is closed (slow client). */
  WS_MAX_BUFFERED_BYTES: z.coerce.number().int().min(1_024).max(100_000_000).default(1_000_000),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Validates environment variables. This is the only place where the
 * environment is read. Error messages name the offending variables but never
 * echo their values, so secrets cannot leak into logs.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => {
        const name = issue.path.join('.');
        const missing = env[name] === undefined;
        return missing ? `${name}: missing` : `${name}: ${issue.message}`;
      }),
    );
  }
  return Object.freeze(result.data);
}
