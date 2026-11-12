import type { HealthResponse } from '@app/shared';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db';

const DATABASE_TIMEOUT_MS = 2_000;

async function databaseIsUp(db: Db): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('database health check timed out'));
        }, DATABASE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reports only "up" or "down". The connection string, host, credentials and
 * the underlying error are never included in the response.
 */
export function registerHealthRoutes(app: FastifyInstance, db: Db): void {
  app.get('/health', async (request, reply): Promise<HealthResponse> => {
    if (await databaseIsUp(db)) return { status: 'ok', database: 'up' };
    request.log.warn('database health check failed');
    void reply.status(503);
    return { status: 'degraded', database: 'down' };
  });
}
