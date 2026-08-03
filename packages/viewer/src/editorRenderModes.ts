import * as THREE from 'three/webgpu';
import { texture, uv, vec3 } from 'three/tsl';

import { KyxosViewer } from './KyxosViewer';
import type { DebugView } from './types';

export type EditorRenderMode =
  | 'shaded'
  | 'wireframe'
  | 'albedo'
  | 'normals'
  | 'ambientOcclusion'
  | 'emission'
  | 'depth'
  | 'metalness'
  | 'roughness'
  | 'velocity'
  | 'uv';

type OverrideMode = 'wireframe' | 'ambientOcclusion' | 'uv';

type MaterialLike = THREE.Material & {
  color?: THREE.Color;
  aoMap?: THREE.Texture | null;
  opacity?: number;
  transparent?: boolean;
  alphaTest?: number;
  side?: THREE.Side;
  depthTest?: boolean;
  depthWrite?: boolean;
};

interface ViewerInternals {
  modelRoot: THREE.Object3D;
}

interface RenderModeState {
  mode: EditorRenderMode;
  originals: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  generated: Set<THREE.Material>;
  onPipelineRebuilt: EventListener;
}

const installed = Symbol('kyxos.editorRenderModes.installed');
const states = new WeakMap<KyxosViewer, RenderModeState>();

const debugViews: Partial<Record<EditorRenderMode, DebugView>> = {
  shaded: 'final',
  albedo: 'diffuseColor',
  normals: 'normal',
  emission: 'emissive',
  depth: 'depth',
  metalness: 'metalness',
  roughness: 'roughness',
  velocity: 'velocity',
};

function internals(viewer: KyxosViewer): ViewerInternals {
  return viewer as unknown as ViewerInternals;
}

function specialMode(mode: EditorRenderMode): mode is OverrideMode {
  return mode === 'wireframe' || mode === 'ambientOcclusion' || mode === 'uv';
}

function copyPresentation(
  source: MaterialLike,
  target: THREE.MeshBasicNodeMaterial,
): void {
  target.name = `Kyxos ${source.name || source.type} debug`;
  target.transparent = Boolean(source.transparent);
  target.opacity = Number(source.opacity ?? 1);
  target.alphaTest = Number(source.alphaTest ?? 0);
  target.side = source.side ?? THREE.FrontSide;
  target.depthTest = source.depthTest !== false;
  target.depthWrite = source.depthWrite !== false;
  target.toneMapped = false;
}

function createOverrideMaterial(
  original: THREE.Material,
  mode: OverrideMode,
): THREE.MeshBasicNodeMaterial {
  const source = original as MaterialLike;
  const material = new THREE.MeshBasicNodeMaterial();
  copyPresentation(source, material);

  if (mode === 'wireframe') {
    material.wireframe = true;
    material.color.copy(source.color ?? new THREE.Color(0xd8f79b));
  } else if (mode === 'ambientOcclusion') {
    material.colorNode = source.aoMap
      ? vec3(texture(source.aoMap, uv(1)).r)
      : vec3(1);
  } else {
    const coordinate = uv(0);
    material.colorNode = vec3(coordinate.x, coordinate.y, 0);
  }
  return material;
}

function restoreMaterials(state: RenderModeState): void {
  for (const [mesh, material] of state.originals) {
    if (mesh.parent) mesh.material = material;
  }
  state.originals.clear();
  for (const material of state.generated) material.dispose();
  state.generated.clear();
}

function applyOverride(
  viewer: KyxosViewer,
  state: RenderModeState,
  mode: OverrideMode,
): boolean {
  let changed = false;
  internals(viewer).modelRoot.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || state.originals.has(object)) return;
    const original = object.material;
    state.originals.set(object, original);
    if (Array.isArray(original)) {
      const replacements = original.map((material) => {
        const replacement = createOverrideMaterial(material, mode);
        state.generated.add(replacement);
        return replacement;
      });
      object.material = replacements;
    } else {
      const replacement = createOverrideMaterial(original, mode);
      state.generated.add(replacement);
      object.material = replacement;
    }
    changed = true;
  });
  return changed;
}

function ensureState(viewer: KyxosViewer): RenderModeState {
  const existing = states.get(viewer);
  if (existing) return existing;
  const state: RenderModeState = {
    mode: 'shaded',
    originals: new Map(),
    generated: new Set(),
    onPipelineRebuilt: () => {
      if (!specialMode(state.mode)) return;
      if (applyOverride(viewer, state, state.mode)) {
        viewer.resetTemporal(`editor-render-mode-refresh:${state.mode}`);
      }
    },
  };
  viewer.addEventListener('pipeline-rebuilt', state.onPipelineRebuilt);
  states.set(viewer, state);
  return state;
}

export function setEditorRenderMode(
  this: KyxosViewer,
  mode: EditorRenderMode,
): void {
  const state = ensureState(this);
  restoreMaterials(state);
  state.mode = mode;

  if (specialMode(mode)) {
    applyOverride(this, state, mode);
    this.setDebugView('beauty');
  } else {
    this.setDebugView(debugViews[mode] ?? 'final');
  }

  this.canvas.dataset.editorRenderMode = mode;
  this.canvas.dataset.editorMaterialOverride = specialMode(mode) ? mode : 'none';
  this.dispatchEvent(new CustomEvent('editor-render-mode-change', {
    detail: { mode },
  }));
}

export function getEditorRenderMode(this: KyxosViewer): EditorRenderMode {
  return states.get(this)?.mode ?? 'shaded';
}

const prototype = KyxosViewer.prototype as unknown as KyxosViewer & {
  [installed]?: boolean;
};
if (!prototype[installed]) {
  Object.assign(prototype, {
    setEditorRenderMode,
    getEditorRenderMode,
  });
  prototype[installed] = true;
}

declare module './KyxosViewer' {
  interface KyxosViewer {
    setEditorRenderMode(mode: EditorRenderMode): void;
    getEditorRenderMode(): EditorRenderMode;
  }
}
