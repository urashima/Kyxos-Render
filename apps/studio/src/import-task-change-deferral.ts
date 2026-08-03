import { ImportTaskQueue } from '@kyxos/editor-core';

type Listener = EventListenerOrEventListenerObject;
type ListenerOptions = boolean | AddEventListenerOptions | undefined;

type QueuePrototype = {
  addEventListener(type: string, listener: Listener | null, options?: ListenerOptions): void;
  removeEventListener(type: string, listener: Listener | null, options?: boolean | EventListenerOptions): void;
  __kyxosDeferredChangeListeners?: boolean;
};

interface DeferredListenerState {
  pending: boolean;
  event: Event | null;
  timer: number | null;
}

const wrappers = new WeakMap<Listener, EventListener>();
const states = new WeakMap<EventTarget, WeakMap<Listener, DeferredListenerState>>();

function invoke(listener: Listener, target: EventTarget, event: Event): void {
  if (typeof listener === 'function') listener.call(target, event);
  else listener.handleEvent(event);
}

function stateFor(target: EventTarget, listener: Listener): DeferredListenerState {
  let byListener = states.get(target);
  if (!byListener) {
    byListener = new WeakMap();
    states.set(target, byListener);
  }
  let state = byListener.get(listener);
  if (!state) {
    state = { pending: false, event: null, timer: null };
    byListener.set(listener, state);
  }
  return state;
}

/**
 * ImportTaskQueue emits synchronously for every progress transition. Studio's
 * listener rebuilds the full Asset Workspace, so the final `complete` event was
 * executed in the same stack that resolved the durable GLB transaction. On
 * Chromium/SwiftShader this could starve DevTools/UI reads even though parsing,
 * Scene Contract construction and Viewer activation had all completed.
 *
 * Browser listeners are coalesced onto a later task. Core editor tests and
 * non-browser consumers retain the original synchronous EventTarget behavior.
 */
export function installImportTaskChangeDeferral(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const prototype = ImportTaskQueue.prototype as unknown as QueuePrototype;
  if (prototype.__kyxosDeferredChangeListeners) return;

  const originalAdd = prototype.addEventListener;
  const originalRemove = prototype.removeEventListener;

  prototype.addEventListener = function addDeferredListener(
    type,
    listener,
    options,
  ): void {
    if (type !== 'change' || !listener) {
      originalAdd.call(this, type, listener, options);
      return;
    }

    let wrapped = wrappers.get(listener);
    if (!wrapped) {
      wrapped = (event: Event) => {
        const target = event.currentTarget ?? this as unknown as EventTarget;
        const state = stateFor(target, listener);
        state.event = event;
        if (state.pending) return;
        state.pending = true;
        document.documentElement.dataset.importTaskUi = 'deferred';
        console.info('[studio-import] task-change · deferred');
        state.timer = window.setTimeout(() => {
          state.pending = false;
          state.timer = null;
          const latest = state.event;
          state.event = null;
          if (!latest) return;
          document.documentElement.dataset.importTaskUi = 'rendering';
          console.info('[studio-import] task-change-listener · start');
          try {
            invoke(listener, target, latest);
            document.documentElement.dataset.importTaskUi = 'complete';
            console.info('[studio-import] task-change-listener · complete');
          } catch (error) {
            document.documentElement.dataset.importTaskUi = 'failed';
            console.error('[studio-import] task-change-listener · failed', error);
            throw error;
          }
        }, 100);
      };
      wrappers.set(listener, wrapped);
    }
    originalAdd.call(this, type, wrapped, options);
  };

  prototype.removeEventListener = function removeDeferredListener(
    type,
    listener,
    options,
  ): void {
    originalRemove.call(
      this,
      type,
      listener && type === 'change' ? wrappers.get(listener) ?? listener : listener,
      options,
    );
  };

  prototype.__kyxosDeferredChangeListeners = true;
}

installImportTaskChangeDeferral();
