import type { AuditEntryDto, CharacterDto, Page, UniverseDto } from '@app/shared';
import { MODE_IDS } from '@app/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkRoundEligibility } from '../src/modules/catalog/selection.service';
import {
  adminClient,
  createReviewedUniverse,
  REVIEW_NOTE,
  startApp,
  type Client,
  type TestContext,
} from './helpers';

const NEUTRAL = MODE_IDS.filter((id) => id !== 'historic');
const ADULT_NOTE = 'Adult in the official lore; adult appearance and presentation.';
const STRICT_ADULT_NOTE =
  'Adult according to the official material (stated age, profession), adult proportions and ' +
  'presentation, no childlike trait. Reviewed individually.';

let context: TestContext;
let admin: Client;

const audience = (id: string, body: Record<string, unknown>) =>
  admin.put(`/universes/${id}/audience`, body);

const universes = async (): Promise<UniverseDto[]> => (await admin.get('/universes')).json();
const universe = async (id: string): Promise<UniverseDto> =>
  (await universes()).find((entry) => entry.id === id) as UniverseDto;

async function createCharacter(universeId: string, name: string): Promise<CharacterDto> {
  const response = await admin.post('/characters', { universeId, names: { en: name } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<CharacterDto>();
}

const character = async (id: string): Promise<CharacterDto> =>
  (await admin.get(`/characters/${id}`)).json();

async function history(entityId: string): Promise<readonly AuditEntryDto[]> {
  return (await admin.get(`/audit?entityId=${entityId}`)).json<Page<AuditEntryDto>>().items;
}

beforeEach(async () => {
  context = await startApp();
  admin = await adminClient(context);
});

afterEach(async () => {
  await context.close();
});

describe('a new universe', () => {
  it('starts UNREVIEWED, whatever the request says', async () => {
    const response = await admin.post('/universes', {
      name: 'Some Game',
      enabledModes: NEUTRAL,
      audience: 'GENERAL',
    });
    expect(response.json<UniverseDto>()).toMatchObject({
      audience: 'UNREVIEWED',
      audienceSetting: 'UNREVIEWED',
      audienceLockedByPolicy: false,
      audienceNote: null,
      audienceSetAt: null,
    });
    // The database default is the same, so no code path can create a reviewed universe by accident.
    const raw = await context.db.universe.create({
      data: { slug: 'raw', name: 'Raw', enabledModes: [] },
    });
    expect(raw.audience).toBe('UNREVIEWED');
  });

  it('cannot enable a sensitive mode, at creation or later, until it is reviewed', async () => {
    const refused = await admin.post('/universes', {
      name: 'Some Game',
      enabledModes: ['historic'],
    });
    expect(refused.json()).toEqual({ error: { code: 'SENSITIVE_MODE_FORBIDDEN' } });

    const created = await createReviewedUniverse(admin, 'Some Game', NEUTRAL, 'UNREVIEWED');
    const update = await admin.put(`/universes/${created.id}`, {
      name: 'Some Game',
      enabledModes: MODE_IDS,
      audience: 'GENERAL', // ignored: the classification has its own endpoint
    });
    expect(update.statusCode).toBe(422);
    expect((await universe(created.id)).audience).toBe('UNREVIEWED');
  });

  it('keeps even a verified adult out of sensitive modes, with an explicit reason', async () => {
    const created = await createReviewedUniverse(admin, 'Some Game', NEUTRAL, 'UNREVIEWED');
    const ashe = await createCharacter(created.id, 'Ashe');
    await admin.put(`/characters/${ashe.id}/status`, { status: 'ALLOWED' });

    // An unreviewed universe asks for the strict justification.
    expect(ashe.adultNoteMinLength).toBe(60);
    const short = await admin.put(`/characters/${ashe.id}/classification`, {
      ageClass: 'ADULT_VERIFIED',
      note: ADULT_NOTE.slice(0, 40),
      confirm: true,
    });
    expect(short.json()).toEqual({ error: { code: 'JUSTIFICATION_REQUIRED' } });
    await admin.put(`/characters/${ashe.id}/classification`, {
      ageClass: 'ADULT_VERIFIED',
      note: STRICT_ADULT_NOTE,
      confirm: true,
    });
    const after = await character(ashe.id);
    expect(after.universe.audience).toBe('UNREVIEWED');
    expect(after.eligibility.historic.reasons).toEqual([
      'MODE_DISABLED_FOR_UNIVERSE',
      'UNIVERSE_UNREVIEWED',
    ]);
    expect(after.eligibility['zoom-out'].eligible).toBe(true);
  });

  it('cannot be unlocked: it has to be reviewed first', async () => {
    const created = await createReviewedUniverse(admin, 'Some Game', NEUTRAL, 'UNREVIEWED');
    const response = await admin.put(`/universes/${created.id}/sensitive-unlock`, {
      note: REVIEW_NOTE,
      confirm: true,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('reviewing a universe as general audience', () => {
  it('needs a confirmation and a long written justification', async () => {
    const created = await createReviewedUniverse(admin, 'Some Game', NEUTRAL, 'UNREVIEWED');
    const unconfirmed = await audience(created.id, { audience: 'GENERAL', note: REVIEW_NOTE });
    expect(unconfirmed.json()).toEqual({ error: { code: 'CONFIRMATION_REQUIRED' } });
    const short = await audience(created.id, {
      audience: 'GENERAL',
      note: 'looks fine',
      confirm: true,
    });
    expect(short.json()).toEqual({ error: { code: 'JUSTIFICATION_REQUIRED' } });
    expect((await universe(created.id)).audience).toBe('UNREVIEWED');
    expect(
      (await audience(created.id, { audience: 'NOPE', note: REVIEW_NOTE, confirm: true }))
        .statusCode,
    ).toBe(400);
    expect(
      (await audience('missing', { audience: 'GENERAL', note: REVIEW_NOTE, confirm: true }))
        .statusCode,
    ).toBe(404);
  });

  it('records who reviewed it, when and why, and opens sensitive modes for verified adults only', async () => {
    const created = await createReviewedUniverse(admin, 'Some Game', NEUTRAL, 'UNREVIEWED');
    const reviewed = (
      await audience(created.id, { audience: 'GENERAL', note: REVIEW_NOTE, confirm: true })
    ).json<UniverseDto>();
    expect(reviewed).toMatchObject({
      audience: 'GENERAL',
      audienceSetting: 'GENERAL',
      audienceNote: REVIEW_NOTE,
    });
    expect(reviewed.audienceSetAt).not.toBeNull();
    const row = await context.db.universe.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.audienceSetById).not.toBeNull();

    // The review enables nothing by itself.
    expect(reviewed.enabledModes).toEqual(NEUTRAL);
    const enabled = await admin.put(`/universes/${created.id}`, {
      name: 'Some Game',
      enabledModes: MODE_IDS,
    });
    expect(enabled.statusCode, enabled.body).toBe(200);

    // And none of the character rules is lifted.
    const ashe = await createCharacter(created.id, 'Ashe');
    const minor = await createCharacter(created.id, 'Kid');
    await admin.put(`/characters/${ashe.id}/status`, { status: 'ALLOWED' });
    await admin.put(`/characters/${minor.id}/status`, { status: 'ALLOWED' });
    await admin.put(`/characters/${minor.id}/classification`, { ageClass: 'MINOR', note: '' });
    expect(ashe.adultNoteMinLength).toBe(20);
    await admin.put(`/characters/${ashe.id}/classification`, {
      ageClass: 'ADULT_VERIFIED',
      note: ADULT_NOTE,
      confirm: true,
    });
    expect((await character(ashe.id)).eligibility.historic.eligible).toBe(true);
    expect((await character(minor.id)).eligibility.historic.reasons).toEqual([
      'NOT_ADULT_VERIFIED',
    ]);
  });

  it('is a no-op, and not logged again, when the classification does not change', async () => {
    const created = await createReviewedUniverse(admin, 'Some Game', NEUTRAL, 'GENERAL');
    await audience(created.id, { audience: 'GENERAL', note: REVIEW_NOTE, confirm: true });
    expect(
      (await history(created.id)).filter((entry) => entry.action === 'universe.audience'),
    ).toHaveLength(1);
  });
});

describe('universes the code fixes as young-audience', () => {
  it.each(['Pokémon', 'Minecraft'])(
    '%s can never be reviewed as general audience',
    async (name) => {
      const created = await createReviewedUniverse(admin, name, NEUTRAL, 'UNREVIEWED');
      expect(created).toMatchObject({
        audience: 'YOUTH',
        audienceSetting: 'UNREVIEWED',
        audienceLockedByPolicy: true,
      });

      const response = await audience(created.id, {
        audience: 'GENERAL',
        note: REVIEW_NOTE,
        confirm: true,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: { code: 'AUDIENCE_FORBIDDEN' } });
      expect((await universe(created.id)).audience).toBe('YOUTH');
    },
  );

  it('stays young-audience whatever is stored, even if the database is edited directly', async () => {
    const created = await createReviewedUniverse(admin, 'Pokémon', NEUTRAL, 'YOUTH');
    await context.db.universe.update({ where: { id: created.id }, data: { audience: 'GENERAL' } });
    const after = await universe(created.id);
    expect(after).toMatchObject({ audience: 'YOUTH', audienceSetting: 'GENERAL' });

    const oak = await createCharacter(created.id, 'Professor Oak');
    expect((await character(oak.id)).eligibility.historic.reasons).toContain(
      'MODE_DISABLED_FOR_UNIVERSE',
    );
    const refused = await admin.put(`/universes/${created.id}`, {
      name: 'Pokémon',
      enabledModes: MODE_IDS,
    });
    expect(refused.json()).toEqual({ error: { code: 'SENSITIVE_MODE_FORBIDDEN' } });

    const renamed = await admin.put(`/universes/${created.id}`, {
      name: 'Pocket Creatures',
      enabledModes: MODE_IDS,
    });
    expect(renamed.statusCode).toBe(422);
  });

  it('can still be classified in the stricter direction', async () => {
    const created = await createReviewedUniverse(admin, 'Pokémon', NEUTRAL, 'UNREVIEWED');
    const response = await audience(created.id, {
      audience: 'YOUTH',
      note: 'Franchise aimed at children.',
    });
    expect(response.json<UniverseDto>()).toMatchObject({
      audienceSetting: 'YOUTH',
      audience: 'YOUTH',
    });
  });
});

describe('moving to a stricter classification', () => {
  const NOTE =
    'Explicit product decision: sensitive modes may be offered for individually verified adults of this universe only.';

  it.each(['YOUTH', 'UNREVIEWED'] as const)(
    'to %s applies at once, switches sensitive modes off and clears any unlock',
    async (target) => {
      const created = await createReviewedUniverse(admin, 'Some Game', MODE_IDS, 'GENERAL');
      expect((await universe(created.id)).enabledModes).toContain('historic');

      const stricter = (await audience(created.id, { audience: target })).json<UniverseDto>();
      expect(stricter.audience).toBe(target);
      expect(stricter.enabledModes).toEqual(NEUTRAL);
      expect(stricter.sensitiveUnlocked).toBe(false);

      // Going back to general audience never re-activates what was switched off.
      const back = (
        await audience(created.id, { audience: 'GENERAL', note: REVIEW_NOTE, confirm: true })
      ).json<UniverseDto>();
      expect(back.audience).toBe('GENERAL');
      expect(back.enabledModes).toEqual(NEUTRAL);
    },
  );

  it('from young-audience with an unlock to general audience clears the unlock', async () => {
    const created = await createReviewedUniverse(admin, 'Some Game', NEUTRAL, 'YOUTH');
    await admin.put(`/universes/${created.id}/sensitive-unlock`, { note: NOTE, confirm: true });
    expect((await universe(created.id)).sensitiveUnlocked).toBe(true);

    const general = (
      await audience(created.id, { audience: 'GENERAL', note: REVIEW_NOTE, confirm: true })
    ).json<UniverseDto>();
    expect(general).toMatchObject({
      audience: 'GENERAL',
      sensitiveUnlocked: false,
      sensitiveUnlockNote: null,
    });
  });

  it('makes verified adults ineligible on the very next round check', async () => {
    const created = await createReviewedUniverse(admin, 'Some Game', MODE_IDS, 'GENERAL');
    const ashe = await createCharacter(created.id, 'Ashe');
    await admin.put(`/characters/${ashe.id}/status`, { status: 'ALLOWED' });
    await admin.put(`/characters/${ashe.id}/classification`, {
      ageClass: 'ADULT_VERIFIED',
      note: ADULT_NOTE,
      confirm: true,
    });
    const variant = (
      await admin.post(`/characters/${ashe.id}/variants`, { names: { en: 'Classic' } })
    ).json<CharacterDto>();
    const asset = await context.db.asset.create({
      data: { variantId: variant.variants[0]?.id ?? '', review: 'APPROVED_SENSITIVE' },
    });
    expect((await checkRoundEligibility(context.db, 'historic', asset.id)).eligible).toBe(true);

    await audience(created.id, { audience: 'UNREVIEWED' });
    expect((await checkRoundEligibility(context.db, 'historic', asset.id)).reasons).toEqual([
      'MODE_DISABLED_FOR_UNIVERSE',
      'UNIVERSE_UNREVIEWED',
    ]);
    expect((await checkRoundEligibility(context.db, 'zoom-out', asset.id)).eligible).toBe(true);
  });
});

describe('history of the audience classification', () => {
  it('is logged with its justification and is never restorable', async () => {
    const created = await createReviewedUniverse(admin, 'Some Game', NEUTRAL, 'GENERAL');
    await audience(created.id, { audience: 'YOUTH' });

    const [stricter, general] = await history(created.id);
    expect(stricter).toMatchObject({
      action: 'universe.audience',
      adminUsername: 'admin',
      before: { audience: 'GENERAL' },
      after: { audience: 'YOUTH', unlocked: false },
      restorable: false,
    });
    expect(general).toMatchObject({
      action: 'universe.audience',
      after: { audience: 'GENERAL', note: REVIEW_NOTE },
      restorable: false,
    });
    for (const entry of [stricter, general]) {
      const response = await admin.post(`/audit/${entry?.id ?? ''}/restore`);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: { code: 'RESTORE_NOT_ALLOWED' } });
    }
    expect((await universe(created.id)).audience).toBe('YOUTH');
  });

  it('cannot be used to undo a change into a universe that is no longer reviewed', async () => {
    const created = await createReviewedUniverse(admin, 'Some Game', NEUTRAL, 'GENERAL');
    await admin.put(`/universes/${created.id}`, { name: 'Some Game', enabledModes: MODE_IDS });
    const [enabled] = await history(created.id);
    await admin.post(`/audit/${enabled?.id ?? ''}/restore`); // back to neutral modes only
    const [restoration] = await history(created.id);

    await audience(created.id, { audience: 'UNREVIEWED' });
    const response = await admin.post(`/audit/${restoration?.id ?? ''}/restore`);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: { code: 'SENSITIVE_MODE_FORBIDDEN' } });
    expect((await universe(created.id)).enabledModes).toEqual(NEUTRAL);
  });
});
