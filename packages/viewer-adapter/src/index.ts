import type { ProjectSession, SceneDocument } from '@kyxos/editor-core';
import type {
  AssetResolver,
  ScenePatch,
  Transform,
  ViewerCapabilityDescription,
} from '@kyxos/scene-contract';
import {
  KyxosViewer,
  type AnimationState,
  type QualityPresetName,
} from '@kyxos/viewer';

export interface SnapSettings {
  translation: number;
  rotation: number;
  scale: number;
  enabled: boolean;
}

export type EditorTool = 'select' | 'translate' | 'rotate' | 'scale';
export type CoordinateSpace = 'local' | 'world';

export interface KyxosViewportAdapter {
  mount(canvas: HTMLCanvasElement): Promise<void>;
  loadDocument(document: SceneDocument): Promise<void>;
  applyPatch(patch: ScenePatch): Promise<void>;
  select(nodeIds: string[]): void;
  frame(nodeIds: string[]): void;
  setTool(tool: EditorTool): void;
  setCoordinateSpace(space: CoordinateSpace): void;
  setSnap(settings: SnapSettings): void;
  getCapabilities(): ViewerCapabilityDescription | null;
  setAnimationState(state: AnimationState): void;
  getAnimationState():
    | (AnimationState & { duration: number; availableClips: string[] })
    | null;
  loadEnvironmentAsset(assetId?: string): Promise<void>;
  resetCamera(): void;
  setQualityPreset(name: QualityPresetName | 'ultra'): void;
  captureThumbnail(): Promise<Blob>;
  dispose(): void;
}

interface TransformDrag {
  pointerId: number;
  axis: 'x' | 'y' | 'z';
  startX: number;
  startY: number;
  transforms: Map<string, Transform>;
}

interface TransformChangeDetail {
  changes: Array<{
    nodeId: string;
    property: 'position' | 'rotation' | 'scale';
    axis: 'x' | 'y' | 'z';
    value: number;
  }>;
  mergeKey: string;
}

