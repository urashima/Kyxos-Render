import type { ProjectSession } from '@kyxos/editor-core';
import type { EditorViewportCommand } from '@kyxos/viewer-adapter';
import { BrowserKyxosViewportAdapter } from '@kyxos/viewer-adapter';

import './camera-preview-parity.css';

interface AdapterPrototype {
  bindSession(session: ProjectSession): () => void;
  __kyxosCameraPreviewParityInstalled?: boolean;
}

interface PreviewWindowState {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  collapsed?: boolean;
}

interface PreviewBinding {
  adapter: BrowserKyxosViewportAdapter;
  session: ProjectSession;
  panel: HTMLDivElement | null;
  previewCanvas: HTMLCanvasElement | null;
  title: HTMLSpanElement | null;
  pinButton: HTMLButtonElement | null;
  viewButton: HTMLButtonElement | null;
  foldButton: HTMLButtonElement | null;
  status: HTMLDivElement | null;
  cameraId: string | null;
  pinnedCameraId: string | null;
  dismissedCameraId: string | null;
  collapsed: boolean;
  manualPosition: boolean;
  mountGeneration: number;
  resizeObserver: ResizeObserver | null;
  mainCanvasObserver: MutationObserver | null;
  onSelection: EventListener;
  onDocument: EventListener;
  onPreview: EventListener;
  onWindowResize: () => void;
}

const WINDOW_KEY = 'kyxos-studio-camera-preview-window-v1';
const bindings = new WeakMap<BrowserKyxosViewportAdapter, PreviewBinding>();

function mainCanvas(adapter: BrowserKyxosViewportAdapter): HTMLCanvasElement | null {
  return (adapter as unknown as { canvas: HTMLCanvasElement | null }).canvas;
}

function readWindowState(): PreviewWindowState {
  try {
    return JSON.parse(localStorage.getItem(WINDOW_KEY) ?? '{}') as PreviewWindowState;
  } catch {
    return {};
  }
}

function writeWindowState(binding: PreviewBinding): void {
  const panel = binding.panel;
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  const current = readWindowState();
  const next: PreviewWindowState = {
    left: rect.left,
    top: rect.top,
    width: binding.collapsed ? current.width : rect.width,
    height: binding.collapsed ? current.height : rect.height,
    collapsed: binding.collapsed,
  };
  localStorage.setItem(WINDOW_KEY, JSON.stringify(next));
}

function sceneCameraForNode(session: ProjectSession, nodeId: string | undefined): string | null {
  if (!nodeId) return null;
  return session.document.value.nodes.find((node) => node.id === nodeId)?.cameraId ?? null;
}

function selectedCameraId(binding: PreviewBinding): string | null {
  for (const nodeId of binding.session.selection.selected) {
    const cameraId = sceneCameraForNode(binding.session, nodeId);
    if (cameraId) return cameraId;
  }
  return null;
}

function cameraExists(binding: PreviewBinding, cameraId: string | null): boolean {
  return Boolean(cameraId && binding.session.document.value.cameras.some((camera) => camera.id === cameraId));
}

function cameraName(binding: PreviewBinding, cameraId: string): string {
  return binding.session.document.value.cameras.find((camera) => camera.id === cameraId)?.name ?? 'Camera';
}

function desiredCameraId(binding: PreviewBinding): string | null {
  if (cameraExists(binding, binding.pinnedCameraId)) return binding.pinnedCameraId;
  if (binding.pinnedCameraId) binding.pinnedCameraId = null;
  const selected = selectedCameraId(binding);
  if (selected !== binding.dismissedCameraId) return selected;
  return null;
}

