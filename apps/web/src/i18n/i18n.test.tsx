import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectInitialLocale, initI18n, LOCALE_STORAGE_KEY } from '.';
import { routes } from '../routes';

function mockBrowserLanguages(languages: string[]): void {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages);
}

function renderAt(path: string): void {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json({ status: 'ok', database: 'up' }))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('locale detection', () => {
  it('uses the browser language when nothing is stored', () => {
    mockBrowserLanguages(['pt-PT', 'en']);
    expect(detectInitialLocale()).toBe('pt-BR');
  });

  it('falls back to English for unsupported browser languages', () => {
    mockBrowserLanguages(['de-DE', 'ja']);
    expect(detectInitialLocale()).toBe('en');
  });

  it('prefers the stored choice over the browser language', () => {
    mockBrowserLanguages(['fr-FR']);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'pt-BR');
    expect(detectInitialLocale()).toBe('pt-BR');
  });

  it('ignores a corrupted stored value', () => {
    mockBrowserLanguages(['fr-FR']);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'klingon');
    expect(detectInitialLocale()).toBe('fr');
  });
});

describe('language switcher', () => {
  it('translates the interface, persists the choice and updates <html lang>', async () => {
    await initI18n('en');
    renderAt('/');
    expect(screen.getByText('Party mini-games to play with friends.')).toBeDefined();
    expect(document.documentElement.lang).toBe('en');

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fr' } });

    await waitFor(() => {
      expect(screen.getByText('Des mini-jeux à partager entre amis.')).toBeDefined();
    });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
    expect(detectInitialLocale()).toBe('fr');
  });

  it('shows a localized name for the historic mode', async () => {
    await initI18n('pt-BR');
    renderAt('/games/gaming-quiz');
    expect(screen.getByText('Que Bunda É Essa?')).toBeDefined();
    expect(screen.getByText('Opcional, desativado por padrão')).toBeDefined();

    await initI18n('fr');
    await waitFor(() => {
      expect(screen.getByText('Laketduku')).toBeDefined();
    });
  });

  it('renders a translated not-found page for unknown games', async () => {
    await initI18n('en');
    renderAt('/games/does-not-exist');
    expect(screen.getByText('Page not found')).toBeDefined();
  });
});
