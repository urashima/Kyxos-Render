import type { ProjectSession } from '@kyxos/editor-core';
import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

const INSTALL_KEY = Symbol.for('kyxos.studio.material-selection');

type AdapterPrototype = {
  bindSession(session: ProjectSession): () => void;
} & Record<PropertyKey, unknown>;

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

function currentMaterial(session: ProjectSession): {
  id: string;
  name: string;
  slot: number;
} | null {
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
  return material ? { id, name: material.name, slot } : null;
}

function installStyles(): void {
  if (document.querySelector('style[data-kx-current-material]')) return;
  const style = document.createElement('style');
  style.dataset.kxCurrentMaterial = 'true';
  style.textContent = `
    .kx-current-material {
      display: grid;
      gap: 2px;
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
    .kx-current-material strong {
      overflow: hidden;
      color: var(--kx-text-primary);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
  document.head.append(style);
}

function syncMaterialPresentation(session: ProjectSession): void {
  const material = currentMaterial(session);
  const canvas = document.querySelector<HTMLCanvasElement>('#studio-canvas');
  if (canvas) {
    if (material) {
      canvas.dataset.selectedMaterialId = material.id;
      canvas.dataset.selectedMaterialName = material.name;
      canvas.dataset.selectedMaterialSlot = String(material.slot);
    } else {
      delete canvas.dataset.selectedMaterialId;
      delete canvas.dataset.selectedMaterialName;
      delete canvas.dataset.selectedMaterialSlot;
    }
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
    banner.innerHTML = '<small>Current material</small><strong></strong>';
    const summary = materialSection.querySelector(':scope > summary');
    summary?.insertAdjacentElement('afterend', banner);
  }
  banner.querySelector('strong')!.textContent = material.name;
  banner.title = `${material.name} · ${material.id}`;

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

    const observer = new MutationObserver(scheduleSync);
    const root = document.querySelector('#app');
    if (root) observer.observe(root, { childList: true, subtree: true });
    session.document.addEventListener('change', scheduleSync);
    session.selection.addEventListener('change', scheduleSync);
    scheduleSync();

    return () => {
      observer.disconnect();
      session.document.removeEventListener('change', scheduleSync);
      session.selection.removeEventListener('change', scheduleSync);
      disposeOriginal();
    };
  };
}

install();
