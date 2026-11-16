import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../errors';
import type { AuditContext } from './audit/log';
import { requireAdmin } from './auth/guard';

const idParams = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
});

/** Who is acting, for the history. Throws 401 when nobody is signed in. */
export function context(request: FastifyRequest): AuditContext {
  return { adminId: requireAdmin(request).id };
}

/** The `:id` of the route, validated. */
export function idOf(request: FastifyRequest): string {
  return parse(idParams, request.params).id;
}
