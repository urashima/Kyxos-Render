import { expect, test } from '@playwright/test';

test('opens searchable controls and maps N to hierarchy rename', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('controls-reference@kyxos.local');
  await page.getByLabel('Password').fill('controls-reference');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Controls Reference Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });

  await page.keyboard.press('Shift+?');
  const controls = page.getByRole('dialog', { name: 'Editor controls and shortcuts' });
  await expect(controls).toBeVisible();
  await expect(controls.locator('[data-kx-controls-count]')).toContainText('controls');
  await controls.getByLabel('Search editor controls').fill('camera position');
  await expect(controls.locator('.kx-control-entry')).toContainText('Camera information');
  await controls.getByLabel('Search editor controls').fill('local world');
  await expect(controls.locator('.kx-control-entry')).toContainText('Local / World');
  await controls.getByRole('button', { name: 'Close controls' }).click();
  await expect(controls).toBeHidden();

  const hierarchy = page.locator('.studio-hierarchy');
  await hierarchy.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Empty' }).click();
  const selected = hierarchy.locator('.hierarchy-row.selected').last();
  await expect(selected).toBeVisible();
  await page.keyboard.press('n');
  const rename = hierarchy.getByRole('textbox', { name: /Rename/ });
  await expect(rename).toBeVisible();
  await rename.fill('Renamed By N');
  await rename.press('Enter');
  await expect(hierarchy.locator('.hierarchy-row').filter({ hasText: 'Renamed By N' })).toBeVisible();

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Space' : 'Control+Space');
  await expect(controls).toBeVisible();
});
