import { expect, test } from '@playwright/test';
import { createAnimatedTriangleGlb } from '../../packages/test-fixtures/src/animated';

test('Kyxos Studio edits, previews and publishes immutable animated releases', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
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

  await page.locator('input[type=file]').setInputFiles({
    name: 'fixture-animated-triangle.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createAnimatedTriangleGlb()),
  });
  await expect(page.getByText(/Import complete/)).toBeVisible({ timeout: 60_000 });
  await expect(
    page.locator('.hierarchy-row', { hasText: 'Animated Triangle' }),
  ).toBeVisible();
  await expect(page.getByLabel('Animation clip')).toHaveValue(/.+/);

  await page.locator('.hierarchy-row', { hasText: 'Animated Triangle' }).click();
  const positionX = page.locator('input[aria-label="position x"]');
  await expect(positionX).toHaveValue('0');

  await page.getByRole('button', { name: 'Move' }).click();
  const gizmoX = page.getByLabel('Transform X');
  await expect(gizmoX).toBeVisible();
  const box = await gizmoX.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2);
  await page.mouse.up();
  await expect(positionX).not.toHaveValue('0');
  await expect(page.locator('.save-state')).toHaveText('Saved', { timeout: 20_000 });

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(positionX).toHaveValue('0');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(positionX).not.toHaveValue('0');
  const v1Position = Number(await positionX.inputValue());

  const animationSection = page
    .locator('details.inspector-section')
    .filter({ has: page.locator('summary', { hasText: 'Animation' }) });
  await animationSection.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(400);
  await animationSection.getByRole('button', { name: 'Pause' }).click();

  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('.kyxos-studio-shell')).toHaveClass(/preview-mode/);
  await expect(page.locator('.studio-hierarchy')).toBeHidden();
  await page.getByRole('button', { name: 'Exit preview' }).click();
  await expect(page.locator('.studio-hierarchy')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Projects')).toBeVisible();
  await page.locator('.project-card', { hasText: 'Studio Acceptance' }).click();
  await page.locator('.hierarchy-row', { hasText: 'Animated Triangle' }).click();
  await expect(page.locator('input[aria-label="position x"]')).toHaveValue(
    String(v1Position),
  );

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
  expect(releases[0].sceneSnapshot.nodes[0].transform.position.x).toBe(v1Position);
  expect(releases[1].sceneSnapshot.nodes[0].transform.position.x).toBe(2.5);
  expect(releases[0].isCurrent).toBe(false);
  expect(releases[1].isCurrent).toBe(true);

  await page.getByRole('button', { name: 'Versions' }).click();
  const releaseCards = page.locator('.release-card');
  await expect(releaseCards).toHaveCount(2);
  await releaseCards.nth(1).getByRole('button', { name: 'Set current' }).click();
  await expect(page.locator('.release-card').nth(1)).toContainText('current');

  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('kyxos-studio-local-v1') ?? '{}');
    state.session = null;
    localStorage.setItem('kyxos-studio-local-v1', JSON.stringify(state));
  });

  const publicV1 = await context.newPage();
  const publicErrors: string[] = [];
  publicV1.on('pageerror', (error) => publicErrors.push(error.message));
  await publicV1.goto(
    `/public/?release=${encodeURIComponent(releases[0].id)}&backend=webgl2`,
  );
  await expect(publicV1.locator('#viewer')).toBeVisible();
  await expect(publicV1.locator('.controls')).toBeVisible({ timeout: 60_000 });
  await expect(publicV1.getByLabel('Animation')).toBeVisible();
  await expect(publicV1.getByText('Scene unavailable')).toHaveCount(0);

  const currentPublic = await context.newPage();
  await currentPublic.goto(
    `/public/?slug=${encodeURIComponent(releases[0].slug)}&backend=webgl2`,
  );
  await expect(currentPublic.locator('.controls')).toBeVisible({ timeout: 60_000 });
  await expect(currentPublic.getByText('Scene unavailable')).toHaveCount(0);

  const embedPage = await context.newPage();
  await embedPage.goto(
    `/embed/?release=${encodeURIComponent(releases[1].id)}&backend=webgl2&ui=0&interaction=0`,
  );
  await expect(embedPage.locator('#viewer')).toBeVisible();
  await expect(embedPage.locator('.controls')).toHaveCount(0);
  await expect(embedPage.locator('html')).toHaveClass(/kyxos-interaction-disabled/);
  await expect(embedPage.locator('#viewer')).toHaveCSS('pointer-events', 'none');
  await expect(embedPage.getByText('Scene unavailable')).toHaveCount(0);

  expect(pageErrors).toEqual([]);
  expect(publicErrors).toEqual([]);
  expect(
    consoleErrors.filter((message) =>
      /unhandled|initialization failed|context creation failed/i.test(message),
    ),
  ).toEqual([]);
});
