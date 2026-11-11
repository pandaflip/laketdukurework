import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchHealth } from '../lib/api';

type Status = 'checking' | 'online' | 'offline';

const DOT_CLASS: Record<Status, string> = {
  checking: 'bg-fg-muted',
  online: 'bg-success',
  offline: 'bg-danger',
};

export function ServerStatus() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal).then(
      (health) => {
        setStatus(health.status === 'ok' ? 'online' : 'offline');
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
    <p className="flex items-center gap-2 text-xs text-fg-muted" data-testid="server-status">
      <span className={`inline-block size-2 rounded-full ${DOT_CLASS[status]}`} aria-hidden />
      {t('server.label')}: {t(`server.${status}`)}
    </p>
  );
}
