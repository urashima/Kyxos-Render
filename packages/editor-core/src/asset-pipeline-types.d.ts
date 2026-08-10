import './asset-pipeline';

export {};

declare module './asset-pipeline' {
  interface SceneAssetBundle {
    metadata?: Record<string, unknown>;
  }
}
