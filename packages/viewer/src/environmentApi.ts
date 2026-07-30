import { KyxosViewer } from './KyxosViewer';

function internals(viewer: KyxosViewer): Record<string, any> {
  return viewer as unknown as Record<string, any>;
}

KyxosViewer.prototype.clearEnvironmentAsset = function clearEnvironmentAsset(): void {
  const scene = internals(this).scene;
  if (!scene) return;
  scene.environment = null;
  if (scene.background?.isTexture) scene.background = null;
  this.resetTemporal('environment-cleared');
};

declare module './KyxosViewer' {
  interface KyxosViewer {
    clearEnvironmentAsset(): void;
  }
}
