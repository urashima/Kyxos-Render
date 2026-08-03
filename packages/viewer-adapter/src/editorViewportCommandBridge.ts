import type {
  EditorCameraBookmarkState,
  EditorRenderMode,
  EditorViewPreset,
  KyxosViewer,
} from '@kyxos/viewer';

import { BrowserKyxosViewportAdapter } from './index';

export type EditorViewportCommand =
  | { command: 'view'; preset: EditorViewPreset }
  | { command: 'frame-all' }
  | { command: 'render-mode'; mode: EditorRenderMode }
  | { command: 'capture-bookmark'; requestId: string }
  | {
      command: 'restore-bookmark';
      state: EditorCameraBookmarkState;
      slot?: number;
    };

export interface EditorCameraBookmarkResponse {
  requestId: string;
  state: EditorCameraBookmarkState;
}

interface AdapterInternals {
  viewer: KyxosViewer | null;
}

interface CommandBridgeState {
  canvas: HTMLCanvasElement;
  onCommand: EventListener;
}

const states = new WeakMap<BrowserKyxosViewportAdapter, CommandBridgeState>();
const installed = Symbol('kyxos.editorViewportCommandBridge.installed');
const renderModes = new Set<EditorRenderMode>([
  'shaded',
  'wireframe',
  'albedo',
  'normals',
  'ambientOcclusion',
  'emission',
  'depth',
  'metalness',
  'roughness',
  'velocity',
  'uv',
]);

function internals(adapter: BrowserKyxosViewportAdapter): AdapterInternals {
  return adapter as unknown as AdapterInternals;
}

function normalizeRenderMode(value: unknown): EditorRenderMode {
  return typeof value === 'string' && renderModes.has(value as EditorRenderMode)
    ? value as EditorRenderMode
    : 'shaded';
}

function applyRenderMode(
  viewer: KyxosViewer,
  canvas: HTMLCanvasElement,
  mode: EditorRenderMode,
): void {
  viewer.setEditorRenderMode(mode);
  canvas.dispatchEvent(new CustomEvent('kyxos:editor-render-mode-change', {
    detail: { mode },
  }));
}

export function installEditorViewportCommandBridge(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as unknown as {
    mount: BrowserKyxosViewportAdapter['mount'];
    loadDocument: BrowserKyxosViewportAdapter['loadDocument'];
    dispose: BrowserKyxosViewportAdapter['dispose'];
    [installed]?: boolean;
  };
  if (prototype[installed]) return;

  const originalMount = prototype.mount;
  const originalLoadDocument = prototype.loadDocument;
  const originalDispose = prototype.dispose;

  prototype.mount = async function mountWithViewportCommands(
    this: BrowserKyxosViewportAdapter,
    canvas: HTMLCanvasElement,
  ): Promise<void> {
    await originalMount.call(this, canvas);
    const onCommand: EventListener = (event) => {
      const command = (event as CustomEvent<EditorViewportCommand>).detail;
      const viewer = internals(this).viewer;
      if (!viewer || !command) return;
      if (command.command === 'view') {
        viewer.setEditorViewPreset(command.preset);
      } else if (command.command === 'frame-all') {
        viewer.frameAllEditorContent();
      } else if (command.command === 'render-mode') {
        applyRenderMode(viewer, canvas, normalizeRenderMode(command.mode));
      } else if (command.command === 'capture-bookmark') {
        canvas.dispatchEvent(
          new CustomEvent<EditorCameraBookmarkResponse>(
            'kyxos:editor-camera-bookmark-state',
            {
              detail: {
                requestId: command.requestId,
                state: viewer.captureEditorCameraBookmark(),
              },
            },
          ),
        );
      } else if (command.command === 'restore-bookmark') {
        viewer.restoreEditorCameraBookmark(command.state, command.slot);
      }
    };
    canvas.addEventListener('kyxos:editor-viewport-command', onCommand);
    states.set(this, { canvas, onCommand });
  };

  prototype.loadDocument = async function loadDocumentWithEditorRenderMode(
    this: BrowserKyxosViewportAdapter,
    document,
  ): Promise<void> {
    await originalLoadDocument.call(this, document);
    const viewer = internals(this).viewer;
    const state = states.get(this);
    if (!viewer || !state) return;
    const editorState = document.value.editorState as
      | { viewportRenderMode?: unknown }
      | undefined;
    applyRenderMode(
      viewer,
      state.canvas,
      normalizeRenderMode(editorState?.viewportRenderMode),
    );
  };

  prototype.dispose = function disposeViewportCommands(
    this: BrowserKyxosViewportAdapter,
  ): void {
    const state = states.get(this);
    if (state) {
      state.canvas.removeEventListener('kyxos:editor-viewport-command', state.onCommand);
      states.delete(this);
    }
    originalDispose.call(this);
  };

  prototype[installed] = true;
}
