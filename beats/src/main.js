// .BEATS — studio de montage audio + voix IA · SuperEssence Studio
import './style.css';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';
import * as E from './engine.js';
import { buffers, project, transport, clipLen, clipEnd } from './engine.js';
import { analyse, blankAnalysis, chordName, NOTES_FR } from './analysis.js';
import { generate, STYLES, ELEMENTS } from './generator.js';
import * as D from './dsp.js';
import * as V from './voice.js';
import { saveProject, listProjects, loadProject, deleteProject } from './store.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const isNative = Capacitor.isNativePlatform();
const HEAD = 104; // track header width (px)
const ui = { pps: 40, sel: null, tab: 'studio', style: 'trap', elements: new Set(['drums', 'bass', 'chords', 'fx']), seed: 1, metro: false, rec: null };

/* ================= helpers ================= */
let toastT;
function toast(m, ms = 2800) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function busy(on, text = 'Traitement…', p = null) {
  $('#busy').classList.toggle('hidden', !on);
  $('#busy-text').textContent = text;
  $('#busy-bar').style.width = p == null ? '0' : `${Math.round(p * 100)}%`;
  $('#busy .bar').style.visibility = p == null ? 'hidden' : 'visible';
}
const nextFrame = () => new Promise((r) => setTimeout(r, 30));
async function task(text, fn) {
  busy(true, text); await nextFrame();
  try { return await fn((p, t) => busy(true, t || text, p)); }
  catch (e) { console.error(e); toast('⚠ ' + (e.message || e), 4500); }
  finally { busy(false); }
}
const fmt = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
const beat = () => 60 / project.cur.bpm;
const grid0 = () => project.cur.analysis?.firstBeat % (beat() * 4) || 0;
const snap = (t) => { if (!project.cur.snap) return t; const b = beat() / 2, g = grid0(); return Math.max(0, Math.round((t - g) / b) * b + g); };
const base = (n) => (n || 'son').replace(/\.[a-z0-9]+$/i, '');
function blobToB64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); }); }
function pickFiles(multiple = true, accept) {
  return new Promise((res) => {
    const inp = $('#file'); inp.multiple = multiple; if (accept) inp.accept = accept;
    inp.value = ''; inp.onchange = () => res([...inp.files]); inp.click();
  });
}
let dirtyT;
function changed() { renderTimeline(); clearTimeout(dirtyT); dirtyT = setTimeout(() => saveProject().catch(() => {}), 2500); }

/* ================= sheet (bottom dialog) ================= */
function sheet(html, bind) {
  $('#sheet-body').innerHTML = html;
  $('#sheet').classList.remove('hidden'); $('#sheet-bg').classList.remove('hidden');
  bind?.($('#sheet-body'));
}
function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheet-bg').classList.add('hidden'); }
$('#sheet-bg').onclick = closeSheet;
const sheetOpen = () => !$('#sheet').classList.contains('hidden');

/* ================= tabs ================= */
function tab(name) {
  ui.tab = name;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === name));
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  if (name === 'projects') renderProjects();
  if (name === 'ai') renderAnalysis();
  if (name === 'studio') renderTimeline();
}
$$('.tabs button').forEach((b) => (b.onclick = () => tab(b.dataset.tab)));

/* ================= waveform cache ================= */
const peaks = new Map();
function peaksOf(bufId) {
  if (peaks.has(bufId)) return peaks.get(bufId);
  const b = buffers.get(bufId).buffer, per = 200, n = Math.ceil(b.duration * per), step = b.sampleRate / per;
  const out = new Float32Array(n), chs = Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i));
  for (let i = 0; i < n; i++) {
    let m = 0;
    const a = Math.floor(i * step), e = Math.min(b.length, Math.floor((i + 1) * step));
    for (const d of chs) for (let j = a; j < e; j += 4) { const v = Math.abs(d[j]); if (v > m) m = v; }
    out[i] = m;
  }
  peaks.set(bufId, out);
  return out;
}
function drawWave(cv, clip, color, w) {
  const h = cv.clientHeight || 56, cw = Math.min(8000, Math.max(1, Math.floor(w)));
  cv.width = cw; cv.height = h;
  const g = cv.getContext('2d'), pk = peaksOf(clip.bufId);
  g.fillStyle = color;
  const len = clipLen(clip);
  for (let x = 0; x < cw; x++) {
    const t0 = clip.offset + (x / cw) * len * clip.rate, t1 = clip.offset + ((x + 1) / cw) * len * clip.rate;
    let m = 0;
    for (let i = Math.floor(t0 * 200); i <= Math.floor(t1 * 200); i++) m = Math.max(m, pk[i] || 0);
    const tl = (x / cw) * len, env = Math.min(1, clip.fadeIn ? tl / clip.fadeIn : 1, clip.fadeOut ? (len - tl) / clip.fadeOut : 1);
    const a = Math.max(1, m * env * clip.gain * h * 0.92);
    g.fillRect(x, (h - a) / 2, 1, a);
  }
}

/* ================= timeline ================= */
function renderTimeline() {
  const p = project.cur;
  $('#proj-name').value = p.name;
  $('#bpm').value = Math.round(p.bpm * 10) / 10;
  $('#key-badge').textContent = p.key ? p.key.name : 'Tonalité ?';
  $('#btn-snap').textContent = p.snap ? 'Grille ✓' : 'Grille ✗';
  $('#btn-snap').classList.toggle('on', p.snap);
  $('#btn-metro').classList.toggle('on', ui.metro);
  $('#tl-empty').style.display = p.tracks.length ? 'none' : 'flex';
  const total = Math.max(E.projectEnd() + 30, 60), width = total * ui.pps;
  $('#tl-inner').style.width = `${HEAD + width}px`;
  // ruler
  const rl = $('#ruler-lane'); rl.innerHTML = ''; rl.style.width = `${width}px`;
  const bar = beat() * 4, g = grid0();
  const every = ui.pps * bar < 28 ? 4 : ui.pps * bar < 60 ? 2 : 1;
  for (let i = 0, t = g; t < total; t += bar, i++) {
    if (i % every) continue;
    const m = document.createElement('i'); m.style.left = `${t * ui.pps}px`; m.textContent = i + 1; rl.appendChild(m);
  }
  const ts = $('#tracks'); ts.innerHTML = '';
  p.tracks.forEach((t, ti) => {
    const row = document.createElement('div'); row.className = 'trow'; row.dataset.track = t.id;
    row.innerHTML = `<div class="thead" style="--c:${t.color}">
        <b class="tname"></b>
        <div class="tbtns"><button class="m ${t.mute ? 'on' : ''}">M</button><button class="s ${t.solo ? 'on' : ''}">S</button><button class="cfg">⚙</button></div>
      </div><div class="lane" style="width:${width}px"></div>`;
    row.querySelector('.tname').textContent = t.name;
    row.querySelector('.m').onclick = () => { t.mute = !t.mute; liveRestart(); changed(); };
    row.querySelector('.s').onclick = () => { t.solo = !t.solo; liveRestart(); changed(); };
    row.querySelector('.cfg').onclick = () => trackSheet(t);
    row.querySelector('.tname').onclick = () => trackSheet(t);
    const lane = row.querySelector('.lane');
    // beat grid background
    lane.style.backgroundSize = `${bar * ui.pps}px 100%`;
    lane.style.backgroundPosition = `${g * ui.pps}px 0`;
    lane.onclick = (e) => { if (e.target === lane) { select(null); E.seek((e.offsetX) / ui.pps); updatePlayhead(); } };
    for (const c of t.clips) {
      const el = document.createElement('div');
      el.className = 'clip' + (ui.sel === c.id ? ' sel' : '');
      const w = clipLen(c) * ui.pps;
      el.style.cssText = `left:${c.start * ui.pps}px;width:${Math.max(4, w)}px;--c:${t.color}`;
      el.innerHTML = `<canvas></canvas><span class="cname"></span>${ui.sel === c.id ? '<i class="h l"></i><i class="h r"></i>' : ''}`;
      el.querySelector('.cname').textContent = c.name + (c.rate !== 1 ? ` · x${c.rate.toFixed(2)}` : '');
      lane.appendChild(el);
      requestAnimationFrame(() => drawWave(el.querySelector('canvas'), c, t.color, w));
      bindClip(el, c, t, ti);
    }
    ts.appendChild(row);
  });
  updatePlayhead();
  renderClipbar();
}

