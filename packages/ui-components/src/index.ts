import { createKxIcon, type KxIconName } from '@kyxos/ui-icons';

export type KxTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
export type KxComponentState = 'default' | 'active' | 'loading' | 'error' | 'selected';

export interface KxButtonOptions {
  icon?: KxIconName;
  tone?: KxTone;
  variant?: 'solid' | 'soft' | 'ghost';
  title?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: (event: MouseEvent) => void;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  value.className = className;
  return value;
}

export function setKxState(target: HTMLElement, state: KxComponentState): void {
  target.dataset.state = state;
  target.toggleAttribute('aria-busy', state === 'loading');
  target.setAttribute('aria-invalid', state === 'error' ? 'true' : 'false');
  target.setAttribute('aria-selected', state === 'selected' ? 'true' : 'false');
}

export function createKxButton(label: string, options: KxButtonOptions = {}): HTMLButtonElement {
  const control = node('button', 'kx-button');
  control.type = 'button';
  control.dataset.tone = options.tone ?? 'neutral';
  control.dataset.variant = options.variant ?? 'soft';
  control.disabled = options.disabled ?? false;
  control.title = options.title ?? label;
  if (options.icon) control.append(createKxIcon(options.icon));
  const text = node('span', 'kx-button-label');
  text.textContent = label;
  control.append(text);
  if (options.loading) setKxState(control, 'loading');
  if (options.onClick) control.addEventListener('click', options.onClick);
  return control;
}

export function createKxIconButton(icon: KxIconName, label: string, action: () => void): HTMLButtonElement {
  const control = createKxButton(label, { icon, variant: 'ghost', onClick: action });
  control.classList.add('kx-icon-button');
  control.querySelector('.kx-button-label')?.classList.add('kx-visually-hidden');
  control.setAttribute('aria-label', label);
  return control;
}

export function createKxPanel(title: string, content?: HTMLElement): HTMLElement {
  const panel = node('section', 'kx-panel');
  const header = node('header', 'kx-panel-header');
  const heading = node('h2', 'kx-panel-title');
  heading.textContent = title;
  header.append(heading);
  const body = content ?? node('div', 'kx-panel-body');
  body.classList.add('kx-panel-body');
  panel.append(header, body);
  return panel;
}

export function createKxFloatingPanel(title: string, content?: HTMLElement): HTMLElement {
  const panel = createKxPanel(title, content);
  panel.classList.add('kx-floating-panel');
  return panel;
}

export function createKxSection(title: string, expanded = true): HTMLDetailsElement {
  const section = node('details', 'kx-section');
  section.open = expanded;
  const summary = node('summary', 'kx-section-header');
  const label = node('span', 'kx-section-title');
  label.textContent = title;
  summary.append(label, createKxIcon('chevron'));
  section.append(summary);
  return section;
}

export function createKxPropertyRow(label: string, control: HTMLElement, help?: string): HTMLElement {
  const row = node('label', 'kx-property-row');
  const name = node('span', 'kx-property-label');
  name.textContent = label;
  if (help) {
    name.title = help;
    name.dataset.tooltip = help;
  }
  const slot = node('span', 'kx-property-control');
  slot.append(control);
  row.append(name, slot);
  return row;
}

export function createKxStatusPill(label: string, tone: KxTone = 'neutral'): HTMLElement {
  const pill = node('span', 'kx-status-pill');
  pill.dataset.tone = tone;
  pill.textContent = label;
  return pill;
}

export function createKxBadge(label: string, tone: KxTone = 'neutral'): HTMLElement {
  const badge = node('span', 'kx-badge');
  badge.dataset.tone = tone;
  badge.textContent = label;
  return badge;
}

export interface KxTab { id: string; label: string; icon?: KxIconName; }
export function createKxTabs(tabs: KxTab[], initial: string, onChange: (id: string) => void): HTMLElement {
  const root = node('div', 'kx-tabs');
  root.setAttribute('role', 'tablist');
  for (const tab of tabs) {
    const button = createKxButton(tab.label, { icon: tab.icon, variant: 'ghost' });
    button.dataset.tab = tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(tab.id === initial));
    button.addEventListener('click', () => {
      for (const other of root.querySelectorAll<HTMLElement>('[role=tab]')) other.setAttribute('aria-selected', String(other === button));
      onChange(tab.id);
    });
    root.append(button);
  }
  return root;
}

