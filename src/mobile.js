// .WORKS — phone-first editing: formatting bar above the keyboard (with live state), contextual
// table tools, undo / redo in the title bar, pinch-to-zoom on the pages.
import { dropdown } from './dialog.js';
import { colorMenu, ribbonActions } from './ribbon.js';

let getSd = () => null;
let notify = () => {};
let unsubs = [];

const $ = (s) => document.querySelector(s);
const ui = () => getSd()?.ui;

async function exec(id, payload) {
  const commands = ui()?.commands;
  if (!commands) return notify('Ouvre un document');
  try {
    const r = await (commands.executeAsync ? commands.executeAsync(id, payload) : commands.execute(id, payload));
    const failed = r === false || r?.ok === false || r?.success === false;
    const noop = /no.?op|no change|unchanged/i.test(`${r?.reason || ''} ${r?.failure?.code || ''} ${r?.failure?.message || ''}`);
    if (failed && !noop) {
      console.warn(id, r);
      notify(id.startsWith('table') ? 'Place le curseur dans un tableau' : 'Action impossible ici');
    }
    return r;
  } catch (e) {
    console.error(e);
    notify('Action impossible ici');
  }
}

const ico = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const G = (t, style = '') => `<span class="qb-glyph" style="${style}">${t}</span>`;

const ALIGN_ICO = {
  left: ico('<path d="M3 6h18M3 10h12M3 14h18M3 18h12"/>'),
  center: ico('<path d="M3 6h18M6 10h12M3 14h18M6 18h12"/>'),
  right: ico('<path d="M3 6h18M9 10h12M3 14h18M9 18h12"/>'),
  justify: ico('<path d="M3 6h18M3 10h18M3 14h18M3 18h18"/>'),
};

const STYLES = [
  ['Normal', 'Normal', 'font-size:14px'],
  ['Title', 'Titre', 'font-size:22px;font-weight:300'],
  ['Heading1', 'Titre 1', 'font-size:18px;font-weight:700;color:#2F5496'],
  ['Heading2', 'Titre 2', 'font-size:16px;font-weight:700;color:#2F5496'],
  ['Heading3', 'Titre 3', 'font-size:15px;font-weight:700;color:#1F3763'],
  ['Subtitle', 'Sous-titre', 'font-size:14px;color:#5A5A5A'],
  ['Quote', 'Citation', 'font-size:14px;font-style:italic;color:#404040'],
];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72];

/* ---------- quick bar definition ---------- */
const ITEMS = [
  { id: 'style', label: 'Style', html: () => G('Normal ▾', 'font-size:12px;min-width:58px'), action: styleMenu, value: 'linked-style' },
  { id: 'font', label: 'Police', html: () => G('Calibri ▾', 'font-size:12px;max-width:92px;overflow:hidden;text-overflow:ellipsis'), action: fontMenu, value: 'font-family' },
  { id: 'size', label: 'Taille', html: () => G('11 ▾', 'font-size:12px;min-width:34px'), action: sizeMenu, value: 'font-size' },
  { sep: true },
  { cmd: 'bold', label: 'Gras', html: () => G('G', 'font-weight:900') },
  { cmd: 'italic', label: 'Italique', html: () => G('I', 'font-style:italic;font-family:serif;font-weight:700') },
  { cmd: 'underline', label: 'Souligné', html: () => G('S', 'text-decoration:underline;font-weight:700') },
  { cmd: 'strikethrough', label: 'Barré', html: () => G('ab', 'text-decoration:line-through') },
  { id: 'color', label: 'Couleur du texte', html: () => G('A', 'font-weight:800;border-bottom:4px solid #C00000;line-height:1.1'), action: (a) => colorMenu(a, (c) => exec('text-color', c ? `#${c}` : '#000000'), { none: 'Automatique' }) },
  { id: 'hl', label: 'Surlignage', html: () => ico('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>', 'style="border-bottom:4px solid #FFFF00"'), action: highlightMenu },
  { sep: true },
  { cmd: 'bullet-list', label: 'Puces', html: () => ico('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1.3" fill="currentColor"/><circle cx="4" cy="12" r="1.3" fill="currentColor"/><circle cx="4" cy="18" r="1.3" fill="currentColor"/>') },
  { cmd: 'numbered-list', label: 'Numérotation', html: () => ico('<path d="M10 6h11M10 12h11M10 18h11M4 4v4M3 18h3l-3 3h3" /><path d="M3 10.5h2.5L3 14h3"/>') },
  { cmd: 'indent-decrease', label: 'Diminuer le retrait', html: () => ico('<path d="M21 6H11M21 12H11M21 18H11M7 8l-4 4 4 4"/>') },
  { cmd: 'indent-increase', label: 'Augmenter le retrait', html: () => ico('<path d="M21 6H11M21 12H11M21 18H11M3 8l4 4-4 4"/>') },
  { id: 'align', label: 'Alignement', html: () => ALIGN_ICO.left, action: alignMenu, value: 'text-align' },
  { sep: true },
  { id: 'insert', label: 'Insérer', html: () => ico('<path d="M12 5v14M5 12h14"/>'), action: insertMenu },
  { cmd: 'clear-formatting', label: 'Effacer la mise en forme', html: () => ico('<path d="M4 7V4h16v3M9 20h6M12 4l-3 16"/><path d="m15 15 6 6M21 15l-6 6"/>') },
];
const TABLE_ITEMS = [
  { tableLabel: true },
  { cmd: 'table-add-row-before', label: 'Ligne au-dessus', html: () => G('+↑', 'font-size:13px;font-weight:700') },
  { cmd: 'table-add-row-after', label: 'Ligne en dessous', html: () => G('+↓', 'font-size:13px;font-weight:700') },
  { cmd: 'table-add-column-before', label: 'Colonne à gauche', html: () => G('+←', 'font-size:13px;font-weight:700') },
  { cmd: 'table-add-column-after', label: 'Colonne à droite', html: () => G('+→', 'font-size:13px;font-weight:700') },
  { cmd: 'table-delete-row', label: 'Supprimer la ligne', html: () => G('−▭', 'font-size:13px;font-weight:700;color:#c00') },
  { cmd: 'table-delete-column', label: 'Supprimer la colonne', html: () => G('−▯', 'font-size:13px;font-weight:700;color:#c00') },
  { cmd: 'table-merge-cells', label: 'Fusionner', html: () => G('⇥⇤', 'font-size:13px') },
  { cmd: 'table-split-cell', label: 'Fractionner', html: () => G('⇤⇥', 'font-size:13px') },
  { cmd: 'table-delete', label: 'Supprimer le tableau', html: () => ico('<rect x="3" y="3" width="18" height="18" rx="1"/><path d="m8 8 8 8M16 8l-8 8"/>', 'style="color:#c00"') },
];

