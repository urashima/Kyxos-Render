import type { JsonPatchOperation, KyxosSceneContract } from '@kyxos/scene-contract';
import {
  DEFAULT_ADVANCED_RENDER_SETTINGS,
  normalizeAdvancedRenderSettings,
  type AdvancedRenderingMode,
  type RestirDIMode,
  type SceneAdvancedLightSamplingSettings,
  type SceneAdvancedRenderSettings,
  type ScenePathTracingSettings,
  type SceneRadianceCacheSettings,
  type SceneRayTracingSettings,
  type SceneRestirDISettings,
} from '@kyxos/scene-contract/advanced-render-settings';

interface StudioAdvancedApi {
  getScene(): KyxosSceneContract;
  applyPatch(label: string, patch: JsonPatchOperation[]): void;
}

interface KyxosStudioAdvancedGlobal { api: StudioAdvancedApi }

interface RuntimeStatus {
  requestedMode?: AdvancedRenderingMode;
  effectiveMode?: AdvancedRenderingMode;
  state?: string;
  message?: string | null;
  samples?: number;
  triangles?: number;
  bvhNodes?: number;
  lights?: number;
  advancedGpuBytes?: number;
  enabledFeatures?: string[];
  unavailableFeatures?: string[];
}

type AdvancedUpdate = {
  renderingMode?: AdvancedRenderingMode;
  lightSampling?: Partial<SceneAdvancedLightSamplingSettings>;
  rayTracing?: Partial<SceneRayTracingSettings>;
  restirDI?: Partial<SceneRestirDISettings>;
  radianceCache?: Partial<SceneRadianceCacheSettings>;
  pathTracing?: Partial<ScenePathTracingSettings>;
};

declare global {
  var kyxosStudio: KyxosStudioAdvancedGlobal | undefined;
}

let mountQueued = false;
let boundCanvas: HTMLCanvasElement | null = null;
let runtimeStatus: RuntimeStatus | null = null;

function runtime(): KyxosStudioAdvancedGlobal | null {
  return globalThis.kyxosStudio ?? null;
}

function current(scene: KyxosSceneContract): SceneAdvancedRenderSettings {
  const renderSettings = scene.renderSettings as typeof scene.renderSettings & { advanced?: SceneAdvancedRenderSettings };
  return normalizeAdvancedRenderSettings(renderSettings.advanced ?? DEFAULT_ADVANCED_RENDER_SETTINGS);
}

function update(scene: KyxosSceneContract, label: string, change: AdvancedUpdate): void {
  const previous = current(scene);
  const next = normalizeAdvancedRenderSettings({
    ...previous,
    ...change,
    lightSampling: { ...previous.lightSampling, ...(change.lightSampling ?? {}) },
    rayTracing: { ...previous.rayTracing, ...(change.rayTracing ?? {}) },
    restirDI: { ...previous.restirDI, ...(change.restirDI ?? {}) },
    radianceCache: { ...previous.radianceCache, ...(change.radianceCache ?? {}) },
    pathTracing: { ...previous.pathTracing, ...(change.pathTracing ?? {}) },
  });
  const renderSettings = scene.renderSettings as typeof scene.renderSettings & { advanced?: SceneAdvancedRenderSettings };
  runtime()?.api.applyPatch(label, [{
    op: renderSettings.advanced ? 'replace' : 'add',
    path: '/renderSettings/advanced',
    value: next,
  }]);
  queueMicrotask(refreshMountedControls);
}

function segmented<T extends string>(
  labelText: string,
  options: readonly { value: T; label: string }[],
  selected: T,
  onSelect: (value: T) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kx-render-row kx-render-row-segmented';
  const label = document.createElement('span');
  label.className = 'kx-render-label';
  label.textContent = labelText;
  const group = document.createElement('div');
  group.className = 'kx-segmented';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', labelText);
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.label;
    button.dataset.value = option.value;
    button.setAttribute('aria-pressed', String(option.value === selected));
    button.addEventListener('click', () => {
      for (const sibling of group.querySelectorAll('button')) sibling.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
      onSelect(option.value);
    });
    group.append(button);
  }
  row.append(label, group);
  return row;
}

function switchControl(
  labelText: string,
  checked: boolean,
  onChange: (value: boolean) => void,
  disabled = false,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kx-render-row';
  const label = document.createElement('span');
  label.className = 'kx-render-label';
  label.textContent = labelText;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kx-render-switch';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-label', labelText);
  button.setAttribute('aria-checked', String(checked));
  button.disabled = disabled;
  button.innerHTML = '<span aria-hidden="true"></span>';
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  row.append(label, button);
  return row;
}

