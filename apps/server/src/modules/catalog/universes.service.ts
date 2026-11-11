import {
  isNeverSensitiveUniverse,
  MODE_IDS,
  MODES,
  slugify,
  type CreateUniverseRequest,
  type ModeId,
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

function toDto(row: {
  id: string;
  slug: string;
  name: string;
  enabledModes: string[];
  _count: { characters: number };
}): UniverseDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    enabledModes: knownModes(row.enabledModes),
    neverSensitive: isNeverSensitiveUniverse(row),
    characterCount: row._count.characters,
  };
}

/** A fundamentally "never sensitive" universe cannot enable a sensitive mode. */
function assertModesAllowed(identity: { slug: string; name: string }, modes: readonly ModeId[]) {
  const wantsSensitive = modes.some((id) => MODES[id].sensitivity !== 'neutral');
  if (wantsSensitive && isNeverSensitiveUniverse(identity)) {
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
  assertModesAllowed({ slug, name: input.name }, enabledModes);

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
    assertModesAllowed({ slug: current.slug, name: current.name }, after.enabledModes);
    assertModesAllowed({ slug: current.slug, name: after.name }, after.enabledModes);

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
