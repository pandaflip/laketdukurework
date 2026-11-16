import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN } from '../playwright.config';
import { makePng, pngFile } from './make-png';

test.use({ locale: 'en-US' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/admin');
  await page.getByLabel('Username').fill(E2E_ADMIN.username);
  await page.getByLabel('Password').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Characters' })).toBeVisible();
}

/** Opens the images page with the given character chosen, ready to import. */
async function openImport(page: Page, name = 'Ashe'): Promise<void> {
  await page.getByRole('link', { name: 'Images', exact: true }).click();
  await page.getByLabel('Find a character').fill(name);
  await page
    .locator('select[name="character"]')
    .selectOption({ label: `${name} · League of Legends` });
}

async function importAndOpen(page: Page, file = pngFile('splash.png', 1215, 717)): Promise<void> {
  await page.getByTestId('file-input').setInputFiles(file);
  await page.getByRole('link', { name: 'Open in the editor' }).first().click();
  await expect(page.getByTestId('source-canvas')).toBeVisible();
}

const stepList = (page: Page) =>
  page.getByRole('navigation', { name: 'Steps' }).getByRole('listitem');

async function generate(page: Page, steps: number, start: number, end: number): Promise<void> {
  await page.getByLabel('Number of steps').fill(String(steps));
  await page.getByLabel('Initial zoom').fill(String(start));
  await page.getByLabel('Final zoom').fill(String(end));
  await page.getByTestId('generate').click();
  await expect(stepList(page)).toHaveCount(steps);
}

test('imports a picture, places the focus, generates 15 steps, previews them, saves and reopens', async ({
  page,
}) => {
  await signIn(page);
  await openImport(page);
  await importAndOpen(page);

  // Click to place the focus point.
  const canvas = page.getByTestId('source-canvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: (box?.width ?? 0) * 0.72, y: (box?.height ?? 0) * 0.31 } });
  await expect(page.getByLabel('Focus X (%)')).toHaveValue(/^7[12]/);
  await expect(page.getByLabel('Focus Y (%)')).toHaveValue(/^3[01]/);

  await generate(page, 15, 10, 1.1);
  await expect(page.getByTestId('preview-position')).toContainText('Step 1 of 15');
  await expect(page.getByTestId('preview-position')).toContainText('Step 1');

  // Previous / next, and direct selection.
  const preview = page.getByRole('group', { name: /Preview of the steps/ });
  await preview.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('preview-position')).toContainText('Step 2 of 15');
  await page.getByRole('button', { name: 'Show Step 15' }).click();
  await expect(page.getByTestId('preview-position')).toContainText('Step 15 of 15');
  await expect(preview.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();

  await page.getByTestId('save-sequence').click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // Reopening gives the same work back.
  await page.reload();
  await expect(stepList(page)).toHaveCount(15);
  await expect(page.getByLabel('Number of steps')).toHaveValue('15');
  await expect(page.getByLabel('Initial zoom')).toHaveValue('10');
  await expect(page.getByLabel('Focus X (%)')).toHaveValue(/^7[12]/);
});

test('adjusts one step by hand, keeps it when regenerating, and reorders and renames steps', async ({
  page,
}) => {
  await signIn(page);
  await openImport(page);
  await importAndOpen(page, pngFile('hand.png', 1600, 900, 2));
  await generate(page, 5, 6, 1);

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('list', { name: 'Steps' }).getByRole('button').nth(2).click();
  await page.getByLabel('Zoom', { exact: true }).fill('3');
  await page.getByLabel('Step name').fill('The sword');
  await expect(page.getByText('Adjusted by hand').first()).toBeVisible();

  // Add, duplicate, move, delete.
  await page.getByRole('button', { name: 'Add a step' }).click();
  await expect(stepList(page)).toHaveCount(6);
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(stepList(page)).toHaveCount(7);
  await page.getByRole('button', { name: 'Move up' }).click();
  await page.getByRole('button', { name: 'Delete step' }).click();
  await expect(stepList(page)).toHaveCount(6);

  // Regenerate with another length: the hand-adjusted step stays.
  await page.getByLabel('Number of steps').fill('9');
  await page.getByLabel('Keep the steps I adjusted by hand').check();
  await page.getByTestId('generate').click();
  await expect(stepList(page)).toHaveCount(9);
  await expect(
    page.getByRole('navigation', { name: 'Steps' }).getByText('The sword'),
  ).toBeVisible();

  // Without the option, everything is regenerated.
  await page.getByLabel('Keep the steps I adjusted by hand').uncheck();
  await page.getByTestId('generate').click();
  await expect(page.getByRole('navigation', { name: 'Steps' }).getByText('The sword')).toHaveCount(
    0,
  );
});

test('moves a frame with the pointer in advanced mode', async ({ page }) => {
  await signIn(page);
  await openImport(page);
  await importAndOpen(page, pngFile('drag.png', 1600, 900, 3));
  await generate(page, 4, 5, 1);
  await page.getByRole('button', { name: 'Advanced' }).click();

  const frame = page.getByTestId('frame-overlay');
  const before = await frame.boundingBox();
  // The focus cross covers the center of the frame: grab the frame by its top-left area.
  await frame.hover({ position: { x: 12, y: 12 } });
  await page.mouse.down();
  await page.mouse.move((before?.x ?? 0) + 12 + 80, (before?.y ?? 0) + 12 + 40, { steps: 5 });
  await page.mouse.up();
  const after = await frame.boundingBox();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeGreaterThan(20);
  await expect(page.getByText('Adjusted by hand').first()).toBeVisible();
});

test('works with the keyboard', async ({ page }) => {
  await signIn(page);
  await openImport(page);
  await importAndOpen(page, pngFile('keys.png', 1215, 717, 4));

  const cross = page.getByTestId('focus-cross');
  await cross.focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Focus X (%)')).toHaveValue('53');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByLabel('Focus Y (%)')).toHaveValue('55');

  await generate(page, 5, 6, 1);
  await page.getByRole('group', { name: /Preview of the steps/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('preview-position')).toContainText('Step 2 of 5');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('preview-position')).toContainText('Step 1 of 5');
});

test('imports by drag and drop, and several files in a row', async ({ page }) => {
  await signIn(page);
  await openImport(page);

  const bytes = makePng(900, 600, 5).toString('base64');
  await page.getByTestId('dropzone').evaluate((zone, data) => {
    const file = new File(
      [Uint8Array.from(atob(data), (char) => char.charCodeAt(0))],
      'dropped splash.png',
      { type: 'image/png' },
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    zone.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  }, bytes);
  await expect(page.getByRole('list', { name: 'Import progress' })).toContainText(
    'dropped splash.png',
  );
  await expect(page.locator('[data-status="done"]').first()).toBeVisible();

  await page
    .getByTestId('file-input')
    .setInputFiles([
      pngFile('a.png', 800, 600, 6),
      pngFile('b.png', 1000, 1600, 7),
      pngFile('c.png', 1215, 717, 8),
    ]);
  await expect(page.locator('[data-status="done"]')).toHaveCount(4);
  await expect(page.locator('tr[data-image-id]').first()).toBeVisible();
});

test('refuses what is not a usable picture, with a clear message', async ({ page }) => {
  await signIn(page);
  await openImport(page);
  await page.getByTestId('file-input').setInputFiles({
    name: 'notes.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not a picture at all'),
  });
  const failed = page.locator('[data-status="failed"]');
  await expect(failed).toContainText('not a usable picture');

  await page.getByTestId('file-input').setInputFiles(pngFile('tiny.png', 120, 120));
  await expect(failed).toHaveCount(2);
  const same = pngFile('twice.png', 700, 500, 9);
  await page.getByTestId('file-input').setInputFiles(same);
  await expect(page.locator('[data-status="done"]').first()).toBeVisible();
  await page.getByTestId('file-input').setInputFiles(same);
  await expect(page.locator('[data-status="failed"]').first()).toContainText('already imported');
});

test('save and add another keeps the character, and the last settings can be reused', async ({
  page,
}) => {
  await signIn(page);
  await openImport(page);
  await importAndOpen(page, pngFile('first.png', 1215, 717, 10));
  await generate(page, 12, 8, 1.5);
  await page.getByRole('button', { name: 'Save and add another image' }).click();

  await expect(page).toHaveURL(/characterId=.+&add=1/);
  await expect(page.locator('select[name="character"]')).not.toHaveValue('');
  await expect(page.getByTestId('dropzone')).toBeVisible();

  await importAndOpen(page, pngFile('second.png', 1215, 717, 11));
  const reuse = page.getByRole('button', { name: /Use last settings \(12 steps, ×8 to ×1.5\)/ });
  await expect(reuse).toBeVisible();
  await reuse.click();
  await expect(page.getByLabel('Number of steps')).toHaveValue('12');
  await expect(page.getByLabel('Initial zoom')).toHaveValue('8');
  // The focus point is not copied: it stays at the center.
  await expect(page.getByLabel('Focus X (%)')).toHaveValue('50');
});

test('reviews an image: approval needs a saved sequence, and changing frames withdraws it', async ({
  page,
}) => {
  await signIn(page);
  await openImport(page);
  await importAndOpen(page, pngFile('review.png', 1215, 717, 12));
  const approve = page.getByTestId('approve-neutral');
  await expect(approve).toBeDisabled();
  await expect(page.getByText('Save a sequence first').first()).toBeVisible();

  await generate(page, 5, 6, 1);
  await page.getByTestId('save-sequence').click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText('Approved (neutral)').first()).toBeVisible();

  // Sensitive approval is refused by the rules for this character, with the reason.
  await expect(page.getByTestId('approve-sensitive')).toBeDisabled();
  await expect(page.getByText('not classified as a verified adult')).toBeVisible();

  // Changing the frames withdraws the approval.
  await page.getByLabel('Initial zoom').fill('7');
  await page.getByTestId('generate').click();
  await page.getByTestId('save-sequence').click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByText('Unverified').first()).toBeVisible();

  await page.getByTestId('reject').click();
  await expect(page.getByText('Rejected').first()).toBeVisible();
});

