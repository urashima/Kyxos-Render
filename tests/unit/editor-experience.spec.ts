import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultStudioHelpRegistry,
  fitImageSize,
  StudioNotificationCenter,
  StudioSearchRegistry,
  StudioSettingsStore,
  type KeyValueStorage,
} from '../../packages/editor-core/src/experience';

class MemoryStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('Studio global search', () => {
  it('ranks exact and prefix matches across providers and executes results', async () => {
    const search = new StudioSearchRegistry();
    const run = vi.fn();
    search.registerProvider('commands', () => [
      { id: 'scene.validate', kind: 'command', label: 'Validate Scene', keywords: ['contract'], run },
      { id: 'scene.export', kind: 'command', label: 'Export Scene', keywords: ['download'], run: vi.fn() },
    ]);
    search.registerProvider('entities', async () => [
      { id: 'camera', kind: 'entity', label: 'Main Camera', description: 'perspective camera', run: vi.fn() },
    ]);

    expect((await search.query('validate')).map((entry) => entry.id)).toEqual(['scene.validate']);
    expect((await search.query('scene')).map((entry) => entry.id)).toEqual(['scene.export', 'scene.validate']);
    const result = (await search.query('contract'))[0];
    await result.run();
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('Studio user settings', () => {
  it('validates, persists, imports and resets user-only preferences', () => {
    const storage = new MemoryStorage();
    const first = new StudioSettingsStore('settings', storage);
    first.update({ compactDensity: true, hierarchyRowHeight: 999, assetViewMode: 'list' });
    expect(first.value).toMatchObject({ compactDensity: true, hierarchyRowHeight: 44, assetViewMode: 'list' });

    const second = new StudioSettingsStore('settings', storage);
    expect(second.value.compactDensity).toBe(true);
    second.import('{"autosaveDelayMs":10,"showTooltips":false}');
    expect(second.value.autosaveDelayMs).toBe(250);
    expect(second.value.showTooltips).toBe(false);
    second.reset();
    expect(second.value).toMatchObject({ compactDensity: false, hierarchyRowHeight: 28, assetViewMode: 'grid' });
  });
});

describe('Studio notifications and help', () => {
  it('tracks unread state, persistent errors and onboarding completion', () => {
    const notifications = new StudioNotificationCenter();
    const info = notifications.push({ severity: 'info', title: 'Imported', message: 'Model ready', persistent: false });
    const error = notifications.push({ severity: 'error', title: 'Import failed', message: 'Decoder error', persistent: true });
    expect(notifications.unreadCount).toBe(2);
    notifications.markRead(info.id);
    expect(notifications.unreadCount).toBe(1);
    notifications.dismiss(error.id);
    expect(notifications.list()).toHaveLength(2);
    notifications.dismiss(info.id);
    expect(notifications.list()).toHaveLength(1);

    const storage = new MemoryStorage();
    const help = createDefaultStudioHelpRegistry('onboarding', storage);
    expect(help.search('reimport')[0].id).toBe('assets');
    const step = help.listSteps()[0];
    help.setStepCompleted(step.id, true);
    expect(help.listSteps()[0].completed).toBe(true);
    const restored = createDefaultStudioHelpRegistry('onboarding', storage);
    expect(restored.listSteps()[0].completed).toBe(true);
  });
});

describe('Image tool sizing', () => {
  it('preserves aspect ratio and prevents accidental upscaling by default', () => {
    expect(fitImageSize(4000, 2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(fitImageSize(400, 200, 1000, 1000)).toEqual({ width: 400, height: 200 });
    expect(fitImageSize(400, 200, 1000, 1000, true)).toEqual({ width: 1000, height: 500 });
  });
});
