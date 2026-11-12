import type {
  AuditEntryDto,
  CharacterDto,
  ImageDetailDto,
  ImageDto,
  Page,
  UniverseDto,
} from '@app/shared';
import { generateSequence, MAX_STEPS, aspectRatio } from '@app/shared';
import { execFileSync } from 'node:child_process';
import { utimes, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkRoundEligibility } from '../src/modules/catalog/selection.service';
import { FileStorage } from '../src/modules/images/storage';
import { pruneOrphanFiles } from '../src/modules/images/service';
import {
  importPicture,
  listFiles,
  saveSequenceOf,
  sequenceBody,
  setupCharacter,
} from './image-helpers';
import {
  adminClient,
  createReviewedUniverse,
  startApp,
  type Client,
  type TestContext,
} from './helpers';

/** The value, or a clear failure when a test expected it to exist. */
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

const NOTE = 'Reviewed one by one: adult character, appropriate framing.';
const ADULT_NOTE = 'Adult in the official lore; adult appearance and presentation.';

let context: TestContext;
let admin: Client;
let universe: UniverseDto;
let character: CharacterDto;

beforeEach(async () => {
  context = await startApp();
  admin = await adminClient(context);
  ({ universe, character } = await setupCharacter(admin));
});
afterEach(async () => {
  await context.close();
});

const detail = async (id: string): Promise<ImageDetailDto> =>
  (await admin.get(`/images/${id}`)).json();
const review = (id: string, body: Record<string, unknown>) =>
  admin.put(`/images/${id}/review`, body);
const history = async (entityId: string): Promise<readonly AuditEntryDto[]> =>
  (await admin.get(`/audit?entityId=${entityId}`)).json<Page<AuditEntryDto>>().items;

