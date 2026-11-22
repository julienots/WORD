// .WORKS — DOCX word processor by SuperEssence Studio
import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';
import './fonts.css';
import './style.css';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
import { putDoc, getDoc, listDocs, deleteDoc, patchDoc, addVersion, listVersions, getVersion } from './store.js';
import { initRibbon, resetRibbonState, addRibbonGroup } from './ribbon.js';
import { formDialog, infoDialog, actionSheet, confirmDialog, promptDialog } from './dialog.js';
import { settings, setSettings, applyTheme, onSettings, isDark } from './settings.js';
import { TEMPLATES, textToHtml, mdToHtml, insertHtmlAtStart } from './templates.js';

/* global __APP_VERSION__ */
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const isNative = Capacitor.isNativePlatform();
const nativeBridge = () => window.DotWorksNative;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const state = {
  superdoc: null,
  docId: null,
  meta: {},
  dirty: false,
  saving: false,
  ready: false,
  pendingHtml: null,
  flowMode: 'paginated',
  totalPages: 1,
  lastVersionAt: 0,
  printing: null,
};
const sdoc = () => state.superdoc?.activeEditor?.doc;

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
const setSaveState = (text) => ($('#save-state').textContent = text);
const baseName = (n) => (n || 'Document1').replace(/\.(docx|docm|dotx|md|markdown|txt|html?)$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Document1';
const docName = () => baseName($('#doc-name').value);
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const plural = (n, w) => `${n.toLocaleString('fr-FR')} ${w}${n > 1 ? 's' : ''}`;
const fmtSize = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`);
const fmtDate = (t) => {
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `Aujourd'hui, ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Hier, ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};

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
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------------- Home: templates ---------------- */
function renderTemplates() {
  const host = $('#templates');
  host.innerHTML = '';
  for (const t of TEMPLATES) {
    const b = document.createElement('button');
    b.className = 'tpl';
    b.innerHTML = `<span class="tpl-page" style="--accent:${t.accent}"><i></i><i></i><i></i><i></i><i></i></span><b>${esc(t.name)}</b><small>${esc(t.hint)}</small>`;
    b.onclick = () => openDocument(null, t.name, null, { html: t.html() });
    host.appendChild(b);
  }
}

/* ---------------- Home: recents ---------------- */
let recentQuery = '';
async function renderRecents() {
  const list = $('#recent');
  let docs = await listDocs().catch(() => []);
  const total = docs.length;
  const q = recentQuery.trim().toLowerCase();
  if (q) docs = docs.filter((d) => d.name.toLowerCase().includes(q));
  const sort = settings().sort;
  docs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (sort === 'name' ? a.name.localeCompare(b.name, 'fr') : b.updated - a.updated));
  $('#recent-sort').textContent = sort === 'name' ? 'Nom ▾' : 'Date ▾';
  $('#recent-search-wrap').style.display = total > 3 ? '' : 'none';
  list.innerHTML = '';
  const empty = $('#recent-empty');
  empty.style.display = docs.length ? 'none' : 'block';
  empty.innerHTML = total && q ? 'Aucun document ne correspond.' : "Aucun document pour l'instant.<br />Importe un fichier Word ou crée un document.";
  for (const d of docs) {
    const li = document.createElement('li');
    const extra = [fmtDate(d.updated), fmtSize(d.size || 0)];
    if (d.words != null) extra.push(plural(d.words, 'mot'));
    li.innerHTML = `
      <button class="recent-open">
        <span class="file-ico">W${d.pinned ? '<em>★</em>' : ''}</span>
        <span class="recent-meta"><b></b><small>${esc(extra.join(' · '))}</small></span>
      </button>
      <button class="recent-more" aria-label="Actions">⋯</button>`;
    li.querySelector('b').textContent = `${d.name}.docx`;
    li.querySelector('.recent-open').onclick = () => openRecent(d.id);
    li.querySelector('.recent-more').onclick = () => recentActions(d);
    list.appendChild(li);
  }
}
async function openRecent(id) {
  const full = await getDoc(id);
  if (full) openDocument(full.blob, full.name, full.id, { meta: full });
  else toast('Document introuvable');
}
async function recentActions(d) {
  const act = await actionSheet({
    title: `${d.name}.docx`,
    items: [
      { label: 'Ouvrir', value: 'open' },
      { label: 'Renommer', value: 'rename' },
      { label: 'Dupliquer', value: 'dup' },
      { label: 'Partager / Ouvrir dans Word', value: 'share' },
      { label: d.pinned ? 'Désépingler' : 'Épingler en haut', value: 'pin' },
      { label: 'Historique des versions', value: 'versions' },
      { separator: true },
      { label: 'Supprimer', value: 'delete', danger: true },
    ],
  });
  if (!act) return;
  if (act === 'open') return openRecent(d.id);
  if (act === 'rename') {
    const name = await promptDialog('Renommer', 'Nom du document', d.name);
    if (name) await patchDoc(d.id, { name: baseName(name) });
  } else if (act === 'dup') {
    const full = await getDoc(d.id);
    if (full) await putDoc({ ...full, id: newId(), name: `${full.name} (copie)`, updated: Date.now(), pinned: false });
    toast('Copie créée');
  } else if (act === 'share') {
    const full = await getDoc(d.id);
    if (full) await shareBlob(full.blob, `${full.name}.docx`, DOCX_MIME);
  } else if (act === 'pin') {
    await patchDoc(d.id, { pinned: !d.pinned });
  } else if (act === 'versions') {
    return showVersions(d.id, d.name, false);
  } else if (act === 'delete') {
    if (!(await confirmDialog('Supprimer', `Supprimer « ${d.name} » et son historique ? Cette action est définitive.`, 'Supprimer'))) return;
    await deleteDoc(d.id);
    toast('Document supprimé');
  }
  renderRecents();
}
$('#recent-search').addEventListener('input', (e) => {
  recentQuery = e.target.value;
  renderRecents();
});
$('#recent-sort').onclick = () => {
  setSettings({ sort: settings().sort === 'name' ? 'date' : 'name' });
  renderRecents();
};

