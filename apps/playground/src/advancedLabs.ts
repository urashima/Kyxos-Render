import {
  KyxosViewer,
  normalizeAdvancedRenderSettings,
  type AdvancedRenderStatus,
  type AdvancedRenderingMode,
  type RestirDIMode,
  type SceneAdvancedRenderSettings,
} from '@kyxos/viewer';

const slug = window.location.pathname.split('/').filter(Boolean).at(-1) ?? '';
const isRtLab = slug === 'rt-lab';
const isPathLab = slug === 'path-tracing';
let labViewer: KyxosViewer | null = null;
let panelMounted = false;

type AdvancedUpdate = {
  renderingMode?: AdvancedRenderingMode;
  lightSampling?: Partial<SceneAdvancedRenderSettings['lightSampling']>;
  rayTracing?: Partial<SceneAdvancedRenderSettings['rayTracing']>;
  restirDI?: Partial<SceneAdvancedRenderSettings['restirDI']>;
  radianceCache?: Partial<SceneAdvancedRenderSettings['radianceCache']>;
  pathTracing?: Partial<SceneAdvancedRenderSettings['pathTracing']>;
};

function requestedMode(): AdvancedRenderingMode {
  return isPathLab ? 'pathTracing' : 'realtime';
}

function routeDefaults(instance: KyxosViewer): void {
  if (!isRtLab && !isPathLab) return;
  const current = instance.getAdvancedRenderSettings();
  instance.setAdvancedRenderSettings(normalizeAdvancedRenderSettings({
    ...current,
    renderingMode: requestedMode(),
    rayTracing: {
      ...current.rayTracing,
      enabled: isRtLab,
      shadows: true,
      ambientOcclusion: isRtLab,
      reflections: true,
      refractions: isRtLab,
      realtimeDenoise: true,
      realtimeFusion: true,
      fusionStrength: 1,
    },
    restirDI: {
      ...current.restirDI,
      mode: 'temporalSpatial',
      candidates: isPathLab ? 16 : 4,
      spatialSamples: isPathLab ? 8 : 4,
    },
    radianceCache: {
      ...current.radianceCache,
      enabled: isPathLab,
      cellSize: 0.5,
      capacity: 65536,
      updateRatio: 0.04,
    },
    pathTracing: {
      ...current.pathTracing,
      maxBounces: isPathLab ? 8 : 3,
      samplesPerFrame: isPathLab ? 2 : 1,
      denoise: true,
      denoiseRadius: 1,
      denoiseStrength: 1,
      fireflyClamp: 20,
      resolutionScale: isPathLab ? 0.75 : 0.5,
    },
  }));
}

function configure(instance: KyxosViewer): void {
  if (!instance.canvas.isConnected) return;
  labViewer = instance;
  routeDefaults(instance);
  instance.canvas.addEventListener('kyxos-advanced-render-status', (event) => {
    updatePanel((event as CustomEvent<AdvancedRenderStatus>).detail);
  });
  instance.canvas.addEventListener('kyxos-advanced-render-warning', (event) => {
    const message = (event as CustomEvent<{ message: string }>).detail.message;
    const warning = document.querySelector<HTMLElement>('#advanced-render-warning');
    if (warning) warning.textContent = message;
  });
  mountPanel();
  syncControls();
  updatePanel(instance.getAdvancedRenderStatus());
}

// Every Playground route shares one Render Controls surface. RT Lab now proves
// the realtime-first architecture explicitly: mode stays Realtime while the RT
// feature master is enabled. Path Tracing is the only separate full-frame mode.
const originalCreate = KyxosViewer.create.bind(KyxosViewer);
(KyxosViewer as unknown as { create: typeof KyxosViewer.create }).create = async (options) => {
  const instance = await originalCreate(options);
  requestAnimationFrame(() => configure(instance));
  return instance;
};

function bytes(value: number): string {
  return value > 0 ? `${(value / 1024 / 1024).toFixed(1)} MB` : '0 MB';
}

function applyUpdate(update: AdvancedUpdate): void {
  if (!labViewer) return;
  const previous = labViewer.getAdvancedRenderSettings();
  const next = normalizeAdvancedRenderSettings({
    ...previous,
    ...update,
    lightSampling: { ...previous.lightSampling, ...(update.lightSampling ?? {}) },
    rayTracing: { ...previous.rayTracing, ...(update.rayTracing ?? {}) },
    restirDI: { ...previous.restirDI, ...(update.restirDI ?? {}) },
    radianceCache: { ...previous.radianceCache, ...(update.radianceCache ?? {}) },
    pathTracing: { ...previous.pathTracing, ...(update.pathTracing ?? {}) },
  });
  labViewer.setAdvancedRenderSettings(next);
  syncControls();
}

