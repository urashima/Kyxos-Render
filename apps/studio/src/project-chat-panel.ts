import type {
  ProjectChatClient,
  ProjectChatMessage,
  ProjectChatTyping,
} from '@kyxos/api-client/chat';
import './project-chat.css';

export interface ProjectChatPanelOptions {
  container: HTMLElement;
  client: ProjectChatClient;
  currentUserId: string;
  canModerate?: boolean;
  title?: string;
  pageSize?: number;
  onError?(error: unknown): void;
}

export interface ProjectChatPanelHandle {
  refresh(): Promise<void>;
  focusComposer(): void;
  dispose(): void;
}

interface ChatPanelState {
  messages: ProjectChatMessage[];
  typing: ProjectChatTyping[];
  replyToId: string | null;
  editingId: string | null;
  loading: boolean;
  loadingOlder: boolean;
  connected: boolean;
  hasOlder: boolean;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
    : '';
}

function sameDay(left: string, right: string): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function dayLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
    : '';
}

function upsert(messages: ProjectChatMessage[], message: ProjectChatMessage): ProjectChatMessage[] {
  const next = messages.filter((entry) => entry.id !== message.id);
  next.push(structuredClone(message));
  return next.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function createButton(label: string, className = ''): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button';
  control.textContent = label;
  control.className = className;
  return control;
}

