from pathlib import Path

path = Path('tests/e2e/webgpu.spec.ts')
text = path.read_text()
needle = "state.warnings.join('\n')"
replacement = "state.warnings.join('\\n')"
count = text.count(needle)
if count != 2:
    raise SystemExit(f'Expected two generated newline escapes, found {count}')
path.write_text(text.replace(needle, replacement))
