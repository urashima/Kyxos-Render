import { describe, expect, it } from 'vitest';

import {
  DiagnosticConsole,
  ImportTaskQueue,
} from '../../packages/editor-core/src/index';
import {
  normalizeImportDiagnostic,
} from '../../apps/studio/src/glb-import-parity';

describe('PlayCanvas-style Studio import lifecycle', () => {
  it('normalizes Error and cyclic renderer data before DiagnosticConsole cloning', () => {
    const cycle: Record<string, unknown> = { label: 'renderer-state' };
    cycle.self = cycle;
    const error = new Error('thumbnail readback failed');
    (error as Error & { renderer?: unknown }).renderer = cycle;

    const normalized = normalizeImportDiagnostic({ error, cycle });
    expect(normalized).toMatchObject({
      error: {
        name: 'Error',
        message: 'thumbnail readback failed',
      },
      cycle: {
        label: 'renderer-state',
        self: '[Circular]',
      },
    });

    const diagnosticConsole = new DiagnosticConsole();
    expect(() =>
      diagnosticConsole.log(
        'warn',
        'Optional import post-processing failed.',
        { error, cycle },
        'assets',
      ),
    ).not.toThrow();
    expect(diagnosticConsole.list()[0]).toMatchObject({
      level: 'warn',
      source: 'assets',
    });
  });

  it('preserves terminal completion when an import worker reports normal stages', async () => {
    let taskId = '';
    const queue = new ImportTaskQueue<string>(1, () => 'import-task');
    taskId = queue.enqueue('fixture.glb', async (context) => {
      context.report('hashing', 0.1);
      context.report('uploading', 0.4);
      context.report('parsing', 0.65);
      context.report('building', 0.9);
      return 'asset-ready';
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Import queue did not complete.')),
        2_000,
      );
      const check = () => {
        const task = queue.list().find((entry) => entry.id === taskId);
        if (task?.stage !== 'complete') return;
        clearTimeout(timeout);
        queue.removeEventListener('change', check);
        resolve();
      };
      queue.addEventListener('change', check);
      check();
    });

    expect(queue.list()[0]).toMatchObject({
      id: 'import-task',
      stage: 'complete',
      progress: 1,
      result: 'asset-ready',
    });
  });
});
