import './studio-controls-reference.css';

type ControlGroup = 'Viewport' | 'Selection' | 'Transform' | 'Panels' | 'Camera & Light' | 'Project';

interface ControlEntry {
  group: ControlGroup;
  action: string;
  shortcut: string;
  detail: string;
}

const controls: ControlEntry[] = [
  { group: 'Viewport', action: 'Orbit', shortcut: 'LMB drag', detail: 'Orbit the editor camera around its target.' },
  { group: 'Viewport', action: 'Pan', shortcut: 'MMB drag / Shift + LMB drag', detail: 'Move the editor camera and target together.' },
  { group: 'Viewport', action: 'Look around', shortcut: 'RMB drag', detail: 'Rotate the editor camera without moving its position.' },
  { group: 'Viewport', action: 'Dolly', shortcut: 'Mouse wheel', detail: 'Move toward or away from the current camera target.' },
  { group: 'Viewport', action: 'Fly', shortcut: 'W / A / S / D', detail: 'Move the editor camera while the viewport is focused or hovered.' },
  { group: 'Viewport', action: 'Fast fly', shortcut: 'Shift + W / A / S / D', detail: 'Temporarily increase editor camera movement speed.' },
  { group: 'Viewport', action: 'Frame selection', shortcut: 'F / Double click', detail: 'Frame the current scene selection.' },
  { group: 'Viewport', action: 'Frame all', shortcut: 'Home', detail: 'Fit all visible scene content.' },
  { group: 'Viewport', action: 'Front / Back', shortcut: 'Numpad 1 / Ctrl + Numpad 1', detail: 'Switch to front or back orthographic view.' },
  { group: 'Viewport', action: 'Right / Left', shortcut: 'Numpad 3 / Ctrl + Numpad 3', detail: 'Switch to right or left orthographic view.' },
  { group: 'Viewport', action: 'Top / Bottom', shortcut: 'Numpad 7 / Ctrl + Numpad 7', detail: 'Switch to top or bottom orthographic view.' },
  { group: 'Viewport', action: 'Perspective', shortcut: 'Numpad 5', detail: 'Return to the perspective editor camera.' },
  { group: 'Viewport', action: 'Camera information', shortcut: 'I', detail: 'Show editable editor-camera position and target.' },
  { group: 'Viewport', action: 'Recall view bookmark', shortcut: 'Alt + 1–9', detail: 'Recall a saved editor-camera view.' },
  { group: 'Viewport', action: 'Save view bookmark', shortcut: 'Alt + Shift + 1–9', detail: 'Save the current editor-camera view.' },
  { group: 'Selection', action: 'Add to selection', shortcut: 'Ctrl/Cmd + click', detail: 'Toggle an entity, Camera or Light in the current selection.' },
  { group: 'Selection', action: 'Range selection', shortcut: 'Shift + click', detail: 'Select a continuous Hierarchy range.' },
  { group: 'Selection', action: 'Previous selection', shortcut: 'Shift + Z', detail: 'Restore the previous scene selection.' },
  { group: 'Selection', action: 'Copy / Cut / Paste', shortcut: 'Ctrl/Cmd + C / X / V', detail: 'Copy, cut or paste full entity subtrees.' },
  { group: 'Selection', action: 'Duplicate', shortcut: 'Ctrl/Cmd + D', detail: 'Duplicate selected entities and their children.' },
  { group: 'Selection', action: 'Rename', shortcut: 'N / F2', detail: 'Start inline rename for the selected entity or asset.' },
  { group: 'Selection', action: 'Delete', shortcut: 'Delete / Backspace', detail: 'Delete the current selection through history.' },
  { group: 'Selection', action: 'Cycle scene objects', shortcut: '[ / ]', detail: 'Cycle the filtered Scene Objects palette.' },
  { group: 'Transform', action: 'Translate', shortcut: '1', detail: 'Activate the translation gizmo.' },
  { group: 'Transform', action: 'Rotate', shortcut: '2', detail: 'Activate the rotation gizmo.' },
  { group: 'Transform', action: 'Scale', shortcut: '3', detail: 'Activate the scale gizmo.' },
  { group: 'Transform', action: 'Local / World', shortcut: 'L', detail: 'Toggle transform coordinate space.' },
  { group: 'Transform', action: 'Temporary snap', shortcut: 'Hold Shift while transforming', detail: 'Temporarily toggle the existing snap setting.' },
  { group: 'Panels', action: 'Hide all panels', shortcut: 'Space', detail: 'Maximize the viewport without changing panel layout.' },
  { group: 'Panels', action: 'Dock / Float panels', shortcut: 'Ctrl/Cmd + Shift + F', detail: 'Toggle the primary editor panels between docked and floating.' },
  { group: 'Panels', action: 'Reset layout', shortcut: 'Ctrl/Cmd + Shift + 0', detail: 'Restore the default docked workspace.' },
  { group: 'Panels', action: 'Editor settings', shortcut: 'Ctrl/Cmd + ,', detail: 'Open persistent density, sizing, motion and touch preferences.' },
  { group: 'Panels', action: 'Controls reference', shortcut: 'Shift + ? / Ctrl/Cmd + Space', detail: 'Open this searchable controls reference.' },
  { group: 'Camera & Light', action: 'Camera palette', shortcut: 'Shift + C', detail: 'Open Scene Objects filtered to Cameras.' },
  { group: 'Camera & Light', action: 'Light palette', shortcut: 'Shift + L', detail: 'Open Scene Objects filtered to Lights.' },
  { group: 'Camera & Light', action: 'Look through Camera', shortcut: 'Scene Objects / View menu', detail: 'Use a scene Camera as the editor viewpoint.' },
  { group: 'Camera & Light', action: 'Match Camera to view', shortcut: 'Scene Objects → Match View', detail: 'Copy the editor viewpoint into a scene Camera through history.' },
  { group: 'Project', action: 'New entity', shortcut: 'Ctrl/Cmd + E', detail: 'Create an empty child under the current selection.' },
  { group: 'Project', action: 'Preview', shortcut: 'Ctrl/Cmd + Enter', detail: 'Toggle the Studio preview state.' },
  { group: 'Project', action: 'Undo / Redo', shortcut: 'Ctrl/Cmd + Z / Shift + Z', detail: 'Undo or redo canonical editor commands.' },
];

