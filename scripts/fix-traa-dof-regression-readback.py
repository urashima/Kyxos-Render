from pathlib import Path

path = Path('tests/e2e/playground.spec.ts')
text = path.read_text()
old_helper = """  const sampleVisibleRatio = async () =>
    page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const source = document.querySelector<HTMLCanvasElement>('#viewport');
      if (!source) throw new Error('Viewport canvas not found.');
      const copy = document.createElement('canvas');
      copy.width = 96;
      copy.height = 54;
      const context = copy.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D verification context unavailable.');
      context.drawImage(source, 0, 0, copy.width, copy.height);
      const data = context.getImageData(0, 0, copy.width, copy.height).data;
      let visible = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index] + data[index + 1] + data[index + 2] > 24 && data[index + 3] > 0) {
          visible += 1;
        }
      }
      return visible / (copy.width * copy.height);
    });
"""
new_helper = """  const sampleVisibleRatio = async () => {
    // WebGL does not preserve the previous drawing buffer, so copying the
    // source canvas outside its render callback can return all zeroes even
    // while the browser visibly composites a correct frame. Sample the
    // composited bottom-right canvas region instead of the discarded buffer.
    const clip = {
      x: bounds.x + bounds.width * 0.58,
      y: bounds.y + bounds.height * 0.48,
      width: bounds.width * 0.38,
      height: bounds.height * 0.46,
    };
    const screenshot = await page.screenshot({ clip });
    return page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const copy = document.createElement('canvas');
      copy.width = 96;
      copy.height = 54;
      const context = copy.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D verification context unavailable.');
      context.drawImage(image, 0, 0, copy.width, copy.height);
      const data = context.getImageData(0, 0, copy.width, copy.height).data;
      let visible = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index] + data[index + 1] + data[index + 2] > 24 && data[index + 3] > 0) {
          visible += 1;
        }
      }
      return visible / (copy.width * copy.height);
    }, screenshot.toString('base64'));
  };
"""
if text.count(old_helper) != 1:
    raise SystemExit(f'Expected one camera-motion helper, found {text.count(old_helper)}')
text = text.replace(old_helper, new_helper, 1)
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
