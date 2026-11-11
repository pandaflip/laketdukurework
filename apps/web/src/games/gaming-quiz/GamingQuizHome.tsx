import { GAMES, MODES } from '@app/shared';
import { useTranslation } from 'react-i18next';

const GAME = GAMES['gaming-quiz'];

/** Placeholder landing page: lists the planned modes. Gameplay arrives in Phase 2. */
export function GamingQuizHome() {
  const { t } = useTranslation();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{t(`${GAME.id}.name`, { ns: 'games' })}</h1>
        <p className="mt-2 text-slate-300">{t(`${GAME.id}.description`, { ns: 'games' })}</p>
      </div>
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          {t('game.modesTitle')}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {GAME.modeIds.map((modeId) => (
            <li
              key={modeId}
              data-mode-id={modeId}
              className="rounded-xl border border-slate-800 bg-slate-900 p-5"
            >
              <h3 className="text-lg font-semibold">{t(`${modeId}.name`, { ns: 'modes' })}</h3>
              <p className="mt-1 text-sm text-slate-400">
                {t(`${modeId}.description`, { ns: 'modes' })}
              </p>
              <p className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-300">
                  {t('game.comingSoon')}
                </span>
                {MODES[modeId].sensitivity === 'sensitive' && (
                  <span className="rounded-full bg-amber-950 px-2 py-0.5 text-amber-300">
                    {t('game.optIn')}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
