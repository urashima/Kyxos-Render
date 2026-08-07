import { expect, test } from '@playwright/test';

test('floats and collapses editor panels while camera and light edits persist through Studio API', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 980 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('viewport-parity@kyxos.local');
  await page.getByLabel('Password').fill('viewport-parity');
  await page.getByRole('button', { name: 'Sign in' }).click();

  page.once('dialog', (dialog) => dialog.accept('Viewport Parity Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });

  const hierarchy = page.locator('.studio-hierarchy');
  const inspector = page.locator('.studio-inspector');
  const assets = page.locator('.studio-assets');
  await page.getByRole('button', { name: 'Float Panels' }).click();
  await expect(hierarchy).toHaveAttribute('data-kx-panel-mode', 'floating');
  await expect(inspector).toHaveAttribute('data-kx-panel-mode', 'floating');
  await expect(assets).toHaveAttribute('data-kx-panel-mode', 'floating');
  await expect(assets).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  await hierarchy.getByRole('button', { name: 'Collapse Hierarchy' }).click();
  await expect(hierarchy).toHaveAttribute('data-collapsed', 'true');
  await expect(hierarchy.locator('.hierarchy-content')).toBeHidden();
  await hierarchy.getByRole('button', { name: 'Expand Hierarchy' }).click();
  await expect(hierarchy).toHaveAttribute('data-collapsed', 'false');

  await page.getByRole('button', { name: 'Dock Panels' }).click();
  await expect(hierarchy).toHaveAttribute('data-kx-panel-mode', 'docked');
  await expect(inspector).toHaveAttribute('data-kx-panel-mode', 'docked');
  await expect(assets).toHaveAttribute('data-kx-panel-mode', 'docked');

  const hierarchyPanel = page.locator('.studio-hierarchy');
  await hierarchyPanel.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Camera' }).click();
  await hierarchyPanel.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Point Light' }).click();

  const entityTools = page.getByRole('complementary', {
    name: 'Viewport objects, cameras and lights',
  });
  await expect(entityTools).toBeVisible();
  await expect(entityTools.locator('[data-kx-entity-counts]')).toContainText('cameras');
  await expect(entityTools.locator('[data-kx-entity-counts]')).toContainText('lights');

  await entityTools.locator('[data-kx-entity-filter]').selectOption('camera');
  const cameraItem = entityTools.locator('.kx-entity-list-item').filter({ hasText: 'Camera' }).first();
  await expect(cameraItem).toBeVisible();
  await cameraItem.click();
  const fov = entityTools.getByLabel('Camera field of view');
  await fov.fill('61');
  await fov.press('Tab');
  await expect.poll(() => page.evaluate(() => {
    const studio = (globalThis as typeof globalThis & {
      kyxosStudio?: { api?: { getScene(): { cameras: Array<{ fov: number }> } } };
    }).kyxosStudio;
    return studio?.api?.getScene().cameras.at(-1)?.fov;
  })).toBe(61);
  await entityTools.getByRole('button', { name: 'Set Active' }).click();
  await expect.poll(() => page.evaluate(() => {
    const studio = (globalThis as typeof globalThis & {
      kyxosStudio?: { api?: { getScene(): { activeCameraId: string; cameras: Array<{ id: string }> } } };
    }).kyxosStudio;
    const scene = studio?.api?.getScene();
    return Boolean(scene && scene.activeCameraId === scene.cameras.at(-1)?.id);
  })).toBe(true);

  await entityTools.locator('[data-kx-entity-filter]').selectOption('light');
  const lightItem = entityTools.locator('.kx-entity-list-item').filter({ hasText: 'Point Light' }).first();
  await expect(lightItem).toBeVisible();
  await lightItem.click();
  const intensity = entityTools.getByLabel('Light intensity');
  await intensity.fill('3.5');
  await intensity.press('Tab');
  await expect.poll(() => page.evaluate(() => {
    const studio = (globalThis as typeof globalThis & {
      kyxosStudio?: { api?: { getScene(): { lights?: Array<{ intensity: number }> } } };
    }).kyxosStudio;
    return studio?.api?.getScene().lights?.at(-1)?.intensity;
  })).toBe(3.5);

  await entityTools.getByRole('button', { name: 'Collapse scene objects' }).click();
  await expect(entityTools).toHaveClass(/collapsed/);
  await entityTools.getByRole('button', { name: 'Collapse scene objects' }).click();
  await expect(entityTools).not.toHaveClass(/collapsed/);
});
