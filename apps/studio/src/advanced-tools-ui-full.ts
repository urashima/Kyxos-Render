import type {
  DiagnosticConsole,
  JsonRpcRequest,
  StudioApi,
  StudioMcpBridge,
  StudioPluginPermission,
  StudioPluginRegistry,
} from '@kyxos/editor-core';
import {
  convertImage,
  inspectImage,
  type ImageConvertOptions,
  type StudioHelpRegistry,
  type StudioNotificationCenter,
  type StudioSearchRegistry,
  type StudioSettingsStore,
} from '@kyxos/editor-core/experience';
import { button, element } from '@kyxos/shared-ui';

export interface AdvancedToolsOptions {
  dialog: HTMLDialogElement;
  console: DiagnosticConsole;
  api: StudioApi;
  plugins: StudioPluginRegistry;
  mcp: StudioMcpBridge;
  search: StudioSearchRegistry;
  settings: StudioSettingsStore;
  notifications: StudioNotificationCenter;
  help: StudioHelpRegistry;
  canEdit: boolean;
  onError(error: unknown): void;
}

type AdvancedTab =
  | 'search'
  | 'console'
  | 'notifications'
  | 'settings'
  | 'help'
  | 'images'
  | 'commands'
  | 'plugins'
  | 'mcp';

export function mountAdvancedTools(options: AdvancedToolsOptions): () => void {
  let active: AdvancedTab = 'search';
  let disposed = false;
  let imageOutputUrl: string | null = null;
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
      ['search', 'Search'],
      ['console', 'Console'],
      ['notifications', `Notifications${options.notifications.unreadCount ? ` (${options.notifications.unreadCount})` : ''}`],
      ['settings', 'Settings'],
      ['help', 'Help'],
      ['images', 'Images'],
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
    if (active === 'search') renderSearch();
    if (active === 'console') renderConsole();
    if (active === 'notifications') renderNotifications();
    if (active === 'settings') renderSettings();
    if (active === 'help') renderHelp();
    if (active === 'images') renderImages();
    if (active === 'commands') renderCommands();
    if (active === 'plugins') renderPlugins();
    if (active === 'mcp') renderMcp();
  }

  function renderSearch(): void {
    const query = element('input', {
      className: 'global-search-input',
      attrs: {
        type: 'search',
        placeholder: 'Search commands, entities, assets, scenes and templates',
        'aria-label': 'Global Studio search',
        autofocus: '',
      },
    });
    const results = element('div', { className: 'global-search-results' });
    let generation = 0;
    const refresh = async () => {
      const current = ++generation;
      const entries = await options.search.query(query.value, 80);
      if (current !== generation || disposed) return;
      results.replaceChildren();
      for (const entry of entries) {
        const row = button('', async () => {
          if (entry.disabled) return;
          try {
            await entry.run();
            options.dialog.close();
          } catch (error) {
            options.onError(error);
          }
        }, 'global-search-result');
        row.disabled = Boolean(entry.disabled);
        const copy = element('span', { className: 'global-search-copy' });
        copy.append(
          element('strong', { text: entry.label }),
          element('small', { text: entry.description ?? entry.id }),
        );
        row.append(element('span', { className: `search-kind ${entry.kind}`, text: entry.kind }), copy);
        results.append(row);
      }
      if (!entries.length) {
        results.append(element('p', { className: 'muted', text: 'No Studio item matches this query.' }));
      }
    };
    query.addEventListener('input', () => void refresh());
    query.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const first = results.querySelector<HTMLButtonElement>('button:not(:disabled)');
      first?.click();
    });
    content.append(
      element('p', { className: 'advanced-intro', text: 'One index across commands, project entities, assets, scenes, templates, settings and help.' }),
      query,
      results,
    );
    void refresh();
    queueMicrotask(() => query.focus());
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

  function renderNotifications(): void {
    const toolbar = element('div', { className: 'dialog-toolbar' });
    const unread = element('input', { attrs: { type: 'checkbox', id: 'notifications-unread' } });
    const unreadLabel = element('label', { className: 'inline-check' });
    unreadLabel.append(unread, document.createTextNode('Unread only'));
    const severity = element('select', { attrs: { 'aria-label': 'Notification severity' } });
    severity.append(
      new Option('All severities', ''),
      new Option('Information', 'info'),
      new Option('Success', 'success'),
      new Option('Warnings', 'warning'),
      new Option('Errors', 'error'),
    );
    const list = element('div', { className: 'notification-list' });
    const refresh = () => {
      list.replaceChildren();
      const notifications = options.notifications.list({
        unreadOnly: unread.checked,
        severities: severity.value ? [severity.value as 'info' | 'success' | 'warning' | 'error'] : undefined,
      });
      for (const notification of notifications) {
        const row = element('article', {
          className: `notification-row ${notification.severity}${notification.read ? ' read' : ''}`,
        });
        const copy = element('div', { className: 'notification-copy' });
        copy.append(
          element('strong', { text: notification.title }),
          element('p', { text: notification.message }),
          element('small', { text: `${notification.source ?? 'studio'} · ${new Date(notification.timestamp).toLocaleString()}` }),
        );
        if (notification.details !== undefined) copy.append(element('code', { text: compactJson(notification.details) }));
        const actions = element('div', { className: 'inline-actions' });
        actions.append(button(notification.read ? 'Unread' : 'Read', () => {
          options.notifications.markRead(notification.id, !notification.read);
        }, 'mini'));
        if (!notification.persistent) actions.append(button('Dismiss', () => {
          options.notifications.dismiss(notification.id);
        }, 'mini danger'));
        row.append(copy, actions);
        list.append(row);
      }
      if (!notifications.length) list.append(element('p', { className: 'muted', text: 'No notifications match this filter.' }));
    };
    unread.addEventListener('change', refresh);
    severity.addEventListener('change', refresh);
    toolbar.append(
      unreadLabel,
      severity,
      button('Mark all read', () => options.notifications.markAllRead(), 'mini'),
      button('Clear read', () => options.notifications.clearRead(), 'mini'),
    );
    content.append(toolbar, list);
    refresh();
  }

  function renderSettings(): void {
    const form = element('form', { className: 'studio-settings-form' });
    const value = options.settings.value;
    const checkbox = (label: string, key: 'compactDensity' | 'reducedMotion' | 'showTooltips' | 'confirmDestructiveActions') => {
      const row = element('label', { className: 'settings-row' });
      const input = element('input', { attrs: { type: 'checkbox' } });
      input.checked = value[key];
      input.addEventListener('change', () => options.settings.update({ [key]: input.checked }));
      row.append(element('span', { text: label }), input);
      return row;
    };
    const numeric = (label: string, key: 'hierarchyRowHeight' | 'autosaveDelayMs', min: number, max: number, step: number, unit: string) => {
      const row = element('label', { className: 'settings-row' });
      const control = element('span', { className: 'settings-control' });
      const input = element('input', { attrs: { type: 'number', min: String(min), max: String(max), step: String(step), value: String(value[key]) } });
      input.addEventListener('change', () => options.settings.update({ [key]: Number(input.value) }));
      control.append(input, element('small', { text: unit }));
      row.append(element('span', { text: label }), control);
      return row;
    };
    const viewRow = element('label', { className: 'settings-row' });
    const view = element('select', { attrs: { 'aria-label': 'Default asset view' } });
    view.append(new Option('Grid', 'grid'), new Option('List', 'list'));
    view.value = value.assetViewMode;
    view.addEventListener('change', () => options.settings.update({ assetViewMode: view.value as 'grid' | 'list' }));
    viewRow.append(element('span', { text: 'Default asset view' }), view);
    form.append(
      checkbox('Compact editor density', 'compactDensity'),
      checkbox('Reduce non-essential motion', 'reducedMotion'),
      checkbox('Show field tooltips', 'showTooltips'),
      checkbox('Confirm destructive actions', 'confirmDestructiveActions'),
      numeric('Hierarchy row height', 'hierarchyRowHeight', 22, 44, 1, 'px'),
      numeric('Autosave delay', 'autosaveDelayMs', 250, 10_000, 50, 'ms'),
      viewRow,
    );
    const actions = element('div', { className: 'dialog-toolbar' });
    actions.append(
      button('Export', () => downloadText('kyxos-studio-settings.json', options.settings.export()), 'mini'),
      button('Import', () => {
        const serialized = prompt('Paste Studio settings JSON', options.settings.export());
        if (!serialized) return;
        try { options.settings.import(serialized); } catch (error) { options.onError(error); }
      }, 'mini'),
      button('Reset defaults', () => options.settings.reset(), 'mini danger'),
    );
    content.append(
      element('p', { className: 'advanced-intro', text: 'These preferences are stored per user and remain separate from project Scene Contract data.' }),
      form,
      actions,
    );
  }

  function renderHelp(): void {
    const search = element('input', { attrs: { type: 'search', placeholder: 'Search Studio help', 'aria-label': 'Search Studio help' } });
    const onboarding = element('section', { className: 'onboarding-list' });
    const topics = element('section', { className: 'help-topic-list' });
    const refresh = () => {
      onboarding.replaceChildren(element('h3', { text: 'First project checklist' }));
      for (const step of options.help.listSteps()) {
        const row = element('label', { className: `onboarding-step${step.completed ? ' complete' : ''}` });
        const input = element('input', { attrs: { type: 'checkbox' } });
        input.checked = step.completed;
        input.addEventListener('change', () => options.help.setStepCompleted(step.id, input.checked));
        const copy = element('span');
        copy.append(element('strong', { text: step.title }), element('small', { text: step.description }));
        row.append(input, copy);
        onboarding.append(row);
      }
      onboarding.append(button('Reset checklist', () => options.help.resetOnboarding(), 'mini'));
      topics.replaceChildren(element('h3', { text: 'Reference' }));
      for (const topic of options.help.search(search.value)) {
        const details = element('details', { className: 'help-topic' });
        const summary = element('summary');
        summary.append(element('strong', { text: topic.title }), element('small', { text: topic.summary }));
        details.append(summary, element('p', { text: topic.body }));
        if (topic.shortcut) details.append(element('kbd', { text: topic.shortcut }));
        topics.append(details);
      }
    };
    search.addEventListener('input', refresh);
    content.append(search, onboarding, topics);
    refresh();
  }

  function renderImages(): void {
    let selected: File | null = null;
    const picker = element('input', { attrs: { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif' } });
    const report = element('pre', { className: 'image-inspection', text: 'Choose an image to inspect dimensions, format and memory footprint.' });
    const preview = element('img', { className: 'image-tool-preview', attrs: { alt: 'Processed image preview' } });
    const width = element('input', { attrs: { type: 'number', min: '1', max: '16384', placeholder: 'Width' } });
    const height = element('input', { attrs: { type: 'number', min: '1', max: '16384', placeholder: 'Height' } });
    const fit = element('select', { attrs: { 'aria-label': 'Image fit mode' } });
    fit.append(new Option('Contain', 'contain'), new Option('Cover', 'cover'), new Option('Stretch', 'stretch'));
    const format = element('select', { attrs: { 'aria-label': 'Image output format' } });
    format.append(new Option('PNG', 'image/png'), new Option('JPEG', 'image/jpeg'), new Option('WebP', 'image/webp'));
    const quality = element('input', { attrs: { type: 'range', min: '0.1', max: '1', step: '0.05', value: '0.9', 'aria-label': 'Image quality' } });
    const status = element('span', { className: 'muted', text: 'No output generated.' });
    const convert = button('Convert image', async () => {
      if (!selected) return;
      try {
        const output = await convertImage(selected, {
          width: Number(width.value) || undefined,
          height: Number(height.value) || undefined,
          fit: fit.value as ImageConvertOptions['fit'],
          mimeType: format.value as ImageConvertOptions['mimeType'],
          quality: Number(quality.value),
        });
        if (imageOutputUrl) URL.revokeObjectURL(imageOutputUrl);
        imageOutputUrl = URL.createObjectURL(output);
        preview.src = imageOutputUrl;
        status.textContent = `${format.value} · ${formatBytes(output.size)}`;
        const extension = format.value === 'image/jpeg' ? 'jpg' : format.value.split('/')[1];
        const base = selected.name.replace(/\.[^.]+$/, '');
        downloadBlob(`${base}-converted.${extension}`, output);
      } catch (error) {
        options.onError(error);
      }
    }, 'primary');
    convert.disabled = true;
    picker.addEventListener('change', async () => {
      selected = picker.files?.[0] ?? null;
      convert.disabled = !selected;
      if (!selected) return;
      try {
        const inspection = await inspectImage(selected);
        width.value = String(inspection.width);
        height.value = String(inspection.height);
        report.textContent = JSON.stringify({
          name: inspection.name,
          type: inspection.mimeType,
          size: formatBytes(inspection.byteSize),
          dimensions: `${inspection.width} × ${inspection.height}`,
          aspectRatio: Number(inspection.aspectRatio.toFixed(4)),
          megapixels: Number(inspection.megapixels.toFixed(2)),
        }, null, 2);
      } catch (error) {
        options.onError(error);
      }
    });
    const controls = element('div', { className: 'image-tool-controls' });
    controls.append(width, height, fit, format, quality, convert, status);
    content.append(
      element('p', { className: 'advanced-intro', text: 'Inspect, resize and transcode texture source files locally. The browser never uploads the source unless you add the output to the Asset Workspace.' }),
      picker,
      report,
      controls,
      preview,
    );
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
  const refreshNotifications = () => render();
  const refreshSettings = () => { if (active === 'settings') render(); };
  const refreshHelp = () => { if (active === 'help') render(); };
  options.console.addEventListener('entry', refreshConsole);
  options.console.addEventListener('clear', refreshConsole);
  options.plugins.addEventListener('change', refreshPlugins);
  options.notifications.addEventListener('change', refreshNotifications);
  options.settings.addEventListener('change', refreshSettings);
  options.help.addEventListener('change', refreshHelp);
  const onClose = () => dispose();
  options.dialog.addEventListener('close', onClose, { once: true });
  render();
  if (!options.dialog.open) options.dialog.showModal();

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (imageOutputUrl) URL.revokeObjectURL(imageOutputUrl);
    imageOutputUrl = null;
    options.console.removeEventListener('entry', refreshConsole);
    options.console.removeEventListener('clear', refreshConsole);
    options.plugins.removeEventListener('change', refreshPlugins);
    options.notifications.removeEventListener('change', refreshNotifications);
    options.settings.removeEventListener('change', refreshSettings);
    options.help.removeEventListener('change', refreshHelp);
  }
  return dispose;
}

function compactJson(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 500 ? `${text.slice(0, 497)}…` : text;
}

function formatBytes(value: number): string {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function downloadText(name: string, value: string): void {
  downloadBlob(name, new Blob([value], { type: 'application/json' }));
}

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = element('a', { attrs: { href: url, download: name } });
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
