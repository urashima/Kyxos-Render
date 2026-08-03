import { describe, expect, it, vi } from 'vitest';
import {
  createProjectChatClient,
  normalizeChatBody,
  type ProjectChatStorage,
} from '../../packages/api-client/src/chat';

class MemoryStorage implements ProjectChatStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('Project chat body normalization', () => {
  it('normalizes line endings and rejects empty or oversized messages', () => {
    expect(normalizeChatBody('  hello\r\nworld  ')).toBe('hello\nworld');
    expect(normalizeChatBody('a\u0000b')).toBe('ab');
    expect(() => normalizeChatBody('   ')).toThrow(/empty/);
    expect(() => normalizeChatBody('x'.repeat(4_001))).toThrow(/4000/);
  });
});

describe('Local project chat', () => {
  it('isolates projects and supports replies, author edits, deletion and owner moderation', async () => {
    const storage = new MemoryStorage();
    let clock = new Date('2026-08-03T12:00:00.000Z');
    const now = () => clock;
    const author = createProjectChatClient({
      projectId: 'project-a',
      userId: 'user-a',
      clientId: 'client-a',
      displayName: ' Author ',
      storage,
      now,
    });
    const other = createProjectChatClient({
      projectId: 'project-a',
      userId: 'user-b',
      clientId: 'client-b',
      displayName: 'Other',
      storage,
      now,
    });
    const owner = createProjectChatClient({
      projectId: 'project-a',
      userId: 'owner',
      clientId: 'owner-client',
      displayName: 'Owner',
      canModerate: true,
      storage,
      now,
    });
    const isolated = createProjectChatClient({
      projectId: 'project-b',
      userId: 'user-a',
      clientId: 'client-c',
      displayName: 'Author',
      storage,
      now,
    });

    const first = await author.sendMessage('First message');
    expect(first.displayName).toBe('Author');
    clock = new Date('2026-08-03T12:00:01.000Z');
    const reply = await other.sendMessage('Reply', first.id);
    expect(reply.replyToId).toBe(first.id);
    expect(await author.listMessages()).toHaveLength(2);
    expect(await isolated.listMessages()).toEqual([]);
    await expect(isolated.sendMessage('Cross-project reply', first.id)).rejects.toThrow(/Reply target/);

    await expect(other.editMessage(first.id, 'forbidden')).rejects.toThrow(/author or project owner/);
    const edited = await author.editMessage(first.id, 'Edited message');
    expect(edited.body).toBe('Edited message');
    expect(edited.editedAt).not.toBeNull();

    const moderated = await owner.deleteMessage(reply.id);
    expect(moderated.body).toBe('');
    expect(moderated.deletedAt).not.toBeNull();
    await expect(other.editMessage(reply.id, 'revive')).rejects.toThrow(/Deleted/);
  });

  it('paginates newest messages and expires typing indicators', async () => {
    const storage = new MemoryStorage();
    let clock = new Date('2026-08-03T12:00:00.000Z');
    const first = createProjectChatClient({
      projectId: 'project-a',
      userId: 'user-a',
      clientId: 'client-a',
      displayName: 'A',
      storage,
      now: () => clock,
    });
    const second = createProjectChatClient({
      projectId: 'project-a',
      userId: 'user-b',
      clientId: 'client-b',
      displayName: 'B',
      storage,
      now: () => clock,
    });

    const messages = [];
    for (let index = 0; index < 4; index += 1) {
      clock = new Date(`2026-08-03T12:00:0${index}.000Z`);
      messages.push(await first.sendMessage(`Message ${index}`));
    }
    expect((await first.listMessages({ limit: 2 })).map((entry) => entry.body)).toEqual([
      'Message 2',
      'Message 3',
    ]);
    expect((await first.listMessages({ limit: 2, before: messages[2].createdAt })).map((entry) => entry.body)).toEqual([
      'Message 0',
      'Message 1',
    ]);

    clock = new Date('2026-08-03T12:01:00.000Z');
    await second.setTyping(true);
    expect((await first.listTyping()).map((entry) => entry.displayName)).toEqual(['B']);
    clock = new Date('2026-08-03T12:01:13.000Z');
    expect(await first.listTyping()).toEqual([]);
  });

  it('delivers local subscription events without echoing typing identities', async () => {
    const storage = new MemoryStorage();
    const first = createProjectChatClient({
      projectId: 'project-a',
      userId: 'user-a',
      clientId: 'client-a',
      displayName: 'A',
      storage,
    });
    const second = createProjectChatClient({
      projectId: 'project-a',
      userId: 'user-b',
      clientId: 'client-b',
      displayName: 'B',
      storage,
    });
    const onMessage = vi.fn();
    const onTyping = vi.fn();
    const dispose = await first.subscribe({ onMessage, onTyping });

    const message = await second.sendMessage('Realtime message');
    await Promise.resolve();
    expect(onMessage).toHaveBeenCalledWith(message, 'insert');

    await second.setTyping(true);
    await Promise.resolve();
    expect(onTyping.mock.calls.at(-1)?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'user-b', clientId: 'client-b' }),
    ]));
    dispose();
  });
});
