import './sceneApi';
import './studioSceneLoadPipelineBudget';
import './sceneComponentHierarchy';
import './cameraFrustumRuntimeParity';
import './mobileStudioBeautyPipeline';
import './gltfNativeLoad';
import './mobileStudioFrameBudget';
import './embeddedGltfTextureApi';
import './materialEditApi';
import './materialCompleteApi';
import './materialTransparencyApi';
import './animationApi';
import './lightingApi';
import './lightShadowRuntimeParity';
import './capabilityApi';
import './environmentApi';
import './editorTransformControls';
import './editorViewportHelpers';
import './editorLightVisualization';
import './editorViewportNavigation';
import './editorRenderModes';

import { installAdvancedRenderingApi } from './advancedRenderingApi';
import { KyxosViewer } from './KyxosViewer';
import { installEditorSceneModeExtension } from './editorSceneMode';
import { installGltfAuthoringFidelityExtension } from './gltfAuthoringFidelity';
import { installGltfTextureDiagnostics } from './gltfTextureDiagnostics';
import { installScreenSpaceSSSExtension } from './materials/screenSpaceSSS';
import { installScreenSpaceSSSDebugExtension } from './materials/screenSpaceSSSDebug';
import { installViewerMetricsBroadcast } from './metricsBroadcast';
import { installNonBlockingVisibilityRecovery } from './nonBlockingVisibilityRecovery';
import { installRealtimeHybridRtExtension } from './realtimeHybridRtExtension';
import { installRenderSettingsParity } from './renderSettingsParity';
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
installRenderSettingsParity(KyxosViewer);
// Advanced rendering is deliberately installed after the existing authoring and
// render-settings wrappers so geometry/material/light edits invalidate the new
// software-ray histories without changing Studio -> Viewer package boundaries.
installAdvancedRenderingApi(KyxosViewer);
// Cinematic/RT mode is a realtime feature layer, not a second full-frame renderer.
// Install this after the Advanced API so Path Tracing can keep the progressive
// reference renderer while Hybrid RT intercepts only cinematic mode.
installRealtimeHybridRtExtension(KyxosViewer);
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
export {
  DEFAULT_SCREEN_SPACE_SSS_RENDER_SETTINGS,
  RENDER_BACKEND_OPTIONS,
  RENDER_EFFECT_LABELS,
  RENDER_EFFECT_ORDER,
  RENDER_EFFECT_PARAMETERS,
  RENDER_QUALITY_OPTIONS,
  RENDER_TONE_MAPPING_OPTIONS,
  SCREEN_SPACE_SSS_EFFECT,
  SCREEN_SPACE_SSS_PARAMETERS,
  SCREEN_SPACE_SSS_PRESETS,
  createCanonicalQualityPreset,
  enforceCanonicalEffectRules,
  formatRenderControlValue,
  mergeCanonicalEffectSettings,
  resolveCanonicalEffects,
  resolveScreenSpaceSssRenderSettings,
  type CanonicalEffectState,
  type RenderOption,
  type RenderParameterDefinition,
  type ScreenSpaceSssRenderSettings,
} from '@kyxos/scene-contract/render-settings';
export {
  DEFAULT_ADVANCED_RENDER_SETTINGS,
  normalizeAdvancedRenderSettings,
} from '@kyxos/scene-contract/advanced-render-settings';
export type {
  AdvancedRendererTier,
  AdvancedRenderingCapabilityDescription,
  AdvancedRenderingMode,
  RestirDIMode,
  SceneAdvancedRenderSettings,
  ScenePathTracingSettings,
  SceneRadianceCacheSettings,
  SceneRestirDISettings,
} from '@kyxos/scene-contract/advanced-render-settings';
export type { AdvancedRenderRuntimeState, AdvancedRenderStatus } from './advancedRenderingApi';
export {
  balanceHeuristic,
  buildAliasTable,
  buildBvh,
  buildEnvironmentAliasTable,
  environmentSolidAnglePdf,
  powerHeuristic,
  RadianceHashCache,
  reservoirFinalWeight,
  reservoirUpdate,
  TemporalHistoryRegistry,
  traceAny,
  traceClosest,
} from './render/advanced';
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
