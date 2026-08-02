import {
  DiagnosticConsole,
  ImportTaskQueue,
  SceneDocument,
} from '@kyxos/editor-core';
import { mergeReimportedSceneWithOverrides } from '@kyxos/editor-core/reimport';
import type {
  KyxosSceneContract,
  SceneLight,
  SceneMaterial,
} from '@kyxos/scene-contract';
import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

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
  targetNames?: string[];
  primitives: PrimitiveImportReport[];
}

interface GltfPunctualLight {
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

interface GlbImportMetadata {
  textures?: unknown[];
  samplers?: unknown[];
  meshPrimitives?: MeshImportReport[];
  skins?: unknown[];
  rootExtensions?: {
    KHR_lights_punctual?: { lights?: GltfPunctualLight[] };
    [key: string]: unknown;
  };
}

interface SceneDocumentPrototype {
  replace(scene: KyxosSceneContract, source?: string): void;
  value: KyxosSceneContract;
  __kyxosGlbParityInstalled?: boolean;
}

interface ImportTaskQueuePrototype {
  enqueue(
    name: string,
    worker: (context: {
      signal: AbortSignal;
      report(stage: string, progress: number): void;
    }) => Promise<unknown>,
  ): string;
  __kyxosImportLifecycleInstalled?: boolean;
}

interface DiagnosticConsolePrototype {
  log: DiagnosticConsole['log'];
  __kyxosSafeImportDiagnosticsInstalled?: boolean;
}

interface ViewportAdapterPrototype {
  captureThumbnail: BrowserKyxosViewportAdapter['captureThumbnail'];
  __kyxosNonBlockingThumbnailInstalled?: boolean;
}

export interface StudioImportLifecycleDetail {
  name: string;
  stage: string;
  progress: number;
  warning?: unknown;
  timestamp: number;
}

const FALLBACK_THUMBNAIL_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQFJX9DwABwQFDmeGlAgAAAABJRU5ErkJggg==';

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

function readReimportMode(
  scene: KyxosSceneContract,
): 'replace' | 'keep-overrides' | 'reset-overrides' | null {
  const model = Object.values(scene.assets).find((asset) => asset.kind === 'model');
  const mode = model?.metadata?.reimportMode;
  return mode === 'replace' || mode === 'keep-overrides' || mode === 'reset-overrides'
    ? mode
    : null;
}

function errorSummary(value: unknown): Record<string, unknown> {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: value.cause == null ? undefined : normalizeImportDiagnostic(value.cause),
    };
  }
  return { message: String(value) };
}

/** Convert renderer, DOM, Error and cyclic values to structured-clone-safe diagnostics. */
export function normalizeImportDiagnostic(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value;
  }
  if (typeof value === 'symbol' || typeof value === 'function') return String(value);
  if (value instanceof Error) return errorSummary(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Blob) {
    return {
      kind: value instanceof File ? 'File' : 'Blob',
      name: value instanceof File ? value.name : undefined,
      type: value.type,
      size: value.size,
    };
  }
  if (ArrayBuffer.isView(value)) {
    return { kind: value.constructor.name, byteLength: value.byteLength };
  }
  if (value instanceof ArrayBuffer) return { kind: 'ArrayBuffer', byteLength: value.byteLength };
  if (typeof Node !== 'undefined' && value instanceof Node) {
    return {
      kind: value.constructor.name,
      nodeName: value.nodeName,
      textContent: value.textContent?.slice(0, 256),
    };
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => normalizeImportDiagnostic(entry, seen));

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    try {
      result[key] = normalizeImportDiagnostic(
        (value as Record<string, unknown>)[key],
        seen,
      );
    } catch (error) {
      result[key] = `[Unreadable: ${error instanceof Error ? error.message : String(error)}]`;
    }
  }
  if (!Object.keys(result).length) result.kind = value.constructor?.name ?? 'Object';
  return result;
}

function emitImportLifecycle(
  name: string,
  stage: string,
  progress: number,
  warning?: unknown,
): void {
  if (typeof document === 'undefined') return;
  const detail: StudioImportLifecycleDetail = {
    name,
    stage,
    progress: Math.max(0, Math.min(1, progress)),
    warning: warning == null ? undefined : normalizeImportDiagnostic(warning),
    timestamp: Date.now(),
  };
  document.documentElement.dataset.importLifecycleStage = stage;
  document.dispatchEvent(
    new CustomEvent<StudioImportLifecycleDetail>('kyxos:studio-import-lifecycle', { detail }),
  );
}

function fallbackThumbnail(): Blob {
  const binary = atob(FALLBACK_THUMBNAIL_BASE64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

function linearRgbHex(value: number[] | undefined): string {
  const components = value?.slice(0, 3) ?? [1, 1, 1];
  return `#${components
    .map((component) => Math.round(Math.max(0, Math.min(1, component)) * 255)
      .toString(16)
      .padStart(2, '0'))
    .join('')}`;
}

function restorePunctualLights(
  scene: KyxosSceneContract,
  metadata: GlbImportMetadata,
): void {
  const definitions = metadata.rootExtensions?.KHR_lights_punctual?.lights ?? [];
  if (!definitions.length) return;
  const lights: SceneLight[] = [];

  for (const node of scene.nodes) {
    const extensions = node.metadata?.gltfExtensions as
      | { KHR_lights_punctual?: { light?: number } }
      | undefined;
    const lightIndex = extensions?.KHR_lights_punctual?.light;
    if (typeof lightIndex !== 'number') continue;
    const definition = definitions[lightIndex];
    if (!definition) continue;
    const spot = definition.spot ?? {};
    const id = node.lightId ?? crypto.randomUUID();
    node.lightId = id;
    lights.push({
      id,
      name: definition.name || node.name || `Light ${lightIndex + 1}`,
      type: definition.type === 'point' || definition.type === 'spot'
        ? definition.type
        : 'directional',
      color: linearRgbHex(definition.color),
      intensity: definition.intensity ?? 1,
      transform: structuredClone(node.transform),
      castShadow: true,
      range: definition.range,
      decay: definition.type === 'directional' ? undefined : 2,
      innerConeAngle: definition.type === 'spot' ? spot.innerConeAngle ?? 0 : undefined,
      outerConeAngle: definition.type === 'spot'
        ? spot.outerConeAngle ?? Math.PI / 4
        : undefined,
    });
  }

  if (lights.length) scene.lights = lights.slice(0, 4);
}

/** Restore all primitive slots, morph defaults and root glTF component data. */
export function normalizeGlbImportContract(
  input: KyxosSceneContract,
): KyxosSceneContract {
  const metadata = readImportMetadata(input);
  if (!metadata) return input;

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
    const mesh = metadata.meshPrimitives?.find((entry) => entry.meshIndex === node.meshIndex);
    if (!mesh) continue;

    node.materialSlots = mesh.primitives.map((primitive) =>
      primitive.material == null
        ? getFallbackMaterial()
        : materialsByGltfIndex.get(primitive.material) ?? getFallbackMaterial(),
    );
    const defaults = node.morphWeights?.length
      ? node.morphWeights
      : mesh.weights ?? [];
    node.metadata = {
      ...(node.metadata ?? {}),
      gltfPrimitiveCount: mesh.primitives.length,
      gltfPrimitiveModes: mesh.primitives.map((primitive) => primitive.mode),
      gltfMorphTargetCounts: mesh.primitives.map((primitive) => primitive.targets.length),
      gltfMeshWeights: mesh.weights,
      gltfMorphDefaultWeights: structuredClone(defaults),
    };
    if ((!node.morphTargetNames?.length) && mesh.targetNames?.length) {
      node.morphTargetNames = structuredClone(mesh.targetNames);
    }
  }

  restorePunctualLights(scene, metadata);
  return scene;
}

function installSceneContractNormalization(): void {
  const prototype = SceneDocument.prototype as unknown as SceneDocumentPrototype;
  if (prototype.__kyxosGlbParityInstalled) return;

  const originalReplace = prototype.replace;
  prototype.replace = function replaceWithImportNormalization(
    scene: KyxosSceneContract,
    source = 'replace',
  ): void {
    let next = source === 'import-glb' ? normalizeGlbImportContract(scene) : scene;
    if (source === 'import-glb') {
      const mode = readReimportMode(next);
      if (mode) {
        next = mergeReimportedSceneWithOverrides(this.value, next, mode);
      }
    }
    originalReplace.call(this, next, source);
  };
  prototype.__kyxosGlbParityInstalled = true;
}

/** Mirror the PlayCanvas asset-task lifecycle without coupling editor-core to Studio. */
function installImportLifecycle(): void {
  const prototype = ImportTaskQueue.prototype as unknown as ImportTaskQueuePrototype;
  if (prototype.__kyxosImportLifecycleInstalled) return;

  const originalEnqueue = prototype.enqueue;
  prototype.enqueue = function enqueueWithLifecycle(name, worker): string {
    emitImportLifecycle(name, 'queued', 0);
    return originalEnqueue.call(this, name, async (context) => {
      try {
        const result = await worker({
          signal: context.signal,
          report(stage, progress) {
            emitImportLifecycle(name, stage, progress);
            context.report(stage as never, progress);
          },
        });
        emitImportLifecycle(name, 'core-complete', 1);
        return result;
      } catch (error) {
        emitImportLifecycle(name, context.signal.aborted ? 'cancelled' : 'failed', 1, error);
        throw error;
      }
    });
  };
  prototype.__kyxosImportLifecycleInstalled = true;
}

function installSafeImportDiagnostics(): void {
  const prototype = DiagnosticConsole.prototype as DiagnosticConsolePrototype;
  if (prototype.__kyxosSafeImportDiagnosticsInstalled) return;

  const originalLog = prototype.log;
  prototype.log = function logCloneSafe(level, message, data, source) {
    const safeData = data == null ? undefined : normalizeImportDiagnostic(data);
    try {
      return originalLog.call(this, level, message, safeData, source);
    } catch (serializationError) {
      try {
        return originalLog.call(
          this,
          level,
          message,
          {
            diagnosticSerializationError: errorSummary(serializationError),
            original: typeof data === 'string' ? data : String(data),
          },
          source,
        );
      } catch {
        return originalLog.call(this, level, message, undefined, source);
      }
    }
  };
  prototype.__kyxosSafeImportDiagnosticsInstalled = true;
}

/** Return a deterministic PNG when optional GPU thumbnail readback is unavailable. */
function installNonBlockingThumbnailCapture(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as unknown as ViewportAdapterPrototype;
  if (prototype.__kyxosNonBlockingThumbnailInstalled) return;

  const originalCapture = prototype.captureThumbnail;
  prototype.captureThumbnail = async function captureThumbnailBestEffort() {
    try {
      return await originalCapture.call(this);
    } catch (error) {
      emitImportLifecycle('thumbnail', 'postprocess-warning', 1, error);
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.importThumbnailFallback = 'true';
      }
      return fallbackThumbnail();
    }
  };
  prototype.__kyxosNonBlockingThumbnailInstalled = true;
}

export function installGlbImportParity(): void {
  installSafeImportDiagnostics();
  installImportLifecycle();
  installNonBlockingThumbnailCapture();
  installSceneContractNormalization();
}

installGlbImportParity();
