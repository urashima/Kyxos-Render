# Kyxos Studio — PlayCanvas Editor 2.29.2 parity contract

## Upstream baseline

- Repository: `https://github.com/playcanvas/editor`
- Version: `2.29.2`
- Commit: `3446b0a1b7ac95912771f1431a10f804f62e814f`
- License: MIT
- Runtime dependencies reviewed: PlayCanvas Engine 2.21.3, Observer 1.7.1, PCUI 6.1.4 and PCUI Graph 5.2.5.

The target is complete **authoring-behavior parity**, not a second rendering engine and not a dependency on PlayCanvas hosted services. PlayCanvas Engine entities, components and launch runtime are translated to Kyxos Scene Contract, KyxosViewer, Editor Core and the Kyxos backend. PlayCanvas names, branding, hosted URLs and service-only code are not copied.

## Non-negotiable product rule

A feature is not complete because a control is visible. It is complete only when:

1. the control reads canonical project state;
2. editing produces a CommandBus operation;
3. the operation updates SceneDocument;
4. History can undo and redo it;
5. Autosave persists it;
6. ViewerAdapter applies it to the real imported asset;
7. refresh restores it;
8. publish freezes it into an immutable release;
9. an automated browser test proves the workflow;
10. no Playground procedural content is treated as project content.

## Upstream module inventory and Kyxos mapping

| PlayCanvas module | Responsibilities | Kyxos target | Current status |
| --- | --- | --- | --- |
| `src/editor/layout` | Editor shell, panels, resizing, persistence | `@kyxos/studio-shell` | Implemented for Kyxos panels |
| `src/editor/project` | Project settings, metadata, permissions | Studio project workspace + backend | Implemented for Kyxos project model |
| `src/editor/scenes` | Scene create, load, duplicate, delete, merge | Scene workspaces, checkpoints and revisions | Implemented |
| `src/editor/assets` | Import, folders, selection, thumbnails, references, tasks | Asset workspace + signed storage | Implemented |
| `src/editor/entities` | Hierarchy, parenting, duplication, deletion, templates | `HierarchyService` + template workspace | Implemented |
| `src/editor/attributes` | Schema-driven fields and data binding | `InspectorSchemaRegistry` | Implemented |
| `src/editor/inspector` | Entity, component, asset and project inspectors | Schema inspector host | Implemented for Scene Contract fields |
| `src/editor/selector` | Cross-surface selection model | `ProjectSession.selection` | Implemented |
| `src/editor/history` | Atomic undo/redo and merge groups | `CommandBus` and `History` | Implemented |
| `src/editor/hotkey` | Context-aware shortcuts | Hierarchy/editor shortcut routing | Implemented for aligned commands |
| `src/editor/viewport` | Render viewport, picking, overlays, cameras, helpers | KyxosViewer editor viewport | Partial |
| `src/editor/viewport-controls` | Transform gizmos, camera controls, snapping | ViewerAdapter editor controls | Prototype only |
| `src/editor/toolbar` | Tools, play/launch, settings and state | Studio top/viewport toolbars | Implemented for Kyxos tools |
| `src/editor/drop` | Drag/drop routing and validation | Asset drop router | Implemented for supported asset types |
| `src/editor/search` | Global/project search | Hierarchy and asset search/filtering | Partial: no global command palette |
| `src/editor/pickers` | Asset/entity/material/curve pickers | Typed schema pickers | Implemented for Asset and Entity fields |
| `src/editor/schema` | Component and attribute schemas | Scene Contract inspector schemas | Implemented |
| `src/editor/settings` | User/editor/project settings | Settings documents | Partial |
| `src/editor/scene-settings` | Rendering, physics, layers and environment | Kyxos render/environment settings | Implemented for supported Kyxos runtime settings |
| `src/editor/animstategraph` | Animation state graph editing | PCUI Graph editor + Kyxos runtime evaluator | Implemented |
| `src/editor/templates` | Entity templates and overrides | Scene templates/prefabs | Implemented |
| `src/editor/storage` | Local storage and editor preferences | IndexedDB/local persistence | Partial |
| `src/editor/store` | Shared editor stores | Editor Core stores | Partial |
| `src/editor/realtime` | Live document synchronization | Private Supabase Realtime channel + operation log | Implemented |
| `src/editor/messenger` / `relay` | Realtime event transport | Broadcast, Presence and persisted operation transport | Implemented |
| `src/editor/users` / `whoisonline` / `chat` | Presence and collaboration UI | Presence and member sessions | Implemented; chat remains an extension point |
| `src/editor/permissions` | Role and write-state enforcement | Owner/Editor/Viewer UI + Supabase RLS | Implemented |
| `src/editor/repositories` / `vc` | Branches, checkpoints, diff, merge | Version-control workspace | Implemented |
| `src/editor/sourcefiles` | Script source assets | Revisioned source workspace | Implemented |
| `src/code-editor` | Monaco, tabs, search, merge and realtime editing | Monaco source editor | Implemented for revisioned Kyxos source files |
| `src/editor/console` | Runtime/editor logs and filtering | Diagnostics console | Implemented |
| `src/editor/alerts` / `notify` | Errors, warnings, tasks and notices | Notification/task center | Partial |
| `src/editor/help` / `guides` | Context help and onboarding | Help overlays and first-run workflow | Missing |
| `src/editor/plugins` / `src/plugins` | Extension points | Permission-gated Kyxos plugin registry | Implemented |
| `src/editor/mcp` | AI inspection and project mutation | Role-aware Studio MCP bridge | Implemented |
| `src/editor/images` | Image inspection and processing | Texture preview/conversion tools | Missing |
| `src/texture-convert` / `workers` / `wasm` | Background conversion/import processing | Import workers, task queue and Three.js decoder stack | Implemented for glTF/GLB, Draco, Meshopt and KTX2/Basis |
| `src/launch` | Play/launch variants and runtime handoff | Preview/Public Viewer/Embed | Implemented with independent app bundles |
| `src/editor-api` | Stable programmatic editor API | Kyxos Studio API | Implemented |

