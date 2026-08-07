import { ImportTaskQueue } from '@kyxos/editor-core';

const installed = Symbol.for('kyxos.importTaskChangeDeferral.installed');

type QueuePrototype = Record<symbol, boolean | undefined>;

/**
 * Legacy compatibility shim.
 *
 * ImportTaskQueue change events are part of the editor lifecycle contract and
 * must remain synchronous. The former implementation monkey-patched
 * addEventListener/removeEventListener and replayed Event objects 100 ms later;
 * that made UI completion, task state and the authoritative worker resolution
 * observable on different clocks. It also left stored Event.currentTarget state
 * detached from the original dispatch.
 *
 * Rendering/virtualization layers may debounce their own expensive work, but
 * the queue itself now retains normal EventTarget semantics.
 */
export function installImportTaskChangeDeferral(): void {
  const prototype = ImportTaskQueue.prototype as unknown as QueuePrototype;
  if (prototype[installed]) return;
  prototype[installed] = true;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.importTaskUi = 'synchronous';
  }
}

installImportTaskChangeDeferral();