function setChecked(id: string, value: boolean): void {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  if (input) input.checked = value;
}

function setValue(id: string, value: string | number): void {
  const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
  if (!input) return;
  input.value = String(value);
  if (input instanceof HTMLInputElement && input.type === 'range') {
    const output = input.nextElementSibling;
    if (output) output.textContent = formatNumber(Number(value), Number(input.step));
  }
}

function formatNumber(value: number, step: number): string {
  if (step < 0.001) return value.toFixed(4);
  if (step < 0.01) return value.toFixed(3);
  if (step < 0.1) return value.toFixed(2);
  if (step < 1) return value.toFixed(1);
  return value.toFixed(0);
}

function syncControls(): void {
  if (!labViewer) return;
  const settings = labViewer.getAdvancedRenderSettings();
  setValue('advanced-render-mode', settings.renderingMode);
  setChecked('advanced-rt-enabled', settings.rayTracing.enabled);
  setChecked('advanced-path-enabled', settings.renderingMode === 'pathTracing');
  setChecked('advanced-env-importance', settings.lightSampling.environmentImportance);
  setChecked('advanced-emissive-sampling', settings.lightSampling.emissiveTriangles);
  setChecked('advanced-ray-shadows', settings.rayTracing.shadows);
  setValue('advanced-shadow-bias', settings.rayTracing.shadowBias);
  setChecked('advanced-ray-ao', settings.rayTracing.ambientOcclusion);
  setValue('advanced-ao-radius', settings.rayTracing.aoRadius);
  setValue('advanced-ao-strength', settings.rayTracing.aoStrength);
  setChecked('advanced-ray-reflections', settings.rayTracing.reflections);
  setValue('advanced-reflection-roughness', settings.rayTracing.reflectionMaxRoughness);
  setChecked('advanced-ray-refractions', settings.rayTracing.refractions);
  setValue('advanced-refraction-roughness', settings.rayTracing.refractionMaxRoughness);
  setValue('advanced-refraction-strength', settings.rayTracing.refractionStrength);
  setChecked('advanced-rt-denoise-enabled', settings.rayTracing.realtimeDenoise);
  setValue('advanced-rt-denoise-radius', settings.rayTracing.denoiseRadius);
  setValue('advanced-rt-denoise-strength', settings.rayTracing.denoiseStrength);
  setChecked('advanced-rt-fusion-enabled', settings.rayTracing.realtimeFusion);
  setValue('advanced-rt-fusion-strength', settings.rayTracing.fusionStrength);
  setValue('advanced-restir-mode', settings.restirDI.mode);
  setValue('advanced-restir-candidates', settings.restirDI.candidates);
  setValue('advanced-restir-spatial', settings.restirDI.spatialSamples);
  setChecked('advanced-cache-enabled', settings.radianceCache.enabled);
  setValue('advanced-cache-cell', settings.radianceCache.cellSize);
  setValue('advanced-cache-capacity', settings.radianceCache.capacity);
  setValue('advanced-cache-update', settings.radianceCache.updateRatio);
  setValue('advanced-path-bounces', settings.pathTracing.maxBounces);
  setValue('advanced-path-spp', settings.pathTracing.samplesPerFrame);
  setValue('advanced-path-resolution', settings.pathTracing.resolutionScale);
  setValue('advanced-firefly', settings.pathTracing.fireflyClamp);
  setChecked('advanced-denoise-enabled', settings.pathTracing.denoise);
  setValue('advanced-denoise-radius', settings.pathTracing.denoiseRadius);
  setValue('advanced-denoise-strength', settings.pathTracing.denoiseStrength);
}

