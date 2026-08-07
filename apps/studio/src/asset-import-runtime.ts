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

const DURABILITY_SLOW_MS = 15_000;
const MOBILE_MEMORY_YIELD_STEPS = new Set([
  'hash-source',
  'upload-source',
  'register-source',
  'parse-source',
]);

function isConstrainedMobileImport(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ipadDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || ipadDesktopMode;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches === true;
  const narrow = Math.min(
    window.screen.width || window.innerWidth,
    window.screen.height || window.innerHeight,
  ) <= 1024;
  return ios || (coarse && narrow && /Android|Mobile/i.test(navigator.userAgent));
}

async function yieldMobileImportMemory(stepId: string): Promise<void> {
  if (!isConstrainedMobileImport() || !MOBILE_MEMORY_YIELD_STEPS.has(stepId)) return;
  if (typeof document !== 'undefined') {
    const previous = Number(document.documentElement.dataset.mobileImportMemoryYields ?? '0');
    document.documentElement.dataset.mobileImportMemoryYields = String(previous + 1);
    document.documentElement.dataset.mobileImportYieldAfter = stepId;
  }
  // A task boundary after full-file hashing / upload / parser work lets WebKit
  // release no-longer-referenced ArrayBuffers before the next heavyweight stage.
  // Do not yield after Viewer activation: once the render loop owns the freshly
  // uploaded scene, iOS/WebKit can indefinitely defer a zero-delay timer under
  // GPU pressure. Core completion must be committed synchronously after the
  // successful activation instead.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
  delete document.documentElement.dataset.importDurabilityState;
  delete document.documentElement.dataset.importDurabilityError;
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

function scheduleDurability<TState>(
  step: ImportJobStep<TState>,
  state: TState,
  signal: AbortSignal,
  progress: number,
): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.importDurabilityState = 'pending';
  }
  scheduleImportPostprocess({
    label: step.id,
    async run() {
      let slowTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        slowTimer = setTimeout(() => {
          if (typeof document !== 'undefined') {
            document.documentElement.dataset.importDurabilityState = 'slow';
          }
          console.warn(
            `[studio-import] ${step.id} is still saving after ${DURABILITY_SLOW_MS} ms; ` +
            'the editable scene remains available while durability finishes.',
          );
        }, DURABILITY_SLOW_MS);
        await step.run(state, signal);
        throwIfImportAborted(signal);
        if (typeof document !== 'undefined') {
          document.documentElement.dataset.importDurabilityState = 'saved';
          delete document.documentElement.dataset.importDurabilityError;
        }
        reportImportStep({
          id: step.id,
          stage: step.stage,
          state: 'complete',
          progress,
          aborted: signal.aborted,
        });
      } finally {
        if (slowTimer != null) clearTimeout(slowTimer);
      }
    },
    onWarning(label, error) {
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.importDurabilityState = 'error';
        document.documentElement.dataset.importDurabilityError = errorMessage(error);
      }
      reportImportStep({
        id: label,
        stage: step.stage,
        state: 'failed',
        progress,
        aborted: signal.aborted,
        error: errorMessage(error),
      });
      reportPostprocessFailure(label, error);
    },
  });
}

export async function runImportJob<TState>(
  context: ImportTaskContext,
  state: TState,
  steps: readonly ImportJobStep<TState>[],
): Promise<void> {
  clearCoreImportCompletion();
  const pendingPostprocess: Array<() => void> = [];
  let lastProgress = 0;

  for (const step of steps) {
    throwIfImportAborted(context.signal);
    const progress = Math.max(lastProgress, Math.min(0.99, step.progress));
    // Persist/recovery verification is durability, not scene activation. Never
    // make the editor's “Import complete” state depend on IndexedDB, cloud
    // revision verification or Blob recovery. Those are allowed to finish after
    // the model is already editable on every platform, not only on iOS.
    const durability = step.id === 'persist-import';
    const postprocess = step.completion === 'postprocess' || durability;
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
        pendingPostprocess.push(() => {
          if (durability) {
            scheduleDurability(step, state, context.signal, progress);
            return;
          }
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
      await yieldMobileImportMemory(step.id);
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

  // The Viewer scene and editor document are already committed. Resolve the
  // core import immediately. Durability and optional derived work are explicitly
  // finished in the background so a slow IndexedDB / remote verification tail
  // cannot hold the browser in a high-memory import state.
  pendingPostprocess.forEach((schedule) => schedule());
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
