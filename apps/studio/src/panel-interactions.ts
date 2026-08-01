import { SceneDocument } from '@kyxos/editor-core';

type PanelKey = 'hierarchy' | 'inspector' | 'assets';

interface PanelDefinition {
  key: PanelKey;
  panelSelector: string;
  contentSelector: string;
  rootClass: string;
  collapsedLabel: string;
  expandedLabel: string;
}

interface InspectorSnapshot {
  openSections: Map<string, boolean>;
  scrollTop: number;
  focusedControlKey: string | null;
}

const STORAGE_KEY = 'kyxos-studio-panel-layout-v3';
const SCENE_PATCH_KEY = Symbol.for('kyxos.studio.inspector-scene-patch');
let sceneChangeDepth = 0;

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

function installSceneChangeBoundary(): void {
  const prototype = SceneDocument.prototype as SceneDocument & Record<PropertyKey, unknown>;
  if (prototype[SCENE_PATCH_KEY]) return;
  prototype[SCENE_PATCH_KEY] = true;

  const originalApply = SceneDocument.prototype.apply;
  const originalReplace = SceneDocument.prototype.replace;

  SceneDocument.prototype.apply = function guardedApply(
    ...args: Parameters<SceneDocument['apply']>
  ): ReturnType<SceneDocument['apply']> {
    sceneChangeDepth += 1;
    try {
      return originalApply.apply(this, args);
    } finally {
      sceneChangeDepth -= 1;
    }
  };

  SceneDocument.prototype.replace = function guardedReplace(
    ...args: Parameters<SceneDocument['replace']>
  ): ReturnType<SceneDocument['replace']> {
    sceneChangeDepth += 1;
    try {
      return originalReplace.apply(this, args);
    } finally {
      sceneChangeDepth -= 1;
    }
  };
}

function readState(): Partial<Record<PanelKey, boolean>> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<
      Record<PanelKey, boolean>
    >;
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
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input, select, textarea, button, a, [contenteditable="true"], [role="slider"]',
      ),
    )
  );
}

function isEditingControl(content: HTMLElement): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    content.contains(active) &&
    active.matches('input, select, textarea, [contenteditable="true"], [role="slider"]')
  );
}

function sectionKey(section: HTMLDetailsElement): string {
  const summary = section.querySelector<HTMLElement>(':scope > summary');
  return (
    section.dataset.sectionKey ??
    summary?.textContent?.trim().replace(/\s+/g, '-').toLowerCase() ??
    'section'
  );
}

function controlKey(control: HTMLElement): string {
  const section = control.closest<HTMLDetailsElement>('details');
  return [
    section ? sectionKey(section) : 'root',
    control.tagName.toLowerCase(),
    control.getAttribute('aria-label') ?? '',
    control.getAttribute('name') ?? '',
    control.getAttribute('type') ?? '',
  ].join('|');
}

function captureInspector(content: HTMLElement): InspectorSnapshot {
  const openSections = new Map<string, boolean>();
  content
    .querySelectorAll<HTMLDetailsElement>('.inspector-section, .effect-card')
    .forEach((section) => openSections.set(sectionKey(section), section.open));

  const active = document.activeElement;
  return {
    openSections,
    scrollTop: content.scrollTop,
    focusedControlKey:
      active instanceof HTMLElement && content.contains(active) ? controlKey(active) : null,
  };
}

function restoreInspector(content: HTMLElement, snapshot: InspectorSnapshot): void {
  content
    .querySelectorAll<HTMLDetailsElement>('.inspector-section, .effect-card')
    .forEach((section) => {
      const open = snapshot.openSections.get(sectionKey(section));
      if (open != null) section.open = open;
    });
  content.scrollTop = snapshot.scrollTop;

  if (snapshot.focusedControlKey) {
    const replacement = [
      ...content.querySelectorAll<HTMLElement>(
        'input, select, textarea, button, [contenteditable="true"], [role="slider"]',
      ),
    ].find((control) => controlKey(control) === snapshot.focusedControlKey);
    replacement?.focus({ preventScroll: true });
  }
}

