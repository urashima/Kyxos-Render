import { expect, test, type Page } from '@playwright/test';

async function openEmptyProject(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('viewport-navigation@kyxos.local');
  await page.getByLabel('Password').fill('viewport-navigation-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Viewport Navigation Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
}

test('orthographic view presets and frame all preserve native transform state', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openEmptyProject(page);

  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('menuitem', { name: 'Add Empty' }).click();
  const row = page.locator('.hierarchy-row').first();
  await expect(row).toBeVisible();
  const nodeId = await row.getAttribute('data-node');
  expect(nodeId).toBeTruthy();

  await page.getByRole('button', { name: 'Move' }).click();
  const canvas = page.locator('#studio-canvas');
  await expect(canvas).toHaveAttribute('data-editor-tool', 'translate');
  await expect(canvas).toHaveAttribute('data-editor-selection', nodeId!);

  const views = page.getByLabel('Viewport view');
  await views.selectOption('front');
  await expect(canvas).toHaveAttribute('data-editor-view', 'front');
  await expect(canvas).toHaveAttribute('data-editor-camera-projection', 'orthographic');
  await expect(canvas).toHaveAttribute('data-editor-gizmo', 'three-transform-controls');
  await expect(canvas).toHaveAttribute('data-editor-tool', 'translate');
  await expect(canvas).toHaveAttribute('data-editor-selection', nodeId!);

  await views.selectOption('top');
  await expect(canvas).toHaveAttribute('data-editor-view', 'top');
  await expect(canvas).toHaveAttribute('data-editor-camera-projection', 'orthographic');

  await views.selectOption('perspective');
  await expect(canvas).toHaveAttribute('data-editor-view', 'perspective');
  await expect(canvas).toHaveAttribute('data-editor-camera-projection', 'perspective');

  await page.getByRole('button', { name: 'Frame All' }).click();
  await expect.poll(async () => canvas.getAttribute('data-editor-frame-all-at')).not.toBeNull();
  expect(pageErrors).toEqual([]);
});
