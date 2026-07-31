import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pagesBase = process.env.PAGES_BASE ?? '';

// The repository's generic PR preview workflow copies only apps/playground/dist.
// During a PR Pages build, attach the other products beneath that directory so
// the preview exposes the complete Kyxos product surface without changing
// normal local, CI, or accepted Pages builds.
if (!pagesBase.includes('/preview/')) {
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const previewRoot = resolve(root, 'apps/playground/dist');
const products = {
  studio: resolve(root, 'apps/studio/dist'),
  public: resolve(root, 'apps/public-viewer/dist'),
  embed: resolve(root, 'apps/public-viewer/dist'),
};

async function assertDirectory(path) {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error();
  } catch {
    throw new Error(`Missing PR preview product build: ${path}`);
  }
}

await assertDirectory(previewRoot);
for (const source of new Set(Object.values(products))) await assertDirectory(source);

for (const [route, source] of Object.entries(products)) {
  const target = resolve(previewRoot, route);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
}

await writeFile(
  resolve(previewRoot, 'preview-build.json'),
  `${JSON.stringify(
    {
      pagesBase,
      commit: process.env.GITHUB_SHA ?? 'local',
      generatedAt: new Date().toISOString(),
      products: Object.keys(products),
    },
    null,
    2,
  )}\n`,
);

console.log(`Composed complete PR preview under ${pagesBase}: studio/, public/, embed/`);