async function makeAdult(characterId: string): Promise<void> {
  await admin.put(`/characters/${characterId}/status`, { status: 'ALLOWED' });
  const response = await admin.put(`/characters/${characterId}/classification`, {
    ageClass: 'ADULT_VERIFIED',
    note: ADULT_NOTE,
    confirm: true,
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function readyImage(seed = 0): Promise<ImageDto> {
  const image = await importPicture(admin, character.id, { seed });
  await saveSequenceOf(admin, image, 5);
  return image;
}

describe('saving a sequence', () => {
  it('persists the frames, the settings and the names, and gives them back unchanged', async () => {
    const image = await importPicture(admin, character.id);
    const body = sequenceBody(image, 15);
    body.steps[3] = {
      name: '  The sword  ',
      rect: body.steps[3]?.rect ?? must(body.steps[0]).rect,
      manual: true,
    };
    body.steps[4] = { name: '', rect: must(body.steps[4]).rect, manual: false };
    const saved = (await admin.put(`/images/${image.id}/sequence`, body)).json<ImageDetailDto>();

    expect(saved).toMatchObject({ hasSequence: true, stepCount: 15 });
    const reopened = await detail(image.id);
    expect(reopened.sequence?.aspect).toEqual({ w: 16, h: 9 });
    expect(reopened.sequence?.params).toEqual(body.params);
    expect(reopened.sequence?.steps).toHaveLength(15);
    reopened.sequence?.steps.forEach((step, index) => {
      expect(step.rect).toEqual(body.steps[index]?.rect);
    });
    expect(reopened.sequence?.steps[3]).toMatchObject({ name: 'The sword', manual: true });
    expect(reopened.sequence?.steps[4]).toMatchObject({ name: null, manual: false });
    expect(reopened.sequence?.steps[0]?.manual).toBe(false);
  });

  it.each([1, 2, 5, 15, 30, MAX_STEPS])(
    'saves and reopens a sequence of %i steps',
    async (steps) => {
      const image = await importPicture(admin, character.id, { seed: steps });
      const saved = await saveSequenceOf(admin, image, steps);
      expect(saved.stepCount).toBe(steps);
      expect((await detail(image.id)).sequence?.steps).toHaveLength(steps);
    },
  );

  it('replaces the previous sequence instead of piling up rows', async () => {
    const image = await importPicture(admin, character.id);
    await saveSequenceOf(admin, image, 15);
    await saveSequenceOf(admin, image, 4);
    expect(await context.db.sequence.count({ where: { assetId: image.id } })).toBe(1);
    expect(await context.db.sequenceStep.count()).toBe(4);
    expect((await detail(image.id)).stepCount).toBe(4);
  });

  it.each([
    [
      { w: 4, h: 3 },
      { width: 1215, height: 717 },
    ],
    [
      { w: 1, h: 1 },
      { width: 1215, height: 717 },
    ],
    [
      { w: 16, h: 9 },
      { width: 1000, height: 1800 },
    ],
    [
      { w: 1, h: 1 },
      { width: 1500, height: 1500 },
    ],
  ])('accepts frames for the %j display on a %j picture', async (aspect, size) => {
    const image = await importPicture(admin, character.id, {
      ...size,
      seed: aspect.w * 10 + size.width,
    });
    const response = await admin.put(
      `/images/${image.id}/sequence`,
      sequenceBody(image, 6, { aspect }),
    );
    expect(response.statusCode, response.body).toBe(200);
    // And the generator agrees with what was saved.
    const saved = (await detail(image.id)).sequence;
    expect(saved?.aspect).toEqual(aspect);
    expect(
      generateSequence({
        image,
        ratio: aspectRatio(aspect),
        focus: { x: 0.6, y: 0.4 },
        start: { kind: 'zoom', zoom: 6 },
        end: { kind: 'zoom', zoom: 1 },
        steps: 6,
      }).rects,
    ).toEqual(saved?.steps.map((step) => step.rect));
  });

  it('checks every frame on the server, whatever the browser claims, and keeps the previous sequence', async () => {
    const image = await importPicture(admin, character.id);
    const good = await saveSequenceOf(admin, image, 5);
    const body = sequenceBody(image, 5);
    const first = must(body.steps[0]).rect;
    const attempts: [string, unknown, number, string][] = [
      [
        'a frame outside the picture',
        { ...body, steps: [{ ...must(body.steps[0]), rect: { ...first, x: 0.9 } }] },
        422,
        'INVALID_SEQUENCE',
      ],
      [
        'a frame that does not have the ratio',
        { ...body, steps: [{ ...must(body.steps[0]), rect: { ...first, w: first.w * 1.5 } }] },
        422,
        'INVALID_SEQUENCE',
      ],
      [
        'a frame that is too small',
        {
          ...body,
          steps: [
            {
              ...must(body.steps[0]),
              rect: { x: 0, y: 0, w: 0.004, h: 0.004 * (1215 / 717) * (9 / 16) },
            },
          ],
        },
        422,
        'INVALID_SEQUENCE',
      ],
      [
        'frames computed for another picture',
        sequenceBody({ width: 500, height: 1800 }, 5),
        422,
        'INVALID_SEQUENCE',
      ],
      ['a ratio that is not offered', { ...body, aspect: { w: 5, h: 3 } }, 400, 'VALIDATION_ERROR'],
      ['no step', { ...body, steps: [] }, 400, 'VALIDATION_ERROR'],
      [
        'too many steps',
        { ...body, steps: Array(MAX_STEPS + 1).fill(body.steps[0]) },
        400,
        'VALIDATION_ERROR',
      ],
      [
        'a name that is too long',
        { ...body, steps: [{ ...must(body.steps[0]), name: 'x'.repeat(81) }] },
        400,
        'VALIDATION_ERROR',
      ],
      [
        'a zoom outside the range',
        { ...body, params: { ...body.params, zoomStart: 500 } },
        400,
        'VALIDATION_ERROR',
      ],
      [
        'a focus outside the picture',
        { ...body, params: { ...body.params, focus: { x: 2, y: 0 } } },
        400,
        'VALIDATION_ERROR',
      ],
      [
        'text instead of numbers',
        { ...body, steps: [{ name: null, rect: { x: 'a', y: 0, w: 1, h: 1 }, manual: false }] },
        400,
        'VALIDATION_ERROR',
      ],
    ];
    for (const [label, payload, status, code] of attempts) {
      const response = await admin.put(`/images/${image.id}/sequence`, payload);
      expect(response.statusCode, label).toBe(status);
      expect(response.json(), label).toEqual({ error: { code } });
    }
    expect((await detail(image.id)).sequence?.steps).toEqual(good.sequence?.steps);
    expect((await admin.put('/images/missing/sequence', body)).statusCode).toBe(404);
  });

  it('does not log, and does not touch an approval, when nothing changed', async () => {
    const image = await readyImage();
    await review(image.id, { review: 'APPROVED_NEUTRAL' });
    const before = (await history(character.id)).length;

    await admin.put(`/images/${image.id}/sequence`, sequenceBody(image, 5));
    expect((await detail(image.id)).review).toBe('APPROVED_NEUTRAL');
    expect((await history(character.id)).length).toBe(before);

    // Only the remembered settings changed: still the same frames, still approved.
    const body = sequenceBody(image, 5);
    await admin.put(`/images/${image.id}/sequence`, {
      ...body,
      params: { ...body.params, zoomStart: 7 },
    });
    const after = await detail(image.id);
    expect(after.review).toBe('APPROVED_NEUTRAL');
    expect(after.sequence?.params.zoomStart).toBe(7);
    expect((await history(character.id)).length).toBe(before);
  });
});

describe('approving and rejecting', () => {
  it('starts UNVERIFIED and needs a saved sequence, whatever the approval', async () => {
    const image = await importPicture(admin, character.id);
    expect((await detail(image.id)).review).toBe('UNVERIFIED');
    for (const approval of ['APPROVED_NEUTRAL', 'APPROVED_SENSITIVE']) {
      const response = await review(image.id, { review: approval, confirm: true, note: NOTE });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: { code: 'SEQUENCE_REQUIRED' } });
    }
    expect((await detail(image.id)).approval.neutral).toEqual({
      allowed: false,
      blockers: ['SEQUENCE_REQUIRED'],
    });
  });

  it('approves for neutral modes, records who and when, and logs it', async () => {
    const image = await readyImage();
    const response = await review(image.id, { review: 'APPROVED_NEUTRAL' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<ImageDetailDto>()).toMatchObject({ review: 'APPROVED_NEUTRAL' });
    expect(response.json<ImageDetailDto>().reviewedAt).not.toBeNull();
    const row = await context.db.asset.findUniqueOrThrow({ where: { id: image.id } });
    expect(row.reviewedById).not.toBeNull();

    const entry = (await history(character.id)).find((item) => item.action === 'image.review');
    expect(entry).toMatchObject({
      adminUsername: 'admin',
      before: { review: 'UNVERIFIED' },
      after: { review: 'APPROVED_NEUTRAL' },
      restorable: false,
    });
    expect((await admin.get(`/characters/${character.id}`)).json<CharacterDto>()).toMatchObject({
      images: { approvedNeutral: 1 },
    });
  });

  it('makes the image playable in neutral modes only once approved', async () => {
    const image = await readyImage();
    expect((await checkRoundEligibility(context.db, 'zoom-out', image.id)).reasons).toEqual([
      'ASSET_NOT_APPROVED',
    ]);
    await review(image.id, { review: 'APPROVED_NEUTRAL' });
    expect((await checkRoundEligibility(context.db, 'zoom-out', image.id)).eligible).toBe(true);
    expect(
      (await admin.get(`/characters/${character.id}`)).json<CharacterDto>().usableImages[
        'zoom-out'
      ],
    ).toBe(1);
  });

  it('can reject, never plays a rejected image, and can reset it', async () => {
    await makeAdult(character.id);
    const image = await readyImage();
    await review(image.id, { review: 'APPROVED_SENSITIVE', confirm: true, note: NOTE });
    expect((await checkRoundEligibility(context.db, 'historic', image.id)).eligible).toBe(true);

    const rejected = (await review(image.id, { review: 'REJECTED' })).json<ImageDetailDto>();
    expect(rejected.review).toBe('REJECTED');
    for (const mode of ['zoom-out', 'pixelated', 'historic'] as const) {
      expect((await checkRoundEligibility(context.db, mode, image.id)).reasons, mode).toContain(
        'ASSET_REJECTED',
      );
    }
    const reset = (await review(image.id, { review: 'UNVERIFIED' })).json<ImageDetailDto>();
    expect(reset).toMatchObject({ review: 'UNVERIFIED', reviewedAt: null });
    expect((await review(image.id, { review: 'WHATEVER' })).statusCode).toBe(400);
    expect((await review('missing', { review: 'REJECTED' })).statusCode).toBe(404);
  });

  it('refuses a neutral approval for an excluded character', async () => {
    const image = await readyImage();
    await admin.put(`/characters/${character.id}/status`, { status: 'EXCLUDED' });
    expect((await detail(image.id)).approval.neutral.blockers).toEqual(['CHARACTER_EXCLUDED']);
    const response = await review(image.id, { review: 'APPROVED_NEUTRAL' });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: { code: 'APPROVAL_NOT_ALLOWED' } });
    expect((await detail(image.id)).review).toBe('UNVERIFIED');
  });

  it('keeps next-to-review in list order', async () => {
    const a = await readyImage(1);
    const b = await readyImage(2);
    const c = await readyImage(3);
    expect((await detail(c.id)).nextId).toBe(b.id);
    expect((await detail(b.id)).nextId).toBe(a.id);
    expect((await detail(a.id)).nextId).toBeNull();
    await review(b.id, { review: 'APPROVED_NEUTRAL' });
    expect((await detail(c.id)).nextId).toBe(a.id);
  });
});

