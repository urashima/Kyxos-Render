from pathlib import Path

path = Path('packages/viewer/src/KyxosViewer.ts')
text = path.read_text()
needle = "            stochastic: true,\n"
replacement = "            // Stochastic SSR requires an original equirectangular HDR texture for misses.\n            // The active studio environment is PMREM, so use the official mirror/blur path.\n            stochastic: false,\n"
if text.count(needle) != 1:
    raise SystemExit(f'Expected one stochastic SSR setting, found {text.count(needle)}')
path.write_text(text.replace(needle, replacement, 1))
