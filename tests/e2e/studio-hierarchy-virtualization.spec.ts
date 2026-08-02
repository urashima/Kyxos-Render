import { expect, test, type Page } from '@playwright/test';

async function openEmptyProject(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('virtual-hierarchy@kyxos.local');
  await page.getByLabel('Password').fill('virtual-hierarchy-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Virtual Hierarchy Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => Boolean((globalThis as any).kyxosStudio?.api));
}

test('large hierarchies mount only visible rows and reveal keyboard/API selection', async ({ page }) => {
  test.setTimeout(120_000);
  await openEmptyProject(page);

  await page.evaluate(() => {
    const studio = (globalThis as any).kyxosStudio;
    const nodes = Array.from({ length: 260 }, (_, index) => ({
      id: `virtual-node-${index}`,
      name: `Virtual Node ${String(index).padStart(3, '0')}`,
      parentId: null,
      children: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      visible: true,
      locked: false,
    }));
    studio.api.applyPatch('Seed virtual hierarchy', [
      { op: 'replace', path: '/nodes', value: nodes },
    ]);
  });

  const tree = page.locator('.hierarchy-tree');
  await expect(tree).toHaveAttribute('data-virtualized', 'true');
  await expect(tree).toHaveAttribute('aria-rowcount', '260');
  await expect.poll(async () => tree.locator('.hierarchy-row').count()).toBeLessThan(80);
  await expect(tree.locator('.hierarchy-virtual-surface')).toHaveCount(1);

  await page.evaluate(() => {
    (globalThis as any).kyxosStudio.api.setSelection(['virtual-node-250']);
  });
  const selected = tree.locator('[data-node="virtual-node-250"]');
  await expect(selected).toBeVisible();
  await expect(selected).toHaveClass(/selected/);
  await expect.poll(async () => tree.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await tree.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await tree.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(tree.locator('[data-node="virtual-node-250"]')).toHaveCount(0);
  await expect(tree.locator('[data-node="virtual-node-0"]')).toBeVisible();
});