test('shows the images of a character and deletes one', async ({ page }) => {
  await signIn(page);
  await openImport(page);
  await importAndOpen(page, pngFile('to-delete.png', 800, 600, 13));
  await page.getByRole('button', { name: 'Delete this image…' }).click();
  await page.getByTestId('confirm-delete').click();
  await expect(page).toHaveURL(/\/admin\/images\?characterId=/);
  await expect(page.getByRole('img', { name: 'to-delete' })).toHaveCount(0);

  // From the character page.
  await page.getByRole('link', { name: 'Characters', exact: true }).click();
  await page
    .locator('tr[data-slug="ashe"]')
    .getByRole('link', { name: 'Ashe', exact: true })
    .click();
  await page.getByRole('link', { name: 'Manage images' }).click();
  await expect(page).toHaveURL(/\/admin\/images\?characterId=/);
});

test('a high-resolution picture is imported and edited without lag', async ({ page }) => {
  await signIn(page);
  await openImport(page);
  const started = Date.now();
  await importAndOpen(page, pngFile('huge.png', 3840, 2160, 14));
  const loaded = Date.now() - started;
  const generating = Date.now();
  await generate(page, 30, 12, 1);
  expect(Date.now() - generating).toBeLessThan(3000);
  expect(loaded).toBeLessThan(30_000);
  await page.getByRole('button', { name: 'Show Step 30' }).click();
  await expect(page.getByTestId('preview-position')).toContainText('Step 30 of 30');
});

