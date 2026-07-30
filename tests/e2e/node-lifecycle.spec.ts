import { expect, test } from '@playwright/test';
import { createTriangleGlb } from '../../packages/test-fixtures/src/index';

test('Hierarchy duplicate, reparent, delete and undo remain synchronized', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/studio/');
  await page.getByLabel('Email').fill('nodes@kyxos.local');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Node Lifecycle'));
  await page.getByRole('button', { name: 'New project' }).click();

  await page.locator('input[type=file]').setInputFiles({
    name: 'node-lifecycle.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createTriangleGlb()),
  });
  await expect(page.getByText(/Import complete/)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.hierarchy-row', { hasText: 'Triangle' })).toBeVisible({
    timeout: 60_000,
  });

  const original = page.locator('.hierarchy-row', { hasText: /^.*Triangle.*$/ }).first();
  await original.click();
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.locator('.hierarchy-row')).toHaveCount(2);
  const copy = page.locator('.hierarchy-row', { hasText: 'Triangle Copy' });
  await expect(copy).toBeVisible();

  const originalBox = await original.boundingBox();
  const copyBox = await copy.boundingBox();
  expect(originalBox).not.toBeNull();
  expect(copyBox).not.toBeNull();
  await page.mouse.move(copyBox!.x + 20, copyBox!.y + copyBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(originalBox!.x + 30, originalBox!.y + originalBox!.height / 2);
  await page.mouse.up();
  await expect(copy).toHaveCSS('padding-left', '22px');

  await copy.click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.hierarchy-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.hierarchy-row')).toHaveCount(2);
  await expect(page.locator('.hierarchy-row', { hasText: 'Triangle Copy' })).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.hierarchy-row', { hasText: 'Triangle Copy' })).toHaveCSS(
    'padding-left',
    '8px',
  );
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.hierarchy-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});
