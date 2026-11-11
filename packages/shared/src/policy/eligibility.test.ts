import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AGE_CLASSES, ASSET_REVIEWS, CHARACTER_STATUSES } from '../catalog/enums';
import { isCompositeMode, MODE_IDS, MODES, type ModeId } from '../registry/modes';
import { adultNoteMinLength } from './classification';
import { isCoreExcludedCharacter, universeAudience } from './core-exclusions';
import {
  canBeClassifiedAdult,
  challengeEligibility,
  characterEligibility,
  characterEligibilityByMode,
  type EligibilityCharacter,
  type EligibilityUniverse,
} from './eligibility';

const SENSITIVE_MODES = MODE_IDS.filter((id) => MODES[id].sensitivity !== 'neutral');
const NEUTRAL_MODES = MODE_IDS.filter(
  (id) => MODES[id].sensitivity === 'neutral' && !isCompositeMode(id),
);

const lol: EligibilityUniverse = {
  slug: 'league-of-legends',
  name: 'League of Legends',
  enabledModes: [...MODE_IDS],
};

const adult: EligibilityCharacter = {
  slug: 'ashe',
  labels: ['Ashe'],
  status: 'ALLOWED',
  ageClass: 'ADULT_VERIFIED',
  blockedModes: [],
};

describe('sensitive modes: the fully compliant case', () => {
  it('is eligible only when every condition holds', () => {
    expect(SENSITIVE_MODES).toEqual(['historic']);
    expect(characterEligibility('historic', lol, adult)).toEqual({ eligible: true, reasons: [] });
    expect(
      challengeEligibility('historic', lol, adult, { review: 'APPROVED_SENSITIVE' }).eligible,
    ).toBe(true);
  });
});

describe('sensitive modes: each missing condition is disqualifying on its own', () => {
  it.each(['UNKNOWN', 'MINOR', 'CHILDLIKE', 'AMBIGUOUS'] as const)(
    'refuses age class %s even when the status is ALLOWED',
    (ageClass) => {
      const outcome = characterEligibility('historic', lol, { ...adult, ageClass });
      expect(outcome.eligible).toBe(false);
      expect(outcome.reasons).toContain('NOT_ADULT_VERIFIED');
    },
  );

  it('refuses a RESTRICTED or EXCLUDED verified adult', () => {
    expect(
      characterEligibility('historic', lol, { ...adult, status: 'RESTRICTED' }).reasons,
    ).toEqual(['STATUS_RESTRICTED']);
    expect(characterEligibility('historic', lol, { ...adult, status: 'EXCLUDED' }).reasons).toEqual(
      ['CHARACTER_EXCLUDED'],
    );
  });

  it('refuses when the universe has not enabled the mode', () => {
    const universe = { ...lol, enabledModes: NEUTRAL_MODES };
    expect(characterEligibility('historic', universe, adult).reasons).toEqual([
      'MODE_DISABLED_FOR_UNIVERSE',
    ]);
  });

  it('refuses when the mode is blocked for the character', () => {
    expect(
      characterEligibility('historic', lol, { ...adult, blockedModes: ['historic'] }).reasons,
    ).toEqual(['MODE_BLOCKED_FOR_CHARACTER']);
  });

  it.each(['UNVERIFIED', 'APPROVED_NEUTRAL', 'REJECTED'] as const)(
    'refuses an asset with review %s',
    (review) => {
      expect(challengeEligibility('historic', lol, adult, { review }).eligible).toBe(false);
    },
  );

  it('treats an unknown runtime status or class as ineligible', () => {
    const corrupted = { ...adult, status: 'WHATEVER', ageClass: 'ADULT' } as unknown;
    const outcome = characterEligibility('historic', lol, corrupted as EligibilityCharacter);
    expect(outcome.eligible).toBe(false);
    expect(characterEligibility('zoom-out', lol, corrupted as EligibilityCharacter).eligible).toBe(
      false,
    );
  });
});

