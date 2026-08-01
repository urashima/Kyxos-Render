import { expect, test, type Page } from '@playwright/test';

async function openFixtureProject(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('panels@kyxos.local');
  await page.getByLabel('Password').fill('panel-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Panel Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
}

test('left, right and bottom panels collapse their actual layout tracks independently', async ({ page }) => {
  await openFixtureProject(page);

  const shell = page.locator('.kyxos-studio-shell');
  const viewport = page.locator('.studio-viewport');
  const hierarchyHeader = page.locator('.studio-hierarchy > .pcui-panel-header');
  const inspectorHeader = page.locator('.studio-inspector > .pcui-panel-header');
  const assetsHeader = page.locator('.studio-assets > .pcui-panel-header');

  const initial = await viewport.boundingBox();
  await hierarchyHeader.click();
  await expect(shell).toHaveClass(/layout-hierarchy-collapsed/);
  await expect(hierarchyHeader).toHaveAttribute('aria-expanded', 'false');
  const afterLeft = await viewport.boundingBox();
  expect((afterLeft?.width ?? 0) - (initial?.width ?? 0)).toBeGreaterThan(180);

  await inspectorHeader.click();
  await expect(shell).toHaveClass(/layout-inspector-collapsed/);
  const afterRight = await viewport.boundingBox();
  expect((afterRight?.width ?? 0) - (afterLeft?.width ?? 0)).toBeGreaterThan(240);

  await assetsHeader.click();
  await expect(shell).toHaveClass(/layout-assets-collapsed/);
  const afterBottom = await viewport.boundingBox();
  expect((afterBottom?.height ?? 0) - (afterRight?.height ?? 0)).toBeGreaterThan(100);

  await hierarchyHeader.click();
  await inspectorHeader.click();
  await assetsHeader.click();
  await expect(shell).not.toHaveClass(/layout-hierarchy-collapsed/);
  await expect(shell).not.toHaveClass(/layout-inspector-collapsed/);
  await expect(shell).not.toHaveClass(/layout-assets-collapsed/);
});

test('inspector controls do not close their module and long content owns vertical scrolling', async ({ page }) => {
  await openFixtureProject(page);

  const firstHierarchyRow = page.locator('.hierarchy-row').first();
  if (await firstHierarchyRow.count()) await firstHierarchyRow.click();

  const section = page.locator('.inspector-section[open], .effect-card[open]').first();
  await expect(section).toBeVisible({ timeout: 10_000 });
  const slider = section.locator('input[type="range"]').first();
  if (await slider.count()) {
    const before = await section.getAttribute('open');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(section).toHaveAttribute('open', before ?? '');
  }

  const inspector = page.locator('.inspector-content');
  await expect(inspector).toHaveCSS('overflow-y', 'auto');
  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('.inspector-content');
    if (!target) return;
    const spacer = document.createElement('div');
    spacer.dataset.testSpacer = 'true';
    spacer.style.height = '1400px';
    target.append(spacer);
  });
  const scrollResult = await inspector.evaluate((element) => {
    element.scrollTop = 600;
    return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
  });
  expect(scrollResult.scrollHeight).toBeGreaterThan(scrollResult.clientHeight);
  expect(scrollResult.scrollTop).toBeGreaterThan(0);
});
