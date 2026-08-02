import { expect, test, type Page } from '@playwright/test';

async function openEmptyProject(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('experience@kyxos.local');
  await page.getByLabel('Password').fill('experience-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Editor Experience Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
}

test('Studio Tools exposes search, persisted settings, notifications, help and image utilities', async ({ page }) => {
  await openEmptyProject(page);
  await page.getByRole('button', { name: 'Tools' }).click();

  const dialog = page.locator('.advanced-tools-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Search' })).toHaveClass(/active/);

  const search = dialog.getByLabel('Global Studio search');
  await search.fill('Validate Scene');
  await expect(dialog.getByRole('button', { name: /Validate Scene Contract/ })).toBeVisible();

  await dialog.getByRole('button', { name: 'Settings' }).click();
  const compact = dialog.getByText('Compact editor density').locator('..').getByRole('checkbox');
  await compact.check();
  await expect(page.locator('.kyxos-studio-shell')).toHaveClass(/compact-density/);
  expect(await page.evaluate(() => localStorage.getItem('kyxos.studio.user-settings.v1'))).toContain('compactDensity');

  await dialog.getByRole('button', { name: 'Help' }).click();
  await expect(dialog.getByText('First project checklist')).toBeVisible();
  await expect(dialog.getByText('Hierarchy selection and parenting')).toBeVisible();

  await dialog.getByRole('button', { name: 'Images' }).click();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'one-pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlZ8AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(dialog.locator('.image-inspection')).toContainText('1 × 1');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Convert image' }).click();
  await expect(await download).toHaveSuggestedFilename('one-pixel-converted.png');

  await dialog.getByRole('button', { name: /Notifications/ }).click();
  await expect(dialog.getByText(/No notifications|Asset|Studio/)).toBeVisible();
});