function rangeControl(
  labelText: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (value: number) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kx-render-row kx-render-row-range';
  const label = document.createElement('label');
  label.className = 'kx-render-label';
  label.textContent = labelText;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);
  slider.setAttribute('aria-label', labelText);
  const output = document.createElement('output');
  const decimals = step < 0.001 ? 4 : step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const format = () => Number(slider.value).toFixed(decimals);
  output.textContent = format();
  slider.addEventListener('input', () => { output.textContent = format(); });
  slider.addEventListener('change', () => onChange(Number(slider.value)));
  row.append(label, slider, output);
  return row;
}

function detailsCard(titleText: string, enabled = true, open = false): { root: HTMLDetailsElement; body: HTMLDivElement } {
  const root = document.createElement('details');
  root.className = 'kx-render-effect kx-advanced-render-card';
  root.open = open;
  const summary = document.createElement('summary');
  const title = document.createElement('span');
  title.textContent = titleText;
  const state = document.createElement('span');
  state.className = 'kx-advanced-render-state';
  state.textContent = enabled ? 'On' : 'Off';
  summary.append(title, state);
  const body = document.createElement('div');
  body.className = 'kx-render-effect-body';
  root.append(summary, body);
  return { root, body };
}

function infoRow(labelText: string, value: string, id?: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kx-render-row';
  const label = document.createElement('span');
  label.className = 'kx-render-label';
  label.textContent = labelText;
  const output = document.createElement('span');
  if (id) output.id = id;
  output.textContent = value;
  row.append(label, output);
  return row;
}

function bytes(value = 0): string {
  return value > 0 ? `${(value / 1024 / 1024).toFixed(1)} MB` : '0 MB';
}