function styleMenu(anchor) {
  dropdown(
    anchor,
    STYLES.map(([id, label, css]) => ({ html: `<span style="${css}">${label}</span>`, action: () => exec('linked-style', id) })).concat([
      { separator: true },
      { label: 'Tous les styles…', action: () => ribbonActions.stylesMenu?.(anchor) },
    ]),
    { className: 'styles-menu' },
  );
}
const FONTS = ['Calibri', 'Calibri Light', 'Cambria', 'Aptos', 'Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Garamond', 'Century Gothic', 'Segoe UI', 'Comic Sans MS'];
function fontMenu(anchor) {
  dropdown(anchor, FONTS.map((f) => ({ html: `<span style="font-family:'${f}'">${f}</span>`, action: () => exec('font-family', f) })), { className: 'font-menu' });
}
function sizeMenu(anchor) {
  dropdown(
    anchor,
    SIZES.map((s) => ({ label: String(s).replace('.', ','), action: () => exec('font-size', String(s)) })),
    { className: 'size-menu' },
  );
}
function highlightMenu(anchor) {
  const HL = [
    ['yellow', '#FFFF00', 'Jaune'],
    ['green', '#00FF00', 'Vert vif'],
    ['cyan', '#00FFFF', 'Turquoise'],
    ['magenta', '#FF00FF', 'Rose'],
    ['blue', '#0000FF', 'Bleu'],
    ['red', '#FF0000', 'Rouge'],
    ['darkYellow', '#808000', 'Jaune foncé'],
    ['lightGray', '#C0C0C0', 'Gris clair'],
  ];
  dropdown(anchor, [
    ...HL.map(([, c, l]) => ({ html: `<span class="hl-chip" style="background:${c}"></span> ${l}`, action: () => exec('highlight-color', c) })),
    { separator: true },
    { label: 'Aucun surlignage', action: () => exec('highlight-color', null) },
  ]);
}
function alignMenu(anchor) {
  dropdown(anchor, [
    { html: `${ALIGN_ICO.left} Aligner à gauche`, action: () => exec('text-align', 'left') },
    { html: `${ALIGN_ICO.center} Centrer`, action: () => exec('text-align', 'center') },
    { html: `${ALIGN_ICO.right} Aligner à droite`, action: () => exec('text-align', 'right') },
    { html: `${ALIGN_ICO.justify} Justifier`, action: () => exec('text-align', 'justify') },
    { separator: true },
    { heading: 'Interligne' },
    ...['1', '1.15', '1.5', '2'].map((v) => ({ label: v.replace('.', ','), action: () => ribbonActions.lineSpacing?.(parseFloat(v)) })),
  ], { className: 'align-menu' });
}
function insertMenu(anchor) {
  const A = ribbonActions;
  dropdown(anchor, [
    { label: '▦ Tableau…', action: A.insertTable },
    { label: '🖼 Image…', action: A.pickImage },
    { label: '🔗 Lien…', action: A.insertLink },
    { label: '💬 Commentaire…', action: A.insertComment },
    { label: '¹ Note de bas de page…', action: () => A.footnote?.('footnote') },
    { label: '⤓ Saut de page', action: () => A.pageBreak?.(1) },
    { label: '# Numéros de page…', action: A.pageNumbers },
    { label: '📅 Date et heure…', action: A.dateDialog },
    { label: 'Ω Symbole…', action: () => A.symbolsMenu?.(anchor) },
    { label: '☰ Table des matières…', action: A.insertToc },
  ]);
}

