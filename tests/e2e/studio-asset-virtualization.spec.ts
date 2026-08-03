import { expect, test, type Page } from '@playwright/test';

async function createStudioProject(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('asset-virtualization@kyxos.local');
  await page.getByLabel('Password').fill('asset-virtualization-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('500 Asset Workspace'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
}

async function seedAssets(page: Page, total: number): Promise<void> {
  await page.evaluate((count) => {
    const api = (globalThis as any).kyxosStudio?.api;
    if (!api) throw new Error('Studio API is unavailable.');
    const assets = Object.fromEntries(
      Array.from({ length: count }, (_, index) => {
        const suffix = String(index).padStart(4, '0');
        const hash = index.toString(16).padStart(64, '0');
        const id = `virtual-asset-${suffix}`;
        return [id, {
          id,
          uri: `asset://${hash}`,
          contentHash: hash,
          kind: index % 2 === 0 ? 'other' : 'script',
          mimeType: index % 2 === 0 ? 'application/octet-stream' : 'text/plain',
          byteSize: index + 1,
          name: `Virtual Asset ${suffix}`,
          metadata: { generatedForVirtualizationAcceptance: true },
        }];
      }),
    );
    api.applyPatch('Seed 500 asset workspace', [
      { op: 'replace', path: '/assets', value: assets },
    ]);
  }, total);
}

test('Studio virtualizes a 500 asset workspace in Grid and List views', async ({ page }) => {
  test.setTimeout(180_000);
  await createStudioProject(page);
  await seedAssets(page, 500);

  const viewport = page.locator('.assets-content');
  const grid = page.locator('.asset-workspace-items');
  await expect(grid).toHaveAttribute('data-virtualized', 'true', { timeout: 20_000 });
  await expect(grid).toHaveAttribute('data-virtual-total', '500');
  await expect.poll(() => page.locator('.asset-workspace-item').count()).toBeLessThan(100);

  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(grid).toHaveAttribute('data-virtual-end', '500', { timeout: 20_000 });
  await expect(page.locator('.asset-workspace-item', { hasText: 'Virtual Asset 0499' })).toBeVisible();
  await expect.poll(() => page.locator('.asset-workspace-item').count()).toBeLessThan(100);

  await page.getByRole('button', { name: 'List', exact: true }).click();
  const list = page.locator('.asset-workspace-items.list');
  await expect(list).toHaveAttribute('data-virtualized', 'true', { timeout: 20_000 });
  await expect(list).toHaveAttribute('data-virtual-columns', '1');
  await expect.poll(() => page.locator('.asset-workspace-item').count()).toBeLessThan(60);

  await viewport.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  const search = page.locator('#asset-workspace-search');
  await search.fill('Virtual Asset 0499');
  await expect(page.locator('.asset-workspace-item')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('.asset-workspace-item', { hasText: 'Virtual Asset 0499' })).toBeVisible();
});
