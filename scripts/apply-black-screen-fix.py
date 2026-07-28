from pathlib import Path

viewer_path = Path('packages/viewer/src/KyxosViewer.ts')
text = viewer_path.read_text()

start = text.index('    scenePass.setMRT(\n')
end = text.index('    this.nodes.push(scenePass);', start)
new_mrt = """    const hasEmissiveAttachment = this.backend === 'webgpu';
    const mrtOutputs: Record<string, any> = {
      output,
      normal: vec4(packNormalToRGB(normalView).rgb, materialRoughness),
      diffuseColor: vec4(diffuseColor.rgb, materialMetalness),
      velocity,
    };
    if (hasEmissiveAttachment) {
      mrtOutputs.emissive = vec4(emissive.rgb, 1);
      this.warnings.delete('webgl2-mrt');
    } else {
      this.warn(
        'webgl2-mrt',
        'WebGL 2 uses a four-attachment Scene MRT for guaranteed compatibility; emissive debug output is unavailable.',
      );
    }
    scenePass.setMRT(mrt(mrtOutputs));
"""
text = text[:start] + new_mrt + text[end:]

replacements = [
    (
        "    const emissiveNode = scenePass.getTextureNode('emissive');\n",
        "    const emissiveNode = hasEmissiveAttachment ? scenePass.getTextureNode('emissive') : null;\n",
    ),
    (
        "    const emissiveTexture = scenePass.getTexture('emissive');\n    emissiveTexture.type = THREE.UnsignedByteType;\n",
        "    if (hasEmissiveAttachment) {\n      const emissiveTexture = scenePass.getTexture('emissive');\n      emissiveTexture.type = THREE.UnsignedByteType;\n    }\n",
    ),
    (
        "    this.debugNodes.set('emissive', vec4(emissiveNode.rgb, 1));\n",
        "    this.debugNodes.set(\n      'emissive',\n      hasEmissiveAttachment ? vec4(emissiveNode.rgb, 1) : vec4(0, 0, 0, 1),\n    );\n",
    ),
    (
        "          const ssrNode = ssr(source, depth, sceneNormal, {\n",
        "          // SSR internally samples its color input, so keep the original Scene Pass texture here.\n          const ssrNode = ssr(beauty, depth, sceneNormal, {\n",
    ),
]
for old, new in replacements:
    if old not in text:
        raise SystemExit(f'Replacement did not match: {old!r}')
    text = text.replace(old, new, 1)

viewer_path.write_text(text)

test_path = Path('tests/e2e/playground.spec.ts')
tests = test_path.read_text()
marker = "test('buffer views, AA exclusivity and lifecycle hooks remain callable', async ({ page }) => {\n"
visual_test = """test('WebGL 2 medium mode renders visible final pixels', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
  });
  await page.goto('/overview/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 90_000 });
  const backend = await page.evaluate(() => window.__kyxosTestApi.getMetrics()?.backend);
  expect(backend).toBe('webgl2');
  await page.waitForTimeout(750);

  const pixels = await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const source = document.querySelector<HTMLCanvasElement>('#viewport');
    if (!source) throw new Error('Viewport canvas not found.');
    const copy = document.createElement('canvas');
    copy.width = 96;
    copy.height = 64;
    const context = copy.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D verification context unavailable.');
    context.drawImage(source, 0, 0, copy.width, copy.height);
    const data = context.getImageData(0, 0, copy.width, copy.height).data;
    let visible = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] + data[index + 1] + data[index + 2] > 24 && data[index + 3] > 0) visible += 1;
    }
    return { visible, total: copy.width * copy.height };
  });

  expect(pixels.visible).toBeGreaterThan(pixels.total * 0.1);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => message.includes('colorNode.sample'))).toEqual([]);
});

"""
if marker not in tests:
    raise SystemExit('E2E insertion marker did not match')
tests = tests.replace(marker, visual_test + marker, 1)
test_path.write_text(tests)
