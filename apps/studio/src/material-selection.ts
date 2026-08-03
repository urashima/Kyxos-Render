import type { ProjectSession } from '@kyxos/editor-core';
import type { SceneMaterial } from '@kyxos/scene-contract';
import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

const INSTALL_KEY = Symbol.for('kyxos.studio.material-selection');

type AdapterPrototype = {
  bindSession(session: ProjectSession): () => void;
} & Record<PropertyKey, unknown>;

interface GltfTextureInfo {
  index?: number;
  texCoord?: number;
  scale?: number;
  strength?: number;
  extensions?: Record<string, unknown>;
}

interface GltfTextureSlots {
  baseColor?: GltfTextureInfo;
  metallicRoughness?: GltfTextureInfo;
  normal?: GltfTextureInfo;
  emissive?: GltfTextureInfo;
  occlusion?: GltfTextureInfo;
  clearcoat?: GltfTextureInfo;
  clearcoatRoughness?: GltfTextureInfo;
  transmission?: GltfTextureInfo;
  thickness?: GltfTextureInfo;
}

interface CurrentMaterial {
  id: string;
  name: string;
  slot: number;
  material: SceneMaterial;
}

const textureLabels: Array<[keyof GltfTextureSlots, string]> = [
  ['baseColor', 'Base Color'],
  ['metallicRoughness', 'Metal / Rough'],
  ['normal', 'Normal'],
  ['occlusion', 'Ambient Occlusion'],
  ['emissive', 'Emission'],
  ['clearcoat', 'Clearcoat'],
  ['clearcoatRoughness', 'Clearcoat Roughness'],
  ['transmission', 'Transmission'],
  ['thickness', 'Thickness'],
];

function selectedMaterialNode(session: ProjectSession) {
  const scene = session.document.value;
  return session.selection.selected
    .map((id) => scene.nodes.find((node) => node.id === id))
    .find((node) => Boolean(node?.materialSlots?.length));
}

function chooseFirstMaterialNode(session: ProjectSession): void {
  if (session.selection.selected.length > 0) return;
  const first = session.document.value.nodes.find((node) => node.materialSlots?.length);
  if (first) session.selection.select([first.id]);
}

function currentMaterial(session: ProjectSession): CurrentMaterial | null {
  const scene = session.document.value;
  const node = selectedMaterialNode(session);
  if (!node?.materialSlots?.length) return null;
  const slotControl = document.querySelector<HTMLSelectElement>(
    'select[aria-label="Material slot"]',
  );
  const slot = Math.max(
    0,
    Math.min(node.materialSlots.length - 1, Number(slotControl?.value ?? 0) || 0),
  );
  const id = node.materialSlots[slot];
  const material = scene.materials[id];
  return material ? { id, name: material.name, slot, material } : null;
}

function importedTextureSlots(material: SceneMaterial): GltfTextureSlots {
  const value = material.metadata?.gltfTextures;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as GltfTextureSlots
    : {};
}

function installStyles(): void {
  if (document.querySelector('style[data-kx-current-material]')) return;
  const style = document.createElement('style');
  style.dataset.kxCurrentMaterial = 'true';
  style.textContent = `
    .kx-current-material {
      display: grid;
      gap: 5px;
      margin: 8px 9px 5px !important;
      padding: 8px 9px;
      border: 1px solid var(--kx-border-strong);
      border-radius: var(--kx-radius-sm);
      background: var(--kx-accent-soft);
    }
    .kx-current-material small {
      color: var(--kx-text-muted);
      font-size: 9px;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .kx-current-material > strong {
      overflow: hidden;
      color: var(--kx-text-primary);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .kx-current-material-runtime {
      width: max-content;
      padding: 2px 5px;
      border: 1px solid color-mix(in srgb, var(--kx-accent) 45%, transparent);
      border-radius: 999px;
      color: var(--kx-accent);
      font-size: 9px;
      font-weight: 650;
      letter-spacing: .03em;
    }
    .kx-current-material-textures {
      display: grid;
      gap: 3px;
      margin-top: 2px;
    }
    .kx-current-material-texture {
      display: grid;
      grid-template-columns: minmax(72px, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-height: 22px;
      padding: 3px 5px;
      border: 1px solid var(--kx-border-subtle);
      border-radius: 4px;
      background: color-mix(in srgb, var(--kx-surface-2) 72%, transparent);
    }
    .kx-current-material-texture span {
      overflow: hidden;
      color: var(--kx-text-secondary);
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .kx-current-material-texture code {
      color: var(--kx-text-primary);
      font-size: 9px;
      white-space: nowrap;
    }
    .kx-current-material-no-texture {
      color: var(--kx-text-muted);
      font-size: 9px;
    }
  `;
  document.head.append(style);
}

function setDatasetValue(
  target: HTMLElement,
  key:
    | 'selectedMaterialId'
    | 'selectedMaterialName'
    | 'selectedMaterialSlot'
    | 'selectedMaterialTextureCount',
  value?: string,
): void {
  if (value == null) {
    if (target.dataset[key] !== undefined) delete target.dataset[key];
    return;
  }
  if (target.dataset[key] !== value) target.dataset[key] = value;
}

