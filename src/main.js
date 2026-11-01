// .WORKS — DOCX word processor by SuperEssence Studio
import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';
import './fonts.css';
import './style.css';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';
import { putDoc, getDoc, listDocs, deleteDoc } from './store.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const isNative = Capacitor.isNativePlatform();
const $ = (s) => document.querySelector(s);

const state = {
  superdoc: null,
  docId: null,
  dirty: false,
  saving: false,
  ready: false,
};

/* ---------------- UI helpers ---------------- */
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
const loader = (on, text = 'Ouverture…') => {
  $('#loader p').textContent = text;
  $('#loader').classList.toggle('hidden', !on);
};
function show(screen) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === screen));
}
function setSaveState(text) {
  $('#save-state').textContent = text;
}
const baseName = (n) => (n || 'Document1').replace(/\.(docx|docm|dotx)$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Document1';
const docName = () => baseName($('#doc-name').value);
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
function base64ToBlob(b64, type = DOCX_MIME) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/* ---------------- Recents ---------------- */
async function renderRecents() {
  const list = $('#recent');
  const docs = await listDocs().catch(() => []);
  list.innerHTML = '';
  $('#recent-empty').style.display = docs.length ? 'none' : 'block';
  for (const d of docs) {
    const li = document.createElement('li');
    const date = new Date(d.updated).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    li.innerHTML = `
      <button class="recent-open">
        <span class="file-ico">W</span>
        <span class="recent-meta"><b></b><small>${date} · ${Math.max(1, Math.round((d.size || 0) / 1024))} Ko</small></span>
      </button>
      <button class="recent-del" aria-label="Supprimer">✕</button>`;
    li.querySelector('b').textContent = `${d.name}.docx`;
    li.querySelector('.recent-open').onclick = async () => {
      const full = await getDoc(d.id);
      if (full) openDocument(full.blob, full.name, full.id);
    };
    li.querySelector('.recent-del').onclick = async () => {
      if (!confirm(`Supprimer « ${d.name} » des récents ?`)) return;
      await deleteDoc(d.id);
      renderRecents();
    };
    list.appendChild(li);
  }
}

/* ---------------- Editor ---------------- */
function destroyEditor() {
  try {
    state.superdoc?.destroy();
  } catch (e) {
    console.warn(e);
  }
  state.superdoc = null;
  state.ready = false;
  $('#editor').innerHTML = '';
  $('#toolbar').innerHTML = '';
  $('#ruler').innerHTML = '';
}

function openDocument(source, name = 'Document1', id = null) {
  destroyEditor();
  show('editor-screen');
  loader(true);
  state.docId = id || newId();
  state.dirty = false;
  $('#doc-name').value = baseName(name);
  setSaveState('');

  const config = {
    selector: '#editor',
    toolbar: '#toolbar',
    documentMode: 'editing',
    role: 'editor',
    telemetry: { enabled: false },
    rulers: true,
    rulerContainer: '#ruler',
    title: baseName(name),
    user: { name: 'Utilisateur .WORKS', email: 'user@works.local' },
    modules: {
      toolbar: { responsiveToContainer: true },
      comments: false,
    },
    onReady: () => {
      state.ready = true;
      loader(false);
      fitWidth();
    },
    onEditorUpdate: () => markDirty(),
    onPaginationUpdate: ({ totalPages }) => {
      $('#status-left').textContent = `${totalPages} page${totalPages > 1 ? 's' : ''}`;
    },
    onZoomChange: ({ zoom, mode }) => {
      $('#zoom-fit').textContent = `${Math.round(zoom)}%`;
      $('#zoom-fit').classList.toggle('on', mode === 'fit-width');
    },
    onContentError: (e) => {
      console.error(e);
      loader(false);
      toast('Ce fichier contient des éléments non pris en charge.', 4000);
    },
    onException: (e) => console.error('SuperDoc exception', e),
  };
  if (source) config.document = source;

  try {
    state.superdoc = new SuperDoc(config);
  } catch (e) {
    console.error(e);
    loader(false);
    toast("Impossible d'ouvrir ce document.");
    show('home');
  }
  // Safety net: never leave the spinner forever.
  setTimeout(() => loader(false), 15000);
}

function fitWidth() {
  const sd = state.superdoc;
  if (!sd) return;
  try {
    if (window.innerWidth < 900 && sd.setZoomMode) sd.setZoomMode('fit-width');
  } catch (e) {
    console.warn(e);
  }
}

function markDirty() {
  if (!state.ready) return;
  state.dirty = true;
  setSaveState('Modifié');
  scheduleAutosave();
}

let autosaveTimer;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveLocal(true), 8000);
}

async function exportBlob() {
  if (!state.superdoc) throw new Error('no document');
  const blob = await state.superdoc.export({
    exportType: ['docx'],
    commentsType: 'external',
    triggerDownload: false,
    exportedName: docName(),
  });
  return blob instanceof Blob ? blob : new Blob([blob], { type: DOCX_MIME });
}

/** Save into the in-app library (IndexedDB). */
async function saveLocal(silent = false) {
  if (!state.superdoc || state.saving) return null;
  state.saving = true;
  setSaveState('Enregistrement…');
  try {
    const blob = await exportBlob();
    await putDoc({ id: state.docId, name: docName(), updated: Date.now(), size: blob.size, blob });
    state.dirty = false;
    setSaveState('Enregistré');
    if (!silent) toast('Document enregistré');
    return blob;
  } catch (e) {
    console.error(e);
    setSaveState('Erreur');
    if (!silent) toast("Échec de l'enregistrement");
    return null;
  } finally {
    state.saving = false;
  }
}

