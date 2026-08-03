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

function clickStudioTool(label: string): boolean {
  const controls = activeShell?.querySelectorAll<HTMLButtonElement>('button') ?? [];
  const control = [...controls].find((entry) => entry.textContent?.trim() === label && !entry.disabled);
  control?.click();
  return Boolean(control);
}

function onGlobalShortcut(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLocaleLowerCase();
  if (key === 'k' && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    clickStudioTool('Tools');
    return;
  }
  if (key === 'a' && event.shiftKey) {
    const studio = (globalThis as typeof globalThis & {
      kyxosStudio?: { api?: { runCommand(id: string): Promise<void> } };
    }).kyxosStudio;
    if (!studio?.api) return;
    event.preventDefault();
    event.stopPropagation();
    void studio.api.runCommand('scene.audit');
  }
}

const observer = new MutationObserver(discoverShell);
observer.observe(document.documentElement, { childList: true, subtree: true });
settings.addEventListener('change', () => {
  if (activeShell?.isConnected) applySettings(activeShell, settings.value);
  window.dispatchEvent(new CustomEvent('kyxos:studio-settings-change', { detail: settings.value }));
});
window.addEventListener('keydown', onGlobalShortcut, { capture: true });
window.addEventListener('pagehide', () => {
  observer.disconnect();
  window.removeEventListener('keydown', onGlobalShortcut, { capture: true });
}, { once: true });
discoverShell();

export { settings as studioSettings };
