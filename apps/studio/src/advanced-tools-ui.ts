import type {
  ConsoleEntry,
  DiagnosticConsole,
  StudioApi,
  StudioMcpBridge,
  StudioPluginRegistry,
} from '@kyxos/editor-core';
import {
  createDefaultStudioHelpRegistry,
  StudioNotificationCenter,
  StudioSearchRegistry,
  StudioSettingsStore,
  type StudioHelpRegistry,
} from '@kyxos/editor-core/experience';
import {
  mountAdvancedTools as mountAdvancedToolsFull,
  type AdvancedToolsOptions as FullAdvancedToolsOptions,
} from './advanced-tools-ui-full';
import './editor-experience.css';
import './editor-experience-overrides.css';

export interface AdvancedToolsOptions {
  dialog: HTMLDialogElement;
  console: DiagnosticConsole;
  api: StudioApi;
  plugins: StudioPluginRegistry;
  mcp: StudioMcpBridge;
  canEdit: boolean;
  onError(error: unknown): void;
  search?: StudioSearchRegistry;
  settings?: StudioSettingsStore;
  notifications?: StudioNotificationCenter;
  help?: StudioHelpRegistry;
}

interface AdvancedServices {
  search: StudioSearchRegistry;
  settings: StudioSettingsStore;
  notifications: StudioNotificationCenter;
  help: StudioHelpRegistry;
}

const serviceCache = new WeakMap<StudioApi, AdvancedServices>();

export function mountAdvancedTools(options: AdvancedToolsOptions): () => void {
  const defaults = serviceCache.get(options.api) ?? createServices(options.api, options.console);
  serviceCache.set(options.api, defaults);
  const resolved: FullAdvancedToolsOptions = {
    ...options,
    search: options.search ?? defaults.search,
    settings: options.settings ?? defaults.settings,
    notifications: options.notifications ?? defaults.notifications,
    help: options.help ?? defaults.help,
  };
  const studioRoot = options.dialog.closest<HTMLElement>('.kyxos-studio-shell');
  const applySettings = () => {
    const value = resolved.settings.value;
    studioRoot?.classList.toggle('compact-density', value.compactDensity);
    studioRoot?.classList.toggle('reduced-motion', value.reducedMotion);
    studioRoot?.classList.toggle('hide-studio-tooltips', !value.showTooltips);
    studioRoot?.style.setProperty('--kyxos-hierarchy-row-height', `${value.hierarchyRowHeight}px`);
  };
  const focusAsset = (event: Event) => {
    const assetId = (event as CustomEvent<{ assetId?: string }>).detail?.assetId;
    if (!assetId) return;
    const card = document.querySelector<HTMLElement>(`[data-asset-id="${CSS.escape(assetId)}"]`);
    if (!card) return;
    card.tabIndex = -1;
    card.scrollIntoView({ block: 'nearest', behavior: resolved.settings.value.reducedMotion ? 'auto' : 'smooth' });
    card.focus({ preventScroll: true });
    card.classList.add('asset-search-highlight');
    window.setTimeout(() => card.classList.remove('asset-search-highlight'), 1_500);
  };
  const normalizeSearchCopy = () => {
    const input = options.dialog.querySelector<HTMLInputElement>('.global-search-input');
    if (input) input.placeholder = 'Search commands, active-scene entities and assets';
    const intro = [...options.dialog.querySelectorAll<HTMLElement>('.advanced-intro')]
      .find((entry) => entry.textContent?.startsWith('One index across'));
    if (intro) intro.textContent = 'Search Studio commands plus entities and assets in the active scene.';
  };
  const copyObserver = new MutationObserver(normalizeSearchCopy);
  copyObserver.observe(options.dialog, { childList: true, subtree: true });
  resolved.settings.addEventListener('change', applySettings);
  window.addEventListener('kyxos:asset-search-result', focusAsset);
  applySettings();
  const disposeFull = mountAdvancedToolsFull(resolved);
  normalizeSearchCopy();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    copyObserver.disconnect();
    resolved.settings.removeEventListener('change', applySettings);
    window.removeEventListener('kyxos:asset-search-result', focusAsset);
    disposeFull();
  };
  options.dialog.addEventListener('close', dispose, { once: true });
  return dispose;
}

function createServices(api: StudioApi, diagnosticConsole: DiagnosticConsole): AdvancedServices {
  const settings = new StudioSettingsStore('kyxos.studio.user-settings.v1');
  const notifications = new StudioNotificationCenter();
  const help = createDefaultStudioHelpRegistry('kyxos.studio.onboarding.v1');
  const search = new StudioSearchRegistry();

  search.registerProvider('active-project', () => {
    const scene = api.getScene();
    return [
      ...api.listCommands().map((command) => ({
        id: command.id,
        kind: 'command' as const,
        label: command.label,
        description: command.shortcut ? `${command.id} · ${command.shortcut}` : command.id,
        keywords: [command.id, command.shortcut ?? ''],
        disabled: command.enabled?.() === false,
        run: () => api.runCommand(command.id),
      })),
      ...scene.nodes.map((node) => {
        const nodeKind = node.cameraId
          ? 'camera'
          : node.lightId
            ? 'light'
            : node.meshAssetId
              ? 'mesh'
              : 'entity';
        return {
          id: node.id,
          kind: 'entity' as const,
          label: node.name,
          description: `${nodeKind} · ${node.children.length} children${node.locked ? ' · locked' : ''}`,
          keywords: [node.id, nodeKind, node.meshAssetId ?? '', ...(node.materialSlots ?? [])],
          run: () => api.setSelection([node.id]),
        };
      }),
      ...Object.values(scene.assets).map((asset) => ({
        id: asset.id,
        kind: 'asset' as const,
        label: asset.name ?? asset.id,
        description: `${asset.kind} · ${asset.mimeType}`,
        keywords: [asset.id, asset.kind, asset.mimeType, asset.contentHash],
        run: () => {
          notifications.push({
            severity: 'info',
            title: `Asset · ${asset.name ?? asset.id}`,
            message: `${asset.kind} · ${formatBytes(asset.byteSize ?? 0)} · ${asset.mimeType}`,
            source: 'global-search',
            details: asset,
            persistent: false,
          });
          window.dispatchEvent(new CustomEvent('kyxos:asset-search-result', {
            detail: { assetId: asset.id },
          }));
        },
      })),
    ];
  });

  const forwardConsoleEntry = (event: Event) => {
    const entry = (event as CustomEvent<ConsoleEntry>).detail;
    if (!entry || (entry.level !== 'warn' && entry.level !== 'error')) return;
    notifications.push({
      severity: entry.level === 'error' ? 'error' : 'warning',
      title: entry.level === 'error' ? 'Studio error' : 'Studio warning',
      message: entry.message,
      source: entry.source,
      details: entry.data,
      persistent: entry.level === 'error',
    });
  };
  diagnosticConsole.addEventListener('entry', forwardConsoleEntry);
  for (const entry of diagnosticConsole.list({ levels: ['warn', 'error'] })) {
    forwardConsoleEntry(new CustomEvent('entry', { detail: entry }));
  }

  return { search, settings, notifications, help };
}

function formatBytes(value: number): string {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
