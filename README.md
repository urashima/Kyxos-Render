# Kyxos Render

Kyxos is a protocol-separated 3D publishing stack built around one rendering runtime:

- **KyxosViewer** — Three.js WebGPU/TSL/RenderPipeline runtime with WebGL 2 fallback.
- **Kyxos Studio** — multi-user scene/template authoring, full glTF import, schema inspection, state graphs, versioning, source editing, autosave and immutable publishing.
- **Kyxos Public Viewer** — anonymous read-only releases and controlled Embed playback.

```text
Kyxos Studio → Scene Contract + Viewer Adapter → KyxosViewer
Kyxos Public Viewer → Scene Contract            → KyxosViewer
```

Viewer never imports Studio, authentication, persistence or PlayCanvas UI. Studio never imports Three.js. Public Viewer never imports Editor Core, PCUI, Observer or upload/draft APIs. Automated boundary and production-bundle checks enforce these rules.

Playground, Studio, Public Viewer and Embed are independent applications. Their source and production bundles do not import one another; reusable behavior lives only in protocol-level packages such as Scene Contract and KyxosViewer.

## Rendering stack

- Three.js `WebGPURenderer` with automatic WebGL 2 fallback
- TSL + `RenderPipeline`
- Scene MRT for beauty, depth, velocity, normal, diffuse color, metalness, roughness and emissive
- TRAA, SSAO, GTAO, SSR, SSGI, temporal reprojection/denoise, Poisson denoise, motion blur, bloom, DoF, FXAA, SMAA, SSAA, LUT, sharpen and sparkle
- Stable `KyxosViewer` API that never exposes Three.js nodes, RenderPipeline, render targets, MRT textures or internal effect instances

## Studio UI provenance

The Studio shell uses PCUI and Observer from the PlayCanvas open-source ecosystem, pinned to the audited PlayCanvas Editor commit recorded in `third-party/playcanvas-editor-source.json`. PlayCanvas Engine, Entity/Component, GraphicsDevice, ShareDB, Realtime, hosted project/login services, names and branding are excluded. See `THIRD_PARTY_NOTICES.md`.

## Commands

```bash
corepack enable
pnpm install --no-frozen-lockfile
pnpm verify
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:visual
pnpm build:pages
```

## Pages routes

```text
/latest/   Kyxos Viewer Playground
/studio/   Kyxos Studio
/public/   Kyxos Public Viewer
/embed/    Embed Viewer
```

## Scene API

```ts
const viewer = await KyxosViewer.create({ canvas, backend: 'auto', quality: 'high' });
await viewer.loadScene(sceneContract, assetResolver);
await viewer.applyScenePatch(patch);
viewer.setNodeTransform(nodeId, transform);
viewer.setMaterial(nodeId, slot, material);
const hit = viewer.pick(x, y);
const capabilities = viewer.getCapabilities();
const image = await viewer.capture();
viewer.dispose();
```

Architecture, protocol and production deployment details are in `docs/ARCHITECTURE.md`, `docs/SCENE_CONTRACT.md` and `docs/DEPLOYMENT.md`.
