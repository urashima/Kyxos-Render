import type {
  ConsoleEntry,
  DiagnosticConsole,
  StudioApi,
  StudioMcpBridge,
  StudioPluginRegistry,
} from '@kyxos/editor-core';
import {
  createDefaultStudioHelpRegistry,
  StudioAuditor,
  StudioNotificationCenter,
  StudioSearchRegistry,
  StudioSettingsStore,
  StudioUserDataStore,
  type StudioAuditReport,
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
  auditor: StudioAuditor;
  userData: StudioUserDataStore;
}

const serviceCache = new WeakMap<StudioApi, AdvancedServices>();

export function mountAdvancedTools(options: AdvancedToolsOptions): () => void {
  const defaults = serviceCache.get(options.api)
    ?? createServices(options.api, options.console, options.canEdit);
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
    card.scrollIntoView({
      block: 'nearest',
      behavior: resolved.settings.value.reducedMotion ? 'auto' : 'smooth',
    });
    card.focus({ preventScroll: true });
    card.classList.add('asset-search-highlight');
    window.setTimeout(() => card.classList.remove('asset-search-highlight'), 1_500);
  };
  const normalizeSearchCopy = () => {
    const input = options.dialog.querySelector<HTMLInputElement>('.global-search-input');
    if (input) input.placeholder = 'Search commands, entities, assets and audit findings';
    const intro = [...options.dialog.querySelectorAll<HTMLElement>('.advanced-intro')]
      .find((entry) => entry.textContent?.startsWith('One index across'));
    if (intro) {
      intro.textContent = 'Search Studio commands, active-scene entities, assets and live audit findings.';
    }
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

function createServices(
  api: StudioApi,
  diagnosticConsole: DiagnosticConsole,
  canEdit: boolean,
): AdvancedServices {
  const settings = new StudioSettingsStore('kyxos.studio.user-settings.v1');
  const notifications = new StudioNotificationCenter();
  const help = createDefaultStudioHelpRegistry('kyxos.studio.onboarding.v1');
  const search = new StudioSearchRegistry();
  const auditor = new StudioAuditor();
  const userData = new StudioUserDataStore('kyxos.studio.userdata.v1');
  const auditScope = () => {
    const scene = api.getScene();
    return userData.scope(scene.metadata.authorId ?? 'local-user', scene.id);
  };
  const runAudit = (): StudioAuditReport => {
    const ignoredCodes = auditScope().get<string[]>('auditor.ignoredCodes', []);
    const report = auditor.audit(api.getScene(), { ignoredCodes });
    auditScope().set('auditor.lastReport', report);
    diagnosticConsole.log(
      report.summary.errors ? 'error' : report.summary.warnings ? 'warn' : 'info',
      `Scene audit: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.info} notes.`,
      report,
      'auditor',
    );
    notifications.push({
      severity: report.summary.errors ? 'error' : report.summary.warnings ? 'warning' : 'success',
      title: report.summary.total ? 'Scene audit completed' : 'Scene audit passed',
      message: report.summary.total
        ? `${report.summary.errors} errors · ${report.summary.warnings} warnings · ${report.summary.info} notes · ${report.summary.fixable} safe fixes`
        : 'No hierarchy, asset, material, camera, light or animation issues were found.',
      source: 'auditor',
      details: report,
      persistent: report.summary.errors > 0,
    });
    return report;
  };

  api.registerCommand({
    id: 'scene.audit',
    label: 'Audit Active Scene',
    shortcut: 'Ctrl/Cmd+Shift+A',
    run() {
      const report = runAudit();
      const first = report.findings.find((finding) => finding.nodeId);
      if (first?.nodeId) api.setSelection([first.nodeId]);
    },
  });
  api.registerCommand({
    id: 'scene.audit.apply-safe-fixes',
    label: 'Apply Safe Scene Audit Fixes',
    enabled: () => canEdit,
    run() {
      const report = runAudit();
      const patch = auditor.safeFixPatch(report);
      if (!patch.length) {
        notifications.push({
          severity: 'info',
          title: 'No safe audit fixes',
          message: 'The current findings require author review or the scene is already clean.',
          source: 'auditor',
          persistent: false,
        });
        return;
      }
      api.applyPatch('Apply safe scene audit fixes', patch);
      const verified = runAudit();
      notifications.push({
        severity: verified.summary.errors ? 'warning' : 'success',
        title: 'Safe audit fixes applied',
        message: `${patch.length} operations applied through Studio history. ${verified.summary.total} findings remain.`,
        source: 'auditor',
        details: { patch, verified },
        persistent: false,
      });
    },
  });
  api.registerCommand({
    id: 'scene.audit.ignore-code',
    label: 'Ignore Scene Audit Rule',
    run(input) {
      const code = String(
        typeof input === 'string'
          ? input
          : (input as { code?: unknown } | undefined)?.code
            ?? prompt('Audit rule code to ignore', ''),
      ).trim();
      if (!code) return;
      const scope = auditScope();
      const ignored = new Set(scope.get<string[]>('auditor.ignoredCodes', []));
      ignored.add(code);
      scope.set('auditor.ignoredCodes', [...ignored].sort());
      notifications.push({
        severity: 'info',
        title: 'Audit rule ignored',
        message: `${code} is hidden for this user and scene.`,
        source: 'auditor',
        persistent: false,
      });
    },
  });
  api.registerCommand({
    id: 'scene.audit.reset-ignored',
    label: 'Reset Ignored Scene Audit Rules',
    run() {
      auditScope().delete('auditor.ignoredCodes');
      notifications.push({
        severity: 'success',
        title: 'Audit rules restored',
        message: 'All scene audit rules are active again.',
        source: 'auditor',
        persistent: false,
      });
    },
  });

  help.registerTopic({
    id: 'auditor',
    title: 'Scene Auditor',
    summary: 'Inspect hierarchy integrity, references and runtime-safe value ranges.',
    body: 'Run Audit Active Scene from Studio API or global search. Findings cover hierarchy cycles, broken assets and components, invalid transforms, material ranges, cameras, lights, skins and animation references. Safe fixes are applied as one undoable Studio command.',
    keywords: ['audit', 'validate', 'broken', 'reference', 'orphan', 'safe fix', 'diagnostic'],
    shortcut: 'Ctrl/Cmd+Shift+A',
  });

  search.registerProvider('active-project', () => {
    const scene = api.getScene();
    const ignoredCodes = auditScope().get<string[]>('auditor.ignoredCodes', []);
    const liveAudit = auditor.audit(scene, { ignoredCodes });
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
      ...liveAudit.findings.map((finding) => ({
        id: finding.id,
        kind: 'help' as const,
        label: `Audit · ${finding.message}`,
        description: `${finding.severity} · ${finding.code} · ${finding.path}`,
        keywords: [finding.code, finding.severity, finding.path, 'audit', 'diagnostic'],
        run: () => {
          if (finding.nodeId) api.setSelection([finding.nodeId]);
          if (finding.assetId) {
            window.dispatchEvent(new CustomEvent('kyxos:asset-search-result', {
              detail: { assetId: finding.assetId },
            }));
          }
          notifications.push({
            severity: finding.severity === 'error'
              ? 'error'
              : finding.severity === 'warning'
                ? 'warning'
                : 'info',
            title: finding.code,
            message: finding.message,
            source: 'auditor',
            details: finding,
            persistent: finding.severity === 'error',
          });
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

  return { search, settings, notifications, help, auditor, userData };
}

function formatBytes(value: number): string {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
