import { GAME_IDS, GAMES } from '@app/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function HomePage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-8">
      <p className="text-lg text-slate-300">{t('tagline', { ns: 'platform' })}</p>
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          {t('home.gamesTitle')}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {GAME_IDS.map((id) => (
            <li key={id} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="text-lg font-semibold">{t(`${id}.name`, { ns: 'games' })}</h3>
              <p className="mt-1 text-sm text-slate-400">
                {t(`${id}.description`, { ns: 'games' })}
              </p>
              <Link
                to={`/games/${GAMES[id].slug}`}
                className="mt-4 inline-block rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
              >
                {t('home.open')}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
