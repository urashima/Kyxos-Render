import { expect, test } from '@playwright/test';
import { createTriangleGlb } from '../../packages/test-fixtures/src/index';

test('Studio groups topbar actions and generates reusable project and asset thumbnails', async ({ page }) => {
  test.setTimeout(210_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('topbar-thumbnail-parity@kyxos.local');
  await page.getByLabel('Password').fill('topbar-thumbnail-parity');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Topbar Thumbnail Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });

  const shell = page.locator('.kyxos-studio-shell');
  const slot = page.locator('.studio-topbar-slot');
  await expect(slot).toHaveAttribute('data-kx-topbar-layout', 'true');
  await expect(shell).toHaveAttribute('data-topbar-density', 'full');
  await expect(slot.locator('.kx-topbar-context')).toBeVisible();
  await expect(slot.locator('.kx-topbar-editor-tools')).toBeVisible();
  await expect(slot.locator('.kx-topbar-primary').getByRole('button', { name: 'Publish', exact: true })).toBeVisible();

  // Transform tools live in the permanent viewport rail. Their original command
  // nodes remain mounted but hidden so the rail invokes the same listeners.
  await expect(slot.locator('.tool-group[data-kx-topbar-command-source="true"]')).toBeHidden();
  const rail = page.locator('.studio-left-rail');
  for (const label of ['Select', 'Move', 'Rotate', 'Scale']) {
    await expect(rail.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  // View owns camera/view/zoom actions. Frame All is no longer a standalone
  // topbar action and sits immediately in the Zoom section after selection zoom.
  const view = slot.getByRole('button', { name: 'View', exact: true });
  await view.click();
  const viewMenu = page.locator('.kx-viewport-view-menu');
  await expect(viewMenu).toBeVisible();
  const zoomSection = viewMenu.locator('[data-section="zoom"]');
  await expect(zoomSection.getByRole('menuitem', { name: 'Zoom to Selection', exact: true })).toBeVisible();
  await expect(zoomSection.getByRole('menuitem', { name: 'Frame All', exact: true })).toBeVisible();
  await expect(slot.getByRole('button', { name: 'Frame All', exact: true })).toHaveCount(0);
  const viewGeometry = await Promise.all([view.boundingBox(), viewMenu.boundingBox()]);
  expect(viewGeometry[0]).not.toBeNull();
  expect(viewGeometry[1]).not.toBeNull();
  expect(viewGeometry[1]!.y).toBeGreaterThanOrEqual(viewGeometry[0]!.y + viewGeometry[0]!.height);
  await page.keyboard.press('Escape');
  await expect(viewMenu).toBeHidden();

  // Helpers uses the same body-level popover policy and must not be clipped by
  // the topbar's project-context overflow region.
  const helpers = slot.getByRole('button', { name: 'Helpers', exact: true });
  await helpers.click();
  const helpersMenu = page.locator('.viewport-helper-popover');
  await expect(helpersMenu).toBeVisible();
  await expect(helpersMenu.getByLabel('Ground grid')).toBeVisible();
  const helperGeometry = await Promise.all([helpers.boundingBox(), helpersMenu.boundingBox()]);
  expect(helperGeometry[0]).not.toBeNull();
  expect(helperGeometry[1]).not.toBeNull();
  expect(helperGeometry[1]!.y).toBeGreaterThanOrEqual(helperGeometry[0]!.y + helperGeometry[0]!.height);
  await page.keyboard.press('Escape');
  await expect(helpersMenu).toBeHidden();

  const more = slot.getByRole('button', { name: 'More project tools', exact: true });
  await more.click();
  const menu = page.locator('.kx-topbar-overflow-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Scenes', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Code', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Versions', exact: true })).toBeVisible();
  const overflowGeometry = await Promise.all([more.boundingBox(), menu.boundingBox()]);
  expect(overflowGeometry[0]).not.toBeNull();
  expect(overflowGeometry[1]).not.toBeNull();
  expect(overflowGeometry[1]!.y).toBeGreaterThanOrEqual(overflowGeometry[0]!.y + overflowGeometry[0]!.height);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await page.setViewportSize({ width: 1100, height: 820 });
  await expect(shell).toHaveAttribute('data-topbar-density', 'comfortable');
  await expect(slot.locator('.kx-topbar-editor-tools')).toBeVisible();
  await expect(slot.locator('.tool-group[data-kx-topbar-command-source="true"]')).toBeHidden();
  await expect(slot.getByLabel('Coordinate space')).toBeVisible();
  await expect(slot.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
  await expect(slot.getByRole('button', { name: 'View', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 900, height: 760 });
  await expect(shell).toHaveAttribute('data-topbar-density', 'compact');
  await expect(slot.locator('.kx-topbar-editor-tools')).toBeVisible();
  await expect(slot.locator('.kx-topbar-transform-cluster')).toBeHidden();
  await expect(slot.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await expect(slot.getByRole('button', { name: 'Redo', exact: true })).toBeVisible();
  await expect(slot.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
  await expect(slot.locator('.kx-topbar-primary').getByRole('button', { name: 'Publish', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 620, height: 760 });
  await expect(slot.locator('.kx-topbar-editor-tools')).toBeHidden();
  const mobileMore = page.getByRole('button', { name: 'More editor actions', exact: true });
  await expect(mobileMore).toBeVisible();
  await mobileMore.click();
  const mobileMenu = page.locator('.kx-mobile-actions-menu');
  await expect(mobileMenu).toBeVisible();
  await expect(mobileMenu.getByRole('menuitem', { name: 'Undo', exact: true })).toBeVisible();
  await expect(mobileMenu.getByRole('menuitem', { name: 'Redo', exact: true })).toBeVisible();
  await expect(mobileMenu.getByRole('menuitem', { name: 'Preview', exact: true })).toBeVisible();
  await expect(mobileMenu.getByRole('menuitem', { name: 'View', exact: true })).toBeVisible();
  await expect(mobileMenu.getByRole('menuitem', { name: 'Helpers', exact: true })).toBeVisible();
  await expect(mobileMenu.getByRole('menuitem', { name: /Projects/ })).toBeVisible();
  await expect(mobileMenu.getByRole('menuitem', { name: 'Upload', exact: true })).toBeVisible();

  await mobileMenu.getByRole('menuitem', { name: 'View', exact: true }).click();
  await expect(viewMenu).toBeVisible();
  await expect(viewMenu.locator('[data-section="zoom"]').getByRole('menuitem', { name: 'Frame All', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewMenu).toBeHidden();

  await mobileMore.click();
  await mobileMenu.getByRole('menuitem', { name: 'Helpers', exact: true }).click();
  await expect(helpersMenu).toBeVisible();
  await expect(helpersMenu.getByLabel('Ground grid')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(helpersMenu).toBeHidden();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(shell).toHaveAttribute('data-topbar-density', 'full');

  await page.locator('#asset-import-input').setInputFiles({
    name: 'thumbnail-triangle.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createTriangleGlb()),
  });
  await expect(page.locator('html')).toHaveAttribute('data-import-core-complete', 'true', { timeout: 90_000 });
  await expect(page.locator('html')).toHaveAttribute('data-import-complete-message', /Import complete/);

  const modelAssetId = await page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    return (Object.values(scene?.assets ?? {}).find((entry: any) => entry.kind === 'model') as any)?.id as string;
  });
  expect(modelAssetId).toBeTruthy();

  const assetCard = page.locator(`.asset-workspace-item[data-asset-id="${modelAssetId}"]`);
  await expect(assetCard).toBeVisible();
  await expect(assetCard).toHaveClass(/has-generated-thumbnail/, { timeout: 60_000 });
  await expect(assetCard).toHaveAttribute('data-thumbnail-renderer', 'asset-thumbnail-v5');
  const sourceHash = await page.evaluate((assetId) => {
    const asset = (globalThis as any).kyxosStudio?.api?.getScene()?.assets?.[assetId];
    return asset?.contentHash as string;
  }, modelAssetId);
  await expect(assetCard).toHaveAttribute('data-thumbnail-source-hash', sourceHash);
  await expect(assetCard.locator('.kx-asset-kind-badge')).toHaveText('3D');
  await expect(assetCard.locator('img.asset-thumbnail')).toHaveAttribute('src', /^data:image\/webp/);

  // Derived binary previews belong to the thumbnail cache, not the Scene Contract.
  await expect.poll(() => page.evaluate((assetId) => {
    const asset = (globalThis as any).kyxosStudio?.api?.getScene()?.assets?.[assetId];
    return Boolean(asset?.metadata?.thumbnailDataUrl);
  }, modelAssetId), { timeout: 30_000 }).toBe(false);

  await expect.poll(
    () => page.locator('html').getAttribute('data-project-thumbnail-state'),
    { timeout: 45_000 },
  ).toBe('saved');
  const projectId = await shell.getAttribute('data-project-id');
  expect(projectId).toBeTruthy();

  await slot.getByRole('button', { name: /Projects/ }).click();
  const card = page.locator(`.project-card[data-project-id="${projectId}"]`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  const projectThumb = card.locator('.project-thumb');
  await expect(projectThumb).toHaveAttribute('data-has-thumbnail', 'true', { timeout: 30_000 });
  await expect(projectThumb.locator('img')).toBeVisible({ timeout: 30_000 });
});
