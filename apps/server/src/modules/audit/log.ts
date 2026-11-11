import type { AuditAction } from '@app/shared';
import type { Prisma } from '../../generated/prisma/client';

export interface AuditContext {
  readonly adminId: string;
  /** Groups the entries of one bulk operation. */
  readonly batchId?: string;
  /** Identifier of the entry being restored, when the change is a restoration. */
  readonly revertsId?: string;
}

export interface AuditRecord {
  readonly action: AuditAction;
  readonly entityType: 'universe' | 'character';
  readonly entityId: string;
  readonly entityLabel: string;
  readonly before?: Prisma.InputJsonValue;
  readonly after?: Prisma.InputJsonValue;
}

/** Appends a history entry inside the transaction that performs the change. */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  context: AuditContext,
  record: AuditRecord,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      adminId: context.adminId,
      batchId: context.batchId ?? null,
      revertsId: context.revertsId ?? null,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId,
      entityLabel: record.entityLabel,
      ...(record.before === undefined ? {} : { before: record.before }),
      ...(record.after === undefined ? {} : { after: record.after }),
    },
  });
  if (context.revertsId !== undefined) {
    await tx.auditLog.update({
      where: { id: context.revertsId },
      data: { revertedAt: new Date() },
    });
  }
}

/** Order-insensitive JSON form, used to compare stored snapshots with current state. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}
