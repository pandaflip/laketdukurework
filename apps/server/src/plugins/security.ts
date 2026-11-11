import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config';

export interface SecurityOptions {
  /** Maximum requests per minute and per IP. Overridable in tests. */
  readonly rateLimitMax?: number;
}

/**
 * Baseline HTTP hardening applied to every route:
 * security headers, CORS restricted to the configured web origin, and a
 * global per-IP rate limit. Stricter per-route limits are added by features.
 */
export async function registerSecurity(
  app: FastifyInstance,
  config: AppConfig,
  options: SecurityOptions = {},
): Promise<void> {
  await app.register(helmet, {
    // The API only serves JSON: forbid everything by default.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] },
    },
  });

  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  await app.register(rateLimit, {
    max: options.rateLimitMax ?? 120,
    timeWindow: '1 minute',
  });
}