describe('sensitive approval follows the whole eligibility policy', () => {
  it('needs an explicit confirmation and a written justification, after the policy', async () => {
    await makeAdult(character.id);
    const image = await readyImage();
    expect((await detail(image.id)).approval.sensitive).toEqual({ allowed: true, blockers: [] });

    const unconfirmed = await review(image.id, { review: 'APPROVED_SENSITIVE', note: NOTE });
    expect(unconfirmed.json()).toEqual({ error: { code: 'CONFIRMATION_REQUIRED' } });
    const unjustified = await review(image.id, {
      review: 'APPROVED_SENSITIVE',
      confirm: true,
      note: 'ok',
    });
    expect(unjustified.json()).toEqual({ error: { code: 'JUSTIFICATION_REQUIRED' } });
    expect((await detail(image.id)).review).toBe('UNVERIFIED');

    const approved = await review(image.id, {
      review: 'APPROVED_SENSITIVE',
      confirm: true,
      note: NOTE,
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(
      (await history(character.id)).find((item) => item.action === 'image.review')?.after,
    ).toMatchObject({ review: 'APPROVED_SENSITIVE', note: NOTE });
    expect((await checkRoundEligibility(context.db, 'historic', image.id)).eligible).toBe(true);
  });

  it.each([
    ['not a verified adult', async () => {}, 'NOT_ADULT_VERIFIED', false],
    [
      'a restricted status',
      async (id: string) => {
        await admin.put(`/characters/${id}/classification`, {
          ageClass: 'ADULT_VERIFIED',
          note: ADULT_NOTE,
          confirm: true,
        });
      },
      'STATUS_RESTRICTED',
      false,
    ],
  ])(
    'refuses it for a character with %s, even by a direct request',
    async (_label, prepare, blocker) => {
      await prepare(character.id);
      const image = await readyImage();
      expect((await detail(image.id)).approval.sensitive.blockers).toContain(blocker);
      const response = await review(image.id, {
        review: 'APPROVED_SENSITIVE',
        confirm: true,
        note: NOTE,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: { code: 'APPROVAL_NOT_ALLOWED' } });
      expect((await detail(image.id)).review).toBe('UNVERIFIED');
    },
  );

  it.each(['MINOR', 'CHILDLIKE', 'AMBIGUOUS'])(
    'refuses it for a character classified %s',
    async (ageClass) => {
      await admin.put(`/characters/${character.id}/status`, { status: 'ALLOWED' });
      await admin.put(`/characters/${character.id}/classification`, { ageClass, note: '' });
      const image = await readyImage();
      const response = await review(image.id, {
        review: 'APPROVED_SENSITIVE',
        confirm: true,
        note: NOTE,
      });
      expect(response.json()).toEqual({ error: { code: 'APPROVAL_NOT_ALLOWED' } });
    },
  );

  it('refuses it for Annie and Zoe, even if the database says they are adults', async () => {
    for (const name of ['Annie', 'Zoe']) {
      const created = (
        await admin.post('/characters', { universeId: universe.id, names: { en: name } })
      ).json<CharacterDto>();
      await admin.put(`/characters/${created.id}/status`, { status: 'ALLOWED' });
      await context.db.character.update({
        where: { id: created.id },
        data: { ageClass: 'ADULT_VERIFIED' },
      });
      const image = await importPicture(admin, created.id, { seed: name.length });
      await saveSequenceOf(admin, image, 3);
      expect((await detail(image.id)).approval.sensitive.blockers).toContain('CORE_EXCLUSION');
      const response = await review(image.id, {
        review: 'APPROVED_SENSITIVE',
        confirm: true,
        note: NOTE,
      });
      expect(response.json()).toEqual({ error: { code: 'APPROVAL_NOT_ALLOWED' } });
      // Even a forced database value cannot make the image playable.
      await context.db.asset.update({
        where: { id: image.id },
        data: { review: 'APPROVED_SENSITIVE' },
      });
      expect((await checkRoundEligibility(context.db, 'historic', image.id)).reasons).toContain(
        'CORE_EXCLUSION',
      );
    }
  });

  it('refuses it in universes that are unreviewed or young-audience and locked', async () => {
    for (const [name, audience, blocker] of [
      ['Some Game', 'UNREVIEWED', 'UNIVERSE_UNREVIEWED'],
      ['Pokémon', 'YOUTH', 'UNIVERSE_SENSITIVE_LOCKED'],
    ] as const) {
      const other = await createReviewedUniverse(admin, name, ['zoom-out'], audience);
      const created = (
        await admin.post('/characters', { universeId: other.id, names: { en: `Adult of ${name}` } })
      ).json<CharacterDto>();
      await makeAdult(created.id).catch(async () => {
        await admin.put(`/characters/${created.id}/status`, { status: 'ALLOWED' });
        await admin.put(`/characters/${created.id}/classification`, {
          ageClass: 'ADULT_VERIFIED',
          note: `${ADULT_NOTE} ${ADULT_NOTE}`,
          confirm: true,
        });
      });
      await admin.put(`/characters/${created.id}/classification`, {
        ageClass: 'ADULT_VERIFIED',
        note: `${ADULT_NOTE} ${ADULT_NOTE}`,
        confirm: true,
      });
      const image = await importPicture(admin, created.id, { seed: name.length });
      await saveSequenceOf(admin, image, 3);
      expect((await detail(image.id)).approval.sensitive.blockers, name).toContain(blocker);
      expect(
        (await review(image.id, { review: 'APPROVED_SENSITIVE', confirm: true, note: NOTE }))
          .statusCode,
        name,
      ).toBe(422);
    }
  });

  it('refuses it when the sensitive mode is disabled or blocked, and a stored approval never outlives a change', async () => {
    await makeAdult(character.id);
    const image = await readyImage();
    await review(image.id, { review: 'APPROVED_SENSITIVE', confirm: true, note: NOTE });
    expect((await checkRoundEligibility(context.db, 'historic', image.id)).eligible).toBe(true);

    // Every later change is honored at the next check, with the approval still stored.
    await admin.put(`/characters/${character.id}/blocked-modes`, { modeIds: ['historic'] });
    expect((await checkRoundEligibility(context.db, 'historic', image.id)).reasons).toEqual([
      'MODE_BLOCKED_FOR_CHARACTER',
    ]);
    await admin.put(`/characters/${character.id}/blocked-modes`, { modeIds: [] });
    await admin.put(`/characters/${character.id}/classification`, {
      ageClass: 'AMBIGUOUS',
      note: 'Doubt raised.',
    });
    expect((await checkRoundEligibility(context.db, 'historic', image.id)).reasons).toEqual([
      'NOT_ADULT_VERIFIED',
    ]);
    await makeAdult(character.id);
    await admin.put(`/universes/${universe.id}/audience`, { audience: 'UNREVIEWED' });
    expect((await checkRoundEligibility(context.db, 'historic', image.id)).reasons).toEqual([
      'MODE_DISABLED_FOR_UNIVERSE',
      'UNIVERSE_UNREVIEWED',
    ]);
    expect((await detail(image.id)).review).toBe('APPROVED_SENSITIVE');
    expect((await detail(image.id)).approval.sensitive.allowed).toBe(false);
  });
});

describe('changing the frames of an approved image', () => {
  it('withdraws the approval, and says so in the history', async () => {
    await makeAdult(character.id);
    const image = await readyImage();
    await review(image.id, { review: 'APPROVED_SENSITIVE', confirm: true, note: NOTE });

    const body = sequenceBody(image, 5);
    const moved = {
      ...body,
      steps: body.steps.map((step, index) =>
        index === 2 ? { ...step, rect: { ...step.rect, x: step.rect.x / 2 }, manual: true } : step,
      ),
    };
    const after = (await admin.put(`/images/${image.id}/sequence`, moved)).json<ImageDetailDto>();
    expect(after).toMatchObject({ review: 'UNVERIFIED', reviewedAt: null });
    expect((await checkRoundEligibility(context.db, 'historic', image.id)).reasons).toEqual([
      'ASSET_NOT_APPROVED',
    ]);

    const withdrawn = (await history(character.id)).find(
      (item) =>
        item.action === 'image.review' &&
        (item.after as { review: string }).review === 'UNVERIFIED',
    );
    expect(withdrawn?.before).toMatchObject({ review: 'APPROVED_SENSITIVE' });
  });
});

describe('deleting an image', () => {
  it('removes the record, the sequence and the files, and logs it', async () => {
    const image = await readyImage();
    expect(await listFiles(context.storageDir)).toHaveLength(3);
    expect((await admin.delete(`/images/${image.id}`)).json()).toEqual({ ok: true });

    expect(await context.db.asset.count()).toBe(0);
    expect(await context.db.sequence.count()).toBe(0);
    expect(await context.db.sequenceStep.count()).toBe(0);
    expect(await listFiles(context.storageDir)).toEqual([]);
    expect((await admin.get(`/images/${image.id}`)).statusCode).toBe(404);
    expect((await admin.get(`/images/${image.id}/file/thumb`)).statusCode).toBe(404);
    await expect(checkRoundEligibility(context.db, 'zoom-out', image.id)).rejects.toMatchObject({
      statusCode: 404,
    });

    const entry = (await history(character.id)).find((item) => item.action === 'image.delete');
    expect(entry).toMatchObject({ before: { assetId: image.id }, restorable: false });
    expect((await admin.post(`/audit/${entry?.id ?? ''}/restore`)).statusCode).toBe(422);
    expect((await admin.delete(`/images/${image.id}`)).statusCode).toBe(404);
  });
});

describe('orphan files', () => {
  it('finds files that no image points to, leaves recent ones alone, and removes them on request', async () => {
    const image = await readyImage();
    const storage = new FileStorage(context.storageDir);
    const stray = 'f'.repeat(32);
    await mkdir(path.join(context.storageDir, 'original'), { recursive: true });
    const strayPath = path.join(context.storageDir, 'original', `${stray}.webp`);
    const tempPath = path.join(context.storageDir, 'thumb', `${stray}.webp.abc123.tmp`);
    await writeFile(strayPath, 'x');
    await writeFile(tempPath, 'x');
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await utimes(strayPath, old, old);

    const dry = await pruneOrphanFiles({ db: context.db, storage }, false);
    expect(dry.orphans).toEqual([`original/${stray}.webp`]); // the recent temporary file is spared
    expect(dry.removed).toBe(0);
    expect(await listFiles(context.storageDir)).toHaveLength(5);

    const applied = await pruneOrphanFiles({ db: context.db, storage }, true, 0);
    expect(applied.orphans).toHaveLength(2);
    expect(applied.removed).toBe(2);
    // The three files of the real image stay.
    expect(await listFiles(context.storageDir)).toHaveLength(3);
    expect((await admin.get(`/images/${image.id}/file/original`)).statusCode).toBe(200);
  });
});

describe('repository safety', () => {
  it('ignores the image storage and development datasets in git', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const ignored = (file: string): boolean => {
      try {
        execFileSync('git', ['check-ignore', '-q', file], { cwd: root, stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    };
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore' });
    } catch {
      return; // git is not available: nothing to check
    }
    for (const file of [
      'apps/server/storage/original/a.webp',
      'apps/server/storage/e2e/thumb/b.webp',
      'storage/original/c.webp',
      'LoL_Female_Splasharts/Ahri/Ahri_0.jpg',
      'apps/server/LoL_Female_Splasharts/Ahri_0.jpg',
    ]) {
      expect(ignored(file), file).toBe(true);
    }
  });
});
