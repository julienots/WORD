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
import { initRibbon, resetRibbonState } from './ribbon.js';
import { finalizeDocx, looksLikeDocx } from './fidelity.js';
import { initMobile, detachMobile, attachMobile } from './mobile.js';
import { closeDropdown } from './dialog.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const isNative = Capacitor.isNativePlatform();
const native = () => window.DotWorksNative || null;
const $ = (s) => document.querySelector(s);
const isPhone = () => Math.min(window.innerWidth, window.innerHeight) < 600;

const state = {
  superdoc: null,
  docId: null,
  /** Bytes of the file as it was opened (or last saved). Used to give back an identical file. */
  original: null,
  /** Content changed since `original`. */
  modified: false,
  /** Document name / metadata changed (no content change). */
  dirty: false,
  saving: false,
  ready: false,
  /** Where the document lives: { kind: 'uri', uri, writable } (Android) | { kind: 'handle', handle } (web) | null */
  source: null,
  /** Phone zoom: 'page' = whole page width, 'text' = text column fills the screen (bigger text). */
  fit: localStorage.getItem('works-fit') || (isPhone() ? 'text' : 'page'),
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

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const toBlob = (bytes) => new Blob([bytes], { type: DOCX_MIME });

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
        <span class="recent-meta"><b></b><small>${date} · ${Math.max(1, Math.round((d.size || 0) / 1024))} Ko${d.uri ? ' · lié au fichier' : ''}</small></span>
      </button>
      <button class="recent-del" aria-label="Supprimer">✕</button>`;
    li.querySelector('b').textContent = `${d.name}.docx`;
    li.querySelector('.recent-open').onclick = async () => {
      const full = await getDoc(d.id);
      if (!full) return;
      const bytes = new Uint8Array(await full.blob.arrayBuffer());
      openDocument(bytes, full.name, { id: full.id, source: full.uri ? { kind: 'uri', uri: full.uri, writable: true } : null });
    };
    li.querySelector('.recent-del').onclick = async () => {
      if (!confirm(`Supprimer « ${d.name} » des récents ?\n(le fichier d’origine n’est pas supprimé)`)) return;
      await deleteDoc(d.id);
      renderRecents();
    };
    list.appendChild(li);
  }
}

/* ---------------- Editor ---------------- */
function destroyEditor() {
  detachMobile();
  closeDropdown();
  try {
    state.superdoc?.destroy();
  } catch (e) {
    console.warn(e);
  }
  state.superdoc = null;
  window.__sd = null;
  state.ready = false;
  $('#editor').innerHTML = '';
  $('#toolbar').innerHTML = '';
  $('#ruler').innerHTML = '';
}

/**
 * Open a document.
 * @param {Uint8Array|null} bytes  .docx bytes (null = new blank document)
 * @param {string} name
 * @param {{ id?: string, source?: object, modified?: boolean, original?: Uint8Array, keepZoom?: boolean }} opts
 */
function openDocument(bytes, name = 'Document1', opts = {}) {
  if (bytes && !looksLikeDocx(bytes)) {
    toast('Ce fichier n’est pas un document Word (.docx) valide.', 4000);
    return;
  }
  destroyEditor();
  resetRibbonState();
  show('editor-screen');
  loader(true);
  state.docId = opts.id || newId();
  state.original = opts.original !== undefined ? opts.original : bytes;
  state.modified = !!opts.modified;
  state.dirty = state.modified;
  state.source = opts.source || null;
  $('#doc-name').value = baseName(name);
  setSaveState(state.modified ? 'Modifié' : '');
  updateLayoutLabels();

  let failed = false;
  const fail = (msg) => {
    if (failed) return;
    failed = true;
    loader(false);
    toast(msg, 5000);
    destroyEditor();
    show('home');
    renderRecents();
  };

  const config = {
    selector: '#editor',
    toolbar: '#toolbar',
    documentMode: 'editing',
    role: 'editor',
    telemetry: { enabled: false },
    rulers: !isPhone(),
    rulerContainer: '#ruler',
    measurementUnit: 'cm',
    title: baseName(name),
    user: { name: 'Utilisateur .WORKS', email: 'user@works.local' },
    modules: {
      toolbar: { responsiveToContainer: true },
      comments: window.innerWidth >= 900 ? { readOnly: false } : false,
    },
    onReady: () => {
      state.ready = true;
      loader(false);
      try {
        state.superdoc.setMeasurementUnit?.('cm');
      } catch (e) {
        console.warn(e);
      }
      fitWidth();
      attachMobile();
    },
    onEditorUpdate: () => markModified(),
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
    onException: (e) => {
      console.error('SuperDoc exception', e);
      if (!state.ready && (e?.code === 'source-load-failed' || e?.stage === 'document-init' || e?.severity === 'error')) {
        fail('Impossible d’ouvrir ce document : fichier endommagé ou format non pris en charge.');
      }
    },
  };
  if (bytes) config.document = new File([bytes], `${baseName(name)}.docx`, { type: DOCX_MIME });

  try {
    state.superdoc = new SuperDoc(config);
    window.__sd = state.superdoc;
  } catch (e) {
    console.error(e);
    fail("Impossible d'ouvrir ce document.");
  }
  // Safety net: a document that never becomes ready (damaged file) must not leave the user stuck.
  const opened = state.superdoc;
  setTimeout(() => {
    if (!state.ready && !failed && state.superdoc === opened) fail('Ce document ne s’ouvre pas : fichier endommagé ou trop complexe.');
  }, 45000);
}

function fitWidth() {
  const sd = state.superdoc;
  if (!sd || window.innerWidth >= 900) return;
  if (state.fit === 'text') return fitText();
  try {
    sd.setZoomMode?.('fit-width');
  } catch (e) {
    console.warn(e);
  }
}

/** Zoom so that the text column (page minus left/right margins) fills the screen width — like Word mobile. */
async function fitText() {
  const sd = state.superdoc;
  if (!sd) return;
  try {
    const s = (await sd.activeEditor.doc.sections.list())?.items?.[0] || {};
    const pageW = s.pageSetup?.width || 8.27;
    const ml = s.margins?.left ?? 1;
    const mr = s.margins?.right ?? 1;
    const textPx = Math.max(2, pageW - ml - mr) * 96;
    const avail = $('#doc-scroll').clientWidth - 12;
    const zoom = Math.max(25, Math.min(300, Math.floor((avail / textPx) * 100)));
    sd.setZoom(zoom);
    // bring the left margin of the text under the left edge of the screen
    const align = () => {
      const page = document.querySelector('.superdoc-page');
      const scroller = $('#doc-scroll');
      if (!page) return;
      const left = page.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
      scroller.scrollLeft = Math.max(0, left + ml * 96 * (zoom / 100) - 6);
    };
    requestAnimationFrame(() => requestAnimationFrame(align));
    setTimeout(align, 350);
  } catch (e) {
    console.warn(e);
    sd.setZoomMode?.('fit-width');
  }
}

function markModified() {
  if (!state.ready) return;
  state.modified = true;
  markDirty();
}
function markDirty() {
  state.dirty = true;
  setSaveState('Modifié');
  scheduleAutosave();
}

let autosaveTimer;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveLocal(true), 8000);
}

/**
 * The .docx bytes of the current document.
 * Unmodified → the original bytes, untouched. Modified → engine export + fidelity layer.
 */
async function currentBytes() {
  if (!state.superdoc) throw new Error('no document');
  if (!state.modified && state.original) return state.original;
  const blob = await state.superdoc.export({
    exportType: ['docx'],
    commentsType: 'external',
    triggerDownload: false,
    exportedName: docName(),
  });
  const raw = new Uint8Array(await (blob instanceof Blob ? blob : new Blob([blob])).arrayBuffer());
  try {
    const { bytes, report } = finalizeDocx(raw, state.original);
    window.__lastFidelityReport = report;
    return bytes;
  } catch (e) {
    if (e.report) throw e; // a broken package must never be written
    console.warn('fidelity layer skipped', e);
    return raw;
  }
}
window.__currentBytes = currentBytes;

/** Save into the in-app library (IndexedDB). */
async function saveLocal(silent = false) {
  if (!state.superdoc || state.saving || !state.ready) return null;
  state.saving = true;
  setSaveState('Enregistrement…');
  try {
    const bytes = await currentBytes();
    await putDoc({
      id: state.docId,
      name: docName(),
      updated: Date.now(),
      size: bytes.length,
      blob: toBlob(bytes),
      uri: state.source?.kind === 'uri' ? state.source.uri : undefined,
    });
    state.dirty = false;
    setSaveState(state.modified ? 'Brouillon enregistré' : 'Enregistré');
    if (!silent) toast('Document enregistré');
    return bytes;
  } catch (e) {
    console.error(e);
    setSaveState('Erreur');
    toast(e.report ? 'Enregistrement bloqué : le fichier produit serait illisible par Word.' : "Échec de l'enregistrement", 4000);
    return null;
  } finally {
    state.saving = false;
  }
}

/** The file now on disk equals what is in the editor: it becomes the new reference. */
function committed(bytes) {
  state.original = bytes;
  state.modified = false;
  state.dirty = false;
  setSaveState('Enregistré');
}

/** "Enregistrer": overwrite the file that was opened when possible, else keep a copy in Documents/.WORKS. */
async function save() {
  const bytes = await saveLocal(true);
  if (!bytes) return;
  const src = state.source;
  if (src?.kind === 'uri' && src.writable && native()?.writeFile) {
    const res = native().writeFile(src.uri, bytesToBase64(bytes));
    if (res === 'ok') {
      committed(bytes);
      await saveLocal(true);
      return toast(`Enregistré : ${docName()}.docx (fichier d’origine)`);
    }
    console.warn('write back failed', res);
    src.writable = false;
    toast('Le fichier d’origine est en lecture seule : choisis où enregistrer.', 3500);
    return saveAs(bytes);
  }
  if (src?.kind === 'handle') {
    try {
      const w = await src.handle.createWritable();
      await w.write(bytes);
      await w.close();
      committed(bytes);
      return toast(`Enregistré : ${src.handle.name}`);
    } catch (e) {
      console.warn(e);
    }
  }
  if (!src && (native()?.createDocument || window.showSaveFilePicker)) return saveAs(bytes);
  return saveCopy(bytes);
}

/** "Enregistrer sous…": system file picker (Android SAF / File System Access), the document then stays linked to it. */
async function saveAs(bytes) {
  bytes = bytes || (await saveLocal(true));
  if (!bytes) return;
  const file = `${docName()}.docx`;
  if (native()?.createDocument) {
    pendingSaveAs = bytes;
    native().createDocument(file, bytesToBase64(bytes));
    return;
  }
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: file, types: [{ description: 'Document Word', accept: { [DOCX_MIME]: ['.docx'] } }] });
      const w = await handle.createWritable();
      await w.write(bytes);
      await w.close();
      state.source = { kind: 'handle', handle };
      $('#doc-name').value = baseName(handle.name);
      committed(bytes);
      return toast(`Enregistré : ${handle.name}`);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      console.warn(e);
    }
  }
  return saveCopy(bytes);
}
let pendingSaveAs = null;
// Result of the Android "Enregistrer sous" picker (sent by MainActivity).
window.addEventListener('dotworks-saved', (e) => {
  const d = e.detail || {};
  const bytes = pendingSaveAs;
  pendingSaveAs = null;
  if (!d.ok) {
    if (d.error && d.error !== 'cancelled') toast(`Échec de l’enregistrement : ${d.error}`, 4000);
    return;
  }
  state.source = { kind: 'uri', uri: d.uri, writable: true };
  if (d.name) $('#doc-name').value = baseName(d.name);
  if (bytes) committed(bytes);
  saveLocal(true);
  toast(`Enregistré : ${d.name || docName() + '.docx'}`);
});

/** Copy in Documents/.WORKS (Android) or a download (web). */
async function saveCopy(bytes) {
  bytes = bytes || (await saveLocal(true));
  if (!bytes) return;
  const file = `${docName()}.docx`;
  if (!isNative) {
    downloadBlob(toBlob(bytes), file);
    return toast(`Téléchargé : ${file}`);
  }
  const data = bytesToBase64(bytes);
  try {
    await Filesystem.writeFile({ path: `.WORKS/${file}`, data, directory: Directory.Documents, recursive: true });
    toast(`Copie enregistrée dans Documents/.WORKS/${file}`, 3500);
  } catch (e) {
    console.warn('Documents not writable, using app storage', e);
    await Filesystem.writeFile({ path: file, data, directory: Directory.External, recursive: true });
    toast(`Copie enregistrée : ${file} (stockage de l'app)`, 3500);
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

/** Share the .docx (open in Microsoft Word, LibreOffice, Drive, Gmail, WhatsApp…). */
async function shareDoc() {
  const bytes = (await saveLocal(true)) || (await currentBytes());
  const file = `${docName()}.docx`;
  if (!isNative) {
    const f = new File([bytes], file, { type: DOCX_MIME });
    if (navigator.canShare?.({ files: [f] })) return navigator.share({ files: [f], title: file }).catch(() => {});
    downloadBlob(toBlob(bytes), file);
    return;
  }
  const { uri } = await Filesystem.writeFile({ path: `share/${file}`, data: bytesToBase64(bytes), directory: Directory.Cache, recursive: true });
  await Share.share({ title: file, files: [uri], dialogTitle: 'Ouvrir / partager le document' }).catch(() => {});
}

/** Re-checks the bytes that would be saved, like Word / LibreOffice would read them. */
async function checkCompat() {
  loader(true, 'Vérification…');
  try {
    const bytes = await currentBytes();
    const { report } = finalizeDocx(bytes, state.original);
    const same = !state.modified && state.original;
    const lines = [
      same ? '✔ Aucune modification : le fichier est identique à l’original, octet pour octet.' : '✔ Seules tes modifications diffèrent de l’original.',
      '✔ Structure XML valide (Word et LibreOffice).',
      report.reordered.length ? `✔ Ordre des éléments corrigé pour Word (${report.reordered.length} partie(s)).` : '✔ Ordre des éléments conforme au schéma Word.',
      window.__lastFidelityReport?.restored?.length ? `✔ ${window.__lastFidelityReport.restored.length} élément(s) d’origine préservé(s).` : '✔ Toutes les parties du document d’origine sont conservées.',
      `Taille : ${Math.max(1, Math.round(bytes.length / 1024))} Ko`,
    ];
    loader(false);
    alert(`Compatibilité Word / LibreOffice\n\n${lines.join('\n')}`);
  } catch (e) {
    loader(false);
    alert(`⚠ Problème détecté : ${e.message}\nLe fichier ne sera pas écrasé.`);
  }
}

/* ---------------- Page / Text zoom ---------------- */
function updateLayoutLabels() {
  const text = state.fit === 'text';
  $('#btn-layout').textContent = text ? '🔍 Texte' : '📄 Page';
  $('#menu-layout').textContent = text ? 'Afficher la page entière' : 'Agrandir le texte à la largeur de l’écran';
}
function toggleLayout() {
  state.fit = state.fit === 'text' ? 'page' : 'text';
  localStorage.setItem('works-fit', state.fit);
  updateLayoutLabels();
  if (state.fit === 'text') fitText();
  else state.superdoc?.setZoomMode?.('fit-width');
}

/* ---------------- File import ---------------- */
async function pickFile() {
  if (native()?.openDocument) return native().openDocument(); // Android picker with write access
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: [{ description: 'Document Word', accept: { [DOCX_MIME]: ['.docx', '.docm', '.dotx'] } }] });
      const f = await handle.getFile();
      return openDocument(new Uint8Array(await f.arrayBuffer()), f.name, { source: { kind: 'handle', handle } });
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  const input = $('#file-input');
  input.value = '';
  input.click();
}
$('#file-input').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (!/\.(docx|docm|dotx)$/i.test(f.name)) {
    toast('Choisis un fichier Word (.docx)');
    return;
  }
  openDocument(new Uint8Array(await f.arrayBuffer()), f.name);
});

