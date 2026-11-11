import { expect, test } from '@playwright/test';

test.describe('default (English) browser', () => {
  test.use({ locale: 'en-US' });

  test('loads in English, reaches the API and remembers a manual language choice', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByText('Party mini-games to play with friends.')).toBeVisible();
    await expect(page.getByTestId('server-status')).toContainText('Online');

    await page.getByRole('combobox').selectOption('fr');
    await expect(page.getByText('Des mini-jeux à partager entre amis.')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

    await page.reload();
    await expect(page.getByText('Des mini-jeux à partager entre amis.')).toBeVisible();
    await expect(page.getByTestId('server-status')).toContainText('En ligne');
  });

  test('navigates to the game page and handles unknown routes', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Open' }).click();
    await expect(page).toHaveURL(/\/games\/gaming-quiz$/);
    await expect(page.getByRole('heading', { name: 'Zoom Out' })).toBeVisible();
    await expect(page.locator('[data-mode-id="historic"]')).toContainText(
      'Optional, off by default',
    );

    await page.goto('/games/nope');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});

test.describe('Brazilian browser', () => {
  test.use({ locale: 'pt-BR' });

  test('detects Brazilian Portuguese automatically', async ({ page }) => {
    await page.goto('/games/gaming-quiz');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.getByRole('heading', { name: 'Que Bunda É Essa?' })).toBeVisible();
  });
});

test.describe('unsupported browser language', () => {
  test.use({ locale: 'de-DE' });

  test('falls back to English', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});
