import { expect, test } from '@playwright/test';

test('persists editor preferences, renders thumbnail fallbacks and keeps mobile actions reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('detail-pass@kyxos.local');
  await page.getByLabel('Password').fill('detail-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();

  page.once('dialog', (dialog) => dialog.accept('Detail Pass Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Editor settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Editor Preferences' });
  await expect(settings).toBeVisible();
  await settings.locator('input[name="hierarchyWidth"]').evaluate((control) => {
    const input = control as HTMLInputElement;
    input.value = '320';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(settings.locator('output[data-output-for="hierarchyWidth"]')).toHaveText('320px');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--kx-detail-hierarchy-width')))
    .toBe('320px');
  await settings.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: '← Projects' }).click();
  const projectCard = page.locator('.project-card').filter({ hasText: 'Detail Pass Fixture' });
  await expect(projectCard.locator('.project-thumb canvas.kx-thumbnail-canvas')).toBeVisible();
  await projectCard.click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileDock = page.getByRole('navigation', { name: 'Mobile editor controls' });
  await expect(mobileDock).toBeVisible();
  await expect(mobileDock.getByRole('button', { name: 'Hierarchy' })).toHaveCSS('min-height', '48px');
  await mobileDock.getByRole('button', { name: 'Assets' }).click();
  await expect(page.locator('.kyxos-studio-shell')).toHaveClass(/kx-mobile-assets-open/);
  await mobileDock.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Editor Preferences' })).toBeVisible();
});
