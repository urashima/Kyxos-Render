import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoots = ['apps', 'packages'];
const packageManifests = new Map();
const skippedDirectories = new Set([
  'node_modules',
  'dist',
  'site',
  'coverage',
  'test-results',
]);

async function collectPackageJson(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collectPackageJson(path);
    } else if (entry.name === 'package.json') {
      const manifest = JSON.parse(await readFile(path, 'utf8'));
      if (manifest.name) packageManifests.set(manifest.name, { path, manifest });
    }
  }
}

for (const name of packageRoots) {
  const directory = resolve(root, name);
  try {
    if ((await stat(directory)).isDirectory()) await collectPackageJson(directory);
  } catch {
    // Missing optional package roots are reported by package rules below.
  }
}

const rules = [
  {
    package: '@kyxos/viewer',
    forbidden: [
      '@kyxos/editor-core',
      '@kyxos/studio-shell',
      '@kyxos/api-client',
      '@playcanvas/pcui',
      '@playcanvas/observer',
      '@playcanvas/pcui-graph',
      'playcanvas',
    ],
  },
  {
    package: '@kyxos/public-viewer',
    forbidden: [
      '@kyxos/editor-core',
      '@kyxos/studio-shell',
      '@kyxos/viewer-adapter',
      '@playcanvas/pcui',
      '@playcanvas/observer',
      '@playcanvas/pcui-graph',
    ],
  },
  {
    package: '@kyxos/scene-contract',
    forbidden: [
      '@kyxos/viewer',
      '@kyxos/editor-core',
      '@kyxos/studio-shell',
      '@kyxos/shared-ui',
      '@playcanvas/pcui',
      '@playcanvas/observer',
      'three',
    ],
  },
  {
    package: '@kyxos/editor-core',
    forbidden: [
      'three',
      '@kyxos/viewer',
      '@kyxos/viewer-adapter',
      '@playcanvas/pcui',
    ],
  },
];

function containsPackageImport(content, packageName) {
  const candidates = [
    `from '${packageName}'`,
    `from "${packageName}"`,
    `from '${packageName}/`,
    `from "${packageName}/`,
    `import('${packageName}')`,
    `import("${packageName}")`,
    `import('${packageName}/`,
    `import("${packageName}/`,
    `require('${packageName}')`,
    `require("${packageName}")`,
    `require('${packageName}/`,
    `require("${packageName}/`,
  ];
  return candidates.some((candidate) => content.includes(candidate));
}

const failures = [];
for (const rule of rules) {
  const entry = packageManifests.get(rule.package);
  if (!entry) {
    failures.push(`Missing package ${rule.package}.`);
    continue;
  }

  const dependencies = {
    ...entry.manifest.dependencies,
    ...entry.manifest.devDependencies,
    ...entry.manifest.peerDependencies,
  };
  for (const forbidden of rule.forbidden) {
    if (dependencies[forbidden]) {
      failures.push(
        `${rule.package} package.json depends on forbidden package ${forbidden}.`,
      );
    }
  }

  const sourceRoot = resolve(dirname(entry.path), 'src');
  async function scan(directory) {
    for (const child of await readdir(directory, { withFileTypes: true })) {
      if (child.isDirectory() && skippedDirectories.has(child.name)) continue;
      const path = resolve(directory, child.name);
      if (child.isDirectory()) {
        await scan(path);
      } else if (/\.(ts|tsx|js|mjs)$/.test(child.name)) {
        const content = await readFile(path, 'utf8');
        for (const forbidden of rule.forbidden) {
          if (containsPackageImport(content, forbidden)) {
            failures.push(
              `${relative(root, path)} imports forbidden dependency ${forbidden}.`,
            );
          }
        }
      }
    }
  }

  try {
    await scan(sourceRoot);
  } catch {
    // Packages without source directories are handled by their own build gates.
  }
}

const studioShell = packageManifests.get('@kyxos/studio-shell')?.manifest;
if (!studioShell?.dependencies?.['@playcanvas/pcui']) {
  failures.push('studio-shell must own the PCUI dependency.');
}
if (!studioShell?.dependencies?.['@playcanvas/observer']) {
  failures.push('studio-shell must own the Observer dependency.');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(
  `Package boundaries verified across ${packageManifests.size} workspace packages.`,
);