## Workstream A — real asset and scene authoring

### A1. Empty scene correctness

- New projects must contain no generated Playground mesh.
- Viewport displays an explicit empty state.
- GLB can be selected or dropped.
- Import replaces the empty scene with the real GLB scene graph.
- Opening another empty project clears the previous model.

### A2. GLB and glTF import parity

- Preserve the full node hierarchy, transforms, names and visibility.
- Preserve all mesh primitives and all material slots, not only primitive zero.
- Preserve skins, joints, inverse bind matrices and morph targets.
- Preserve cameras and `KHR_lights_punctual` lights.
- Preserve animation clips, channels, interpolation and duration.
- Preserve embedded and external textures.
- Support Draco, Meshopt, KTX2/Basis and supported glTF extensions.
- Display structured import warnings and unsupported-extension errors.
- Import must be cancellable and report hashing/upload/parsing/build stages.
- Reimport must support replace, keep overrides and reset overrides.

### A3. Asset workspace

- Folder tree, breadcrumbs, grid/list modes and search.
- Multi-select, rename, duplicate, move, delete and restore.
- Type filters for model, material, texture, environment and animation.
- Real thumbnails generated from the asset, never placeholder text.
- Dependency and reverse-reference inspection.
- Drag assets into viewport, hierarchy and inspector slots.
- Asset task queue with progress, retry, cancel and error details.

## Workstream B — entities and hierarchy

- True nested tree with expansion state and virtualized rows.
- Add empty node, camera, directional/point/spot light and supported Kyxos node types.
- Multi-selection with Ctrl/Cmd and range selection with Shift.
- Box selection and viewport/hierarchy selection synchronization.
- Drag reorder and reparent with cycle prevention and insertion indicators.
- Duplicate complete subtrees with remapped child IDs.
- Delete with dependency-safe cleanup.
- Enable/disable, lock/unlock and isolate/unisolate.
- Rename inline without browser prompts.
- Copy, cut, paste and duplicate across projects where compatible.
- Context menus and keyboard navigation.
- Search by name, type, component/material and asset reference.

## Workstream C — viewport and transform tools

- Real 3D translate, rotate and scale gizmos positioned on the selected object.
- Local/world orientation, pivot/center mode and individual/group transforms.
- Axis, plane and free-move handles.
- Numeric snapping and temporary modifier snapping.
- Orthographic front/back/top/bottom/left/right cameras.
- Perspective editor camera bookmarks.
- Orbit, pan, dolly, frame selection and frame all.
- Grid, axes, bounds, light, camera, skeleton and collider helpers.
- Selection outline and hover highlight.
- Shaded, wireframe, normals, UV/material/debug views.
- Camera speed and input settings.
- Transform drag is one merged history operation and survives refresh.

## Workstream D — schema-driven inspector

Build an inspector registry instead of hard-coding every field in `main.ts`.

- Mixed-value multi-editing.
- Reset, copy, paste, keyframe and override indicators.
- Validation, min/max/step, units and tooltips.
- Typed asset/entity pickers and drag targets.
- Transform, node, mesh, material, animation, camera, light, environment and render inspectors.
- Complete Kyxos effect parameter inspectors generated from Viewer capabilities.
- Material slots per primitive and live material assignment.
- Texture color space, channel packing, UV set, tiling, offset and rotation.
- Material variants and imported/default override restoration.
- Collapsible section state persisted per user.

## Workstream E — animation

- Clip list, preview, seek, speed, loop and autoplay.
- Clip rename, trim, duplicate and delete metadata operations.
- Animation state graph equivalent to PlayCanvas `animstategraph`.
- States, transitions, parameters, conditions and blend trees.
- Graph editing through PCUI Graph.
- Skinned mesh and morph animation verification.
- Published runtime uses the exact authored graph and default state.