function updatePanel(status: AdvancedRenderStatus): void {
  const state = document.querySelector<HTMLElement>('#advanced-render-state');
  const samples = document.querySelector<HTMLElement>('#advanced-render-samples');
  const scene = document.querySelector<HTMLElement>('#advanced-render-scene');
  const memory = document.querySelector<HTMLElement>('#advanced-render-memory');
  const frame = document.querySelector<HTMLElement>('#advanced-render-frame');
  const active = document.querySelector<HTMLElement>('#advanced-render-active-features');
  const unavailable = document.querySelector<HTMLElement>('#advanced-render-unavailable');
  const warning = document.querySelector<HTMLElement>('#advanced-render-warning');
  if (state) state.textContent = `${status.state} · ${status.effectiveMode}`;
  if (samples) samples.textContent = status.samples.toLocaleString();
  if (scene) scene.textContent = `${status.triangles.toLocaleString()} tri · ${status.bvhNodes.toLocaleString()} BVH · ${status.lights} lights`;
  if (memory) memory.textContent = bytes(status.advancedGpuBytes);
  if (frame) frame.textContent = `${status.cpuFrameTimeMs.toFixed(2)} ms`;
  if (active) active.textContent = status.enabledFeatures.length ? status.enabledFeatures.join(', ') : 'Raster / environment';
  if (unavailable) unavailable.textContent = status.unavailableFeatures.length ? status.unavailableFeatures.join(', ') : 'None';
  if (warning && status.message) warning.textContent = status.message;
  syncControls();
}

function rangeRow(id: string, label: string, min: number, max: number, step: number): string {
  return `<div class="control-row range"><label for="${id}">${label}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${min}"><output>—</output></div>`;
}

function switchRow(id: string, label: string): string {
  return `<div class="control-row"><label for="${id}">${label}</label><input class="switch" id="${id}" type="checkbox"></div>`;
}

function groupTitle(label: string): string {
  return `<div class="control-row"><strong>${label}</strong><span></span></div>`;
}

