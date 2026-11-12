import {
  effectiveAudience,
  isPolicyYouthUniverse,
  MODE_IDS,
  MODES,
  sensitiveModesAvailable,
  slugify,
  STRICT_NOTE_MIN_LENGTH,
  type CreateUniverseRequest,
  type ModeId,
  type SetAudienceRequest,
  type UnlockSensitiveRequest,
  type UniverseAudience,
  type UniverseDto,
  type UpdateUniverseRequest,
} from '@app/shared';
import { isUniqueViolation, type Db } from '../../db';
import { AppError, conflict, invalid, notFound } from '../../errors';
import type { AuditContext } from '../audit/log';
import { writeAudit } from '../audit/log';

export interface UniverseFacet {
  readonly name: string;
  readonly enabledModes: ModeId[];
}

/** Keeps only known mode identifiers, in registry order. */
export function knownModes(modes: readonly string[]): ModeId[] {
  return MODE_IDS.filter((id) => modes.includes(id));
}

const isSensitive = (id: ModeId): boolean => MODES[id].sensitivity !== 'neutral';

interface UniverseRow {
  id: string;
  slug: string;
  name: string;
  enabledModes: string[];
  audience: UniverseAudience;
  audienceNote: string | null;
  audienceSetAt: Date | null;
  sensitiveUnlockedAt: Date | null;
  sensitiveUnlockNote: string | null;
  _count: { characters: number };
}

function toDto(row: UniverseRow): UniverseDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    enabledModes: knownModes(row.enabledModes),
    audience: effectiveAudience(row),
    audienceSetting: row.audience,
    audienceLockedByPolicy: isPolicyYouthUniverse(row),
    audienceNote: row.audienceNote,
    audienceSetAt: row.audienceSetAt?.toISOString() ?? null,
    sensitiveUnlocked: row.sensitiveUnlockedAt !== null,
    sensitiveUnlockNote: row.sensitiveUnlockNote,
    sensitiveUnlockedAt: row.sensitiveUnlockedAt?.toISOString() ?? null,
    characterCount: row._count.characters,
  };
}

/**
 * Sensitive modes can only be enabled where they are available: a universe
 * reviewed as general audience, or a young-audience one that was explicitly
 * unlocked. Never for an unreviewed universe. Checked on every write path,
 * restorations included.
 */
function assertModesAllowed(
  identity: { slug: string; name: string; audience: UniverseAudience },
  unlocked: boolean,
  modes: readonly ModeId[],
): void {
  if (
    modes.some(isSensitive) &&
    !sensitiveModesAvailable({ ...identity, sensitiveUnlocked: unlocked })
  ) {
    throw new AppError(422, 'SENSITIVE_MODE_FORBIDDEN');
  }
}

const withCount = { _count: { select: { characters: true } } } as const;

export async function listUniverses(db: Db): Promise<UniverseDto[]> {
  const rows = await db.universe.findMany({ orderBy: { name: 'asc' }, include: withCount });
  return rows.map(toDto);
}

export async function createUniverse(
  db: Db,
  context: AuditContext,
  input: CreateUniverseRequest,
): Promise<UniverseDto> {
  const slug = input.slug ?? slugify(input.name);
  if (slug === '') throw invalid();
  const enabledModes = knownModes(input.enabledModes);
  // A new universe is always UNREVIEWED and locked: reviewing it is a separate, explicit step.
  assertModesAllowed({ slug, name: input.name, audience: 'UNREVIEWED' }, false, enabledModes);

  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.universe.create({
        data: { slug, name: input.name, enabledModes },
        include: withCount,
      });
      await writeAudit(tx, context, {
        action: 'universe.create',
        entityType: 'universe',
        entityId: row.id,
        entityLabel: row.name,
        after: { slug, name: row.name, enabledModes },
      });
      return toDto(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict();
    throw error;
  }
}

export async function updateUniverse(
  db: Db,
  context: AuditContext,
  id: string,
  input: UpdateUniverseRequest,
  expected?: UniverseFacet,
): Promise<UniverseDto> {
  return db.$transaction(async (tx) => {
    const current = await tx.universe.findUnique({ where: { id } });
    if (!current) throw notFound();

    const before: UniverseFacet = {
      name: current.name,
      enabledModes: knownModes(current.enabledModes),
    };
    const after: UniverseFacet = { name: input.name, enabledModes: knownModes(input.enabledModes) };
    if (expected && JSON.stringify(expected) !== JSON.stringify(before)) {
      throw new AppError(409, 'RESTORE_CONFLICT');
    }
    // Checked against both the old and the new name: a rename cannot unlock anything.
    const unlocked = current.sensitiveUnlockedAt !== null;
    const { audience } = current;
    assertModesAllowed(
      { slug: current.slug, name: current.name, audience },
      unlocked,
      after.enabledModes,
    );
    assertModesAllowed(
      { slug: current.slug, name: after.name, audience },
      unlocked,
      after.enabledModes,
    );

    const row = await tx.universe.update({ where: { id }, data: after, include: withCount });
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await writeAudit(tx, context, {
        action: 'universe.update',
        entityType: 'universe',
        entityId: id,
        entityLabel: row.name,
        before: { ...before },
        after: { ...after },
      });
    }
    return toDto(row);
  });
}

