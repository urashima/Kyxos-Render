import type {
  KyxosSceneContract,
  SceneNode,
  ScenePatch,
} from '@kyxos/scene-contract';

export interface MorphTargetRow {
  index: number;
  label: string;
  value: number;
  mixed: boolean;
  supportedNodeIds: string[];
}

export interface SkinJointSummary {
  skinIndex: number;
  jointCount: number;
  jointNames: string[];
  skeletonName?: string;
  inverseBindMatricesAccessor?: number;
}

export interface GltfNodeInspectorOptions {
  scene: KyxosSceneContract;
  nodes: SceneNode[];
  container: HTMLElement;
  canEdit: boolean;
  applyPatch(label: string, patch: ScenePatch, mergeKey?: string): void;
}

function finiteWeight(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-7;
}

export function morphTargetRows(nodes: SceneNode[]): MorphTargetRow[] {
  const targets = nodes.filter((node) => (node.morphWeights?.length ?? 0) > 0);
  const count = targets.reduce(
    (maximum, node) => Math.max(maximum, node.morphWeights?.length ?? 0),
    0,
  );
  const rows: MorphTargetRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const supported = targets.filter((node) => index < (node.morphWeights?.length ?? 0));
    if (!supported.length) continue;
    const values = supported.map((node) => finiteWeight(node.morphWeights?.[index]));
    const label = supported
      .map((node) => node.morphTargetNames?.[index])
      .find((value): value is string => Boolean(value?.trim()))
      ?? `Target ${index + 1}`;
    rows.push({
      index,
      label,
      value: values[0] ?? 0,
      mixed: values.some((value) => !sameNumber(value, values[0] ?? 0)),
      supportedNodeIds: supported.map((node) => node.id),
    });
  }
  return rows;
}

export function morphWeightPatch(
  scene: KyxosSceneContract,
  nodeIds: Iterable<string>,
  targetIndex: number,
  value: number,
): ScenePatch {
  if (!Number.isFinite(value)) throw new Error('Morph target weight must be finite.');
  const selected = new Set(nodeIds);
  return scene.nodes.flatMap((node, nodeIndex) => {
    if (!selected.has(node.id) || targetIndex >= (node.morphWeights?.length ?? 0)) return [];
    return [{
      op: 'replace' as const,
      path: `/nodes/${nodeIndex}/morphWeights/${targetIndex}`,
      value,
    }];
  });
}

export function resetMorphWeightsPatch(
  scene: KyxosSceneContract,
  nodeIds: Iterable<string>,
): ScenePatch {
  const selected = new Set(nodeIds);
  return scene.nodes.flatMap((node, nodeIndex) => {
    if (!selected.has(node.id) || !node.morphWeights?.length) return [];
    const source = node.metadata?.gltfMorphDefaultWeights;
    const defaults = Array.isArray(source)
      ? node.morphWeights.map((_, index) => finiteWeight(source[index]))
      : node.morphWeights.map(() => 0);
    return [{
      op: 'replace' as const,
      path: `/nodes/${nodeIndex}/morphWeights`,
      value: defaults,
    }];
  });
}

export function skinJointSummary(
  scene: KyxosSceneContract,
  node: SceneNode,
): SkinJointSummary | null {
  if (!node.skin) return null;
  const byId = new Map(scene.nodes.map((entry) => [entry.id, entry]));
  return {
    skinIndex: node.skin.skinIndex,
    jointCount: node.skin.joints.length,
    jointNames: node.skin.joints.map((id) => byId.get(id)?.name ?? id),
    skeletonName: node.skin.skeletonNodeId
      ? byId.get(node.skin.skeletonNodeId)?.name ?? node.skin.skeletonNodeId
      : undefined,
    inverseBindMatricesAccessor: node.skin.inverseBindMatricesAccessor,
  };
}

function section(title: string): HTMLElement {
  const root = document.createElement('section');
  root.className = 'inspector-section expanded gltf-node-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  root.append(heading);
  return root;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('label');
  row.className = 'inspector-field gltf-node-field';
  const name = document.createElement('span');
  name.textContent = label;
  row.append(name, control);
  return row;
}

function output(value: string): HTMLOutputElement {
  const element = document.createElement('output');
  element.textContent = value;
  return element;
}