describe('fundamental exclusions', () => {
  const variants: [string, EligibilityCharacter][] = [
    ['slug', { ...adult, slug: 'annie', labels: ['Someone'] }],
    ['name', { ...adult, slug: 'x', labels: ['Annie'] }],
    ['accented name', { ...adult, slug: 'x', labels: ['Zoé'] }],
    ['upper-case alias', { ...adult, slug: 'x', labels: ['Other', 'ZOE'] }],
    ['punctuated alias', { ...adult, slug: 'x', labels: ['A.n.n.i.e'] }],
    ['localized alias', { ...adult, slug: 'aspect-of-twilight', labels: ['Aspect', 'zoe'] }],
  ];

  it.each(variants)('excludes Annie and Zoe matched by %s', (_label, character) => {
    expect(isCoreExcludedCharacter(lol, character)).toBe(true);
    expect(characterEligibility('historic', lol, character).reasons).toContain('CORE_EXCLUSION');
    expect(canBeClassifiedAdult(lol, character)).toBe(false);
  });

  it('recognizes the universe by slug variants and by name', () => {
    const annie = { ...adult, slug: 'annie' };
    expect(isCoreExcludedCharacter({ slug: 'lol' }, annie)).toBe(true);
    expect(isCoreExcludedCharacter({ slug: 'riot-moba', name: 'League of Legends' }, annie)).toBe(
      true,
    );
    expect(isCoreExcludedCharacter({ slug: 'valorant', name: 'Valorant' }, annie)).toBe(false);
  });

  it('keeps Annie and Zoe available in neutral modes', () => {
    const zoe: EligibilityCharacter = {
      slug: 'zoe',
      labels: ['Zoe', 'Zoé'],
      status: 'RESTRICTED',
      ageClass: 'MINOR',
      blockedModes: [],
    };
    for (const modeId of NEUTRAL_MODES) {
      expect(characterEligibility(modeId, lol, zoe).eligible).toBe(true);
    }
  });
});

describe('universes with a young audience', () => {
  const youth = (slug: string, sensitiveUnlocked?: boolean): EligibilityUniverse => ({
    slug,
    enabledModes: [...MODE_IDS],
    ...(sensitiveUnlocked === undefined ? {} : { sensitiveUnlocked }),
  });

  it.each(['pokemon', 'minecraft'])('%s is recognized, by slug and by name', (slug) => {
    expect(universeAudience({ slug })).toBe('YOUTH');
    expect(universeAudience({ slug: 'pkmn', name: 'Pokémon' })).toBe('YOUTH');
    expect(universeAudience({ slug: 'x', name: 'MINECRAFT' })).toBe('YOUTH');
    expect(universeAudience({ slug: 'valorant', name: 'Valorant' })).toBe('GENERAL');
  });

  it.each([undefined, false])('keeps sensitive modes locked by default (unlocked: %s)', (flag) => {
    const outcome = characterEligibility('historic', youth('pokemon', flag), adult);
    expect(outcome).toEqual({ eligible: false, reasons: ['UNIVERSE_SENSITIVE_LOCKED'] });
  });

  it('is not enough, once unlocked, to make anybody eligible', () => {
    const universe = youth('pokemon', true);
    expect(characterEligibility('historic', universe, adult).eligible).toBe(true);
    for (const ageClass of ['UNKNOWN', 'MINOR', 'CHILDLIKE', 'AMBIGUOUS'] as const) {
      expect(characterEligibility('historic', universe, { ...adult, ageClass }).reasons).toEqual([
        'NOT_ADULT_VERIFIED',
      ]);
    }
    expect(
      challengeEligibility('historic', universe, adult, { review: 'APPROVED_NEUTRAL' }).reasons,
    ).toEqual(['ASSET_NOT_APPROVED']);
  });

  it('does not make fundamental exclusions depend on the audience tier', () => {
    const annie = { ...adult, slug: 'annie', labels: ['Annie'] };
    expect(
      characterEligibility('historic', { ...lol, sensitiveUnlocked: true }, annie).reasons,
    ).toEqual(['CORE_EXCLUSION']);
  });

  it('asks for a longer justification', () => {
    expect(adultNoteMinLength('GENERAL')).toBe(20);
    expect(adultNoteMinLength('YOUTH')).toBe(60);
  });

  it('never affects neutral modes', () => {
    expect(characterEligibility('zoom-out', youth('minecraft'), adult).eligible).toBe(true);
  });
});

describe('composite mode (Chaos Mix)', () => {
  it('is never a valid round mode: rounds are checked under their concrete mode', () => {
    expect(isCompositeMode('chaos-mix')).toBe(true);
    expect(characterEligibility('chaos-mix', lol, adult)).toEqual({
      eligible: false,
      reasons: ['MODE_IS_COMPOSITE'],
    });
    expect(
      challengeEligibility('chaos-mix', lol, adult, { review: 'APPROVED_SENSITIVE' }).reasons,
    ).toEqual(['MODE_IS_COMPOSITE']);
    expect(isCompositeMode('historic')).toBe(false);
  });
});