/* ---------------- Editor ---------------- */
function destroyEditor() {
  stopSpeaking();
  closeNav();
  setFocusMode(false);
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

/**
 * Open a document in the editor.
 * source: File/Blob of a .docx, or null for a blank document.
 * opts.html: content inserted into the blank document (templates, imported .md/.txt/.html).
 */
function openDocument(source, name = 'Document1', id = null, opts = {}) {
  destroyEditor();
  resetRibbonState();
  show('editor-screen');
  loader(true, opts.loading || 'Ouverture…');
  state.docId = id || newId();
  state.meta = opts.meta ? { pinned: !!opts.meta.pinned, created: opts.meta.created } : { created: Date.now() };
  state.dirty = false;
  state.pendingHtml = opts.html || null;
  state.flowMode = opts.flowMode || 'paginated';
  state.lastVersionAt = 0;
  state.totalPages = 1;
  $('#doc-name').value = baseName(name);
  setSaveState('');
  updateStatus();
  document.body.classList.toggle('web-layout', state.flowMode === 'semantic');
  document.querySelector('[data-rb="weblayout"]')?.classList.toggle('on', state.flowMode === 'semantic');

  const s = settings();
  const config = {
    selector: '#editor',
    toolbar: '#toolbar',
    documentMode: 'editing',
    role: 'editor',
    telemetry: { enabled: false },
    rulers: state.flowMode !== 'semantic',
    rulerContainer: '#ruler',
    title: baseName(name),
    user: { name: s.author || 'Utilisateur .WORKS', email: 'user@works.local' },
    layoutEngineOptions: { flowMode: state.flowMode },
    modules: {
      toolbar: { responsiveToContainer: true },
      comments: window.innerWidth >= 900 ? { readOnly: false } : false,
      surfaces: {
        passwordPrompt: {
          title: 'Mot de passe requis',
          invalidTitle: 'Mot de passe incorrect',
          description: 'Ce document Word est protégé. Saisis son mot de passe pour l’ouvrir.',
          placeholder: 'Mot de passe',
          inputAriaLabel: 'Mot de passe du document',
          submitLabel: 'Ouvrir',
          cancelLabel: 'Annuler',
          busyLabel: 'Déchiffrement…',
          invalidMessage: 'Mot de passe incorrect. Réessaie.',
          timeoutMessage: 'Le déchiffrement a pris trop de temps. Réessaie.',
          genericErrorMessage: 'Impossible de déchiffrer ce document.',
        },
      },
    },
    onReady: () => onEditorReady(opts),
    onEditorUpdate: () => markDirty(),
    onTransaction: () => scheduleHistoryRefresh(),
    onPaginationUpdate: ({ totalPages }) => {
      state.totalPages = totalPages || 1;
      updateCurrentPage();
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
    window.__sd = state.superdoc;
  } catch (e) {
    console.error(e);
    loader(false);
    toast("Impossible d'ouvrir ce document.");
    show('home');
  }
  // Safety net: never leave the spinner forever.
  setTimeout(() => loader(false), 20000);
}

async function onEditorReady(opts) {
  try {
    state.superdoc.setMeasurementUnit?.('cm');
  } catch (e) {
    console.warn(e);
  }
  applyZoomSetting();
  if (state.pendingHtml && sdoc()) {
    const html = state.pendingHtml;
    state.pendingHtml = null;
    try {
      const r = await insertHtmlAtStart(sdoc(), html, { spacing: opts.spacing !== false });
      if (r?.success === false) console.warn(r);
    } catch (e) {
      console.error(e);
      toast("Une partie du contenu n'a pas pu être importée");
    }
  }
  state.ready = true;
  loader(false);
  if (opts.keepDirty || opts.html) markDirty();
  applySpellcheck();
  refreshHistory();
  refreshStats();
}

function applyZoomSetting() {
  const sd = state.superdoc;
  if (!sd) return;
  try {
    if (state.flowMode === 'semantic') sd.setZoom(100);
    else if (settings().zoom === '100') sd.setZoom(100);
    else if (window.innerWidth < 900 && sd.setZoomMode) sd.setZoomMode('fit-width');
  } catch (e) {
    console.warn(e);
  }
}

function applySpellcheck() {
  const on = !!settings().spellcheck;
  document.querySelectorAll('#editor [contenteditable], #editor textarea').forEach((el) => {
    el.spellcheck = on;
    el.setAttribute('autocorrect', on ? 'on' : 'off');
  });
}

function markDirty() {
  if (!state.ready) return;
  state.dirty = true;
  setSaveState('Modifié');
  scheduleAutosave();
  scheduleStats();
  scheduleHistoryRefresh();
}

let autosaveTimer;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  const sec = Number(settings().autosave) || 0;
  if (sec > 0) autosaveTimer = setTimeout(() => saveLocal(true), sec * 1000);
}

/* ---------------- Undo / redo ---------------- */
let histTimer;
function scheduleHistoryRefresh() {
  clearTimeout(histTimer);
  histTimer = setTimeout(refreshHistory, 120);
}
function refreshHistory() {
  let h = null;
  try {
    h = sdoc()?.history?.get();
  } catch {
    /* not ready */
  }
  $('#btn-undo').disabled = !h?.canUndo;
  $('#btn-redo').disabled = !h?.canRedo;
}
function historyAction(kind) {
  try {
    const r = sdoc()?.history?.[kind]();
    if (r?.noop) toast(kind === 'undo' ? 'Rien à annuler' : 'Rien à rétablir', 1200);
  } catch (e) {
    console.warn(e);
  }
  refreshHistory();
}
$('#btn-undo').onclick = () => historyAction('undo');
$('#btn-redo').onclick = () => historyAction('redo');
$('#btn-undo').onmousedown = $('#btn-redo').onmousedown = (e) => e.preventDefault();

/* ---------------- Status bar: page & words ---------------- */
let lastCounts = null;
let statsTimer;
function scheduleStats() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(refreshStats, 700);
}
async function refreshStats() {
  try {
    const info = await sdoc()?.info({});
    if (info?.counts) lastCounts = info.counts;
  } catch {
    /* ignore */
  }
  updateStatus();
}
function updateStatus() {
  const w = lastCounts?.words ?? 0;
  $('#status-words').textContent = plural(w, 'mot');
}
function currentPage() {
  const scroller = $('#doc-scroll');
  const r = scroller.getBoundingClientRect();
  const mid = r.top + r.height / 3;
  let best = null;
  for (const p of document.querySelectorAll('#editor .superdoc-page')) {
    const pr = p.getBoundingClientRect();
    if (pr.top <= mid && pr.bottom >= mid) return Number(p.dataset.pageNumber) || 1;
    if (pr.top <= mid) best = p;
  }
  return Number(best?.dataset.pageNumber) || 1;
}
function updateCurrentPage() {
  const total = state.totalPages || 1;
  $('#status-page').textContent = state.flowMode === 'semantic' ? 'Mode Web' : `Page ${Math.min(currentPage(), total)} sur ${total}`;
}
let scrollRaf;
$('#doc-scroll').addEventListener('scroll', () => {
  cancelAnimationFrame(scrollRaf);
  scrollRaf = requestAnimationFrame(updateCurrentPage);
}, { passive: true });

