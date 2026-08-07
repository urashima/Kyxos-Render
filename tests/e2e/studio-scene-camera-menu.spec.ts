import { expect, test } from '@playwright/test';

test('lists scene cameras beside orthographic editor views', async ({ page }) => {
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('camera-menu@kyxos.local');
  await page.getByLabel('Password').fill('camera-menu');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Camera Menu Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });

  const hierarchy = page.locator('.studio-hierarchy');
  await hierarchy.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Camera' }).click();

  const scene = await page.evaluate(() => {
    const studio = (globalThis as typeof globalThis & {
      kyxosStudio?: { api?: { getScene(): { cameras: Array<{ id: string; name: string }> } } };
    }).kyxosStudio;
    return studio?.api?.getScene();
  });
  const camera = scene?.cameras.at(-1);
  expect(camera).toBeTruthy();

  const view = page.getByLabel('Viewport view');
  await view.focus();
  await expect(view.locator('optgroup[label="Scene Cameras"]')).toBeAttached();
  await expect(view.locator(`option[value="scene-camera:${camera!.id}"]`)).toContainText(camera!.name);
  await view.selectOption(`scene-camera:${camera!.id}`);
  await expect(page.locator('#studio-canvas')).toHaveAttribute('data-scene-camera-id', camera!.id);
});
