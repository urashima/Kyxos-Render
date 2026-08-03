import {
  InspectorSchemaRegistry,
  type InspectorContext,
  type InspectorFieldSchema,
  type InspectorSectionSchema,
} from '@kyxos/editor-core';
import type { SceneMaterial, TextureRef, Vec3 } from '@kyxos/scene-contract';

interface InspectorRegistryPrototype {
  sections(context: InspectorContext): InspectorSectionSchema[];
  __kyxosCompleteMaterialInspectorInstalled?: boolean;
}

type CompleteTextureField =
  | 'clearcoatRoughnessTexture'
  | 'clearcoatNormalTexture'
  | 'sheenColorTexture'
  | 'sheenRoughnessTexture'
  | 'specularTexture'
  | 'specularColorTexture'
  | 'iridescenceTexture'
  | 'iridescenceThicknessTexture'
  | 'anisotropyTexture';

function encode(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function decode(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function selectedMaterialIds(context: InspectorContext): string[] {
  const selected = new Set(context.nodeIds);
  const ids = new Set<string>();
  for (const node of context.scene.nodes) {
    if (!selected.has(node.id)) continue;
    const slots = context.scene.activeMaterialVariantId
      ? node.materialVariantBindings?.[context.scene.activeMaterialVariantId]
        ?? node.materialSlots
      : node.materialSlots;
    for (const id of slots ?? []) ids.add(id);
  }
  return [...ids];
}

function materialPaths(suffix: string): (context: InspectorContext) => string[] {
  return (context) => selectedMaterialIds(context).map(
    (id) => `/materials/${encode(id)}/${suffix}`,
  );
}

function texturePaths(
  property: CompleteTextureField,
  suffix: string,
): (context: InspectorContext) => string[] {
  return (context) => selectedMaterialIds(context).flatMap((id) => {
    const material = context.scene.materials[id] as SceneMaterial & Record<string, unknown>;
    const reference = material?.[property];
    return reference && typeof reference === 'object'
      ? [`/materials/${encode(id)}/${property}/${suffix}`]
      : [];
  });
}

function restoreMaterialValue(context: InspectorContext, path: string): unknown {
  const match = path.match(/^\/materials\/([^/]+)\/(.+)$/);
  if (!match) return undefined;
  const material = context.scene.materials[decode(match[1])];
  let value: unknown = material?.metadata?.original;
  for (const segment of match[2].split('/').map(decode)) {
    value = value && typeof value === 'object'
      ? (value as Record<string, unknown>)[segment]
      : undefined;
  }
  return value;
}

function finiteNumber(
  id: string,
  label: string,
  suffix: string,
  defaults: {
    minimum?: number;
    maximum?: number;
    step?: number;
    defaultValue?: number;
    unit?: string;
  } = {},
): InspectorFieldSchema {
  return {
    id,
    label,
    type: 'number',
    minimum: defaults.minimum,
    maximum: defaults.maximum,
    step: defaults.step ?? 0.01,
    defaultValue: defaults.defaultValue,
    unit: defaults.unit,
    resolvePaths: materialPaths(suffix),
    restoreValue: restoreMaterialValue,
    normalize(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return defaults.defaultValue ?? 0;
      return Math.max(
        defaults.minimum ?? -Infinity,
        Math.min(defaults.maximum ?? Infinity, number),
      );
    },
    validate(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return `${label} must be a finite number.`;
      if (defaults.minimum != null && number < defaults.minimum) {
        return `${label} must be at least ${defaults.minimum}.`;
      }
      if (defaults.maximum != null && number > defaults.maximum) {
        return `${label} must be at most ${defaults.maximum}.`;
      }
      return null;
    },
  };
}

function colorValue(value: unknown, fallback: Vec3): Vec3 {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
    return {
      x: Number.parseInt(value.slice(1, 3), 16) / 255,
      y: Number.parseInt(value.slice(3, 5), 16) / 255,
      z: Number.parseInt(value.slice(5, 7), 16) / 255,
    };
  }
  if (value && typeof value === 'object') {
    const source = value as Partial<Vec3>;
    if ([source.x, source.y, source.z].every((entry) => Number.isFinite(entry))) {
      return { x: Number(source.x), y: Number(source.y), z: Number(source.z) };
    }
  }
  return fallback;
}

function colorField(
  id: string,
  label: string,
  suffix: string,
  fallback: Vec3,
): InspectorFieldSchema {
  return {
    id,
    label,
    type: 'color',
    defaultValue: fallback,
    resolvePaths: materialPaths(suffix),
    restoreValue: restoreMaterialValue,
    normalize: (value) => colorValue(value, fallback),
  };
}

function textureField(
  property: CompleteTextureField,
  label: string,
  colorSpace: TextureRef['colorSpace'],
  channel: TextureRef['channel'],
): InspectorFieldSchema[] {
  const prefix = `material.complete.${property}`;
  const field: InspectorFieldSchema = {
    id: prefix,
    label,
    type: 'asset',
    assetKinds: ['texture'],
    tooltip: 'Assign a typed glTF texture while preserving UV, transform and sampler state.',
    resolvePaths: materialPaths(property),
    restoreValue: restoreMaterialValue,
    normalize(value) {
      const source = value && typeof value === 'object'
        ? value as Partial<TextureRef>
        : { assetId: String(value ?? '') };
      return {
        assetId: source.assetId ?? '',
        texCoord: Math.max(0, Math.trunc(Number(source.texCoord ?? 0))),
        colorSpace,
        channel,
        offset: source.offset ?? { x: 0, y: 0 },
        scale: source.scale ?? { x: 1, y: 1 },
        rotation: Number(source.rotation ?? 0),
        wrapS: source.wrapS ?? 'repeat',
        wrapT: source.wrapT ?? 'repeat',
        minFilter: source.minFilter ?? 'linearMipLinear',
        magFilter: source.magFilter ?? 'linear',
      } satisfies TextureRef;
    },
  };

  const number = (
    suffix: string,
    fieldLabel: string,
    defaults: { minimum?: number; maximum?: number; step?: number; defaultValue: number },
  ): InspectorFieldSchema => ({
    id: `${prefix}.${suffix}`,
    label: `${label} ${fieldLabel}`,
    type: 'number',
    minimum: defaults.minimum,
    maximum: defaults.maximum,
    step: defaults.step,
    defaultValue: defaults.defaultValue,
    resolvePaths: texturePaths(property, suffix),
    restoreValue: restoreMaterialValue,
    normalize(value) {
      const next = Number(value);
      if (!Number.isFinite(next)) return defaults.defaultValue;
      return Math.max(
        defaults.minimum ?? -Infinity,
        Math.min(defaults.maximum ?? Infinity, next),
      );
    },
  });

  return [
    field,
    number('texCoord', 'UV Set', { minimum: 0, maximum: 7, step: 1, defaultValue: 0 }),
    number('offset/x', 'Offset U', { step: 0.01, defaultValue: 0 }),
    number('offset/y', 'Offset V', { step: 0.01, defaultValue: 0 }),
    number('scale/x', 'Scale U', { step: 0.01, defaultValue: 1 }),
    number('scale/y', 'Scale V', { step: 0.01, defaultValue: 1 }),
    number('rotation', 'Rotation', { step: 0.01, defaultValue: 0 }),
    {
      id: `${prefix}.wrapS`,
      label: `${label} Wrap U`,
      type: 'select',
      options: [
        { value: 'repeat', label: 'Repeat' },
        { value: 'clamp', label: 'Clamp' },
        { value: 'mirror', label: 'Mirror' },
      ],
      defaultValue: 'repeat',
      resolvePaths: texturePaths(property, 'wrapS'),
      restoreValue: restoreMaterialValue,
    },
    {
      id: `${prefix}.wrapT`,
      label: `${label} Wrap V`,
      type: 'select',
      options: [
        { value: 'repeat', label: 'Repeat' },
        { value: 'clamp', label: 'Clamp' },
        { value: 'mirror', label: 'Mirror' },
      ],
      defaultValue: 'repeat',
      resolvePaths: texturePaths(property, 'wrapT'),
      restoreValue: restoreMaterialValue,
    },
    {
      id: `${prefix}.minFilter`,
      label: `${label} Min Filter`,
      type: 'select',
      options: [
        { value: 'nearest', label: 'Nearest' },
        { value: 'linear', label: 'Linear' },
        { value: 'nearestMipNearest', label: 'Nearest Mip Nearest' },
        { value: 'linearMipNearest', label: 'Linear Mip Nearest' },
        { value: 'nearestMipLinear', label: 'Nearest Mip Linear' },
        { value: 'linearMipLinear', label: 'Linear Mip Linear' },
      ],
      defaultValue: 'linearMipLinear',
      resolvePaths: texturePaths(property, 'minFilter'),
      restoreValue: restoreMaterialValue,
    },
    {
      id: `${prefix}.magFilter`,
      label: `${label} Mag Filter`,
      type: 'select',
      options: [
        { value: 'nearest', label: 'Nearest' },
        { value: 'linear', label: 'Linear' },
      ],
      defaultValue: 'linear',
      resolvePaths: texturePaths(property, 'magFilter'),
      restoreValue: restoreMaterialValue,
    },
  ];
}

function advancedFields(): InspectorFieldSchema[] {
  return [
    {
      id: 'material.complete.unlit',
      label: 'Unlit',
      type: 'boolean',
      defaultValue: false,
      tooltip: 'KHR_materials_unlit: render without scene lighting.',
      resolvePaths: materialPaths('unlit'),
      restoreValue: restoreMaterialValue,
    },
    colorField('material.complete.emissive', 'Emissive Color', 'emissive', { x: 0, y: 0, z: 0 }),
    finiteNumber('material.complete.emissiveIntensity', 'Emissive Strength', 'emissiveIntensity', {
      minimum: 0,
      maximum: 1000,
      defaultValue: 1,
    }),
    finiteNumber('material.complete.alphaCutoff', 'Alpha Cutoff', 'alphaCutoff', {
      minimum: 0,
      maximum: 1,
      defaultValue: 0.5,
    }),
    finiteNumber('material.complete.aoIntensity', 'Occlusion Strength', 'aoIntensity', {
      minimum: 0,
      maximum: 1,
      defaultValue: 1,
    }),
    finiteNumber('material.complete.clearcoatNormalScale', 'Clearcoat Normal Scale', 'clearcoatNormalScale', {
      minimum: 0,
      maximum: 4,
      defaultValue: 1,
    }),
    colorField('material.complete.attenuationColor', 'Attenuation Color', 'attenuationColor', { x: 1, y: 1, z: 1 }),
    finiteNumber('material.complete.attenuationDistance', 'Attenuation Distance', 'attenuationDistance', {
      minimum: 0,
      maximum: 1000000,
      defaultValue: 1000000,
      unit: 'm',
    }),
    colorField('material.complete.sheenColor', 'Sheen Color', 'sheenColor', { x: 0, y: 0, z: 0 }),
    colorField('material.complete.specularColor', 'Specular Color', 'specularColor', { x: 1, y: 1, z: 1 }),
    finiteNumber('material.complete.iridescence', 'Iridescence', 'iridescence', {
      minimum: 0,
      maximum: 1,
      defaultValue: 0,
    }),
    finiteNumber('material.complete.iridescenceIor', 'Iridescence IOR', 'iridescenceIor', {
      minimum: 1,
      maximum: 2.333,
      step: 0.001,
      defaultValue: 1.3,
    }),
    finiteNumber('material.complete.iridescenceThicknessMinimum', 'Iridescence Thickness Min', 'iridescenceThicknessMinimum', {
      minimum: 0,
      maximum: 10000,
      defaultValue: 100,
      unit: 'nm',
    }),
    finiteNumber('material.complete.iridescenceThicknessMaximum', 'Iridescence Thickness Max', 'iridescenceThicknessMaximum', {
      minimum: 0,
      maximum: 10000,
      defaultValue: 400,
      unit: 'nm',
    }),
    finiteNumber('material.complete.anisotropy', 'Anisotropy Strength', 'anisotropy', {
      minimum: 0,
      maximum: 1,
      defaultValue: 0,
    }),
    finiteNumber('material.complete.anisotropyRotation', 'Anisotropy Rotation', 'anisotropyRotation', {
      minimum: -Math.PI * 2,
      maximum: Math.PI * 2,
      defaultValue: 0,
      unit: 'rad',
    }),
    finiteNumber('material.complete.dispersion', 'Dispersion', 'dispersion', {
      minimum: 0,
      maximum: 10,
      defaultValue: 0,
    }),
  ];
}

function extendedTextureFields(): InspectorFieldSchema[] {
  return [
    ...textureField('clearcoatRoughnessTexture', 'Clearcoat Roughness Texture', 'linear', 'g'),
    ...textureField('clearcoatNormalTexture', 'Clearcoat Normal Texture', 'linear', 'rgb'),
    ...textureField('sheenColorTexture', 'Sheen Color Texture', 'srgb', 'rgb'),
    ...textureField('sheenRoughnessTexture', 'Sheen Roughness Texture', 'linear', 'a'),
    ...textureField('specularTexture', 'Specular Intensity Texture', 'linear', 'a'),
    ...textureField('specularColorTexture', 'Specular Color Texture', 'srgb', 'rgb'),
    ...textureField('iridescenceTexture', 'Iridescence Texture', 'linear', 'r'),
    ...textureField('iridescenceThicknessTexture', 'Iridescence Thickness Texture', 'linear', 'g'),
    ...textureField('anisotropyTexture', 'Anisotropy Texture', 'linear', 'rgb'),
  ];
}

const prototype = InspectorSchemaRegistry.prototype as unknown as InspectorRegistryPrototype;
if (!prototype.__kyxosCompleteMaterialInspectorInstalled) {
  const originalSections = prototype.sections;
  prototype.sections = function sectionsWithCompleteMaterials(
    context: InspectorContext,
  ): InspectorSectionSchema[] {
    const sections = originalSections.call(this, context);
    const visible = selectedMaterialIds(context).length > 0;
    if (!visible) return sections;
    return [
      ...sections,
      {
        id: 'material-advanced-complete',
        title: 'Material Advanced',
        order: 41,
        visible: () => true,
        fields: advancedFields,
      },
      {
        id: 'material-extension-textures',
        title: 'Material Extension Textures',
        order: 42,
        visible: () => true,
        fields: extendedTextureFields,
      },
    ].sort((left, right) => left.order - right.order);
  };
  prototype.__kyxosCompleteMaterialInspectorInstalled = true;
}
