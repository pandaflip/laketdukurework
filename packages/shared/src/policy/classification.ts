import type { UniverseAudience } from './audience';

/** Minimum length of the written justification of a verified-adult classification. */
export const ADULT_NOTE_MIN_LENGTH = 20;

/**
 * Stricter minimum used for universes that are not reviewed as general
 * audience, and for the audience review and the sensitive-mode unlock.
 */
export const STRICT_NOTE_MIN_LENGTH = 60;

export function adultNoteMinLength(audience: UniverseAudience): number {
  return audience === 'GENERAL' ? ADULT_NOTE_MIN_LENGTH : STRICT_NOTE_MIN_LENGTH;
}
