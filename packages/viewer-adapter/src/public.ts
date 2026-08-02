export * from './index';
export type { EditorViewportCommand } from './editorViewportCommandBridge';
export type { TransformPivot } from './transformPivot';
import './boxSelection';
import './transformPivot';
import { installEditorViewportCommandBridge } from './editorViewportCommandBridge';
import { installNativeTransformBridge } from './nativeTransformBridge';

installNativeTransformBridge();
installEditorViewportCommandBridge();
