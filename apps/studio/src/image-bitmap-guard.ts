import './generated-glb-byte-cache';
import './import-task-change-deferral';
import './workspace-import-save-guard';
import './import-worker-boundary';
import { DiagnosticConsole, type ConsoleEntry, type ConsoleLevel } from '@kyxos/editor-core';

const installed = Symbol.for('kyxos.imageBitmapGuard.installed');
const diagnosticGuardInstalled = Symbol.for('kyxos.thumbnailDiagnosticGuard.installed');
const IMAGE_BITMAP_TIMEOUT_MS = 5_000;
const skippedThumbnailType = 'application/x-kyxos-thumbnail-skip';

type GuardGlobal = typeof globalThis & {
  [installed]?: boolean;
};

type DiagnosticPrototype = {
  log(
    level: ConsoleLevel,
    message: string,
    data?: unknown,
    source?: string,
  ): ConsoleEntry;
  [diagnosticGuardInstalled]?: boolean;
};

function hasActiveImportTransaction(): boolean {
  return Boolean(
    document.querySelector(
      '.import-task:not(.complete):not(.failed):not(.cancelled)',
    ),
  );
}

function isSkippedThumbnailSource(source: unknown): boolean {
  return source instanceof Blob && source.type === skippedThumbnailType;
}

function installThumbnailDiagnosticGuard(): void {
  const prototype = DiagnosticConsole.prototype as DiagnosticPrototype;
  if (prototype[diagnosticGuardInstalled]) return;
  const originalLog = prototype.log;
  prototype.log = function guardedDiagnosticLog(
    level,
    message,
    data,
    source,
  ): ConsoleEntry {
    if (source === 'assets' && message.startsWith('Could not generate a thumbnail')) {
      return {
        id: crypto.randomUUID(),
        level: 'debug',
        message,
        data: data == null ? undefined : String(
          typeof data === 'object' && data && 'message' in data
            ? (data as { message?: unknown }).message
            : data,
        ),
        source,
        timestamp: Date.now(),
      };
    }
    return originalLog.call(this, level, message, data, source);
  };
  prototype[diagnosticGuardInstalled] = true;
}

installThumbnailDiagnosticGuard();

const guardGlobal = globalThis as GuardGlobal;
const originalCreateImageBitmap = globalThis.createImageBitmap?.bind(globalThis);

if (!guardGlobal[installed] && originalCreateImageBitmap) {
  const guardedCreateImageBitmap = ((...args: unknown[]): Promise<ImageBitmap> => {
    if (isSkippedThumbnailSource(args[0])) {
      document.documentElement.dataset.imageBitmapGuard = 'skipped-thumbnail-blob';
      return Promise.reject(
        new DOMException('Thumbnail decoding was intentionally skipped.', 'AbortError'),
      );
    }

    if (hasActiveImportTransaction()) {
      document.documentElement.dataset.imageBitmapGuard = 'skipped-active-import';
      return Promise.reject(
        new DOMException('Thumbnail decoding skipped during asset import.', 'AbortError'),
      );
    }

    let operation: Promise<ImageBitmap>;
    try {
      operation = Reflect.apply(originalCreateImageBitmap, globalThis, args) as Promise<ImageBitmap>;
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise<ImageBitmap>((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new DOMException('Image bitmap decoding timed out.', 'TimeoutError'));
      }, IMAGE_BITMAP_TIMEOUT_MS);

      operation.then(
        (bitmap) => {
          if (settled) {
            bitmap.close();
            return;
          }
          settled = true;
          window.clearTimeout(timeoutId);
          resolve(bitmap);
        },
        (error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          reject(error);
        },
      );
    });
  }) as typeof globalThis.createImageBitmap;

  globalThis.createImageBitmap = guardedCreateImageBitmap;
  guardGlobal[installed] = true;
  document.documentElement.dataset.imageBitmapGuard = 'installed';
}
