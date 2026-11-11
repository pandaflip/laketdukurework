import { describe, expect, it } from 'vitest';
import { normalizeName, slugify, SLUG_PATTERN } from './normalize';

describe('normalizeName', () => {
  it('ignores accents, case, spaces and punctuation', () => {
    expect(normalizeName('Zoé')).toBe('zoe');
    expect(normalizeName('  ANNIE ')).toBe('annie');
    expect(normalizeName("Kai'Sa")).toBe('kaisa');
    expect(normalizeName('Miss Fortune')).toBe('missfortune');
    expect(normalizeName('Z-o.é')).toBe('zoe');
  });

  it('keeps non-latin letters and digits', () => {
    expect(normalizeName('カスミ')).toBe('カスミ');
    expect(normalizeName('2B')).toBe('2b');
  });
});

describe('slugify', () => {
  it('produces kebab-case identifiers', () => {
    expect(slugify('Miss Fortune')).toBe('miss-fortune');
    expect(slugify("  Kai'Sa!! ")).toBe('kai-sa');
    expect(slugify('Zoé')).toBe('zoe');
    expect(slugify('League of Legends')).toMatch(SLUG_PATTERN);
  });

  it('returns an empty string when nothing usable remains', () => {
    expect(slugify('ピカチュウ')).toBe('');
  });
});
