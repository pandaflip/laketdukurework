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
