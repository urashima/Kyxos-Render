import { Observer } from '@playcanvas/observer';
import { Panel } from '@playcanvas/pcui';
import '@playcanvas/pcui/styles';
import { element } from '@kyxos/shared-ui';
import {
  createKxCommandPalette,
  createKxDialog,
  createKxIconButton,
  createKxToastHost,
  showKxToast,
  type KxCommand,
} from '@kyxos/ui-components';
import { createKxIcon, type KxIconName } from '@kyxos/ui-icons';
import { applyKyxosTheme, readStoredTheme, type KyxosTheme } from '@kyxos/ui-theme';

export type StudioMode = 'authoring' | 'focus';

export interface StudioShell {
  root: HTMLElement;
  topbar: HTMLElement;
  hierarchy: HTMLElement;
  viewport: HTMLElement;
  inspector: HTMLElement;
  assets: HTMLElement;
  status: HTMLElement;
  leftRail: HTMLElement;
  performance: HTMLElement;
  observer: Observer;
  setMode(mode: StudioMode): void;
  getMode(): StudioMode;
  setTheme(theme: KyxosTheme): void;
  resetLayout(): void;
  destroy(): void;
}

interface ViewerMetricsDetail {
  fps?: number;
  cpuFrameTimeMs?: number;
  gpuFrameTimeMs?: number | null;
  drawCalls?: number;
  triangles?: number;
  textures?: number;
  totalGpuBytes?: number;
  backend?: string;
}

const LAYOUT_KEY = 'kyxos-studio-layout-v2';

function createPanel(
  title: string,
  className: string,
  content: HTMLElement,
  options: { collapsible?: boolean; collapseHorizontally?: boolean } = {},
): Panel {
  const panel = new Panel({
    headerText: title,
    content,
    collapsible: options.collapsible ?? false,
    collapseHorizontally: options.collapseHorizontally ?? false,
  });
  panel.dom.classList.add(className, 'kx-panel-surface');
  return panel;
}

function readMode(): StudioMode {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as { mode?: StudioMode };
    return saved.mode === 'focus' ? 'focus' : 'authoring';
  } catch {
    return 'authoring';
  }
}

function saveLayout(mode: StudioMode, theme: KyxosTheme): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ mode, theme }));
  } catch {
    // Layout persistence is best effort in privacy-restricted contexts.
  }
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (control) => control.textContent?.trim().toLowerCase() === text.toLowerCase(),
  );
}

function dispatchEditorKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

