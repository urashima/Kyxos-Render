from pathlib import Path

path = Path('packages/viewer/src/presets.ts')
text = path.read_text()
needle = """  if (name === 'low') {
    state.fxaa.enabled = true;
    state.gtao.enabled = true;
    state.gtao.resolutionScale = 0.5;
    return state;
  }
"""
replacement = """  if (name === 'low') {
    // Low is the deterministic plain Beauty baseline. Every post effect is
    // validated independently before being assigned to a shipping preset.
    return state;
  }
"""
if text.count(needle) != 1:
    raise SystemExit(f'Expected one Low preset block, found {text.count(needle)}')
path.write_text(text.replace(needle, replacement, 1))
