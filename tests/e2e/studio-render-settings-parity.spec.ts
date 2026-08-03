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
  const canvas = page.locator('#studio-canvas');
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  await expect(canvas).toHaveAttribute('data-authoring-render', 'pipeline');
  await expect(canvas).toHaveAttribute('data-authoring-pipeline', 'playground');
  await expect(canvas).toHaveAttribute('data-authoring-ready', 'true', {
    timeout: 60_000,
  });

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
  const readSwitchGeometry = () =>
    bloomSwitch.evaluate((track) => {
      const knob = track.querySelector<HTMLElement>('span');
      if (!knob) throw new Error('Switch knob is missing.');
      const trackRect = track.getBoundingClientRect();
      const knobRect = knob.getBoundingClientRect();
      return {
        checked: track.getAttribute('aria-checked') === 'true',
        trackWidth: trackRect.width,
        trackHeight: trackRect.height,
        knobWidth: knobRect.width,
        knobHeight: knobRect.height,
        knobOffsetX: knobRect.left - trackRect.left,
        centerDeltaY:
          knobRect.top + knobRect.height / 2 - (trackRect.top + trackRect.height / 2),
      };
    });

  const initialGeometry = await readSwitchGeometry();
  expect(initialGeometry.trackWidth).toBeCloseTo(40, 1);
  expect(initialGeometry.trackHeight).toBeCloseTo(22, 1);
  expect(initialGeometry.knobWidth).toBeCloseTo(16, 1);
  expect(initialGeometry.knobHeight).toBeCloseTo(16, 1);
  expect(Math.abs(initialGeometry.centerDeltaY)).toBeLessThan(0.75);
  expect(initialGeometry.knobOffsetX).toBeCloseTo(initialGeometry.checked ? 21 : 3, 1);

  const effectCountBefore = Number(await canvas.getAttribute('data-render-effect-count'));
  const wasEnabled = await bloomSwitch.getAttribute('aria-checked');
  await bloomSwitch.click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (globalThis as any).kyxosStudio.api.getScene().renderSettings.effects.bloom.enabled,
      ),
    )
    .toBe(wasEnabled !== 'true');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-render-effect-count')))
    .not.toBe(effectCountBefore);
  await expect
    .poll(async () => {
      const geometry = await readSwitchGeometry();
      const expected = geometry.checked ? 21 : 3;
      return {
        centered: Math.abs(geometry.centerDeltaY) < 0.75,
        aligned: Math.abs(geometry.knobOffsetX - expected) < 0.75,
      };
    })
    .toEqual({ centered: true, aligned: true });
  await expect(canvas).toHaveAttribute('data-authoring-render', 'pipeline');

  await section.locator('button[data-kx-theme-choice="graphite"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-kx-theme', 'graphite');
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--kx-accent').trim(),
      ),
    )
    .toBe('#d32d2d');
  await page.close();

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
  await publicPage.close();

  // `site/embed` is the same built Public Viewer artifact copied by the Pages
  // composer. Exercise its no-UI mode on the shared build here; the Pages
  // workflow separately verifies that the `/embed/` artifact and online route exist.
  const embedPage = await context.newPage();
  await embedPage.goto('/public/?slug=ui-fixture&backend=webgl2&ui=0&theme=dark');
  await expect(embedPage.locator('#viewer')).toBeVisible({ timeout: 60_000 });
  await expect(embedPage.locator('#viewer')).toHaveAttribute(
    'data-render-settings-parity',
    'playground',
    { timeout: 60_000 },
  );
  await expect(embedPage.locator('html')).toHaveAttribute('data-kx-product-theme', 'dark');
  await expect(embedPage.locator('.controls')).toHaveCount(0);
  await embedPage.close();
});
