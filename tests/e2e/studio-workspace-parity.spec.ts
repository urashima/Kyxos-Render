import { expect, test } from '@playwright/test';

async function createStudioProject(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('workspace-parity@kyxos.local');
  await page.getByLabel('Password').fill('workspace-parity');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Workspace Parity Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.kyxos-studio-shell')).toHaveAttribute('data-kx-workspace-parity', 'true');
}

async function expectCollapseDirection(
  page: import('@playwright/test').Page,
  panelSelector: string,
  collapseGlyph: string,
  expandGlyph: string,
): Promise<void> {
  const panel = page.locator(panelSelector);
  const fold = panel.locator('.kx-workspace-fold');
  await expect(fold).toHaveText(collapseGlyph);
  await fold.click();
  await expect(panel).toHaveClass(/kx-panel-collapsed/);
  await expect(fold).toHaveText(expandGlyph);
  await fold.click();
  await expect(panel).not.toHaveClass(/kx-panel-collapsed/);
  await expect(fold).toHaveText(collapseGlyph);
}

test('Studio workspace matches dock, float, collapse, settings and mobile reachability behavior', async ({ page }) => {
  test.setTimeout(180_000);
  await createStudioProject(page);

  await expectCollapseDirection(page, '.studio-hierarchy', '‹', '›');
  await expectCollapseDirection(page, '.studio-inspector', '›', '‹');
  await expectCollapseDirection(page, '.studio-assets', '⌄', '⌃');

  const hierarchy = page.locator('.studio-hierarchy');
  await hierarchy.getByRole('button', { name: 'Float Hierarchy' }).click();
  await expect(hierarchy).toHaveClass(/kx-panel-floating/);
  await expect(page.locator('.kyxos-studio-shell')).toHaveClass(/workspace-floating-hierarchy/);

  const before = await hierarchy.boundingBox();
  const header = hierarchy.locator(':scope > .pcui-panel-header');
  const headerBox = await header.boundingBox();
  expect(before).not.toBeNull();
  expect(headerBox).not.toBeNull();
  if (before && headerBox) {
    const x = headerBox.x + 18;
    const y = headerBox.y + headerBox.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 96, y + 54, { steps: 5 });
    await page.mouse.up();
    const after = await hierarchy.boundingBox();
    expect(after).not.toBeNull();
    if (after) {
      expect(after.x).toBeGreaterThan(before.x + 40);
      expect(after.y).toBeGreaterThan(before.y + 20);
    }
  }

  const floatingFold = hierarchy.locator('.kx-workspace-fold');
  await expect(floatingFold).toHaveText('⌃');
  await floatingFold.click();
  await expect(hierarchy).toHaveClass(/kx-floating-collapsed/);
  await expect(floatingFold).toHaveText('⌄');
  await floatingFold.click();
  await expect(hierarchy).not.toHaveClass(/kx-floating-collapsed/);
  await hierarchy.getByRole('button', { name: 'Dock Hierarchy' }).click();
  await expect(hierarchy).not.toHaveClass(/kx-panel-floating/);

  await page.getByRole('button', { name: 'Studio Settings' }).click();
  const settings = page.locator('.kx-studio-settings-dialog');
  await expect(settings).toBeVisible();
  await expect(settings.getByText('Interface', { exact: true })).toBeVisible();
  await expect(settings.getByText('Assets', { exact: true })).toBeVisible();
  await expect(settings.getByText('Viewport', { exact: true })).toBeVisible();
  await expect(settings.getByText('Workspace', { exact: true })).toBeVisible();

  const multiSelectRow = settings.locator('.kx-settings-row').filter({ hasText: 'Modifier multi-select' });
  const multiSelect = multiSelectRow.locator('input[type=checkbox]');
  await expect(multiSelect).toBeChecked();
  await multiSelect.uncheck();
  await expect.poll(() => page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem('kyxos-studio-workspace-preferences-v1') ?? '{}');
    return value.viewportMultiSelect;
  })).toBe(false);
  await multiSelect.check();
  await settings.getByRole('button', { name: 'Done' }).click();
  await expect(settings).not.toBeVisible();

  // Restore-default must be exercised against a genuinely floating panel, but
  // native <dialog> modality correctly blocks clicks on the workspace behind it.
  // Float first, then reopen Settings and restore from inside the modal.
  await hierarchy.getByRole('button', { name: 'Float Hierarchy' }).click();
  await expect(hierarchy).toHaveClass(/kx-panel-floating/);
  await page.getByRole('button', { name: 'Studio Settings' }).click();
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Restore default workspace' }).click();
  await expect(hierarchy).not.toHaveClass(/kx-panel-floating|kx-panel-collapsed/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kyxos-studio-workspace-layout-v4'))).toBeNull();
  await settings.getByRole('button', { name: 'Done' }).click();
  await expect(settings).not.toBeVisible();

  await hierarchy.getByRole('button', { name: 'Float Hierarchy' }).click();
  await expect(hierarchy).toHaveClass(/kx-panel-floating/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(hierarchy).not.toHaveClass(/kx-panel-floating/);

  const shell = page.locator('.kyxos-studio-shell');
  await page.getByRole('button', { name: 'Toggle hierarchy' }).click();
  await expect(shell).toHaveClass(/hierarchy-drawer-open/);
  await expect(hierarchy).toBeVisible();
  await page.getByRole('button', { name: 'Toggle inspector' }).click();
  await expect(shell).toHaveClass(/inspector-drawer-open/);
  await expect(page.locator('.studio-inspector')).toBeVisible();

  const more = page.getByRole('button', { name: 'More editor actions' });
  await expect(more).toBeVisible();
  await more.click();
  const mobileActions = page.locator('.kx-mobile-actions-menu');
  await expect(mobileActions).toBeVisible();
  for (const action of ['Scenes', 'State Graph', 'Collaborate', 'History', 'Code', 'Tools', 'Versions']) {
    await expect(mobileActions.getByRole('menuitem', { name: action, exact: true })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(mobileActions).not.toBeVisible();
  await expect(more).toBeFocused();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => hierarchy.evaluate((element) => element.classList.contains('kx-panel-floating'))).toBe(true);
  await expect(page.locator('.studio-topbar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Studio Settings' })).toBeVisible();
  await expect(more).not.toBeVisible();
});