import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractSource = await readFile(resolve(root, 'packages/scene-contract/src/index.ts'), 'utf8');
const migrationSource = await readFile(resolve(root, 'packages/scene-migrations/src/index.ts'), 'utf8');
const viewerPackage = JSON.parse(await readFile(resolve(root, 'packages/viewer/package.json'), 'utf8'));
const publicPackage = JSON.parse(await readFile(resolve(root, 'apps/public-viewer/package.json'), 'utf8'));
const failures = [];

for (const symbol of [
  'validateSceneContract', 'getContractVersion', 'getRuntimeCompatibility',
  'KyxosSceneContract', 'asset://', 'SceneEffectName',
]) {
  if (!contractSource.includes(symbol)) failures.push(`Scene Contract is missing ${symbol}.`);
}
for (const effect of [
  'traa', 'ssao', 'gtao', 'ssr', 'ssgi', 'temporalReprojection', 'temporalDenoise',
  'poissonDenoise', 'motionBlur', 'bloom', 'dof', 'fxaa', 'smaa', 'ssaa', 'lut',
  'sharpness', 'sparkle',
]) {
  if (!contractSource.includes(`'${effect}'`)) failures.push(`Scene Contract is missing render effect ${effect}.`);
}
for (const version of ["'0.9.0'", "'1.0.0'", "'1.1.0'"]) {
  if (!migrationSource.includes(version)) failures.push(`Migration graph does not cover ${version}.`);
}
if (!viewerPackage.dependencies?.['@kyxos/scene-contract']) failures.push('Viewer must depend on Scene Contract.');
if (!publicPackage.dependencies?.['@kyxos/scene-migrations']) failures.push('Public Viewer must depend on scene migrations.');
if (viewerPackage.version === viewerPackage.dependencies?.['@kyxos/scene-contract']) failures.push('Viewer and Contract versions must remain independently versioned.');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Scene Contract surface, effect coverage, migrations and independent package boundaries verified.');
