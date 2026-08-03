import { HierarchyService } from '@kyxos/editor-core';
import type { KyxosSceneContract } from '@kyxos/scene-contract';

type HierarchyInternals = {
  host: { getScene(): KyxosSceneContract };
  expanded: Set<string>;
};

type HierarchyPrototype = {
  rows(query?: string): ReturnType<HierarchyService['rows']>;
  [key: symbol]: unknown;
};

const installed = Symbol.for('kyxos.studio.imported-hierarchy-expansion');
const signatures = new WeakMap<HierarchyService, string>();

function importedSceneSignature(scene: KyxosSceneContract): string | null {
  const models = Object.values(scene.assets)
    .filter((asset) => asset.kind === 'model')
    .map((asset) => `${asset.id}:${asset.contentHash}`)
    .sort();
  if (!models.length || !scene.nodes.length) return null;

  // Node IDs change when a different source hierarchy is imported or reimported,
  // but ordinary transforms, material edits and renames do not. This lets users
  // collapse branches normally after the initial authored tree is revealed.
  return [scene.id, ...models, ...scene.nodes.map((node) => node.id).sort()].join('|');
}

const prototype = HierarchyService.prototype as unknown as HierarchyPrototype;

if (!prototype[installed]) {
  const originalRows = prototype.rows;
  prototype.rows = function rowsWithImportedHierarchyExpanded(query = '') {
    const service = this as unknown as HierarchyService;
    const internal = this as unknown as HierarchyInternals;
    const scene = internal.host.getScene();
    const signature = importedSceneSignature(scene);

    if (signature && signatures.get(service) !== signature) {
      for (const node of scene.nodes) {
        if (node.children.length) internal.expanded.add(node.id);
      }
      signatures.set(service, signature);
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.importedHierarchy = 'expanded';
      }
    } else if (!signature) {
      signatures.delete(service);
    }

    return originalRows.call(this, query);
  };
  prototype[installed] = true;
}
