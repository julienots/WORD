// .WORKS — Word-style ribbon (Accueil / Insertion / Mise en page / Références / Révision / Affichage).
// Every action goes through SuperDoc's Document API, so it is written as native Word XML in the .docx.
import { formDialog, infoDialog, dropdown } from './dialog.js';

const W_NS = { w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' };
const CM_TWIPS = 567; // 1 cm = 567 twips
const CM_IN = 1 / 2.54;
const PT_TWIPS = 20;

let getSd = () => null;
let notify = (m) => console.log(m);

/* ======================= helpers ======================= */
const sd = () => getSd();
const doc = () => sd()?.activeEditor?.doc;
const snapshot = () => sd()?.ui?.selection?.getSnapshot?.() || {};

const isNoop = (res) => /no change|produced no|NO_OP|unchanged/i.test(res?.failure?.message || res?.failure?.code || '');
function ok(res, msg) {
  if (res && res.success === false && isNoop(res)) {
    if (msg) notify(msg);
    return true;
  }
  if (res && res.success === false) {
    console.warn(res);
    notify(res.failure?.message ? `Impossible : ${res.failure.message}` : 'Action impossible ici');
    return false;
  }
  if (msg) notify(msg);
  return true;
}
async function run(fn, msg) {
  if (!doc()) return notify('Ouvre un document');
  try {
    return ok(await fn(), msg);
  } catch (e) {
    console.error(e);
    notify(`Action impossible : ${e.message || e}`);
    return false;
  }
}
const cmd = (id, payload) => {
  try {
    const r = sd()?.ui?.commands?.execute(id, payload);
    if (r && r.ok === false && r.reason) console.warn(id, r);
    return r;
  } catch (e) {
    console.error(e);
  }
};

/** Selection target for inline formatting (null when caret only). */
function selTarget(snap = snapshot()) {
  return snap.empty ? null : snap.selectionTarget || null;
}
/** Text target collapsed at the caret (end of the selection). */
function caretText(snap = snapshot()) {
  const st = snap.selectionTarget;
  const end = st?.end || st?.start;
  if (end?.blockId != null) {
    const r = { kind: 'text', blockId: end.blockId, range: { start: end.offset, end: end.offset } };
    if (end.story && end.story.storyType !== 'body') r.story = end.story;
    return r;
  }
  const seg = snap.target?.segments?.at(-1);
  if (seg) return { kind: 'text', blockId: seg.blockId, range: { start: seg.range.end, end: seg.range.end } };
  return null;
}
function caretSelection(snap = snapshot()) {
  const t = caretText(snap);
  if (!t) return null;
  const p = { kind: 'text', blockId: t.blockId, offset: t.range.start };
  if (t.story) p.story = t.story;
  return { kind: 'selection', start: p, end: { ...p }, ...(t.story ? { story: t.story } : {}) };
}
function textRange(snap = snapshot()) {
  const seg = snap.target?.segments?.[0];
  if (!seg) return caretText(snap);
  return { kind: 'text', blockId: seg.blockId, range: { ...seg.range } };
}
/** Block ids touched by the selection (paragraphs / headings / list items). */
function selectedBlockIds(snap = snapshot()) {
  const ids = new Set();
  for (const s of snap.target?.segments || []) ids.add(s.blockId);
  const st = snap.selectionTarget;
  if (!ids.size && st?.start?.blockId) ids.add(st.start.blockId);
  if (st?.end?.blockId) ids.add(st.end.blockId);
  return [...ids];
}
async function blockAddress(id) {
  try {
    const r = await doc().getNodeById({ nodeId: id });
    if (r?.address?.kind === 'block') return r.address;
  } catch (e) {
    /* fallthrough */
  }
  return { kind: 'block', nodeType: 'paragraph', nodeId: id };
}
async function forEachParagraph(fn, snap = snapshot()) {
  const ids = selectedBlockIds(snap);
  if (!ids.length) return notify('Place le curseur dans un paragraphe');
  let res;
  for (const id of ids) {
    const target = await blockAddress(id);
    res = await fn(target);
    if (res && res.success === false && !isNoop(res)) return ok(res);
  }
  return true;
}
const paraOp = (op, extra) => () => run(() => forEachParagraph((target) => doc().format.paragraph[op]({ target, ...extra })));

async function sections() {
  const r = await doc().sections.list();
  return (r?.items || []).map((s) => s.address);
}
async function forEachSection(fn) {
  return run(async () => {
    const list = await sections();
    let r;
    for (const target of list) {
      r = await fn(target);
      if (r && r.success === false && !isNoop(r)) return r;
    }
    return r;
  });
}
async function firstSection() {
  return (await sections())[0];
}
async function sectionInfo() {
  const r = await doc().sections.list();
  return r?.items?.[0];
}

/** Inline formatting on the selection. */
function inline(patch, label) {
  return () => {
    const target = selTarget();
    if (!target) return notify('Sélectionne d’abord du texte');
    return run(() => doc().format.apply({ target, inline: patch }), label);
  };
}
async function readFmt() {
  const target = selTarget();
  if (!target) return null;
  try {
    return (await doc().format.readSelection({ target }))?.properties || null;
  } catch {
    return null;
  }
}
async function toggleInline(key, onValue = true) {
  const target = selTarget();
  if (!target) return notify('Sélectionne d’abord du texte');
  const p = await readFmt();
  const cur = p?.[key]?.value;
  const active = typeof onValue === 'string' ? cur === onValue : !!cur;
  const value = active ? (typeof onValue === 'string' ? 'baseline' : false) : onValue;
  return run(() => doc().format.apply({ target, inline: { [key]: value } }));
}

/** Insert raw WordprocessingML runs at the caret. */
async function insertRunXml(xml, fallback) {
  const target = caretSelection();
  if (!target) return notify('Place le curseur dans le document');
  try {
    const r = await doc().insert({ type: 'ooxml', value: xml, namespaces: W_NS, target });
    if (r?.success !== false) return true;
    console.warn('ooxml insert refused, using fallback', r);
  } catch (e) {
    console.warn(e);
  }
  if (fallback) return fallback();
  return notify('Impossible ici : place le curseur dans un paragraphe simple');
}
/** Page break that also works in complex paragraphs: new paragraph after the current one + "page break before". */
async function pageBreak(count = 1) {
  const fallback = async () => {
    const ids = selectedBlockIds();
    if (!ids.length) return notify('Place le curseur dans le document');
    return run(async () => {
      let after = await blockAddress(ids.at(-1));
      let r;
      for (let i = 0; i < count; i++) {
        r = await doc().create.paragraph({ at: { kind: 'after', target: after }, text: '' });
        if (r?.success === false) return r;
        after = r.paragraph;
        await doc().format.paragraph.setFlowOptions({ target: r.paragraph, pageBreakBefore: true });
      }
      return r;
    });
  };
  return insertRunXml('<w:r><w:br w:type="page"/></w:r>'.repeat(count), fallback);
}
function insertText(text) {
  const target = caretSelection();
  if (!target) return notify('Place le curseur dans le document');
  return run(() => doc().insert({ target, value: text }));
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const hex = (c) => String(c || '').replace('#', '').toUpperCase();

/* ======================= colour palette ======================= */
const PALETTE = [
  'FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47',
  'F2F2F2', '7F7F7F', 'D0CECE', 'D6DCE4', 'D9E2F3', 'FBE5D5', 'EDEDED', 'FFF2CC', 'DEEBF6', 'E2EFD9',
  'BFBFBF', '404040', 'AEABAB', 'ADB9CA', 'B4C6E7', 'F7CBAC', 'DBDBDB', 'FFE599', 'BDD7EE', 'C5E0B3',
  'C00000', 'FF0000', 'FFCB1F', 'FFFF00', '92D050', '00B050', '00B0F0', '0070C0', '002060', '7030A0',
];
function colorMenu(anchor, onPick, { none = 'Aucune' } = {}) {
  const items = [];
  if (none) items.push({ label: none, action: () => onPick(null) });
  items.push({
    html: `<div class="swatches">${PALETTE.map((c) => `<span data-c="${c}" style="background:#${c}" title="#${c}"></span>`).join('')}</div>`,
    action: () => {},
  });
  items.push({
    label: 'Autres couleurs…',
    action: async () => {
      const v = await formDialog({ title: 'Couleur personnalisée', fields: [{ name: 'c', label: 'Couleur', type: 'color', value: '#FFCB1F' }] });
      if (v) onPick(hex(v.c));
    },
  });
  dropdown(anchor, items, { className: 'color-menu' });
  document.querySelectorAll('.color-menu .swatches span').forEach((s) => {
    s.onmousedown = (e) => e.preventDefault();
    s.onclick = (e) => {
      e.stopPropagation();
      document.querySelector('.color-menu')?.remove();
      onPick(s.dataset.c);
    };
  });
}

/* ======================= ACCUEIL ======================= */
async function clipboardAction(kind) {
  sd()?.focus?.();
  if (kind === 'paste') {
    try {
      const text = await navigator.clipboard.readText();
      if (text) return insertText(text);
    } catch {
      /* ignore */
    }
    if (!document.execCommand('paste')) notify('Appui long dans le texte → Coller');
    return;
  }
  if (!document.execCommand(kind)) {
    const t = snapshot().quotedText;
    if (t && navigator.clipboard) {
      await navigator.clipboard.writeText(t);
      if (kind === 'cut') document.execCommand('delete');
      notify(kind === 'cut' ? 'Coupé' : 'Copié');
    }
  }
}

async function growFont(delta) {
  const target = selTarget();
  if (!target) return notify('Sélectionne d’abord du texte');
  const p = await readFmt();
  const cur = p?.fontSize?.value || 11;
  const sizes = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
  let next = delta > 0 ? sizes.find((s) => s > cur) ?? cur + 10 : [...sizes].reverse().find((s) => s < cur) ?? Math.max(1, cur - 1);
  return run(() => doc().format.apply({ target, inline: { fontSize: next } }));
}

async function changeCase(mode) {
  const snap = snapshot();
  const target = selTarget(snap);
  if (!target) return notify('Sélectionne d’abord du texte');
  if (mode === 'caps') return run(() => doc().format.apply({ target, inline: { caps: true, smallCaps: false } }));
  if (mode === 'smallCaps') return run(() => doc().format.apply({ target, inline: { smallCaps: true, caps: false } }));
  const text = snap.quotedText || '';
  if (!text) return;
  let out = text;
  if (mode === 'upper') out = text.toLocaleUpperCase('fr');
  if (mode === 'lower') out = text.toLocaleLowerCase('fr');
  if (mode === 'title') out = text.toLocaleLowerCase('fr').replace(/(^|[\s\-'’])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('fr'));
  if (mode === 'sentence') out = text.toLocaleLowerCase('fr').replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('fr'));
  if (mode === 'toggle') out = [...text].map((c) => (c === c.toLocaleUpperCase('fr') ? c.toLocaleLowerCase('fr') : c.toLocaleUpperCase('fr'))).join('');
  return run(() => doc().replace({ target, text: out }));
}

function underlineMenu(anchor) {
  const styles = [
    ['single', 'Simple', 'border-bottom:1px solid'],
    ['double', 'Double', 'border-bottom:3px double'],
    ['thick', 'Épais', 'border-bottom:3px solid'],
    ['dotted', 'Pointillé', 'border-bottom:2px dotted'],
    ['dash', 'Tirets', 'border-bottom:2px dashed'],
    ['dotDash', 'Trait-point', 'border-bottom:2px dashed'],
    ['wave', 'Ondulé', 'text-decoration:underline wavy'],
    ['words', 'Mots seulement', 'text-decoration:underline'],
  ];
  dropdown(anchor, [
    ...styles.map(([v, l, css]) => ({ html: `<span style="${css};padding-bottom:1px">${l}</span>`, action: inline({ underline: { style: v } }) })),
    { separator: true },
    { label: 'Couleur du soulignement…', action: () => colorMenu(anchor, (c) => inline({ underline: { style: 'single', color: c || 'auto' } })(), { none: 'Automatique' }) },
    { label: 'Aucun soulignement', action: inline({ underline: false }) },
  ]);
}

function effectsMenu(anchor) {
  dropdown(anchor, [
    { label: 'Barré double', action: () => toggleInline('dstrike') },
    { label: 'Petites majuscules', action: () => toggleInline('smallCaps') },
    { label: 'MAJUSCULES', action: () => toggleInline('caps') },
    { label: 'Contour', action: () => toggleInline('outline') },
    { label: 'Ombre', action: () => toggleInline('shadow') },
    { label: 'Relief', action: () => toggleInline('emboss') },
    { label: 'Empreinte', action: () => toggleInline('imprint') },
    { label: 'Masqué', action: () => toggleInline('vanish') },
    { separator: true },
    { label: 'Trame de fond des caractères…', action: () => colorMenu(anchor, (c) => inline({ shading: c ? { val: 'clear', fill: c, color: 'auto' } : null })()) },
    { label: 'Bordure des caractères', action: inline({ border: { val: 'single', sz: 4, color: '000000', space: 0 } }) },
    { label: 'Police avancée…', action: fontDialog },
  ]);
}

async function fontDialog() {
  const target = selTarget();
  if (!target) return notify('Sélectionne d’abord du texte');
  const p = (await readFmt()) || {};
  const v = await formDialog({
    title: 'Police',
    fields: [
      { name: 'fontFamily', label: 'Police', type: 'select', value: p.fontFamily?.value || 'Calibri', options: FONTS.map((f) => [f, f]) },
      { name: 'fontSize', label: 'Taille (pt)', type: 'number', step: 0.5, min: 1, value: p.fontSize?.value || 11 },
      { name: 'color', label: 'Couleur', type: 'color', value: `#${p.color?.value && p.color.value !== 'auto' ? p.color.value : '000000'}` },
      { name: 'letterSpacing', label: 'Espacement (pt, +/-)', type: 'number', step: 0.1, value: (p.letterSpacing?.value || 0) / 20 },
      { name: 'charScale', label: 'Échelle (%)', type: 'number', step: 1, min: 1, max: 600, value: p.charScale?.value || 100 },
      { name: 'position', label: 'Position (pt, +/-)', type: 'number', step: 0.5, value: (p.position?.value || 0) / 2 },
      { name: 'kerning', label: 'Crénage à partir de (pt, 0 = non)', type: 'number', step: 1, min: 0, value: (p.kerning?.value || 0) / 2 },
      { name: 'bold', label: 'Gras', type: 'checkbox', value: !!p.bold?.value },
      { name: 'italic', label: 'Italique', type: 'checkbox', value: !!p.italic?.value },
      { name: 'strike', label: 'Barré', type: 'checkbox', value: !!p.strike?.value },
      { name: 'dstrike', label: 'Barré double', type: 'checkbox', value: !!p.dstrike?.value },
      { name: 'smallCaps', label: 'Petites majuscules', type: 'checkbox', value: !!p.smallCaps?.value },
      { name: 'caps', label: 'Majuscules', type: 'checkbox', value: !!p.caps?.value },
      { name: 'vanish', label: 'Masqué', type: 'checkbox', value: !!p.vanish?.value },
    ],
  });
  if (!v) return;
  return run(() =>
    doc().format.apply({
      target,
      inline: {
        fontFamily: v.fontFamily,
        fontSize: v.fontSize,
        color: hex(v.color),
        letterSpacing: Math.round((v.letterSpacing || 0) * 20) || null,
        charScale: v.charScale && v.charScale !== 100 ? Math.round(v.charScale) : null,
        position: Math.round((v.position || 0) * 2) || null,
        kerning: Math.round((v.kerning || 0) * 2) || null,
        bold: v.bold,
        italic: v.italic,
        strike: v.strike,
        dstrike: v.dstrike,
        smallCaps: v.smallCaps,
        caps: v.caps,
        vanish: v.vanish,
      },
    }),
  );
}

async function paragraphDialog() {
  const snap = snapshot();
  const ids = selectedBlockIds(snap);
  if (!ids.length) return notify('Place le curseur dans un paragraphe');
  let props = {};
  try {
    props = (await doc().getNodeById({ nodeId: ids[0] }))?.node?.paragraph?.props || {};
  } catch {
    /* ignore */
  }
  const ind = props.indent || {};
  const sp = props.spacing || {};
  const ptToCm = (pt) => (pt ? +((pt * 20) / CM_TWIPS).toFixed(2) : 0);
  const lineVal = sp.line ? (sp.lineRule === 'auto' || !sp.lineRule ? +(sp.line / 240).toFixed(2) : +(sp.line / 20).toFixed(1)) : 1.08;
  const v = await formDialog({
    title: 'Paragraphe',
    fields: [
      { name: 'alignment', label: 'Alignement', type: 'select', value: props.alignment || 'left', options: [['left', 'Gauche'], ['center', 'Centré'], ['right', 'Droite'], ['justify', 'Justifié']] },
      { name: 'outline', label: 'Niveau hiérarchique', type: 'select', value: props.outlineLevel ?? '', options: [['', 'Corps du texte'], ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), `Niveau ${n + 1}`])] },
      { name: 'left', label: 'Retrait gauche (cm)', type: 'number', step: 0.1, value: ptToCm(ind.left) },
      { name: 'right', label: 'Retrait droit (cm)', type: 'number', step: 0.1, value: ptToCm(ind.right) },
      { name: 'special', label: 'Retrait 1re ligne', type: 'select', value: ind.hanging ? 'hanging' : ind.firstLine ? 'firstLine' : 'none', options: [['none', 'Aucun'], ['firstLine', 'Première ligne'], ['hanging', 'Suspendu']] },
      { name: 'by', label: 'De (cm)', type: 'number', step: 0.1, value: ptToCm(ind.hanging || ind.firstLine) || 1.25 },
      { name: 'before', label: 'Espacement avant (pt)', type: 'number', step: 1, min: 0, value: sp.before ? +(sp.before / 20).toFixed(1) : 0 },
      { name: 'after', label: 'Espacement après (pt)', type: 'number', step: 1, min: 0, value: sp.after ? +(sp.after / 20).toFixed(1) : 8 },
      { name: 'lineRule', label: 'Interligne', type: 'select', value: sp.lineRule === 'exact' ? 'exact' : sp.lineRule === 'atLeast' ? 'atLeast' : 'auto', options: [['auto', 'Multiple (lignes)'], ['atLeast', 'Au moins (pt)'], ['exact', 'Exactement (pt)']] },
      { name: 'line', label: 'Valeur', type: 'number', step: 0.05, min: 0, value: lineVal },
      { name: 'keepNext', label: 'Paragraphes solidaires', type: 'checkbox', value: !!props.keepNext },
      { name: 'keepLines', label: 'Lignes solidaires', type: 'checkbox', value: !!props.keepLines },
      { name: 'widow', label: 'Éviter veuves et orphelines', type: 'checkbox', value: props.widowControl !== false },
      { name: 'pbb', label: 'Saut de page avant', type: 'checkbox', value: !!props.pageBreakBefore },
      { name: 'ctx', label: 'Pas d’espace entre paragraphes du même style', type: 'checkbox', value: !!props.contextualSpacing },
    ],
  });
  if (!v) return;
  const n = (x) => (Number.isFinite(x) ? x : 0);
  return run(() =>
    forEachParagraph(async (target) => {
      const P = doc().format.paragraph;
      let r = await P.setAlignment({ target, alignment: v.alignment });
      if (r?.success === false) return r;
      const indent = { left: Math.round(n(v.left) * CM_TWIPS), right: Math.round(n(v.right) * CM_TWIPS) };
      if (v.special === 'firstLine') indent.firstLine = Math.round(n(v.by) * CM_TWIPS);
      if (v.special === 'hanging') indent.hanging = Math.round(n(v.by) * CM_TWIPS);
      if (v.special === 'none') indent.firstLine = 0;
      await P.setIndentation({ target, ...indent });
      const line = v.lineRule === 'auto' ? Math.round(n(v.line || 1) * 240) : Math.round(n(v.line || 12) * 20);
      await P.setSpacing({ target, before: Math.round(n(v.before) * 20), after: Math.round(n(v.after) * 20), line, lineRule: v.lineRule });
      await P.setKeepOptions({ target, keepNext: v.keepNext, keepLines: v.keepLines, widowControl: v.widow });
      await P.setFlowOptions({ target, pageBreakBefore: v.pbb, contextualSpacing: v.ctx });
      await P.setOutlineLevel({ target, outlineLevel: v.outline === '' ? null : Number(v.outline) });
      return r;
    }, snap),
  );
}

function bordersMenu(anchor) {
  const B = (side) => paraOp('setBorder', { side, style: 'single', size: 4, color: '000000', space: 1 });
  const all = () =>
    run(() =>
      forEachParagraph(async (target) => {
        for (const side of ['top', 'bottom', 'left', 'right']) await doc().format.paragraph.setBorder({ target, side, style: 'single', size: 4, color: '000000', space: 4 });
      }),
    );
  dropdown(anchor, [
    { label: '▁ Bordure inférieure', action: B('bottom') },
    { label: '▔ Bordure supérieure', action: B('top') },
    { label: '▏ Bordure gauche', action: B('left') },
    { label: '▕ Bordure droite', action: B('right') },
    { label: '☐ Encadré (toutes)', action: all },
    { label: '═ Bordure intérieure (entre)', action: B('between') },
    { label: '━ Ligne horizontale épaisse', action: paraOp('setBorder', { side: 'bottom', style: 'single', size: 18, color: '000000', space: 1 }) },
    { label: '═ Double ligne', action: paraOp('setBorder', { side: 'bottom', style: 'double', size: 6, color: '000000', space: 1 }) },
    { separator: true },
    { label: 'Aucune bordure', action: paraOp('clearBorder', { side: 'all' }) },
    { label: 'Bordures et trame…', action: borderDialog },
  ]);
}
async function borderDialog() {
  const v = await formDialog({
    title: 'Bordures du paragraphe',
    fields: [
      { name: 'style', label: 'Style', type: 'select', value: 'single', options: [['single', 'Simple'], ['double', 'Double'], ['dotted', 'Pointillé'], ['dashed', 'Tirets'], ['thick', 'Épais'], ['wave', 'Ondulé'], ['threeDEmboss', 'Relief 3D']] },
      { name: 'color', label: 'Couleur', type: 'color', value: '#000000' },
      { name: 'size', label: 'Épaisseur (pt)', type: 'select', value: '0.5', options: ['0.25', '0.5', '0.75', '1', '1.5', '2.25', '3', '4.5', '6'].map((x) => [x, `${x} pt`]) },
      { name: 'top', label: 'Haut', type: 'checkbox', value: true },
      { name: 'bottom', label: 'Bas', type: 'checkbox', value: true },
      { name: 'left', label: 'Gauche', type: 'checkbox', value: true },
      { name: 'right', label: 'Droite', type: 'checkbox', value: true },
      { name: 'fill', label: 'Trame de fond', type: 'color', value: '#FFFFFF' },
      { name: 'useFill', label: 'Appliquer la trame', type: 'checkbox', value: false },
    ],
  });
  if (!v) return;
  return run(() =>
    forEachParagraph(async (target) => {
      const P = doc().format.paragraph;
      await P.clearBorder({ target, side: 'all' });
      for (const side of ['top', 'bottom', 'left', 'right']) {
        if (v[side]) await P.setBorder({ target, side, style: v.style, color: hex(v.color), size: Math.round(parseFloat(v.size) * 8), space: 4 });
      }
      if (v.useFill) await P.setShading({ target, fill: hex(v.fill), val: 'clear', color: 'auto' });
    }),
  );
}

async function tabsDialog() {
  const v = await formDialog({
    title: 'Tabulations',
    fields: [
      { name: 'pos', label: 'Position (cm)', type: 'number', step: 0.25, value: 8 },
      { name: 'align', label: 'Alignement', type: 'select', value: 'left', options: [['left', 'Gauche'], ['center', 'Centré'], ['right', 'Droite'], ['decimal', 'Décimal'], ['bar', 'Barre']] },
      { name: 'leader', label: 'Points de suite', type: 'select', value: 'none', options: [['none', 'Aucun'], ['dot', '.......'], ['hyphen', '-------'], ['underscore', '______'], ['middleDot', '·······']] },
    ],
    extraButtons: [{ label: 'Tout effacer', action: 'clear' }],
  });
  if (!v) return;
  if (v.__action === 'clear') return paraOp('clearAllTabStops')();
  return paraOp('setTabStop', { position: Math.round(v.pos * CM_TWIPS), alignment: v.align, leader: v.leader })();
}

function spacingMenu(anchor) {
  const L = (line) => paraOp('setSpacing', { line: Math.round(line * 240), lineRule: 'auto' });
  dropdown(anchor, [
    { heading: 'Interligne' },
    ...[1, 1.15, 1.5, 2, 2.5, 3].map((x) => ({ label: String(x).replace('.', ','), action: L(x) })),
    { separator: true },
    { label: 'Ajouter un espace avant (12 pt)', action: paraOp('setSpacing', { before: 240 }) },
    { label: 'Supprimer l’espace avant', action: paraOp('setSpacing', { before: 0 }) },
    { label: 'Ajouter un espace après (8 pt)', action: paraOp('setSpacing', { after: 160 }) },
    { label: 'Supprimer l’espace après', action: paraOp('setSpacing', { after: 0 }) },
    { separator: true },
    { label: 'Options d’interligne…', action: paragraphDialog },
  ]);
}

async function stylesMenu(anchor) {
  let gallery = [];
  try {
    gallery = (await sd().ui.styles.getQuickGallery()) || [];
  } catch {
    /* ignore */
  }
  if (!gallery.length) {
    gallery = [
      { id: 'Normal', name: 'Normal' },
      { id: 'Title', name: 'Titre' },
      { id: 'Subtitle', name: 'Sous-titre' },
      ...[1, 2, 3, 4].map((n) => ({ id: `Heading${n}`, name: `Titre ${n}` })),
    ];
  }
  const FR = { Normal: 'Normal', 'No Spacing': 'Sans interligne', Title: 'Titre', Subtitle: 'Sous-titre', Quote: 'Citation', 'Intense Quote': 'Citation intense', 'List Paragraph': 'Paragraphe de liste' };
  const name = (s) => FR[s.name] || s.name.replace(/^heading (\d)/i, 'Titre $1');
  const items = gallery
    .filter((s) => s.type !== 'character' && s.type !== 'table' && s.type !== 'numbering')
    .slice(0, 30)
    .map((s) => {
      const css = s.preview?.css || {};
      const style = `font-family:'${css.fontFamily || 'inherit'}';font-weight:${css.fontWeight || 'normal'};font-style:${css.fontStyle || 'normal'};color:${css.color || 'inherit'};font-size:${Math.min(22, parseFloat(css.fontSize) * 1.33 || 14)}px`;
      return { html: `<span style="${esc(style)}">${esc(name(s))}</span>`, action: () => applyStyle(s.id) };
    });
  items.push({ separator: true }, { label: 'Effacer le style', action: paraOp('resetDirectFormatting') });
  dropdown(anchor, items, { className: 'styles-menu' });
}
function applyStyle(styleId) {
  return run(() => forEachParagraph((target) => doc().styles.paragraph.setStyle({ target, styleId })));
}

async function findReplace() {
  const v = await formDialog({
    title: 'Rechercher et remplacer',
    fields: [
      { name: 'q', label: 'Rechercher', type: 'text' },
      { name: 'r', label: 'Remplacer par', type: 'text' },
      { name: 'cs', label: 'Respecter la casse', type: 'checkbox', value: false },
      { name: 'ww', label: 'Mot entier', type: 'checkbox', value: false },
    ],
    ok: 'Remplacer tout',
    extraButtons: [{ label: 'Suivant', action: 'next' }],
  });
  if (!v || !v.q) return;
  const S = sd().ui.search;
  try {
    S.find(v.q, { caseSensitive: v.cs, wholeWord: v.ww, matchCase: v.cs });
    if (v.__action === 'next') {
      S.next();
      return;
    }
    const count = S.getSnapshot?.()?.total ?? S.getSnapshot?.()?.matches?.length;
    await S.replaceAll(v.r ?? '');
    notify(count != null ? `${count} remplacement(s) effectué(s)` : 'Remplacement effectué');
  } catch (e) {
    console.error(e);
    notify('Recherche impossible');
  }
}

/* ======================= INSERTION ======================= */
async function insertTable() {
  const v = await formDialog({
    title: 'Insérer un tableau',
    fields: [
      { name: 'cols', label: 'Nombre de colonnes', type: 'number', min: 1, max: 63, step: 1, value: 3 },
      { name: 'rows', label: 'Nombre de lignes', type: 'number', min: 1, max: 500, step: 1, value: 3 },
    ],
  });
  if (!v) return;
  const t = caretText();
  const at = t ? { kind: 'inParagraph', target: await blockAddress(t.blockId), offset: t.range.start } : undefined;
  return run(() => doc().create.table({ rows: Math.max(1, v.rows | 0), columns: Math.max(1, v.cols | 0), ...(at ? { at } : {}) }), 'Tableau inséré');
}

function pickImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = async () => {
      const src = fr.result;
      const dims = await new Promise((res) => {
        const img = new Image();
        img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => res({ w: 400, h: 300 });
        img.src = src;
      });
      const maxW = 6 * 96; // ~16 cm
      const scale = Math.min(1, maxW / dims.w);
      const t = caretText();
      const at = t ? { kind: 'inParagraph', target: await blockAddress(t.blockId), offset: t.range.start } : undefined;
      const r = await run(() => doc().create.image({ src, alt: f.name, size: { width: Math.round(dims.w * scale), height: Math.round(dims.h * scale) }, ...(at ? { at } : {}) }), 'Image insérée');
      if (r === false) cmd('image');
    };
    fr.readAsDataURL(f);
  };
  input.click();
}

