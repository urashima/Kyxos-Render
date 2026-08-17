import {
  DEFAULT_ADVANCED_RENDER_SETTINGS,
  normalizeAdvancedRenderSettings,
  type SceneAdvancedRenderSettings,
} from '@kyxos/scene-contract/advanced-render-settings';
import {
  SCREEN_SPACE_SSS_EFFECT,
  resolveScreenSpaceSssRenderSettings,
} from '@kyxos/scene-contract/render-settings';
import type { SceneEffectSettings, SceneRenderSettings } from '@kyxos/scene-contract';
import type { KyxosViewer } from './KyxosViewer';
import type { ScreenSpaceSSSSettings } from './types';

const installKey = Symbol.for('kyxos.viewer.render-settings-parity');

type RenderSettingsWithAdvanced = SceneRenderSettings & { advanced?: SceneAdvancedRenderSettings };
type RenderSettingsViewer = KyxosViewer & {
  setRenderSettings(settings: SceneRenderSettings): void;
  setScreenSpaceSSS(settings: Partial<ScreenSpaceSSSSettings>): unknown;
  setAdvancedRenderSettings(settings: SceneAdvancedRenderSettings): void;
};

type ViewerConstructor = { prototype: KyxosViewer };
type MarkedViewerPrototype = RenderSettingsViewer & Record<symbol, boolean | undefined>;

export function installRenderSettingsParity(ViewerClass: ViewerConstructor): void {
  const prototype = ViewerClass.prototype as MarkedViewerPrototype;
  if (prototype[installKey]) return;

  const original = prototype.setRenderSettings;
  if (typeof original !== 'function') {
    throw new Error('Scene render settings API must be installed before render parity.');
  }

  prototype.setRenderSettings = function setRenderSettingsWithParity(
    settings: SceneRenderSettings,
  ): void {
    const rawEffects = settings.effects as Record<string, SceneEffectSettings | undefined>;
    const standardEffects = { ...rawEffects };
    const sssSettings = resolveScreenSpaceSssRenderSettings(
      standardEffects[SCREEN_SPACE_SSS_EFFECT],
    );
    delete standardEffects[SCREEN_SPACE_SSS_EFFECT];

    original.call(this, {
      ...settings,
      effects: standardEffects,
    });

    this.setScreenSpaceSSS(sssSettings as ScreenSpaceSSSSettings);
    const advanced = normalizeAdvancedRenderSettings(
      (settings as RenderSettingsWithAdvanced).advanced ?? DEFAULT_ADVANCED_RENDER_SETTINGS,
    );
    // AdvancedRenderingApi is installed immediately after this wrapper. Scene loading
    // can still invoke setRenderSettings later, when the method is guaranteed to exist.
    if (typeof this.setAdvancedRenderSettings === 'function') this.setAdvancedRenderSettings(advanced);

    const enabledEffects = Object.values(standardEffects).filter(
      (entry) => entry?.enabled,
    ).length + (sssSettings.enabled ? 1 : 0);
    this.canvas.dataset.renderSettingsParity = 'playground';
    this.canvas.dataset.renderQuality = settings.qualityPreset;
    this.canvas.dataset.renderToneMapping = settings.toneMapping;
    this.canvas.dataset.renderEffectCount = String(enabledEffects);
    this.canvas.dataset.renderingMode = advanced.renderingMode;
    this.canvas.dispatchEvent(
      new CustomEvent('kyxos-render-settings-applied', {
        detail: {
          backend: settings.backend,
          qualityPreset: settings.qualityPreset,
          exposure: settings.exposure,
          toneMapping: settings.toneMapping,
          enabledEffects,
          screenSpaceSSS: sssSettings.enabled,
          advanced,
        },
      }),
    );
  };

  prototype[installKey] = true;
}
