import {
  DEFAULT_LOCALE,
  isLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
  type Locale,
} from '@app/shared';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { NAMESPACES, resources } from './resources';

export const LOCALE_STORAGE_KEY = 'app.locale';

function readStoredLocale(): Locale | undefined {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : undefined;
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
    return undefined;
  }
}

/** The player's saved choice wins; otherwise the browser languages; otherwise English. */
export function detectInitialLocale(): Locale {
  return readStoredLocale() ?? resolveLocale(window.navigator.languages);
}

function applyDocumentLocale(): void {
  document.documentElement.lang = i18next.language;
  document.title = i18next.t('name', { ns: 'platform' });
}

export async function initI18n(locale: Locale = detectInitialLocale()): Promise<void> {
  if (i18next.isInitialized) {
    await i18next.changeLanguage(locale);
  } else {
    await i18next.use(initReactI18next).init({
      resources,
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...SUPPORTED_LOCALES],
      ns: [...NAMESPACES],
      defaultNS: 'common',
      interpolation: { escapeValue: false }, // React already escapes.
    });
    i18next.on('languageChanged', applyDocumentLocale);
  }
  applyDocumentLocale();
}

/** Manual selection: applied immediately and remembered on this device. */
export async function setLocale(locale: Locale): Promise<void> {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The choice still applies for this visit.
  }
  await i18next.changeLanguage(locale);
}

export function currentLocale(): Locale {
  return isLocale(i18next.language) ? i18next.language : DEFAULT_LOCALE;
}
