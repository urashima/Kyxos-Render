const implementedMaterialExtensions = new Set([
  'KHR_materials_unlit',
  'KHR_materials_clearcoat',
  'KHR_materials_transmission',
  'KHR_materials_volume',
  'KHR_materials_ior',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_emissive_strength',
  'KHR_materials_iridescence',
  'KHR_materials_anisotropy',
  'KHR_materials_dispersion',
  'KHR_texture_transform',
]);

interface ImportReportShape {
  warnings?: unknown;
  unsupportedExtensions?: unknown;
  extensions?: unknown;
  [key: string]: unknown;
}

function referencesImplementedExtension(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return [...implementedMaterialExtensions].some((extension) => value.includes(extension));
}

function sanitizeExtensionList(value: unknown): unknown {
  return Array.isArray(value)
    ? value.filter((entry) => !implementedMaterialExtensions.has(String(entry)))
    : value;
}

function sanitizeWarnings(value: unknown): unknown {
  return Array.isArray(value)
    ? value.filter((entry) => !referencesImplementedExtension(entry))
    : value;
}

function sanitizeReport(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const report = value as ImportReportShape;
  report.warnings = sanitizeWarnings(report.warnings);
  report.unsupportedExtensions = sanitizeExtensionList(report.unsupportedExtensions);

  if (report.extensions && typeof report.extensions === 'object' && !Array.isArray(report.extensions)) {
    const extensions = report.extensions as Record<string, unknown>;
    for (const key of ['unsupported', 'unsupportedUsed', 'unsupportedRequired']) {
      extensions[key] = sanitizeExtensionList(extensions[key]);
    }
  }
  return report;
}

const target = globalThis as typeof globalThis & Record<string, unknown>;
const property = '__kyxosLastGlbImportReport';
const existing = Object.getOwnPropertyDescriptor(target, property);

if (!existing || existing.configurable !== false) {
  let current = sanitizeReport(existing?.get ? existing.get.call(target) : existing?.value);
  Object.defineProperty(target, property, {
    configurable: true,
    enumerable: existing?.enumerable ?? false,
    get() {
      return current;
    },
    set(value: unknown) {
      current = sanitizeReport(value);
    },
  });
}

export { implementedMaterialExtensions, sanitizeReport as sanitizeGltfMaterialImportReport };
