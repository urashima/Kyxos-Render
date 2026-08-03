import type {
  KyxosSceneContract,
  SceneMaterial,
  ScenePatch,
  ViewerCapabilityDescription,
} from '@kyxos/scene-contract';

export const MIXED_VALUE = Symbol('kyxos.inspector.mixed-value');

export type InspectorFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'color'
  | 'select'
  | 'asset'
  | 'entity'
  | 'readonly';

export interface InspectorContext {
  scene: KyxosSceneContract;
  nodeIds: string[];
}

export interface InspectorFieldSchema {
  id: string;
  label: string;
  type: InspectorFieldType;
  tooltip?: string;
  unit?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  assetKinds?: string[];
  defaultValue?: unknown;
  resolvePaths(context: InspectorContext): string[];
  validate?(value: unknown, context: InspectorContext): string | null;
  normalize?(value: unknown, context: InspectorContext): unknown;
  restoreValue?(context: InspectorContext, path: string): unknown;
}

export interface InspectorSectionSchema {
  id: string;
  title: string;
  order: number;
  visible?(context: InspectorContext): boolean;
  fields(context: InspectorContext): InspectorFieldSchema[];
}

export interface InspectorFieldValue {
  paths: string[];
  value: unknown | typeof MIXED_VALUE;
  mixed: boolean;
  overridden: boolean;
  validationError: string | null;
}

