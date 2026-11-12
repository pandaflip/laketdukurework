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
  await expect(row(page, 'caitlyn')).toContainText('No image');
  // The table only shows summary badges: reasons are on the character page.
  await expect(row(page, 'caitlyn')).not.toContainText('not classified as a verified adult');

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

test('a new universe must be reviewed before any sensitive mode can be enabled', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Universes' }).click();

  await page.getByLabel('Name', { exact: true }).first().fill('Brand New Game');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const card = page.locator('[data-universe="brand-new-game"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('To review');
  await expect(card).toContainText('has not been reviewed');
  const sensitiveBox = card.getByRole('checkbox', { name: /Ziasskwest/ });
  await expect(sensitiveBox).toBeDisabled();
  // Unreviewed universes cannot use the young-audience unlock either.
  await expect(card.getByRole('button', { name: 'Unlock sensitive modes' })).toHaveCount(0);

  // General audience needs a justification and a confirmation.
  await card.getByLabel('Audience classification').selectOption('GENERAL');
  await card
    .getByLabel('Justification')
    .fill('Reviewed by hand: a competitive adult-oriented game, no young-audience positioning.');
  await card.getByRole('checkbox', { name: /I have reviewed this universe/ }).check();
  await card.getByRole('button', { name: 'Save classification' }).click();
  await expect(card).toContainText('General audience');
  await expect(sensitiveBox).toBeEnabled();
  await sensitiveBox.check();
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sensitiveBox).toBeChecked();

  // A stricter classification applies at once and switches the sensitive mode off.
  await card.getByLabel('Audience classification').selectOption('YOUTH');
  await card.getByRole('button', { name: 'Save classification' }).click();
  await expect(card).toContainText('Young audience');
  await expect(sensitiveBox).toBeDisabled();
  await expect(sensitiveBox).not.toBeChecked();
  await expect(card.getByRole('button', { name: 'Unlock sensitive modes' })).toBeVisible();
});

test('universes fixed as young-audience by the code cannot be made general audience', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Universes' }).click();
  const minecraft = page.locator('[data-universe="minecraft"]');
  await expect(minecraft).toContainText('Young audience');
  await expect(minecraft).toContainText('The code fixes this universe as young-audience');
  // Asserted on the attribute: Playwright's disabled state is unreliable for <option> elements.
  await expect(
    minecraft.getByLabel('Audience classification').locator('option[value="GENERAL"]'),
  ).toHaveAttribute('disabled', '');
});

test('the table links to the detailed reasons on the character page', async ({ page }) => {
  await signIn(page);
  await row(page, 'ashe')
    .getByRole('link', { name: /eligibility details for Ashe/i })
    .click();
  await expect(page).toHaveURL(/#eligibility$/);
  const card = page.locator('#eligibility');
  await expect(card).toBeVisible();
  await expect(card.locator('li[data-mode-id="historic"]')).toContainText(
    'not classified as a verified adult',
  );
  // Chaos Mix is not a round mode of its own: its rounds are checked per mode.
  await expect(card.locator('li[data-mode-id="chaos-mix"]')).toContainText('Checked per round');
  // Images are reported apart from the eligibility of the character.
  await expect(card.locator('li[data-mode-id="zoom-out"]')).toContainText('0 usable images');
});

test('a verified adult needs a justification and a confirmation; Annie can never be one', async ({
  page,
}) => {
  await signIn(page);

  // Enable the sensitive mode for the universe first (off by default).
  await page.getByRole('link', { name: 'Universes' }).click();
  const lol = page.locator('[data-universe="league-of-legends"]');
  await lol.getByRole('checkbox', { name: /Ziasskwest/ }).check();
  await lol.getByRole('button', { name: 'Save', exact: true }).click();
  const pokemon = page.locator('[data-universe="pokemon"]');
  const sensitiveBox = pokemon.getByRole('checkbox', { name: /Ziasskwest/ });
  await expect(sensitiveBox).toBeDisabled();
  await expect(pokemon).toContainText('young audience');

  // Unlocking is a deliberate exception: confirmation and a long justification.
  await pokemon
    .getByLabel('Justification')
    .fill(
      'Explicit product decision: sensitive modes may be offered for individually verified adults only.',
    );
  await pokemon.getByRole('checkbox', { name: /I understand this is an exception/ }).check();
  await pokemon.getByRole('button', { name: 'Unlock sensitive modes' }).click();
  await expect(pokemon.getByRole('button', { name: 'Lock again' })).toBeVisible();
  await expect(sensitiveBox).toBeEnabled();
  await sensitiveBox.check();
  await pokemon.getByRole('button', { name: 'Save', exact: true }).click();

  // Locking again switches the sensitive mode off at once.
  await pokemon.getByRole('button', { name: 'Lock again' }).click();
  await expect(pokemon.getByRole('button', { name: 'Unlock sensitive modes' })).toBeVisible();
  await expect(sensitiveBox).toBeDisabled();
  await expect(sensitiveBox).not.toBeChecked();

  await page.getByRole('link', { name: 'Characters' }).click();
  await row(page, 'ashe').getByRole('link', { name: 'Ashe', exact: true }).click();
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
  await row(page, 'annie').getByRole('link', { name: 'Annie', exact: true }).click();
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
