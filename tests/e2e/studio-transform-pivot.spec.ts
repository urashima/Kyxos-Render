import { expect, test } from '@playwright/test';

test('Studio preserves Active Pivot / Center through editor camera projection changes', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('pivot@kyxos.local');
  await page.getByLabel('Password').fill('pivot-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Transform Pivot Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();

  const canvas = page.locator('#studio-canvas');
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  const pivot = page.getByLabel('Transform pivot');
  await expect(pivot).toBeVisible();
  await expect(pivot).toHaveValue('active');

  await pivot.selectOption('center');
  await expect(canvas).toHaveAttribute('data-editor-pivot', 'center');

  const view = page.getByLabel('Viewport view');
  await view.selectOption('front');
  await expect(canvas).toHaveAttribute('data-editor-camera-projection', 'orthographic');
  await expect(canvas).toHaveAttribute('data-editor-pivot', 'center');
  await expect(pivot).toHaveValue('center');

  await view.selectOption('perspective');
  await expect(canvas).toHaveAttribute('data-editor-camera-projection', 'perspective');
  await expect(canvas).toHaveAttribute('data-editor-pivot', 'center');
});
