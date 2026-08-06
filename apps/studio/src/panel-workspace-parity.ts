import './panel-workspace-parity.css';

type PanelKey = 'hierarchy' | 'inspector' | 'assets';
type PanelMode = 'docked' | 'floating';

interface PanelGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PanelState {
  mode: PanelMode;
  collapsed: boolean;
  pinned: boolean;
  maximized: boolean;
  geometry: PanelGeometry;
}

interface WorkspaceState {
  panels: Record<PanelKey, PanelState>;
}

interface PanelDefinition {
  key: PanelKey;
  label: string;
  selector: string;
  contentSelector: string;
  rootCollapsedClass: string;
}

const STORAGE_KEY = 'kyxos-studio-panel-workspace-v1';
const HEADER_HEIGHT = 36;
const definitions: PanelDefinition[] = [
  {
    key: 'hierarchy',
    label: 'Hierarchy',
    selector: '.studio-hierarchy',
    contentSelector: '.hierarchy-content',
    rootCollapsedClass: 'layout-hierarchy-collapsed',
  },
  {
    key: 'inspector',
    label: 'Inspector',
    selector: '.studio-inspector',
    contentSelector: '.inspector-content',
    rootCollapsedClass: 'layout-inspector-collapsed',
  },
  {
    key: 'assets',
    label: 'Assets',
    selector: '.studio-assets',
    contentSelector: '.assets-content',
    rootCollapsedClass: 'layout-assets-collapsed',
  },
];

const enhancedShells = new WeakSet<HTMLElement>();
const enhancedPanels = new WeakSet<HTMLElement>();
let workspaceState = readWorkspaceState();
let topLayer = 80;

function viewportGeometry(key: PanelKey): PanelGeometry {
  const viewportWidth = Math.max(640, window.innerWidth);
  const viewportHeight = Math.max(480, window.innerHeight);
  if (key === 'hierarchy') {
    return { left: 76, top: 76, width: 300, height: Math.min(680, viewportHeight - 120) };
  }
  if (key === 'inspector') {
    const width = Math.min(390, viewportWidth - 48);
    return { left: viewportWidth - width - 24, top: 76, width, height: Math.min(720, viewportHeight - 120) };
  }
  const width = Math.min(960, viewportWidth - 48);
  const height = Math.min(310, Math.max(190, viewportHeight * 0.34));
  return { left: Math.max(24, (viewportWidth - width) / 2), top: viewportHeight - height - 42, width, height };
}

function defaultState(): WorkspaceState {
  return {
    panels: {
      hierarchy: { mode: 'docked', collapsed: false, pinned: true, maximized: false, geometry: viewportGeometry('hierarchy') },
      inspector: { mode: 'docked', collapsed: false, pinned: true, maximized: false, geometry: viewportGeometry('inspector') },
      assets: { mode: 'docked', collapsed: false, pinned: true, maximized: false, geometry: viewportGeometry('assets') },
    },
  };
}

function readWorkspaceState(): WorkspaceState {
  const fallback = defaultState();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<WorkspaceState>;
    for (const definition of definitions) {
      const value = stored.panels?.[definition.key];
      if (!value) continue;
      fallback.panels[definition.key] = {
        mode: value.mode === 'floating' ? 'floating' : 'docked',
        collapsed: Boolean(value.collapsed),
        pinned: value.pinned !== false,
        maximized: Boolean(value.maximized),
        geometry: sanitizeGeometry(value.geometry, definition.key),
      };
    }
  } catch {
    // Use the deterministic default layout when storage is unavailable.
  }
  return fallback;
}

function sanitizeGeometry(value: Partial<PanelGeometry> | undefined, key: PanelKey): PanelGeometry {
  const fallback = viewportGeometry(key);
  return {
    left: finite(value?.left, fallback.left),
    top: finite(value?.top, fallback.top),
    width: Math.max(240, finite(value?.width, fallback.width)),
    height: Math.max(HEADER_HEIGHT, finite(value?.height, fallback.height)),
  };
}

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function saveWorkspaceState(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaceState));
  } catch {
    // The live workspace remains usable in privacy-restricted contexts.
  }
}

function requestViewportResize(): void {
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  });
}

function stopControlEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function iconButton(label: string, text: string, action: (event: MouseEvent) => void): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'kx-panel-window-button';
  control.setAttribute('aria-label', label);
  control.title = label;
  control.textContent = text;
  control.addEventListener('pointerdown', stopControlEvent, true);
  control.addEventListener('click', (event) => {
    stopControlEvent(event);
    action(event);
  }, true);
  return control;
}

function geometryWithinViewport(geometry: PanelGeometry): PanelGeometry {
  const width = Math.min(Math.max(240, geometry.width), Math.max(240, window.innerWidth - 12));
  const height = Math.min(Math.max(HEADER_HEIGHT, geometry.height), Math.max(HEADER_HEIGHT, window.innerHeight - 58));
  return {
    left: Math.max(6, Math.min(window.innerWidth - width - 6, geometry.left)),
    top: Math.max(52, Math.min(window.innerHeight - HEADER_HEIGHT - 6, geometry.top)),
    width,
    height,
  };
}

function applyGeometry(panel: HTMLElement, state: PanelState): void {
  if (state.mode !== 'floating') return;
  const geometry = geometryWithinViewport(state.geometry);
  state.geometry = geometry;
  panel.style.left = `${geometry.left}px`;
  panel.style.top = `${geometry.top}px`;
  panel.style.width = `${geometry.width}px`;
  panel.style.height = `${state.collapsed ? HEADER_HEIGHT : geometry.height}px`;
}

function syncRoot(shell: HTMLElement): void {
  shell.classList.toggle(
    'kx-has-floating-panels',
    definitions.some((definition) => workspaceState.panels[definition.key].mode === 'floating'),
  );
  shell.classList.toggle(
    'kx-floating-assets-active',
    workspaceState.panels.assets.mode === 'floating',
  );
  const toggle = shell.querySelector<HTMLButtonElement>('[data-kx-panel-workspace-toggle]');
  if (toggle) {
    const allFloating = definitions.every((definition) => workspaceState.panels[definition.key].mode === 'floating');
    toggle.textContent = allFloating ? 'Dock Panels' : 'Float Panels';
    toggle.setAttribute('aria-pressed', String(allFloating));
  }
}

function applyPanelState(shell: HTMLElement, panel: HTMLElement, definition: PanelDefinition): void {
  const state = workspaceState.panels[definition.key];
  const content = panel.querySelector<HTMLElement>(definition.contentSelector);
  const collapseButton = panel.querySelector<HTMLButtonElement>('[data-kx-panel-collapse]');
  const modeButton = panel.querySelector<HTMLButtonElement>('[data-kx-panel-mode]');
  const pinButton = panel.querySelector<HTMLButtonElement>('[data-kx-panel-pin]');
  if (!content) return;

  panel.dataset.kxPanelKey = definition.key;
  panel.dataset.kxPanelMode = state.mode;
  panel.dataset.collapsed = String(state.collapsed);
  panel.dataset.pinned = String(state.pinned);
  panel.classList.toggle('kx-panel-floating', state.mode === 'floating');
  panel.classList.toggle('kx-panel-collapsed', state.collapsed);
  panel.classList.toggle('kx-panel-maximized', state.mode === 'floating' && state.maximized);
  panel.classList.toggle('kx-panel-unpinned', state.mode === 'floating' && !state.pinned);
  shell.classList.toggle(definition.rootCollapsedClass, state.mode === 'docked' && state.collapsed);
  content.hidden = state.collapsed;
  content.inert = state.collapsed;

  if (state.mode === 'floating') {
    panel.style.position = 'fixed';
    panel.style.zIndex = String(++topLayer);
    applyGeometry(panel, state);
  } else {
    panel.removeAttribute('style');
  }

  if (collapseButton) {
    collapseButton.textContent = state.collapsed ? '+' : '−';
    collapseButton.setAttribute('aria-label', `${state.collapsed ? 'Expand' : 'Collapse'} ${definition.label}`);
    collapseButton.title = collapseButton.getAttribute('aria-label') ?? '';
  }
  if (modeButton) {
    modeButton.textContent = state.mode === 'floating' ? '▣' : '◫';
    modeButton.setAttribute('aria-label', `${state.mode === 'floating' ? 'Dock' : 'Float'} ${definition.label}`);
    modeButton.title = modeButton.getAttribute('aria-label') ?? '';
  }
  if (pinButton) {
    pinButton.hidden = state.mode !== 'floating';
    pinButton.textContent = state.pinned ? '●' : '○';
    pinButton.setAttribute('aria-pressed', String(state.pinned));
    pinButton.title = state.pinned ? 'Keep panel open' : 'Auto-minimize when focus leaves';
  }
  syncRoot(shell);
  requestViewportResize();
}

