import './gltf-node-inspector-bootstrap';
import { createGlbImportReport } from './glb-report';

export interface GlbWorkerResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
}

export interface GlbWorkerLifecycleDetail {
  stage:
    | 'created'
    | 'posted'
    | 'fallback'
    | 'complete'
    | 'failed'
    | 'message-error'
    | 'timeout'
    | 'cancelled';
  fileName: string;
  error?: string;
}

export interface ParseGlbInWorkerOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fallbackDelayMs?: number;
  workerFactory?: () => Worker;
}

interface GlbWorkerGlobal {
  __kyxosLastGlbImportReport?: unknown;
}

function emitLifecycle(detail: GlbWorkerLifecycleDetail): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.glbWorkerStage = detail.stage;
    document.dispatchEvent(
      new CustomEvent<GlbWorkerLifecycleDetail>('kyxos:glb-worker-lifecycle', {
        detail,
      }),
    );
  }
  const suffix = detail.error ? ` · ${detail.error}` : '';
  console.info(`[glb-worker] ${detail.stage} · ${detail.fileName}${suffix}`);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('GLB parsing was cancelled.', 'AbortError');
}

function rememberReport<T>(result: T): T {
  (globalThis as typeof globalThis & GlbWorkerGlobal).__kyxosLastGlbImportReport = result;
  return result;
}

export async function parseGlbInWorker<T = unknown>(
  file: File,
  options: ParseGlbInWorkerOptions = {},
): Promise<T> {
  const {
    signal,
    timeoutMs = 30_000,
    fallbackDelayMs = 1_200,
  } = options;
  if (signal?.aborted) throw abortError(signal);

  // Keep the original bytes available for the deterministic fallback. A
  // separate copy is transferred to the Worker so postMessage cannot detach
  // the only ArrayBuffer owned by the import transaction.
  const buffer = await file.arrayBuffer();
  if (signal?.aborted) throw abortError(signal);

  const parseLocally = (reason?: unknown): T => {
    if (signal?.aborted) throw abortError(signal);
    emitLifecycle({
      stage: 'fallback',
      fileName: file.name,
      error: reason instanceof Error ? reason.message : reason == null ? undefined : String(reason),
    });
    return rememberReport(createGlbImportReport(buffer, file.name) as T);
  };

  let worker: Worker;
  try {
    worker = options.workerFactory?.() ?? new Worker(
      new URL('./importWorker.ts', import.meta.url),
      { type: 'module' },
    );
  } catch (error) {
    return parseLocally(error);
  }
  emitLifecycle({ stage: 'created', fileName: file.name });

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let fallbackStarted = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let fallbackId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (fallbackId !== undefined) clearTimeout(fallbackId);
      worker.removeEventListener('message', onMessage as EventListener);
      worker.removeEventListener('messageerror', onMessageError);
      worker.removeEventListener('error', onWorkerError);
      signal?.removeEventListener('abort', onAbort);
      queueMicrotask(() => worker.terminate());
    };

    const settle = (
      stage: GlbWorkerLifecycleDetail['stage'],
      callback: () => void,
      error?: unknown,
    ): void => {
      if (settled) return;
      settled = true;
      emitLifecycle({
        stage,
        fileName: file.name,
        error: error instanceof Error ? error.message : error == null ? undefined : String(error),
      });
      callback();
      cleanup();
    };

    const complete = (result: T): void => {
      rememberReport(result);
      settle('complete', () => resolve(result));
    };

    const runFallback = (reason?: unknown): void => {
      if (settled || fallbackStarted) return;
      fallbackStarted = true;
      try {
        complete(parseLocally(reason));
      } catch (error) {
        const stage = signal?.aborted ? 'cancelled' : 'failed';
        settle(stage, () => reject(error), error);
      }
    };

    const onMessage = (event: MessageEvent<GlbWorkerResponse<T>>): void => {
      const response = event.data;
      if (response?.ok && response.result !== undefined) {
        complete(response.result as T);
        return;
      }
      runFallback(new Error(response?.error || 'GLB parser worker returned no result.'));
    };

    const onMessageError = (): void => {
      runFallback(new Error('GLB parser result could not be cloned.'));
    };

    const onWorkerError = (event: ErrorEvent): void => {
      runFallback(new Error(event.message || 'GLB parser worker failed.'));
    };

    const onAbort = (): void => {
      const error = abortError(signal!);
      settle('cancelled', () => reject(error), error);
    };

    worker.addEventListener('message', onMessage as EventListener);
    worker.addEventListener('messageerror', onMessageError);
    worker.addEventListener('error', onWorkerError);
    signal?.addEventListener('abort', onAbort, { once: true });

    const boundedFallbackDelay = Math.max(0, Math.min(fallbackDelayMs, timeoutMs));
    fallbackId = setTimeout(() => {
      runFallback(
        new Error(`GLB parser worker did not respond within ${boundedFallbackDelay} ms.`),
      );
    }, boundedFallbackDelay);
    timeoutId = setTimeout(() => {
      if (settled) return;
      const error = new Error(`GLB parsing timed out after ${timeoutMs} ms.`);
      if (!fallbackStarted) runFallback(error);
      else settle('timeout', () => reject(error), error);
    }, timeoutMs);

    try {
      const workerBuffer = buffer.slice(0);
      worker.postMessage({ name: file.name, buffer: workerBuffer }, [workerBuffer]);
      emitLifecycle({ stage: 'posted', fileName: file.name });
    } catch (error) {
      runFallback(error);
    }
  });
}
