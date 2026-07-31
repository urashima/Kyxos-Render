# Kyxos Architecture

## Products

```text
Kyxos Studio
  ├─ @kyxos/editor-core
  ├─ @kyxos/studio-shell → PCUI + Observer
  ├─ @kyxos/viewer-adapter
  └─ Scene Contract
          ↓
     @kyxos/viewer

Kyxos Public Viewer
  ├─ @kyxos/api-client
  ├─ Scene Contract + Migrations
  └─ @kyxos/viewer
```

`@kyxos/viewer` is the only rendering runtime. It may use Three.js WebGPURenderer, TSL, RenderPipeline and official effect nodes, but it cannot import Studio, backend, authentication, PCUI or publishing code.

Studio cannot import Three.js. Every viewport change crosses `KyxosViewportAdapter`; every data change crosses `CommandBus → SceneDocument → JSON Patch → History → Autosave → Viewer Adapter`.

Public Viewer is read-only and cannot import Editor Core, Studio Shell, PCUI, Observer, upload or draft APIs. `scripts/verify-boundaries.mjs` enforces these rules and `scripts/build-pages.mjs` scans its production bundle.

## Persistence

The production reference backend is Supabase Auth, PostgreSQL, private Storage and Edge Functions. RLS protects drafts and owner assets. `published_versions` and `published_assets` reject UPDATE and DELETE through triggers. Public resolution returns only an immutable snapshot, its published asset manifest and the configured Embed origins.

When Supabase environment variables are absent, GitHub Pages uses the owner-only local provider: project metadata and releases are stored in localStorage, binary assets in IndexedDB. This provider is an acceptance environment, not a replacement for production RLS.

## Upgrade boundaries

- Viewer API version and Scene Contract version are independent.
- Studio generates controls from `viewer.getCapabilities()`.
- Public Viewer migrates supported older contracts before loading.
- Published snapshots are never edited in place.
- New Viewer releases must pass old-contract fixtures and fixed-version tests.

## Source provenance

PlayCanvas Editor commit `3446b0a1b7ac95912771f1431a10f804f62e814f` is the audited interaction reference. PCUI and Observer are contained in `@kyxos/studio-shell`; PlayCanvas Engine, Entity, Components, GraphicsDevice, ShareDB, Realtime and hosted services are excluded. See `THIRD_PARTY_NOTICES.md` and `third-party/playcanvas-editor-source.json`.
