import type { Locale } from '@app/shared';
import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import enGames from './locales/en/games.json';
import enModes from './locales/en/modes.json';
import enPlatform from './locales/en/platform.json';
import frCommon from './locales/fr/common.json';
import frErrors from './locales/fr/errors.json';
import frGames from './locales/fr/games.json';
import frModes from './locales/fr/modes.json';
import frPlatform from './locales/fr/platform.json';
import ptBRCommon from './locales/pt-BR/common.json';
import ptBRErrors from './locales/pt-BR/errors.json';
import ptBRGames from './locales/pt-BR/games.json';
import ptBRModes from './locales/pt-BR/modes.json';
import ptBRPlatform from './locales/pt-BR/platform.json';

/**
 * Translation namespaces:
 * - `platform`: the portal brand (name, tagline)
 * - `games`:    per-game name and description, keyed by game id
 * - `modes`:    per-mode name and description, keyed by mode id
 * - `common`:   shared interface strings
 * - `errors`:   messages for API error codes
 */
export const NAMESPACES = ['common', 'platform', 'games', 'modes', 'errors'] as const;

export type Namespace = (typeof NAMESPACES)[number];

const en = {
  common: enCommon,
  platform: enPlatform,
  games: enGames,
  modes: enModes,
  errors: enErrors,
};

/** English is the reference: other locales must provide the same keys. */
export type Messages = typeof en;

export const resources: Record<Locale, Messages> = {
  en,
  fr: {
    common: frCommon,
    platform: frPlatform,
    games: frGames,
    modes: frModes,
    errors: frErrors,
  },
  'pt-BR': {
    common: ptBRCommon,
    platform: ptBRPlatform,
    games: ptBRGames,
    modes: ptBRModes,
    errors: ptBRErrors,
  },
};

/** Each language is listed under its own name, whatever the active locale. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  'pt-BR': 'Português (Brasil)',
};
