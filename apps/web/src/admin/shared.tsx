import type { IneligibilityReason, Locale, LocalizedNames } from '@app/shared';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Notice } from '../design/ui';
import { currentLocale } from '../i18n';
import { errorCodeOf } from '../lib/api';

/** Name in the administrator's language, falling back to English. */
export function localizedName(names: LocalizedNames, locale: Locale = currentLocale()): string {
  return names[locale] ?? names.en;
}

/**
 * Runs an admin change, then refreshes every admin list and detail view.
 * `beforeRefresh` runs first: use it to leave a page whose data the change
 * has just deleted, so nothing tries to reload it.
 */
export function useAdminMutation<Input, Output>(
  action: (input: Input) => Promise<Output>,
  onDone?: (output: Output) => void,
  beforeRefresh?: (output: Output) => void,
): UseMutationResult<Output, Error, Input> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: async (output) => {
      beforeRefresh?.(output);
      await client.invalidateQueries({ queryKey: ['admin'] });
      onDone?.(output);
    },
  });
}

export function ErrorNotice({ error }: { error: unknown }) {
  const { t } = useTranslation('errors');
  if (error === null || error === undefined) return null;
  return <Notice tone="danger">{t(errorCodeOf(error))}</Notice>;
}

export function ReasonList({ reasons }: { reasons: readonly IneligibilityReason[] }) {
  const { t } = useTranslation('admin');
  return (
    <ul className="list-inside list-disc text-xs text-fg-muted">
      {reasons.map((reason) => (
        <li key={reason}>{t(`reasons.${reason}`)}</li>
      ))}
    </ul>
  );
}

/** "a, b , c" -> ["a", "b", "c"] */
export function splitAliases(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}
