import { z } from 'zod';

/**
 * Stable, language-independent error codes returned by the API.
 * Clients translate them through the `errors` namespace; the server never
 * sends human-readable or internal error messages.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  error: z.object({ code: z.enum(ERROR_CODES) }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
