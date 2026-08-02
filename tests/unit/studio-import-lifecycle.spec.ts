import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DiagnosticConsole,
  ImportTaskQueue,
} from '../../packages/editor-core/src/index';
import {
  normalizeImportDiagnostic,
} from '../../apps/studio/src/glb-import-parity';

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validatePng(bytes: Uint8Array): void {
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let sawImageData = false;
  let sawEnd = false;
  while (offset < bytes.byteLength) {
    expect(offset + 12).toBeLessThanOrEqual(bytes.byteLength);
    const length = view.getUint32(offset, false);
    const typeStart = offset + 4;
    const dataEnd = typeStart + 4 + length;
    expect(dataEnd + 4).toBeLessThanOrEqual(bytes.byteLength);
    const typeAndData = bytes.slice(typeStart, dataEnd);
    const expectedCrc = view.getUint32(dataEnd, false);
    expect(crc32(typeAndData)).toBe(expectedCrc);
    const type = new TextDecoder().decode(bytes.slice(typeStart, typeStart + 4));
    sawImageData ||= type === 'IDAT';
    sawEnd ||= type === 'IEND';
    offset = dataEnd + 4;
  }
  expect(offset).toBe(bytes.byteLength);
  expect(sawImageData).toBe(true);
  expect(sawEnd).toBe(true);
}

function fallbackPngFromSource(relativePath: string): Uint8Array {
  const source = readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  );
  const encoded = source.match(
    /const FALLBACK_THUMBNAIL_BASE64\s*=\s*\n?\s*'([^']+)'/,
  )?.[1];
  expect(encoded, `${relativePath} must declare a fallback thumbnail`).toBeTruthy();
  return Buffer.from(encoded!, 'base64');
}

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

  it('keeps every import fallback thumbnail as a structurally valid PNG', () => {
    validatePng(
      fallbackPngFromSource('../../apps/studio/src/glb-import-parity.ts'),
    );
    validatePng(
      fallbackPngFromSource('../../apps/studio/src/glb-import-diagnostics.ts'),
    );
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
