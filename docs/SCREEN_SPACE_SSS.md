# Deferred Stochastic Temporal Screen-Space Subsurface Scattering

## Scope and research boundary

Sketchfab publicly exposes material channels named `SubsurfaceScattering` and `SubsurfaceTranslucency`, and describes subsurface scattering for materials such as skin, wax, ceramics and milk. Sketchfab also documents its renderer-wide Temporal Anti-Aliasing as reusing previous frames and smoothing real-time shadows and screen-space effects. Sketchfab does **not** publish the source code, stochastic sample sequence, diffusion kernel or history rejection logic used by its production SSS renderer.

Kyxos therefore implements the same publicly observable class of low-sample temporal behavior, but does **not** claim to be a source-identical copy. The implementation combines:

- the published Separable SSS diffusion profiles by Jorge Jimenez and Diego Gutierrez;
- interleaved-gradient and frame-varying random sampling patterns used by official Three.js screen-space nodes;
- the official Three.js `TemporalReprojectNode` in diffuse mode for motion-vector reprojection, geometry validation and YCoCg variance clipping.

References:

- https://www.iryoku.com/separable-sss/
- https://github.com/iryoku/separable-sss
- https://sketchfab.com/blogs/community/siggraph-reveals-subsurface-scattering-scene-inspector/
- https://sketchfab.com/blogs/community/introducing-temporal-anti-aliasing/
- https://sketchfab.com/blogs/community/the-sketchfab-guide-to-post-processing-filters/
- https://sketchfab.com/developers/viewer/functions
- https://github.com/mrdoob/three.js/blob/3cc8908cad65fe9a75c4fcf29c4f897c593443d5/examples/jsm/tsl/display/TemporalReprojectNode.js
- https://github.com/mrdoob/three.js/blob/3cc8908cad65fe9a75c4fcf29c4f897c593443d5/examples/jsm/tsl/display/SSSNode.js

Attribution required by the reference diffusion implementation license:

> Uses Separable SSS. Copyright (C) 2012 by Jorge Jimenez and Diego Gutierrez.

## Pipeline

```text
Scene materials
  -> dedicated deferred SSS G-buffer
       normal.rgb
       velocity.xy
       mask.r
       thickness.g
       roughness.b
       baseColor.rgb
       metalness.a
       depth / view-Z
  -> reduced-resolution stochastic diffusion estimate
       Low:    one random symmetric pair  = 2 color taps/sample pixel
       Medium: two random symmetric pairs = 4 color taps/sample pixel
       High:   three pairs + stochastic broad lobe = 6 color taps/sample pixel
  -> full-resolution official TemporalReprojectNode
       motion-vector reprojection
       four-tap geometrically weighted history sampling
       previous depth and normal validation
       diffuse velocity-divergence rejection
       YCoCg neighborhood variance clipping
  -> diffuse-only dielectric correction + restrained edge translucency
  -> existing Kyxos final output
```

The stochastic pass importance-selects radii from the same target profile used by the former deterministic separable blur. Each pair receives a frame-varying two-dimensional rotation. Over time, the mean approaches the target diffusion profile instead of repeating every spatial tap during every frame.

## Default workload

The default interactive configuration is:

```text
Quality:             Low
Color taps:          2 per sampled pixel per frame
Resolution scale:    0.5 × 0.5
Sampled pixels:      25% of full-resolution pixels
Effective SSS color taps:
                     2 × 0.25 = 0.5 tap per full-resolution pixel per frame
Temporal history:    16 frames
```

The previous Low path evaluated a deterministic five-tap horizontal pass followed by a five-tap vertical pass. The new default reduces the SSS diffusion color-sample workload from ten full-resolution taps to an effective half tap per full-resolution pixel per frame, a 95% reduction in this specific sampling component.

This percentage does **not** represent the complete GPU-frame reduction. The material G-buffer, edge-stop texture reads, full-resolution temporal resolve, history validation and compositing still have real costs. GPU timing on target hardware remains the authoritative whole-effect measurement.

## Stochastic quality modes

| Mode | Random pairs | Color taps per sampled pixel | Purpose |
| --- | ---: | ---: | --- |
| Low | 1 | 2 | default interactive and lower-end devices |
| Medium | 2 | 4 | reduced noise during interaction |
| High | 3 | 6 | close-ups; also samples the broad second lobe |

`resolutionScale` is independent of quality and can be adjusted from `0.25` to `1.0`. Pixel workload is proportional to `resolutionScale²`:

| Scale | Sampled pixel ratio |
| ---: | ---: |
| 0.25 | 6.25% |
| 0.50 | 25% |
| 0.75 | 56.25% |
| 1.00 | 100% |

