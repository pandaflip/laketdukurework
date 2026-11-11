import type { AdminDto } from '@app/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config';
import type { Db } from '../../db';
import { AppError } from '../../errors';
import { authenticate } from './service';

declare module 'fastify' {
  interface FastifyRequest {
    admin: AdminDto | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function sessionCookieName(config: AppConfig): string {
  // The `__Host-` prefix makes browsers refuse the cookie unless it is Secure,
  // host-only and scoped to `/`. It requires HTTPS, so plain names are used locally.
  return isSecureOrigin(config) ? '__Host-admin_session' : 'admin_session';
}

export function isSecureOrigin(config: AppConfig): boolean {
  return config.WEB_ORIGIN.startsWith('https://');
}

/**
 * CSRF defence in depth, on top of the SameSite=Strict cookie: every
 * state-changing admin request must come from the web app's own origin.
 */
export function assertSameOrigin(request: FastifyRequest, config: AppConfig): void {
  if (SAFE_METHODS.has(request.method)) return;
  if (request.headers.origin !== config.WEB_ORIGIN) throw new AppError(403, 'FORBIDDEN_ORIGIN');
}

export async function loadAdmin(request: FastifyRequest, db: Db, config: AppConfig): Promise<void> {
  const token = request.cookies[sessionCookieName(config)];
  request.admin = token === undefined ? null : await authenticate(db, token);
}

export function requireAdmin(request: FastifyRequest): AdminDto {
  if (!request.admin) throw new AppError(401, 'UNAUTHENTICATED');
  return request.admin;
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  void reply.clearCookie(sessionCookieName(config), { path: '/' });
}
