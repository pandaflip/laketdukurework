import type { ApiError, ErrorCode } from '@app/shared';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config';
import { createDb } from './db';
import { AppError } from './errors';
import { registerAdminRoutes } from './modules/admin.routes';
import { createLimiter } from './modules/images/processing';
import { createImageDeps } from './modules/images/service';
import { FileStorage } from './modules/images/storage';
import { systemTimers, type Timers } from './game/runtime';
import type { Random } from './game/deck';
import { RoomManager } from './play/manager';
import { MAX_MESSAGE_BYTES, registerPlayRoutes } from './play/routes';
import type { AuthRouteOptions } from './modules/auth/routes';
import { registerHealthRoutes } from './modules/health/routes';
import { registerSecurity, type SecurityOptions } from './plugins/security';

/** Test hooks for the game rooms: the game clock and the draw. */
export interface PlayOptions {
  readonly playTimers?: Timers;
  readonly playRandom?: Random;
}

export type AppOptions = SecurityOptions & AuthRouteOptions & PlayOptions;

function errorCodeForStatus(statusCode: number): ErrorCode {
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 413) return 'FILE_TOO_LARGE';
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
  // Streams: a file is only read by the one route that asks for it, and never above the limit.
  await app.register(multipart, {
    limits: { fileSize: config.UPLOAD_MAX_BYTES, files: 1, fields: 0, parts: 2 },
  });
  // One budget of simultaneous image work, shared by the administration and the games.
  const imageLimit = createLimiter(config.IMAGE_CONCURRENCY);
  const images = createImageDeps(db, config, imageLimit, (details, message) => {
    app.log.warn(details, message);
  });
  const rooms = new RoomManager({
    config,
    db,
    storage: new FileStorage(config.STORAGE_DIR),
    limit: imageLimit,
    random: options.playRandom ?? Math.random,
    timers: options.playTimers ?? systemTimers,
  });
  await app.register(websocket, {
    options: { maxPayload: MAX_MESSAGE_BYTES },
    // On shutdown, players are told the server stops (and their rooms close) BEFORE the
    // connections are cut, which is what the plugin does by default.
    preClose(done) {
      rooms.closeAll('SERVER_STOPPING');
      for (const client of this.websocketServer.clients) client.close();
      this.websocketServer.close(done);
    },
  });

  await app.register(
    (api, _opts, done) => {
      registerHealthRoutes(api, db);
      done();
    },
    { prefix: '/api' },
  );
  await app.register(
    (play, _opts, done) => {
      registerPlayRoutes(play, { manager: rooms, config });
      done();
    },
    { prefix: '/api/play' },
  );
  await app.register(
    (admin, _opts, done) => {
      registerAdminRoutes(admin, db, config, images, options);
      done();
    },
    { prefix: '/api/admin' },
  );

  return app;
}