The temporal resolve remains full resolution. The pinned Three.js implementation explicitly supports mapping a lower-resolution beauty input onto the full-resolution resolve grid.

## Target diffusion profile

Low importance-samples this normalized five-tap target:

```text
center: 0.42
+/- 0.5: 0.24
+/- 1.0: 0.05
```

Medium and High importance-sample the published normalized seven-tap profile:

```text
center: 0.382
+/- 0.333333: 0.242
+/- 0.666667: 0.061
+/- 1.0: 0.006
```

High stochastically selects the former broad second lobe with the same 42% mixture weight and a `2.4×` radius scale. This avoids evaluating both complete lobes every frame.

## Edge stopping

Samples are rejected or attenuated when any of these discontinuities are detected:

- SSS material mask changes;
- view-space depth changes;
- surface normal changes;
- base color changes;
- material thickness changes.

This prevents skin color from bleeding across silhouettes, eyes, hair, clothing or nearby objects.

The temporal resolver independently validates reprojected history with previous depth, previous normal and motion vectors. Neighborhood variance clipping limits stale colors after disocclusion or lighting change.

## Diffuse/specular separation

Only the estimated non-metal diffuse share receives the diffusion correction. Metal response is excluded, and smoother surfaces retain more of their original glossy response. The implementation adds the diffusion delta back to the complete Kyxos output rather than replacing the original lighting.

The current input is still the rendered Beauty signal, so this is a practical Beauty-space approximation rather than a fully separated direct/indirect diffuse lighting buffer. Shadow-map shading on an SSS material can be softened; specular preservation is estimated from metalness and roughness rather than reconstructed from a dedicated specular buffer.

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
  quality: 'low',
  resolutionScale: 0.5,
  temporalFiltering: true,
  temporalMaxFrames: 16,
  temporalClamp: 0.55,
  temporalFlickerSuppression: 1,
  materialNames: ['Skin', 'Ears'],
});

const status = viewer.getScreenSpaceSSSStatus();
console.log(status.samplesPerFrame); // 2
console.log(status.sampledPixelRatio); // 0.25
console.log(status.effectiveTapsPerFullResolutionPixel); // 0.5
```

`materialNames` matches either mesh names or material names. When it is null or empty, all eligible PBR materials are selected. Per-material overrides are also supported:

```ts
material.userData.kyxosSSS = true; // force include
material.userData.kyxosSSS = false; // force exclude
material.userData.kyxosSSSThickness = 0.8;
```

## Parameters

- `color`: scattering tint.
- `strength`: diffusion contribution.
- `radius`: full-resolution screen-space diffusion width.
- `falloff`: per-channel diffusion falloff.
- `thickness`: default normalized material thickness.
- `depthFalloff`: strength of depth discontinuity rejection.
- `normalThreshold`: normal similarity required for diffusion.
- `quality`: `low`, `medium` or `high`; maps to 2, 4 or 6 color taps per sampled pixel.
- `resolutionScale`: stochastic pass scale from `0.25` to `1.0`.
- `temporalFiltering`: enables the official diffuse temporal resolver.
- `temporalMaxFrames`: maximum history accumulation length.
- `temporalClamp`: variance-clipping strength.
- `temporalFlickerSuppression`: HDR/flicker suppression used by variance clipping.
- `materialNames`: optional material/mesh allow-list.

## Debug views

The existing Debug View selector includes:

- `SSS · Mask`;
- `SSS · Thickness`;
- `SSS · Stochastic current`: raw low-sample, reduced-resolution estimate before history;
- `SSS · Temporal resolve`: accumulated full-resolution result;
- `SSS · Diffusion Δ`;
- `SSS · Translucency`.

On a static scene, `Stochastic current` should visibly change between frames while `Temporal resolve` becomes progressively more stable.

## Ordering and compatibility

The implementation uses the same pinned Three.js TSL and `RenderPipeline` backend as Kyxos, so it runs on WebGPU and the official WebGL 2 fallback. Final composition and each debug output build independent TSL graphs to avoid cross-graph assignment-stack failures.

SSS owns an effect-specific temporal history. Existing full-frame TRAA remains independent and can still resolve the final scene. This avoids requiring TRAA for SSS while retaining motion-vector-aware history when another anti-aliasing mode is selected.

## Known screen-space and temporal limits

- Off-screen and fully occluded light transport is unavailable.
- Very thin back-lit transmission remains an approximation.
- Rapid deformation, disocclusion or abrupt lighting changes can temporarily reduce history confidence and expose more noise.
- Larger history values converge more smoothly but can increase lag or ghosting.
- Lower resolution scales improve performance but lose small diffusion details.
- This is reflected screen-space diffusion plus approximate edge translucency, not volumetric transmission.