export function createKxProgress(value = 0, label = 'Progress'): HTMLElement {
  const root = node('div', 'kx-progress');
  root.setAttribute('role', 'progressbar');
  root.setAttribute('aria-label', label);
  root.setAttribute('aria-valuemin', '0');
  root.setAttribute('aria-valuemax', '100');
  const fill = node('span', 'kx-progress-fill');
  root.append(fill);
  setKxProgress(root, value);
  return root;
}

export function setKxProgress(root: HTMLElement, value: number): void {
  const clamped = Math.max(0, Math.min(100, value));
  root.setAttribute('aria-valuenow', String(clamped));
  const fill = root.querySelector<HTMLElement>('.kx-progress-fill');
  if (fill) fill.style.width = `${clamped}%`;
}

export function createKxEmptyState(title: string, detail: string, action?: HTMLButtonElement): HTMLElement {
  const root = node('div', 'kx-empty-state');
  const heading = node('strong', 'kx-empty-title');
  heading.textContent = title;
  const copy = node('p', 'kx-empty-detail');
  copy.textContent = detail;
  root.append(heading, copy);
  if (action) root.append(action);
  return root;
}

export function createKxErrorState(title: string, detail: string, retry?: () => void): HTMLElement {
  const action = retry ? createKxButton('Try again', { icon: 'reset', tone: 'danger', onClick: retry }) : undefined;
  const root = createKxEmptyState(title, detail, action);
  root.classList.add('kx-error-state');
  root.prepend(createKxIcon('error'));
  return root;
}

export function createKxDialog(title: string): HTMLDialogElement {
  const dialog = node('dialog', 'kx-dialog');
  const header = node('header', 'kx-dialog-header');
  const heading = node('h2', 'kx-dialog-title');
  heading.textContent = title;
  const close = createKxIconButton('close', 'Close', () => dialog.close());
  header.append(heading, close);
  const body = node('div', 'kx-dialog-body');
  dialog.append(header, body);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  return dialog;
}

export interface KxCommand { id: string; label: string; category?: string; shortcut?: string; keywords?: string[]; run: () => void; }
export function createKxCommandPalette(commands: KxCommand[]): HTMLDialogElement {
  const dialog = node('dialog', 'kx-command-palette');
  dialog.setAttribute('aria-label', 'Command palette');
  const search = node('input', 'kx-command-search');
  search.type = 'search';
  search.placeholder = 'Search commands…';
  search.setAttribute('aria-label', 'Search commands');
  const results = node('div', 'kx-command-results');
  dialog.append(search, results);

  const render = () => {
    const query = search.value.trim().toLowerCase();
    results.replaceChildren();
    const filtered = commands.filter((command) => [command.label, command.category, ...(command.keywords ?? [])].filter(Boolean).join(' ').toLowerCase().includes(query));
    for (const command of filtered.slice(0, 18)) {
      const item = createKxButton(command.label, { icon: 'command', variant: 'ghost' });
      item.classList.add('kx-command-item');
      const meta = node('span', 'kx-command-meta');
      meta.textContent = command.shortcut ?? command.category ?? '';
      item.append(meta);
      item.addEventListener('click', () => { dialog.close(); command.run(); });
      results.append(item);
    }
    if (!filtered.length) results.append(createKxEmptyState('No commands', 'Try another name or keyword.'));
  };
  search.addEventListener('input', render);
  dialog.addEventListener('close', () => { search.value = ''; render(); });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') dialog.close();
    if (event.key === 'Enter') (results.querySelector<HTMLButtonElement>('button')?.click());
  });
  render();
  queueMicrotask(() => dialog.addEventListener('toggle', () => search.focus()));
  return dialog;
}

export function createKxToastHost(): HTMLElement {
  const host = node('div', 'kx-toast-host');
  host.setAttribute('aria-live', 'polite');
  return host;
}

export function showKxToast(host: HTMLElement, message: string, tone: KxTone = 'neutral', timeout = 3200): void {
  const toast = node('div', 'kx-toast');
  toast.dataset.tone = tone;
  toast.textContent = message;
  host.append(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), 200);
  }, timeout);
}

