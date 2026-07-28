from pathlib import Path

path = Path('tests/e2e/playground.spec.ts')
text = path.read_text()
needle = """  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/overview/');
"""
replacement = """  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  // The GitHub runner uses a CPU software renderer. Keep enough pixels to
  // detect a black frame while avoiding multi-minute 80-tap DoF frames.
  await page.setViewportSize({ width: 320, height: 180 });
  await page.goto('/overview/');
"""
if text.count(needle) != 1:
    raise SystemExit(f'Expected one camera-motion viewport anchor, found {text.count(needle)}')
path.write_text(text.replace(needle, replacement, 1))
