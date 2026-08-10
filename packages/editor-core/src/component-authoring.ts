import type {
  AssetKind,
  KyxosSceneContract,
  SceneNode,
  ScenePatch,
  Vec2,
  Vec3,
  Vec4,
} from '@kyxos/scene-contract';

export type SceneAuthoringComponentType =
  | 'render'
  | 'sprite-renderer'
  | 'audio-listener'
  | 'audio-source'
  | 'particle-system'
  | 'script'
  | 'screen'
  | 'element'
  | 'button'
  | 'scrollbar'
  | 'scroll-view'
  | 'layout-group'
  | 'layout-child'
  | 'zone'
  | 'gsplat';

export interface RenderAuthoringComponent {
  enabled: boolean;
  meshAssetId?: string;
  materialSlots: string[];
  castShadows: boolean;
  receiveShadows: boolean;
  lightmapped: boolean;
  static: boolean;
}

export interface SpriteRendererAuthoringComponent {
  enabled: boolean;
  assetId?: string;
  frame: string;
  color: Vec4;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
  drawMode: 'simple' | 'sliced' | 'tiled';
  width: number;
  height: number;
  pixelsPerUnit: number;
}

export interface AudioListenerAuthoringComponent {
  enabled: boolean;
}

export interface AudioSourceAuthoringComponent {
  enabled: boolean;
  assetId?: string;
  volume: number;
  pitch: number;
  loop: boolean;
  autoplay: boolean;
  positional: boolean;
  distanceModel: 'linear' | 'inverse' | 'exponential';
  refDistance: number;
  maxDistance: number;
  rollOffFactor: number;
}

export interface ParticleSystemAuthoringComponent {
  enabled: boolean;
  maxParticles: number;
  lifetime: number;
  rate: number;
  startSpeed: number;
  startSize: number;
  startColor: Vec4;
  gravity: Vec3;
  localSpace: boolean;
  looping: boolean;
  prewarm: boolean;
  blendMode: 'normal' | 'additive' | 'multiply' | 'premultiplied';
  sortMode: 'none' | 'distance' | 'newer-first' | 'older-first';
  textureAssetId?: string;
  meshAssetId?: string;
  emitter: {
    shape: 'point' | 'sphere' | 'hemisphere' | 'box' | 'cone';
    radius: number;
    angle: number;
    size: Vec3;
  };
}

export interface ScriptEntry {
  id: string;
  name: string;
  assetId: string;
  enabled: boolean;
  attributes: Record<string, unknown>;
}

export interface ScriptAuthoringComponent {
  enabled: boolean;
  scripts: ScriptEntry[];
  executionOrder: string[];
}

export interface ScreenAuthoringComponent {
  enabled: boolean;
  screenSpace: boolean;
  resolution: Vec2;
  scaleMode: 'none' | 'blend' | 'fixed-width' | 'fixed-height';
  referenceResolution: Vec2;
  scaleBlend: number;
  priority: number;
}

export interface ElementAuthoringComponent {
  enabled: boolean;
  type: 'group' | 'image' | 'text';
  anchor: Vec4;
  pivot: Vec2;
  width: number;
  height: number;
  color: Vec4;
  opacity: number;
  textureAssetId?: string;
  spriteAssetId?: string;
  fontAssetId?: string;
  text: string;
  fontSize: number;
  alignment: Vec2;
  wrapLines: boolean;
  autoWidth: boolean;
  autoHeight: boolean;
  useInput: boolean;
}

export interface ButtonAuthoringComponent {
  enabled: boolean;
  active: boolean;
  transitionMode: 'none' | 'tint' | 'sprite';
  targetNodeId?: string;
  hoverTint: Vec4;
  pressedTint: Vec4;
  inactiveTint: Vec4;
  fadeDuration: number;
  hoverSpriteAssetId?: string;
  pressedSpriteAssetId?: string;
  inactiveSpriteAssetId?: string;
}

export interface ScrollbarAuthoringComponent {
  enabled: boolean;
  orientation: 'horizontal' | 'vertical';
  value: number;
  handleSize: number;
  handleNodeId?: string;
}

export interface ScrollViewAuthoringComponent {
  enabled: boolean;
  horizontal: boolean;
  vertical: boolean;
  bounce: boolean;
  friction: number;
  dragThreshold: number;
  viewportNodeId?: string;
  contentNodeId?: string;
  horizontalScrollbarNodeId?: string;
  verticalScrollbarNodeId?: string;
}

export interface LayoutGroupAuthoringComponent {
  enabled: boolean;
  orientation: 'horizontal' | 'vertical' | 'grid';
  reverseX: boolean;
  reverseY: boolean;
  alignment: Vec2;
  padding: Vec4;
  spacing: Vec2;
  widthFitting: 'none' | 'stretch' | 'shrink' | 'both';
  heightFitting: 'none' | 'stretch' | 'shrink' | 'both';
  wrap: boolean;
}

export interface LayoutChildAuthoringComponent {
  enabled: boolean;
  excludeFromLayout: boolean;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  preferredWidth: number;
  preferredHeight: number;
  fitWidthProportion: number;
  fitHeightProportion: number;
}

export interface ZoneAuthoringComponent {
  enabled: boolean;
  size: Vec3;
}

export interface GsplatAuthoringComponent {
  enabled: boolean;
  assetId?: string;
  materialAssetId?: string;
  sort: boolean;
  lod: number;
  pointScale: number;
  shBands: 0 | 1 | 2 | 3;
}

