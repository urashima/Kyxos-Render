from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'{label} marker not found')
    return text.replace(old, new, 1)


index = Path('packages/api-client/src/index.ts')
text = index.read_text()
old = '''async function putBlob(hash: string, blob: Blob): Promise<void> {
  const db = await openAssetDb();
  try {
    // WebKit/Safari can reject a File object during IndexedDB structured cloning
    // even though a plain Blob containing the same bytes is accepted.
    const persistable = new Blob([await blob.arrayBuffer()], {
      type: blob.type || 'application/octet-stream',
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('blobs', 'readwrite');
      const request = transaction.objectStore('blobs').put(persistable, hash);
      const failure = () => reject(
        transaction.error
          ?? request.error
          ?? new Error(`IndexedDB rejected asset Blob ${hash}.`),
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = failure;
      transaction.onabort = failure;
      request.onerror = failure;
    });
  } finally {
    db.close();
  }
}

async function getBlob(hash: string): Promise<Blob | null> {
  const db = await openAssetDb();
  const value = await new Promise<Blob | null>((resolve, reject) => {
    const request = db.transaction('blobs').objectStore('blobs').get(hash);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}
'''
new = '''interface StoredAssetBlobRecord {
  bytes: ArrayBuffer;
  type: string;
}

function decodeStoredAssetBlob(value: unknown): Blob | null {
  if (value instanceof Blob) return value;
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<StoredAssetBlobRecord>;
  if (!(record.bytes instanceof ArrayBuffer)) return null;
  return new Blob([record.bytes], {
    type: typeof record.type === 'string' && record.type
      ? record.type
      : 'application/octet-stream',
  });
}

async function putBlob(hash: string, blob: Blob): Promise<void> {
  const persistable: StoredAssetBlobRecord = {
    bytes: await blob.arrayBuffer(),
    type: blob.type || 'application/octet-stream',
  };
  const db = await openAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('blobs', 'readwrite');
      const request = transaction.objectStore('blobs').put(persistable, hash);
      const failure = () => reject(
        transaction.error
          ?? request.error
          ?? new Error(`IndexedDB rejected asset bytes ${hash}.`),
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = failure;
      transaction.onabort = failure;
      request.onerror = failure;
    });
  } finally {
    db.close();
  }
}

async function getBlob(hash: string): Promise<Blob | null> {
  const db = await openAssetDb();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('blobs').objectStore('blobs').get(hash);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return decodeStoredAssetBlob(value);
  } finally {
    db.close();
  }
}
'''
text = replace_once(text, old, new, 'index asset storage')
index.write_text(text)


legacy = Path('packages/api-client/src/legacyAssetRecovery.ts')
text = legacy.read_text()
old = '''async function getBlob(key: string): Promise<Blob | null> {
  if (!key) return null;
  const db = await openAssetDb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const request = db.transaction(ASSET_STORE_NAME).objectStore(ASSET_STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function putBlob(key: string, blob: Blob): Promise<void> {
  const db = await openAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(ASSET_STORE_NAME, 'readwrite');
      transaction.objectStore(ASSET_STORE_NAME).put(blob, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function listBlobs(): Promise<Array<{ key: string; blob: Blob }>> {
  const db = await openAssetDb();
  try {
    return await new Promise((resolve, reject) => {
      const entries: Array<{ key: string; blob: Blob }> = [];
      const request = db.transaction(ASSET_STORE_NAME).objectStore(ASSET_STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(entries);
          return;
        }
        if (cursor.value instanceof Blob) {
          entries.push({ key: String(cursor.key), blob: cursor.value });
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
'''
new = '''interface StoredAssetBlobRecord {
  bytes: ArrayBuffer;
  type: string;
}

function decodeStoredAssetBlob(value: unknown): Blob | null {
  if (value instanceof Blob) return value;
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<StoredAssetBlobRecord>;
  if (!(record.bytes instanceof ArrayBuffer)) return null;
  return new Blob([record.bytes], {
    type: typeof record.type === 'string' && record.type
      ? record.type
      : 'application/octet-stream',
  });
}

async function getBlob(key: string): Promise<Blob | null> {
  if (!key) return null;
  const db = await openAssetDb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const request = db.transaction(ASSET_STORE_NAME).objectStore(ASSET_STORE_NAME).get(key);
      request.onsuccess = () => resolve(decodeStoredAssetBlob(request.result));
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function putBlob(key: string, blob: Blob): Promise<void> {
  const persistable: StoredAssetBlobRecord = {
    bytes: await blob.arrayBuffer(),
    type: blob.type || 'application/octet-stream',
  };
  const db = await openAssetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(ASSET_STORE_NAME, 'readwrite');
      const request = transaction.objectStore(ASSET_STORE_NAME).put(persistable, key);
      const failure = () => reject(
        transaction.error
          ?? request.error
          ?? new Error(`IndexedDB rejected recovered asset bytes ${key}.`),
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = failure;
      transaction.onabort = failure;
      request.onerror = failure;
    });
  } finally {
    db.close();
  }
}

async function listBlobs(): Promise<Array<{ key: string; blob: Blob }>> {
  const db = await openAssetDb();
  try {
    return await new Promise((resolve, reject) => {
      const entries: Array<{ key: string; blob: Blob }> = [];
      const request = db.transaction(ASSET_STORE_NAME).objectStore(ASSET_STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(entries);
          return;
        }
        const blob = decodeStoredAssetBlob(cursor.value);
        if (blob) entries.push({ key: String(cursor.key), blob });
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
'''
text = replace_once(text, old, new, 'legacy asset storage')
legacy.write_text(text)


spec = Path('tests/e2e/studio-save-publish-public.spec.ts')
text = spec.read_text()
old = 'request.onsuccess = () => resolve(request.result instanceof Blob);'
new = '''request.onsuccess = () => {
        const value = request.result as any;
        resolve(value instanceof Blob || value?.bytes instanceof ArrayBuffer);
      };'''
count = text.count(old)
if count != 3:
    raise SystemExit(f'expected 3 direct Blob assertions, found {count}')
text = text.replace(old, new)
spec.write_text(text)
