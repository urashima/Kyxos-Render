import { SceneDocument } from '@kyxos/editor-core';
import type {
  KyxosSceneContract,
  SceneMaterial,
} from '@kyxos/scene-contract';

interface PrimitiveImportReport {
  index: number;
  material: number | null;
  mode: number;
  indices: number | null;
  attributes: Record<string, number>;
  targets: Array<Record<string, number>>;
  extensions: Record<string, unknown>;
}

interface MeshImportReport {
  meshIndex: number;
  name: string;
  weights: number[];
  primitives: PrimitiveImportReport[];
}

interface GlbImportMetadata {
  textures?: unknown[];
  samplers?: unknown[];
  meshPrimitives?: MeshImportReport[];
  skins?: unknown[];
  rootExtensions?: Record<string, unknown>;
}

interface SceneDocumentPrototype {
  replace(scene: KyxosSceneContract, source?: string): void;
  __kyxosGlbParityInstalled?: boolean;
}

function defaultPrimitiveMaterial(): SceneMaterial {
  const id = crypto.randomUUID();
  return {
    id,
    name: 'glTF Default Material',
    baseColor: { x: 1, y: 1, z: 1, w: 1 },
    metalness: 1,
    roughness: 1,
    emissive: { x: 0, y: 0, z: 0 },
    opacity: 1,
    alphaMode: 'opaque',
    doubleSided: false,
    metadata: {
      generatedForUnassignedGltfPrimitive: true,
    },
  };
}

function readImportMetadata(scene: KyxosSceneContract): GlbImportMetadata | null {
  const model = Object.values(scene.assets).find((asset) => asset.kind === 'model');
  const metadata = model?.metadata?.textures;
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return null;
  return metadata as GlbImportMetadata;
}

/**
 * Restores every glTF primitive-to-material binding after the legacy importer
 * creates its initial Scene Contract. The previous implementation selected only
 * `primitives[0]`, which made all additional material slots invisible to the
 * Inspector even though GLTFLoader rendered them.
 */
export function normalizeGlbImportContract(
  input: KyxosSceneContract,
): KyxosSceneContract {
  const metadata = readImportMetadata(input);
  if (!metadata?.meshPrimitives?.length) return input;

  const scene = structuredClone(input);
  const materialsByGltfIndex = new Map<number, string>();
  for (const material of Object.values(scene.materials)) {
    const sourceIndex = material.metadata?.gltfMaterialIndex;
    if (typeof sourceIndex === 'number') materialsByGltfIndex.set(sourceIndex, material.id);
  }

  let fallbackMaterialId: string | null = null;
  const getFallbackMaterial = (): string => {
    if (fallbackMaterialId) return fallbackMaterialId;
    const material = defaultPrimitiveMaterial();
    scene.materials[material.id] = material;
    fallbackMaterialId = material.id;
    return material.id;
  };

  for (const node of scene.nodes) {
    if (node.meshIndex == null) continue;
    const mesh = metadata.meshPrimitives.find(
      (entry) => entry.meshIndex === node.meshIndex,
    );
    if (!mesh) continue;

    node.materialSlots = mesh.primitives.map((primitive) =>
      primitive.material == null
        ? getFallbackMaterial()
        : materialsByGltfIndex.get(primitive.material) ?? getFallbackMaterial(),
    );
    node.metadata = {
      ...(node.metadata ?? {}),
      gltfPrimitiveCount: mesh.primitives.length,
      gltfPrimitiveModes: mesh.primitives.map((primitive) => primitive.mode),
      gltfMorphTargetCounts: mesh.primitives.map(
        (primitive) => primitive.targets.length,
      ),
      gltfMeshWeights: mesh.weights,
    };
  }

  return scene;
}

export function installGlbImportParity(): void {
  const prototype = SceneDocument.prototype as unknown as SceneDocumentPrototype;
  if (prototype.__kyxosGlbParityInstalled) return;

  const originalReplace = prototype.replace;
  prototype.replace = function replaceWithImportNormalization(
    scene: KyxosSceneContract,
    source = 'replace',
  ): void {
    originalReplace.call(
      this,
      source === 'import-glb' ? normalizeGlbImportContract(scene) : scene,
      source,
    );
  };
  prototype.__kyxosGlbParityInstalled = true;
}

installGlbImportParity();
