import {
  StudioSettingsStore,
  type StudioUserSettings,
} from '@kyxos/editor-core/experience';

const settings = new StudioSettingsStore('kyxos.studio.user-settings.v1');
let activeShell: HTMLElement | null = null;

function applySettings(shell: HTMLElement, value: StudioUserSettings): void {
  shell.classList.toggle('compact-density', value.compactDensity);
  shell.classList.toggle('reduced-motion', value.reducedMotion);
  shell.classList.toggle('hide-studio-tooltips', !value.showTooltips);
  shell.style.setProperty('--kyxos-hierarchy-row-height', `${value.hierarchyRowHeight}px`);
}

function discoverShell(): void {
  const shell = document.querySelector<HTMLElement>('.kyxos-studio-shell');
  if (shell === activeShell) return;
  activeShell = shell;
  if (activeShell) applySettings(activeShell, settings.value);
}

const observer = new MutationObserver(discoverShell);
observer.observe(document.documentElement, { childList: true, subtree: true });
settings.addEventListener('change', () => {
  if (activeShell?.isConnected) applySettings(activeShell, settings.value);
  window.dispatchEvent(new CustomEvent('kyxos:studio-settings-change', { detail: settings.value }));
});
window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
discoverShell();

export { settings as studioSettings };
