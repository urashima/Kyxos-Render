# Kyxos Render Engine

A compact material-preview viewer built on the Three.js WebGPU renderer, TSL, RenderPipeline and official WebGPU effect nodes. The runtime has no dependency on `realism-effects`; that project is used only as a feature, visual and parameter reference.

## Stack

- Three.js `WebGPURenderer` with automatic WebGL 2 fallback
- TSL + `RenderPipeline`
- One Scene MRT for beauty, depth, velocity, normal, diffuse color, metalness, roughness and emissive
- Official `MeshSSSNodeMaterial` for thickness-driven subsurface scattering
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
await viewer.setSSSMaterial({
  enabled: true,
  color: '#ff8050',
  distortion: 0.1,
  ambient: 0.4,
  attenuation: 0.8,
  power: 2,
  scale: 16,
  thicknessMap: '/textures/thickness.png',
});
viewer.setEffect('traa', { enabled: true });
viewer.setEffect('ssgi', { enabled: true });
viewer.setQualityPreset('high');
const metrics = viewer.getMetrics();
const image = await viewer.capture();
viewer.dispose();
```

The public API never exposes Three.js nodes, RenderPipeline, render targets, MRT textures or internal effect instances.

See [`docs/SSS_MATERIAL.md`](docs/SSS_MATERIAL.md) for the SSS pipeline placement, parameters and current Three.js limitations.
