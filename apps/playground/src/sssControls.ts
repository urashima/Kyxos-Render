import {
  DEFAULT_SSS_MATERIAL_SETTINGS,
  KyxosViewer,
  type KyxosViewerCreateOptions,
  type SSSMaterialSettings,
  type SSSMaterialStatus,
} from '@kyxos/viewer';

type ViewerCreate = (options: KyxosViewerCreateOptions) => Promise<KyxosViewer>;
type SSSPatch = Partial<SSSMaterialSettings>;

const patchKey = Symbol.for('kyxos.playground.sss-material-controls');
const viewerConstructor = KyxosViewer as typeof KyxosViewer & { create: ViewerCreate };
const constructorState = viewerConstructor as unknown as Record<PropertyKey, unknown>;

let currentViewer: KyxosViewer | null = null;
let currentSettings: SSSMaterialSettings = { ...DEFAULT_SSS_MATERIAL_SETTINGS };
let thicknessFile: File | null = null;
let operation = Promise.resolve<SSSMaterialStatus | null>(null);

async function applyPersistentSettings(viewer: KyxosViewer) {
  if (!currentSettings.enabled) return viewer.getSSSMaterialStatus();
  if (!thicknessFile) return viewer.setSSSMaterial(currentSettings);

  const url = URL.createObjectURL(thicknessFile);
  try {
    return await viewer.setSSSMaterial({ ...currentSettings, thicknessMap: url });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function queuePatch(patch: SSSPatch) {
  const persistentPatch = { ...patch };
  delete persistentPatch.thicknessMap;
  currentSettings = { ...currentSettings, ...persistentPatch };

  operation = operation
    .catch(() => null)
    .then(async () => {
      if (!currentViewer) return null;
      const status = await currentViewer.setSSSMaterial(patch);
      syncPanel(status);
      return status;
    })
    .catch((error) => {
      setStatus(`SSS failed: ${error instanceof Error ? error.message : String(error)}`, true);
      return null;
    });
  return operation;
}

if (!constructorState[patchKey]) {
  const originalCreate = viewerConstructor.create.bind(viewerConstructor);

  viewerConstructor.create = async (options: KyxosViewerCreateOptions) => {
    const viewer = await originalCreate(options);
    currentViewer = viewer;
    await applyPersistentSettings(viewer);
    window.dispatchEvent(new CustomEvent('kyxos-viewer-created'));
    return viewer;
  };

  constructorState[patchKey] = true;
}

function numberInput(
  key: keyof SSSMaterialSettings,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
) {
  return `
    <div class="control-row range">
      <label for="sss-${String(key)}">${label}</label>
      <input id="sss-${String(key)}" data-sss-number="${String(key)}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
      <output>${value.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}</output>
    </div>`;
}

function createPanel() {
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.id = 'sss-material-panel';
  panel.innerHTML = `
    <div class="panel-title"><span>SSS Material</span><span>Three.js Official</span></div>
    <div class="panel-body">
      <div class="control-row">
        <label for="sss-enabled">Subsurface scattering</label>
        <input class="switch" id="sss-enabled" type="checkbox">
      </div>
      <div class="control-row">
        <label for="sss-color">Scattering color</label>
        <input id="sss-color" type="color" value="${currentSettings.color}">
      </div>
      ${numberInput('distortion', 'Distortion', 0.01, 1, 0.01, currentSettings.distortion)}
      ${numberInput('ambient', 'Ambient', 0, 5, 0.05, currentSettings.ambient)}
      ${numberInput('attenuation', 'Attenuation', 0.01, 5, 0.05, currentSettings.attenuation)}
      ${numberInput('power', 'Power', 0.01, 16, 0.1, currentSettings.power)}
      ${numberInput('scale', 'Scale', 0.01, 50, 0.1, currentSettings.scale)}
      <div class="control-row">
        <label for="sss-thickness-map">Thickness map</label>
        <input id="sss-thickness-map" type="file" accept="image/*">
      </div>
      <div class="control-row">
        <button class="btn" id="sss-clear-thickness">Clear map</button>
        <button class="btn primary" id="sss-demo">Load SSS demo</button>
      </div>
      <div class="control-row"><span id="sss-status">Ready</span><span>Beauty lighting</span></div>
    </div>`;
  return panel;
}

function setStatus(message: string, failed = false) {
  const status = document.querySelector<HTMLElement>('#sss-status');
  if (!status) return;
  status.textContent = message;
  status.style.color = failed ? '#ff6b6b' : '';
}

function syncPanel(status = currentViewer?.getSSSMaterialStatus()) {
  if (!status) return;
  const enabled = document.querySelector<HTMLInputElement>('#sss-enabled');
  const color = document.querySelector<HTMLInputElement>('#sss-color');
  if (enabled) enabled.checked = status.enabled;
  if (color) color.value = status.color;
  document.querySelectorAll<HTMLInputElement>('[data-sss-number]').forEach((input) => {
    const key = input.dataset.sssNumber as keyof SSSMaterialSettings;
    const value = Number(status[key]);
    if (!Number.isFinite(value)) return;
    input.value = String(value);
    const output = input.nextElementSibling;
    if (output) output.textContent = value.toFixed(Number(input.step) < 0.1 ? 2 : Number(input.step) < 1 ? 1 : 0);
  });
  setStatus(
    status.enabled
      ? `Enabled · ${status.convertedMaterials} material${status.convertedMaterials === 1 ? '' : 's'}${status.hasThicknessMap ? ' · thickness map' : ''}`
      : 'Disabled · original materials restored',
  );
}

function bindPanel(panel: HTMLElement) {
  panel.querySelector<HTMLInputElement>('#sss-enabled')?.addEventListener('change', (event) => {
    void queuePatch({ enabled: (event.currentTarget as HTMLInputElement).checked });
  });

  panel.querySelector<HTMLInputElement>('#sss-color')?.addEventListener('input', (event) => {
    void queuePatch({ color: (event.currentTarget as HTMLInputElement).value });
  });

  panel.querySelectorAll<HTMLInputElement>('[data-sss-number]').forEach((input) => {
    input.addEventListener('input', () => {
      const output = input.nextElementSibling;
      if (output) {
        output.textContent = Number(input.value).toFixed(Number(input.step) < 0.1 ? 2 : Number(input.step) < 1 ? 1 : 0);
      }
    });
    input.addEventListener('change', () => {
      const key = input.dataset.sssNumber as keyof SSSMaterialSettings;
      void queuePatch({ [key]: Number(input.value) });
    });
  });

  panel.querySelector<HTMLInputElement>('#sss-thickness-map')?.addEventListener('change', async (event) => {
    thicknessFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
    if (!currentViewer) return;
    if (!thicknessFile) {
      await queuePatch({ thicknessMap: null });
      return;
    }
    const url = URL.createObjectURL(thicknessFile);
    try {
      await queuePatch({ thicknessMap: url });
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  panel.querySelector<HTMLButtonElement>('#sss-clear-thickness')?.addEventListener('click', async () => {
    thicknessFile = null;
    const input = panel.querySelector<HTMLInputElement>('#sss-thickness-map');
    if (input) input.value = '';
    await queuePatch({ thicknessMap: null });
  });

  panel.querySelector<HTMLButtonElement>('#sss-demo')?.addEventListener('click', async () => {
    if (!currentViewer) return;
    setStatus('Loading material study…');
    await currentViewer.loadModel('procedural:matte');
    await queuePatch({
      enabled: true,
      color: '#ff8050',
      distortion: 0.1,
      ambient: 0.4,
      attenuation: 0.8,
      power: 2,
      scale: 16,
    });
  });
}

function mountPanel() {
  if (document.querySelector('#sss-material-panel')) {
    syncPanel();
    return;
  }

  const inspector = document.querySelector<HTMLElement>('.inspector');
  if (!inspector) {
    requestAnimationFrame(mountPanel);
    return;
  }

  const panel = createPanel();
  const materialPanel = document.querySelector('#material-panel');
  if (materialPanel) materialPanel.insertAdjacentElement('afterend', panel);
  else inspector.append(panel);
  bindPanel(panel);
  syncPanel();
}

window.addEventListener('kyxos-viewer-created', () => requestAnimationFrame(() => syncPanel()));

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
} else {
  mountPanel();
}

declare global {
  interface Window {
    __kyxosSSSTestApi?: {
      set: (settings: SSSPatch) => Promise<SSSMaterialStatus | null>;
      get: () => SSSMaterialStatus | null;
      demo: () => Promise<SSSMaterialStatus | null>;
    };
  }
}

window.__kyxosSSSTestApi = {
  set: queuePatch,
  get: () => currentViewer?.getSSSMaterialStatus() ?? null,
  demo: async () => {
    if (!currentViewer) return null;
    await currentViewer.loadModel('procedural:matte');
    return queuePatch({ enabled: true });
  },
};
