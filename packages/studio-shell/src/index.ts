import { Observer } from '@playcanvas/observer';
import { Panel } from '@playcanvas/pcui';
import '@playcanvas/pcui/styles';
import { element } from '@kyxos/shared-ui';

export interface StudioShell {
  root: HTMLElement;
  topbar: HTMLElement;
  hierarchy: HTMLElement;
  viewport: HTMLElement;
  inspector: HTMLElement;
  assets: HTMLElement;
  status: HTMLElement;
  observer: Observer;
  destroy(): void;
}

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
  panel.dom.classList.add(className);
  return panel;
}

export function createStudioShell(container: HTMLElement): StudioShell {
  const observer = new Observer({
    layout: {
      hierarchyCollapsed: false,
      inspectorCollapsed: false,
      assetsCollapsed: false,
    },
    status: 'Saved',
  });

  const root = element('div', { className: 'kyxos-studio-shell pcui-theme-grey' });
  const topbar = element('header', { className: 'studio-topbar' });
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
    className: 'studio-status',
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
  const assetsPanel = createPanel('Assets / Animation', 'studio-assets', assets, {
    collapsible: true,
  });

  hierarchyPanel.on('collapse', () => observer.set('layout.hierarchyCollapsed', true));
  hierarchyPanel.on('expand', () => observer.set('layout.hierarchyCollapsed', false));
  inspectorPanel.on('collapse', () => observer.set('layout.inspectorCollapsed', true));
  inspectorPanel.on('expand', () => observer.set('layout.inspectorCollapsed', false));
  assetsPanel.on('collapse', () => observer.set('layout.assetsCollapsed', true));
  assetsPanel.on('expand', () => observer.set('layout.assetsCollapsed', false));

  root.append(
    topbar,
    hierarchyPanel.dom,
    viewport,
    inspectorPanel.dom,
    assetsPanel.dom,
    status,
  );
  container.replaceChildren(root);

  return {
    root,
    topbar,
    hierarchy,
    viewport,
    inspector,
    assets,
    status,
    observer,
    destroy() {
      hierarchyPanel.destroy();
      inspectorPanel.destroy();
      assetsPanel.destroy();
      root.remove();
    },
  };
}
