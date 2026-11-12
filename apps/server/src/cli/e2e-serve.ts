import { rm } from 'node:fs/promises';
import path from 'node:path';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { createDb } from '../db';
import { hashPassword } from '../modules/auth/password';
import { derivedDatabaseUrl, prepareDatabase, truncateAll } from '../testing/database';
import { seedDemoCatalog } from './seed';

/**
 * Server used by the browser tests only. It runs on a dedicated, freshly
 * reset database (`<name>_e2e`) with the demo catalog and one test admin.
 */
if (process.env.NODE_ENV !== 'test') {
  throw new Error('e2e-serve only runs with NODE_ENV=test');
}
const username = process.env.E2E_ADMIN_USERNAME;
const password = process.env.E2E_ADMIN_PASSWORD;
if (username === undefined || password === undefined) {
  throw new Error('E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD are required');
}

const base = loadConfig(process.env);

// Images of the browser tests live in their own directory, emptied at every start.
const storageDir = path.resolve(base.STORAGE_DIR);
if (path.basename(storageDir) !== 'e2e') {
  throw new Error('e2e-serve only resets a storage directory named "e2e"');
}
await rm(storageDir, { recursive: true, force: true });
const databaseUrl = derivedDatabaseUrl(base.DATABASE_URL, 'e2e');
await prepareDatabase(base.DATABASE_URL, databaseUrl);

const db = createDb(databaseUrl);
await truncateAll(db);
await seedDemoCatalog(db);
await db.adminUser.create({ data: { username, passwordHash: await hashPassword(password) } });
await db.$disconnect();

const config = { ...base, DATABASE_URL: databaseUrl };
// The browser suite sends far more requests than a person does, all from one address:
// its limits are raised here only. The defaults of the real server are unchanged.
const app = await buildApp(config, { loginRateLimitMax: 1000, rateLimitMax: 100_000 });
await app.listen({ host: config.HOST, port: config.PORT });
