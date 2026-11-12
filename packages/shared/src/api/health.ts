import { z } from 'zod';

/** Liveness of the API and of its database. Never includes connection details. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
