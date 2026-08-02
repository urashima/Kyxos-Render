import type { ImportTaskContext, ImportTaskStage } from '@kyxos/editor-core';

export interface ImportJobStep<TState> {
  /** Stable machine-readable step name used in diagnostics. */
  id: string;
  /** Queue stage surfaced to the Studio task strip. */
  stage: Exclude<ImportTaskStage, 'queued' | 'complete' | 'failed' | 'cancelled'>;
  /** Monotonic progress value reported before this step starts. */
  progress: number;
  run(state: TState, signal: AbortSignal): Promise<void> | void;
}

export interface ImportPostprocessOptions {
  label: string;
  run(): Promise<void> | void;
  onWarning(label: string, error: unknown): void;
}

export function throwIfImportAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Asset import was cancelled.', 'AbortError');
}

/**
 * Execute an import as an explicit, observable job pipeline. This mirrors the
 * PlayCanvas Editor asset job model: each durable phase reports state, honours
 * cancellation, and only core asset availability controls task completion.
 */
export async function runImportJob<TState>(
  context: ImportTaskContext,
  state: TState,
  steps: readonly ImportJobStep<TState>[],
): Promise<TState> {
  let lastProgress = 0;
  for (const step of steps) {
    throwIfImportAborted(context.signal);
    const progress = Math.max(lastProgress, Math.min(0.99, step.progress));
    context.report(step.stage, progress);
    lastProgress = progress;
    await step.run(state, context.signal);
    throwIfImportAborted(context.signal);
  }
  return state;
}

/**
 * Optional work such as thumbnails and draft flushing must never keep an asset
 * task in uploading/building. Schedule it after the core job resolves and
 * report failures independently instead of rejecting the import promise.
 */
export function scheduleImportPostprocess(
  options: ImportPostprocessOptions,
): void {
  window.setTimeout(() => {
    Promise.resolve()
      .then(() => options.run())
      .catch((error) => options.onWarning(options.label, error));
  }, 0);
}
