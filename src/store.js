// IndexedDB store: recent documents (the .docx bytes are kept untouched) + version history.
const DB = 'dotworks';
const STORE = 'docs';
const VERSIONS = 'versions';
const MAX_VERSIONS = 20;

let dbPromise;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(VERSIONS)) {
        const v = db.createObjectStore(VERSIONS, { keyPath: 'vid', autoIncrement: true });
        v.createIndex('docId', 'docId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const putDoc = (doc) => tx(STORE, 'readwrite', (s) => s.put(doc));
export const getDoc = (id) => tx(STORE, 'readonly', (s) => s.get(id));
export async function deleteDoc(id) {
  await tx(STORE, 'readwrite', (s) => s.delete(id));
  await deleteVersions(id).catch(() => {});
}
export async function listDocs() {
  const all = await tx(STORE, 'readonly', (s) => s.getAll());
  return (all || []).map(({ blob, ...meta }) => meta);
}
/** Update metadata only (rename, pin…). */
export async function patchDoc(id, patch) {
  const d = await getDoc(id);
  if (!d) return null;
  const next = { ...d, ...patch };
  await putDoc(next);
  return next;
}

/* ---------- version history ---------- */
export async function addVersion(docId, blob, meta = {}) {
  await tx(VERSIONS, 'readwrite', (s) => s.add({ docId, blob, size: blob.size, created: Date.now(), ...meta }));
  // prune oldest
  const list = await listVersions(docId);
  const extra = list.slice(MAX_VERSIONS);
  if (extra.length) await tx(VERSIONS, 'readwrite', (s) => extra.forEach((v) => s.delete(v.vid)));
}
export async function listVersions(docId) {
  const all = await tx(VERSIONS, 'readonly', (s) => s.index('docId').getAll(docId));
  return (all || []).map(({ blob, ...m }) => m).sort((a, b) => b.created - a.created);
}
export const getVersion = (vid) => tx(VERSIONS, 'readonly', (s) => s.get(vid));
async function deleteVersions(docId) {
  const list = await listVersions(docId);
  if (list.length) await tx(VERSIONS, 'readwrite', (s) => list.forEach((v) => s.delete(v.vid)));
}