async function goToPage() {
  if (state.flowMode === 'semantic') return;
  const total = state.totalPages || 1;
  const r = await formDialog({ title: 'Atteindre', fields: [{ name: 'p', label: `Numéro de page (1 – ${total})`, type: 'number', value: currentPage(), min: 1, max: total }], ok: 'Atteindre' });
  if (!r || !Number.isFinite(r.p)) return;
  const n = Math.min(total, Math.max(1, Math.round(r.p)));
  const scroller = $('#doc-scroll');
  const pages = [...document.querySelectorAll('#editor .superdoc-page')];
  const exact = pages.find((p) => Number(p.dataset.pageNumber) === n);
  if (exact) return exact.scrollIntoView({ block: 'start' });
  // virtualized: estimate from the page stride, then refine once the page is painted
  scroller.scrollTop = ((n - 1) / total) * scroller.scrollHeight;
  setTimeout(() => {
    const p = document.querySelector(`#editor .superdoc-page[data-page-number="${n}"]`);
    p?.scrollIntoView({ block: 'start' });
  }, 350);
}
$('#status-page').onclick = goToPage;
$('#status-words').onclick = () => showStats();

async function showStats() {
  await refreshStats();
  const c = lastCounts || {};
  const rows = [
    ['Pages', state.flowMode === 'semantic' ? '—' : state.totalPages],
    ['Mots', c.words ?? 0],
    ['Caractères (espaces compris)', c.characters ?? 0],
    ['Paragraphes', c.paragraphs ?? 0],
    ['Titres', c.headings ?? 0],
    ['Tableaux', c.tables ?? 0],
    ['Images', c.images ?? 0],
    ['Commentaires', c.comments ?? 0],
    ['Modifications suivies', c.trackedChanges ?? 0],
  ];
  const minutes = Math.max(1, Math.round((c.words || 0) / 230));
  infoDialog(
    'Statistiques',
    `<table class="stats">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${Number(v).toLocaleString?.('fr-FR') ?? v}</td></tr>`).join('')}
     <tr><td>Temps de lecture estimé</td><td>${minutes} min</td></tr></table>`,
  );
}

/* ---------------- Save / export ---------------- */
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

/** Save into the in-app library (IndexedDB) and keep a version snapshot. */
async function saveLocal(silent = false, manual = !silent) {
  if (!state.superdoc || state.saving || !state.ready) return null;
  state.saving = true;
  setSaveState('Enregistrement…');
  try {
    const blob = await exportBlob();
    await refreshStats();
    const now = Date.now();
    await putDoc({
      id: state.docId,
      name: docName(),
      updated: now,
      created: state.meta.created || now,
      pinned: !!state.meta.pinned,
      size: blob.size,
      words: lastCounts?.words,
      pages: state.totalPages,
      blob,
    });
    if (settings().versions && (manual || now - state.lastVersionAt > 5 * 60 * 1000)) {
      await addVersion(state.docId, blob, { name: docName(), words: lastCounts?.words, manual }).catch(console.warn);
      state.lastVersionAt = now;
    }
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

/** Write any file to Documents/.WORKS (native) or download it (web). Returns a shareable uri on native. */
async function writeUserFile(blobOrText, filename, { textual = false } = {}) {
  if (!isNative) {
    downloadBlob(blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: 'text/plain;charset=utf-8' }), filename);
    toast(`Téléchargé : ${filename}`);
    return null;
  }
  const opts = textual ? { data: blobOrText, encoding: Encoding.UTF8 } : { data: await blobToBase64(blobOrText) };
  try {
    const r = await Filesystem.writeFile({ path: `.WORKS/${filename}`, directory: Directory.Documents, recursive: true, ...opts });
    toast(`Enregistré dans Documents/.WORKS/${filename}`, 3500);
    return r.uri;
  } catch (e) {
    console.warn('Documents not writable, using app storage', e);
    const r = await Filesystem.writeFile({ path: filename, directory: Directory.External, recursive: true, ...opts });
    toast(`Enregistré : ${filename} (stockage de l'app)`, 3500);
    return r.uri;
  }
}

