// .BEATS — local project storage (IndexedDB).
import { buffers, project, audioCtx, clearHistory } from './engine.js';
import { encodeWav } from './dsp.js';

let dbp;
function db() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('dotbeats', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('projects', { keyPath: 'id' }); r.result.createObjectStore('blobs'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
const tx = async (store, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store), r = fn(s);
    t.oncomplete = () => res(r?.result);
    t.onerror = () => rej(t.error);
  });
};

export async function saveProject() {
  const p = project.cur;
  p.updated = Date.now();
  const used = new Set(p.tracks.flatMap((t) => t.clips.map((c) => c.bufId)));
  const bufMeta = {};
  for (const id of used) {
    const e = buffers.get(id);
    if (!e) continue;
    if (!e.blob) e.blob = encodeWav(e.buffer);
    if (!e.saved) { await tx('blobs', 'readwrite', (s) => s.put(e.blob, id)); e.saved = true; }
    bufMeta[id] = { name: e.name, meta: e.meta };
  }
  await tx('projects', 'readwrite', (s) => s.put({ ...JSON.parse(JSON.stringify(p)), bufMeta }));
}
export const listProjects = async () => ((await tx('projects', 'readonly', (s) => s.getAll())) || []).sort((a, b) => b.updated - a.updated);
export async function loadProject(id) {
  const rec = await tx('projects', 'readonly', (s) => s.get(id));
  if (!rec) throw new Error('Projet introuvable');
  for (const [bid, m] of Object.entries(rec.bufMeta || {})) {
    if (buffers.has(bid)) continue;
    const blob = await tx('blobs', 'readonly', (s) => s.get(bid));
    if (!blob) continue;
    const buffer = await audioCtx().decodeAudioData(await blob.arrayBuffer());
    buffers.set(bid, { buffer, name: m.name, blob, meta: m.meta || {}, saved: true });
  }
  delete rec.bufMeta;
  project.cur = rec;
  clearHistory();
}
export async function deleteProject(id) {
  const rec = await tx('projects', 'readonly', (s) => s.get(id));
  await tx('projects', 'readwrite', (s) => s.delete(id));
  const all = await listProjects();
  const still = new Set(all.flatMap((p) => Object.keys(p.bufMeta || {})));
  for (const bid of Object.keys(rec?.bufMeta || {})) if (!still.has(bid)) await tx('blobs', 'readwrite', (s) => s.delete(bid));
}
