/**
 * Locales supported by the platform. These are technical identifiers (BCP 47 tags):
 * they are never translated and never used as display names.
 */
export const SUPPORTED_LOCALES = ['en', 'fr', 'pt-BR'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the best supported locale from an ordered list of candidates
 * (e.g. `navigator.languages` or an `Accept-Language` header).
 *
 * Matching is case-insensitive: an exact tag wins, otherwise the primary
 * language subtag is used (`fr-CA` -> `fr`, `pt` or `pt-PT` -> `pt-BR`).
 * Falls back to {@link DEFAULT_LOCALE}.
 */
export function resolveLocale(candidates: readonly string[]): Locale {
  for (const candidate of candidates) {
    const tag = candidate.trim().toLowerCase();
    if (tag === '') continue;

    const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === tag);
    if (exact) return exact;

    const primary = tag.split(/[-_]/)[0];
    const byLanguage = SUPPORTED_LOCALES.find(
      (locale) => locale.toLowerCase().split('-')[0] === primary,
    );
    if (byLanguage) return byLanguage;
  }
  return DEFAULT_LOCALE;
}