function mountPanel(): void {
  if (panelMounted) return;
  const inspector = document.querySelector<HTMLElement>('.inspector');
  if (!inspector) {
    requestAnimationFrame(mountPanel);
    return;
  }
  panelMounted = true;

  const sectionLabel = document.createElement('div');
  sectionLabel.className = 'section-label';
  sectionLabel.textContent = 'Advanced rendering';
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.id = 'advanced-render-panel';
  panel.innerHTML = `
    <div class="panel-title"><span>Realtime WebGPU RT / Path Tracing</span><span id="advanced-render-state">idle · realtime</span></div>
    <div class="panel-body">
      <div class="control-row"><label for="advanced-render-mode">Mode</label><select class="select" id="advanced-render-mode">
        <option value="realtime">Realtime</option>
        <option value="cinematic">RT Preset</option>
        <option value="pathTracing">Path Tracing</option>
      </select></div>
      ${switchRow('advanced-rt-enabled', 'RT Enabled')}

      ${groupTitle('Light Sampling')}
      ${switchRow('advanced-env-importance', 'HDRI importance')}
      ${switchRow('advanced-emissive-sampling', 'Emissive triangles')}

      ${groupTitle('Realtime Ray Tracing')}
      ${switchRow('advanced-ray-shadows', 'RT shadows')}
      ${rangeRow('advanced-shadow-bias', 'Shadow bias', 0.0001, 0.02, 0.0001)}
      ${switchRow('advanced-ray-ao', 'RT AO')}
      ${rangeRow('advanced-ao-radius', 'AO radius', 0.05, 5, 0.05)}
      ${rangeRow('advanced-ao-strength', 'AO strength', 0, 1, 0.05)}
      ${switchRow('advanced-ray-reflections', 'RT reflections')}
      ${rangeRow('advanced-reflection-roughness', 'Reflection roughness', 0.05, 1, 0.05)}
      ${switchRow('advanced-ray-refractions', 'RT refractions')}
      ${rangeRow('advanced-refraction-roughness', 'Refraction roughness', 0.02, 1, 0.02)}
      ${rangeRow('advanced-refraction-strength', 'Refraction strength', 0, 2, 0.05)}
      ${switchRow('advanced-rt-denoise-enabled', 'Realtime denoise')}
      ${rangeRow('advanced-rt-denoise-radius', 'Denoise radius', 0.5, 3, 0.1)}
      ${rangeRow('advanced-rt-denoise-strength', 'Denoise strength', 0, 1, 0.05)}
      ${switchRow('advanced-rt-fusion-enabled', 'Realtime fusion')}
      ${rangeRow('advanced-rt-fusion-strength', 'Fusion strength', 0, 1.5, 0.05)}

      ${groupTitle('ReSTIR DI')}
      <div class="control-row"><label for="advanced-restir-mode">Mode</label><select class="select" id="advanced-restir-mode">
        <option value="off">Off</option><option value="initial">Initial</option><option value="temporal">Temporal</option><option value="temporalSpatial">Temporal + Spatial</option>
      </select></div>
      ${rangeRow('advanced-restir-candidates', 'Candidates', 1, 32, 1)}
      ${rangeRow('advanced-restir-spatial', 'Spatial samples', 0, 32, 1)}

      ${groupTitle('Radiance Cache')}
      ${switchRow('advanced-cache-enabled', 'Enabled')}
      ${rangeRow('advanced-cache-cell', 'Cell size', 0.05, 4, 0.05)}
      ${rangeRow('advanced-cache-capacity', 'Capacity', 1024, 262144, 1024)}
      ${rangeRow('advanced-cache-update', 'Update ratio', 0.005, 0.5, 0.005)}

      ${groupTitle('Progressive Path Tracing')}
      ${switchRow('advanced-path-enabled', 'Enabled')}
      ${rangeRow('advanced-path-bounces', 'Max bounces', 1, 16, 1)}
      ${rangeRow('advanced-path-spp', 'Samples / frame', 1, 4, 1)}
      ${rangeRow('advanced-path-resolution', 'Resolution', 0.25, 1, 0.05)}
      ${rangeRow('advanced-firefly', 'Firefly clamp', 1, 100, 1)}
      ${switchRow('advanced-denoise-enabled', 'PT denoise')}
      ${rangeRow('advanced-denoise-radius', 'PT denoise radius', 0, 2, 1)}
      ${rangeRow('advanced-denoise-strength', 'PT denoise strength', 0, 1, 0.05)}

      ${groupTitle('Runtime / Capabilities')}
      <div class="control-row"><label>RT phases / PT samples</label><strong id="advanced-render-samples">0</strong></div>
      <div class="control-row"><label>Scene</label><span id="advanced-render-scene">—</span></div>
      <div class="control-row"><label>Advanced memory</label><span id="advanced-render-memory">0 MB</span></div>
      <div class="control-row"><label>CPU submit</label><span id="advanced-render-frame">0 ms</span></div>
      <div class="control-row"><label>Active features</label><span id="advanced-render-active-features">—</span></div>
      <div class="control-row"><label>Unavailable</label><span id="advanced-render-unavailable">—</span></div>
      <div class="control-row"><button class="btn" id="advanced-render-reset">Reset temporal history</button></div>
      <div class="warning-list" id="advanced-render-warning">Realtime raster stays authoritative; optional RT work may skip a phase instead of blocking the viewport.</div>
    </div>`;

  const effectLabel = Array.from(inspector.querySelectorAll<HTMLElement>('.section-label'))
    .find((element) => element.textContent?.trim().toLowerCase() === 'effect stack');
  inspector.insertBefore(sectionLabel, effectLabel ?? null);
  inspector.insertBefore(panel, effectLabel ?? null);
  bindControls(panel);
  syncControls();
}

function bindToggle(panel: HTMLElement, id: string, onChange: (checked: boolean) => void): void {
  panel.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener('change', (event) => {
    onChange((event.currentTarget as HTMLInputElement).checked);
  });
}

function bindRange(panel: HTMLElement, id: string, onChange: (value: number) => void): void {
  const input = panel.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) return;
  const output = input.nextElementSibling;
  input.addEventListener('input', () => {
    if (output) output.textContent = formatNumber(Number(input.value), Number(input.step));
  });
  input.addEventListener('change', () => onChange(Number(input.value)));
}

