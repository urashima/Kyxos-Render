export type * from './component-authoring';

const nativeStructuredClone = globalThis.structuredClone.bind(globalThis);

function containsFunction(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === 'function') return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => containsFunction(entry, seen));
  return Object.values(value as Record<string, unknown>).some((entry) => containsFunction(entry, seen));
}

function clonePreservingFunctions<T>(value: T, seen = new Map<object, unknown>()): T {
  if (typeof value === 'function' || value == null || typeof value !== 'object') return value;
  if (!containsFunction(value)) return nativeStructuredClone(value);
  if (seen.has(value)) return seen.get(value) as T;
  if (Array.isArray(value)) {
    const array: unknown[] = [];
    seen.set(value, array);
    for (const entry of value) array.push(clonePreservingFunctions(entry, seen));
    return array as T;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    copy[key] = clonePreservingFunctions(entry, seen);
  }
  return copy as T;
}

// The implementation keeps descriptor factories as functions. Patch cloning only
// for module initialization, then replace the two descriptor-copying methods so
// all ordinary component data continues to use the platform structuredClone.
globalThis.structuredClone = clonePreservingFunctions as typeof structuredClone;
const implementation = await import('./component-authoring');

const registryPrototype = implementation.ComponentRegistry.prototype as unknown as {
  register(descriptor: import('./component-authoring').ComponentDescriptor): () => void;
  list(category?: import('./component-authoring').ComponentDescriptor['category']): import('./component-authoring').ComponentDescriptor[];
};

registryPrototype.register = function register(
  this: { descriptors: Map<string, import('./component-authoring').ComponentDescriptor> },
  descriptor: import('./component-authoring').ComponentDescriptor,
): () => void {
  if (this.descriptors.has(descriptor.type)) throw new Error(`Component ${descriptor.type} is already registered.`);
  const copy = clonePreservingFunctions(descriptor);
  this.descriptors.set(descriptor.type, copy);
  return () => this.descriptors.delete(descriptor.type);
};

registryPrototype.list = function list(
  this: { descriptors: Map<string, import('./component-authoring').ComponentDescriptor> },
  category?: import('./component-authoring').ComponentDescriptor['category'],
): import('./component-authoring').ComponentDescriptor[] {
  return [...this.descriptors.values()]
    .filter((descriptor) => !category || descriptor.category === category)
    .sort((left, right) => left.category.localeCompare(right.category) || left.label.localeCompare(right.label))
    .map((descriptor) => clonePreservingFunctions(descriptor));
};

globalThis.structuredClone = nativeStructuredClone;

export const ComponentRegistry = implementation.ComponentRegistry;
export const defaultComponentRegistry = implementation.defaultComponentRegistry;
export const validateAuthoringComponents = implementation.validateAuthoringComponents;
export const componentMixedValue = implementation.componentMixedValue;
export const copyAuthoringComponents = implementation.copyAuthoringComponents;
export const normalizeComponentClipboard = implementation.normalizeComponentClipboard;
export const ComponentAuthoringService = implementation.ComponentAuthoringService;
export const summarizeAuthoringComponents = implementation.summarizeAuthoringComponents;
