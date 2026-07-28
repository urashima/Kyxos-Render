# Work Status

- Branch: `main`
- Delivery state: Accepted and released as `v1.0.0`
- Current checkpoint: Complete
- Source of truth: this repository, merged PR #1, GitHub Actions, the Pages deployment, and tag `v1.0.0`
- Next action: None for this delivery

## Release evidence

- PR #1, `feat: rebuild Kyxos viewer with complete WebGPU realism stack`, merged into `main`
- Release merge commit: `cae1d1980e7a1e75e20a621545f0c13a5bfcc1aa`
- Final PR gate: `CI and Pages` run #40 succeeded on commit `79954d486b9eba02997da164a1c9ede739958f58`
- Formatting, lint, TypeScript, unit tests, production build, browser acceptance, and Pages artifact generation passed
- Full lifecycle acceptance passed with 100 resizes, 100 effect switches, 50 model switches, 50 environment switches, and 50 Viewer create/dispose cycles
- The Pages artifact contains `/latest/`, all 19 requested demo routes, compiled assets, and the root redirect to `/latest/`
- The `v1.0.0` tag was created only after the `main` verification and GitHub Pages deployment jobs succeeded
- Public Playground: `https://urashima.github.io/Kyxos-Render/latest/`

## Architecture acceptance

- `WebGPURenderer` is the only renderer entry point; WebGL 2 uses the official fallback backend
- The render stack uses Three.js TSL, `RenderPipeline`, official Scene MRT, and official WebGPU effect nodes
- Temporal reset disposes and recreates official temporal nodes; no custom history manager exists
- `realism-effects` remains reference-only and is not a runtime dependency
- Texture Lab receives only the thin `KyxosViewer` public API

## Known implementation constraints

- Capture mode uses the official SSAA pass. Depth-dependent screen-space effects are disabled in SSAA capture because they do not share the jittered SSAA pass buffers.
- GPU frame time is reported only when the selected backend exposes timestamp queries; otherwise it is `null`.
- WebGL 2 buffer availability follows the device MRT attachment limit; unsupported advanced paths are isolated rather than blocking the viewer.
- This agent verified the successful Pages deployment dependency chain and generated site artifact; direct external HTTP probing of the Pages URL was blocked by the execution environment's URL-access policy.
