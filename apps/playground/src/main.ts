import {
  KyxosViewer,
  type BackendPreference,
  type DebugView,
  type EffectName,
  type EffectSettings,
  type QualityPresetName,
  type StressResult,
  type StressTestName,
  type ViewerMetrics,
} from '@kyxos/viewer';
import { demoRoutes, resolveRoute } from './routes';
import './styles.css';

const route = resolveRoute(window.location.pathname);
const baseUrl = import.meta.env.BASE_URL;

const effectLabels: Record<EffectName, string> = {
  traa: 'TRAA',
  fxaa: 'FXAA',
  smaa: 'SMAA',
  ssaa: 'SSAA Capture',
  gtao: 'GTAO',
  ssao: 'SSAO',
  ssr: 'SSR',
  ssgi: 'SSGI',
  temporalReprojection: 'Temporal Reprojection',
  poissonDenoise: 'Poisson Denoise',
  temporalDenoise: 'Temporal Denoise',
  motionBlur: 'Motion Blur',
  bloom: 'Bloom',
  dof: 'Depth of Field',
  lut: 'LUT / Color Grade',
  lensDistortion: 'Lens Distortion',
  sharpness: 'Sharpness',
  sparkle: 'Sparkle',
  gradualBackground: 'Gradual Background',
};

const parameterDefinitions: Partial<
  Record<EffectName, Array<{ key: string; label: string; min: number; max: number; step: number }>>
