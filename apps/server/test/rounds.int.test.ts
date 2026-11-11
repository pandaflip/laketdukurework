import type { CharacterDto, Page } from '@app/shared';
import { MODE_IDS } from '@app/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import {
  assertRoundEligible,
  checkRoundEligibility,
} from '../src/modules/catalog/selection.service';
import { adminClient, startApp, type Client, type TestContext } from './helpers';

const ADULT_NOTE = 'Adult in the official lore; adult appearance and presentation.';

let context: TestContext;
let admin: Client;

async function setup(name = 'Ashe') {
  const universe = (
    await admin.post('/universes', { name: 'League of Legends', enabledModes: MODE_IDS })
  ).json<{ id: string }>();
  const created = (
    await admin.post('/characters', { universeId: universe.id, names: { en: name } })
  ).json<CharacterDto>();
  const withVariant = (
    await admin.post(`/characters/${created.id}/variants`, { names: { en: 'Classic' } })
  ).json<CharacterDto>();
  const variantId = withVariant.variants[0]?.id ?? '';
  return { universeId: universe.id, characterId: created.id, variantId };
}

const addAsset = (
  variantId: string,
  review: 'UNVERIFIED' | 'APPROVED_NEUTRAL' | 'APPROVED_SENSITIVE' | 'REJECTED',
) => context.db.asset.create({ data: { variantId, review } });

const character = async (id: string): Promise<CharacterDto> =>
  (await admin.get(`/characters/${id}`)).json();

const makeVerifiedAdult = async (id: string) => {
  await admin.put(`/characters/${id}/status`, { status: 'ALLOWED' });
  await admin.put(`/characters/${id}/classification`, {
    ageClass: 'ADULT_VERIFIED',
    note: ADULT_NOTE,
    confirm: true,
  });
};

beforeEach(async () => {
  context = await startApp();
  admin = await adminClient(context);
});

afterEach(async () => {
  await context.close();
});

describe('image summary and usable images', () => {
  it('keeps the review of the images apart from the eligibility of the character', async () => {
    const { characterId, variantId } = await setup();
    expect((await character(characterId)).images).toEqual({
      total: 0,
      approvedNeutral: 0,
      approvedSensitive: 0,
      rejected: 0,
      unverified: 0,
    });

    await addAsset(variantId, 'UNVERIFIED');
    await addAsset(variantId, 'APPROVED_NEUTRAL');
    await addAsset(variantId, 'APPROVED_SENSITIVE');
    await addAsset(variantId, 'REJECTED');

    const ashe = await character(characterId);
    expect(ashe.images).toEqual({
      total: 4,
      approvedNeutral: 1,
      approvedSensitive: 1,
      rejected: 1,
      unverified: 1,
    });
    // The character is eligible to neutral modes: two images are usable there.
    expect(ashe.eligibility['zoom-out'].eligible).toBe(true);
    expect(ashe.usableImages['zoom-out']).toBe(2);
    // Not a verified adult: images approved for sensitive use change nothing.
    expect(ashe.eligibility.historic.eligible).toBe(false);
    expect(ashe.usableImages.historic).toBe(0);
    expect(ashe.usableImages['chaos-mix']).toBe(0);

    await makeVerifiedAdult(characterId);
    const adult = await character(characterId);
    expect(adult.usableImages.historic).toBe(1);
  });
});