async function insertLink() {
  const snap = snapshot();
  const v = await formDialog({
    title: 'Insérer un lien',
    fields: [
      { name: 'text', label: 'Texte à afficher', type: 'text', value: snap.quotedText || '' },
      { name: 'href', label: 'Adresse (https://, mailto:…)', type: 'text', value: 'https://' },
      { name: 'tip', label: 'Info-bulle', type: 'text' },
    ],
  });
  if (!v || !v.href) return;
  const link = { destination: { href: v.href }, ...(v.tip ? { tooltip: v.tip } : {}) };
  if (!snap.empty && snap.target?.segments?.length === 1 && v.text === snap.quotedText) {
    return run(() => doc().hyperlinks.wrap({ target: textRange(snap), link }), 'Lien ajouté');
  }
  return run(() => doc().hyperlinks.insert({ target: caretText(snap), text: v.text || v.href, link }), 'Lien inséré');
}

async function insertBookmark() {
  let n = 1;
  try {
    const names = new Set(((await doc().bookmarks.list())?.items || []).map((b) => b.name || b.bookmark?.name));
    while (names.has(`Signet${n}`)) n++;
  } catch {
    /* ignore */
  }
  const v = await formDialog({ title: 'Signet', fields: [{ name: 'name', label: 'Nom du signet', type: 'text', value: `Signet${n}` }] });
  if (!v || !v.name) return;
  const name = v.name.replace(/[^\p{L}\p{N}_]/gu, '_').replace(/^(\d)/, '_$1');
  return run(() => doc().bookmarks.insert({ name, at: textRange() }), `Signet « ${name} » ajouté`);
}

