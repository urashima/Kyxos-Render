# Visual Acceptance

## Stable evidence

Playwright captures Login, Project List, Studio, Public Viewer and UI Lab. UI Lab is captured in Moss and Graphite at 1920×1080, 1440×900, 1366×768, 1024×768 and 390×844. Product visual tests use fixed local data and a deterministic scene.

## Acceptance checklist

1. Viewport renders and remains the visual subject.
2. Authoring/Focus switching preserves the exact canvas element and editor state.
3. Main pages use token colors and shared controls.
4. Inspector sections are readable with long labels and do not overlap controls.
5. Save, upload, parse, offline, conflict, publish and compatibility states include text.
6. 1366×768 exposes all primary actions.
7. 390×844 Public Viewer controls remain reachable and safe-area aware.
8. Hidden panels do not receive pointer events or run expensive observers.
9. 1000 hierarchy rows and 500 asset records remain scrollable through virtualization/lazy loading boundaries.
10. Screenshot diffs are reviewed together with functional regression results; a visually correct but disconnected control is a failure.

PR descriptions must include before/after evidence, tested resolutions, preview URLs, known limitations and any deliberate fallbacks.
