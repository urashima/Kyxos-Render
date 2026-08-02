import type { ImportTaskContext, ImportTaskStage } from '@kyxos/editor-core';

export interface ImportJobStep<TState> {
  /** Stable machine-readable step name used in diagnostics. */
  id: string;
  /** Queue stage surfaced to the Studio task strip. */
  stage: Exclude<ImportTaskStage, 'queued' | 'complete' | 'failed' | 'cancelled'>;
  /** Monotonic progress value reported before this step starts. */
  progress: number;
  /**
   * Viewport activation and other consumer refreshes are post-processing. They
   * start in order but do not control whether the imported asset is ready.
   */
  completion?: 'core' | 'postprocess';
  run(state: TState, signal: AbortSignal): Promise<void> | void;
}

export interface ImportPostprocessOptions {
  label: string;
  run(): Promise<void> | void;
  onWarning(label: string, error: unknown): void;
}

export interface ImportPostprocessFailureDetail {
  label: string;
  error: unknown;
}

export function throwIfImportAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Asset import was cancelled.', 'AbortError');
}

function reportPostprocessFailure(label: string, error: unknown): void {
  console.warn(`[studio-import] Optional post-processing failed: ${label}`, error);
  if (typeof document === 'undefined') return;
  document.dispatchEvent(
    new CustomEvent<ImportPostprocessFailureDetail>(
      'kyxos:studio-import-postprocess-error',
      { detail: { label, error } },
    ),
  );
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

    if (step.completion === 'postprocess' || step.id.startsWith('activate-')) {
      scheduleImportPostprocess({
        label: step.id,
        run: () => step.run(state, context.signal),
        onWarning: reportPostprocessFailure,
      });
      continue;
    }

    await step.run(state, context.signal);
    throwIfImportAborted(context.signal);
  }
  return state;
}

/**
 * Optional work such as viewport activation, thumbnails and draft flushing
 * must never keep an asset task in uploading/building. Schedule it after the
 * core job resolves and report failures independently instead of rejecting the
 * import promise.
 */
export function scheduleImportPostprocess(
  options: ImportPostprocessOptions,
): void {
  const schedule = typeof window === 'undefined'
    ? (callback: () => void) => setTimeout(callback, 0)
    : (callback: () => void) => window.setTimeout(callback, 0);
  schedule(() => {
    Promise.resolve()
      .then(() => options.run())
      .catch((error) => options.onWarning(options.label, error));
  });
}
