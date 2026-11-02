// .BEATS — project model, multitrack playback and offline mixdown.
export const SR = 44100;
const uid = () => Math.random().toString(36).slice(2, 10);
const COLORS = ['#ffcb1f', '#ff5d8f', '#5db2ff', '#5dffb0', '#b98bff', '#ff8a3d', '#3dfff2', '#ff5d5d'];

export const buffers = new Map(); // id -> { buffer, name, blob?, meta }
export let ctx = null;
export function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR, latencyHint: 'playback' });
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function newProject() {
  return { id: uid(), name: 'Mon son', bpm: 120, key: null, snap: true, master: { vol: 0.9, limiter: true }, tracks: [], analysis: null, updated: Date.now() };
}
export const project = { cur: newProject() };

export function addBuffer(buffer, name, blob = null, meta = {}) {
  const id = uid();
  buffers.set(id, { buffer, name, blob, meta });
  return id;
}
export function addTrack(name, color) {
  const p = project.cur;
  const t = {
    id: uid(), name: name || `Piste ${p.tracks.length + 1}`, color: color || COLORS[p.tracks.length % COLORS.length],
    vol: 0.85, pan: 0, mute: false, solo: false,
    fx: { low: 0, mid: 0, high: 0, reverb: 0, delay: 0, comp: false }, clips: [],
  };
  p.tracks.push(t);
  return t;
}
export function addClip(track, bufId, start, extra = {}) {
  const b = buffers.get(bufId).buffer;
  const c = { id: uid(), bufId, start: Math.max(0, start), offset: 0, dur: b.duration, gain: 1, fadeIn: 0.005, fadeOut: 0.01, rate: 1, name: buffers.get(bufId).name, ...extra };
  track.clips.push(c);
  return c;
}
export const clipLen = (c) => c.dur / c.rate;
export const clipEnd = (c) => c.start + clipLen(c);
export function projectEnd() {
  let e = 0;
  for (const t of project.cur.tracks) for (const c of t.clips) e = Math.max(e, clipEnd(c));
  return e;
}
export function findClip(id) {
  for (const t of project.cur.tracks) { const c = t.clips.find((x) => x.id === id); if (c) return { track: t, clip: c }; }
  return null;
}
export const trackEnd = (t) => t.clips.reduce((e, c) => Math.max(e, clipEnd(c)), 0);

/* ---------- undo ---------- */
const undoStack = [], redoStack = [];
export function snapshot() {
  undoStack.push(JSON.stringify(project.cur));
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
}
export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(JSON.stringify(project.cur));
  project.cur = JSON.parse(undoStack.pop());
  return true;
}
export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(JSON.stringify(project.cur));
  project.cur = JSON.parse(redoStack.pop());
  return true;
}
export function clearHistory() { undoStack.length = 0; redoStack.length = 0; }

