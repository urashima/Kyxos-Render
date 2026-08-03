import { expect, test, type Page } from '@playwright/test';

async function createStudioProject(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('camera-bookmarks@kyxos.local');
  await page.getByLabel('Password').fill('camera-bookmarks-test');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Camera Bookmark Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
}

async function sceneBookmarks(page: Page): Promise<Array<{
  name: string;
  slot: number;
  preset?: string;
  projection?: string;
}>> {
  return page.evaluate(() => {
    const scene = (globalThis as any).kyxosStudio?.api?.getScene();
    return (scene?.editorState?.cameraBookmarks ?? []).map((bookmark: any) => ({
      name: bookmark.name,
      slot: bookmark.slot,
      preset: bookmark.state?.preset,
      projection: bookmark.state?.camera?.projection,
    }));
  });
}

test('Studio saves, recalls, renames and deletes editor camera bookmarks', async ({ page }) => {
  test.setTimeout(180_000);
  await createStudioProject(page);

  const canvas = page.locator('#studio-canvas');
  const cameraControls = page.getByRole('group', { name: 'Viewport camera' });
  const view = cameraControls.getByLabel('Viewport view');
  const bookmarks = cameraControls.getByLabel('Camera bookmark');

  await view.selectOption('front');
  await expect(canvas).toHaveAttribute('data-editor-view', 'front');
  await bookmarks.selectOption('1');
  await cameraControls.getByRole('button', { name: 'Save View', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-editor-bookmark-saved', '1');
  await expect.poll(() => sceneBookmarks(page)).toEqual([
    { name: 'View 1', slot: 1, preset: 'front', projection: 'orthographic' },
  ]);

  await view.selectOption('right');
  await expect(canvas).toHaveAttribute('data-editor-view', 'right');
  await cameraControls.getByRole('button', { name: 'Recall', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-editor-bookmark-slot', '1');
  await expect(canvas).toHaveAttribute('data-editor-view', 'front');

  await view.selectOption('top');
  await page.keyboard.press('Alt+Shift+Digit2');
  await expect(canvas).toHaveAttribute('data-editor-bookmark-saved', '2');
  await view.selectOption('perspective');
  await page.keyboard.press('Alt+Digit2');
  await expect(canvas).toHaveAttribute('data-editor-bookmark-slot', '2');
  await expect(canvas).toHaveAttribute('data-editor-view', 'top');

  await bookmarks.selectOption('2');
  page.once('dialog', (dialog) => dialog.accept('Top Review'));
  await cameraControls.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(bookmarks.locator('option[value="2"]')).toHaveText('2 · Top Review');
  await expect.poll(() => sceneBookmarks(page)).toContainEqual({
    name: 'Top Review',
    slot: 2,
    preset: 'top',
    projection: 'orthographic',
  });

  await cameraControls.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(bookmarks.locator('option[value="2"]')).toHaveText('2 · Empty');
  await expect.poll(() => sceneBookmarks(page)).toEqual([
    { name: 'View 1', slot: 1, preset: 'front', projection: 'orthographic' },
  ]);
});