async function insertComment() {
  const snap = snapshot();
  if (snap.empty) return notify('Sélectionne le texte à commenter');
  const v = await formDialog({ title: 'Nouveau commentaire', fields: [{ name: 't', label: 'Commentaire', type: 'textarea' }] });
  if (!v || !v.t) return;
  return run(() => doc().comments.create({ text: v.t, target: snap.target }), 'Commentaire ajouté');
}

async function headerFooterText(kind) {
  const sec = await firstSection();
  const v = await formDialog({
    title: kind === 'header' ? 'En-tête' : 'Pied de page',
    fields: [
      { name: 'text', label: 'Texte à ajouter', type: 'text' },
      { name: 'first', label: 'Première page différente', type: 'checkbox', value: false },
      { type: 'info', html: '<small>Astuce : double-tape dans la zone d’en-tête / pied de page d’une page pour l’éditer directement.</small>' },
    ],
  });
  if (!v) return;
  if (v.first) await run(() => doc().sections.setTitlePage({ target: sec, enabled: true }));
  if (!v.text) return;
  const story = { kind: 'story', storyType: 'headerFooterSlot', section: sec, headerFooterKind: kind, variant: 'default', onWrite: 'materializeIfInherited' };
  let r = await run(() => doc().insert({ value: v.text, in: story }), kind === 'header' ? 'En-tête modifié' : 'Pied de page modifié');
  if (r === false) {
    const story2 = { kind: 'story', storyType: 'headerFooterSlot', section: sec, headerFooterKind: kind, variant: 'default' };
    await run(() => doc().insert({ value: v.text, in: story2 }));
  }
}

