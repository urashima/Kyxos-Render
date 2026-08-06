import { expect, test } from '@playwright/test';

test('selects Cameras and Lights from projected viewport icons', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 960 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('viewport-icons@kyxos.local');
  await page.getByLabel('Password').fill('viewport-icons');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Viewport Icon Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });

  const hierarchy = page.locator('.studio-hierarchy');
  await hierarchy.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Camera' }).click();
  await hierarchy.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Point Light' }).click();

  const ids = await page.evaluate(() => {
    const studio = (globalThis as typeof globalThis & {
      kyxosStudio?: {
        api?: {
          getScene(): {
            nodes: Array<{ id: string; cameraId?: string; lightId?: string }>;
            cameras: Array<{
              id: string;
              transform: { position: { x: number; y: number; z: number } };
            }>;
          };
        };
      };
    }).kyxosStudio;
    const scene = studio?.api?.getScene();
    const cameraNode = scene?.nodes.find((node) => node.cameraId);
    const camera = scene?.cameras.find((entry) => entry.id === cameraNode?.cameraId);
    return {
      camera: cameraNode?.id,
      light: scene?.nodes.find((node) => node.lightId)?.id,
      cameraPosition: camera?.transform.position,
    };
  });
  expect(ids.camera).toBeTruthy();
  expect(ids.light).toBeTruthy();
  expect(ids.cameraPosition).toBeTruthy();

  const cameraIcon = page.locator(`.kx-viewport-entity-icon[data-node-id="${ids.camera}"]`);
  const lightIcon = page.locator(`.kx-viewport-entity-icon[data-node-id="${ids.light}"]`);
  await expect(cameraIcon).toBeVisible({ timeout: 10_000 });
  await expect(lightIcon).toBeVisible({ timeout: 10_000 });

  await cameraIcon.click();
  await expect.poll(() => page.evaluate(() => {
    const studio = (globalThis as typeof globalThis & {
      kyxosStudio?: { api?: { getSelection(): string[] } };
    }).kyxosStudio;
    return studio?.api?.getSelection() ?? [];
  })).toEqual([ids.camera]);

  await lightIcon.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await expect.poll(() => page.evaluate(() => {
    const studio = (globalThis as typeof globalThis & {
      kyxosStudio?: { api?: { getSelection(): string[] } };
    }).kyxosStudio;
    return studio?.api?.getSelection() ?? [];
  })).toEqual(expect.arrayContaining([ids.camera, ids.light]));

  const helpers = page.locator('.viewport-helper-menu');
  await helpers.locator('summary').click();
  await helpers.getByLabel('Camera helpers').uncheck();
  await expect(cameraIcon).toBeHidden();
  await expect(lightIcon).toBeVisible();
  await helpers.getByLabel('Camera helpers').check();
  await expect(cameraIcon).toBeVisible();

  await cameraIcon.dblclick();
  const editorPosition = await page.locator('#studio-canvas').evaluate(
    (canvas: HTMLCanvasElement) => new Promise<{ x: number; y: number; z: number }>((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = window.setTimeout(() => {
        canvas.removeEventListener('kyxos:editor-camera-bookmark-state', onState);
        reject(new Error('Editor camera capture timed out.'));
      }, 2_000);
      const onState = (event: Event) => {
        const detail = (event as CustomEvent<{
          requestId: string;
          state: { camera: { transform: { position: { x: number; y: number; z: number } } } };
        }>).detail;
        if (detail.requestId !== requestId) return;
        window.clearTimeout(timeout);
        canvas.removeEventListener('kyxos:editor-camera-bookmark-state', onState);
        resolve(detail.state.camera.transform.position);
      };
      canvas.addEventListener('kyxos:editor-camera-bookmark-state', onState);
      canvas.dispatchEvent(new CustomEvent('kyxos:editor-viewport-command', {
        detail: { command: 'capture-bookmark', requestId },
      }));
    }),
  );
  expect(editorPosition).toEqual(ids.cameraPosition);
});
