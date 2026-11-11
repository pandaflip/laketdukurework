import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">{t('notFound.title')}</h1>
      <p className="text-slate-400">{t('notFound.body')}</p>
      <Link to="/" className="text-indigo-400 hover:underline">
        {t('nav.backHome')}
      </Link>
    </div>
  );
}