function clampPanel(binding: PreviewBinding): void {
  const panel = binding.panel;
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
  const left = Math.min(maxLeft, Math.max(margin, rect.left));
  const top = Math.min(maxTop, Math.max(margin, rect.top));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function anchorPanel(binding: PreviewBinding): void {
  const panel = binding.panel;
  const canvas = mainCanvas(binding.adapter);
  if (!panel || !canvas) return;
  if (binding.manualPosition) {
    clampPanel(binding);
    return;
  }
  const viewport = canvas.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const left = Math.max(8, Math.min(
    window.innerWidth - panelRect.width - 8,
    viewport.right - panelRect.width - 14,
  ));
  const top = Math.max(8, Math.min(
    window.innerHeight - panelRect.height - 8,
    viewport.top + 14,
  ));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function dispatchViewportCommand(
  adapter: BrowserKyxosViewportAdapter,
  detail: EditorViewportCommand,
): void {
  mainCanvas(adapter)?.dispatchEvent(new CustomEvent('kyxos:editor-viewport-command', { detail }));
}

function updateViewButton(binding: PreviewBinding): void {
  const button = binding.viewButton;
  const panel = binding.panel;
  const canvas = mainCanvas(binding.adapter);
  if (!button || !panel || !canvas || !binding.cameraId) return;
  const active = canvas.dataset.editorSceneCameraView === binding.cameraId;
  button.textContent = active ? 'Return' : 'View';
  button.title = active ? 'Return to the previous editor camera' : 'View through this Scene Camera';
  button.setAttribute('aria-pressed', String(active));
  panel.dataset.viewThrough = String(active);
}

function updateHeader(binding: PreviewBinding): void {
  if (!binding.cameraId) return;
  if (binding.title) binding.title.textContent = cameraName(binding, binding.cameraId);
  if (binding.pinButton) {
    const pinned = binding.pinnedCameraId === binding.cameraId;
    binding.pinButton.setAttribute('aria-pressed', String(pinned));
    binding.pinButton.title = pinned ? 'Unpin camera preview' : 'Pin camera preview';
  }
  if (binding.foldButton) {
    binding.foldButton.textContent = binding.collapsed ? '⌄' : '⌃';
    binding.foldButton.title = binding.collapsed ? 'Expand camera preview' : 'Collapse camera preview';
  }
  updateViewButton(binding);
}

function setStatus(binding: PreviewBinding, message: string | null): void {
  if (!binding.status) return;
  binding.status.hidden = !message;
  binding.status.textContent = message ?? '';
}

function installDrag(binding: PreviewBinding, header: HTMLElement): void {
  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const panel = binding.panel;
    if (!panel) return;
    event.preventDefault();
    const start = panel.getBoundingClientRect();
    const offsetX = event.clientX - start.left;
    const offsetY = event.clientY - start.top;
    binding.manualPosition = true;
    header.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId || !binding.panel) return;
      binding.panel.style.left = `${moveEvent.clientX - offsetX}px`;
      binding.panel.style.top = `${moveEvent.clientY - offsetY}px`;
      clampPanel(binding);
    };
    const end = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', end);
      header.removeEventListener('pointercancel', end);
      writeWindowState(binding);
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
  });
}

function restoreWindowState(binding: PreviewBinding): void {
  const panel = binding.panel;
  if (!panel) return;
  const saved = readWindowState();
  if (saved.width && Number.isFinite(saved.width)) panel.style.width = `${saved.width}px`;
  if (saved.height && Number.isFinite(saved.height)) panel.style.height = `${saved.height}px`;
  if (saved.left != null && saved.top != null) {
    panel.style.left = `${saved.left}px`;
    panel.style.top = `${saved.top}px`;
    binding.manualPosition = true;
  }
  binding.collapsed = saved.collapsed === true;
  panel.classList.toggle('kx-camera-preview-collapsed', binding.collapsed);
  requestAnimationFrame(() => {
    if (binding.manualPosition) clampPanel(binding);
    else anchorPanel(binding);
  });
}

