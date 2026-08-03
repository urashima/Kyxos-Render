import {
  InspectorSchemaRegistry,
  type InspectorContext,
  type InspectorFieldSchema,
  type InspectorSectionSchema,
} from '@kyxos/editor-core';

interface InspectorRegistryPrototype {
  sections(context: InspectorContext): InspectorSectionSchema[];
  __kyxosTransparencyInspectorInstalled?: boolean;
}

const surfaceFieldIds = new Set([
  'material.opacity',
  'material.alphaMode',
  'material.doubleSided',
]);

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

function clamp01(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function surfaceFields(context: InspectorContext): InspectorFieldSchema[] {
  const fields: InspectorFieldSchema[] = [
    {
      id: 'material.surface.opacity',
      label: 'Opacity',
      type: 'number',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      defaultValue: 1,
      tooltip: 'Surface opacity used by Blend and Cutout modes. Opaque always renders fully solid.',
      resolvePaths: materialPaths('opacity'),
      restoreValue: restoreMaterialValue,
      normalize: (value) => clamp01(value, 1),
    },
    {
      id: 'material.surface.alphaMode',
      label: 'Alpha Mode',
      type: 'select',
      options: [
        { value: 'opaque', label: 'Opaque' },
        { value: 'mask', label: 'Cutout' },
        { value: 'blend', label: 'Blend' },
      ],
      defaultValue: 'opaque',
      tooltip: 'Opaque ignores alpha, Cutout uses an alpha threshold, and Blend renders smooth transparency.',
      resolvePaths: materialPaths('alphaMode'),
      restoreValue: restoreMaterialValue,
    },
  ];

  const hasMask = selectedMaterialIds(context).some(
    (id) => context.scene.materials[id]?.alphaMode === 'mask',
  );
  if (hasMask) {
    fields.push({
      id: 'material.surface.alphaCutoff',
      label: 'Alpha Cutoff',
      type: 'number',
      minimum: 0,
      maximum: 1,
      step: 0.01,
      defaultValue: 0.5,
      tooltip: 'Pixels below this alpha threshold are discarded in Cutout mode.',
      resolvePaths: materialPaths('alphaCutoff'),
      restoreValue: restoreMaterialValue,
      normalize: (value) => clamp01(value, 0.5),
    });
  }

  fields.push({
    id: 'material.surface.doubleSided',
    label: 'Double Sided',
    type: 'boolean',
    defaultValue: false,
    tooltip: 'Render both front and back faces. Transparent double-sided surfaces keep the correct two-pass path.',
    resolvePaths: materialPaths('doubleSided'),
    restoreValue: restoreMaterialValue,
  });
  return fields;
}

const prototype = InspectorSchemaRegistry.prototype as unknown as InspectorRegistryPrototype;
if (!prototype.__kyxosTransparencyInspectorInstalled) {
  const originalSections = prototype.sections;
  prototype.sections = function sectionsWithTransparencySurface(
    context: InspectorContext,
  ): InspectorSectionSchema[] {
    const sections = originalSections.call(this, context).map((section) => {
      if (section.id === 'material') {
        const originalFields = section.fields;
        return {
          ...section,
          fields: (current: InspectorContext) =>
            originalFields(current).filter((field) => !surfaceFieldIds.has(field.id)),
        };
      }
      if (section.id === 'material-advanced-complete') {
        const originalFields = section.fields;
        return {
          ...section,
          fields: (current: InspectorContext) =>
            originalFields(current).filter(
              (field) => field.id !== 'material.complete.alphaCutoff',
            ),
        };
      }
      return section;
    });
    if (!selectedMaterialIds(context).length) return sections;
    sections.push({
      id: 'material-surface',
      title: 'Material Surface',
      order: 40.5,
      visible: () => true,
      fields: surfaceFields,
    });
    return sections.sort((left, right) => left.order - right.order);
  };
  prototype.__kyxosTransparencyInspectorInstalled = true;
}
