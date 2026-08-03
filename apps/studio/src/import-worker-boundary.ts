import { ImportTaskQueue } from '@kyxos/editor-core';

type QueuePrototype = {
  enqueue(
    name: string,
    worker: (context: {
      signal: AbortSignal;
      report(stage: string, progress: number): void;
    }) => Promise<unknown>,
  ): string;
  __kyxosImportWorkerBoundaryInstalled?: boolean;
};

/** Trace the exact boundary between Studio's import worker and task completion. */
export function installImportWorkerBoundary(): void {
  if (typeof document === 'undefined') return;
  const prototype = ImportTaskQueue.prototype as unknown as QueuePrototype;
  if (prototype.__kyxosImportWorkerBoundaryInstalled) return;

  const originalEnqueue = prototype.enqueue;
  prototype.enqueue = function enqueueWithBoundary(name, worker): string {
    return originalEnqueue.call(this, name, async (context) => {
      document.documentElement.dataset.importWorkerBoundary = 'running';
      console.info(`[studio-import] queue-worker · start · ${name}`);
      try {
        const result = await worker(context);
        document.documentElement.dataset.importWorkerBoundary = 'resolved';
        console.info(`[studio-import] queue-worker · resolved · ${name}`);
        return result;
      } catch (error) {
        document.documentElement.dataset.importWorkerBoundary = 'rejected';
        console.info(`[studio-import] queue-worker · rejected · ${name}`);
        throw error;
      } finally {
        console.info(`[studio-import] queue-worker · finally · ${name}`);
      }
    });
  };
  prototype.__kyxosImportWorkerBoundaryInstalled = true;
}

installImportWorkerBoundary();
