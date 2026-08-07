import { expect, test } from '@playwright/test';

async function openStudio(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('interaction-parity@kyxos.local');
  await page.getByLabel('Password').fill('interaction-parity');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Interaction Parity Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
}

async function captureEditorCamera(page: import('@playwright/test').Page) {
  return page.locator('#studio-canvas').evaluate((canvas: HTMLCanvasElement) => new Promise<{
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
  }>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      canvas.removeEventListener('kyxos:editor-camera-bookmark-state', onState);
      reject(new Error('Camera capture timed out.'));
    }, 2_000);
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<{
        requestId: string;
        state: {
          camera: {
            transform: { position: { x: number; y: number; z: number } };
            target: { x: number; y: number; z: number };
          };
        };
      }>).detail;
      if (detail.requestId !== requestId) return;
      window.clearTimeout(timeout);
      canvas.removeEventListener('kyxos:editor-camera-bookmark-state', onState);
      resolve({
        position: detail.state.camera.transform.position,
        target: detail.state.camera.target,
      });
    };
    canvas.addEventListener('kyxos:editor-camera-bookmark-state', onState);
    canvas.dispatchEvent(new CustomEvent('kyxos:editor-viewport-command', {
      detail: { command: 'capture-bookmark', requestId },
    }));
  }));
}

test('matches PlayCanvas transform, layout and camera shortcuts', async ({ page }) => {
  await openStudio(page);
  const shell = page.locator('.kyxos-studio-shell');
  const canvas = page.locator('#studio-canvas');
  const coordinateSpace = page.getByLabel('Coordinate space');

  await page.keyboard.press('Digit1');
  await expect(page.getByRole('button', { name: 'Move', exact: true })).toHaveClass(/active/);
  await page.keyboard.press('Digit2');
  await expect(page.getByRole('button', { name: 'Rotate', exact: true })).toHaveClass(/active/);
  await page.keyboard.press('Digit3');
  await expect(page.getByRole('button', { name: 'Scale', exact: true })).toHaveClass(/active/);

  await expect(coordinateSpace).toHaveValue('local');
  await page.keyboard.press('l');
  await expect(coordinateSpace).toHaveValue('world');

  await page.keyboard.press('Space');
  await expect(shell).toHaveClass(/kx-panels-hidden/);
  await expect(page.locator('.studio-hierarchy')).toBeHidden();
  await page.keyboard.press('Space');
  await expect(shell).not.toHaveClass(/kx-panels-hidden/);
  await expect(page.locator('.studio-hierarchy')).toBeVisible();

  const beforeNodes = await page.evaluate(() => {
    const studio = (globalThis as typeof globalThis & {
      kyxosStudio?: { api?: { getScene(): { nodes: unknown[] } } };
    }).kyxosStudio;
    return studio?.api?.getScene().nodes.length ?? 0;
  });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+e' : 'Control+e');
  await expect.poll(() => page.evaluate(() => {
    const studio = (globalThis as typeof globalThis & {
      kyxosStudio?: { api?: { getScene(): { nodes: unknown[] } } };
    }).kyxosStudio;
    return studio?.api?.getScene().nodes.length ?? 0;
  })).toBe(beforeNodes + 1);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+d' : 'Control+d');
  await expect.poll(() => page.evaluate(() => {
    const studio = (globalThis as typeof globalThis & {
      kyxosStudio?: { api?: { getScene(): { nodes: unknown[] } } };
    }).kyxosStudio;
    return studio?.api?.getScene().nodes.length ?? 0;
  })).toBe(beforeNodes + 2);

  await page.keyboard.press('i');
  await expect(page.getByRole('complementary', { name: 'Editor camera information' })).toBeVisible();
  await page.getByLabel('Editor camera position').fill('1, 2, 3');
  await page.getByLabel('Editor camera position').press('Enter');
  await expect.poll(async () => (await captureEditorCamera(page)).position).toEqual({ x: 1, y: 2, z: 3 });

  await canvas.hover();
  await canvas.focus();
  const beforeFly = await captureEditorCamera(page);
  await page.keyboard.down('w');
  await page.waitForTimeout(320);
  await page.keyboard.up('w');
  const afterFly = await captureEditorCamera(page);
  expect(afterFly.position).not.toEqual(beforeFly.position);
  expect(afterFly.target).not.toEqual(beforeFly.target);
});
