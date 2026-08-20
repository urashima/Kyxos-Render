import type {
  AdvancedRenderingCapabilityDescription,
  SceneAdvancedRenderSettings,
} from './advanced-render-settings';

declare module './index' {
  interface SceneRenderSettings {
    /** High-level, backend-independent advanced rendering intent. */
    advanced?: SceneAdvancedRenderSettings;
  }

  interface ViewerCapabilityDescription {
    /** Runtime-negotiated WebGPU enhanced-rendering capabilities. */
    advancedRendering?: AdvancedRenderingCapabilityDescription;
  }
}

export {};