function bindClip(el, c, t) {
  el.addEventListener('click', (e) => { e.stopPropagation(); if (ui.sel !== c.id) select(c.id); });
  el.addEventListener('pointerdown', (e) => {
    if (ui.sel !== c.id) return;
    e.preventDefault(); e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
    const x0 = e.clientX, y0 = e.clientY, o = { ...c };
    let moved = false;
    const rows = $$('.trow');
    const onMove = (ev) => {
      const dt = (ev.clientX - x0) / ui.pps;
      if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
      if (!moved) { E.snapshot(); moved = true; }
      if (mode === 'move') {
        c.start = Math.max(0, snap(o.start + dt));
        el.style.left = `${c.start * ui.pps}px`;
        const hit = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return ev.clientY >= b.top && ev.clientY < b.bottom; });
        el.dataset.target = hit;
      } else if (mode === 'l') {
        const ns = Math.min(clipEnd(o) - 0.05, Math.max(0, snap(o.start + dt)));
        const dd = (ns - o.start) * o.rate;
        if (o.offset + dd < 0) return;
        c.start = ns; c.offset = o.offset + dd; c.dur = o.dur - dd;
        el.style.left = `${c.start * ui.pps}px`; el.style.width = `${clipLen(c) * ui.pps}px`;
      } else {
        const buf = buffers.get(c.bufId).buffer;
        const ne = Math.max(o.start + 0.05, snap(clipEnd(o) + dt));
        c.dur = Math.min(buf.duration - c.offset, (ne - o.start) * o.rate);
        el.style.width = `${clipLen(c) * ui.pps}px`;
      }
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
      if (!moved) return;
      const ti = +el.dataset.target;
      const tracks = project.cur.tracks;
      if (mode === 'move' && ti >= 0 && tracks[ti] && tracks[ti].id !== t.id) {
        t.clips = t.clips.filter((x) => x !== c); tracks[ti].clips.push(c);
      }
      liveRestart(); changed();
    };
    el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
  });
}
function select(id) { ui.sel = id; renderTimeline(); }
function renderClipbar() {
  const f = ui.sel && E.findClip(ui.sel);
  $('#clipbar').classList.toggle('hidden', !f);
  if (!f) return;
  $('#cb-name').textContent = f.clip.name;
  $('#cb-info').textContent = ` ${fmt(f.clip.start)} → ${fmt(clipEnd(f.clip))} · ${fmt(clipLen(f.clip))}`;
}
function updatePlayhead() {
  const t = E.now();
  $('#playhead').style.left = `${HEAD + t * ui.pps}px`;
  $('#time').textContent = fmt(t);
  const b = Math.floor((t - grid0()) / (beat() * 4)) + 1;
  $('#bar').textContent = `Mesure ${Math.max(1, b)} · ${Math.max(1, Math.floor(((t - grid0()) / beat()) % 4) + 1)}`;
}
// ruler seek
$('#ruler-lane').addEventListener('click', (e) => { const r = $('#ruler-lane').getBoundingClientRect(); E.seek((e.clientX - r.left) / ui.pps); updatePlayhead(); });
$('#zoom-in').onclick = () => zoom(1.5);
$('#zoom-out').onclick = () => zoom(1 / 1.5);
function zoom(f) {
  const tl = $('#timeline'), center = (tl.scrollLeft + tl.clientWidth / 2 - HEAD) / ui.pps;
  ui.pps = Math.max(4, Math.min(600, ui.pps * f));
  renderTimeline();
  tl.scrollLeft = center * ui.pps + HEAD - tl.clientWidth / 2;
}
// pinch zoom on timeline
(() => {
  const pts = new Map(); let d0 = 0, z0 = 0;
  const tl = $('#timeline');
  tl.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, e.clientX); if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.abs(a - b); z0 = ui.pps; } });
  tl.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e.clientX);
    if (pts.size === 2 && d0 > 20) { const [a, b] = [...pts.values()]; const d = Math.abs(a - b); const np = Math.max(4, Math.min(600, (z0 * d) / d0)); if (Math.abs(np - ui.pps) / ui.pps > 0.08) { ui.pps = np; renderTimeline(); } }
  });
  const up = (e) => pts.delete(e.pointerId);
  tl.addEventListener('pointerup', up); tl.addEventListener('pointercancel', up);
  tl.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2); } }, { passive: false });
})();

/* ================= transport ================= */
let metroNodes = [];
function startMetro() {
  stopMetro();
  if (!ui.metro || !transport.playing) return;
  const c = E.ctx, b = beat(), g = grid0();
  let t = Math.ceil((transport.startPos - g) / b) * b + g;
  for (let i = 0; i < 2000 && t < E.projectEnd() + 60; i++, t += b) {
    const when = transport.startedAt + (t - transport.startPos);
    const o = c.createOscillator(), gg = c.createGain();
    const n = Math.round((t - g) / b);
    o.frequency.value = ((n % 4) + 4) % 4 === 0 ? 1600 : 1000;
    gg.gain.setValueAtTime(0.25, when); gg.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    o.connect(gg).connect(c.destination); o.start(when); o.stop(when + 0.06);
    metroNodes.push(o);
  }
}
function stopMetro() { metroNodes.forEach((o) => { try { o.stop(); } catch {} }); metroNodes = []; }
function playToggle() {
  if (transport.playing) { E.stop(); stopMetro(); }
  else { if (E.now() >= E.projectEnd() - 0.05) E.seek(0); E.play(transport.pos); startMetro(); loop(); }
  $('#btn-play').textContent = transport.playing ? '❚❚' : '▶';
}
function liveRestart() { if (transport.playing) { const t = E.now(); E.play(t); startMetro(); } }
const vuData = new Float32Array(2048);
function loop() {
  if (!transport.playing) { drawVu(0); return; }
  const t = E.now();
  if (t > E.projectEnd() + 0.3 && !ui.rec) { E.stop(); stopMetro(); E.seek(E.projectEnd()); $('#btn-play').textContent = '▶'; updatePlayhead(); drawVu(0); return; }
  updatePlayhead();
  const tl = $('#timeline'), x = HEAD + t * ui.pps;
  if (x > tl.scrollLeft + tl.clientWidth - 40 || x < tl.scrollLeft + HEAD) tl.scrollLeft = x - HEAD - 30;
  const an = transport.graph?.analyser;
  if (an) { an.getFloatTimeDomainData(vuData); drawVu(D.peakAndRms(vuData).peak); }
  requestAnimationFrame(loop);
}
function drawVu(v) {
  const c = $('#vu'), g = c.getContext('2d'), h = c.height;
  g.clearRect(0, 0, c.width, h);
  const a = Math.min(1, v) * h;
  g.fillStyle = v > 0.98 ? '#ff4d4d' : v > 0.8 ? '#ffcb1f' : '#3dff9a';
  g.fillRect(0, h - a, c.width, a);
}
$('#btn-play').onclick = playToggle;
$('#btn-home').onclick = () => { E.seek(0); $('#timeline').scrollLeft = 0; updatePlayhead(); };
$('#btn-metro').onclick = () => { ui.metro = !ui.metro; startMetro(); renderTimeline(); };
$('#btn-snap').onclick = () => { project.cur.snap = !project.cur.snap; renderTimeline(); };
$('#bpm').onchange = () => { const v = +$('#bpm').value; if (v >= 40 && v <= 240) { E.snapshot(); project.cur.bpm = v; changed(); } };
$('#proj-name').onchange = () => { project.cur.name = $('#proj-name').value.trim() || 'Mon son'; changed(); };
$('#btn-undo').onclick = () => { if (E.undo()) { ui.sel = null; liveRestart(); changed(); } else toast('Rien à annuler'); };
$('#btn-redo').onclick = () => { if (E.redo()) { liveRestart(); changed(); } };
$('#btn-save').onclick = () => task('Enregistrement…', async () => { await saveProject(); toast('✓ Projet enregistré'); });

