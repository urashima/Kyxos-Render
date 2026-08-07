import { expect, test } from '@playwright/test';

async function createStudioProject(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('camera-light-parity@kyxos.local');
  await page.getByLabel('Password').fill('camera-light-parity');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Camera Light Parity Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
}

async function addHierarchyComponent(
  page: import('@playwright/test').Page,
  label: string,
): Promise<void> {
  const hierarchy = page.locator('.studio-hierarchy');
  await hierarchy.getByRole('button', { name: 'Add', exact: true }).click();
  const menu = page.locator('.studio-context-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: label, exact: true }).click();
}

test('Studio camera and light selection, inspector edits and transforms stay synchronized', async ({ page }) => {
  test.setTimeout(180_000);
  await createStudioProject(page);

  await addHierarchyComponent(page, 'Add Camera');
  const cameraInspector = page.locator('.kx-component-inspector').filter({ hasText: 'Camera ·' });
  await expect(cameraInspector).toBeVisible();
  await expect(page.locator('.hierarchy-row.selected .kx-component-badge')).toHaveText('CAM');

  const cameraState = await page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const selected = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.cameraId && entry.id === selected);
    const camera = scene?.cameras?.find((entry: any) => entry.id === node?.cameraId);
    return { nodeTransform: node?.transform, componentTransform: camera?.transform, cameraId: camera?.id };
  });
  expect(cameraState.nodeTransform).toEqual(cameraState.componentTransform);
  expect(cameraState.cameraId).toBeTruthy();

  await cameraInspector.getByLabel('FOV').fill('58');
  await expect(cameraInspector.getByLabel('FOV')).toBeFocused();
  await cameraInspector.getByLabel('Position X').fill('5.25');
  await expect(cameraInspector.getByLabel('Position X')).toBeFocused();
  await cameraInspector.getByLabel('Position Y').fill('2.75');
  await expect(cameraInspector.getByLabel('Position Y')).toBeFocused();

  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const selected = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === selected);
    const camera = scene?.cameras?.find((entry: any) => entry.id === node?.cameraId);
    return {
      fov: camera?.fov,
      nodeX: node?.transform?.position?.x,
      nodeY: node?.transform?.position?.y,
      cameraX: camera?.transform?.position?.x,
      cameraY: camera?.transform?.position?.y,
    };
  })).toEqual({ fov: 58, nodeX: 5.25, nodeY: 2.75, cameraX: 5.25, cameraY: 2.75 });

  await cameraInspector.getByRole('button', { name: 'Set Active' }).click();
  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const selected = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === selected);
    return scene?.activeCameraId === node?.cameraId;
  })).toBe(true);

  await addHierarchyComponent(page, 'Add Spot Light');
  const lightInspector = page.locator('.kx-component-inspector').filter({ hasText: 'Light ·' });
  await expect(lightInspector).toBeVisible();
  await expect(page.locator('.hierarchy-row.selected .kx-component-badge')).toHaveText('LGT');

  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const selected = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === selected);
    const light = scene?.lights?.find((entry: any) => entry.id === node?.lightId);
    return JSON.stringify(node?.transform) === JSON.stringify(light?.transform);
  })).toBe(true);

  await lightInspector.getByLabel('Intensity').fill('7.5');
  await expect(lightInspector.getByLabel('Intensity')).toBeFocused();
  await lightInspector.getByLabel('Range').fill('18');
  await expect(lightInspector.getByLabel('Range')).toBeFocused();
  await lightInspector.getByLabel('Position Z').fill('-3.5');
  await expect(lightInspector.getByLabel('Position Z')).toBeFocused();
  await lightInspector.getByLabel('Shadow Bias').fill('0.0015');
  await lightInspector.getByLabel('Normal Bias').fill('0.035');

  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const selected = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === selected);
    const light = scene?.lights?.find((entry: any) => entry.id === node?.lightId);
    return {
      intensity: light?.intensity,
      range: light?.range,
      nodeZ: node?.transform?.position?.z,
      lightZ: light?.transform?.position?.z,
      bias: light?.shadow?.bias,
      normalBias: light?.shadow?.normalBias,
    };
  })).toEqual({
    intensity: 7.5,
    range: 18,
    nodeZ: -3.5,
    lightZ: -3.5,
    bias: 0.0015,
    normalBias: 0.035,
  });

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const selected = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === selected);
    const light = scene?.lights?.find((entry: any) => entry.id === node?.lightId);
    return light?.shadow?.normalBias ?? null;
  })).not.toBe(0.035);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const selected = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === selected);
    const light = scene?.lights?.find((entry: any) => entry.id === node?.lightId);
    return light?.shadow?.normalBias;
  })).toBe(0.035);
});
