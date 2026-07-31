import {
  DEFAULT_SCREEN_SPACE_SSS_SETTINGS,
  KyxosViewer,
  type KyxosViewerCreateOptions,
  type ScreenSpaceSSSSettings,
  type ScreenSpaceSSSStatus,
} from '@kyxos/viewer';

type ViewerCreate = (options: KyxosViewerCreateOptions) => Promise<KyxosViewer>;
type SSSPatch = Partial<ScreenSpaceSSSSettings>;

type SSSPreset = Pick<
  ScreenSpaceSSSSettings,
  'color' | 'strength' | 'radius' | 'falloff' | 'thickness' | 'depthFalloff' | 'normalThreshold'
>;

const presets: Record<'skin' | 'wax' | 'jade', SSSPreset> = {
  skin: {
    color: '#ffb59e',
    strength: 1.15,
    radius: 18,
    falloff: [1, 0.72, 0.5],
    thickness: 0.78,
    depthFalloff: 36,
    normalThreshold: 0.05,
  },
  wax: {
    color: '#ffd2a1',
    strength: 1.35,
    radius: 24,
    falloff: [1, 0.82, 0.58],
    thickness: 0.92,
    depthFalloff: 28,
    normalThreshold: -0.1,
  },
  jade: {
    color: '#9fffc5',
    strength: 1.05,
    radius: 20,
    falloff: [0.5, 1, 0.72],
    thickness: 0.85,
    depthFalloff: 42,
    normalThreshold: 0.1,
  },
};

const patchKey = Symbol.for('kyxos.playground.screen-space-sss-controls');
const viewerConstructor = KyxosViewer as typeof KyxosViewer & { create: ViewerCreate };
const constructorState = viewerConstructor as unknown as Record<PropertyKey, unknown>;

let currentViewer: KyxosViewer | null = null;
let currentSettings = structuredClone(
  DEFAULT_SCREEN_SPACE_SSS_SETTINGS,
) as ScreenSpaceSSSSettings;
let routeInitialized = false;

function isSSSRoute() {
  return window.location.pathname.split('/').filter(Boolean).at(-1) === 'sss';
}

function applyPatch(patch: SSSPatch) {
  currentSettings = {
    ...currentSettings,
    ...patch,
    falloff: patch.falloff ? [...patch.falloff] : [...currentSettings.falloff],
    materialNames:
      patch.materialNames === undefined ? currentSettings.materialNames : patch.materialNames,
  };
  const status = currentViewer?.setScreenSpaceSSS(patch) ?? null;
  syncPanel(status);
  return status;
}

if (!constructorState[patchKey]) {
  const originalCreate = viewerConstructor.create.bind(viewerConstructor);

  viewerConstructor.create = async (options: KyxosViewerCreateOptions) => {
    const viewer = await originalCreate(options);
    currentViewer = viewer;

    if (isSSSRoute()) {
      if (!routeInitialized) {
        currentSettings = {
          ...(structuredClone(DEFAULT_SCREEN_SPACE_SSS_SETTINGS) as ScreenSpaceSSSSettings),
          enabled: true,
          quality: 'high',
          ...presets.skin,
        };
        routeInitialized = true;
      }
      await viewer.loadModel('procedural:sphere');
      viewer.setScreenSpaceSSS(currentSettings);
    } else if (currentSettings.enabled) {
      viewer.setScreenSpaceSSS(currentSettings);
    }

    window.dispatchEvent(new CustomEvent('kyxos-viewer-created'));
    syncPanel(viewer.getScreenSpaceSSSStatus());
    return viewer;
  };

  constructorState[patchKey] = true;
}

