interface StudioApiLike {
  getSelection(): string[];
  setSelection(ids: string[]): void;
}

interface StudioGlobal {
  kyxosStudio?: { api?: StudioApiLike };
}

const enhancedItems = new WeakSet<HTMLButtonElement>();
const enhancedPanels = new WeakSet<HTMLElement>();

function studioApi(): StudioApiLike | null {
  return (globalThis as typeof globalThis & StudioGlobal).kyxosStudio?.api ?? null;
}

function enhanceItem(item: HTMLButtonElement): void {
  if (enhancedItems.has(item)) return;
  enhancedItems.add(item);
  item.addEventListener('click', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const nodeId = item.dataset.nodeId;
    const api = studioApi();
    if (!nodeId || !api) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const selection = api.getSelection();
    api.setSelection(selection.includes(nodeId)
      ? selection.filter((id) => id !== nodeId)
      : [...selection, nodeId]);
  }, true);
}

function syncPanelState(panel: HTMLElement): void {
  const collapsed = panel.classList.contains('collapsed');
  const collapse = panel.querySelector<HTMLButtonElement>('[data-kx-entity-collapse]');
  if (collapse) {
    collapse.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} scene objects`);
    collapse.title = collapse.getAttribute('aria-label') ?? '';
  }
  const toggle = document.querySelector<HTMLButtonElement>('.kx-entity-tools-toggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!panel.hidden && !collapsed));
    toggle.classList.toggle('active', !panel.hidden);
  }
}

function enhancePanel(panel: HTMLElement): void {
  if (!enhancedPanels.has(panel)) {
    enhancedPanels.add(panel);
    new MutationObserver(() => syncPanelState(panel)).observe(panel, {
      attributes: true,
      attributeFilter: ['class', 'hidden'],
    });
  }
  syncPanelState(panel);
  panel.querySelectorAll<HTMLButtonElement>('.kx-entity-list-item').forEach(enhanceItem);
}

function scan(): void {
  document.querySelectorAll<HTMLElement>('.kx-viewport-entity-tools').forEach(enhancePanel);
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
scan();
