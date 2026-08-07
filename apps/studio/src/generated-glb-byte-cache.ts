import { registeredLocalBlobBytes } from './local-blob-byte-registry';

const installed = Symbol.for('kyxos.generatedGlbByteCache.installed');

type CacheGlobal = typeof globalThis & { [installed]?: boolean };
const runtime = globalThis as CacheGlobal;

if (!runtime[installed]) {
  const previousArrayBuffer = File.prototype.arrayBuffer;
  File.prototype.arrayBuffer = function generatedFileArrayBuffer(): Promise<ArrayBuffer> {
    const registered = registeredLocalBlobBytes(this);
    if (!registered) {
      // A user-picked File is not a generated asset. Never retain or clone its
      // entire payload here; large GLBs must remain eligible for collection
      // between hashing, persistence and GLTFLoader parsing on iOS.
      return previousArrayBuffer.call(this);
    }
    const bytes = registered;
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
      return Promise.resolve(bytes.buffer as ArrayBuffer);
    }
    return Promise.resolve(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  };
  runtime[installed] = true;
}
