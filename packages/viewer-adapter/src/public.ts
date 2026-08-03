export * from './index';
export type {
  EditorCameraBookmarkState,
  EditorRenderMode,
} from '@kyxos/viewer';
export type {
  EditorCameraBookmarkResponse,
  EditorViewportCommand,
} from './editorViewportCommandBridge';
export type { TransformPivot } from './transformPivot';
export type { ViewportHelperSettings } from './viewportHelpers';
import './boxSelection';
import './transformPivot';
import './viewportHelpers';
import { installBackendQueryOverride } from './backendQueryOverride';
import { installEditorViewportCommandBridge } from './editorViewportCommandBridge';
import { installNativeTransformBridge } from './nativeTransformBridge';
import { installNonBlockingThumbnailCapture } from './thumbnailCapture';

installBackendQueryOverride();
installNativeTransformBridge();
installNonBlockingThumbnailCapture();
installEditorViewportCommandBridge();
