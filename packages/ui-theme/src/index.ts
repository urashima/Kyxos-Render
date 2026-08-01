export type KyxosTheme = 'moss' | 'graphite';

const STORAGE_KEY = 'kyxos-ui-theme';

export function readStoredTheme(): KyxosTheme {
  if (typeof localStorage === 'undefined') return 'moss';
  return localStorage.getItem(STORAGE_KEY) === 'graphite' ? 'graphite' : 'moss';
}

export function applyKyxosTheme(theme: KyxosTheme, target: HTMLElement = document.documentElement): void {
  target.dataset.kxTheme = theme;
  target.classList.toggle('kx-theme-moss', theme === 'moss');
  target.classList.toggle('kx-theme-graphite', theme === 'graphite');
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable in locked-down embeds; the DOM theme remains active.
  }
  target.dispatchEvent(new CustomEvent('kyxos:theme-change', { detail: { theme } }));
}

export function toggleKyxosTheme(target: HTMLElement = document.documentElement): KyxosTheme {
  const next: KyxosTheme = target.dataset.kxTheme === 'graphite' ? 'moss' : 'graphite';
  applyKyxosTheme(next, target);
  return next;
}
