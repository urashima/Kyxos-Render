const installed = Symbol.for('kyxos.workspaceImportSaveGuard.installed');

type GuardGlobal = typeof globalThis & { [installed]?: boolean };

/**
 * Legacy compatibility shim.
 *
 * This module previously replaced window.setTimeout globally and converted any
 * 650 ms timer created during an import into a five-minute timer. That was able
 * to defer unrelated editor controls, source workspace work, autosave feedback,
 * thumbnail scheduling and test-visible lifecycle updates simply because they
 * happened to use the same delay value.
 *
 * Import durability is now owned by the explicit GLB import lifecycle. There is
 * deliberately no browser-global timing override here; callers importing this
 * historical module remain source-compatible while Studio uses native timers.
 */
export function installWorkspaceImportSaveGuard(): void {
  if (typeof globalThis === 'undefined') return;
  const runtime = globalThis as GuardGlobal;
  if (runtime[installed]) return;
  runtime[installed] = true;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.workspaceImportSaveGuard = 'native-timers';
  }
}

installWorkspaceImportSaveGuard();
