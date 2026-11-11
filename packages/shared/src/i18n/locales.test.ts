import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, isLocale, resolveLocale } from './locales';

describe('isLocale', () => {
  it('accepts supported locales only', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('pt-BR')).toBe(true);
    expect(isLocale('pt')).toBe(false);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});

describe('resolveLocale', () => {
  it('returns an exact match, case-insensitively', () => {
    expect(resolveLocale(['fr'])).toBe('fr');
    expect(resolveLocale(['pt-br'])).toBe('pt-BR');
    expect(resolveLocale(['PT_BR'])).toBe('pt-BR');
  });

  it('falls back to the primary language subtag', () => {
    expect(resolveLocale(['fr-CA'])).toBe('fr');
    expect(resolveLocale(['en-US'])).toBe('en');
    expect(resolveLocale(['pt'])).toBe('pt-BR');
    expect(resolveLocale(['pt-PT'])).toBe('pt-BR');
  });

  it('respects the order of preference', () => {
    expect(resolveLocale(['de-DE', 'pt-BR', 'fr'])).toBe('pt-BR');
    expect(resolveLocale(['fr-FR', 'en'])).toBe('fr');
  });

  it('falls back to English when nothing matches', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(resolveLocale([])).toBe('en');
    expect(resolveLocale(['de', 'ja-JP', ''])).toBe('en');
  });
});