async function pageNumbers() {
  const v = await formDialog({
    title: 'Numéros de page',
    fields: [
      { name: 'kind', label: 'Position', type: 'select', value: 'footer', options: [['footer', 'Bas de page'], ['header', 'Haut de page']] },
      { name: 'alignment', label: 'Alignement', type: 'select', value: 'center', options: [['left', 'Gauche'], ['center', 'Centre'], ['right', 'Droite']] },
      { name: 'format', label: 'Format', type: 'select', value: 'decimal', options: [['decimal', '1, 2, 3'], ['lowerRoman', 'i, ii, iii'], ['upperRoman', 'I, II, III'], ['lowerLetter', 'a, b, c'], ['upperLetter', 'A, B, C'], ['numberInDash', '- 1 -']] },
      { name: 'start', label: 'Commencer à', type: 'number', min: 0, step: 1, value: 1 },
      { name: 'first', label: 'Afficher sur la première page', type: 'checkbox', value: true },
    ],
    extraButtons: [{ label: 'Supprimer', action: 'remove' }],
  });
  if (!v) return;
  const section = await firstSection();
  if (v.__action === 'remove') return run(() => doc().headerFooters.pageNumbers.remove({ section }), 'Numéros supprimés');
  await run(() => doc().sections.setPageNumbering({ target: section, format: v.format, start: v.start > 1 ? v.start : null }));
  return run(() => doc().headerFooters.pageNumbers.insert({ section, kind: v.kind, alignment: v.alignment, showOnFirstPage: v.first }), 'Numéros de page insérés');
}

async function insertField(instr, cached) {
  const at = caretText();
  if (!at) return notify('Place le curseur dans le document');
  return run(() => doc().fields.insert({ at, instruction: instr, mode: 'raw', cachedResultText: cached }));
}
async function dateDialog() {
  const d = new Date();
  const fmts = [
    ['dd/MM/yyyy', d.toLocaleDateString('fr-FR')],
    ['dddd d MMMM yyyy', d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })],
    ['d MMMM yyyy', d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })],
    ['dd/MM/yy', d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })],
    ['yyyy-MM-dd', d.toISOString().slice(0, 10)],
    ['MMMM yyyy', d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })],
    ['HH:mm', d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })],
    ['dd/MM/yyyy HH:mm', `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`],
  ];
  const v = await formDialog({
    title: 'Date et heure',
    fields: [
      { name: 'f', label: 'Format', type: 'select', value: '0', options: fmts.map(([, l], i) => [String(i), l]) },
      { name: 'auto', label: 'Mettre à jour automatiquement', type: 'checkbox', value: false },
    ],
  });
  if (!v) return;
  const [pic, text] = fmts[Number(v.f)];
  if (v.auto) return insertField(`DATE \\@ "${pic}"`, text);
  return insertText(text);
}
async function fieldDialog() {
  const v = await formDialog({
    title: 'Insérer un champ',
    fields: [
      {
        name: 'f',
        label: 'Champ',
        type: 'select',
        value: 'PAGE',
        options: [
          ['PAGE', 'Numéro de page (PAGE)'],
          ['NUMPAGES', 'Nombre de pages (NUMPAGES)'],
          ['SECTIONPAGES', 'Pages de la section'],
          ['AUTHOR', 'Auteur'],
          ['TITLE', 'Titre'],
          ['FILENAME', 'Nom du fichier'],
          ['CREATEDATE', 'Date de création'],
          ['SAVEDATE', 'Date d’enregistrement'],
          ['NUMWORDS', 'Nombre de mots'],
          ['custom', 'Autre (code de champ)…'],
        ],
      },
      { name: 'code', label: 'Code de champ (si Autre)', type: 'text' },
    ],
  });
  if (!v) return;
  const code = v.f === 'custom' ? v.code : v.f;
  if (!code) return;
  return insertField(code, v.f === 'PAGE' ? '1' : v.f === 'NUMPAGES' ? String(document.querySelectorAll('.superdoc-page').length || 1) : '');
}

const SYMBOLS = '€ £ $ ¥ ¢ © ® ™ § ¶ † ‡ • · … ‰ ° ± × ÷ ≠ ≈ ≤ ≥ ∞ √ ∑ ∏ ∫ ∂ ∆ π µ Ω α β γ δ ε θ λ σ φ ω ← → ↑ ↓ ↔ ⇒ ⇔ ✓ ✔ ✗ ✘ ★ ☆ ♥ ♦ ♣ ♠ ☺ ☎ ✉ ✂ ☐ ☑ ☒ « » “ ” ‘ ’ – — ½ ¼ ¾ ¹ ² ³ ⁿ ‹ › ¡ ¿ Æ æ Œ œ Ç ç'.split(' ');
function symbolsMenu(anchor) {
  dropdown(
    anchor,
    [
      { html: `<div class="sym-grid">${SYMBOLS.map((s) => `<span data-s="${esc(s)}">${esc(s)}</span>`).join('')}</div>`, action: () => {} },
      { label: 'Espace insécable', action: () => insertText(' ') },
      { label: 'Tiret insécable', action: () => insertText('‑') },
      { label: 'Trait d’union conditionnel', action: () => insertText('­') },
    ],
    { className: 'sym-menu' },
  );
  document.querySelectorAll('.sym-menu .sym-grid span').forEach((s) => {
    s.onmousedown = (e) => e.preventDefault();
    s.onclick = (e) => {
      e.stopPropagation();
      document.querySelector('.sym-menu')?.remove();
      insertText(s.dataset.s);
    };
  });
}