/* ---------- graph ---------- */
let irCache = null;
function impulse(c) {
  if (irCache && irCache.sampleRate === c.sampleRate) return irCache;
  const len = Math.floor(c.sampleRate * 2.8), b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  return (irCache = b);
}
/** Builds the whole mix graph in context c, starting playback of project time `from` at context time `when`. */
export function buildGraph(c, from, when, dest = c.destination, onlyTrack = null) {
  const p = project.cur, sources = [];
  const master = c.createGain(); master.gain.value = p.master.vol;
  let out = master;
  if (p.master.limiter) {
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
    master.connect(lim); out = lim;
  }
  const analyser = c.createAnalyser(); analyser.fftSize = 2048;
  out.connect(analyser); out.connect(dest);
  const verb = c.createConvolver(); verb.buffer = impulse(c); verb.connect(master);
  const dly = c.createDelay(2); dly.delayTime.value = (60 / p.bpm) * 0.75;
  const fb = c.createGain(); fb.gain.value = 0.38; const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 3500;
  dly.connect(dlp).connect(fb).connect(dly); dlp.connect(master);
  const anySolo = p.tracks.some((t) => t.solo);
  for (const t of p.tracks) {
    if (onlyTrack ? t.id !== onlyTrack : t.mute || (anySolo && !t.solo)) continue;
    const input = c.createGain();
    const lo = c.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 200; lo.gain.value = t.fx.low;
    const mid = c.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1500; mid.Q.value = 0.8; mid.gain.value = t.fx.mid;
    const hi = c.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 5000; hi.gain.value = t.fx.high;
    let node = input.connect(lo).connect(mid).connect(hi);
    if (t.fx.comp) { const cp = c.createDynamicsCompressor(); cp.threshold.value = -22; cp.ratio.value = 4; cp.attack.value = 0.005; const mk = c.createGain(); mk.gain.value = 1.6; node = node.connect(cp).connect(mk); }
    const vol = c.createGain(); vol.gain.value = t.vol;
    const pan = c.createStereoPanner(); pan.pan.value = t.pan;
    node.connect(vol).connect(pan).connect(master);
    if (t.fx.reverb > 0) { const s = c.createGain(); s.gain.value = t.fx.reverb * 0.6; pan.connect(s).connect(verb); }
    if (t.fx.delay > 0) { const s = c.createGain(); s.gain.value = t.fx.delay * 0.5; pan.connect(s).connect(dly); }
    for (const cl of t.clips) {
      const end = clipEnd(cl);
      if (end <= from) continue;
      const entry = buffers.get(cl.bufId);
      if (!entry) continue;
      const src = c.createBufferSource(); src.buffer = entry.buffer; src.playbackRate.value = cl.rate;
      const g = c.createGain();
      const startAt = when + Math.max(0, cl.start - from);
      const skip = Math.max(0, from - cl.start); // timeline seconds
      const len = clipLen(cl);
      // fades on timeline
      const fi = Math.min(cl.fadeIn, len / 2), fo = Math.min(cl.fadeOut, len / 2);
      const at = (x) => when + (cl.start + x - from);
      const gainAt = (x) => cl.gain * Math.min(1, fi > 0 ? x / fi : 1, fo > 0 ? (len - x) / fo : 1);
      g.gain.setValueAtTime(gainAt(skip), startAt);
      if (skip < fi) g.gain.linearRampToValueAtTime(cl.gain, at(fi));
      if (fo > 0) { g.gain.setValueAtTime(gainAt(Math.max(skip, len - fo)), Math.max(startAt, at(len - fo))); g.gain.linearRampToValueAtTime(0, at(len)); }
      src.connect(g).connect(input);
      src.start(startAt, cl.offset + skip * cl.rate, Math.max(0.001, (len - skip) * cl.rate));
      sources.push(src);
    }
  }
  return { sources, analyser, master };
}

/* ---------- transport ---------- */
export const transport = { playing: false, pos: 0, startedAt: 0, startPos: 0, graph: null, loop: null };
export function now() {
  if (!transport.playing) return transport.pos;
  return transport.startPos + (ctx.currentTime - transport.startedAt);
}
export function play(from = transport.pos) {
  stop(false);
  const c = audioCtx();
  transport.startedAt = c.currentTime + 0.05;
  transport.startPos = from;
  transport.graph = buildGraph(c, from, transport.startedAt);
  transport.playing = true;
}
export function stop(keepPos = true) {
  if (transport.graph) {
    transport.graph.sources.forEach((s) => { try { s.stop(); } catch {} });
    try { transport.graph.master.disconnect(); } catch {}
  }
  if (transport.playing && keepPos) transport.pos = now();
  transport.graph = null;
  transport.playing = false;
}
export function seek(t) {
  const was = transport.playing;
  stop(false);
  transport.pos = Math.max(0, t);
  if (was) play(transport.pos);
}

/** Offline mixdown of [from,to] (or whole project). */
export async function renderMix({ from = 0, to = projectEnd() + 0.5, onlyTrack = null } = {}) {
  const len = Math.max(1, Math.ceil((to - from) * SR));
  const oc = new OfflineAudioContext(2, len, SR);
  buildGraph(oc, from, 0, oc.destination, onlyTrack);
  return oc.startRendering();
}

export async function decodeFile(file) {
  const ab = await file.arrayBuffer();
  return audioCtx().decodeAudioData(ab.slice(0));
}
