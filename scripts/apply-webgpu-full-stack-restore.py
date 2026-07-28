from pathlib import Path

viewer_path = Path('packages/viewer/src/KyxosViewer.ts')
text = viewer_path.read_text()

# Add official texture/AO bridges and a separate emissive debug pass.
import_marker = """import {
  diffuseColor,
  metalness,
"""
import_replacement = """import {
  builtinAOContext,
  convertToTexture,
  diffuseColor,
  emissive,
  metalness,
"""
if import_marker not in text:
    raise SystemExit('TSL import marker did not match')
text = text.replace(import_marker, import_replacement, 1)

pass_marker = """    const sceneNormal = sample((uv: any) => unpackRGBToNormal(normalPacked.sample(uv).rgb));
    const metalRoughness = sample((uv: any) => metalRough.sample(uv).rg);

    const scenePass = pass(this.scene, this.camera);
    scenePass.name = 'Kyxos.Beauty';
    scenePass.options.samples = 0;
    this.nodes.push(scenePass);

    const beauty = scenePass.getTextureNode('output');
    const viewZ = scenePass.getViewZNode();

    this.debugNodes.set('beauty', scenePass);
"""
pass_replacement = """    const sceneNormal = sample((uv: any) => unpackRGBToNormal(normalPacked.sample(uv).rgb));
    const metalRoughness = sample((uv: any) => metalRough.sample(uv).rg);
    const useSSAA = this.effects.ssaa.enabled;

    // Feed AO into the Beauty pass through Three.js' official lighting context.
    // Keeping Beauty as a real pass texture means SSR, TRAA and the remaining
    // texture-based effects can sample it without turning the visible graph black.
    let ambientOcclusionNode: any = null;

    if (!useSSAA && this.effects.gtao.enabled) {
      try {
        const settings = this.effects.gtao;
        const gtao = ao(depth, sceneNormal, this.camera);
        gtao.samples.value = Number(settings.samples ?? 16);
        gtao.radius.value = Number(settings.radius ?? 0.5);
        gtao.scale.value = Number(settings.intensity ?? 1.2);
        gtao.thickness.value = Number(settings.thickness ?? 1);
        gtao.resolutionScale = Number(settings.resolutionScale ?? 0.5);
        gtao.useTemporalFiltering = this.effects.traa.enabled;
        ambientOcclusionNode = gtao.getTextureNode().sample(screenUV).r;
        this.nodes.push(gtao);
      } catch (error) {
        this.effectFailure('gtao', error);
      }
    }

    if (!useSSAA && this.effects.ssao.enabled) {
      try {
        const settings = this.effects.ssao;
        const ssaoNode = ssao(depth, sceneNormal, this.camera);
        ssaoNode.samples.value = Number(settings.samples ?? 16);
        ssaoNode.radius.value = Number(settings.radius ?? 0.5);
        ssaoNode.intensity.value = Number(settings.intensity ?? 1.5);
        ssaoNode.resolutionScale = Number(settings.resolutionScale ?? 0.5);
        const ssaoSample = ssaoNode.getTextureNode().sample(screenUV).r;
        ambientOcclusionNode = ambientOcclusionNode
          ? ambientOcclusionNode.mul(ssaoSample)
          : ssaoSample;
        this.nodes.push(ssaoNode);
      } catch (error) {
        this.effectFailure('ssao', error);
      }
    }

    const scenePass = pass(this.scene, this.camera);
    scenePass.name = 'Kyxos.Beauty';
    scenePass.options.samples = 0;
    if (ambientOcclusionNode) scenePass.contextNode = builtinAOContext(ambientOcclusionNode);
    this.nodes.push(scenePass);

    const beauty = scenePass.getTextureNode('output');
    const viewZ = scenePass.getViewZNode();

    // Emissive remains outside the four-attachment material pre-pass so WebGL2
    // compatibility is preserved while the debug channel is fully restored.
    const emissivePass = pass(this.scene, this.camera);
    emissivePass.name = 'Kyxos.Emissive';
    emissivePass.options.samples = 0;
    emissivePass.setMRT(mrt({ output: vec4(emissive.rgb, 1) }));
    this.nodes.push(emissivePass);
    const emissiveNode = emissivePass.getTextureNode('output');

    this.debugNodes.set('beauty', scenePass);
"""
if pass_marker not in text:
    raise SystemExit('Beauty pass marker did not match')
