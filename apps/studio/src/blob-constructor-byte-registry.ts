const installKey = Symbol.for('kyxos.blobConstructorByteRegistry.installed');
const localBlobBytesRegistryKey = Symbol.for('kyxos.localBlobBytesRegistry');

type RegistryGlobal = typeof globalThis & {
  [installKey]?: boolean;
  [localBlobBytesRegistryKey]?: WeakMap<Blob, Uint8Array>;
};

const runtime = globalThis as RegistryGlobal;

if (!runtime[installKey] && typeof Blob !== 'undefined') {
  const NativeBlob = Blob;
  const registry = runtime[localBlobBytesRegistryKey] ?? new WeakMap<Blob, Uint8Array>();
  runtime[localBlobBytesRegistryKey] = registry;

  const exactBytes = (part: BlobPart | undefined): Uint8Array | null => {
    if (part instanceof ArrayBuffer) return new Uint8Array(part);
    if (ArrayBuffer.isView(part)) {
      return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
    }
    return null;
  };

  const RegisteredBlob = new Proxy(NativeBlob, {
    construct(target, args) {
      // Always construct an actual native Blob. This keeps browser APIs and
      // File/Blob brand checks intact while letting Kyxos remember an existing
      // immutable backing ArrayBuffer when the Blob is only a local persistence
      // wrapper around those exact bytes.
      const blob = Reflect.construct(target, args, target) as Blob;
      const parts = args[0] as BlobPart[] | undefined;
      if (parts?.length === 1) {
        const bytes = exactBytes(parts[0]);
        if (bytes && bytes.byteLength === blob.size) registry.set(blob, bytes);
      }
      return blob;
    },
  });

  Object.defineProperty(RegisteredBlob, Symbol.hasInstance, {
    configurable: true,
    value(instance: unknown) {
      return instance instanceof NativeBlob;
    },
  });

  Object.defineProperty(globalThis, 'Blob', {
    configurable: true,
    writable: true,
    value: RegisteredBlob,
  });

  runtime[installKey] = true;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.localBlobExactBytes = 'installed';
  }
}
