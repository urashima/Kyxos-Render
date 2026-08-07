const localBlobBytesRegistryKey = Symbol.for('kyxos.localBlobBytesRegistry');

type RegistryGlobal = typeof globalThis & {
  [localBlobBytesRegistryKey]?: WeakMap<Blob, Uint8Array>;
};

const runtime = globalThis as RegistryGlobal;
const registry = runtime[localBlobBytesRegistryKey] ?? new WeakMap<Blob, Uint8Array>();
runtime[localBlobBytesRegistryKey] = registry;

/**
 * Register bytes owned by a generated immutable Blob/File.
 * Callers must not mutate the Uint8Array after registration. Keeping the same
 * backing store avoids a second full generated-GLB allocation on mobile.
 */
export function registerLocalBlobBytes(blob: Blob, bytes: Uint8Array): void {
  registry.set(blob, bytes);
}

export function registeredLocalBlobBytes(blob: Blob): Uint8Array | undefined {
  return registry.get(blob);
}
