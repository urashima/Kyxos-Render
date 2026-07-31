# Kyxos Render Engine

A compact material-preview viewer built on the Three.js WebGPU renderer, TSL, RenderPipeline and official WebGPU effect nodes. The runtime has no dependency on `realism-effects`; that project is used only as a feature, visual and parameter reference.

## Stack

- Three.js `WebGPURenderer` with automatic WebGL 2 fallback
- TSL + `RenderPipeline`
- One Scene MRT for beauty, depth, velocity, normal, diffuse color, metalness, roughness and emissive
- Material-selective deferred screen-space subsurface scattering with separable diffusion and edge stopping
- Official TRAA, SSAO, GTAO, SSR, SSGI, temporal reprojection, recurrent denoise, Poisson denoise, motion blur, bloom, DoF, FXAA, SMAA, SSAA, LUT and sharpen nodes
- Thin `KyxosViewer` integration API

## Commands

```bash
corepack enable
pnpm install
pnpm verify
pnpm test:e2e
pnpm build:pages
```

## Public API

```ts
const viewer = await KyxosViewer.create({ canvas, backend: 'auto', quality: 'high' });
await viewer.loadModel(url);
await viewer.loadEnvironment(url);
viewer.setMaterialTextures(textures);
viewer.setScreenSpaceSSS({
  enabled: true,
  color: '#ffb59e',
  strength: 0.72,
  radius: 7.5,
  falloff: [1, 0.37, 0.3],
  thickness: 0.55,
  quality: 'high',
  materialNames: ['Skin'],
});
viewer.setEffect('traa', { enabled: true });
viewer.setEffect('ssgi', { enabled: true });
viewer.setQualityPreset('high');
const metrics = viewer.getMetrics();
const image = await viewer.capture();
viewer.dispose();
```

The public API never exposes Three.js nodes, RenderPipeline, render targets, MRT textures or internal effect instances.

See [`docs/SCREEN_SPACE_SSS.md`](docs/SCREEN_SPACE_SSS.md) for the algorithm, research boundary, attribution, material selection and compatibility notes.
