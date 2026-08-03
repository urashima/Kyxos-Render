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

  // Reproduce the real legacy/mobile failure: the Scene Contract contains a
  // truncated hash padded with zeros while the Blob remains stored under the
  // original SHA-256 key and the lightweight asset index is missing.
  const simulatedLostAsset = await page.evaluate(async () => {
    const api = (globalThis as any).kyxosStudio?.api;
    const scene = api.getScene();
    const [assetKey, asset] = Object.entries(scene.assets)[0] as [string, any];
    const originalHash = asset?.contentHash as string;
    if (!asset || !originalHash) throw new Error('Imported asset is unavailable.');

    const paddedCandidate = `${originalHash.slice(0, 56)}00000000`;
    const legacyHash = paddedCandidate === originalHash
      ? `${originalHash.slice(0, 56)}ffffffff`
      : paddedCandidate;
    const pointer = assetKey.replace(/~/g, '~0').replace(/\//g, '~1');
    api.applyPatch('Simulate legacy padded asset hash', [
      { op: 'replace', path: `/assets/${pointer}/contentHash`, value: legacyHash },
      { op: 'replace', path: `/assets/${pointer}/uri`, value: `asset://${legacyHash}` },
    ]);

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kyxos-assets', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const originalBlobExists = await new Promise<boolean>((resolve, reject) => {
      const request = db.transaction('blobs').objectStore('blobs').get(originalHash);
      request.onsuccess = () => resolve(request.result instanceof Blob);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!originalBlobExists) throw new Error('Original content-addressed Blob is missing.');

    const raw = localStorage.getItem('kyxos-studio-local-v1') ?? '{}';
    const state = JSON.parse(raw);
    delete state.assets?.[assetKey];
    localStorage.setItem('kyxos-studio-local-v1', JSON.stringify(state));
    return { id: assetKey, hash: legacyHash, originalHash };
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
    metadata: {
      actualContentHash: simulatedLostAsset.originalHash,
    },
  });

  const aliasExists = await page.evaluate(async ({ hash }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kyxos-assets', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const exists = await new Promise<boolean>((resolve, reject) => {
      const request = db.transaction('blobs').objectStore('blobs').get(hash);
      request.onsuccess = () => resolve(request.result instanceof Blob);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return exists;
  }, simulatedLostAsset);
  expect(aliasExists).toBe(true);

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


test('publish re-persists an imported Blob from the live manifest when IndexedDB loses it', async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await createProject(page);

  await page.locator('#asset-import-input').setInputFiles({
    name: 'live-blob-recovery.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from(createTriangleGlb()),
  });
  await expect(page.locator('html')).toHaveAttribute(
    'data-import-durable',
    'true',
    { timeout: 120_000 },
  );
  await expect(page.locator('.save-state')).toHaveText('Saved', { timeout: 60_000 });

  const imported = await page.evaluate(async () => {
    const api = (globalThis as any).kyxosStudio?.api;
    const asset = Object.values(api.getScene().assets)[0] as any;
    if (!asset) throw new Error('Imported asset is unavailable.');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kyxos-assets', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('blobs', 'readwrite');
      transaction.objectStore('blobs').delete(asset.contentHash);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
    return { hash: asset.contentHash };
  });

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-publish-state', 'published', {
    timeout: 90_000,
  });
  await expect(page.locator('html')).toHaveAttribute(
    'data-recovered-visible-asset',
    imported.hash,
  );

  const restored = await page.evaluate(async ({ hash }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kyxos-assets', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const exists = await new Promise<boolean>((resolve, reject) => {
      const request = db.transaction('blobs').objectStore('blobs').get(hash);
      request.onsuccess = () => resolve(request.result instanceof Blob);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return exists;
  }, imported);
  expect(restored).toBe(true);

  const href = await page.locator('.viewport-overlay a', { hasText: 'Open' }).getAttribute('href');
  expect(href).toBeTruthy();
  const publicPage = await context.newPage();
  await publicPage.goto(href!);
  await expect(publicPage.locator('html')).toHaveAttribute(
    'data-public-viewer-stage',
    'ready',
    { timeout: 120_000 },
  );
});
