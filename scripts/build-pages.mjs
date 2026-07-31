import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = resolve(root, 'site');
const products = {
  latest: resolve(root, 'apps/playground/dist'),
  studio: resolve(root, 'apps/studio/dist'),
  public: resolve(root, 'apps/public-viewer/dist'),
};
const playgroundRoutes = [
  'overview',
  'pbr',
  'buffers',
  'aa',
  'traa',
  'temporal',
  'gtao',
  'ssao',
  'ssr',
  'ssgi',
  'motion-blur',
  'denoise',
  'sharpness',
  'lens-distortion',
  'background',
  'sparkle',
  'full-stack',
  'performance',
  'lifecycle',
];

async function assertDirectory(path) {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error(`${path} is not a directory.`);
  } catch {
    throw new Error(`Missing build output: ${relative(root, path)}. Run pnpm build first.`);
  }
}

async function collectFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path, base)));
    else files.push({ path: relative(base, path).replaceAll('\\', '/'), bytes: (await stat(path)).size });
  }
  return files;
}

for (const directory of Object.values(products)) await assertDirectory(directory);
await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });

for (const [name, directory] of Object.entries(products)) {
  await cp(directory, resolve(site, name), { recursive: true });
}
await cp(products.public, resolve(site, 'embed'), { recursive: true });

const playgroundIndex = await readFile(resolve(site, 'latest/index.html'), 'utf8');
for (const route of playgroundRoutes) {
  const latestTarget = resolve(site, 'latest', route);
  const compatibilityTarget = resolve(site, route);
  await mkdir(latestTarget, { recursive: true });
  await mkdir(compatibilityTarget, { recursive: true });
  await writeFile(resolve(latestTarget, 'index.html'), playgroundIndex);
  await writeFile(resolve(compatibilityTarget, 'index.html'), playgroundIndex);
}

await writeFile(
  resolve(site, 'index.html'),
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./latest/"><title>Kyxos Render</title>',
);
await writeFile(resolve(site, '.nojekyll'), '');

const report = {};
for (const product of ['latest', 'studio', 'public', 'embed']) {
  const files = await collectFiles(resolve(site, product));
  report[product] = {
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    javascriptBytes: files
      .filter((file) => ['.js', '.mjs'].includes(extname(file.path)))
      .reduce((total, file) => total + file.bytes, 0),
    cssBytes: files
      .filter((file) => extname(file.path) === '.css')
      .reduce((total, file) => total + file.bytes, 0),
    files,
  };
}
await writeFile(resolve(site, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);

const publicScripts = (await collectFiles(resolve(site, 'public')))
  .filter((file) => ['.js', '.mjs'].includes(extname(file.path)))
  .map((file) => resolve(site, 'public', file.path));
const forbidden = ['@playcanvas/pcui', '@playcanvas/observer', '@kyxos/editor-core', '@kyxos/studio-shell'];
for (const script of publicScripts) {
  const content = await readFile(script, 'utf8');
  for (const token of forbidden) {
    if (content.includes(token)) {
      throw new Error(`Public Viewer bundle contains forbidden editor dependency token ${token} in ${relative(root, script)}.`);
    }
  }
}

console.log(JSON.stringify(report, null, 2));
