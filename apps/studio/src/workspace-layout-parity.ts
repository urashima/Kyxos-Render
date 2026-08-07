import './workspace-layout-parity.css';

type PanelKey = 'hierarchy' | 'inspector' | 'assets';

interface PanelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PanelState {
  floating: boolean;
  rect?: PanelRect;
}

type WorkspaceState = Partial<Record<PanelKey, PanelState>>;

interface PanelDefinition {
  key: PanelKey;
  selector: string;
  rootFloatingClass: string;
  title: string;
}

const STORAGE_KEY = 'kyxos-studio-workspace-layout-v4';
const definitions: PanelDefinition[] = [
  {
    key: 'hierarchy',
    selector: '.studio-hierarchy',
    rootFloatingClass: 'workspace-floating-hierarchy',
    title: 'Hierarchy',
  },
  {
    key: 'inspector',
    selector: '.studio-inspector',
    rootFloatingClass: 'workspace-floating-inspector',
    title: 'Inspector',
  },
  {
    key: 'assets',
    selector: '.studio-assets',
    rootFloatingClass: 'workspace-floating-assets',
    title: 'Assets',
  },
];

const DEFAULT_FLOATING_SIZE: Record<PanelKey, { width: number; height: number }> = {
  hierarchy: { width: 292, height: 520 },
  inspector: { width: 354, height: 620 },
  assets: { width: 720, height: 280 },
};

function readState(): WorkspaceState {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as WorkspaceState;
  } catch {
    return {};
  }
}

function writeState(state: WorkspaceState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Layout persistence is best effort.
  }
}

function requestViewportResize(): void {
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  });
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(
    target.closest('button,input,select,textarea,a,[contenteditable="true"],[role="slider"]'),
  );
}

function clampRect(rect: PanelRect): PanelRect {
  const margin = 8;
  const topbar = 48;
  const status = 24;
  const width = Math.min(Math.max(rect.width, 220), Math.max(220, innerWidth - margin * 2));
  const height = Math.min(
    Math.max(rect.height, 120),
    Math.max(120, innerHeight - topbar - status - margin * 2),
  );
  const left = Math.min(Math.max(rect.left, margin), Math.max(margin, innerWidth - width - margin));
  const top = Math.min(
    Math.max(rect.top, topbar + margin),
    Math.max(topbar + margin, innerHeight - status - height - margin),
  );
  return { left, top, width, height };
}

function rectFromPanel(panel: HTMLElement, key: PanelKey): PanelRect {
  const current = panel.getBoundingClientRect();
  const fallback = DEFAULT_FLOATING_SIZE[key];
  const width = current.width > 80 ? current.width : fallback.width;
  const height = current.height > 80 ? current.height : fallback.height;
  return clampRect({
    left: current.left,
    top: current.top,
    width,
    height,
  });
}

function applyRect(panel: HTMLElement, rect: PanelRect): void {
  const next = clampRect(rect);
  panel.style.left = `${Math.round(next.left)}px`;
  panel.style.top = `${Math.round(next.top)}px`;
  panel.style.width = `${Math.round(next.width)}px`;
  panel.style.height = `${Math.round(next.height)}px`;
}

function clearRect(panel: HTMLElement): void {
  panel.style.removeProperty('left');
  panel.style.removeProperty('top');
  panel.style.removeProperty('width');
  panel.style.removeProperty('height');
}

function foldGlyph(key: PanelKey, collapsed: boolean, floating: boolean): string {
  if (floating) return collapsed ? '⌄' : '⌃';
  if (key === 'hierarchy') return collapsed ? '›' : '‹';
  if (key === 'inspector') return collapsed ? '‹' : '›';
  return collapsed ? '⌃' : '⌄';
}