export function createKxSlider(min: number, max: number, value: number, step = 0.01): HTMLInputElement {
  const input = node('input', 'kx-slider');
  input.type = 'range'; input.min = String(min); input.max = String(max); input.value = String(value); input.step = String(step);
  return input;
}

export function createKxNumberInput(value = 0, step = 0.1): HTMLInputElement {
  const input = node('input', 'kx-number-input');
  input.type = 'number'; input.value = String(value); input.step = String(step);
  return input;
}

export function createKxTextInput(value = '', placeholder = ''): HTMLInputElement {
  const input = node('input', 'kx-text-input'); input.type = 'text'; input.value = value; input.placeholder = placeholder; return input;
}

export function createKxSearchInput(placeholder = 'Search…'): HTMLInputElement {
  const input = createKxTextInput('', placeholder); input.type = 'search'; input.classList.add('kx-search-input'); return input;
}

export function createKxToggle(checked = false, label = 'Toggle'): HTMLInputElement {
  const input = node('input', 'kx-toggle'); input.type = 'checkbox'; input.checked = checked; input.setAttribute('aria-label', label); return input;
}

export function createKxSelect(options: Array<{ label: string; value: string }>, value?: string): HTMLSelectElement {
  const select = node('select', 'kx-select');
  for (const option of options) select.append(new Option(option.label, option.value));
  if (value != null) select.value = value;
  return select;
}

export function createKxColorInput(value = '#ffffff'): HTMLInputElement { const input = node('input', 'kx-color-input'); input.type = 'color'; input.value = value; return input; }

export function createKxAssetCard(title: string, subtitle = '', thumbnail?: string): HTMLElement {
  const card = node('button', 'kx-asset-card'); card.type = 'button';
  const preview = node('span', 'kx-asset-preview'); if (thumbnail) preview.style.backgroundImage = `url(${thumbnail})`;
  const copy = node('span', 'kx-asset-copy'); const heading = node('strong', 'kx-asset-title'); heading.textContent = title; const detail = node('small', 'kx-asset-subtitle'); detail.textContent = subtitle;
  copy.append(heading, detail); card.append(preview, copy); return card;
}

export function createKxPresetCard(title: string, subtitle = '', thumbnail?: string): HTMLElement { const card = createKxAssetCard(title, subtitle, thumbnail); card.classList.add('kx-preset-card'); return card; }
export function createKxThumbnailStrip(): HTMLElement { return node('div', 'kx-thumbnail-strip'); }
export function createKxBreadcrumb(items: string[]): HTMLElement { const root = node('nav', 'kx-breadcrumb'); root.setAttribute('aria-label', 'Breadcrumb'); items.forEach((item, index) => { const span = node('span', 'kx-breadcrumb-item'); span.textContent = item; root.append(span); if (index < items.length - 1) root.append(document.createTextNode('/')); }); return root; }

export const KxPanel = createKxPanel;
export const KxFloatingPanel = createKxFloatingPanel;
export const KxSection = createKxSection;
export const KxSectionHeader = createKxSection;
export const KxButton = createKxButton;
export const KxIconButton = createKxIconButton;
export const KxSplitButton = createKxButton;
export const KxSegmentedControl = createKxTabs;
export const KxToggle = createKxToggle;
export const KxSlider = createKxSlider;
export const KxNumberInput = createKxNumberInput;
export const KxTextInput = createKxTextInput;
export const KxSelect = createKxSelect;
export const KxColorInput = createKxColorInput;
export const KxSearchInput = createKxSearchInput;
export const KxStatusPill = createKxStatusPill;
export const KxBadge = createKxBadge;
export const KxTooltip = createKxStatusPill;
export const KxPopover = createKxFloatingPanel;
export const KxContextMenu = createKxFloatingPanel;
export const KxDialog = createKxDialog;
export const KxToast = showKxToast;
export const KxProgress = createKxProgress;
export const KxEmptyState = createKxEmptyState;
export const KxErrorState = createKxErrorState;
export const KxAssetCard = createKxAssetCard;
export const KxPresetCard = createKxPresetCard;
export const KxThumbnailStrip = createKxThumbnailStrip;
export const KxPropertyRow = createKxPropertyRow;
export const KxInspectorGroup = createKxSection;
export const KxBreadcrumb = createKxBreadcrumb;
export const KxTabs = createKxTabs;
export const KxCommandPalette = createKxCommandPalette;
