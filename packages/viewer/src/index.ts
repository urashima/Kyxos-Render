import { KyxosViewer } from './KyxosViewer';
import { installSSSMaterialExtension } from './materials/sssMaterial';

installSSSMaterialExtension(KyxosViewer);

export { KyxosViewer };
export { createQualityPreset, enforceEffectRules, mergeEffectSettings } from './presets';
export {
  DEFAULT_SSS_MATERIAL_SETTINGS,
  resolveSSSMaterialSettings,
} from './materials/sssMaterial';
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
  SSSMaterialSettings,
  SSSMaterialStatus,
  StressResult,
  StressTestName,
  TextureInput,
  ViewerMetrics,
} from './types';