function mount(): void {
  const api = runtime()?.api;
  if (!api) return;
  const renderBody = document.querySelector<HTMLElement>('.kx-render-settings-body');
  if (!renderBody || renderBody.querySelector('[data-kx-advanced-render-settings]')) {
    bindRuntimeStatus();
    refreshRuntimeStatus();
    return;
  }

  const scene = api.getScene();
  const settings = current(scene);
  const pathEnabled = settings.renderingMode === 'pathTracing';
  const realtimeRtEnabled = settings.rayTracing.enabled && !pathEnabled;

  const group = document.createElement('section');
  group.className = 'kx-render-group kx-advanced-render-settings';
  group.dataset.kxAdvancedRenderSettings = 'true';
  group.innerHTML = '<h3>Advanced Rendering</h3>';

  const note = document.createElement('p');
  note.className = 'kx-render-empty';
  note.textContent = 'RT AO, shadows, reflection and refraction are realtime enhancements. They remain active while the camera moves; temporal denoise and fusion reconstruct each frame. Path Trace is the separate progressive reference mode.';
  group.append(note);

  group.append(segmented<AdvancedRenderingMode>(
    'Rendering mode',
    [
      { value: 'realtime', label: 'Realtime' },
      { value: 'cinematic', label: 'RT Preset' },
      { value: 'pathTracing', label: 'Path Trace' },
    ],
    settings.renderingMode,
    (renderingMode) => update(scene, 'Advanced rendering mode', { renderingMode }),
  ));

  const sampling = detailsCard('Light Sampling', true, true);
  sampling.body.append(
    switchControl('HDRI importance sampling', settings.lightSampling.environmentImportance, (environmentImportance) =>
      update(scene, 'HDRI importance sampling', { lightSampling: { environmentImportance } })),
    switchControl('Emissive triangle sampling', settings.lightSampling.emissiveTriangles, (emissiveTriangles) =>
      update(scene, 'Emissive triangle sampling', { lightSampling: { emissiveTriangles } })),
  );

  const rt = detailsCard('Realtime Ray Tracing', realtimeRtEnabled, realtimeRtEnabled);
  rt.body.append(
    switchControl('RT Enabled', settings.rayTracing.enabled, (enabled) =>
      update(scene, 'Realtime ray tracing', { rayTracing: { enabled } })),
    switchControl('Ray traced shadows', settings.rayTracing.shadows, (shadows) =>
      update(scene, 'Ray traced shadows', { rayTracing: { shadows } })),
    rangeControl('Shadow bias', settings.rayTracing.shadowBias, 0.0001, 0.02, 0.0001, (shadowBias) =>
      update(scene, 'Ray shadow bias', { rayTracing: { shadowBias } })),
    switchControl('Ray AO', settings.rayTracing.ambientOcclusion, (ambientOcclusion) =>
      update(scene, 'Ray ambient occlusion', { rayTracing: { ambientOcclusion } })),
    rangeControl('AO radius', settings.rayTracing.aoRadius, 0.05, 5, 0.05, (aoRadius) =>
      update(scene, 'Ray AO radius', { rayTracing: { aoRadius } })),
    rangeControl('AO strength', settings.rayTracing.aoStrength, 0, 1, 0.05, (aoStrength) =>
      update(scene, 'Ray AO strength', { rayTracing: { aoStrength } })),
    switchControl('Ray reflections', settings.rayTracing.reflections, (reflections) =>
      update(scene, 'Ray reflections', { rayTracing: { reflections } })),
    rangeControl('Reflection max roughness', settings.rayTracing.reflectionMaxRoughness, 0.05, 1, 0.05, (reflectionMaxRoughness) =>
      update(scene, 'Ray reflection roughness', { rayTracing: { reflectionMaxRoughness } })),
    switchControl('Ray refractions', settings.rayTracing.refractions, (refractions) =>
      update(scene, 'Ray refractions', { rayTracing: { refractions } })),
    rangeControl('Refraction max roughness', settings.rayTracing.refractionMaxRoughness, 0.02, 1, 0.02, (refractionMaxRoughness) =>
      update(scene, 'Ray refraction roughness', { rayTracing: { refractionMaxRoughness } })),
    rangeControl('Refraction strength', settings.rayTracing.refractionStrength, 0, 2, 0.05, (refractionStrength) =>
      update(scene, 'Ray refraction strength', { rayTracing: { refractionStrength } })),
    switchControl('Realtime denoise', settings.rayTracing.realtimeDenoise, (realtimeDenoise) =>
      update(scene, 'Realtime RT denoise', { rayTracing: { realtimeDenoise } })),
    rangeControl('Denoise radius', settings.rayTracing.denoiseRadius, 0.5, 3, 0.1, (denoiseRadius) =>
      update(scene, 'Realtime RT denoise radius', { rayTracing: { denoiseRadius } })),
    rangeControl('Denoise strength', settings.rayTracing.denoiseStrength, 0, 1, 0.05, (denoiseStrength) =>
      update(scene, 'Realtime RT denoise strength', { rayTracing: { denoiseStrength } })),
    switchControl('Realtime fusion', settings.rayTracing.realtimeFusion, (realtimeFusion) =>
      update(scene, 'Realtime RT fusion', { rayTracing: { realtimeFusion } })),
    rangeControl('Fusion strength', settings.rayTracing.fusionStrength, 0, 1.5, 0.05, (fusionStrength) =>
      update(scene, 'Realtime RT fusion strength', { rayTracing: { fusionStrength } })),
  );

  const restir = detailsCard('ReSTIR Direct Lighting', settings.restirDI.mode !== 'off');
  restir.body.append(
    segmented<RestirDIMode>(
      'Mode',
      [
        { value: 'off', label: 'Off' },
        { value: 'initial', label: 'Initial' },
        { value: 'temporal', label: 'Temporal' },
        { value: 'temporalSpatial', label: 'T + S' },
      ],
      settings.restirDI.mode,
      (mode) => update(scene, 'ReSTIR DI mode', { restirDI: { mode } }),
    ),
    rangeControl('Candidates', settings.restirDI.candidates, 1, 32, 1, (candidates) =>
      update(scene, 'ReSTIR candidates', { restirDI: { candidates } })),
    rangeControl('Spatial samples', settings.restirDI.spatialSamples, 0, 32, 1, (spatialSamples) =>
      update(scene, 'ReSTIR spatial samples', { restirDI: { spatialSamples } })),
  );

  const cache = detailsCard('World-Space Radiance Cache', settings.radianceCache.enabled);
  cache.body.append(
    switchControl('Enabled', settings.radianceCache.enabled, (enabled) =>
      update(scene, 'Radiance cache', { radianceCache: { enabled } })),
    rangeControl('Cell size', settings.radianceCache.cellSize, 0.05, 4, 0.05, (cellSize) =>
      update(scene, 'Radiance cache cell size', { radianceCache: { cellSize } })),
    rangeControl('Capacity', settings.radianceCache.capacity, 1024, 262144, 1024, (capacity) =>
      update(scene, 'Radiance cache capacity', { radianceCache: { capacity } })),
    rangeControl('Update ratio', settings.radianceCache.updateRatio, 0.005, 0.5, 0.005, (updateRatio) =>
      update(scene, 'Radiance cache update ratio', { radianceCache: { updateRatio } })),
  );

  const path = detailsCard('Progressive Path Tracing', pathEnabled, pathEnabled);
  path.body.append(
    switchControl('Enabled', pathEnabled, (enabled) =>
      update(scene, 'Progressive path tracing', { renderingMode: enabled ? 'pathTracing' : 'realtime' })),
    rangeControl('Max bounces', settings.pathTracing.maxBounces, 1, 16, 1, (maxBounces) =>
      update(scene, 'Path tracing bounces', { pathTracing: { maxBounces } })),
    rangeControl('Samples / frame', settings.pathTracing.samplesPerFrame, 1, 4, 1, (samplesPerFrame) =>
      update(scene, 'Path tracing samples', { pathTracing: { samplesPerFrame } })),
    rangeControl('Resolution', settings.pathTracing.resolutionScale, 0.25, 1, 0.05, (resolutionScale) =>
      update(scene, 'Path tracing resolution', { pathTracing: { resolutionScale } })),
    rangeControl('Firefly clamp', settings.pathTracing.fireflyClamp, 1, 100, 1, (fireflyClamp) =>
      update(scene, 'Path tracing firefly clamp', { pathTracing: { fireflyClamp } })),
    switchControl('Denoise', settings.pathTracing.denoise, (denoise) =>
      update(scene, 'Path tracing denoise', { pathTracing: { denoise } })),
    rangeControl('Denoise radius', settings.pathTracing.denoiseRadius, 0, 2, 1, (denoiseRadius) =>
      update(scene, 'Path denoise radius', { pathTracing: { denoiseRadius } })),
    rangeControl('Denoise strength', settings.pathTracing.denoiseStrength, 0, 1, 0.05, (denoiseStrength) =>
      update(scene, 'Path denoise strength', { pathTracing: { denoiseStrength } })),
  );

  const runtimeCard = detailsCard('Runtime / Capabilities', true, false);
  runtimeCard.body.append(
    infoRow('State', 'idle · realtime', 'kx-advanced-runtime-state'),
    infoRow('RT phases', '0', 'kx-advanced-runtime-samples'),
    infoRow('Scene acceleration', '—', 'kx-advanced-runtime-scene'),
    infoRow('Advanced GPU memory', '0 MB', 'kx-advanced-runtime-memory'),
    infoRow('Active features', '—', 'kx-advanced-runtime-features'),
    infoRow('Unavailable', '—', 'kx-advanced-runtime-unavailable'),
    infoRow('Status', 'Realtime raster remains authoritative.', 'kx-advanced-runtime-message'),
  );

  group.append(sampling.root, rt.root, restir.root, cache.root, path.root, runtimeCard.root);
  const effects = renderBody.querySelector('.kx-render-effects');
  renderBody.insertBefore(group, effects ?? null);
  bindRuntimeStatus();
  refreshRuntimeStatus();
}

