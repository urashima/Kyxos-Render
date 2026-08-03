import { test } from '@playwright/test';

import { acceptStudioBackend } from './studio-backend-acceptance';

test('Studio forced WebGPU backend renders and produces visual evidence', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await acceptStudioBackend(page, testInfo, 'webgpu');
});