> = {
  traa: [
    { key: 'depthThreshold', label: 'Depth threshold', min: 0.0001, max: 0.004, step: 0.0001 },
    { key: 'edgeDepthDiff', label: 'Edge depth diff', min: 0.0001, max: 0.006, step: 0.0001 },
    { key: 'maxVelocityLength', label: 'Max velocity', min: 16, max: 256, step: 1 },
  ],
  ssaa: [{ key: 'samples', label: 'Samples', min: 1, max: 32, step: 1 }],
  gtao: [
    { key: 'resolutionScale', label: 'Resolution', min: 0.25, max: 1, step: 0.25 },
    { key: 'samples', label: 'Samples', min: 4, max: 32, step: 1 },
    { key: 'radius', label: 'Radius', min: 0.1, max: 2, step: 0.05 },
    { key: 'intensity', label: 'Intensity', min: 0, max: 4, step: 0.05 },
    { key: 'thickness', label: 'Thickness', min: 0.01, max: 2, step: 0.01 },
  ],
  ssao: [
    { key: 'resolutionScale', label: 'Resolution', min: 0.25, max: 1, step: 0.25 },
    { key: 'samples', label: 'Samples', min: 4, max: 32, step: 1 },
    { key: 'radius', label: 'Radius', min: 0.1, max: 2, step: 0.05 },
    { key: 'intensity', label: 'Intensity', min: 0, max: 4, step: 0.05 },
  ],
  ssr: [
    { key: 'resolutionScale', label: 'Resolution', min: 0.25, max: 1, step: 0.25 },
    { key: 'quality', label: 'Quality', min: 0.05, max: 1, step: 0.05 },
    { key: 'intensity', label: 'Intensity', min: 0, max: 4, step: 0.05 },
    { key: 'thickness', label: 'Thickness', min: 0.01, max: 0.3, step: 0.01 },
    { key: 'maxDistance', label: 'Max distance', min: 0.05, max: 3, step: 0.05 },
    { key: 'mirrorBias', label: 'Mirror bias', min: 0, max: 1, step: 0.05 },
  ],
  ssgi: [
    { key: 'resolutionScale', label: 'Resolution', min: 0.25, max: 1, step: 0.25 },
    { key: 'sliceCount', label: 'Slices', min: 1, max: 4, step: 1 },
    { key: 'stepCount', label: 'Steps', min: 2, max: 32, step: 1 },
    { key: 'radius', label: 'Radius', min: 1, max: 25, step: 1 },
    { key: 'intensity', label: 'Intensity', min: 0, max: 8, step: 0.1 },
  ],
  poissonDenoise: [{ key: 'radius', label: 'Radius', min: 0, max: 5, step: 0.1 }],
  temporalDenoise: [
    { key: 'radius', label: 'Radius', min: 0, max: 3, step: 0.05 },
    { key: 'strength', label: 'Strength', min: 0.5, max: 0.95, step: 0.005 },
  ],
  motionBlur: [{ key: 'amount', label: 'Amount', min: 0, max: 3, step: 0.05 }],
  bloom: [
    { key: 'threshold', label: 'Threshold', min: 0, max: 2, step: 0.05 },
    { key: 'strength', label: 'Strength', min: 0, max: 3, step: 0.05 },
    { key: 'radius', label: 'Radius', min: 0, max: 1, step: 0.01 },
  ],
  dof: [
    { key: 'focusDistance', label: 'Focus distance', min: 0.1, max: 20, step: 0.1 },
    { key: 'focalLength', label: 'Focal length', min: 10, max: 200, step: 1 },
    { key: 'bokehScale', label: 'Bokeh scale', min: 0, max: 10, step: 0.1 },
  ],
  lut: [{ key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01 }],
  lensDistortion: [{ key: 'amount', label: 'Amount', min: -0.2, max: 0.2, step: 0.005 }],
  sharpness: [{ key: 'amount', label: 'Amount', min: 0, max: 2, step: 0.05 }],
  sparkle: [
    { key: 'intensity', label: 'Intensity', min: 0, max: 2, step: 0.05 },
    { key: 'threshold', label: 'Threshold', min: 0.5, max: 1, step: 0.005 },
  ],
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root not found.');

app.innerHTML = `
  <main class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">K</div>
        <div><strong>KYXOS RENDER</strong><span>WEBGPU REALISM LAB</span></div>
      </div>
      <div class="nav-label">Playground demos</div>
      <nav class="nav-list">
        ${demoRoutes
          .map(
            (item, index) => `
              <a class="nav-item ${item.slug === route.slug ? 'active' : ''}" href="${baseUrl}${item.slug}/">
                <span>${item.title}</span><small>${String(index + 1).padStart(2, '0')}</small>
              </a>`,
          )
          .join('')}
      </nav>
    </aside>

    <section class="viewport-shell">
      <canvas id="viewport" tabindex="0"></canvas>
      <div class="hero-copy">
        <div class="eyebrow">${route.eyebrow}</div>
        <h1>${route.title}</h1>
        <p>${route.description}</p>
      </div>
      <div class="viewport-toolbar">
        <span class="backend-pill" id="backend-pill">Initializing</span>
        <select class="select" id="quality-select" aria-label="Quality preset">
          ${(['low', 'medium', 'high', 'cinematic', 'capture'] as QualityPresetName[])
            .map(
              (quality) =>
                `<option value="${quality}" ${quality === route.quality ? 'selected' : ''}>${quality}</option>`,
            )
            .join('')}
        </select>
        <select class="select" id="debug-select" aria-label="Debug view">
          ${(
            [
              'final',
              'beauty',
              'depth',
              'velocity',
              'normal',
              'diffuseColor',
              'metalness',
              'roughness',
              'emissive',
            ] as DebugView[]
          )
            .map(
              (view) =>
                `<option value="${view}" ${view === (route.debugView ?? 'final') ? 'selected' : ''}>${view}</option>`,
            )
            .join('')}
        </select>
        <button class="btn" id="compare-button">Before / After</button>
        <button class="btn" id="reset-button">Reset</button>
        <button class="btn primary" id="capture-button">Screenshot</button>
        <span class="spacer"></span>
        <select class="select" id="backend-select" aria-label="Renderer backend">
          <option value="auto">Backend: Auto</option>
          <option value="webgpu">Backend: WebGPU</option>
          <option value="webgl2">Backend: WebGL 2</option>
        </select>
        <button class="btn danger" id="recreate-button">Dispose / Recreate</button>
      </div>
      <div class="loading" id="loading">Building WebGPU pipeline</div>
    </section>

    <aside class="inspector">
      <div class="section-label">Live telemetry</div>
      <section class="panel">
        <div class="panel-title"><span>Performance</span><span id="resolution-label">—</span></div>
        <div class="panel-body metric-grid" id="metrics-grid">
          ${['FPS', 'CPU ms', 'GPU ms', 'Draw calls', 'Triangles', 'Textures', 'Targets', 'GPU memory']
            .map(
              (label, index) =>
                `<div class="metric"><span>${label}</span><strong data-metric="${index}">—</strong></div>`,
            )
            .join('')}
        </div>
      </section>

      <div class="section-label">Scene</div>
      <section class="panel">
        <div class="panel-title">Assets and comparison</div>
        <div class="panel-body">
          <div class="control-row"><label for="model-select">Model</label><select class="select" id="model-select"><option value="procedural:material-study">Material study</option><option value="procedural:chrome">Chrome knot</option><option value="procedural:matte">Matte knot</option><option value="procedural:sphere">Sphere</option></select></div>
          <div class="control-row"><label for="environment-select">Environment</label><select class="select" id="environment-select"><option value="studio">Studio HDR</option></select></div>
          <div class="control-row"><label for="animation-switch">Scene animation</label><input class="switch" id="animation-switch" type="checkbox" ${route.animate ? 'checked' : ''}></div>
          <div class="control-row"><label for="comparison-switch">Comparison</label><input class="switch" id="comparison-switch" type="checkbox"></div>
          <div class="control-row range"><label for="comparison-range">Split</label><input id="comparison-range" type="range" min="0.05" max="0.95" value="0.5" step="0.01"><output>0.50</output></div>
        </div>
      </section>

      <div class="section-label">Effect stack</div>
      <section class="panel">
        <div class="panel-title"><span>Official + Kyxos nodes</span><span>Ordered</span></div>
        <div class="panel-body" id="effect-controls"></div>
      </section>

      <section class="panel" id="parameter-panel">
        <div class="panel-title"><span id="parameter-title">Focused parameters</span><span>Live</span></div>
        <div class="panel-body" id="parameter-controls"></div>
      </section>

      <section class="panel" id="material-panel" ${route.slug === 'pbr' ? '' : 'hidden'}>
        <div class="panel-title"><span>Texture Lab inputs</span><span>Local</span></div>
        <div class="panel-body">
          ${['baseColor', 'normal', 'roughness', 'metalness', 'ao', 'emissive']
            .map(
              (name) =>
                `<div class="control-row"><label>${name}</label><input data-texture="${name}" type="file" accept="image/*"></div>`,
            )
            .join('')}
        </div>
      </section>

      <section class="panel" id="lifecycle-panel" ${route.slug === 'lifecycle' ? '' : 'hidden'}>
        <div class="panel-title"><span>Acceptance stress</span><span>Automated</span></div>
        <div class="panel-body">
          <div class="stress-grid">
            <button class="btn" data-stress="resize" data-count="100">Resize ×100</button>
            <button class="btn" data-stress="toggle" data-count="100">Toggle ×100</button>
            <button class="btn" data-stress="model" data-count="50">Model ×50</button>
            <button class="btn" data-stress="environment" data-count="50">HDR ×50</button>
          </div>
          <button class="btn danger" id="recreate-stress">Viewer create/dispose ×50</button>
          <ul class="stress-output" id="stress-output"></ul>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title"><span>Runtime limits</span><span>Isolated</span></div>
        <div class="panel-body"><ul class="warning-list" id="warning-list"></ul></div>
      </section>
    </aside>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
const loading = document.querySelector<HTMLDivElement>('#loading');
const backendPill = document.querySelector<HTMLSpanElement>('#backend-pill');
const qualitySelect = document.querySelector<HTMLSelectElement>('#quality-select');
const debugSelect = document.querySelector<HTMLSelectElement>('#debug-select');
const backendSelect = document.querySelector<HTMLSelectElement>('#backend-select');
const effectControls = document.querySelector<HTMLDivElement>('#effect-controls');
const parameterControls = document.querySelector<HTMLDivElement>('#parameter-controls');
const parameterTitle = document.querySelector<HTMLSpanElement>('#parameter-title');
const warningList = document.querySelector<HTMLUListElement>('#warning-list');
const stressOutput = document.querySelector<HTMLUListElement>('#stress-output');

if (
  !canvas ||
  !loading ||
  !backendPill ||
  !qualitySelect ||
  !debugSelect ||
  !backendSelect ||
  !effectControls ||
  !parameterControls ||
  !parameterTitle ||
  !warningList ||
  !stressOutput
) {
  throw new Error('Playground UI failed to initialize.');
}

let viewer: KyxosViewer | null = null;
let compareEnabled = false;
let selectedEffect: EffectName = route.focus ?? 'traa';
let selectedBackend: BackendPreference = 'auto';
let lastError: string | null = null;

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function updateMetrics(metrics: ViewerMetrics) {
  const values = [
    metrics.fps.toFixed(1),
    metrics.cpuFrameTimeMs.toFixed(2),
    metrics.gpuFrameTimeMs === null ? 'N/A' : metrics.gpuFrameTimeMs.toFixed(2),
    String(metrics.drawCalls),
    metrics.triangles.toLocaleString(),
    String(metrics.textures),
    String(metrics.renderTargets),
    formatBytes(metrics.totalGpuBytes),
  ];
  document.querySelectorAll<HTMLElement>('[data-metric]').forEach((element) => {
    element.textContent = values[Number(element.dataset.metric)] ?? '—';
  });
  const resolution = document.querySelector<HTMLElement>('#resolution-label');
  if (resolution) resolution.textContent = `${metrics.width}×${metrics.height}`;
  backendPill.textContent = metrics.backend;
}

function updateWarnings() {
  if (!viewer) return;
  warningList.innerHTML = viewer
    .getWarnings()
    .map((warning) => `<li>${warning}</li>`)
    .join('');
}

function renderEffectControls() {
  if (!viewer) return;
  const effects = viewer.getEffects();
  const names = Object.keys(effectLabels) as EffectName[];
  names.sort((a, b) => (a === selectedEffect ? -1 : b === selectedEffect ? 1 : 0));
  effectControls.innerHTML = names
    .map(
      (name) => `
        <div class="control-row" data-effect-row="${name}">
          <button class="btn" data-focus-effect="${name}">${effectLabels[name]}</button>
          <input class="switch" data-effect-toggle="${name}" type="checkbox" ${effects[name].enabled ? 'checked' : ''}>
        </div>`,
    )
    .join('');

  effectControls.querySelectorAll<HTMLInputElement>('[data-effect-toggle]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!viewer) return;
      const effect = input.dataset.effectToggle as EffectName;
      viewer.setEffect(effect, { enabled: input.checked });
      selectedEffect = effect;
      window.setTimeout(() => {
        renderEffectControls();
        renderParameterControls();
        updateWarnings();
      }, 40);
    });
  });
  effectControls.querySelectorAll<HTMLButtonElement>('[data-focus-effect]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedEffect = button.dataset.focusEffect as EffectName;
      renderEffectControls();
      renderParameterControls();
    });
  });
}

function renderParameterControls() {
  if (!viewer) return;
  const settings = viewer.getEffects()[selectedEffect];
  const definitions = parameterDefinitions[selectedEffect] ?? [];
  parameterTitle.textContent = effectLabels[selectedEffect];
  parameterControls.innerHTML = definitions.length
    ? definitions
        .map((definition) => {
          const fallback = definition.min;
          const value = Number(settings[definition.key] ?? fallback);
          return `
            <div class="control-row range">
              <label>${definition.label}</label>
              <input data-effect-parameter="${definition.key}" type="range" min="${definition.min}" max="${definition.max}" step="${definition.step}" value="${value}">
              <output>${value.toFixed(definition.step < 0.01 ? 4 : definition.step < 1 ? 2 : 0)}</output>
            </div>`;
        })
        .join('')
    : '<div class="control-row"><span>This effect uses official defaults.</span><span>—</span></div>';

  parameterControls.querySelectorAll<HTMLInputElement>('[data-effect-parameter]').forEach((input) => {
    input.addEventListener('input', () => {
      const output = input.nextElementSibling;
      if (output)
        output.textContent = Number(input.value).toFixed(
          Number(input.step) < 0.01 ? 4 : Number(input.step) < 1 ? 2 : 0,
        );
    });
    input.addEventListener('change', () => {
      if (!viewer) return;
      const key = input.dataset.effectParameter as keyof EffectSettings;
      viewer.setEffect(selectedEffect, { [key]: Number(input.value) });
      window.setTimeout(updateWarnings, 40);
    });
  });
}

async function applyRouteConfiguration(instance: KyxosViewer) {
  instance.setQualityPreset(route.quality);
  if (route.slug === 'ssao') {
    instance.setEffect('gtao', { enabled: false });
    instance.setEffect('ssao', { enabled: true });
  } else if (route.focus && !['fxaa', 'temporalReprojection', 'temporalDenoise'].includes(route.focus)) {
    instance.setEffect(route.focus, { enabled: true });
  }
  if (route.slug === 'aa') instance.setEffect('fxaa', { enabled: true });
  if (route.slug === 'temporal') {
    instance.setEffect('ssr', { enabled: true });
    instance.setEffect('temporalReprojection', { enabled: true });
  }
  if (route.slug === 'denoise') {
    instance.setEffect('ssr', { enabled: true });
    instance.setEffect('temporalReprojection', { enabled: true });
    instance.setEffect('temporalDenoise', { enabled: true });
  }
  instance.setDebugView(route.debugView ?? 'final');
  instance.setAnimationEnabled(Boolean(route.animate));
}

async function createViewer(backend: BackendPreference = selectedBackend) {
  loading.classList.remove('hidden');
  loading.textContent = 'Building WebGPU pipeline';
  lastError = null;
  viewer?.dispose();
  viewer = null;

  try {
    const instance = await KyxosViewer.create({
      canvas,
      backend,
      quality: route.quality,
      pixelRatio: Math.min(window.devicePixelRatio || 1, route.slug === 'performance' ? 1 : 1.5),
    });
    viewer = instance;
    await applyRouteConfiguration(instance);
    instance.addEventListener('metrics', (event) =>
      updateMetrics((event as CustomEvent<ViewerMetrics>).detail),
    );
    instance.addEventListener('warning', updateWarnings);
    instance.addEventListener('error', (event) => {
      const detail = (event as CustomEvent<{ error: unknown }>).detail;
      lastError = detail.error instanceof Error ? detail.error.message : String(detail.error);
      updateWarnings();
    });
    renderEffectControls();
    renderParameterControls();
    updateWarnings();
    updateMetrics(instance.getMetrics());
    loading.classList.add('hidden');
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    loading.className = 'fatal';
    loading.textContent = `Viewer initialization failed: ${lastError}`;
    throw error;
  }
}

qualitySelect.addEventListener('change', () => {
  if (!viewer) return;
  viewer.setQualityPreset(qualitySelect.value as QualityPresetName);
  window.setTimeout(() => {
    renderEffectControls();
    renderParameterControls();
  }, 40);
});

debugSelect.addEventListener('change', () => viewer?.setDebugView(debugSelect.value as DebugView));
backendSelect.addEventListener('change', () => {
  selectedBackend = backendSelect.value as BackendPreference;
  void createViewer(selectedBackend);
});

document.querySelector('#compare-button')?.addEventListener('click', () => {
  compareEnabled = !compareEnabled;
  viewer?.setComparison(
    compareEnabled,
    Number((document.querySelector('#comparison-range') as HTMLInputElement)?.value ?? 0.5),
  );
});
document.querySelector<HTMLInputElement>('#comparison-switch')?.addEventListener('change', (event) => {
  compareEnabled = (event.currentTarget as HTMLInputElement).checked;
  viewer?.setComparison(compareEnabled);
});
document.querySelector<HTMLInputElement>('#comparison-range')?.addEventListener('input', (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const output = input.nextElementSibling;
  if (output) output.textContent = Number(input.value).toFixed(2);
  viewer?.setComparisonSplit(Number(input.value));
});
document.querySelector<HTMLInputElement>('#animation-switch')?.addEventListener('change', (event) => {
  viewer?.setAnimationEnabled((event.currentTarget as HTMLInputElement).checked);
});
document.querySelector<HTMLSelectElement>('#model-select')?.addEventListener('change', (event) => {
  void viewer?.loadModel((event.currentTarget as HTMLSelectElement).value);
});
document.querySelector<HTMLSelectElement>('#environment-select')?.addEventListener('change', (event) => {
  void viewer?.loadEnvironment((event.currentTarget as HTMLSelectElement).value);
});
document.querySelector('#reset-button')?.addEventListener('click', () => viewer?.resetView());
document
  .querySelector('#recreate-button')
  ?.addEventListener('click', () => void createViewer(selectedBackend));
document.querySelector('#capture-button')?.addEventListener('click', async () => {
  if (!viewer) return;
  const blob = await viewer.capture();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kyxos-${route.slug}.png`;
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelectorAll<HTMLInputElement>('[data-texture]').forEach((input) => {
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file || !viewer) return;
    const url = URL.createObjectURL(file);
    viewer.setMaterialTextures({ [input.dataset.texture ?? 'baseColor']: url });
  });
});

