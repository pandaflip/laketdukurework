import { isLocale, SUPPORTED_LOCALES } from '@app/shared';
import { useTranslation } from 'react-i18next';
import { currentLocale, setLocale } from '../i18n';
import { LOCALE_NAMES } from '../i18n/resources';

export function LanguageSwitcher() {
  const { t } = useTranslation();

  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <span>{t('language.label')}</span>
      <select
        className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
        value={currentLocale()}
        onChange={(event) => {
          const { value } = event.target;
          if (isLocale(value)) void setLocale(value);
        }}
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale} lang={locale}>
            {LOCALE_NAMES[locale]}
          </option>
        ))}
      </select>
    </label>
  );
}
