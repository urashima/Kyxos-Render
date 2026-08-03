import { createProjectChatClient } from '@kyxos/api-client/chat';
import { mountProjectChatPanel } from './project-chat-panel';
import './project-chat-lab.css';

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `
  <main class="chat-lab">
    <header class="chat-lab-header">
      <div>
        <span class="chat-lab-mark">K</span>
        <div><strong>Kyxos Project Chat Lab</strong><small>Private project conversation and typing acceptance</small></div>
      </div>
      <div class="chat-lab-actions">
        <button id="chat-reset" type="button">Reset conversation</button>
        <a href="../">Back to Studio</a>
      </div>
    </header>
    <section class="chat-lab-summary">
      <span>One project</span><span>Two authenticated roles</span><span>Shared local transport</span><span>Same API as Supabase</span>
    </section>
    <section class="chat-lab-grid">
      <article>
        <header><strong>Owner session</strong><small>Can moderate any message</small></header>
        <div id="owner-chat"></div>
      </article>
      <article>
        <header><strong>Editor session</strong><small>Can edit and delete own messages</small></header>
        <div id="editor-chat"></div>
      </article>
    </section>
    <footer>Messages are isolated to <code>chat-lab-project</code>. Reload to verify persistence.</footer>
  </main>
`;

const storageKey = 'kyxos-project-chat-lab-v1';
const projectId = 'chat-lab-project';
const ownerClient = createProjectChatClient({
  projectId,
  userId: 'owner-user',
  clientId: 'owner-client',
  displayName: 'Owner',
  canModerate: true,
  storageKey,
});
const editorClient = createProjectChatClient({
  projectId,
  userId: 'editor-user',
  clientId: 'editor-client',
  displayName: 'Editor',
  storageKey,
});

const ownerPanel = mountProjectChatPanel({
  container: document.querySelector<HTMLElement>('#owner-chat')!,
  client: ownerClient,
  currentUserId: 'owner-user',
  canModerate: true,
  title: 'Project Chat · Owner',
  onError: console.error,
});
const editorPanel = mountProjectChatPanel({
  container: document.querySelector<HTMLElement>('#editor-chat')!,
  client: editorClient,
  currentUserId: 'editor-user',
  title: 'Project Chat · Editor',
  onError: console.error,
});

document.querySelector<HTMLButtonElement>('#chat-reset')!.addEventListener('click', () => {
  if (!confirm('Clear the local Chat Lab conversation?')) return;
  localStorage.removeItem(storageKey);
  location.reload();
});

window.addEventListener('pagehide', () => {
  ownerPanel.dispose();
  editorPanel.dispose();
}, { once: true });
