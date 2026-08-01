import {
  BrowserKyxosViewportAdapter,
  type EditorTool,
  type SnapSettings,
} from '@kyxos/viewer-adapter';

type CoordinateSpace = 'local' | 'world';

interface EditorViewer extends EventTarget {
  canvas: HTMLCanvasElement;
  createEditorTransformControls(): void;
  setEditorTransformSelection(nodeIds: string[]): void;
  setEditorTransformMode(mode: EditorTool): void;
  setEditorTransformSpace(space: CoordinateSpace): void;
  setEditorTransformSnap(settings: SnapSettings): void;
  refreshEditorTransformControls(): void;
  disposeEditorTransformControls(): void;
}

interface AdapterInternals {
  viewer: EditorViewer | null;
  canvas: HTMLCanvasElement | null;
  gizmo: HTMLElement | null;
  tool: EditorTool;
  onCanvasPointerDown: (event: PointerEvent) => void;
}

interface AdapterPrototype {
  mount(canvas: HTMLCanvasElement): Promise<void>;
  loadDocument(...args: Parameters<BrowserKyxosViewportAdapter['loadDocument']>): Promise<void>;
  applyPatch(...args: Parameters<BrowserKyxosViewportAdapter['applyPatch']>): Promise<void>;
  select(nodeIds: string[]): void;
  setTool(tool: EditorTool): void;
  setCoordinateSpace(space: CoordinateSpace): void;
  setSnap(settings: SnapSettings): void;
  dispose(): void;
  __kyxosTransformControlsParityInstalled?: boolean;
}

interface TransformBridge {
  viewer: EditorViewer;
  canvas: HTMLCanvasElement;
  originalPointerDown: (event: PointerEvent) => void;
  guardedPointerDown: (event: PointerEvent) => void;
  onChange: (event: Event) => void;
  onStart: (event: Event) => void;
  onEnd: (event: Event) => void;
}

const bridges = new WeakMap<BrowserKyxosViewportAdapter, TransformBridge>();

function internals(adapter: BrowserKyxosViewportAdapter): AdapterInternals {
  return adapter as unknown as AdapterInternals;
}

function disconnect(adapter: BrowserKyxosViewportAdapter): void {
  const bridge = bridges.get(adapter);
  if (!bridge) return;
  bridge.viewer.removeEventListener('editor-transform-change', bridge.onChange);
  bridge.viewer.removeEventListener('editor-transform-start', bridge.onStart);
  bridge.viewer.removeEventListener('editor-transform-end', bridge.onEnd);
  bridge.canvas.removeEventListener('pointerdown', bridge.guardedPointerDown);
  bridge.canvas.addEventListener('pointerdown', bridge.originalPointerDown);
  bridge.viewer.disposeEditorTransformControls();
  bridges.delete(adapter);
}

function connect(adapter: BrowserKyxosViewportAdapter): void {
  disconnect(adapter);
  const internal = internals(adapter);
  const viewer = internal.viewer;
  const canvas = internal.canvas;
  if (!viewer || !canvas) return;

  // Remove the original screen-centered HTML prototype. The official Three.js
  // TransformControls helper is rendered at the selected object's real pivot.
  internal.gizmo?.remove();
  internal.gizmo = null;

  const onChange = (event: Event) => {
    adapter.dispatchEvent(
      new CustomEvent('transform-change', {
        detail: (event as CustomEvent).detail,
      }),
    );
  };
  const onStart = (event: Event) => {
    adapter.dispatchEvent(
      new CustomEvent('transform-start', {
        detail: (event as CustomEvent).detail,
      }),
    );
  };
  const onEnd = (event: Event) => {
    adapter.dispatchEvent(
      new CustomEvent('transform-end', {
        detail: (event as CustomEvent).detail,
      }),
    );
  };

  // TransformControls registers on the same canvas as the Adapter picker. Put
  // the editor picker after the official controls and suppress selection changes
  // while a transform axis is hot, otherwise clicking X/Y/Z would clear the
  // selection before the drag begins.
  const originalPointerDown = internal.onCanvasPointerDown;
  canvas.removeEventListener('pointerdown', originalPointerDown);
  viewer.createEditorTransformControls();
  const guardedPointerDown = (event: PointerEvent) => {
    const axis = viewer.canvas.dataset.editorAxis;
    if (internal.tool !== 'select' && axis) return;
    originalPointerDown(event);
  };
  canvas.addEventListener('pointerdown', guardedPointerDown);

  viewer.addEventListener('editor-transform-change', onChange);
  viewer.addEventListener('editor-transform-start', onStart);
  viewer.addEventListener('editor-transform-end', onEnd);
  bridges.set(adapter, {
    viewer,
    canvas,
    originalPointerDown,
    guardedPointerDown,
    onChange,
    onStart,
    onEnd,
  });
}

export function installTransformControlsParity(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as unknown as AdapterPrototype;
  if (prototype.__kyxosTransformControlsParityInstalled) return;

  const originalMount = prototype.mount;
  const originalLoadDocument = prototype.loadDocument;
  const originalApplyPatch = prototype.applyPatch;
  const originalSelect = prototype.select;
  const originalSetTool = prototype.setTool;
  const originalSetCoordinateSpace = prototype.setCoordinateSpace;
  const originalSetSnap = prototype.setSnap;
  const originalDispose = prototype.dispose;

  prototype.mount = async function mountWithTransformControls(
    canvas: HTMLCanvasElement,
  ): Promise<void> {
    await originalMount.call(this, canvas);
    connect(this);
  };

  prototype.loadDocument = async function loadDocumentWithTransformControls(
    ...args: Parameters<BrowserKyxosViewportAdapter['loadDocument']>
  ): Promise<void> {
    await originalLoadDocument.apply(this, args);
    internals(this).viewer?.refreshEditorTransformControls();
  };

  prototype.applyPatch = async function applyPatchWithTransformControls(
    ...args: Parameters<BrowserKyxosViewportAdapter['applyPatch']>
  ): Promise<void> {
    await originalApplyPatch.apply(this, args);
    internals(this).viewer?.refreshEditorTransformControls();
  };

  prototype.select = function selectWithTransformControls(nodeIds: string[]): void {
    originalSelect.call(this, nodeIds);
    internals(this).viewer?.setEditorTransformSelection(nodeIds);
  };

  prototype.setTool = function setToolWithTransformControls(tool: EditorTool): void {
    originalSetTool.call(this, tool);
    internals(this).viewer?.setEditorTransformMode(tool);
  };

  prototype.setCoordinateSpace = function setSpaceWithTransformControls(
    space: CoordinateSpace,
  ): void {
    originalSetCoordinateSpace.call(this, space);
    internals(this).viewer?.setEditorTransformSpace(space);
  };

  prototype.setSnap = function setSnapWithTransformControls(
    settings: SnapSettings,
  ): void {
    originalSetSnap.call(this, settings);
    internals(this).viewer?.setEditorTransformSnap(settings);
  };

  prototype.dispose = function disposeWithTransformControls(): void {
    disconnect(this);
    originalDispose.call(this);
  };

  prototype.__kyxosTransformControlsParityInstalled = true;
}

installTransformControlsParity();