export interface SceneAuthoringComponentMap {
  render: RenderAuthoringComponent;
  'sprite-renderer': SpriteRendererAuthoringComponent;
  'audio-listener': AudioListenerAuthoringComponent;
  'audio-source': AudioSourceAuthoringComponent;
  'particle-system': ParticleSystemAuthoringComponent;
  script: ScriptAuthoringComponent;
  screen: ScreenAuthoringComponent;
  element: ElementAuthoringComponent;
  button: ButtonAuthoringComponent;
  scrollbar: ScrollbarAuthoringComponent;
  'scroll-view': ScrollViewAuthoringComponent;
  'layout-group': LayoutGroupAuthoringComponent;
  'layout-child': LayoutChildAuthoringComponent;
  zone: ZoneAuthoringComponent;
  gsplat: GsplatAuthoringComponent;
}

export type SceneAuthoringComponents = Partial<SceneAuthoringComponentMap>;

declare module '@kyxos/scene-contract' {
  interface SceneNode {
    authoringComponents?: SceneAuthoringComponents;
  }
}

export type ComponentFieldType =
  | 'boolean'
  | 'number'
  | 'string'
  | 'text'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'color'
  | 'enum'
  | 'asset'
  | 'node'
  | 'string-array'
  | 'object';

export interface ComponentFieldSchema {
  path: string;
  label: string;
  type: ComponentFieldType;
  min?: number;
  max?: number;
  step?: number;
  enumValues?: string[];
  assetKinds?: AssetKind[];
  optional?: boolean;
  advanced?: boolean;
  visibleWhen?: { path: string; equals: unknown };
}

export interface ComponentDescriptor<K extends SceneAuthoringComponentType = SceneAuthoringComponentType> {
  type: K;
  label: string;
  category: 'Rendering' | 'Audio' | 'Effects' | 'Scripting' | 'UI' | 'World';
  icon: string;
  requires: SceneAuthoringComponentType[];
  conflicts: SceneAuthoringComponentType[];
  fields: ComponentFieldSchema[];
  createDefault(): SceneAuthoringComponentMap[K];
}

export interface ComponentValidationIssue {
  code:
    | 'component.unknown'
    | 'component.required-missing'
    | 'component.conflict'
    | 'component.value-invalid'
    | 'component.asset-missing'
    | 'component.asset-kind'
    | 'component.node-missing'
    | 'component.node-type'
    | 'component.script-duplicate'
    | 'component.script-order'
    | 'component.listener-duplicate';
  severity: 'error' | 'warning';
  path: string;
  message: string;
  nodeId: string;
  component: SceneAuthoringComponentType | string;
  field?: string;
}

export interface ComponentClipboard {
  version: 1;
  components: SceneAuthoringComponents;
  copiedAt: string;
}

export type ComponentPasteMode = 'merge' | 'replace';

export interface ComponentCommandHost {
  getScene(): KyxosSceneContract;
  execute(
    label: string,
    patch: (scene: KyxosSceneContract) => ScenePatch,
    mergeKey?: string,
  ): void;
}

export interface MixedComponentValue<T = unknown> {
  mixed: boolean;
  value?: T;
  values: T[];
  missingNodes: string[];
}

const ZERO2: Vec2 = { x: 0, y: 0 };
const HALF2: Vec2 = { x: 0.5, y: 0.5 };
const ZERO3: Vec3 = { x: 0, y: 0, z: 0 };
const ONE3: Vec3 = { x: 1, y: 1, z: 1 };
const WHITE: Vec4 = { x: 1, y: 1, z: 1, w: 1 };
const TRANSPARENT_WHITE: Vec4 = { x: 1, y: 1, z: 1, w: 0.5 };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function componentPath(index: number): string {
  return `/nodes/${index}/authoringComponents`;
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.').filter(Boolean)) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function writePath<T>(value: T, path: string, nextValue: unknown): T {
  const copy = clone(value);
  const segments = path.split('.').filter(Boolean);
  if (!segments.length) return clone(nextValue) as T;
  let current = copy as unknown as Record<string, unknown>;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      if (nextValue === undefined) delete current[segment];
      else current[segment] = clone(nextValue);
      return;
    }
    if (!isRecord(current[segment])) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  });
  return copy;
}

