import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

export interface ProjectChatMessage {
  id: string;
  projectId: string;
  userId: string;
  displayName: string;
  body: string;
  replyToId: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ProjectChatTyping {
  projectId: string;
  userId: string;
  clientId: string;
  displayName: string;
  updatedAt: string;
}

export interface ProjectChatSubscription {
  onMessage?(
    message: ProjectChatMessage,
    event: 'insert' | 'update' | 'delete',
  ): void;
  onTyping?(typing: ProjectChatTyping[]): void;
  onStatus?(status: 'connecting' | 'connected' | 'disconnected' | 'error', error?: unknown): void;
}

export interface ProjectChatStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ProjectChatClientOptions {
  projectId: string;
  userId: string;
  clientId: string;
  displayName: string;
  url?: string;
  anonKey?: string;
  accessToken?: string;
  canModerate?: boolean;
  storage?: ProjectChatStorage | null;
  storageKey?: string;
  now?: () => Date;
}

export interface ProjectChatClient {
  listMessages(input?: { limit?: number; before?: string }): Promise<ProjectChatMessage[]>;
  listTyping(): Promise<ProjectChatTyping[]>;
  sendMessage(body: string, replyToId?: string | null): Promise<ProjectChatMessage>;
  editMessage(messageId: string, body: string): Promise<ProjectChatMessage>;
  deleteMessage(messageId: string): Promise<ProjectChatMessage>;
  setTyping(active: boolean): Promise<void>;
  subscribe(subscription: ProjectChatSubscription): Promise<() => void>;
}

interface LocalProjectChatState {
  version: 1;
  messages: ProjectChatMessage[];
  typing: ProjectChatTyping[];
}

const localChatHub = new EventTarget();

function timestamp(options: ProjectChatClientOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

function normalizeDisplayName(value: string): string {
  return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || 'User';
}

export function normalizeChatBody(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!normalized) throw new Error('Chat message cannot be empty.');
  if (normalized.length > 4_000) throw new Error('Chat message cannot exceed 4000 characters.');
  return normalized;
}

function normalizeMessage(row: any): ProjectChatMessage {
  return {
    id: String(row.id),
    projectId: String(row.project_id ?? row.projectId),
    userId: String(row.user_id ?? row.userId),
    displayName: normalizeDisplayName(String(row.display_name ?? row.displayName ?? 'User')),
    body: String(row.body ?? ''),
    replyToId: row.reply_to_id ?? row.replyToId ?? null,
    createdAt: String(row.created_at ?? row.createdAt),
    editedAt: row.edited_at ?? row.editedAt ?? null,
    deletedAt: row.deleted_at ?? row.deletedAt ?? null,
  };
}

function normalizeTyping(row: any): ProjectChatTyping {
  return {
    projectId: String(row.project_id ?? row.projectId),
    userId: String(row.user_id ?? row.userId),
    clientId: String(row.client_id ?? row.clientId),
    displayName: normalizeDisplayName(String(row.display_name ?? row.displayName ?? 'User')),
    updatedAt: String(row.updated_at ?? row.updatedAt),
  };
}

function createEmptyLocalState(): LocalProjectChatState {
  return { version: 1, messages: [], typing: [] };
}

class LocalProjectChatClient implements ProjectChatClient {
  private readonly storage: ProjectChatStorage | null;
  private readonly storageKey: string;
  private readonly displayName: string;
  private channel: BroadcastChannel | null = null;

  constructor(private readonly options: ProjectChatClientOptions) {
    this.storage = options.storage === undefined
      ? typeof localStorage === 'undefined' ? null : localStorage
      : options.storage;
    this.storageKey = options.storageKey ?? 'kyxos-project-chat-local-v1';
    this.displayName = normalizeDisplayName(options.displayName);
  }

  private load(): LocalProjectChatState {
    try {
      const value = JSON.parse(this.storage?.getItem(this.storageKey) ?? 'null') as LocalProjectChatState | null;
      if (value?.version === 1 && Array.isArray(value.messages) && Array.isArray(value.typing)) {
        return structuredClone(value);
      }
    } catch {
      this.storage?.removeItem(this.storageKey);
    }
    return createEmptyLocalState();
  }

  private save(state: LocalProjectChatState): void {
    this.storage?.setItem(this.storageKey, JSON.stringify(state));
  }

  private projectMessages(state: LocalProjectChatState): ProjectChatMessage[] {
    return state.messages.filter((entry) => entry.projectId === this.options.projectId);
  }

  private emit(payload: unknown): void {
    const eventName = `project:${this.options.projectId}`;
    localChatHub.dispatchEvent(new CustomEvent(eventName, { detail: structuredClone(payload) }));
    this.channel?.postMessage(payload);
  }