let dialog: HTMLDialogElement | null = null;
let query = '';
let activeGroup: ControlGroup | 'All' = 'All';

function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'input,textarea,select,[contenteditable="true"],.monaco-editor',
  ));
}

function matches(entry: ControlEntry): boolean {
  if (activeGroup !== 'All' && entry.group !== activeGroup) return false;
  const search = query.trim().toLocaleLowerCase();
  if (!search) return true;
  return `${entry.group} ${entry.action} ${entry.shortcut} ${entry.detail}`
    .toLocaleLowerCase()
    .includes(search);
}

function render(): void {
  if (!dialog) return;
  const list = dialog.querySelector<HTMLElement>('[data-kx-controls-list]');
  const count = dialog.querySelector<HTMLElement>('[data-kx-controls-count]');
  if (!list || !count) return;
  const entries = controls.filter(matches);
  list.replaceChildren();
  count.textContent = `${entries.length} controls`;
  for (const entry of entries) {
    const item = document.createElement('article');
    item.className = 'kx-control-entry';
    item.dataset.group = entry.group;
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = entry.action;
    const detail = document.createElement('small');
    detail.textContent = entry.detail;
    copy.append(title, detail);
    const shortcut = document.createElement('kbd');
    shortcut.textContent = entry.shortcut;
    item.append(copy, shortcut);
    list.append(item);
  }
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'kx-controls-empty';
    empty.textContent = 'No controls match the current search.';
    list.append(empty);
  }
  dialog.querySelectorAll<HTMLButtonElement>('[data-kx-controls-group]').forEach((button) => {
    button.classList.toggle('active', button.dataset.kxControlsGroup === activeGroup);
    button.setAttribute('aria-pressed', String(button.dataset.kxControlsGroup === activeGroup));
  });
}

