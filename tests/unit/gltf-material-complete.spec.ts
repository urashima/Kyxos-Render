import { describe, expect, it } from 'vitest';

import {
  normalizeCompleteGltfMaterials,
  type CompleteGltfMaterialImportReport,
  type CompleteSceneMaterial,
} from '../../apps/studio/src/gltf-material-complete';
import {
  completeMaterialOverridePaths,
  mergeReimportedSceneWithOverrides,
} from '../../packages/editor-core/src/reimport';
import { createFixtureContract } from '../../packages/test-fixtures/src/index';

function completeReport(): CompleteGltfMaterialImportReport {
  const texture = {
    index: 0,
    texCoord: 1,
    extensions: {
      KHR_texture_transform: {
        offset: [0.25, 0.5],
        scale: [2, 3],
        rotation: 0.4,
        texCoord: 2,
      },
    },
  };
  return {
    materials: [{
      index: 0,
      pbr: {
        baseColorFactor: [0.1, 0.2, 0.3, 0.4],
        metallicFactor: 0.65,
        roughnessFactor: 0.35,
        baseColorTexture: texture,
        metallicRoughnessTexture: texture,
      },
      normalTexture: { ...texture, scale: 0.75 },
      emissiveTexture: texture,
      emissiveFactor: [0.2, 0.3, 0.4],
      occlusionTexture: { ...texture, strength: 0.55 },
      alphaMode: 'BLEND',
      alphaCutoff: 0.37,
      doubleSided: true,
      extensions: {
        KHR_materials_clearcoat: {
          clearcoatFactor: 0.8,
          clearcoatRoughnessFactor: 0.22,
          clearcoatTexture: texture,
          clearcoatRoughnessTexture: texture,
          clearcoatNormalTexture: { ...texture, scale: 0.6 },
        },
        KHR_materials_transmission: {
          transmissionFactor: 0.72,
          transmissionTexture: texture,
        },
        KHR_materials_volume: {
          thicknessFactor: 0.45,
          thicknessTexture: texture,
          attenuationDistance: 12,
          attenuationColor: [0.8, 0.7, 0.6],
        },
        KHR_materials_ior: { ior: 1.42 },
        KHR_materials_sheen: {
          sheenColorFactor: [0.7, 0.2, 0.1],
          sheenRoughnessFactor: 0.31,
          sheenColorTexture: texture,
          sheenRoughnessTexture: texture,
        },
        KHR_materials_specular: {
          specularFactor: 0.81,
          specularColorFactor: [0.9, 0.8, 0.7],
          specularTexture: texture,
          specularColorTexture: texture,
        },
        KHR_materials_emissive_strength: { emissiveStrength: 4.5 },
        KHR_materials_iridescence: {
          iridescenceFactor: 0.91,
          iridescenceIor: 1.38,
          iridescenceThicknessMinimum: 120,
          iridescenceThicknessMaximum: 460,
          iridescenceTexture: texture,
          iridescenceThicknessTexture: texture,
        },
        KHR_materials_anisotropy: {
          anisotropyStrength: 0.63,
          anisotropyRotation: 0.28,
          anisotropyTexture: texture,
        },
        KHR_materials_dispersion: { dispersion: 0.16 },
      },
    }],
    images: [{ name: 'Complete Material Pixel', mimeType: 'image/png' }],
    textures: {
      textures: [{ source: 0, sampler: 0 }],
      samplers: [{
        wrapS: 33071,
        wrapT: 33648,
        minFilter: 9985,
        magFilter: 9728,
      }],
    },
  };
}

function sourceScene() {
  const scene = createFixtureContract('Complete Material');
  scene.materials['fixture-material'].metadata = { gltfMaterialIndex: 0 };
  return scene;
}

