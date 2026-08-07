import { expect, test } from '@playwright/test';

async function createStudioProject(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/studio/');
  await page.getByLabel('Email').fill('source-workspace-parity@kyxos.local');
  await page.getByLabel('Password').fill('source-workspace-parity');
  await page.getByRole('button', { name: 'Sign in' }).click();
  page.once('dialog', (dialog) => dialog.accept('Source Workspace Fixture'));
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.locator('#studio-canvas')).toBeVisible({ timeout: 60_000 });
}

async function acceptPrompt(page: import('@playwright/test').Page, value: string, action: () => Promise<void>): Promise<void> {
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt');
    await dialog.accept(value);
  });
  await action();
}

test('Studio source workspace supports create edit save rename duplicate refresh delete and dirty close protection', async ({ page }) => {
  test.setTimeout(180_000);
  await createStudioProject(page);

  await page.getByRole('button', { name: 'Code', exact: true }).click();
  const dialog = page.locator('.code-editor-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole('heading', { name: 'Code Editor' })).toBeVisible();
  await expect(dialog.getByLabel('Filter source files')).toBeVisible();

  await acceptPrompt(page, 'scripts/workspace.ts', async () => {
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
  });
  await expect(dialog.locator('.code-editor-tab.active')).toContainText('scripts/workspace.ts');
  await expect(dialog.locator('.code-file.active')).toContainText('scripts/workspace.ts');

  const input = dialog.locator('.monaco-editor textarea.inputarea').first();
  await expect(input).toBeAttached();
  await input.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type("export const workspaceParity = 42;\n");
  await expect(dialog.locator('.code-save-state')).toHaveText('Unsaved');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();

  page.once('dialog', async (confirmDialog) => {
    expect(confirmDialog.type()).toBe('confirm');
    expect(confirmDialog.message()).toContain('Discard unsaved changes');
    await confirmDialog.dismiss();
  });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.locator('.code-save-state')).toContainText('Saved');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  await acceptPrompt(page, 'scripts/renamed-workspace.ts', async () => {
    await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  });
  await expect(dialog.locator('.code-editor-tab.active')).toContainText('scripts/renamed-workspace.ts');
  await expect(dialog.locator('.code-file-list')).not.toContainText('scripts/workspace.ts');

  await acceptPrompt(page, 'scripts/copied-workspace.ts', async () => {
    await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click();
  });
  await expect(dialog.locator('.code-editor-tab.active')).toContainText('scripts/copied-workspace.ts');
  await expect(dialog.locator('.code-file-list')).toContainText('scripts/renamed-workspace.ts');
  await expect(dialog.locator('.code-file-list')).toContainText('scripts/copied-workspace.ts');

  const filter = dialog.getByLabel('Filter source files');
  await filter.fill('renamed');
  await expect(dialog.locator('.code-file-list .code-file')).toHaveCount(1);
  await expect(dialog.locator('.code-file-list .code-file')).toContainText('renamed-workspace.ts');
  await filter.fill('');

  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(dialog.locator('.code-editor-tab.active')).toContainText('scripts/copied-workspace.ts');

  page.once('dialog', async (confirmDialog) => {
    expect(confirmDialog.type()).toBe('confirm');
    expect(confirmDialog.message()).toContain('Delete scripts/copied-workspace.ts');
    await confirmDialog.accept();
  });
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.locator('.code-file-list')).not.toContainText('scripts/copied-workspace.ts');
  await expect(dialog.locator('.code-editor-tab.active')).toContainText('scripts/renamed-workspace.ts');

  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();

  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.code-editor-tab.active')).toContainText('scripts/renamed-workspace.ts');
});
