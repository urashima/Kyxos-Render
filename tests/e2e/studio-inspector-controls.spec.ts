import { expect, test } from '@playwright/test';
import { createAnimatedTriangleGlb } from '../../packages/test-fixtures/src/animated';

test('Studio Inspector controls remain live, focused and persistent', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('inspector@kyxos.local');
  await page.getByLabel('Password').fill('inspector-test');
  await page.getByRole('button', { name: 'Sign in' }).click();

  page.once('dialog', (dialog) => dialog.accept('Inspector Controls'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });

  await page.locator('#asset-import-input').setInputFiles({
    name: 'inspector-animated-triangle.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createAnimatedTriangleGlb()),
  });
  await expect(page.getByText(/Import complete/)).toBeVisible({ timeout: 60_000 });
  await page.locator('.hierarchy-row', { hasText: 'Animated Triangle' }).click();

  const material = page
    .locator('details.inspector-section')
    .filter({ has: page.locator('summary', { hasText: 'Material' }) });
  await expect(material).toBeVisible();
  await expect(material).toHaveAttribute('open', '');

  const roughness = material
    .locator('.schema-field')
    .filter({ hasText: 'Roughness' })
    .locator('input[type=number]');
  await expect(roughness).toBeVisible();
  const before = Number(await roughness.inputValue());
  await roughness.evaluate((control) => {
    control.setAttribute('data-live-control', 'roughness');
  });
  await roughness.focus();
  await page.keyboard.press('ArrowUp');

  await expect(material).toHaveAttribute('open', '');
  await expect(roughness).toBeFocused();
  await expect(roughness).toHaveAttribute('data-live-control', 'roughness');
  expect(Number(await roughness.inputValue())).toBeGreaterThan(before);
  await expect(page.locator('.save-state')).toHaveText('Saved', { timeout: 20_000 });
  const savedRoughness = await roughness.inputValue();

  const effectCard = page.locator('details.effect-card').filter({
    has: page.locator('summary input[type=checkbox]:not(:disabled)'),
  }).first();
  if (await effectCard.count()) {
    const enabled = effectCard.locator('summary input[type=checkbox]');
    const wasOpen = await effectCard.evaluate((element) => (element as HTMLDetailsElement).open);
    const wasChecked = await enabled.isChecked();
    await enabled.click();
    await expect(enabled).toBeChecked({ checked: !wasChecked });
    expect(await effectCard.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(wasOpen);
  }

  await page.reload();
  await expect(page.getByText('Projects', { exact: true })).toBeVisible();
  await page.locator('.project-card', { hasText: 'Inspector Controls' }).click();
  await page.locator('.hierarchy-row', { hasText: 'Animated Triangle' }).click();
  const restoredMaterial = page
    .locator('details.inspector-section')
    .filter({ has: page.locator('summary', { hasText: 'Material' }) });
  const restoredRoughness = restoredMaterial
    .locator('.schema-field')
    .filter({ hasText: 'Roughness' })
    .locator('input[type=number]');
  await expect(restoredRoughness).toHaveValue(savedRoughness);
});
