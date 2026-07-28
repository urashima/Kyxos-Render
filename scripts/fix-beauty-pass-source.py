from pathlib import Path

path = Path('packages/viewer/src/KyxosViewer.ts')
text = path.read_text()
replacements = [
    ("    let source: any = beauty;\n", "    // Preserve the actual Beauty PassNode through the display chain. Official\n    // FXAA and RenderPipeline examples use renderOutput(scenePass), while\n    // texture-sampling effects continue to consume the Beauty TextureNode.\n    let source: any = scenePass;\n"),
    ("    this.beforeNode = renderOutput(beauty);\n", "    this.beforeNode = renderOutput(scenePass);\n"),
]
for needle, replacement in replacements:
    if text.count(needle) != 1:
        raise SystemExit(f'Expected one Beauty pass source marker, found {text.count(needle)}: {needle!r}')
    text = text.replace(needle, replacement, 1)
path.write_text(text)
