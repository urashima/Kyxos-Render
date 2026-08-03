import type { AssetResolver, KyxosSceneContract } from '@kyxos/scene-contract';
import type { Material } from 'three/webgpu';

import type { NativeGltfMaterialSnapshot } from './gltfNativeLoad';
import { KyxosViewer } from './KyxosViewer';

interface TextureLike {
  isTexture?: boolean;
}

interface DiagnosticsInternals {
  gltfNativeMaterialSnapshots?: NativeGltfMaterialSnapshot[];
}

interface ViewerPrototype {
  loadScene(scene: KyxosSceneContract, resolver: AssetResolver): Promise<void>;
  __kyxosGltfTextureDiagnosticsInstalled?: boolean;
}

const textureKeys = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'specularColorMap',
  'specularIntensityMap',
] as const;

function hasTexture(material: Material): boolean {
  const candidate = material as Material & Record<string, unknown>;
  return textureKeys.some((key) =>
    (candidate[key] as TextureLike | null | undefined)?.isTexture === true,
  );
}

export function installGltfTextureDiagnostics(
  ViewerClass: typeof KyxosViewer,
): void {
  const prototype = ViewerClass.prototype as unknown as ViewerPrototype;
  if (prototype.__kyxosGltfTextureDiagnosticsInstalled) return;
  const originalLoadScene = prototype.loadScene;

  prototype.loadScene = async function loadSceneWithTextureDiagnostics(
    this: KyxosViewer,
    scene: KyxosSceneContract,
    resolver: AssetResolver,
  ): Promise<void> {
    await originalLoadScene.call(this, scene, resolver);
    const internal = this as unknown as DiagnosticsInternals;
    const count = (internal.gltfNativeMaterialSnapshots ?? [])
      .flatMap((snapshot) => snapshot.materials)
      .filter(hasTexture)
      .length;
    this.canvas.dataset.gltfTexturedMaterials = String(count);
  };

  prototype.__kyxosGltfTextureDiagnosticsInstalled = true;
}
