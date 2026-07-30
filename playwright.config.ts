import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (!process.env.CI) {
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';
}

const localChromiumExecutable = resolve(
  process.cwd(),
  'node_modules/.pnpm/playwright-core@1.62.0/node_modules/playwright-core/.local-browsers/chromium-1234/chrome-win64/chrome.exe',
);
const executablePath =
  process.platform === 'win32' && existsSync(localChromiumExecutable) ? localChromiumExecutable : undefined;
const chromiumLaunchOptions = (args: string[]) => ({
  ...(executablePath ? { executablePath } : {}),
  args,
});

const commonUse = {
  baseURL: 'http://127.0.0.1:4173',
  trace: 'retain-on-failure' as const,
  screenshot: 'only-on-failure' as const,
  video: 'retain-on-failure' as const,
};

const chromiumProject = {
  name: 'chromium',
  testIgnore: '**/webgpu.spec.ts',
  use: {
    ...devices['Desktop Chrome'],
    ...commonUse,
    launchOptions: chromiumLaunchOptions([
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ]),
  },
};

const webgpuProject = {
  name: 'chromium-webgpu',
  testMatch: '**/webgpu.spec.ts',
  use: {
    ...devices['Desktop Chrome'],
    ...commonUse,
    viewport: { width: 640, height: 360 },
    launchOptions: chromiumLaunchOptions([
      '--enable-unsafe-webgpu',
      '--enable-unsafe-swiftshader',
      '--use-vulkan=swiftshader',
      '--enable-features=Vulkan,UseSkiaRenderer',
      '--enable-dawn-features=allow_unsafe_apis',
      '--disable-dawn-features=disallow_unsafe_apis',
      '--use-gpu-in-tests',
      '--enable-accelerated-2d-canvas',
      '--ignore-gpu-blocklist',
    ]),
  },
};

const webServer =
  process.env.KYXOS_MANAGED_E2E_SERVERS === '1'
    ? undefined
    : [
        {
          command:
            'node node_modules/vite/bin/vite.js apps/playground --configLoader runner --host 127.0.0.1 --port 4173',
          url: 'http://127.0.0.1:4173',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command:
            'node node_modules/vite/bin/vite.js apps/studio --configLoader runner --host 127.0.0.1 --port 4174',
          url: 'http://127.0.0.1:4174',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command:
            'node node_modules/vite/bin/vite.js apps/public-viewer --configLoader runner --host 127.0.0.1 --port 4175',
          url: 'http://127.0.0.1:4175',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ];

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  projects: [chromiumProject, ...(process.env.KYXOS_WEBGPU_E2E === '1' ? [webgpuProject] : [])],
  webServer,
});