function createMorphSlider(
  options: GltfNodeInspectorOptions,
  row: MorphTargetRow,
  number?: HTMLInputElement,
): HTMLInputElement {
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '-1';
  slider.max = '1';
  slider.step = '0.001';
  slider.value = String(row.value);
  slider.disabled = !options.canEdit;
  slider.setAttribute('aria-label', `${row.label} morph weight`);

  slider.addEventListener('input', () => {
    const value = Number(slider.value);
    if (!Number.isFinite(value)) return;
    if (number) number.value = String(value);
    options.applyPatch(
      `Morph target: ${row.label}`,
      morphWeightPatch(options.scene, row.supportedNodeIds, row.index, value),
      `morph:${row.supportedNodeIds.join(',')}:${row.index}`,
    );
  });
  return slider;
}

function resetMorphButton(options: GltfNodeInspectorOptions): HTMLButtonElement {
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'secondary mini gltf-node-section gltf-morph-reset';
  reset.textContent = 'Reset imported weights';
  reset.disabled = !options.canEdit;
  reset.addEventListener('click', () => options.applyPatch(
    'Reset morph targets',
    resetMorphWeightsPatch(options.scene, options.nodes.map((node) => node.id)),
  ));
  return reset;
}

function enhanceSchemaMorphTargets(
  options: GltfNodeInspectorOptions,
  rows: MorphTargetRow[],
): boolean {
  const root = options.container.querySelector<HTMLElement>(
    '[data-schema-section="morph-targets"]',
  );
  if (!root) return false;

  root.dataset.morphTargetCount = String(rows.length);
  const fields = Array.from(root.querySelectorAll<HTMLElement>('.schema-field'));
  for (const row of rows) {
    const schemaField = fields.find(
      (candidate) => candidate.querySelector('.schema-field-label')?.textContent?.trim() === row.label,
    );
    const value = schemaField?.querySelector<HTMLElement>('.schema-field-value');
    const number = value?.querySelector<HTMLInputElement>('input[type="number"]');
    if (!value || !number) continue;

    const slider = createMorphSlider(options, row, number);
    slider.className = 'gltf-node-section gltf-morph-slider';
    value.prepend(slider);
  }

  root.append(resetMorphButton(options));
  return true;
}

function renderStandaloneMorphTargets(
  options: GltfNodeInspectorOptions,
  rows: MorphTargetRow[],
): void {
  const root = section('Morph Targets');
  root.dataset.morphTargetCount = String(rows.length);

  for (const row of rows) {
    const controls = document.createElement('div');
    controls.className = 'morph-target-controls';
    const number = document.createElement('input');
    number.type = 'number';
    number.step = '0.001';
    number.value = row.mixed ? '' : String(row.value);
    number.placeholder = row.mixed ? '— Mixed —' : '';
    number.disabled = !options.canEdit;
    number.setAttribute('aria-label', `${row.label} morph value`);

    const slider = createMorphSlider(options, row, number);
    number.addEventListener('input', () => {
      const value = Number(number.value);
      if (!Number.isFinite(value)) return;
      slider.value = String(Math.max(-1, Math.min(1, value)));
      options.applyPatch(
        `Morph target: ${row.label}`,
        morphWeightPatch(options.scene, row.supportedNodeIds, row.index, value),
        `morph:${row.supportedNodeIds.join(',')}:${row.index}`,
      );
    });
    controls.append(slider, number);
    root.append(field(row.label, controls));
  }

  const reset = resetMorphButton(options);
  reset.classList.remove('gltf-node-section');
  root.append(reset);
  options.container.append(root);
}

function renderMorphTargets(options: GltfNodeInspectorOptions): void {
  const rows = morphTargetRows(options.nodes);
  if (!rows.length) return;
  if (!enhanceSchemaMorphTargets(options, rows)) {
    renderStandaloneMorphTargets(options, rows);
  }
}

function renderSkin(options: GltfNodeInspectorOptions): void {
  const skinned = options.nodes
    .map((node) => ({ node, summary: skinJointSummary(options.scene, node) }))
    .filter((entry): entry is { node: SceneNode; summary: SkinJointSummary } => Boolean(entry.summary));
  if (!skinned.length) return;
  const root = section('Skin / Joints');
  root.dataset.skinCount = String(skinned.length);
  for (const { node, summary } of skinned) {
    if (skinned.length > 1) root.append(field('Node', output(node.name)));
    root.append(
      field('Skin', output(String(summary.skinIndex))),
      field('Joints', output(`${summary.jointCount} · ${summary.jointNames.join(', ')}`)),
    );
    if (summary.skeletonName) root.append(field('Skeleton', output(summary.skeletonName)));
    if (summary.inverseBindMatricesAccessor != null) {
      root.append(field('Inverse Bind', output(`Accessor ${summary.inverseBindMatricesAccessor}`)));
    }
  }
  options.container.append(root);
}

export function mountGltfNodeInspector(options: GltfNodeInspectorOptions): void {
  renderMorphTargets(options);
  renderSkin(options);
}
