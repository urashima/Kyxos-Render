import type { KyxosSceneContract, ScenePatch } from '@kyxos/scene-contract';

export type ConsoleLevel = 'debug' | 'info' | 'warn' | 'error';
export interface ConsoleEntry {
  id: string;
  level: ConsoleLevel;
  message: string;
  data?: unknown;
  source?: string;
  timestamp: number;
}

export class DiagnosticConsole extends EventTarget {
  private entries: ConsoleEntry[] = [];

  constructor(private readonly limit = 2_000) { super() }

  log(level: ConsoleLevel, message: string, data?: unknown, source?: string): ConsoleEntry {
    const entry = { id: crypto.randomUUID(), level, message, data: data == null ? undefined : structuredClone(data), source, timestamp: Date.now() } satisfies ConsoleEntry;
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    this.dispatchEvent(new CustomEvent('entry', { detail: structuredClone(entry) }));
    return structuredClone(entry);
  }

  list(input: { levels?: ConsoleLevel[]; query?: string; source?: string } = {}): ConsoleEntry[] {
    const levels = new Set(input.levels ?? []);
    const query = input.query?.trim().toLocaleLowerCase() ?? '';
    return this.entries
      .filter((entry) => !levels.size || levels.has(entry.level))
      .filter((entry) => !input.source || entry.source === input.source)
      .filter((entry) => !query || entry.message.toLocaleLowerCase().includes(query) || JSON.stringify(entry.data).toLocaleLowerCase().includes(query))
      .map((entry) => structuredClone(entry));
  }

  clear(): void {
    this.entries = [];
    this.dispatchEvent(new CustomEvent('clear'));
  }

  export(): string { return JSON.stringify(this.entries, null, 2) }
}

export type StudioPluginPermission =
  | 'scene:read'
  | 'scene:write'
  | 'selection:read'
  | 'selection:write'
  | 'assets:read'
  | 'assets:write'
  | 'panels:register'
  | 'commands:register'
  | 'network';

export interface StudioPluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  permissions: StudioPluginPermission[];
}

export interface StudioCommand {
  id: string;
  label: string;
  shortcut?: string;
  enabled?(): boolean;
  run(input?: unknown): void | Promise<void>;
}

export interface StudioPanelRegistration {
  id: string;
  title: string;
  mount(container: HTMLElement): void | (() => void);
}

export interface StudioApiHost {
  getScene(): KyxosSceneContract;
  applyPatch(label: string, patch: ScenePatch): void;
  getSelection(): string[];
  setSelection(ids: string[]): void;
}

export class StudioApi extends EventTarget {
  private commands = new Map<string, StudioCommand>();
  private panels = new Map<string, StudioPanelRegistration>();

  constructor(private readonly host: StudioApiHost) { super() }

  getScene(): KyxosSceneContract { return structuredClone(this.host.getScene()) }
  applyPatch(label: string, patch: ScenePatch): void { this.host.applyPatch(label, structuredClone(patch)) }
  getSelection(): string[] { return [...this.host.getSelection()] }
  setSelection(ids: string[]): void { this.host.setSelection([...new Set(ids)]) }

  registerCommand(command: StudioCommand): () => void {
    if (this.commands.has(command.id)) throw new Error(`Command ${command.id} is already registered.`);
    this.commands.set(command.id, command);
    this.dispatchEvent(new CustomEvent('commands-change'));
    return () => { this.commands.delete(command.id); this.dispatchEvent(new CustomEvent('commands-change')) };
  }

  listCommands(): StudioCommand[] { return [...this.commands.values()] }
  async runCommand(id: string, input?: unknown): Promise<void> {
    const command = this.commands.get(id);
    if (!command) throw new Error(`Command ${id} is not registered.`);
    if (command.enabled?.() === false) throw new Error(`Command ${id} is disabled.`);
    await command.run(input);
  }

  registerPanel(panel: StudioPanelRegistration): () => void {
    if (this.panels.has(panel.id)) throw new Error(`Panel ${panel.id} is already registered.`);
    this.panels.set(panel.id, panel);
    this.dispatchEvent(new CustomEvent('panels-change'));
    return () => { this.panels.delete(panel.id); this.dispatchEvent(new CustomEvent('panels-change')) };
  }

  listPanels(): StudioPanelRegistration[] { return [...this.panels.values()] }
}

export interface StudioPluginContext {
  manifest: StudioPluginManifest;
  api: StudioApi;
  console: DiagnosticConsole;
  assertPermission(permission: StudioPluginPermission): void;
}

export interface StudioPlugin {
  manifest: StudioPluginManifest;
  activate(context: StudioPluginContext): void | (() => void) | Promise<void | (() => void)>;
}

export class StudioPluginRegistry extends EventTarget {
  private plugins = new Map<string, { plugin: StudioPlugin; dispose?: () => void; active: boolean; error?: string }>();

  constructor(private readonly api: StudioApi, private readonly console: DiagnosticConsole) { super() }

  register(plugin: StudioPlugin): () => void {
    if (!/^[a-z0-9][a-z0-9._-]+$/i.test(plugin.manifest.id)) throw new Error('Plugin IDs may contain letters, digits, dots, underscores and dashes.');
    if (this.plugins.has(plugin.manifest.id)) throw new Error(`Plugin ${plugin.manifest.id} is already registered.`);
    this.plugins.set(plugin.manifest.id, { plugin, active: false });
    this.emit();
    return () => this.unregister(plugin.manifest.id);
  }

  unregister(id: string): void {
    const entry = this.plugins.get(id);
    entry?.dispose?.();
    this.plugins.delete(id);
    this.emit();
  }

