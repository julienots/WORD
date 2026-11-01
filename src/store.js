// Tiny IndexedDB store for recent documents (the .docx bytes are kept untouched).
const DB = 'dotworks';
const STORE = 'docs';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const putDoc = (doc) => tx('readwrite', (s) => s.put(doc));
export const getDoc = (id) => tx('readonly', (s) => s.get(id));
export const deleteDoc = (id) => tx('readwrite', (s) => s.delete(id));
export async function listDocs() {
  const all = await tx('readonly', (s) => s.getAll());
  return (all || []).map(({ blob, ...meta }) => meta).sort((a, b) => b.updated - a.updated);
}
