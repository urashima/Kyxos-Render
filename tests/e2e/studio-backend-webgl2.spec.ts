import { test } from '@playwright/test';

import { acceptStudioBackend } from './studio-backend-acceptance';

test('Studio forced WebGL2 backend renders and produces visual evidence', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await acceptStudioBackend(page, testInfo, 'webgl2');
});
