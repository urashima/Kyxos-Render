type ViewerPrototype = {
  renderFrame?: (time: number) => void;
  renderer?: {
    backend?: {
      hasTimestamp?: boolean;
      trackTimestamp?: boolean;
    };
    resolveTimestampsAsync?: (type?: string) => Promise<number | undefined>;
  };
  warn?: (key: string, message: string) => void;
  [key: symbol]: unknown;
};

type ViewerConstructor = {
  prototype: ViewerPrototype;
};

const installed = Symbol('kyxos.timestampQueryGuard.installed');
const pending = Symbol('kyxos.timestampQueryGuard.pending');
const lastResolution = Symbol('kyxos.timestampQueryGuard.lastResolution');

/**
 * Three.js timestamp query pools must be resolved while timestamp tracking is
 * enabled. Without this, effect-heavy RenderPipeline rebuilds eventually
 * exhaust the WebGPU query pool and subsequent render pipelines can be dropped.
 */
export function installTimestampQueryGuard(ViewerClass: ViewerConstructor): void {
  const prototype = ViewerClass.prototype;
  if (prototype[installed]) return;

  const originalRenderFrame = prototype.renderFrame;
  if (typeof originalRenderFrame !== 'function') return;

  prototype.renderFrame = function guardedRenderFrame(this: ViewerPrototype, time: number): void {
    originalRenderFrame.call(this, time);

    const renderer = this.renderer;
    const backend = renderer?.backend;
    if (
      !renderer?.resolveTimestampsAsync ||
      !backend?.hasTimestamp ||
      backend.trackTimestamp === false ||
      this[pending] === true ||
      time - Number(this[lastResolution] ?? 0) < 250
    ) {
      return;
    }

    this[lastResolution] = time;
    this[pending] = true;
    void Promise.resolve()
      .then(() => renderer.resolveTimestampsAsync?.('render'))
      .catch((error: unknown) => {
        this.warn?.(
          'gpu-timestamp',
          `GPU timestamp query failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        this[pending] = false;
      });
  };

  prototype[installed] = true;
}
