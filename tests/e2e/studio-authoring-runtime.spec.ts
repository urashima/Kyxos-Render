import { expect, test } from '@playwright/test';
import { createTriangleGlb } from '../../packages/test-fixtures/src/index';

async function createStudioProject(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('authoring-runtime@kyxos.local');
  await page.getByLabel('Password').fill('authoring-runtime');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Authoring Runtime Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
}

async function waitForImport(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute(
    'data-import-core-complete',
    'true',
    { timeout: 90_000 },
  );
  await expect(page.locator('html')).toHaveAttribute(
    'data-import-complete-message',
    /Import complete/,
  );
}

test('Studio helpers, empty defaults, publish and transparent surfaces remain functional', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await createStudioProject(page);

  const canvas = page.locator('#studio-canvas');
  await expect(canvas).toHaveAttribute('data-authoring-render', 'pipeline');
  await expect(canvas).toHaveAttribute('data-studio-default-floor', /removed|absent/);
  await expect(canvas).toHaveAttribute('data-studio-default-lights', /removed|absent/);
  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    return scene?.lights?.length ?? 0;
  })).toBe(0);

  await page.getByText('Helpers', { exact: true }).click();
  const grid = page.getByLabel('Ground grid');
  await expect(grid).toBeChecked();
  await grid.uncheck();
  await expect(canvas).toHaveAttribute('data-editor-grid-visible', 'false');
  await expect(canvas).not.toHaveAttribute('data-editor-helpers', /(?:^|,)grid(?:,|$)/);
  await expect(canvas).toHaveAttribute('data-editor-helper-ui-value', 'false');
  await grid.check();
  await expect(canvas).toHaveAttribute('data-editor-grid-visible', 'true');
  await expect(canvas).toHaveAttribute('data-editor-helpers', /(?:^|,)grid(?:,|$)/);

  // Publishing an untouched new project must bootstrap its first immutable draft
  // instead of failing with a revision conflict.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.locator('.viewport-overlay')).toContainText('Published v1', {
    timeout: 60_000,
  });
  await expect(page.locator('html')).toHaveAttribute('data-publish-draft-bootstrap', 'ready');

  await page.locator('#asset-import-input').setInputFiles({
    name: 'transparent-surface.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createTriangleGlb()),
  });
  await waitForImport(page);
  await page.locator('.hierarchy-row', { hasText: 'Triangle' }).click();

  const surface = page
    .locator('details.inspector-section')
    .filter({ has: page.locator(':scope > summary', { hasText: 'Material Surface' }) });
  await expect(surface).toBeVisible();
  if (!(await surface.getAttribute('open'))) await surface.locator(':scope > summary').click();

  const opacity = surface.getByLabel('Opacity');
  const alphaMode = surface.getByLabel('Alpha Mode');
  await opacity.fill('0.45');
  await alphaMode.selectOption('blend');
  await expect.poll(() => page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    return Object.values(scene?.materials ?? {})[0] as any;
  })).toMatchObject({ opacity: 0.45, alphaMode: 'blend' });
  await expect(canvas).toHaveAttribute('data-material-alpha-mode', 'blend');
  await expect(canvas).toHaveAttribute('data-material-runtime-opacity', '0.45');
  await expect(canvas).toHaveAttribute('data-material-transparent', 'true');
  await expect(canvas).toHaveAttribute('data-material-depth-write', 'false');

  await alphaMode.selectOption('mask');
  await expect(surface.getByLabel('Alpha Cutoff')).toBeVisible();
  await surface.getByLabel('Alpha Cutoff').fill('0.6');
  await expect(canvas).toHaveAttribute('data-material-alpha-mode', 'mask');
  await expect(canvas).toHaveAttribute('data-material-transparent', 'false');
  await expect(canvas).toHaveAttribute('data-material-depth-write', 'true');
  await expect(canvas).toHaveAttribute('data-material-alpha-test', '0.6');

  await alphaMode.selectOption('opaque');
  await expect(canvas).toHaveAttribute('data-material-alpha-mode', 'opaque');
  await expect(canvas).toHaveAttribute('data-material-runtime-opacity', '1');
  await expect(canvas).toHaveAttribute('data-material-transparent', 'false');
  await expect(canvas).toHaveAttribute('data-material-depth-write', 'true');
});
