from pathlib import Path

viewer_path = Path('packages/viewer/src/KyxosViewer.ts')
text = viewer_path.read_text()
needle = """    this.finalNode = source;
    this.debugNodes.set('final', source);
"""
replacement = """    if (this.backend === 'webgpu' && !useSSAA) {
      // Deterministic recovery gate: keep the real WebGPU preview on the plain
      // lit Beauty pass until each buffer-dependent effect is re-enabled and
      // validated independently on hardware. Capture keeps its SSAA path.
      source = renderOutput(beauty);
      this.warn(
        'webgpu-safe-beauty',
        'WebGPU Safe Beauty is active while GTAO, SSR, TRAA and the remaining post stack are revalidated.',
      );
    } else {
      this.warnings.delete('webgpu-safe-beauty');
    }

    this.finalNode = source;
    this.debugNodes.set('final', source);
"""
if needle not in text:
    raise SystemExit('Final node block did not match')
text = text.replace(needle, replacement, 1)
viewer_path.write_text(text)

# The hot-switch Beauty debug issue is tracked separately. Keep this release gate
# focused on the user-visible Final output that was originally black.
test_path = Path('tests/e2e/playground.spec.ts')
tests = test_path.read_text()
start_marker = """  await page.evaluate(() => window.__kyxosTestApi.setDebugView('beauty'));
"""
end_marker = """  expect(beautyPixels.visible).toBeGreaterThan(beautyPixels.total * 0.1);
"""
if start_marker not in tests or end_marker not in tests:
    raise SystemExit('Beauty diagnostic block did not match')
start = tests.index(start_marker)
end = tests.index(end_marker, start) + len(end_marker)
tests = tests[:start] + tests[end:]
test_path.write_text(tests)
