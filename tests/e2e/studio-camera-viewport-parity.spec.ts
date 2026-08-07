import { expect, test } from '@playwright/test';

async function createStudioProject(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('camera-viewport-parity@kyxos.local');
  await page.getByLabel('Password').fill('camera-viewport-parity');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Camera Viewport Parity Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
}

async function addCamera(page: import('@playwright/test').Page): Promise<{ cameraId: string; name: string }> {
  const hierarchy = page.locator('.studio-hierarchy');
  await hierarchy.getByRole('button', { name: 'Add', exact: true }).click();
  const menu = page.locator('.studio-context-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Add Camera', exact: true }).click();
  const result = await page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const selected = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === selected);
    const camera = scene?.cameras?.find((entry: any) => entry.id === node?.cameraId);
    return { cameraId: camera?.id as string, name: camera?.name as string };
  });
  expect(result.cameraId).toBeTruthy();
  return result;
}

test('Studio keeps an independent authoring camera and explicitly views through authored cameras', async ({ page }) => {
  test.setTimeout(180_000);
  await createStudioProject(page);

  const canvas = page.locator('#studio-canvas');
  await expect(canvas).toHaveAttribute('data-authoring-camera', 'editor');

  const camera = await addCamera(page);
  const cameraInspector = page.locator('.kx-component-inspector').filter({ hasText: 'Camera ·' });
  await expect(cameraInspector).toBeVisible();
  await cameraInspector.getByRole('button', { name: 'Set Active' }).click();

  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    return scene?.activeCameraId;
  })).toBe(camera.cameraId);

  // Runtime scene state is independent: making a camera Active must not steal
  // the authoring viewport from the editor camera.
  await expect(canvas).toHaveAttribute('data-authoring-camera', 'editor');
  await expect(canvas).toHaveAttribute('data-authored-scene-camera', camera.cameraId);

  const viewportView = page.getByLabel('Viewport view');
  await viewportView.focus();
  await expect(viewportView.locator(`option[value="scene:${camera.cameraId}"]`)).toHaveText(
    `${camera.name} · Active`,
  );

  await viewportView.selectOption(`scene:${camera.cameraId}`);
  await expect(canvas).toHaveAttribute('data-authoring-camera', 'scene');
  await expect(canvas).toHaveAttribute('data-editor-scene-camera-view', camera.cameraId);

  // Camera edits remain scene data while view-through is explicit. Returning to
  // an Editor Camera is equally explicit and leaves activeCameraId unchanged.
  await cameraInspector.getByLabel('FOV').fill('61');
  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const active = scene?.cameras?.find((entry: any) => entry.id === scene.activeCameraId);
    return active?.fov;
  })).toBe(61);
  await expect(canvas).toHaveAttribute('data-editor-scene-camera-view', camera.cameraId);

  await viewportView.selectOption('perspective');
  await expect(canvas).toHaveAttribute('data-authoring-camera', 'editor');
  await expect(canvas).not.toHaveAttribute('data-editor-scene-camera-view', camera.cameraId);
  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    return scene?.activeCameraId;
  })).toBe(camera.cameraId);
});