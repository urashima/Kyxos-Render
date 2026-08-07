import './mobile-actions-menu.css';

const EXCLUDED_LABELS = new Set(['Preview', 'Publish']);

function visibleLabel(button: HTMLButtonElement): string {
  return (button.getAttribute('aria-label') ?? button.textContent ?? '').trim().replace(/\s+/g, ' ');
}

function actionableButtons(root: HTMLElement): HTMLButtonElement[] {
  const slot = root.querySelector<HTMLElement>('.studio-topbar-slot');
  if (!slot) return [];
  const explicitlyGrouped = [...slot.querySelectorAll<HTMLButtonElement>('button[data-kx-mobile-action-source="true"]')];
  const candidates = explicitlyGrouped.length
    ? explicitlyGrouped
    : [...slot.querySelectorAll<HTMLButtonElement>(':scope > button')];
  return [...new Set(candidates)].filter((button) => {
    const label = visibleLabel(button);
    return label
      && !EXCLUDED_LABELS.has(label)
      && !button.classList.contains('preview-toggle')
      && !button.classList.contains('kx-topbar-overflow-trigger');
  });
}

function mount(root: HTMLElement): void {
  if (root.dataset.kxMobileActions === 'true') return;
  const end = root.querySelector<HTMLElement>('.studio-topbar-end');
  if (!end) return;
  root.dataset.kxMobileActions = 'true';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'kx-mobile-actions-trigger icon-button';
  trigger.textContent = '•••';
  trigger.title = 'More editor actions';
  trigger.setAttribute('aria-label', 'More editor actions');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'kx-mobile-actions-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');

  const close = (restoreFocus = false) => {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({ preventScroll: true });
  };

  const render = () => {
    const actions = actionableButtons(root);
    menu.replaceChildren();
    for (const source of actions) {
      const label = visibleLabel(source);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'kx-mobile-actions-item';
      item.textContent = label;
      item.disabled = source.disabled;
      item.setAttribute('role', 'menuitem');
      item.addEventListener('click', () => {
        close();
        source.click();
      });
      menu.append(item);
    }
    if (!actions.length) {
      const empty = document.createElement('span');
      empty.className = 'kx-mobile-actions-empty';
      empty.textContent = 'No additional actions';
      menu.append(empty);
    }
  };

  const open = () => {
    render();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
  };

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.hidden) open();
    else close();
  });
  menu.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('pointerdown', (event) => {
    if (menu.hidden || menu.contains(event.target as Node) || trigger.contains(event.target as Node)) return;
    close();
  });
  document.addEventListener('keydown', (event) => {
    if (menu.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!items.length) return;
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    items[(current + direction + items.length) % items.length].focus();
  });

  const syncDisabled = new MutationObserver(() => {
    if (!menu.hidden) render();
  });
  const slot = root.querySelector<HTMLElement>('.studio-topbar-slot');
  if (slot) syncDisabled.observe(slot, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'data-kx-mobile-action-source'],
  });

  end.prepend(trigger, menu);
}

function scan(): void {
  document.querySelectorAll<HTMLElement>('.kyxos-studio-shell').forEach(mount);
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scan();