function createPanel(binding: PreviewBinding): void {
  if (binding.panel?.isConnected) return;
  const panel = document.createElement('div');
  panel.className = 'kx-camera-preview';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Camera preview');

  const header = document.createElement('div');
  header.className = 'kx-camera-preview-header';
  const title = document.createElement('span');
  title.className = 'kx-camera-preview-title';
  const actions = document.createElement('div');
  actions.className = 'kx-camera-preview-actions';

  const view = document.createElement('button');
  view.type = 'button';
  view.textContent = 'View';
  view.setAttribute('aria-label', 'View through camera');
  view.addEventListener('click', () => {
    if (!binding.cameraId) return;
    const active = mainCanvas(binding.adapter)?.dataset.editorSceneCameraView === binding.cameraId;
    dispatchViewportCommand(binding.adapter, active
      ? { command: 'scene-camera' }
      : { command: 'scene-camera', cameraId: binding.cameraId });
    queueMicrotask(() => updateViewButton(binding));
  });

  const pin = document.createElement('button');
  pin.type = 'button';
  pin.textContent = 'Pin';
  pin.setAttribute('aria-label', 'Pin camera preview');
  pin.addEventListener('click', () => {
    if (!binding.cameraId) return;
    binding.pinnedCameraId = binding.pinnedCameraId === binding.cameraId ? null : binding.cameraId;
    binding.dismissedCameraId = null;
    updateHeader(binding);
  });

  const fold = document.createElement('button');
  fold.type = 'button';
  fold.setAttribute('aria-label', 'Collapse camera preview');
  fold.addEventListener('click', () => {
    binding.collapsed = !binding.collapsed;
    panel.classList.toggle('kx-camera-preview-collapsed', binding.collapsed);
    updateHeader(binding);
    writeWindowState(binding);
    if (!binding.collapsed) requestAnimationFrame(() => clampPanel(binding));
  });

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close camera preview');
  close.title = 'Close camera preview';
  close.addEventListener('click', () => {
    binding.dismissedCameraId = binding.cameraId;
    binding.pinnedCameraId = null;
    removePanel(binding);
  });

  actions.append(view, pin, fold, close);
  header.append(title, actions);

  const body = document.createElement('div');
  body.className = 'kx-camera-preview-body';
  const canvas = document.createElement('canvas');
  canvas.className = 'kx-camera-preview-canvas';
  canvas.dataset.sceneCameraPreview = 'true';
  canvas.setAttribute('aria-label', 'Live camera preview canvas');
  const status = document.createElement('div');
  status.className = 'kx-camera-preview-status';
  status.textContent = 'Loading camera preview…';
  body.append(canvas, status);
  panel.append(header, body);

  // Deliberately live outside .kyxos-studio-shell. The preview is a runtime
  // Scene Camera render and must not inherit Studio's detached authoring camera.
  document.body.append(panel);
  binding.panel = panel;
  binding.previewCanvas = canvas;
  binding.title = title;
  binding.pinButton = pin;
  binding.viewButton = view;
  binding.foldButton = fold;
  binding.status = status;

  installDrag(binding, header);
  restoreWindowState(binding);
  binding.resizeObserver?.disconnect();
  binding.resizeObserver = new ResizeObserver(() => {
    if (!binding.collapsed) writeWindowState(binding);
  });
  binding.resizeObserver.observe(panel);
  updateHeader(binding);
}

function removePanel(binding: PreviewBinding): void {
  binding.mountGeneration += 1;
  binding.adapter.closeCameraPreview();
  binding.resizeObserver?.disconnect();
  binding.resizeObserver = null;
  binding.panel?.remove();
  binding.panel = null;
  binding.previewCanvas = null;
  binding.title = null;
  binding.pinButton = null;
  binding.viewButton = null;
  binding.foldButton = null;
  binding.status = null;
  binding.cameraId = null;
}