/** Save to library + write a real .docx file on the device. */
async function saveToDevice() {
  const blob = await saveLocal(true, true);
  if (!blob) return toast("Échec de l'enregistrement");
  await writeUserFile(blob, `${docName()}.docx`);
}

async function shareBlob(blob, file, mime) {
  if (!isNative) {
    const f = new File([blob], file, { type: mime });
    if (navigator.canShare?.({ files: [f] })) return navigator.share({ files: [f], title: file }).catch(() => {});
    return downloadBlob(blob, file);
  }
  const data = await blobToBase64(blob);
  const { uri } = await Filesystem.writeFile({ path: `share/${file}`, data, directory: Directory.Cache, recursive: true });
  await Share.share({ title: file, files: [uri], dialogTitle: 'Ouvrir / partager le document' }).catch(() => {});
}

/** Share the .docx (open in Microsoft Word, Drive, Gmail, WhatsApp…). */
async function shareDoc() {
  const blob = (await saveLocal(true)) || (await exportBlob());
  await shareBlob(blob, `${docName()}.docx`, DOCX_MIME);
}

async function saveAsCopy() {
  const name = await promptDialog('Enregistrer une copie', 'Nom de la copie', `${docName()} (copie)`, 'Enregistrer');
  if (!name) return;
  state.docId = newId();
  state.meta = { created: Date.now() };
  state.lastVersionAt = 0;
  $('#doc-name').value = baseName(name);
  state.dirty = true;
  const blob = await saveLocal(true);
  if (blob) toast(`Copie enregistrée : ${baseName(name)}`);
}

/* ---------------- Export: Markdown / HTML / text ---------------- */
async function exportOther() {
  const fmt = await actionSheet({
    title: 'Exporter',
    items: [
      { label: 'Markdown (.md)', hint: 'Titres, listes, gras, liens, tableaux', value: 'md' },
      { label: 'Page web (.html)', hint: 'Lisible dans tout navigateur', value: 'html' },
      { label: 'Texte brut (.txt)', hint: 'Sans mise en forme', value: 'txt' },
    ],
  });
  if (!fmt || !sdoc()) return;
  const d = sdoc();
  try {
    let content;
    let mime;
    if (fmt === 'md') {
      content = String(await d.getMarkdown({})).replace(/^\s+/, '');
      mime = 'text/markdown';
    } else if (fmt === 'html') {
      const body = await d.getHtml({});
      content = `<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(docName())}</title>
<style>body{font-family:Calibri,Carlito,Arial,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.5;color:#222}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px}h1,h2,h3{color:#2F5496}img{max-width:100%}</style>
</head><body>\n${body}\n</body></html>`;
      mime = 'text/html';
    } else {
      content = String(await d.getText({}));
      mime = 'text/plain';
    }
    const file = `${docName()}.${fmt}`;
    const act = await actionSheet({
      title: file,
      items: [
        { label: 'Enregistrer sur l’appareil', value: 'save' },
        { label: 'Partager', value: 'share' },
      ],
    });
    if (act === 'save') await writeUserFile(content, file, { textual: true });
    else if (act === 'share') await shareBlob(new Blob([content], { type: `${mime};charset=utf-8` }), file, mime);
  } catch (e) {
    console.error(e);
    toast(`Export impossible : ${e.message || e}`);
  }
}

