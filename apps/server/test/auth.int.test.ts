import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  authenticate,
  hashToken,
  LOCK_DURATION_MS,
  MAX_FAILED_LOGINS,
  SESSION_IDLE_MS,
  SESSION_TTL_MS,
} from '../src/modules/auth/service';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  client,
  createAdmin,
  loginAs,
  sessionCookie,
  startApp,
  WEB_ORIGIN,
  type TestContext,
} from './helpers';

let context: TestContext;

beforeEach(async () => {
  context = await startApp();
  await createAdmin(context.db);
});

afterEach(async () => {
  await context.close();
});

describe('login', () => {
  it('opens a session with a hardened cookie', async () => {
    const response = await loginAs(context.app);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ admin: { username: ADMIN_USERNAME } });

    const cookie = response.cookies.find((entry) => entry.name === 'admin_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('accepts the username case-insensitively', async () => {
    expect((await loginAs(context.app, '  ADMIN ')).statusCode).toBe(200);
  });

  it('never stores the session token or the password in clear', async () => {
    const response = await loginAs(context.app);
    const token = sessionCookie(response).split('=')[1] ?? '';
    const session = await context.db.adminSession.findFirstOrThrow();
    expect(session.tokenHash).toBe(hashToken(token));
    expect(session.tokenHash).not.toContain(token);

    const admin = await context.db.adminUser.findFirstOrThrow();
    expect(admin.passwordHash).toMatch(/^\$argon2id\$/);
    expect(admin.passwordHash).not.toContain(ADMIN_PASSWORD);
    expect(response.body).not.toContain('passwordHash');
  });

  it('answers identically for a wrong password and an unknown user', async () => {
    const wrongPassword = await loginAs(context.app, ADMIN_USERNAME, 'not the password');
    const unknownUser = await loginAs(context.app, 'ghost', 'not the password');
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.body).toBe(unknownUser.body);
    expect(wrongPassword.json()).toEqual({ error: { code: 'INVALID_CREDENTIALS' } });
    expect(wrongPassword.cookies).toHaveLength(0);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    for (let attempt = 0; attempt < MAX_FAILED_LOGINS; attempt += 1) {
      expect((await loginAs(context.app, ADMIN_USERNAME, 'wrong')).statusCode).toBe(401);
    }
    const locked = await loginAs(context.app);
    expect(locked.statusCode).toBe(401);
    expect(locked.json()).toEqual({ error: { code: 'INVALID_CREDENTIALS' } });

    // The lock is temporary.
    await context.db.adminUser.updateMany({
      data: { lockedUntil: new Date(Date.now() - LOCK_DURATION_MS) },
    });
    expect((await loginAs(context.app)).statusCode).toBe(200);
  });

  it('resets the failure counter after a successful login', async () => {
    await loginAs(context.app, ADMIN_USERNAME, 'wrong');
    await loginAs(context.app);
    const admin = await context.db.adminUser.findFirstOrThrow();
    expect(admin.failedLoginCount).toBe(0);
  });

  it('refuses a disabled administrator', async () => {
    await context.db.adminUser.updateMany({ data: { disabledAt: new Date() } });
    expect((await loginAs(context.app)).statusCode).toBe(401);
  });

  it('rejects malformed or oversized credentials', async () => {
    const anonymous = client(context.app);
    expect((await anonymous.post('/auth/login', { username: 'admin' })).statusCode).toBe(400);
    expect(
      (await anonymous.post('/auth/login', { username: 'admin', password: 'x'.repeat(5000) }))
        .statusCode,
    ).toBe(400);
  });

  it('rate-limits login attempts per client', async () => {
    await context.close();
    context = await startApp({ loginRateLimitMax: 3 });
    await createAdmin(context.db);
    for (let attempt = 0; attempt < 3; attempt += 1) await loginAs(context.app, 'ghost', 'x');
    const response = await loginAs(context.app);
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: { code: 'RATE_LIMITED' } });
  });
});

describe('sessions', () => {
  it('protects every admin route', async () => {
    const anonymous = client(context.app);
    for (const url of ['/auth/me', '/universes', '/characters', '/characters/x', '/audit']) {
      const response = await anonymous.get(url);
      expect(response.statusCode, url).toBe(401);
      expect(response.json(), url).toEqual({ error: { code: 'UNAUTHENTICATED' } });
    }
    expect((await anonymous.post('/characters', {})).statusCode).toBe(401);
    expect((await anonymous.post('/characters/bulk-status', {})).statusCode).toBe(401);
    expect((await anonymous.put('/characters/x/classification', {})).statusCode).toBe(401);
    expect((await anonymous.post('/audit/x/restore')).statusCode).toBe(401);
  });

  it('rejects a forged session cookie', async () => {
    const forged = client(context.app, 'admin_session=not-a-real-token');
    expect((await forged.get('/auth/me')).statusCode).toBe(401);
  });

  it('identifies the administrator and ends the session on logout', async () => {
    const cookie = sessionCookie(await loginAs(context.app));
    const admin = client(context.app, cookie);
    expect((await admin.get('/auth/me')).json()).toMatchObject({
      admin: { username: ADMIN_USERNAME },
    });

    expect((await admin.post('/auth/logout')).statusCode).toBe(200);
    expect((await admin.get('/auth/me')).statusCode).toBe(401);
    expect(await context.db.adminSession.count()).toBe(0);
  });

  it('expires sessions after their lifetime or when idle', async () => {
    const token = sessionCookie(await loginAs(context.app)).split('=')[1] ?? '';
    const now = Date.now();
    expect(await authenticate(context.db, token, new Date(now))).not.toBeNull();
    expect(
      await authenticate(context.db, token, new Date(now + SESSION_IDLE_MS + 60_000)),
    ).toBeNull();

    const second = sessionCookie(await loginAs(context.app)).split('=')[1] ?? '';
    await context.db.adminSession.updateMany({
      // Recently active, yet past its absolute lifetime.
      data: { lastSeenAt: new Date(now + SESSION_TTL_MS + 30_000) },
    });
    expect(
      await authenticate(context.db, second, new Date(now + SESSION_TTL_MS + 60_000)),
    ).toBeNull();
  });

  it('closes the sessions of an administrator disabled afterwards', async () => {
    const admin = client(context.app, sessionCookie(await loginAs(context.app)));
    await context.db.adminUser.updateMany({ data: { disabledAt: new Date() } });
    expect((await admin.get('/auth/me')).statusCode).toBe(401);
  });
});

describe('cross-site request protection', () => {
  it('refuses state-changing requests from another origin or without origin', async () => {
    const cookie = sessionCookie(await loginAs(context.app));
    for (const origin of ['https://evil.example', undefined]) {
      const response = await context.app.inject({
        method: 'POST',
        url: '/api/admin/auth/logout',
        headers: { cookie, ...(origin === undefined ? {} : { origin }) },
        payload: {},
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: { code: 'FORBIDDEN_ORIGIN' } });
    }
    // The session is still valid: the forged logout had no effect.
    expect((await client(context.app, cookie).get('/auth/me')).statusCode).toBe(200);
  });

  it('refuses a login posted from another origin', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    expect(response.statusCode).toBe(403);
    expect(WEB_ORIGIN).not.toBe('https://evil.example');
  });
});
