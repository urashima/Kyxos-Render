const localBlobBytesRegistryKey = Symbol.for('kyxos.localBlobBytesRegistry');

type RegistryGlobal = typeof globalThis & {
  [localBlobBytesRegistryKey]?: WeakMap<Blob, Uint8Array>;
};

const runtime = globalThis as RegistryGlobal;
const registry = runtime[localBlobBytesRegistryKey] ?? new WeakMap<Blob, Uint8Array>();
runtime[localBlobBytesRegistryKey] = registry;

export function registerLocalBlobBytes(blob: Blob, bytes: Uint8Array): void {
  registry.set(blob, bytes.slice());
}

export function registeredLocalBlobBytes(blob: Blob): Uint8Array | undefined {
  return registry.get(blob);
}