function installInspectorRenderGuard(root: HTMLElement): void {
  const content = root.querySelector<HTMLElement>('.inspector-content');
  if (!content || content.dataset.kxRenderGuard === 'true') return;
  content.dataset.kxRenderGuard = 'true';

  const originalReplaceChildren = content.replaceChildren.bind(content);
  const originalAppend = content.append.bind(content);
  let suppressAppend = false;
  let restoreToken = 0;

  content.replaceChildren = (...nodes: (Node | string)[]): void => {
    // SceneDocument changes are synchronous. Rebuilding the Inspector while a
    // native control owns focus destroys pointer capture, keyboard focus and
    // the element that is dispatching the current input/change event. Keep the
    // existing DOM for that one render; its control already contains the new
    // value and Viewer/History/Autosave listeners still receive the patch.
    if (sceneChangeDepth > 0 && isEditingControl(content)) {
      suppressAppend = true;
      queueMicrotask(() => {
        suppressAppend = false;
      });
      return;
    }

    const snapshot = captureInspector(content);
    originalReplaceChildren(...nodes);
    const token = ++restoreToken;
    queueMicrotask(() => {
      if (token === restoreToken) restoreInspector(content, snapshot);
    });
  };

  content.append = (...nodes: (Node | string)[]): void => {
    if (suppressAppend) return;
    originalAppend(...nodes);
  };
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

  const key =
    section.dataset.sectionKey ??
    summary.textContent?.trim().replace(/\s+/g, '-').toLowerCase();
  if (key) section.dataset.sectionKey = key;

  // Run after the target control's own listener. The old capture handlers used
  // preventDefault/stopPropagation before the input event reached its target,
  // which made every Inspector checkbox, slider and select appear disabled.
  summary.addEventListener('click', (event) => {
    if (!isInteractive(event.target)) return;
    const openBeforeControlClick = section.open;
    event.stopPropagation();
    queueMicrotask(() => {
      section.open = openBeforeControlClick;
      summary.setAttribute('aria-expanded', String(section.open));
    });
  });

  section.addEventListener('toggle', () => {
    summary.setAttribute('aria-expanded', String(section.open));
  });

  section.addEventListener(
    'pointerdown',
    (event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'range') {
        section.dataset.controlActive = 'true';
      }
    },
    true,
  );

  const clearActive = () => delete section.dataset.controlActive;
  section.addEventListener('pointerup', clearActive, true);
  section.addEventListener('pointercancel', clearActive, true);
  window.addEventListener('pointerup', clearActive, true);
  window.addEventListener('pointercancel', clearActive, true);
  window.addEventListener('blur', clearActive);
}

function installPanel(
  root: HTMLElement,
  definition: PanelDefinition,
  state: Partial<Record<PanelKey, boolean>>,
): void {
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
    header.setAttribute(
      'aria-label',
      collapsed ? definition.collapsedLabel : definition.expandedLabel,
    );
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

  header.addEventListener(
    'click',
    (event) => {
      if (isInteractive(event.target) && event.target !== header) {
        const collapseControl = (event.target as Element).closest(
          '.pcui-panel-header-icon, .pcui-panel-collapse-icon',
        );
        if (!collapseControl) return;
      }
      toggle(event);
    },
    true,
  );
  header.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' || event.key === ' ') toggle(event);
    },
    true,
  );

  apply(Boolean(state[definition.key]), false);
}

function upgradeStudio(root: HTMLElement): void {
  const state = readState();
  for (const definition of panelDefinitions) installPanel(root, definition, state);
  installInspectorRenderGuard(root);
  root
    .querySelectorAll<HTMLDetailsElement>('.inspector-section, .effect-card')
    .forEach(upgradeAccordion);

  const observer = new MutationObserver(() => {
    installInspectorRenderGuard(root);
    root
      .querySelectorAll<HTMLDetailsElement>('.inspector-section, .effect-card')
      .forEach(upgradeAccordion);
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

installSceneChangeBoundary();
const documentObserver = new MutationObserver(scan);
documentObserver.observe(document.documentElement, { childList: true, subtree: true });
scan();
