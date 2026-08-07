import * as THREE from 'three/webgpu';
import { pass, renderOutput } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

import { KyxosViewer } from './KyxosViewer';

const installKey = Symbol.for('kyxos.viewer.mobile-studio-beauty-pipeline');

type ViewerInternals = {
  canvas: HTMLCanvasElement;
  disposed: boolean;
  renderer: THREE.WebGPURenderer;
  renderPipeline: THREE.RenderPipeline | null;
  scene: THREE.Scene;
  camera: THREE.Camera;
  nodes: unknown[];
  debugNodes: Map<string, unknown>;
  debugView: string;
  effects: Record<string, { enabled?: boolean }>;
  beforeNode: unknown;
  finalNode: unknown;
  pipelineGeneration: number;
  warnings: Map<string, string>;
  disposePipeline(): void;
  applyOutputSelection(): void;
};

type ViewerPrototype = {
  buildPipeline(reason: string): void;
  resetTemporal(reason?: string): void;
  [installKey]?: boolean;
};

function usesMobileStudioBeautyPipeline(viewer: ViewerInternals): boolean {
  return viewer.canvas.dataset.studioRuntimeProfile === 'mobile-safe'
    && viewer.debugView === 'final';
}

const prototype = KyxosViewer.prototype as unknown as ViewerPrototype;
if (!prototype[installKey]) {
  const originalBuildPipeline = prototype.buildPipeline;
  const originalResetTemporal = prototype.resetTemporal;

  prototype.buildPipeline = function buildPipelineWithMobileBeautyOnly(
    this: KyxosViewer,
    reason: string,
  ): void {
    const internal = this as unknown as ViewerInternals;
    if (!usesMobileStudioBeautyPipeline(internal)) {
      originalBuildPipeline.call(this, reason);
      return;
    }
    if (internal.disposed) return;

    // The normal Kyxos graph always creates a 4-attachment material/velocity
    // MRT, depth, Beauty and a second Emissive pass even when every screen-space
    // effect is disabled. That architecture is useful for desktop debug/effects,
    // but it is exactly the wrong first-frame memory profile for iOS WebKit.
    // Mobile Studio renders one Beauty target and optional FXAA. The authoritative
    // scene settings are untouched; Public Viewer and desktop continue to use the
    // complete graph, and selecting a debug buffer temporarily falls back to it.
    internal.pipelineGeneration += 1;
    internal.disposePipeline();
    internal.debugNodes.clear();

    const pipeline = new THREE.RenderPipeline(internal.renderer);
    pipeline.outputColorTransform = false;
    internal.renderPipeline = pipeline;

    const beautyPass = pass(internal.scene, internal.camera);
    beautyPass.name = 'Kyxos.MobileBeauty';
    beautyPass.options.samples = 0;
    internal.nodes.push(beautyPass);

    const beauty = beautyPass.getTextureNode('output');
    internal.beforeNode = renderOutput(beauty);
    let output: any = renderOutput(beauty);
    if (internal.effects.fxaa?.enabled) {
      output = fxaa(output);
    }

    internal.finalNode = output;
    internal.debugNodes.set('beauty', internal.beforeNode);
    internal.debugNodes.set('final', output);
    internal.applyOutputSelection();
    pipeline.needsUpdate = true;
    internal.warnings.delete('pipeline');

    internal.canvas.dataset.studioRuntimePipeline = 'beauty-only';
    internal.canvas.dataset.studioRuntimeMrt = 'disabled';
    document.documentElement.dataset.studioRuntimePipeline = 'beauty-only';
    document.documentElement.dataset.studioRuntimeMrt = 'disabled';

    this.dispatchEvent(new CustomEvent('pipeline-rebuilt', {
      detail: { reason: `mobile-beauty:${reason}` },
    }));
  };

  prototype.resetTemporal = function resetTemporalWithMobileBeautyGuard(
    this: KyxosViewer,
    reason = 'manual',
  ): void {
    const internal = this as unknown as ViewerInternals;
    if (!usesMobileStudioBeautyPipeline(internal)) {
      originalResetTemporal.call(this, reason);
      return;
    }

    // Beauty-only Mobile Studio has no TRAA, SSGI, temporal reprojection or
    // denoiser history to clear. Rebuilding the RenderPipeline here only
    // destroys and reallocates the sole beauty target precisely when a freshly
    // decoded GLB has just uploaded its textures. Keep resize/debug rebuilds on
    // their explicit paths, but make temporal resets allocation-free on iOS.
    internal.canvas.dataset.studioRuntimeTemporalReset = 'skipped';
    internal.canvas.dataset.studioRuntimeTemporalResetReason = reason;
    document.documentElement.dataset.studioRuntimeTemporalReset = 'skipped';
  };

  prototype[installKey] = true;
}
