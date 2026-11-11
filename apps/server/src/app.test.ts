import { apiErrorSchema, healthResponseSchema } from '@app/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig({
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://app:pw@127.0.0.1:5432/app_test',
});

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('HTTP app', () => {
  it('answers the health check', async () => {
    app = await buildApp(config);
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toEqual({ status: 'ok' });
  });

  it('sets security headers', async () => {
    app = await buildApp(config);
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS for the configured origin only', async () => {
    app = await buildApp(config);
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    expect(denied.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('returns a stable error code for unknown routes', async () => {
    app = await buildApp(config);
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed JSON without leaking details', async () => {
    app = await buildApp(config);
    app.post('/api/echo', (request) => request.body);
    const response = await app.inject({
      method: 'POST',
      url: '/api/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('hides internal error messages', async () => {
    app = await buildApp(config);
    app.get('/api/boom', () => {
      throw new Error('secret internal detail');
    });
    const response = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('secret internal detail');
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR' } });
  });

  it('rate-limits abusive clients', async () => {
    app = await buildApp(config, { rateLimitMax: 2 });
    await app.inject({ method: 'GET', url: '/api/health' });
    await app.inject({ method: 'GET', url: '/api/health' });
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: { code: 'RATE_LIMITED' } });
  });
});
