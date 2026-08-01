# Kyxos Studio Design System

Kyxos Studio uses one token-driven visual system for Studio, UI Lab and Public Viewer. Product code must consume `@kyxos/ui-theme` variables and `@kyxos/ui-components`; it must not introduce page-local colors, radii or shadows.

## Themes

- **Kyxos Moss** is the default immersive LookDev theme. It uses low-saturation grey-green canvas surfaces and a yellow-green accent.
- **Kyxos Graphite** is the traditional neutral dark editor theme.

The active theme is persisted in `localStorage` and applied through `data-kx-theme`. Theme switching does not recreate the Viewer or SceneDocument.

## Token groups

`packages/ui-theme/src/` owns color, spacing, radii, typography, shadows, blur and motion tokens. Controls use a 32 px minimum target; primary controls use 36 px where space permits. Numeric values use the system monospace stack.

## Visual hierarchy

The 3D viewport is the visual subject. Surfaces use low-contrast borders instead of heavy dividers. Accent color is reserved for primary actions, current selection, focus and live status. Errors, warnings and success states always include text or an icon.

## Motion

Allowed motion is limited to panels, popovers, toast feedback, selection and loading. Durations are 120/180/260 ms. `prefers-reduced-motion` collapses transitions and animations.
