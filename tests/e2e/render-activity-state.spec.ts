import { expect, test } from '@playwright/test';

const fatalPattern =
  /render pipeline error|gpuvalidationerror|validation error|device lost|out of memory|sample is not a function/i;

test('render activity converges and releases requestAnimationFrame', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 480, height: 320 });
  await page.goto('/overview/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, {
    timeout: 90_000,
  });

  await page.evaluate(() => window.__kyxosTestApi.setQuality('high'));
  await page.waitForFunction(() => window.__kyxosTestApi.getActivity()?.state === 'sleeping', null, {
    timeout: 45_000,
  });

  let activity = await page.evaluate(() => window.__kyxosTestApi.getActivity());
  expect(activity?.pendingAnimationFrame).toBe(false);
  expect(activity?.staticSampleCount).toBe(activity?.accumulationFrames);

  await page.evaluate(() => window.__kyxosTestApi.setEffect('bloom', { strength: 0.61 }));
  await page.waitForFunction(() => window.__kyxosTestApi.getActivity()?.state !== 'sleeping');
  await page.waitForFunction(() => window.__kyxosTestApi.getActivity()?.state === 'accumulating', null, {
    timeout: 30_000,
  });
  await page.waitForFunction(() => window.__kyxosTestApi.getActivity()?.state === 'sleeping', null, {
    timeout: 45_000,
  });

  activity = await page.evaluate(() => window.__kyxosTestApi.getActivity());
  expect(activity?.pendingAnimationFrame).toBe(false);

  await page.evaluate(() => window.__kyxosTestApi.setAnimation(true));
  await page.waitForFunction(() => window.__kyxosTestApi.getActivity()?.state === 'interactive');
  activity = await page.evaluate(() => window.__kyxosTestApi.getActivity());
  expect(activity?.animationActive).toBe(true);
  expect(activity?.pendingAnimationFrame).toBe(true);

  await page.evaluate(() => window.__kyxosTestApi.setAnimation(false));
  await page.waitForFunction(() => window.__kyxosTestApi.getActivity()?.state === 'sleeping', null, {
    timeout: 45_000,
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => fatalPattern.test(message))).toEqual([]);
});
