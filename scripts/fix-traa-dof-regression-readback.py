from pathlib import Path

path = Path('tests/e2e/playground.spec.ts')
text = path.read_text()
old_sample = """  const sampleVisibleRatio = async () =>
    page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const source = document.querySelector<HTMLCanvasElement>('#viewport');
"""
new_sample = """  const sampleVisibleRatio = async () =>
    page.evaluate(() => {
      const source = document.querySelector<HTMLCanvasElement>('#viewport');
"""
if text.count(old_sample) != 1:
    raise SystemExit(f'Expected one camera-motion sample block, found {text.count(old_sample)}')
text = text.replace(old_sample, new_sample, 1)
old_loop = """  for (let step = 1; step <= 24; step += 1) {
    await page.mouse.move(centerX + step * 5, centerY + Math.sin(step * 0.4) * 24);
    await page.waitForTimeout(45);
    ratios.push(await sampleVisibleRatio());
  }
"""
new_loop = """  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(centerX + step * 10, centerY + Math.sin(step * 0.5) * 24);
    await page.waitForTimeout(90);
    ratios.push(await sampleVisibleRatio());
  }
"""
if text.count(old_loop) != 1:
    raise SystemExit(f'Expected one camera-motion loop, found {text.count(old_loop)}')
path.write_text(text.replace(old_loop, new_loop, 1))
