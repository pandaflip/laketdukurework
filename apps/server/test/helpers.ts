import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp, type AppOptions } from '../src/app';
import { loadConfig, type AppConfig } from '../src/config';
import { createDb, type Db } from '../src/db';
import { hashPassword } from '../src/modules/auth/password';
import { truncateAll } from '../src/testing/database';

export const WEB_ORIGIN = 'http://localhost:5173';
export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = 'correct horse battery staple';

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    WEB_ORIGIN,
    DATABASE_URL: process.env.DATABASE_URL,
    ...overrides,
  });
}

let passwordHash: Promise<string> | undefined;

export async function createAdmin(db: Db, username = ADMIN_USERNAME): Promise<string> {
  passwordHash ??= hashPassword(ADMIN_PASSWORD);
  const admin = await db.adminUser.create({ data: { username, passwordHash: await passwordHash } });
  return admin.id;
}

export interface TestContext {
  readonly app: FastifyInstance;
  readonly db: Db;
  close(): Promise<void>;
}

/** A fresh app on an emptied test database. */
export async function startApp(options: AppOptions = {}): Promise<TestContext> {
  const config = testConfig();
  const db = createDb(config.DATABASE_URL);
  await truncateAll(db);
  const app = await buildApp(config, options);
  return {
    app,
    db,
    close: async () => {
      await app.close();
      await db.$disconnect();
    },
  };
}

export function sessionCookie(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((entry) => entry.name === 'admin_session');
  if (!cookie) throw new Error('no session cookie in response');
  return `${cookie.name}=${cookie.value}`;
}

export async function loginAs(
  app: FastifyInstance,
  username = ADMIN_USERNAME,
  password = ADMIN_PASSWORD,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    headers: { origin: WEB_ORIGIN },
    payload: { username, password },
  });
}

export interface Client {
  get(url: string): Promise<LightMyRequestResponse>;
  post(url: string, payload?: unknown): Promise<LightMyRequestResponse>;
  put(url: string, payload?: unknown): Promise<LightMyRequestResponse>;
  delete(url: string): Promise<LightMyRequestResponse>;
}

/** Sends requests like the web app does: same origin, with the session cookie if any. */
export function client(app: FastifyInstance, cookie?: string): Client {
  const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    const options: InjectOptions = {
      method,
      url: `/api/admin${url}`,
      headers: { origin: WEB_ORIGIN, ...(cookie === undefined ? {} : { cookie }) },
      ...(payload === undefined ? {} : { payload: payload as object }),
    };
    return app.inject(options);
  };
  return {
    get: (url) => send('GET', url),
    post: (url, payload) => send('POST', url, payload ?? {}),
    put: (url, payload) => send('PUT', url, payload ?? {}),
    delete: (url) => send('DELETE', url),
  };
}

/** Logs the default admin in and returns an authenticated client. */
export async function adminClient(context: TestContext): Promise<Client> {
  await createAdmin(context.db);
  return client(context.app, sessionCookie(await loginAs(context.app)));
}
