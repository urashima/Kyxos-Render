import './generated-glb-byte-cache';
import './import-task-change-deferral';
import './workspace-import-save-guard';
import './import-worker-boundary';
import { DiagnosticConsole, type ConsoleEntry, type ConsoleLevel } from '@kyxos/editor-core';

const installed = Symbol.for('kyxos.imageBitmapGuard.installed');
const diagnosticGuardInstalled = Symbol.for('kyxos.thumbnailDiagnosticGuard.installed');
const DESKTOP_IMAGE_BITMAP_TIMEOUT_MS = 5_000;
const MOBILE_IMAGE_BITMAP_TIMEOUT_MS = 20_000;
const MOBILE_MAX_TEXTURE_DIMENSION = 2048;
const IMAGE_HEADER_READ_BYTES = 256 * 1024;
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

function constrainedMobileTextureRuntime(): boolean {
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

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker == null || marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (sof.has(marker) && length >= 7) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return null;
  }
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X') {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return { width, height };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const width = 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8));
    const height = 1 + (((bytes[22] & 0xc0) >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10));
    return { width, height };
  }
  if (
    chunk === 'VP8 ' &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

async function blobDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  const bytes = new Uint8Array(
    await blob.slice(0, Math.min(blob.size, IMAGE_HEADER_READ_BYTES)).arrayBuffer(),
  );
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return jpegDimensions(bytes) ?? webpDimensions(bytes);
}

function dimensionsFromSource(source: unknown): { width: number; height: number } | null {
  if (!source || typeof source !== 'object') return null;
  const value = source as { width?: unknown; height?: unknown; videoWidth?: unknown; videoHeight?: unknown };
  const width = typeof value.width === 'number'
    ? value.width
    : typeof value.videoWidth === 'number' ? value.videoWidth : 0;
  const height = typeof value.height === 'number'
    ? value.height
    : typeof value.videoHeight === 'number' ? value.videoHeight : 0;
  return width > 0 && height > 0 ? { width, height } : null;
}

function constrainedSize(width: number, height: number): { width: number; height: number } | null {
  const max = Math.max(width, height);
  if (max <= MOBILE_MAX_TEXTURE_DIMENSION) return null;
  const scale = MOBILE_MAX_TEXTURE_DIMENSION / max;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function mobileSafeBitmapArgs(args: unknown[]): Promise<unknown[]> {
  if (!constrainedMobileTextureRuntime()) return args;
  document.documentElement.dataset.mobileTextureMaxDimension = String(MOBILE_MAX_TEXTURE_DIMENSION);

  const source = args[0];
  const cropOverload = args.length >= 5 && [1, 2, 3, 4].every((index) => typeof args[index] === 'number');
  let dimensions = cropOverload
    ? { width: Math.abs(Number(args[3])), height: Math.abs(Number(args[4])) }
    : dimensionsFromSource(source);
  if (!dimensions && source instanceof Blob) {
    try {
      dimensions = await blobDimensions(source);
    } catch {
      // Header probing is only an optimization. Fall through to native decode
      // when a browser-specific image container cannot be inspected safely.
    }
  }
  if (!dimensions) return args;

  const optionsIndex = cropOverload ? 5 : 1;
  const previous = (
    args[optionsIndex] && typeof args[optionsIndex] === 'object'
      ? args[optionsIndex]
      : {}
  ) as ImageBitmapOptions;
  const requestedWidth = previous.resizeWidth ?? dimensions.width;
  const requestedHeight = previous.resizeHeight ?? dimensions.height;
  const resized = constrainedSize(requestedWidth, requestedHeight);
  if (!resized) return args;

  const next = [...args];
  next[optionsIndex] = {
    ...previous,
    resizeWidth: resized.width,
    resizeHeight: resized.height,
    resizeQuality: previous.resizeQuality ?? 'medium',
  } satisfies ImageBitmapOptions;
  document.documentElement.dataset.mobileTextureDownsampled = 'true';
  document.documentElement.dataset.mobileTextureSourceSize = `${dimensions.width}x${dimensions.height}`;
  document.documentElement.dataset.mobileTextureDecodeSize = `${resized.width}x${resized.height}`;
  return next;
}

const guardGlobal = globalThis as GuardGlobal;
const originalCreateImageBitmap = globalThis.createImageBitmap?.bind(globalThis);

if (!guardGlobal[installed] && originalCreateImageBitmap) {
  const guardedCreateImageBitmap = ((...args: unknown[]): Promise<ImageBitmap> => {
    // Only the explicit thumbnail sentinel is skipped. GLTFLoader also calls
    // createImageBitmap while an import task is active; rejecting all active
    // imports silently removed embedded base-color, normal and PBR textures.
    if (isSkippedThumbnailSource(args[0])) {
      document.documentElement.dataset.imageBitmapGuard = 'skipped-thumbnail-blob';
      return Promise.reject(
        new DOMException('Thumbnail decoding was intentionally skipped.', 'AbortError'),
      );
    }

    const operation = mobileSafeBitmapArgs(args).then((safeArgs) =>
      Reflect.apply(originalCreateImageBitmap, globalThis, safeArgs) as Promise<ImageBitmap>,
    );

    return new Promise<ImageBitmap>((resolve, reject) => {
      let settled = false;
      const timeoutMs = constrainedMobileTextureRuntime()
        ? MOBILE_IMAGE_BITMAP_TIMEOUT_MS
        : DESKTOP_IMAGE_BITMAP_TIMEOUT_MS;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        document.documentElement.dataset.imageBitmapGuard = 'decode-timeout';
        reject(new DOMException('Image bitmap decoding timed out.', 'TimeoutError'));
      }, timeoutMs);

      operation.then(
        (bitmap) => {
          if (settled) {
            bitmap.close();
            return;
          }
          settled = true;
          window.clearTimeout(timeoutId);
          document.documentElement.dataset.imageBitmapGuard = 'decoded';
          resolve(bitmap);
        },
        (error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          document.documentElement.dataset.imageBitmapGuard = 'decode-error';
          reject(error);
        },
      );
    });
  }) as typeof globalThis.createImageBitmap;

  globalThis.createImageBitmap = guardedCreateImageBitmap;
  guardGlobal[installed] = true;
  document.documentElement.dataset.imageBitmapGuard = 'installed';
  if (constrainedMobileTextureRuntime()) {
    document.documentElement.dataset.mobileTextureMaxDimension = String(MOBILE_MAX_TEXTURE_DIMENSION);
  }
}
