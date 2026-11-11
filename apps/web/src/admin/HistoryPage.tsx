import { useTranslation } from 'react-i18next';
import { Card } from '../design/ui';
import { AuditList } from './AuditList';

export function HistoryPage() {
  const { t } = useTranslation('admin');
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">{t('history.title')}</h1>
      <p className="text-sm text-fg-muted">{t('history.intro')}</p>
      <Card>
        <AuditList />
      </Card>
    </div>
  );
}
