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
  await expect(page.locator('#studio-canvas')).toHaveAttribute('data-authoring-camera', 'editor');
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

async function clickComponentHelper(
  page: import('@playwright/test').Page,
  nodeId: string,
  kind: 'camera' | 'light',
): Promise<void> {
  const canvas = page.locator('#studio-canvas');
  const target = await expect.poll(async () => {
    return canvas.evaluate((element, expected) => {
      const targets = JSON.parse(
        (element as HTMLCanvasElement).dataset.editorComponentHelperTargets ?? '[]',
      ) as Array<{ nodeId: string; kind: string; x: number; y: number; visible: boolean }>;
      return targets.find((entry) => entry.nodeId === expected.nodeId && entry.kind === expected.kind && entry.visible)
        ?? null;
    }, { nodeId, kind });
  }, { timeout: 20_000 }).not.toBeNull().then(async () => {
    return canvas.evaluate((element, expected) => {
      const targets = JSON.parse(
        (element as HTMLCanvasElement).dataset.editorComponentHelperTargets ?? '[]',
      ) as Array<{ nodeId: string; kind: string; x: number; y: number; visible: boolean }>;
      return targets.find((entry) => entry.nodeId === expected.nodeId && entry.kind === expected.kind && entry.visible)!;
    }, { nodeId, kind });
  });

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    // Empty-scene fixture makes the upper-left canvas corner a deterministic
    // selection-clear location before exercising the component helper hit path.
    await page.mouse.click(box.x + 8, box.y + 8);
    await expect(page.locator('.hierarchy-row.selected')).toHaveCount(0);
  }
  await page.mouse.click(target.x, target.y);
  await expect(page.locator(`.hierarchy-row.selected[data-node="${nodeId}"]`)).toBeVisible();
  await expect(canvas).toHaveAttribute('data-editor-helper-last-hit', nodeId);
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
    return {
      nodeId: node?.id,
      nodeTransform: node?.transform,
      componentTransform: camera?.transform,
      cameraId: camera?.id,
    };
  });
  expect(cameraState.nodeTransform).toEqual(cameraState.componentTransform);
  expect(cameraState.cameraId).toBeTruthy();
  expect(cameraState.nodeId).toBeTruthy();

  await cameraInspector.getByLabel('FOV').fill('58');
  await expect(cameraInspector.getByLabel('FOV')).toBeFocused();
  // Put the authored camera clearly inside the independent authoring camera's
  // view so the test exercises a real visible helper rather than an offscreen
  // tolerance path.
  await cameraInspector.getByLabel('Position X').fill('0');
  await expect(cameraInspector.getByLabel('Position X')).toBeFocused();
  await cameraInspector.getByLabel('Position Y').fill('2');
  await expect(cameraInspector.getByLabel('Position Y')).toBeFocused();
  await cameraInspector.getByLabel('Position Z').fill('0.5');
  await expect(cameraInspector.getByLabel('Position Z')).toBeFocused();

  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const selected = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === selected);
    const camera = scene?.cameras?.find((entry: any) => entry.id === node?.cameraId);
    return {
      fov: camera?.fov,
      nodeX: node?.transform?.position?.x,
      nodeY: node?.transform?.position?.y,
      nodeZ: node?.transform?.position?.z,
      cameraX: camera?.transform?.position?.x,
      cameraY: camera?.transform?.position?.y,
      cameraZ: camera?.transform?.position?.z,
    };
  })).toEqual({
    fov: 58,
    nodeX: 0,
    nodeY: 2,
    nodeZ: 0.5,
    cameraX: 0,
    cameraY: 2,
    cameraZ: 0.5,
  });

  await clickComponentHelper(page, cameraState.nodeId as string, 'camera');
  await expect(cameraInspector).toBeVisible();
  await cameraInspector.getByRole('button', { name: 'Set Active' }).click();
  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const selected = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === selected);
    return scene?.activeCameraId === node?.cameraId;
  })).toBe(true);
  // Runtime active-camera state must not take over the Studio authoring view.
  await expect(page.locator('#studio-canvas')).toHaveAttribute('data-authoring-camera', 'editor');
  await expect(page.locator('#studio-canvas')).toHaveAttribute(
    'data-authored-scene-camera',
    cameraState.cameraId as string,
  );

  await addHierarchyComponent(page, 'Add Spot Light');
  const lightInspector = page.locator('.kx-component-inspector').filter({ hasText: 'Light ·' });
  await expect(lightInspector).toBeVisible();
  await expect(page.locator('.hierarchy-row.selected .kx-component-badge')).toHaveText('LGT');

  const lightState = await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const selected = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === selected);
    const light = scene?.lights?.find((entry: any) => entry.id === node?.lightId);
    if (JSON.stringify(node?.transform) !== JSON.stringify(light?.transform)) return null;
    return { nodeId: node?.id ?? null, lightId: light?.id ?? null };
  })).not.toBeNull().then(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const selected = document.querySelector<HTMLElement>('.hierarchy-row.selected')?.dataset.node;
    const node = scene?.nodes?.find((entry: any) => entry.id === selected);
    return { nodeId: node?.id as string, lightId: node?.lightId as string };
  }));

  await lightInspector.getByLabel('Intensity').fill('7.5');
  await expect(lightInspector.getByLabel('Intensity')).toBeFocused();
  await lightInspector.getByLabel('Range').fill('18');
  await expect(lightInspector.getByLabel('Range')).toBeFocused();
  await lightInspector.getByLabel('Position X').fill('0');
  await lightInspector.getByLabel('Position Y').fill('1');
  await lightInspector.getByLabel('Position Z').fill('-3.5');
  await expect(lightInspector.getByLabel('Position Z')).toBeFocused();
  await lightInspector.getByLabel('Rotation X').fill('0');
  await lightInspector.getByLabel('Rotation Y').fill('0.6');
  await lightInspector.getByLabel('Rotation Z').fill('0');
  await expect(lightInspector.getByLabel('Rotation Y')).toBeFocused();
  await lightInspector.getByLabel('Inner Cone °').fill('20');
  await lightInspector.getByLabel('Outer Cone °').fill('40');
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
      nodeX: node?.transform?.position?.x,
      nodeY: node?.transform?.position?.y,
      nodeZ: node?.transform?.position?.z,
      lightX: light?.transform?.position?.x,
      lightY: light?.transform?.position?.y,
      lightZ: light?.transform?.position?.z,
      nodeRotationY: node?.transform?.rotation?.y,
      lightRotationY: light?.transform?.rotation?.y,
      innerCone: light?.innerConeAngle,
      outerCone: light?.outerConeAngle,
      bias: light?.shadow?.bias,
      normalBias: light?.shadow?.normalBias,
    };
  })).toEqual({
    intensity: 7.5,
    range: 18,
    nodeX: 0,
    nodeY: 1,
    nodeZ: -3.5,
    lightX: 0,
    lightY: 1,
    lightZ: -3.5,
    nodeRotationY: 0.6,
    lightRotationY: 0.6,
    innerCone: 20 * Math.PI / 180,
    outerCone: 40 * Math.PI / 180,
    bias: 0.0015,
    normalBias: 0.035,
  });

  const canvas = page.locator('#studio-canvas');
  await expect.poll(() => canvas.evaluate((element, expected) => {
    const entries = JSON.parse(
      (element as HTMLCanvasElement).dataset.editorLightVisualizations ?? '[]',
    ) as Array<{
      nodeId: string;
      lightId: string;
      type: string;
      selected: boolean;
      range: number | null;
      innerConeAngle: number | null;
      outerConeAngle: number | null;
      direction: [number, number, number];
    }>;
    return entries.find((entry) => entry.nodeId === expected.nodeId && entry.lightId === expected.lightId) ?? null;
  }, lightState)).toMatchObject({
    nodeId: lightState.nodeId,
    lightId: lightState.lightId,
    type: 'spot',
    selected: true,
    range: 18,
  });

  // The rendered Three.js SpotLight must use the same local -Z direction as the
  // Scene Contract / helper proxy. Rotation Y=0.6 should rotate -Z toward -X.
  await expect.poll(() => canvas.evaluate((element, lightId) => {
    const entries = JSON.parse(
      (element as HTMLCanvasElement).dataset.managedLightDirections ?? '[]',
    ) as Array<{ id: string; type: string; direction: [number, number, number] | null }>;
    return entries.find((entry) => entry.id === lightId)?.direction ?? null;
  }, lightState.lightId)).toEqual(expect.arrayContaining([
    expect.any(Number),
    expect.any(Number),
    expect.any(Number),
  ]));
  const renderedDirection = await canvas.evaluate((element, lightId) => {
    const entries = JSON.parse(
      (element as HTMLCanvasElement).dataset.managedLightDirections ?? '[]',
    ) as Array<{ id: string; direction: [number, number, number] | null }>;
    return entries.find((entry) => entry.id === lightId)?.direction ?? null;
  }, lightState.lightId);
  expect(renderedDirection).not.toBeNull();
  if (renderedDirection) {
    expect(renderedDirection[0]).toBeCloseTo(-Math.sin(0.6), 4);
    expect(renderedDirection[1]).toBeCloseTo(0, 4);
    expect(renderedDirection[2]).toBeCloseTo(-Math.cos(0.6), 4);
  }

  await clickComponentHelper(page, lightState.nodeId, 'light');
  await expect(lightInspector).toBeVisible();

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