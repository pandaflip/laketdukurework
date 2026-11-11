import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ServerStatus } from './ServerStatus';

export function AppLayout() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <Link to="/" className="text-xl font-bold tracking-tight" aria-label={t('nav.home')}>
          {t('name', { ns: 'platform' })}
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="flex-1 pb-12">
        <Outlet />
      </main>
      <footer className="border-t border-line py-4">
        <ServerStatus />
      </footer>
    </div>
  );
}
