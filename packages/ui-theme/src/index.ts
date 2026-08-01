export type KyxosThemeName = 'moss' | 'graphite';

const STORAGE_KEY = 'kyxos-ui-theme';

export function readStoredTheme(): KyxosThemeName {
  if (typeof localStorage === 'undefined') return 'moss';
  return localStorage.getItem(STORAGE_KEY) === 'graphite' ? 'graphite' : 'moss';
}

export function applyKyxosTheme(theme: KyxosThemeName): KyxosThemeName {
  document.documentElement.dataset.kxTheme = theme;
  document.documentElement.style.colorScheme = 'dark';
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable in locked-down embeds; the applied DOM theme remains valid.
  }
  window.dispatchEvent(new CustomEvent('kyxos:theme-change', { detail: { theme } }));
  return theme;
}

export function initializeKyxosTheme(): KyxosThemeName {
  return applyKyxosTheme(readStoredTheme());
}

export function toggleKyxosTheme(): KyxosThemeName {
  return applyKyxosTheme(readStoredTheme() === 'moss' ? 'graphite' : 'moss');
}
