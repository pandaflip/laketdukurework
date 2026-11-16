/**
 * What a host may restrict a game to. Every list holds technical identifiers
 * (slugs), never display names. Empty lists restrict nothing.
 *
 *  - `universes`: at least one of these universes (OR)
 *  - `excludeUniverses`: none of these universes
 *  - `include`: at least one of these categories (OR)
 *  - `require`: all of these categories (AND)
 *  - `exclude`: none of these categories (EXCEPT)
 */
export interface ContentFilter {
  readonly universes: readonly string[];
  readonly excludeUniverses: readonly string[];
  readonly include: readonly string[];
  readonly require: readonly string[];
  readonly exclude: readonly string[];
}

export const EMPTY_FILTER: ContentFilter = {
  universes: [],
  excludeUniverses: [],
  include: [],
  require: [],
  exclude: [],
};

export interface FilterSubject {
  readonly universeSlug: string;
  readonly categorySlugs: readonly string[];
}

export function matchesFilter(filter: ContentFilter, subject: FilterSubject): boolean {
  const categories = new Set(subject.categorySlugs);
  if (filter.universes.length > 0 && !filter.universes.includes(subject.universeSlug)) return false;
  if (filter.excludeUniverses.includes(subject.universeSlug)) return false;
  if (filter.include.length > 0 && !filter.include.some((slug) => categories.has(slug))) {
    return false;
  }
  if (!filter.require.every((slug) => categories.has(slug))) return false;
  if (filter.exclude.some((slug) => categories.has(slug))) return false;
  return true;
}
