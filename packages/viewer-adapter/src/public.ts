export * from './index';
export type { EditorViewportCommand } from './editorViewportCommandBridge';
export type { TransformPivot } from './transformPivot';
export type { ViewportHelperSettings } from './viewportHelpers';
import './boxSelection';
import './transformPivot';
import './viewportHelpers';
import { installEditorViewportCommandBridge } from './editorViewportCommandBridge';
import { installNativeTransformBridge } from './nativeTransformBridge';

installNativeTransformBridge();
installEditorViewportCommandBridge();
