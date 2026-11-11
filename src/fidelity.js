// .WORKS — DOCX fidelity layer.
//
// Goal: a document edited in .WORKS must re-open in Microsoft Word and LibreOffice exactly as it was,
// with only the user's edits changed.
//
//  1. When nothing was modified, the original file bytes are returned untouched (byte-for-byte).
//  2. Every part the engine did not change is written back with its ORIGINAL bytes.
//  3. Parts of the original package that the export still references but dropped are restored.
//  4. Elements whose child order is enforced by the OOXML schema (borders, pPr, rPr, sectPr, tblPr,
//     tcPr…) are put back in schema order — Word rejects out-of-order children
//     ("Word found unreadable content"), LibreOffice silently ignores them.
//  5. Every XML part is parsed before saving: a broken package is never written over the user's file.
import { unzipSync, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

/* ---------------- schema order (ECMA-376 transitional, w: namespace) ---------------- */
const seq = (s) => s.trim().split(/\s+/);
const BORDER4 = seq('top left start bottom right end');
const ORDER = {
  pBdr: seq('top left start bottom right end between bar'),
  pgBorders: BORDER4,
  tblBorders: seq('top left start bottom right end insideH insideV'),
  tcBorders: seq('top left start bottom right end insideH insideV tl2br tr2bl'),
  tblCellMar: BORDER4,
  tcMar: BORDER4,
  pPr: seq(`pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers pBdr shd tabs
    suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid
    spacing ind contextualSpacing mirrorIndents suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl
    divId cnfStyle rPr sectPr pPrChange`),
  rPr: seq(`ins del moveFrom moveTo rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint
    noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign
    rtl cs em lang eastAsianLayout specVanish oMath __w14__ rPrChange`),
  sectPr: seq(`headerReference footerReference footnotePr endnotePr type pgSz pgMar paperSrc pgBorders lnNumType pgNumType
    cols formProt vAlign noEndnote titlePg textDirection bidi rtlGutter docGrid printerSettings sectPrChange`),
  tblPr: seq(`tblStyle tblpPr tblOverlap bidiVisual tblStyleRowBandSize tblStyleColBandSize tblW jc tblCellSpacing tblInd
    tblBorders shd tblLayout tblCellMar tblLook tblCaption tblDescription tblPrChange`),
  tcPr: seq(`cnfStyle tcW gridSpan hMerge vMerge tcBorders shd noWrap tcMar textDirection tcFitText vAlign hideMark headers
    cellIns cellDel cellMerge tcPrChange`),
};
// headerReference / footerReference may be freely interleaved: give them the same rank.
const SAME_RANK = { sectPr: { footerReference: 'headerReference' } };

function rankOf(parentName, el) {
  const order = ORDER[parentName];
  let name = el.localName;
  if (el.namespaceURI !== W) {
    if (parentName === 'rPr' && el.namespaceURI === W14) name = '__w14__';
    else return -1; // unknown: sticks to its predecessor
  }
  name = SAME_RANK[parentName]?.[name] || name;
  return order.indexOf(name);
}

/** Reorder children of schema-ordered containers. Returns true when something moved. */
function fixOrder(xmlDoc) {
  let changed = false;
  for (const parentName of Object.keys(ORDER)) {
    const list = xmlDoc.getElementsByTagNameNS(W, parentName);
    for (let i = 0; i < list.length; i++) {
      const parent = list[i];
      const kids = [...parent.children];
      if (kids.length < 2) continue;
      let last = -1;
      let prev = -1;
      let sorted = true;
      const ranked = kids.map((el, idx) => {
        let r = rankOf(parentName, el);
        if (r < 0) r = prev + 0.5; // keep unknown elements right after the previous known one
        else prev = r;
        if (r < last) sorted = false;
        last = r;
        return { el, r, idx };
      });
      if (sorted) continue;
      ranked.sort((a, b) => a.r - b.r || a.idx - b.idx);
      for (const { el } of ranked) parent.appendChild(el); // appendChild moves the node
      changed = true;
    }
  }
  return changed;
}

/* ---------------- helpers ---------------- */
const isXmlPart = (n) => /\.(xml|rels|vml)$/i.test(n);
const prologOf = (text) => text.match(/^﻿?<\?xml[^>]*\?>\s*/)?.[0] || '';
function parseXml(text) {
  const d = new DOMParser().parseFromString(text, 'application/xml');
  if (d.getElementsByTagName('parsererror').length) return null;
  return d;
}
/** Canonical form used to decide whether a part really changed (ignores engine-only noise). */
function canon(bytes) {
  return dec
    .decode(bytes)
    .replace(/^﻿?<\?xml[^>]*\?>\s*/, '')
    .replace(/\s+w14:(paraId|textId)="[0-9A-Fa-f]+"/g, '')
    .replace(/\s+\/>/g, '/>')
    .replace(/\r\n/g, '\n');
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function resolveTarget(relsPath, target) {
  // word/_rels/document.xml.rels + "media/a.png" -> word/media/a.png
  const base = relsPath.replace(/_rels\/[^/]+\.rels$/, '');
  const parts = (target.startsWith('/') ? target.slice(1) : base + target).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return decodeURIComponent(out.join('/'));
}

/**
 * Post-process an exported .docx.
 * @param {Uint8Array} exported  bytes produced by the editor
 * @param {Uint8Array|null} original  bytes of the file that was opened (null for a new document)
 * @returns {{ bytes: Uint8Array, report: object }}
 */
export function finalizeDocx(exported, original) {
  const report = { reordered: [], keptOriginal: [], restored: [], invalid: [] };
  const out = unzipSync(exported);
  const orig = original ? safeUnzip(original) : null;

  // 1. schema order + well-formedness of every XML part
  for (const name of Object.keys(out)) {
    if (!isXmlPart(name)) continue;
    const text = dec.decode(out[name]);
    const needsOrderCheck = /^word\/.*\.xml$/.test(name) && /<w:(pBdr|pgBorders|tblBorders|tcBorders|tblCellMar|tcMar|pPr|rPr|sectPr|tblPr|tcPr)[\s>]/.test(text);
    if (!needsOrderCheck) {
      if (!parseXml(text)) report.invalid.push(name);
      continue;
    }
    const xml = parseXml(text);
    if (!xml) {
      report.invalid.push(name);
      continue;
    }
    if (fixOrder(xml)) {
      const body = new XMLSerializer().serializeToString(xml).replace(/^<\?xml[^>]*\?>\s*/, '');
      out[name] = enc.encode((prologOf(text) || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n') + body);
      report.reordered.push(name);
    }
  }
  if (report.invalid.length) {
    const err = new Error(`Export invalide (${report.invalid.join(', ')})`);
    err.report = report;
    throw err;
  }

  if (orig) {
    // 2. untouched parts keep their exact original bytes
    for (const name of Object.keys(out)) {
      const o = orig[name];
      if (!o || sameBytes(o, out[name])) continue;
      if (isXmlPart(name) && canon(o) === canon(out[name])) {
        out[name] = o;
        report.keptOriginal.push(name);
      }
    }
    // 3. restore parts that are still referenced but were dropped by the export
    const referenced = new Set();
    for (const name of Object.keys(out)) {
      if (!name.endsWith('.rels')) continue;
      const rels = parseXml(dec.decode(out[name]));
      if (!rels) continue;
      for (const r of rels.getElementsByTagNameNS(REL_NS, 'Relationship')) {
        if (r.getAttribute('TargetMode') === 'External') continue;
        const t = r.getAttribute('Target');
        if (t) referenced.add(resolveTarget(name, t));
      }
    }
    const missing = Object.keys(orig).filter((n) => !out[n] && referenced.has(n));
    for (const n of missing) {
      out[n] = orig[n];
      report.restored.push(n);
      const relsName = n.replace(/([^/]+)$/, '_rels/$1.rels');
      if (orig[relsName] && !out[relsName]) out[relsName] = orig[relsName];
    }
    if (missing.length) ensureContentTypes(out, orig, missing);
  }

  // Same part order as the original package ([Content_Types].xml first) for maximal compatibility.
  const order = ['[Content_Types].xml', ...(orig ? Object.keys(orig) : []), ...Object.keys(out)];
  const zipped = {};
  for (const n of order) if (out[n] && !zipped[n]) zipped[n] = [out[n], { level: /\.(png|jpe?g|gif|emf|wmf|bin|odttf|ttf)$/i.test(n) ? 0 : 6 }];
  return { bytes: zipSync(zipped), report };
}

function ensureContentTypes(out, orig, parts) {
  const ctName = '[Content_Types].xml';
  const ct = parseXml(dec.decode(out[ctName]));
  const oct = parseXml(dec.decode(orig[ctName] || new Uint8Array()));
  if (!ct || !oct) return;
  const root = ct.documentElement;
  const has = (tag, attr, val) => [...root.getElementsByTagNameNS(CT_NS, tag)].some((e) => (e.getAttribute(attr) || '').toLowerCase() === val.toLowerCase());
  let changed = false;
  for (const p of parts) {
    const ext = p.split('.').pop();
    if (has('Override', 'PartName', `/${p}`)) continue;
    const ov = [...oct.getElementsByTagNameNS(CT_NS, 'Override')].find((e) => e.getAttribute('PartName') === `/${p}`);
    if (ov) {
      root.appendChild(ct.importNode(ov, true));
      changed = true;
    } else if (!has('Default', 'Extension', ext)) {
      const def = [...oct.getElementsByTagNameNS(CT_NS, 'Default')].find((e) => (e.getAttribute('Extension') || '').toLowerCase() === ext.toLowerCase());
      if (def) {
        root.insertBefore(ct.importNode(def, true), root.firstChild);
        changed = true;
      }
    }
  }
  if (changed) {
    const text = dec.decode(out[ctName]);
    out[ctName] = enc.encode(prologOf(text) + new XMLSerializer().serializeToString(ct).replace(/^<\?xml[^>]*\?>\s*/, ''));
  }
}

function safeUnzip(bytes) {
  try {
    return unzipSync(bytes);
  } catch {
    return null;
  }
}

/** Quick check that bytes look like a Word package (used before opening a file). */
export function looksLikeDocx(bytes) {
  const z = safeUnzip(bytes);
  if (!z || !z['[Content_Types].xml']) return false;
  const main = Object.keys(z).find((n) => /^word\/document\d*\.xml$/.test(n));
  return !!main && !!parseXml(dec.decode(z['[Content_Types].xml'])) && !!parseXml(dec.decode(z[main]));
}
