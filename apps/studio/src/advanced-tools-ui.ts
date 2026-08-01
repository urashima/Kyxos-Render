import type {
  DiagnosticConsole,
  JsonRpcRequest,
  StudioApi,
  StudioMcpBridge,
  StudioPluginPermission,
  StudioPluginRegistry,
} from '@kyxos/editor-core';
import { button, element } from '@kyxos/shared-ui';

export interface AdvancedToolsOptions {
  dialog: HTMLDialogElement;
  console: DiagnosticConsole;
  api: StudioApi;
  plugins: StudioPluginRegistry;
  mcp: StudioMcpBridge;
  canEdit: boolean;
  onError(error: unknown): void;
}

export function mountAdvancedTools(options: AdvancedToolsOptions): () => void {
  let active: 'console' | 'commands' | 'plugins' | 'mcp' = 'console';
  let disposed = false;
  const header = element('header', { className: 'dialog-header' });
  header.append(
    element('h2', { text: 'Studio Tools' }),
    button('Close', () => options.dialog.close(), 'secondary'),
  );
  const tabs = element('nav', { className: 'advanced-tabs' });
  const content = element('section', { className: 'advanced-tools-content' });
  options.dialog.replaceChildren(header, tabs, content);

  function render(): void {
    tabs.replaceChildren();
    for (const [id, label] of [
      ['console', 'Console'],
      ['commands', 'Studio API'],
      ['plugins', 'Plugins'],
      ['mcp', 'MCP'],
    ] as const) {
      tabs.append(button(label, () => {
        active = id;
        render();
      }, active === id ? 'active' : 'secondary'));
    }
    content.replaceChildren();
    if (active === 'console') renderConsole();
    if (active === 'commands') renderCommands();
    if (active === 'plugins') renderPlugins();
    if (active === 'mcp') renderMcp();
  }

  function renderConsole(): void {
    const toolbar = element('div', { className: 'console-toolbar' });
    const query = element('input', { attrs: { type: 'search', placeholder: 'Filter console', 'aria-label': 'Filter console' } });
    const level = element('select', { attrs: { 'aria-label': 'Console level' } });
    level.append(new Option('All levels', ''), new Option('Debug', 'debug'), new Option('Info', 'info'), new Option('Warnings', 'warn'), new Option('Errors', 'error'));
    const list = element('div', { className: 'diagnostic-console' });
    const refresh = () => {
      list.replaceChildren();
      const entries = options.console.list({
        query: query.value,
        levels: level.value ? [level.value as 'debug' | 'info' | 'warn' | 'error'] : undefined,
      });
      for (const entry of entries) {
        const row = element('article', { className: `console-entry ${entry.level}` });
        row.append(
          element('time', { text: new Date(entry.timestamp).toLocaleTimeString() }),
          element('span', { text: entry.source ?? 'studio' }),
          element('pre', { text: entry.message }),
        );
        if (entry.data !== undefined) row.append(element('code', { text: compactJson(entry.data) }));
        list.append(row);
      }
      if (!entries.length) list.append(element('p', { className: 'muted', text: 'No console entries match this filter.' }));
    };
    query.addEventListener('input', refresh);
    level.addEventListener('change', refresh);
    toolbar.append(
      query,
      level,
      button('Clear', () => { options.console.clear(); refresh(); }, 'mini'),
      button('Export', () => downloadText('kyxos-console.json', options.console.export()), 'mini'),
    );
    content.append(toolbar, list);
    refresh();
  }

  function renderCommands(): void {
    content.append(element('p', {
      className: 'advanced-intro',
      text: 'The stable Studio API exposes scene reads, undoable JSON Patch writes, selection, commands, and extension panels.',
    }));
    const table = element('div', { className: 'studio-command-list' });
    for (const command of options.api.listCommands()) {
      const row = element('article', { className: 'studio-command-row' });
      const copy = element('div');
      copy.append(
        element('strong', { text: command.label }),
        element('code', { text: command.id }),
      );
      const run = button('Run', async () => {
        try { await options.api.runCommand(command.id); }
        catch (error) { options.onError(error); }
      }, 'mini');
      run.disabled = command.enabled?.() === false;
      row.append(copy, command.shortcut ? element('kbd', { text: command.shortcut }) : element('span'), run);
      table.append(row);
    }
    if (!options.api.listCommands().length) table.append(element('p', { className: 'muted', text: 'No commands registered.' }));
    content.append(table);
  }

  function renderPlugins(): void {
    const toolbar = element('div', { className: 'dialog-toolbar' });
    const register = button('Register Manifest', () => {
      const raw = prompt('Plugin manifest JSON', JSON.stringify({
        id: `local.plugin.${Date.now()}`,
        name: 'Local Plugin',
        version: '1.0.0',
        permissions: ['scene:read'],
      }, null, 2));
      if (!raw) return;
      try {
        const manifest = JSON.parse(raw);
        options.plugins.register({
          manifest,
          activate(context) {
            context.console.log('info', `${context.manifest.name} activated.`, context.manifest.permissions, context.manifest.id);
          },
        });
        render();
      } catch (error) { options.onError(error); }
    }, 'secondary');
    register.disabled = !options.canEdit;
    toolbar.append(register);
    content.append(toolbar);
    for (const plugin of options.plugins.list()) {
      const row = element('article', { className: 'plugin-row' });
      const copy = element('div');
      copy.append(
        element('strong', { text: `${plugin.name} · ${plugin.version}` }),
        element('code', { text: plugin.id }),
        element('span', { text: plugin.permissions.length ? plugin.permissions.join(', ') : 'No permissions' }),
      );
      const toggle = button(plugin.active ? 'Deactivate' : 'Activate', async () => {
        try {
          if (plugin.active) options.plugins.deactivate(plugin.id);
          else await options.plugins.activate(plugin.id, plugin.permissions as StudioPluginPermission[]);
          render();
        } catch (error) { options.onError(error); }
      }, plugin.active ? 'active' : 'secondary');
      toggle.disabled = !options.canEdit;
      row.append(copy, toggle);
      if (plugin.error) row.append(element('p', { className: 'field-error', text: plugin.error }));
      content.append(row);
    }
  }

  function renderMcp(): void {
    content.append(element('p', {
      className: 'advanced-intro',
      text: `Local MCP bridge · protocol 2025-06-18 · write tools ${options.canEdit ? 'enabled for this role' : 'disabled'}.`,
    }));
    const request = element('textarea', { className: 'mcp-request' });
    request.value = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null, 2);
    const response = element('pre', { className: 'mcp-response', text: 'Send a JSON-RPC request to inspect the bridge.' });
    const examples = element('select', { attrs: { 'aria-label': 'MCP request example' } });
    examples.append(
      new Option('List tools', 'tools/list'),
      new Option('List resources', 'resources/list'),
      new Option('Read active scene', 'resources/read'),
      new Option('Get selection', 'studio.get_selection'),
    );
    examples.addEventListener('change', () => {
      const value = examples.value === 'resources/read'
        ? { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'kyxos://scene/active' } }
        : examples.value === 'studio.get_selection'
          ? { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'studio.get_selection', arguments: {} } }
          : { jsonrpc: '2.0', id: 1, method: examples.value };
      request.value = JSON.stringify(value, null, 2);
    });
    const send = button('Send JSON-RPC', async () => {
      try {
        const value = JSON.parse(request.value) as JsonRpcRequest;
        response.textContent = JSON.stringify(await options.mcp.handle(value), null, 2);
      } catch (error) { options.onError(error); }
    }, 'primary');
    content.append(element('div', { className: 'mcp-toolbar' }), request, send, response);
    content.querySelector('.mcp-toolbar')!.append(examples);
  }

  const refreshConsole = () => { if (active === 'console') render(); };
  const refreshPlugins = () => { if (active === 'plugins') render(); };
  options.console.addEventListener('entry', refreshConsole);
  options.console.addEventListener('clear', refreshConsole);
  options.plugins.addEventListener('change', refreshPlugins);
  const onClose = () => dispose();
  options.dialog.addEventListener('close', onClose, { once: true });
  render();
  if (!options.dialog.open) options.dialog.showModal();

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    options.console.removeEventListener('entry', refreshConsole);
    options.console.removeEventListener('clear', refreshConsole);
    options.plugins.removeEventListener('change', refreshPlugins);
  }
  return dispose;
}

function compactJson(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 500 ? `${text.slice(0, 497)}…` : text;
}

function downloadText(name: string, value: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
  const anchor = element('a', { attrs: { href: url, download: name } });
  anchor.click();
  URL.revokeObjectURL(url);
}