function setPanelMode(shell: HTMLElement, panel: HTMLElement, definition: PanelDefinition, mode: PanelMode): void {
  const state = workspaceState.panels[definition.key];
  if (state.mode === mode) return;
  state.mode = mode;
  state.maximized = false;
  state.collapsed = false;
  if (mode === 'floating') state.geometry = geometryWithinViewport(state.geometry);
  saveWorkspaceState();
  applyPanelState(shell, panel, definition);
}

function setCollapsed(shell: HTMLElement, panel: HTMLElement, definition: PanelDefinition, collapsed: boolean): void {
  const state = workspaceState.panels[definition.key];
  state.collapsed = collapsed;
  state.maximized = false;
  saveWorkspaceState();
  applyPanelState(shell, panel, definition);
}

function toggleMaximized(shell: HTMLElement, panel: HTMLElement, definition: PanelDefinition): void {
  const state = workspaceState.panels[definition.key];
  if (state.mode !== 'floating') return;
  state.maximized = !state.maximized;
  state.collapsed = false;
  saveWorkspaceState();
  applyPanelState(shell, panel, definition);
}

function installDrag(shell: HTMLElement, panel: HTMLElement, definition: PanelDefinition, header: HTMLElement): void {
  header.addEventListener('pointerdown', (event) => {
    const state = workspaceState.panels[definition.key];
    if (state.mode !== 'floating' || state.maximized || event.button !== 0) return;
    if ((event.target as Element).closest('button,input,select,textarea,a,[contenteditable="true"]')) return;
    const start = { x: event.clientX, y: event.clientY, left: state.geometry.left, top: state.geometry.top };
    panel.style.zIndex = String(++topLayer);
    panel.classList.add('kx-panel-dragging');
    header.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      state.geometry = geometryWithinViewport({
        ...state.geometry,
        left: start.left + moveEvent.clientX - start.x,
        top: start.top + moveEvent.clientY - start.y,
      });
      applyGeometry(panel, state);
    };
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== event.pointerId) return;
      header.releasePointerCapture(event.pointerId);
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', end);
      header.removeEventListener('pointercancel', end);
      panel.classList.remove('kx-panel-dragging');
      saveWorkspaceState();
      requestViewportResize();
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
  });
  header.addEventListener('dblclick', (event) => {
    if ((event.target as Element).closest('button,input,select,textarea,a')) return;
    event.preventDefault();
    toggleMaximized(shell, panel, definition);
  });
}