function bindRuntimeStatus(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#studio-canvas, canvas[data-advanced-render-state]');
  if (!canvas || canvas === boundCanvas) return;
  boundCanvas = canvas;
  canvas.addEventListener('kyxos-advanced-render-status', (event) => {
    runtimeStatus = (event as CustomEvent<RuntimeStatus>).detail;
    refreshRuntimeStatus();
  });
}

function refreshRuntimeStatus(): void {
  const canvas = boundCanvas;
  const status = runtimeStatus;
  const state = document.querySelector<HTMLElement>('#kx-advanced-runtime-state');
  const samples = document.querySelector<HTMLElement>('#kx-advanced-runtime-samples');
  const scene = document.querySelector<HTMLElement>('#kx-advanced-runtime-scene');
  const memory = document.querySelector<HTMLElement>('#kx-advanced-runtime-memory');
  const features = document.querySelector<HTMLElement>('#kx-advanced-runtime-features');
  const unavailable = document.querySelector<HTMLElement>('#kx-advanced-runtime-unavailable');
  const message = document.querySelector<HTMLElement>('#kx-advanced-runtime-message');
  if (state) state.textContent = `${status?.state ?? canvas?.dataset.advancedRenderState ?? 'idle'} · ${status?.effectiveMode ?? canvas?.dataset.advancedRenderMode ?? 'realtime'}`;
  if (samples) samples.textContent = String(status?.samples ?? 0);
  if (scene) scene.textContent = status ? `${status.triangles ?? 0} tri · ${status.bvhNodes ?? 0} BVH · ${status.lights ?? 0} lights` : '—';
  if (memory) memory.textContent = bytes(status?.advancedGpuBytes ?? 0);
  if (features) features.textContent = status?.enabledFeatures?.length ? status.enabledFeatures.join(', ') : 'Raster / environment';
  if (unavailable) unavailable.textContent = status?.unavailableFeatures?.length ? status.unavailableFeatures.join(', ') : 'None';
  if (message) message.textContent = status?.message || 'Realtime raster remains visible while optional RT work is skipped or unavailable.';
}

function refreshMountedControls(): void {
  const existing = document.querySelector<HTMLElement>('[data-kx-advanced-render-settings]');
  if (!existing) {
    scheduleMount();
    return;
  }
  existing.remove();
  mount();
}

function scheduleMount(): void {
  if (mountQueued) return;
  mountQueued = true;
  queueMicrotask(() => {
    mountQueued = false;
    mount();
  });
}

const observer = new MutationObserver(() => {
  bindRuntimeStatus();
  scheduleMount();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
scheduleMount();
