from pathlib import Path

path = Path('playwright.config.ts')
text = path.read_text()
old = """          args: [
            '--enable-unsafe-webgpu',
            '--use-webgpu-adapter=swiftshader',
            '--enable-dawn-features=allow_unsafe_apis',
            '--disable-dawn-features=disallow_unsafe_apis',
            '--use-gpu-in-tests',
            '--enable-accelerated-2d-canvas',
            '--ignore-gpu-blocklist',
          ],
"""
new = """          args: [
            '--enable-unsafe-webgpu',
            '--enable-unsafe-swiftshader',
            '--use-vulkan=swiftshader',
            '--enable-features=Vulkan,UseSkiaRenderer',
            '--enable-dawn-features=allow_unsafe_apis',
            '--disable-dawn-features=disallow_unsafe_apis',
            '--use-gpu-in-tests',
            '--enable-accelerated-2d-canvas',
            '--ignore-gpu-blocklist',
          ],
"""
if text.count(old) != 1:
    raise SystemExit(f'Expected one WebGPU launch flag block, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
