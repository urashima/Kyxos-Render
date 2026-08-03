import { expect, test, type Page } from '@playwright/test';

function align4(value: number): number {
  return (value + 3) & ~3;
}

function createUvTriangleGlb(): Uint8Array {
  const positions = new Float32Array([
    -0.8, 0, 0,
    0.8, 0, 0,
    0, 1.4, 0,
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    0.5, 1,
  ]);
  const indices = new Uint16Array([0, 1, 2]);
  const positionOffset = 0;
  const uvOffset = align4(positionOffset + positions.byteLength);
  const indexOffset = align4(uvOffset + uvs.byteLength);
  const binaryLength = align4(indexOffset + indices.byteLength);
  const binary = new Uint8Array(binaryLength);
  binary.set(new Uint8Array(positions.buffer), positionOffset);
  binary.set(new Uint8Array(uvs.buffer), uvOffset);
  binary.set(new Uint8Array(indices.buffer), indexOffset);

  const gltf = {
    asset: { version: '2.0', generator: 'Kyxos render mode fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Render Mode Triangle', mesh: 0 }],
    meshes: [{
      name: 'Render Mode Mesh',
      primitives: [{
        attributes: { POSITION: 0, TEXCOORD_0: 1 },
        indices: 2,
        material: 0,
      }],
    }],
    materials: [{
      name: 'Render Mode Material',
      pbrMetallicRoughness: {
        baseColorFactor: [0.15, 0.65, 0.95, 1],
        metallicFactor: 0.5,
        roughnessFactor: 0.35,
      },
      emissiveFactor: [0.1, 0.02, 0],
    }],
    buffers: [{ byteLength: binaryLength }],
    bufferViews: [
      { buffer: 0, byteOffset: positionOffset, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: uvOffset, byteLength: uvs.byteLength, target: 34962 },
      { buffer: 0, byteOffset: indexOffset, byteLength: indices.byteLength, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [-0.8, 0, 0],
        max: [0.8, 1.4, 0],
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: 3,
        type: 'VEC2',
        min: [0, 0],
        max: [1, 1],
      },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };

  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = align4(json.byteLength);
  const totalLength = 12 + 8 + jsonLength + 8 + binaryLength;
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(json, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  output.set(binary, binaryHeader + 8);
  return output;
}

async function createStudioProject(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('render-modes@kyxos.local');
  await page.getByLabel('Password').fill('render-modes-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Render Modes Fixture'));
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

async function storedRenderMode(page: Page): Promise<string | undefined> {
  return page.evaluate(() =>
    (globalThis as any).kyxosStudio?.api?.getScene()?.editorState?.viewportRenderMode,
  );
}

test('Studio switches and persists complete viewport render modes', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await createStudioProject(page);

  await page.locator('#asset-import-input').setInputFiles({
    name: 'render-modes.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createUvTriangleGlb()),
  });
  await waitForImport(page);
  await expect(page.locator('.hierarchy-row', { hasText: 'Render Mode Triangle' })).toBeVisible();

  const canvas = page.locator('#studio-canvas');
  const select = page.getByLabel('Viewport render mode');
  await expect(select).toHaveValue('shaded');
  await expect(canvas).toHaveAttribute('data-editor-render-mode', 'shaded');

  for (const mode of [
    'wireframe',
    'albedo',
    'normals',
    'ambientOcclusion',
    'emission',
    'depth',
    'metalness',
    'roughness',
    'velocity',
    'uv',
  ]) {
    await select.selectOption(mode);
    await expect(canvas).toHaveAttribute('data-editor-render-mode', mode);
    await expect.poll(() => storedRenderMode(page)).toBe(mode);
  }

  await expect(canvas).toHaveAttribute('data-editor-material-override', 'uv');
  await select.selectOption('wireframe');
  await expect(canvas).toHaveAttribute('data-editor-material-override', 'wireframe');
  await select.selectOption('shaded');
  await expect(canvas).toHaveAttribute('data-editor-material-override', 'none');
  await expect(canvas).toHaveAttribute('data-editor-render-mode', 'shaded');
  await expect.poll(() => storedRenderMode(page)).toBe('shaded');
  expect(pageErrors).toEqual([]);
});
