/**
 * Canonical form used to compare names: accents and case are ignored, and
 * anything that is not a letter or a digit is dropped ("Zoé" -> "zoe",
 * "Miss Fortune" -> "missfortune", "Kai'Sa" -> "kaisa").
 */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** URL-safe technical identifier derived from a display name ("Miss Fortune" -> "miss-fortune"). */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
