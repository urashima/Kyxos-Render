from pathlib import Path

viewer_path = Path('packages/viewer/src/KyxosViewer.ts')
text = viewer_path.read_text()
old = """  setDebugView(view: DebugView) {
    this.debugView = view;
    this.applyOutputSelection();
  }
"""
new = """  setDebugView(view: DebugView) {
    this.debugView = view;
    // Pass/RTT lifecycle dependencies are not reliably re-registered by a hot
    // outputNode swap in the pinned Three.js RenderPipeline. Rebuild the small
    // graph so Beauty and G-buffer debug passes are scheduled deterministically.
    this.queuePipelineRebuild(`debug-view:${view}`);
  }
"""
if old not in text:
    raise SystemExit('setDebugView block did not match')
text = text.replace(old, new, 1)
viewer_path.write_text(text)

test_path = Path('tests/e2e/playground.spec.ts')
tests = test_path.read_text()
if "  await page.waitForTimeout(250);\n" not in tests:
    raise SystemExit('Beauty wait did not match')
tests = tests.replace("  await page.waitForTimeout(250);\n", "  await page.waitForTimeout(1_000);\n", 1)
test_path.write_text(tests)
