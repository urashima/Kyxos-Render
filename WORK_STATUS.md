# Work Status

- Branch: `feat/webgpu-realism-complete`
- Delivery state: In progress
- Current checkpoint: bootstrap and unified viewer implementation
- Source of truth: this repository, its pull request, Actions runs and public Pages output
- Next action: run CI, fix compile/runtime failures, publish Pages, execute lifecycle acceptance, merge and tag

## Known implementation constraints

- `WebGPURenderer` is the only renderer entry point. WebGL 2 is selected through its official fallback backend.
- Temporal reset is implemented by disposing and recreating official temporal effect nodes; there is no custom history manager.
- Capture mode uses the official SSAA pass. Depth-dependent screen-space effects are disabled in SSAA capture because they do not share the jittered SSAA pass buffers.
- GPU frame time is reported only when the selected backend exposes timestamp queries; otherwise it is `null`.
