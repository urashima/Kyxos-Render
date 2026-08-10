function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('GLB metadata read was cancelled.', 'AbortError');
}

export async function readGlbMetadataPrefix(
  file: File,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (signal?.aborted) throw abortError(signal);
  if (file.size < 20) throw new Error('File is too small to be a GLB container.');

  const header = await file.slice(0, 20).arrayBuffer();
  if (signal?.aborted) throw abortError(signal);
  const view = new DataView(header);
  if (view.getUint32(0, true) !== 0x46546c67) {
    throw new Error('File is not a valid GLB container.');
  }
  if (view.getUint32(4, true) !== 2) {
    throw new Error('Only GLB 2.0 is supported.');
  }
  const declaredLength = view.getUint32(8, true);
  if (declaredLength > file.size) throw new Error('GLB container is truncated.');

  const jsonLength = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);
  if (jsonType !== 0x4e4f534a) {
    throw new Error('GLB JSON must be the first container chunk.');
  }
  const end = 20 + jsonLength;
  if (end > declaredLength || end > file.size) {
    throw new Error('GLB JSON chunk exceeds the container length.');
  }

  const prefix = await file.slice(0, end).arrayBuffer();
  if (signal?.aborted) throw abortError(signal);

  // createGlbImportReport only needs the JSON chunk. Rewrite the declared
  // container length in this private metadata copy so its existing parser can
  // validate the prefix without allocating the binary geometry/image payload.
  new DataView(prefix).setUint32(8, prefix.byteLength, true);
  return prefix;
}
