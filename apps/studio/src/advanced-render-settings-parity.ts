import type { JsonPatchOperation, KyxosSceneContract } from '@kyxos/scene-contract';
import {
  DEFAULT_ADVANCED_RENDER_SETTINGS,
  normalizeAdvancedRenderSettings,
  type AdvancedRenderingMode,
  type RestirDIMode,
  type SceneAdvancedRenderSettings,
} from '@kyxos/scene-contract/advanced-render-settings';

interface StudioAdvancedApi {
  getScene(): KyxosSceneContract;
  applyPatch(label: string, patch: JsonPatchOperation[]): void;
}

interface KyxosStudioAdvancedGlobal { api: StudioAdvancedApi }

declare global {
  var kyxosStudio: KyxosStudioAdvancedGlobal | undefined;
}

let mountQueued = false;

function runtime(): KyxosStudioAdvancedGlobal | null {
  return globalThis.kyxosStudio ?? null;
}

function current(scene: KyxosSceneContract): SceneAdvancedRenderSettings {
  const renderSettings = scene.renderSettings as typeof scene.renderSettings & { advanced?: SceneAdvancedRenderSettings };
  return normalizeAdvancedRenderSettings(renderSettings.advanced ?? DEFAULT_ADVANCED_RENDER_SETTINGS);
}

function update(scene: KyxosSceneContract, label: string, change: Partial<SceneAdvancedRenderSettings>): void {
  const previous = current(scene);
  const next = normalizeAdvancedRenderSettings({
    ...previous,
    ...change,
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
    button.addEventListener('click', () => onSelect(option.value));
    group.append(button);
  }
  row.append(label, group);
  return row;
}

function switchControl(labelText: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
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
  button.innerHTML = '<span aria-hidden="true"></span>';
  button.addEventListener('click', () => onChange(button.getAttribute('aria-checked') !== 'true'));
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
  output.textContent = Number(value).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0);
  slider.addEventListener('input', () => {
    output.textContent = Number(slider.value).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0);
  });
  slider.addEventListener('change', () => onChange(Number(slider.value)));
  row.append(label, slider, output);
  return row;
}

function detailsCard(titleText: string, enabled = true): { root: HTMLDetailsElement; body: HTMLDivElement } {
  const root = document.createElement('details');
  root.className = 'kx-render-effect kx-advanced-render-card';
  root.open = false;
  const summary = document.createElement('summary');
  const title = document.createElement('span');
  title.textContent = titleText;
  const state = document.createElement('span');
  state.className = 'kx-advanced-render-state';
  state.textContent = enabled ? 'WebGPU' : 'Off';
  summary.append(title, state);
  const body = document.createElement('div');
  body.className = 'kx-render-effect-body';
  root.append(summary, body);
  return { root, body };
}

function mount(): void {
  const api = runtime()?.api;
  if (!api) return;
  const renderBody = document.querySelector<HTMLElement>('.kx-render-settings-body');
  if (!renderBody || renderBody.querySelector('[data-kx-advanced-render-settings]')) return;
  const scene = api.getScene();
  const settings = current(scene);

  const group = document.createElement('section');
  group.className = 'kx-render-group kx-advanced-render-settings';
  group.dataset.kxAdvancedRenderSettings = 'true';
  group.innerHTML = '<h3>WebGPU Advanced Rendering</h3>';

  const note = document.createElement('p');
  note.className = 'kx-render-empty';
  note.textContent = 'Cinematic and Path Traced Preview use Kyxos software BVH / WebGPU compute. WebGL2 remains the automatic realtime fallback.';
  group.append(note);

  group.append(segmented<AdvancedRenderingMode>(
    'Rendering mode',
    [
      { value: 'realtime', label: 'Realtime' },
      { value: 'cinematic', label: 'Cinematic' },
      { value: 'pathTracing', label: 'Path Traced' },
    ],
    settings.renderingMode,
    (renderingMode) => update(scene, 'Advanced rendering mode', { renderingMode }),
  ));

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
      (mode) => update(scene, 'ReSTIR DI mode', { restirDI: { ...settings.restirDI, mode } }),
    ),
    rangeControl('Candidates', settings.restirDI.candidates, 1, 32, 1, (candidates) =>
      update(scene, 'ReSTIR candidates', { restirDI: { ...settings.restirDI, candidates } })),
    rangeControl('Spatial samples', settings.restirDI.spatialSamples, 0, 32, 1, (spatialSamples) =>
      update(scene, 'ReSTIR spatial samples', { restirDI: { ...settings.restirDI, spatialSamples } })),
  );

  const cache = detailsCard('World-Space Radiance Cache', settings.radianceCache.enabled);
  cache.body.append(
    switchControl('Enabled', settings.radianceCache.enabled, (enabled) =>
      update(scene, 'Radiance cache', { radianceCache: { ...settings.radianceCache, enabled } })),
    rangeControl('Cell size', settings.radianceCache.cellSize, 0.1, 4, 0.1, (cellSize) =>
      update(scene, 'Radiance cache cell size', { radianceCache: { ...settings.radianceCache, cellSize } })),
    rangeControl('Update ratio', settings.radianceCache.updateRatio, 0.01, 0.25, 0.01, (updateRatio) =>
      update(scene, 'Radiance cache update ratio', { radianceCache: { ...settings.radianceCache, updateRatio } })),
  );

  const path = detailsCard('Progressive Path Tracing', settings.renderingMode === 'pathTracing');
  path.body.append(
    rangeControl('Max bounces', settings.pathTracing.maxBounces, 1, 16, 1, (maxBounces) =>
      update(scene, 'Path tracing bounces', { pathTracing: { ...settings.pathTracing, maxBounces } })),
    rangeControl('Samples / frame', settings.pathTracing.samplesPerFrame, 1, 4, 1, (samplesPerFrame) =>
      update(scene, 'Path tracing samples', { pathTracing: { ...settings.pathTracing, samplesPerFrame } })),
    rangeControl('Resolution', settings.pathTracing.resolutionScale, 0.25, 1, 0.05, (resolutionScale) =>
      update(scene, 'Path tracing resolution', { pathTracing: { ...settings.pathTracing, resolutionScale } })),
    rangeControl('Firefly clamp', settings.pathTracing.fireflyClamp, 1, 100, 1, (fireflyClamp) =>
      update(scene, 'Path tracing firefly clamp', { pathTracing: { ...settings.pathTracing, fireflyClamp } })),
    switchControl('Denoise', settings.pathTracing.denoise, (denoise) =>
      update(scene, 'Path tracing denoise', { pathTracing: { ...settings.pathTracing, denoise } })),
  );

  const runtimeState = document.createElement('div');
  runtimeState.className = 'kx-render-empty kx-advanced-runtime-status';
  const viewerCanvas = document.querySelector<HTMLCanvasElement>('canvas[data-advanced-render-state]');
  runtimeState.textContent = viewerCanvas
    ? `Runtime: ${viewerCanvas.dataset.advancedRenderState ?? 'idle'} · ${viewerCanvas.dataset.advancedRenderMode ?? 'realtime'}`
    : 'Runtime capability is negotiated by KyxosViewer when the mode is activated.';

  group.append(restir.root, cache.root, path.root, runtimeState);
  const effects = renderBody.querySelector('.kx-render-effects');
  renderBody.insertBefore(group, effects ?? null);
}

function scheduleMount(): void {
  if (mountQueued) return;
  mountQueued = true;
  queueMicrotask(() => {
    mountQueued = false;
    mount();
  });
}

const observer = new MutationObserver(scheduleMount);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('kyxos-advanced-render-status', scheduleMount as EventListener);
scheduleMount();
