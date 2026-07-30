import { expect, test } from '@playwright/test';

test('Studio shell exposes editor workflow controls', async ({ page }) => {
  await page.goto('http://127.0.0.1:4174/');
  await expect(page.locator('#project-select')).toBeVisible();
  await expect(page.locator('#studio-canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
});

test('Public Viewer supports published and embed routes', async ({ page }) => {
  await page.goto('http://127.0.0.1:4175/s/kyxos-acceptance-scene?autoplay=1');
  await expect(page.locator('#public-canvas')).toBeVisible();
  await expect(page.locator('#scene-title')).toContainText('Kyxos');
  await page.goto('http://127.0.0.1:4175/embed/kyxos-acceptance-scene?ui=0');
  await expect(page.locator('#public-canvas')).toBeVisible();
  await expect(page.locator('.public-toolbar')).toBeHidden();
});
