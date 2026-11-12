import type { CharacterDto, UniverseDto } from '@app/shared';
import { MODE_IDS } from '@app/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findEligibleCharacters } from '../src/modules/catalog/characters.service';
import {
  adminClient,
  createReviewedUniverse,
  startApp,
  type Client,
  type TestContext,
} from './helpers';

const NEUTRAL = MODE_IDS.filter((id) => id !== 'historic');
const SHORT_NOTE = 'Adult in the official lore; adult appearance.'; // under 60 characters
const STRICT_NOTE =
  'Adult according to the official material (stated age, profession), adult proportions and ' +
  'presentation, no childlike trait. Reviewed individually.';
const UNLOCK_NOTE =
  'Explicit product decision: sensitive modes may be offered for individually verified adults ' +
  'of this universe only, with every image reviewed one by one.';

let context: TestContext;
let admin: Client;

async function createUniverse(name: string, enabledModes: readonly string[] = NEUTRAL) {
  const audience = /pok[eé]mon|minecraft/i.test(name) ? 'YOUTH' : 'GENERAL';
  return createReviewedUniverse(admin, name, enabledModes, audience);
}

async function createCharacter(universeId: string, name: string): Promise<CharacterDto> {
  const response = await admin.post('/characters', { universeId, names: { en: name } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<CharacterDto>();
}

const unlock = (universeId: string, body: Record<string, unknown>) =>
  admin.put(`/universes/${universeId}/sensitive-unlock`, body);

async function unlockAndEnable(universe: UniverseDto): Promise<UniverseDto> {
  expect((await unlock(universe.id, { note: UNLOCK_NOTE, confirm: true })).statusCode).toBe(200);
  const response = await admin.put(`/universes/${universe.id}`, {
    name: universe.name,
    enabledModes: [...NEUTRAL, 'historic'],
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<UniverseDto>();
}

async function character(id: string): Promise<CharacterDto> {
  return (await admin.get(`/characters/${id}`)).json();
}

beforeEach(async () => {
  context = await startApp();
  admin = await adminClient(context);
});

afterEach(async () => {
  await context.close();
});

describe('unlocking sensitive modes for a universe with a young audience', () => {
  it('requires a confirmation and a long justification', async () => {
    const universe = await createUniverse('Pokémon');

    const unconfirmed = await unlock(universe.id, { note: UNLOCK_NOTE });
    expect(unconfirmed.json()).toEqual({ error: { code: 'CONFIRMATION_REQUIRED' } });
    const short = await unlock(universe.id, { note: SHORT_NOTE, confirm: true });
    expect(short.json()).toEqual({ error: { code: 'JUSTIFICATION_REQUIRED' } });
    const missing = await unlock(universe.id, { confirm: true });
    expect(missing.statusCode).toBe(400);

    const [stillLocked] = (await admin.get('/universes')).json<UniverseDto[]>();
    expect(stillLocked?.sensitiveUnlocked).toBe(false);
  });

  it('records who unlocked it, when and why', async () => {
    const universe = await createUniverse('Minecraft');
    const unlocked = (
      await unlock(universe.id, { note: UNLOCK_NOTE, confirm: true })
    ).json<UniverseDto>();
    expect(unlocked).toMatchObject({ sensitiveUnlocked: true, sensitiveUnlockNote: UNLOCK_NOTE });
    expect(unlocked.sensitiveUnlockedAt).not.toBeNull();
    const row = await context.db.universe.findUniqueOrThrow({ where: { id: universe.id } });
    expect(row.sensitiveUnlockedById).not.toBeNull();

    // Unlocking enables nothing by itself, and cannot be repeated.
    expect(unlocked.enabledModes).toEqual(NEUTRAL);
    expect((await unlock(universe.id, { note: UNLOCK_NOTE, confirm: true })).statusCode).toBe(409);
  });

  it('only applies to universes with a young audience', async () => {
    const general = await createUniverse('Valorant');
    expect((await unlock(general.id, { note: UNLOCK_NOTE, confirm: true })).statusCode).toBe(400);
    expect((await unlock('missing', { note: UNLOCK_NOTE, confirm: true })).statusCode).toBe(404);
  });

  it('cannot be set through any other endpoint', async () => {
    const universe = await createUniverse('Pokémon');
    const forged = await admin.put(`/universes/${universe.id}`, {
      name: 'Pokémon',
      enabledModes: NEUTRAL,
      sensitiveUnlocked: true,
      sensitiveUnlockedAt: new Date().toISOString(),
    });
    expect(forged.json<UniverseDto>().sensitiveUnlocked).toBe(false);
    const created = await admin.post('/universes', {
      name: 'Minecraft',
      enabledModes: NEUTRAL,
      sensitiveUnlocked: true,
    });
    expect(created.json<UniverseDto>().sensitiveUnlocked).toBe(false);
  });

  it('is not enough to make anyone eligible: the character and the image rules still apply', async () => {
    const universe = await unlockAndEnable(await createUniverse('Pokémon'));
    const misty = await createCharacter(universe.id, 'Misty');
    const oak = await createCharacter(universe.id, 'Professor Oak');
    await admin.put(`/characters/${misty.id}/classification`, { ageClass: 'MINOR', note: '' });
    await admin.put(`/characters/${oak.id}/status`, { status: 'ALLOWED' });

    expect((await character(misty.id)).eligibility.historic.reasons).toEqual([
      'STATUS_RESTRICTED',
      'NOT_ADULT_VERIFIED',
    ]);
    // A verified adult in a youth universe needs the stricter justification.
    const shortNote = await admin.put(`/characters/${oak.id}/classification`, {
      ageClass: 'ADULT_VERIFIED',
      note: SHORT_NOTE,
      confirm: true,
    });
    expect(shortNote.json()).toEqual({ error: { code: 'JUSTIFICATION_REQUIRED' } });
    const verified = await admin.put(`/characters/${oak.id}/classification`, {
      ageClass: 'ADULT_VERIFIED',
      note: STRICT_NOTE,
      confirm: true,
    });
    expect(verified.statusCode, verified.body).toBe(200);
    expect(verified.json<CharacterDto>().eligibility.historic.eligible).toBe(true);

    // Still no playable image: nothing is approved yet.
    expect(verified.json<CharacterDto>().usableImages.historic).toBe(0);
    expect((await character(misty.id)).eligibility.historic.eligible).toBe(false);
    expect((await findEligibleCharacters(context.db, 'historic')).map((item) => item.slug)).toEqual(
      ['professor-oak'],
    );
  });

  it('announces the stricter justification length in the character data', async () => {
    const pokemon = await createUniverse('Pokémon');
    const valorant = await createUniverse('Valorant');
    expect((await createCharacter(pokemon.id, 'Oak')).adultNoteMinLength).toBe(60);
    expect((await createCharacter(valorant.id, 'Jett')).adultNoteMinLength).toBe(20);
  });
});

describe('locking again', () => {
  it('switches every sensitive mode off at once and takes effect on the next selection', async () => {
    const universe = await unlockAndEnable(await createUniverse('Pokémon'));
    const oak = await createCharacter(universe.id, 'Professor Oak');
    await admin.put(`/characters/${oak.id}/status`, { status: 'ALLOWED' });
    await admin.put(`/characters/${oak.id}/classification`, {
      ageClass: 'ADULT_VERIFIED',
      note: STRICT_NOTE,
      confirm: true,
    });
    expect((await findEligibleCharacters(context.db, 'historic')).length).toBe(1);

    const response = await admin.delete(`/universes/${universe.id}/sensitive-unlock`);
    const locked = response.json<UniverseDto>();
    expect(locked).toMatchObject({ sensitiveUnlocked: false, sensitiveUnlockNote: null });
    expect(locked.enabledModes).toEqual(NEUTRAL);

    expect(await findEligibleCharacters(context.db, 'historic')).toEqual([]);
    expect((await character(oak.id)).eligibility.historic.reasons).toEqual([
      'MODE_DISABLED_FOR_UNIVERSE',
      'UNIVERSE_SENSITIVE_LOCKED',
    ]);
    // Neutral modes are untouched.
    expect((await character(oak.id)).eligibility['zoom-out'].eligible).toBe(true);
  });

  it('is idempotent and needs no confirmation', async () => {
    const universe = await createUniverse('Pokémon');
    const response = await admin.delete(`/universes/${universe.id}/sensitive-unlock`);
    expect(response.statusCode).toBe(200);
    expect(response.json<UniverseDto>().sensitiveUnlocked).toBe(false);
    expect((await admin.delete('/universes/missing/sensitive-unlock')).statusCode).toBe(404);
  });
});

describe('fundamental protections are independent from the universe settings', () => {
  it('keeps Annie out of sensitive modes in a fully unlocked universe setup', async () => {
    const lol = await createUniverse('League of Legends', [...NEUTRAL, 'historic']);
    const annie = await createCharacter(lol.id, 'Annie');
    await admin.put(`/characters/${annie.id}/status`, { status: 'ALLOWED' });
    const refused = await admin.put(`/characters/${annie.id}/classification`, {
      ageClass: 'ADULT_VERIFIED',
      note: STRICT_NOTE,
      confirm: true,
    });
    expect(refused.json()).toEqual({ error: { code: 'CLASSIFICATION_FORBIDDEN' } });
    expect((await character(annie.id)).eligibility.historic.reasons).toContain('CORE_EXCLUSION');
  });

  it('does not let a bulk change grant anything beyond the status', async () => {
    const universe = await unlockAndEnable(await createUniverse('Pokémon'));
    const oak = await createCharacter(universe.id, 'Professor Oak');
    await admin.post('/characters/bulk-status', {
      ids: [oak.id],
      status: 'ALLOWED',
      ageClass: 'ADULT_VERIFIED',
      confirm: true,
      note: STRICT_NOTE,
    });
    const after = await character(oak.id);
    expect(after).toMatchObject({ status: 'ALLOWED', ageClass: 'UNKNOWN' });
    expect(after.eligibility.historic.eligible).toBe(false);
  });
});
