import {
  aspectRatio,
  challengeEligibility,
  checkSteps,
  isCompositeMode,
  MODE_IDS,
  MODES,
  sequenceParamsSchema,
  SENSITIVE_APPROVAL_NOTE_MIN_LENGTH,
  SEQUENCE_MODE,
  type ApprovalBlocker,
  type ApprovalCheckDto,
  type ImageDetailDto,
  type ImageDto,
  type ImageListQuery,
  type ImageFileKind,
  type Page,
  type ReviewImageRequest,
  type SaveSequenceRequest,
  type SequenceDto,
} from '@app/shared';
import type { ReadStream } from 'node:fs';
import { isUniqueViolation, type Db } from '../../db';
import { AppError, notFound } from '../../errors';
import type { Prisma } from '../../generated/prisma/client';
import { canonical, writeAudit, type AuditContext } from '../audit/log';
import {
  characterNames,
  eligibilityInputs,
  loadRow,
  type Row,
} from '../catalog/characters.service';
import {
  ImageRejected,
  labelFromFilename,
  processUpload,
  sha256Of,
  type ImageLimits,
} from './processing';
import { FileStorage, newStorageKey } from './storage';
import type { AppConfig } from '../../config';

export interface ImageDeps {
  readonly db: Db;
  readonly storage: FileStorage;
  readonly limits: ImageLimits;
  /** Runs an image task, at most `IMAGE_CONCURRENCY` at a time. */
  readonly limiter: <T>(task: () => Promise<T>) => Promise<T>;
  readonly warn: (details: unknown, message: string) => void;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const withCharacter = {
  character: { include: { labels: true, universe: { select: { name: true } } } },
  sequences: {
    where: { modeId: SEQUENCE_MODE },
    orderBy: { createdAt: 'asc' },
    take: 1,
    select: { _count: { select: { steps: true } } },
  },
} satisfies Prisma.AssetInclude;

type AssetWithCharacter = Prisma.AssetGetPayload<{ include: typeof withCharacter }>;

function toDto(asset: AssetWithCharacter): ImageDto {
  const stepCount = asset.sequences[0]?._count.steps ?? 0;
  return {
    id: asset.id,
    characterId: asset.characterId,
    characterNames: characterNames(asset.character),
    universeName: asset.character.universe.name,
    label: asset.label,
    width: asset.width,
    height: asset.height,
    bytes: asset.bytes,
    sourceFormat: asset.sourceFormat,
    review: asset.review,
    reviewedAt: asset.reviewedAt?.toISOString() ?? null,
    hasSequence: stepCount > 0,
    stepCount,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

async function characterLabel(db: Pick<Db, 'character'>, characterId: string): Promise<string> {
  const character = await db.character.findUnique({
    where: { id: characterId },
    include: { labels: true },
  });
  if (!character) throw notFound();
  return characterNames(character).en;
}

// ---------------------------------------------------------------------------
// Approval rules
// ---------------------------------------------------------------------------

const SENSITIVE_MODES = MODE_IDS.filter(
  (id) => MODES[id].sensitivity !== 'neutral' && !isCompositeMode(id),
);

/**
 * What an approval would require right now, from the stored data:
 * - any approval needs a saved sequence (the approval covers its frames);
 * - a neutral approval needs a character that is not excluded;
 * - a sensitive approval needs the FULL eligibility of the character for at
 *   least one sensitive mode: universe classification, individual
 *   classification, fundamental exclusions, status, enabled and unblocked mode.
 * The same function answers the interface and guards the server.
 */
export function approvalChecks(
  row: Row,
  hasSequence: boolean,
): { neutral: ApprovalCheckDto; sensitive: ApprovalCheckDto } {
  const { universe, character } = eligibilityInputs(row);

  const neutral: ApprovalBlocker[] = [];
  if (!hasSequence) neutral.push('SEQUENCE_REQUIRED');
  if (character.status === 'EXCLUDED') neutral.push('CHARACTER_EXCLUDED');

  const sensitive: ApprovalBlocker[] = [];
  if (!hasSequence) sensitive.push('SEQUENCE_REQUIRED');
  const results = SENSITIVE_MODES.map((modeId) =>
    challengeEligibility(modeId, universe, character, { review: 'APPROVED_SENSITIVE' }),
  );
  if (!results.some((result) => result.eligible)) {
    const closest = results.reduce((best, result) =>
      result.reasons.length < best.reasons.length ? result : best,
    );
    sensitive.push(...closest.reasons);
  }

  return {
    neutral: { allowed: neutral.length === 0, blockers: neutral },
    sensitive: { allowed: sensitive.length === 0, blockers: sensitive },
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listImages(db: Db, query: ImageListQuery): Promise<Page<ImageDto>> {
  const where: Prisma.AssetWhereInput = {
    ...(query.characterId === undefined ? {} : { characterId: query.characterId }),
    ...(query.review === undefined ? {} : { review: query.review }),
  };
  const [total, rows] = await Promise.all([
    db.asset.count({ where }),
    db.asset.findMany({
      where,
      include: withCharacter,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { items: rows.map(toDto), total, page: query.page, pageSize: query.pageSize };
}

function toSequenceDto(
  sequence: Prisma.SequenceGetPayload<{ include: { steps: true } }>,
): SequenceDto {
  const params = sequenceParamsSchema.safeParse(sequence.params);
  return {
    modeId: SEQUENCE_MODE,
    aspect: { w: sequence.aspectW, h: sequence.aspectH },
    params: params.success
      ? params.data
      : { focus: { x: 0.5, y: 0.5 }, steps: sequence.steps.length, zoomStart: 6, zoomEnd: 1 },
    steps: sequence.steps.map((step) => ({
      name: step.name,
      rect: { x: step.x, y: step.y, w: step.w, h: step.h },
      manual: step.manual,
    })),
    updatedAt: sequence.updatedAt.toISOString(),
  };
}

async function findSequence(db: Pick<Db, 'sequence' | 'sequenceStep'>, assetId: string) {
  const sequence = await db.sequence.findFirst({
    where: { assetId, modeId: SEQUENCE_MODE },
    orderBy: { createdAt: 'asc' },
  });
  if (!sequence) return null;
  const steps = await db.sequenceStep.findMany({
    where: { sequenceId: sequence.id },
    orderBy: { position: 'asc' },
  });
  return { ...sequence, steps };
}

export async function getImage(db: Db, id: string): Promise<ImageDetailDto> {
  const asset = await db.asset.findUnique({ where: { id }, include: withCharacter });
  if (!asset) throw notFound();
  const sequence = await findSequence(db, id);
  const row = await loadRow(db, asset.characterId);
  const next = await db.asset.findFirst({
    where: {
      review: 'UNVERIFIED',
      OR: [
        { createdAt: { lt: asset.createdAt } },
        { createdAt: asset.createdAt, id: { lt: asset.id } },
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  return {
    ...toDto(asset),
    sequence: sequence ? toSequenceDto(sequence) : null,
    approval: approvalChecks(row, (sequence?.steps.length ?? 0) > 0),
    nextId: next?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const REJECTION_STATUS: Record<string, number> = { TOO_BIG: 422 };

/**
 * Imports one illustration for a character: validated by decoding it,
 * normalized, stored, then recorded. Either everything is in place or nothing
 * is: a failure removes the files it wrote, and the same file is never
 * recorded twice for one character. The image starts `UNVERIFIED`.
 */
export async function importImage(
  deps: ImageDeps,
  context: AuditContext,
  characterId: string,
  file: { readonly filename: string; readonly bytes: Buffer },
): Promise<ImageDto> {
  const { db, storage } = deps;
  const character = await db.character.findUnique({
    where: { id: characterId },
    select: { id: true },
  });
  if (!character) throw notFound();

  // Cheap duplicate check before any expensive work.
  const sha256 = sha256Of(file.bytes);
  if (await db.asset.findUnique({ where: { characterId_sha256: { characterId, sha256 } } })) {
    throw new AppError(409, 'DUPLICATE_IMAGE');
  }

  let processed;
  try {
    processed = await deps.limiter(() => processUpload(file.bytes, deps.limits));
  } catch (error) {
    if (error instanceof ImageRejected) {
      throw new AppError(REJECTION_STATUS[error.reason] ?? 422, 'INVALID_IMAGE');
    }
    throw error;
  }

  const key = newStorageKey();
  try {
    await Promise.all([
      storage.write('original', key, processed.original),
      storage.write('display', key, processed.display),
      storage.write('thumb', key, processed.thumb),
    ]);
    const created = await db.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          characterId,
          label: labelFromFilename(file.filename),
          storageKey: key,
          sha256,
          sourceFormat: processed.sourceFormat,
          width: processed.width,
          height: processed.height,
          bytes: processed.original.length,
        },
      });
      await writeAudit(tx, context, {
        action: 'image.import',
        entityType: 'character',
        entityId: characterId,
        entityLabel: await characterLabel(tx, characterId),
        after: {
          assetId: asset.id,
          label: asset.label,
          width: asset.width,
          height: asset.height,
          sourceFormat: asset.sourceFormat,
        },
      });
      return asset;
    });
    return (await getImage(db, created.id)) satisfies ImageDto;
  } catch (error) {
    // Nothing is recorded: do not leave files behind.
    await storage.remove(key).catch((cleanup: unknown) => {
      deps.warn({ err: cleanup }, 'could not remove files of a failed import');
    });
    if (isUniqueViolation(error)) throw new AppError(409, 'DUPLICATE_IMAGE');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Sequence
// ---------------------------------------------------------------------------

const sameContent = (
  existing: {
    aspectW: number;
    aspectH: number;
    steps: { name: string | null; x: number; y: number; w: number; h: number; manual: boolean }[];
  },
  next: SaveSequenceRequest,
): boolean =>
  canonical([
    existing.aspectW,
    existing.aspectH,
    existing.steps.map((s) => [s.name, s.x, s.y, s.w, s.h, s.manual]),
  ]) ===
  canonical([
    next.aspect.w,
    next.aspect.h,
    next.steps.map((s) => [
      s.name === '' ? null : s.name,
      s.rect.x,
      s.rect.y,
      s.rect.w,
      s.rect.h,
      s.manual,
    ]),
  ]);

/**
 * Saves the whole sequence of an image. Every frame is checked again here
 * (bounds, ratio, minimum size, count): the browser's checks are never trusted.
 * Changing the frames of an approved image withdraws its approval, because an
 * approval covers the frames that were reviewed.
 */
export async function saveSequence(
  deps: ImageDeps,
  context: AuditContext,
  assetId: string,
  input: SaveSequenceRequest,
): Promise<ImageDetailDto> {
  const { db } = deps;
  await db.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw notFound();

    const check = checkSteps(
      input.steps.map((step) => ({ name: step.name, rect: step.rect })),
      { width: asset.width, height: asset.height },
      aspectRatio(input.aspect),
    );
    if (!check.ok) throw new AppError(422, 'INVALID_SEQUENCE');

    const existing = await findSequence(tx, assetId);
    const changed = !existing || !sameContent(existing, input);
    const stepRows = input.steps.map((step, position) => ({
      position,
      name: step.name === '' ? null : step.name,
      x: step.rect.x,
      y: step.rect.y,
      w: step.rect.w,
      h: step.rect.h,
      manual: step.manual,
    }));

    let sequenceId = existing?.id;
    if (!existing) {
      const created = await tx.sequence.create({
        data: {
          assetId,
          modeId: SEQUENCE_MODE,
          aspectW: input.aspect.w,
          aspectH: input.aspect.h,
          params: input.params,
        },
      });
      sequenceId = created.id;
    } else {
      await tx.sequence.update({
        where: { id: existing.id },
        data: { aspectW: input.aspect.w, aspectH: input.aspect.h, params: input.params },
      });
    }
    if (sequenceId === undefined) throw new Error('sequence id missing');

    if (changed) {
      await tx.sequenceStep.deleteMany({ where: { sequenceId } });
      await tx.sequenceStep.createMany({ data: stepRows.map((row) => ({ ...row, sequenceId })) });
    }
    if (!changed) return;

    const approved = asset.review === 'APPROVED_NEUTRAL' || asset.review === 'APPROVED_SENSITIVE';
    await tx.asset.update({
      where: { id: assetId },
      data: {
        updatedAt: new Date(),
        ...(approved ? { review: 'UNVERIFIED', reviewedAt: null, reviewedById: null } : {}),
      },
    });
    const label = await characterLabel(tx, asset.characterId);
    await writeAudit(tx, context, {
      action: 'image.sequence',
      entityType: 'character',
      entityId: asset.characterId,
      entityLabel: label,
      before: { assetId, steps: existing?.steps.length ?? 0 },
      after: {
        assetId,
        steps: stepRows.length,
        aspect: `${input.aspect.w}:${input.aspect.h}`,
        manualSteps: stepRows.filter((row) => row.manual).length,
      },
    });
    if (approved) {
      await writeAudit(tx, context, {
        action: 'image.review',
        entityType: 'character',
        entityId: asset.characterId,
        entityLabel: label,
        before: { assetId, review: asset.review },
        after: { assetId, review: 'UNVERIFIED', note: 'Frames changed: approval withdrawn.' },
      });
    }
  });
  return getImage(db, assetId);
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/**
 * Approves, rejects or resets an image. Every condition is re-evaluated here
 * from the stored data, whatever the browser showed: an approval for sensitive
 * modes cannot get around the universe classification, the individual
 * classification, the fundamental exclusions or a disabled or blocked mode.
 * Rejecting and resetting are always allowed (the stricter directions).
 */
export async function reviewImage(
  deps: ImageDeps,
  context: AuditContext,
  assetId: string,
  input: ReviewImageRequest,
): Promise<ImageDetailDto> {
  const { db } = deps;
  await db.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw notFound();
    if (asset.review === input.review) return;

    const approving = input.review === 'APPROVED_NEUTRAL' || input.review === 'APPROVED_SENSITIVE';
    if (approving) {
      const sequence = await findSequence(tx, assetId);
      const hasSequence = (sequence?.steps.length ?? 0) > 0;
      if (!hasSequence) throw new AppError(422, 'SEQUENCE_REQUIRED');
      const checks = approvalChecks(await loadRow(tx, asset.characterId), hasSequence);
      const check = input.review === 'APPROVED_SENSITIVE' ? checks.sensitive : checks.neutral;
      if (!check.allowed) throw new AppError(422, 'APPROVAL_NOT_ALLOWED');
      if (input.review === 'APPROVED_SENSITIVE') {
        if (input.confirm !== true) throw new AppError(422, 'CONFIRMATION_REQUIRED');
        if (input.note.length < SENSITIVE_APPROVAL_NOTE_MIN_LENGTH) {
          throw new AppError(422, 'JUSTIFICATION_REQUIRED');
        }
      }
    }

    await tx.asset.update({
      where: { id: assetId },
      data: {
        review: input.review,
        reviewedAt: input.review === 'UNVERIFIED' ? null : new Date(),
        reviewedById: input.review === 'UNVERIFIED' ? null : context.adminId,
      },
    });
    await writeAudit(tx, context, {
      action: 'image.review',
      entityType: 'character',
      entityId: asset.characterId,
      entityLabel: await characterLabel(tx, asset.characterId),
      before: { assetId, review: asset.review },
      after: { assetId, review: input.review, ...(input.note === '' ? {} : { note: input.note }) },
    });
  });
  return getImage(db, assetId);
}

// ---------------------------------------------------------------------------
// Delete, files, orphans
// ---------------------------------------------------------------------------

/** Deletes the image, its sequences and its files. Logged; never restorable. */
export async function deleteImage(
  deps: ImageDeps,
  context: AuditContext,
  assetId: string,
): Promise<void> {
  const { db, storage } = deps;
  const key = await db.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw notFound();
    await tx.asset.delete({ where: { id: assetId } });
    await writeAudit(tx, context, {
      action: 'image.delete',
      entityType: 'character',
      entityId: asset.characterId,
      entityLabel: await characterLabel(tx, asset.characterId),
      before: {
        assetId,
        label: asset.label,
        review: asset.review,
        width: asset.width,
        height: asset.height,
      },
    });
    return asset.storageKey;
  });
  // The record is gone for good: remove the files. A failure leaves orphans for `pruneOrphanFiles`.
  await storage.remove(key).catch((error: unknown) => {
    deps.warn({ err: error }, 'could not remove files of a deleted image');
  });
}

export interface OpenedFile {
  readonly stream: ReadStream;
  readonly size: number;
  readonly etag: string;
}

export async function openImageFile(
  deps: ImageDeps,
  id: string,
  kind: ImageFileKind,
): Promise<OpenedFile> {
  const asset = await deps.db.asset.findUnique({ where: { id }, select: { storageKey: true } });
  if (!asset) throw notFound();
  try {
    const size = await deps.storage.size(kind, asset.storageKey);
    return {
      stream: deps.storage.open(kind, asset.storageKey),
      size,
      etag: `"${kind}-${asset.storageKey}"`,
    };
  } catch {
    throw notFound();
  }
}

export interface PruneResult {
  readonly orphans: readonly string[];
  readonly removed: number;
}

/**
 * Finds the files that no image points to (left by a crash between writing
 * and recording, or by a failed cleanup) and removes them when `apply` is set.
 * Files younger than `minAgeMs` are left alone: they may belong to an import in progress.
 */
export async function pruneOrphanFiles(
  deps: Pick<ImageDeps, 'db' | 'storage'>,
  apply: boolean,
  minAgeMs = 10 * 60 * 1000,
): Promise<PruneResult> {
  const keys = new Set(
    (await deps.db.asset.findMany({ select: { storageKey: true } })).map(
      (asset) => asset.storageKey,
    ),
  );
  const cutoff = Date.now() - minAgeMs;
  const orphans = (await deps.storage.list()).filter((file) => {
    const match = /^([a-f0-9]{32})\.webp$/.exec(file.name);
    const referenced = match?.[1] !== undefined && keys.has(match[1]);
    return !referenced && file.modifiedMs <= cutoff;
  });
  let removed = 0;
  if (apply) {
    for (const file of orphans) {
      await deps.storage.removeByName(file.kind, file.name);
      removed += 1;
    }
  }
  return { orphans: orphans.map((file) => `${file.kind}/${file.name}`), removed };
}

export function createImageDeps(
  db: Db,
  config: AppConfig,
  limiter: ImageDeps['limiter'],
  warn: ImageDeps['warn'],
): ImageDeps {
  return {
    db,
    storage: new FileStorage(config.STORAGE_DIR),
    limits: { maxPixels: config.IMAGE_MAX_PIXELS, minSide: config.IMAGE_MIN_SIDE },
    limiter,
    warn,
  };
}
