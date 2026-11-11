import { derivedDatabaseUrl } from '../src/testing/database';

/** Reads the repository `.env` when present; real environment variables win. */
export function loadRootEnv(): void {
  try {
    process.loadEnvFile(new URL('../../../.env', import.meta.url));
  } catch {
    // No .env file (CI): DATABASE_URL comes from the environment.
  }
}

export function resolveDatabaseUrls(): { baseUrl: string; testUrl: string } {
  loadRootEnv();
  const baseUrl = process.env.TEST_BASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (baseUrl === undefined || baseUrl === '') {
    throw new Error('DATABASE_URL is required to run the tests (see .env.example).');
  }
  return { baseUrl, testUrl: derivedDatabaseUrl(baseUrl, 'test') };
}
