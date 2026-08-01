import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const appRoots = ['apps/playground', 'apps/studio', 'apps/public-viewer'] as const;
const appPackages = ['@kyxos/playground', '@kyxos/studio', '@kyxos/public-viewer'];

function sourceFiles(directory: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) output.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx|js|mjs|css|html)$/.test(entry)) output.push(path);
  }
  return output;
}

function moduleSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/(?:from\s*|import\s*\(|import\s*)['"]([^'"]+)['"]/g),
    ...source.matchAll(/@import\s+['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);
}

describe('independent Kyxos product runtimes', () => {
  for (const appRoot of appRoots) {
    it(`${appRoot} does not import another application`, () => {
      const violations: string[] = [];
      const ownPackage = `@kyxos/${appRoot.split('/').at(-1)}`;

      for (const file of sourceFiles(resolve(root, appRoot))) {
        const source = readFileSync(file, 'utf8');
        for (const specifier of moduleSpecifiers(source)) {
          const importsAnotherAppPackage =
            appPackages.includes(specifier) && specifier !== ownPackage;
          const importsAppsDirectory = /(^|\/)apps\//.test(specifier);
          if (importsAnotherAppPackage || importsAppsDirectory) {
            violations.push(`${relative(root, file)} -> ${specifier}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  }
});
