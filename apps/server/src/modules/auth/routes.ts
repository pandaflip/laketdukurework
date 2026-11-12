import { loginRequestSchema, type AdminDto } from '@app/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config';
import type { Db } from '../../db';
import { parse } from '../../errors';
import { clearSessionCookie, isSecureOrigin, requireAdmin, sessionCookieName } from './guard';
import { login, logout } from './service';

export interface AuthRouteOptions {
  /** Login attempts allowed per IP in a 5-minute window. Overridable in tests. */
  readonly loginRateLimitMax?: number;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  db: Db,
  config: AppConfig,
  options: AuthRouteOptions = {},
): void {
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: options.loginRateLimitMax ?? 10, timeWindow: '5 minutes' } } },
    async (request, reply): Promise<{ admin: AdminDto }> => {
      const body = parse(loginRequestSchema, request.body);
      const result = await login(db, body.username, body.password);
      void reply.setCookie(sessionCookieName(config), result.token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: isSecureOrigin(config),
        path: '/',
        expires: result.expiresAt,
      });
      return { admin: result.admin };
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[sessionCookieName(config)];
    if (token !== undefined) await logout(db, token);
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  app.get('/auth/me', (request): { admin: AdminDto } => ({ admin: requireAdmin(request) }));
}
