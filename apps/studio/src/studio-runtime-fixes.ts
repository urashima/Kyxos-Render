import {
  AutosaveController,
  SceneDocument,
  SceneWorkspaceService,
} from '@kyxos/editor-core';
import type {
  KyxosSceneContract,
  SceneLight,
  Transform,
} from '@kyxos/scene-contract';

interface ReportNode {
  index?: number;
  translation?: number[];
  rotation?: number[];
  extensions?: Record<string, unknown>;
}

interface ReportLight {
  name?: string;
  type?: 'directional' | 'point' | 'spot';
  color?: number[];
  intensity?: number;
  range?: number;
  spot?: {
    innerConeAngle?: number;
    outerConeAngle?: number;
  };
}

interface ImportReport {
  nodes?: ReportNode[];
  lights?: ReportLight[];
}

interface RuntimeGlobal {
  __kyxosLastGlbImportReport?: ImportReport;
}

interface AutosaveInternals {
  projectId: string;
  document: SceneDocument;
  repository: {
    load(projectId: string): Promise<{ revision: number } | null>;
  };
  revisionValue: number;
  dirty: boolean;
  disposed: boolean;
}

const sceneDocumentInstallKey = Symbol.for('kyxos.studio.runtime-fixes.scene-document');
const workspaceInstallKey = Symbol.for('kyxos.studio.runtime-fixes.workspace');
const autosaveInstallKey = Symbol.for('kyxos.studio.runtime-fixes.autosave');

function identityTransform(): Transform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function legacyDefaultLight(light: SceneLight): boolean {
  if (light.type !== 'directional') return false;
  if (light.name === 'Main Light') {
    return Math.abs(light.intensity - 3.2) < 0.001 && light.color.toLowerCase() === '#fff4e6';
  }
  if (light.name === 'Auxiliary Light') {
    return Math.abs(light.intensity - 1.1) < 0.001 && light.color.toLowerCase() === '#b9d7ff';
  }
  return false;
}

function stripLegacyDefaultLights(scene: KyxosSceneContract): void {
  const lights = scene.lights ?? [];
  const linked = new Set(scene.nodes.flatMap((node) => node.lightId ? [node.lightId] : []));
  const defaults = lights.filter((light) => !linked.has(light.id) && legacyDefaultLight(light));
  const hasPair = defaults.some((light) => light.name === 'Main Light')
    && defaults.some((light) => light.name === 'Auxiliary Light');
  if (!hasPair) return;
  const defaultIds = new Set(defaults.map((light) => light.id));
  scene.lights = lights.filter((light) => !defaultIds.has(light.id));
  document.documentElement.dataset.studioDefaultContractLights = 'removed';
}

function quaternionToEuler(value: unknown): Transform['rotation'] {
  if (!Array.isArray(value) || value.length < 4) return identityTransform().rotation;
  const [x, y, z, w] = value.map(Number);
  if (![x, y, z, w].every(Number.isFinite)) return identityTransform().rotation;
  const sinr = 2 * (w * x + y * z);
  const cosr = 1 - 2 * (x * x + y * y);
  const pitchInput = 2 * (w * y - z * x);
  const siny = 2 * (w * z + x * y);
  const cosy = 1 - 2 * (y * y + z * z);
  return {
    x: Math.atan2(sinr, cosr),
    y: Math.abs(pitchInput) >= 1
      ? Math.sign(pitchInput) * Math.PI / 2
      : Math.asin(pitchInput),
    z: Math.atan2(siny, cosy),
  };
}

function linearRgbHex(value: unknown): string {
  const source = Array.isArray(value) ? value : [1, 1, 1];
  return `#${source.slice(0, 3).map((entry) =>
    Math.round(Math.max(0, Math.min(1, Number(entry) || 0)) * 255)
      .toString(16)
      .padStart(2, '0'),
  ).join('')}`;
}