  async listMessages(input: { limit?: number; before?: string } = {}): Promise<ProjectChatMessage[]> {
    const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 100)));
    return this.projectMessages(this.load())
      .filter((entry) => !input.before || entry.createdAt < input.before)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .reverse()
      .map((entry) => structuredClone(entry));
  }

  async listTyping(): Promise<ProjectChatTyping[]> {
    const state = this.load();
    const cutoff = (this.options.now?.() ?? new Date()).getTime() - 12_000;
    const active = state.typing.filter((entry) =>
      entry.projectId === this.options.projectId &&
      entry.clientId !== this.options.clientId &&
      new Date(entry.updatedAt).getTime() >= cutoff,
    );
    if (active.length !== state.typing.filter((entry) => entry.projectId === this.options.projectId).length) {
      state.typing = state.typing.filter((entry) =>
        entry.projectId !== this.options.projectId || new Date(entry.updatedAt).getTime() >= cutoff,
      );
      this.save(state);
    }
    return active.map((entry) => structuredClone(entry));
  }

  async sendMessage(body: string, replyToId: string | null = null): Promise<ProjectChatMessage> {
    const state = this.load();
    if (replyToId && !this.projectMessages(state).some((entry) => entry.id === replyToId)) {
      throw new Error('Reply target does not exist in this project.');
    }
    const message: ProjectChatMessage = {
      id: crypto.randomUUID(),
      projectId: this.options.projectId,
      userId: this.options.userId,
      displayName: this.displayName,
      body: normalizeChatBody(body),
      replyToId,
      createdAt: timestamp(this.options),
      editedAt: null,
      deletedAt: null,
    };
    state.messages.push(message);
    state.messages = state.messages.slice(-10_000);
    this.save(state);
    this.emit({ type: 'message', event: 'insert', message });
    return structuredClone(message);
  }

  async editMessage(messageId: string, body: string): Promise<ProjectChatMessage> {
    const state = this.load();
    const message = state.messages.find((entry) =>
      entry.id === messageId && entry.projectId === this.options.projectId,
    );
    if (!message) throw new Error('Chat message not found.');
    if (message.deletedAt) throw new Error('Deleted chat messages cannot be edited.');
    if (message.userId !== this.options.userId && !this.options.canModerate) {
      throw new Error('Only the author or project owner can edit this message.');
    }
    message.body = normalizeChatBody(body);
    message.editedAt = timestamp(this.options);
    this.save(state);
    this.emit({ type: 'message', event: 'update', message });
    return structuredClone(message);
  }

  async deleteMessage(messageId: string): Promise<ProjectChatMessage> {
    const state = this.load();
    const message = state.messages.find((entry) =>
      entry.id === messageId && entry.projectId === this.options.projectId,
    );
    if (!message) throw new Error('Chat message not found.');
    if (message.userId !== this.options.userId && !this.options.canModerate) {
      throw new Error('Only the author or project owner can delete this message.');
    }
    if (!message.deletedAt) {
      message.body = '';
      message.deletedAt = timestamp(this.options);
      message.editedAt = message.deletedAt;
      this.save(state);
      this.emit({ type: 'message', event: 'update', message });
    }
    return structuredClone(message);
  }

  async setTyping(active: boolean): Promise<void> {
    const state = this.load();
    state.typing = state.typing.filter((entry) => !(
      entry.projectId === this.options.projectId &&
      entry.userId === this.options.userId &&
      entry.clientId === this.options.clientId
    ));
    if (active) {
      state.typing.push({
        projectId: this.options.projectId,
        userId: this.options.userId,
        clientId: this.options.clientId,
        displayName: this.displayName,
        updatedAt: timestamp(this.options),
      });
    }
    this.save(state);
    this.emit({ type: 'typing' });
  }

  async subscribe(subscription: ProjectChatSubscription): Promise<() => void> {
    subscription.onStatus?.('connecting');
    const eventName = `project:${this.options.projectId}`;
    const receive = async (payload: any): Promise<void> => {
      if (payload?.type === 'message' && payload.message?.projectId === this.options.projectId) {
        subscription.onMessage?.(normalizeMessage(payload.message), payload.event ?? 'update');
      }
      if (payload?.type === 'typing') subscription.onTyping?.(await this.listTyping());
    };
    const onLocal = (event: Event) => { void receive((event as CustomEvent).detail) };
    const onBroadcast = (event: MessageEvent) => { void receive(event.data) };
    localChatHub.addEventListener(eventName, onLocal);
    this.channel = typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(`kyxos-chat:${this.options.projectId}`);
    this.channel?.addEventListener('message', onBroadcast);
    subscription.onTyping?.(await this.listTyping());
    subscription.onStatus?.('connected');
    return () => {
      void this.setTyping(false).catch(() => undefined);
      localChatHub.removeEventListener(eventName, onLocal);
      this.channel?.removeEventListener('message', onBroadcast);
      this.channel?.close();
      this.channel = null;
      subscription.onStatus?.('disconnected');
    };
  }
}

class SupabaseProjectChatClient implements ProjectChatClient {
  private readonly client: SupabaseClient;
  private readonly displayName: string;
  private channel: RealtimeChannel | null = null;

