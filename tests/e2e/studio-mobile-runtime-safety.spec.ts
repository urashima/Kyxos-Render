import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { createTriangleGlb } from '../../packages/test-fixtures/src/index';

const IPHONE_UA = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)',
  'AppleWebKit/605.1.15 (KHTML, like Gecko)',
  'Version/18.6 Mobile/15E148 Safari/604.1',
].join(' ');

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 0);
  return Buffer.concat([length, typeBytes, Buffer.from(data), checksum]);
}

function createLargeSolidPng(width = 4096, height = 2048): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // grayscale, 8-bit
  ihdr[9] = 0;
  const scanlines = Buffer.alloc((width + 1) * height);
  const compressed = deflateSync(scanlines, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('iPhone Studio loads GLB with one low-memory runtime and preserves authored render quality', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({
    userAgent: IPHONE_UA,
    viewport: { width: 393, height: 852 },
    screen: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto('/studio/');
    await page.getByLabel('Email').fill('mobile-runtime-safety@kyxos.local');
    await page.getByLabel('Password').fill('mobile-runtime-safety');
    await page.getByRole('button', { name: 'Sign in' }).click();
    page.once('dialog', (dialog) => dialog.accept('iPhone Runtime Fixture'));
    await page.getByRole('button', { name: 'New project' }).click();

    const html = page.locator('html');
    const canvas = page.locator('#studio-canvas');
    await expect(canvas).toBeVisible({ timeout: 60_000 });
    await expect(html).toHaveAttribute('data-studio-runtime-profile', 'mobile-safe');
    await expect(html).toHaveAttribute('data-studio-runtime-backend', 'webgl2');
    await expect(html).toHaveAttribute('data-studio-runtime-quality', 'low');
    await expect(html).toHaveAttribute('data-studio-runtime-pixel-ratio', '1');
    await expect(html).toHaveAttribute('data-studio-runtime-shadows', 'disabled');
    await expect(html).toHaveAttribute('data-studio-runtime-pipeline', 'beauty-only');
    await expect(html).toHaveAttribute('data-studio-runtime-mrt', 'disabled');
    await expect(canvas).toHaveAttribute('data-studio-runtime-profile', 'mobile-safe');
    await expect(canvas).toHaveAttribute('data-studio-runtime-backend', 'webgl2');
    await expect(canvas).toHaveAttribute('data-studio-runtime-quality', 'low');
    await expect(canvas).toHaveAttribute('data-studio-runtime-shadows', 'disabled');
    await expect(canvas).toHaveAttribute('data-studio-runtime-pipeline', 'beauty-only');
    await expect(canvas).toHaveAttribute('data-studio-runtime-mrt', 'disabled');

    const authoredQualityBefore = await page.evaluate(() =>
      (globalThis as any).kyxosStudio?.api?.getScene()?.renderSettings?.qualityPreset as string,
    );
    expect(authoredQualityBefore).toBeTruthy();
    await expect(canvas).toHaveAttribute('data-authored-render-quality', authoredQualityBefore);

    // Verify the Studio-only mobile decoder budget with a real 4096×2048 PNG.
    // The PNG compresses to a very small fixture, but a native full-size RGBA
    // decode would still occupy tens of MB on WebKit before GPU upload.
    const largeTexture = createLargeSolidPng().toString('base64');
    const decodedSize = await page.evaluate(async (encoded) => {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const result = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return result;
    }, largeTexture);
    expect(decodedSize).toEqual({ width: 2048, height: 1024 });
    await expect(html).toHaveAttribute('data-mobile-texture-max-dimension', '2048');
    await expect(html).toHaveAttribute('data-mobile-texture-downsampled', 'true');
    await expect(html).toHaveAttribute('data-mobile-texture-source-size', '4096x2048');
    await expect(html).toHaveAttribute('data-mobile-texture-decode-size', '2048x1024');

    const glb = Buffer.from(createTriangleGlb());
    await page.locator('#asset-import-input').setInputFiles({
      name: 'iphone-triangle.glb',
      mimeType: 'model/gltf-binary',
      buffer: glb,
    });
    await expect(html).toHaveAttribute('data-import-core-complete', 'true', { timeout: 90_000 });
    await expect(html).toHaveAttribute('data-picker-blob-read-mode', 'uncached-large');
    await expect.poll(
      () => html.getAttribute('data-import-durability-state'),
      { timeout: 5_000 },
    ).toMatch(/^(pending|saved|slow)$/);

    const metadataBytes = Number(await html.getAttribute('data-glb-metadata-bytes'));
    const sourceBytes = Number(await html.getAttribute('data-glb-source-bytes'));
    expect(metadataBytes).toBeGreaterThan(20);
    expect(sourceBytes).toBe(glb.byteLength);
    expect(metadataBytes).toBeLessThanOrEqual(sourceBytes);

    const authoredQualityAfter = await page.evaluate(() =>
      (globalThis as any).kyxosStudio?.api?.getScene()?.renderSettings?.qualityPreset as string,
    );
    expect(authoredQualityAfter).toBe(authoredQualityBefore);
    await expect(canvas).toHaveAttribute('data-studio-runtime-quality', 'low');
    await expect(canvas).toHaveAttribute('data-studio-runtime-pipeline', 'beauty-only');

    const modelAssetId = await page.evaluate(() => {
      const scene = (globalThis as any).kyxosStudio?.api?.getScene();
      return (Object.values(scene?.assets ?? {}).find((entry: any) => entry.kind === 'model') as any)?.id as string;
    });
    expect(modelAssetId).toBeTruthy();
    const modelCard = page.locator(`.asset-workspace-item[data-asset-id="${modelAssetId}"]`);
    await expect(modelCard).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_500);
    await expect(page.locator('.kx-thumbnail-render-host')).toHaveCount(0);
    await expect(modelCard).not.toHaveClass(/has-generated-thumbnail/);
    await expect(html).toHaveAttribute('data-project-thumbnail-state', 'mobile-deferred');
  } finally {
    await context.close();
  }
});