async function ensurePreview(binding: PreviewBinding): Promise<void> {
  const desired = desiredCameraId(binding);
  if (!desired) {
    removePanel(binding);
    return;
  }
  createPanel(binding);
  if (!binding.previewCanvas) return;
  updateHeader(binding);
  anchorPanel(binding);

  if (binding.cameraId === desired && binding.adapter.getCameraPreviewCamera() === desired) {
    updateHeader(binding);
    return;
  }

  binding.cameraId = desired;
  updateHeader(binding);
  const mountedCamera = binding.adapter.getCameraPreviewCamera();
  if (mountedCamera) {
    binding.adapter.setCameraPreviewCamera(desired);
    setStatus(binding, null);
    return;
  }

  const generation = ++binding.mountGeneration;
  setStatus(binding, 'Loading camera preview…');
  try {
    await binding.adapter.mountCameraPreview(binding.previewCanvas, desired);
    if (generation !== binding.mountGeneration || binding.cameraId !== desired) return;
    setStatus(binding, null);
    updateHeader(binding);
  } catch (error) {
    if (generation !== binding.mountGeneration) return;
    setStatus(binding, error instanceof Error ? error.message : 'Camera preview failed.');
  }
}

function installPreviewUI(
  adapter: BrowserKyxosViewportAdapter,
  session: ProjectSession,
): () => void {
  const onSelection: EventListener = () => {
    const selected = selectedCameraId(binding);
    if (selected !== binding.dismissedCameraId) binding.dismissedCameraId = null;
    void ensurePreview(binding);
  };
  const onDocument: EventListener = () => {
    if (binding.pinnedCameraId && !cameraExists(binding, binding.pinnedCameraId)) {
      binding.pinnedCameraId = null;
    }
    void ensurePreview(binding);
  };
  const onPreview: EventListener = (event) => {
    const detail = (event as CustomEvent<{ status?: string; error?: unknown }>).detail;
    if (detail?.status === 'ready' || detail?.status === 'camera') setStatus(binding, null);
    if (detail?.status === 'error') {
      setStatus(binding, detail.error instanceof Error ? detail.error.message : 'Camera preview failed.');
    }
  };
  const onWindowResize = () => anchorPanel(binding);

  const binding: PreviewBinding = {
    adapter,
    session,
    panel: null,
    previewCanvas: null,
    title: null,
    pinButton: null,
    viewButton: null,
    foldButton: null,
    status: null,
    cameraId: null,
    pinnedCameraId: null,
    dismissedCameraId: null,
    collapsed: false,
    manualPosition: false,
    mountGeneration: 0,
    resizeObserver: null,
    mainCanvasObserver: null,
    onSelection,
    onDocument,
    onPreview,
    onWindowResize,
  };
  bindings.set(adapter, binding);

  session.selection.addEventListener('change', onSelection);
  session.document.addEventListener('change', onDocument);
  adapter.addEventListener('camera-preview', onPreview);
  window.addEventListener('resize', onWindowResize);
  const canvas = mainCanvas(adapter);
  if (canvas) {
    binding.mainCanvasObserver = new MutationObserver(() => updateViewButton(binding));
    binding.mainCanvasObserver.observe(canvas, {
      attributes: true,
      attributeFilter: ['data-editor-scene-camera-view', 'data-authoring-camera'],
    });
  }
  requestAnimationFrame(() => void ensurePreview(binding));

  return () => {
    session.selection.removeEventListener('change', onSelection);
    session.document.removeEventListener('change', onDocument);
    adapter.removeEventListener('camera-preview', onPreview);
    window.removeEventListener('resize', onWindowResize);
    binding.mainCanvasObserver?.disconnect();
    removePanel(binding);
    bindings.delete(adapter);
  };
}

export function installCameraPreviewParity(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as unknown as AdapterPrototype;
  if (prototype.__kyxosCameraPreviewParityInstalled) return;
  const originalBindSession = prototype.bindSession;

  prototype.bindSession = function bindSessionWithCameraPreview(session: ProjectSession): () => void {
    const unbind = originalBindSession.call(this, session);
    const disposePreview = installPreviewUI(this as unknown as BrowserKyxosViewportAdapter, session);
    return () => {
      disposePreview();
      unbind();
    };
  };

  prototype.__kyxosCameraPreviewParityInstalled = true;
}

installCameraPreviewParity();