  constructor(private readonly options: ProjectChatClientOptions) {
    if (!options.url || !options.anonKey || !options.accessToken) {
      throw new Error('Supabase project chat requires url, anonKey and accessToken.');
    }
    this.displayName = normalizeDisplayName(options.displayName);
    this.client = createClient(options.url, options.anonKey, {
      global: { headers: { authorization: `Bearer ${options.accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    this.client.realtime.setAuth(options.accessToken);
  }

  async listMessages(input: { limit?: number; before?: string } = {}): Promise<ProjectChatMessage[]> {
    const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 100)));
    let query = this.client
      .from('project_chat_messages')
      .select('*')
      .eq('project_id', this.options.projectId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (input.before) query = query.lt('created_at', input.before);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(normalizeMessage).reverse();
  }

  async listTyping(): Promise<ProjectChatTyping[]> {
    const cutoff = new Date((this.options.now?.() ?? new Date()).getTime() - 12_000).toISOString();
    const { data, error } = await this.client
      .from('project_chat_typing')
      .select('*')
      .eq('project_id', this.options.projectId)
      .neq('client_id', this.options.clientId)
      .gte('updated_at', cutoff)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(normalizeTyping);
  }

  async sendMessage(body: string, replyToId: string | null = null): Promise<ProjectChatMessage> {
    const { data, error } = await this.client
      .from('project_chat_messages')
      .insert({
        project_id: this.options.projectId,
        user_id: this.options.userId,
        display_name: this.displayName,
        body: normalizeChatBody(body),
        reply_to_id: replyToId,
      })
      .select()
      .single();
    if (error) throw error;
    return normalizeMessage(data);
  }

  async editMessage(messageId: string, body: string): Promise<ProjectChatMessage> {
    const { data, error } = await this.client
      .from('project_chat_messages')
      .update({ body: normalizeChatBody(body), edited_at: timestamp(this.options) })
      .eq('project_id', this.options.projectId)
      .eq('id', messageId)
      .is('deleted_at', null)
      .select()
      .single();
    if (error) throw error;
    return normalizeMessage(data);
  }

  async deleteMessage(messageId: string): Promise<ProjectChatMessage> {
    const deletedAt = timestamp(this.options);
    const { data, error } = await this.client
      .from('project_chat_messages')
      .update({ body: '', edited_at: deletedAt, deleted_at: deletedAt })
      .eq('project_id', this.options.projectId)
      .eq('id', messageId)
      .select()
      .single();
    if (error) throw error;
    return normalizeMessage(data);
  }

  async setTyping(active: boolean): Promise<void> {
    if (active) {
      const { error } = await this.client.from('project_chat_typing').upsert({
        project_id: this.options.projectId,
        user_id: this.options.userId,
        client_id: this.options.clientId,
        display_name: this.displayName,
        updated_at: timestamp(this.options),
      });
      if (error) throw error;
      return;
    }
    const { error } = await this.client
      .from('project_chat_typing')
      .delete()
      .eq('project_id', this.options.projectId)
      .eq('user_id', this.options.userId)
      .eq('client_id', this.options.clientId);
    if (error) throw error;
  }

  async subscribe(subscription: ProjectChatSubscription): Promise<() => void> {
    subscription.onStatus?.('connecting');
    this.client.realtime.setAuth(this.options.accessToken!);
    const refreshTyping = async () => {
      try {
        subscription.onTyping?.(await this.listTyping());
      } catch (error) {
        subscription.onStatus?.('error', error);
      }
    };
    const channel = this.client.channel(`project:${this.options.projectId}`, {
      config: {
        private: true,
        broadcast: { self: false, ack: true },
        presence: { key: this.options.clientId },
      },
    });
    channel
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_chat_messages',
          filter: `project_id=eq.${this.options.projectId}`,
        },
        (payload: any) => {
          const row = payload.new?.id ? payload.new : payload.old;
          if (!row?.id) return;
          const event = payload.eventType === 'INSERT'
            ? 'insert'
            : payload.eventType === 'DELETE'
              ? 'delete'
              : 'update';
          subscription.onMessage?.(normalizeMessage(row), event);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_chat_typing',
          filter: `project_id=eq.${this.options.projectId}`,
        },
        () => { void refreshTyping() },
      );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Project chat realtime connection timed out.')), 10_000);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timeout);
          reject(new Error(`Project chat realtime connection failed: ${status}.`));
        }
      });
    }).catch((error) => {
      subscription.onStatus?.('error', error);
      throw error;
    });
    this.channel = channel;
    await refreshTyping();
    subscription.onStatus?.('connected');
    return () => {
      void this.setTyping(false).catch(() => undefined);
      void this.client.removeChannel(channel);
      if (this.channel === channel) this.channel = null;
      subscription.onStatus?.('disconnected');
    };
  }
}

export function createProjectChatClient(options: ProjectChatClientOptions): ProjectChatClient {
  if (!options.projectId || !options.userId || !options.clientId) {
    throw new Error('Project chat requires projectId, userId and clientId.');
  }
  return options.url && options.anonKey
    ? new SupabaseProjectChatClient(options)
    : new LocalProjectChatClient(options);
}