function createDescriptors(): ComponentDescriptor[] {
  return [
    {
      type: 'render', label: 'Render', category: 'Rendering', icon: 'cube', requires: [], conflicts: [],
      fields: [
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
        { path: 'meshAssetId', label: 'Mesh', type: 'asset', assetKinds: ['model'], optional: true },
        { path: 'materialSlots', label: 'Materials', type: 'string-array' },
        { path: 'castShadows', label: 'Cast Shadows', type: 'boolean' },
        { path: 'receiveShadows', label: 'Receive Shadows', type: 'boolean' },
        { path: 'lightmapped', label: 'Lightmapped', type: 'boolean' },
        { path: 'static', label: 'Static', type: 'boolean' },
      ],
      createDefault: () => ({ enabled: true, materialSlots: [], castShadows: true, receiveShadows: true, lightmapped: false, static: false }),
    },
    {
      type: 'sprite-renderer', label: 'Sprite Renderer', category: 'Rendering', icon: 'image', requires: [], conflicts: [],
      fields: [
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
        { path: 'assetId', label: 'Sprite', type: 'asset', assetKinds: ['texture', 'other'], optional: true },
        { path: 'frame', label: 'Frame', type: 'string' },
        { path: 'color', label: 'Color', type: 'color' },
        { path: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.01 },
        { path: 'drawMode', label: 'Draw Mode', type: 'enum', enumValues: ['simple', 'sliced', 'tiled'] },
        { path: 'width', label: 'Width', type: 'number', min: 0.001, max: 100000 },
        { path: 'height', label: 'Height', type: 'number', min: 0.001, max: 100000 },
        { path: 'pixelsPerUnit', label: 'Pixels Per Unit', type: 'number', min: 0.001, max: 100000 },
      ],
      createDefault: () => ({ enabled: true, frame: '', color: clone(WHITE), opacity: 1, flipX: false, flipY: false, drawMode: 'simple', width: 1, height: 1, pixelsPerUnit: 100 }),
    },
    {
      type: 'audio-listener', label: 'Audio Listener', category: 'Audio', icon: 'ear', requires: [], conflicts: [],
      fields: [{ path: 'enabled', label: 'Enabled', type: 'boolean' }],
      createDefault: () => ({ enabled: true }),
    },
    {
      type: 'audio-source', label: 'Audio Source', category: 'Audio', icon: 'volume', requires: [], conflicts: [],
      fields: [
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
        { path: 'assetId', label: 'Audio Clip', type: 'asset', assetKinds: ['other'], optional: true },
        { path: 'volume', label: 'Volume', type: 'number', min: 0, max: 1, step: 0.01 },
        { path: 'pitch', label: 'Pitch', type: 'number', min: 0.01, max: 4, step: 0.01 },
        { path: 'loop', label: 'Loop', type: 'boolean' },
        { path: 'autoplay', label: 'Autoplay', type: 'boolean' },
        { path: 'positional', label: 'Positional', type: 'boolean' },
        { path: 'distanceModel', label: 'Distance Model', type: 'enum', enumValues: ['linear', 'inverse', 'exponential'], visibleWhen: { path: 'positional', equals: true } },
        { path: 'refDistance', label: 'Reference Distance', type: 'number', min: 0.001, max: 100000, visibleWhen: { path: 'positional', equals: true } },
        { path: 'maxDistance', label: 'Maximum Distance', type: 'number', min: 0.001, max: 100000, visibleWhen: { path: 'positional', equals: true } },
        { path: 'rollOffFactor', label: 'Rolloff', type: 'number', min: 0, max: 100, visibleWhen: { path: 'positional', equals: true } },
      ],
      createDefault: () => ({ enabled: true, volume: 1, pitch: 1, loop: false, autoplay: false, positional: true, distanceModel: 'inverse', refDistance: 1, maxDistance: 10000, rollOffFactor: 1 }),
    },
    {
      type: 'particle-system', label: 'Particle System', category: 'Effects', icon: 'sparkles', requires: [], conflicts: [],
      fields: [
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
        { path: 'maxParticles', label: 'Max Particles', type: 'number', min: 1, max: 1000000, step: 1 },
        { path: 'lifetime', label: 'Lifetime', type: 'number', min: 0.001, max: 100000 },
        { path: 'rate', label: 'Rate', type: 'number', min: 0, max: 1000000 },
        { path: 'startSpeed', label: 'Start Speed', type: 'number', min: -100000, max: 100000 },
        { path: 'startSize', label: 'Start Size', type: 'number', min: 0, max: 100000 },
        { path: 'startColor', label: 'Start Color', type: 'color' },
        { path: 'gravity', label: 'Gravity', type: 'vec3' },
        { path: 'localSpace', label: 'Local Space', type: 'boolean' },
        { path: 'looping', label: 'Looping', type: 'boolean' },
        { path: 'prewarm', label: 'Prewarm', type: 'boolean' },
        { path: 'blendMode', label: 'Blend', type: 'enum', enumValues: ['normal', 'additive', 'multiply', 'premultiplied'] },
        { path: 'sortMode', label: 'Sorting', type: 'enum', enumValues: ['none', 'distance', 'newer-first', 'older-first'] },
        { path: 'textureAssetId', label: 'Texture', type: 'asset', assetKinds: ['texture'], optional: true },
        { path: 'meshAssetId', label: 'Mesh', type: 'asset', assetKinds: ['model'], optional: true },
        { path: 'emitter.shape', label: 'Emitter Shape', type: 'enum', enumValues: ['point', 'sphere', 'hemisphere', 'box', 'cone'] },
        { path: 'emitter.radius', label: 'Emitter Radius', type: 'number', min: 0, max: 100000 },
        { path: 'emitter.angle', label: 'Emitter Angle', type: 'number', min: 0, max: 180 },
        { path: 'emitter.size', label: 'Emitter Size', type: 'vec3' },
      ],
      createDefault: () => ({ enabled: true, maxParticles: 1000, lifetime: 5, rate: 10, startSpeed: 1, startSize: 1, startColor: clone(WHITE), gravity: clone(ZERO3), localSpace: false, looping: true, prewarm: false, blendMode: 'normal', sortMode: 'none', emitter: { shape: 'point', radius: 1, angle: 25, size: clone(ONE3) } }),
    },
    {
      type: 'script', label: 'Script', category: 'Scripting', icon: 'code', requires: [], conflicts: [],
      fields: [
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
        { path: 'scripts', label: 'Scripts', type: 'object' },
        { path: 'executionOrder', label: 'Execution Order', type: 'string-array' },
      ],
      createDefault: () => ({ enabled: true, scripts: [], executionOrder: [] }),
    },
    {
      type: 'screen', label: 'Screen', category: 'UI', icon: 'monitor', requires: [], conflicts: [],
      fields: [
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
        { path: 'screenSpace', label: 'Screen Space', type: 'boolean' },
        { path: 'resolution', label: 'Resolution', type: 'vec2' },
        { path: 'scaleMode', label: 'Scale Mode', type: 'enum', enumValues: ['none', 'blend', 'fixed-width', 'fixed-height'] },
        { path: 'referenceResolution', label: 'Reference Resolution', type: 'vec2' },
        { path: 'scaleBlend', label: 'Scale Blend', type: 'number', min: 0, max: 1, step: 0.01 },
        { path: 'priority', label: 'Priority', type: 'number', min: -32768, max: 32767, step: 1 },
      ],
      createDefault: () => ({ enabled: true, screenSpace: true, resolution: { x: 1280, y: 720 }, scaleMode: 'blend', referenceResolution: { x: 1280, y: 720 }, scaleBlend: 0.5, priority: 0 }),
    },
    {
      type: 'element', label: 'Element', category: 'UI', icon: 'square', requires: [], conflicts: [],
      fields: [
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
        { path: 'type', label: 'Type', type: 'enum', enumValues: ['group', 'image', 'text'] },
        { path: 'anchor', label: 'Anchor', type: 'vec4' },
        { path: 'pivot', label: 'Pivot', type: 'vec2' },
        { path: 'width', label: 'Width', type: 'number', min: 0, max: 100000 },
        { path: 'height', label: 'Height', type: 'number', min: 0, max: 100000 },
        { path: 'color', label: 'Color', type: 'color' },
        { path: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.01 },
        { path: 'textureAssetId', label: 'Texture', type: 'asset', assetKinds: ['texture'], optional: true, visibleWhen: { path: 'type', equals: 'image' } },
        { path: 'spriteAssetId', label: 'Sprite', type: 'asset', assetKinds: ['texture', 'other'], optional: true, visibleWhen: { path: 'type', equals: 'image' } },
        { path: 'fontAssetId', label: 'Font', type: 'asset', assetKinds: ['other'], optional: true, visibleWhen: { path: 'type', equals: 'text' } },
        { path: 'text', label: 'Text', type: 'text', visibleWhen: { path: 'type', equals: 'text' } },
        { path: 'fontSize', label: 'Font Size', type: 'number', min: 1, max: 10000, visibleWhen: { path: 'type', equals: 'text' } },
        { path: 'alignment', label: 'Alignment', type: 'vec2', visibleWhen: { path: 'type', equals: 'text' } },
      ],
      createDefault: () => ({ enabled: true, type: 'group', anchor: { x: 0.5, y: 0.5, z: 0.5, w: 0.5 }, pivot: clone(HALF2), width: 100, height: 100, color: clone(WHITE), opacity: 1, text: '', fontSize: 32, alignment: clone(HALF2), wrapLines: true, autoWidth: false, autoHeight: false, useInput: false }),
    },
    {
      type: 'button', label: 'Button', category: 'UI', icon: 'mouse-pointer', requires: ['element'], conflicts: [],
      fields: [
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
        { path: 'active', label: 'Active', type: 'boolean' },
        { path: 'transitionMode', label: 'Transition', type: 'enum', enumValues: ['none', 'tint', 'sprite'] },
        { path: 'targetNodeId', label: 'Target', type: 'node', optional: true },
        { path: 'hoverTint', label: 'Hover Tint', type: 'color', visibleWhen: { path: 'transitionMode', equals: 'tint' } },
        { path: 'pressedTint', label: 'Pressed Tint', type: 'color', visibleWhen: { path: 'transitionMode', equals: 'tint' } },
        { path: 'inactiveTint', label: 'Inactive Tint', type: 'color', visibleWhen: { path: 'transitionMode', equals: 'tint' } },
        { path: 'fadeDuration', label: 'Fade Duration', type: 'number', min: 0, max: 100 },
        { path: 'hoverSpriteAssetId', label: 'Hover Sprite', type: 'asset', assetKinds: ['texture', 'other'], optional: true, visibleWhen: { path: 'transitionMode', equals: 'sprite' } },
        { path: 'pressedSpriteAssetId', label: 'Pressed Sprite', type: 'asset', assetKinds: ['texture', 'other'], optional: true, visibleWhen: { path: 'transitionMode', equals: 'sprite' } },
        { path: 'inactiveSpriteAssetId', label: 'Inactive Sprite', type: 'asset', assetKinds: ['texture', 'other'], optional: true, visibleWhen: { path: 'transitionMode', equals: 'sprite' } },
      ],
      createDefault: () => ({ enabled: true, active: true, transitionMode: 'tint', hoverTint: clone(TRANSPARENT_WHITE), pressedTint: { x: 0.75, y: 0.75, z: 0.75, w: 1 }, inactiveTint: { x: 0.5, y: 0.5, z: 0.5, w: 0.5 }, fadeDuration: 0.1 }),
    },
    {
      type: 'scrollbar', label: 'Scrollbar', category: 'UI', icon: 'sliders', requires: ['element'], conflicts: [],
      fields: [
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
        { path: 'orientation', label: 'Orientation', type: 'enum', enumValues: ['horizontal', 'vertical'] },
        { path: 'value', label: 'Value', type: 'number', min: 0, max: 1, step: 0.001 },
        { path: 'handleSize', label: 'Handle Size', type: 'number', min: 0, max: 1, step: 0.001 },
        { path: 'handleNodeId', label: 'Handle', type: 'node', optional: true },
      ],
      createDefault: () => ({ enabled: true, orientation: 'horizontal', value: 0, handleSize: 0.5 }),
    },
    {
      type: 'scroll-view', label: 'Scroll View', category: 'UI', icon: 'scroll', requires: ['element'], conflicts: [],
      fields: [
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
        { path: 'horizontal', label: 'Horizontal', type: 'boolean' },
        { path: 'vertical', label: 'Vertical', type: 'boolean' },
        { path: 'bounce', label: 'Bounce', type: 'boolean' },
        { path: 'friction', label: 'Friction', type: 'number', min: 0, max: 1, step: 0.001 },
        { path: 'dragThreshold', label: 'Drag Threshold', type: 'number', min: 0, max: 10000 },
        { path: 'viewportNodeId', label: 'Viewport', type: 'node', optional: true },
        { path: 'contentNodeId', label: 'Content', type: 'node', optional: true },
        { path: 'horizontalScrollbarNodeId', label: 'Horizontal Scrollbar', type: 'node', optional: true },
        { path: 'verticalScrollbarNodeId', label: 'Vertical Scrollbar', type: 'node', optional: true },
      ],
      createDefault: () => ({ enabled: true, horizontal: true, vertical: true, bounce: true, friction: 0.05, dragThreshold: 10 }),
    },
    {
      type: 'layout-group', label: 'Layout Group', category: 'UI', icon: 'layout', requires: ['element'], conflicts: [],
      fields: [
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
        { path: 'orientation', label: 'Orientation', type: 'enum', enumValues: ['horizontal', 'vertical', 'grid'] },
        { path: 'alignment', label: 'Alignment', type: 'vec2' },
        { path: 'padding', label: 'Padding', type: 'vec4' },
        { path: 'spacing', label: 'Spacing', type: 'vec2' },
        { path: 'widthFitting', label: 'Width Fitting', type: 'enum', enumValues: ['none', 'stretch', 'shrink', 'both'] },
        { path: 'heightFitting', label: 'Height Fitting', type: 'enum', enumValues: ['none', 'stretch', 'shrink', 'both'] },
        { path: 'wrap', label: 'Wrap', type: 'boolean' },
      ],
      createDefault: () => ({ enabled: true, orientation: 'horizontal', reverseX: false, reverseY: false, alignment: clone(HALF2), padding: { x: 0, y: 0, z: 0, w: 0 }, spacing: clone(ZERO2), widthFitting: 'none', heightFitting: 'none', wrap: false }),
    },
    {
      type: 'layout-child', label: 'Layout Child', category: 'UI', icon: 'panel', requires: ['element'], conflicts: [],
      fields: [
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
        { path: 'excludeFromLayout', label: 'Exclude', type: 'boolean' },
        { path: 'minWidth', label: 'Min Width', type: 'number', min: 0, max: 100000 },
        { path: 'minHeight', label: 'Min Height', type: 'number', min: 0, max: 100000 },
        { path: 'maxWidth', label: 'Max Width', type: 'number', min: 0, max: 100000 },
        { path: 'maxHeight', label: 'Max Height', type: 'number', min: 0, max: 100000 },
        { path: 'preferredWidth', label: 'Preferred Width', type: 'number', min: 0, max: 100000 },
        { path: 'preferredHeight', label: 'Preferred Height', type: 'number', min: 0, max: 100000 },
        { path: 'fitWidthProportion', label: 'Width Proportion', type: 'number', min: 0, max: 100000 },
        { path: 'fitHeightProportion', label: 'Height Proportion', type: 'number', min: 0, max: 100000 },
      ],
      createDefault: () => ({ enabled: true, excludeFromLayout: false, minWidth: 0, minHeight: 0, maxWidth: 100000, maxHeight: 100000, preferredWidth: 100, preferredHeight: 100, fitWidthProportion: 1, fitHeightProportion: 1 }),
    },
    {
      type: 'zone', label: 'Zone', category: 'World', icon: 'box-select', requires: [], conflicts: [],
      fields: [
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
        { path: 'size', label: 'Size', type: 'vec3' },
      ],
      createDefault: () => ({ enabled: true, size: clone(ONE3) }),
    },
    {
      type: 'gsplat', label: 'Gaussian Splat', category: 'Rendering', icon: 'cloud', requires: [], conflicts: ['render', 'sprite-renderer'],
      fields: [
        { path: 'enabled', label: 'Enabled', type: 'boolean' },
        { path: 'assetId', label: 'GSplat Asset', type: 'asset', assetKinds: ['model', 'other'], optional: true },
        { path: 'materialAssetId', label: 'Material', type: 'asset', assetKinds: ['material'], optional: true },
        { path: 'sort', label: 'Sort', type: 'boolean' },
        { path: 'lod', label: 'LOD', type: 'number', min: 0, max: 1, step: 0.01 },
        { path: 'pointScale', label: 'Point Scale', type: 'number', min: 0.001, max: 1000 },
        { path: 'shBands', label: 'SH Bands', type: 'enum', enumValues: ['0', '1', '2', '3'] },
      ],
      createDefault: () => ({ enabled: true, sort: true, lod: 1, pointScale: 1, shBands: 3 }),
    },
  ];
}

