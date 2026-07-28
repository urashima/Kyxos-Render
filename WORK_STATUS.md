# Work Status

- Branch: `feat/webgpu-realism-complete`
- Delivery state: Acceptance passed; pending final merge and stable tag
- Current checkpoint: tests-pages complete
- Source of truth: this repository, PR #1, GitHub Actions, and the Pages artifact
- Next action: pass final CI for this status commit, merge PR #1, deploy `main`, verify `/latest/`, and create the first stable tag

## Acceptance evidence

- CI workflow: `CI and Pages` run #30 succeeded on commit `9b1119927b642c1549acc55985ffcabe2bffe140`
- Formatting, lint, TypeScript, unit tests, production build, and browser acceptance passed
- Full lifecycle acceptance passed with the specified resize, effect toggle, model/environment switching, and create/dispose counts
- The generated GitHub Pages artifact contains `/latest/`, all 19 requested demo routes, compiled assets, and the root redirect to `/latest/`
- `WebGPURenderer` is the only renderer entry point; WebGL 2 uses the official fallback backend
- Temporal reset disposes and recreates official temporal nodes; no custom history manager exists
- `realism-effects` remains reference-only and is not a runtime dependency

## Known implementation constraints

- Capture mode uses the official SSAA pass. Depth-dependent screen-space effects are disabled in SSAA capture because they do not share the jittered SSAA pass buffers.
- GPU frame time is reported only when the selected backend exposes timestamp queries; otherwise it is `null`.
- WebGL 2 buffer availability follows the device MRT attachment limit; unsupported advanced paths are isolated rather than blocking the viewer.
