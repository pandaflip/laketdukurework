import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_LIMITS,
  DEFAULT_ROOM_CONFIG,
  applyPreset,
  clientMessageSchema,
  cleanNickname,
  estimateRoundSec,
  finalHoldSec,
  matchesFilter,
  parseRoomConfig,
  rankPoints,
  rankStandings,
  selectStepIndices,
  winnersOf,
  EMPTY_FILTER,
  type Totals,
} from '../index';

describe('selectStepIndices', () => {
  it('keeps the first and the last step and spreads the others', () => {
    expect(selectStepIndices(15, 5)).toEqual([0, 4, 7, 11, 14]);
    expect(selectStepIndices(10, 3)).toEqual([0, 5, 9]);
  });

  it('plays every step when the image has as many or fewer than requested', () => {
    expect(selectStepIndices(7, 10)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(selectStepIndices(5, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('handles degenerate inputs without inventing steps', () => {
    expect(selectStepIndices(0, 5)).toEqual([]);
    expect(selectStepIndices(1, 5)).toEqual([0]);
    expect(selectStepIndices(5, 1)).toEqual([0]);
    expect(selectStepIndices(Number.NaN, 5)).toEqual([]);
  });

  it('always returns distinct, increasing, in-range indices with both ends kept', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 2, max: 40 }), (m, n) => {
        const indices = selectStepIndices(m, n);
        expect(indices).toHaveLength(Math.min(m, n));
        expect(indices[0]).toBe(0);
        expect(indices.at(-1)).toBe(m - 1 > 0 ? m - 1 : 0);
        for (let i = 1; i < indices.length; i++) {
          expect(indices[i]).toBeGreaterThan(indices[i - 1] as number);
        }
      }),
    );
  });

  it('is deterministic', () => {
    expect(selectStepIndices(37, 11)).toEqual(selectStepIndices(37, 11));
  });
});

describe('rankPoints', () => {
  it('gives 1000, 800, 640, 512, 410, 328, 262 and 210 to the first eight', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(rankPoints)).toEqual([
      1000, 800, 640, 512, 410, 328, 262, 210,
    ]);
  });

  it('never drops below the floor and is non-increasing', () => {
    for (let rank = 1; rank < 60; rank++) {
      expect(rankPoints(rank)).toBeGreaterThanOrEqual(100);
      expect(rankPoints(rank + 1)).toBeLessThanOrEqual(rankPoints(rank));
    }
  });

  it('refuses invalid ranks', () => {
    expect([0, -1, 1.5, Number.NaN].map(rankPoints)).toEqual([0, 0, 0, 0]);
  });
});

const totals = (
  playerId: string,
  score: number,
  firsts: number,
  found: number,
  joinOrder: number,
): Totals => ({ playerId, score, firsts, found, joinOrder });

describe('rankStandings', () => {
  it('orders by score, then firsts, then found', () => {
    const placed = rankStandings([
      totals('a', 1000, 0, 3, 0),
      totals('b', 1000, 1, 1, 1),
      totals('c', 2000, 0, 0, 2),
      totals('d', 1000, 1, 2, 3),
    ]);
    expect(placed.map((entry) => [entry.playerId, entry.place])).toEqual([
      ['c', 1],
      ['d', 2],
      ['b', 3],
      ['a', 4],
    ]);
  });

  it('gives a shared place, listed by arrival, to players equal on every criterion', () => {
    const placed = rankStandings([totals('b', 500, 1, 1, 1), totals('a', 500, 1, 1, 0)]);
    expect(placed.map((entry) => [entry.playerId, entry.place])).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
    expect(winnersOf([totals('b', 500, 1, 1, 1), totals('a', 500, 1, 1, 0)])).toEqual(['a', 'b']);
  });

  it('does not depend on the order of the input', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 5 }),
            fc.integer({ min: 0, max: 3 }),
            fc.integer({ min: 0, max: 3 }),
          ),
          { minLength: 1, maxLength: 8 },
        ),
        (rows) => {
          const list = rows.map(([score, firsts, found], index) =>
            totals(`p${index}`, score * 100, firsts, found, index),
          );
          const forward = rankStandings(list).map((entry) => `${entry.playerId}:${entry.place}`);
          const backward = rankStandings([...list].reverse()).map(
            (entry) => `${entry.playerId}:${entry.place}`,
          );
          expect(backward).toEqual(forward);
        },
      ),
    );
  });
});