function numberControl(
  key: keyof ScreenSpaceSSSSettings,
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

function falloffControl(channel: 0 | 1 | 2, label: string, value: number) {
  return `
    <div class="control-row range">
      <label for="sss-falloff-${channel}">${label}</label>
      <input id="sss-falloff-${channel}" data-sss-falloff="${channel}" type="range" min="0" max="2" step="0.01" value="${value}">
      <output>${value.toFixed(2)}</output>
    </div>`;
}

function createPanel() {
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.id = 'screen-space-sss-panel';
  panel.hidden = !isSSSRoute();
  panel.innerHTML = `
    <div class="panel-title"><span>Screen-Space SSS</span><span>Deferred</span></div>
    <div class="panel-body">
      <div class="control-row">
        <label for="sss-enabled">Subsurface scattering</label>
        <input class="switch" id="sss-enabled" type="checkbox">
      </div>
      <div class="control-row">
        <label for="sss-quality">Quality</label>
        <select class="select" id="sss-quality">
          <option value="low">Low · 5 tap</option>
          <option value="medium">Medium · 7 tap</option>
          <option value="high">High · dual lobe</option>
        </select>
      </div>
      <div class="control-row">
        <label for="sss-color">Scattering color</label>
        <input id="sss-color" type="color" value="${currentSettings.color}">
      </div>
      ${numberControl('strength', 'Strength', 0, 1.5, 0.01, currentSettings.strength)}
      ${numberControl('radius', 'Radius', 0.25, 32, 0.25, currentSettings.radius)}
      ${numberControl('thickness', 'Thickness', 0.01, 1, 0.01, currentSettings.thickness)}
      ${numberControl('depthFalloff', 'Depth edge stop', 1, 256, 1, currentSettings.depthFalloff)}
      ${numberControl('normalThreshold', 'Normal edge stop', -1, 0.99, 0.01, currentSettings.normalThreshold)}
      ${falloffControl(0, 'Falloff R', currentSettings.falloff[0])}
      ${falloffControl(1, 'Falloff G', currentSettings.falloff[1])}
      ${falloffControl(2, 'Falloff B', currentSettings.falloff[2])}
      <div class="control-row">
        <button class="btn" data-sss-preset="skin">Skin</button>
        <button class="btn" data-sss-preset="wax">Wax</button>
        <button class="btn" data-sss-preset="jade">Jade</button>
      </div>
      <div class="control-row"><span id="sss-status">Ready</span><span>Diffuse only</span></div>
    </div>`;
  return panel;
}

function setStatus(message: string, failed = false) {
  const status = document.querySelector<HTMLElement>('#sss-status');
  if (!status) return;
  status.textContent = message;
  status.style.color = failed ? '#ff6b6b' : '';
}

function syncPanel(status = currentViewer?.getScreenSpaceSSSStatus() ?? null) {
  if (!status) return;
  const enabled = document.querySelector<HTMLInputElement>('#sss-enabled');
  const quality = document.querySelector<HTMLSelectElement>('#sss-quality');
  const color = document.querySelector<HTMLInputElement>('#sss-color');
  if (enabled) enabled.checked = status.enabled;
  if (quality) quality.value = status.quality;
  if (color) color.value = status.color;

  document.querySelectorAll<HTMLInputElement>('[data-sss-number]').forEach((input) => {
    const key = input.dataset.sssNumber as keyof ScreenSpaceSSSSettings;
    const value = Number(status[key]);
    if (!Number.isFinite(value)) return;
    input.value = String(value);
    const output = input.nextElementSibling;
    if (output) {
      output.textContent = value.toFixed(Number(input.step) < 0.1 ? 2 : Number(input.step) < 1 ? 1 : 0);
    }
  });

  document.querySelectorAll<HTMLInputElement>('[data-sss-falloff]').forEach((input) => {
    const index = Number(input.dataset.sssFalloff) as 0 | 1 | 2;
    input.value = String(status.falloff[index]);
    const output = input.nextElementSibling;
    if (output) output.textContent = status.falloff[index].toFixed(2);
  });

  setStatus(
    status.lastError
      ? `Isolated · ${status.lastError}`
      : status.enabled
        ? `Enabled · ${status.markedMaterials}/${status.eligibleMaterials} materials`
        : 'Disabled',
    Boolean(status.lastError),
  );
}

function bindRange(input: HTMLInputElement, apply: () => void) {
  input.addEventListener('input', () => {
    const output = input.nextElementSibling;
    if (output) {
      output.textContent = Number(input.value).toFixed(
        Number(input.step) < 0.1 ? 2 : Number(input.step) < 1 ? 1 : 0,
      );
    }
  });
  input.addEventListener('change', apply);
}

function bindPanel(panel: HTMLElement) {
  panel.querySelector<HTMLInputElement>('#sss-enabled')?.addEventListener('change', (event) => {
    applyPatch({ enabled: (event.currentTarget as HTMLInputElement).checked });
  });
  panel.querySelector<HTMLSelectElement>('#sss-quality')?.addEventListener('change', (event) => {
    applyPatch({ quality: (event.currentTarget as HTMLSelectElement).value as ScreenSpaceSSSSettings['quality'] });
  });
  panel.querySelector<HTMLInputElement>('#sss-color')?.addEventListener('input', (event) => {
    applyPatch({ color: (event.currentTarget as HTMLInputElement).value });
  });

  panel.querySelectorAll<HTMLInputElement>('[data-sss-number]').forEach((input) => {
    bindRange(input, () => {
      const key = input.dataset.sssNumber as keyof ScreenSpaceSSSSettings;
      applyPatch({ [key]: Number(input.value) } as SSSPatch);
    });
  });

  panel.querySelectorAll<HTMLInputElement>('[data-sss-falloff]').forEach((input) => {
    bindRange(input, () => {
      const falloff = [...currentSettings.falloff] as [number, number, number];
      falloff[Number(input.dataset.sssFalloff) as 0 | 1 | 2] = Number(input.value);
      applyPatch({ falloff });
    });
  });

  panel.querySelectorAll<HTMLButtonElement>('[data-sss-preset]').forEach((button) => {
    button.addEventListener('click', async () => {
      const name = button.dataset.sssPreset as keyof typeof presets;
      if (!currentViewer || !presets[name]) return;
      setStatus(`Loading ${name} preset…`);
      await currentViewer.loadModel('procedural:sphere');
      applyPatch({ enabled: true, quality: 'high', ...presets[name] });
    });
  });
}

function mountPanel() {
  if (document.querySelector('#screen-space-sss-panel')) {
    syncPanel();
    return;
  }

  const inspector = document.querySelector<HTMLElement>('.inspector');
  if (!inspector) {
    requestAnimationFrame(mountPanel);
    return;
  }

  const panel = createPanel();
  const parameterPanel = document.querySelector('#parameter-panel');
  if (parameterPanel) parameterPanel.insertAdjacentElement('afterend', panel);
  else inspector.append(panel);
  bindPanel(panel);
  syncPanel();
}

type ScreenSpaceSSSTestApi = {
  getStatus: () => ScreenSpaceSSSStatus | null;
  set: (settings: SSSPatch) => ScreenSpaceSSSStatus | null;
};

declare global {
  interface Window {
    __kyxosScreenSpaceSSSTestApi: ScreenSpaceSSSTestApi;
  }
}

window.__kyxosScreenSpaceSSSTestApi = {
  getStatus: () => currentViewer?.getScreenSpaceSSSStatus() ?? null,
  set: applyPatch,
};

window.addEventListener('kyxos-viewer-created', () => syncPanel());
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
} else {
  mountPanel();
}
