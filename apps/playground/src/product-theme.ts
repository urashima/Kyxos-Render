import './product-theme.css';

type ProductTheme = 'moss' | 'graphite';
const storageKey = 'kyxos-ui-theme';
const params = new URLSearchParams(location.search);

function readTheme(): ProductTheme {
  const requested = params.get('theme')?.toLowerCase();
  if (requested === 'light' || requested === 'red' || requested === 'graphite') return 'graphite';
  if (requested === 'dark' || requested === 'green' || requested === 'moss') return 'moss';
  try {
    return localStorage.getItem(storageKey) === 'graphite' ? 'graphite' : 'moss';
  } catch {
    return 'moss';
  }
}

function currentTheme(): ProductTheme {
  return document.documentElement.dataset.kxTheme === 'graphite' ? 'graphite' : 'moss';
}

function applyTheme(theme: ProductTheme): void {
  document.documentElement.dataset.kxTheme = theme;
  document.documentElement.dataset.kxProductTheme = theme === 'graphite' ? 'light' : 'dark';
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // Storage is optional for local or embedded previews.
  }
  syncToggle();
}

function syncToggle(): void {
  const button = document.querySelector<HTMLButtonElement>('#kx-playground-theme-toggle');
  if (!button) return;
  const light = currentTheme() === 'graphite';
  button.textContent = light ? 'Dark theme' : 'Light theme';
  button.setAttribute('aria-pressed', String(light));
}

function mount(): void {
  const toolbar = document.querySelector<HTMLElement>('.viewport-toolbar');
  if (!toolbar) {
    requestAnimationFrame(mount);
    return;
  }

  const quality = toolbar.querySelector<HTMLSelectElement>('#quality-select');
  if (quality && !quality.querySelector('option[value="ultra"]')) {
    const capture = quality.querySelector('option[value="capture"]');
    const option = new Option('ultra', 'ultra');
    quality.insertBefore(option, capture);
  }

  if (!toolbar.querySelector('#kx-playground-theme-toggle')) {
    const button = document.createElement('button');
    button.id = 'kx-playground-theme-toggle';
    button.type = 'button';
    button.className = 'btn kx-playground-theme-toggle';
    button.addEventListener('click', () =>
      applyTheme(currentTheme() === 'moss' ? 'graphite' : 'moss'),
    );
    toolbar.append(button);
  }
  syncToggle();
}

applyTheme(readTheme());
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
