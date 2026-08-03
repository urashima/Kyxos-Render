import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

function align4(value: number): number {
  return (value + 3) & ~3;
}

function createFidelityGlb(): Uint8Array {
  const chunks: Uint8Array[] = [];
  const views: Array<{
    buffer: number;
    byteOffset: number;
    byteLength: number;
    target?: number;
  }> = [];
  let byteLength = 0;

  const append = (value: ArrayBufferView, target?: number): number => {
    const aligned = align4(byteLength);
    if (aligned > byteLength) chunks.push(new Uint8Array(aligned - byteLength));
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const index = views.length;
    views.push({
      buffer: 0,
      byteOffset: aligned,
      byteLength: bytes.byteLength,
      ...(target ? { target } : {}),
    });
    chunks.push(new Uint8Array(bytes));
    byteLength = aligned + bytes.byteLength;
    return index;
  };

  const positions = append(new Float32Array([
    -0.55, 0, 0,
    0.55, 0, 0,
    -0.55, 2, 0,
    0.55, 2, 0,
  ]), 34962);
  const normals = append(new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]), 34962);
  const texcoords = append(new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    1, 1,
  ]), 34962);
  const joints = append(new Uint8Array([
    0, 0, 0, 0,
    0, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
  ]), 34962);
  const weights = append(new Float32Array([
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
  ]), 34962);
  const indices = append(new Uint16Array([0, 1, 2, 2, 1, 3]), 34963);
  const inverseBindMatrices = append(new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, -1, 0, 1,
  ]));
  const animationTimes = append(new Float32Array([0, 1]));
  const halfAngle = Math.PI / 4;
  const animationRotations = append(new Float32Array([
    0, 0, 0, 1,
    0, 0, Math.sin(halfAngle), Math.cos(halfAngle),
  ]));
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQFJX9DwABwQFDmeGlAgAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  const image = append(png);

  const paddedLength = align4(byteLength);
  const binary = new Uint8Array(paddedLength);
  let offset = 0;
  for (const chunk of chunks) {
    binary.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const c = Math.cos(Math.PI / 12);
  const s = Math.sin(Math.PI / 12);
  const gltf = {
    asset: { version: '2.0', generator: 'Kyxos glTF fidelity fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        name: 'Matrix Root',
        matrix: [
          c * 1.2, s * 1.2, 0, 0,
          -s, c, 0, 0,
          0, 0, 1, 0,
          0.75, 0.25, 0, 1,
        ],
        children: [1, 2],
      },
      { name: 'Textured Skinned Mesh', mesh: 0, skin: 0 },
      { name: 'Root Bone', children: [3] },
      { name: 'Tip Bone', translation: [0, 1, 0] },
    ],
    meshes: [{
      name: 'Textured Skin Mesh',
      primitives: [{
        attributes: {
          POSITION: 0,
          NORMAL: 1,
          TEXCOORD_0: 2,
          JOINTS_0: 3,
          WEIGHTS_0: 4,
        },
        indices: 5,
        material: 0,
      }],
    }],
    skins: [{
      name: 'Two Bone Skin',
      inverseBindMatrices: 6,
      skeleton: 2,
      joints: [2, 3],
    }],
    materials: [{
      name: 'Embedded Checker PBR',
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        baseColorTexture: { index: 0 },
        metallicFactor: 0.2,
        roughnessFactor: 0.55,
      },
      doubleSided: true,
    }],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{
      magFilter: 9729,
      minFilter: 9729,
      wrapS: 10497,
      wrapT: 10497,
    }],
    images: [{ bufferView: image, mimeType: 'image/png', name: 'Embedded Pixel' }],
    animations: [{
      name: 'Bend Tip Bone',
      samplers: [{ input: 7, output: 8, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 3, path: 'rotation' } }],
    }],
    buffers: [{ byteLength: paddedLength }],
    bufferViews: views,
    accessors: [
      {
        bufferView: positions,
        componentType: 5126,
        count: 4,
        type: 'VEC3',
        min: [-0.55, 0, 0],
        max: [0.55, 2, 0],
      },
      { bufferView: normals, componentType: 5126, count: 4, type: 'VEC3' },
      {
        bufferView: texcoords,
        componentType: 5126,
        count: 4,
        type: 'VEC2',
        min: [0, 0],
        max: [1, 1],
      },
      { bufferView: joints, componentType: 5121, count: 4, type: 'VEC4' },
      { bufferView: weights, componentType: 5126, count: 4, type: 'VEC4' },
      { bufferView: indices, componentType: 5123, count: 6, type: 'SCALAR' },
      { bufferView: inverseBindMatrices, componentType: 5126, count: 2, type: 'MAT4' },
      {
        bufferView: animationTimes,
        componentType: 5126,
        count: 2,
        type: 'SCALAR',
        min: [0],
        max: [1],
      },
      { bufferView: animationRotations, componentType: 5126, count: 2, type: 'VEC4' },
    ],
  };

  const encoded = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = align4(encoded.byteLength);
  const totalLength = 12 + 8 + jsonLength + 8 + binary.byteLength;
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(encoded, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binary.byteLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  output.set(binary, binaryHeader + 8);
  return output;
}