test('the image pages have no automatic accessibility violation', async ({ page }) => {
  await signIn(page);
  await openImport(page);
  await importAndOpen(page, pngFile('a11y.png', 1215, 717, 15));
  const scan = async (label: string): Promise<void> => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map(
        (v) =>
          `${v.id}: ${v.nodes
            .slice(0, 2)
            .map((n) => n.target.join(' '))
            .join(' | ')}`,
      ),
      label,
    ).toEqual([]);
  };
  await scan('editor, before generating');
  await generate(page, 6, 6, 1);
  await scan('editor, simple mode');
  await page.getByRole('button', { name: 'Advanced' }).click();
  await scan('editor, advanced mode');
  await page
    .getByRole('link', { name: /^Images$/ })
    .first()
    .click();
  await expect(page.locator('tr[data-image-id]').first()).toBeVisible();
  await scan('images list');
});

const focusValues = async (page: Page): Promise<[number, number]> => [
  Number(await page.getByLabel('Focus X (%)').inputValue()),
  Number(await page.getByLabel('Focus Y (%)').inputValue()),
];

test('random mode draws a focus and a sequence, relaunches, lets you adjust, and the saved draw stays fixed', async ({
  page,
}) => {
  await signIn(page);
  await openImport(page);
  await importAndOpen(page, pngFile('random.png', 1215, 717, 20));

  // Entering Random mode on a new picture draws at once: ×12 to ×1 by default.
  await page.getByRole('button', { name: 'Random' }).click();
  await expect(stepList(page)).toHaveCount(5);
  await expect(page.getByLabel('Initial zoom')).toHaveValue('12');
  await expect(page.getByLabel('Final zoom')).toHaveValue('1');
  const [firstX, firstY] = await focusValues(page);
  expect(firstX).toBeGreaterThanOrEqual(20);
  expect(firstX).toBeLessThanOrEqual(80);
  expect(firstY).toBeGreaterThanOrEqual(20);
  expect(firstY).toBeLessThanOrEqual(80);
  await expect(page.getByTestId('drawn-focus')).toContainText('Focus drawn');

  // Preview before saving.
  await expect(page.getByTestId('preview-position')).toContainText('Step 1 of 5');
  await page.getByRole('button', { name: 'Show Step 5' }).click();
  await expect(page.getByTestId('preview-position')).toContainText('Step 5 of 5');

  // Relaunch: a new focus and a new sequence.
  await page.getByLabel('Number of steps').fill('9');
  await page.getByTestId('relaunch').click();
  await expect(stepList(page)).toHaveCount(9);
  const [secondX, secondY] = await focusValues(page);
  expect([secondX, secondY]).not.toEqual([firstX, firstY]);

  // A narrower zone keeps the draw closer to the center, whatever the draw.
  await page.getByLabel('Draw zone (%)').fill('20');
  for (let i = 0; i < 6; i += 1) {
    await page.getByTestId('relaunch').click();
    const [x, y] = await focusValues(page);
    expect(x).toBeGreaterThanOrEqual(40);
    expect(x).toBeLessThanOrEqual(60);
    expect(y).toBeGreaterThanOrEqual(40);
    expect(y).toBeLessThanOrEqual(60);
  }

  // Adjust a step in Advanced mode, then save.
  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('list', { name: 'Steps' }).getByRole('button').nth(3).click();
  await page.getByLabel('Zoom', { exact: true }).fill('2');
  await expect(page.getByText('Adjusted by hand').first()).toBeVisible();
  const drawn = await focusValues(page);
  await page.getByTestId('save-sequence').click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // Once saved, nothing is drawn again: not on reload, not when switching modes.
  await page.reload();
  await expect(stepList(page)).toHaveCount(9);
  expect(await focusValues(page)).toEqual(drawn);
  await page.getByRole('button', { name: 'Random' }).click();
  await expect(stepList(page)).toHaveCount(9);
  expect(await focusValues(page)).toEqual(drawn);
  await page.getByRole('button', { name: 'Simple' }).click();
  expect(await focusValues(page)).toEqual(drawn);
  await expect(page.getByText('Adjusted by hand').first()).toBeVisible();
});