function enhancePanel(shell: HTMLElement, definition: PanelDefinition): void {
  const panel = shell.querySelector<HTMLElement>(definition.selector);
  if (!panel || enhancedPanels.has(panel)) return;
  const header = panel.querySelector<HTMLElement>(':scope > .pcui-panel-header');
  const content = panel.querySelector<HTMLElement>(definition.contentSelector);
  if (!header || !content) return;
  enhancedPanels.add(panel);

  const controls = document.createElement('span');
  controls.className = 'kx-panel-window-controls';
  const pinButton = iconButton(`Pin ${definition.label}`, '●', () => {
    const state = workspaceState.panels[definition.key];
    state.pinned = !state.pinned;
    saveWorkspaceState();
    applyPanelState(shell, panel, definition);
  });
  pinButton.dataset.kxPanelPin = '';
  const collapseButton = iconButton(`Collapse ${definition.label}`, '−', () => {
    const state = workspaceState.panels[definition.key];
    setCollapsed(shell, panel, definition, !state.collapsed);
  });
  collapseButton.dataset.kxPanelCollapse = '';
  const modeButton = iconButton(`Float ${definition.label}`, '◫', () => {
    const state = workspaceState.panels[definition.key];
    setPanelMode(shell, panel, definition, state.mode === 'floating' ? 'docked' : 'floating');
  });
  modeButton.dataset.kxPanelMode = '';
  controls.append(pinButton, collapseButton, modeButton);
  header.append(controls);

  panel.addEventListener('pointerdown', () => {
    if (workspaceState.panels[definition.key].mode === 'floating') panel.style.zIndex = String(++topLayer);
  });
  panel.addEventListener('focusout', () => {
    const state = workspaceState.panels[definition.key];
    if (state.mode !== 'floating' || state.pinned || state.collapsed) return;
    queueMicrotask(() => {
      if (!panel.contains(document.activeElement)) setCollapsed(shell, panel, definition, true);
    });
  });
  const resizeObserver = new ResizeObserver(() => {
    const state = workspaceState.panels[definition.key];
    if (state.mode !== 'floating' || state.collapsed || state.maximized) return;
    const rect = panel.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    state.geometry = geometryWithinViewport({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    saveWorkspaceState();
  });
  resizeObserver.observe(panel);
  installDrag(shell, panel, definition, header);
  applyPanelState(shell, panel, definition);
}

function setAllPanelModes(shell: HTMLElement, mode: PanelMode): void {
  for (const definition of definitions) {
    const panel = shell.querySelector<HTMLElement>(definition.selector);
    if (!panel) continue;
    workspaceState.panels[definition.key].mode = mode;
    workspaceState.panels[definition.key].collapsed = false;
    workspaceState.panels[definition.key].maximized = false;
    if (mode === 'floating') workspaceState.panels[definition.key].geometry = viewportGeometry(definition.key);
    applyPanelState(shell, panel, definition);
  }
  saveWorkspaceState();
}

function resetWorkspace(shell: HTMLElement): void {
  workspaceState = defaultState();
  saveWorkspaceState();
  for (const definition of definitions) {
    const panel = shell.querySelector<HTMLElement>(definition.selector);
    if (panel) applyPanelState(shell, panel, definition);
  }
}

function enhanceShell(shell: HTMLElement): void {
  if (enhancedShells.has(shell)) return;
  enhancedShells.add(shell);
  for (const definition of definitions) enhancePanel(shell, definition);

  const topbar = shell.querySelector<HTMLElement>('.studio-topbar-end');
  if (topbar && !topbar.querySelector('[data-kx-panel-workspace-toggle]')) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'secondary kx-panel-workspace-toggle';
    toggle.dataset.kxPanelWorkspaceToggle = '';
    toggle.title = 'Toggle docked and floating editor panels · Ctrl/⌘ Shift F';
    toggle.addEventListener('click', () => {
      const allFloating = definitions.every((definition) => workspaceState.panels[definition.key].mode === 'floating');
      setAllPanelModes(shell, allFloating ? 'docked' : 'floating');
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'secondary kx-panel-workspace-reset';
    reset.textContent = 'Reset Layout';
    reset.title = 'Restore docked panel layout · Ctrl/⌘ Shift 0';
    reset.addEventListener('click', () => resetWorkspace(shell));
    topbar.prepend(toggle, reset);
  }
  syncRoot(shell);
}

function scan(): void {
  document.querySelectorAll<HTMLElement>('.kyxos-studio-shell').forEach(enhanceShell);
}

window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.matches('input,textarea,select') || target?.closest('.monaco-editor')) return;
  const shell = document.querySelector<HTMLElement>('.kyxos-studio-shell');
  if (!shell || !(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
  if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    const allFloating = definitions.every((definition) => workspaceState.panels[definition.key].mode === 'floating');
    setAllPanelModes(shell, allFloating ? 'docked' : 'floating');
  } else if (event.key === '0') {
    event.preventDefault();
    resetWorkspace(shell);
  }
});

window.addEventListener('resize', () => {
  const shell = document.querySelector<HTMLElement>('.kyxos-studio-shell');
  if (!shell) return;
  for (const definition of definitions) {
    const panel = shell.querySelector<HTMLElement>(definition.selector);
    const state = workspaceState.panels[definition.key];
    if (panel && state.mode === 'floating') {
      state.geometry = geometryWithinViewport(state.geometry);
      applyPanelState(shell, panel, definition);
    }
  }
  saveWorkspaceState();
});

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
scan();
