import { defineConfig, devices } from '@playwright/test';

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
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
    },
  },
};

const webgpuProject = {
  name: 'chromium-webgpu',
  testMatch: '**/webgpu.spec.ts',
  use: {
    ...devices['Desktop Chrome'],
    ...commonUse,
    viewport: { width: 640, height: 360 },
    launchOptions: {
      args: [
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
    },
  },
};

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  projects: [chromiumProject, ...(process.env.KYXOS_WEBGPU_E2E === '1' ? [webgpuProject] : [])],
  webServer: {
    command: 'pnpm --filter @kyxos/playground exec vite --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
