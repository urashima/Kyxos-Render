import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const viteBin = resolve(root, 'node_modules/vite/bin/vite.js');
const playwrightCli = resolve(root, 'node_modules/@playwright/test/cli.js');
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const servers = [
  { app: 'apps/playground', port: 4173 },
  { app: 'apps/studio', port: 4174 },
  { app: 'apps/public-viewer', port: 4175 },
];

const children = [];

async function runCommand(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? 1}`);
  }
}

async function buildApps() {
  if (process.env.KYXOS_SKIP_E2E_BUILD === '1') return;
  await runCommand(pnpmBin, ['build'], {
    STUDIO_BASE: '/',
    PUBLIC_VIEWER_BASE: '/',
  });
}

function spawnServer({ app, port }) {
  const child = spawn(
    process.execPath,
    [
      viteBin,
      'preview',
      app,
      '--configLoader',
      'runner',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
    },
  );
  child.stdout.on('data', (chunk) => process.stdout.write(`[${app}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${app}] ${chunk}`));
  children.push(child);
}

async function waitForUrl(url, timeoutMs = 120_000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : ''}`);
}

function terminate(child) {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve();
  const release = () => {
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
  };
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.unref();
    release();
    return Promise.resolve();
  }
  child.kill('SIGTERM');
  return Promise.race([
    once(child, 'exit'),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2000)).then(() => child.kill('SIGKILL')),
  ])
    .catch(() => undefined)
    .finally(release);
}

async function main() {
  await buildApps();
  for (const server of servers) spawnServer(server);
  await Promise.all(servers.map((server) => waitForUrl(`http://127.0.0.1:${server.port}/`)));

  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const playwrightEnv = {
    ...process.env,
    KYXOS_MANAGED_E2E_SERVERS: '1',
  };
  if (!process.env.CI) {
    playwrightEnv.PLAYWRIGHT_BROWSERS_PATH ??= '0';
  }
  const child = spawn(process.execPath, [playwrightCli, 'test', ...args], {
    cwd: root,
    stdio: 'inherit',
    env: playwrightEnv,
  });
  const [code] = await once(child, 'exit');
  process.exitCode = Number(code ?? 1);
}

try {
  await main();
} finally {
  await Promise.all(children.map(terminate));
}
