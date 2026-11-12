import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Db } from '../db';

/**
 * Helpers for automated tests only. They work on a separate database whose
 * name is derived from the configured one (`app_dev` -> `app_dev_test`), so
 * development data is never touched.
 */

export function derivedDatabaseUrl(baseUrl: string, suffix: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}_${suffix}`;
  return url.toString();
}

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

/** Creates the derived database if needed and applies every migration to it. */
export async function prepareDatabase(baseUrl: string, targetUrl: string): Promise<void> {
  const name = databaseName(targetUrl);
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('unexpected test database name');

  const client = new pg.Client({ connectionString: baseUrl, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
  } catch {
    throw new Error(
      'PostgreSQL is not reachable. Start it with `pnpm db:up` and check DATABASE_URL in .env.',
    );
  }
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }

  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: targetUrl },
    stdio: 'pipe',
  });
}

export async function truncateAll(db: Db): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE "AuditLog", "AdminSession", "Asset", "Variant", "CharacterBlockedMode", ' +
      '"CharacterLabel", "Character", "Universe", "AdminUser" RESTART IDENTITY CASCADE',
  );
}
