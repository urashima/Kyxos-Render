import * as THREE from 'three/webgpu';
import SSRNode from 'three/addons/tsl/display/SSRNode.js';

type GuardedSsrNode = {
  stochastic?: boolean;
  _importanceEnvironment?: unknown;
  setEnvMap?: (texture: THREE.Texture) => void;
};

const installed = Symbol('kyxos.ssrEnvironmentGuard.installed');

const fallbackEnvironment = new THREE.DataTexture(
  new Float32Array([
    0, 0, 0, 1,
    0, 0, 0, 1,
  ]),
  2,
  1,
  THREE.RGBAFormat,
  THREE.FloatType,
);
fallbackEnvironment.name = 'Kyxos.SSR.BlackEnvironmentFallback';
fallbackEnvironment.mapping = THREE.EquirectangularReflectionMapping;
fallbackEnvironment.colorSpace = THREE.LinearSRGBColorSpace;
fallbackEnvironment.generateMipmaps = false;
fallbackEnvironment.needsUpdate = true;

/**
 * The pinned Three.js stochastic SSR path builds its environment-miss branch
 * even when no equirectangular environment was supplied. Ensure the internal
 * sampler exists so a screen-space miss resolves to black instead of throwing
 * while the TSL graph is compiled.
 */
export function installSsrEnvironmentGuard(): void {
  const prototype = SSRNode.prototype as unknown as Record<PropertyKey, unknown> & {
    setup?: (builder: unknown) => unknown;
  };
  if (prototype[installed]) return;

  const originalSetup = prototype.setup;
  if (typeof originalSetup !== 'function') return;

  prototype.setup = function guardedSetup(this: GuardedSsrNode, builder: unknown): unknown {
    if (
      this.stochastic === true &&
      this._importanceEnvironment == null &&
      typeof this.setEnvMap === 'function'
    ) {
      this.setEnvMap(fallbackEnvironment);
    }
    return originalSetup.call(this, builder);
  };

  prototype[installed] = true;
}