function setupPanel(
  root: HTMLElement,
  definition: PanelDefinition,
  state: WorkspaceState,
): void {
  const panel = root.querySelector<HTMLElement>(definition.selector);
  if (!panel || panel.dataset.kxWorkspaceReady === 'true') return;
  const header = panel.querySelector<HTMLElement>(':scope > .pcui-panel-header');
  if (!header) return;

  panel.dataset.kxWorkspaceReady = 'true';
  panel.dataset.workspacePanel = definition.key;
  header.classList.add('kx-workspace-drag-handle');
  header.title = `${definition.title} · drag to float · double-click to dock/float`;

  const controls = document.createElement('span');
  controls.className = 'kx-workspace-panel-controls';

  const fold = document.createElement('button');
  fold.type = 'button';
  fold.className = 'kx-workspace-panel-button kx-workspace-fold';
  fold.setAttribute('aria-label', `Collapse ${definition.title}`);

  const floatToggle = document.createElement('button');
  floatToggle.type = 'button';
  floatToggle.className = 'kx-workspace-panel-button kx-workspace-float';
  floatToggle.textContent = '◇';
  floatToggle.setAttribute('aria-label', `Float ${definition.title}`);
  floatToggle.title = `Dock / float ${definition.title}`;

  controls.append(fold, floatToggle);
  header.append(controls);

  const getStored = (): PanelState => state[definition.key] ?? { floating: false };

  const syncChrome = () => {
    const floating = panel.classList.contains('kx-panel-floating');
    const collapsed = panel.dataset.collapsed === 'true' || panel.classList.contains('kx-panel-collapsed');
    fold.textContent = foldGlyph(definition.key, collapsed, floating);
    fold.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${definition.title}`);
    fold.title = `${collapsed ? 'Expand' : 'Collapse'} ${definition.title}`;
    floatToggle.textContent = floating ? '◆' : '◇';
    floatToggle.setAttribute('aria-pressed', String(floating));
    floatToggle.setAttribute('aria-label', `${floating ? 'Dock' : 'Float'} ${definition.title}`);
    panel.classList.toggle('kx-floating-collapsed', floating && collapsed);
  };

  const setFloating = (floating: boolean, preferredRect?: PanelRect) => {
    if (matchMedia('(max-width: 1099px)').matches) floating = false;
    panel.classList.toggle('kx-panel-floating', floating);
    root.classList.toggle(definition.rootFloatingClass, floating);
    if (floating) {
      const next = clampRect(preferredRect ?? getStored().rect ?? rectFromPanel(panel, definition.key));
      applyRect(panel, next);
      state[definition.key] = { floating: true, rect: next };
    } else {
      clearRect(panel);
      state[definition.key] = { ...getStored(), floating: false };
    }
    writeState(state);
    syncChrome();
    requestViewportResize();
  };

  const triggerFold = () => {
    header.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    queueMicrotask(syncChrome);
  };

  fold.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    triggerFold();
  });
  floatToggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setFloating(!panel.classList.contains('kx-panel-floating'));
  });

  header.addEventListener('dblclick', (event) => {
    if (isInteractive(event.target)) return;
    event.preventDefault();
    setFloating(!panel.classList.contains('kx-panel-floating'));
  });

  let drag:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        offsetX: number;
        offsetY: number;
        sourceRect: PanelRect;
        activated: boolean;
      }
    | null = null;

  const onMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.activated && Math.hypot(dx, dy) < 5) return;
    if (!drag.activated) {
      drag.activated = true;
      setFloating(true, drag.sourceRect);
    }
    if (!panel.classList.contains('kx-panel-floating')) return;
    const current = getStored().rect ?? drag.sourceRect;
    const next = clampRect({
      left: event.clientX - drag.offsetX,
      top: event.clientY - drag.offsetY,
      width: current.width,
      height: panel.classList.contains('kx-floating-collapsed') ? 38 : current.height,
    });
    applyRect(panel, next);
    state[definition.key] = { floating: true, rect: { ...current, left: next.left, top: next.top } };
  };

  const finishDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.activated) writeState(state);
    drag = null;
    header.classList.remove('is-workspace-dragging');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finishDrag);
    window.removeEventListener('pointercancel', finishDrag);
  };

  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || isInteractive(event.target) || matchMedia('(max-width: 1099px)').matches) return;
    const rect = rectFromPanel(panel, definition.key);
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      sourceRect: rect,
      activated: panel.classList.contains('kx-panel-floating'),
    };
    header.classList.add('is-workspace-dragging');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
  });

  const resizeObserver = new ResizeObserver(() => {
    if (!panel.classList.contains('kx-panel-floating') || panel.classList.contains('kx-floating-collapsed')) return;
    const rect = panel.getBoundingClientRect();
    const current = getStored();
    state[definition.key] = {
      floating: true,
      rect: clampRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }),
    };
    writeState(state);
  });
  resizeObserver.observe(panel);

  const mutationObserver = new MutationObserver(syncChrome);
  mutationObserver.observe(panel, { attributes: true, attributeFilter: ['class', 'data-collapsed'] });

  const stored = getStored();
  if (stored.floating && !matchMedia('(max-width: 1099px)').matches) setFloating(true, stored.rect);
  else syncChrome();

  panel.addEventListener('transitionend', requestViewportResize);
}

function resetWorkspace(root: HTMLElement): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best effort.
  }
  for (const definition of definitions) {
    const panel = root.querySelector<HTMLElement>(definition.selector);
    panel?.classList.remove('kx-panel-floating', 'kx-floating-collapsed');
    if (panel) clearRect(panel);
    root.classList.remove(definition.rootFloatingClass);
  }
  requestViewportResize();
}

function upgrade(root: HTMLElement): void {
  if (root.dataset.kxWorkspaceParity === 'true') return;
  root.dataset.kxWorkspaceParity = 'true';
  const state = readState();
  for (const definition of definitions) setupPanel(root, definition, state);

  const compactTopbar = () => {
    root.classList.toggle('kx-narrow-desktop', innerWidth < 1320 && innerWidth >= 1100);
  };
  compactTopbar();
  window.addEventListener('resize', compactTopbar);

  root.addEventListener('keydown', (event) => {
    if (!(event instanceof KeyboardEvent) || event.defaultPrevented) return;
    if (event.altKey && event.key === '1') {
      root.querySelector<HTMLElement>('.studio-hierarchy > .pcui-panel-header')?.click();
    } else if (event.altKey && event.key === '2') {
      root.querySelector<HTMLElement>('.studio-inspector > .pcui-panel-header')?.click();
    } else if (event.altKey && event.key === '3') {
      root.querySelector<HTMLElement>('.studio-assets > .pcui-panel-header')?.click();
    }
  });
}

function scan(): void {
  document.querySelectorAll<HTMLElement>('.kyxos-studio-shell').forEach(upgrade);
}

window.addEventListener('kyxos:workspace-reset', () => {
  document.querySelectorAll<HTMLElement>('.kyxos-studio-shell').forEach(resetWorkspace);
});
window.addEventListener('resize', () => {
  if (matchMedia('(max-width: 1099px)').matches) {
    document.querySelectorAll<HTMLElement>('.kx-panel-floating').forEach((panel) => {
      panel.classList.remove('kx-panel-floating', 'kx-floating-collapsed');
      clearRect(panel);
    });
    document.querySelectorAll<HTMLElement>('.kyxos-studio-shell').forEach((root) => {
      definitions.forEach((definition) => root.classList.remove(definition.rootFloatingClass));
    });
  }
});

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scan();
