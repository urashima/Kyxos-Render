import './advanced-render-augmentation';

import {
  assertSceneContract as assertBaseSceneContract,
  createEmptySceneContract as createBaseEmptySceneContract,
  validateSceneContract as validateBaseSceneContract,
  type ContractValidationIssue,
  type ContractValidationResult,
  type KyxosSceneContract,
} from './index';
import {
  DEFAULT_ADVANCED_RENDER_SETTINGS,
  type SceneAdvancedRenderSettings,
} from './advanced-render-settings';

export * from './index';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function push(
  issues: ContractValidationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

function validateAdvancedRendering(
  value: unknown,
  issues: ContractValidationIssue[],
): void {
  if (value == null) return; // Backward-compatible with pre-advanced 1.1 scenes.
  if (!isRecord(value)) {
    push(issues, '/renderSettings/advanced', 'type', 'Advanced render settings must be an object.');
    return;
  }

  if (!['realtime', 'cinematic', 'pathTracing'].includes(String(value.renderingMode))) {
    push(issues, '/renderSettings/advanced/renderingMode', 'enum', 'Unsupported advanced rendering mode.');
  }

  const restir = value.restirDI;
  if (!isRecord(restir)) {
    push(issues, '/renderSettings/advanced/restirDI', 'required', 'ReSTIR DI settings are required.');
  } else {
    if (!['off', 'initial', 'temporal', 'temporalSpatial'].includes(String(restir.mode))) {
      push(issues, '/renderSettings/advanced/restirDI/mode', 'enum', 'Unsupported ReSTIR DI mode.');
    }
    if (!Number.isInteger(restir.candidates) || Number(restir.candidates) < 1 || Number(restir.candidates) > 32) {
      push(issues, '/renderSettings/advanced/restirDI/candidates', 'range', 'ReSTIR candidates must be an integer between 1 and 32.');
    }
    if (!Number.isInteger(restir.spatialSamples) || Number(restir.spatialSamples) < 0 || Number(restir.spatialSamples) > 32) {
      push(issues, '/renderSettings/advanced/restirDI/spatialSamples', 'range', 'ReSTIR spatial samples must be an integer between 0 and 32.');
    }
  }

  const cache = value.radianceCache;
  if (!isRecord(cache)) {
    push(issues, '/renderSettings/advanced/radianceCache', 'required', 'Radiance cache settings are required.');
  } else {
    if (typeof cache.enabled !== 'boolean') {
      push(issues, '/renderSettings/advanced/radianceCache/enabled', 'type', 'Radiance cache enabled must be boolean.');
    }
    if (!finite(cache.cellSize) || Number(cache.cellSize) < 0.05 || Number(cache.cellSize) > 16) {
      push(issues, '/renderSettings/advanced/radianceCache/cellSize', 'range', 'Radiance cache cell size must be between 0.05 and 16.');
    }
    if (!Number.isInteger(cache.capacity) || Number(cache.capacity) < 1024 || Number(cache.capacity) > 1048576) {
      push(issues, '/renderSettings/advanced/radianceCache/capacity', 'range', 'Radiance cache capacity must be an integer between 1024 and 1048576.');
    }
    if (!finite(cache.updateRatio) || Number(cache.updateRatio) < 0.0025 || Number(cache.updateRatio) > 1) {
      push(issues, '/renderSettings/advanced/radianceCache/updateRatio', 'range', 'Radiance cache update ratio must be between 0.0025 and 1.');
    }
  }

  const path = value.pathTracing;
  if (!isRecord(path)) {
    push(issues, '/renderSettings/advanced/pathTracing', 'required', 'Path tracing settings are required.');
  } else {
    if (!Number.isInteger(path.maxBounces) || Number(path.maxBounces) < 1 || Number(path.maxBounces) > 16) {
      push(issues, '/renderSettings/advanced/pathTracing/maxBounces', 'range', 'Path tracing maxBounces must be an integer between 1 and 16.');
    }
    if (!Number.isInteger(path.samplesPerFrame) || Number(path.samplesPerFrame) < 1 || Number(path.samplesPerFrame) > 4) {
      push(issues, '/renderSettings/advanced/pathTracing/samplesPerFrame', 'range', 'Path tracing samplesPerFrame must be an integer between 1 and 4.');
    }
    if (typeof path.denoise !== 'boolean') {
      push(issues, '/renderSettings/advanced/pathTracing/denoise', 'type', 'Path tracing denoise must be boolean.');
    }
    if (!finite(path.fireflyClamp) || Number(path.fireflyClamp) < 1 || Number(path.fireflyClamp) > 1000) {
      push(issues, '/renderSettings/advanced/pathTracing/fireflyClamp', 'range', 'Path tracing firefly clamp must be between 1 and 1000.');
    }
    if (!finite(path.resolutionScale) || Number(path.resolutionScale) < 0.25 || Number(path.resolutionScale) > 1) {
      push(issues, '/renderSettings/advanced/pathTracing/resolutionScale', 'range', 'Path tracing resolution scale must be between 0.25 and 1.');
    }
  }
}

export function validateSceneContract(value: unknown): ContractValidationResult {
  const base = validateBaseSceneContract(value);
  const issues = [...base.issues];
  if (isRecord(value) && isRecord(value.renderSettings)) {
    validateAdvancedRendering(value.renderSettings.advanced, issues);
  }
  return { valid: issues.length === 0, issues };
}

export function assertSceneContract(value: unknown): asserts value is KyxosSceneContract {
  // Preserve the base guard's existing invariant checks, then apply the advanced extension.
  assertBaseSceneContract(value);
  const result = validateSceneContract(value);
  if (!result.valid) {
    throw new Error(result.issues.map((entry) => `${entry.path || '/'}: ${entry.message}`).join('\n'));
  }
}

export function createEmptySceneContract(name = 'Untitled Scene'): KyxosSceneContract {
  const scene = createBaseEmptySceneContract(name);
  scene.renderSettings.advanced = structuredClone(DEFAULT_ADVANCED_RENDER_SETTINGS) as SceneAdvancedRenderSettings;
  return scene;
}
