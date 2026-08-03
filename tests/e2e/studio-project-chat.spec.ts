import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/studio/chat-lab/');
  await page.evaluate(() => localStorage.removeItem('kyxos-project-chat-lab-v1'));
  await page.reload();
  await expect(page.getByText('Kyxos Project Chat Lab')).toBeVisible();
  await expect(page.locator('.project-chat-panel')).toHaveCount(2);
  await expect(page.locator('.project-chat-status')).toHaveText(['Connected', 'Connected']);
});

test('Project Chat sends, replies, edits, moderates and persists across two sessions', async ({ page }) => {
  const panels = page.locator('.project-chat-panel');
  const owner = panels.nth(0);
  const editor = panels.nth(1);

  await owner.getByLabel('Chat message').fill('Hello Editor');
  await owner.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(owner.locator('.project-chat-message')).toContainText('Hello Editor');
  await expect(editor.locator('.project-chat-message')).toContainText('Hello Editor');

  await editor
    .locator('.project-chat-message')
    .filter({ hasText: 'Hello Editor' })
    .getByRole('button', { name: 'Reply', exact: true })
    .click();
  await expect(editor.locator('.project-chat-context')).toContainText('Replying to Owner');
  await editor.getByLabel('Chat message').fill('Hello Owner');
  await editor.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(owner.locator('.project-chat-message').filter({ hasText: 'Hello Owner' })).toContainText('Owner: Hello Editor');

  const editorMessage = editor.locator('.project-chat-message').filter({ hasText: 'Hello Owner' });
  await editorMessage.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(editor.locator('.project-chat-context')).toContainText('Editing your message');
  await editor.getByLabel('Chat message').fill('Updated reply');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(owner.locator('.project-chat-message').filter({ hasText: 'Updated reply' })).toContainText('edited');

  page.once('dialog', (dialog) => dialog.accept());
  await owner
    .locator('.project-chat-message')
    .filter({ hasText: 'Updated reply' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect(owner.locator('.project-chat-message.deleted')).toContainText('Message deleted');
  await expect(editor.locator('.project-chat-message.deleted')).toContainText('Message deleted');

  await page.reload();
  await expect(page.locator('.project-chat-panel').nth(0).locator('.project-chat-message')).toHaveCount(2);
  await expect(page.locator('.project-chat-panel').nth(0).locator('.project-chat-message.deleted')).toContainText('Message deleted');
});

test('Project Chat publishes typing state and keeps user actions scoped', async ({ page }) => {
  const panels = page.locator('.project-chat-panel');
  const owner = panels.nth(0);
  const editor = panels.nth(1);

  await editor.getByLabel('Chat message').fill('Typing now');
  await expect(owner.locator('.project-chat-typing')).toHaveText('Editor is typing…');
  await expect(editor.locator('.project-chat-typing')).toHaveText('');

  await editor.getByRole('button', { name: 'Send', exact: true }).click();
  const editorMessage = owner.locator('.project-chat-message').filter({ hasText: 'Typing now' });
  await expect(editorMessage.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(editorMessage.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(1);

  const editorOwnMessage = editor.locator('.project-chat-message').filter({ hasText: 'Typing now' });
  await expect(editorOwnMessage.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(1);
  await expect(editorOwnMessage.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(1);
});
