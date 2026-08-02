import { SceneDocument } from '@kyxos/editor-core';
import type { KyxosSceneContract, ScenePatch } from '@kyxos/scene-contract';

import { mountGltfNodeInspector } from './gltf-node-inspector';

interface InspectorDocumentPrototype {
  replace(scene: KyxosSceneContract, source?: string): void;
  apply(patch: ScenePatch, source?: string): void;
  value: KyxosSceneContract;
  __kyxosGltfInspectorInstalled?: boolean;
}

interface StudioHistoryApi {
  applyPatch(label: string, patch: ScenePatch): void;
}

interface InspectorGlobal {
  kyxosStudio?: { api?: StudioHistoryApi };
}

let activeDocument: SceneDocument | null = null;
let renderQueued = false;
let observer: MutationObserver | null = null;

function selectedNodeIds(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '.hierarchy-row[aria-selected="true"][data-node]',
    ),
  )
    .map((row) => row.dataset.node)
    .filter((id): id is string => Boolean(id));
}

function inspectorSignature(
  scene: KyxosSceneContract,
  nodeIds: string[],
): string {
  const selected = new Set(nodeIds);
  return scene.nodes
    .filter((node) => selected.has(node.id))
    .map((node) => [
      node.id,
      node.skin?.skinIndex ?? '',
      node.skin?.joints.length ?? 0,
      ...(node.morphWeights ?? []),
    ].join(':'))
    .join('|');
}

function applyAuthoringPatch(label: string, patch: ScenePatch, mergeKey?: string): void {
  if (!patch.length) return;
  const api = (globalThis as typeof globalThis & InspectorGlobal).kyxosStudio?.api;
  const historyLabel = mergeKey ? `${label}:${mergeKey}` : label;
  if (api) {
    api.applyPatch(historyLabel, patch);
    return;
  }
  activeDocument?.apply(patch, historyLabel);
}

function renderInspector(): void {
  renderQueued = false;
  const container = document.querySelector<HTMLElement>('.inspector-content');
  if (!container || !activeDocument) return;

  const scene = activeDocument.value;
  const nodeIds = selectedNodeIds();
  const selected = new Set(nodeIds);
  const nodes = scene.nodes.filter((node) => selected.has(node.id));
  const authorable = nodes.filter(
    (node) => Boolean(node.skin) || (node.morphWeights?.length ?? 0) > 0,
  );
  const signature = inspectorSignature(scene, nodeIds);
  const existing = container.querySelectorAll('.gltf-node-section');

  if (!authorable.length) {
    existing.forEach((element) => element.remove());
    delete container.dataset.gltfInspectorSignature;
    return;
  }
  if (
    existing.length > 0
    && container.dataset.gltfInspectorSignature === signature
  ) {
    return;
  }

  existing.forEach((element) => element.remove());
  container.dataset.gltfInspectorSignature = signature;
  const shell = container.closest<HTMLElement>('.kyxos-studio-shell');
  const canEdit = !shell?.classList.contains('studio-read-only');
  mountGltfNodeInspector({
    scene,
    nodes: authorable,
    container,
    canEdit,
    applyPatch: applyAuthoringPatch,
  });
}

function queueInspectorRender(): void {
  if (renderQueued || typeof document === 'undefined') return;
  renderQueued = true;
  queueMicrotask(renderInspector);
}

function installDocumentCapture(): void {
  const prototype = SceneDocument.prototype as unknown as InspectorDocumentPrototype;
  if (prototype.__kyxosGltfInspectorInstalled) return;

  const originalReplace = prototype.replace;
  prototype.replace = function replaceAndRefreshInspector(scene, source = 'replace'): void {
    activeDocument = this as unknown as SceneDocument;
    originalReplace.call(this, scene, source);
    queueInspectorRender();
  };

  const originalApply = prototype.apply;
  prototype.apply = function applyAndRefreshInspector(patch, source = 'command'): void {
    activeDocument = this as unknown as SceneDocument;
    originalApply.call(this, patch, source);
    queueInspectorRender();
  };
  prototype.__kyxosGltfInspectorInstalled = true;
}

function installDomObserver(): void {
  if (typeof document === 'undefined' || observer) return;
  const start = () => {
    if (!document.body || observer) return;
    observer = new MutationObserver(queueInspectorRender);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'class', 'data-node'],
    });
    queueInspectorRender();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

export function installGltfNodeInspectorBootstrap(): void {
  installDocumentCapture();
  installDomObserver();
}

installGltfNodeInspectorBootstrap();
