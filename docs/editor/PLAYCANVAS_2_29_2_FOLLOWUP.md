# Kyxos Studio — PlayCanvas Editor 2.29.2 follow-up audit

## Locked upstream baseline

- Repository: `playcanvas/editor`
- Version: `2.29.2`
- Commit: `3446b0a1b7ac95912771f1431a10f804f62e814f`
- Published: 2026-07-30
- Runtime dependencies: PlayCanvas Engine `2.21.3`, Observer `1.7.1`, PCUI `6.1.4`, PCUI Graph `5.2.5`, Monaco `0.47.0`, ShareDB `3.3.2`

The audit uses the complete `src/editor/index.ts` import graph rather than only visible toolbar features. Kyxos targets authoring-behavior parity while retaining KyxosViewer, Scene Contract, Supabase and independent Studio / Playground / Public Viewer / Embed products. PlayCanvas hosted billing, organization services, branding and the PlayCanvas Engine entity runtime are not copied.

## Complete module-family mapping

| PlayCanvas 2.29.2 family | Kyxos mapping | State after this pass |
| --- | --- | --- |
| editor, permissions, history, hotkey | `SceneDocument`, `CommandBus`, `HistoryService`, role gates | Implemented |
| layout, toolbar, viewport controls | Studio Shell + Viewer Adapter | Implemented; product-specific controls remain Kyxos-native |
| storage/localstorage, clipboard | Studio settings, IndexedDB drafts, subtree clipboard | Implemented |
| console, notify, alerts | Diagnostic Console + Notification Center | Implemented for editor/runtime events; hosted maintenance and quota alerts remain backend-dependent |
| search | Cross-provider Studio search | Implemented; `Ctrl/Cmd+K` now opens the command/search surface |
| project, settings, userdata | project workspace, Scene Contract settings, scoped user/project data | Implemented in this pass for user/project-local state |
| store, observer lists, selector | Editor Core services and canonical selection | Implemented |
| entities | Hierarchy Service, virtualized rows, context commands, clipboard, lock/hide/isolate | Implemented |
| assets | Asset Workspace, folders, virtualized Grid/List, import queue, reimport, references | Implemented for Kyxos asset kinds |
| schema, attributes, inspector | Schema Inspector registry and typed fields | Implemented for Scene Contract fields |
| templates | templates/prefabs, instances and overrides | Implemented |
| scenes | multi-scene workspace | Implemented |
| repositories, version control | checkpoints, branches, diff, merge and conflict UI | Implemented; production RLS acceptance is tracked separately |
| sourcefiles, code editor | revisioned source assets + Monaco | Implemented for Kyxos-supported source files |
| realtime, messenger, relay, whoisonline | Supabase private Realtime operations and Presence | Implemented |
| chat | no production persisted conversation surface yet | Remaining |
| camera and viewport navigation | perspective/orthographic views, frame, orbit, pan, dolly and bookmarks | Implemented |
| gizmos and viewport helpers | native Three.js controls, bounds, grid, axes, cameras, lights and skeleton helpers | Implemented for Kyxos node types |
| viewport picking and rectangle selection | Viewer picking and multi-selection bridge | Implemented |
| viewport previews and render modes | animation/material previews and diagnostic render modes | Implemented |
| anim state graph | PCUI Graph + Kyxos evaluator | Implemented |
| images and texture conversion | local inspection, resize and PNG/JPEG/WebP conversion | Implemented |
| auditor | Scene integrity, references and runtime-range diagnostics | Implemented in this pass |
| help and guides | searchable help and persisted onboarding checklist | Implemented |
| plugins | permission-gated registry and lifecycle | Implemented |
| MCP and Editor API | role-aware JSON-RPC bridge and stable command API | Implemented |
| launch and publish | in-memory Preview, immutable releases, Public Viewer and Embed | Implemented |
| sprite editor | no dedicated atlas/frame editor | Remaining Kyxos-compatible mapping |
| asset store / organization / CMS pickers | PlayCanvas-hosted services | Intentional non-equivalence |
| lightmapper / batch groups / physics components / layers | not fully represented by Scene Contract | Remaining contract expansion |
| advanced asset creators | bundle, cubemap, sprite, i18n, shader and texture recompression authoring | Remaining |
| full picker suite | curve, gradient, node, project and conflict-specialized pickers | Partial |

## Delivered in this follow-up pass

### Scene Auditor

The new Auditor runs against the canonical Scene Contract and reports:

- empty scenes and missing active cameras;
- hierarchy cycles, missing parents, duplicate/missing children and parent-child mismatches;
- non-finite transforms and near-zero scale;
- missing model, material, animation, camera, light, skin and morph references;
- missing material textures and environment assets;
- invalid material scalar ranges, alpha cutoff and IOR;
- invalid camera clipping, FOV and orthographic size;
- invalid light intensity and spot cone ordering;
- missing asset dependencies and orphan assets.

Safe findings produce RFC 6902 operations and are applied through the Studio API as one undoable command. Audit results are available through global search, Diagnostic Console and Notification Center. Rules can be ignored per user and scene without mutating the project Scene Contract.

### Scoped project user data

`StudioUserDataStore` separates user/project-local state from published scene data. It provides isolated scopes, structured clone safety, persistence, import/export, reset and change events. The first consumer stores ignored Auditor rules and the last report per author and scene.

### Command access

- `Ctrl/Cmd+K` opens Studio Tools on the global search surface.
- `Ctrl/Cmd+Shift+A` runs the active-scene Auditor.
- `scene.audit`
- `scene.audit.apply-safe-fixes`
- `scene.audit.ignore-code`
- `scene.audit.reset-ignored`

## Remaining implementation order

1. Persisted project Chat / comments / typing state with Supabase RLS and Presence integration.
2. Kyxos Texture Atlas and frame editor as the compatible replacement for PlayCanvas Sprite Editor.
3. Scene Contract expansion for layers, batch groups, lightmap settings and selected physics/collider authoring data.
4. Advanced asset creators and conversion tasks: cubemap, bundle, shader/source templates, i18n, texture recompression and thumbnail regeneration.
5. Complete typed Picker registry for curves, gradients, nodes, project resources and conflict resolution.
6. Production two-user Supabase acceptance from PR #25 after the six credential secrets are configured.
7. Browser acceptance for this Auditor pass, followed by deployment of a dedicated PR preview.

## Acceptance rule

A mapped module is accepted only when it reads canonical state, mutates through commands, participates in Undo/Redo where applicable, survives save/refresh, respects role permissions, reaches the real Viewer or backend behavior, and has automated unit or browser evidence. A visible control alone is not considered implementation.
