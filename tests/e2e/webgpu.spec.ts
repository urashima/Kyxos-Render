import { expect, test, type Page } from '@playwright/test';

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

interface PixelSample {
  visible: number;
  total: number;
  luminance: number;
}

async function sampleVisiblePixels(page: Page): Promise<PixelSample> {
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

async function waitForVisiblePixels(page: Page, timeout = 12_000): Promise<PixelSample> {
  const started = Date.now();
  let sample = await sampleVisiblePixels(page);
  while (
    Date.now() - started < timeout &&
    (sample.visible <= sample.total * 0.05 || sample.luminance <= sample.total * 24)
  ) {
    await page.waitForTimeout(250);
    sample = await sampleVisiblePixels(page);
  }
  return sample;
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
          for (const effect of all) {
            window.__kyxosTestApi.setEffect(effect as never, { enabled: false });
          }
          for (const [effect, settings] of effects ?? []) {
            window.__kyxosTestApi.setEffect(effect as never, settings as never);
          }
        }
      },
      { effects: stage.effects, quality: stage.quality, all: allEffects },
    );

    await page.waitForTimeout(stage.settle ?? 1800);
    const pixels = await waitForVisiblePixels(page);
    const state = await page.evaluate(() => ({
      error: window.__kyxosTestApi.getLastError(),
      warnings: window.__kyxosTestApi.getWarnings(),
    }));
    const warnings = state.warnings.join('\n');

    expect(pixels.visible, `${stage.name} visible pixels`).toBeGreaterThan(
      pixels.total * 0.05,
    );
    expect(pixels.luminance, `${stage.name} luminance`).toBeGreaterThan(
      pixels.total * 24,
    );
    expect(state.error, `${stage.name} runtime error`).toBeNull();
    expect(warnings, `${stage.name} Safe Beauty warning`).not.toContain('Safe Beauty');
    expect(warnings, `${stage.name} automatic Beauty recovery`).not.toContain(
      'recovered to the lit Beauty pass',
    );
    expect(warnings, `${stage.name} isolated effect`).not.toContain(
      'was isolated and disabled',
    );
    expect(pageErrors, `${stage.name} page errors`).toEqual([]);
    expect(
      consoleErrors.filter((message) =>
        /sample is not a function|render pipeline error|gpuvalidationerror|validation error/i.test(
          message,
        ),
      ),
      `${stage.name} console errors`,
    ).toEqual([]);
  }
});
