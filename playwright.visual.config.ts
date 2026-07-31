import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['html', { open: 'never', outputFolder: 'playwright-visual-report' }], ['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'pnpm build:pages && node scripts/serve-site.mjs',
    url: 'http://127.0.0.1:4173/latest/',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