/** Save to library + write a real .docx file on the device. */
async function saveToDevice() {
  const blob = await saveLocal(true);
  if (!blob) return toast("Échec de l'enregistrement");
  const file = `${docName()}.docx`;
  if (!isNative) {
    downloadBlob(blob, file);
    return toast(`Téléchargé : ${file}`);
  }
  const data = await blobToBase64(blob);
  try {
    await Filesystem.writeFile({ path: `.WORKS/${file}`, data, directory: Directory.Documents, recursive: true });
    toast(`Enregistré dans Documents/.WORKS/${file}`, 3500);
  } catch (e) {
    console.warn('Documents not writable, using app storage', e);
    await Filesystem.writeFile({ path: file, data, directory: Directory.External, recursive: true });
    toast(`Enregistré : ${file} (stockage de l'app)`, 3500);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Share the .docx (open in Microsoft Word, Drive, Gmail, WhatsApp…). */
async function shareDoc() {
  const blob = (await saveLocal(true)) || (await exportBlob());
  const file = `${docName()}.docx`;
  if (!isNative) {
    const f = new File([blob], file, { type: DOCX_MIME });
    if (navigator.canShare?.({ files: [f] })) return navigator.share({ files: [f], title: file }).catch(() => {});
    downloadBlob(blob, file);
    return;
  }
  const data = await blobToBase64(blob);
  const { uri } = await Filesystem.writeFile({ path: `share/${file}`, data, directory: Directory.Cache, recursive: true });
  await Share.share({ title: file, files: [uri], dialogTitle: 'Ouvrir / partager le document' }).catch(() => {});
}

/* ---------------- File import ---------------- */
function pickFile() {
  const input = $('#file-input');
  input.value = '';
  input.click();
}
$('#file-input').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (!/\.(docx|docm|dotx)$/i.test(f.name)) {
    toast('Choisis un fichier Word (.docx)');
    return;
  }
  openDocument(f, f.name);
});

// Files opened from another app ("Ouvrir avec .WORKS") — provided by MainActivity.java
function takeNativeFile() {
  const bridge = window.DotWorksNative;
  if (!bridge?.takePendingFile) return;
  try {
    const raw = bridge.takePendingFile();
    if (!raw) return;
    const { name, data } = JSON.parse(raw);
    const blob = base64ToBlob(data);
    openDocument(new File([blob], name || 'Document.docx', { type: DOCX_MIME }), name);
  } catch (e) {
    console.error(e);
    toast("Impossible d'ouvrir ce fichier");
  }
}
window.addEventListener('dotworks-file', takeNativeFile);

/* ---------------- Wiring ---------------- */
async function goHome() {
  if (state.dirty) await saveLocal(true);
  destroyEditor();
  show('home');
  renderRecents();
}

$('#btn-new').onclick = () => openDocument(null, 'Document1');
$('#btn-open').onclick = pickFile;
$('#btn-back').onclick = goHome;
$('#btn-save').onclick = () => saveToDevice();
$('#btn-menu').onclick = () => $('#menu').classList.remove('hidden');
$('#menu').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (e.target.id === 'menu' || btn) $('#menu').classList.add('hidden');
  if (!btn) return;
  switch (btn.dataset.act) {
    case 'save':
      return saveToDevice();
    case 'share':
      return shareDoc();
    case 'download': {
      const blob = (await saveLocal(true)) || (await exportBlob());
      if (isNative) return saveToDevice();
      return downloadBlob(blob, `${docName()}.docx`);
    }
    case 'open':
      if (state.dirty) await saveLocal(true);
      return pickFile();
    case 'new':
      if (state.dirty) await saveLocal(true);
      return openDocument(null, 'Document1');
    case 'about':
      return alert(
        '.WORKS 1.0\nTraitement de texte compatible Microsoft Word (.docx)\n\nDéveloppé par SuperEssence Studio\n\nMoteur DOCX : SuperDoc (AGPL-3.0)',
      );
  }
});
$('#doc-name').addEventListener('change', () => {
  $('#doc-name').value = docName();
  markDirty();
});

const zoomBy = (d) => {
  const sd = state.superdoc;
  if (!sd?.getZoom) return;
  sd.setZoom(Math.min(300, Math.max(25, Math.round(sd.getZoom() + d))));
};
$('#zoom-in').onclick = () => zoomBy(10);
$('#zoom-out').onclick = () => zoomBy(-10);
$('#zoom-fit').onclick = () => state.superdoc?.setZoomMode?.('fit-width');

// Ctrl+S like Word
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.superdoc) {
    e.preventDefault();
    saveToDevice();
  }
});

// Autosave when the app goes to background
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.dirty) saveLocal(true);
});

if (isNative) {
  App.addListener('backButton', () => {
    if (!$('#menu').classList.contains('hidden')) return $('#menu').classList.add('hidden');
    if ($('#editor-screen').classList.contains('active')) return goHome();
    App.exitApp();
  });
  App.addListener('resume', takeNativeFile);
}

renderRecents();
takeNativeFile();
