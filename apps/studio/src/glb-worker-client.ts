import './gltf-node-inspector-bootstrap';

export interface GlbWorkerResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
}

export interface GlbWorkerLifecycleDetail {
  stage:
    | 'created'
    | 'posted'
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

export async function parseGlbInWorker<T = unknown>(
  file: File,
  options: ParseGlbInWorkerOptions = {},
): Promise<T> {
  const { signal, timeoutMs = 30_000 } = options;
  if (signal?.aborted) throw abortError(signal);

  const buffer = await file.arrayBuffer();
  if (signal?.aborted) throw abortError(signal);

  const worker = options.workerFactory?.() ?? new Worker(
    new URL('./importWorker.ts', import.meta.url),
    { type: 'module' },
  );
  emitLifecycle({ stage: 'created', fileName: file.name });

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timeout = 0;

    const cleanup = (): void => {
      if (timeout) window.clearTimeout(timeout);
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

    const onMessage = (event: MessageEvent<GlbWorkerResponse<T>>): void => {
      const response = event.data;
      if (response?.ok && response.result !== undefined) {
        (globalThis as typeof globalThis & GlbWorkerGlobal).__kyxosLastGlbImportReport = response.result;
        settle('complete', () => resolve(response.result as T));
        return;
      }
      const error = new Error(response?.error || 'GLB parser worker returned no result.');
      settle('failed', () => reject(error), error);
    };

    const onMessageError = (): void => {
      const error = new Error('GLB parser result could not be cloned.');
      settle('message-error', () => reject(error), error);
    };

    const onWorkerError = (event: ErrorEvent): void => {
      const error = new Error(event.message || 'GLB parser worker failed.');
      settle('failed', () => reject(error), error);
    };

    const onAbort = (): void => {
      const error = abortError(signal!);
      settle('cancelled', () => reject(error), error);
    };

    worker.addEventListener('message', onMessage as EventListener);
    worker.addEventListener('messageerror', onMessageError);
    worker.addEventListener('error', onWorkerError);
    signal?.addEventListener('abort', onAbort, { once: true });

    timeout = window.setTimeout(() => {
      const error = new Error(`GLB parsing timed out after ${timeoutMs} ms.`);
      settle('timeout', () => reject(error), error);
    }, timeoutMs);

    try {
      worker.postMessage({ name: file.name, buffer }, [buffer]);
      emitLifecycle({ stage: 'posted', fileName: file.name });
    } catch (error) {
      settle('failed', () => reject(error), error);
    }
  });
}
