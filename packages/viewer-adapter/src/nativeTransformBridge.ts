import type {
  EditorTransformMode,
  EditorTransformSnap,
  EditorTransformSpace,
  KyxosViewer,
} from '@kyxos/viewer';

import {
  BrowserKyxosViewportAdapter,
  type CoordinateSpace,
  type EditorTool,
  type KyxosViewportAdapter,
  type SnapSettings,
} from './index';
import { getAdapterTransformPivot } from './transformPivot';
import { getAdapterViewportHelpers } from './viewportHelpers';

type AdapterInternals = {
  viewer: KyxosViewer | null;
  gizmo: HTMLDivElement | null;
  selected: string[];
  tool: EditorTransformMode;
  coordinateSpace: EditorTransformSpace;
  snap: EditorTransformSnap;
};

type AdapterPrototype = {
  mount: KyxosViewportAdapter['mount'];
  loadDocument: KyxosViewportAdapter['loadDocument'];
  applyPatch: KyxosViewportAdapter['applyPatch'];
  select: KyxosViewportAdapter['select'];
  setTool: KyxosViewportAdapter['setTool'];
  setCoordinateSpace: KyxosViewportAdapter['setCoordinateSpace'];
  setSnap: KyxosViewportAdapter['setSnap'];
  dispose: KyxosViewportAdapter['dispose'];
  [key: symbol]: unknown;
};

interface NativeBridgeState {
  viewer: KyxosViewer;
  onChange: (event: Event) => void;
  onStart: (event: Event) => void;
  onEnd: (event: Event) => void;
  onDragging: (event: Event) => void;
}

const bridgeStates = new WeakMap<BrowserKyxosViewportAdapter, NativeBridgeState>();
const installed = Symbol('kyxos.nativeTransformBridge.installed');

function internals(adapter: BrowserKyxosViewportAdapter): AdapterInternals {
  return adapter as unknown as AdapterInternals;
}

function removeFallbackGizmo(adapter: BrowserKyxosViewportAdapter): void {
  const internal = internals(adapter);
  internal.gizmo?.remove();
  internal.gizmo = null;
}

function syncNativeControls(adapter: BrowserKyxosViewportAdapter): void {
  const internal = internals(adapter);
  const viewer = internal.viewer;
  if (!viewer) return;
  viewer.setEditorTransformSelection(internal.selected);
  viewer.setEditorTransformMode(internal.tool);
  viewer.setEditorTransformSpace(internal.coordinateSpace);
  viewer.setEditorTransformPivot(getAdapterTransformPivot(adapter));
  viewer.setEditorTransformSnap(internal.snap);
  viewer.setEditorViewportHelperSettings(getAdapterViewportHelpers(adapter));
  viewer.setEditorViewportHelperSelection(internal.selected);
  removeFallbackGizmo(adapter);
}

function detachNativeBridge(adapter: BrowserKyxosViewportAdapter): void {
  const state = bridgeStates.get(adapter);
  if (!state) return;
  state.viewer.removeEventListener('editor-transform-change', state.onChange);
  state.viewer.removeEventListener('editor-transform-start', state.onStart);
  state.viewer.removeEventListener('editor-transform-end', state.onEnd);
  state.viewer.removeEventListener('editor-transform-dragging', state.onDragging);
  state.viewer.disposeEditorTransformControls();
  state.viewer.disposeEditorViewportHelpers();
  bridgeStates.delete(adapter);
}

export function installNativeTransformBridge(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as unknown as AdapterPrototype;
  if (prototype[installed]) return;

  const originalMount = prototype.mount;
  const originalLoadDocument = prototype.loadDocument;
  const originalApplyPatch = prototype.applyPatch;
  const originalSelect = prototype.select;
  const originalSetTool = prototype.setTool;
  const originalSetCoordinateSpace = prototype.setCoordinateSpace;
  const originalSetSnap = prototype.setSnap;
  const originalDispose = prototype.dispose;

  prototype.mount = async function mountWithNativeTransform(
    this: BrowserKyxosViewportAdapter,
    canvas: HTMLCanvasElement,
  ): Promise<void> {
    await originalMount.call(this, canvas);
    const viewer = internals(this).viewer;
    if (!viewer) return;
    viewer.createEditorTransformControls();
    viewer.createEditorViewportHelpers();
    const onChange = (event: Event) => {
      this.dispatchEvent(new CustomEvent('transform-change', {
        detail: (event as CustomEvent).detail,
      }));
    };
    const onStart = (event: Event) => {
      this.dispatchEvent(new CustomEvent('transform-start', {
        detail: (event as CustomEvent).detail,
      }));
    };
    const onEnd = (event: Event) => {
      this.dispatchEvent(new CustomEvent('transform-end', {
        detail: (event as CustomEvent).detail,
      }));
    };
    const onDragging = (event: Event) => {
      const dragging = Boolean((event as CustomEvent<{ dragging?: boolean }>).detail?.dragging);
      canvas.classList.toggle('native-transform-dragging', dragging);
      canvas.dataset.editorDragging = String(dragging);
    };
    viewer.addEventListener('editor-transform-change', onChange);
    viewer.addEventListener('editor-transform-start', onStart);
    viewer.addEventListener('editor-transform-end', onEnd);
    viewer.addEventListener('editor-transform-dragging', onDragging);
    bridgeStates.set(this, { viewer, onChange, onStart, onEnd, onDragging });
    syncNativeControls(this);
  };

  prototype.loadDocument = async function loadDocumentWithNativeTransform(
    this: BrowserKyxosViewportAdapter,
    document,
  ): Promise<void> {
    const viewer = internals(this).viewer;
    // Editor-only helpers live in the Viewer scene. Remove them while the runtime
    // replaces a model so GLTF loading, scene traversal and pipeline compilation
    // never observe stale helper geometry or mutate the scene being loaded.
    viewer?.disposeEditorViewportHelpers();
    try {
      await originalLoadDocument.call(this, document);
    } finally {
      const currentViewer = internals(this).viewer;
      currentViewer?.createEditorViewportHelpers();
      syncNativeControls(this);
    }
  };

  prototype.applyPatch = async function applyPatchWithNativeTransform(
    this: BrowserKyxosViewportAdapter,
    patch,
  ): Promise<void> {
    await originalApplyPatch.call(this, patch);
    const viewer = internals(this).viewer;
    viewer?.refreshEditorTransformControls();
    viewer?.refreshEditorViewportHelpers();
  };

  prototype.select = function selectWithNativeTransform(
    this: BrowserKyxosViewportAdapter,
    nodeIds: string[],
  ): void {
    originalSelect.call(this, nodeIds);
    syncNativeControls(this);
  };

  prototype.setTool = function setToolWithNativeTransform(
    this: BrowserKyxosViewportAdapter,
    tool: EditorTool,
  ): void {
    originalSetTool.call(this, tool);
    syncNativeControls(this);
  };

  prototype.setCoordinateSpace = function setCoordinateSpaceWithNativeTransform(
    this: BrowserKyxosViewportAdapter,
    space: CoordinateSpace,
  ): void {
    originalSetCoordinateSpace.call(this, space);
    syncNativeControls(this);
  };

  prototype.setSnap = function setSnapWithNativeTransform(
    this: BrowserKyxosViewportAdapter,
    snap: SnapSettings,
  ): void {
    originalSetSnap.call(this, snap);
    syncNativeControls(this);
  };

  prototype.dispose = function disposeWithNativeTransform(
    this: BrowserKyxosViewportAdapter,
  ): void {
    detachNativeBridge(this);
    originalDispose.call(this);
  };

  prototype[installed] = true;
}
