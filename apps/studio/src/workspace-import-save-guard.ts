const installed = Symbol.for('kyxos.workspaceImportSaveGuard.installed');
const WORKSPACE_SAVE_DELAY_MS = 650;
const IMPORT_FALLBACK_DELAY_MS = 5 * 60_000;
const importStages = new Set(['queued', 'hashing', 'uploading', 'parsing', 'building']);

type GuardGlobal = typeof globalThis & { [installed]?: boolean };

function importTransactionActive(): boolean {
  if (typeof document === 'undefined') return false;
  return importStages.has(document.documentElement.dataset.importLifecycleStage ?? '');
}

/**
 * SceneWorkspaceService mirrors every active SceneDocument change and Studio
 * schedules a full ProjectWorkspace persistence 650ms later. During GLB import
 * that snapshot duplicates the newly parsed scene, material report and editor
 * state into the local acceptance provider in one synchronous JSON operation.
 * Chromium/SwiftShader can remain unresponsive before the completion UI paints.
 *
 * Keep `workspaceDirty` semantics intact by allowing scheduleWorkspaceSave to
 * run, but postpone only its import-time 650ms timer. A subsequent edit clears
 * this timer and saves normally; project navigation/pagehide calls flushWorkspace
 * directly, so imported scenes are still persisted when the user leaves.
 */
export function installWorkspaceImportSaveGuard(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const runtime = globalThis as GuardGlobal;
  if (runtime[installed]) return;

  const nativeSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = ((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ): number => {
    if (
      timeout === WORKSPACE_SAVE_DELAY_MS
      && typeof handler === 'function'
      && importTransactionActive()
    ) {
      document.documentElement.dataset.workspaceImportSave = 'deferred';
      console.info('[studio-import] workspace-save · deferred-until-edit-or-exit');
      return nativeSetTimeout(handler, IMPORT_FALLBACK_DELAY_MS, ...args);
    }
    return nativeSetTimeout(handler, timeout, ...args);
  }) as typeof window.setTimeout;

  runtime[installed] = true;
}

installWorkspaceImportSaveGuard();
