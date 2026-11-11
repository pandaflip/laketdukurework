import { healthResponseSchema, type HealthResponse } from '@app/shared';

/** All API calls are same-origin (`/api/...`); responses are validated before use. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health', signal ? { signal } : {});
  if (!response.ok) throw new Error(`health check failed: ${response.status}`);
  return healthResponseSchema.parse(await response.json());
}