/* ================= import ================= */
async function importFiles(files, mode = 'track') {
  if (!files.length) return;
  E.snapshot();
  let i = 0;
  for (const f of files) {
    i++;
    await task(`Import ${i}/${files.length} : ${f.name}`, async (prog) => {
      const buffer = await E.decodeFile(f);
      const id = E.addBuffer(buffer, base(f.name), f);
      const p = project.cur;
      let tr, start;
      if (mode === 'append') {
        tr = p.tracks[0] || E.addTrack(base(f.name));
        start = E.projectEnd();
      } else if (mode === 'here') {
        tr = E.addTrack(base(f.name)); start = E.now();
      } else { tr = E.addTrack(base(f.name)); start = 0; }
      E.addClip(tr, id, start);
      if (!p.analysis && $('#imp-ana')?.checked !== false) {
        prog(0, 'Analyse du tempo et de la tonalité…');
        const a = await analyse(buffer, { onProgress: (x) => prog(x, 'Analyse du tempo et de la tonalité…') });
        buffers.get(id).meta = { bpm: a.bpm, key: a.key };
        p.analysis = a; p.bpm = a.bpm; p.key = a.key;
        toast(`🎵 ${a.bpm} BPM · ${a.key.name}`);
      } else if (!buffers.get(id).meta.bpm && buffer.duration > 8) {
        const a = await analyse(buffer, { end: Math.min(buffer.duration, 60) });
        buffers.get(id).meta = { bpm: a.bpm, key: a.key };
      }
    });
  }
  changed();
}
function importSheet() {
  sheet(`<h3>Ajouter des sons</h3>
    <div class="tools">
      <button class="tool" data-m="track"><b>🎼 Nouvelle piste</b><small>Superposer (chaque son sur sa piste, au début)</small></button>
      <button class="tool" data-m="append"><b>⏭ À la suite</b><small>Assembler : met le son à la fin du morceau</small></button>
      <button class="tool" data-m="here"><b>📍 À la tête de lecture</b><small>Rajouter un morceau à l'endroit précis (${fmt(E.now())})</small></button>
    </div>`, (b) => b.querySelectorAll('[data-m]').forEach((x) => (x.onclick = async () => { closeSheet(); importFiles(await pickFiles(true, 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,video/mp4'), x.dataset.m); })));
}
$('#btn-import').onclick = importSheet;
$('#btn-empty-import').onclick = importSheet;
$('#btn-empty-beat').onclick = () => tab('ai');

/* ================= recording (micro) ================= */
async function getMic() {
  try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
  catch { throw new Error('Micro refusé : autorise le micro dans les réglages Android.'); }
}
function recorder(stream) {
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  const r = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
  const chunks = [];
  r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((res) => (r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); res(new Blob(chunks, { type: r.mimeType || 'audio/webm' })); }));
  r.start(250);
  return { stop: () => { r.stop(); return done; } };
}
$('#btn-rec').onclick = async () => {
  if (ui.rec) {
    const { rec, at } = ui.rec; ui.rec = null;
    $('#btn-rec').classList.remove('on');
    if (transport.playing) playToggle();
    const blob = await rec.stop();
    await task('Ajout de l’enregistrement…', async () => {
      const buffer = await E.audioCtx().decodeAudioData(await blob.arrayBuffer());
      E.snapshot();
      const id = E.addBuffer(buffer, 'Voix ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), blob);
      const tr = project.cur.tracks.find((t) => t.name === 'Micro') || E.addTrack('Micro', '#ff5d8f');
      E.addClip(tr, id, Math.max(0, at - 0.08));
      changed();
    });
    return;
  }
  try {
    const stream = await getMic();
    const at = E.now();
    ui.rec = { rec: recorder(stream), at };
    $('#btn-rec').classList.add('on');
    if (!transport.playing && project.cur.tracks.length) playToggle();
    toast('● Enregistrement… appuie encore pour arrêter');
  } catch (e) { toast('⚠ ' + e.message); }
};

/* ================= clip actions ================= */
function clipAct(act) {
  const f = E.findClip(ui.sel); if (!f) return;
  const { clip: c, track: t } = f, tracks = project.cur.tracks, ti = tracks.indexOf(t);
  const ctx = E.audioCtx();
  switch (act) {
    case 'split': {
      const at = E.now();
      if (at <= c.start + 0.02 || at >= clipEnd(c) - 0.02) return toast('Place la tête de lecture sur le clip pour couper');
      E.snapshot();
      const d1 = (at - c.start) * c.rate;
      const c2 = { ...c, id: Math.random().toString(36).slice(2, 10), start: at, offset: c.offset + d1, dur: c.dur - d1, fadeIn: 0.005 };
      c.dur = d1; c.fadeOut = 0.005; t.clips.push(c2); ui.sel = c2.id; break;
    }
    case 'dup': { E.snapshot(); const c2 = { ...c, id: Math.random().toString(36).slice(2, 10), start: clipEnd(c) }; t.clips.push(c2); ui.sel = c2.id; break; }
    case 'loop':
      return sheet(`<h3>Boucler le clip</h3><p class="muted">Répète le clip à la suite (calé à la grille).</p>
        <div class="chips">${[2, 4, 8, 16].map((n) => `<button class="chip" data-n="${n}">×${n}</button>`).join('')}</div>`, (b) =>
        b.querySelectorAll('[data-n]').forEach((x) => (x.onclick = () => {
          E.snapshot(); let s = clipEnd(c);
          for (let i = 1; i < +x.dataset.n; i++) { t.clips.push({ ...c, id: Math.random().toString(36).slice(2, 10), start: s }); s += clipLen(c); }
          closeSheet(); changed();
        })));
    case 'del': E.snapshot(); t.clips = t.clips.filter((x) => x !== c); ui.sel = null; if (!t.clips.length && t.name.startsWith('IA')) project.cur.tracks.splice(ti, 1); break;
    case 'up': case 'down': {
      const ni = ti + (act === 'up' ? -1 : 1);
      E.snapshot();
      if (ni < 0) return;
      const dest = tracks[ni] || E.addTrack();
      t.clips = t.clips.filter((x) => x !== c); dest.clips.push(c); break;
    }
    case 'fade':
      return sheet(`<h3>Fondus</h3>
        <label class="sl">Fondu d'entrée <input type="range" id="fi" min="0" max="${Math.min(20, clipLen(c) / 2).toFixed(1)}" step="0.1" value="${c.fadeIn}" /><output id="fiv">${c.fadeIn.toFixed(1)}s</output></label>
        <label class="sl">Fondu de sortie <input type="range" id="fo" min="0" max="${Math.min(20, clipLen(c) / 2).toFixed(1)}" step="0.1" value="${c.fadeOut}" /><output id="fov">${c.fadeOut.toFixed(1)}s</output></label>`, (b) => {
        E.snapshot();
        b.querySelector('#fi').oninput = (e) => { c.fadeIn = +e.target.value; b.querySelector('#fiv').textContent = c.fadeIn.toFixed(1) + 's'; changed(); };
        b.querySelector('#fo').oninput = (e) => { c.fadeOut = +e.target.value; b.querySelector('#fov').textContent = c.fadeOut.toFixed(1) + 's'; changed(); };
        b.querySelectorAll('input').forEach((i) => (i.onchange = liveRestart));
      });
    case 'gain':
      return sheet(`<h3>Volume du clip</h3><label class="sl">Gain <input type="range" id="g" min="0" max="2.5" step="0.05" value="${c.gain}" /><output id="gv">${Math.round(c.gain * 100)}%</output></label>`, (b) => {
        E.snapshot();
        b.querySelector('#g').oninput = (e) => { c.gain = +e.target.value; b.querySelector('#gv').textContent = Math.round(c.gain * 100) + '%'; changed(); };
        b.querySelector('#g').onchange = liveRestart;
      });
    case 'speed':
      return sheet(`<h3>Vitesse &amp; tonalité</h3>
        <p class="muted small">Vitesse simple = change tempo et hauteur ensemble (effet vinyle).</p>
        <label class="sl">Vitesse <input type="range" id="sp" min="0.5" max="2" step="0.01" value="${c.rate}" /><output id="spv">x${c.rate.toFixed(2)}</output></label>
        <h3>Traitement pro (garde la qualité)</h3>
        <label class="sl">Tempo seul (%) <input type="range" id="ts" min="50" max="200" step="1" value="100" /><output id="tsv">100%</output></label>
        <label class="sl">Tonalité seule (demi-tons) <input type="range" id="ps" min="-12" max="12" step="1" value="0" /><output id="psv">0</output></label>
        <button class="pill y" id="apply">Appliquer</button>`, (b) => {
        E.snapshot();
        const meta = buffers.get(c.bufId).meta || {};
        if (meta.bpm) b.querySelector('h3').insertAdjacentHTML('afterend', `<p class="small">Tempo d'origine : <b>${meta.bpm} BPM</b>${meta.key ? ' · ' + meta.key.name : ''}</p>`);
        b.querySelector('#sp').oninput = (e) => { const r = +e.target.value; c.rate = r; b.querySelector('#spv').textContent = 'x' + r.toFixed(2); changed(); };
        b.querySelector('#sp').onchange = liveRestart;
        b.querySelector('#ts').oninput = (e) => (b.querySelector('#tsv').textContent = e.target.value + '%');
        b.querySelector('#ps').oninput = (e) => (b.querySelector('#psv').textContent = e.target.value);
        b.querySelector('#apply').onclick = () => {
          const tsv = +b.querySelector('#ts').value / 100, psv = +b.querySelector('#ps').value;
          if (tsv === 1 && psv === 0) return closeSheet();
          closeSheet();
          task('Traitement haute qualité…', async () => {
            const src = D.sliceBuffer(ctx, buffers.get(c.bufId).buffer, c.offset, c.offset + c.dur);
            const out = D.makeBuffer(ctx, Array.from({ length: src.numberOfChannels }, (_, ch) => {
              let d = src.getChannelData(ch);
              if (psv) d = D.pitchShift(d, psv, src.sampleRate);
              if (tsv !== 1) d = D.timeStretch(d, 1 / tsv, src.sampleRate);
              return d;
            }), src.sampleRate);
            const id = E.addBuffer(out, c.name, null, { ...meta, bpm: meta.bpm ? meta.bpm * tsv : undefined });
            Object.assign(c, { bufId: id, offset: 0, dur: out.duration, name: `${c.name.replace(/ \(.*\)$/, '')} (${psv ? (psv > 0 ? '+' : '') + psv + 'dt ' : ''}${tsv !== 1 ? Math.round(tsv * 100) + '%' : ''})`.replace(' )', ')') });
            liveRestart(); changed();
          });
        };
      });
    case 'reverse': case 'normalize': {
      E.snapshot();
      const src = D.sliceBuffer(ctx, buffers.get(c.bufId).buffer, c.offset, c.offset + c.dur);
      const out = act === 'reverse' ? D.reverseBuffer(ctx, src) : D.normalizeBuffer(ctx, src);
      const id = E.addBuffer(out, c.name, null, buffers.get(c.bufId).meta);
      Object.assign(c, { bufId: id, offset: 0, dur: out.duration });
      toast(act === 'reverse' ? '⇄ Clip inversé' : '📈 Volume optimisé'); break;
    }
    case 'ai': ui.zone = 'clip'; setSeg('#zone', 'clip'); setSeg('#ana-src', 'clip'); tab('ai'); return;
  }
  liveRestart(); changed();
}
$$('#clipbar [data-act]').forEach((b) => (b.onclick = () => clipAct(b.dataset.act)));

/* ================= track settings ================= */
function trackSheet(t) {
  const fx = t.fx;
  sheet(`<h3>Piste</h3>
    <div class="row"><input id="tn" value="" /><input type="color" id="tc" value="${t.color}" /></div>
    <label class="sl">Volume <input type="range" id="tv" min="0" max="1.5" step="0.01" value="${t.vol}" /></label>
    <label class="sl">Panoramique <input type="range" id="tp" min="-1" max="1" step="0.05" value="${t.pan}" /></label>
    <h3>Égaliseur</h3>
    <label class="sl">Basses <input type="range" id="eq-low" min="-15" max="15" step="0.5" value="${fx.low}" /></label>
    <label class="sl">Médiums <input type="range" id="eq-mid" min="-15" max="15" step="0.5" value="${fx.mid}" /></label>
    <label class="sl">Aigus <input type="range" id="eq-high" min="-15" max="15" step="0.5" value="${fx.high}" /></label>
    <h3>Effets</h3>
    <label class="sl">Réverbération <input type="range" id="fx-rev" min="0" max="1" step="0.02" value="${fx.reverb}" /></label>
    <label class="sl">Écho (calé au tempo) <input type="range" id="fx-dly" min="0" max="1" step="0.02" value="${fx.delay}" /></label>
    <label class="ck"><input type="checkbox" id="fx-comp" ${fx.comp ? 'checked' : ''}/> Compresseur (son plus dense)</label>
    <div class="row wrap">
      <button class="pill" id="t-bounce">Figer la piste (bounce)</button>
      <button class="pill danger" id="t-del">Supprimer la piste</button>
    </div>`, (b) => {
    E.snapshot();
    b.querySelector('#tn').value = t.name;
    const bindR = (id, fn) => { const i = b.querySelector(id); i.oninput = () => { fn(+i.value); changed(); }; i.onchange = liveRestart; };
    b.querySelector('#tn').onchange = (e) => { t.name = e.target.value || t.name; changed(); };
    b.querySelector('#tc').oninput = (e) => { t.color = e.target.value; changed(); };
    bindR('#tv', (v) => (t.vol = v)); bindR('#tp', (v) => (t.pan = v));
    bindR('#eq-low', (v) => (fx.low = v)); bindR('#eq-mid', (v) => (fx.mid = v)); bindR('#eq-high', (v) => (fx.high = v));
    bindR('#fx-rev', (v) => (fx.reverb = v)); bindR('#fx-dly', (v) => (fx.delay = v));
    b.querySelector('#fx-comp').onchange = (e) => { fx.comp = e.target.checked; liveRestart(); changed(); };
    b.querySelector('#t-del').onclick = () => { project.cur.tracks = project.cur.tracks.filter((x) => x !== t); closeSheet(); liveRestart(); changed(); };
    b.querySelector('#t-bounce').onclick = () => { closeSheet(); task('Rendu de la piste…', async () => {
      const s = Math.min(...t.clips.map((c) => c.start)), e = Math.max(...t.clips.map(clipEnd));
      const saved = { vol: t.vol, pan: t.pan, mute: t.mute, solo: t.solo };
      const out = await E.renderMix({ from: s, to: e + 1, onlyTrack: t.id });
      const id = E.addBuffer(out, t.name + ' (figée)');
      t.clips = []; Object.assign(t, { fx: { low: 0, mid: 0, high: 0, reverb: 0, delay: 0, comp: false }, vol: 1, pan: 0, mute: saved.mute, solo: saved.solo });
      E.addClip(t, id, s); liveRestart(); changed();
    }); };
  });
}

/* ================= AI: analysis ================= */
function setSeg(sel, v) { $$(`${sel} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === v)); }
const segVal = (sel) => $(`${sel} button.on`)?.dataset.v;
$$('.seg').forEach((s) => s.querySelectorAll('button').forEach((b) => (b.onclick = () => setSeg('#' + s.id, b.dataset.v))));
function renderAnalysis() {
  const a = project.cur.analysis;
  if (!a) { $('#ana-out').innerHTML = project.cur.tracks.length ? 'Appuie sur <b>Analyser</b> pour que l’IA écoute ta musique.' : 'Importe une musique dans le Studio, ou crée un beat de zéro ci-dessous.'; $('#chord-grid').innerHTML = ''; return; }
  $('#ana-out').innerHTML = `<div class="stats"><div><b>${Math.round(a.bpm * 10) / 10}</b><small>BPM</small></div><div><b>${a.key.name}</b><small>Tonalité</small></div><div><b>${a.bars.length}</b><small>Mesures</small></div></div>`;
  $('#chord-grid').innerHTML = a.bars.slice(0, 256).map((b, i) => `<span style="--e:${b.energy.toFixed(2)}" title="Mesure ${i + 1}">${chordName(b.chord)}</span>`).join('');
}
async function runAnalysis() {
  const p = project.cur;
  if (!p.tracks.some((t) => t.clips.length)) return toast('Importe d’abord une musique');
  return task('L’IA écoute ta musique…', async (prog) => {
    let buf, off = 0;
    const f = ui.sel && E.findClip(ui.sel);
    if (segVal('#ana-src') === 'clip' && f) {
      const ctx = E.audioCtx(), c = f.clip;
      buf = D.sliceBuffer(ctx, buffers.get(c.bufId).buffer, c.offset, c.offset + c.dur);
      off = c.start;
      if (c.rate !== 1) toast('Clip accéléré : analyse sur l’original');
    } else {
      // analyse only real audio (not the AI tracks)
      const muted = p.tracks.filter((t) => t.name.startsWith('IA ·'));
      muted.forEach((t) => (t._m = t.mute, t.mute = true));
      buf = await E.renderMix({ from: 0, to: E.projectEnd() });
      muted.forEach((t) => (t.mute = t._m, delete t._m));
    }
    const a = await analyse(buf, { onProgress: (x) => prog(x) });
    a.firstBeat += off; a.bars.forEach((b) => (b.t += off));
    E.snapshot();
    p.analysis = a; p.bpm = a.bpm; p.key = a.key;
    renderAnalysis(); renderTimeline();
    toast(`🎵 ${a.bpm} BPM · ${a.key.name}`);
  });
}
$('#btn-analyse').onclick = runAnalysis;

/* ================= AI: generation ================= */
$('#styles').innerHTML = Object.entries(STYLES).map(([k, s]) => `<button class="chip ${k === ui.style ? 'on' : ''}" data-k="${k}">${s.name}</button>`).join('');
$$('#styles .chip').forEach((b) => (b.onclick = () => { ui.style = b.dataset.k; $$('#styles .chip').forEach((x) => x.classList.toggle('on', x === b)); }));
$('#elements').innerHTML = ELEMENTS.map((e) => `<button class="chip ${ui.elements.has(e.id) ? 'on' : ''}" data-k="${e.id}" style="--c:${e.color}">${e.name}</button>`).join('');
$$('#elements .chip').forEach((b) => (b.onclick = () => { const k = b.dataset.k; ui.elements.has(k) ? ui.elements.delete(k) : ui.elements.add(k); b.classList.toggle('on', ui.elements.has(k)); }));
$('#new-key').innerHTML = NOTES_FR.flatMap((n, i) => [`<option value="${i}:minor">${n} mineur</option>`, `<option value="${i}:major">${n} majeur</option>`]).join('');
$('#new-key').value = '9:minor';

async function placeGenerated(results, replace = true) {
  const p = project.cur;
  for (const r of results) {
    const name = `IA · ${r.name}`;
    let tr = p.tracks.find((t) => t.name === name);
    if (tr && replace) tr.clips = tr.clips.filter((c) => clipEnd(c) <= r.start + 0.01 || c.start >= r.start + r.buffer.duration - 3.01);
    if (!tr) tr = E.addTrack(name, r.color);
    const id = E.addBuffer(r.buffer, `${r.name} (${STYLES[ui.style].name})`, null, { generated: true });
    const off = Math.max(0, -r.start);
    E.addClip(tr, id, r.start + off, { fadeOut: 0.05, offset: off, dur: r.buffer.duration - off });
    peaks.delete(id);
  }
}
async function doGenerate() {
  const p = project.cur;
  if (!ui.elements.size) return toast('Choisis au moins un élément');
  if (!p.analysis) { if (!p.tracks.length) return toast('Importe une musique ou crée un beat de zéro'); await runAnalysis(); if (!p.analysis) return; }
  const zone = segVal('#zone'), f = ui.sel && E.findClip(ui.sel);
  let from = 0, to = E.projectEnd();
  if (zone === 'from') from = E.now();
  if (zone === 'clip') { if (!f) return toast('Sélectionne un clip dans le Studio'); from = f.clip.start; to = clipEnd(f.clip); }
  // extend analysis bars if project is longer than the analysed part
  const a = p.analysis, barSec = 240 / a.bpm;
  const last = a.bars[a.bars.length - 1];
  for (let t = (last?.t ?? 0) + barSec, i = 0; t < to; t += barSec, i++) a.bars.push({ t, energy: last?.energy ?? 1, chord: (a.bars[i % Math.max(1, a.bars.length)] || last).chord });
  await task('Création des ajouts…', async (prog) => {
    const res = await generate(a, { style: ui.style, elements: [...ui.elements], intensity: +$('#intensity').value, from, to, energyAware: $('#energy-aware').checked, seed: ui.seed, onProgress: prog });
    E.snapshot();
    await placeGenerated(res);
    changed();
    toast(`✨ ${res.length} piste(s) ajoutée(s) · ${STYLES[ui.style].name}`);
    tab('studio');
    if (!transport.playing) { E.seek(from); playToggle(); }
  });
}
$('#btn-generate').onclick = doGenerate;
$('#btn-vary').onclick = () => { ui.seed = Math.floor(Math.random() * 1e6) + 1; doGenerate(); };
$('#btn-scratch').onclick = async () => {
  const [r, m] = $('#new-key').value.split(':'), bpm = +$('#new-bpm').value || 140, n = +$('#new-bars').value || 16;
  const p = project.cur, start = E.projectEnd() > 0 ? Math.ceil(E.projectEnd() / (240 / bpm)) * (240 / bpm) : 0;
  if (!p.tracks.length) { p.bpm = bpm; }
  const prog = m === 'minor' ? [0, 5, 2, 6] : [0, 4, 5, 3];
  const a = blankAnalysis(p.bpm, { root: +r, mode: m }, n, prog);
  a.bars.forEach((b) => (b.t += start)); a.firstBeat = start % (240 / p.bpm);
  if (!p.analysis) { p.analysis = a; p.key = a.key; }
  if (ui.elements.size < 2) ['drums', 'bass', 'chords', 'melody'].forEach((x) => ui.elements.add(x));
  await task('Création du beat…', async (pr) => {
    const res = await generate(a, { style: ui.style, elements: [...ui.elements], intensity: +$('#intensity').value, from: start, to: start + n * (240 / p.bpm), energyAware: true, seed: ui.seed, onProgress: pr });
    E.snapshot(); await placeGenerated(res, false); changed(); tab('studio');
    E.seek(start); if (!transport.playing) playToggle();
  });
  $$('#elements .chip').forEach((b) => b.classList.toggle('on', ui.elements.has(b.dataset.k)));
};

/* ================= AI: assemble / transform ================= */
$('#xfade').oninput = (e) => ($('#xfade-v').textContent = e.target.value);
$('#ext-bars').oninput = (e) => ($('#ext-v').textContent = e.target.value);
const realClips = () => project.cur.tracks.filter((t) => !t.name.startsWith('IA ·')).flatMap((t) => t.clips.map((c) => ({ c, t })));
$('#btn-automix').onclick = () => {
  const list = realClips().sort((a, b) => a.c.start - b.c.start);
  if (list.length < 2) return toast('Importe au moins 2 morceaux');
  E.snapshot();
  const p = project.cur, bars = +$('#xfade').value, x = (240 / p.bpm) * bars;
  const A = p.tracks.find((t) => t.name === 'Mix A') || E.addTrack('Mix A', '#ffcb1f');
  const B = p.tracks.find((t) => t.name === 'Mix B') || E.addTrack('Mix B', '#5db2ff');
  list.forEach(({ c, t }) => (t.clips = t.clips.filter((y) => y !== c)));
  let pos = 0;
  list.forEach(({ c }, i) => {
    const meta = buffers.get(c.bufId).meta || {};
    if (meta.bpm && Math.abs(p.bpm / meta.bpm - 1) < 0.12) c.rate = p.bpm / meta.bpm; // beat-match small tempo gaps
    c.start = Math.max(0, pos - (i ? x : 0));
    c.fadeIn = i ? Math.min(x, clipLen(c) / 2) : 0.01;
    c.fadeOut = i < list.length - 1 ? Math.min(x, clipLen(c) / 2) : 3;
    (i % 2 ? B : A).clips.push(c);
    pos = clipEnd(c);
  });
  p.tracks = p.tracks.filter((t) => t.clips.length || t === A || t === B);
  changed(); tab('studio'); toast(`🎚 ${list.length} morceaux enchaînés`);
};
$('#btn-extend').onclick = () => task('Recherche du meilleur passage…', async () => {
  const p = project.cur;
  if (!p.analysis) await runAnalysis();
  const a = p.analysis; if (!a) return;
  const barSec = 240 / a.bpm, nb = +$('#ext-bars').value, seg = Math.min(8, nb);
  const end = E.projectEnd();
  // highest energy 'seg'-bar window fully inside the audio
  let best = 0, bs = -1;
  for (let i = 0; i + seg <= a.bars.length; i++) { if (a.bars[i + seg - 1].t + barSec > end) break; const s = a.bars.slice(i, i + seg).reduce((x, b) => x + b.energy, 0); if (s > bs) { bs = s; best = i; } }
  const from = a.bars[best]?.t ?? 0, to = from + seg * barSec;
  const lastBar = a.bars.filter((b) => b.t + barSec <= end + 0.05).pop(), insertAt = lastBar ? lastBar.t + barSec : end;
  E.snapshot();
  for (const t of p.tracks) {
    if (t.name.startsWith('IA ·')) continue;
    // cut clips that pass the insert point, then append copies of [from,to]
    for (const c of [...t.clips]) {
      if (c.start < to && clipEnd(c) > from) {
        for (let k = 0; k < nb / seg; k++) {
          const s = Math.max(c.start, from), e2 = Math.min(clipEnd(c), to);
          const nc = { ...c, id: Math.random().toString(36).slice(2, 10), start: insertAt + k * seg * barSec + (s - from), offset: c.offset + (s - c.start) * c.rate, dur: (e2 - s) * c.rate, fadeIn: 0.012, fadeOut: 0.012 };
          t.clips.push(nc);
        }
      }
      if (c.start < insertAt && clipEnd(c) > insertAt) {
        const tail = { ...c, id: Math.random().toString(36).slice(2, 10), start: insertAt + nb * barSec, offset: c.offset + (insertAt - c.start) * c.rate, dur: (clipEnd(c) - insertAt) * c.rate };
        c.dur = (insertAt - c.start) * c.rate; c.fadeOut = 0.012; tail.fadeIn = 0.012;
        t.clips.push(tail);
      } else if (c.start >= insertAt - 0.001 && !c._new) c.start += nb * barSec;
    }
  }
  // the bars of the copied part get the same chords → AI additions keep following
  const copy = a.bars.slice(best, best + seg);
  a.bars = a.bars.filter((b) => b.t < insertAt - 0.01).concat(
    Array.from({ length: nb }, (_, i) => ({ ...copy[i % seg], t: insertAt + i * barSec })),
    a.bars.filter((b) => b.t >= insertAt - 0.01).map((b) => ({ ...b, t: b.t + nb * barSec })));
  changed(); tab('studio');
  toast(`➕ ${nb} mesures ajoutées (mesures ${best + 1}–${best + seg} rejouées)`);
});
$('#btn-intro').onclick = async () => {
  const p = project.cur;
  if (!p.tracks.length) return toast('Importe d’abord une musique');
  if (!p.analysis) await runAnalysis();
  const a = p.analysis; if (!a) return;
  const barSec = 240 / a.bpm, shift = 4 * barSec;
  E.snapshot();
  p.tracks.forEach((t) => t.clips.forEach((c) => (c.start += shift)));
  a.bars.forEach((b) => (b.t += shift)); a.firstBeat += shift;
  const first = a.bars[0] || { chord: { root: a.key.root, minor: a.key.mode === 'minor' } };
  const intro = { ...a, bars: Array.from({ length: 4 }, (_, i) => ({ t: a.bars[0].t - shift + i * barSec, energy: 0.2, chord: (a.bars[i] || first).chord })) };
  intro.bars[3].energy = 0.3;
  await task('Création de l’intro…', async () => {
    const res = await generate({ ...intro, bars: [...intro.bars, { ...a.bars[0], energy: 1 }] }, { style: ui.style, elements: ['chords', 'fx', 'drums'], intensity: 0.5, from: intro.bars[0].t, to: intro.bars[0].t + shift, energyAware: true, seed: ui.seed });
    await placeGenerated(res.map((r) => ({ ...r, name: r.name + ' intro' })), false);
    changed(); tab('studio'); E.seek(0);
  });
};
$('#btn-outro').onclick = () => {
  const p = project.cur, end = E.projectEnd();
  if (!end) return toast('Rien à finir');
  E.snapshot();
  const fade = Math.min(8, end / 4);
  p.tracks.forEach((t) => t.clips.forEach((c) => { if (clipEnd(c) > end - fade) c.fadeOut = Math.min(clipLen(c) / 2, clipEnd(c) - (end - fade)); }));
  const ctx = E.audioCtx(), sr = 44100, len = sr * 6, b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); let lp = 0; for (let i = 0; i < len; i++) { lp += (Math.random() * 2 - 1 - lp) * (0.3 * (1 - i / len) + 0.01); d[i] = lp * 0.5 * Math.pow(1 - i / len, 2); } }
  const id = E.addBuffer(b, 'Sortie (souffle)');
  const tr = p.tracks.find((t) => t.name === 'IA · FX transitions') || E.addTrack('IA · FX transitions', '#ffcb1f');
  E.addClip(tr, id, Math.max(0, end - fade), { fadeIn: 1, fadeOut: 2, gain: 0.6 });
  tr.fx.reverb = 0.6;
  changed(); tab('studio'); toast('🌙 Outro ajoutée');
};
$('#btn-master').onclick = () => {
  const p = project.cur; E.snapshot();
  p.master.limiter = true; p.master.vol = 1.05;
  p.tracks.forEach((t) => { if (!t.name.startsWith('IA ·')) { t.fx.low = Math.max(t.fx.low, 2); t.fx.high = Math.max(t.fx.high, 2.5); t.fx.comp = true; } });
  liveRestart(); changed(); toast('💎 Mastering appliqué (EQ + compresseur + limiteur)');
};
$('#btn-match').onclick = () => {
  const p = project.cur; E.snapshot(); let n = 0;
  for (const { c } of realClips()) { const m = buffers.get(c.bufId).meta; if (m?.bpm) { let r = p.bpm / m.bpm; if (r > 1.5) r /= 2; if (r < 0.67) r *= 2; c.rate = r; n++; } }
  liveRestart(); changed(); toast(n ? `🎯 ${n} morceau(x) calé(s) sur ${p.bpm} BPM` : 'Aucun tempo détecté sur les morceaux');
};

/* ================= export ================= */
async function saveBlob(blob, name) {
  if (!isNative) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); return { name }; }
  const data = await blobToB64(blob);
  try { await Filesystem.writeFile({ path: `.BEATS/${name}`, data, directory: Directory.Documents, recursive: true }); return { name, where: 'Documents/.BEATS' }; }
  catch { await Filesystem.writeFile({ path: name, data, directory: Directory.External, recursive: true }); return { name, where: 'Android/data' }; }
}
async function shareBlob(blob, name) {
  if (!isNative) {
    const f = new File([blob], name, { type: blob.type });
    if (navigator.canShare?.({ files: [f] })) return navigator.share({ files: [f], title: name }).catch(() => {});
    return saveBlob(blob, name);
  }
  const { uri } = await Filesystem.writeFile({ path: `share/${name}`, data: await blobToB64(blob), directory: Directory.Cache, recursive: true });
  await Share.share({ title: name, files: [uri], dialogTitle: 'Partager' }).catch(() => {});
}
const safe = (n) => (n || 'son').replace(/[\\/:*?"<>|]+/g, '_').trim();
$('#btn-export').onclick = () => {
  if (!E.projectEnd()) return toast('Le projet est vide');
  sheet(`<h3>Exporter le mix</h3>
    <div class="seg" id="ex-fmt"><button data-v="mp3-320" class="on">MP3 320k</button><button data-v="mp3-192">MP3 192k</button><button data-v="wav">WAV</button></div>
    <label class="ck"><input type="checkbox" id="ex-stems" /> Exporter aussi chaque piste séparément (stems)</label>
    <div class="row"><button class="pill y big" id="ex-save">💾 Enregistrer</button><button class="pill big" id="ex-share">Partager</button></div>`, (b) => {
    b.querySelectorAll('#ex-fmt button').forEach((x) => (x.onclick = () => setSeg('#ex-fmt', x.dataset.v)));
    const run = (share) => { const fm = segVal('#ex-fmt'), stems = b.querySelector('#ex-stems').checked; closeSheet(); exportMix(fm, share, stems); };
    b.querySelector('#ex-save').onclick = () => run(false);
    b.querySelector('#ex-share').onclick = () => run(true);
  });
};
async function encode(buf, fm, prog) { return fm === 'wav' ? D.encodeWav(buf) : D.encodeMp3(buf, +fm.split('-')[1], prog); }
function exportMix(fm, share, stems) {
  task('Mixage final…', async (prog) => {
    const was = transport.playing; if (was) playToggle();
    const buf = await E.renderMix();
    prog(0, 'Encodage…');
    const blob = await encode(buf, fm, (x) => prog(x, 'Encodage…'));
    const name = `${safe(project.cur.name)}.${fm === 'wav' ? 'wav' : 'mp3'}`;
    if (share) await shareBlob(blob, name);
    else { const r = await saveBlob(blob, name); toast(`✓ ${r.name}${r.where ? ' → ' + r.where : ''}`, 4000); }
    if (stems) for (const t of project.cur.tracks) {
      if (!t.clips.length) continue;
      prog(0, `Piste : ${t.name}`);
      const sb = await E.renderMix({ onlyTrack: t.id });
      await saveBlob(await encode(sb, fm), `${safe(project.cur.name)} - ${safe(t.name)}.${fm === 'wav' ? 'wav' : 'mp3'}`);
    }
  });
}

/* ================= projects ================= */
async function renderProjects() {
  const list = await listProjects().catch(() => []);
  $('#proj-empty').style.display = list.length ? 'none' : 'block';
  $('#proj-list').innerHTML = '';
  for (const p of list) {
    const li = document.createElement('li');
    li.innerHTML = `<button class="po"><b></b><small>${new Date(p.updated).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · ${p.tracks.length} piste(s) · ${Math.round(p.bpm)} BPM</small></button><button class="pd">✕</button>`;
    li.querySelector('b').textContent = p.name;
    li.querySelector('.po').onclick = () => task('Ouverture…', async () => { E.stop(); await loadProject(p.id); ui.sel = null; tab('studio'); });
    li.querySelector('.pd').onclick = async () => { if (confirm(`Supprimer « ${p.name} » ?`)) { await deleteProject(p.id); renderProjects(); } };
    $('#proj-list').appendChild(li);
  }
}
$('#btn-new').onclick = async () => {
  if (project.cur.tracks.length) await saveProject().catch(() => {});
  E.stop(); project.cur = E.newProject(); E.clearHistory(); ui.sel = null; transport.pos = 0; tab('studio');
};

/* ================= VOIX IA ================= */
const vs = { cloneFiles: [], stsBlob: null, labSrc: null, labRef: null, result: null, voice: null };
function refreshKey() {
  const k = V.getKey();
  $('#key-state').textContent = k ? 'Clé enregistrée ✓' : 'Pas de clé';
  $('#key-state').classList.toggle('ok', !!k);
  $('#xi-key').value = k ? '••••••••' + k.slice(-4) : '';
}
$('#btn-key').onclick = () => { const v = $('#xi-key').value; if (v && !v.startsWith('••')) { V.setKey(v); toast('✓ Clé enregistrée'); syncVoices(); } refreshKey(); };
function renderVoices() {
  const list = V.myVoices();
  if (!vs.voice && list[0]) vs.voice = list[0].id;
  $('#voices').innerHTML = list.length ? '' : '<p class="muted small">Aucune voix clonée pour l’instant.</p>';
  for (const v of list) {
    const el = document.createElement('div'); el.className = 'voice' + (v.id === vs.voice ? ' on' : '');
    el.innerHTML = '<span class="vi">🗣</span><b></b><button class="vd">✕</button>';
    el.querySelector('b').textContent = v.name;
    el.onclick = () => { vs.voice = v.id; renderVoices(); };
    el.querySelector('.vd').onclick = async (e) => { e.stopPropagation(); if (confirm(`Supprimer la voix « ${v.name} » ?`)) { await V.deleteVoice(v.id); if (vs.voice === v.id) vs.voice = null; renderVoices(); } };
    $('#voices').appendChild(el);
  }
}
const syncVoices = () => V.syncVoices().then(renderVoices).catch((e) => toast('⚠ ' + e.message));
$('#btn-sync').onclick = () => task('Synchronisation…', syncVoices);
function renderCloneFiles() {
  $('#clone-files').innerHTML = vs.cloneFiles.map((f, i) => `<li>🎵 ${f.name.replace(/</g, '')} <small>${Math.round(f.size / 1024)} Ko</small><button data-i="${i}">✕</button></li>`).join('');
  $$('#clone-files button').forEach((b) => (b.onclick = () => { vs.cloneFiles.splice(+b.dataset.i, 1); renderCloneFiles(); }));
}
$('#btn-clone-files').onclick = async () => { vs.cloneFiles.push(...(await pickFiles(true, 'audio/*'))); renderCloneFiles(); };
async function recordButton(btn, onDone) {
  if (btn._rec) { const r = btn._rec; btn._rec = null; btn.classList.remove('on'); btn.textContent = btn._label; onDone(await r.stop()); return; }
  try { const s = await getMic(); btn._rec = recorder(s); btn._label = btn.textContent; btn.textContent = '■ Arrêter'; btn.classList.add('on'); }
  catch (e) { toast('⚠ ' + e.message); }
}
$('#btn-clone-rec').onclick = (e) => recordButton(e.currentTarget, (b) => { vs.cloneFiles.push(new File([b], `micro-${vs.cloneFiles.length + 1}.${b.type.includes('mp4') ? 'm4a' : 'webm'}`, { type: b.type })); renderCloneFiles(); });
$('#btn-clone').onclick = () => {
  if (!vs.cloneFiles.length) return toast('Ajoute au moins un MP3 de la voix');
  if (!$('#clone-consent').checked) return toast('Coche la case d’autorisation');
  task('Clonage de la voix…', async () => {
    const id = await V.cloneVoice($('#clone-name').value.trim() || 'Ma voix', vs.cloneFiles);
    vs.voice = id; vs.cloneFiles = []; renderCloneFiles(); renderVoices();
    toast('🧬 Voix créée ! Tu peux maintenant lui faire dire ce que tu veux.');
  });
};
async function showResult(blob, name) {
  vs.result = { blob, name };
  $('#voice-result').hidden = false;
  $('#voice-audio').src = URL.createObjectURL(blob);
  $('#voice-audio').play().catch(() => {});
  $('#voice-result').scrollIntoView({ behavior: 'smooth' });
}
$('#btn-tts').onclick = () => {
  const text = $('#tts-text').value.trim();
  if (!text) return toast('Écris un texte');
  if (!vs.voice) return toast('Crée ou choisis une voix');
  task('Génération de la voix…', async () => {
    const blob = await V.speak(vs.voice, text, { model: $('#tts-model').value, stability: +$('#tts-stab').value, similarity: +$('#tts-sim').value, style: +$('#tts-style').value });
    showResult(blob, `Voix - ${text.slice(0, 24)}`);
  });
};
$('#btn-sts-rec').onclick = (e) => recordButton(e.currentTarget, (b) => { vs.stsBlob = b; $('#sts-src').textContent = `✓ Enregistrement prêt (${Math.round(b.size / 1024)} Ko)`; });
$('#btn-sts-file').onclick = async () => { const [f] = await pickFiles(false, 'audio/*'); if (f) { vs.stsBlob = f; $('#sts-src').textContent = '✓ ' + f.name; } };
$('#btn-sts').onclick = () => {
  if (!vs.stsBlob) return toast('Enregistre-toi ou choisis un fichier');
  if (!vs.voice) return toast('Crée ou choisis une voix');
  task('Transformation de la voix…', async () => showResult(await V.convert(vs.voice, vs.stsBlob), 'Voix transformée'));
};
// offline lab
$('#lab-fx').innerHTML = Object.entries(V.VOICE_FX).map(([k, n]) => `<option value="${k}">${n}</option>`).join('') + '<option value="semis">Hauteur manuelle (demi-tons)</option>';
$('#lab-semis').oninput = (e) => ($('#lab-semis-v').textContent = e.target.value);
const labInfo = () => ($('#lab-info').innerHTML = `Voix : <b>${vs.labSrc ? vs.labSrc.name : '—'}</b>${vs.labSrc?.pitch ? ` (${Math.round(vs.labSrc.pitch)} Hz)` : ''} · Modèle : <b>${vs.labRef ? vs.labRef.name : '—'}</b>${vs.labRef?.pitch ? ` (${Math.round(vs.labRef.pitch)} Hz)` : ''}`);
async function loadLab(fileOrBlob, name, slot) {
  await task('Analyse de la voix…', async () => {
    const buffer = await E.audioCtx().decodeAudioData(await fileOrBlob.arrayBuffer());
    vs[slot] = { buffer, name, pitch: V.pitchOf(buffer) };
    labInfo();
  });
}
$('#btn-lab-src').onclick = async () => { const [f] = await pickFiles(false, 'audio/*'); if (f) loadLab(f, f.name, 'labSrc'); };
$('#btn-lab-ref').onclick = async () => { const [f] = await pickFiles(false, 'audio/*'); if (f) { loadLab(f, f.name, 'labRef'); $('#lab-fx').value = 'match'; } };
$('#btn-lab-rec').onclick = (e) => recordButton(e.currentTarget, (b) => loadLab(b, 'Micro', 'labSrc'));
$('#btn-lab').onclick = () => {
  if (!vs.labSrc) return toast('Choisis la voix à modifier');
  const fx = $('#lab-fx').value;
  if (fx === 'match' && !vs.labRef) return toast('Choisis la voix modèle');
  task('Traitement de la voix…', async () => {
    const out = await V.voiceFx(vs.labSrc.buffer, fx, { semis: +$('#lab-semis').value, refPitch: vs.labRef?.pitch });
    showResult(D.encodeWav(out), `${base(vs.labSrc.name)} - ${V.VOICE_FX[fx] || 'voix'}`);
  });
};
$('#btn-v-studio').onclick = () => task('Ajout au Studio…', async () => {
  const { blob, name } = vs.result;
  const buffer = await E.audioCtx().decodeAudioData(await blob.arrayBuffer());
  E.snapshot();
  const id = E.addBuffer(buffer, name, blob);
  const tr = project.cur.tracks.find((t) => t.name === 'Voix IA') || E.addTrack('Voix IA', '#ff5d8f');
  E.addClip(tr, id, E.now());
  changed(); tab('studio'); toast('➜ Voix ajoutée à la tête de lecture');
});
$('#btn-v-share').onclick = () => vs.result && shareBlob(vs.result.blob, `${safe(vs.result.name)}.${vs.result.blob.type.includes('wav') ? 'wav' : 'mp3'}`);
$('#btn-v-save').onclick = async () => { if (!vs.result) return; const r = await saveBlob(vs.result.blob, `${safe(vs.result.name)}.${vs.result.blob.type.includes('wav') ? 'wav' : 'mp3'}`); toast(`✓ ${r.name}${r.where ? ' → ' + r.where : ''}`); };

/* ================= boot ================= */
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.code === 'Space') { e.preventDefault(); playToggle(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') $('#btn-undo').click();
  if (e.key === 'Delete' && ui.sel) clipAct('del');
});
if (isNative) {
  App.addListener('backButton', () => {
    if (sheetOpen()) return closeSheet();
    if (ui.sel) return select(null);
    if (ui.tab !== 'studio') return tab('studio');
    saveProject().finally(() => App.exitApp());
  });
  App.addListener('pause', () => { saveProject().catch(() => {}); });
}
refreshKey(); renderVoices(); renderTimeline(); labInfo();
listProjects().then((l) => { if (l[0]) loadProject(l[0].id).then(() => renderTimeline()).catch(() => {}); }).catch(() => {});
window.__beats = { E, project, buffers };
