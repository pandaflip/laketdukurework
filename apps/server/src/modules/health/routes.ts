import type { HealthResponse } from '@app/shared';
import type { FastifyInstance } from 'fastify';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', (): HealthResponse => ({ status: 'ok' }));
}