async function footnote(type = 'footnote') {
  const at = caretText();
  if (!at) return notify('Place le curseur dans le document');
  const v = await formDialog({ title: type === 'footnote' ? 'Note de bas de page' : 'Note de fin', fields: [{ name: 't', label: 'Texte de la note', type: 'textarea' }] });
  if (!v) return;
  const r = await doc().footnotes.insert({ at, type, content: v.t || ' ' }).catch((e) => ({ success: false, failure: { message: e.message } }));
  if (r?.success === false && /plain paragraph/.test(r.failure?.message || '')) return notify('Place le curseur dans un paragraphe de texte simple pour insérer une note');
  return ok(r, 'Note insérée');
}

async function watermark() {
  const v = await formDialog({
    title: 'Filigrane',
    fields: [
      { name: 'preset', label: 'Modèle', type: 'select', value: 'CONFIDENTIEL', options: ['CONFIDENTIEL', 'BROUILLON', 'URGENT', 'NE PAS COPIER', 'EXEMPLE', 'ORIGINAL', 'COPIE', '(personnalisé)'].map((x) => [x, x]) },
      { name: 'text', label: 'Texte personnalisé', type: 'text' },
      { name: 'font', label: 'Police', type: 'select', value: 'Calibri', options: FONTS.map((f) => [f, f]) },
      { name: 'color', label: 'Couleur', type: 'color', value: '#C0C0C0' },
      { name: 'orientation', label: 'Disposition', type: 'select', value: 'diagonal', options: [['diagonal', 'Diagonale'], ['horizontal', 'Horizontale']] },
      { name: 'semi', label: 'Semi-transparent', type: 'checkbox', value: true },
    ],
    extraButtons: [{ label: 'Supprimer', action: 'remove' }, { label: 'Image…', action: 'picture' }],
  });
  if (!v) return;
  const existing = (await doc().watermarks.list())?.items || (await doc().watermarks.list()) || [];
  const list = Array.isArray(existing) ? existing : existing.items || [];
  for (const w of list) {
    const id = w.watermarkId || w.address?.watermarkId || w.id;
    if (id) await doc().watermarks.remove({ target: { kind: 'watermark', watermarkId: id } });
  }
  if (v.__action === 'remove') return notify('Filigrane supprimé');
  if (v.__action === 'picture') {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => run(() => doc().watermarks.insert({ target: { kind: 'document' }, watermark: { kind: 'picture', src: fr.result, washout: true } }), 'Filigrane ajouté');
      fr.readAsDataURL(f);
    };
    return input.click();
  }
  const text = v.preset === '(personnalisé)' ? v.text : v.preset;
  if (!text) return;
  return run(
    () => doc().watermarks.insert({ target: { kind: 'document' }, watermark: { kind: 'text', text, fontFamily: v.font, color: hex(v.color), orientation: v.orientation, opacity: v.semi ? 0.5 : 1, fontSizePt: 'auto' } }),
    'Filigrane ajouté',
  );
}

async function sectionBreak(breakType) {
  const ids = selectedBlockIds();
  const at = ids.length ? { kind: 'after', target: await blockAddress(ids.at(-1)) } : { kind: 'documentEnd' };
  return run(() => doc().create.sectionBreak({ at, breakType }), 'Saut de section inséré');
}
function breaksMenu(anchor) {
  dropdown(anchor, [
    { heading: 'Sauts de page' },
    { label: 'Page', action: () => pageBreak(1) },
    { label: 'Colonne', action: () => insertRunXml('<w:r><w:br w:type="column"/></w:r>', () => notify('Saut de colonne impossible ici')) },
    { label: 'Saut de ligne (habillage du texte)', action: () => insertRunXml('<w:r><w:br/></w:r>', () => insertText('\u2028')) },
    { heading: 'Sauts de section' },
    { label: 'Page suivante', action: () => sectionBreak('nextPage') },
    { label: 'Continu', action: () => sectionBreak('continuous') },
    { label: 'Page paire', action: () => sectionBreak('evenPage') },
    { label: 'Page impaire', action: () => sectionBreak('oddPage') },
  ]);
}

async function caption() {
  const ids = selectedBlockIds();
  if (!ids.length) return notify('Place le curseur sous la figure ou le tableau');
  const v = await formDialog({
    title: 'Insérer une légende',
    fields: [
      { name: 'label', label: 'Étiquette', type: 'select', value: 'Figure', options: [['Figure', 'Figure'], ['Tableau', 'Tableau'], ['Équation', 'Équation']] },
      { name: 'text', label: 'Légende', type: 'text' },
      { name: 'pos', label: 'Position', type: 'select', value: 'below', options: [['below', 'Sous la sélection'], ['above', 'Au-dessus de la sélection']] },
    ],
  });
  if (!v) return;
  return run(async () => doc().captions.insert({ adjacentTo: await blockAddress(ids[0]), position: v.pos, label: v.label, text: v.text ? ` : ${v.text}` : '' }), 'Légende insérée');
}

async function insertTextBoxLike() {
  const ids = selectedBlockIds();
  const v = await formDialog({ title: 'Zone de texte (encadré)', fields: [{ name: 't', label: 'Texte', type: 'textarea' }] });
  if (!v || !v.t) return;
  return run(async () => {
    const at = ids.length ? { kind: 'after', target: await blockAddress(ids.at(-1)) } : { kind: 'documentEnd' };
    const r = await doc().create.paragraph({ at, text: v.t });
    if (r?.success === false) return r;
    const target = r.paragraph;
    const P = doc().format.paragraph;
    for (const side of ['top', 'bottom', 'left', 'right']) await P.setBorder({ target, side, style: 'single', size: 8, color: '000000', space: 4 });
    await P.setIndentation({ target, left: 567, right: 567 });
    return r;
  }, 'Encadré inséré');
}

async function dropCap() {
  const snap = snapshot();
  const ids = selectedBlockIds(snap);
  if (!ids.length) return notify('Place le curseur dans un paragraphe');
  const target = { kind: 'selection', start: { kind: 'text', blockId: ids[0], offset: 0 }, end: { kind: 'text', blockId: ids[0], offset: 1 } };
  return run(() => doc().format.apply({ target, inline: { fontSize: 36, bold: true, position: -16 } }), 'Lettrine appliquée');
}

