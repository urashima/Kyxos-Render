# Kyxos Studio viewport and panel parity — 2026-08-07

This document records the acceptance surface added in PR #40. It deliberately separates editor UI behavior from Viewer runtime behavior so Studio, Viewer, Public Viewer, Playground, and Embed remain independently deployable.

## Module boundaries

| Module | Responsibility | Forbidden coupling |
| --- | --- | --- |
| `panel-workspace-parity.ts` | Dock, float, collapse, pin, drag, resize, maximize, geometry persistence | Scene mutation, Viewer internals |
| `viewport-entity-tools.ts` | Scene object discovery and Camera/Light authoring through `kyxosStudio.api` | Direct Three.js access, private adapter state |
| `viewport-entity-tools-polish.ts` | Multi-selection and accessibility state | Scene ownership |
| `playcanvas-interaction-parity.ts` | Mouse/keyboard viewport navigation using public camera bookmark commands | Direct renderer/camera ownership |
| `editor-detail-pass.ts` | Preferences, mobile dock, dialog geometry, project/file interaction details | Viewer implementation |
| `viewer-adapter` | Stable viewport command bridge | Studio DOM/UI |
| `scene-contract` | Canonical immutable scene data and patches | Product shell behavior |

## Panel workspace acceptance

- Hierarchy, Inspector, and Assets independently support docked and floating modes.
- Both docked and floating panels support collapse and restore.
- Floating panel geometry, pinning, and mode survive reload through local editor preferences.
- Floating windows support drag, resize, focus/z-order, double-click maximize, and reset layout.
- Unpinned floating windows minimize after focus leaves.
- The floating Assets shelf uses a transparent outer gutter; only the shelf surface receives glass blur.
- Mobile and coarse-pointer layouts use safe-area insets and minimum touch targets.
- `Ctrl/Cmd + Shift + F` toggles docked/floating layout.
- `Ctrl/Cmd + Shift + 0` restores the default layout.
- `Space` temporarily hides all authoring panels for an unobstructed viewport.

## Viewport interaction acceptance

PlayCanvas-compatible inputs:

| Input | Behavior |
| --- | --- |
| Left mouse | Existing orbit/select path |
| Middle mouse / Shift + left mouse | Pan |
| Right mouse | Look around |
| Wheel | Existing dolly path |
| W/A/S/D | Fly camera while the viewport is engaged |
| Shift + W/A/S/D | Faster fly movement |
| 1 / 2 / 3 | Translate / rotate / scale |
| F or double click | Frame selection |
| L | Local/world coordinate space |
| Shift while transforming | Temporary snapping through the existing snap setting |
| Space | Hide/show editor panels |
| Ctrl/Cmd + E | Add empty entity |
| Ctrl/Cmd + D | Duplicate selection |
| Ctrl/Cmd + Enter | Preview |
| Shift + Z | Restore previous selection |
| I | Editable editor-camera position/target overlay |
| Shift + C / Shift + L | Open the scene palette filtered to cameras/lights |
| [ / ] | Cycle filtered scene objects |

The interaction layer only exchanges `capture-bookmark` and `restore-bookmark` commands with the Viewer adapter. It does not import renderer implementation or mutate the runtime camera directly.

## Camera authoring acceptance

- Search, filter, select, Ctrl/Cmd multi-select, frame, helper visibility.
- Rename, visible, locked, and transform editing.
- Perspective/orthographic projection.
- Field of view, near/far clipping, orthographic size, target, and auto-rotate.
- Set active camera.
- Look through a scene camera without changing canonical scene data.
- Match a scene camera to the current editor view through a history-backed Scene Patch.
- Editable editor camera position/target overlay.

## Light authoring acceptance

- Search, filter, select, Ctrl/Cmd multi-select, frame, isolate, helper visibility.
- Directional, point, spot, and ambient type selection.
- Color, intensity, range, decay, and cast-shadow editing.
- Spot inner/outer cone editing.
- Shadow map size, bias, normal bias, and radius editing.
- Transform edits keep the linked node and Scene Light transform synchronized.

## History and persistence

All canonical Camera/Light/Entity edits call `kyxosStudio.api.applyPatch(label, patch)`. This preserves the existing command/history/autosave/collaboration path instead of introducing a second source of truth. Window geometry and personal UI preferences remain local and are intentionally excluded from shared scene revisions.

## Automated acceptance

`tests/e2e/studio-panel-viewport-parity.spec.ts` covers:

1. Floating all three main panels.
2. Transparent floating Assets shelf background.
3. Floating panel collapse/restore and return to docked mode.
4. Camera and Point Light creation through the existing Hierarchy menu.
5. Camera FOV patch and active-camera selection through the public Studio API.
6. Light intensity patch through the public Studio API.
7. Scene palette collapse/restore.

## Remaining release gates

These items are not claimed complete until CI and public-preview acceptance are green:

- Build/typecheck/lint of the new independent modules.
- Desktop Chromium E2E for panel and Camera/Light editing.
- Mobile/touch visual acceptance for overlapping floating surfaces.
- Real WebGPU and WebGL2 manual checks for helpers, transform controls, and look-through camera behavior.
- Regression checks for GLB import, publish, Public Viewer, realtime, and production RLS.
- Public Pages preview at `/preview/pr-40/studio/`.

## Completion language

“PlayCanvas interaction parity” in this pass refers to the viewport, panel workspace, selection, Camera, and Light authoring surface listed above. It does not falsely imply that every unrelated PlayCanvas service, engine component, physics system, script runtime, or cloud workflow has already passed Kyxos production acceptance.
