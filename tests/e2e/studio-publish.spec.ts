import { expect, test } from '@playwright/test';
import { createTriangleGlb } from '../../packages/test-fixtures/src/index';

test('Kyxos Studio owner workflow publishes immutable v1/v2 and opens anonymous public/embed views', async ({ page, context }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/studio/');
  await page.getByLabel('Email').fill('owner@kyxos.local');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Projects')).toBeVisible();

  page.once('dialog', async (dialog) => dialog.accept('Studio Acceptance'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible();

  const upload = page.locator('input[type=file]');
  await upload.setInputFiles({
    name: 'fixture-triangle.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createTriangleGlb()),
  });
  await expect(page.getByText(/Import complete|Required extension/)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.hierarchy-row', { hasText: 'Triangle' })).toBeVisible();

  await page.locator('.hierarchy-row', { hasText: 'Triangle' }).click();
  const positionX = page.locator('input[aria-label="position x"]');
  await positionX.fill('1.25');
  await expect(page.locator('.save-state')).toHaveText('Saved', { timeout: 20_000 });

  await page.reload();
  await expect(page.getByText('Projects')).toBeVisible();
  await page.locator('.project-card', { hasText: 'Studio Acceptance' }).click();
  await expect(page.locator('.hierarchy-row', { hasText: 'Triangle' })).toBeVisible();
  await page.locator('.hierarchy-row', { hasText: 'Triangle' }).click();
  await expect(page.locator('input[aria-label="position x"]')).toHaveValue('1.25');

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published v1/)).toBeVisible({ timeout: 60_000 });

  await page.locator('input[aria-label="position x"]').fill('2.5');
  await expect(page.locator('.save-state')).toHaveText('Saved', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published v2/)).toBeVisible({ timeout: 60_000 });

  const releases = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('kyxos-studio-local-v1') ?? '{}');
    return state.releases
      .filter((release: any) => release.projectId === state.projects[0].id)
      .sort((a: any, b: any) => a.versionNumber - b.versionNumber);
  });
  expect(releases).toHaveLength(2);
  expect(releases[0].sceneSnapshot.nodes[0].transform.position.x).toBe(1.25);
  expect(releases[1].sceneSnapshot.nodes[0].transform.position.x).toBe(2.5);
  expect(releases[0].isCurrent).toBe(false);
  expect(releases[1].isCurrent).toBe(true);

  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('kyxos-studio-local-v1') ?? '{}');
    state.session = null;
    localStorage.setItem('kyxos-studio-local-v1', JSON.stringify(state));
  });

  const publicPage = await context.newPage();
  const publicErrors: string[] = [];
  publicPage.on('pageerror', (error) => publicErrors.push(error.message));
  await publicPage.goto(`/public/?release=${encodeURIComponent(releases[0].id)}&backend=webgl2`);
  await expect(publicPage.locator('#viewer')).toBeVisible();
  await expect(publicPage.locator('.controls')).toBeVisible({ timeout: 60_000 });
  await expect(publicPage.getByText('Scene unavailable')).toHaveCount(0);

  const embedPage = await context.newPage();
  await embedPage.goto(`/embed/?release=${encodeURIComponent(releases[1].id)}&backend=webgl2&ui=0`);
  await expect(embedPage.locator('#viewer')).toBeVisible();
  await expect(embedPage.locator('.controls')).toHaveCount(0);
  await expect(embedPage.getByText('Scene unavailable')).toHaveCount(0);

  expect(pageErrors).toEqual([]);
  expect(publicErrors).toEqual([]);
  expect(
    consoleErrors.filter((message) => /unhandled|initialization failed|context creation failed/i.test(message)),
  ).toEqual([]);
});
