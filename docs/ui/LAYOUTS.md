# Studio Layouts

## Authoring Mode

Authoring Mode keeps Hierarchy, Viewport, Inspector and the bottom asset shelf visible. At 1920 px the center column retains more than 70% of the editor width. PCUI panel collapse behavior remains available.

## Focus Mode

Focus Mode keeps the same canvas, SceneDocument, selection, CommandBus and history instances. It changes only shell CSS and layout state: Hierarchy is hidden, Inspector becomes a floating surface and the asset area becomes a horizontal filmstrip. No scene reload occurs.

## Responsive behavior

Below 1100 px, Hierarchy and Inspector become drawers and Focus Mode is the initial layout. The asset shelf can still be scrolled horizontally. On phone widths Studio is a review surface: viewport, animation/resource shelf, project state and preview remain available; full authoring is intentionally signposted as a desktop experience.

Layout and theme preferences are stored under `kyxos-studio-layout-v2`. “Restore default layout” clears transient drawer state without touching project data.
