import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'apps/playground/dist');
const site = resolve(root, 'site');
const latest = resolve(site, 'latest');
const routes = [
  'overview', 'pbr', 'buffers', 'aa', 'traa', 'temporal', 'gtao', 'ssao', 'ssr', 'ssgi',
  'motion-blur', 'denoise', 'sharpness', 'lens-distortion', 'background', 'sparkle',
  'full-stack', 'performance', 'lifecycle',
];

await rm(site, { recursive: true, force: true });
await mkdir(latest, { recursive: true });
await cp(dist, latest, { recursive: true });
const index = await readFile(resolve(latest, 'index.html'), 'utf8');
for (const route of routes) {
  const target = resolve(latest, route);
  await mkdir(target, { recursive: true });
  await writeFile(resolve(target, 'index.html'), index);
}
await writeFile(
  resolve(site, 'index.html'),
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./latest/"><title>Kyxos Render</title>',
);
await writeFile(resolve(site, '.nojekyll'), '');