function bindControls(panel: HTMLElement): void {
  panel.querySelector<HTMLSelectElement>('#advanced-render-mode')?.addEventListener('change', (event) =>
    applyUpdate({ renderingMode: (event.currentTarget as HTMLSelectElement).value as AdvancedRenderingMode }));
  bindToggle(panel, 'advanced-rt-enabled', (enabled) => applyUpdate({ rayTracing: { enabled } }));
  bindToggle(panel, 'advanced-env-importance', (environmentImportance) => applyUpdate({ lightSampling: { environmentImportance } }));
  bindToggle(panel, 'advanced-emissive-sampling', (emissiveTriangles) => applyUpdate({ lightSampling: { emissiveTriangles } }));
  bindToggle(panel, 'advanced-ray-shadows', (shadows) => applyUpdate({ rayTracing: { shadows } }));
  bindRange(panel, 'advanced-shadow-bias', (shadowBias) => applyUpdate({ rayTracing: { shadowBias } }));
  bindToggle(panel, 'advanced-ray-ao', (ambientOcclusion) => applyUpdate({ rayTracing: { ambientOcclusion } }));
  bindRange(panel, 'advanced-ao-radius', (aoRadius) => applyUpdate({ rayTracing: { aoRadius } }));
  bindRange(panel, 'advanced-ao-strength', (aoStrength) => applyUpdate({ rayTracing: { aoStrength } }));
  bindToggle(panel, 'advanced-ray-reflections', (reflections) => applyUpdate({ rayTracing: { reflections } }));
  bindRange(panel, 'advanced-reflection-roughness', (reflectionMaxRoughness) => applyUpdate({ rayTracing: { reflectionMaxRoughness } }));
  bindToggle(panel, 'advanced-ray-refractions', (refractions) => applyUpdate({ rayTracing: { refractions } }));
  bindRange(panel, 'advanced-refraction-roughness', (refractionMaxRoughness) => applyUpdate({ rayTracing: { refractionMaxRoughness } }));
  bindRange(panel, 'advanced-refraction-strength', (refractionStrength) => applyUpdate({ rayTracing: { refractionStrength } }));
  bindToggle(panel, 'advanced-rt-denoise-enabled', (realtimeDenoise) => applyUpdate({ rayTracing: { realtimeDenoise } }));
  bindRange(panel, 'advanced-rt-denoise-radius', (denoiseRadius) => applyUpdate({ rayTracing: { denoiseRadius } }));
  bindRange(panel, 'advanced-rt-denoise-strength', (denoiseStrength) => applyUpdate({ rayTracing: { denoiseStrength } }));
  bindToggle(panel, 'advanced-rt-fusion-enabled', (realtimeFusion) => applyUpdate({ rayTracing: { realtimeFusion } }));
  bindRange(panel, 'advanced-rt-fusion-strength', (fusionStrength) => applyUpdate({ rayTracing: { fusionStrength } }));
  panel.querySelector<HTMLSelectElement>('#advanced-restir-mode')?.addEventListener('change', (event) =>
    applyUpdate({ restirDI: { mode: (event.currentTarget as HTMLSelectElement).value as RestirDIMode } }));
  bindRange(panel, 'advanced-restir-candidates', (candidates) => applyUpdate({ restirDI: { candidates } }));
  bindRange(panel, 'advanced-restir-spatial', (spatialSamples) => applyUpdate({ restirDI: { spatialSamples } }));
  bindToggle(panel, 'advanced-cache-enabled', (enabled) => applyUpdate({ radianceCache: { enabled } }));
  bindRange(panel, 'advanced-cache-cell', (cellSize) => applyUpdate({ radianceCache: { cellSize } }));
  bindRange(panel, 'advanced-cache-capacity', (capacity) => applyUpdate({ radianceCache: { capacity } }));
  bindRange(panel, 'advanced-cache-update', (updateRatio) => applyUpdate({ radianceCache: { updateRatio } }));
  bindToggle(panel, 'advanced-path-enabled', (enabled) => applyUpdate({ renderingMode: enabled ? 'pathTracing' : 'realtime' }));
  bindRange(panel, 'advanced-path-bounces', (maxBounces) => applyUpdate({ pathTracing: { maxBounces } }));
  bindRange(panel, 'advanced-path-spp', (samplesPerFrame) => applyUpdate({ pathTracing: { samplesPerFrame } }));
  bindRange(panel, 'advanced-path-resolution', (resolutionScale) => applyUpdate({ pathTracing: { resolutionScale } }));
  bindRange(panel, 'advanced-firefly', (fireflyClamp) => applyUpdate({ pathTracing: { fireflyClamp } }));
  bindToggle(panel, 'advanced-denoise-enabled', (denoise) => applyUpdate({ pathTracing: { denoise } }));
  bindRange(panel, 'advanced-denoise-radius', (denoiseRadius) => applyUpdate({ pathTracing: { denoiseRadius } }));
  bindRange(panel, 'advanced-denoise-strength', (denoiseStrength) => applyUpdate({ pathTracing: { denoiseStrength } }));
  panel.querySelector('#advanced-render-reset')?.addEventListener('click', () => labViewer?.resetAccumulation('render-controls-reset'));
}

mountPanel();
