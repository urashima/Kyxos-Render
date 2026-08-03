import { expect, test } from '@playwright/test';

test('Studio, Public Viewer and Embed share Playground render settings and product themes', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('render-parity@kyxos.local');
  await page.getByLabel('Password').fill('render-parity');
  await page.getByRole('button', { name: 'Sign in' }).click();

  page.once('dialog', (dialog) => dialog.accept('Render Settings Parity'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });

  const section = page
    .locator('details.inspector-section')
    .filter({ has: page.locator(':scope > summary', { hasText: 'Render Settings' }) });
  await expect(section).toHaveAttribute('data-render-settings-parity', 'playground');
  await expect(section.locator('input:not([type="range"])')).toHaveCount(0);
  await expect(section.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(section.locator('select')).toHaveCount(0);
  expect(await section.locator('button[role="switch"]').count()).toBeGreaterThan(10);

  const exposure = section.getByLabel('Exposure');
  await exposure.fill('1.35');
  await exposure.dispatchEvent('change');
  await expect
    .poll(() =>
      page.evaluate(
        () => (globalThis as any).kyxosStudio.api.getScene().renderSettings.exposure,
      ),
    )
    .toBe(1.35);

  const bloom = section.locator('details.kx-render-effect').filter({
    has: page.locator(':scope > summary', { hasText: 'Bloom' }),
  });
  const bloomSwitch = bloom.getByRole('switch', { name: 'Bloom enabled' });
  const wasEnabled = await bloomSwitch.getAttribute('aria-checked');
  await bloomSwitch.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (globalThis as any).kyxosStudio.api.getScene().renderSettings.effects.bloom.enabled,
      ),
    )
    .toBe(wasEnabled !== 'true');

  await section.locator('button[data-kx-theme-choice="graphite"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-kx-theme', 'graphite');
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--kx-accent').trim(),
      ),
    )
    .toBe('#d32d2d');

  const publicPage = await context.newPage();
  await publicPage.goto('/public/?slug=ui-fixture&backend=webgl2&theme=light');
  await expect(publicPage.locator('#viewer')).toBeVisible();
  await expect(publicPage.locator('#viewer')).toHaveAttribute(
    'data-render-settings-parity',
    'playground',
    { timeout: 60_000 },
  );
  await expect(publicPage.locator('html')).toHaveAttribute('data-kx-product-theme', 'light');
  await expect(publicPage.getByRole('button', { name: /Use dark green and black theme/ })).toBeVisible();

  const embedPage = await context.newPage();
  await embedPage.goto('/embed/?slug=ui-fixture&backend=webgl2&ui=0&theme=dark');
  await expect(embedPage.locator('#viewer')).toBeVisible();
  await expect(embedPage.locator('#viewer')).toHaveAttribute(
    'data-render-settings-parity',
    'playground',
    { timeout: 60_000 },
  );
  await expect(embedPage.locator('html')).toHaveAttribute('data-kx-product-theme', 'dark');
  await expect(embedPage.locator('.controls')).toHaveCount(0);
});
