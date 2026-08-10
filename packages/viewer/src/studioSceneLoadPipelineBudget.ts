import type { SceneRenderSettings } from '@kyxos/scene-contract';

import { KyxosViewer } from './KyxosViewer';

const installKey = Symbol.for('kyxos.viewer.studio-scene-load-pipeline-budget');
const lastRenderSettings = new WeakMap<KyxosViewer, string>();

type ViewerPrototype = {
  resetTemporal(reason?: string): void;
  setRenderSettings(settings: SceneRenderSettings): void;
  [installKey]?: boolean;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function renderSettingsFingerprint(settings: SceneRenderSettings): string {
  return JSON.stringify(stableValue({
    backend: settings.backend,
    qualityPreset: settings.qualityPreset,
    exposure: settings.exposure,
    toneMapping: settings.toneMapping,
    effects: settings.effects,
  }));
}

function studioSceneLoadActive(viewer: KyxosViewer): boolean {
  return Boolean(
    viewer.canvas.closest('.kyxos-studio-shell')
    && viewer.canvas.dataset.authoringReady === 'false',
  );
}

const prototype = KyxosViewer.prototype as unknown as ViewerPrototype;
if (!prototype[installKey]) {
  const originalResetTemporal = prototype.resetTemporal;
  const originalSetRenderSettings = prototype.setRenderSettings;

  prototype.resetTemporal = function resetTemporalWithStudioLoadBudget(
    this: KyxosViewer,
    reason = 'manual',
  ): void {
    if (studioSceneLoadActive(this)) {
      // Scene replacement happens while EditorSceneMode has stopped the Studio
      // render loop. The RenderPipeline already references the same Scene and
      // Camera objects, so swapping model children does not require destroying
      // and recreating every MRT/temporal target. The old implementation used
      // resetTemporal() as a full pipeline rebuild primitive for model/camera/
      // environment changes. During GLB import that queued a heavyweight rAF
      // immediately after texture upload and could monopolize Chromium's main
      // thread or terminate iOS WebContent before the editor became responsive.
      this.canvas.dataset.studioSceneLoadTemporalReset = 'deferred';
      this.canvas.dataset.studioSceneLoadTemporalReason = reason;
      document.documentElement.dataset.studioSceneLoadTemporalReset = 'deferred';
      return;
    }
    originalResetTemporal.call(this, reason);
  };

  prototype.setRenderSettings = function setRenderSettingsWithStudioLoadBudget(
    this: KyxosViewer,
    settings: SceneRenderSettings,
  ): void {
    const fingerprint = renderSettingsFingerprint(settings);
    if (lastRenderSettings.get(this) === fingerprint) {
      // Import/reimport normally preserves the project's authored render
      // settings. Reapplying an identical preset previously called
      // setQualityPreset() plus setEffect() for every effect, which queued a
      // complete pipeline rebuild even though no pipeline input changed.
      this.canvas.dataset.studioRenderSettingsSync = 'unchanged';
      return;
    }
    lastRenderSettings.set(this, fingerprint);
    this.canvas.dataset.studioRenderSettingsSync = 'applied';
    originalSetRenderSettings.call(this, settings);
  };

  prototype[installKey] = true;
}
