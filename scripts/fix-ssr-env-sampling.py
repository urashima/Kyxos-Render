from pathlib import Path

path = Path('packages/viewer/src/KyxosViewer.ts')
text = path.read_text()
needle = "            envImportanceSampling: true,\n"
replacement = "            // PMREM scene.environment is not an equirectangular SSR sampling source.\n            // Keep screen-space reflections enabled without compiling the null MIS path.\n            envImportanceSampling: false,\n"
if text.count(needle) != 1:
    raise SystemExit(f'Expected one SSR MIS setting, found {text.count(needle)}')
path.write_text(text.replace(needle, replacement, 1))