/* ---------------- PDF / print ---------------- */
// SuperDoc only paints the visible pages, so printing uses a hidden, non-virtualized read-only copy.
async function printDocument() {
  if (!state.superdoc) return;
  loader(true, 'Préparation du PDF…');
  let blob;
  try {
    blob = await exportBlob();
  } catch (e) {
    loader(false);
    return toast('Export impossible');
  }
  cleanupPrint();
  const host = $('#print-host');
  host.innerHTML = '<div id="print-doc"></div>';
  let total = 0;
  const ready = new Promise((resolve) => {
    try {
      state.printing = new SuperDoc({
        selector: '#print-doc',
        document: new File([blob], `${docName()}.docx`, { type: DOCX_MIME }),
        documentMode: 'viewing',
        role: 'viewer',
        telemetry: { enabled: false },
        rulers: false,
        layoutEngineOptions: { flowMode: 'paginated', virtualization: { enabled: false } },
        modules: { comments: false, toolbar: false },
        onReady: () => resolve(true),
        onPaginationUpdate: ({ totalPages }) => (total = totalPages),
        onException: (e) => console.warn('print', e),
      });
    } catch (e) {
      console.error(e);
      resolve(false);
    }
  });
  const ok = await Promise.race([ready, new Promise((r) => setTimeout(() => r(false), 30000))]);
  if (!ok) {
    loader(false);
    cleanupPrint();
    return toast("Impossible de préparer l'impression");
  }
  try {
    state.printing.setZoom?.(100);
  } catch {
    /* ignore */
  }
  // wait until every page is painted
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const pages = host.querySelectorAll('.superdoc-page');
    const filled = host.querySelectorAll('.superdoc-page[data-v2-page-content="filled"]').length;
    if (pages.length && pages.length >= (total || 1) && filled >= pages.length) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 400));
  const first = host.querySelector('.superdoc-page');
  const w = first ? parseFloat(first.style.width) || first.offsetWidth : 816;
  const h = first ? parseFloat(first.style.height) || first.offsetHeight : 1056;
  let st = document.getElementById('print-page-style');
  if (!st) {
    st = document.createElement('style');
    st.id = 'print-page-style';
    document.head.appendChild(st);
  }
  st.textContent = `@page { size: ${w}px ${h}px; margin: 0; }`;
  document.body.classList.add('printing');
  loader(false);
  if (isNative && nativeBridge()?.print) {
    nativeBridge().print(docName());
    // The Android print dialog renders asynchronously; clean up when the user comes back.
    $('#print-done').classList.remove('hidden');
  } else {
    window.addEventListener('afterprint', cleanupPrint, { once: true });
    window.print();
  }
}
function cleanupPrint() {
  document.body.classList.remove('printing');
  $('#print-done')?.classList.add('hidden');
  try {
    state.printing?.destroy();
  } catch {
    /* ignore */
  }
  state.printing = null;
  $('#print-host').innerHTML = '';
}
const printDone = document.createElement('div');
printDone.id = 'print-done';
printDone.className = 'print-done hidden';
printDone.innerHTML = '<span>Impression / PDF en cours…</span><button class="chip">Terminé</button>';
printDone.querySelector('button').onclick = cleanupPrint;
document.body.appendChild(printDone);

/* ---------------- Version history ---------------- */
async function showVersions(docId = state.docId, name = docName(), inEditor = true) {
  const list = await listVersions(docId).catch(() => []);
  if (!list.length) return infoDialog('Historique des versions', '<p>Aucune version enregistrée pour ce document.</p><p style="color:#888">Une version est créée à chaque enregistrement manuel, et toutes les 5 minutes pendant l’enregistrement automatique.</p>');
  const vid = await actionSheet({
    title: `Versions de « ${name} »`,
    items: list.map((v) => ({
      value: v.vid,
      html: `<b>${esc(fmtDate(v.created))}${v.manual ? ' · enregistrée' : ' · auto'}</b><small>${esc([fmtSize(v.size || 0), v.words != null ? plural(v.words, 'mot') : ''].filter(Boolean).join(' · '))}</small>`,
    })),
  });
  if (!vid) return;
  const v = await getVersion(vid);
  if (!v) return;
  const act = await actionSheet({
    title: fmtDate(v.created),
    items: [
      { label: 'Restaurer cette version', hint: 'L’état actuel reste dans l’historique', value: 'restore' },
      { label: 'Ouvrir comme nouvelle copie', value: 'copy' },
    ],
  });
  if (!act) return;
  if (act === 'restore') {
    if (inEditor && state.dirty) await saveLocal(true);
    const meta = (await getDoc(docId)) || {};
    openDocument(v.blob, name, docId, { meta, keepDirty: true });
  } else {
    if (inEditor && state.dirty) await saveLocal(true);
    openDocument(v.blob, `${name} (version du ${new Date(v.created).toLocaleDateString('fr-FR')})`, null, { keepDirty: true });
  }
}