// Files opened from another app ("Ouvrir avec .WORKS") or from the picker — provided by MainActivity.java
async function takeNativeFile() {
  const bridge = native();
  if (!bridge?.takePendingFile) return;
  try {
    const raw = bridge.takePendingFile();
    if (!raw) return;
    const { name, data, uri, writable } = JSON.parse(raw);
    if (state.superdoc && state.dirty) await saveLocal(true);
    openDocument(base64ToBytes(data), name || 'Document.docx', { source: uri ? { kind: 'uri', uri, writable: !!writable } : null });
  } catch (e) {
    console.error(e);
    toast("Impossible d'ouvrir ce fichier");
  }
}
window.addEventListener('dotworks-file', takeNativeFile);
window.addEventListener('dotworks-error', (e) => toast(`Impossible de lire ce fichier : ${e.detail?.error || ''}`, 4000));

/* ---------------- Wiring ---------------- */
async function goHome() {
  if (state.modified && state.source && confirm('Enregistrer les modifications dans le fichier ?')) await save();
  if (state.dirty) await saveLocal(true);
  destroyEditor();
  show('home');
  renderRecents();
}

$('#btn-new').onclick = () => openDocument(null, 'Document1');
$('#btn-open').onclick = pickFile;
$('#btn-back').onclick = goHome;
$('#btn-save').onclick = () => save();
$('#btn-layout').onclick = toggleLayout;
$('#btn-menu').onclick = () => {
  const src = state.source;
  $('#menu-save-sub').textContent =
    src?.kind === 'uri' && src.writable ? 'Écrase le fichier d’origine' : src?.kind === 'handle' ? `Écrase ${src.handle.name}` : 'Choisir où enregistrer le .docx';
  $('#menu').classList.remove('hidden');
};
$('#menu').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (e.target.id === 'menu' || btn) $('#menu').classList.add('hidden');
  if (!btn) return;
  switch (btn.dataset.act) {
    case 'save':
      return save();
    case 'saveas':
      return saveAs();
    case 'share':
      return shareDoc();
    case 'download':
      return saveCopy();
    case 'layout':
      return toggleLayout();
    case 'check':
      return checkCompat();
    case 'open':
      if (state.dirty) await saveLocal(true);
      return pickFile();
    case 'new':
      if (state.dirty) await saveLocal(true);
      return openDocument(null, 'Document1');
    case 'about':
      return alert(
        '.WORKS 1.1\nTraitement de texte compatible Microsoft Word (.docx) et LibreOffice\n\nDéveloppé par SuperEssence Studio\n\nMoteur DOCX : SuperDoc (AGPL-3.0)',
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

// Rotation / resize: keep the chosen fit
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.ready && !document.body.classList.contains('keyboard-open')) fitWidth();
  }, 250);
});

// Ctrl+S like Word
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.superdoc) {
    e.preventDefault();
    save();
  }
});

// Autosave when the app goes to background
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.dirty) saveLocal(true);
});

if (isNative) {
  App.addListener('backButton', () => {
    if (document.querySelector('.dlg-backdrop')) return document.querySelector('.dlg-backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    if (document.querySelector('.rb-menu')) return closeDropdown();
    if (!$('#menu').classList.contains('hidden')) return $('#menu').classList.add('hidden');
    if ($('#editor-screen').classList.contains('active')) return goHome();
    App.exitApp();
  });
  App.addListener('resume', takeNativeFile);
}

initRibbon({ getSuperdoc: () => state.superdoc, toast, toggleLayout, fitText });
initMobile({ getSuperdoc: () => state.superdoc, toast });
renderRecents();
takeNativeFile();