export class ComponentRegistry {
  private readonly descriptors = new Map<SceneAuthoringComponentType, ComponentDescriptor>();

  constructor(descriptors: Iterable<ComponentDescriptor> = createDescriptors()) {
    for (const descriptor of descriptors) this.register(descriptor);
  }

  register<K extends SceneAuthoringComponentType>(descriptor: ComponentDescriptor<K>): () => void {
    if (this.descriptors.has(descriptor.type)) throw new Error(`Component ${descriptor.type} is already registered.`);
    this.descriptors.set(descriptor.type, clone(descriptor) as ComponentDescriptor);
    return () => this.descriptors.delete(descriptor.type);
  }

  get<K extends SceneAuthoringComponentType>(type: K): ComponentDescriptor<K> {
    const descriptor = this.descriptors.get(type);
    if (!descriptor) throw new Error(`Unknown component ${type}.`);
    return descriptor as ComponentDescriptor<K>;
  }

  has(type: string): type is SceneAuthoringComponentType {
    return this.descriptors.has(type as SceneAuthoringComponentType);
  }

  list(category?: ComponentDescriptor['category']): ComponentDescriptor[] {
    return [...this.descriptors.values()]
      .filter((descriptor) => !category || descriptor.category === category)
      .sort((left, right) => left.category.localeCompare(right.category) || left.label.localeCompare(right.label))
      .map(clone);
  }

