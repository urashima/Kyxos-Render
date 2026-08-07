import { expect, test } from '@playwright/test';

async function createProject(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('camera-light-parity@kyxos.local');
  await page.getByLabel('Password').fill('camera-light-parity');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Camera Light Parity Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#studio-canvas')).toHaveAttribute('data-authoring-camera', 'editor');
}

async function addComponent(page: import('@playwright/test').Page, label: string): Promise<void> {
  await page.locator('.studio-hierarchy').getByRole('button', { name: 'Add', exact: true }).click();
  const menu = page.locator('.studio-context-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: label, exact: true }).click();
}

async function selectedIds(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const id = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === id);
    return { nodeId: node?.id as string, cameraId: node?.cameraId as string | undefined, lightId: node?.lightId as string | undefined };
  });
}

async function clickHelper(
  page: import('@playwright/test').Page,
  nodeId: string,
  kind: 'camera' | 'light',
): Promise<void> {
  const canvas = page.locator('#studio-canvas');
  const target = await expect.poll(() => canvas.evaluate((element, expected) => {
    const values = JSON.parse((element as HTMLCanvasElement).dataset.editorComponentHelperTargets ?? '[]') as Array<{
      nodeId: string; kind: string; x: number; y: number; visible: boolean;
    }>;
    return values.find((value) => value.nodeId === expected.nodeId && value.kind === expected.kind && value.visible) ?? null;
  }, { nodeId, kind }), { timeout: 20_000 }).not.toBeNull().then(() =>
    canvas.evaluate((element, expected) => {
      const values = JSON.parse((element as HTMLCanvasElement).dataset.editorComponentHelperTargets ?? '[]') as Array<{
        nodeId: string; kind: string; x: number; y: number; visible: boolean;
      }>;
      return values.find((value) => value.nodeId === expected.nodeId && value.kind === expected.kind && value.visible)!;
    }, { nodeId, kind }),
  );
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box) await page.mouse.click(box.x + 8, box.y + 8);
  await page.mouse.click(target.x, target.y);
  await expect(page.locator(`.hierarchy-row.selected[data-node="${nodeId}"]`)).toBeVisible();
  await expect(canvas).toHaveAttribute('data-editor-helper-last-hit', nodeId);
}

