from pathlib import Path

path = Path('scripts/finalize-hardware-restoration.py')
text = path.read_text()
old = """append_marker = \"\"\"test('capture mode returns a PNG blob', async ({ page }) => {\n\"\"\"
"""
new = """append_marker = \"\"\"test.describe('full lifecycle acceptance', () => {\n\"\"\"
"""
if text.count(old) != 1:
    raise SystemExit(f'Expected one finalizer test anchor, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
