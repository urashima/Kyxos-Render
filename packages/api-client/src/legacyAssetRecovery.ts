import type { SceneAsset } from '@kyxos/scene-contract';

const ASSET_DB_NAME = 'kyxos-assets';
const ASSET_STORE_NAME = 'blobs';

export interface LocalAssetIndexEntry {
  id: string;
  hash: string;
  name?: string;
  mimeType?: string;
  byteSize?: number;
  completed?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RecoveredAssetBlob {
  sourceKey: string;
  actualHash: string;
}

function openAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ASSET_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ASSET_STORE_NAME)) {
        request.result.createObjectStore(ASSET_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

interface StoredAssetBlobRecord {
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

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function matchesExpectedShape(blob: Blob, asset: SceneAsset): boolean {
  if (asset.byteSize && blob.size !== asset.byteSize) return false;
  if (asset.mimeType && blob.type && blob.type !== asset.mimeType) return false;
  return true;
}

export async function recoverLocalAssetBlob(
  assetKey: string,
  asset: SceneAsset,
  index: Record<string, LocalAssetIndexEntry>,
): Promise<RecoveredAssetBlob | null> {
  const expectedHash = asset.contentHash;
  const candidateKeys = new Set<string>([
    expectedHash,
    assetKey,
    asset.id,
    asset.uri,
    asset.uri.startsWith('asset://') ? asset.uri.slice('asset://'.length) : '',
  ].filter(Boolean));

  for (const [storedKey, stored] of Object.entries(index)) {
    const sameLogicalAsset =
      storedKey === assetKey ||
      stored.id === asset.id ||
      stored.hash === expectedHash ||
      (
        Boolean(asset.name) &&
        stored.name === asset.name &&
        (!asset.byteSize || stored.byteSize === asset.byteSize)
      );
    if (!sameLogicalAsset) continue;
    candidateKeys.add(storedKey);
    candidateKeys.add(stored.id);
    candidateKeys.add(stored.hash);
  }

  for (const key of candidateKeys) {
    const blob = await getBlob(key);
    if (!blob || !matchesExpectedShape(blob, asset)) continue;
    if (key !== expectedHash) await putBlob(expectedHash, blob);
    return { sourceKey: key, actualHash: await sha256(blob) };
  }

  const allEntries = await listBlobs();
  let candidates = allEntries.filter((entry) => matchesExpectedShape(entry.blob, asset));
  if (candidates.length === 1) {
    const candidate = candidates[0];
    if (candidate.key !== expectedHash) await putBlob(expectedHash, candidate.blob);
    return { sourceKey: candidate.key, actualHash: await sha256(candidate.blob) };
  }

  for (const candidate of candidates) {
    const actualHash = await sha256(candidate.blob);
    if (actualHash !== expectedHash) continue;
    if (candidate.key !== expectedHash) await putBlob(expectedHash, candidate.blob);
    return { sourceKey: candidate.key, actualHash };
  }

  return null;
}
