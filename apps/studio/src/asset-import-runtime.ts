import type { ImportTaskContext, ImportTaskStage } from '@kyxos/editor-core';

export interface ImportJobStep<TState> {
  id: string;
  stage: Exclude<ImportTaskStage, 'queued' | 'complete' | 'failed' | 'cancelled'>;
  progress: number;
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

function clearCoreImportCompletion(): void {
  if (typeof document === 'undefined') return;
  delete document.documentElement.dataset.importCoreComplete;
  delete document.documentElement.dataset.importCompleteMessage;
  delete document.documentElement.dataset.importCompletedAt;
}

function commitCoreImportCompletion(state: unknown): void {
  if (typeof document === 'undefined') return;
  const message = completionMessage(state);
  document.documentElement.dataset.importCoreComplete = 'true';
  document.documentElement.dataset.importCompleteMessage = message;
  document.documentElement.dataset.importCompletedAt = String(Date.now());
  for (const notice of document.querySelectorAll<HTMLElement>('.viewport-overlay')) {
    const text = document.createElement('span');
    text.textContent = message;
    notice.replaceChildren(text);
    notice.classList.remove('error-notice');
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') setTimeout(resolve, 0);
    else window.setTimeout(resolve, 0);
  });
}

export async function runImportJob<TState>(
  context: ImportTaskContext,
  state: TState,
  steps: readonly ImportJobStep<TState>[],
): Promise<void> {
  clearCoreImportCompletion();
  let lastProgress = 0;
  for (const step of steps) {
    throwIfImportAborted(context.signal);
    const progress = Math.max(lastProgress, Math.min(0.99, step.progress));
    const postprocess = step.completion === 'postprocess';
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

  // Let the browser commit the imported hierarchy, asset cards and completion
  // marker before returning to ImportTaskQueue. This keeps the durable import
  // transaction observable even when optional work or the renderer is slow.
  await yieldToBrowser();
  console.info('[studio-import] core-import · return-void');
}

function scheduleAfterPaint(callback: () => void): void {
  if (typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') {
    setTimeout(callback, 0);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(callback, 0)));
}

export function scheduleImportPostprocess(
  options: ImportPostprocessOptions,
): void {
  scheduleAfterPaint(() => {
    // Import thumbnails are decorative. Even with GPU readback bypassed,
    // createImageBitmap/canvas WebP encoding can synchronously lock software
    // Chromium and low-end devices after a successful GLB activation. Defer the
    // thumbnail until a dedicated worker/offscreen implementation is available;
    // never block the imported model, hierarchy, materials or animations.
    if (options.label.startsWith('thumbnail:')) {
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.importThumbnailFallback = 'deferred';
      }
      console.info(`[studio-import] ${options.label} · deferred-fallback`);
      return;
    }

    Promise.resolve()
      .then(() => options.run())
      .catch((error) => options.onWarning(options.label, error));
  });
}