/* ---------------- Navigation pane (headings + search) ---------------- */
function openNav() {
  $('#nav-pane').classList.remove('hidden');
  document.querySelector('[data-rb="navpane"]')?.classList.add('on');
  $('#btn-nav').classList.add('on');
  refreshOutline();
  setTimeout(() => $('#nav-query').focus(), 50);
}
function closeNav() {
  if ($('#nav-pane').classList.contains('hidden')) return;
  $('#nav-pane').classList.add('hidden');
  document.querySelector('[data-rb="navpane"]')?.classList.remove('on');
  $('#btn-nav').classList.remove('on');
  try {
    state.superdoc?.ui?.search?.close();
  } catch {
    /* ignore */
  }
}
const toggleNav = () => ($('#nav-pane').classList.contains('hidden') ? openNav() : closeNav());
async function refreshOutline() {
  const ul = $('#nav-outline');
  ul.innerHTML = '';
  let outline = [];
  try {
    outline = (await sdoc()?.info({}))?.outline || [];
  } catch {
    /* ignore */
  }
  if (!outline.length) {
    ul.innerHTML = '<li class="nav-empty">Aucun titre. Applique les styles « Titre 1 », « Titre 2 »… pour structurer ton document.</li>';
    return;
  }
  for (const o of outline) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.textContent = o.text || '(sans texte)';
    b.style.paddingLeft = `${10 + (Math.max(1, o.level) - 1) * 14}px`;
    b.className = `lvl${o.level}`;
    b.onclick = async () => {
      try {
        await state.superdoc.ui.viewport.scrollIntoView({ target: { kind: 'text', blockId: o.nodeId, range: { start: 0, end: 0 } }, block: 'start' });
      } catch (e) {
        state.superdoc?.scrollToElement?.(o.nodeId);
      }
      if (window.innerWidth < 700) closeNav();
    };
    li.appendChild(b);
    ul.appendChild(li);
  }
}
let searchTimer;
function searchSnapshotText() {
  const s = state.superdoc?.ui?.search?.getSnapshot?.();
  if (!s || !s.query) return '';
  return s.total ? `${s.activeIndex + 1} sur ${s.total}` : 'Aucun résultat';
}
function runSearch() {
  const q = $('#nav-query').value;
  const search = state.superdoc?.ui?.search;
  if (!search) return;
  try {
    if (!search.getSnapshot().open) search.open();
    if (!q) {
      search.clear();
      $('#nav-count').textContent = '';
      return;
    }
    search.find(q);
  } catch (e) {
    console.warn(e);
  }
  setTimeout(() => ($('#nav-count').textContent = searchSnapshotText()), 250);
}
$('#nav-query').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 250);
});
$('#nav-query').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchStep(e.shiftKey ? 'previous' : 'next');
  }
});
function searchStep(dir) {
  try {
    state.superdoc?.ui?.search?.[dir]();
  } catch (e) {
    console.warn(e);
  }
  setTimeout(() => ($('#nav-count').textContent = searchSnapshotText()), 80);
}
$('#nav-next').onclick = () => searchStep('next');
$('#nav-prev').onclick = () => searchStep('previous');
async function searchReplace(all) {
  const search = state.superdoc?.ui?.search;
  if (!search || !$('#nav-query').value) return toast('Saisis le texte à rechercher');
  const before = search.getSnapshot().total;
  try {
    const r = await (all ? search.replaceAll($('#nav-replace').value) : search.replace($('#nav-replace').value));
    if (r && r.success === false) toast('Remplacement impossible ici');
    else if (all) toast(`${plural(before, 'remplacement')} effectué${before > 1 ? 's' : ''}`);
  } catch (e) {
    console.warn(e);
    toast('Remplacement impossible');
  }
  setTimeout(() => ($('#nav-count').textContent = searchSnapshotText()), 250);
}
$('#nav-rep1').onclick = () => searchReplace(false);
$('#nav-repall').onclick = () => searchReplace(true);
$('#nav-close').onclick = closeNav;
$('#btn-nav').onclick = toggleNav;

/* ---------------- Focus mode ---------------- */
function setFocusMode(on) {
  document.body.classList.toggle('focus', on);
  document.querySelector('[data-rb="focus"]')?.classList.toggle('on', on);
  if (on) toast('Mode concentration — touche ⤢ pour quitter', 2000);
}
$('#btn-focus').onclick = () => setFocusMode(true);
$('#focus-exit').onclick = () => setFocusMode(false);

/* ---------------- Web layout (reflow to the phone width) ---------------- */
async function toggleWebLayout() {
  if (!state.superdoc) return;
  const next = state.flowMode === 'semantic' ? 'paginated' : 'semantic';
  const wasDirty = state.dirty;
  let blob;
  try {
    blob = await exportBlob();
  } catch {
    return toast('Changement de mode impossible');
  }
  const meta = { ...state.meta };
  openDocument(new File([blob], `${docName()}.docx`, { type: DOCX_MIME }), docName(), state.docId, {
    meta,
    flowMode: next,
    keepDirty: wasDirty,
    loading: next === 'semantic' ? 'Mode Web…' : 'Mode Page…',
  });
  toast(next === 'semantic' ? 'Mode Web : le texte s’adapte à l’écran' : 'Mode Page : mise en page Word', 2200);
}

