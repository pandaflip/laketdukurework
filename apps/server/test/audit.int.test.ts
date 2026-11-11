import type { AuditEntryDto, CharacterDto, Page, UniverseDto } from '@app/shared';
import { MODE_IDS } from '@app/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminClient, startApp, type Client, type TestContext } from './helpers';

const ADULT_NOTE = 'Adult in the official lore; adult appearance and presentation.';

let context: TestContext;
let admin: Client;
let universe: UniverseDto;

async function createCharacter(name: string): Promise<CharacterDto> {
  return (await admin.post('/characters', { universeId: universe.id, names: { en: name } })).json();
}

async function history(entityId?: string): Promise<readonly AuditEntryDto[]> {
  const url = entityId === undefined ? '/audit' : `/audit?entityId=${entityId}`;
  return (await admin.get(url)).json<Page<AuditEntryDto>>().items;
}

async function character(id: string): Promise<CharacterDto> {
  return (await admin.get(`/characters/${id}`)).json();
}

beforeEach(async () => {
  context = await startApp();
  admin = await adminClient(context);
  universe = (
    await admin.post('/universes', { name: 'League of Legends', enabledModes: MODE_IDS })
  ).json();
});

afterEach(async () => {
  await context.close();
});

describe('history', () => {
  it('records who changed what, with before and after values', async () => {
    const ashe = await createCharacter('Ashe');
    await admin.put(`/characters/${ashe.id}/status`, { status: 'ALLOWED' });
    await admin.put(`/characters/${ashe.id}/status`, { status: 'ALLOWED' }); // no-op: not logged

    const entries = await history(ashe.id);
    expect(entries.map((entry) => entry.action)).toEqual(['character.status', 'character.create']);
    expect(entries[0]).toMatchObject({
      adminUsername: 'admin',
      entityLabel: 'Ashe',
      before: { status: 'RESTRICTED' },
      after: { status: 'ALLOWED' },
      restorable: true,
      revertedAt: null,
    });
    expect(entries[1]?.restorable).toBe(false);
    expect((await history()).length).toBe(3); // + universe.create
  });
});

