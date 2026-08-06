import './hierarchy-reparent-parity.css';

import {
  hierarchyRootIds,
  localTransformForWorld,
  worldMatrixMap,
  type Matrix4,
} from '@kyxos/editor-core/hierarchy-transform';
import type { KyxosSceneContract, ScenePatch } from '@kyxos/scene-contract';

interface StudioApiLike {
  getScene(): KyxosSceneContract;
  applyPatch(label: string, patch: ScenePatch): void;
  getSelection(): string[];
}

interface StudioGlobal {
  kyxosStudio?: { api?: StudioApiLike };
}

interface DragSnapshot {
  sceneId: string;
  rootIds: string[];
  parentIds: Map<string, string | null>;
  worldMatrices: Map<string, Matrix4>;
}

let snapshot: DragSnapshot | null = null;
let pendingDrop = false;
let hint: HTMLElement | null = null;
let lastPointer = { x: 0, y: 0 };

function studioApi(): StudioApiLike | null {
  return (globalThis as typeof globalThis & StudioGlobal).kyxosStudio?.api ?? null;
}

function ensureHint(): HTMLElement {
  if (hint?.isConnected) return hint;
  hint = document.createElement('div');
  hint.className = 'kx-reparent-mode-hint';
  hint.setAttribute('role', 'status');
  hint.setAttribute('aria-live', 'polite');
  document.body.append(hint);
  return hint;
}

function renderHint(preserve: boolean, x = lastPointer.x, y = lastPointer.y): void {
  const element = ensureHint();
  element.dataset.preserve = String(preserve);
  element.innerHTML = preserve
    ? '<strong>Preserve World</strong><span>Hold Ctrl/Cmd to keep local transform</span>'
    : '<strong>Keep Local</strong><span>World transform may change</span>';
  element.style.left = `${Math.min(window.innerWidth - 248, Math.max(8, x + 14))}px`;
  element.style.top = `${Math.min(window.innerHeight - 58, Math.max(8, y + 14))}px`;
  element.classList.add('visible');
}

function hideHint(): void {
  hint?.classList.remove('visible');
}

function startSnapshot(event: DragEvent): void {
  const row = (event.target as Element | null)?.closest<HTMLElement>('.hierarchy-row[data-node]');
  const api = studioApi();
  if (!row || !api) return;
  const scene = api.getScene();
  const nodeId = row.dataset.node;
  if (!nodeId) return;
  const selection = api.getSelection();
  const roots = hierarchyRootIds(scene.nodes, selection.includes(nodeId) ? selection : [nodeId]);
  if (!roots.length) return;
  const allWorld = worldMatrixMap(scene.nodes);
  snapshot = {
    sceneId: scene.id,
    rootIds: roots,
    parentIds: new Map(roots.map((id) => [
      id,
      scene.nodes.find((node) => node.id === id)?.parentId ?? null,
    ])),
    worldMatrices: new Map(roots.flatMap((id) => {
      const matrix = allWorld.get(id);
      return matrix ? [[id, matrix] as const] : [];
    })),
  };
  lastPointer = { x: event.clientX, y: event.clientY };
  renderHint(!(event.ctrlKey || event.metaKey));
}

function patchPreservedTransforms(api: StudioApiLike, drag: DragSnapshot): void {
  const scene = api.getScene();
  if (scene.id !== drag.sceneId) return;
  const worldAfter = worldMatrixMap(scene.nodes);
  const patch: ScenePatch = [];
  for (const rootId of drag.rootIds) {
    const nodeIndex = scene.nodes.findIndex((node) => node.id === rootId);
    if (nodeIndex < 0) continue;
    const node = scene.nodes[nodeIndex];
    if (node.parentId === drag.parentIds.get(rootId)) continue;
    const savedWorld = drag.worldMatrices.get(rootId);
    if (!savedWorld) continue;
    const parentWorld = node.parentId ? worldAfter.get(node.parentId) : null;
    const transform = localTransformForWorld(savedWorld, parentWorld);
    if (!transform) continue;
    patch.push({
      op: 'replace',
      path: `/nodes/${nodeIndex}/transform`,
      value: transform,
    });
    if (node.cameraId) {
      const cameraIndex = scene.cameras.findIndex((camera) => camera.id === node.cameraId);
      if (cameraIndex >= 0) patch.push({
        op: 'replace',
        path: `/cameras/${cameraIndex}/transform`,
        value: structuredClone(transform),
      });
    }
    if (node.lightId) {
      const lightIndex = (scene.lights ?? []).findIndex((light) => light.id === node.lightId);
      if (lightIndex >= 0) patch.push({
        op: 'replace',
        path: `/lights/${lightIndex}/transform`,
        value: structuredClone(transform),
      });
    }
  }
  if (!patch.length) return;
  api.applyPatch('Preserve hierarchy world transform', patch);
  const canvas = document.querySelector<HTMLCanvasElement>('#studio-canvas');
  if (canvas) {
    canvas.dataset.reparentTransformMode = 'world';
    canvas.dataset.reparentTransformAt = String(performance.now());
  }
}

function scheduleDrop(event: DragEvent): void {
  if (!snapshot) return;
  const target = (event.target as Element | null)?.closest('.hierarchy-row[data-node]');
  if (!target) return;
  const drag = snapshot;
  const preserve = !(event.ctrlKey || event.metaKey);
  pendingDrop = true;
  lastPointer = { x: event.clientX, y: event.clientY };
  renderHint(preserve);
  window.setTimeout(() => {
    try {
      const api = studioApi();
      if (preserve && api) patchPreservedTransforms(api, drag);
      else {
        const canvas = document.querySelector<HTMLCanvasElement>('#studio-canvas');
        if (canvas) {
          canvas.dataset.reparentTransformMode = 'local';
          canvas.dataset.reparentTransformAt = String(performance.now());
        }
      }
    } finally {
      pendingDrop = false;
      snapshot = null;
      hideHint();
    }
  }, 0);
}

function updateDragMode(event: DragEvent): void {
  if (!snapshot) return;
  lastPointer = { x: event.clientX, y: event.clientY };
  renderHint(!(event.ctrlKey || event.metaKey));
}

function endDrag(): void {
  if (pendingDrop) return;
  snapshot = null;
  hideHint();
}

document.addEventListener('dragstart', startSnapshot, true);
document.addEventListener('dragover', updateDragMode, true);
document.addEventListener('drop', scheduleDrop, true);
document.addEventListener('dragend', endDrag, true);
window.addEventListener('blur', endDrag);
window.addEventListener('pagehide', () => {
  document.removeEventListener('dragstart', startSnapshot, true);
  document.removeEventListener('dragover', updateDragMode, true);
  document.removeEventListener('drop', scheduleDrop, true);
  document.removeEventListener('dragend', endDrag, true);
  window.removeEventListener('blur', endDrag);
  hint?.remove();
  hint = null;
}, { once: true });