text = text.replace(pass_marker, pass_replacement, 1)

warning_marker = """    this.debugNodes.set('emissive', vec4(0, 0, 0, 1));
    this.warn(
      'emissive-prepass',
      'Emissive debug output is isolated from the core pre-pass while the visible pipeline is stabilized.',
    );

    let source: any = beauty;
    const useSSAA = this.effects.ssaa.enabled;
"""
warning_replacement = """    this.debugNodes.set('emissive', renderOutput(emissiveNode));
    this.warnings.delete('emissive-prepass');

    let source: any = beauty;
"""
if warning_marker not in text:
    raise SystemExit('Emissive warning marker did not match')
text = text.replace(warning_marker, warning_replacement, 1)

# AO is now injected into the Beauty lighting context, so remove the old
# post-multiply blocks that converted source into a fragile generic expression.
else_marker = """    } else {
      this.warnings.delete('capture-ssaa');
"""
else_index = text.index(else_marker)
ao_start = text.index("      if (this.effects.gtao.enabled) {", else_index)
ssgi_start = text.index("      if (this.effects.ssgi.enabled) {", ao_start)
text = text[:ao_start] + text[ssgi_start:]

# SSR intensity is already applied inside SSRNode; do not multiply it twice.
double_intensity = """          source = vec4(source.rgb.add(reflection.rgb.mul(Number(settings.intensity ?? 1))), 1);
"""
if double_intensity not in text:
    raise SystemExit('SSR intensity composition marker did not match')
text = text.replace(double_intensity, "          source = vec4(source.rgb.add(reflection.rgb), 1);\n", 1)

# The pinned official MotionBlur implementation calls inputNode.sample() directly.
# Explicitly convert arbitrary composite/TRAA nodes into a texture first.
motion_marker = """          const amount = uniform(Number(this.effects.motionBlur.amount ?? 1));
          source = motionBlur(source, velocityNode.mul(amount));
"""
motion_replacement = """          const amount = uniform(Number(this.effects.motionBlur.amount ?? 1));
          const motionInput = convertToTexture(source);
          if (motionInput !== source) this.nodes.push(motionInput);
          source = motionBlur(motionInput, velocityNode.mul(amount));
"""
if motion_marker not in text:
    raise SystemExit('Motion blur marker did not match')
text = text.replace(motion_marker, motion_replacement, 1)

# Remove the temporary WebGPU final override now that every stage has a valid
# texture boundary and the actual WebGPU matrix is tested in CI.
safe_start_marker = """    if (this.backend === 'webgpu' && !useSSAA) {
"""
safe_start = text.index(safe_start_marker)
safe_end = text.index("    this.finalNode = source;\n", safe_start)
text = text[:safe_start] + "    this.warnings.delete('webgpu-safe-beauty');\n\n" + text[safe_end:]

viewer_path.write_text(text)

# Add a real WebGPU project instead of validating only the WebGL fallback.
Path('playwright.config.ts').write_text("""import { defineConfig, devices } from '@playwright/test';

const commonUse = {
  baseURL: 'http://127.0.0.1:4173',
  trace: 'retain-on-failure' as const,
  screenshot: 'only-on-failure' as const,
  video: 'retain-on-failure' as const,
};

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/webgpu.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        ...commonUse,
        launchOptions: {
          args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
        },
      },
    },
    {
      name: 'chromium-webgpu',
      testMatch: '**/webgpu.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        ...commonUse,
        viewport: { width: 640, height: 360 },
        launchOptions: {
          args: [
            '--enable-unsafe-webgpu',
            '--use-webgpu-adapter=swiftshader',
            '--enable-dawn-features=allow_unsafe_apis',
            '--disable-dawn-features=disallow_unsafe_apis',
            '--use-gpu-in-tests',
            '--enable-accelerated-2d-canvas',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'pnpm --filter @kyxos/playground exec vite --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
""")

