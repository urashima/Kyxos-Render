from pathlib import Path

path = Path('tests/e2e/playground.spec.ts')
text = path.read_text()
needle = """    const pixels = await page.evaluate(() => {
      const source = document.querySelector<HTMLCanvasElement>('#viewport');
"""
replacement = """    const pixels = await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const source = document.querySelector<HTMLCanvasElement>('#viewport');
"""
if text.count(needle) != 1:
    raise SystemExit(f'Expected one debug readback block, found {text.count(needle)}')
path.write_text(text.replace(needle, replacement, 1))
