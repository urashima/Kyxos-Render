import { expect, test, type Page } from '@playwright/test';

function align4(value: number): number {
  return (value + 3) & ~3;
}

function createCompleteMaterialGlb(): Uint8Array {
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
    -0.8, 0, 0,
    0.8, 0, 0,
    0, 1.4, 0,
  ]), 34962);
  const normals = append(new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]), 34962);
  const texcoords = append(new Float32Array([
    0, 0,
    1, 0,
    0.5, 1,
  ]), 34962);
  const indices = append(new Uint16Array([0, 1, 2]), 34963);
  const png = append(Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQFJX9DwABwQFDmeGlAgAAAABJRU5ErkJggg==',
    'base64',
  )));

  const paddedLength = align4(byteLength);
  const binary = new Uint8Array(paddedLength);
  let offset = 0;
  for (const chunk of chunks) {
    binary.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const texture = {
    index: 0,
    texCoord: 0,
    extensions: {
      KHR_texture_transform: {
        offset: [0.1, 0.2],
        scale: [1.5, 0.75],
        rotation: 0.15,
      },
    },
  };
  const gltf = {
    asset: { version: '2.0', generator: 'Kyxos complete material browser fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Complete Material Mesh', mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        indices: 3,
        material: 0,
      }],
    }],
    materials: [{
      name: 'Complete Physical Material',
      pbrMetallicRoughness: {
        baseColorFactor: [0.7, 0.4, 0.2, 0.85],
        metallicFactor: 0.58,
        roughnessFactor: 0.27,
        baseColorTexture: texture,
        metallicRoughnessTexture: texture,
      },
      normalTexture: { ...texture, scale: 0.73 },
      emissiveTexture: texture,
      emissiveFactor: [0.1, 0.2, 0.3],
      occlusionTexture: { ...texture, strength: 0.62 },
      alphaMode: 'BLEND',
      doubleSided: true,
      extensions: {
        KHR_materials_clearcoat: {
          clearcoatFactor: 0.82,
          clearcoatRoughnessFactor: 0.18,
          clearcoatTexture: texture,
          clearcoatRoughnessTexture: texture,
          clearcoatNormalTexture: { ...texture, scale: 0.66 },
        },
        KHR_materials_transmission: {
          transmissionFactor: 0.41,
          transmissionTexture: texture,
        },
        KHR_materials_volume: {
          thicknessFactor: 0.35,
          thicknessTexture: texture,
          attenuationDistance: 8,
          attenuationColor: [0.8, 0.65, 0.5],
        },
        KHR_materials_ior: { ior: 1.47 },
        KHR_materials_sheen: {
          sheenColorFactor: [0.3, 0.5, 0.7],
          sheenRoughnessFactor: 0.24,
          sheenColorTexture: texture,
          sheenRoughnessTexture: texture,
        },
        KHR_materials_specular: {
          specularFactor: 0.77,
          specularColorFactor: [0.9, 0.8, 0.7],
          specularTexture: texture,
          specularColorTexture: texture,
        },
        KHR_materials_emissive_strength: { emissiveStrength: 3.2 },
        KHR_materials_iridescence: {
          iridescenceFactor: 0.69,
          iridescenceIor: 1.36,
          iridescenceThicknessMinimum: 110,
          iridescenceThicknessMaximum: 430,
          iridescenceTexture: texture,
          iridescenceThicknessTexture: texture,
        },
        KHR_materials_anisotropy: {
          anisotropyStrength: 0.64,
          anisotropyRotation: 0.21,
          anisotropyTexture: texture,
        },
        KHR_materials_dispersion: { dispersion: 0.12 },
      },
    }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{
      magFilter: 9729,
      minFilter: 9987,
      wrapS: 10497,
      wrapT: 33071,
    }],
    images: [{ bufferView: png, mimeType: 'image/png', name: 'Complete Material Pixel' }],
    extensionsUsed: [
      'KHR_texture_transform',
      'KHR_materials_clearcoat',
      'KHR_materials_transmission',
      'KHR_materials_volume',
      'KHR_materials_ior',
      'KHR_materials_sheen',
      'KHR_materials_specular',
      'KHR_materials_emissive_strength',
      'KHR_materials_iridescence',
      'KHR_materials_anisotropy',
      'KHR_materials_dispersion',
    ],
    buffers: [{ byteLength: paddedLength }],
    bufferViews: views,
    accessors: [
      {
        bufferView: positions,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [-0.8, 0, 0],
        max: [0.8, 1.4, 0],
      },
      { bufferView: normals, componentType: 5126, count: 3, type: 'VEC3' },
      {
        bufferView: texcoords,
        componentType: 5126,
        count: 3,
        type: 'VEC2',
        min: [0, 0],
        max: [1, 1],
      },
      { bufferView: indices, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };

  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = align4(json.byteLength);
  const totalLength = 12 + 8 + jsonLength + 8 + binary.byteLength;
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
  view.setUint32(binaryHeader, binary.byteLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  output.set(binary, binaryHeader + 8);
  return output;
}

async function createProject(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/?gltfDiagnostics=1');
  await page.getByLabel('Email').fill('material-fidelity@kyxos.local');
  await page.getByLabel('Password').fill('material-fidelity-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Complete Material Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
}

test('Studio imports, edits and preserves complete glTF material parameters', async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await createProject(page);

  await page.locator('#asset-import-input').setInputFiles({
    name: 'complete-material.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createCompleteMaterialGlb()),
  });
  await expect(page.locator('html')).toHaveAttribute(
    'data-import-core-complete',
    'true',
    { timeout: 90_000 },
  );

  const imported = await page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const material = Object.values(scene?.materials ?? {}).find(
      (entry: any) => entry.name === 'Complete Physical Material',
    ) as any;
    return {
      baseColor: material?.baseColor,
      opacity: material?.opacity,
      metalness: material?.metalness,
      roughness: material?.roughness,
      normalScale: material?.normalScale,
      aoIntensity: material?.aoIntensity,
      emissiveIntensity: material?.emissiveIntensity,
      clearcoat: material?.clearcoat,
      clearcoatRoughness: material?.clearcoatRoughness,
      clearcoatNormalScale: material?.clearcoatNormalScale,
      transmission: material?.transmission,
      thickness: material?.thickness,
      attenuationDistance: material?.attenuationDistance,
      ior: material?.ior,
      sheenRoughness: material?.sheenRoughness,
      specularIntensity: material?.specularIntensity,
      iridescence: material?.iridescence,
      anisotropy: material?.anisotropy,
      dispersion: material?.dispersion,
      baseTexture: material?.baseColorTexture,
      clearcoatNormalTexture: material?.clearcoatNormalTexture,
      sheenColorTexture: material?.sheenColorTexture,
      specularTexture: material?.specularTexture,
      iridescenceTexture: material?.iridescenceTexture,
      anisotropyTexture: material?.anisotropyTexture,
      originalAnisotropy: material?.metadata?.original?.anisotropy,
    };
  });

  expect(imported).toMatchObject({
    baseColor: { x: 0.7, y: 0.4, z: 0.2, w: 0.85 },
    opacity: 0.85,
    metalness: 0.58,
    roughness: 0.27,
    normalScale: 0.73,
    aoIntensity: 0.62,
    emissiveIntensity: 3.2,
    clearcoat: 0.82,
    clearcoatRoughness: 0.18,
    clearcoatNormalScale: 0.66,
    transmission: 0.41,
    thickness: 0.35,
    attenuationDistance: 8,
    ior: 1.47,
    sheenRoughness: 0.24,
    specularIntensity: 0.77,
    iridescence: 0.69,
    anisotropy: 0.64,
    dispersion: 0.12,
    originalAnisotropy: 0.64,
  });
  expect(imported.baseTexture).toMatchObject({
    colorSpace: 'srgb',
    channel: 'rgba',
    offset: { x: 0.1, y: 0.2 },
    scale: { x: 1.5, y: 0.75 },
    rotation: 0.15,
  });
  expect(imported.clearcoatNormalTexture?.channel).toBe('rgb');
  expect(imported.sheenColorTexture?.colorSpace).toBe('srgb');
  expect(imported.specularTexture?.channel).toBe('a');
  expect(imported.iridescenceTexture?.channel).toBe('r');
  expect(imported.anisotropyTexture?.channel).toBe('rgb');

  await page.getByText('Complete Material Mesh', { exact: true }).first().click();
  const anisotropy = page.locator('#inspector-material-complete-anisotropy');
  const iridescence = page.locator('#inspector-material-complete-iridescence');
  const dispersion = page.locator('#inspector-material-complete-dispersion');
  await expect(anisotropy).toHaveValue('0.64');
  await expect(iridescence).toHaveValue('0.69');
  await expect(dispersion).toHaveValue('0.12');
  await expect(page.locator('#inspector-material-complete-clearcoatNormalTexture')).toHaveValue(
    imported.clearcoatNormalTexture.assetId,
  );

  await anisotropy.fill('0.9');
  await anisotropy.dispatchEvent('input');
  const canvas = page.locator('#studio-canvas');
  await expect.poll(async () => {
    const state = JSON.parse(await canvas.getAttribute('data-complete-material-state') ?? '{}');
    return state.anisotropy;
  }).toBe(0.9);

  const edited = await page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    const material = Object.values(scene?.materials ?? {}).find(
      (entry: any) => entry.name === 'Complete Physical Material',
    ) as any;
    return {
      anisotropy: material?.anisotropy,
      clearcoat: material?.clearcoat,
      transmission: material?.transmission,
      iridescence: material?.iridescence,
      dispersion: material?.dispersion,
      extensionTextureCount: material?.metadata?.gltfCompleteTextureFields?.length,
    };
  });
  expect(edited).toEqual({
    anisotropy: 0.9,
    clearcoat: 0.82,
    transmission: 0.41,
    iridescence: 0.69,
    dispersion: 0.12,
    extensionTextureCount: 18,
  });
  expect(pageErrors).toEqual([]);
});