Path('tests/e2e/webgpu.spec.ts').write_text("""import { expect, test, type Page } from '@playwright/test';

const allEffects = [
  'traa',
  'fxaa',
  'smaa',
  'ssaa',
  'gtao',
  'ssao',
  'ssr',
  'ssgi',
  'temporalReprojection',
  'poissonDenoise',
  'temporalDenoise',
  'motionBlur',
  'bloom',
  'dof',
  'lut',
  'lensDistortion',
  'sharpness',
  'sparkle',
] as const;

async function sampleVisiblePixels(page: Page) {
  return page.evaluate(async () => {
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
    let luminance = 0;
    for (let index = 0; index < data.length; index += 4) {
      const sum = data[index] + data[index + 1] + data[index + 2];
      if (sum > 24 && data[index + 3] > 0) visible += 1;
      luminance += sum;
    }
    return { visible, total: copy.width * copy.height, luminance };
  });
}

test('restored WebGPU effect matrix remains visible', async ({ page }) => {
  test.setTimeout(10 * 60_000);

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/overview/');
  await page.waitForFunction(() => window.__kyxosTestApi?.ready(), null, { timeout: 120_000 });
  const backend = await page.evaluate(() => window.__kyxosTestApi.getMetrics()?.backend);
  expect(backend).toBe('webgpu');

  const stages: Array<{
    name: string;
    quality?: 'low' | 'medium' | 'high' | 'cinematic';
    effects?: Array<[string, Record<string, unknown>]>;
    settle?: number;
  }> = [
    { name: 'FXAA', effects: [['fxaa', { enabled: true }]] },
    { name: 'SMAA', effects: [['smaa', { enabled: true }]] },
    { name: 'GTAO', effects: [['gtao', { enabled: true }]] },
    { name: 'SSAO', effects: [['ssao', { enabled: true }]] },
    { name: 'SSR', effects: [['ssr', { enabled: true }]], settle: 2500 },
    { name: 'SSGI + TRAA', effects: [['ssgi', { enabled: true }]], settle: 3000 },
    { name: 'TRAA', effects: [['traa', { enabled: true }]], settle: 2500 },
    { name: 'Poisson denoise', effects: [['poissonDenoise', { enabled: true }]] },
    {
      name: 'SSR temporal denoise',
      effects: [
        ['ssr', { enabled: true }],
        ['temporalReprojection', { enabled: true }],
        ['temporalDenoise', { enabled: true }],
      ],
      settle: 3500,
    },
    { name: 'Motion blur', effects: [['motionBlur', { enabled: true }]], settle: 2500 },
    { name: 'Bloom', effects: [['bloom', { enabled: true }]] },
    { name: 'Depth of field', effects: [['dof', { enabled: true }]], settle: 2500 },
    { name: 'LUT', effects: [['lut', { enabled: true }]] },
    { name: 'Lens distortion', effects: [['lensDistortion', { enabled: true }]] },
    { name: 'Sharpness', effects: [['sharpness', { enabled: true }]] },
    { name: 'Sparkle', effects: [['sparkle', { enabled: true }]] },
    { name: 'Cinematic full stack', quality: 'cinematic', settle: 5000 },
  ];

  for (const stage of stages) {
    pageErrors.length = 0;
    consoleErrors.length = 0;

    await page.evaluate(
      ({ effects, quality, all }) => {
        window.__kyxosTestApi.setQuality(quality ?? 'low');
        if (!quality) {
          for (const effect of all) window.__kyxosTestApi.setEffect(effect as never, { enabled: false });
          for (const [effect, settings] of effects ?? []) {
            window.__kyxosTestApi.setEffect(effect as never, settings as never);
          }
        }
      },
      { effects: stage.effects, quality: stage.quality, all: allEffects },
    );

    await page.waitForTimeout(stage.settle ?? 1800);
    const pixels = await sampleVisiblePixels(page);
    const state = await page.evaluate(() => ({
      error: window.__kyxosTestApi.getLastError(),
      warnings: window.__kyxosTestApi.getWarnings(),
    }));

    expect(pixels.visible, `${stage.name} visible pixels`).toBeGreaterThan(pixels.total * 0.05);
    expect(pixels.luminance, `${stage.name} luminance`).toBeGreaterThan(pixels.total * 24);
    expect(state.error, `${stage.name} runtime error`).toBeNull();
    expect(state.warnings.join('\n'), `${stage.name} Safe Beauty warning`).not.toContain('Safe Beauty');
    expect(state.warnings.join('\n'), `${stage.name} isolated effect`).not.toContain('was isolated and disabled');
    expect(pageErrors, `${stage.name} page errors`).toEqual([]);
    expect(
      consoleErrors.filter((message) =>
        /sample is not a function|render pipeline error|gpuvalidationerror|validation error/i.test(message),
      ),
      `${stage.name} console errors`,
    ).toEqual([]);
  }
});
""")
