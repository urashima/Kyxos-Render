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
  return mountAdvancedToolsFull(resolved);
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
          description: `${nodeKind} · ${node.children.length} children`,
          keywords: [node.id, nodeKind, node.meshAssetId ?? '', ...(node.materialSlots ?? [])],
          disabled: Boolean(node.locked),
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