test('Studio camera and light selection, inspector edits and transforms stay synchronized', async ({ page }) => {
  test.setTimeout(180_000);
  await createProject(page);

  await addComponent(page, 'Add Camera');
  const cameraInspector = page.locator('.kx-component-inspector').filter({ hasText: 'Camera ·' });
  await expect(cameraInspector).toBeVisible();
  await expect(page.locator('.hierarchy-row.selected .kx-component-badge')).toHaveText('CAM');
  const camera = await selectedIds(page);
  expect(camera.cameraId).toBeTruthy();

  await cameraInspector.getByLabel('FOV').fill('58');
  await cameraInspector.getByLabel('Position X').fill('0');
  await cameraInspector.getByLabel('Position Y').fill('2');
  await cameraInspector.getByLabel('Position Z').fill('0.5');
  await expect(cameraInspector.getByLabel('Position Z')).toBeFocused();
  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const selected = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === selected);
    const component = scene?.cameras?.find((entry: any) => entry.id === node?.cameraId);
    return { node: node?.transform, component: component?.transform, fov: component?.fov };
  })).toEqual({
    node: { position: { x: 0, y: 2, z: 0.5 }, rotation: expect.any(Object), scale: { x: 1, y: 1, z: 1 } },
    component: { position: { x: 0, y: 2, z: 0.5 }, rotation: expect.any(Object), scale: { x: 1, y: 1, z: 1 } },
    fov: 58,
  });

  await clickHelper(page, camera.nodeId, 'camera');
  await cameraInspector.getByRole('button', { name: 'Set Active' }).click();
  await expect(page.locator('#studio-canvas')).toHaveAttribute('data-authoring-camera', 'editor');
  await expect(page.locator('#studio-canvas')).toHaveAttribute('data-authored-scene-camera', camera.cameraId!);

  await addComponent(page, 'Add Spot Light');
  const lightInspector = page.locator('.kx-component-inspector').filter({ hasText: 'Light ·' });
  await expect(lightInspector).toBeVisible();
  await expect(page.locator('.hierarchy-row.selected .kx-component-badge')).toHaveText('LGT');
  const light = await selectedIds(page);
  expect(light.lightId).toBeTruthy();

  await lightInspector.getByLabel('Intensity').fill('7.5');
  await lightInspector.getByLabel('Range').fill('18');
  await lightInspector.getByLabel('Position X').fill('0');
  await lightInspector.getByLabel('Position Y').fill('1');
  await lightInspector.getByLabel('Position Z').fill('-3.5');
  await lightInspector.getByLabel('Rotation X').fill('0');
  await lightInspector.getByLabel('Rotation Y').fill('0.6');
  await lightInspector.getByLabel('Rotation Z').fill('0');
  await expect(lightInspector.getByLabel('Rotation Z')).toBeFocused();
  await lightInspector.getByLabel('Inner Cone °').fill('20');
  await lightInspector.getByLabel('Outer Cone °').fill('40');
  await lightInspector.getByLabel('Shadow Bias').fill('0.0015');
  await lightInspector.getByLabel('Normal Bias').fill('0.035');

  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const selected = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === selected);
    const component = scene?.lights?.find((entry: any) => entry.id === node?.lightId);
    return {
      nodePosition: node?.transform?.position,
      lightPosition: component?.transform?.position,
      nodeRotationY: node?.transform?.rotation?.y,
      lightRotationY: component?.transform?.rotation?.y,
      intensity: component?.intensity,
      range: component?.range,
      bias: component?.shadow?.bias,
      normalBias: component?.shadow?.normalBias,
    };
  })).toEqual({
    nodePosition: { x: 0, y: 1, z: -3.5 },
    lightPosition: { x: 0, y: 1, z: -3.5 },
    nodeRotationY: 0.6,
    lightRotationY: 0.6,
    intensity: 7.5,
    range: 18,
    bias: 0.0015,
    normalBias: 0.035,
  });

  const canvas = page.locator('#studio-canvas');
  await expect.poll(() => canvas.evaluate((element, expected) => {
    const values = JSON.parse((element as HTMLCanvasElement).dataset.editorLightVisualizations ?? '[]') as Array<any>;
    return values.find((value) => value.nodeId === expected.nodeId && value.lightId === expected.lightId) ?? null;
  }, light)).toMatchObject({ nodeId: light.nodeId, lightId: light.lightId, type: 'spot', selected: true, range: 18 });

  const direction = await expect.poll(() => canvas.evaluate((element, lightId) => {
    const values = JSON.parse((element as HTMLCanvasElement).dataset.managedLightDirections ?? '[]') as Array<any>;
    return values.find((value) => value.id === lightId)?.direction ?? null;
  }, light.lightId)).not.toBeNull().then(() => canvas.evaluate((element, lightId) => {
    const values = JSON.parse((element as HTMLCanvasElement).dataset.managedLightDirections ?? '[]') as Array<any>;
    return values.find((value) => value.id === lightId)?.direction as [number, number, number] | null;
  }, light.lightId));
  expect(direction).not.toBeNull();
  if (direction) {
    expect(direction[0]).toBeCloseTo(-Math.sin(0.6), 4);
    expect(direction[1]).toBeCloseTo(0, 4);
    expect(direction[2]).toBeCloseTo(-Math.cos(0.6), 4);
  }

  await clickHelper(page, light.nodeId, 'light');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const id = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === id);
    return scene?.lights?.find((entry: any) => entry.id === node?.lightId)?.shadow?.normalBias ?? null;
  })).not.toBe(0.035);
});
