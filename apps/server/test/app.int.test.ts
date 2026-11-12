import { apiErrorSchema, healthResponseSchema } from '@app/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { startApp, testConfig, type TestContext } from './helpers';

let context: TestContext | undefined;

afterEach(async () => {
  await context?.close();
  context = undefined;
});

describe('HTTP app', () => {
  it('reports the API and the database as healthy', async () => {
    context = await startApp();
    const response = await context.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toEqual({ status: 'ok', database: 'up' });
  });

  it('reports a database outage without leaking connection details', async () => {
    const secret = 's3cret-db-password';
    const app = await buildApp(
      testConfig({ DATABASE_URL: `postgresql://nobody:${secret}@127.0.0.1:1/unreachable_db` }),
    );
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'degraded', database: 'down' });
      expect(response.body).not.toContain(secret);
      expect(response.body).not.toContain('unreachable_db');
      expect(response.body).not.toContain('127.0.0.1');
    } finally {
      await app.close();
    }
  });

  it('sets security headers', async () => {
    context = await startApp();
    const response = await context.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS for the configured origin only', async () => {
    context = await startApp();
    const allowed = await context.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await context.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    expect(denied.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('returns a stable error code for unknown routes', async () => {
    context = await startApp();
    const response = await context.app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed JSON without leaking details', async () => {
    context = await startApp();
    context.app.post('/api/echo', (request) => request.body);
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('hides internal error messages', async () => {
    context = await startApp();
    context.app.get('/api/boom', () => {
      throw new Error('secret internal detail');
    });
    const response = await context.app.inject({ method: 'GET', url: '/api/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('secret internal detail');
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR' } });
  });

  it('rate-limits abusive clients', async () => {
    context = await startApp({ rateLimitMax: 2 });
    await context.app.inject({ method: 'GET', url: '/api/health' });
    await context.app.inject({ method: 'GET', url: '/api/health' });
    const response = await context.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: { code: 'RATE_LIMITED' } });
  });
});
