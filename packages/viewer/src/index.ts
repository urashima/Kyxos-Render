import { KyxosViewer } from './KyxosViewer';
import { installScreenSpaceSSSExtension } from './materials/screenSpaceSSS';

installScreenSpaceSSSExtension(KyxosViewer);

export { KyxosViewer };
export { createQualityPreset, enforceEffectRules, mergeEffectSettings } from './presets';
export {
  DEFAULT_SCREEN_SPACE_SSS_SETTINGS,
  resolveScreenSpaceSSSSettings,
} from './materials/screenSpaceSSS';
export type {
  BackendName,
  BackendPreference,
  CaptureOptions,
  DebugView,
  EffectName,
  EffectSettings,
  EffectsState,
  KyxosViewerCreateOptions,
  MaterialTextureInputs,
  QualityPresetName,
  ScreenSpaceSSSQuality,
  ScreenSpaceSSSSettings,
  ScreenSpaceSSSStatus,
  StressResult,
  StressTestName,
  TextureInput,
  ViewerMetrics,
} from './types';
