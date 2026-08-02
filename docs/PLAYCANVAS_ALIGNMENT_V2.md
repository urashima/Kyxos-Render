# PlayCanvas Alignment V2

Base: `main`

This work intentionally does not use PR #20 as an implementation base.

## Product boundaries

The following applications remain independently buildable and may not import each other's private implementation:

- `apps/playground`: rendering demos only
- `apps/studio`: authoring application only
- `apps/public-viewer`: read-only published scene playback
- `apps/embed`: minimal embeddable playback surface

Shared behavior must move through explicit packages and protocols. Studio-specific UI, auth, collaboration, persistence and editor commands must never enter Viewer, Playground, Public Viewer or Embed bundles.

## Alignment workstreams

1. Hierarchy behavior: collapse, subtree clone, range and additive selection, reorder, drag feedback, context menu, rename, keyboard navigation, clipboard, creation commands, lock/hide/isolate.
2. Schema Inspector: schema-driven fields, mixed values, typed pickers, reset/override/restore, validation metadata, complete material/texture/camera/light/render controls.
3. Asset Workspace: folders, grid/list, thumbnails, search/filter, rename/move/delete/restore, dependency graph, reverse references, reimport and queued imports.
4. glTF: skin/joints, morph targets, Draco, Meshopt, KTX2/Basis, external resources, cameras, `KHR_lights_punctual`, variants and override-preserving reimport.
5. Scenes/Templates: multiple scenes, scene CRUD, templates/prefabs, instance overrides and apply/reset flows.
6. Animation State Graph: states, transitions, parameters, conditions, blend trees and PCUI Graph editing.
7. Collaboration/versioning: roles, presence, realtime edits, checkpoints, branches, diff, merge and conflict resolution.
8. Advanced systems: Monaco, console, plugin registry, Studio API, MCP, production Supabase and two-user RLS acceptance.

## Required acceptance gates

- Every feature has unit or contract coverage plus a Playwright user-flow test.
- Import jobs expose deterministic states: queued, reading, decoding, processing, committing, complete, failed and cancelled.
- Reimport is transactional and preserves authored overrides using stable source identities.
- Collaboration tests use two independent authenticated sessions and verify Owner/Editor/Viewer permissions at the database policy level.
- `pnpm verify`, E2E and production Pages builds must pass.
- `verify:boundaries` must reject cross-application private imports.

## Reference policy

PlayCanvas Editor is a behavioral and UX reference. Reused MIT code must be recorded in third-party provenance. PlayCanvas Engine services, hosted APIs, branding and private backend assumptions are not copied into Kyxos.
