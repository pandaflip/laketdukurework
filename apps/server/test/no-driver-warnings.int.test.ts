import type { CharacterDto } from '@app/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkRoundEligibility } from '../src/modules/catalog/selection.service';
import {
  adminClient,
  createAsset,
  createReviewedUniverse,
  startApp,
  type Client,
  type TestContext,
} from './helpers';

let context: TestContext;
let admin: Client;
const warnings: string[] = [];
const collect = (warning: Error): void => {
  warnings.push(`${warning.name}: ${warning.message}`);
};

beforeEach(async () => {
  warnings.length = 0;
  process.on('warning', collect);
  context = await startApp();
  admin = await adminClient(context);
});

afterEach(async () => {
  process.off('warning', collect);
  await context.close();
});

describe('database driver', () => {
  it('emits no deprecation warning during the usual administration flows', async () => {
    const universe = await createReviewedUniverse(admin, 'League of Legends');
    const created = (
      await admin.post('/characters', {
        universeId: universe.id,
        names: { en: 'Ashe', fr: 'Ashe' },
        aliases: { en: ['Archer'] },
      })
    ).json<CharacterDto>();
    const asset = await createAsset(context.db, created.id, 'APPROVED_NEUTRAL');

    await admin.put(`/characters/${created.id}/status`, { status: 'ALLOWED' });
    await admin.put(`/characters/${created.id}/blocked-modes`, { modeIds: ['pixelated'] });
    await admin.put(`/characters/${created.id}/labels`, { names: { en: 'Ash' }, aliases: {} });
    await admin.post('/characters/bulk-status', { ids: [created.id], status: 'EXCLUDED' });
    const history = (await admin.get('/audit')).json<{ items: { id: string }[] }>();
    await admin.post(`/audit/${history.items[0]?.id ?? ''}/restore`);
    await checkRoundEligibility(context.db, 'zoom-out', asset.id);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(warnings.filter((line) => line.includes('client.query()'))).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
