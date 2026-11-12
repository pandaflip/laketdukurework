import type { AuditEntryDto } from '@app/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Notice } from '../design/ui';
import { currentLocale } from '../i18n';
import { adminApi } from '../lib/api';
import { ErrorNotice, useAdminMutation } from './shared';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Compact, human-readable rendering of a stored "before" or "after" value. */
function useSummarize(): (entry: AuditEntryDto, value: unknown) => string {
  const { t } = useTranslation('admin');
  return (entry, value) => {
    if (!isRecord(value)) return t('history.none');
    switch (entry.action) {
      case 'character.status':
        return t(`status.${String(value.status)}.label`, { defaultValue: String(value.status) });
      case 'character.classification':
        return t(`ageClass.${String(value.ageClass)}`, { defaultValue: String(value.ageClass) });
      case 'character.blocked-modes':
        return Array.isArray(value.modeIds) && value.modeIds.length > 0
          ? value.modeIds.join(', ')
          : t('history.none');
      case 'image.import':
        return text(value.label);
      case 'image.sequence':
        return t('images.historySteps', { count: Number(value.steps ?? 0) });
      case 'image.review':
        return t(`images.reviewStates.${String(value.review)}`, {
          defaultValue: String(value.review),
        });
      case 'image.delete':
        return text(value.label);
      case 'universe.audience':
        return t(`universes.audience.${String(value.audience)}`, {
          defaultValue: String(value.audience),
        });
      case 'universe.sensitive-unlock':
      case 'universe.sensitive-lock':
        return t(value.unlocked === true ? 'universes.unlocked' : 'universes.locked');
      case 'universe.create':
      case 'universe.update':
        return `${String(value.name)} · ${Array.isArray(value.enabledModes) ? value.enabledModes.join(', ') : ''}`;
      default: {
        const names = isRecord(value.names) ? Object.values(value.names).join(' / ') : '';
        const aliases = isRecord(value.aliases)
          ? Object.values(value.aliases).flat().join(', ')
          : '';
        return [names, aliases].filter((part) => part !== '').join(' · ') || t('history.none');
      }
    }
  };
}

/** History of administrative changes, optionally limited to one character or universe. */
export function AuditList({ entityId }: { entityId?: string }) {
  const { t } = useTranslation('admin');
  const [page, setPage] = useState(1);
  const params = { ...(entityId === undefined ? {} : { entityId }), page };
  const audit = useQuery({
    queryKey: ['admin', 'audit', params],
    queryFn: () => adminApi.audit(params),
    placeholderData: keepPreviousData,
  });
  const restore = useAdminMutation(adminApi.restore);
  const restoreBatch = useAdminMutation(adminApi.restoreBatch);
  const summarize = useSummarize();
  const formatDate = new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: 'short',
    timeStyle: 'medium',
  });

  const items = audit.data?.items ?? [];
  const pageCount = Math.max(1, Math.ceil((audit.data?.total ?? 0) / (audit.data?.pageSize ?? 50)));
  const busy = restore.isPending || restoreBatch.isPending;

  return (
    <div className="space-y-3">
      <ErrorNotice error={audit.error} />
      <ErrorNotice error={restore.error} />
      <ErrorNotice error={restoreBatch.error} />
      {restoreBatch.data && (
        <Notice tone="success">
          {t('history.batchRestored', {
            restored: restoreBatch.data.restored,
            skipped: restoreBatch.data.skipped,
          })}
        </Notice>
      )}
      {audit.isSuccess && items.length === 0 && (
        <p className="text-sm text-fg-muted">{t('history.empty')}</p>
      )}
      <ul className="divide-y divide-line">
        {items.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm"
            data-action={entry.action}
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t(`history.actions.${entry.action}`)}</span>
                <span className="text-fg-soft">{entry.entityLabel}</span>
                {entry.revertsId !== null && <Badge>{t('history.isRestoration')}</Badge>}
                {entry.revertedAt !== null && <Badge tone="warning">{t('history.restored')}</Badge>}
                {entry.batchId !== null && <Badge>{t('history.bulk')}</Badge>}
              </div>
              {(entry.before !== null || entry.after !== null) && (
                <p className="break-words text-fg-muted">
                  {summarize(entry, entry.before)} → {summarize(entry, entry.after)}
                </p>
              )}
              <p className="text-xs text-fg-muted">
                {formatDate.format(new Date(entry.createdAt))} · {entry.adminUsername}
              </p>
            </div>
            {entry.restorable && (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() => {
                    restore.mutate(entry.id);
                  }}
                >
                  {t('history.restore')}
                </Button>
                {entry.batchId !== null && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      if (entry.batchId !== null) restoreBatch.mutate(entry.batchId);
                    }}
                  >
                    {t('history.restoreBatch')}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-fg-muted">
          <Button
            disabled={page <= 1}
            onClick={() => {
              setPage(page - 1);
            }}
          >
            {t('pagination.previous')}
          </Button>
          <span>{t('pagination.page', { page, pageCount })}</span>
          <Button
            disabled={page >= pageCount}
            onClick={() => {
              setPage(page + 1);
            }}
          >
            {t('pagination.next')}
          </Button>
        </div>
      )}
    </div>
  );
}
