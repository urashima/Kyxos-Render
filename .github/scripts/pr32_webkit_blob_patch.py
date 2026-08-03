from pathlib import Path

path = Path('packages/api-client/src/index.ts')
text = path.read_text()
old = '''async function putBlob(hash: string, blob: Blob): Promise<void> {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('blobs', 'readwrite');
    transaction.objectStore('blobs').put(blob, hash);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}
'''
new = '''async function putBlob(hash: string, blob: Blob): Promise<void> {
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
'''
if old not in text:
    raise SystemExit('putBlob marker not found')
path.write_text(text.replace(old, new, 1))
