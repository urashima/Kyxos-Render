import './sceneApi';
import './gltfNativeLoad';
import './embeddedGltfTextureApi';
import './materialEditApi';
import './animationApi';
import './lightingApi';
import './capabilityApi';
import './environmentApi';
import './editorTransformControls';
import './editorViewportHelpers';
import './editorViewportNavigation';
import './editorRenderModes';

import { KyxosViewer } from './KyxosViewer';
import { installEditorSceneModeExtension } from './editorSceneMode';
import { installGltfAuthoringFidelityExtension } from './gltfAuthoringFidelity';
import { installGltfTextureDiagnostics } from './gltfTextureDiagnostics';
import { installScreenSpaceSSSExtension } from './materials/screenSpaceSSS';
import { installScreenSpaceSSSDebugExtension } from './materials/screenSpaceSSSDebug';
import { installViewerMetricsBroadcast } from './metricsBroadcast';
import { installNonBlockingVisibilityRecovery } from './nonBlockingVisibilityRecovery';
import { installSSSStudyModelExtension } from './scene/sssStudyModel';
import { installSsrEnvironmentGuard } from './ssrEnvironmentGuard';
import { installTimestampQueryGuard } from './timestampQueryGuard';

// Resolve timestamp query pools while the renderer is tracking GPU timings and
// guard the pinned stochastic SSR path before applications create a viewer.
installTimestampQueryGuard(KyxosViewer as unknown as Parameters<typeof installTimestampQueryGuard>[0]);
installSsrEnvironmentGuard();
installNonBlockingVisibilityRecovery(KyxosViewer);

// Scene API is installed by the side-effect import above. Studio scene mode then
// removes the procedural playground model and unmanaged lights before loading
// any Scene Contract. Native glTF fidelity is restored after the editor wrapper
// so authored scenes keep their exact hierarchy, skin bind space and materials.
installEditorSceneModeExtension(KyxosViewer);
installGltfAuthoringFidelityExtension(KyxosViewer);
installGltfTextureDiagnostics(KyxosViewer);

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
export {
  DEFAULT_EDITOR_VIEWPORT_HELPERS,
  type EditorViewportHelperSettings,
} from './editorViewportHelpers';
export type { AnimationState, CameraState, PickResult } from './sceneTypes';
export type {
  EditorTransformMode,
  EditorTransformPivot,
  EditorTransformSnap,
  EditorTransformSpace,
} from './editorTransformControls';
export type {
  EditorCameraBookmarkState,
  EditorViewPreset,
} from './editorViewportNavigation';
export type { EditorRenderMode } from './editorRenderModes';
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