/* ---------- rendering ---------- */
const buttons = new Map(); // key -> { el, item }
function makeBtn(item) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'qb-btn';
  b.title = item.label;
  b.setAttribute('aria-label', item.label);
  b.innerHTML = item.html();
  b.onmousedown = (e) => e.preventDefault(); // keep the selection / keyboard
  b.onclick = () => (item.cmd ? exec(item.cmd) : item.action?.(b));
  return b;
}
function renderBar() {
  const bar = $('#quickbar');
  bar.innerHTML = '';
  buttons.clear();
  const main = document.createElement('div');
  main.className = 'qb-row';
  for (const it of ITEMS) {
    if (it.sep) {
      main.appendChild(Object.assign(document.createElement('span'), { className: 'qb-sep' }));
      continue;
    }
    const b = makeBtn(it);
    buttons.set(it.cmd || it.id, { el: b, item: it });
    main.appendChild(b);
  }
  const table = document.createElement('div');
  table.className = 'qb-row qb-table';
  for (const it of TABLE_ITEMS) {
    if (it.tableLabel) {
      table.appendChild(Object.assign(document.createElement('span'), { className: 'qb-tlabel', textContent: 'Tableau' }));
      continue;
    }
    const b = makeBtn(it);
    buttons.set(it.cmd, { el: b, item: it });
    table.appendChild(b);
  }
  bar.append(table, main);
}

function applyState(snap) {
  const cmds = snap?.commands || {};
  for (const [key, { el, item }] of buttons) {
    const st = cmds[item.cmd || item.value];
    if (item.cmd) {
      el.classList.toggle('on', !!st?.active);
      el.disabled = st ? st.enabled === false && !item.cmd.startsWith('table') : false;
    }
    if (key === 'style') {
      const v = st?.value;
      const name = STYLES.find(([id]) => id === v?.styleId)?.[1] || v?.styleName || 'Normal';
      el.querySelector('.qb-glyph').textContent = `${name.replace(/^heading (\d)/i, 'Titre $1')} ▾`;
    }
    if (key === 'font') el.querySelector('.qb-glyph').textContent = `${st?.value || '–'} ▾`;
    if (key === 'size') el.querySelector('.qb-glyph').textContent = `${st?.value ? String(st.value).replace('.', ',') : '–'} ▾`;
    if (key === 'align') el.innerHTML = ALIGN_ICO[st?.value] || ALIGN_ICO.left;
  }
  const inTable = cmds['table-add-row-after']?.enabled === true;
  $('#quickbar').classList.toggle('in-table', inTable);
  const ro = snap?.context === 'viewing';
  $('#quickbar').classList.toggle('readonly', ro);
}

function applyHistory(h) {
  $('#btn-undo').disabled = !h?.canUndo;
  $('#btn-redo').disabled = !h?.canRedo;
}

/* ---------- pinch to zoom (pages) ---------- */
function initPinch() {
  const el = $('#doc-scroll');
  let start = null;
  let raf = 0;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  el.addEventListener(
    'touchstart',
    (e) => {
      const sd = getSd();
      if (e.touches.length === 2 && sd?.getZoom) start = { d: dist(e.touches), z: sd.getZoom() };
    },
    { passive: true },
  );
  el.addEventListener(
    'touchmove',
    (e) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const z = Math.min(300, Math.max(25, Math.round((start.z * dist(e.touches)) / start.d)));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => getSd()?.setZoom?.(z));
    },
    { passive: false },
  );
  const end = (e) => {
    if (e.touches.length < 2) start = null;
  };
  el.addEventListener('touchend', end, { passive: true });
  el.addEventListener('touchcancel', end, { passive: true });
}

/* ---------- keyboard awareness ---------- */
function initKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const onResize = () => {
    // When the soft keyboard is open the visual viewport shrinks: hide the ribbon panel to give room to the text.
    const kb = window.innerHeight - vv.height > 140;
    document.body.classList.toggle('keyboard-open', kb);
  };
  vv.addEventListener('resize', onResize);
}

/* ---------- public ---------- */
export function initMobile({ getSuperdoc, toast }) {
  getSd = getSuperdoc;
  notify = toast;
  renderBar();
  initPinch();
  initKeyboard();
  $('#btn-undo').onmousedown = (e) => e.preventDefault();
  $('#btn-redo').onmousedown = (e) => e.preventDefault();
  $('#btn-undo').onclick = () => exec('undo');
  $('#btn-redo').onclick = () => exec('redo');
}

export function attachMobile() {
  detachMobile();
  const u = ui();
  if (!u) return;
  try {
    unsubs.push(u.toolbar.observe(applyState));
    unsubs.push(u.history.observe(applyHistory));
  } catch (e) {
    console.warn('mobile toolbar state unavailable', e);
  }
}

export function detachMobile() {
  for (const f of unsubs) {
    try {
      f();
    } catch {
      /* ignore */
    }
  }
  unsubs = [];
  applyHistory(null);
}