function appendStressResult(
  result: StressResult | { name: string; passed: boolean; durationMs: number; note?: string },
) {
  stressOutput.insertAdjacentHTML(
    'afterbegin',
    `<li>${result.passed ? 'PASS' : 'CHECK'} · ${result.name} · ${result.durationMs.toFixed(0)} ms${result.note ? ` · ${result.note}` : ''}</li>`,
  );
}

document.querySelectorAll<HTMLButtonElement>('[data-stress]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!viewer) return;
    button.disabled = true;
    const name = button.dataset.stress as StressTestName;
    const count = Number(button.dataset.count ?? 1);
    try {
      appendStressResult(await viewer.runStressTest(name, count));
    } finally {
      button.disabled = false;
      updateWarnings();
    }
  });
});

async function runRecreateStress(iterations = 50) {
  const started = performance.now();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;width:96px;height:64px;left:-10000px;top:-10000px';
  document.body.append(host);
  let completed = 0;
  try {
    for (let index = 0; index < iterations; index += 1) {
      const testCanvas = document.createElement('canvas');
      testCanvas.style.cssText = 'width:96px;height:64px';
      host.replaceChildren(testCanvas);
      const testViewer = await KyxosViewer.create({
        canvas: testCanvas,
        backend: 'webgl2',
        quality: 'low',
        autoStart: false,
        pixelRatio: 1,
      });
      testViewer.dispose();
      completed += 1;
    }
  } finally {
    host.remove();
  }
  return {
    name: 'viewer-recreate',
    passed: completed === iterations,
    durationMs: performance.now() - started,
    note: `${completed}/${iterations}`,
  };
}