  async activate(id: string, grantedPermissions?: StudioPluginPermission[]): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) throw new Error(`Plugin ${id} is not registered.`);
    if (entry.active) return;
    const granted = new Set(grantedPermissions ?? entry.plugin.manifest.permissions);
    for (const required of entry.plugin.manifest.permissions) {
      if (!granted.has(required)) throw new Error(`Plugin permission ${required} was not granted.`);
    }
    try {
      const guardedApi = this.guardApi(id, granted);
      const dispose = await entry.plugin.activate({
        manifest: structuredClone(entry.plugin.manifest),
        api: guardedApi,
        console: this.console,
        assertPermission(permission) {
          if (!granted.has(permission)) throw new Error(`Plugin ${id} cannot use ${permission}.`);
        },
      });
      entry.dispose = typeof dispose === 'function' ? dispose : undefined;
      entry.active = true;
      delete entry.error;
      this.console.log('info', `Plugin ${entry.plugin.manifest.name} activated.`, undefined, 'plugins');
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      this.console.log('error', `Plugin ${entry.plugin.manifest.name} failed to activate.`, entry.error, 'plugins');
      throw error;
    } finally {
      this.emit();
    }
  }

  deactivate(id: string): void {
    const entry = this.plugins.get(id);
    if (!entry?.active) return;
    entry.dispose?.();
    entry.dispose = undefined;
    entry.active = false;
    this.emit();
  }

  list(): Array<StudioPluginManifest & { active: boolean; error?: string }> {
    return [...this.plugins.values()].map((entry) => ({ ...structuredClone(entry.plugin.manifest), active: entry.active, error: entry.error }));
  }

  private guardApi(id: string, granted: ReadonlySet<StudioPluginPermission>): StudioApi {
    const permissions = new Map<PropertyKey, StudioPluginPermission>([
      ['getScene', 'scene:read'],
      ['applyPatch', 'scene:write'],
      ['getSelection', 'selection:read'],
      ['setSelection', 'selection:write'],
      ['registerCommand', 'commands:register'],
      ['registerPanel', 'panels:register'],
      // Commands are extension code and may mutate the project. Treat invocation
      // as a write even if an individual command happens to be read-only.
      ['runCommand', 'scene:write'],
    ]);
    return new Proxy(this.api, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const permission = permissions.get(property);
          if (permission && !granted.has(permission)) {
            throw new Error(`Plugin ${id} cannot use ${permission}.`);
          }
          return Reflect.apply(value, target, args);
        };
      },
    });
  }

  private emit(): void { this.dispatchEvent(new CustomEvent('change', { detail: this.list() })) }
}

export interface JsonRpcRequest { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any }
export interface JsonRpcResponse { jsonrpc: '2.0'; id?: string | number | null; result?: unknown; error?: { code: number; message: string } }

export class StudioMcpBridge {
  constructor(private readonly api: StudioApi, private readonly allowWrites = false) {}

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const response: JsonRpcResponse = { jsonrpc: '2.0', id: request.id ?? null };
    try {
      if (request.method === 'initialize') {
        response.result = { protocolVersion: '2025-06-18', serverInfo: { name: 'kyxos-studio', version: '1.0.0' }, capabilities: { tools: {}, resources: {} } };
      } else if (request.method === 'tools/list') {
        response.result = { tools: [
          { name: 'studio.get_scene', description: 'Read the active Kyxos Scene Contract.', inputSchema: { type: 'object', properties: {} } },
          { name: 'studio.get_selection', description: 'Read selected entity IDs.', inputSchema: { type: 'object', properties: {} } },
          { name: 'studio.apply_patch', description: 'Apply an RFC 6902 patch through Studio history.', inputSchema: { type: 'object', required: ['label', 'patch'], properties: { label: { type: 'string' }, patch: { type: 'array' } } } },
          { name: 'studio.run_command', description: 'Run a registered Studio command.', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, input: {} } } },
        ] };
      } else if (request.method === 'resources/list') {
        response.result = { resources: [{ uri: 'kyxos://scene/active', name: 'Active Scene', mimeType: 'application/json' }] };
      } else if (request.method === 'resources/read') {
        if (request.params?.uri !== 'kyxos://scene/active') throw new Error('Resource not found.');
        response.result = { contents: [{ uri: request.params.uri, mimeType: 'application/json', text: JSON.stringify(this.api.getScene()) }] };
      } else if (request.method === 'tools/call') {
        response.result = await this.callTool(request.params?.name, request.params?.arguments ?? {});
      } else {
        response.error = { code: -32601, message: 'Method not found.' };
      }
    } catch (error) {
      response.error = { code: -32000, message: error instanceof Error ? error.message : String(error) };
    }
    return response;
  }

  private async callTool(name: string, args: any): Promise<unknown> {
    if (name === 'studio.get_scene') return { content: [{ type: 'text', text: JSON.stringify(this.api.getScene()) }] };
    if (name === 'studio.get_selection') return { content: [{ type: 'text', text: JSON.stringify(this.api.getSelection()) }] };
    if (name === 'studio.apply_patch') {
      if (!this.allowWrites) throw new Error('MCP write tools are disabled for this session.');
      this.api.applyPatch(String(args.label ?? 'MCP edit'), args.patch ?? []);
      return { content: [{ type: 'text', text: 'Patch applied.' }] };
    }
    if (name === 'studio.run_command') {
      if (!this.allowWrites) throw new Error('MCP write tools are disabled for this session.');
      await this.api.runCommand(String(args.id), args.input);
      return { content: [{ type: 'text', text: 'Command completed.' }] };
    }
    throw new Error(`Tool ${name} does not exist.`);
  }
}
