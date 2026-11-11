import type { UniverseAudience } from './core-exclusions';

/** Minimum length of the written justification of a verified-adult classification. */
export const ADULT_NOTE_MIN_LENGTH = 20;

/**
 * Stricter minimum used for universes with a young audience, for the
 * justification of the classification and of the sensitive-mode unlock.
 */
export const STRICT_NOTE_MIN_LENGTH = 60;

export function adultNoteMinLength(audience: UniverseAudience): number {
  return audience === 'YOUTH' ? STRICT_NOTE_MIN_LENGTH : ADULT_NOTE_MIN_LENGTH;
}
