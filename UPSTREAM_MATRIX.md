# Upstream Matrix

| Capability            | Upstream implementation            | Kyxos use                                |
| --------------------- | ---------------------------------- | ---------------------------------------- |
| Renderer/fallback     | Three.js `WebGPURenderer`          | Direct                                   |
| Render graph          | Three.js `RenderPipeline`          | Direct                                   |
| Scene buffers         | TSL `pass()` + `mrt()`             | Direct, one scene MRT                    |
| TRAA                  | `TRAANode`                         | Direct                                   |
| Static accumulation   | `SSAAPassNode`                     | Direct in Capture                        |
| GTAO/HBAO equivalent  | `GTAONode`                         | Direct                                   |
| SSAO                  | `SSAONode`                         | Direct                                   |
| SSR                   | `SSRNode`                          | Direct                                   |
| SSGI                  | `SSGINode`                         | Direct                                   |
| Temporal reprojection | `TemporalReprojectNode`            | Direct                                   |
| Temporal denoise      | `RecurrentDenoiseNode`             | Direct                                   |
| Poisson denoise       | `DenoiseNode`                      | Direct                                   |
| Motion blur           | `MotionBlur`                       | Direct                                   |
| Bloom                 | `BloomNode`                        | Direct                                   |
| Depth of field        | `DepthOfFieldNode`                 | Direct                                   |
| FXAA/SMAA             | Official display nodes             | Direct                                   |
| LUT                   | `Lut3DNode`                        | Direct with generated LUT                |
| Sharpness             | `SharpenNode`                      | Direct                                   |
| Lens distortion       | Small Kyxos TSL adapter            | Custom allowed                           |
| Gradual background    | `Scene.backgroundNode` + TSL       | Custom allowed                           |
| Sparkle               | Small Kyxos TSL adapter            | Custom allowed                           |
| realism-effects       | Feature/visual/parameter reference | No runtime dependency; no wholesale copy |
