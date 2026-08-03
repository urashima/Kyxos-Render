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
  const compact = dialog.getByText('Compact editor density').locator('..').locator('input[type="checkbox"]');
  await compact.check();
  await expect(page.locator('.kyxos-studio-shell')).toHaveClass(/compact-density/);
  expect(await page.evaluate(() => localStorage.getItem('kyxos.studio.user-settings.v1'))).toContain('compactDensity');

  await dialog.getByRole('button', { name: 'Help' }).click();
  await expect(dialog.getByText('First project checklist')).toBeVisible();
  await expect(dialog.getByText('Hierarchy selection and parenting')).toBeVisible();
  await expect(dialog.getByText('Scene Auditor')).toBeVisible();

  await dialog.getByRole('button', { name: 'Images' }).click();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'one-pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(dialog.locator('.image-inspection')).toContainText('1 × 1');
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Convert image' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('one-pixel-converted.png');

  await dialog.getByRole('button', { name: /Notifications/ }).click();
  await expect(dialog.getByText('No notifications match this filter.')).toBeVisible();
});

test('Studio command palette runs the Auditor and persists its per-scene report', async ({ page }) => {
  await openEmptyProject(page);

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  const audit = palette.getByRole('button', { name: /Audit Active Scene/ }).first();
  await expect(audit).toBeVisible();
  await audit.click();
  await expect(palette).not.toBeVisible();

  await expect.poll(async () => page.evaluate(() => localStorage.getItem('kyxos.studio.userdata.v1')))
    .toContain('auditor.lastReport');

  await page.getByRole('button', { name: 'Tools' }).click();
  const dialog = page.locator('.advanced-tools-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Notifications/ }).click();
  await expect(dialog.getByText(/Scene audit (completed|passed)/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  await page.keyboard.press('Control+Shift+A');
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('kyxos.studio.userdata.v1');
    return raw ? JSON.parse(raw).version : null;
  })).toBe(1);
});
