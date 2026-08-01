# Accessibility

- All tool buttons use an accessible name and tooltip containing the shortcut where relevant.
- Focus rings are visible and tokenized.
- Editor shortcuts are ignored while an input, textarea, select or content-editable element has focus.
- Status is never communicated by color alone. Save, offline, conflict, fallback and error states remain readable in text.
- Minimum targets are 32 × 32 px; primary actions use 36 px where possible.
- Dialogs use native `dialog`, labelled controls and Escape handling.
- Reduced motion and reduced transparency media queries are supported.
- The responsive shell preserves access to Hierarchy and Inspector through labelled drawer buttons.

Visual checks must include long English and Chinese strings in UI Lab, 200% zoom, keyboard-only traversal and the Moss/Graphite themes.