document.querySelector<HTMLButtonElement>('#recreate-stress')?.addEventListener('click', async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  try {
    appendStressResult(await runRecreateStress(50));
  } finally {
    button.disabled = false;
  }
});

type TestApi = {
  ready: () => boolean;
  getMetrics: () => ViewerMetrics | null;
  getWarnings: () => string[];
  getLastError: () => string | null;
  setQuality: (quality: QualityPresetName) => void;
  setEffect: (name: EffectName, settings: Partial<EffectSettings>) => void;
  setDebugView: (view: DebugView) => void;
  runStress: (name: StressTestName, count: number) => Promise<StressResult>;
  recreate: (count: number) => Promise<{ name: string; passed: boolean; durationMs: number; note?: string }>;
};

declare global {
  interface Window {
    __kyxosTestApi: TestApi;
  }
}

window.__kyxosTestApi = {
  ready: () => viewer !== null && loading.classList.contains('hidden'),
  getMetrics: () => viewer?.getMetrics() ?? null,
  getWarnings: () => viewer?.getWarnings() ?? [],
  getLastError: () => lastError,
  setQuality: (quality) => viewer?.setQualityPreset(quality),
  setEffect: (name, settings) => viewer?.setEffect(name, settings),
  setDebugView: (view) => viewer?.setDebugView(view),
  runStress: async (name, count) => {
    if (!viewer) throw new Error('Viewer is not ready.');
    return viewer.runStressTest(name, count);
  },
  recreate: runRecreateStress,
};

void createViewer();