function createDialog(): HTMLDialogElement {
  const next = document.createElement('dialog');
  next.className = 'kx-controls-dialog kx-detail-dialog';
  next.setAttribute('aria-label', 'Editor controls and shortcuts');
  next.innerHTML = `
    <header class="kx-controls-header">
      <div><strong>Controls & Shortcuts</strong><small>PlayCanvas-aligned, Kyxos extended</small></div>
      <button type="button" data-kx-controls-close aria-label="Close controls">×</button>
    </header>
    <div class="kx-controls-toolbar">
      <input type="search" data-kx-controls-search placeholder="Search orbit, camera, panel…" aria-label="Search editor controls">
      <span data-kx-controls-count></span>
    </div>
    <nav class="kx-controls-groups" aria-label="Control categories"></nav>
    <section class="kx-controls-list" data-kx-controls-list></section>
    <footer><span>Shortcuts are ignored while typing.</span><kbd>Esc</kbd></footer>`;
  document.body.append(next);

  const groups = next.querySelector<HTMLElement>('.kx-controls-groups')!;
  for (const group of ['All', 'Viewport', 'Selection', 'Transform', 'Panels', 'Camera & Light', 'Project'] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = group;
    button.dataset.kxControlsGroup = group;
    button.addEventListener('click', () => {
      activeGroup = group;
      render();
    });
    groups.append(button);
  }
  next.querySelector<HTMLButtonElement>('[data-kx-controls-close]')?.addEventListener('click', () => next.close());
  next.querySelector<HTMLInputElement>('[data-kx-controls-search]')?.addEventListener('input', (event) => {
    query = (event.currentTarget as HTMLInputElement).value;
    render();
  });
  next.addEventListener('click', (event) => {
    if (event.target === next) next.close();
  });
  next.addEventListener('close', () => {
    query = '';
    activeGroup = 'All';
    const input = next.querySelector<HTMLInputElement>('[data-kx-controls-search]');
    if (input) input.value = '';
  });
  dialog = next;
  render();
  return next;
}

function openControls(search = ''): void {
  const next = dialog?.isConnected ? dialog : createDialog();
  query = search;
  activeGroup = 'All';
  const input = next.querySelector<HTMLInputElement>('[data-kx-controls-search]');
  if (input) input.value = search;
  render();
  if (!next.open) next.showModal();
  requestAnimationFrame(() => input?.focus());
}

function installButton(shell: HTMLElement): void {
  const topbar = shell.querySelector<HTMLElement>('.studio-topbar-end');
  if (!topbar || topbar.querySelector('[data-kx-controls-button]')) return;
  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'secondary kx-controls-button';
  control.dataset.kxControlsButton = '';
  control.textContent = 'Controls';
  control.title = 'Controls and shortcuts · Shift+?';
  control.addEventListener('click', () => openControls());
  topbar.prepend(control);
}

function requestRename(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'F2',
    code: 'F2',
    bubbles: true,
    cancelable: true,
  }));
}

window.addEventListener('keydown', (event) => {
  if (isTyping(event.target)) return;
  const modifier = event.ctrlKey || event.metaKey;
  if ((event.shiftKey && event.key === '?') || (modifier && event.code === 'Space')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openControls();
  } else if (!modifier && !event.altKey && !event.shiftKey && event.key.toLocaleLowerCase() === 'n') {
    event.preventDefault();
    event.stopImmediatePropagation();
    requestRename();
  }
}, true);

function scan(): void {
  document.querySelectorAll<HTMLElement>('.kyxos-studio-shell').forEach(installButton);
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
scan();
