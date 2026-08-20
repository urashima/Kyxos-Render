import * as THREE from 'three/webgpu';
import SSRNode from 'three/addons/tsl/display/SSRNode.js';

type GuardedSsrNode = {
  stochastic?: boolean;
  envImportanceSampling?: boolean;
  _importanceEnvironment?: unknown;
  setEnvMap?: (texture: THREE.Texture | null) => void;
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
 * The pinned Three.js stochastic SSR path owns an optional CDF-backed
 * ImportanceSampledEnvironment, but Kyxos historically constructed SSR with
 * envImportanceSampling disabled. Patch setEnvMap before the first SSR instance
 * is created so valid CPU-backed HDR/EXR textures build the official CDF/MIS
 * tables. PMREM targets remain unsupported by SSRNode and still fall back to the
 * safe black CPU texture during graph construction.
 */
export function installSsrEnvironmentGuard(): void {
  const prototype = SSRNode.prototype as unknown as Record<PropertyKey, unknown> & {
    setup?: (builder: unknown) => unknown;
    setEnvMap?: (texture: THREE.Texture | null) => void;
  };
  if (prototype[installed]) return;

  const originalSetEnvMap = prototype.setEnvMap;
  if (typeof originalSetEnvMap === 'function') {
    prototype.setEnvMap = function importanceSampledSetEnvMap(
      this: GuardedSsrNode,
      texture: THREE.Texture | null,
    ): void {
      const image = texture?.image as { data?: ArrayBufferView } | undefined;
      if (this.stochastic === true && image?.data) {
        // SSRNode reads this flag when it creates ImportanceSampledEnvironment.
        // Setting it before the original call keeps the implementation entirely
        // inside Three.js' own CDF + MIS path rather than duplicating the shader.
        this.envImportanceSampling = true;
      }
      originalSetEnvMap.call(this, texture);
    };
  }

  const originalSetup = prototype.setup;
  if (typeof originalSetup === 'function') {
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
  }

  prototype[installed] = true;
}
