import { expect, test } from '@playwright/test';
import baselines from './visual-baselines.json';
import { createTriangleGlb } from '../../packages/test-fixtures/src/index';

async function visibleRatio(page: import('@playwright/test').Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((canvas: HTMLCanvasElement) => {
    const sample = document.createElement('canvas');
    sample.width = 96;
    sample.height = 64;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) return 0;
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let visible = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 24 && pixels[index + 3] > 0) visible += 1;
    }
    return visible / (sample.width * sample.height);
  });
}

test('captures Studio and immutable Public Viewer visual evidence', async ({ page }, testInfo) => {
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('visual@kyxos.local');
  await page.getByLabel('Password').fill('visual-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Visual Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'visual-fixture.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createTriangleGlb()),
  });
  await expect(page.locator('.hierarchy-row', { hasText: 'Triangle' })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1000);

  const studioRatio = await visibleRatio(page, '#studio-canvas');
  expect(studioRatio).toBeGreaterThanOrEqual(baselines.studioViewport.minVisibleRatio);
  expect(studioRatio).toBeLessThanOrEqual(baselines.studioViewport.maxVisibleRatio);
  await testInfo.attach('studio-viewport', {
    body: await page.locator('.studio-viewport').screenshot(),
    contentType: 'image/png',
  });

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published v1/)).toBeVisible({ timeout: 60_000 });
  const releaseId = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('kyxos-studio-local-v1') ?? '{}');
    return state.releases.at(-1).id;
  });

  await page.goto(`/public/?release=${encodeURIComponent(releaseId)}&backend=webgl2`);
  await expect(page.locator('.controls')).toBeVisible({ timeout: 60_000 });
  const publicRatio = await visibleRatio(page, '#viewer');
  expect(publicRatio).toBeGreaterThanOrEqual(baselines.publishedWebgl2.minVisibleRatio);
  expect(publicRatio).toBeLessThanOrEqual(baselines.publishedWebgl2.maxVisibleRatio);
  await testInfo.attach('published-webgl2', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
