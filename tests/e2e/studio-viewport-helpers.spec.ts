import { expect, test, type Page } from '@playwright/test';
import {
  createGltfAuthoringGlb,
  createTriangleGlb,
} from '../../packages/test-fixtures/src/index';

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

async function waitForImport(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute(
    'data-import-core-complete',
    'true',
    { timeout: 90_000 },
  );
  await expect(page.locator('html')).toHaveAttribute(
    'data-import-complete-message',
    /Import complete/,
  );
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

test('Studio imports and edits complete glTF authoring content', async ({ page }) => {
  test.setTimeout(180_000);
  await createStudioProject(page, 'gltf-authoring@kyxos.local', 'Complete glTF Fixture');

  await page.locator('#asset-import-input').setInputFiles({
    name: 'complete-authoring.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createGltfAuthoringGlb()),
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
  await expect(page.locator('.asset-workspace-item', { hasText: 'complete-authoring.glb' })).toBeVisible();
  await expect(page.getByLabel('Material variant')).toBeVisible();

  const summary = await page.evaluate(() => {
    const studio = (globalThis as typeof globalThis & {
      kyxosStudio?: { api?: { getScene(): any } };
    }).kyxosStudio;
    const scene = studio?.api?.getScene();
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
});
