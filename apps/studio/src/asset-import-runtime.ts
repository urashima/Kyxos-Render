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

export interface ImportStepLifecycleDetail {
  id: string;
  stage: ImportTaskStage | 'core-complete';
  state: 'start' | 'complete' | 'scheduled' | 'failed';
  progress: number;
  aborted: boolean;
  error?: string;
}

interface ImportCompletionReport {
  warnings?: unknown[];
  nodes?: unknown[];
  materials?: unknown[];
  animations?: unknown[];
}

interface ImportCompletionState {
  report?: ImportCompletionReport | null;
}

export function throwIfImportAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Asset import was cancelled.', 'AbortError');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deferredDispatch<T>(name: string, detail: T): void {
  if (typeof document === 'undefined') return;
  const dispatch = () => document.dispatchEvent(new CustomEvent<T>(name, { detail }));
  if (typeof window === 'undefined') setTimeout(dispatch, 0);
  else window.setTimeout(dispatch, 0);
}

function reportImportStep(detail: ImportStepLifecycleDetail): void {
  const suffix = detail.error ? ` · ${detail.error}` : '';
  console.info(
    `[studio-import] ${detail.id} · ${detail.state} · ${detail.stage} · ${detail.progress}${suffix}`,
  );
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.importStep = detail.id;
  document.documentElement.dataset.importStepState = detail.state;
  document.documentElement.dataset.importStepStage = detail.stage;
  document.documentElement.dataset.importStepProgress = String(detail.progress);
  document.documentElement.dataset.importStepAborted = String(detail.aborted);
  // Lifecycle consumers are optional observers. Never run them synchronously
  // inside the core asset transaction because a panel/plugin listener must not
  // prevent the import promise from resolving.
  deferredDispatch('kyxos:studio-import-step', detail);
}

function reportPostprocessFailure(label: string, error: unknown): void {
  console.warn(`[studio-import] Optional post-processing failed: ${label}`, error);
  deferredDispatch<ImportPostprocessFailureDetail>(
    'kyxos:studio-import-postprocess-error',
    { label, error },
  );
}

function completionMessage(state: unknown): string {
  if (!state || typeof state !== 'object') return 'Import complete';
  const report = (state as ImportCompletionState).report;
  if (!report || typeof report !== 'object') return 'Import complete';

  const warnings = Array.isArray(report.warnings)
    ? report.warnings.map(String).filter(Boolean)
    : [];
  if (warnings.length) return `Import complete · ${warnings.join(' · ')}`;

  const nodes = Array.isArray(report.nodes) ? report.nodes.length : 0;
  const materials = Array.isArray(report.materials) ? report.materials.length : 0;
  const animations = Array.isArray(report.animations) ? report.animations.length : 0;
  return `Import complete · ${nodes} nodes · ${materials} materials · ${animations} animations`;
}

/**
 * Commit the durable core completion status before any optional Console,
 * plugin, renderer, thumbnail or autosave observer can run. This follows the
 * PlayCanvas asset-job model: the task itself owns readiness; UI consumers only
 * reflect it and cannot keep the task stuck in uploading/building.
 */
function commitCoreImportCompletion(state: unknown): void {
  if (typeof document === 'undefined') return;
  const message = completionMessage(state);
  document.documentElement.dataset.importCoreComplete = 'true';
  document.documentElement.dataset.importCompleteMessage = message;
  const notice = document.querySelector<HTMLElement>('.viewport-overlay');
  if (!notice) return;
  const text = document.createElement('span');
  text.textContent = message;
  notice.replaceChildren(text);
  notice.classList.remove('error-notice');
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
    const postprocess = step.completion === 'postprocess' || step.id.startsWith('activate-');
    reportImportStep({
      id: step.id,
      stage: step.stage,
      state: 'start',
      progress,
      aborted: context.signal.aborted,
    });

    try {
      context.report(step.stage, progress);
      lastProgress = progress;

      if (postprocess) {
        scheduleImportPostprocess({
          label: step.id,
          run: async () => {
            await step.run(state, context.signal);
            reportImportStep({
              id: step.id,
              stage: step.stage,
              state: 'complete',
              progress,
              aborted: context.signal.aborted,
            });
          },
          onWarning(label, error) {
            reportImportStep({
              id: label,
              stage: step.stage,
              state: 'failed',
              progress,
              aborted: context.signal.aborted,
              error: errorMessage(error),
            });
            reportPostprocessFailure(label, error);
          },
        });
        reportImportStep({
          id: step.id,
          stage: step.stage,
          state: 'scheduled',
          progress,
          aborted: context.signal.aborted,
        });
        continue;
      }

      await step.run(state, context.signal);
      throwIfImportAborted(context.signal);
      reportImportStep({
        id: step.id,
        stage: step.stage,
        state: 'complete',
        progress,
        aborted: context.signal.aborted,
      });
    } catch (error) {
      reportImportStep({
        id: step.id,
        stage: step.stage,
        state: 'failed',
        progress,
        aborted: context.signal.aborted,
        error: errorMessage(error),
      });
      throw error;
    }
  }

  commitCoreImportCompletion(state);
  reportImportStep({
    id: 'core-import',
    stage: 'core-complete',
    state: 'complete',
    progress: 1,
    aborted: context.signal.aborted,
  });
  console.info('[studio-import] core-import · return');
  return state;
}

/**
 * Optional work such as viewport activation, thumbnails and draft flushing
 * must never keep an asset task in uploading/building. Schedule it after the
 * core job resolves and report failures independently instead of rejecting the
 * import promise. One frame of delay lets the hierarchy, asset list and task
 * status commit before renderer readback or scene activation starts.
 */
export function scheduleImportPostprocess(
  options: ImportPostprocessOptions,
): void {
  const delayMs = typeof window === 'undefined' ? 0 : 16;
  const schedule = typeof window === 'undefined'
    ? (callback: () => void) => setTimeout(callback, delayMs)
    : (callback: () => void) => window.setTimeout(callback, delayMs);
  schedule(() => {
    Promise.resolve()
      .then(() => options.run())
      .catch((error) => options.onWarning(options.label, error));
  });
}
