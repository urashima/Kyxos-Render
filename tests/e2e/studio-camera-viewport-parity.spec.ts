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

async function addCamera(
  page: import('@playwright/test').Page,
): Promise<{ cameraId: string; nodeId: string; name: string }> {
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
    return { cameraId: camera?.id as string, nodeId: node?.id as string, name: camera?.name as string };
  });
  expect(result.cameraId).toBeTruthy();
  expect(result.nodeId).toBeTruthy();
  return result;
}

test('Studio keeps an independent authoring camera and explicitly views through authored cameras', async ({ page }) => {
  test.setTimeout(180_000);
  await createStudioProject(page);

  const canvas = page.locator('#studio-canvas');
  await expect(canvas).toHaveAttribute('data-authoring-camera', 'editor');

  const camera = await addCamera(page);
  const cameraInspector = page.locator('.kx-component-inspector').filter({ hasText: 'Camera ·' }).first();
  await expect(cameraInspector).toBeVisible();
  const cameraRuntime = page.locator('.kx-camera-runtime');
  await expect(cameraRuntime).toBeVisible();
  const frustumCulling = cameraRuntime.getByLabel('Frustum Culling');
  await expect(frustumCulling).toBeChecked();
  await frustumCulling.uncheck();
  await expect.poll(() => page.evaluate((cameraId) => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    return scene?.cameras?.find((entry: any) => entry.id === cameraId)?.frustumCulling;
  }, camera.cameraId)).toBe(false);

  // Selecting an authored camera opens a separate low-resolution live runtime
  // preview instead of reusing or stealing the authoring viewport.
  const preview = page.getByRole('region', { name: 'Camera preview' });
  await expect(preview).toBeVisible({ timeout: 60_000 });
  await expect(preview.locator('.kx-camera-preview-title')).toHaveText(camera.name);
  const previewCanvas = preview.getByLabel('Live camera preview canvas');
  await expect.poll(() => previewCanvas.getAttribute('data-camera-preview-status')).toBe('ready');
  await expect(previewCanvas).toHaveAttribute('data-camera-preview-id', camera.cameraId);
  await expect(previewCanvas).toHaveAttribute('data-managed-camera-frustum-culling', 'false');

  // Reparent the authored camera beneath a translated/rotated rig. The runtime
  // preview must recompute position and target from the complete node hierarchy,
  // not keep treating the camera's local transform as world space.
  await page.evaluate(({ nodeId }) => {
    const api = (globalThis as any).kyxosStudio?.api;
    const scene = api?.getScene();
    const rigId = crypto.randomUUID();
    const nodes = scene.nodes.map((node: any) => node.id === nodeId
      ? { ...node, parentId: rigId }
      : structuredClone(node));
    nodes.push({
      id: rigId,
      name: 'Camera Rig',
      parentId: null,
      children: [nodeId],
      transform: {
        position: { x: 1, y: 0, z: 0 },
        rotation: { x: 0, y: Math.PI / 2, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      visible: true,
      metadata: { type: 'empty' },
    });
    api.applyPatch('Parent camera under rig', [{ op: 'replace', path: '/nodes', value: nodes }]);
  }, { nodeId: camera.nodeId });

  const managedCamera = await expect.poll(() => previewCanvas.evaluate((element) => {
    const value = (element as HTMLCanvasElement).dataset.managedCameraWorld;
    return value ? JSON.parse(value) : null;
  })).not.toBeNull().then(() => previewCanvas.evaluate((element) => {
    return JSON.parse((element as HTMLCanvasElement).dataset.managedCameraWorld ?? 'null');
  }));
  expect(managedCamera.id).toBe(camera.cameraId);
  expect(managedCamera.position.x).toBeCloseTo(5.8, 4);
  expect(managedCamera.position.y).toBeCloseTo(2.4, 4);
  expect(managedCamera.position.z).toBeCloseTo(-3.4, 4);
  expect(managedCamera.target.x).toBeCloseTo(1, 4);
  expect(managedCamera.target.y).toBeCloseTo(0.9, 4);
  expect(managedCamera.target.z).toBeCloseTo(0, 4);

  const pinPreview = preview.getByRole('button', { name: 'Pin camera preview' });
  await pinPreview.click();
  await expect(pinPreview).toHaveAttribute('aria-pressed', 'true');
  await preview.getByTitle('Collapse camera preview').click();
  await expect(preview).toHaveClass(/kx-camera-preview-collapsed/);
  await preview.getByTitle('Expand camera preview').click();
  await expect(preview).not.toHaveClass(/kx-camera-preview-collapsed/);

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
  await expect(canvas).toHaveAttribute('data-managed-camera-frustum-culling', 'false');
  await expect(preview).toHaveAttribute('data-view-through', 'true');

  // Camera edits remain scene data while view-through is explicit and the live
  // preview keeps the same camera binding through Scene Contract patches.
  await cameraInspector.getByLabel('FOV').fill('61');
  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const active = scene?.cameras?.find((entry: any) => entry.id === scene.activeCameraId);
    return active?.fov;
  })).toBe(61);
  await expect(canvas).toHaveAttribute('data-editor-scene-camera-view', camera.cameraId);
  await expect(previewCanvas).toHaveAttribute('data-camera-preview-id', camera.cameraId);
  await expect(previewCanvas).toHaveAttribute('data-managed-camera-frustum-culling', 'false');

  await viewportView.selectOption('perspective');
  await expect(canvas).toHaveAttribute('data-authoring-camera', 'editor');
  await expect(canvas).not.toHaveAttribute('data-editor-scene-camera-view', camera.cameraId);
  await expect(canvas).toHaveAttribute('data-managed-camera-frustum-culling', 'true');
  await expect(preview).toHaveAttribute('data-view-through', 'false');
  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    return scene?.activeCameraId;
  })).toBe(camera.cameraId);
});