/* ======================= MISE EN PAGE ======================= */
const marginsPreset = (top, bottom, left, right) => () => forEachSection((target) => doc().sections.setPageMargins({ target, top, bottom, left, right }));
function marginsMenu(anchor) {
  const c = (x) => +(x * CM_IN).toFixed(4);
  dropdown(anchor, [
    { label: 'Normales (2,5 cm)', action: marginsPreset(c(2.5), c(2.5), c(2.5), c(2.5)) },
    { label: 'Étroites (1,27 cm)', action: marginsPreset(0.5, 0.5, 0.5, 0.5) },
    { label: 'Modérées (2,54 / 1,91 cm)', action: marginsPreset(1, 1, 0.75, 0.75) },
    { label: 'Larges (2,54 / 5,08 cm)', action: marginsPreset(1, 1, 2, 2) },
    { label: 'Word par défaut (2,54 cm)', action: marginsPreset(1, 1, 1, 1) },
    { label: 'Miroir (int. 3,18 / ext. 2,54)', action: marginsPreset(1, 1, 1.25, 1) },
    { separator: true },
    { label: 'Marges personnalisées…', action: marginsDialog },
  ]);
}
async function marginsDialog() {
  const s = await sectionInfo();
  const m = s?.margins || { top: 1, bottom: 1, left: 1, right: 1, gutter: 0 };
  const hf = s?.headerFooterMargins || { header: 0.5, footer: 0.5 };
  const cm = (x) => +((x || 0) * 2.54).toFixed(2);
  const v = await formDialog({
    title: 'Mise en page — Marges',
    fields: [
      { name: 'top', label: 'Haut (cm)', type: 'number', step: 0.1, min: 0, value: cm(m.top) },
      { name: 'bottom', label: 'Bas (cm)', type: 'number', step: 0.1, min: 0, value: cm(m.bottom) },
      { name: 'left', label: 'Gauche (cm)', type: 'number', step: 0.1, min: 0, value: cm(m.left) },
      { name: 'right', label: 'Droite (cm)', type: 'number', step: 0.1, min: 0, value: cm(m.right) },
      { name: 'gutter', label: 'Reliure (cm)', type: 'number', step: 0.1, min: 0, value: cm(m.gutter) },
      { name: 'header', label: 'En-tête depuis le bord (cm)', type: 'number', step: 0.1, min: 0, value: cm(hf.header) },
      { name: 'footer', label: 'Pied depuis le bord (cm)', type: 'number', step: 0.1, min: 0, value: cm(hf.footer) },
    ],
  });
  if (!v) return;
  const i = (x) => +((x || 0) * CM_IN).toFixed(4);
  return forEachSection(async (target) => {
    await doc().sections.setHeaderFooterMargins({ target, header: i(v.header), footer: i(v.footer) });
    return doc().sections.setPageMargins({ target, top: i(v.top), bottom: i(v.bottom), left: i(v.left), right: i(v.right), gutter: i(v.gutter) });
  });
}
async function orientation(o) {
  const s = await sectionInfo();
  const w = s?.pageSetup?.width || 8.27;
  const h = s?.pageSetup?.height || 11.69;
  const [short, long] = w < h ? [w, h] : [h, w];
  return forEachSection((target) =>
    doc().sections.setPageSetup({ target, orientation: o, width: o === 'landscape' ? long : short, height: o === 'landscape' ? short : long }),
  );
}
const PAPER = [
  ['A4', 'A4 (21 × 29,7 cm)', 8.27, 11.69],
  ['A5', 'A5 (14,8 × 21 cm)', 5.83, 8.27],
  ['A3', 'A3 (29,7 × 42 cm)', 11.69, 16.54],
  ['B5', 'B5 (17,6 × 25 cm)', 6.93, 9.84],
  ['Letter', 'Lettre US (21,59 × 27,94 cm)', 8.5, 11],
  ['Legal', 'Légal (21,59 × 35,56 cm)', 8.5, 14],
  ['Executive', 'Executive (18,41 × 26,67 cm)', 7.25, 10.5],
  ['Env', 'Enveloppe DL (11 × 22 cm)', 4.33, 8.66],
];
function sizeMenu(anchor) {
  dropdown(anchor, [
    ...PAPER.map(([id, label, w, h]) => ({
      label,
      action: async () => {
        const s = await sectionInfo();
        const land = s?.pageSetup?.orientation === 'landscape';
        return forEachSection((target) => doc().sections.setPageSetup({ target, width: land ? h : w, height: land ? w : h, orientation: land ? 'landscape' : 'portrait' }));
      },
    })),
    { separator: true },
    {
      label: 'Taille personnalisée…',
      action: async () => {
        const v = await formDialog({ title: 'Taille du papier', fields: [{ name: 'w', label: 'Largeur (cm)', type: 'number', step: 0.1, value: 21 }, { name: 'h', label: 'Hauteur (cm)', type: 'number', step: 0.1, value: 29.7 }] });
        if (v) forEachSection((target) => doc().sections.setPageSetup({ target, width: +(v.w * CM_IN).toFixed(3), height: +(v.h * CM_IN).toFixed(3), orientation: v.w > v.h ? 'landscape' : 'portrait' }));
      },
    },
  ]);
}
function columnsMenu(anchor) {
  const C = (count, gap = 0.5) => () => forEachSection((target) => doc().sections.setColumns({ target, count, gap, equalWidth: true }));
  dropdown(anchor, [
    { label: '▯ Une', action: C(1) },
    { label: '▯▯ Deux', action: C(2) },
    { label: '▯▯▯ Trois', action: C(3) },
    { label: '▯▯▯▯ Quatre', action: C(4, 0.3) },
    { separator: true },
    {
      label: 'Autres colonnes…',
      action: async () => {
        const v = await formDialog({ title: 'Colonnes', fields: [{ name: 'n', label: 'Nombre', type: 'number', min: 1, max: 12, step: 1, value: 2 }, { name: 'gap', label: 'Espacement (cm)', type: 'number', step: 0.1, value: 1.25 }] });
        if (v) C(Math.max(1, v.n | 0), +(v.gap * CM_IN).toFixed(3))();
      },
    },
  ]);
}
function lineNumbersMenu(anchor) {
  const L = (enabled, restart) => () => forEachSection((target) => doc().sections.setLineNumbering({ target, enabled, ...(enabled ? { countBy: 1, start: 1, restart } : {}) }));
  dropdown(anchor, [
    { label: 'Aucun', action: L(false) },
    { label: 'Continu', action: L(true, 'continuous') },
    { label: 'Recommencer à chaque page', action: L(true, 'newPage') },
    { label: 'Recommencer à chaque section', action: L(true, 'newSection') },
  ]);
}
async function pageBorders() {
  const v = await formDialog({
    title: 'Bordures de page',
    fields: [
      { name: 'style', label: 'Style', type: 'select', value: 'single', options: [['single', 'Simple'], ['double', 'Double'], ['thick', 'Épais'], ['dotted', 'Pointillé'], ['dashed', 'Tirets'], ['triple', 'Triple'], ['threeDEmboss', 'Relief 3D']] },
      { name: 'color', label: 'Couleur', type: 'color', value: '#000000' },
      { name: 'size', label: 'Épaisseur (pt)', type: 'select', value: '1', options: ['0.5', '1', '1.5', '2.25', '3', '4.5', '6'].map((x) => [x, `${x} pt`]) },
      { name: 'display', label: 'Appliquer à', type: 'select', value: 'allPages', options: [['allPages', 'Toutes les pages'], ['firstPage', 'Première page seulement'], ['notFirstPage', 'Toutes sauf la première']] },
      { name: 'shadow', label: 'Ombre', type: 'checkbox', value: false },
    ],
    extraButtons: [{ label: 'Supprimer', action: 'remove' }],
  });
  if (!v) return;
  if (v.__action === 'remove') return forEachSection((target) => doc().sections.clearPageBorders({ target }));
  const spec = { style: v.style, color: hex(v.color), size: Math.round(parseFloat(v.size) * 8), space: 24, shadow: v.shadow };
  return forEachSection((target) => doc().sections.setPageBorders({ target, borders: { display: v.display, offsetFrom: 'page', top: spec, bottom: spec, left: spec, right: spec } }));
}
function vAlignMenu(anchor) {
  const A = (value) => () => forEachSection((target) => doc().sections.setVerticalAlign({ target, value }));
  dropdown(anchor, [
    { label: 'Haut', action: A('top') },
    { label: 'Centré', action: A('center') },
    { label: 'Bas', action: A('bottom') },
    { label: 'Justifié', action: A('both') },
  ]);
}
function hfOptionsMenu(anchor) {
  dropdown(anchor, [
    { label: 'Première page différente : oui', action: () => forEachSection((target) => doc().sections.setTitlePage({ target, enabled: true })) },
    { label: 'Première page différente : non', action: () => forEachSection((target) => doc().sections.setTitlePage({ target, enabled: false })) },
    { label: 'Pages paires et impaires différentes : oui', action: () => run(() => doc().sections.setOddEvenHeadersFooters({ enabled: true })) },
    { label: 'Pages paires et impaires différentes : non', action: () => run(() => doc().sections.setOddEvenHeadersFooters({ enabled: false })) },
  ]);
}

/* ======================= RÉFÉRENCES ======================= */
async function insertToc() {
  const v = await formDialog({
    title: 'Table des matières',
    fields: [
      { name: 'where', label: 'Emplacement', type: 'select', value: 'here', options: [['here', 'À la position du curseur'], ['start', 'Début du document']] },
      { name: 'levels', label: 'Niveaux affichés', type: 'select', value: '3', options: ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((x) => [x, x]) },
      { name: 'pages', label: 'Afficher les numéros de page', type: 'checkbox', value: true },
      { name: 'links', label: 'Liens hypertexte', type: 'checkbox', value: true },
    ],
  });
  if (!v) return;
  const ids = selectedBlockIds();
  const at = v.where === 'here' && ids.length ? { kind: 'before', target: await blockAddress(ids[0]) } : { kind: 'documentStart' };
  const instruction = `TOC \\o "1-${v.levels}"${v.links ? ' \\h' : ''} \\z \\u${v.pages ? '' : ' \\n'}`;
  return run(() => doc().create.tableOfContents({ at, instruction }), 'Table des matières insérée');
}
async function tocAction(action) {
  return run(async () => {
    const r = await doc().toc.list();
    const items = r?.items || [];
    if (!items.length) return { success: false, failure: { message: 'aucune table des matières' } };
    let res;
    for (const it of items) {
      const target = it.address || it.toc || { kind: 'block', nodeType: 'tableOfContents', nodeId: it.id };
      res = action === 'remove' ? await doc().toc.remove({ target }) : await doc().toc.update({ target, mode: action === 'pages' ? 'pageNumbers' : 'all' });
    }
    return res;
  }, action === 'remove' ? 'Table supprimée' : 'Table mise à jour');
}
async function updateFields() {
  return run(async () => {
    const r = await doc().fields.list();
    const items = r?.items || [];
    for (const f of items) {
      const target = f.address || { kind: 'field', fieldId: f.id };
      try {
        await doc().fields.rebuild({ target });
      } catch {
        /* skip non-rebuildable */
      }
    }
    try {
      for (const it of (await doc().toc.list())?.items || []) await doc().toc.update({ target: it.address, mode: 'all' });
    } catch {
      /* ignore */
    }
    return { success: true };
  }, 'Champs mis à jour');
}

/* ======================= RÉVISION ======================= */
async function wordCount() {
  let text = '';
  try {
    text = await doc().getText({});
  } catch {
    /* ignore */
  }
  const snap = snapshot();
  const sel = snap.quotedText || '';
  const words = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;
  const pages = document.querySelectorAll('.superdoc-page').length || Number(document.getElementById('status-left')?.textContent.match(/\d+/)?.[0]) || 1;
  let paras = text.split(/\n+/).filter((p) => p.trim()).length;
  try {
    const bl = await doc().blocks.list({});
    const items = bl?.items || [];
    const n = items.filter((b) => /paragraph|heading|listItem/.test(b.nodeType || b.address?.nodeType || b.kind || '')).length;
    if (n) paras = n;
    else if (bl?.total) paras = bl.total;
  } catch {
    /* ignore */
  }
  const rows = [
    ['Pages', pages],
    ['Mots', words(text)],
    ['Caractères (espaces non compris)', text.replace(/\s/g, '').length],
    ['Caractères (espaces compris)', text.replace(/\n/g, '').length],
    ['Paragraphes', paras],
    ['Lignes (approx.)', Math.ceil(text.length / 80)],
  ];
  if (sel) rows.push(['— Sélection : mots', words(sel)], ['— Sélection : caractères', sel.length]);
  return infoDialog('Statistiques', `<table class="stats">${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`);
}
let tracking = false;
function setTracking(on) {
  tracking = on;
  try {
    sd().setDocumentMode(on ? 'suggesting' : 'editing');
  } catch {
    cmd('document-mode', on ? 'suggesting' : 'editing');
  }
  document.querySelector('[data-rb="track"]')?.classList.toggle('on', on);
  notify(on ? 'Suivi des modifications activé' : 'Suivi des modifications désactivé');
}
async function protect() {
  const v = await formDialog({
    title: 'Restreindre la modification',
    fields: [
      { name: 'mode', label: 'Autoriser uniquement', type: 'select', value: 'readOnly', options: [['readOnly', 'Aucune modification (lecture seule)'], ['comments', 'Commentaires'], ['trackedChanges', 'Modifications suivies'], ['forms', 'Remplissage de formulaires']] },
    ],
    extraButtons: [{ label: 'Retirer la protection', action: 'clear' }],
  });
  if (!v) return;
  if (v.__action === 'clear') return run(() => doc().protection.clearEditingRestriction({}, { changeMode: 'direct' }), 'Protection retirée');
  return run(() => doc().protection.setEditingRestriction({ mode: v.mode }, { changeMode: 'direct' }), 'Protection appliquée (active dans Word)');
}