export function mountProjectChatPanel(options: ProjectChatPanelOptions): ProjectChatPanelHandle {
  const pageSize = Math.max(10, Math.min(200, options.pageSize ?? 60));
  const state: ChatPanelState = {
    messages: [],
    typing: [],
    replyToId: null,
    editingId: null,
    loading: true,
    loadingOlder: false,
    connected: false,
    hasOlder: true,
  };
  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  let typingTimer: number | null = null;
  let typingHeartbeat: number | null = null;

  const root = document.createElement('section');
  root.className = 'project-chat-panel';
  root.setAttribute('aria-label', options.title ?? 'Project chat');
  root.innerHTML = `
    <header class="project-chat-header">
      <div><strong></strong><small class="project-chat-status">Connecting…</small></div>
      <button type="button" class="project-chat-refresh" aria-label="Refresh chat">↻</button>
    </header>
    <div class="project-chat-scroll">
      <button type="button" class="project-chat-older">Load older messages</button>
      <div class="project-chat-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
      <div class="project-chat-empty"><strong>No messages yet</strong><span>Start a project conversation.</span></div>
    </div>
    <div class="project-chat-typing" aria-live="polite"></div>
    <div class="project-chat-context" hidden>
      <span></span><button type="button" aria-label="Cancel reply or edit">×</button>
    </div>
    <form class="project-chat-composer">
      <textarea rows="2" maxlength="4000" placeholder="Message project members" aria-label="Chat message"></textarea>
      <div><span class="project-chat-count">0 / 4000</span><button type="submit" class="primary">Send</button></div>
    </form>
  `;
  options.container.replaceChildren(root);

  root.querySelector<HTMLElement>('.project-chat-header strong')!.textContent = options.title ?? 'Project Chat';
  const status = root.querySelector<HTMLElement>('.project-chat-status')!;
  const refreshButton = root.querySelector<HTMLButtonElement>('.project-chat-refresh')!;
  const scroll = root.querySelector<HTMLElement>('.project-chat-scroll')!;
  const olderButton = root.querySelector<HTMLButtonElement>('.project-chat-older')!;
  const messagesHost = root.querySelector<HTMLElement>('.project-chat-messages')!;
  const empty = root.querySelector<HTMLElement>('.project-chat-empty')!;
  const typingHost = root.querySelector<HTMLElement>('.project-chat-typing')!;
  const contextHost = root.querySelector<HTMLElement>('.project-chat-context')!;
  const contextLabel = contextHost.querySelector<HTMLElement>('span')!;
  const cancelContext = contextHost.querySelector<HTMLButtonElement>('button')!;
  const form = root.querySelector<HTMLFormElement>('.project-chat-composer')!;
  const textarea = form.querySelector<HTMLTextAreaElement>('textarea')!;
  const count = form.querySelector<HTMLElement>('.project-chat-count')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;

  function reportError(error: unknown): void {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.dataset.state = 'error';
    options.onError?.(error);
  }

  function messageById(id: string | null): ProjectChatMessage | null {
    return id ? state.messages.find((entry) => entry.id === id) ?? null : null;
  }

  function syncContext(): void {
    const reply = messageById(state.replyToId);
    const editing = messageById(state.editingId);
    contextHost.hidden = !reply && !editing;
    contextLabel.textContent = editing
      ? `Editing your message from ${formatTime(editing.createdAt)}`
      : reply
        ? `Replying to ${reply.displayName}: ${reply.deletedAt ? 'Deleted message' : reply.body.slice(0, 100)}`
        : '';
    submit.textContent = editing ? 'Save' : 'Send';
  }

  function resetContext(): void {
    state.replyToId = null;
    state.editingId = null;
    textarea.value = '';
    count.textContent = '0 / 4000';
    syncContext();
  }

  function renderTyping(): void {
    const names = [...new Set(state.typing.map((entry) => entry.displayName))];
    typingHost.textContent = names.length === 0
      ? ''
      : names.length === 1
        ? `${names[0]} is typing…`
        : names.length === 2
          ? `${names[0]} and ${names[1]} are typing…`
          : `${names.slice(0, 2).join(', ')} and ${names.length - 2} others are typing…`;
  }

  function renderMessages(preserveScroll = false): void {
    const previousBottom = scroll.scrollHeight - scroll.scrollTop;
    messagesHost.replaceChildren();
    empty.hidden = state.loading || state.messages.length > 0;
    olderButton.hidden = !state.hasOlder || state.loading;
    olderButton.disabled = state.loadingOlder;
    olderButton.textContent = state.loadingOlder ? 'Loading…' : 'Load older messages';

    let previous: ProjectChatMessage | null = null;
    for (const message of state.messages) {
      if (!previous || !sameDay(previous.createdAt, message.createdAt)) {
        const separator = document.createElement('div');
        separator.className = 'project-chat-day';
        separator.textContent = dayLabel(message.createdAt);
        messagesHost.append(separator);
      }
      const article = document.createElement('article');
      article.className = 'project-chat-message';
      article.dataset.messageId = message.id;
      article.classList.toggle('own', message.userId === options.currentUserId);
      article.classList.toggle('deleted', Boolean(message.deletedAt));

      const header = document.createElement('header');
      const author = document.createElement('strong');
      author.textContent = message.displayName;
      const time = document.createElement('time');
      time.dateTime = message.createdAt;
      time.textContent = formatTime(message.createdAt);
      if (message.editedAt && !message.deletedAt) time.textContent += ' · edited';
      header.append(author, time);

      const reply = messageById(message.replyToId);
      if (message.replyToId) {
        const quote = document.createElement('button');
        quote.type = 'button';
        quote.className = 'project-chat-quote';
        quote.textContent = reply
          ? `${reply.displayName}: ${reply.deletedAt ? 'Deleted message' : reply.body.slice(0, 140)}`
          : 'Previous message unavailable';
        quote.addEventListener('click', () => {
          const target = messagesHost.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(message.replyToId!)}"]`);
          target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          target?.classList.add('highlight');
          window.setTimeout(() => target?.classList.remove('highlight'), 1_200);
        });
        article.append(header, quote);
      } else {
        article.append(header);
      }

      const body = document.createElement('p');
      body.textContent = message.deletedAt ? 'Message deleted' : message.body;
      article.append(body);

      if (!message.deletedAt) {
        const actions = document.createElement('div');
        actions.className = 'project-chat-actions';
        const replyButton = createButton('Reply');
        replyButton.addEventListener('click', () => {
          state.replyToId = message.id;
          state.editingId = null;
          syncContext();
          textarea.focus();
        });
        actions.append(replyButton);
        if (message.userId === options.currentUserId) {
          const editButton = createButton('Edit');
          editButton.addEventListener('click', () => {
            state.editingId = message.id;
            state.replyToId = null;
            textarea.value = message.body;
            count.textContent = `${textarea.value.length} / 4000`;
            syncContext();
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
          });
          actions.append(editButton);
        }
        if (message.userId === options.currentUserId || options.canModerate) {
          const deleteButton = createButton('Delete', 'danger');
          deleteButton.addEventListener('click', async () => {
            if (!confirm('Delete this project message?')) return;
            try {
              const updated = await options.client.deleteMessage(message.id);
              state.messages = upsert(state.messages, updated);
              renderMessages(true);
            } catch (error) {
              reportError(error);
            }
          });
          actions.append(deleteButton);
        }
        article.append(actions);
      }
      messagesHost.append(article);
      previous = message;
    }

    if (preserveScroll) scroll.scrollTop = Math.max(0, scroll.scrollHeight - previousBottom);
    else scroll.scrollTop = scroll.scrollHeight;
    syncContext();
  }

  async function loadInitial(): Promise<void> {
    state.loading = true;
    renderMessages();
    try {
      const messages = await options.client.listMessages({ limit: pageSize });
      state.messages = messages;
      state.hasOlder = messages.length >= pageSize;
      state.typing = await options.client.listTyping();
      renderTyping();
      status.textContent = state.connected ? 'Connected' : 'Loaded';
      status.dataset.state = state.connected ? 'connected' : 'loaded';
    } catch (error) {
      reportError(error);
    } finally {
      state.loading = false;
      renderMessages();
    }
  }

  async function loadOlder(): Promise<void> {
    if (state.loadingOlder || !state.hasOlder) return;
    state.loadingOlder = true;
    renderMessages(true);
    try {
      const before = state.messages[0]?.createdAt;
      const older = await options.client.listMessages({ limit: pageSize, before });
      state.messages = [...older, ...state.messages.filter((current) => !older.some((entry) => entry.id === current.id))];
      state.hasOlder = older.length >= pageSize;
    } catch (error) {
      reportError(error);
    } finally {
      state.loadingOlder = false;
      renderMessages(true);
    }
  }

  function scheduleTyping(): void {
    if (typingTimer != null) window.clearTimeout(typingTimer);
    if (typingHeartbeat == null && textarea.value.trim()) {
      void options.client.setTyping(true).catch(reportError);
      typingHeartbeat = window.setInterval(() => {
        void options.client.setTyping(Boolean(textarea.value.trim())).catch(reportError);
      }, 5_000);
    }
    typingTimer = window.setTimeout(() => {
      typingTimer = null;
      if (typingHeartbeat != null) {
        window.clearInterval(typingHeartbeat);
        typingHeartbeat = null;
      }
      void options.client.setTyping(false).catch(reportError);
    }, 4_000);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = textarea.value;
    if (!value.trim() || submit.disabled) return;
    submit.disabled = true;
    try {
      const updated = state.editingId
        ? await options.client.editMessage(state.editingId, value)
        : await options.client.sendMessage(value, state.replyToId);
      state.messages = upsert(state.messages, updated);
      resetContext();
      await options.client.setTyping(false);
      renderMessages();
    } catch (error) {
      reportError(error);
    } finally {
      submit.disabled = false;
      textarea.focus();
    }
  });

  textarea.addEventListener('input', () => {
    count.textContent = `${textarea.value.length} / 4000`;
    scheduleTyping();
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    } else if (event.key === 'Escape') {
      resetContext();
    }
  });
  cancelContext.addEventListener('click', resetContext);
  refreshButton.addEventListener('click', () => void loadInitial());
  olderButton.addEventListener('click', () => void loadOlder());

  void (async () => {
    await loadInitial();
    try {
      unsubscribe = await options.client.subscribe({
        onMessage(message) {
          if (disposed) return;
          const wasAtBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40;
          state.messages = upsert(state.messages, message);
          renderMessages(!wasAtBottom);
        },
        onTyping(typing) {
          if (disposed) return;
          state.typing = typing;
          renderTyping();
        },
        onStatus(next, error) {
          if (disposed) return;
          state.connected = next === 'connected';
          status.textContent = next === 'connected'
            ? 'Connected'
            : next === 'connecting'
              ? 'Connecting…'
              : next === 'error'
                ? 'Connection error'
                : 'Offline';
          status.dataset.state = next;
          if (error) options.onError?.(error);
        },
      });
    } catch (error) {
      reportError(error);
    }
  })();

  return {
    refresh: loadInitial,
    focusComposer: () => textarea.focus(),
    dispose() {
      if (disposed) return;
      disposed = true;
      if (typingTimer != null) window.clearTimeout(typingTimer);
      if (typingHeartbeat != null) window.clearInterval(typingHeartbeat);
      unsubscribe?.();
      root.remove();
    },
  };
}