async function createStudioProject(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/?gltfDiagnostics=1');
  await page.getByLabel('Email').fill('gltf-fidelity@kyxos.local');
  await page.getByLabel('Password').fill('gltf-fidelity-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('glTF Fidelity Fixture'));
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

function digest(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

test('Studio preserves glTF matrices, embedded PBR textures, skin weights and bone animation', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await createStudioProject(page);

  await page.locator('#asset-import-input').setInputFiles({
    name: 'matrix-texture-skin-animation.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createFidelityGlb()),
  });
  await waitForImport(page);

  const canvas = page.locator('#studio-canvas');
  await expect(canvas).toHaveAttribute('data-gltf-transform-mode', 'native-scene');
  await expect(canvas).toHaveAttribute('data-authoring-materials', 'exact-gltf');
  await expect(canvas).toHaveAttribute('data-gltf-textured-materials', /^[1-9]\d*$/);
  await expect(canvas).toHaveAttribute('data-gltf-skinned-meshes', '1');
  await expect(canvas).toHaveAttribute('data-gltf-bones', '2');
  await expect(canvas).toHaveAttribute('data-gltf-weighted-vertices', '4');
  await expect(canvas).toHaveAttribute('data-gltf-invalid-weights', '0');
  await expect(canvas).toHaveAttribute('data-gltf-matrix-nodes', '1');
  await expect(canvas).toHaveAttribute('data-gltf-animations', '1');
  await expect(canvas).toHaveAttribute('data-gltf-native-materials', /^[1-9]\d*$/);

  const sceneState = await page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const root = scene?.nodes?.find((node: any) => node.name === 'Matrix Root');
    const mesh = scene?.nodes?.find((node: any) => node.name === 'Textured Skinned Mesh');
    const material = Object.values(scene?.materials ?? {}).find(
      (entry: any) => entry.name === 'Embedded Checker PBR',
    ) as any;
    const textureAssetId = material?.baseColorTexture?.assetId;
    const textureAsset = textureAssetId ? scene?.assets?.[textureAssetId] : undefined;
    return {
      rootPosition: root?.transform?.position,
      rootScale: root?.transform?.scale,
      matrix: root?.metadata?.gltfNodeMatrix,
      jointCount: mesh?.skin?.joints?.length ?? 0,
      textureIndex: material?.metadata?.gltfTextures?.baseColor?.index,
      textureAssetId,
      textureAssetKind: textureAsset?.kind,
      textureAssetIndex: textureAsset?.metadata?.gltfTextureIndex,
      textureContentHash: textureAsset?.contentHash,
      textureUri: textureAsset?.uri,
      metallic: material?.metalness,
      roughness: material?.roughness,
    };
  });
  expect(sceneState.rootPosition).toEqual({ x: 0.75, y: 0.25, z: 0 });
  expect(sceneState.rootScale.x).toBeCloseTo(1.2, 5);
  expect(sceneState.rootScale.y).toBeCloseTo(1, 5);
  expect(sceneState.matrix).toHaveLength(16);
  expect(sceneState.jointCount).toBe(2);
  expect(sceneState.textureIndex).toBe(0);
  expect(sceneState.textureAssetId).toMatch(/^embedded-gltf-texture:/);
  expect(sceneState.textureAssetKind).toBe('texture');
  expect(sceneState.textureAssetIndex).toBe(0);
  expect(sceneState.textureContentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(sceneState.textureUri).toBe(`asset://${sceneState.textureContentHash}`);
  expect(sceneState.metallic).toBeCloseTo(0.2, 5);
  expect(sceneState.roughness).toBeCloseTo(0.55, 5);

  await page.getByText('Textured Skinned Mesh', { exact: true }).first().click();
  await expect(page.getByLabel('Base Texture')).toHaveValue(sceneState.textureAssetId);

  const initialPose = await canvas.getAttribute('data-gltf-bone-pose');
  expect(initialPose).toBeTruthy();
  await expect.poll(
    () => canvas.getAttribute('data-gltf-bone-pose'),
    { timeout: 10_000 },
  ).not.toBe(initialPose);

  const first = await canvas.screenshot({ path: testInfo.outputPath('gltf-fidelity-frame-a.png') });
  await page.waitForTimeout(450);
  const second = await canvas.screenshot({ path: testInfo.outputPath('gltf-fidelity-frame-b.png') });
  expect(digest(first)).not.toBe(digest(second));
  expect(pageErrors).toEqual([]);
});
