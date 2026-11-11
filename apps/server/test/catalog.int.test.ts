import type { CharacterDto, Page, UniverseDto } from '@app/shared';
import { MODE_IDS } from '@app/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findEligibleCharacters } from '../src/modules/catalog/characters.service';
import { adminClient, startApp, type Client, type TestContext } from './helpers';

const NEUTRAL = MODE_IDS.filter((id) => id !== 'historic');
/** Neutral modes that hold rounds of their own (Chaos Mix only mixes the others). */
const PLAYABLE_NEUTRAL = NEUTRAL.filter((id) => id !== 'chaos-mix');
const ADULT_NOTE = 'Adult in the official lore; adult appearance and presentation.';

let context: TestContext;
let admin: Client;

async function createUniverse(name: string, enabledModes: readonly string[] = MODE_IDS) {
  const response = await admin.post('/universes', { name, enabledModes });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<UniverseDto>();
}

async function createCharacter(universeId: string, body: Record<string, unknown>) {
  const response = await admin.post('/characters', { universeId, ...body });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<CharacterDto>();
}

async function verifiedAdult(universeId: string, name: string): Promise<CharacterDto> {
  const character = await createCharacter(universeId, { names: { en: name } });
  await admin.put(`/characters/${character.id}/status`, { status: 'ALLOWED' });
  const response = await admin.put(`/characters/${character.id}/classification`, {
    ageClass: 'ADULT_VERIFIED',
    note: ADULT_NOTE,
    confirm: true,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<CharacterDto>();
}

beforeEach(async () => {
  context = await startApp();
  admin = await adminClient(context);
});

afterEach(async () => {
  await context.close();
});

describe('universes', () => {
  it('creates a universe with a derived slug and lists it', async () => {
    const universe = await createUniverse('League of Legends', NEUTRAL);
    expect(universe).toMatchObject({
      slug: 'league-of-legends',
      audience: 'GENERAL',
      sensitiveUnlocked: false,
      characterCount: 0,
    });
    expect(universe.enabledModes).toEqual(NEUTRAL);
    expect((await admin.get('/universes')).json<UniverseDto[]>()).toHaveLength(1);
  });

  it('refuses a duplicate slug', async () => {
    await createUniverse('Valorant');
    const response = await admin.post('/universes', { name: 'VALORANT', enabledModes: [] });
    expect(response.statusCode).toBe(409);
  });

  it.each(['Pokémon', 'Minecraft'])(
    'keeps sensitive modes locked in %s by default',
    async (name) => {
      const refused = await admin.post('/universes', { name, enabledModes: ['historic'] });
      expect(refused.statusCode).toBe(422);
      expect(refused.json()).toEqual({ error: { code: 'SENSITIVE_MODE_FORBIDDEN' } });

      const universe = await createUniverse(name, NEUTRAL);
      expect(universe).toMatchObject({ audience: 'YOUTH', sensitiveUnlocked: false });
      const update = await admin.put(`/universes/${universe.id}`, {
        name,
        enabledModes: [...NEUTRAL, 'historic'],
      });
      expect(update.statusCode).toBe(422);
    },
  );

  it('does not let a rename unlock sensitive modes', async () => {
    const universe = await createUniverse('Pokémon', NEUTRAL);
    const response = await admin.put(`/universes/${universe.id}`, {
      name: 'Pocket Creatures',
      enabledModes: [...NEUTRAL, 'historic'],
    });
    expect(response.statusCode).toBe(422);
  });

  it('rejects unknown mode identifiers', async () => {
    const response = await admin.post('/universes', { name: 'X', enabledModes: ['nsfw'] });
    expect(response.statusCode).toBe(400);
  });
});

describe('characters: creation and editing', () => {
  it('always starts RESTRICTED and UNKNOWN, whatever the request says', async () => {
    const universe = await createUniverse('League of Legends');
    const character = await createCharacter(universe.id, {
      names: { en: 'Ashe' },
      status: 'ALLOWED',
      ageClass: 'ADULT_VERIFIED',
      ageClassNote: ADULT_NOTE,
    });
    expect(character).toMatchObject({
      slug: 'ashe',
      status: 'RESTRICTED',
      ageClass: 'UNKNOWN',
      ageClassNote: null,
      coreExcluded: false,
    });
    expect(character.eligibility.historic.eligible).toBe(false);
    expect(character.eligibility['zoom-out'].eligible).toBe(true);
  });

  it('stores localized names and aliases and finds them accent-insensitively', async () => {
    const universe = await createUniverse('Overwatch');
    await createCharacter(universe.id, {
      names: { en: 'Mercy', fr: 'Ange', 'pt-BR': 'Mercy' },
      aliases: { fr: ['Angéla', 'angela', 'Ange'], en: ['Dr. Ziegler'] },
    });
    await createCharacter(universe.id, { names: { en: 'Tracer' } });

    for (const search of ['ANGELA', 'angé', 'ziegler', 'merc']) {
      const page = (await admin.get(`/characters?search=${encodeURIComponent(search)}`)).json<
        Page<CharacterDto>
      >();
      expect(
        page.items.map((item) => item.slug),
        search,
      ).toEqual(['mercy']);
    }
    const mercy = (await admin.get('/characters?search=mercy')).json<Page<CharacterDto>>().items[0];
    // Duplicates (same spelling ignoring accents/case, or equal to the name) are dropped.
    expect(mercy?.aliases.fr).toEqual(['Angéla']);
    expect(mercy?.names).toEqual({ en: 'Mercy', fr: 'Ange', 'pt-BR': 'Mercy' });

    const none = (await admin.get('/characters?search=%21%21%21')).json<Page<CharacterDto>>();
    expect(none.total).toBe(0);
  });

  it('filters by universe and status, with pagination', async () => {
    const lol = await createUniverse('League of Legends');
    const valorant = await createUniverse('Valorant');
    const ashe = await createCharacter(lol.id, { names: { en: 'Ashe' } });
    await createCharacter(lol.id, { names: { en: 'Irelia' } });
    await createCharacter(valorant.id, { names: { en: 'Jett' } });
    await admin.put(`/characters/${ashe.id}/status`, { status: 'EXCLUDED' });

    const byUniverse = (await admin.get(`/characters?universeId=${lol.id}`)).json<
      Page<CharacterDto>
    >();
    expect(byUniverse.total).toBe(2);
    const excluded = (await admin.get('/characters?status=EXCLUDED')).json<Page<CharacterDto>>();
    expect(excluded.items.map((item) => item.slug)).toEqual(['ashe']);
    const paged = (await admin.get('/characters?pageSize=2&page=2')).json<Page<CharacterDto>>();
    expect(paged).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(paged.items).toHaveLength(1);
  });

  it('refuses duplicates, unknown universes and unusable names', async () => {
    const universe = await createUniverse('Valorant');
    await createCharacter(universe.id, { names: { en: 'Jett' } });
    expect(
      (await admin.post('/characters', { universeId: universe.id, names: { en: 'JETT' } }))
        .statusCode,
    ).toBe(409);
    expect(
      (await admin.post('/characters', { universeId: 'nope', names: { en: 'Sage' } })).statusCode,
    ).toBe(404);
    expect(
      (await admin.post('/characters', { universeId: universe.id, names: { en: '!!!' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await admin.post('/characters', { universeId: universe.id, names: { fr: 'Sauge' } }))
        .statusCode,
    ).toBe(400);
  });

  it('edits names and aliases', async () => {
    const universe = await createUniverse('Pokémon', NEUTRAL);
    const misty = await createCharacter(universe.id, { names: { en: 'Misty' } });
    const response = await admin.put(`/characters/${misty.id}/labels`, {
      names: { en: 'Misty', fr: 'Ondine' },
      aliases: { 'pt-BR': ['Misty de Cerulean'] },
    });
    expect(response.json<CharacterDto>()).toMatchObject({
      slug: 'misty',
      names: { en: 'Misty', fr: 'Ondine' },
      aliases: { en: [], fr: [], 'pt-BR': ['Misty de Cerulean'] },
    });
  });

  it('manages variants', async () => {
    const universe = await createUniverse('League of Legends');
    const irelia = await createCharacter(universe.id, { names: { en: 'Irelia' } });
    const created = (
      await admin.post(`/characters/${irelia.id}/variants`, {
        names: { en: 'Frostblade', fr: 'Lame de glace' },
      })
    ).json<CharacterDto>();
    expect(created.variants).toMatchObject([
      { slug: 'frostblade', names: { fr: 'Lame de glace' } },
    ]);

    const duplicate = await admin.post(`/characters/${irelia.id}/variants`, {
      names: { en: 'frostblade' },
    });
    expect(duplicate.statusCode).toBe(409);

    const variantId = created.variants[0]?.id ?? '';
    const renamed = (
      await admin.put(`/variants/${variantId}`, {
        names: { en: 'Frostblade', 'pt-BR': 'Lâmina Gélida' },
      })
    ).json<CharacterDto>();
    expect(renamed.variants[0]?.names).toEqual({ en: 'Frostblade', 'pt-BR': 'Lâmina Gélida' });

    const removed = (await admin.delete(`/variants/${variantId}`)).json<CharacterDto>();
    expect(removed.variants).toEqual([]);
  });
});

describe('status', () => {
  it('changes one character and reports eligibility reasons', async () => {
    const universe = await createUniverse('League of Legends');
    const ashe = await createCharacter(universe.id, { names: { en: 'Ashe' } });
    expect(ashe.eligibility.historic.reasons).toEqual(['STATUS_RESTRICTED', 'NOT_ADULT_VERIFIED']);

    const allowed = (
      await admin.put(`/characters/${ashe.id}/status`, { status: 'ALLOWED' })
    ).json<CharacterDto>();
    // ALLOWED alone never opens a sensitive mode.
    expect(allowed.eligibility.historic).toEqual({
      eligible: false,
      reasons: ['NOT_ADULT_VERIFIED'],
    });

    const excluded = (
      await admin.put(`/characters/${ashe.id}/status`, { status: 'EXCLUDED' })
    ).json<CharacterDto>();
    for (const modeId of MODE_IDS) expect(excluded.eligibility[modeId].eligible).toBe(false);
    expect(
      (await admin.put(`/characters/${ashe.id}/status`, { status: 'BANNED' })).statusCode,
    ).toBe(400);
  });

  it('applies bulk changes atomically under one batch', async () => {
    const universe = await createUniverse('Valorant');
    const jett = await createCharacter(universe.id, { names: { en: 'Jett' } });
    const sage = await createCharacter(universe.id, { names: { en: 'Sage' } });
    await admin.put(`/characters/${sage.id}/status`, { status: 'EXCLUDED' });

    const result = (
      await admin.post('/characters/bulk-status', {
        ids: [jett.id, sage.id, jett.id],
        status: 'EXCLUDED',
      })
    ).json<{ batchId: string | null; changed: number; unchanged: number }>();
    expect(result).toMatchObject({ changed: 1, unchanged: 1 });
    expect(result.batchId).not.toBeNull();

    const failed = await admin.post('/characters/bulk-status', {
      ids: [jett.id, 'missing'],
      status: 'ALLOWED',
    });
    expect(failed.statusCode).toBe(404);
    const jettAfter = (await admin.get(`/characters/${jett.id}`)).json<CharacterDto>();
    expect(jettAfter.status).toBe('EXCLUDED');
  });

  it('cannot change the classification through the bulk endpoint', async () => {
    const universe = await createUniverse('Valorant');
    const jett = await createCharacter(universe.id, { names: { en: 'Jett' } });
    await admin.post('/characters/bulk-status', {
      ids: [jett.id],
      status: 'ALLOWED',
      ageClass: 'ADULT_VERIFIED',
      confirm: true,
      note: ADULT_NOTE,
    });
    const after = (await admin.get(`/characters/${jett.id}`)).json<CharacterDto>();
    expect(after).toMatchObject({ status: 'ALLOWED', ageClass: 'UNKNOWN' });
    expect(after.eligibility.historic.eligible).toBe(false);
  });
});

describe('classification', () => {
  it('requires an explicit confirmation and a written justification for ADULT_VERIFIED', async () => {
    const universe = await createUniverse('League of Legends');
    const ashe = await createCharacter(universe.id, { names: { en: 'Ashe' } });
    const url = `/characters/${ashe.id}/classification`;

    const unconfirmed = await admin.put(url, { ageClass: 'ADULT_VERIFIED', note: ADULT_NOTE });
    expect(unconfirmed.json()).toEqual({ error: { code: 'CONFIRMATION_REQUIRED' } });
    const unjustified = await admin.put(url, {
      ageClass: 'ADULT_VERIFIED',
      note: 'ok',
      confirm: true,
    });
    expect(unjustified.json()).toEqual({ error: { code: 'JUSTIFICATION_REQUIRED' } });
    expect((await admin.get(`/characters/${ashe.id}`)).json<CharacterDto>().ageClass).toBe(
      'UNKNOWN',
    );

    const done = (
      await admin.put(url, { ageClass: 'ADULT_VERIFIED', note: ADULT_NOTE, confirm: true })
    ).json<CharacterDto>();
    expect(done).toMatchObject({ ageClass: 'ADULT_VERIFIED', ageClassNote: ADULT_NOTE });
    // Still RESTRICTED: the classification alone is not enough either.
    expect(done.eligibility.historic.reasons).toEqual(['STATUS_RESTRICTED']);
    const row = await context.db.character.findUniqueOrThrow({ where: { id: ashe.id } });
    expect(row.ageClassSetById).not.toBeNull();
  });

  it('makes a character eligible only when status, classification and universe all agree', async () => {
    const universe = await createUniverse('League of Legends');
    const ashe = await verifiedAdult(universe.id, 'Ashe');
    expect(ashe.eligibility.historic).toEqual({ eligible: true, reasons: [] });

    for (const ageClass of ['MINOR', 'CHILDLIKE', 'AMBIGUOUS', 'UNKNOWN']) {
      const downgraded = (
        await admin.put(`/characters/${ashe.id}/classification`, { ageClass, note: '' })
      ).json<CharacterDto>();
      expect(downgraded.status).toBe('ALLOWED');
      expect(downgraded.eligibility.historic.eligible, ageClass).toBe(false);
    }
  });

  it.each([
    ['Annie', { names: { en: 'Annie' } }],
    ['Zoe', { names: { en: 'Zoe', fr: 'Zoé' } }],
    [
      'Zoe under another slug',
      { slug: 'aspect-of-twilight', names: { en: 'Aspect of Twilight' }, aliases: { fr: ['Zoé'] } },
    ],
  ])('refuses ADULT_VERIFIED for %s, even through the API directly', async (_label, body) => {
    const universe = await createUniverse('League of Legends');
    const character = await createCharacter(universe.id, body);
    expect(character.coreExcluded).toBe(true);

    await admin.put(`/characters/${character.id}/status`, { status: 'ALLOWED' });
    const response = await admin.put(`/characters/${character.id}/classification`, {
      ageClass: 'ADULT_VERIFIED',
      note: ADULT_NOTE,
      confirm: true,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: { code: 'CLASSIFICATION_FORBIDDEN' } });

    const after = (await admin.get(`/characters/${character.id}`)).json<CharacterDto>();
    expect(after.ageClass).toBe('UNKNOWN');
    expect(after.eligibility.historic.reasons).toContain('CORE_EXCLUSION');
    for (const modeId of PLAYABLE_NEUTRAL) expect(after.eligibility[modeId].eligible).toBe(true);
  });

  it('cannot be bypassed by a variant or by renaming a verified adult', async () => {
    const universe = await createUniverse('League of Legends');
    const annie = await createCharacter(universe.id, { names: { en: 'Annie' } });
    await admin.put(`/characters/${annie.id}/status`, { status: 'ALLOWED' });
    const withVariant = (
      await admin.post(`/characters/${annie.id}/variants`, { names: { en: 'Grown-up Annie' } })
    ).json<CharacterDto>();
    expect(withVariant.eligibility.historic.eligible).toBe(false);

    // An eligible adult that later receives an excluded name loses eligibility at once.
    const adult = await verifiedAdult(universe.id, 'Ashe');
    expect(adult.eligibility.historic.eligible).toBe(true);
    const renamed = (
      await admin.put(`/characters/${adult.id}/labels`, {
        names: { en: 'Ashe' },
        aliases: { en: ['Zoe'] },
      })
    ).json<CharacterDto>();
    expect(renamed.coreExcluded).toBe(true);
    expect(renamed.eligibility.historic.reasons).toEqual(['CORE_EXCLUSION']);
  });

  it('keeps verified adults ineligible in universes without sensitive modes', async () => {
    const pokemon = await createUniverse('Pokémon', NEUTRAL);
    const valorant = await createUniverse('Valorant', NEUTRAL);
    const inPokemon = await verifiedAdult(pokemon.id, 'Professor Oak');
    const inValorant = await verifiedAdult(valorant.id, 'Sage');
    expect(inPokemon.eligibility.historic.reasons).toEqual([
      'MODE_DISABLED_FOR_UNIVERSE',
      'UNIVERSE_SENSITIVE_LOCKED',
    ]);
    expect(inValorant.eligibility.historic.reasons).toEqual(['MODE_DISABLED_FOR_UNIVERSE']);
  });
});

describe('composite mode', () => {
  it('is never reported as eligible for a character: rounds are checked under their real mode', async () => {
    const universe = await createUniverse('League of Legends');
    const ashe = await verifiedAdult(universe.id, 'Ashe');
    expect(ashe.eligibility['chaos-mix']).toEqual({
      eligible: false,
      reasons: ['MODE_IS_COMPOSITE'],
    });
    expect(ashe.usableImages['chaos-mix']).toBe(0);
    expect(
      (await findEligibleCharacters(context.db, 'chaos-mix')).map((item) => item.slug),
    ).toEqual([]);
  });
});

describe('per-mode restrictions and server-side eligibility', () => {
  it('blocks chosen modes for one character', async () => {
    const universe = await createUniverse('League of Legends');
    const ashe = await verifiedAdult(universe.id, 'Ashe');
    const blocked = (
      await admin.put(`/characters/${ashe.id}/blocked-modes`, {
        modeIds: ['historic', 'pixelated'],
      })
    ).json<CharacterDto>();
    expect(blocked.blockedModes).toEqual(['pixelated', 'historic']);
    expect(blocked.eligibility.historic.reasons).toEqual(['MODE_BLOCKED_FOR_CHARACTER']);
    expect(blocked.eligibility.pixelated.eligible).toBe(false);
    expect(blocked.eligibility['zoom-out'].eligible).toBe(true);
  });

  it('selects eligible characters on the server and reflects changes immediately', async () => {
    const lol = await createUniverse('League of Legends');
    const pokemon = await createUniverse('Pokémon', NEUTRAL);
    const ashe = await verifiedAdult(lol.id, 'Ashe');
    await createCharacter(lol.id, { names: { en: 'Annie' } });
    await createCharacter(lol.id, { names: { en: 'Irelia' } });
    await createCharacter(pokemon.id, { names: { en: 'Pikachu' } });

    const slugs = async (modeId: 'historic' | 'zoom-out', universeIds?: string[]) =>
      (await findEligibleCharacters(context.db, modeId, universeIds)).map((item) => item.slug);

    expect(await slugs('historic')).toEqual(['ashe']);
    expect(await slugs('zoom-out')).toEqual(['annie', 'ashe', 'irelia', 'pikachu']);
    expect(await slugs('zoom-out', [pokemon.id])).toEqual(['pikachu']);

    await admin.put(`/characters/${ashe.id}/status`, { status: 'RESTRICTED' });
    expect(await slugs('historic')).toEqual([]);
    await admin.put(`/characters/${ashe.id}/status`, { status: 'EXCLUDED' });
    expect(await slugs('zoom-out', [lol.id])).toEqual(['annie', 'irelia']);

    // Even with a corrupted row forced directly into the database, the policy holds.
    await context.db.character.updateMany({
      where: { slug: 'annie' },
      data: { status: 'ALLOWED', ageClass: 'ADULT_VERIFIED' },
    });
    expect(await slugs('historic')).toEqual([]);
  });
});
