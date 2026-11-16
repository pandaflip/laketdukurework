import fc from 'fast-check';
import { normalizeName } from '@app/shared';
import { describe, expect, it } from 'vitest';
import {
  AnswerIndex,
  allowedErrors,
  buildSuggestions,
  distance,
  type CatalogLabel,
} from './answers';

const label = (
  characterId: string,
  kind: 'NAME' | 'ALIAS',
  value: string,
  locale = 'en',
): CatalogLabel => ({ characterId, locale, kind, value, normalized: normalizeName(value) });

const ON = { typoTolerance: true, aliases: true };
const EXACT_ONLY = { typoTolerance: false, aliases: false };

const index = new AnswerIndex([
  label('leblanc', 'NAME', 'LeBlanc'),
  label('leblanc', 'ALIAS', 'LB'),
  label('leblanc', 'ALIAS', 'La Trompeuse', 'fr'),
  label('mf', 'NAME', 'Miss Fortune'),
  label('mf', 'NAME', 'Miss Fortune', 'pt-BR'),
  label('mf', 'ALIAS', 'MF'),
  label('kaisa', 'NAME', "Kai'Sa"),
  label('zed', 'NAME', 'Zed'),
  label('zac', 'NAME', 'Zac'),
  label('karma', 'NAME', 'Karma'),
  label('ahri', 'NAME', 'Ahri'),
  label('maokai', 'NAME', 'Maokai'),
  label('maokal', 'NAME', 'Maokal'),
  label('nidalee', 'NAME', 'Nidalee'),
  label('lissandra', 'NAME', 'Lissandra'),
  label('sol', 'NAME', 'Aurelion Sol'),
  label('tahm', 'NAME', 'Tahm Kench'),
  label('tahm', 'NAME', 'Tahm Kench', 'fr'),
  // Two characters sharing an alias, and two sharing an official name.
  label('wukong', 'NAME', 'Wukong'),
  label('wukong', 'ALIAS', 'Monkey'),
  label('rengar', 'NAME', 'Rengar'),
  label('rengar', 'ALIAS', 'Monkey'),
  label('twin-a', 'NAME', 'Echo'),
  label('twin-b', 'NAME', 'Echo'),
  label('twin-a', 'NAME', 'Echo Alpha', 'fr'),
]);

describe('exact answers', () => {
  it('ignores case, accents, spaces and punctuation', () => {
    for (const text of ['leblanc', 'LEBLANC', ' LeBlanc ', 'Le-Blanc']) {
      expect(index.matches('leblanc', text, EXACT_ONLY), text).toBe(true);
    }
    expect(index.matches('mf', 'miss fortune', EXACT_ONLY)).toBe(true);
    expect(index.matches('mf', 'MISSFORTUNE', EXACT_ONLY)).toBe(true);
    expect(index.matches('kaisa', "Kai'Sa", EXACT_ONLY)).toBe(true);
    expect(index.matches('kaisa', 'kaisa', EXACT_ONLY)).toBe(true);
  });

  it('accepts the official name of any language', () => {
    expect(index.matches('leblanc', 'LeBlanc', EXACT_ONLY)).toBe(true);
    expect(index.matches('tahm', 'tahmkench', EXACT_ONLY)).toBe(true);
  });

  it('refuses another character, empty text and punctuation only', () => {
    expect(index.matches('leblanc', 'Zed', ON)).toBe(false);
    expect(index.matches('leblanc', '', ON)).toBe(false);
    expect(index.matches('leblanc', ' -- ', ON)).toBe(false);
  });
});

describe('typing mistakes', () => {
  it('accepts a swapped pair of letters when tolerance is on, not otherwise', () => {
    expect(index.matches('leblanc', 'Leblacn', ON)).toBe(true);
    expect(index.matches('leblanc', 'Leblacn', { ...ON, typoTolerance: false })).toBe(false);
  });

  it('accepts one mistake from five letters, two from ten', () => {
    expect(index.matches('karma', 'Karna', ON)).toBe(true);
    expect(index.matches('karma', 'Karnz', ON)).toBe(false);
    expect(index.matches('lissandra', 'Lisandra', ON)).toBe(true);
    expect(index.matches('lissandra', 'Lisandrra', ON)).toBe(false); // 9 letters: one mistake only
    expect(index.matches('tahm', 'Tahm Kensh', ON)).toBe(true);
    expect(index.matches('tahm', 'Tam Kensh', ON)).toBe(false);
    expect(index.matches('sol', 'Aurelion Sl', ON)).toBe(true);
    expect(index.matches('sol', 'Aurelon Sl', ON)).toBe(true); // 11 letters: two mistakes
    expect(index.matches('sol', 'Aurelon S', ON)).toBe(false);
  });

  it('never loosens short names', () => {
    expect(allowedErrors(3)).toBe(0);
    expect(allowedErrors(4)).toBe(0);
    expect(allowedErrors(5)).toBe(1);
    expect(allowedErrors(9)).toBe(1);
    expect(allowedErrors(10)).toBe(2);
    for (const text of ['Zad', 'Ze', 'Zedd', 'Aha', 'Ahrii', 'Ari']) {
      expect(index.matches('zed', text, ON) || index.matches('ahri', text, ON), text).toBe(false);
    }
  });

  it('refuses a mistake that is as close to another character', () => {
    // One substitution away from both "Maokai" and "Maokal".
    expect(index.matches('maokai', 'Maokay', ON)).toBe(false);
    expect(index.matches('maokal', 'Maokay', ON)).toBe(false);
    // Exactly the other one is the other one.
    expect(index.matches('maokai', 'Maokal', ON)).toBe(false);
    expect(index.matches('maokal', 'Maokal', ON)).toBe(true);
  });

  it('applies to official names only, never to aliases', () => {
    expect(index.matches('leblanc', 'LBB', ON)).toBe(false);
    expect(index.matches('mf', 'MFF', ON)).toBe(false);
    expect(index.matches('leblanc', 'La Trompeus', ON)).toBe(false);
  });
});