  create<K extends SceneAuthoringComponentType>(type: K): SceneAuthoringComponentMap[K] {
    return clone(this.get(type).createDefault());
  }
}

export const defaultComponentRegistry = new ComponentRegistry();

function validateVector(value: unknown, dimensions: number): boolean {
  if (!isRecord(value)) return false;
  return ['x', 'y', 'z', 'w'].slice(0, dimensions).every((key) => finite(value[key]));
}

function validateField(
  scene: KyxosSceneContract,
  node: SceneNode,
  nodeIndex: number,
  componentType: SceneAuthoringComponentType,
  component: unknown,
  field: ComponentFieldSchema,
  issues: ComponentValidationIssue[],
): void {
  const value = readPath(component, field.path);
  const path = `${componentPath(nodeIndex)}/${escapePointer(componentType)}/${field.path.replace(/\./g, '/')}`;
  if (value == null && field.optional) return;
  let valid = true;
  switch (field.type) {
    case 'boolean': valid = typeof value === 'boolean'; break;
    case 'number': valid = finite(value) && (field.min == null || value >= field.min) && (field.max == null || value <= field.max); break;
    case 'string':
    case 'text': valid = typeof value === 'string'; break;
    case 'vec2': valid = validateVector(value, 2); break;
    case 'vec3': valid = validateVector(value, 3); break;
    case 'vec4':
    case 'color': valid = validateVector(value, 4); break;
    case 'enum': valid = field.enumValues?.includes(String(value)) ?? false; break;
    case 'string-array': valid = Array.isArray(value) && value.every((entry) => typeof entry === 'string'); break;
    case 'object': valid = isRecord(value) || Array.isArray(value); break;
    case 'asset': {
      valid = value == null || typeof value === 'string';
      if (typeof value === 'string') {
        const asset = scene.assets[value];
        if (!asset) issues.push({ code: 'component.asset-missing', severity: 'error', path, message: `Asset ${value} does not exist.`, nodeId: node.id, component: componentType, field: field.path });
        else if (field.assetKinds?.length && !field.assetKinds.includes(asset.kind)) issues.push({ code: 'component.asset-kind', severity: 'error', path, message: `Asset ${value} has kind ${asset.kind}; expected ${field.assetKinds.join(', ')}.`, nodeId: node.id, component: componentType, field: field.path });
      }
      break;
    }
    case 'node': {
      valid = value == null || typeof value === 'string';
      if (typeof value === 'string' && !scene.nodes.some((entry) => entry.id === value)) issues.push({ code: 'component.node-missing', severity: 'error', path, message: `Node ${value} does not exist.`, nodeId: node.id, component: componentType, field: field.path });
      break;
    }
  }
  if (!valid) issues.push({ code: 'component.value-invalid', severity: 'error', path, message: `${field.label} is invalid.`, nodeId: node.id, component: componentType, field: field.path });
}

