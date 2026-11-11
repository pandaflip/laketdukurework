import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN } from '../playwright.config';

test.use({ locale: 'en-US' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/admin');
  await page.getByLabel('Username').fill(E2E_ADMIN.username);
  await page.getByLabel('Password').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Characters' })).toBeVisible();
}

function row(page: Page, slug: string) {
  return page.locator(`tr[data-slug="${slug}"]`);
}

test('the admin area requires signing in and rejects wrong credentials', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Characters' })).toHaveCount(0);

  await page.getByLabel('Username').fill(E2E_ADMIN.username);
  await page.getByLabel('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Wrong username or password');

  await signIn(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('searches, creates and bulk-edits characters', async ({ page }) => {
  await signIn(page);

  // Accent-insensitive search on a French name.
  await page.getByLabel('Search').fill('zoé');
  await expect(row(page, 'zoe')).toBeVisible();
  await expect(row(page, 'ashe')).toHaveCount(0);
  await expect(row(page, 'zoe')).toContainText('Fundamental exclusion');
  await page.getByLabel('Search').fill('');

  // A new character starts Restricted and Not reviewed.
  await page.getByLabel('Name (English)').fill('Caitlyn');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(row(page, 'caitlyn')).toBeVisible();
  await expect(row(page, 'caitlyn').getByRole('combobox')).toHaveValue('RESTRICTED');
  await expect(row(page, 'caitlyn')).toContainText('Not reviewed');
  await expect(row(page, 'caitlyn')).toContainText('Sensitive modes: no');

  // Bulk status change, then restore the whole batch from the history.
  await row(page, 'jett').getByRole('checkbox').check();
  await row(page, 'sage').getByRole('checkbox').check();
  await page.getByLabel('Status to apply').selectOption('EXCLUDED');
  await page.getByRole('button', { name: 'Apply to selection' }).click();
  await expect(page.getByText('2 characters updated.')).toBeVisible();
  await expect(row(page, 'jett').getByRole('combobox')).toHaveValue('EXCLUDED');
  await expect(row(page, 'jett')).toContainText('Neutral modes: no');

  await page.getByRole('link', { name: 'History' }).click();
  await page.getByRole('button', { name: 'Restore the whole batch' }).first().click();
  await expect(page.getByText('2 restored, 0 skipped')).toBeVisible();
  await page.getByRole('link', { name: 'Characters' }).click();
  await expect(row(page, 'jett').getByRole('combobox')).toHaveValue('RESTRICTED');
});

test('a verified adult needs a justification and a confirmation; Annie can never be one', async ({
  page,
}) => {
  await signIn(page);

  // Enable the sensitive mode for the universe first (off by default).
  await page.getByRole('link', { name: 'Universes' }).click();
  const lol = page.locator('[data-universe="league-of-legends"]');
  await lol.getByRole('checkbox', { name: /Ziasskwest/ }).check();
  await lol.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.locator('[data-universe="pokemon"]').getByRole('checkbox', { name: /Ziasskwest/ }),
  ).toBeDisabled();
  await expect(page.locator('[data-universe="pokemon"]')).toContainText(
    'Sensitive modes can never be enabled',
  );

  await page.getByRole('link', { name: 'Characters' }).click();
  await row(page, 'ashe').getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Ashe' })).toBeVisible();

  const historic = page.locator('li[data-mode-id="historic"]');
  await expect(historic).toContainText('Not eligible');

  // ALLOWED alone is not enough.
  await page.getByLabel('Status', { exact: true }).selectOption('ALLOWED');
  await expect(historic).toContainText('not classified as a verified adult');

  await page.getByLabel('Safety classification').selectOption('ADULT_VERIFIED');
  await page
    .getByLabel('Justification')
    .fill('Adult in the official lore; adult appearance and presentation.');
  await page.getByRole('checkbox', { name: /I have checked this character individually/ }).check();
  await page.getByRole('button', { name: 'Save classification' }).click();
  await expect(historic).toContainText('Eligible');
  await expect(historic).not.toContainText('Not eligible');

  // The history of the character shows the changes and offers to restore them.
  await expect(page.locator('li[data-action="character.classification"]')).toContainText(
    'Not reviewed → Verified adult',
  );
  await page
    .locator('li[data-action="character.classification"]')
    .getByRole('button', { name: 'Restore', exact: true })
    .click();
  await expect(historic).toContainText('Not eligible');

  // Annie: the option is disabled and the server explains why.
  await page.getByRole('link', { name: '← Characters' }).click();
  await row(page, 'annie').getByRole('link').click();
  await expect(page.getByText('permanently excluded from sensitive modes').first()).toBeVisible();
  await expect(
    page.getByLabel('Safety classification').locator('option[value="ADULT_VERIFIED"]'),
  ).toBeDisabled();
  await page.getByLabel('Status', { exact: true }).selectOption('ALLOWED');
  await expect(page.locator('li[data-mode-id="historic"]')).toContainText('Fundamental exclusion');
  await expect(page.locator('li[data-mode-id="zoom-out"]')).toContainText('Eligible');
});

test('the admin interface is available in French and Brazilian Portuguese', async ({ page }) => {
  await signIn(page);
  await page.getByRole('combobox', { name: 'Language' }).selectOption('fr');
  await expect(page.getByRole('heading', { name: 'Personnages' })).toBeVisible();
  await expect(row(page, 'zoe')).toContainText('Zoé');
  await expect(row(page, 'zoe')).toContainText('Apparence enfantine');

  await page
    .getByRole('combobox', { name: 'Idioma' })
    .or(page.getByRole('combobox', { name: 'Langue' }))
    .selectOption('pt-BR');
  await expect(page.getByRole('heading', { name: 'Personagens' })).toBeVisible();
  await expect(row(page, 'annie')).toContainText('Menor de idade');
});
