from pathlib import Path

path = Path('tests/unit/presets.test.ts')
text = path.read_text()
needle = """    expect(preset.fxaa.enabled || preset.smaa.enabled).toBe(true);
    expect(preset.gtao.enabled).toBe(true);
    expect(preset.gtao.resolutionScale).toBe(0.5);
"""
replacement = """    expect(preset.fxaa.enabled).toBe(false);
    expect(preset.smaa.enabled).toBe(false);
    expect(preset.traa.enabled).toBe(false);
    expect(preset.gtao.enabled).toBe(false);
"""
if text.count(needle) != 1:
    raise SystemExit(f'Expected one Low preset test block, found {text.count(needle)}')
path.write_text(text.replace(needle, replacement, 1))
