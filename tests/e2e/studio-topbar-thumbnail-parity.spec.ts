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

  const more = slot.getByRole('button', { name: 'More project tools', exact: true });
  await more.click();
  const menu = slot.locator('.kx-topbar-overflow-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Scenes', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Code', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Versions', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await page.locator('#asset-import-input').setInputFiles({
    name: 'thumbnail-triangle.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createTriangleGlb()),
  });
  await expect(page.locator('html')).toHaveAttribute('data-import-core-complete', 'true', { timeout: 90_000 });
  await expect(page.locator('html')).toHaveAttribute('data-import-complete-message', /Import complete/);

  const modelAssetId = await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const asset = Object.values(scene?.assets ?? {}).find((entry: any) => entry.kind === 'model') as any;
    return asset?.metadata?.thumbnailRenderer === 'asset-thumbnail-v2' ? asset.id : null;
  }), { timeout: 60_000 }).not.toBeNull().then(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    return (Object.values(scene?.assets ?? {}).find((entry: any) => entry.kind === 'model') as any)?.id as string;
  }));
  expect(modelAssetId).toBeTruthy();

  const assetCard = page.locator(`.asset-workspace-item[data-asset-id="${modelAssetId}"]`);
  await expect(assetCard).toBeVisible();
  await expect(assetCard).toHaveClass(/has-generated-thumbnail/);
  await expect(assetCard.locator('.kx-asset-kind-badge')).toHaveText('3D');
  const assetImage = assetCard.locator('img.asset-thumbnail');
  if (await assetImage.count()) await expect(assetImage).toHaveAttribute('src', /^data:image\/webp/);

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
