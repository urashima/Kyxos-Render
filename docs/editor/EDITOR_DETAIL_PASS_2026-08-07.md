# Kyxos Studio editor detail pass — 2026-08-07

## Scope

This pass continues from `main` without replacing KyxosViewer, Scene Contract, CommandBus, autosave, collaboration transport or publishing. It closes the product-detail gap between already-present editor services and their desktop/mobile presentation.

## Delivered in this branch

### Window behavior

- Studio modal workspaces gain desktop drag, resize, maximize and restore behavior.
- Window geometry is remembered independently for Code, Animation Graph, Advanced Tools and release/management dialogs.
- Mobile layouts convert those windows to safe-area-aware full-screen workspaces.
- Existing dialog actions and canonical data paths are preserved.

### Editor preferences and settings

- A persistent Editor Preferences dialog is available from the top bar and `Ctrl/Cmd + ,`.
- Hierarchy width, Inspector width, Asset shelf height and thumbnail size update live.
- Comfortable/compact density, reduced motion, backdrop blur and coarse-pointer target size are supported.
- Preferences remain browser/user settings; render and project settings remain versioned in Scene Contract.

### Mobile reachability

- A bottom command dock keeps Hierarchy, transform tools, Assets, Inspector, Upload, Publish and Settings reachable above device safe areas.
- Coarse-pointer targets use a configurable 40–58 px minimum.
- The Asset shelf can expand into a mobile overlay without replacing editor state.
- Top-bar overflow no longer determines whether primary mobile commands can be reached.

### Thumbnails and secondary actions

- Project cards and Asset Workspace items receive deterministic canvas previews only when a real image, video or captured thumbnail is absent.
- Uploaded/captured thumbnails always take priority over generated fallbacks.
- Project rename, duplicate, archive and delete use an accessible popover rather than an action-name prompt.
- New source-file path entry uses an in-app dialog while preserving the existing revisioned source-file operation.

### Automated acceptance

`tests/e2e/studio-editor-detail-pass.spec.ts` verifies:

1. persistent layout preference updates;
2. project thumbnail fallback rendering;
3. mobile dock visibility and touch target size;
4. mobile Asset shelf access;
5. mobile settings access.

## Verified existing module surfaces on `main`

The repository already contains stateful implementations for Hierarchy, schema Inspector, Asset Workspace, glTF import/reimport, scenes/templates, animation state graph, collaboration/version control, Monaco, console, plugins, Studio API and MCP. This pass intentionally reuses those systems rather than duplicating them in the presentation layer.

## Remaining release gates

These items must not be marked complete merely because UI or service classes exist.

### Hierarchy

- Run the full browser matrix for subtree clipboard, ordered reparenting, range/multi-select, lock/hide/isolate and keyboard operation on imported scenes.
- Verify 1,000-node virtualization with mobile drawers and no hidden panel input interception.

### Schema Inspector

- Verify every visible material, texture, Camera, Light and render/effect field against real Viewer capabilities.
- Confirm mixed-value edits, reset/restore and typed pickers survive refresh and immutable publish.

### Asset Workspace

- Replace generated fallback previews with captured real thumbnails whenever model rendering is available.
- Verify folder move/trash/restore, dependency and reverse-reference changes, reimport modes and task cancellation against cloud persistence.

### glTF

- Run fixture acceptance for skins/joints, morph targets, Draco, Meshopt, KTX2/Basis, external resources, cameras, `KHR_lights_punctual`, material variants and override-preserving reimport on WebGPU and WebGL 2.

### Scenes / Templates

- Verify duplicate/rename/delete, template instances and apply/reset override behavior through save, refresh and publish.

### Animation State Graph

- Verify State, Transition, Parameter, Condition and 1D/2D Blend Tree authoring through the PCUI Graph surface and published runtime evaluation.

### Collaboration / version control

- Run live two-user Owner/Editor/Viewer RLS acceptance against Production Supabase.
- Verify Presence, Realtime operation ordering, checkpoints, branches, diff, merge and explicit conflict resolution under concurrent edits and offline recovery.

### Advanced systems

- Verify Monaco revision conflicts, Console filtering, plugin disposal, Studio API permissions and MCP history/role enforcement.
- Complete real texture/image inspection and conversion workflows; the current branch only improves preview fallbacks.

## Completion rule

A module is complete only after the operation mutates canonical state, participates in history/autosave, restores after refresh, reaches the real Viewer, freezes correctly in an immutable release and passes the relevant automated browser and production-security acceptance suites.