/**
 * Records the audience review of a universe.
 *
 * Stricter classifications (YOUTH, UNREVIEWED) apply at once: every sensitive
 * mode is switched off and any unlock is cleared, so that a later, more
 * permissive classification never silently re-activates a mode. GENERAL is the
 * permissive direction: it needs a confirmation and a long written
 * justification, and is refused for universes the code fixes as young-audience.
 * Never restorable.
 */
export async function setAudience(
  db: Db,
  context: AuditContext,
  id: string,
  input: SetAudienceRequest,
): Promise<UniverseDto> {
  return db.$transaction(async (tx) => {
    const current = await tx.universe.findUnique({ where: { id } });
    if (!current) throw notFound();

    const target = input.audience;
    if (target === 'GENERAL' && isPolicyYouthUniverse(current)) {
      throw new AppError(422, 'AUDIENCE_FORBIDDEN');
    }
    if (target === current.audience) return toDto({ ...current, ...(await count(tx, id)) });
    if (target === 'GENERAL') {
      if (input.confirm !== true) throw new AppError(422, 'CONFIRMATION_REQUIRED');
      if (input.note.length < STRICT_NOTE_MIN_LENGTH) {
        throw new AppError(422, 'JUSTIFICATION_REQUIRED');
      }
    }

    const previousModes = knownModes(current.enabledModes);
    // A reviewed-general universe keeps whatever is enabled; every other target starts clean.
    const enabledModes =
      target === 'GENERAL' ? previousModes : previousModes.filter((modeId) => !isSensitive(modeId));
    const row = await tx.universe.update({
      where: { id },
      data: {
        audience: target,
        audienceNote: input.note === '' ? null : input.note,
        audienceSetAt: new Date(),
        audienceSetById: context.adminId,
        enabledModes,
        sensitiveUnlockedAt: null,
        sensitiveUnlockNote: null,
        sensitiveUnlockedById: null,
      },
      include: withCount,
    });
    await writeAudit(tx, context, {
      action: 'universe.audience',
      entityType: 'universe',
      entityId: id,
      entityLabel: row.name,
      before: {
        audience: current.audience,
        unlocked: current.sensitiveUnlockedAt !== null,
        enabledModes: previousModes,
      },
      after: { audience: target, note: input.note, unlocked: false, enabledModes },
    });
    return toDto(row);
  });
}

/**
 * Unlocks sensitive modes for a universe with a young audience. Deliberately
 * heavy: explicit confirmation, a long written justification, one universe at
 * a time, logged, and never restorable. It enables no mode by itself, and it
 * changes nothing about individual characters or images.
 */
export async function unlockSensitive(
  db: Db,
  context: AuditContext,
  id: string,
  input: UnlockSensitiveRequest,
): Promise<UniverseDto> {
  return db.$transaction(async (tx) => {
    const current = await tx.universe.findUnique({ where: { id } });
    if (!current) throw notFound();
    // Only a young-audience universe can be unlocked; an unreviewed one must be reviewed first.
    if (effectiveAudience(current) !== 'YOUTH') throw invalid();
    if (current.sensitiveUnlockedAt !== null) throw conflict();
    if (input.confirm !== true) throw new AppError(422, 'CONFIRMATION_REQUIRED');
    if (input.note.length < STRICT_NOTE_MIN_LENGTH) {
      throw new AppError(422, 'JUSTIFICATION_REQUIRED');
    }

    const row = await tx.universe.update({
      where: { id },
      data: {
        sensitiveUnlockedAt: new Date(),
        sensitiveUnlockNote: input.note,
        sensitiveUnlockedById: context.adminId,
      },
      include: withCount,
    });
    await writeAudit(tx, context, {
      action: 'universe.sensitive-unlock',
      entityType: 'universe',
      entityId: id,
      entityLabel: row.name,
      before: { unlocked: false },
      after: { unlocked: true, note: input.note },
    });
    return toDto(row);
  });
}

/**
 * Locks sensitive modes again (the safe direction: no confirmation needed) and
 * switches every sensitive mode off for the universe in the same step.
 */
export async function lockSensitive(
  db: Db,
  context: AuditContext,
  id: string,
): Promise<UniverseDto> {
  return db.$transaction(async (tx) => {
    const current = await tx.universe.findUnique({ where: { id } });
    if (!current) throw notFound();
    if (current.sensitiveUnlockedAt === null)
      return toDto({ ...current, ...(await count(tx, id)) });

    const enabledModes = knownModes(current.enabledModes).filter((modeId) => !isSensitive(modeId));
    const row = await tx.universe.update({
      where: { id },
      data: {
        enabledModes,
        sensitiveUnlockedAt: null,
        sensitiveUnlockNote: null,
        sensitiveUnlockedById: null,
      },
      include: withCount,
    });
    await writeAudit(tx, context, {
      action: 'universe.sensitive-lock',
      entityType: 'universe',
      entityId: id,
      entityLabel: row.name,
      before: { unlocked: true, enabledModes: knownModes(current.enabledModes) },
      after: { unlocked: false, enabledModes },
    });
    return toDto(row);
  });
}

async function count(
  tx: { character: { count: (args: { where: { universeId: string } }) => Promise<number> } },
  universeId: string,
): Promise<{ _count: { characters: number } }> {
  return { _count: { characters: await tx.character.count({ where: { universeId } }) } };
}
