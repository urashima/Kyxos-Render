import './topbar-layout-parity.css';

const SECONDARY_ACTIONS = new Set([
  'Scenes',
  'State Graph',
  'Collaborate',
  'History',
  'Code',
  'Tools',
  'Versions',
]);

function labelOf(button: HTMLButtonElement): string {
  return (button.getAttribute('aria-label') ?? button.textContent ?? '').trim().replace(/\s+/g, ' ');
}

function directButtons(slot: HTMLElement): HTMLButtonElement[] {
  return [...slot.children].filter((child): child is HTMLButtonElement => child instanceof HTMLButtonElement);
}

function findButton(slot: HTMLElement, label: string): HTMLButtonElement | undefined {
  return directButtons(slot).find((button) => labelOf(button) === label);
}

function mount(root: HTMLElement): void {
  const slot = root.querySelector<HTMLElement>('.studio-topbar-slot');
  if (!slot || slot.dataset.kxTopbarLayout === 'true') return;

  const publish = findButton(slot, 'Publish');
  const projects = directButtons(slot).find((button) => /projects/i.test(labelOf(button)));
  const title = [...slot.children].find((child) => child instanceof HTMLElement && child.tagName === 'STRONG') as HTMLElement | undefined;
  const save = slot.querySelector<HTMLElement>(':scope > .save-state');
  const role = slot.querySelector<HTMLElement>(':scope > .role-badge');
  const presence = slot.querySelector<HTMLElement>(':scope > .presence-strip');
  const tools = slot.querySelector<HTMLElement>(':scope > .tool-group');
  const coordinate = slot.querySelector<HTMLSelectElement>(':scope > select[aria-label="Coordinate space"]');
  const snap = directButtons(slot).find((button) => /^Snap\b/i.test(labelOf(button)));
  const undo = findButton(slot, 'Undo');
  const redo = findButton(slot, 'Redo');
  const preview = findButton(slot, 'Preview');
  const upload = findButton(slot, 'Upload');

  // Wait until main.ts has finished constructing the editor controls. Moving the
  // actual nodes preserves all existing listeners, disabled states and role logic.
  if (!publish || !projects || !title || !save || !tools || !coordinate || !undo || !redo || !preview) return;
  slot.dataset.kxTopbarLayout = 'true';

  const context = document.createElement('div');
  context.className = 'kx-topbar-context';
  context.setAttribute('aria-label', 'Project context');

  const projectCopy = document.createElement('div');
  projectCopy.className = 'kx-topbar-project-copy';
  title.classList.add('kx-topbar-title');
  projectCopy.append(title, role ?? document.createTextNode(''), presence ?? document.createTextNode(''));
  context.append(projects, projectCopy, save);

  const editorTools = document.createElement('div');
  editorTools.className = 'kx-topbar-editor-tools';
  editorTools.setAttribute('aria-label', 'Editor tools');
  const transformCluster = document.createElement('div');
  transformCluster.className = 'kx-topbar-cluster kx-topbar-transform-cluster';
  transformCluster.append(tools, coordinate);
  if (snap) transformCluster.append(snap);

  const historyCluster = document.createElement('div');
  historyCluster.className = 'kx-topbar-cluster kx-topbar-history-cluster';
  historyCluster.append(undo, redo);

  const viewCluster = document.createElement('div');
  viewCluster.className = 'kx-topbar-cluster kx-topbar-view-cluster';
  preview.classList.add('kx-topbar-preview');
  viewCluster.append(preview);
  editorTools.append(transformCluster, historyCluster, viewCluster);

  const primary = document.createElement('div');
  primary.className = 'kx-topbar-primary';
  if (upload) primary.append(upload);
  publish.classList.add('kx-topbar-publish');
  primary.append(publish);

  const overflow = document.createElement('div');
  overflow.className = 'kx-topbar-overflow';
  const overflowTrigger = document.createElement('button');
  overflowTrigger.type = 'button';
  overflowTrigger.className = 'kx-topbar-overflow-trigger icon-button';
  overflowTrigger.textContent = '•••';
  overflowTrigger.title = 'More project tools';
  overflowTrigger.setAttribute('aria-label', 'More project tools');
  overflowTrigger.setAttribute('aria-haspopup', 'menu');
  overflowTrigger.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div');
  menu.className = 'kx-topbar-overflow-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  overflow.append(overflowTrigger, menu);

  for (const button of directButtons(slot)) {
    const label = labelOf(button);
    if (!label || button === publish || button === projects || button === undo || button === redo || button === preview || button === upload || button === snap) continue;
    if (!SECONDARY_ACTIONS.has(label)) continue;
    button.dataset.kxMobileActionSource = 'true';
    button.setAttribute('role', 'menuitem');
    menu.append(button);
  }
  // Core editing actions that move out of the visual topbar on phones remain
  // first-class mobile menu sources. We mirror the original controls rather
  // than reimplementing history/snap commands, so disabled/permission state is
  // always inherited from the same command path.
  undo.dataset.kxMobileActionSource = 'true';
  redo.dataset.kxMobileActionSource = 'true';
  if (snap) snap.dataset.kxMobileActionSource = 'true';
  if (upload) upload.dataset.kxMobileActionSource = 'true';
  publish.dataset.kxMobileActionSource = 'true';
  preview.dataset.kxMobileActionSource = 'true';
  projects.dataset.kxMobileActionSource = 'true';

  // Preserve hidden file inputs used by Upload / Reimport and any future
  // extension nodes that are intentionally not part of the visible topbar.
  slot.prepend(context, editorTools, primary, overflow);

  const close = (restoreFocus = false) => {
    if (menu.hidden) return;
    menu.hidden = true;
    overflowTrigger.setAttribute('aria-expanded', 'false');
    overflow.classList.remove('is-open');
    if (restoreFocus) overflowTrigger.focus({ preventScroll: true });
  };
  const open = () => {
    menu.hidden = false;
    overflowTrigger.setAttribute('aria-expanded', 'true');
    overflow.classList.add('is-open');
    requestAnimationFrame(() => menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
  };

  overflowTrigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hidden) open();
    else close();
  });
  menu.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (target) close();
    event.stopPropagation();
  });
  document.addEventListener('pointerdown', (event) => {
    if (menu.hidden || overflow.contains(event.target as Node)) return;
    close();
  });
  document.addEventListener('keydown', (event) => {
    if (menu.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!items.length) return;
    event.preventDefault();
    const active = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Home') items[0].focus();
    else if (event.key === 'End') items.at(-1)?.focus();
    else {
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      items[(Math.max(0, active) + direction + items.length) % items.length].focus();
    }
  });

  const syncCompactState = () => {
    const width = root.getBoundingClientRect().width;
    root.dataset.topbarDensity = width < 980 ? 'compact' : width < 1280 ? 'comfortable' : 'full';
  };
  const resizeObserver = new ResizeObserver(syncCompactState);
  resizeObserver.observe(root);
  syncCompactState();

  root.addEventListener('kx:destroy', () => resizeObserver.disconnect(), { once: true });
}

function scan(): void {
  document.querySelectorAll<HTMLElement>('.kyxos-studio-shell').forEach(mount);
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scan();