test('random mode works on portrait pictures, refuses unusable zooms and stays accessible', async ({
  page,
}) => {
  await signIn(page);
  await openImport(page);
  await importAndOpen(page, pngFile('random-portrait.png', 1000, 1600, 21));
  await page.getByRole('button', { name: 'Random' }).click();
  await expect(stepList(page)).toHaveCount(5);

  await page.getByLabel('Number of steps').fill('15');
  await page.getByTestId('relaunch').click();
  await expect(stepList(page)).toHaveCount(15);
  await page.getByTestId('save-sequence').click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // An initial zoom that is not tighter than the final one cannot be drawn.
  await page.getByLabel('Initial zoom').fill('1');
  await expect(page.getByTestId('relaunch')).toBeDisabled();
  await expect(page.getByText('must be tighter')).toBeVisible();
  await page.getByLabel('Initial zoom').fill('12');
  await expect(page.getByTestId('relaunch')).toBeEnabled();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.nodes
          .slice(0, 2)
          .map((n) => n.target.join(' '))
          .join(' | ')}`,
    ),
  ).toEqual([]);
});

test('the images pages are available in French and Brazilian Portuguese', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Images', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('fr');
  await expect(page.getByRole('heading', { name: 'Images' })).toBeVisible();
  await expect(page.getByText('Choisir des fichiers')).toBeVisible();
  await page.getByRole('combobox', { name: 'Langue' }).selectOption('pt-BR');
  await expect(page.getByRole('heading', { name: 'Imagens' })).toBeVisible();
  await expect(page.getByText('Escolher arquivos')).toBeVisible();
});