function renderTextureSlots(container: HTMLElement, material: SceneMaterial): number {
  const slots = importedTextureSlots(material);
  const active = textureLabels.flatMap(([key, label]) => {
    const texture = slots[key];
    return typeof texture?.index === 'number'
      ? [{ key, label, texture }]
      : [];
  });
  const signature = JSON.stringify(active.map(({ key, texture }) => [
    key,
    texture.index,
    texture.texCoord ?? 0,
    texture.scale,
    texture.strength,
  ]));
  if (container.dataset.signature === signature) return active.length;
  container.dataset.signature = signature;
  container.replaceChildren();

  if (!active.length) {
    const empty = document.createElement('div');
    empty.className = 'kx-current-material-no-texture';
    empty.textContent = 'No glTF texture slots';
    container.append(empty);
    return 0;
  }

  for (const { label, texture } of active) {
    const row = document.createElement('div');
    row.className = 'kx-current-material-texture';
    row.dataset.textureIndex = String(texture.index);
    row.dataset.textureChannel = label;
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('code');
    value.textContent = `Embedded #${texture.index} · UV${texture.texCoord ?? 0}`;
    row.append(name, value);
    container.append(row);
  }
  return active.length;
}

function syncMaterialPresentation(session: ProjectSession): void {
  const material = currentMaterial(session);
  const canvas = document.querySelector<HTMLCanvasElement>('#studio-canvas');
  const textures = material ? importedTextureSlots(material.material) : {};
  const textureCount = Object.values(textures).filter(
    (texture) => typeof texture?.index === 'number',
  ).length;
  if (canvas) {
    setDatasetValue(canvas, 'selectedMaterialId', material?.id);
    setDatasetValue(canvas, 'selectedMaterialName', material?.name);
    setDatasetValue(
      canvas,
      'selectedMaterialSlot',
      material ? String(material.slot) : undefined,
    );
    setDatasetValue(
      canvas,
      'selectedMaterialTextureCount',
      material ? String(textureCount) : undefined,
    );
  }

  const materialSection = [
    ...document.querySelectorAll<HTMLDetailsElement>('.inspector-section'),
  ].find(
    (section) =>
      section.querySelector(':scope > summary')?.textContent?.trim() === 'Material',
  );
  if (!materialSection || !material) return;

  let banner = materialSection.querySelector<HTMLElement>(
    ':scope > .kx-current-material',
  );
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'kx-current-material';
    banner.innerHTML = [
      '<small>Current material</small>',
      '<strong></strong>',
      '<div class="kx-current-material-runtime">Native glTF PBR</div>',
      '<div class="kx-current-material-textures" aria-label="Imported glTF texture slots"></div>',
    ].join('');
    const summary = materialSection.querySelector(':scope > summary');
    summary?.insertAdjacentElement('afterend', banner);
  }
  const name = banner.querySelector<HTMLElement>(':scope > strong');
  if (name && name.textContent !== material.name) name.textContent = material.name;
  const title = `${material.name} · ${material.id}`;
  if (banner.title !== title) banner.title = title;
  const textureList = banner.querySelector<HTMLElement>(
    '.kx-current-material-textures',
  );
  if (textureList) renderTextureSlots(textureList, material.material);

  const slotControl = materialSection.querySelector<HTMLSelectElement>(
    'select[aria-label="Material slot"]',
  );
  if (slotControl && slotControl.dataset.kxMaterialSync !== 'true') {
    slotControl.dataset.kxMaterialSync = 'true';
    slotControl.addEventListener('change', () =>
      queueMicrotask(() => syncMaterialPresentation(session)),
    );
  }
}

function install(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as unknown as AdapterPrototype;
  if (prototype[INSTALL_KEY]) return;
  prototype[INSTALL_KEY] = true;
  installStyles();

  const originalBindSession = prototype.bindSession;
  prototype.bindSession = function bindMaterialAwareSession(
    session: ProjectSession,
  ): () => void {
    const disposeOriginal = originalBindSession.call(this, session);
    let syncQueued = false;
    const scheduleSync = () => {
      if (syncQueued) return;
      syncQueued = true;
      queueMicrotask(() => {
        syncQueued = false;
        chooseFirstMaterialNode(session);
        syncMaterialPresentation(session);
      });
    };

    // Scene and selection events are the authoritative causes of Inspector
    // changes. A previous document-wide MutationObserver observed the banner
    // inserted by syncMaterialPresentation itself; assigning textContent then
    // generated another childList record forever and trapped the browser in a
    // microtask feedback loop immediately after GLB activation.
    session.document.addEventListener('change', scheduleSync);
    session.selection.addEventListener('change', scheduleSync);
    scheduleSync();

    return () => {
      session.document.removeEventListener('change', scheduleSync);
      session.selection.removeEventListener('change', scheduleSync);
      disposeOriginal();
    };
  };
}

install();
