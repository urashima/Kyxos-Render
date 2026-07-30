import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const forbidden = /from\s+['"]@kyxos\/viewer\/src\//;
const allowedRoots = new Set([resolve(root, 'packages/viewer'), resolve(root, 'tests')]);
const offenders = [];
const ignored = new Set(['node_modules', 'dist', 'site', '.git']);
const sourcePattern = /\.(ts|tsx|js|mjs)$/;

async function scan(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) await scan(absolute);
      continue;
    }
    if (!sourcePattern.test(entry.name)) continue;
    const relative = absolute.slice(root.length + 1);
    if ([...allowedRoots].some((allowed) => absolute.startsWith(allowed))) continue;
    const text = await readFile(absolute, 'utf8');
    if (forbidden.test(text)) offenders.push(relative);
  }
}

await scan(root);

if (offenders.length > 0) {
  console.error(`Forbidden viewer internals import found:\n${offenders.join('\n')}`);
  process.exit(1);
}

console.warn('Forbidden import check passed.');