export class BrowserKyxosViewportAdapter
  extends EventTarget
  implements KyxosViewportAdapter
{
  private viewer: KyxosViewer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private document: SceneDocument | null = null;
  private selected: string[] = [];
  private tool: EditorTool = 'select';
  private coordinateSpace: CoordinateSpace = 'local';
  private snap: SnapSettings = {
    translation: 0.1,
    rotation: 15,
    scale: 0.1,
    enabled: false,
  };
  private gizmo: HTMLDivElement | null = null;
  private drag: TransformDrag | null = null;
  private operationQueue: Promise<void> = Promise.resolve();
  private generation = 0;

  private readonly onCanvasPointerDown = (event: PointerEvent) => {
    if (!this.viewer || !this.canvas || event.button !== 0) return;
    const hit = this.viewer.pick(event.clientX, event.clientY);
    this.selected = hit ? [hit.nodeId] : [];
    this.updateGizmo();
    this.dispatchEvent(
      new CustomEvent('selection', {
        detail: { nodeIds: [...this.selected], hit },
      }),
    );
  };

  private readonly onGizmoPointerDown = (event: PointerEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-axis]');
    if (!target || this.tool === 'select' || !this.document) return;
    event.preventDefault();
    event.stopPropagation();

    const axis = target.dataset.axis as TransformDrag['axis'];
    const transforms = new Map<string, Transform>();
    const scene = this.document.value;
    for (const nodeId of this.selected) {
      const node = scene.nodes.find((entry) => entry.id === nodeId);
      if (node && !node.locked) transforms.set(nodeId, structuredClone(node.transform));
    }
    if (!transforms.size) return;

    this.drag = {
      pointerId: event.pointerId,
      axis,
      startX: event.clientX,
      startY: event.clientY,
      transforms,
    };
    target.setPointerCapture(event.pointerId);
    window.addEventListener('pointermove', this.onGizmoPointerMove);
    window.addEventListener('pointerup', this.onGizmoPointerUp, { once: true });
    this.gizmo?.classList.add('is-dragging');
    this.dispatchEvent(
      new CustomEvent('transform-start', {
        detail: { nodeIds: [...this.selected] },
      }),
    );
  };

  private readonly onGizmoPointerMove = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const rawDelta =
      event.clientX - this.drag.startX - (event.clientY - this.drag.startY);
    const property =
      this.tool === 'translate'
        ? 'position'
        : this.tool === 'rotate'
          ? 'rotation'
          : 'scale';
    const sensitivity = property === 'rotation' ? 0.01 : 0.008;
    const delta = rawDelta * sensitivity;
    const changes: TransformChangeDetail['changes'] = [];

    for (const [nodeId, transform] of this.drag.transforms) {
      const initial = transform[property][this.drag.axis];
      let value =
        property === 'scale' ? Math.max(0.001, initial + delta) : initial + delta;
      value = this.applySnap(property, value);
      changes.push({
        nodeId,
        property,
        axis: this.drag.axis,
        value,
      });
    }

    this.dispatchEvent(
      new CustomEvent<TransformChangeDetail>('transform-change', {
        detail: {
          changes,
          mergeKey: `gizmo:${this.tool}:${this.selected.join(',')}:${this.drag.axis}`,
        },
      }),
    );
  };

  private readonly onGizmoPointerUp = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    window.removeEventListener('pointermove', this.onGizmoPointerMove);
    this.drag = null;
    this.gizmo?.classList.remove('is-dragging');
    this.dispatchEvent(
      new CustomEvent('transform-end', {
        detail: { nodeIds: [...this.selected] },
      }),
    );
  };

  constructor(
    private readonly assetResolver: AssetResolver,
    private readonly createOptions: {
      backend?: 'auto' | 'webgpu' | 'webgl2';
      quality?: QualityPresetName;
    } = {},
  ) {
    super();
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const generation = this.generation;
    const run = async () => {
      if (generation !== this.generation) return;
      await operation();
      if (generation !== this.generation) return;
      this.updateGizmo();
    };
    const result = this.operationQueue.then(run, run);
    this.operationQueue = result.catch((error) => {
      this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
    });
    return result;
  }

  async mount(canvas: HTMLCanvasElement): Promise<void> {
    this.dispose();
    this.generation += 1;
    this.operationQueue = Promise.resolve();
    this.canvas = canvas;
    this.viewer = await KyxosViewer.create({
      canvas,
      backend: this.createOptions.backend ?? 'auto',
      quality: this.createOptions.quality ?? 'high',
    });
    canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    this.mountGizmo(canvas);
    this.dispatchEvent(
      new CustomEvent('ready', { detail: this.viewer.getCapabilities() }),
    );
  }

  loadDocument(document: SceneDocument): Promise<void> {
    this.document = document;
    return this.enqueue(async () => {
      if (!this.viewer) throw new Error('Viewport adapter is not mounted.');
      await this.viewer.loadScene(document.value, this.assetResolver);
    });
  }

  applyPatch(patch: ScenePatch): Promise<void> {
    return this.enqueue(async () => {
      if (!this.viewer) throw new Error('Viewport adapter is not mounted.');
      await this.viewer.applyScenePatch(patch);
    });
  }

  bindSession(session: ProjectSession): () => void {
    const onDocument = (event: Event) => {
      const detail = (event as CustomEvent<{ patch: ScenePatch }>).detail;
      if (detail.patch.length) {
        void this.applyPatch(detail.patch).catch((error) => {
          this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
        });
      }
    };
    const onSelection = (event: Event) =>
      this.select((event as CustomEvent<{ nodeIds: string[] }>).detail.nodeIds);
    const onViewportSelection = (event: Event) =>
      session.selection.select(
        (event as CustomEvent<{ nodeIds: string[] }>).detail.nodeIds,
      );
    const onTransformChange = (event: Event) => {
      const detail = (event as CustomEvent<TransformChangeDetail>).detail;
      session.commands.execute({
        id: 'viewport-gizmo-transform',
        label: `Gizmo ${this.tool}`,
        mergeKey: detail.mergeKey,
        patch(document) {
          return detail.changes.flatMap((change) => {
            const nodeIndex = document.nodes.findIndex(
              (node) => node.id === change.nodeId,
            );
            if (nodeIndex < 0) return [];
            return [
              {
                op: 'replace' as const,
                path: `/nodes/${nodeIndex}/transform/${change.property}/${change.axis}`,
                value: change.value,
              },
            ];
          });
        },
      });
    };

    session.document.addEventListener('change', onDocument);
    session.selection.addEventListener('change', onSelection);
    this.addEventListener('selection', onViewportSelection);
    this.addEventListener('transform-change', onTransformChange);

    return () => {
      session.document.removeEventListener('change', onDocument);
      session.selection.removeEventListener('change', onSelection);
      this.removeEventListener('selection', onViewportSelection);
      this.removeEventListener('transform-change', onTransformChange);
    };
  }

  select(nodeIds: string[]): void {
    this.selected = [...nodeIds];
    this.canvas?.toggleAttribute('data-has-selection', nodeIds.length > 0);
    this.updateGizmo();
    this.dispatchEvent(
      new CustomEvent('overlay-change', {
        detail: {
          nodeIds,
          tool: this.tool,
          coordinateSpace: this.coordinateSpace,
          snap: this.snap,
        },
      }),
    );
  }

  frame(nodeIds: string[]): void {
    if (nodeIds[0]) this.viewer?.frameNode(nodeIds[0]);
  }

  setTool(tool: EditorTool): void {
    this.tool = tool;
    this.updateGizmo();
    this.dispatchEvent(new CustomEvent('tool', { detail: { tool } }));
  }

  setCoordinateSpace(space: CoordinateSpace): void {
    this.coordinateSpace = space;
    if (this.gizmo) this.gizmo.dataset.space = space;
    this.dispatchEvent(
      new CustomEvent('tool', { detail: { coordinateSpace: space } }),
    );
  }

  setSnap(settings: SnapSettings): void {
    this.snap = structuredClone(settings);
    if (this.gizmo) this.gizmo.dataset.snap = String(settings.enabled);
    this.dispatchEvent(new CustomEvent('tool', { detail: { snap: this.snap } }));
  }

  getCapabilities(): ViewerCapabilityDescription | null {
    return this.viewer?.getCapabilities() ?? null;
  }

  setAnimationState(animation: AnimationState): void {
    this.viewer?.setAnimationState(animation);
  }

  getAnimationState():
    | (AnimationState & { duration: number; availableClips: string[] })
    | null {
    return this.viewer?.getAnimationState() ?? null;
  }

  loadEnvironmentAsset(assetId?: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.viewer || !this.document) {
        throw new Error('Viewport adapter is not mounted.');
      }
      if (!assetId) {
        await this.viewer.restoreStudioEnvironment();
        return;
      }
      const asset = this.document.value.assets[assetId];
      if (!asset || asset.kind !== 'environment') {
        throw new Error(`Environment asset is missing: ${assetId}`);
      }
      await this.viewer.loadEnvironment(await this.assetResolver.resolve(asset));
    });
  }

  resetCamera(): void {
    this.viewer?.resetCamera();
  }

  setQualityPreset(name: QualityPresetName | 'ultra'): void {
    this.viewer?.setQualityPreset(name === 'ultra' ? 'cinematic' : name);
  }

  async captureThumbnail(): Promise<Blob> {
    await this.operationQueue;
    if (!this.viewer) throw new Error('Viewport adapter is not mounted.');
    let timeoutId = 0;
    try {
      return await Promise.race([
        this.viewer.capture({ mimeType: 'image/png', scale: 1 }),
        new Promise<never>((_resolve, reject) => {
          timeoutId = window.setTimeout(
            () => reject(new Error('Viewport thumbnail capture timed out.')),
            10_000,
          );
        }),
      ]);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  dispose(): void {
    this.generation += 1;
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.onGizmoPointerMove);
      window.removeEventListener('pointerup', this.onGizmoPointerUp);
    }
    this.gizmo?.removeEventListener('pointerdown', this.onGizmoPointerDown);
    this.gizmo?.remove();
    this.gizmo = null;
    this.drag = null;
    this.viewer?.dispose();
    this.viewer = null;
    this.canvas = null;
    this.document = null;
    this.operationQueue = Promise.resolve();
  }

  private mountGizmo(canvas: HTMLCanvasElement): void {
    const parent = canvas.parentElement;
    if (!parent) return;
    const gizmo = document.createElement('div');
    gizmo.className = 'kyxos-transform-gizmo';
    gizmo.setAttribute('aria-label', 'Transform gizmo');
    gizmo.innerHTML = [
      '<button type="button" data-axis="x" aria-label="Transform X">X</button>',
      '<button type="button" data-axis="y" aria-label="Transform Y">Y</button>',
      '<button type="button" data-axis="z" aria-label="Transform Z">Z</button>',
    ].join('');
    Object.assign(gizmo.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      display: 'none',
      gap: '4px',
      padding: '5px',
      border: '1px solid rgba(255,255,255,.16)',
      borderRadius: '8px',
      background: 'rgba(10,14,20,.82)',
      backdropFilter: 'blur(8px)',
      transform: 'translate(-50%, -50%)',
      zIndex: '4',
      pointerEvents: 'auto',
      userSelect: 'none',
    });
    for (const control of gizmo.querySelectorAll<HTMLButtonElement>('button')) {
      Object.assign(control.style, {
        width: '28px',
        height: '28px',
        padding: '0',
        borderRadius: '50%',
        fontWeight: '800',
        cursor: 'grab',
      });
      const axis = control.dataset.axis;
      control.style.color =
        axis === 'x' ? '#ff7b86' : axis === 'y' ? '#72e59b' : '#77a9ff';
    }
    gizmo.addEventListener('pointerdown', this.onGizmoPointerDown);
    parent.append(gizmo);
    this.gizmo = gizmo;
    this.updateGizmo();
  }

  private updateGizmo(): void {
    if (!this.gizmo) return;
    const visible = this.tool !== 'select' && this.selected.length > 0;
    this.gizmo.style.display = visible ? 'flex' : 'none';
    this.gizmo.dataset.tool = this.tool;
    this.gizmo.dataset.space = this.coordinateSpace;
    this.gizmo.dataset.snap = String(this.snap.enabled);
    this.gizmo.title = visible
      ? `${this.tool} · ${this.coordinateSpace}${this.snap.enabled ? ' · snap' : ''}`
      : '';
  }

  private applySnap(
    property: 'position' | 'rotation' | 'scale',
    value: number,
  ): number {
    if (!this.snap.enabled) return value;
    const step =
      property === 'position'
        ? this.snap.translation
        : property === 'rotation'
          ? (this.snap.rotation * Math.PI) / 180
          : this.snap.scale;
    return step > 0 ? Math.round(value / step) * step : value;
  }
}
