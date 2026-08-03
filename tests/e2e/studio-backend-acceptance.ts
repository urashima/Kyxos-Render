import { createHash } from 'node:crypto';

import { expect, type Page, type TestInfo } from '@playwright/test';

import { createTriangleGlb } from '../../packages/test-fixtures/src/index';

export type AcceptedStudioBackend = 'webgl2' | 'webgpu';

function digest(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function createStudioProject(
  page: Page,
  backend: AcceptedStudioBackend,
): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/studio/?backend=${backend}`);
  await page.getByLabel('Email').fill(`backend-${backend}@kyxos.local`);
  await page.getByLabel('Password').fill('backend-acceptance-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept(`Backend ${backend}`));
  await page.getByRole('button', { name: 'New project' }).click();

  const canvas = page.locator('#studio-canvas');
  await expect(canvas).toBeVisible({ timeout: 120_000 });
  await expect(canvas).toHaveAttribute('data-requested-backend', backend);
  await expect(canvas).toHaveAttribute('data-render-backend', backend, {
    timeout: 120_000,
  });
  await expect(canvas).toHaveAttribute('data-backend-acceptance', 'matched');
}

async function waitForImport(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute(
    'data-import-core-complete',
    'true',
    { timeout: 120_000 },
  );
  await expect(page.locator('html')).toHaveAttribute(
    'data-import-complete-message',
    /Import complete/,
  );
  await expect(page.locator('.hierarchy-row', { hasText: 'Triangle' })).toBeVisible();
}

export async function acceptStudioBackend(
  page: Page,
  testInfo: TestInfo,
  backend: AcceptedStudioBackend,
): Promise<void> {
  const pageErrors: string[] = [];
  const severeConsoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error'
      && /gpuvalidationerror|validation error|render pipeline|shader error|context lost/i.test(
        message.text(),
      )
    ) {
      severeConsoleErrors.push(message.text());
    }
  });

  await createStudioProject(page, backend);
  await page.locator('#asset-import-input').setInputFiles({
    name: `${backend}-triangle.glb`,
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createTriangleGlb()),
  });
  await waitForImport(page);

  const canvas = page.locator('#studio-canvas');
  const renderMode = page.getByLabel('Viewport render mode');
  await renderMode.selectOption('shaded');
  await expect(canvas).toHaveAttribute('data-editor-render-mode', 'shaded');
  await page.waitForTimeout(750);
  const shaded = await canvas.screenshot({
    animations: 'disabled',
    caret: 'hide',
  });
  await testInfo.attach(`${backend}-shaded.png`, {
    body: shaded,
    contentType: 'image/png',
  });

  await renderMode.selectOption('normals');
  await expect(canvas).toHaveAttribute('data-editor-render-mode', 'normals');
  await page.waitForTimeout(750);
  const normals = await canvas.screenshot({
    animations: 'disabled',
    caret: 'hide',
  });
  await testInfo.attach(`${backend}-normals.png`, {
    body: normals,
    contentType: 'image/png',
  });

  expect(shaded.byteLength, `${backend} shaded screenshot evidence`).toBeGreaterThan(2_000);
  expect(normals.byteLength, `${backend} normals screenshot evidence`).toBeGreaterThan(2_000);
  expect(digest(normals), `${backend} normals must visibly differ from shaded`).not.toBe(
    digest(shaded),
  );
  expect(pageErrors, `${backend} page errors`).toEqual([]);
  expect(severeConsoleErrors, `${backend} GPU/renderer errors`).toEqual([]);

  const evidence = {
    backend,
    requestedBackend: await canvas.getAttribute('data-requested-backend'),
    actualBackend: await canvas.getAttribute('data-render-backend'),
    shadedSha256: digest(shaded),
    normalsSha256: digest(normals),
    shadedBytes: shaded.byteLength,
    normalsBytes: normals.byteLength,
  };
  await testInfo.attach(`${backend}-visual-evidence.json`, {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: 'application/json',
  });
}