async function listComments() {
  let items = [];
  try {
    items = (await doc().comments.list())?.items || [];
  } catch (e) {
    console.warn(e);
  }
  if (!items.length) return infoDialog('Commentaires', 'Aucun commentaire dans ce document.');
  const html = items
    .map((c) => {
      const author = c.author?.name || c.creatorName || c.author || 'Auteur';
      const text = c.text ?? c.body ?? c.content ?? '';
      const quote = c.anchoredText || c.quotedText || '';
      return `<div class="cm-item"><b>${esc(author)}</b>${quote ? `<div class="cm-quote">« ${esc(quote)} »</div>` : ''}<div>${esc(typeof text === 'string' ? text : JSON.stringify(text))}</div></div>`;
    })
    .join('');
  return infoDialog(`Commentaires (${items.length})`, html);
}

/* ======================= AFFICHAGE ======================= */
function setMode(mode) {
  try {
    sd().setDocumentMode(mode);
  } catch (e) {
    console.warn(e);
  }
  document.body.classList.toggle('reading', mode === 'viewing');
  notify(mode === 'viewing' ? 'Mode Lecture' : 'Mode Modification');
}
function zoomMenu(anchor) {
  dropdown(anchor, [
    ...[50, 75, 100, 125, 150, 200, 300].map((z) => ({ label: `${z} %`, action: () => sd().setZoom(z) })),
    { label: 'Largeur de la page', action: () => sd().setZoomMode('fit-width') },
  ]);
}
function unitMenu(anchor) {
  const U = (u) => () => {
    try {
      sd().setMeasurementUnit(u);
    } catch {
      cmd('measurement-unit', u);
    }
  };
  dropdown(anchor, [
    { label: 'Centimètres', action: U('cm') },
    { label: 'Millimètres', action: U('mm') },
    { label: 'Pouces', action: U('in') },
    { label: 'Points', action: U('pt') },
  ]);
}