function validateComponentSpecific(
  scene: KyxosSceneContract,
  node: SceneNode,
  nodeIndex: number,
  type: SceneAuthoringComponentType,
  component: SceneAuthoringComponentMap[SceneAuthoringComponentType],
  issues: ComponentValidationIssue[],
): void {
  const basePath = `${componentPath(nodeIndex)}/${escapePointer(type)}`;
  if (type === 'script') {
    const script = component as ScriptAuthoringComponent;
    const ids = new Set<string>();
    for (const [index, entry] of script.scripts.entries()) {
      if (!entry.id || ids.has(entry.id)) issues.push({ code: 'component.script-duplicate', severity: 'error', path: `${basePath}/scripts/${index}/id`, message: 'Script entry IDs must be unique.', nodeId: node.id, component: type });
      ids.add(entry.id);
      const asset = scene.assets[entry.assetId];
      if (!asset) issues.push({ code: 'component.asset-missing', severity: 'error', path: `${basePath}/scripts/${index}/assetId`, message: `Script asset ${entry.assetId} does not exist.`, nodeId: node.id, component: type });
      else if (asset.kind !== 'script') issues.push({ code: 'component.asset-kind', severity: 'error', path: `${basePath}/scripts/${index}/assetId`, message: 'Script entries must reference script assets.', nodeId: node.id, component: type });
    }
    if (script.executionOrder.length !== new Set(script.executionOrder).size || script.executionOrder.some((id) => !ids.has(id))) issues.push({ code: 'component.script-order', severity: 'error', path: `${basePath}/executionOrder`, message: 'Script execution order must contain unique existing script IDs.', nodeId: node.id, component: type });
  }
  if (type === 'scroll-view') {
    const scrollView = component as ScrollViewAuthoringComponent;
    for (const [field, requiredComponent] of [
      ['viewportNodeId', 'element'],
      ['contentNodeId', 'element'],
      ['horizontalScrollbarNodeId', 'scrollbar'],
      ['verticalScrollbarNodeId', 'scrollbar'],
    ] as const) {
      const targetId = scrollView[field];
      if (!targetId) continue;
      const target = scene.nodes.find((entry) => entry.id === targetId);
      if (target && !target.authoringComponents?.[requiredComponent]) issues.push({ code: 'component.node-type', severity: 'warning', path: `${basePath}/${field}`, message: `${field} should reference a node with ${requiredComponent}.`, nodeId: node.id, component: type, field });
    }
  }
  if (type === 'scrollbar') {
    const scrollbar = component as ScrollbarAuthoringComponent;
    const target = scrollbar.handleNodeId ? scene.nodes.find((entry) => entry.id === scrollbar.handleNodeId) : undefined;
    if (target && !target.authoringComponents?.element) issues.push({ code: 'component.node-type', severity: 'warning', path: `${basePath}/handleNodeId`, message: 'Scrollbar handle should reference an Element node.', nodeId: node.id, component: type, field: 'handleNodeId' });
  }
}

