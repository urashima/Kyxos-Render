import type {
  KyxosSceneContract,
  SceneCamera,
  SceneLight,
  SceneMaterial,
  SceneNode,
} from '@kyxos/scene-contract';

import { materialOverridePaths } from './schema';

export type ExtendedReimportMode = 'replace' | 'keep-overrides' | 'reset-overrides';

function gltfIndex(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const index = (value as Record<string, unknown>)[key];
  return typeof index === 'number' && Number.isInteger(index) ? index : undefined;
}

function nodeSourceIndex(node: SceneNode): number | undefined {
  return gltfIndex(node.metadata, 'gltfNodeIndex');
}

function materialSourceIndex(material: SceneMaterial): number | undefined {
  return gltfIndex(material.metadata, 'gltfMaterialIndex');
}

function linkedCamera(scene: KyxosSceneContract, node: SceneNode): SceneCamera | undefined {
  return node.cameraId ? scene.cameras.find((camera) => camera.id === node.cameraId) : undefined;
}

function linkedLight(scene: KyxosSceneContract, node: SceneNode): SceneLight | undefined {
  return node.lightId ? scene.lights?.find((light) => light.id === node.lightId) : undefined;
}

function preserveCamera(previous: SceneCamera, imported: SceneCamera): SceneCamera {
  return {
    ...structuredClone(previous),
    id: imported.id,
  };
}

function preserveLight(previous: SceneLight, imported: SceneLight): SceneLight {
  return {
    ...structuredClone(previous),
    id: imported.id,
  };
}

function copyMaterialOverrides(previous: SceneMaterial, imported: SceneMaterial): void {
  const importedOriginal = structuredClone(imported.metadata?.original ?? imported);
  for (const key of materialOverridePaths(previous)) {
    (imported as unknown as Record<string, unknown>)[key] = structuredClone(
      (previous as unknown as Record<string, unknown>)[key],
    );
  }
  imported.metadata = {
    ...(imported.metadata ?? {}),
    original: importedOriginal,
  };
}

function preserveSelectedVariant(
  current: KyxosSceneContract,
  next: KyxosSceneContract,
): void {
  if (!current.activeMaterialVariantId) return;
  const currentVariant = current.materialVariants?.find(
    (variant) => variant.id === current.activeMaterialVariantId,
  );
  if (!currentVariant) return;
  const importedVariant = next.materialVariants?.find(
    (variant) => variant.name === currentVariant.name,
  );
  if (importedVariant) next.activeMaterialVariantId = importedVariant.id;
}

function appendUserComponents(
  current: KyxosSceneContract,
  next: KyxosSceneContract,
): void {
  const currentLinkedCameras = new Set(
    current.nodes.map((node) => node.cameraId).filter((id): id is string => Boolean(id)),
  );
  const currentLinkedLights = new Set(
    current.nodes.map((node) => node.lightId).filter((id): id is string => Boolean(id)),
  );
  const nextCameraIds = new Set(next.cameras.map((camera) => camera.id));
  const nextLightIds = new Set(next.lights?.map((light) => light.id) ?? []);

  for (const camera of current.cameras) {
    if (currentLinkedCameras.has(camera.id) || nextCameraIds.has(camera.id)) continue;
    next.cameras.push(structuredClone(camera));
    nextCameraIds.add(camera.id);
  }
  next.lights ??= [];
  for (const light of current.lights ?? []) {
    if (currentLinkedLights.has(light.id) || nextLightIds.has(light.id)) continue;
    next.lights.push(structuredClone(light));
    nextLightIds.add(light.id);
  }
}

/**
 * Merge a newly imported glTF scene with editor-authored state. Source objects
 * are matched through stable glTF indices, while regenerated Kyxos IDs remain
 * those of the new import. This keeps overrides without hiding newly added or
 * removed source nodes, materials, cameras, lights or variants.
 */
export function mergeReimportedSceneWithOverrides(
  current: KyxosSceneContract,
  imported: KyxosSceneContract,
  mode: ExtendedReimportMode,
): KyxosSceneContract {
  if (mode === 'replace') return structuredClone(imported);
  const next = structuredClone(imported);
  next.editorState = structuredClone(current.editorState);

  const currentMaterials = new Map<number, SceneMaterial>();
  for (const material of Object.values(current.materials)) {
    const index = materialSourceIndex(material);
    if (index != null) currentMaterials.set(index, material);
  }
  for (const material of Object.values(next.materials)) {
    const index = materialSourceIndex(material);
    const previous = index == null ? undefined : currentMaterials.get(index);
    if (!previous) continue;
    const importedOriginal = structuredClone(material.metadata?.original ?? material);
    if (mode === 'keep-overrides') copyMaterialOverrides(previous, material);
    else material.metadata = { ...(material.metadata ?? {}), original: importedOriginal };
  }

  const currentNodes = new Map<number, SceneNode>();
  for (const node of current.nodes) {
    const index = nodeSourceIndex(node);
    if (index != null) currentNodes.set(index, node);
  }

  for (const node of next.nodes) {
    const index = nodeSourceIndex(node);
    const previous = index == null ? undefined : currentNodes.get(index);
    if (!previous || mode !== 'keep-overrides') continue;

    node.name = previous.name;
    node.transform = structuredClone(previous.transform);
    node.visible = previous.visible;
    node.locked = previous.locked;
    if (previous.morphWeights) node.morphWeights = structuredClone(previous.morphWeights);

    const previousCamera = linkedCamera(current, previous);
    const importedCamera = linkedCamera(next, node);
    if (previousCamera && importedCamera) {
      const cameraIndex = next.cameras.findIndex((camera) => camera.id === importedCamera.id);
      next.cameras[cameraIndex] = preserveCamera(previousCamera, importedCamera);
    }

    const previousLight = linkedLight(current, previous);
    const importedLight = linkedLight(next, node);
    if (previousLight && importedLight && next.lights) {
      const lightIndex = next.lights.findIndex((light) => light.id === importedLight.id);
      next.lights[lightIndex] = preserveLight(previousLight, importedLight);
    }
  }

  for (const [id, asset] of Object.entries(current.assets)) {
    if (asset.kind !== 'model' && !next.assets[id]) next.assets[id] = structuredClone(asset);
  }
  if (current.environment.assetId) next.environment = structuredClone(current.environment);
  next.renderSettings = structuredClone(current.renderSettings);

  if (mode === 'keep-overrides') {
    appendUserComponents(current, next);
    preserveSelectedVariant(current, next);

    const activeCamera = current.cameras.find((camera) => camera.id === current.activeCameraId);
    if (activeCamera) {
      const activeNode = current.nodes.find((node) => node.cameraId === activeCamera.id);
      const sourceIndex = activeNode ? nodeSourceIndex(activeNode) : undefined;
      const importedNode = sourceIndex == null
        ? undefined
        : next.nodes.find((node) => nodeSourceIndex(node) === sourceIndex);
      if (importedNode?.cameraId) next.activeCameraId = importedNode.cameraId;
      else if (next.cameras.some((camera) => camera.id === activeCamera.id)) {
        next.activeCameraId = activeCamera.id;
      }
    }
  }

  return next;
}
