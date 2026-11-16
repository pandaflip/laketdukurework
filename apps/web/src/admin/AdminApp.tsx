import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { NavLink, Route, Routes } from 'react-router';
import { Button, Notice } from '../design/ui';
import { adminApi, errorCodeOf } from '../lib/api';
import { NotFoundPage } from '../platform/NotFoundPage';
import { CharacterPage } from './CharacterPage';
import { CharactersPage } from './CharactersPage';
import { ImageEditorPage } from './images/ImageEditorPage';
import { ImagesPage } from './images/ImagesPage';
import { HistoryPage } from './HistoryPage';
import { LoginPage } from './LoginPage';
import { ErrorNotice, useAdminMutation } from './shared';
import { UniversesPage } from './UniversesPage';

const NAV = [
  { to: '/admin', key: 'characters', end: true },
  { to: '/admin/images', key: 'images', end: false },
  { to: '/admin/universes', key: 'universes', end: false },
  { to: '/admin/history', key: 'history', end: false },
] as const;

/**
 * Administration area. The server decides who is signed in (`/auth/me`);
 * nothing here is trusted for access control.
 */
export default function AdminApp() {
  const { t } = useTranslation('admin');
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: adminApi.me, retry: false });
  const logout = useAdminMutation(adminApi.logout);

  if (me.isPending) return <Notice>{t('loading')}</Notice>;
  if (me.isError) {
    return errorCodeOf(me.error) === 'UNAUTHENTICATED' ? (
      <LoginPage />
    ) : (
      <ErrorNotice error={me.error} />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <nav className="flex flex-wrap gap-1" aria-label={t('nav.label')}>
          {NAV.map((item) => (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-control px-3 py-1.5 text-sm font-medium ${
                  isActive ? 'bg-surface-sunken text-fg' : 'text-fg-muted hover:text-fg'
                }`
              }
            >
              {t(`nav.${item.key}`)}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-sm text-fg-muted">
          <span>{me.data.admin.username}</span>
          <Button
            variant="ghost"
            onClick={() => {
              logout.mutate(undefined);
            }}
          >
            {t('nav.logout')}
          </Button>
        </div>
      </div>
      <Routes>
        <Route index element={<CharactersPage />} />
        <Route path="characters/:id" element={<CharacterPage />} />
        <Route path="images" element={<ImagesPage />} />
        <Route path="images/:id" element={<ImageEditorPage />} />
        <Route path="universes" element={<UniversesPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}
