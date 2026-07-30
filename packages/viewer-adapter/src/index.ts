import type { ProjectSession, SceneDocument } from '@kyxos/editor-core';
import type { AssetResolver, ScenePatch } from '@kyxos/scene-contract';
import { KyxosViewer } from '@kyxos/viewer';

export interface SnapSettings { translation: number; rotation: number; scale: number; enabled: boolean }
export type EditorTool = 'select' | 'translate' | 'rotate' | 'scale';
export interface KyxosViewportAdapter {
  mount(canvas: HTMLCanvasElement): Promise<void>;
  loadDocument(document: SceneDocument): Promise<void>;
  applyPatch(patch: ScenePatch): Promise<void>;
  select(nodeIds: string[]): void;
  frame(nodeIds: string[]): void;
  setTool(tool: EditorTool): void;
  setCoordinateSpace(space: 'local' | 'world'): void;
  setSnap(settings: SnapSettings): void;
  captureThumbnail(): Promise<Blob>;
  dispose(): void;
}

export class BrowserKyxosViewportAdapter extends EventTarget implements KyxosViewportAdapter {
  private viewer: KyxosViewer | null = null; private canvas: HTMLCanvasElement | null = null; private document: SceneDocument | null = null;
  private selected: string[] = []; private tool: EditorTool = 'select'; private coordinateSpace: 'local' | 'world' = 'local';
  private snap: SnapSettings = { translation: 0.1, rotation: 15, scale: 0.1, enabled: false };
  private readonly onPointerDown = (event: PointerEvent) => {
    if (!this.viewer || !this.canvas) return;
    const hit = this.viewer.pick(event.clientX, event.clientY); this.selected = hit ? [hit.nodeId] : [];
    this.dispatchEvent(new CustomEvent('selection', { detail: { nodeIds: [...this.selected], hit } }));
  };
  constructor(private readonly assetResolver: AssetResolver, private readonly createOptions: { backend?: 'auto' | 'webgpu' | 'webgl2'; quality?: 'low' | 'medium' | 'high' | 'ultra' | 'capture' } = {}) { super() }
  async mount(canvas: HTMLCanvasElement): Promise<void> {
    this.dispose(); this.canvas = canvas; this.viewer = await KyxosViewer.create({ canvas, backend: this.createOptions.backend ?? 'auto', quality: this.createOptions.quality ?? 'high' });
    canvas.addEventListener('pointerdown', this.onPointerDown); this.dispatchEvent(new CustomEvent('ready', { detail: this.viewer.getCapabilities() }));
  }
  async loadDocument(document: SceneDocument): Promise<void> { if (!this.viewer) throw new Error('Viewport adapter is not mounted.'); this.document = document; await this.viewer.loadScene(document.value, this.assetResolver) }
  async applyPatch(patch: ScenePatch): Promise<void> { if (!this.viewer) throw new Error('Viewport adapter is not mounted.'); await this.viewer.applyScenePatch(patch) }
  bindSession(session: ProjectSession): () => void {
    const onDocument = (event: Event) => { const detail = (event as CustomEvent<{ patch: ScenePatch }>).detail; if (detail.patch.length) void this.applyPatch(detail.patch) };
    const onSelection = (event: Event) => this.select((event as CustomEvent<{ nodeIds: string[] }>).detail.nodeIds);
    const onViewportSelection = (event: Event) => session.selection.select((event as CustomEvent<{ nodeIds: string[] }>).detail.nodeIds);
    session.document.addEventListener('change', onDocument); session.selection.addEventListener('change', onSelection); this.addEventListener('selection', onViewportSelection);
    return () => { session.document.removeEventListener('change', onDocument); session.selection.removeEventListener('change', onSelection); this.removeEventListener('selection', onViewportSelection) };
  }
  select(nodeIds: string[]): void { this.selected = [...nodeIds]; this.canvas?.toggleAttribute('data-has-selection', nodeIds.length > 0); this.dispatchEvent(new CustomEvent('overlay-change', { detail: { nodeIds, tool: this.tool, coordinateSpace: this.coordinateSpace, snap: this.snap } })) }
  frame(nodeIds: string[]): void { if (nodeIds[0]) this.viewer?.frameNode(nodeIds[0]) }
  setTool(tool: EditorTool): void { this.tool = tool; this.dispatchEvent(new CustomEvent('tool', { detail: { tool } })) }
  setCoordinateSpace(space: 'local' | 'world'): void { this.coordinateSpace = space; this.dispatchEvent(new CustomEvent('tool', { detail: { coordinateSpace: space } })) }
  setSnap(settings: SnapSettings): void { this.snap = structuredClone(settings); this.dispatchEvent(new CustomEvent('tool', { detail: { snap: this.snap } })) }
  async captureThumbnail(): Promise<Blob> { if (!this.viewer) throw new Error('Viewport adapter is not mounted.'); return this.viewer.capture({ mimeType: 'image/png', scale: 1 }) }
  getViewer(): KyxosViewer | null { return this.viewer }
  dispose(): void { if (this.canvas) this.canvas.removeEventListener('pointerdown', this.onPointerDown); this.viewer?.dispose(); this.viewer = null; this.canvas = null; this.document = null }
}
