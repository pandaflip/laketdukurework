import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchHealth } from '../lib/api';

type Status = 'checking' | 'online' | 'offline';

const DOT_CLASS: Record<Status, string> = {
  checking: 'bg-slate-500',
  online: 'bg-emerald-400',
  offline: 'bg-rose-400',
};

export function ServerStatus() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal).then(
      () => {
        setStatus('online');
      },
      () => {
        if (!controller.signal.aborted) setStatus('offline');
      },
    );
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <p className="flex items-center gap-2 text-xs text-slate-400" data-testid="server-status">
      <span className={`inline-block size-2 rounded-full ${DOT_CLASS[status]}`} aria-hidden />
      {t('server.label')}: {t(`server.${status}`)}
    </p>
  );
}