function decode(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function encode(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function at(root: unknown, path: string): unknown {
  let value: any = root;
  for (const segment of path.slice(1).split('/').filter(Boolean).map(decode)) {
    value = value?.[Array.isArray(value) ? Number(segment) : segment];
  }
  return value;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function selectedNodeIndexes(context: InspectorContext): number[] {
  const selected = new Set(context.nodeIds);
  return context.scene.nodes.flatMap((node, index) =>
    selected.has(node.id) ? [index] : [],
  );
}

function selectedMaterialIds(context: InspectorContext): string[] {
  const selected = new Set(context.nodeIds);
  return unique(
    context.scene.nodes
      .filter((node) => selected.has(node.id))
      .flatMap((node) => node.materialSlots ?? []),
  );
}

function selectedCameraIndexes(context: InspectorContext): number[] {
  const selected = new Set(context.nodeIds);
  const cameraIds = new Set(
    context.scene.nodes
      .filter((node) => selected.has(node.id) && node.cameraId)
      .map((node) => node.cameraId!),
  );
  if (!cameraIds.size) cameraIds.add(context.scene.activeCameraId);
  return context.scene.cameras.flatMap((camera, index) =>
    cameraIds.has(camera.id) ? [index] : [],
  );
}

function selectedLightIndexes(context: InspectorContext): number[] {
  const selected = new Set(context.nodeIds);
  const lightIds = new Set(
    context.scene.nodes
      .filter((node) => selected.has(node.id) && node.lightId)
      .map((node) => node.lightId!),
  );
  if (!lightIds.size && context.nodeIds.length === 0) {
    return (context.scene.lights ?? []).map((_, index) => index);
  }
  return (context.scene.lights ?? []).flatMap((light, index) =>
    lightIds.has(light.id) ? [index] : [],
  );
}

function pathsForNodes(suffix: string): (context: InspectorContext) => string[] {
  return (context) => selectedNodeIndexes(context).map((index) => `/nodes/${index}/${suffix}`);
}

function pathsForMaterials(suffix: string): (context: InspectorContext) => string[] {
  return (context) =>
    selectedMaterialIds(context).map((id) => `/materials/${encode(id)}/${suffix}`);
}

function pathsForMaterialTexture(
  property: keyof SceneMaterial,
  suffix: string,
): (context: InspectorContext) => string[] {
  return (context) => selectedMaterialIds(context).flatMap((id) => {
    const reference = context.scene.materials[id]?.[property];
    return reference && typeof reference === 'object'
      ? [`/materials/${encode(id)}/${String(property)}/${suffix}`]
      : [];
  });
}

function materialRestore(context: InspectorContext, path: string): unknown {
  const match = path.match(/^\/materials\/([^/]+)\/(.+)$/);
  if (!match) return undefined;
  const material = context.scene.materials[decode(match[1])];
  let value: any = material?.metadata?.original;
  for (const segment of match[2].split('/').map(decode)) value = value?.[segment];
  return value;
}

function numberField(
  id: string,
  label: string,
  resolvePaths: InspectorFieldSchema['resolvePaths'],
  options: Partial<InspectorFieldSchema> = {},
): InspectorFieldSchema {
  return {
    id,
    label,
    type: 'number',
    step: 0.01,
    resolvePaths,
    normalize(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return 0;
      return Math.max(
        options.minimum ?? -Infinity,
        Math.min(options.maximum ?? Infinity, number),
      );
    },
    validate(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return `${label} must be a finite number.`;
      if (options.minimum != null && number < options.minimum) {
        return `${label} must be at least ${options.minimum}.`;
      }
      if (options.maximum != null && number > options.maximum) {
        return `${label} must be at most ${options.maximum}.`;
      }
      return null;
    },
    ...options,
  };
}

export class InspectorSchemaRegistry extends EventTarget {
  private readonly sectionsById = new Map<string, InspectorSectionSchema>();

  register(section: InspectorSectionSchema): () => void {
    if (this.sectionsById.has(section.id)) {
      throw new Error(`Inspector section ${section.id} is already registered.`);
    }
    this.sectionsById.set(section.id, section);
    this.dispatchEvent(new CustomEvent('change', { detail: { id: section.id } }));
    return () => {
      this.sectionsById.delete(section.id);
      this.dispatchEvent(new CustomEvent('change', { detail: { id: section.id } }));
    };
  }

  sections(context: InspectorContext): InspectorSectionSchema[] {
    return [...this.sectionsById.values()]
      .filter((section) => section.visible?.(context) !== false)
      .sort((left, right) => left.order - right.order);
  }
}

export class SchemaInspectorModel {
  constructor(public readonly registry: InspectorSchemaRegistry) {}

  read(field: InspectorFieldSchema, context: InspectorContext): InspectorFieldValue {
    const paths = unique(field.resolvePaths(context));
    const values = paths.map((path) => at(context.scene, path));
    const first = values[0];
    const mixed = values.some((value) => !equal(value, first));
    const overridden = paths.some((path, index) => {
      const imported = field.restoreValue?.(context, path);
      return imported !== undefined && !equal(values[index], imported);
    });
    const value = mixed ? MIXED_VALUE : first;
    return {
      paths,
      value,
      mixed,
      overridden,
      validationError: mixed ? null : field.validate?.(value, context) ?? null,
    };
  }

  update(
    field: InspectorFieldSchema,
    context: InspectorContext,
    input: unknown,
  ): ScenePatch {
    const current = this.read(field, context);
    const error = field.validate?.(input, context);
    if (error) throw new Error(error);
    const value = field.normalize?.(input, context) ?? input;
    return current.paths.flatMap((path) => {
      const previous = at(context.scene, path);
      if (equal(previous, value)) return [];
      return [
        {
          op: previous === undefined ? ('add' as const) : ('replace' as const),
          path,
          value: structuredClone(value),
        },
      ];
    });
  }

  reset(field: InspectorFieldSchema, context: InspectorContext): ScenePatch {
    return field.defaultValue === undefined
      ? this.clear(field, context)
      : this.update(field, context, structuredClone(field.defaultValue));
  }

  clear(field: InspectorFieldSchema, context: InspectorContext): ScenePatch {
    return unique(field.resolvePaths(context)).flatMap((path) =>
      at(context.scene, path) === undefined
        ? []
        : [{ op: 'remove' as const, path }],
    );
  }

  restore(field: InspectorFieldSchema, context: InspectorContext): ScenePatch {
    return unique(field.resolvePaths(context)).flatMap((path) => {
      const imported = field.restoreValue?.(context, path);
      if (imported === undefined || equal(imported, at(context.scene, path))) return [];
      return [{ op: 'replace' as const, path, value: structuredClone(imported) }];
    });
  }
}

export function createDefaultInspectorRegistry(
  capabilities?: ViewerCapabilityDescription | null,
): InspectorSchemaRegistry {
  const registry = new InspectorSchemaRegistry();

  registry.register({
    id: 'node',
    title: 'Node',
    order: 10,
    visible: (context) => context.nodeIds.length > 0,
    fields: () => [
      {
        id: 'node.name',
        label: 'Name',
        type: 'string',
        tooltip: 'The authoring name stored in the Scene Contract.',
        resolvePaths: pathsForNodes('name'),
        defaultValue: 'Node',
        validate: (value) =>
          typeof value === 'string' && value.trim() ? null : 'Name is required.',
        normalize: (value) => String(value).trim(),
      },
      {
        id: 'node.parent',
        label: 'Parent',
        type: 'entity',
        tooltip: 'Select another entity as the hierarchy parent.',
        resolvePaths: pathsForNodes('parentId'),
        defaultValue: null,
      },
      {
        id: 'node.visible',
        label: 'Visible',
        type: 'boolean',
        resolvePaths: pathsForNodes('visible'),
        defaultValue: true,
      },
      {
        id: 'node.locked',
        label: 'Locked',
        type: 'boolean',
        resolvePaths: pathsForNodes('locked'),
        defaultValue: false,
      },
    ],
  });

  registry.register({
    id: 'transform',
    title: 'Transform',
    order: 20,
    visible: (context) => context.nodeIds.length > 0,
    fields: () =>
      (['position', 'rotation', 'scale'] as const).flatMap((property) =>
        (['x', 'y', 'z'] as const).map((axis) =>
          numberField(
            `transform.${property}.${axis}`,
            `${property[0].toUpperCase()}${axis.toUpperCase()}`,
            pathsForNodes(`transform/${property}/${axis}`),
            {
              step: property === 'rotation' ? 0.01 : 0.1,
              unit: property === 'rotation' ? 'rad' : property === 'position' ? 'm' : undefined,
              defaultValue: property === 'scale' ? 1 : 0,
            },
          ),
        ),
      ),
  });

  registry.register({
    id: 'morph-targets',
    title: 'Morph Targets',
    order: 30,
    visible: (context) =>
      selectedNodeIndexes(context).some(
        (index) => (context.scene.nodes[index].morphWeights?.length ?? 0) > 0,
      ),
    fields: (context) => {
      const count = Math.max(
        0,
        ...selectedNodeIndexes(context).map(
          (index) => context.scene.nodes[index].morphWeights?.length ?? 0,
        ),
      );
      return Array.from({ length: count }, (_, index) =>
        numberField(
          `morph.${index}`,
          context.scene.nodes[selectedNodeIndexes(context)[0]]?.morphTargetNames?.[index] ??
            `Target ${index + 1}`,
          (current) =>
            selectedNodeIndexes(current).flatMap((nodeIndex) =>
              (current.scene.nodes[nodeIndex].morphWeights?.length ?? 0) > index
                ? [`/nodes/${nodeIndex}/morphWeights/${index}`]
                : [],
            ),
          { minimum: 0, maximum: 1, step: 0.01, defaultValue: 0 },
        ),
      );
    },
  });

  registry.register({
    id: 'material',
    title: 'Material',
    order: 40,
    visible: (context) => selectedMaterialIds(context).length > 0,
    fields: () => {
      const fields: InspectorFieldSchema[] = [
        {
          id: 'material.name',
          label: 'Name',
          type: 'string',
          resolvePaths: pathsForMaterials('name'),
          defaultValue: 'Material',
          restoreValue: materialRestore,
        },
        {
          id: 'material.baseColor',
          label: 'Base Color',
          type: 'color',
          resolvePaths: pathsForMaterials('baseColor'),
          defaultValue: { x: 1, y: 1, z: 1, w: 1 },
          restoreValue: materialRestore,
        },
        ...(['metalness', 'roughness', 'opacity', 'clearcoat', 'clearcoatRoughness', 'transmission', 'sheenRoughness', 'specularIntensity'] as const).map(
          (property) =>
            numberField(
              `material.${property}`,
              property.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase()),
              pathsForMaterials(property),
              {
                minimum: 0,
                maximum: 1,
                step: 0.01,
                defaultValue:
                  property === 'roughness' || property === 'opacity' ? 1 : 0,
                restoreValue: materialRestore,
              },
            ),
        ),
        numberField('material.normalScale', 'Normal Scale', pathsForMaterials('normalScale'), {
          minimum: 0,
          maximum: 4,
          step: 0.01,
          defaultValue: 1,
          restoreValue: materialRestore,
        }),
        numberField('material.ior', 'IOR', pathsForMaterials('ior'), {
          minimum: 1,
          maximum: 2.333,
          step: 0.001,
          defaultValue: 1.5,
          restoreValue: materialRestore,
        }),
        numberField('material.thickness', 'Thickness', pathsForMaterials('thickness'), {
          minimum: 0,
          maximum: 100,
          step: 0.01,
          unit: 'm',
          defaultValue: 0,
          restoreValue: materialRestore,
        }),
        {
          id: 'material.alphaMode',
          label: 'Alpha Mode',
          type: 'select',
          options: [
            { value: 'opaque', label: 'Opaque' },
            { value: 'mask', label: 'Mask' },
            { value: 'blend', label: 'Blend' },
          ],
          resolvePaths: pathsForMaterials('alphaMode'),
          defaultValue: 'opaque',
          restoreValue: materialRestore,
        },
        {
          id: 'material.doubleSided',
          label: 'Double Sided',
          type: 'boolean',
          resolvePaths: pathsForMaterials('doubleSided'),
          defaultValue: false,
          restoreValue: materialRestore,
        },
      ];
      for (const property of [
        'baseColorTexture',
        'normalTexture',
        'roughnessTexture',
        'metalnessTexture',
        'emissiveTexture',
        'aoTexture',
        'clearcoatTexture',
        'transmissionTexture',
        'thicknessTexture',
      ]) {
        fields.push({
          id: `material.${property}`,
          label: property.replace(/Texture$/, '').replace(/([A-Z])/g, ' $1'),
          type: 'asset',
          assetKinds: ['texture'],
          tooltip: 'Typed texture picker; drag a texture asset here or choose one.',
          resolvePaths: pathsForMaterials(property),
          defaultValue: undefined,
          restoreValue: materialRestore,
        });
        const textureLabel = property
          .replace(/Texture$/, '')
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (value) => value.toUpperCase());
        fields.push(
          numberField(
            `material.${property}.texCoord`,
            `${textureLabel} UV Set`,
            pathsForMaterialTexture(property as keyof SceneMaterial, 'texCoord'),
            {
              minimum: 0,
              maximum: 7,
              step: 1,
              defaultValue: 0,
              normalize: (value) => Math.max(0, Math.min(7, Math.round(Number(value)))),
              restoreValue: materialRestore,
            },
          ),
          {
            id: `material.${property}.colorSpace`,
            label: `${textureLabel} Color Space`,
            type: 'select',
            options: [
              { value: 'srgb', label: 'sRGB' },
              { value: 'linear', label: 'Linear' },
              { value: 'none', label: 'Data / None' },
            ],
            resolvePaths: pathsForMaterialTexture(property as keyof SceneMaterial, 'colorSpace'),
            defaultValue: /baseColor|emissive/i.test(property) ? 'srgb' : 'linear',
            restoreValue: materialRestore,
          },
          {
            id: `material.${property}.channel`,
            label: `${textureLabel} Channel`,
            type: 'select',
            options: ['r', 'g', 'b', 'a', 'rgb', 'rgba'].map((value) => ({ value, label: value.toUpperCase() })),
            resolvePaths: pathsForMaterialTexture(property as keyof SceneMaterial, 'channel'),
            defaultValue: /baseColor|normal|emissive/i.test(property) ? 'rgb' : 'r',
            restoreValue: materialRestore,
          },
          ...(['x', 'y'] as const).map((axis) =>
            numberField(
              `material.${property}.offset.${axis}`,
              `${textureLabel} Offset ${axis.toUpperCase()}`,
              pathsForMaterialTexture(property as keyof SceneMaterial, `offset/${axis}`),
              { step: 0.01, defaultValue: 0, restoreValue: materialRestore },
            ),
          ),
          ...(['x', 'y'] as const).map((axis) =>
            numberField(
              `material.${property}.scale.${axis}`,
              `${textureLabel} Tiling ${axis.toUpperCase()}`,
              pathsForMaterialTexture(property as keyof SceneMaterial, `scale/${axis}`),
              { step: 0.01, defaultValue: 1, restoreValue: materialRestore },
            ),
          ),
          numberField(
            `material.${property}.rotation`,
            `${textureLabel} Rotation`,
            pathsForMaterialTexture(property as keyof SceneMaterial, 'rotation'),
            { step: 0.01, unit: 'rad', defaultValue: 0, restoreValue: materialRestore },
          ),
          ...(['wrapS', 'wrapT'] as const).map((axis) => ({
            id: `material.${property}.${axis}`,
            label: `${textureLabel} ${axis === 'wrapS' ? 'Wrap U' : 'Wrap V'}`,
            type: 'select' as const,
            options: [
              { value: 'repeat', label: 'Repeat' },
              { value: 'clamp', label: 'Clamp' },
              { value: 'mirror', label: 'Mirror' },
            ],
            resolvePaths: pathsForMaterialTexture(property as keyof SceneMaterial, axis),
            defaultValue: 'repeat',
            restoreValue: materialRestore,
          })),
          {
            id: `material.${property}.minFilter`,
            label: `${textureLabel} Min Filter`,
            type: 'select',
            options: [
              ['nearest', 'Nearest'],
              ['linear', 'Linear'],
              ['nearestMipNearest', 'Nearest Mipmap Nearest'],
              ['linearMipNearest', 'Linear Mipmap Nearest'],
              ['nearestMipLinear', 'Nearest Mipmap Linear'],
              ['linearMipLinear', 'Linear Mipmap Linear'],
            ].map(([value, label]) => ({ value, label })),
            resolvePaths: pathsForMaterialTexture(property as keyof SceneMaterial, 'minFilter'),
            defaultValue: 'linearMipLinear',
            restoreValue: materialRestore,
          },
          {
            id: `material.${property}.magFilter`,
            label: `${textureLabel} Mag Filter`,
            type: 'select',
            options: [
              { value: 'nearest', label: 'Nearest' },
              { value: 'linear', label: 'Linear' },
            ],
            resolvePaths: pathsForMaterialTexture(property as keyof SceneMaterial, 'magFilter'),
            defaultValue: 'linear',
            restoreValue: materialRestore,
          },
        );
      }
      return fields;
    },
  });

  registry.register({
    id: 'camera',
    title: 'Camera',
    order: 50,
    visible: (context) => selectedCameraIndexes(context).length > 0,
    fields: () => [
      {
        id: 'camera.projection',
        label: 'Projection',
        type: 'select',
        options: [
          { value: 'perspective', label: 'Perspective' },
          { value: 'orthographic', label: 'Orthographic' },
        ],
        resolvePaths: (context) =>
          selectedCameraIndexes(context).map((index) => `/cameras/${index}/projection`),
        defaultValue: 'perspective',
      },
      ...[
        ['fov', 'FOV', 1, 179, 1, 'deg'],
        ['near', 'Near', 0.001, 100, 0.01, 'm'],
        ['far', 'Far', 0.01, 100000, 1, 'm'],
        ['orthographicSize', 'Ortho Size', 0.001, 100000, 0.1, 'm'],
      ].map(([property, label, minimum, maximum, step, unit]) =>
        numberField(
          `camera.${property}`,
          String(label),
          (context) =>
            selectedCameraIndexes(context).map((index) => `/cameras/${index}/${property}`),
          {
            minimum: Number(minimum),
            maximum: Number(maximum),
            step: Number(step),
            unit: String(unit),
            defaultValue: property === 'fov' ? 45 : property === 'near' ? 0.01 : property === 'far' ? 1000 : 5,
          },
        ),
      ),
    ],
  });

  registry.register({
    id: 'light',
    title: 'Light',
    order: 60,
    visible: (context) => selectedLightIndexes(context).length > 0,
    fields: () => [
      {
        id: 'light.type',
        label: 'Type',
        type: 'select',
        options: ['directional', 'point', 'spot', 'ambient'].map((value) => ({
          value,
          label: value.replace(/^./, (entry) => entry.toUpperCase()),
        })),
        resolvePaths: (context) =>
          selectedLightIndexes(context).map((index) => `/lights/${index}/type`),
        defaultValue: 'directional',
      },
      {
        id: 'light.color',
        label: 'Color',
        type: 'color',
        resolvePaths: (context) =>
          selectedLightIndexes(context).map((index) => `/lights/${index}/color`),
        defaultValue: '#ffffff',
      },
      ...[
        ['intensity', 'Intensity', 0, 100000, 0.05],
        ['range', 'Range', 0, 100000, 0.1],
        ['decay', 'Decay', 0, 10, 0.01],
        ['innerConeAngle', 'Inner Cone', 0, Math.PI / 2, 0.01],
        ['outerConeAngle', 'Outer Cone', 0, Math.PI / 2, 0.01],
      ].map(([property, label, minimum, maximum, step]) =>
        numberField(
          `light.${property}`,
          String(label),
          (context) =>
            selectedLightIndexes(context).map((index) => `/lights/${index}/${property}`),
          {
            minimum: Number(minimum),
            maximum: Number(maximum),
            step: Number(step),
            defaultValue: property === 'intensity' ? 1 : property === 'decay' ? 2 : 0,
          },
        ),
      ),
      {
        id: 'light.castShadow',
        label: 'Cast Shadow',
        type: 'boolean',
        resolvePaths: (context) =>
          selectedLightIndexes(context).map((index) => `/lights/${index}/castShadow`),
        defaultValue: false,
      },
    ],
  });

  registry.register({
    id: 'environment',
    title: 'Environment',
    order: 70,
    fields: () => [
      {
        id: 'environment.asset',
        label: 'Environment',
        type: 'asset',
        assetKinds: ['environment'],
        resolvePaths: () => ['/environment/assetId'],
        defaultValue: undefined,
      },
      numberField('environment.rotation', 'Rotation', () => ['/environment/rotation'], {
        step: 0.01,
        unit: 'rad',
        defaultValue: 0,
      }),
      numberField('environment.intensity', 'Intensity', () => ['/environment/intensity'], {
        minimum: 0,
        maximum: 20,
        defaultValue: 1,
      }),
      numberField('environment.backgroundIntensity', 'Background', () => ['/environment/backgroundIntensity'], {
        minimum: 0,
        maximum: 20,
        defaultValue: 1,
      }),
      numberField('environment.backgroundBlur', 'Blur', () => ['/environment/backgroundBlur'], {
        minimum: 0,
        maximum: 1,
        defaultValue: 0,
      }),
      {
        id: 'environment.backgroundColor',
        label: 'Background Color',
        type: 'color',
        resolvePaths: () => ['/environment/backgroundColor'],
        defaultValue: '#111827',
      },
      {
        id: 'environment.transparent',
        label: 'Transparent',
        type: 'boolean',
        resolvePaths: () => ['/environment/transparentBackground'],
        defaultValue: false,
      },
    ],
  });

  registry.register({
    id: 'render',
    title: 'Render Settings',
    order: 80,
    fields: () => {
      const fields: InspectorFieldSchema[] = [
        {
          id: 'render.backend',
          label: 'Backend',
          type: 'select',
          options: ['auto', 'webgpu', 'webgl2'].map((value) => ({ value, label: value })),
          resolvePaths: () => ['/renderSettings/backend'],
          defaultValue: 'auto',
        },
        {
          id: 'render.quality',
          label: 'Quality',
          type: 'select',
          options: ['low', 'medium', 'high', 'cinematic', 'ultra', 'capture'].map(
            (value) => ({ value, label: value }),
          ),
          resolvePaths: () => ['/renderSettings/qualityPreset'],
          defaultValue: 'high',
        },
        numberField('render.exposure', 'Exposure', () => ['/renderSettings/exposure'], {
          minimum: 0,
          maximum: 20,
          step: 0.01,
          defaultValue: 1,
        }),
      ];
      for (const [effect, capability] of Object.entries(capabilities?.effects ?? {})) {
        fields.push({
          id: `effect.${effect}.enabled`,
          label: `${effect} Enabled`,
          type: 'boolean',
          tooltip: capability.available
            ? `Enable ${effect}.`
            : capability.reason ?? `${effect} is unavailable on this backend.`,
          resolvePaths: () => [`/renderSettings/effects/${encode(effect)}/enabled`],
          defaultValue: Boolean(capability.parameters?.enabled),
        });
        for (const [parameter, value] of Object.entries(capability.parameters ?? {})) {
          if (parameter === 'enabled') continue;
          if (typeof value === 'number') {
            fields.push(
              numberField(
                `effect.${effect}.${parameter}`,
                `${effect} ${parameter}`,
                () => [
                  `/renderSettings/effects/${encode(effect)}/${encode(parameter)}`,
                ],
                { step: 0.01, defaultValue: value },
              ),
            );
          } else if (typeof value === 'boolean') {
            fields.push({
              id: `effect.${effect}.${parameter}`,
              label: `${effect} ${parameter}`,
              type: 'boolean',
              resolvePaths: () => [
                `/renderSettings/effects/${encode(effect)}/${encode(parameter)}`,
              ],
              defaultValue: value,
            });
          }
        }
      }
      return fields;
    },
  });

  return registry;
}

export function materialOverridePaths(material: SceneMaterial): string[] {
  const original = material.metadata?.original;
  if (!original || typeof original !== 'object') return [];
  return Object.keys(material)
    .filter((key) => key !== 'metadata')
    .filter(
      (key) =>
        !equal(
          material[key as keyof SceneMaterial],
          (original as Record<string, unknown>)[key],
        ),
    );
}
