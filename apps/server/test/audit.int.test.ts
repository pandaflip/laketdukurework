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

describe('restoring a restoration', () => {
  it('journals every restoration with its author and links it to the original change', async () => {
    const ashe = await createCharacter('Ashe');
    await admin.put(`/characters/${ashe.id}/status`, { status: 'EXCLUDED' });
    const [change] = await history(ashe.id);
    await admin.post(`/audit/${change?.id ?? ''}/restore`);

    const [restoration, original] = await history(ashe.id);
    expect(restoration).toMatchObject({
      action: 'character.status',
      adminUsername: 'admin',
      revertsId: original?.id,
      before: { status: 'EXCLUDED' },
      after: { status: 'RESTRICTED' },
      revertedAt: null,
      restorable: true,
    });
    expect(original?.revertedAt).not.toBeNull();
  });

  it('can be undone, and undone again, as long as nothing newer exists', async () => {
    const ashe = await createCharacter('Ashe');
    await admin.put(`/characters/${ashe.id}/status`, { status: 'EXCLUDED' });
    const statusAfter = async () => (await character(ashe.id)).status;

    const [first] = await history(ashe.id);
    await admin.post(`/audit/${first?.id ?? ''}/restore`);
    expect(await statusAfter()).toBe('RESTRICTED');

    const [firstRestoration] = await history(ashe.id);
    expect((await admin.post(`/audit/${firstRestoration?.id ?? ''}/restore`)).statusCode).toBe(200);
    expect(await statusAfter()).toBe('EXCLUDED');

    const [secondRestoration] = await history(ashe.id);
    expect(secondRestoration).toMatchObject({ revertsId: firstRestoration?.id, restorable: true });
    expect((await admin.post(`/audit/${secondRestoration?.id ?? ''}/restore`)).statusCode).toBe(
      200,
    );
    expect(await statusAfter()).toBe('RESTRICTED');

    // Creation, the change and three restorations: nothing is ever deleted from the history.
    expect((await history(ashe.id)).map((entry) => entry.action)).toEqual([
      'character.status',
      'character.status',
      'character.status',
      'character.status',
      'character.create',
    ]);
  });

  it('cannot undo a restoration once a newer change exists', async () => {
    const ashe = await createCharacter('Ashe');
    await admin.put(`/characters/${ashe.id}/status`, { status: 'EXCLUDED' });
    const [change] = await history(ashe.id);
    await admin.post(`/audit/${change?.id ?? ''}/restore`);
    const [restoration] = await history(ashe.id);
    await admin.put(`/characters/${ashe.id}/status`, { status: 'ALLOWED' });

    const response = await admin.post(`/audit/${restoration?.id ?? ''}/restore`);
    expect(response.statusCode).toBe(409);
    expect((await character(ashe.id)).status).toBe('ALLOWED');
  });

  it('restores a restored batch as a batch of its own', async () => {
    const ashe = await createCharacter('Ashe');
    const irelia = await createCharacter('Irelia');
    const bulk = (
      await admin.post('/characters/bulk-status', { ids: [ashe.id, irelia.id], status: 'EXCLUDED' })
    ).json<{ batchId: string }>();
    await admin.post(`/audit/batches/${bulk.batchId}/restore`);

    const restorations = (await history()).filter((entry) => entry.revertsId !== null);
    expect(restorations).toHaveLength(2);
    const restorationBatch = restorations[0]?.batchId ?? null;
    expect(restorationBatch).not.toBeNull();
    expect(restorationBatch).not.toBe(bulk.batchId);

    const undone = (
      await admin.post(`/audit/batches/${restorationBatch ?? ''}/restore`)
    ).json<unknown>();
    expect(undone).toEqual({ restored: 2, skipped: 0 });
    expect((await character(ashe.id)).status).toBe('EXCLUDED');
    expect((await character(irelia.id)).status).toBe('EXCLUDED');
  });
});

