# Sparkle visibility fix

The previous Sparkle implementation was effectively invisible because it applied the user threshold to `noise * luminance^5`, requiring an almost-white pixel and an almost-one random value simultaneously. Its 920 x 520 procedural grid also produced sub-pixel flare lines on normal playground viewports, and used reversed `smoothstep` edges whose result is undefined in GLSL.

The repaired node:

- applies `threshold` directly to highlight luminance;
- uses a sparse 96 x 54 grid with visible cell-local cross flares;
- separates random candidate selection from highlight qualification;
- animates candidate brightness with a stable per-cell phase;
- avoids reversed `smoothstep` edges;
- uses visible defaults (`intensity: 0.8`, `threshold: 0.78`).

Regression coverage includes preset assertions and a browser-level canvas comparison on the polished Chrome procedural model.
