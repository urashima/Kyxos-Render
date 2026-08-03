export * from './index';
export type {
  EditorCameraBookmarkResponse,
  EditorViewportCommand,
} from './editorViewportCommandBridge';
export type { TransformPivot } from './transformPivot';
export type { ViewportHelperSettings } from './viewportHelpers';
import './boxSelection';
import './transformPivot';
import './viewportHelpers';
import { installEditorViewportCommandBridge } from './editorViewportCommandBridge';
import { installNativeTransformBridge } from './nativeTransformBridge';
import { installNonBlockingThumbnailCapture } from './thumbnailCapture';

installNativeTransformBridge();
installNonBlockingThumbnailCapture();
installEditorViewportCommandBridge();