describe('complete glTF material normalization', () => {
  it('maps core PBR, all supported physical extensions and texture state', () => {
    const scene = normalizeCompleteGltfMaterials(sourceScene(), completeReport());
    const material = scene.materials['fixture-material'] as CompleteSceneMaterial;

    expect(material).toMatchObject({
      baseColor: { x: 0.1, y: 0.2, z: 0.3, w: 0.4 },
      opacity: 0.4,
      metalness: 0.65,
      roughness: 0.35,
      normalScale: 0.75,
      aoIntensity: 0.55,
      emissive: { x: 0.2, y: 0.3, z: 0.4 },
      emissiveIntensity: 4.5,
      alphaMode: 'blend',
      alphaCutoff: 0.37,
      doubleSided: true,
      clearcoat: 0.8,
      clearcoatRoughness: 0.22,
      clearcoatNormalScale: 0.6,
      transmission: 0.72,
      thickness: 0.45,
      attenuationDistance: 12,
      attenuationColor: { x: 0.8, y: 0.7, z: 0.6 },
      ior: 1.42,
      sheenColor: { x: 0.7, y: 0.2, z: 0.1 },
      sheenRoughness: 0.31,
      specularIntensity: 0.81,
      specularColor: { x: 0.9, y: 0.8, z: 0.7 },
      iridescence: 0.91,
      iridescenceIor: 1.38,
      iridescenceThicknessMinimum: 120,
      iridescenceThicknessMaximum: 460,
      anisotropy: 0.63,
      anisotropyRotation: 0.28,
      dispersion: 0.16,
    });

    expect(material.baseColorTexture).toMatchObject({
      assetId: 'embedded-gltf-texture:fixture-model:0',
      texCoord: 2,
      colorSpace: 'srgb',
      channel: 'rgba',
      offset: { x: 0.25, y: 0.5 },
      scale: { x: 2, y: 3 },
      rotation: 0.4,
      wrapS: 'clamp',
      wrapT: 'mirror',
      minFilter: 'linearMipNearest',
      magFilter: 'nearest',
    });
    expect(material.metalnessTexture?.channel).toBe('b');
    expect(material.roughnessTexture?.channel).toBe('g');
    expect(material.aoTexture?.channel).toBe('r');
    expect(material.clearcoatRoughnessTexture?.channel).toBe('g');
    expect(material.sheenRoughnessTexture?.channel).toBe('a');
    expect(material.specularTexture?.channel).toBe('a');
    expect(material.iridescenceThicknessTexture?.channel).toBe('g');
    expect(material.anisotropyTexture?.channel).toBe('rgb');
    expect(scene.assets['embedded-gltf-texture:fixture-model:0']).toMatchObject({
      kind: 'texture',
      mimeType: 'image/png',
      metadata: { gltfTextureIndex: 0, gltfImageIndex: 0 },
    });
    expect(material.metadata?.original).toMatchObject({
      clearcoat: 0.8,
      anisotropy: 0.63,
      dispersion: 0.16,
    });
  });

  it('does not inject physical extension defaults or non-JSON Infinity', () => {
    const report: CompleteGltfMaterialImportReport = {
      materials: [{
        index: 0,
        pbr: {},
        extensions: {
          KHR_materials_volume: { thicknessFactor: 0.2 },
        },
      }],
    };
    const scene = normalizeCompleteGltfMaterials(sourceScene(), report);
    const material = scene.materials['fixture-material'] as CompleteSceneMaterial;

    expect(material.thickness).toBe(0.2);
    expect(material.attenuationDistance).toBeUndefined();
    expect(material.clearcoat).toBeUndefined();
    expect(material.specularColor).toBeUndefined();
    expect(material.iridescence).toBeUndefined();
    expect(material.anisotropy).toBeUndefined();
    expect(material.dispersion).toBeUndefined();
    expect(JSON.stringify(scene)).not.toContain('attenuationDistance');
  });
});

describe('complete material reimport overrides', () => {
  it('preserves new extension edits and deliberate texture removal', () => {
    const imported = normalizeCompleteGltfMaterials(sourceScene(), completeReport());
    const current = structuredClone(imported);
    const currentMaterial = current.materials['fixture-material'] as CompleteSceneMaterial;
    currentMaterial.anisotropy = 0.94;
    delete currentMaterial.sheenColorTexture;

    const nextSource = sourceScene();
    const nextReport = completeReport();
    const extension = nextReport.materials?.[0].extensions?.KHR_materials_anisotropy as
      | Record<string, unknown>
      | undefined;
    if (extension) extension.anisotropyStrength = 0.2;
    const next = normalizeCompleteGltfMaterials(nextSource, nextReport);

    expect(completeMaterialOverridePaths(currentMaterial)).toEqual(
      expect.arrayContaining(['anisotropy', 'sheenColorTexture']),
    );
    const merged = mergeReimportedSceneWithOverrides(current, next, 'keep-overrides');
    const mergedMaterial = merged.materials['fixture-material'] as CompleteSceneMaterial;
    expect(mergedMaterial.anisotropy).toBe(0.94);
    expect(mergedMaterial.sheenColorTexture).toBeUndefined();
    expect((mergedMaterial.metadata?.original as Record<string, unknown>).anisotropy).toBe(0.2);
  });
});
