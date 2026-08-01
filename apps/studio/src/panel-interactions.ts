type PanelKey = 'hierarchy' | 'inspector' | 'assets';

interface PanelDefinition {
  key: PanelKey;
  panelSelector: string;
  contentSelector: string;
  rootClass: string;
  collapsedLabel: string;
  expandedLabel: string;
}

const STORAGE_KEY = 'kyxos-studio-panel-layout-v3';
const panelDefinitions: PanelDefinition[] = [
  {
    key: 'hierarchy',
    panelSelector: '.studio-hierarchy',
    contentSelector: '.hierarchy-content',
    rootClass: 'layout-hierarchy-collapsed',
    collapsedLabel: 'Expand Hierarchy',
    expandedLabel: 'Collapse Hierarchy',
  },
  {
    key: 'inspector',
    panelSelector: '.studio-inspector',
    contentSelector: '.inspector-content',
    rootClass: 'layout-inspector-collapsed',
    collapsedLabel: 'Expand Inspector',
    expandedLabel: 'Collapse Inspector',
  },
  {
    key: 'assets',
    panelSelector: '.studio-assets',
    contentSelector: '.assets-content',
    rootClass: 'layout-assets-collapsed',
    collapsedLabel: 'Expand Assets',
    expandedLabel: 'Collapse Assets',
  },
];

function readState(): Partial<Record<PanelKey, boolean>> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<PanelKey, boolean>>;
  } catch {
    return {};
  }
}

function writeState(state: Partial<Record<PanelKey, boolean>>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Persistence is best effort when storage is unavailable.
  }
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, select, textarea, button, a, [contenteditable="true"], [role="slider"]'));
}

function requestViewportResize(): void {
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  });
}

function upgradeAccordion(section: HTMLDetailsElement): void {
  if (section.dataset.kxAccordionReady === 'true') return;
  section.dataset.kxAccordionReady = 'true';
  section.classList.add('kx-independent-accordion');

  const summary = section.querySelector<HTMLElement>(':scope > summary');
  if (!summary) return;
  summary.setAttribute('role', 'button');
  summary.setAttribute('aria-expanded', String(section.open));

  const sectionKey = section.dataset.sectionKey ?? summary.textContent?.trim().replace(/\s+/g, '-').toLowerCase();
  if (sectionKey) section.dataset.sectionKey = sectionKey;

  summary.addEventListener('click', (event) => {
    if (!isInteractive(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  section.addEventListener('toggle', () => {
    summary.setAttribute('aria-expanded', String(section.open));
  });

  section.addEventListener('pointerdown', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'range') {
      section.dataset.controlActive = 'true';
      event.stopPropagation();
    }
  }, true);

  const clearActive = () => delete section.dataset.controlActive;
  section.addEventListener('pointerup', clearActive, true);
  section.addEventListener('pointercancel', clearActive, true);
  section.addEventListener('change', (event) => {
    if (isInteractive(event.target)) event.stopPropagation();
  }, true);
  section.addEventListener('input', (event) => {
    if (isInteractive(event.target)) event.stopPropagation();
  }, true);
}

function installPanel(root: HTMLElement, definition: PanelDefinition, state: Partial<Record<PanelKey, boolean>>): void {
  const panel = root.querySelector<HTMLElement>(definition.panelSelector);
  if (!panel || panel.dataset.kxPanelReady === 'true') return;
  const header = panel.querySelector<HTMLElement>(':scope > .pcui-panel-header');
  const content = panel.querySelector<HTMLElement>(definition.contentSelector);
  if (!header || !content) return;

  panel.dataset.kxPanelReady = 'true';
  header.tabIndex = 0;
  header.setAttribute('role', 'button');

  const apply = (collapsed: boolean, persist = true): void => {
    root.classList.toggle(definition.rootClass, collapsed);
    panel.classList.toggle('kx-panel-collapsed', collapsed);
    panel.dataset.collapsed = String(collapsed);
    header.setAttribute('aria-expanded', String(!collapsed));
    header.setAttribute('aria-label', collapsed ? definition.collapsedLabel : definition.expandedLabel);
    content.hidden = collapsed;
    content.inert = collapsed;
    if (persist) {
      state[definition.key] = collapsed;
      writeState(state);
    }
    requestViewportResize();
  };

  const toggle = (event?: Event): void => {
    event?.preventDefault();
    event?.stopPropagation();
    if ('stopImmediatePropagation' in (event ?? {})) event?.stopImmediatePropagation();
    apply(panel.dataset.collapsed !== 'true');
  };

  header.addEventListener('click', (event) => {
    if (isInteractive(event.target) && event.target !== header) {
      const collapseControl = (event.target as Element).closest('.pcui-panel-header-icon, .pcui-panel-collapse-icon');
      if (!collapseControl) return;
    }
    toggle(event);
  }, true);
  header.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') toggle(event);
  }, true);

  apply(Boolean(state[definition.key]), false);
}

function upgradeStudio(root: HTMLElement): void {
  const state = readState();
  for (const definition of panelDefinitions) installPanel(root, definition, state);
  root.querySelectorAll<HTMLDetailsElement>('.inspector-section, .effect-card').forEach(upgradeAccordion);

  const observer = new MutationObserver(() => {
    root.querySelectorAll<HTMLDetailsElement>('.inspector-section, .effect-card').forEach(upgradeAccordion);
  });
  observer.observe(root, { childList: true, subtree: true });

  const shellObserver = new ResizeObserver(requestViewportResize);
  shellObserver.observe(root);
}

function scan(): void {
  document.querySelectorAll<HTMLElement>('.kyxos-studio-shell').forEach((root) => {
    if (root.dataset.kxPanelInteractions === 'true') return;
    root.dataset.kxPanelInteractions = 'true';
    upgradeStudio(root);
  });
}

const documentObserver = new MutationObserver(scan);
documentObserver.observe(document.documentElement, { childList: true, subtree: true });
scan();