## Workstream F — project, scenes, settings and templates

- Project metadata, thumbnail, quality defaults and backend policy.
- Multiple scenes per project with create, duplicate, rename and delete.
- Scene revisions, checkpoints, compare, restore and merge conflict UI.
- Reusable templates/prefabs with instances, overrides and reset/apply operations.
- User editor preferences separated from project settings.
- Import/export Scene Contract JSON with validation and migration report.

## Workstream G — collaboration and version control

- Owner/editor/viewer roles enforced in both UI and RLS.
- Presence, active selection and user list.
- Realtime document operations with conflict-safe ordering.
- Comments/chat are optional for first production parity, but the extension point must exist.
- Checkpoints, branches, diff, merge and immutable published releases remain distinct concepts.
- Offline changes reconcile explicitly; no silent last-write-wins.

## Workstream H — code, console, plugins and API

- Monaco-based source editor only for Kyxos-supported script assets.
- Tabs, project search, diagnostics, formatting and merge view.
- Runtime/editor console with severity, source and clear/filter controls.
- Plugin registry with permissions and lifecycle disposal.
- Stable Studio API for projects, assets, documents, selection, commands and viewport.
- MCP server surface must call the same command API as the UI and respect permissions/history.

## Workstream I — launch, preview and publishing

- Preview mode must use the current unsaved in-memory SceneDocument.
- Public Viewer and Embed use immutable release snapshots.
- Fixed and current links remain distinct.
- Loading progress is asset-byte based.
- Mobile controls, fullscreen, animation and camera controls remain reachable.
- Published versions never reference local object URLs.
- Production Supabase deployment and anonymous resolver are mandatory for completion.

## Automated acceptance matrix

The following browser workflows are release blockers:

1. Empty project shows no procedural model.
2. Drop a real multi-node, multi-material, animated GLB.
3. Imported hierarchy matches the glTF node tree.
4. Select a mesh in viewport and hierarchy.
5. Translate, rotate and scale through real gizmos; undo and redo.
6. Edit every material slot and texture assignment.
7. Reparent, reorder, duplicate and delete a subtree.
8. Refresh and recover the exact draft.
9. Reimport while preserving selected overrides.
10. Create and switch scenes.
11. Create a template instance and override it.
12. Edit and execute an animation graph.
13. Publish v1, edit, publish v2 and prove v1 is unchanged.
14. Open current, fixed and Embed routes anonymously.
15. Verify RLS with two separate users.
16. Verify WebGPU and WebGL 2 editor operation.
17. Verify 1000 hierarchy nodes and 500 assets remain interactive.
18. Verify no hidden/collapsed panel intercepts input.
19. Verify all visible controls mutate canonical state or are explicitly disabled with a reason.
20. Verify all imported/runtime resources are disposed when switching projects.

## Current delivery state after the complete alignment pass

This pass adds the requested alignment modules as real stateful systems rather than static controls:

- Full hierarchy tree behavior, subtree-safe clipboard operations, ordered drop targets, inline rename, keyboard navigation and lock/hide/isolate state.
- Schema-generated multi-object Inspector with mixed/override state, typed pickers, validation, units, restore/reset, physical materials, texture sampling/UV controls, camera, light, render and effect capabilities.
- Asset folders, search/filtering, grid/list views, generated model thumbnails, dependency inspection, recoverable trash, reimport modes and a cancellable/retryable import queue.
- A shared glTF decode configuration for Draco, Meshopt and KTX2/Basis, external-resource GLB packing, skins/joints, morphs, cameras, punctual lights, physical extensions and material variants.
- Multiple scenes and templates/prefabs with instance override discovery, per-path apply/reset, apply-all/reset-all and unpack.
- A PCUI Graph animation state editor plus published Viewer runtime evaluation for parameters, triggers, conditions, transitions, 1D and 2D blend trees.
- Owner/Editor/Viewer roles, private Realtime Broadcast/Presence, checkpoints, branches, structural diff, three-way merge and explicit conflict resolution.
- Revisioned source files in Monaco, diagnostics console, permission-gated plugins, stable Studio API and role-aware MCP JSON-RPC tools.
- Separate Studio, Playground, Public Viewer and Embed entry graphs, enforced by boundary and production-bundle verification.

Intentional non-equivalences remain outside the Kyxos product model: PlayCanvas hosted accounts/billing/messenger services, PlayCanvas Engine entity/component runtime, branding, and service endpoints are not copied. The existing Kyxos viewport transform implementation also remains Kyxos-native rather than embedding PlayCanvas Engine gizmos.

The PR must remain draft until the browser matrix and the optional live two-user Supabase RLS suite have run in an environment with Chromium and configured production credentials.
