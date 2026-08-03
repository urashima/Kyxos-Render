import { describe, expect, it } from 'vitest';
import { KyxosViewer } from '../../packages/viewer/src/KyxosViewer';

describe('SSR environment selection', () => {
  it('uses CPU-backed equirectangular textures and rejects PMREM targets', () => {
    const viewer = Object.create(KyxosViewer.prototype) as KyxosViewer & {
      environmentResource: unknown;
      getStochasticSsrEnvironment(): unknown;
    };
    const hdr = {
      isTexture: true,
      image: { data: new Float32Array([1, 1, 1, 1]) },
    };

    viewer.environmentResource = hdr;
    expect(viewer.getStochasticSsrEnvironment()).toBe(hdr);

    viewer.environmentResource = { texture: hdr };
    expect(viewer.getStochasticSsrEnvironment()).toBeNull();
  });
});