function lightIndex(node: { metadata?: Record<string, unknown> }): number | null {
  const extensions = node.metadata?.gltfExtensions;
  if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)) return null;
  const punctual = (extensions as Record<string, unknown>).KHR_lights_punctual;
  if (!punctual || typeof punctual !== 'object' || Array.isArray(punctual)) return null;
  const value = (punctual as Record<string, unknown>).light;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function restoreImportedLights(scene: KyxosSceneContract): boolean {
  const report = (globalThis as typeof globalThis & RuntimeGlobal).__kyxosLastGlbImportReport;
  if (!report?.lights?.length) return false;
  const restored: SceneLight[] = [];
  const used = new Set<number>();
  for (const node of scene.nodes) {
    if (!node.lightId) continue;
    const index = lightIndex(node);
    if (index == null || used.has(index)) continue;
    const source = report.lights[index];
    if (!source) continue;
    const reportNode = report.nodes?.find((entry) => entry.index === node.metadata?.gltfNodeIndex);
    const spot = source.spot ?? {};
    restored.push({
      id: node.lightId,
      name: source.name || node.name || `Light ${index + 1}`,
      type: source.type === 'point' || source.type === 'spot' ? source.type : 'directional',
      color: linearRgbHex(source.color),
      intensity: Number.isFinite(source.intensity) ? Number(source.intensity) : 1,
      transform: {
        position: {
          x: Number(reportNode?.translation?.[0] ?? node.transform.position.x),
          y: Number(reportNode?.translation?.[1] ?? node.transform.position.y),
          z: Number(reportNode?.translation?.[2] ?? node.transform.position.z),
        },
        rotation: reportNode?.rotation
          ? quaternionToEuler(reportNode.rotation)
          : structuredClone(node.transform.rotation),
        scale: { x: 1, y: 1, z: 1 },
      },
      castShadow: true,
      range: source.range,
      decay: source.type === 'directional' ? undefined : 2,
      innerConeAngle: source.type === 'spot' ? spot.innerConeAngle ?? 0 : undefined,
      outerConeAngle: source.type === 'spot' ? spot.outerConeAngle ?? Math.PI / 4 : undefined,
    });
    used.add(index);
    if (restored.length === 4) break;
  }
  if (!restored.length) return false;
  scene.lights = restored;
  document.documentElement.dataset.studioImportedLights = String(restored.length);
  return true;
}

function normalizeStudioScene(scene: KyxosSceneContract, source: string): KyxosSceneContract {
  if (source === 'import-glb') restoreImportedLights(scene);
  stripLegacyDefaultLights(scene);
  return scene;
}

const documentPrototype = SceneDocument.prototype as SceneDocument & Record<PropertyKey, unknown>;
if (!documentPrototype[sceneDocumentInstallKey]) {
  const originalReplace = documentPrototype.replace;
  documentPrototype.replace = function replaceWithStudioRuntimeFixes(
    scene: KyxosSceneContract,
    source = 'replace',
  ): void {
    originalReplace.call(this, normalizeStudioScene(scene, source), source);
  };
  documentPrototype[sceneDocumentInstallKey] = true;
}

const workspacePrototype = SceneWorkspaceService.prototype as SceneWorkspaceService & Record<PropertyKey, unknown>;
if (!workspacePrototype[workspaceInstallKey]) {
  const originalUpdateScene = workspacePrototype.updateScene;
  workspacePrototype.updateScene = function updateSceneWithoutDefaultLights(
    sceneId: string,
    scene: KyxosSceneContract,
  ): void {
    originalUpdateScene.call(this, sceneId, normalizeStudioScene(scene, 'workspace-update'));
  };
  workspacePrototype[workspaceInstallKey] = true;
}

const autosavePrototype = AutosaveController.prototype as AutosaveController & Record<PropertyKey, unknown>;
if (!autosavePrototype[autosaveInstallKey]) {
  const originalFlush = autosavePrototype.flush;
  autosavePrototype.flush = async function flushWithInitialDraftBootstrap(): Promise<void> {
    const internal = this as unknown as AutosaveInternals;
    if (!internal.disposed && !internal.dirty && internal.revisionValue === 0) {
      const existing = await internal.repository.load(internal.projectId);
      if (existing) {
        internal.revisionValue = existing.revision;
      } else {
        internal.dirty = true;
        document.documentElement.dataset.publishDraftBootstrap = 'pending';
      }
    }
    await originalFlush.call(this);
    if (internal.revisionValue > 0) {
      document.documentElement.dataset.publishDraftBootstrap = 'ready';
    }
  };
  autosavePrototype[autosaveInstallKey] = true;
}
