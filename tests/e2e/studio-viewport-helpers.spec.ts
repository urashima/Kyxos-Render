import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import {
  createGltfAuthoringGlb,
  createTriangleGlb,
} from '../../packages/test-fixtures/src/index';

const KHRONOS_SAMPLE_REVISION = '2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf';
const THREE_SAMPLE_REVISION = 'b84ded15b430e73a26071ed7a20d020a41210023';

async function downloadFixture(
  request: APIRequestContext,
  url: string,
): Promise<Buffer> {
  const response = await request.get(url, { timeout: 60_000 });
  expect(response.ok(), `${url} must be downloadable`).toBe(true);
  return response.body();
}

async function createStudioProject(
  page: Page,
  email: string,
  name: string,
): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('helpers-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept(name));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
}

async function waitForImport(
  page: Page,
  previousCompletedAt?: string | null,
): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute(
    'data-import-core-complete',
    'true',
    { timeout: 90_000 },
  );
  await expect(page.locator('html')).toHaveAttribute(
    'data-import-complete-message',
    /Import complete/,
  );
  if (previousCompletedAt != null) {
    await expect.poll(
      () => page.locator('html').getAttribute('data-import-completed-at'),
      { timeout: 90_000 },
    ).not.toBe(previousCompletedAt);
  }
}

async function sceneSummary(page: Page): Promise<{
  nodeCount: number;
  assetCount: number;
  extensions: string[];
}> {
  return page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const model = Object.values(scene?.assets ?? {}).find(
      (asset: any) => asset.kind === 'model',
    ) as any;
    return {
      nodeCount: scene?.nodes?.length ?? 0,
      assetCount: Object.keys(scene?.assets ?? {}).length,
      extensions: model?.metadata?.extensionsUsed ?? [],
    };
  });
}

test('Studio viewport helpers survive GLB scene replacement', async ({ page }) => {
  test.setTimeout(180_000);
  await createStudioProject(page, 'helpers@kyxos.local', 'Viewport Helpers Fixture');

  const canvas = page.locator('#studio-canvas');
  await expect(canvas).toHaveAttribute('data-editor-helpers', /grid/);
  await expect(canvas).toHaveAttribute('data-editor-helpers', /axes/);
  await expect(canvas).toHaveAttribute('data-editor-helpers', /bounds/);

  await page.getByText('Helpers', { exact: true }).click();
  const grid = page.getByLabel('Ground grid');
  const skeletons = page.getByLabel('Skeletons');
  await expect(grid).toBeChecked();
  await expect(skeletons).not.toBeChecked();

  await grid.uncheck();
  await expect(canvas).not.toHaveAttribute('data-editor-helpers', /(?:^|,)grid(?:,|$)/);
  await skeletons.check();
  await expect(canvas).toHaveAttribute('data-editor-helpers', /skeletons/);

  await page.locator('#asset-import-input').setInputFiles({
    name: 'helpers-import.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createTriangleGlb()),
  });

  await waitForImport(page);
  await expect(page.locator('.hierarchy-row', { hasText: 'Triangle' })).toBeVisible();
  await expect(page.locator('.asset-workspace-item', { hasText: 'helpers-import.glb' })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-editor-helpers', /skeletons/);
  await expect(canvas).not.toHaveAttribute('data-editor-helpers', /(?:^|,)grid(?:,|$)/);
});

test('Studio imports, edits and reimports complete glTF authoring content', async ({ page }) => {
  test.setTimeout(240_000);
  await createStudioProject(page, 'gltf-authoring@kyxos.local', 'Complete glTF Fixture');
  const fixture = Buffer.from(createGltfAuthoringGlb());

  await page.locator('#asset-import-input').setInputFiles({
    name: 'complete-authoring.glb',
    mimeType: 'model/gltf-binary',
    buffer: fixture,
  });

  await waitForImport(page);
  for (const name of [
    'Authoring Root',
    'Skinned Morph Mesh',
    'Root Joint',
    'Imported Camera',
    'Imported Key Light',
  ]) {
    await expect(page.locator('.hierarchy-row', { hasText: name })).toBeVisible();
  }
  const assetCard = page.locator('.asset-workspace-item', {
    hasText: 'complete-authoring.glb',
  });
  await expect(assetCard).toBeVisible();
  await expect(page.getByLabel('Material variant')).toBeVisible();

  const summary = await page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const skinned = scene?.nodes?.find((node: any) => node.name === 'Skinned Morph Mesh');
    const cameraNode = scene?.nodes?.find((node: any) => node.name === 'Imported Camera');
    const lightNode = scene?.nodes?.find((node: any) => node.name === 'Imported Key Light');
    return {
      skinJoints: skinned?.skin?.joints?.length ?? 0,
      morphWeights: skinned?.morphWeights ?? [],
      morphNames: skinned?.morphTargetNames ?? [],
      cameraLinked: Boolean(cameraNode?.cameraId),
      cameraCount: scene?.cameras?.length ?? 0,
      lightLinked: Boolean(lightNode?.lightId),
      lightTypes: scene?.lights?.map((light: any) => light.type) ?? [],
      variants: scene?.materialVariants?.map((variant: any) => variant.name) ?? [],
    };
  });

  expect(summary).toMatchObject({
    skinJoints: 1,
    morphWeights: [0.2],
    morphNames: ['Raise'],
    cameraLinked: true,
    lightLinked: true,
    variants: ['Red'],
  });
  expect(summary.cameraCount).toBeGreaterThan(1);
  expect(summary.lightTypes).toContain('spot');

  await page.locator('.hierarchy-row', { hasText: 'Skinned Morph Mesh' }).click();
  await expect(page.getByText('Morph Targets', { exact: true })).toBeVisible();
  await expect(page.getByText('Skin / Joints', { exact: true })).toBeVisible();
  await expect(page.getByText(/1 · Root Joint/)).toBeVisible();

  const morphSlider = page.getByLabel('Raise morph weight');
  await expect(morphSlider).toBeVisible();
  await morphSlider.fill('0.65');
  await expect.poll(async () => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    return scene?.nodes?.find((node: any) => node.name === 'Skinned Morph Mesh')
      ?.morphWeights?.[0];
  })).toBeCloseTo(0.65, 3);

  const previousCompletedAt = await page.locator('html').getAttribute('data-import-completed-at');
  const chooserPromise = page.waitForEvent('filechooser');
  await assetCard.getByRole('button', { name: 'Reimport' }).click();
  const chooser = await chooserPromise;
  page.once('dialog', (dialog) => dialog.accept('keep-overrides'));
  await chooser.setFiles({
    name: 'complete-authoring.glb',
    mimeType: 'model/gltf-binary',
    buffer: fixture,
  });
  await waitForImport(page, previousCompletedAt);
  await expect.poll(async () => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    return scene?.nodes?.find((node: any) => node.name === 'Skinned Morph Mesh')
      ?.morphWeights?.[0];
  })).toBeCloseTo(0.65, 3);
});

