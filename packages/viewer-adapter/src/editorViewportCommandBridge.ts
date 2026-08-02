import type { EditorViewPreset, KyxosViewer } from '@kyxos/viewer';

import { BrowserKyxosViewportAdapter } from './index';

export type EditorViewportCommand =
  | { command: 'view'; preset: EditorViewPreset }
  | { command: 'frame-all' };

interface AdapterInternals {
  viewer: KyxosViewer | null;
}

interface CommandBridgeState {
  canvas: HTMLCanvasElement;
  onCommand: EventListener;
}

const states = new WeakMap<BrowserKyxosViewportAdapter, CommandBridgeState>();
const installed = Symbol('kyxos.editorViewportCommandBridge.installed');

function internals(adapter: BrowserKyxosViewportAdapter): AdapterInternals {
  return adapter as unknown as AdapterInternals;
}

export function installEditorViewportCommandBridge(): void {
  const prototype = BrowserKyxosViewportAdapter.prototype as unknown as {
    mount: BrowserKyxosViewportAdapter['mount'];
    dispose: BrowserKyxosViewportAdapter['dispose'];
    [installed]?: boolean;
  };
  if (prototype[installed]) return;

  const originalMount = prototype.mount;
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
      if (command.command === 'view') viewer.setEditorViewPreset(command.preset);
      else if (command.command === 'frame-all') viewer.frameAllEditorContent();
    };
    canvas.addEventListener('kyxos:editor-viewport-command', onCommand);
    states.set(this, { canvas, onCommand });
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
