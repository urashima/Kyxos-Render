import {
  fitImageSize,
  type ImageConvertOptions,
  type ImageInspection,
} from './experience-full';

export async function inspectImage(file: Blob & { name?: string }): Promise<ImageInspection> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('Image inspection requires createImageBitmap support.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    return {
      name: file.name ?? 'image',
      mimeType: file.type || 'application/octet-stream',
      byteSize: file.size,
      width: bitmap.width,
      height: bitmap.height,
      aspectRatio: bitmap.width / Math.max(1, bitmap.height),
      megapixels: (bitmap.width * bitmap.height) / 1_000_000,
    };
  } finally {
    bitmap.close();
  }
}

export async function convertImage(file: Blob, options: ImageConvertOptions = {}): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('Image conversion requires createImageBitmap support.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const fit = options.fit ?? 'contain';
    const requestedWidth = Math.max(1, Math.round(options.width ?? bitmap.width));
    const requestedHeight = Math.max(1, Math.round(options.height ?? bitmap.height));
    const output = fit === 'contain'
      ? fitImageSize(bitmap.width, bitmap.height, requestedWidth, requestedHeight, options.allowUpscale)
      : { width: requestedWidth, height: requestedHeight };
    const canvas = createImageCanvas(output.width, output.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable.');
    if (options.background) {
      context.fillStyle = options.background;
      context.fillRect(0, 0, output.width, output.height);
    }
    if (fit === 'cover') {
      const scale = Math.max(output.width / bitmap.width, output.height / bitmap.height);
      const drawWidth = bitmap.width * scale;
      const drawHeight = bitmap.height * scale;
      context.drawImage(
        bitmap,
        (output.width - drawWidth) / 2,
        (output.height - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
    } else {
      context.drawImage(bitmap, 0, 0, output.width, output.height);
    }
    const mimeType = options.mimeType
      ?? (file.type === 'image/jpeg' || file.type === 'image/webp' ? file.type : 'image/png');
    return await canvasToBlob(
      canvas,
      mimeType,
      Math.max(0, Math.min(1, options.quality ?? 0.9)),
    );
  } finally {
    bitmap.close();
  }
}

type ImageCanvas = HTMLCanvasElement | OffscreenCanvas;

function createImageCanvas(width: number, height: number): ImageCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') throw new Error('Image conversion requires a browser canvas.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToBlob(canvas: ImageCanvas, mimeType: string, quality: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: mimeType, quality });
  }
  return await new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Image encoding failed.')),
      mimeType,
      quality,
    );
  });
}
