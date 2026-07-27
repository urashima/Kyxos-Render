# Development Plan

The project is delivered in one branch and one pull request. Internal checkpoints are commits, not phases.

1. Bootstrap workspace, tests, CI and Pages.
2. Implement the viewer, PBR scene, model/environment loading and Texture Lab inputs.
3. Build one official Scene MRT and buffer debug views.
4. Integrate AA, AO, SSR, SSGI, temporal and denoise nodes.
5. Add motion blur, bloom, DoF, LUT and the small allowed TSL adaptations.
6. Add five fixed quality presets and the thin public API.
7. Add the single Playground, route views, metrics and lifecycle stress harness.
8. Validate CI, publish `/latest/`, merge one PR and tag the stable result.

A blocked advanced effect remains isolated and disabled by default, with the limitation recorded in `WORK_STATUS.md`; it must not block the remaining delivery.
