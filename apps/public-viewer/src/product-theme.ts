import { applyKyxosTheme, readStoredTheme, type KyxosTheme } from '@kyxos/ui-theme';
import './product-theme.css';

const params = new URLSearchParams(location.search);
const embed = location.pathname.includes('/embed') || params.get('ui') === '0';

function requestedTheme(): KyxosTheme {
  const value = params.get('theme')?.toLowerCase();
  if (value === 'light' || value === 'red' || value === 'graphite') return 'graphite';
  if (value === 'dark' || value === 'green' || value === 'moss') return 'moss';
  return readStoredTheme();
}

function currentTheme(): KyxosTheme {
  return document.documentElement.dataset.kxTheme === 'graphite' ? 'graphite' : 'moss';
}

function apply(theme: KyxosTheme): void {
  applyKyxosTheme(theme);
  document.documentElement.dataset.kxProductTheme = theme === 'graphite' ? 'light' : 'dark';
  syncToggle();
}

function syncToggle(): void {
  const button = document.querySelector<HTMLButtonElement>('#kx-public-theme-toggle');
  if (!button) return;
  const light = currentTheme() === 'graphite';
  button.textContent = light ? 'Dark' : 'Light';
  button.title = light ? 'Use dark green and black theme' : 'Use light red and white theme';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(light));
}

function mountToggle(): void {
  if (embed) return;
  const controls = document.querySelector<HTMLElement>('.controls');
  if (!controls) {
    requestAnimationFrame(mountToggle);
    return;
  }
  if (controls.querySelector('#kx-public-theme-toggle')) return;
  const button = document.createElement('button');
  button.id = 'kx-public-theme-toggle';
  button.type = 'button';
  button.className = 'kx-public-theme-toggle';
  button.addEventListener('click', () =>
    apply(currentTheme() === 'moss' ? 'graphite' : 'moss'),
  );
  controls.append(button);
  syncToggle();
}

apply(requestedTheme());
document.documentElement.dataset.kxProduct = embed ? 'embed' : 'public';
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountToggle, { once: true });
} else {
  mountToggle();
}
