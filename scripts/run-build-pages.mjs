import { spawnSync } from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const environment = { ...process.env, PAGES_BUILD: '1' };

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: environment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(pnpm, ['build']);
run(process.execPath, ['scripts/build-pages.mjs']);