export function validateAuthoringComponents(
  scene: KyxosSceneContract,
  registry: ComponentRegistry = defaultComponentRegistry,
): ComponentValidationIssue[] {
  const issues: ComponentValidationIssue[] = [];
  const listeners: string[] = [];
  scene.nodes.forEach((node, nodeIndex) => {
    const components = node.authoringComponents;
    if (!components) return;
    for (const [rawType, rawComponent] of Object.entries(components)) {
      if (!registry.has(rawType)) {
        issues.push({ code: 'component.unknown', severity: 'error', path: `${componentPath(nodeIndex)}/${escapePointer(rawType)}`, message: `Unknown component ${rawType}.`, nodeId: node.id, component: rawType });
        continue;
      }
      const type = rawType;
      const descriptor = registry.get(type);
      for (const required of descriptor.requires) if (!components[required]) issues.push({ code: 'component.required-missing', severity: 'error', path: `${componentPath(nodeIndex)}/${escapePointer(type)}`, message: `${descriptor.label} requires ${registry.get(required).label}.`, nodeId: node.id, component: type });
      for (const conflict of descriptor.conflicts) if (components[conflict]) issues.push({ code: 'component.conflict', severity: 'error', path: `${componentPath(nodeIndex)}/${escapePointer(type)}`, message: `${descriptor.label} conflicts with ${registry.get(conflict).label}.`, nodeId: node.id, component: type });
      for (const field of descriptor.fields) validateField(scene, node, nodeIndex, type, rawComponent, field, issues);
      validateComponentSpecific(scene, node, nodeIndex, type, rawComponent as SceneAuthoringComponentMap[SceneAuthoringComponentType], issues);
      if (type === 'audio-listener' && (rawComponent as AudioListenerAuthoringComponent).enabled) listeners.push(node.id);
    }
  });
  if (listeners.length > 1) {
    for (const nodeId of listeners) {
      const index = scene.nodes.findIndex((node) => node.id === nodeId);
      issues.push({ code: 'component.listener-duplicate', severity: 'warning', path: `${componentPath(index)}/audio-listener`, message: 'More than one enabled Audio Listener exists.', nodeId, component: 'audio-listener' });
    }
  }
  return issues;
}

export function componentMixedValue<K extends SceneAuthoringComponentType>(
  scene: KyxosSceneContract,
  nodeIds: Iterable<string>,
  type: K,
  path: string,
): MixedComponentValue {
  const requested = [...new Set(nodeIds)];
  const nodes = requested.map((id) => scene.nodes.find((node) => node.id === id)).filter((node): node is SceneNode => Boolean(node));
  const missingNodes = nodes.filter((node) => !node.authoringComponents?.[type]).map((node) => node.id);
  const values = nodes
    .map((node) => node.authoringComponents?.[type])
    .filter((component): component is SceneAuthoringComponentMap[K] => Boolean(component))
    .map((component) => clone(readPath(component, path)));
  const first = values[0];
  const mixed = missingNodes.length > 0 || values.some((value) => !equal(value, first));
  return { mixed, value: mixed ? undefined : clone(first), values, missingNodes };
}

export function copyAuthoringComponents(
  node: SceneNode,
  types?: Iterable<SceneAuthoringComponentType>,
  now = new Date().toISOString(),
): ComponentClipboard {
  const selected = types ? new Set(types) : null;
  const components = Object.fromEntries(
    Object.entries(node.authoringComponents ?? {})
      .filter(([type]) => !selected || selected.has(type as SceneAuthoringComponentType))
      .map(([type, value]) => [type, clone(value)]),
  ) as SceneAuthoringComponents;
  return { version: 1, components, copiedAt: now };
}

export function normalizeComponentClipboard(value: unknown): ComponentClipboard {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.components) || typeof value.copiedAt !== 'string') throw new Error('Unsupported component clipboard payload.');
  return { version: 1, components: clone(value.components) as SceneAuthoringComponents, copiedAt: value.copiedAt };
}

function withRequirements(
  registry: ComponentRegistry,
  components: SceneAuthoringComponents,
  type: SceneAuthoringComponentType,
): SceneAuthoringComponents {
  const next = clone(components);
  const descriptor = registry.get(type);
  for (const required of descriptor.requires) if (!next[required]) next[required] = registry.create(required) as never;
  return next;
}

function assertNoConflicts(
  registry: ComponentRegistry,
  components: SceneAuthoringComponents,
  type: SceneAuthoringComponentType,
): void {
  const conflicts = registry.get(type).conflicts.filter((entry) => Boolean(components[entry]));
  if (conflicts.length) throw new Error(`${registry.get(type).label} conflicts with ${conflicts.map((entry) => registry.get(entry).label).join(', ')}.`);
}

function nodesPatch(
  scene: KyxosSceneContract,
  nodeIds: Set<string>,
  mutate: (node: SceneNode, index: number) => void,
): ScenePatch {
  const patch: ScenePatch = [];
  scene.nodes.forEach((node, index) => {
    if (!nodeIds.has(node.id)) return;
    const next = clone(node);
    mutate(next, index);
    patch.push({ op: 'replace', path: `/nodes/${index}`, value: next });
  });
  if (patch.length !== nodeIds.size) {
    const found = new Set(scene.nodes.filter((node) => nodeIds.has(node.id)).map((node) => node.id));
    throw new Error(`Nodes not found: ${[...nodeIds].filter((id) => !found.has(id)).join(', ')}`);
  }
  return patch;
}

export class ComponentAuthoringService extends EventTarget {
  private clipboard: ComponentClipboard | null = null;

  constructor(
    private readonly host: ComponentCommandHost,
    readonly registry: ComponentRegistry = defaultComponentRegistry,
  ) {
    super();
  }

  add<K extends SceneAuthoringComponentType>(
    nodeIds: Iterable<string>,
    type: K,
    initial?: Partial<SceneAuthoringComponentMap[K]>,
  ): void {
    const ids = new Set(nodeIds);
    this.host.execute(`Add ${this.registry.get(type).label}`, (scene) => nodesPatch(scene, ids, (node) => {
      let components = clone(node.authoringComponents ?? {});
      if (components[type]) throw new Error(`${node.name} already has ${this.registry.get(type).label}.`);
      assertNoConflicts(this.registry, components, type);
      components = withRequirements(this.registry, components, type);
      components[type] = { ...this.registry.create(type), ...(initial ? clone(initial) : {}) } as never;
      node.authoringComponents = components;
    }));
    this.emit('change', { type: 'component:add', nodeIds: [...ids], component: type });
  }