describe('restore', () => {
  it('restores a status change and records the restoration', async () => {
    const ashe = await createCharacter('Ashe');
    await admin.put(`/characters/${ashe.id}/status`, { status: 'EXCLUDED' });
    const [change] = await history(ashe.id);

    const response = await admin.post(`/audit/${change?.id ?? ''}/restore`);
    expect(response.statusCode, response.body).toBe(200);
    expect((await character(ashe.id)).status).toBe('RESTRICTED');

    const [restoration, original] = await history(ashe.id);
    expect(restoration).toMatchObject({
      action: 'character.status',
      revertsId: original?.id,
      after: { status: 'RESTRICTED' },
    });
    expect(original?.revertedAt).not.toBeNull();
    expect(original?.restorable).toBe(false);

    // An entry cannot be restored twice.
    expect((await admin.post(`/audit/${original?.id ?? ''}/restore`)).statusCode).toBe(422);
  });

  it('refuses to overwrite a newer change', async () => {
    const ashe = await createCharacter('Ashe');
    await admin.put(`/characters/${ashe.id}/status`, { status: 'EXCLUDED' });
    const [first] = await history(ashe.id);
    await admin.put(`/characters/${ashe.id}/status`, { status: 'ALLOWED' });

    const response = await admin.post(`/audit/${first?.id ?? ''}/restore`);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: 'RESTORE_CONFLICT' } });
    expect((await character(ashe.id)).status).toBe('ALLOWED');
  });

  it('restores a whole bulk operation, skipping entries changed since', async () => {
    const ashe = await createCharacter('Ashe');
    const irelia = await createCharacter('Irelia');
    const poppy = await createCharacter('Poppy');
    const bulk = (
      await admin.post('/characters/bulk-status', {
        ids: [ashe.id, irelia.id, poppy.id],
        status: 'EXCLUDED',
      })
    ).json<{ batchId: string }>();
    await admin.put(`/characters/${poppy.id}/status`, { status: 'ALLOWED' });

    const result = (await admin.post(`/audit/batches/${bulk.batchId}/restore`)).json<unknown>();
    expect(result).toEqual({ restored: 2, skipped: 1 });
    expect((await character(ashe.id)).status).toBe('RESTRICTED');
    expect((await character(irelia.id)).status).toBe('RESTRICTED');
    expect((await character(poppy.id)).status).toBe('ALLOWED');
    expect((await admin.post('/audit/batches/unknown/restore')).statusCode).toBe(404);
  });

  it('never grants ADULT_VERIFIED through a restoration', async () => {
    const ashe = await createCharacter('Ashe');
    const url = `/characters/${ashe.id}/classification`;
    await admin.put(url, { ageClass: 'ADULT_VERIFIED', note: ADULT_NOTE, confirm: true });
    await admin.put(url, { ageClass: 'AMBIGUOUS', note: 'Doubt raised during review.' });

    const [downgrade, upgrade] = await history(ashe.id);
    expect(downgrade).toMatchObject({ action: 'character.classification', restorable: false });
    const response = await admin.post(`/audit/${downgrade?.id ?? ''}/restore`);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: { code: 'RESTORE_NOT_ALLOWED' } });
    expect((await character(ashe.id)).ageClass).toBe('AMBIGUOUS');

    // Undoing the upgrade itself (towards the stricter state) is allowed, when still current.
    expect(upgrade?.restorable).toBe(true);
    expect((await admin.post(`/audit/${upgrade?.id ?? ''}/restore`)).statusCode).toBe(409);
  });

  it('restores an accidental classification upgrade back to the stricter state', async () => {
    const ashe = await createCharacter('Ashe');
    await admin.put(`/characters/${ashe.id}/classification`, {
      ageClass: 'ADULT_VERIFIED',
      note: ADULT_NOTE,
      confirm: true,
    });
    const [upgrade] = await history(ashe.id);
    expect((await admin.post(`/audit/${upgrade?.id ?? ''}/restore`)).statusCode).toBe(200);
    expect(await character(ashe.id)).toMatchObject({ ageClass: 'UNKNOWN', ageClassNote: null });
  });

  it('restores names, aliases and per-mode restrictions', async () => {
    const ashe = await createCharacter('Ashe');
    await admin.put(`/characters/${ashe.id}/labels`, {
      names: { en: 'Ash', fr: 'Cendre' },
      aliases: { en: ['Archer'] },
    });
    await admin.put(`/characters/${ashe.id}/blocked-modes`, { modeIds: ['pixelated'] });

    const [blocked, labels] = await history(ashe.id);
    expect((await admin.post(`/audit/${labels?.id ?? ''}/restore`)).statusCode).toBe(200);
    expect((await admin.post(`/audit/${blocked?.id ?? ''}/restore`)).statusCode).toBe(200);
    expect(await character(ashe.id)).toMatchObject({
      names: { en: 'Ashe' },
      aliases: { en: [], fr: [], 'pt-BR': [] },
      blockedModes: [],
    });
  });

  it('re-validates universe settings when restoring them', async () => {
    const neutral = MODE_IDS.filter((id) => id !== 'historic');
    await admin.put(`/universes/${universe.id}`, {
      name: 'League of Legends',
      enabledModes: neutral,
    });
    const [update] = await history(universe.id);
    expect((await admin.post(`/audit/${update?.id ?? ''}/restore`)).statusCode).toBe(200);
    const [restored] = (await admin.get('/universes')).json<UniverseDto[]>();
    expect(restored?.enabledModes).toEqual(MODE_IDS);
  });

  it('refuses unknown entries and non-restorable actions', async () => {
    const ashe = await createCharacter('Ashe');
    const [creation] = await history(ashe.id);
    expect((await admin.post(`/audit/${creation?.id ?? ''}/restore`)).statusCode).toBe(422);
    expect((await admin.post('/audit/unknown/restore')).statusCode).toBe(404);
  });
});
