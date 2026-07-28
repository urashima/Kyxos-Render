from pathlib import Path

path = Path('tests/e2e/playground.spec.ts')
text = path.read_text()
test_start = text.index("test('TRAA and depth of field stay visible while the camera moves'")
goto_marker = "  await page.goto('/overview/');\n"
goto_index = text.index(goto_marker, test_start)
insertion = """  // The GitHub runner uses a CPU software renderer. Keep enough pixels to
  // detect a black frame while avoiding multi-minute 80-tap DoF frames.
  await page.setViewportSize({ width: 320, height: 180 });
"""
if insertion in text[test_start:goto_index]:
    raise SystemExit('Camera-motion viewport is already configured')
text = text[:goto_index] + insertion + text[goto_index:]
path.write_text(text)