describe('an old restoration never silently overwrites a newer change', () => {
  it.each([
    [
      'names and aliases',
      async (id: string) => {
        await admin.put(`/characters/${id}/labels`, { names: { en: 'Ash' }, aliases: {} });
        await admin.put(`/characters/${id}/labels`, { names: { en: 'Asha' }, aliases: {} });
      },
      async (id: string) => (await character(id)).names.en,
      'Asha',
    ],
    [
      'blocked modes',
      async (id: string) => {
        await admin.put(`/characters/${id}/blocked-modes`, { modeIds: ['pixelated'] });
        await admin.put(`/characters/${id}/blocked-modes`, { modeIds: ['historic'] });
      },
      async (id: string) => (await character(id)).blockedModes.join(','),
      'historic',
    ],
    [
      'classification',
      async (id: string) => {
        await admin.put(`/characters/${id}/classification`, { ageClass: 'MINOR', note: '' });
        await admin.put(`/characters/${id}/classification`, { ageClass: 'AMBIGUOUS', note: '' });
      },
      async (id: string) => (await character(id)).ageClass,
      'AMBIGUOUS',
    ],
  ])(
    'refuses to restore an outdated change of %s',
    async (_label, makeTwoChanges, read, expected) => {
      const ashe = await createCharacter('Ashe');
      await makeTwoChanges(ashe.id);
      const entries = await history(ashe.id);
      const older = entries[1];
      const response = await admin.post(`/audit/${older?.id ?? ''}/restore`);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: { code: 'RESTORE_CONFLICT' } });
      expect(await read(ashe.id)).toBe(expected);
    },
  );

  it('refuses to restore an outdated change of a universe', async () => {
    const neutral = MODE_IDS.filter((id) => id !== 'historic');
    await admin.put(`/universes/${universe.id}`, {
      name: 'League of Legends',
      enabledModes: neutral,
    });
    await admin.put(`/universes/${universe.id}`, { name: 'LoL', enabledModes: neutral });
    const entries = await history(universe.id);
    const response = await admin.post(`/audit/${entries[1]?.id ?? ''}/restore`);
    expect(response.statusCode).toBe(409);
    const [current] = (await admin.get('/universes')).json<UniverseDto[]>();
    expect(current?.name).toBe('LoL');
  });
});

describe('safety validations are re-applied by every restoration', () => {
  const NOTE =
    'Explicit product decision: sensitive modes may be offered for individually verified adults of this universe only.';

  it('cannot re-enable a sensitive mode in a universe that was locked in the meantime', async () => {
    const neutral = MODE_IDS.filter((id) => id !== 'historic');
    const pokemon = (
      await admin.post('/universes', { name: 'Pokémon', enabledModes: neutral })
    ).json<UniverseDto>();
    await admin.put(`/universes/${pokemon.id}/sensitive-unlock`, { note: NOTE, confirm: true });
    await admin.put(`/universes/${pokemon.id}`, { name: 'Pokémon', enabledModes: MODE_IDS });
    const [enabled] = await history(pokemon.id);

    // Undo the change, lock the universe, then try to undo the undo.
    await admin.post(`/audit/${enabled?.id ?? ''}/restore`);
    const [restoration] = await history(pokemon.id);
    await admin.delete(`/universes/${pokemon.id}/sensitive-unlock`);

    const response = await admin.post(`/audit/${restoration?.id ?? ''}/restore`);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: { code: 'SENSITIVE_MODE_FORBIDDEN' } });
    const universes = (await admin.get('/universes')).json<UniverseDto[]>();
    expect(universes.find((entry) => entry.id === pokemon.id)?.enabledModes).toEqual(neutral);
  });

  it('never restores the unlocking or the locking of a universe', async () => {
    const pokemon = (
      await admin.post('/universes', { name: 'Pokémon', enabledModes: [] })
    ).json<UniverseDto>();
    await admin.put(`/universes/${pokemon.id}/sensitive-unlock`, { note: NOTE, confirm: true });
    await admin.delete(`/universes/${pokemon.id}/sensitive-unlock`);

    const entries = await history(pokemon.id);
    expect(entries.map((entry) => entry.action).slice(0, 2)).toEqual([
      'universe.sensitive-lock',
      'universe.sensitive-unlock',
    ]);
    for (const entry of entries.slice(0, 2)) {
      expect(entry.restorable).toBe(false);
      const response = await admin.post(`/audit/${entry.id}/restore`);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: { code: 'RESTORE_NOT_ALLOWED' } });
    }
    const [current] = (await admin.get('/universes')).json<UniverseDto[]>();
    expect(current?.sensitiveUnlocked).toBe(false);
  });

  it('keeps the classification out of status restorations', async () => {
    const ashe = await createCharacter('Ashe');
    await admin.put(`/characters/${ashe.id}/classification`, {
      ageClass: 'ADULT_VERIFIED',
      note: ADULT_NOTE,
      confirm: true,
    });
    await admin.put(`/characters/${ashe.id}/status`, { status: 'ALLOWED' });
    await admin.put(`/characters/${ashe.id}/classification`, {
      ageClass: 'CHILDLIKE',
      note: 'Doubt raised during review.',
    });

    const statusChange = (await history(ashe.id)).find(
      (entry) => entry.action === 'character.status',
    );
    expect((await admin.post(`/audit/${statusChange?.id ?? ''}/restore`)).statusCode).toBe(200);
    const after = await character(ashe.id);
    expect(after).toMatchObject({ status: 'RESTRICTED', ageClass: 'CHILDLIKE' });
    expect(after.eligibility.historic.eligible).toBe(false);
  });
});
