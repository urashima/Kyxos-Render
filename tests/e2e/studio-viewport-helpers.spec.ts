import { expect, test } from '@playwright/test';
import { createTriangleGlb } from '../../packages/test-fixtures/src/index';

test('Studio viewport helpers survive GLB scene replacement', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('helpers@kyxos.local');
  await page.getByLabel('Password').fill('helpers-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Viewport Helpers Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();

  const canvas = page.locator('#studio-canvas');
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  await expect(canvas).toHaveAttribute('data-editor-helpers', /grid/);
  await expect(canvas).toHaveAttribute('data-editor-helpers', /axes/);
  await expect(canvas).toHaveAttribute('data-editor-helpers', /bounds/);

  await page.getByText('Helpers', { exact: true }).click();
  const grid = page.getByLabel('Ground grid');
  const skeletons = page.getByLabel('Skeletons');
  await expect(grid).toBeChecked();
  await expect(skeletons).not.toBeChecked();

  await grid.uncheck();
  await expect(canvas).not.toHaveAttribute('data-editor-helpers', /(?:^|,)grid(?:,|$)/);
  await skeletons.check();
  await expect(canvas).toHaveAttribute('data-editor-helpers', /skeletons/);

  await page.locator('#asset-import-input').setInputFiles({
    name: 'helpers-import.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createTriangleGlb()),
  });

  await expect(page.getByText(/Import complete/)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.hierarchy-row', { hasText: 'Triangle' })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-editor-helpers', /skeletons/);
  await expect(canvas).not.toHaveAttribute('data-editor-helpers', /(?:^|,)grid(?:,|$)/);
});
