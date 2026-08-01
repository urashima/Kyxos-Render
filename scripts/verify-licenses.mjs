import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedCommit = '3446b0a1b7ac95912771f1431a10f804f62e814f';
const notice = await readFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
const license = await readFile(resolve(root, 'licenses/playcanvas-editor-MIT.txt'), 'utf8');
const source = JSON.parse(await readFile(resolve(root, 'third-party/playcanvas-editor-source.json'), 'utf8'));
const shell = JSON.parse(await readFile(resolve(root, 'packages/studio-shell/package.json'), 'utf8'));

const failures = [];
if (source.upstream?.repository !== 'https://github.com/playcanvas/editor') failures.push('PlayCanvas Editor repository provenance is missing.');
if (source.upstream?.commit !== expectedCommit) failures.push(`PlayCanvas Editor must remain pinned to ${expectedCommit}.`);
if (source.upstream?.license !== 'MIT') failures.push('PlayCanvas Editor license must be recorded as MIT.');
if (!notice.includes(expectedCommit) || !notice.includes('PlayCanvas Editor')) failures.push('THIRD_PARTY_NOTICES.md does not contain the pinned upstream source.');
if (!license.includes('Copyright (c) 2011-2026 PlayCanvas Ltd.')) failures.push('The PlayCanvas MIT copyright statement is missing.');
if (!license.includes('Permission is hereby granted, free of charge')) failures.push('The complete MIT grant is missing.');
if (shell.dependencies?.['@playcanvas/pcui'] !== '6.1.4') failures.push('PCUI version differs from the audited 6.1.4 release.');
if (shell.dependencies?.['@playcanvas/observer'] !== '1.7.1') failures.push('Observer version differs from the audited 1.7.1 release.');

const appSources = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (/\.(ts|tsx|js|mjs|html|css)$/.test(entry.name)) appSources.push(path);
  }
}
await collect(resolve(root, 'apps'));
for (const path of appSources) {
  const content = await readFile(path, 'utf8');
  if (/playcanvas\.com|PlayCanvas logo|ViewportApplication|ShareDB|pc\.Application/.test(content)) {
    failures.push(`Forbidden PlayCanvas hosted service, runtime, or branding reference in ${path}.`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Third-party provenance and MIT notices verified.');
