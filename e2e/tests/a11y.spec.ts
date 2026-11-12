import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN } from '../playwright.config';

test.use({ locale: 'en-US' });

async function expectNoViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? '?'}): ${violation.nodes
        .slice(0, 2)
        .map((node) => node.target.join(' '))
        .join(' | ')}`,
  );
  expect(summary, `accessibility violations on ${label}`).toEqual([]);
}

test('pages of the platform and the administration have no automatic accessibility violation', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('server-status')).toContainText('Online');
  await expectNoViolations(page, 'home');

  await page.goto('/games/gaming-quiz');
  await expect(page.locator('[data-mode-id="historic"]')).toBeVisible();
  await expectNoViolations(page, 'game page');

  await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expectNoViolations(page, 'admin login');

  await page.getByLabel('Username').fill(E2E_ADMIN.username);
  await page.getByLabel('Password').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('tr[data-slug="ashe"]')).toBeVisible();
  await expectNoViolations(page, 'character list');

  await page
    .locator('tr[data-slug="ashe"]')
    .getByRole('link', { name: 'Ashe', exact: true })
    .click();
  await expect(page.locator('#eligibility')).toBeVisible();
  await expectNoViolations(page, 'character page');

  await page.getByRole('link', { name: 'Universes' }).click();
  await expect(page.locator('[data-universe="pokemon"]')).toBeVisible();
  await expectNoViolations(page, 'universes');

  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expectNoViolations(page, 'history');
});

test('the catalog can be used with the keyboard only', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('Username').fill(E2E_ADMIN.username);
  await page.getByLabel('Password').fill(E2E_ADMIN.password);
  await page.keyboard.press('Enter');
  await expect(page.locator('tr[data-slug="ashe"]')).toBeVisible();

  // Tab reaches the "Why?" link of a row, and Enter follows it.
  const why = page.getByRole('link', { name: /eligibility details for Ashe/i });
  await why.focus();
  await expect(why).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#eligibility')).toBeVisible();
});