test('Studio bundles external glTF resources and decodes Draco', async ({ page, request }) => {
  test.setTimeout(240_000);
  await createStudioProject(page, 'draco@kyxos.local', 'Draco External Fixture');
  const base = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${KHRONOS_SAMPLE_REVISION}/Models/Box/glTF-Draco`;
  const [gltf, binary] = await Promise.all([
    downloadFixture(request, `${base}/Box.gltf`),
    downloadFixture(request, `${base}/Box.bin`),
  ]);

  await page.locator('#asset-import-input').setInputFiles([
    { name: 'Box.gltf', mimeType: 'model/gltf+json', buffer: gltf },
    { name: 'Box.bin', mimeType: 'application/octet-stream', buffer: binary },
  ]);

  await waitForImport(page);
  const summary = await sceneSummary(page);
  expect(summary.nodeCount).toBeGreaterThan(0);
  expect(summary.assetCount).toBeGreaterThan(0);
  expect(summary.extensions).toContain('KHR_draco_mesh_compression');
});

test('Studio decodes Meshopt geometry with KTX2 Basis textures', async ({ page, request }) => {
  test.setTimeout(240_000);
  await createStudioProject(page, 'meshopt-ktx2@kyxos.local', 'Meshopt KTX2 Fixture');
  const url = `https://raw.githubusercontent.com/mrdoob/three.js/${THREE_SAMPLE_REVISION}/examples/models/gltf/coffeemat.glb`;
  const fixture = await downloadFixture(request, url);

  await page.locator('#asset-import-input').setInputFiles({
    name: 'coffeemat.glb',
    mimeType: 'model/gltf-binary',
    buffer: fixture,
  });

  await waitForImport(page);
  const summary = await sceneSummary(page);
  expect(summary.nodeCount).toBeGreaterThan(0);
  expect(summary.assetCount).toBeGreaterThan(0);
  expect(summary.extensions).toContain('EXT_meshopt_compression');
  expect(summary.extensions).toContain('KHR_texture_basisu');
});
