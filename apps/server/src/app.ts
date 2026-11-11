import type { ApiError, ErrorCode } from '@app/shared';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config';
import { createDb } from './db';
import { AppError } from './errors';
import { registerAdminRoutes } from './modules/admin.routes';
import type { AuthRouteOptions } from './modules/auth/routes';
import { registerHealthRoutes } from './modules/health/routes';
import { registerSecurity, type SecurityOptions } from './plugins/security';

export type AppOptions = SecurityOptions & AuthRouteOptions;

function errorCodeForStatus(statusCode: number): ErrorCode {
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 503) return 'SERVICE_UNAVAILABLE';
  if (statusCode === 429) return 'RATE_LIMITED';
  if (statusCode >= 400 && statusCode < 500) return 'VALIDATION_ERROR';
  return 'INTERNAL_ERROR';
}

function errorBody(code: ErrorCode): ApiError {
  return { error: { code } };
}

export async function buildApp(
  config: AppConfig,
  options: AppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.LOG_LEVEL },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
  });

  // Clients only ever receive a stable error code: no stack traces, no internals.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(errorBody(error.code));
    }
    const candidate = (error as { statusCode?: unknown }).statusCode;
    const statusCode =
      typeof candidate === 'number' && candidate >= 400 && candidate < 600 ? candidate : 500;
    if (statusCode >= 500) request.log.error({ err: error }, 'unhandled error');
    return reply.status(statusCode).send(errorBody(errorCodeForStatus(statusCode)));
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send(errorBody('NOT_FOUND')));

  const db = createDb(config.DATABASE_URL);
  app.addHook('onClose', async () => {
    await db.$disconnect();
  });

  app.decorateRequest('admin', null);
  await registerSecurity(app, config, options);
  await app.register(cookie);

  await app.register(
    (api, _opts, done) => {
      registerHealthRoutes(api, db);
      done();
    },
    { prefix: '/api' },
  );
  await app.register(
    (admin, _opts, done) => {
      registerAdminRoutes(admin, db, config, options);
      done();
    },
    { prefix: '/api/admin' },
  );

  return app;
}
