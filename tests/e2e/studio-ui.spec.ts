import { expect, test } from '@playwright/test';

test('switches Authoring and Focus modes without replacing the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('ui@kyxos.local');
  await page.getByLabel('Password').fill('ui-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('UI Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });

  await page.evaluate(() => {
    (window as typeof window & { __kyxosCanvas?: HTMLCanvasElement }).__kyxosCanvas = document.querySelector<HTMLCanvasElement>('#studio-canvas') ?? undefined;
  });

  await page.getByRole('button', { name: 'Focus mode' }).click();
  await expect(page.locator('.kyxos-studio-shell')).toHaveAttribute('data-mode', 'focus');
  expect(await page.evaluate(() => (window as typeof window & { __kyxosCanvas?: HTMLCanvasElement }).__kyxosCanvas === document.querySelector('#studio-canvas'))).toBe(true);

  await page.getByRole('button', { name: 'Authoring mode' }).click();
  await expect(page.locator('.kyxos-studio-shell')).toHaveAttribute('data-mode', 'authoring');
  expect(await page.evaluate(() => (window as typeof window & { __kyxosCanvas?: HTMLCanvasElement }).__kyxosCanvas === document.querySelector('#studio-canvas'))).toBe(true);

  await page.getByRole('button', { name: 'Switch theme' }).click();
  await expect(page.locator('.kyxos-studio-shell')).toHaveAttribute('data-kx-theme', 'graphite');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  await expect(page.getByLabel('Command palette')).toBeVisible();
  await page.keyboard.press('Escape');

  const viewport = await page.locator('.studio-viewport').boundingBox();
  expect(viewport?.width ?? 0).toBeGreaterThan(1200);
  expect(viewport?.height ?? 0).toBeGreaterThan(700);
});
