# Third-Party Notices

Kyxos Studio uses selected open-source editor libraries and interaction patterns from the PlayCanvas ecosystem under the MIT License.

## PlayCanvas Editor

- Repository: https://github.com/playcanvas/editor
- Upstream commit: `3446b0a1b7ac95912771f1431a10f804f62e814f`
- Version at pin: `2.29.2`
- License: MIT
- Copyright: Copyright (c) 2011-2026 PlayCanvas Ltd.
- Usage: layout and interaction reference; selected PCUI/Observer integration patterns only. The PlayCanvas runtime, scene model, realtime service, project service, login service, launch page, trademarks, logos, and service endpoints are not included.

## @playcanvas/pcui

- License: MIT
- Usage: editor UI components.

## @playcanvas/observer

- License: MIT
- Usage: observable UI binding support. Kyxos scene state remains owned by `@kyxos/editor-core`.

## @playcanvas/pcui-graph

- License: MIT
- Usage: animation state-graph canvas, node/edge interaction, selection, pan, zoom and context-menu events. Kyxos owns the graph contract, validation and runtime evaluator.

Full license text is preserved in `licenses/playcanvas-editor-MIT.txt`. Source provenance is recorded in `third-party/playcanvas-editor-source.json`.