/* ---------------- Read aloud ---------------- */
let speaking = false;
async function readAloud() {
  if (speaking) return stopSpeaking();
  const d = sdoc();
  if (!d) return;
  let text = '';
  try {
    text = String(await d.getText({}));
  } catch {
    /* ignore */
  }
  text = text.replace(/​/g, '').replace(/\s+\n/g, '\n').trim();
  if (!text) return toast('Le document est vide');
  if (nativeBridge()?.speak) {
    nativeBridge().speak(text, 'fr-FR');
  } else if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
    const chunks = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c);
      u.lang = 'fr-FR';
      if (i === chunks.length - 1) u.onend = () => setSpeaking(false);
      speechSynthesis.speak(u);
    });
  } else {
    return toast('Synthèse vocale indisponible sur cet appareil');
  }
  setSpeaking(true);
}
function setSpeaking(on) {
  speaking = on;
  $('#tts-bar').classList.toggle('hidden', !on);
  document.querySelector('[data-rb="tts"]')?.classList.toggle('on', on);
}
function stopSpeaking() {
  if (!speaking) return;
  try {
    nativeBridge()?.stopSpeaking?.();
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  setSpeaking(false);
}
$('#tts-stop').onclick = stopSpeaking;
window.addEventListener('dotworks-tts-end', () => setSpeaking(false));

/* ---------------- Settings ---------------- */
async function openSettings() {
  const s = settings();
  const r = await formDialog({
    title: 'Paramètres',
    fields: [
      { name: 'theme', label: 'Thème', type: 'select', value: s.theme, options: [['auto', 'Automatique (système)'], ['light', 'Clair'], ['dark', 'Sombre']] },
      { name: 'author', label: 'Nom d’auteur (commentaires, révisions)', value: s.author },
      { name: 'autosave', label: 'Enregistrement automatique', type: 'select', value: String(s.autosave), options: [['0', 'Désactivé'], ['3', 'Toutes les 3 s'], ['8', 'Toutes les 8 s'], ['30', 'Toutes les 30 s'], ['60', 'Chaque minute']] },
      { name: 'zoom', label: 'Zoom à l’ouverture', type: 'select', value: s.zoom, options: [['fit', 'Largeur de la page'], ['100', '100 %']] },
      { name: 'spellcheck', label: 'Correcteur orthographique du clavier', type: 'checkbox', value: s.spellcheck },
      { name: 'versions', label: 'Conserver l’historique des versions', type: 'checkbox', value: s.versions },
      { name: 'awake', label: 'Garder l’écran allumé pendant l’édition', type: 'checkbox', value: s.awake },
    ],
    ok: 'Enregistrer',
  });
  if (!r) return;
  setSettings({ ...r, autosave: Number(r.autosave) || 0, author: (r.author || '').trim() || 'Utilisateur .WORKS' });
  applySpellcheck();
  applyKeepAwake();
  if (state.superdoc) {
    try {
      await state.superdoc.setUser?.({ name: settings().author, email: 'user@works.local' });
    } catch {
      /* ignore */
    }
  }
  toast('Paramètres enregistrés');
}
function applyKeepAwake() {
  const editing = $('#editor-screen').classList.contains('active');
  try {
    nativeBridge()?.keepScreenOn?.(!!settings().awake && editing);
  } catch {
    /* ignore */
  }
}
onSettings(() => {
  document.querySelector('[data-rb="dark"]')?.classList.toggle('on', isDark());
  if (isNative) {
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  }
});

/* ---------------- File import ---------------- */
function pickFile() {
  const input = $('#file-input');
  input.value = '';
  input.click();
}
async function importFile(f) {
  if (!f) return;
  const name = f.name || 'Document';
  if (/\.(docx|docm|dotx)$/i.test(name)) return openDocument(f, name);
  if (/\.doc$/i.test(name)) return toast('Ancien format .doc : ouvre-le dans Word et enregistre-le en .docx');
  if (/\.(md|markdown|txt|html?)$/i.test(name) || /^text\//.test(f.type)) {
    const text = await f.text();
    let html;
    if (/\.html?$/i.test(name) || f.type === 'text/html') {
      const d = new DOMParser().parseFromString(text, 'text/html');
      d.querySelectorAll('script,style,link,meta,iframe,object,embed').forEach((el) => el.remove());
      html = d.body.innerHTML;
    } else if (/\.(md|markdown)$/i.test(name)) html = mdToHtml(text);
    else html = textToHtml(text);
    return openDocument(null, baseName(name), null, { html, loading: 'Importation…' });
  }
  toast('Format non pris en charge. Choisis un .docx, .md, .html ou .txt');
}
$('#file-input').addEventListener('change', (e) => importFile(e.target.files?.[0]));

// Drag & drop (desktop / tablets)
document.addEventListener('dragover', (e) => {
  if ($('#home').classList.contains('active')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (!$('#home').classList.contains('active')) return;
  e.preventDefault();
  importFile(e.dataTransfer?.files?.[0]);
});

// Files opened from another app ("Ouvrir avec .WORKS") — provided by MainActivity.java
function takeNativeFile() {
  const bridge = nativeBridge();
  if (!bridge?.takePendingFile) return;
  try {
    const raw = bridge.takePendingFile();
    if (!raw) return;
    const { name, data } = JSON.parse(raw);
    const blob = base64ToBlob(data);
    const open = () => openDocument(new File([blob], name || 'Document.docx', { type: DOCX_MIME }), name);
    if (state.superdoc && state.dirty) saveLocal(true).finally(open);
    else open();
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
  applyKeepAwake();
  renderRecents();
}
async function newDocument() {
  const choice = await actionSheet({
    title: 'Nouveau document',
    items: [{ label: 'Document vierge', value: 'blank' }, ...TEMPLATES.map((t) => ({ label: t.name, hint: t.hint, value: t.id }))],
  });
  if (!choice) return;
  if (state.dirty) await saveLocal(true);
  const t = TEMPLATES.find((x) => x.id === choice);
  if (t) openDocument(null, t.name, null, { html: t.html() });
  else openDocument(null, 'Document1');
}

$('#btn-new').onclick = () => openDocument(null, 'Document1');
$('#btn-open').onclick = pickFile;
$('#btn-settings').onclick = openSettings;
$('#btn-back').onclick = goHome;
$('#btn-save').onclick = async () => {
  await saveToDevice();
};
$('#btn-menu').onclick = () => $('#menu').classList.remove('hidden');
$('#menu').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (e.target.id === 'menu' || btn) $('#menu').classList.add('hidden');
  if (!btn) return;
  switch (btn.dataset.act) {
    case 'save':
      return saveToDevice();
    case 'saveas':
      return saveAsCopy();
    case 'share':
      return shareDoc();
    case 'pdf':
      return printDocument();
    case 'export':
      return exportOther();
    case 'download': {
      if (isNative) return saveToDevice();
      const blob = (await saveLocal(true)) || (await exportBlob());
      return downloadBlob(blob, `${docName()}.docx`);
    }
    case 'versions':
      if (state.dirty) await saveLocal(true);
      return showVersions();
    case 'props':
      return showStats();
    case 'open':
      if (state.dirty) await saveLocal(true);
      return pickFile();
    case 'new':
      return newDocument();
    case 'settings':
      return openSettings();
    case 'about':
      return infoDialog(
        'À propos',
        `<p style="text-align:center;margin:4px 0 12px"><b style="font-size:26px;color:#e0a800">.WORKS</b><br><small>Version ${esc(VERSION)}</small></p>
         <p>Traitement de texte compatible Microsoft Word (.docx).</p>
         <p>Développé par <b>SuperEssence Studio</b>.</p>
         <p style="color:#888;font-size:13px">Moteur DOCX : SuperDoc (AGPL-3.0). Polices métriquement compatibles : Carlito, Caladea, Arimo, Tinos, Cousine.</p>`,
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

// Pinch-to-zoom on the document (two fingers), like Word mobile
(() => {
  const el = $('#doc-scroll');
  let startDist = 0;
  let startZoom = 100;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2 && state.superdoc?.getZoom && state.flowMode !== 'semantic') {
      startDist = dist(e.touches);
      startZoom = state.superdoc.getZoom();
    }
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !startDist) return;
    const z = Math.min(300, Math.max(25, Math.round((startZoom * dist(e.touches)) / startDist)));
    if (Math.abs(z - state.superdoc.getZoom()) >= 4) state.superdoc.setZoom(z);
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) startDist = 0;
  }, { passive: true });
})();