export function createStudioShell(container: HTMLElement): StudioShell {
  const initialMode = matchMedia('(max-width: 1099px)').matches ? 'focus' : readMode();
  const initialTheme = readStoredTheme();
  applyKyxosTheme(initialTheme);

  const observer = new Observer({
    layout: {
      hierarchyCollapsed: false,
      inspectorCollapsed: false,
      assetsCollapsed: false,
      mode: initialMode,
      hierarchyDrawer: false,
      inspectorDrawer: false,
    },
    theme: initialTheme,
    status: 'Saved',
  });

  const root = element('div', {
    className: `kyxos-studio-shell pcui-theme-grey kx-theme-${initialTheme}`,
    attrs: { 'data-mode': initialMode, 'data-kx-theme': initialTheme },
  });

  const topbarChrome = element('header', { className: 'studio-topbar' });
  const topbarStart = element('div', { className: 'studio-topbar-start' });
  const brand = element('div', { className: 'studio-shell-brand', attrs: { 'aria-label': 'Kyxos Studio' } });
  brand.append(createKxIcon('brand'), element('span', { text: 'Kyxos' }));
  const topbar = element('div', { className: 'studio-topbar-slot' });
  const topbarEnd = element('div', { className: 'studio-topbar-end' });
  topbarStart.append(brand);
  topbarChrome.append(topbarStart, topbar, topbarEnd);

  const hierarchy = element('div', {
    className: 'studio-panel-content hierarchy-content',
    attrs: { 'aria-label': 'Hierarchy' },
  });
  const viewport = element('main', {
    className: 'studio-viewport',
    attrs: { 'aria-label': 'Kyxos Viewport' },
  });
  const inspector = element('div', {
    className: 'studio-panel-content inspector-content',
    attrs: { 'aria-label': 'Inspector' },
  });
  const assets = element('div', {
    className: 'studio-panel-content assets-content',
    attrs: { 'aria-label': 'Assets and animation' },
  });
  const status = element('div', {
    className: 'studio-status kx-mono',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });

  const hierarchyPanel = createPanel('Hierarchy', 'studio-hierarchy', hierarchy, {
    collapsible: true,
    collapseHorizontally: true,
  });
  const inspectorPanel = createPanel('Inspector', 'studio-inspector', inspector, {
    collapsible: true,
    collapseHorizontally: true,
  });
  const assetsPanel = createPanel('Assets / Materials / Presets', 'studio-assets', assets, {
    collapsible: true,
  });

  hierarchyPanel.on('collapse', () => observer.set('layout.hierarchyCollapsed', true));
  hierarchyPanel.on('expand', () => observer.set('layout.hierarchyCollapsed', false));
  inspectorPanel.on('collapse', () => observer.set('layout.inspectorCollapsed', true));
  inspectorPanel.on('expand', () => observer.set('layout.inspectorCollapsed', false));
  assetsPanel.on('collapse', () => observer.set('layout.assetsCollapsed', true));
  assetsPanel.on('expand', () => observer.set('layout.assetsCollapsed', false));

  const leftRail = element('nav', {
    className: 'studio-left-rail kx-floating-panel',
    attrs: { 'aria-label': 'Viewport tools' },
  });
  const railActions: Array<[KxIconName, string, string, () => void]> = [
    ['select', 'Select', 'V', () => buttonByText(root, 'Select')?.click()],
    ['move', 'Move', 'W', () => buttonByText(root, 'Move')?.click()],
    ['rotate', 'Rotate', 'E', () => buttonByText(root, 'Rotate')?.click()],
    ['scale', 'Scale', 'R', () => buttonByText(root, 'Scale')?.click()],
    ['frame', 'Frame selection', 'F', () => dispatchEditorKey('f')],
    ['orbit', 'Orbit camera', 'Alt + drag', () => root.querySelector<HTMLCanvasElement>('#studio-canvas')?.focus()],
  ];
  for (const [icon, label, shortcut, action] of railActions) {
    const control = createKxIconButton(icon, label, action);
    control.dataset.tooltip = `${label} · ${shortcut}`;
    control.title = `${label} · ${shortcut}`;
    leftRail.append(control);
  }

  const performanceCapsule = element('button', {
    className: 'studio-performance-capsule kx-floating-panel',
    attrs: { type: 'button', 'aria-expanded': 'false', 'aria-label': 'Viewport performance' },
  });
  performanceCapsule.append(createKxIcon('performance'));
  const performanceSummary = element('span', { className: 'performance-summary kx-mono' });
  const performanceDetails = element('span', { className: 'performance-details kx-mono' });
  performanceCapsule.append(performanceSummary, performanceDetails);
  performanceCapsule.addEventListener('click', () => {
    const expanded = performanceCapsule.getAttribute('aria-expanded') === 'true';
    performanceCapsule.setAttribute('aria-expanded', String(!expanded));
  });

  const modeGroup = element('div', { className: 'studio-mode-switch', attrs: { role: 'group', 'aria-label': 'Editor mode' } });
  const authoringButton = createKxIconButton('authoring', 'Authoring mode', () => setMode('authoring'));
  const focusButton = createKxIconButton('focus', 'Focus mode', () => setMode('focus'));
  modeGroup.append(authoringButton, focusButton);

  const hierarchyDrawer = createKxIconButton('hierarchy', 'Toggle hierarchy', () => {
    const open = root.classList.toggle('hierarchy-drawer-open');
    observer.set('layout.hierarchyDrawer', open);
  });
  hierarchyDrawer.classList.add('studio-drawer-toggle');
  const inspectorDrawer = createKxIconButton('inspector', 'Toggle inspector', () => {
    const open = root.classList.toggle('inspector-drawer-open');
    observer.set('layout.inspectorDrawer', open);
  });
  inspectorDrawer.classList.add('studio-drawer-toggle');

  const toastHost = createKxToastHost();
  const shortcutsDialog = createKxDialog('Keyboard shortcuts');
  const shortcutsBody = shortcutsDialog.querySelector<HTMLElement>('.kx-dialog-body')!;
  shortcutsBody.innerHTML = [
    '<div class="shortcut-grid">',
    '<span>Command palette</span><kbd>Ctrl / ⌘ K</kbd>',
    '<span>Move / Rotate / Scale</span><kbd>W / E / R</kbd>',
    '<span>Frame selection</span><kbd>F</kbd>',
    '<span>Undo / Redo</span><kbd>Ctrl / ⌘ Z · Y</kbd>',
    '<span>Delete selection</span><kbd>Delete</kbd>',
    '<span>Close focus / dialog</span><kbd>Esc</kbd>',
    '</div>',
  ].join('');

  let mode = initialMode;
  let theme = initialTheme;

  const themeButton = createKxIconButton('theme', 'Switch theme', () => {
    setTheme(root.dataset.kxTheme === 'graphite' ? 'moss' : 'graphite');
    showKxToast(toastHost, `Theme: ${root.dataset.kxTheme === 'graphite' ? 'Kyxos Graphite' : 'Kyxos Moss'}`, 'accent');
  });

  const commands: KxCommand[] = [
    { id: 'projects', label: 'Open project list', category: 'Project', keywords: ['back'], run: () => buttonByText(root, '← Projects')?.click() },
    { id: 'undo', label: 'Undo', category: 'Edit', shortcut: 'Ctrl/⌘ Z', run: () => buttonByText(root, 'Undo')?.click() },
    { id: 'redo', label: 'Redo', category: 'Edit', shortcut: 'Ctrl/⌘ Y', run: () => buttonByText(root, 'Redo')?.click() },
    { id: 'authoring', label: 'Switch to Authoring mode', category: 'Layout', run: () => setMode('authoring') },
    { id: 'focus', label: 'Switch to Focus mode', category: 'Layout', run: () => setMode('focus') },
    { id: 'preview', label: 'Toggle preview', category: 'View', run: () => root.querySelector<HTMLButtonElement>('.preview-toggle')?.click() },
    { id: 'frame', label: 'Frame selection', category: 'View', shortcut: 'F', run: () => dispatchEditorKey('f') },
    { id: 'upload', label: 'Upload asset', category: 'Assets', run: () => buttonByText(root, 'Upload')?.click() },
    { id: 'versions', label: 'Open versions', category: 'Project', run: () => buttonByText(root, 'Versions')?.click() },
    { id: 'publish', label: 'Publish project', category: 'Project', run: () => buttonByText(root, 'Publish')?.click() },
    { id: 'theme', label: 'Switch Moss / Graphite theme', category: 'Appearance', run: () => themeButton.click() },
    { id: 'reset-layout', label: 'Restore default layout', category: 'Layout', run: resetLayout },
    { id: 'shortcuts', label: 'Show keyboard shortcuts', category: 'Help', shortcut: '?', run: () => shortcutsDialog.showModal() },
  ];
  const commandPalette = createKxCommandPalette(commands);
  const commandButton = createKxIconButton('command', 'Command palette', () => commandPalette.showModal());
  topbarEnd.append(hierarchyDrawer, inspectorDrawer, modeGroup, themeButton, commandButton);

  root.append(
    topbarChrome,
    hierarchyPanel.dom,
    viewport,
    inspectorPanel.dom,
    assetsPanel.dom,
    status,
    leftRail,
    performanceCapsule,
    commandPalette,
    shortcutsDialog,
    toastHost,
  );
  container.replaceChildren(root);

  let destroyed = false;
  let frameCount = 0;
  let lastFpsTime = performanceNow();
  let shellFps = 0;
  let metrics: ViewerMetricsDetail = {};
  let raf = 0;
  let lastPerformanceText = '';

  function performanceNow(): number {
    return typeof globalThis.performance === 'undefined' ? Date.now() : globalThis.performance.now();
  }

  function setMode(next: StudioMode): void {
    mode = next;
    root.dataset.mode = next;
    root.classList.toggle('focus-mode', next === 'focus');
    authoringButton.setAttribute('aria-pressed', String(next === 'authoring'));
    focusButton.setAttribute('aria-pressed', String(next === 'focus'));
    observer.set('layout.mode', next);
    root.classList.remove('hierarchy-drawer-open', 'inspector-drawer-open');
    saveLayout(mode, theme);
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function setTheme(next: KyxosTheme): void {
    theme = next;
    root.dataset.kxTheme = next;
    root.classList.toggle('kx-theme-moss', next === 'moss');
    root.classList.toggle('kx-theme-graphite', next === 'graphite');
    observer.set('theme', next);
    applyKyxosTheme(next);
    saveLayout(mode, theme);
  }

  function resetLayout(): void {
    root.classList.remove('hierarchy-drawer-open', 'inspector-drawer-open');
    setMode(matchMedia('(max-width: 1099px)').matches ? 'focus' : 'authoring');
    showKxToast(toastHost, 'Default editor layout restored.', 'success');
  }

  function formatNumber(value: number | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return Intl.NumberFormat('en', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
  }

  function renderPerformance(): void {
    const fps = metrics.fps ?? shellFps;
    const backendFromStatus = /webgpu/i.test(status.textContent ?? '') ? 'WebGPU' : /webgl2/i.test(status.textContent ?? '') ? 'WebGL2' : undefined;
    const backend = metrics.backend ?? backendFromStatus ?? 'Starting';
    const summary = `${Math.round(fps || 0)} FPS · ${formatNumber(metrics.drawCalls)} DC · ${formatNumber(metrics.triangles)} tris · ${backend}`;
    const detail = `${metrics.cpuFrameTimeMs?.toFixed(1) ?? '—'} ms CPU · ${metrics.gpuFrameTimeMs?.toFixed(1) ?? '—'} ms GPU · ${formatNumber(metrics.textures)} tex · ${metrics.totalGpuBytes ? `${(metrics.totalGpuBytes / 1048576).toFixed(0)} MB` : '— MB'}`;
    const next = `${summary}|${detail}`;
    if (next === lastPerformanceText) return;
    lastPerformanceText = next;
    performanceSummary.textContent = summary;
    performanceDetails.textContent = detail;
  }

  function loop(now: number): void {
    if (destroyed) return;
    frameCount += 1;
    const elapsed = now - lastFpsTime;
    if (elapsed >= 500) {
      shellFps = (frameCount * 1000) / elapsed;
      frameCount = 0;
      lastFpsTime = now;
      renderPerformance();
    }
    raf = requestAnimationFrame(loop);
  }

  const onMetrics = (event: Event) => {
    metrics = { ...metrics, ...(event as CustomEvent<ViewerMetricsDetail>).detail };
    renderPerformance();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select, [contenteditable=true]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      commandPalette.showModal();
    } else if (event.key === '?' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      shortcutsDialog.showModal();
    }
  };
  window.addEventListener('kyxos:viewer-metrics', onMetrics);
  window.addEventListener('keydown', onKeyDown, { capture: true });
  const statusObserver = new MutationObserver(renderPerformance);
  statusObserver.observe(status, { childList: true, characterData: true, subtree: true });

  setMode(initialMode);
  setTheme(initialTheme);
  renderPerformance();
  raf = requestAnimationFrame(loop);

  return {
    root,
    topbar,
    hierarchy,
    viewport,
    inspector,
    assets,
    status,
    leftRail,
    performance: performanceCapsule,
    observer,
    setMode,
    getMode: () => mode,
    setTheme,
    resetLayout,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      statusObserver.disconnect();
      window.removeEventListener('kyxos:viewer-metrics', onMetrics);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      hierarchyPanel.destroy();
      inspectorPanel.destroy();
      assetsPanel.destroy();
      if (commandPalette.open) commandPalette.close();
      if (shortcutsDialog.open) shortcutsDialog.close();
      root.remove();
    },
  };
}