describe('neutral modes', () => {
  it('accept RESTRICTED characters of any age class with an approved asset', () => {
    const child = { ...adult, status: 'RESTRICTED', ageClass: 'MINOR' } as const;
    expect(characterEligibility('zoom-out', lol, child).eligible).toBe(true);
    expect(
      challengeEligibility('zoom-out', lol, child, { review: 'APPROVED_NEUTRAL' }).eligible,
    ).toBe(true);
  });

  it('refuse EXCLUDED characters and unverified or rejected assets', () => {
    expect(characterEligibility('zoom-out', lol, { ...adult, status: 'EXCLUDED' }).eligible).toBe(
      false,
    );
    expect(challengeEligibility('zoom-out', lol, adult, { review: 'UNVERIFIED' }).reasons).toEqual([
      'ASSET_NOT_APPROVED',
    ]);
    expect(challengeEligibility('zoom-out', lol, adult, { review: 'REJECTED' }).reasons).toEqual([
      'ASSET_REJECTED',
    ]);
  });
});

describe('properties over every combination', () => {
  const universeArb = fc.record({
    slug: fc.constantFrom('league-of-legends', 'lol', 'valorant', 'pokemon', 'minecraft', 'other'),
    enabledModes: fc.subarray([...MODE_IDS]),
    sensitiveUnlocked: fc.boolean(),
  });
  const characterArb = fc.record({
    slug: fc.constantFrom('annie', 'zoe', 'ashe', 'jett', 'steve'),
    labels: fc.subarray(['Annie', 'Zoé', 'ZOE', 'Ashe', 'Jett', 'Steve', 'Pikachu']),
    status: fc.constantFrom(...CHARACTER_STATUSES),
    ageClass: fc.constantFrom(...AGE_CLASSES),
    blockedModes: fc.subarray([...MODE_IDS]),
  });
  const assetArb = fc.record({ review: fc.constantFrom(...ASSET_REVIEWS) });
  const sensitiveModeArb = fc.constantFrom<ModeId>(...SENSITIVE_MODES);
  const anyModeArb = fc.constantFrom<ModeId>(...MODE_IDS);

  it('a sensitive challenge is eligible only if every safety condition holds', () => {
    fc.assert(
      fc.property(
        sensitiveModeArb,
        universeArb,
        characterArb,
        assetArb,
        (modeId, universe, character, asset) => {
          if (!challengeEligibility(modeId, universe, character, asset).eligible) return;
          expect(character.ageClass).toBe('ADULT_VERIFIED');
          expect(character.status).toBe('ALLOWED');
          expect(asset.review).toBe('APPROVED_SENSITIVE');
          expect(universe.enabledModes).toContain(modeId);
          expect(character.blockedModes).not.toContain(modeId);
          expect(universeAudience(universe) === 'GENERAL' || universe.sensitiveUnlocked).toBe(true);
          expect(isCoreExcludedCharacter(universe, character)).toBe(false);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('a composite mode is never eligible, whatever the inputs', () => {
    fc.assert(
      fc.property(universeArb, characterArb, assetArb, (universe, character, asset) => {
        expect(characterEligibility('chaos-mix', universe, character).eligible).toBe(false);
        expect(challengeEligibility('chaos-mix', universe, character, asset).eligible).toBe(false);
      }),
    );
  });

  it('an EXCLUDED character is never eligible to anything', () => {
    fc.assert(
      fc.property(anyModeArb, universeArb, characterArb, assetArb, (modeId, universe, c, asset) => {
        const character = { ...c, status: 'EXCLUDED' as const };
        expect(characterEligibility(modeId, universe, character).eligible).toBe(false);
        expect(challengeEligibility(modeId, universe, character, asset).eligible).toBe(false);
      }),
    );
  });

  it('a challenge is never more permissive than its character', () => {
    fc.assert(
      fc.property(anyModeArb, universeArb, characterArb, assetArb, (modeId, universe, c, asset) => {
        if (challengeEligibility(modeId, universe, c, asset).eligible) {
          expect(characterEligibility(modeId, universe, c).eligible).toBe(true);
        }
      }),
    );
  });

  it('reports a reason whenever something is ineligible', () => {
    fc.assert(
      fc.property(universeArb, characterArb, (universe, character) => {
        for (const outcome of Object.values(characterEligibilityByMode(universe, character))) {
          expect(outcome.eligible).toBe(outcome.reasons.length === 0);
        }
      }),
    );
  });
});
