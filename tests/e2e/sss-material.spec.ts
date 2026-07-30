import { expect, test } from '@playwright/test';

test('official Three.js SSS material enters the Kyxos beauty pipeline', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto('/pbr/');
  await page.waitForFunction(
    () => window.__kyxosTestApi?.ready() && Boolean(window.__kyxosSSSTestApi),
    null,
    { timeout: 90_000 },
  );

  const enabled = await page.evaluate(async () => {
    await window.__kyxosSSSTestApi?.demo();
    return window.__kyxosSSSTestApi?.set({
      color: '#ff5c3a',
      distortion: 0.2,
      ambient: 0.5,
      attenuation: 1.1,
      power: 3,
      scale: 20,
    });
  });

  expect(enabled).toMatchObject({
    enabled: true,
    color: '#ff5c3a',
    distortion: 0.2,
    ambient: 0.5,
    attenuation: 1.1,
    power: 3,
    scale: 20,
  });
  expect(enabled?.convertedMaterials).toBeGreaterThan(0);
  expect(enabled?.hasThicknessMap).toBe(false);

  const disabled = await page.evaluate(async () => window.__kyxosSSSTestApi?.set({ enabled: false }));
  expect(disabled?.enabled).toBe(false);
  expect(disabled?.convertedMaterials).toBe(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => /SSS failed|Viewer initialization failed/i.test(message))).toEqual([]);
});