describe('matchesFilter', () => {
  const subject = { universeSlug: 'lol', categorySlugs: ['mage', 'ionia'] };

  it('accepts everything with an empty filter', () => {
    expect(matchesFilter(EMPTY_FILTER, subject)).toBe(true);
  });

  it('OR keeps a character with at least one of the categories', () => {
    expect(matchesFilter({ ...EMPTY_FILTER, include: ['mage', 'tank'] }, subject)).toBe(true);
    expect(matchesFilter({ ...EMPTY_FILTER, include: ['tank', 'support'] }, subject)).toBe(false);
  });

  it('AND keeps a character with all of the categories', () => {
    expect(matchesFilter({ ...EMPTY_FILTER, require: ['mage', 'ionia'] }, subject)).toBe(true);
    expect(matchesFilter({ ...EMPTY_FILTER, require: ['mage', 'noxus'] }, subject)).toBe(false);
  });

  it('EXCEPT drops a character with any of the categories', () => {
    expect(matchesFilter({ ...EMPTY_FILTER, exclude: ['noxus'] }, subject)).toBe(true);
    expect(matchesFilter({ ...EMPTY_FILTER, exclude: ['noxus', 'ionia'] }, subject)).toBe(false);
  });

  it('filters universes by inclusion and exclusion', () => {
    expect(matchesFilter({ ...EMPTY_FILTER, universes: ['lol'] }, subject)).toBe(true);
    expect(matchesFilter({ ...EMPTY_FILTER, universes: ['pokemon'] }, subject)).toBe(false);
    expect(matchesFilter({ ...EMPTY_FILTER, excludeUniverses: ['lol'] }, subject)).toBe(false);
  });

  it('combines the rules', () => {
    const filter = { ...EMPTY_FILTER, include: ['mage'], require: ['ionia'], exclude: ['noxus'] };
    expect(matchesFilter(filter, subject)).toBe(true);
    expect(matchesFilter(filter, { ...subject, categorySlugs: ['mage', 'ionia', 'noxus'] })).toBe(
      false,
    );
  });
});

describe('room configuration', () => {
  it('has the validated defaults', () => {
    expect(DEFAULT_ROOM_CONFIG).toMatchObject({
      modeId: 'zoom-out',
      targetScore: 5000,
      steps: 10,
      stepDelaySec: 6,
      attempts: { kind: 'unlimited', cooldownSec: 2 },
      vote: { enabled: true, threshold: 'half' },
      typoTolerance: true,
      aliases: true,
      showWrongAnswers: false,
    });
  });

  it('accepts the bounds and refuses what is outside them', () => {
    const { steps, stepDelaySec } = CONFIG_LIMITS;
    expect(parseRoomConfig({ steps: steps.min, stepDelaySec: stepDelaySec.max }).ok).toBe(true);
    for (const bad of [
      { steps: steps.min - 1 },
      { steps: steps.max + 1 },
      { steps: 10.5 },
      { stepDelaySec: 1 },
      { stepDelaySec: 16 },
      { targetScore: 999 },
      { attempts: { kind: 'limited', max: 16 } },
      { attempts: { kind: 'limited', max: 0 } },
      { attempts: { kind: 'unlimited', cooldownSec: 11 } },
      { attempts: { kind: 'forever' } },
      { vote: { threshold: 'all' } },
      { modeId: 'pixelated' },
      { profile: 'solo-classic' },
      { unknownOption: true },
      { filter: { include: ['Not A Slug'] } },
    ]) {
      expect(parseRoomConfig(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('fills the options of the chosen attempts mode', () => {
    const result = parseRoomConfig({ attempts: { kind: 'limited' } });
    expect(result.ok && result.config.attempts).toEqual({ kind: 'limited', max: 5 });
  });

  it('applies presets to the pace only', () => {
    const custom = { ...DEFAULT_ROOM_CONFIG, showWrongAnswers: true };
    expect(applyPreset(custom, 'fast')).toMatchObject({
      steps: 8,
      stepDelaySec: 4,
      showWrongAnswers: true,
    });
    expect(applyPreset(custom, 'relaxed')).toMatchObject({ steps: 15, stepDelaySec: 8 });
  });

  it('estimates a round as (steps - 1) delays plus the final hold', () => {
    expect(finalHoldSec(2)).toBe(8);
    expect(finalHoldSec(12)).toBe(12);
    expect(estimateRoundSec(10, 6)).toBe(9 * 6 + 8);
    expect(estimateRoundSec(1, 2)).toBe(8);
  });
});

describe('messages', () => {
  it('accepts well-formed answers and votes only', () => {
    expect(
      clientMessageSchema.safeParse({ type: 'answer', stepIndex: 0, text: 'Ahri' }).success,
    ).toBe(true);
    expect(clientMessageSchema.safeParse({ type: 'vote', stepIndex: 3 }).success).toBe(true);
    for (const bad of [
      { type: 'answer', stepIndex: -1, text: 'x' },
      { type: 'answer', stepIndex: 0, text: 'x'.repeat(500) },
      { type: 'answer', stepIndex: 0, text: 'x', score: 1000 },
      { type: 'vote', stepIndex: 0, playerId: 'someone' },
      { type: 'setScore', value: 9999 },
      { type: 'answer', text: 'no step' },
    ]) {
      expect(clientMessageSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('cleans nicknames and refuses control and invisible characters', () => {
    expect(cleanNickname('  Lucas   B  ')).toBe('Lucas B');
    expect(cleanNickname('A')).toBeNull();
    expect(cleanNickname('x'.repeat(17))).toBeNull();
    expect(cleanNickname('Bad\u0000name')).toBeNull();
    expect(cleanNickname('zero​width')).toBeNull();
    expect(cleanNickname('Ana🙂')).toBe('Ana🙂');
  });
});
