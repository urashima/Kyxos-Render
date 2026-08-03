import { expect, test } from '@playwright/test';
import { createMultiMaterialGlb } from '../../packages/test-fixtures/src/multiMaterial';

test('Studio selects, displays and edits every runtime material slot', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('materials@kyxos.local');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  page.once('dialog', async (dialog) => dialog.accept('Multi Material Acceptance'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toHaveAttribute('data-empty-scene', '');

  await page.locator('#asset-import-input').setInputFiles({
    name: 'two-material.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createMultiMaterialGlb()),
  });
  await expect(page.getByText(/Import complete/)).toBeVisible({ timeout: 60_000 });

  const node = page.locator('.hierarchy-row', { hasText: 'Two Material Mesh' });
  await expect(node).toBeVisible();
  await expect(node).toHaveClass(/selected/);

  const materialSection = page
    .locator('details.inspector-section')
    .filter({ has: page.locator('summary', { hasText: 'Material' }) });
  await expect(materialSection).toBeVisible();
  await expect(materialSection.locator('.kx-current-material strong')).toHaveText('Left Red');
  await expect(page.locator('#studio-canvas')).toHaveAttribute(
    'data-selected-material-name',
    'Left Red',
  );

  const slot = page.getByLabel('Material slot');
  await expect(slot).toBeVisible();
  await expect(slot.locator('option')).toHaveCount(2);
  await expect(slot.locator('option').nth(0)).toHaveText('Left Red');
  await expect(slot.locator('option').nth(1)).toHaveText('Right Blue');

  await slot.selectOption('1');
  await expect(materialSection.locator('.kx-current-material strong')).toHaveText('Right Blue');
  await expect(page.locator('#studio-canvas')).toHaveAttribute(
    'data-selected-material-name',
    'Right Blue',
  );

  const roughness = materialSection
    .locator('.field-row')
    .filter({ hasText: 'roughness' })
    .locator('input');
  await expect(roughness).toHaveValue('0.25');
  const revisionBefore = Number(
    (await page.locator('#studio-canvas').getAttribute('data-material-revision')) ?? 0,
  );
  await roughness.fill('0.6');
  await roughness.dispatchEvent('input');
  await expect(page.locator('.save-state')).toHaveText('Saved', { timeout: 20_000 });
  await expect.poll(async () =>
    Number((await page.locator('#studio-canvas').getAttribute('data-material-revision')) ?? 0),
  ).toBeGreaterThan(revisionBefore);
  await expect(page.locator('#studio-canvas')).toHaveAttribute('data-material-name', 'Right Blue');

  await page.reload();
  await expect(page.getByText('Projects', { exact: true })).toBeVisible();
  await page.locator('.project-card', { hasText: 'Multi Material Acceptance' }).click();
  await expect(page.locator('.hierarchy-row', { hasText: 'Two Material Mesh' })).toHaveClass(/selected/);
  await page.getByLabel('Material slot').selectOption('1');
  await expect(
    page
      .locator('details.inspector-section')
      .filter({ has: page.locator('summary', { hasText: 'Material' }) })
      .locator('.field-row')
      .filter({ hasText: 'roughness' })
      .locator('input'),
  ).toHaveValue('0.6');
  await expect(page.locator('.kx-current-material strong')).toHaveText('Right Blue');
});
