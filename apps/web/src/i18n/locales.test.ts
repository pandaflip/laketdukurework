import {
  AGE_CLASSES,
  AUDIT_ACTIONS,
  CHARACTER_STATUSES,
  ERROR_CODES,
  GAME_IDS,
  INELIGIBILITY_REASONS,
  MODE_IDS,
  SUPPORTED_LOCALES,
} from '@app/shared';
import { describe, expect, it } from 'vitest';
import { LOCALE_NAMES, NAMESPACES, resources } from './resources';

function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return { [prefix]: value };
  return Object.assign(
    {},
    ...Object.entries(value).map(([key, child]) =>
      flatten(child, prefix ? `${prefix}.${key}` : key),
    ),
  ) as Record<string, unknown>;
}

describe('translation files', () => {
  it('exist for every supported locale, with a display name', () => {
    expect(Object.keys(resources).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    for (const locale of SUPPORTED_LOCALES) expect(LOCALE_NAMES[locale]).not.toBe('');
  });

  it.each(SUPPORTED_LOCALES)('%s has exactly the same keys as English', (locale) => {
    for (const ns of NAMESPACES) {
      const reference = Object.keys(flatten(resources.en[ns])).sort();
      expect(Object.keys(flatten(resources[locale][ns])).sort(), `${locale}/${ns}`).toEqual(
        reference,
      );
    }
  });

  it.each(SUPPORTED_LOCALES)('%s has no empty or non-string message', (locale) => {
    for (const ns of NAMESPACES) {
      for (const [key, message] of Object.entries(flatten(resources[locale][ns]))) {
        expect(typeof message, `${locale}/${ns}:${key}`).toBe('string');
        expect((message as string).trim(), `${locale}/${ns}:${key}`).not.toBe('');
      }
    }
  });

  it.each(SUPPORTED_LOCALES)('%s names and describes every game and mode', (locale) => {
    const games = flatten(resources[locale].games);
    const modes = flatten(resources[locale].modes);
    for (const id of GAME_IDS) {
      expect(games).toHaveProperty([`${id}.name`]);
      expect(games).toHaveProperty([`${id}.description`]);
    }
    for (const id of MODE_IDS) {
      expect(modes).toHaveProperty([`${id}.name`]);
      expect(modes).toHaveProperty([`${id}.description`]);
    }
  });

  it.each(SUPPORTED_LOCALES)('%s translates every code the server can send', (locale) => {
    const errors = flatten(resources[locale].errors);
    for (const code of [...ERROR_CODES, 'NETWORK_ERROR']) expect(errors).toHaveProperty([code]);

    const admin = flatten(resources[locale].admin);
    for (const reason of INELIGIBILITY_REASONS) expect(admin).toHaveProperty([`reasons.${reason}`]);
    for (const ageClass of AGE_CLASSES) expect(admin).toHaveProperty([`ageClass.${ageClass}`]);
    for (const action of AUDIT_ACTIONS) {
      expect(admin).toHaveProperty([`history.actions.${action}`]);
    }
    for (const status of CHARACTER_STATUSES) {
      expect(admin).toHaveProperty([`status.${status}.label`]);
      expect(admin).toHaveProperty([`status.${status}.hint`]);
    }
  });
});
