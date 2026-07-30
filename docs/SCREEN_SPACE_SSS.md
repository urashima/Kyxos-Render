# Deferred Screen-Space Subsurface Scattering

## Scope and research boundary

Sketchfab publicly exposes material channels named `SubsurfaceScattering` and `SubsurfaceTranslucency`, and describes subsurface scattering for materials such as skin, wax, ceramics and milk. Sketchfab does not publish the source code or exact diffusion kernel used by its production renderer.

Kyxos therefore implements the same public-facing class of controls and visual behavior, but does **not** claim to be a source-identical copy. The screen-space diffusion method is based on the published separable SSS work by Jorge Jimenez and Diego Gutierrez:

- https://www.iryoku.com/separable-sss/
- https://github.com/iryoku/separable-sss
- https://sketchfab.com/blogs/community/siggraph-reveals-subsurface-scattering-materials-and-more/
- https://sketchfab.com/developers/viewer/functions

Attribution required by the reference implementation license:

> Uses Separable SSS. Copyright (C) 2012 by Jorge Jimenez and Diego Gutierrez.

## Pipeline

```text
Scene materials
  -> dedicated deferred SSS G-buffer
       normal.rgb
       mask.r
       thickness.g
       roughness.b
       baseColor.rgb
       metalness.a
       view-Z
  -> horizontal edge-aware diffusion
  -> vertical edge-aware diffusion
  -> optional broad second lobe at High quality
  -> diffuse-only dielectric correction
  -> existing Kyxos final output
```

The diffusion is material selective. Pixels are rejected or attenuated when any of these discontinuities are detected:

- SSS material mask changes
- view-space depth changes
- surface normal changes
- base color changes
- material thickness changes

This prevents the common screen-space failure where skin color bleeds across silhouettes, eyes, hair, clothing or nearby objects.

## Diffuse/specular separation

Only the estimated non-metal diffuse share receives the diffusion correction. Metal response is excluded, and smoother surfaces retain more of their original glossy response. The implementation adds the diffusion delta back to the complete Kyxos output rather than replacing the original lighting.

## Quality modes

| Mode | Diffusion | Intended use |
| --- | --- | --- |
| Low | symmetric 5-tap horizontal + vertical | WebGL 2 and lower-end devices |
| Medium | published normalized 7-tap horizontal + vertical | default interactive editing |
| High | 7-tap narrow lobe + 7-tap broad lobe | close-up skin/wax/jade presentation |

The seven-tap profile uses the published normalized weights:

```text
center: 0.382
+/- 0.333333: 0.242
+/- 0.666667: 0.061
+/- 1.0: 0.006
```

## Viewer API

```ts
viewer.setScreenSpaceSSS({
  enabled: true,
  color: '#ffb59e',
  strength: 0.72,
  radius: 7.5,
  falloff: [1, 0.37, 0.3],
  thickness: 0.55,
  depthFalloff: 72,
  normalThreshold: 0.35,
  quality: 'high',
  materialNames: ['Skin', 'Ears'],
});

const status = viewer.getScreenSpaceSSSStatus();
```

`materialNames` matches either mesh names or material names. When it is null or empty, all eligible PBR materials are selected. Per-material overrides are also supported:

```ts
material.userData.kyxosSSS = true; // force include
material.userData.kyxosSSS = false; // force exclude
material.userData.kyxosSSSThickness = 0.8;
```

## Parameters

- `color`: scattering tint.
- `strength`: blend amount between original and diffused diffuse lighting.
- `radius`: screen-space diffusion width.
- `falloff`: per-channel diffusion falloff.
- `thickness`: default normalized material thickness.
- `depthFalloff`: strength of depth discontinuity rejection.
- `normalThreshold`: normal similarity required for diffusion.
- `quality`: `low`, `medium` or `high`.
- `materialNames`: optional material/mesh allow-list.

## Ordering and compatibility

The implementation uses the same Three.js TSL and `RenderPipeline` backend as Kyxos, so it runs on WebGPU and the existing official WebGL 2 fallback. It owns a dedicated SSS G-buffer because the current shared Kyxos MRT is already limited to four WebGL 2-compatible attachments.

The SSS correction is derived from the stable Beauty signal and added to the final output. This avoids nesting the complete SSGI/SSR/DoF frame graph inside another render-to-texture node, which previously caused multi-pass scheduling failures. The current implementation is spatial; TRAA still resolves the scene normally, but the added SSS delta does not yet own a separate temporal history.

## Known screen-space limits

Like Sketchfab-style real-time screen-space diffusion, the effect cannot scatter information that is not visible in the current frame. Very thin back-lit transmission and fully occluded light transport require a separate translucency/thickness solution. This implementation targets reflected subsurface diffusion, not volumetric transmission.
