import {
  KyxosViewer,
  type AdvancedRenderStatus,
  type AdvancedRenderingMode,
  type RestirDIMode,
} from '@kyxos/viewer';

const slug = window.location.pathname.split('/').filter(Boolean).at(-1) ?? '';
const isRtLab = slug === 'rt-lab';
const isPathLab = slug === 'path-tracing';
let labViewer: KyxosViewer | null = null;
let panelMounted = false;

function requestedMode(): AdvancedRenderingMode {
  return isPathLab ? 'pathTracing' : isRtLab ? 'cinematic' : 'realtime';
}

function configure(instance: KyxosViewer): void {
  if (!isRtLab && !isPathLab) return;
  if (!instance.canvas.isConnected) return;
  labViewer = instance;
  let capabilityRetryIssued = false;

  const retryAfterCapabilityNegotiation = (status: AdvancedRenderStatus): void => {
    if (capabilityRetryIssued || status.state !== 'fallback' || requestedMode() === 'realtime') return;
    const capabilities = instance.getAdvancedCapabilities();
    if (!capabilities.softwareRayQuery) return;
    capabilityRetryIssued = true;
    queueMicrotask(() => {
      if (labViewer !== instance || !instance.canvas.isConnected) return;
      instance.setRenderingMode(requestedMode());
    });
  };

  instance.setAdvancedRenderSettings({
    renderingMode: requestedMode(),
    restirDI: {
      mode: 'temporalSpatial',
      candidates: isPathLab ? 16 : 8,
      spatialSamples: 8,
    },
    radianceCache: {
      enabled: true,
      cellSize: 0.5,
      capacity: 65536,
      updateRatio: 0.04,
    },
    pathTracing: {
      maxBounces: isPathLab ? 8 : 3,
      samplesPerFrame: isPathLab ? 2 : 1,
      denoise: true,
      fireflyClamp: 20,
      resolutionScale: isPathLab ? 0.75 : 0.5,
    },
  });
  instance.canvas.addEventListener('kyxos-advanced-render-status', (event) => {
    const status = (event as CustomEvent<AdvancedRenderStatus>).detail;
    updatePanel(status);
    retryAfterCapabilityNegotiation(status);
  });
  instance.canvas.addEventListener('kyxos-advanced-render-warning', (event) => {
    const message = (event as CustomEvent<{ message: string }>).detail.message;
    const warning = document.querySelector<HTMLElement>('#advanced-lab-warning');
    if (warning) warning.textContent = message;
  });
  mountPanel();
  const initialStatus = instance.getAdvancedRenderStatus();
  updatePanel(initialStatus);
  retryAfterCapabilityNegotiation(initialStatus);
}

if (isRtLab || isPathLab) {
  const originalCreate = KyxosViewer.create.bind(KyxosViewer);
  (KyxosViewer as unknown as { create: typeof KyxosViewer.create }).create = async (options) => {
    const instance = await originalCreate(options);
    // Let Playground finish its route preset, debug state and UI wiring first.
    // The raster viewer remains the guaranteed visible fallback while advanced
    // WebGPU resources are negotiated and built on the following animation frame.
    requestAnimationFrame(() => configure(instance));
    return instance;
  };
}

function bytes(value: number): string {
  return value > 0 ? `${(value / 1024 / 1024).toFixed(1)} MB` : '0 MB';
}

function updatePanel(status: AdvancedRenderStatus): void {
  const state = document.querySelector<HTMLElement>('#advanced-lab-state');
  const samples = document.querySelector<HTMLElement>('#advanced-lab-samples');
  const scene = document.querySelector<HTMLElement>('#advanced-lab-scene');
  const memory = document.querySelector<HTMLElement>('#advanced-lab-memory');
  const frame = document.querySelector<HTMLElement>('#advanced-lab-frame');
  const warning = document.querySelector<HTMLElement>('#advanced-lab-warning');
  if (state) state.textContent = `${status.state} · ${status.effectiveMode}`;
  if (samples) samples.textContent = status.samples.toLocaleString();
  if (scene) scene.textContent = `${status.triangles.toLocaleString()} tri · ${status.bvhNodes.toLocaleString()} BVH · ${status.lights} lights`;
  if (memory) memory.textContent = bytes(status.advancedGpuBytes);
  if (frame) frame.textContent = `${status.cpuFrameTimeMs.toFixed(2)} ms`;
  if (warning && status.message) warning.textContent = status.message;
}

function mountPanel(): void {
  if (panelMounted || (!isRtLab && !isPathLab)) return;
  const inspector = document.querySelector<HTMLElement>('.inspector');
  if (!inspector) {
    requestAnimationFrame(mountPanel);
    return;
  }
  panelMounted = true;
  const sectionLabel = document.createElement('div');
  sectionLabel.className = 'section-label';
  sectionLabel.textContent = 'WebGPU Advanced';
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.id = 'advanced-lab-panel';
  panel.innerHTML = `
    <div class="panel-title"><span>${isPathLab ? 'Progressive Path Tracing' : 'Hybrid RT Lab'}</span><span id="advanced-lab-state">initializing</span></div>
    <div class="panel-body">
      <div class="control-row"><label>Mode</label><select class="select" id="advanced-lab-mode">
        <option value="realtime">Realtime</option>
        <option value="cinematic">Cinematic</option>
        <option value="pathTracing">Path Tracing</option>
      </select></div>
      <div class="control-row"><label>ReSTIR DI</label><select class="select" id="advanced-lab-restir">
        <option value="off">Off</option>
        <option value="initial">Initial</option>
        <option value="temporal">Temporal</option>
        <option value="temporalSpatial">Temporal + Spatial</option>
      </select></div>
      <div class="control-row"><label>Samples</label><strong id="advanced-lab-samples">0</strong></div>
      <div class="control-row"><label>Scene</label><span id="advanced-lab-scene">—</span></div>
      <div class="control-row"><label>Advanced memory</label><span id="advanced-lab-memory">0 MB</span></div>
      <div class="control-row"><label>CPU submit</label><span id="advanced-lab-frame">0 ms</span></div>
      <div class="control-row"><button class="btn" id="advanced-lab-reset">Reset accumulation</button><button class="btn" id="advanced-lab-cache">Toggle cache</button></div>
      <div class="warning-list" id="advanced-lab-warning">Raster preview stays visible until the negotiated advanced renderer produces frames.</div>
    </div>`;
  const firstLabel = inspector.querySelector('.section-label');
  inspector.insertBefore(panel, firstLabel?.nextSibling ?? inspector.firstChild);
  inspector.insertBefore(sectionLabel, panel);

  const mode = panel.querySelector<HTMLSelectElement>('#advanced-lab-mode');
  if (mode) {
    mode.value = requestedMode();
    mode.addEventListener('change', () => labViewer?.setRenderingMode(mode.value as AdvancedRenderingMode));
  }
  const restir = panel.querySelector<HTMLSelectElement>('#advanced-lab-restir');
  if (restir) {
    restir.value = 'temporalSpatial';
    restir.addEventListener('change', () => labViewer?.setRestirDI({ mode: restir.value as RestirDIMode }));
  }
  panel.querySelector('#advanced-lab-reset')?.addEventListener('click', () => labViewer?.resetAccumulation('lab-reset'));
  panel.querySelector('#advanced-lab-cache')?.addEventListener('click', () => {
    if (!labViewer) return;
    const settings = labViewer.getAdvancedRenderSettings();
    labViewer.setRadianceCache({ enabled: !settings.radianceCache.enabled });
  });
}

if (isRtLab || isPathLab) mountPanel();
