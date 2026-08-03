import { expect, test } from '@playwright/test';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);

test('Texture Atlas editor slices, edits, validates, undoes and exports frames', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/texture-atlas/');

  await expect(page.getByText('Kyxos Texture Atlas')).toBeVisible();
  await expect(page.getByText('Open a texture to begin')).toBeVisible();
  await page.locator('#atlas-image-input').setInputFiles({
    name: 'sprite.png',
    mimeType: 'image/png',
    buffer: onePixelPng,
  });
  await expect(page.locator('#atlas-image-info')).toContainText('1 × 1');
  await expect(page.locator('#atlas-canvas')).toBeVisible();

  await page.getByRole('button', { name: 'Add frame' }).click();
  await expect(page.locator('.atlas-frame-row')).toHaveCount(1);
  await expect(page.locator('#atlas-frame-count')).toHaveText('1');
  await expect(page.locator('#atlas-issues')).toContainText('Atlas is valid');

  const nameInput = page.locator('#atlas-inspector .atlas-field-wide input');
  await nameInput.fill('Hero Idle');
  await nameInput.blur();
  await expect(page.locator('.atlas-frame-row strong')).toHaveText('Hero Idle');

  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.locator('.atlas-frame-row')).toHaveCount(2);
  await expect(page.locator('#atlas-issues')).toContainText('overlap');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.atlas-frame-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('.atlas-frame-row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Auto detect' }).click();
  await expect(page.locator('.atlas-frame-row')).toHaveCount(1);
  await expect(page.locator('#atlas-status')).toContainText('Detected 1 alpha regions');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('sprite-atlas.json');
  const path = await download.path();
  expect(path).toBeTruthy();
});

test('Texture Atlas editor creates deterministic prompt-driven grids', async ({ page }) => {
  await page.goto('/studio/texture-atlas/');
  await page.locator('#atlas-image-input').setInputFiles({
    name: 'grid.png',
    mimeType: 'image/png',
    buffer: onePixelPng,
  });
  const answers = ['1', '1', '0', '0'];
  page.on('dialog', async (dialog) => dialog.accept(answers.shift() ?? '0'));
  await page.getByRole('button', { name: 'Grid slice' }).click();
  await expect(page.locator('.atlas-frame-row')).toHaveCount(1);
  await expect(page.locator('.atlas-frame-row span')).toHaveText('0, 0 · 1 × 1');
  await expect(page.locator('#atlas-status')).toContainText('Created 1 grid frames');
});
