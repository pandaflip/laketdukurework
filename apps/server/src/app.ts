import type { ApiError, ErrorCode } from '@app/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config';
import { registerHealthRoutes } from './modules/health/routes';
import { registerSecurity, type SecurityOptions } from './plugins/security';

function errorCodeForStatus(statusCode: number): ErrorCode {
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 429) return 'RATE_LIMITED';
  if (statusCode >= 400 && statusCode < 500) return 'VALIDATION_ERROR';
  return 'INTERNAL_ERROR';
}

function errorBody(code: ErrorCode): ApiError {
  return { error: { code } };
}

export async function buildApp(
  config: AppConfig,
  options: SecurityOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.LOG_LEVEL },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
  });

  // Clients only ever receive a stable error code: no stack traces, no internals.
  app.setErrorHandler((error, request, reply) => {
    const candidate = (error as { statusCode?: unknown }).statusCode;
    const statusCode =
      typeof candidate === 'number' && candidate >= 400 && candidate < 600 ? candidate : 500;
    if (statusCode >= 500) request.log.error({ err: error }, 'unhandled error');
    return reply.status(statusCode).send(errorBody(errorCodeForStatus(statusCode)));
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send(errorBody('NOT_FOUND')));

  await registerSecurity(app, config, options);

  await app.register(
    (api, _opts, done) => {
      registerHealthRoutes(api);
      done();
    },
    { prefix: '/api' },
  );

  return app;
}
