export * from './index';
export type { EditorViewportCommand } from './editorViewportCommandBridge';
import './boxSelection';
import { installEditorViewportCommandBridge } from './editorViewportCommandBridge';
import { installNativeTransformBridge } from './nativeTransformBridge';

installNativeTransformBridge();
installEditorViewportCommandBridge();