/* ======================= Ribbon definition ======================= */
const FONTS = ['Calibri', 'Calibri Light', 'Cambria', 'Arial', 'Arial Black', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Garamond', 'Century Gothic', 'Segoe UI', 'Helvetica', 'Comic Sans MS', 'Impact', 'Aptos'];

// Simple inline SVG icon set (24×24, stroke = currentColor)
const I = {
  cut: '<path d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  paste: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  brush: '<path d="M18 3l3 3-9 9-3-3zM9 12l-4 4a2 2 0 0 0 0 3 2 2 0 0 0 3 0l4-4"/>',
  page: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  pagebreak: '<path d="M6 2h12v7H6zM6 15h12v7H6z"/><path d="M2 12h3M8 12h3M13 12h3M19 12h3"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  header: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M4 7h16" stroke-width="3"/>',
  footer: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M4 17h16" stroke-width="3"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  omega: '<path d="M5 20h4v-2a7 7 0 1 1 6 0v2h4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  field: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  note: '<path d="M4 4h16v12H4z"/><path d="M4 20h8M7 8h10M7 12h6"/>',
  water: '<path d="M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0z"/>',
  margins: '<rect x="3" y="3" width="18" height="18"/><rect x="7" y="7" width="10" height="10" stroke-dasharray="2 2"/>',
  orient: '<rect x="2" y="7" width="14" height="10" rx="1"/><rect x="12" y="3" width="10" height="14" rx="1" stroke-dasharray="2 2"/>',
  size: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M8 14l3-3 3 3"/>',
  columns: '<rect x="3" y="3" width="18" height="18"/><path d="M12 3v18M6 7h3M6 11h3M15 7h3M15 11h3"/>',
  lines: '<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>',
  border: '<rect x="3" y="3" width="18" height="18" rx="1" stroke-width="2.6"/>',
  valign: '<path d="M4 4h16M4 20h16M12 7v10M9 10l3-3 3 3M9 14l3 3 3-3"/>',
  toc: '<path d="M4 6h10M4 10h14M6 14h12M6 18h10"/><path d="M19 6h1M20 18h1"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  caption: '<rect x="4" y="3" width="16" height="11"/><path d="M6 18h12M8 21h8"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  track: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  book: '<path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  pilcrow: '<path d="M13 4v16M17 4v16M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  styles: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  para: '<path d="M3 6h18M3 10h12M3 14h18M3 18h12"/>',
  tab: '<path d="M3 12h14M13 8l4 4-4 4M21 5v14"/>',
  shade: '<path d="M19 11 11 3 3 11l8 8z"/><path d="M21 15s-2 2.5-2 4a2 2 0 0 0 4 0c0-1.5-2-4-2-4z"/>',
  textbox: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M7 9h10M12 9v6"/>',
  dropcap: '<path d="M3 4h7v9H3zM13 6h8M13 10h8M3 16h18M3 20h18"/>',
  unit: '<path d="M2 12h20M6 9v6M10 10v4M14 9v6M18 10v4"/>',
  hline: '<path d="M3 12h18" stroke-width="3"/>',
  blank: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M12 11v6M9 14h6"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[name] || ''}</svg>`;

/**
 * Group = { label, items: [ { id, icon | glyph, label, title, action(anchorEl), menu: true } ] }
 */
function T(glyph, style = '') {
  return `<span class="glyph" style="${style}">${glyph}</span>`;
}
const TABS = {
  accueil: {
    label: 'Accueil',
    builtin: true,
    groups: [
      {
        label: 'Presse-papiers',
        items: [
          { icon: 'paste', label: 'Coller', action: () => clipboardAction('paste') },
          { icon: 'cut', label: 'Couper', action: () => clipboardAction('cut') },
          { icon: 'copy', label: 'Copier', action: () => clipboardAction('copy') },
          { icon: 'brush', label: 'Reproduire', title: 'Reproduire la mise en forme', action: () => cmd('copy-format') },
        ],
      },
      {
        label: 'Police',
        items: [
          { glyph: T('A<sup>▲</sup>'), label: 'Agrandir', action: () => growFont(1) },
          { glyph: T('A<sub>▼</sub>'), label: 'Réduire', action: () => growFont(-1) },
          { glyph: T('x<sub>2</sub>'), label: 'Indice', action: () => toggleInline('vertAlign', 'subscript') },
          { glyph: T('x<sup>2</sup>'), label: 'Exposant', action: () => toggleInline('vertAlign', 'superscript') },
          { glyph: T('Aa'), label: 'Casse', menu: true, action: (a) => dropdown(a, [
            { label: 'Phrase.', action: () => changeCase('sentence') },
            { label: 'minuscules', action: () => changeCase('lower') },
            { label: 'MAJUSCULES', action: () => changeCase('upper') },
            { label: 'Majuscule En Début De Mot', action: () => changeCase('title') },
            { label: 'iNVERSER lA cASSE', action: () => changeCase('toggle') },
            { label: 'Format MAJUSCULES (style)', action: () => changeCase('caps') },
            { label: 'Format Petites majuscules', action: () => changeCase('smallCaps') },
          ]) },
          { glyph: T('U', 'text-decoration:underline double'), label: 'Soulignement', menu: true, action: underlineMenu },
          { glyph: T('A', 'text-shadow:1px 1px 0 #999;font-weight:900'), label: 'Effets', menu: true, action: effectsMenu },
          { glyph: T('F', 'font-family:serif;font-weight:700'), label: 'Police…', action: fontDialog },
        ],
      },
      {
        label: 'Paragraphe',
        items: [
          { glyph: T('≡', 'font-size:22px'), label: 'Justifier', action: paraOp('setAlignment', { alignment: 'justify' }) },
          { icon: 'lines', label: 'Interligne', menu: true, action: spacingMenu },
          { icon: 'shade', label: 'Trame', menu: true, action: (a) => colorMenu(a, (c) => (c ? paraOp('setShading', { fill: c, val: 'clear', color: 'auto' })() : paraOp('clearShading')())) },
          { icon: 'border', label: 'Bordures', menu: true, action: bordersMenu },
          { icon: 'tab', label: 'Tabulations', action: tabsDialog },
          { icon: 'para', label: 'Paragraphe…', action: paragraphDialog },
          { icon: 'pilcrow', label: 'Afficher ¶', action: () => cmd('formatting-marks') },
        ],
      },
      {
        label: 'Styles',
        items: [
          { glyph: T('AaBb', 'font-size:13px'), label: 'Normal', action: () => applyStyle('Normal') },
          { glyph: T('AaBb', 'font-size:15px;font-weight:700;color:#2F5496'), label: 'Titre 1', action: () => applyStyle('Heading1') },
          { glyph: T('AaBb', 'font-size:14px;font-weight:700;color:#2F5496'), label: 'Titre 2', action: () => applyStyle('Heading2') },
          { glyph: T('AaBb', 'font-size:13px;font-weight:700;color:#1F3763'), label: 'Titre 3', action: () => applyStyle('Heading3') },
          { glyph: T('Aa', 'font-size:20px'), label: 'Titre', action: () => applyStyle('Title') },
          { icon: 'styles', label: 'Tous les styles', menu: true, action: stylesMenu },
        ],
      },
      { label: 'Modification', items: [{ icon: 'search', label: 'Remplacer', action: findReplace }] },
    ],
  },
  insertion: {
    label: 'Insertion',
    groups: [
      {
        label: 'Pages',
        items: [
          { icon: 'blank', label: 'Page vierge', action: () => pageBreak(2) },
          { icon: 'pagebreak', label: 'Saut de page', action: () => pageBreak(1) },
          { icon: 'pagebreak', label: 'Sauts', menu: true, action: breaksMenu },
        ],
      },
      { label: 'Tableaux', items: [{ icon: 'table', label: 'Tableau', action: insertTable }] },
      { label: 'Illustrations', items: [{ icon: 'image', label: 'Image', action: pickImage }] },
      {
        label: 'Liens',
        items: [
          { icon: 'link', label: 'Lien', action: insertLink },
          { icon: 'bookmark', label: 'Signet', action: insertBookmark },
        ],
      },
      { label: 'Commentaires', items: [{ icon: 'comment', label: 'Commentaire', action: insertComment }] },
      {
        label: 'En-tête et pied',
        items: [
          { icon: 'header', label: 'En-tête', action: () => headerFooterText('header') },
          { icon: 'footer', label: 'Pied de page', action: () => headerFooterText('footer') },
          { icon: 'hash', label: 'N° de page', action: pageNumbers },
        ],
      },
      {
        label: 'Texte',
        items: [
          { icon: 'textbox', label: 'Encadré', action: insertTextBoxLike },
          { icon: 'dropcap', label: 'Lettrine', action: dropCap },
          { icon: 'calendar', label: 'Date/heure', action: dateDialog },
          { icon: 'field', label: 'Champ', action: fieldDialog },
          { icon: 'hline', label: 'Ligne', action: paraOp('setBorder', { side: 'bottom', style: 'single', size: 6, color: '000000', space: 1 }) },
        ],
      },
      {
        label: 'Symboles',
        items: [
          { icon: 'omega', label: 'Symbole', menu: true, action: symbolsMenu },
          { icon: 'water', label: 'Filigrane', action: watermark },
        ],
      },
    ],
  },
  miseenpage: {
    label: 'Mise en page',
    groups: [
      {
        label: 'Mise en page',
        items: [
          { icon: 'margins', label: 'Marges', menu: true, action: marginsMenu },
          { icon: 'orient', label: 'Orientation', menu: true, action: (a) => dropdown(a, [{ label: 'Portrait', action: () => orientation('portrait') }, { label: 'Paysage', action: () => orientation('landscape') }]) },
          { icon: 'size', label: 'Taille', menu: true, action: sizeMenu },
          { icon: 'columns', label: 'Colonnes', menu: true, action: columnsMenu },
          { icon: 'pagebreak', label: 'Sauts', menu: true, action: breaksMenu },
          { icon: 'lines', label: 'N° de ligne', menu: true, action: lineNumbersMenu },
        ],
      },
      {
        label: 'Paragraphe',
        items: [
          { icon: 'tab', label: 'Retrait +', action: paraOp('setIndentation', { left: 720 }) },
          { icon: 'para', label: 'Retraits et espacement', action: paragraphDialog },
        ],
      },
      {
        label: 'Page',
        items: [
          { icon: 'border', label: 'Bordures de page', action: pageBorders },
          { icon: 'valign', label: 'Alignement vertical', menu: true, action: vAlignMenu },
          { icon: 'header', label: 'Options en-tête', menu: true, action: hfOptionsMenu },
          { icon: 'water', label: 'Filigrane', action: watermark },
        ],
      },
    ],
  },
  references: {
    label: 'Références',
    groups: [
      {
        label: 'Table des matières',
        items: [
          { icon: 'toc', label: 'Table des matières', action: insertToc },
          { icon: 'refresh', label: 'Mettre à jour', action: () => tocAction('all') },
          { icon: 'x', label: 'Supprimer la table', action: () => tocAction('remove') },
          { icon: 'para', label: 'Ajouter le texte', menu: true, action: (a) => dropdown(a, [
            { label: 'Ne pas afficher dans la table', action: paraOp('setOutlineLevel', { outlineLevel: null }) },
            ...[1, 2, 3].map((n) => ({ label: `Niveau ${n}`, action: () => applyStyle(`Heading${n}`) })),
          ]) },
        ],
      },
      {
        label: 'Notes',
        items: [
          { icon: 'note', label: 'Note de bas de page', action: () => footnote('footnote') },
          { icon: 'note', label: 'Note de fin', action: () => footnote('endnote') },
        ],
      },
      {
        label: 'Légendes',
        items: [
          { icon: 'caption', label: 'Légende', action: caption },
          { icon: 'bookmark', label: 'Signet', action: insertBookmark },
          { icon: 'refresh', label: 'Mettre à jour les champs', action: updateFields },
        ],
      },
    ],
  },
  revision: {
    label: 'Révision',
    groups: [
      { label: 'Vérification', items: [{ icon: 'stats', label: 'Statistiques', action: wordCount }] },
      {
        label: 'Commentaires',
        items: [
          { icon: 'comment', label: 'Nouveau commentaire', action: insertComment },
          { icon: 'book', label: 'Voir les commentaires', action: listComments },
        ],
      },
      {
        label: 'Suivi',
        items: [
          { id: 'track', icon: 'track', label: 'Suivi des modifs', action: () => setTracking(!tracking) },
        ],
      },
      {
        label: 'Modifications',
        items: [
          { icon: 'check', label: 'Accepter', action: () => cmd('track-changes-accept-selection') },
          { icon: 'x', label: 'Refuser', action: () => cmd('track-changes-reject-selection') },
          { icon: 'check', label: 'Tout accepter', action: () => cmd('acceptAllChanges') },
          { icon: 'x', label: 'Tout refuser', action: () => cmd('rejectAllChanges') },
        ],
      },
      { label: 'Protéger', items: [{ icon: 'lock', label: 'Restreindre', action: protect }] },
    ],
  },
  affichage: {
    label: 'Affichage',
    groups: [
      {
        label: 'Affichages',
        items: [
          { icon: 'book', label: 'Mode Lecture', action: () => setMode('viewing') },
          { icon: 'edit', label: 'Modification', action: () => setMode('editing') },
        ],
      },
      {
        label: 'Afficher',
        items: [
          { icon: 'ruler', label: 'Règle', action: () => { try { sd().toggleRuler(); } catch { cmd('ruler'); } } },
          { icon: 'pilcrow', label: 'Marques ¶', action: () => cmd('formatting-marks') },
          { icon: 'unit', label: 'Unité', menu: true, action: unitMenu },
        ],
      },
      {
        label: 'Zoom',
        items: [
          { icon: 'zoom', label: 'Zoom', menu: true, action: zoomMenu },
          { glyph: T('100%', 'font-size:12px;font-weight:700'), label: '100 %', action: () => sd().setZoom(100) },
          { icon: 'fit', label: 'Largeur page', action: () => sd().setZoomMode('fit-width') },
        ],
      },
    ],
  },
};

/* ======================= rendering ======================= */
function renderGroup(g) {
  const el = document.createElement('div');
  el.className = 'rb-group';
  const row = document.createElement('div');
  row.className = 'rb-items';
  for (const it of g.items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rb-btn';
    if (it.id) b.dataset.rb = it.id;
    b.title = it.title || it.label;
    b.innerHTML = `${it.icon ? svg(it.icon) : it.glyph}<span class="rb-label">${esc(it.label)}${it.menu ? ' ▾' : ''}</span>`;
    b.onmousedown = (e) => e.preventDefault(); // keep editor selection
    b.onclick = () => it.action?.(b);
    row.appendChild(b);
  }
  const label = document.createElement('div');
  label.className = 'rb-glabel';
  label.textContent = g.label;
  el.append(row, label);
  return el;
}

export function initRibbon({ getSuperdoc, toast }) {
  getSd = getSuperdoc;
  notify = toast;
  const tabsEl = document.getElementById('rb-tabs');
  const panel = document.getElementById('rb-panel');
  const extra = document.getElementById('rb-extra');
  const builtin = document.getElementById('toolbar');
  const panes = {};
  for (const [key, tab] of Object.entries(TABS)) {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'rb-tab';
    t.dataset.tab = key;
    t.textContent = tab.label;
    t.onmousedown = (e) => e.preventDefault();
    t.onclick = () => select(key);
    tabsEl.appendChild(t);
    const pane = document.createElement('div');
    pane.className = 'rb-pane';
    for (const g of tab.groups) pane.appendChild(renderGroup(g));
    panes[key] = pane;
  }
  function select(key) {
    tabsEl.querySelectorAll('.rb-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === key));
    extra.innerHTML = '';
    extra.appendChild(panes[key]);
    builtin.parentElement.classList.toggle('show-builtin', !!TABS[key].builtin);
    panel.scrollLeft = 0;
  }
  select('accueil');
}

export function resetRibbonState() {
  tracking = false;
  document.querySelector('[data-rb="track"]')?.classList.remove('on');
  document.body.classList.remove('reading');
}
