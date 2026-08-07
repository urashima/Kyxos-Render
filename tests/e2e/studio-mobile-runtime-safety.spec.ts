import { expect, test } from '@playwright/test';
import { createTriangleGlb } from '../../packages/test-fixtures/src/index';

const IPHONE_UA = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)',
  'AppleWebKit/605.1.15 (KHTML, like Gecko)',
  'Version/18.6 Mobile/15E148 Safari/604.1',
].join(' ');

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
    await expect(canvas).toHaveAttribute('data-studio-runtime-profile', 'mobile-safe');
    await expect(canvas).toHaveAttribute('data-studio-runtime-backend', 'webgl2');
    await expect(canvas).toHaveAttribute('data-studio-runtime-quality', 'low');

    const authoredQualityBefore = await page.evaluate(() =>
      (globalThis as any).kyxosStudio?.api?.getScene()?.renderSettings?.qualityPreset as string,
    );
    expect(authoredQualityBefore).toBeTruthy();
    await expect(canvas).toHaveAttribute('data-authored-render-quality', authoredQualityBefore);

    const glb = Buffer.from(createTriangleGlb());
    await page.locator('#asset-import-input').setInputFiles({
      name: 'iphone-triangle.glb',
      mimeType: 'model/gltf-binary',
      buffer: glb,
    });
    await expect(html).toHaveAttribute('data-import-core-complete', 'true', { timeout: 90_000 });
    await expect(html).toHaveAttribute('data-mobile-import-concurrency', '1');

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