// Keyboard shortcuts like Word
window.addEventListener('keydown', (e) => {
  if (!state.superdoc || !$('#editor-screen').classList.contains('active')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 's') {
    e.preventDefault();
    saveToDevice();
  } else if ((e.ctrlKey || e.metaKey) && k === 'p') {
    e.preventDefault();
    printDocument();
  } else if ((e.ctrlKey || e.metaKey) && (k === 'f' || k === 'h')) {
    e.preventDefault();
    openNav();
    if (k === 'h') setTimeout(() => $('#nav-replace').focus(), 80);
  } else if ((e.ctrlKey || e.metaKey) && k === 'g') {
    e.preventDefault();
    goToPage();
  } else if (e.key === 'Escape' && document.body.classList.contains('focus')) {
    setFocusMode(false);
  }
});

// Autosave when the app goes to background
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.dirty) saveLocal(true);
});
window.addEventListener('beforeunload', (e) => {
  if (state.dirty && !isNative) {
    saveLocal(true);
    e.preventDefault();
  }
});

/* ---------------- Extra ribbon groups ---------------- */
addRibbonGroup('affichage', {
  label: 'Lecture',
  items: [
    { id: 'navpane', icon: 'navpane', label: 'Navigation', action: toggleNav },
    { id: 'weblayout', icon: 'web', label: 'Mode Web', title: 'Le texte s’adapte à la largeur de l’écran', action: toggleWebLayout },
    { id: 'focus', icon: 'focus', label: 'Concentration', action: () => setFocusMode(!document.body.classList.contains('focus')) },
    { id: 'dark', icon: 'moon', label: 'Thème sombre', action: () => setSettings({ theme: isDark() ? 'light' : 'dark' }) },
  ],
}, { first: true });
addRibbonGroup('revision', {
  label: 'Voix',
  items: [{ id: 'tts', icon: 'speaker', label: 'Lecture à voix haute', action: readAloud }],
}, { first: true });
addRibbonGroup('accueil', {
  label: 'Navigation',
  items: [
    { icon: 'navpane', label: 'Rechercher', action: openNav },
    { icon: 'history', label: 'Versions', action: async () => { if (state.dirty) await saveLocal(true); showVersions(); } },
  ],
});
addRibbonGroup('insertion', {
  label: 'Exporter',
  items: [{ icon: 'pdf', label: 'PDF', action: printDocument }],
});

/* ---------------- Native integration ---------------- */
if (isNative) {
  App.addListener('backButton', () => {
    if ($('#dialog-host').children.length) return $('#dialog-host').lastElementChild.remove();
    if (!$('#menu').classList.contains('hidden')) return $('#menu').classList.add('hidden');
    if (document.body.classList.contains('printing')) return cleanupPrint();
    if (speaking) return stopSpeaking();
    if (!$('#nav-pane').classList.contains('hidden')) return closeNav();
    if (document.body.classList.contains('focus')) return setFocusMode(false);
    if ($('#editor-screen').classList.contains('active')) return goHome();
    App.exitApp();
  });
  App.addListener('resume', () => {
    takeNativeFile();
    if (document.body.classList.contains('printing')) setTimeout(cleanupPrint, 1500);
  });
  App.addListener('pause', () => {
    if (state.dirty) saveLocal(true);
  });
  Keyboard.addListener('keyboardWillShow', () => document.body.classList.add('kb-open')).catch?.(() => {});
  Keyboard.addListener('keyboardWillHide', () => document.body.classList.remove('kb-open')).catch?.(() => {});
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor?.({ color: '#000000' })?.catch?.(() => {});
}

/* ---------------- Boot ---------------- */
applyTheme();
$('#app-version').textContent = VERSION;
initRibbon({ getSuperdoc: () => state.superdoc, toast });
document.querySelector('[data-rb="dark"]')?.classList.toggle('on', isDark());
renderTemplates();
renderRecents();
takeNativeFile();
// expose for debugging / tests
window.__works = { state, openDocument, printDocument, cleanupPrint, saveLocal };
// keep the screen awake setting in sync with the active screen
new MutationObserver(applyKeepAwake).observe($('#editor-screen'), { attributes: true, attributeFilter: ['class'] });