describe('aliases', () => {
  it('are accepted only when the option is on, with an exact match', () => {
    expect(index.matches('leblanc', 'LB', ON)).toBe(true);
    expect(index.matches('leblanc', 'lb', ON)).toBe(true);
    expect(index.matches('leblanc', 'LB', { ...ON, aliases: false })).toBe(false);
    expect(index.matches('leblanc', 'La Trompeuse', ON)).toBe(true);
    expect(index.matches('mf', 'MF', ON)).toBe(true);
    expect(index.matches('mf', 'MF', { ...ON, aliases: false })).toBe(false);
  });

  it('do not turn the official name off', () => {
    expect(index.matches('leblanc', 'LeBlanc', { typoTolerance: false, aliases: false })).toBe(
      true,
    );
  });
});

describe('ambiguity', () => {
  it('refuses an alias shared by two characters, for both', () => {
    expect(index.matches('wukong', 'Monkey', ON)).toBe(false);
    expect(index.matches('rengar', 'Monkey', ON)).toBe(false);
  });

  it('refuses an official name shared by two characters', () => {
    expect(index.matches('twin-a', 'Echo', ON)).toBe(false);
    expect(index.matches('twin-b', 'Echo', ON)).toBe(false);
  });

  it('knows which characters can be answered at all', () => {
    expect(index.isAnswerable('leblanc')).toBe(true);
    expect(index.isAnswerable('twin-b')).toBe(false); // its only name is shared
    expect(index.isAnswerable('twin-a')).toBe(true); // another name is its own
    expect(index.isAnswerable('nobody')).toBe(false);
  });
});

describe('related answers', () => {
  it('flags names, aliases and typos whatever the options', () => {
    expect(index.isRelated('leblanc', 'LB')).toBe(true);
    expect(index.isRelated('leblanc', 'Leblacn')).toBe(true);
    expect(index.isRelated('leblanc', 'leblanc')).toBe(true);
    expect(index.isRelated('leblanc', 'La Trompeuse')).toBe(true);
    expect(index.isRelated('leblanc', 'Zed')).toBe(false);
    expect(index.isRelated('leblanc', 'Mage')).toBe(false);
    expect(index.isRelated('leblanc', '')).toBe(false);
  });

  it('flags an ambiguous alias that includes the character', () => {
    expect(index.isRelated('wukong', 'Monkey')).toBe(true);
  });
});

describe('distance', () => {
  it('counts swaps, insertions, deletions and substitutions', () => {
    expect(distance('leblanc', 'leblacn', 3)).toBe(1);
    expect(distance('karma', 'karm', 3)).toBe(1);
    expect(distance('karma', 'karmas', 3)).toBe(1);
    expect(distance('karma', 'karna', 3)).toBe(1);
    expect(distance('abc', 'abc', 3)).toBe(0);
  });

  it('stops counting beyond the limit', () => {
    expect(distance('aaaaaaaa', 'bbbbbbbb', 2)).toBe(3);
    expect(distance('a', 'abcdefgh', 2)).toBe(3);
  });

  it('is symmetric and consistent with its limit', () => {
    const word = fc.stringMatching(/^[a-z]{0,8}$/);
    fc.assert(
      fc.property(word, word, (a, b) => {
        const full = distance(a, b, 20);
        expect(distance(b, a, 20)).toBe(full);
        expect(distance(a, b, 2)).toBe(Math.min(full, 3));
        expect(distance(a, a, 2)).toBe(0);
      }),
    );
  });
});

describe('autocompletion', () => {
  it('lists one name per character per language, sorted, falling back to English', () => {
    const suggestions = buildSuggestions([
      { names: { en: 'Zed' } },
      { names: { en: 'Ahri', fr: 'Ahri' } },
      { names: { en: 'The Mage', fr: 'Le Mage', 'pt-BR': 'O Mago' } },
      { names: { en: 'Ahri' } },
    ]);
    expect(suggestions.en).toEqual(['Ahri', 'The Mage', 'Zed']);
    expect(suggestions.fr).toEqual(['Ahri', 'Le Mage', 'Zed']);
    expect(suggestions['pt-BR']).toEqual(['Ahri', 'O Mago', 'Zed']);
  });
});
