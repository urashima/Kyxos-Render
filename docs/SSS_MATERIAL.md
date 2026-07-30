# Three.js SSS Material Integration

## Decision

Kyxos uses Three.js' official `MeshSSSNodeMaterial` from the exact Three.js commit already pinned by `@kyxos/viewer`.

Three.js currently exposes SSS as an experimental physical node-material lighting model. It adds a view-dependent thickness-scattering term during direct lighting. It is **not** a separable full-screen Burley diffusion blur and Kyxos does not introduce a custom scattering algorithm.

This keeps the implementation aligned with the project rule to prefer official Three.js WebGPU/TSL features over locally invented shader math.

## Pipeline placement

```text
MeshSSSNodeMaterial
  -> Kyxos Beauty scene pass
  -> SSGI / SSR / spatial and temporal filters
  -> TRAA
  -> Motion Blur / Bloom / DoF / color finishing
  -> RenderPipeline output
```

SSS is evaluated while the Beauty pass shades the mesh. The existing material-data MRT remains unchanged, so depth, velocity, normal, diffuse color, metalness and roughness continue to feed the current screen-space effects.

## Public API

```ts
const status = await viewer.setSSSMaterial({
  enabled: true,
  color: '#ff8050',
  distortion: 0.1,
  ambient: 0.4,
  attenuation: 0.8,
  power: 2,
  scale: 16,
  thicknessMap: '/textures/skin-thickness.png',
});

console.log(status.convertedMaterials);
console.log(viewer.getSSSMaterialStatus());

await viewer.setSSSMaterial({ enabled: false });
```

`thicknessMap` is sampled in linear color space and multiplied by `color`. A white map means maximum configured scattering and black suppresses scattering.

## Material conversion

When enabled, Kyxos traverses the active model and converts `MeshStandardMaterial` and `MeshPhysicalMaterial` instances to official `MeshSSSNodeMaterial` instances. PBR textures and compatible physical-material properties are preserved.

When disabled, on model replacement, or during viewer disposal, Kyxos restores the original material assignments and disposes the generated SSS materials. Uploaded thickness textures are also released.

## Playground

The Playground inspector includes an **SSS Material · Three.js Official** panel with:

- enable/disable
- scattering color
- distortion
- ambient
- attenuation
- power
- scale
- thickness-map upload and clear
- one-click SSS material study

The selected SSS settings survive Viewer recreation and renderer-backend switching. An uploaded thickness file is reloaded for the new Viewer instead of reusing a disposed GPU texture.

## Limits

- The official implementation responds to direct lights; an environment-only scene may show a subtler result than a deliberately back-lit setup.
- Thickness is texture-driven or uniform-color driven. It is not computed from back-face depth.
- This branch does not add a new MRT attachment or temporal history buffer.
- The result remains compatible with the existing WebGPU renderer and official WebGL 2 backend because it is a Three.js node material rather than a custom backend-specific pass.
