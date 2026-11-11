import type { ErrorCode } from '@app/shared';
import type { z } from 'zod';

/** An expected failure, reported to the client as a status and a stable code only. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export const notFound = (): AppError => new AppError(404, 'NOT_FOUND');
export const conflict = (): AppError => new AppError(409, 'CONFLICT');
export const invalid = (): AppError => new AppError(400, 'VALIDATION_ERROR');

/** Validates untrusted input. Unknown keys are dropped, never passed through. */
export function parse<Schema extends z.ZodType>(schema: Schema, input: unknown): z.infer<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) throw invalid();
  return result.data;
}
