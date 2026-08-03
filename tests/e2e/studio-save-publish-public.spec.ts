import { expect, test } from '@playwright/test';
import { createTriangleGlb } from '../../packages/test-fixtures/src/index';

async function createProject(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('durable-publish@kyxos.local');
  await page.getByLabel('Password').fill('durable-publish');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Durable Publish Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
}

test('imported scene saves durably, publishes, opens and reloads from the public link', async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await createProject(page);

  await page.locator('#asset-import-input').setInputFiles({
    name: 'durable-publish.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createTriangleGlb()),
  });
  await expect(page.locator('html')).toHaveAttribute(
    'data-import-core-complete',
    'true',
    { timeout: 120_000 },
  );
  await expect(page.locator('html')).toHaveAttribute(
    'data-import-durable',
    'true',
  );
  await expect(page.locator('.save-state')).toHaveText('Saved', { timeout: 60_000 });

  // Reproduce the mobile failure where a concurrent Draft/Workspace save
  // overwrote the just-completed GLB asset metadata. The binary Blob remains
  // in IndexedDB, so Publish must repair the lightweight asset index from
  // the Scene Contract instead of requiring a reimport.
  const simulatedLostAsset = await page.evaluate(() => {
    const api = (globalThis as any).kyxosStudio?.api;
    const scene = api.getScene();
    const asset = Object.values(scene.assets)[0] as any;
    const raw = localStorage.getItem('kyxos-studio-local-v1') ?? '{}';
    const state = JSON.parse(raw);
    if (!asset || !state.assets?.[asset.id]) {
      throw new Error('Imported asset metadata was not durably registered.');
    }
    delete state.assets[asset.id];
    localStorage.setItem('kyxos-studio-local-v1', JSON.stringify(state));
    return { id: asset.id, hash: asset.contentHash };
  });

  // This payload exceeds the practical localStorage allowance once duplicated
  // into Draft, Workspace and Release snapshots. The durable provider must keep
  // the heavy scene in IndexedDB and only lightweight indexes in localStorage.
  await page.evaluate(() => {
    const api = (globalThis as any).kyxosStudio?.api;
    api.applyPatch('Durable payload', [{
      op: 'add',
      path: '/metadata/durablePayload',
      value: 'x'.repeat(6_000_000),
    }]);
  });
  await expect(page.locator('.save-state')).toHaveText('Saved', { timeout: 90_000 });

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.locator('.viewport-overlay')).toContainText('Published v1', {
    timeout: 90_000,
  });
  await expect(page.locator('html')).toHaveAttribute('data-publish-state', 'published');

  const repairedAsset = await page.evaluate(({ id }) => {
    const state = JSON.parse(localStorage.getItem('kyxos-studio-local-v1') ?? '{}');
    return state.assets?.[id] ?? null;
  }, simulatedLostAsset);
  expect(repairedAsset).toMatchObject({
    id: simulatedLostAsset.id,
    hash: simulatedLostAsset.hash,
    completed: true,
  });

  const localIndex = await page.evaluate(() => {
    const raw = localStorage.getItem('kyxos-studio-local-v1') ?? '';
    const state = JSON.parse(raw || '{}');
    return {
      bytes: raw.length,
      draftHasContract: Object.values(state.drafts ?? {}).some((entry: any) => Boolean(entry.contract)),
      workspaceHasDocument: Object.values(state.workspaces ?? {}).some((entry: any) => Boolean(entry.workspace)),
      releaseHasSnapshot: (state.releases ?? []).some((entry: any) => Boolean(entry.sceneSnapshot)),
    };
  });
  expect(localIndex.bytes).toBeLessThan(750_000);
  expect(localIndex.draftHasContract).toBe(false);
  expect(localIndex.workspaceHasDocument).toBe(false);
  expect(localIndex.releaseHasSnapshot).toBe(false);

  const href = await page.locator('.viewport-overlay a', { hasText: 'Open' }).getAttribute('href');
  expect(href).toBeTruthy();
  await page.close();

  const publicPage = await context.newPage();
  await publicPage.goto(href!);
  await expect(publicPage.locator('html')).toHaveAttribute(
    'data-public-viewer-stage',
    'ready',
    { timeout: 120_000 },
  );
  await expect(publicPage.locator('html')).toHaveAttribute('data-public-viewer-ready', 'true');
  await expect(publicPage.locator('#viewer')).toBeVisible();
  await expect(publicPage.locator('.loading')).toHaveCount(0);

  await publicPage.reload();
  await expect(publicPage.locator('html')).toHaveAttribute(
    'data-public-viewer-stage',
    'ready',
    { timeout: 120_000 },
  );
  await expect(publicPage.locator('html')).toHaveAttribute('data-public-viewer-ready', 'true');
  await expect(publicPage.locator('.loading')).toHaveCount(0);
});