  remove(
    nodeIds: Iterable<string>,
    type: SceneAuthoringComponentType,
    options: { cascade?: boolean } = {},
  ): void {
    const ids = new Set(nodeIds);
    this.host.execute(`Remove ${this.registry.get(type).label}`, (scene) => nodesPatch(scene, ids, (node) => {
      const components = clone(node.authoringComponents ?? {});
      const dependents = Object.keys(components)
        .filter((candidate): candidate is SceneAuthoringComponentType => this.registry.has(candidate))
        .filter((candidate) => this.registry.get(candidate).requires.includes(type));
      if (dependents.length && !options.cascade) throw new Error(`${this.registry.get(type).label} is required by ${dependents.map((entry) => this.registry.get(entry).label).join(', ')}.`);
      for (const dependent of dependents) delete components[dependent];
      delete components[type];
      node.authoringComponents = Object.keys(components).length ? components : undefined;
    }));
    this.emit('change', { type: 'component:remove', nodeIds: [...ids], component: type });
  }

  set<K extends SceneAuthoringComponentType>(
    nodeIds: Iterable<string>,
    type: K,
    path: string,
    value: unknown,
  ): void {
    const ids = new Set(nodeIds);
    this.host.execute(`Edit ${this.registry.get(type).label}`, (scene) => nodesPatch(scene, ids, (node) => {
      const components = clone(node.authoringComponents ?? {});
      const component = components[type];
      if (!component) throw new Error(`${node.name} does not have ${this.registry.get(type).label}.`);
      components[type] = writePath(component, path, value) as never;
      node.authoringComponents = components;
    }), `component:${type}:${path}`);
    this.emit('change', { type: 'component:set', nodeIds: [...ids], component: type, path, value: clone(value) });
  }

  setEnabled(nodeIds: Iterable<string>, type: SceneAuthoringComponentType, enabled: boolean): void {
    this.set(nodeIds, type, 'enabled', Boolean(enabled));
  }

  copy(nodeId: string, types?: Iterable<SceneAuthoringComponentType>): ComponentClipboard {
    const node = this.host.getScene().nodes.find((entry) => entry.id === nodeId);
    if (!node) throw new Error('Node not found.');
    this.clipboard = copyAuthoringComponents(node, types);
    this.emit('change', { type: 'component:copy', nodeId, components: Object.keys(this.clipboard.components) });
    return clone(this.clipboard);
  }

  importClipboard(value: unknown): void {
    this.clipboard = normalizeComponentClipboard(value);
  }

  exportClipboard(): ComponentClipboard | null {
    return this.clipboard ? clone(this.clipboard) : null;
  }

  paste(
    nodeIds: Iterable<string>,
    mode: ComponentPasteMode = 'merge',
    clipboard: ComponentClipboard | null = this.clipboard,
  ): void {
    if (!clipboard) throw new Error('Component clipboard is empty.');
    const payload = normalizeComponentClipboard(clipboard);
    const ids = new Set(nodeIds);
    this.host.execute('Paste Components', (scene) => nodesPatch(scene, ids, (node) => {
      let components: SceneAuthoringComponents = mode === 'replace' ? {} : clone(node.authoringComponents ?? {});
      for (const [rawType, component] of Object.entries(payload.components)) {
        if (!this.registry.has(rawType)) continue;
        assertNoConflicts(this.registry, components, rawType);
        components = withRequirements(this.registry, components, rawType);
        components[rawType] = clone(component) as never;
      }
      node.authoringComponents = Object.keys(components).length ? components : undefined;
    }));
    this.emit('change', { type: 'component:paste', nodeIds: [...ids], mode, components: Object.keys(payload.components) });
  }

  addScript(nodeIds: Iterable<string>, entry: ScriptEntry): void {
    const ids = new Set(nodeIds);
    this.host.execute('Add Script', (scene) => nodesPatch(scene, ids, (node) => {
      const components = clone(node.authoringComponents ?? {});
      const script = clone(components.script ?? this.registry.create('script'));
      if (script.scripts.some((candidate) => candidate.id === entry.id)) throw new Error(`Script entry ${entry.id} already exists.`);
      script.scripts.push(clone(entry));
      script.executionOrder.push(entry.id);
      components.script = script;
      node.authoringComponents = components;
    }));
    this.emit('change', { type: 'script:add', nodeIds: [...ids], scriptId: entry.id });
  }

  reorderScripts(nodeIds: Iterable<string>, order: string[]): void {
    const ids = new Set(nodeIds);
    this.host.execute('Reorder Scripts', (scene) => nodesPatch(scene, ids, (node) => {
      const components = clone(node.authoringComponents ?? {});
      const script = components.script;
      if (!script) throw new Error(`${node.name} does not have Script.`);
      const currentIds = script.scripts.map((entry) => entry.id);
      if (order.length !== currentIds.length || new Set(order).size !== order.length || order.some((id) => !currentIds.includes(id))) throw new Error('Script order must contain every script exactly once.');
      script.executionOrder = [...order];
      node.authoringComponents = components;
    }));
    this.emit('change', { type: 'script:reorder', nodeIds: [...ids], order: [...order] });
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail: clone(detail) }));
  }
}

export function summarizeAuthoringComponents(scene: KyxosSceneContract): Record<SceneAuthoringComponentType, number> {
  const result = Object.fromEntries(defaultComponentRegistry.list().map((descriptor) => [descriptor.type, 0])) as Record<SceneAuthoringComponentType, number>;
  for (const node of scene.nodes) {
    for (const type of Object.keys(node.authoringComponents ?? {})) if (defaultComponentRegistry.has(type)) result[type] += 1;
  }
  return result;
}
