import { SceneDocument } from '@kyxos/editor-core';
import type { KyxosSceneContract, Transform } from '@kyxos/scene-contract';

interface ReportNode {
  index?: number;
  parent?: number | null;
  matrix?: number[];
  rotation?: number[];
}

interface ImportReport {
  nodes?: ReportNode[];
}

interface FidelityGlobal {
  __kyxosLastGlbImportReport?: ImportReport;
}

interface SceneDocumentPrototype {
  replace(scene: KyxosSceneContract, source?: string): void;
  __kyxosGltfFidelityInstalled?: boolean;
}

function cloneTransform(transform: Transform): Transform {
  return structuredClone(transform);
}

function enrichImportedScene(scene: KyxosSceneContract, report: ImportReport): KyxosSceneContract {
  const next = structuredClone(scene);
  for (const node of next.nodes) {
    const sourceIndex = node.metadata?.gltfNodeIndex;
    if (typeof sourceIndex !== 'number') continue;
    const source = report.nodes?.[sourceIndex];
    if (!source) continue;
    node.metadata = {
      ...(node.metadata ?? {}),
      sourceQuaternion: Array.isArray(source.rotation)
        ? structuredClone(source.rotation)
        : node.metadata?.sourceQuaternion,
      gltfNodeMatrix: Array.isArray(source.matrix)
        ? structuredClone(source.matrix)
        : undefined,
      gltfOriginalParentIndex: source.parent ?? null,
      gltfOriginalTransform: cloneTransform(node.transform),
    };
  }
  return next;
}

const prototype = SceneDocument.prototype as unknown as SceneDocumentPrototype;
if (!prototype.__kyxosGltfFidelityInstalled) {
  const originalReplace = prototype.replace;
  prototype.replace = function replaceWithNativeGltfMetadata(
    scene: KyxosSceneContract,
    source = 'replace',
  ): void {
    const report = (globalThis as typeof globalThis & FidelityGlobal)
      .__kyxosLastGlbImportReport;
    originalReplace.call(
      this,
      source === 'import-glb' && report ? enrichImportedScene(scene, report) : scene,
      source,
    );
  };
  prototype.__kyxosGltfFidelityInstalled = true;
}
