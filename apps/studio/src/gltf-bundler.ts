import './image-bitmap-guard';

interface GltfBuffer { uri?: string; byteLength: number; [key: string]: unknown }
interface GltfBufferView { buffer: number; byteOffset?: number; byteLength: number; [key: string]: unknown }
interface GltfImage { uri?: string; bufferView?: number; mimeType?: string; [key: string]: unknown }
interface GltfDocument {
  asset?: { version?: string };
  buffers?: GltfBuffer[];
  bufferViews?: GltfBufferView[];
  images?: GltfImage[];
  [key: string]: unknown;
}

function align4(value: number): number { return (value + 3) & ~3 }

function normalizeResourcePath(value: string): string {
  return decodeURIComponent(value.split(/[?#]/)[0])
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/');
}

function basename(value: string): string { return value.split('/').at(-1) ?? value }

function bytesFromDataUri(uri: string): Uint8Array {
  const match = uri.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) throw new Error('Invalid data URI in glTF resource.');
  const decoded = match[2]
    ? atob(match[3])
    : decodeURIComponent(match[3]);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function dataUriMimeType(uri: string): string | undefined {
  return uri.match(/^data:([^;,]+)/)?.[1];
}

function mimeTypeFor(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase();
  return ({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    ktx2: 'image/ktx2', avif: 'image/avif', gif: 'image/gif', basis: 'image/basis',
  } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream';
}

function fileLookup(files: File[]): Map<string, File | null> {
  const result = new Map<string, File | null>();
  for (const file of files) {
    const relative = normalizeResourcePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
    for (const key of [relative, normalizeResourcePath(file.name), basename(relative)]) {
      const existing = result.get(key);
      if (existing === undefined) result.set(key, file);
      else if (existing !== file) result.set(key, null);
    }
  }
  return result;
}

async function resourceBytes(uri: string, files: Map<string, File | null>): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  if (uri.startsWith('data:')) return { bytes: bytesFromDataUri(uri), mimeType: dataUriMimeType(uri) };
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('//')) {
    throw new Error(`Remote glTF resource is not imported automatically: ${uri}`);
  }
  const path = normalizeResourcePath(uri);
  if (path.split('/').includes('..')) throw new Error(`Unsafe glTF resource path: ${uri}`);
  const exact = files.get(path);
  const file = exact === undefined ? files.get(basename(path)) : exact;
  if (file === null) throw new Error(`Ambiguous external glTF resource: ${uri}`);
  if (!file) throw new Error(`Missing external glTF resource: ${uri}`);
  return { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type || mimeTypeFor(path) };
}

function remainingExternalUris(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((entry, index) => remainingExternalUris(entry, `${path}/${index}`));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    const nextPath = `${path}/${key}`;
    if (key === 'uri' && typeof entry === 'string' && !entry.startsWith('data:')) return [`${nextPath}: ${entry}`];
    return remainingExternalUris(entry, nextPath);
  });
}

function appendPart(parts: Uint8Array[], bytes: Uint8Array, offset: number): { offset: number; next: number } {
  const aligned = align4(offset);
  if (aligned > offset) parts.push(new Uint8Array(aligned - offset));
  parts.push(bytes);
  return { offset: aligned, next: aligned + bytes.byteLength };
}

function concat(parts: Uint8Array[], byteLength: number): Uint8Array {
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength }
  return result;
}

export interface ExternalGltfBundleResult {
  file: File;
  sourceName: string;
  resourceNames: string[];
}

/**
 * Packs a local .gltf and its external buffers/images into a deterministic GLB.
 * Remote URLs are rejected so credentials and mutable third-party resources are
 * never smuggled into a published Scene Contract.
 */
export async function bundleExternalGltf(
  inputFiles: Iterable<File>,
  entryName?: string,
): Promise<ExternalGltfBundleResult> {
  const files = [...inputFiles];
  const entry = entryName
    ? files.find((file) => normalizeResourcePath(file.name) === normalizeResourcePath(entryName))
    : files.find((file) => file.name.toLowerCase().endsWith('.gltf'));
  if (!entry) throw new Error('Select a .gltf file and all of its external resources.');
  const source = JSON.parse(await entry.text()) as GltfDocument;
  if (source.asset?.version !== '2.0') throw new Error('Only glTF 2.0 is supported.');
  const gltf = structuredClone(source);
  const lookup = fileLookup(files.filter((file) => file !== entry));
  const parts: Uint8Array[] = [];
  let binLength = 0;
  const bufferOffsets: number[] = [];
  const resourceNames = new Set<string>();

  for (const [index, buffer] of (gltf.buffers ?? []).entries()) {
    if (!buffer.uri) throw new Error(`External glTF buffer ${index} has no URI.`);
    const resource = await resourceBytes(buffer.uri, lookup);
    if (!buffer.uri.startsWith('data:')) resourceNames.add(normalizeResourcePath(buffer.uri));
    if (resource.bytes.byteLength < buffer.byteLength) throw new Error(`Buffer ${buffer.uri} is shorter than its declared byteLength.`);
    const appended = appendPart(parts, resource.bytes.slice(0, buffer.byteLength), binLength);
    bufferOffsets[index] = appended.offset;
    binLength = appended.next;
  }

  for (const view of gltf.bufferViews ?? []) {
    const base = bufferOffsets[view.buffer];
    if (base == null) throw new Error(`BufferView references missing buffer ${view.buffer}.`);
    const sourceBuffer = gltf.buffers?.[view.buffer];
    if ((view.byteOffset ?? 0) + view.byteLength > (sourceBuffer?.byteLength ?? 0)) {
      throw new Error(`BufferView exceeds buffer ${view.buffer}.`);
    }
    view.byteOffset = base + (view.byteOffset ?? 0);
    view.buffer = 0;
  }

  gltf.bufferViews ??= [];
  for (const image of gltf.images ?? []) {
    if (!image.uri) continue;
    const resource = await resourceBytes(image.uri, lookup);
    if (!image.uri.startsWith('data:')) resourceNames.add(normalizeResourcePath(image.uri));
    const appended = appendPart(parts, resource.bytes, binLength);
    binLength = appended.next;
    image.bufferView = gltf.bufferViews.length;
    image.mimeType = image.mimeType || resource.mimeType || mimeTypeFor(image.uri);
    delete image.uri;
    gltf.bufferViews.push({ buffer: 0, byteOffset: appended.offset, byteLength: resource.bytes.byteLength });
  }

  const paddedBinLength = align4(binLength);
  if (paddedBinLength > binLength) parts.push(new Uint8Array(paddedBinLength - binLength));
  if (paddedBinLength) gltf.buffers = [{ byteLength: paddedBinLength }];
  else delete gltf.buffers;

  const remainingUris = remainingExternalUris(gltf);
  if (remainingUris.length) {
    throw new Error(`Unsupported external glTF URI fields remain after packing: ${remainingUris.join(', ')}`);
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = align4(jsonBytes.byteLength);
  const totalLength = 12 + 8 + jsonLength + (paddedBinLength ? 8 + paddedBinLength : 0);
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(jsonBytes, 20);
  if (paddedBinLength) {
    const header = 20 + jsonLength;
    view.setUint32(header, paddedBinLength, true);
    view.setUint32(header + 4, 0x004e4942, true);
    output.set(concat(parts, paddedBinLength), header + 8);
  }

  const outputName = entry.name.replace(/\.gltf$/i, '.glb');
  return {
    file: new File([output], outputName, { type: 'model/gltf-binary', lastModified: entry.lastModified }),
    sourceName: entry.name,
    resourceNames: [...resourceNames].sort(),
  };
}
