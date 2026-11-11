/**
 * Administrable status of a character. It never grants access to sensitive
 * modes on its own: see `policy/eligibility.ts`.
 * - ALLOWED:    active in the catalog, subject to each mode's eligibility rules
 * - RESTRICTED: neutral modes only (default for every new character)
 * - EXCLUDED:   removed from every mode
 */
export const CHARACTER_STATUSES = ['ALLOWED', 'RESTRICTED', 'EXCLUDED'] as const;
export type CharacterStatus = (typeof CHARACTER_STATUSES)[number];
export const DEFAULT_CHARACTER_STATUS: CharacterStatus = 'RESTRICTED';

/**
 * Safety classification, independent from the status. Only `ADULT_VERIFIED`
 * can make a character eligible to sensitive modes, and it is never the default.
 */
export const AGE_CLASSES = [
  'UNKNOWN',
  'ADULT_VERIFIED',
  'MINOR',
  'CHILDLIKE',
  'AMBIGUOUS',
] as const;
export type AgeClass = (typeof AGE_CLASSES)[number];
export const DEFAULT_AGE_CLASS: AgeClass = 'UNKNOWN';

/** Per-asset review. Unverified content is excluded everywhere by default. */
export const ASSET_REVIEWS = [
  'UNVERIFIED',
  'APPROVED_NEUTRAL',
  'APPROVED_SENSITIVE',
  'REJECTED',
] as const;
export type AssetReview = (typeof ASSET_REVIEWS)[number];

export const LABEL_KINDS = ['NAME', 'ALIAS'] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];