describe('round eligibility, checked on the server for the real mode and the image used', () => {
  it('requires an approval that matches the mode', async () => {
    const { variantId, characterId } = await setup();
    const unverified = await addAsset(variantId, 'UNVERIFIED');
    const neutral = await addAsset(variantId, 'APPROVED_NEUTRAL');
    const sensitive = await addAsset(variantId, 'APPROVED_SENSITIVE');
    const rejected = await addAsset(variantId, 'REJECTED');

    expect((await checkRoundEligibility(context.db, 'zoom-out', unverified.id)).reasons).toEqual([
      'ASSET_NOT_APPROVED',
    ]);
    expect((await checkRoundEligibility(context.db, 'zoom-out', rejected.id)).reasons).toEqual([
      'ASSET_REJECTED',
    ]);
    expect((await checkRoundEligibility(context.db, 'zoom-out', neutral.id)).eligible).toBe(true);
    expect((await checkRoundEligibility(context.db, 'pixelated', sensitive.id)).eligible).toBe(
      true,
    );

    // The sensitive mode needs a verified adult AND an image approved for it.
    await makeVerifiedAdult(characterId);
    expect((await checkRoundEligibility(context.db, 'historic', neutral.id)).reasons).toEqual([
      'ASSET_NOT_APPROVED',
    ]);
    expect((await checkRoundEligibility(context.db, 'historic', sensitive.id)).eligible).toBe(true);
  });

  it('refuses the composite mode: every round is checked under its concrete mode', async () => {
    const { variantId } = await setup();
    const asset = await addAsset(variantId, 'APPROVED_SENSITIVE');
    expect(await checkRoundEligibility(context.db, 'chaos-mix', asset.id)).toEqual({
      eligible: false,
      reasons: ['MODE_IS_COMPOSITE'],
    });
    await expect(assertRoundEligible(context.db, 'chaos-mix', asset.id)).rejects.toMatchObject({
      statusCode: 422,
      code: 'INELIGIBLE_CONTENT',
    });
  });

  it('reflects an administrative change on the very next check', async () => {
    const { variantId, characterId, universeId } = await setup();
    const asset = await addAsset(variantId, 'APPROVED_SENSITIVE');
    await makeVerifiedAdult(characterId);
    await expect(assertRoundEligible(context.db, 'historic', asset.id)).resolves.toBeUndefined();

    await admin.put(`/characters/${characterId}/status`, { status: 'RESTRICTED' });
    await expect(assertRoundEligible(context.db, 'historic', asset.id)).rejects.toBeInstanceOf(
      AppError,
    );
    await admin.put(`/characters/${characterId}/status`, { status: 'ALLOWED' });
    await expect(assertRoundEligible(context.db, 'historic', asset.id)).resolves.toBeUndefined();

    await admin.put(`/characters/${characterId}/blocked-modes`, { modeIds: ['historic'] });
    expect((await checkRoundEligibility(context.db, 'historic', asset.id)).reasons).toEqual([
      'MODE_BLOCKED_FOR_CHARACTER',
    ]);
    await admin.put(`/characters/${characterId}/blocked-modes`, { modeIds: [] });

    await admin.put(`/universes/${universeId}`, {
      name: 'League of Legends',
      enabledModes: MODE_IDS.filter((id) => id !== 'historic'),
    });
    expect((await checkRoundEligibility(context.db, 'historic', asset.id)).reasons).toEqual([
      'MODE_DISABLED_FOR_UNIVERSE',
    ]);

    await admin.put(`/characters/${characterId}/status`, { status: 'EXCLUDED' });
    expect((await checkRoundEligibility(context.db, 'zoom-out', asset.id)).reasons).toEqual([
      'CHARACTER_EXCLUDED',
    ]);
  });

  it('cannot be bypassed through a variant or an alias', async () => {
    const { variantId, characterId } = await setup('Ashe');
    const asset = await addAsset(variantId, 'APPROVED_SENSITIVE');
    await makeVerifiedAdult(characterId);
    await expect(assertRoundEligible(context.db, 'historic', asset.id)).resolves.toBeUndefined();

    // A new alias that matches a fundamental exclusion applies to every variant at once.
    await admin.put(`/characters/${characterId}/labels`, {
      names: { en: 'Ashe' },
      aliases: { fr: ['Zoé'] },
    });
    expect((await checkRoundEligibility(context.db, 'historic', asset.id)).reasons).toEqual([
      'CORE_EXCLUSION',
    ]);
  });

  it('answers 404 for an unknown image', async () => {
    await expect(checkRoundEligibility(context.db, 'zoom-out', 'missing')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('many characters', () => {
  it('pages, filters and searches a catalog of several hundred characters', async () => {
    const { universeId } = await setup('Seed');
    const rows = Array.from({ length: 300 }, (_unused, index) => String(index).padStart(3, '0'));
    await context.db.character.createMany({
      data: rows.map((id) => ({ universeId, slug: `char-${id}` })),
    });
    const created = await context.db.character.findMany({
      where: { slug: { startsWith: 'char-' } },
      select: { id: true, slug: true },
    });
    await context.db.characterLabel.createMany({
      data: created.map((entry) => ({
        characterId: entry.id,
        locale: 'en',
        kind: 'NAME' as const,
        value: `Char ${entry.slug.slice(5)}`,
        normalized: `char${entry.slug.slice(5)}`,
      })),
    });

    const started = Date.now();
    const first = (await admin.get('/characters?pageSize=100')).json<Page<CharacterDto>>();
    expect(first).toMatchObject({ total: 301, page: 1, pageSize: 100 });
    expect(first.items).toHaveLength(100);
    const last = (await admin.get('/characters?pageSize=100&page=4')).json<Page<CharacterDto>>();
    expect(last.items).toHaveLength(1);

    const search = (await admin.get('/characters?search=char%2007')).json<Page<CharacterDto>>();
    expect(search.total).toBe(10);
    expect(Date.now() - started).toBeLessThan(10_000);

    const unique = new Set(
      [
        ...first.items,
        ...(await admin.get('/characters?pageSize=100&page=2')).json<Page<CharacterDto>>().items,
      ].map((item) => item.id),
    );
    expect(unique.size).toBe(200);
  });
});
