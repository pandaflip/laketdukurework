import {
  ageClassSchema,
  AUDIT_ACTIONS,
  characterStatusSchema,
  localizedNamesSchema,
  modeIdSchema,
  type AuditAction,
  type AuditEntryDto,
  type AuditListQuery,
  type BatchRestoreResultDto,
  type Page,
} from '@app/shared';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../../db';
import { AppError, notFound } from '../../errors';
import type { AuditLog } from '../../generated/prisma/client';
import {
  setBlockedModes,
  setClassification,
  setStatus,
  updateLabels,
} from '../catalog/characters.service';
import { updateUniverse } from '../catalog/universes.service';
import type { AuditContext } from './log';

// Stored snapshots are re-validated before being applied again.
const aliasList = z.array(z.string());
const snapshots = {
  status: z.object({ status: characterStatusSchema }),
  classification: z.object({ ageClass: ageClassSchema, note: z.string().nullable() }),
  blockedModes: z.object({ modeIds: z.array(modeIdSchema) }),
  labels: z.object({
    names: localizedNamesSchema,
    aliases: z.object({ en: aliasList, fr: aliasList, 'pt-BR': aliasList }),
  }),
  universe: z.object({ name: z.string(), enabledModes: z.array(modeIdSchema) }),
};

const RESTORABLE_ACTIONS: readonly AuditAction[] = [
  'universe.update',
  'character.labels',
  'character.status',
  'character.classification',
  'character.blocked-modes',
];

const notAllowed = (): AppError => new AppError(422, 'RESTORE_NOT_ALLOWED');

function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/**
 * A restoration re-applies the "before" snapshot through the normal services,
 * so every validation runs again. Two extra guards apply:
 * - restoring can never grant `ADULT_VERIFIED`: that always goes through the
 *   explicit classification form (confirmation + justification);
 * - an entry can only be restored while the data still matches its "after"
 *   snapshot (checked by the services), so newer changes are never overwritten.
 */
function restorableNow(entry: AuditLog): boolean {
  if (!isAuditAction(entry.action) || !RESTORABLE_ACTIONS.includes(entry.action)) return false;
  if (entry.revertedAt !== null || entry.before === null || entry.after === null) return false;
  if (entry.action === 'character.classification') {
    const before = snapshots.classification.safeParse(entry.before);
    return before.success && before.data.ageClass !== 'ADULT_VERIFIED';
  }
  return true;
}

function toDto(entry: AuditLog & { admin: { username: string } }): AuditEntryDto {
  return {
    id: entry.id,
    action: isAuditAction(entry.action) ? entry.action : 'character.create',
    entityType: entry.entityType === 'universe' ? 'universe' : 'character',
    entityId: entry.entityId,
    entityLabel: entry.entityLabel,
    adminUsername: entry.admin.username,
    batchId: entry.batchId,
    before: entry.before,
    after: entry.after,
    revertsId: entry.revertsId,
    revertedAt: entry.revertedAt?.toISOString() ?? null,
    restorable: restorableNow(entry),
    createdAt: entry.createdAt.toISOString(),
  };
}

export async function listAudit(db: Db, query: AuditListQuery): Promise<Page<AuditEntryDto>> {
  const where = query.entityId === undefined ? {} : { entityId: query.entityId };
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      include: { admin: { select: { username: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { items: rows.map(toDto), total, page: query.page, pageSize: query.pageSize };
}

async function restoreEntry(db: Db, context: AuditContext, entry: AuditLog): Promise<void> {
  if (!restorableNow(entry)) throw notAllowed();
  const restoreContext: AuditContext = { ...context, revertsId: entry.id };

  switch (entry.action as AuditAction) {
    case 'character.status': {
      const before = snapshots.status.parse(entry.before);
      const after = snapshots.status.parse(entry.after);
      await setStatus(db, restoreContext, entry.entityId, before.status, after);
      return;
    }
    case 'character.classification': {
      const before = snapshots.classification.parse(entry.before);
      const after = snapshots.classification.parse(entry.after);
      if (before.ageClass === 'ADULT_VERIFIED') throw notAllowed();
      await setClassification(
        db,
        restoreContext,
        entry.entityId,
        { ageClass: before.ageClass, note: before.note ?? '' },
        after,
      );
      return;
    }
    case 'character.blocked-modes': {
      const before = snapshots.blockedModes.parse(entry.before);
      const after = snapshots.blockedModes.parse(entry.after);
      await setBlockedModes(db, restoreContext, entry.entityId, before.modeIds, after);
      return;
    }
    case 'character.labels': {
      const before = snapshots.labels.parse(entry.before);
      const after = snapshots.labels.parse(entry.after);
      await updateLabels(db, restoreContext, entry.entityId, before, after);
      return;
    }
    case 'universe.update': {
      const before = snapshots.universe.parse(entry.before);
      const after = snapshots.universe.parse(entry.after);
      await updateUniverse(db, restoreContext, entry.entityId, before, after);
      return;
    }
    default:
      throw notAllowed();
  }
}

export async function restoreAuditEntry(db: Db, context: AuditContext, id: string): Promise<void> {
  const entry = await db.auditLog.findUnique({ where: { id } });
  if (!entry) throw notFound();
  await restoreEntry(db, context, entry);
}

/** Restores every entry of a bulk operation that is still restorable; skips the others. */
export async function restoreAuditBatch(
  db: Db,
  context: AuditContext,
  batchId: string,
): Promise<BatchRestoreResultDto> {
  const entries = await db.auditLog.findMany({ where: { batchId }, orderBy: { createdAt: 'asc' } });
  if (entries.length === 0) throw notFound();

  const restoreContext: AuditContext = { ...context, batchId: randomUUID() };
  let restored = 0;
  let skipped = 0;
  for (const entry of entries) {
    try {
      await restoreEntry(db, restoreContext, entry);
      restored += 1;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      skipped += 1;
    }
  }
  return { restored, skipped };
}
