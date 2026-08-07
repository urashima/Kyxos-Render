import './workspace-layout-resilience.css';

type PanelKey = 'hierarchy' | 'inspector' | 'assets';

interface StoredPanelState {
  floating?: boolean;
}

type WorkspaceState = Partial<Record<PanelKey, StoredPanelState>>;

const WORKSPACE_KEY = 'kyxos-studio-workspace-layout-v4';
const LEGACY_COLLAPSE_KEY = 'kyxos-studio-panel-layout-v3';
const desktopQuery = matchMedia('(min-width: 1100px)');
const selectors: Record<PanelKey, string> = {
  hierarchy: '.studio-hierarchy',
  inspector: '.studio-inspector',
  assets: '.studio-assets',
};

function readWorkspace(): WorkspaceState {
  try {
    return JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? '{}') as WorkspaceState;
  } catch {
    return {};
  }
}

function root(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.kyxos-studio-shell');
}

function restoreDesktopFloatingPanels(): void {
  if (!desktopQuery.matches) return;
  const shell = root();
  if (!shell) return;
  const state = readWorkspace();
  (Object.keys(selectors) as PanelKey[]).forEach((key) => {
    if (!state[key]?.floating) return;
    const panel = shell.querySelector<HTMLElement>(selectors[key]);
    if (!panel || panel.classList.contains('kx-panel-floating')) return;
    panel.querySelector<HTMLButtonElement>('.kx-workspace-float')?.click();
  });
}

function normalizeMobilePanels(): void {
  if (desktopQuery.matches) return;
  const shell = root();
  if (!shell) return;
  shell.classList.remove(
    'workspace-floating-hierarchy',
    'workspace-floating-inspector',
    'workspace-floating-assets',
  );
  shell.querySelectorAll<HTMLElement>('.kx-panel-floating').forEach((panel) => {
    panel.classList.remove('kx-panel-floating', 'kx-floating-collapsed');
    panel.style.removeProperty('left');
    panel.style.removeProperty('top');
    panel.style.removeProperty('width');
    panel.style.removeProperty('height');
    panel.querySelector<HTMLButtonElement>('.kx-workspace-float')?.setAttribute('aria-pressed', 'false');
  });
}

function resetAllWorkspaceState(): void {
  try {
    localStorage.removeItem(WORKSPACE_KEY);
    localStorage.removeItem(LEGACY_COLLAPSE_KEY);
  } catch {
    // Persistence reset is best effort.
  }

  const shell = root();
  if (!shell) return;
  (Object.keys(selectors) as PanelKey[]).forEach((key) => {
    const panel = shell.querySelector<HTMLElement>(selectors[key]);
    if (!panel) return;
    if (panel.dataset.collapsed === 'true' || panel.classList.contains('kx-panel-collapsed')) {
      panel.querySelector<HTMLElement>(':scope > .pcui-panel-header')?.click();
    }
    panel.classList.remove('kx-panel-floating', 'kx-floating-collapsed');
    panel.style.removeProperty('left');
    panel.style.removeProperty('top');
    panel.style.removeProperty('width');
    panel.style.removeProperty('height');
  });
  shell.classList.remove(
    'layout-hierarchy-collapsed',
    'layout-inspector-collapsed',
    'layout-assets-collapsed',
    'workspace-floating-hierarchy',
    'workspace-floating-inspector',
    'workspace-floating-assets',
    'hierarchy-drawer-open',
    'inspector-drawer-open',
  );
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function onResponsiveChange(): void {
  if (desktopQuery.matches) requestAnimationFrame(restoreDesktopFloatingPanels);
  else normalizeMobilePanels();
}

desktopQuery.addEventListener('change', onResponsiveChange);
window.addEventListener('kyxos:workspace-reset', resetAllWorkspaceState);

const observer = new MutationObserver(() => {
  if (root()) {
    if (desktopQuery.matches) restoreDesktopFloatingPanels();
    else normalizeMobilePanels();
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });
