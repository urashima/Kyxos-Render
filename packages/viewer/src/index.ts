import './sceneApi';
import './animationApi';
import './lightingApi';
import './capabilityApi';
import './environmentApi';

import { KyxosViewer } from './KyxosViewer';
import { installScreenSpaceSSSExtension } from './materials/screenSpaceSSS';
import { installScreenSpaceSSSDebugExtension } from './materials/screenSpaceSSSDebug';
import { installViewerMetricsBroadcast } from './metricsBroadcast';
import { installSSSStudyModelExtension } from './scene/sssStudyModel';

// Install the procedural study before the SSS load wrapper so loading the study
// still restores and reapplies material masks through the normal Viewer API.
installSSSStudyModelExtension(KyxosViewer);
installScreenSpaceSSSExtension(KyxosViewer);
installScreenSpaceSSSDebugExtension(KyxosViewer);
installViewerMetricsBroadcast(KyxosViewer);

export { KyxosViewer };
export { createQualityPreset, enforceEffectRules, mergeEffectSettings } from './presets';
export {
  DEFAULT_SCREEN_SPACE_SSS_SETTINGS,
  resolveScreenSpaceSSSSettings,
} from './materials/screenSpaceSSS';
export type { AnimationState, CameraState, PickResult } from './sceneTypes';
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
