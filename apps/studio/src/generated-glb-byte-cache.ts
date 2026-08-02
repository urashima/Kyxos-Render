import { registerLocalBlobBytes } from './local-blob-byte-registry';

const installed = Symbol.for('kyxos.generatedGlbByteCache.installed');
const cachedReads = new WeakMap<File, Promise<ArrayBuffer>>();

type CacheGlobal = typeof globalThis & { [installed]?: boolean };
const runtime = globalThis as CacheGlobal;

if (!runtime[installed]) {
  const previousArrayBuffer = File.prototype.arrayBuffer;
  File.prototype.arrayBuffer = function cachedGeneratedFileArrayBuffer(): Promise<ArrayBuffer> {
    let pending = cachedReads.get(this);
    if (!pending) {
      pending = previousArrayBuffer.call(this).then((buffer) => {
        registerLocalBlobBytes(this, new Uint8Array(buffer));
        return buffer;
      });
      cachedReads.set(this, pending);
      pending.catch(() => cachedReads.delete(this));
    }
    return pending.then((buffer) => buffer.slice(0));
  };
  runtime[installed] = true;
}
