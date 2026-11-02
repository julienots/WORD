// .BEATS — automatic accompaniment generator (procedural synthesis, follows tempo / key / chords / energy).
const SR = 44100;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const STYLES = {
  trap:      { name: 'Trap',        kick: [0, 7, 10], kickB: [0, 3, 10], snare: [8], hats: 'roll', bass: '808', chords: 'pad', melody: 'bell', swing: 0 },
  drill:     { name: 'Drill',       kick: [0, 11], kickB: [0, 6, 11], snare: [8], ghost: [14], hats: 'drill', bass: '808slide', chords: 'pad', melody: 'bell', swing: 0 },
  house:     { name: 'House',       kick: [0, 4, 8, 12], snare: [4, 12], clap: true, hats: 'offbeat', bass: 'offbeat', chords: 'stab', melody: 'pluck8', swing: 0 },
  pop:       { name: 'Pop',         kick: [0, 6, 8], snare: [4, 12], hats: '8ths', bass: 'root8', chords: 'pad', melody: 'pluck', swing: 0 },
  lofi:      { name: 'Lo-fi',       kick: [0, 7, 10], snare: [4, 12], hats: '8ths', bass: 'soft', chords: 'keys7', melody: 'keys', swing: 0.62 },
  afro:      { name: 'Afro',        kick: [0, 4, 8, 12], soft: true, rim: [0, 3, 6, 10, 12], hats: 'shaker', bass: 'log', chords: 'pluckChords', melody: 'pluck', swing: 0.55 },
  reggaeton: { name: 'Reggaeton',   kick: [0, 4, 8, 12], snare: [3, 6, 11, 14], hats: '8ths', bass: 'root8', chords: 'pad', melody: 'pluck', swing: 0 },
  cine:      { name: 'Cinématique', kick: [0], snare: [8], hats: 'none', bass: 'sub', chords: 'strings', melody: 'piano', swing: 0, epic: true },
};
export const ELEMENTS = [
  { id: 'drums', name: 'Batterie', color: '#ff5d5d' },
  { id: 'bass', name: 'Basse / 808', color: '#5db2ff' },
  { id: 'chords', name: 'Accords / Nappes', color: '#b98bff' },
  { id: 'melody', name: 'Mélodie', color: '#5dffb0' },
  { id: 'fx', name: 'FX transitions', color: '#ffcb1f' },
];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/* ---------- instruments ---------- */
let NOISE = null, IR = null; // AudioBuffers can be shared between contexts
function shared(ctx) {
  if (!NOISE) {
    NOISE = ctx.createBuffer(1, SR, SR); const d = NOISE.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    IR = ctx.createBuffer(2, SR * 2.6, SR);
    for (let c = 0; c < 2; c++) { const x = IR.getChannelData(c); for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / x.length, 3.2); }
  }
}
class Kit {
  constructor(ctx, out) {
    this.ctx = ctx; this.out = out;
    shared(ctx);
    this.noiseBuf = NOISE;
    this.verb = ctx.createConvolver(); this.verb.buffer = IR;
    const vg = ctx.createGain(); vg.gain.value = 0.35;
    this.verb.connect(vg).connect(out);
    this.curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; this.curve[i] = Math.tanh(2.2 * x); }
  }
  shaper() { const w = this.ctx.createWaveShaper(); w.curve = this.curve; return w; }
  env(t, v, a, d, node) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    if (node) node.connect(g);
    return g;
  }
  noise(t, dur) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(t); s.stop(t + dur + 0.05); return s; }
  filt(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  osc(type, f, t, dur) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + dur + 0.05); return o; }
  send(node, amt) { const g = this.ctx.createGain(); g.gain.value = amt; node.connect(g).connect(this.verb); }

  kick(t, v = 1, soft = false) {
    const o = this.osc('sine', soft ? 120 : 160, t, 0.5);
    o.frequency.exponentialRampToValueAtTime(soft ? 50 : 42, t + 0.11);
    this.env(t, v, 0.002, soft ? 0.3 : 0.45, o).connect(this.out);
    const c = this.noise(t, 0.01), hp = this.filt('highpass', 3000);
    this.env(t, v * 0.25, 0.001, 0.012, c.connect(hp)).connect(this.out);
  }
  snare(t, v = 1) {
    const n = this.noise(t, 0.25), bp = this.filt('bandpass', 1900, 0.6);
    const g = this.env(t, v * 0.7, 0.001, 0.2, n.connect(bp)); g.connect(this.out); this.send(g, 0.15);
    const b = this.osc('triangle', 190, t, 0.15); b.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    this.env(t, v * 0.5, 0.001, 0.1, b).connect(this.out);
  }
  clap(t, v = 1) {
    const n = this.noise(t, 0.3), bp = this.filt('bandpass', 1250, 1.2), g = this.ctx.createGain();
    n.connect(bp).connect(g);
    g.gain.setValueAtTime(0, t);
    [0, 0.011, 0.022].forEach((d) => { g.gain.setValueAtTime(v * 0.9, t + d); g.gain.exponentialRampToValueAtTime(v * 0.15, t + d + 0.009); });
    g.gain.setValueAtTime(v * 0.7, t + 0.032); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    g.connect(this.out); this.send(g, 0.25);
  }
  hat(t, v = 1, open = false, pan = 0.15) {
    const n = this.noise(t, open ? 0.35 : 0.06), hp = this.filt('highpass', 7500);
    const p = this.ctx.createStereoPanner(); p.pan.value = pan;
    this.env(t, v * 0.32, 0.001, open ? 0.3 : 0.045, n.connect(hp)).connect(p).connect(this.out);
  }
  shaker(t, v = 1) {
    const n = this.noise(t, 0.08), bp = this.filt('bandpass', 6000, 1.5), p = this.ctx.createStereoPanner(); p.pan.value = -0.25;
    this.env(t, v * 0.25, 0.012, 0.05, n.connect(bp)).connect(p).connect(this.out);
  }
  rim(t, v = 1) {
    const o = this.osc('triangle', 820, t, 0.06), bp = this.filt('bandpass', 1600, 2), p = this.ctx.createStereoPanner(); p.pan.value = 0.3;
    this.env(t, v * 0.45, 0.001, 0.05, o.connect(bp)).connect(p).connect(this.out);
  }
  tom(t, f, v = 1) {
    const o = this.osc('sine', f * 1.6, t, 0.4); o.frequency.exponentialRampToValueAtTime(f, t + 0.1);
    this.env(t, v * 0.7, 0.002, 0.35, o).connect(this.out);
  }
  b808(t, dur, midi, v = 1, slideFrom = null) {
    const f = mtof(midi), o = this.osc('sine', slideFrom ? mtof(slideFrom) : f, t, dur + 0.2);
    if (slideFrom) o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    const g = this.ctx.createGain(), pre = this.ctx.createGain(); pre.gain.value = 1.8;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.75, t + 0.005);
    g.gain.setValueAtTime(v * 0.6, t + Math.max(0.01, dur - 0.05)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    const sh = this.ctx.createGain(); sh.gain.value = 0.55;
    o.connect(pre).connect(this.shaper()).connect(sh).connect(g).connect(this.out);
  }
  bass(t, dur, midi, v = 1, type = 'sawtooth', cut = 500) {
    const o = this.osc(type, mtof(midi), t, dur + 0.1), lp = this.filt('lowpass', cut, 4);
    lp.frequency.setValueAtTime(cut * 3, t); lp.frequency.exponentialRampToValueAtTime(cut, t + 0.12);
    const sub = this.osc('sine', mtof(midi), t, dur + 0.1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.45, t + 0.008);
    g.gain.setValueAtTime(v * 0.4, t + Math.max(0.02, dur - 0.03)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
    o.connect(lp).connect(g); sub.connect(g); g.connect(this.out);
  }
  logDrum(t, midi, v = 1) {
    const o = this.osc('sine', mtof(midi + 12), t, 0.4); o.frequency.exponentialRampToValueAtTime(mtof(midi), t + 0.06);
    this.env(t, v * 0.8, 0.002, 0.35, o).connect(this.shaper()).connect(this.out);
  }
  pad(t, dur, midis, v = 1, kind = 'pad') {
    const g = this.ctx.createGain(), lp = this.filt('lowpass', kind === 'strings' ? 2600 : 1500, 0.5);
    const att = kind === 'stab' ? 0.005 : kind === 'strings' ? 0.5 : 0.35, rel = kind === 'stab' ? 0.18 : 0.7;
    const len = kind === 'stab' ? 0.12 : dur;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.16, t + att);
    g.gain.setValueAtTime(v * 0.14, t + Math.max(att, len)); g.gain.exponentialRampToValueAtTime(0.0001, t + len + rel);
    for (const m of midis) for (const det of [-9, 9]) {
      const o = this.osc('sawtooth', mtof(m), t, len + rel); o.detune.value = det;
      const p = this.ctx.createStereoPanner(); p.pan.value = det > 0 ? 0.4 : -0.4;
      o.connect(p).connect(lp);
    }
    lp.connect(g); g.connect(this.out); this.send(g, kind === 'stab' ? 0.4 : 0.6);
  }
  keys(t, dur, midis, v = 1) {
    for (const m of midis) {
      const o = this.osc('triangle', mtof(m), t, dur + 0.8), o2 = this.osc('sine', mtof(m) * 2, t, dur + 0.8);
      const lp = this.filt('lowpass', 2200);
      const g = this.env(t, v * 0.13, 0.004, Math.min(2.5, dur + 0.6)); o.connect(lp); o2.connect(lp); lp.connect(g);
      g.connect(this.out); this.send(g, 0.35);
    }
  }
  pluck(t, midi, v = 1, type = 'square', decay = 0.28) {
    const o = this.osc(type, mtof(midi), t, decay + 0.1), lp = this.filt('lowpass', 3500, 3);
    lp.frequency.setValueAtTime(4500, t); lp.frequency.exponentialRampToValueAtTime(350, t + decay);
    const g = this.env(t, v * 0.18, 0.002, decay, o.connect(lp)); g.connect(this.out); this.send(g, 0.4);
  }
  bell(t, midi, v = 1) {
    const f = mtof(midi);
    [[1, 1], [2.76, 0.4], [5.4, 0.2]].forEach(([r, a]) => {
      const o = this.osc('sine', f * r, t, 1.4);
      const g = this.env(t, v * 0.12 * a, 0.002, 1.2 / r, o); g.connect(this.out); this.send(g, 0.45);
    });
  }
  riser(t0, t1, v = 1) {
    const d = t1 - t0, n = this.noise(t0, d), bp = this.filt('bandpass', 300, 1.5);
    bp.frequency.setValueAtTime(300, t0); bp.frequency.exponentialRampToValueAtTime(9000, t1);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v * 0.45, t1); g.gain.linearRampToValueAtTime(0, t1 + 0.02);
    n.connect(bp).connect(g); g.connect(this.out); this.send(g, 0.5);
    const o = this.osc('sawtooth', 110, t0, d); o.frequency.exponentialRampToValueAtTime(880, t1);
    const og = this.ctx.createGain(), lp = this.filt('lowpass', 2000); og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(v * 0.08, t1); og.gain.linearRampToValueAtTime(0, t1 + 0.02);
    o.connect(lp).connect(og).connect(this.out);
  }
  impact(t, v = 1) {
    const o = this.osc('sine', 70, t, 1.6); o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
    this.env(t, v * 0.9, 0.003, 1.4, o).connect(this.out);
    const n = this.noise(t, 1.2), lp = this.filt('lowpass', 3000);
    lp.frequency.setValueAtTime(6000, t); lp.frequency.exponentialRampToValueAtTime(200, t + 1);
    const g = this.env(t, v * 0.5, 0.002, 1, n.connect(lp)); g.connect(this.out); this.send(g, 0.9);
  }
  downlifter(t, d, v = 1) {
    const n = this.noise(t, d), bp = this.filt('bandpass', 8000, 1.2);
    bp.frequency.setValueAtTime(8000, t); bp.frequency.exponentialRampToValueAtTime(200, t + d);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(v * 0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    n.connect(bp).connect(g); g.connect(this.out); this.send(g, 0.6);
  }
}

/* ---------- harmony helpers ---------- */
const third = (c) => (c.minor ? 3 : 4);
function voicing(c, sev = false, base = 55) {
  let r = 48 + c.root;
  while (r < base) r += 12;
  while (r > base + 11) r -= 12;
  const v = [r, r + third(c), r + 7];
  if (sev) v.push(r + (c.minor ? 10 : 11));
  return v;
}
const bassNote = (c, lo = 28) => lo + ((c.root - (lo % 12) + 12) % 12);
function scaleNotes(key) {
  const st = key.mode === 'major' ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10]; // pentatonic = always fits
  return st.map((s) => (key.root + s) % 12);
}

/* ---------- main ---------- */
/**
 * @param analysis result of analyse()/blankAnalysis()
 * @param o {style, elements:string[], intensity, from, to, energyAware, seed, onProgress}
 * @returns Promise<[{id,name,color,buffer,start}]>
 */
export async function generate(analysis, o) {
  const st = STYLES[o.style] || STYLES.pop, R = rng(o.seed || 1), I = o.intensity ?? 0.7;
  const barSec = 240 / analysis.bpm, step = barSec / 16;
  const bars = analysis.bars.filter((b) => b.t + barSec > o.from + 0.01 && b.t < o.to - 0.01);
  if (!bars.length) throw new Error('Zone trop courte : sélectionne au moins une mesure.');
  const t0 = bars[0].t, length = bars[bars.length - 1].t + barSec - t0 + 3;
  // section changes (energy jumps) → risers + impacts
  const drops = new Set();
  bars.forEach((b, i) => {
    if (i < 2) return;
    const prev = (bars[i - 1].energy + bars[i - 2].energy) / 2;
    if (b.energy - prev > 0.22 && b.energy > 0.55) drops.add(i);
  });
  if (!drops.size) for (let i = 8; i < bars.length; i += 8) drops.add(i);
  const swing = (s) => (st.swing && s % 2 === 1 ? (st.swing - 0.5) * 2 * step : 0);
  const level = (b) => (!o.energyAware ? 2 : b.energy < 0.35 ? 0 : b.energy < 0.68 ? 1 : 2);
  const els = ELEMENTS.filter((e) => o.elements.includes(e.id));
  function scheduleBar(k, el, bi, T) {
      const b = bars[bi], lv = level(b), fill = bi % 8 === 7 && bi < bars.length - 1, nextDrop = drops.has(bi + 1);
      const ch = b.chord, nextCh = (bars[bi + 1] || b).chord;
      if (el.id === 'drums') {
        if (lv === 0) {
          for (let s = 0; s < 16; s += 4) st.hats === 'shaker' ? k.shaker(T + s * step, 0.6) : k.hat(T + (s + 2) * step, 0.45);
          return;
        }
        const kicks = bi % 2 && st.kickB ? st.kickB : st.kick;
        kicks.forEach((s) => k.kick(T + s * step, st.soft ? 0.75 : 1, st.soft));
        if (st.epic) { k.tom(T + 12 * step, 90, 0.8); k.tom(T + 14 * step, 70, 0.8); }
        if (!(fill && I > 0.3)) {
          (st.snare || []).forEach((s) => (st.clap ? k.clap(T + s * step, 0.9) : (k.snare(T + s * step, 0.9), lv === 2 && k.clap(T + s * step, 0.6))));
          (st.ghost || []).forEach((s) => I > 0.5 && k.snare(T + s * step, 0.25));
        } else {
          (st.snare || []).filter((s) => s < 12).forEach((s) => k.snare(T + s * step, 0.9));
          const roll = I > 0.75 ? 8 : 4;
          for (let r = 0; r < roll; r++) k.snare(T + (12 + (r * 4) / roll) * step, 0.35 + (0.6 * r) / roll);
        }
        (st.rim || []).forEach((s) => k.rim(T + s * step + swing(s), 0.8));
        for (let s = 0; s < 16; s++) {
          const t = T + s * step + swing(s);
          switch (st.hats) {
            case 'offbeat': if (s % 4 === 2) k.hat(t, 0.8, true); else if (lv === 2 && I > 0.4) k.hat(t, 0.3); break;
            case '8ths': if (s % 2 === 0 || (lv === 2 && I > 0.8)) k.hat(t, s % 4 === 0 ? 0.8 : 0.5); break;
            case 'shaker': k.shaker(t, s % 4 === 2 ? 1 : 0.55); break;
            case 'drill': if ([0, 3, 6, 8, 11, 14].includes(s)) k.hat(t, 0.7); break;
            case 'roll':
              if (s % 2 === 0) {
                if (lv === 2 && R() < 0.12 + 0.25 * I && s !== 0) {
                  const n = R() < 0.5 ? 3 : 4;
                  for (let r = 0; r < n; r++) k.hat(t + (r * 2 * step) / n, 0.35 + 0.1 * r);
                } else k.hat(t, s % 4 === 0 ? 0.75 : 0.5);
              }
              break;
          }
        }
        if (bi % 4 === 3 && st.hats !== 'none' && I > 0.3) k.hat(T + 14 * step, 0.5, true, -0.2);
      }
      if (el.id === 'bass' && lv > 0) {
        const n = bassNote(ch), nn = bassNote(nextCh);
        if (st.bass === '808' || st.bass === '808slide') {
          const kicks = bi % 2 && st.kickB ? st.kickB : st.kick, hits = [...kicks, 16];
          for (let i = 0; i < hits.length - 1; i++) {
            const slide = st.bass === '808slide' && i > 0 && R() < 0.5 ? n + (R() < 0.5 ? 12 : -5) : null;
            const note = i === hits.length - 2 && R() < 0.3 ? nn : n;
            k.b808(T + hits[i] * step, (hits[i + 1] - hits[i]) * step * 0.95, note + 12 * (note < 31 ? 1 : 0), 1, slide);
          }
        } else if (st.bass === 'offbeat') [2, 6, 10, 14].forEach((s) => k.bass(T + s * step, step * 1.6, n + 12, 0.9, 'sawtooth', 380));
        else if (st.bass === 'root8') for (let s = 0; s < 16; s += 2) k.bass(T + s * step, step * 1.7, s >= 14 && lv === 2 ? nn + 12 : n + 12, s % 4 ? 0.7 : 0.9, 'sawtooth', 300);
        else if (st.bass === 'soft') [[0, 6], [10, 6]].forEach(([s, d]) => k.bass(T + s * step + swing(s), d * step, n + 12, 0.9, 'triangle', 600));
        else if (st.bass === 'log') [0, 3, 6, 10, 13].forEach((s) => (s < 13 || R() < 0.6) && k.logDrum(T + s * step + swing(s), n + 12, 0.85));
        else k.bass(T, barSec * 0.98, n + 12, 0.9, 'sine', 200);
      }
      if (el.id === 'chords') {
        const v = voicing(ch, st.chords === 'keys7');
        const vol = lv === 0 ? 0.7 : 1;
        if (st.chords === 'stab') { if (lv > 0) [2, 6, 10, 14].forEach((s) => (s !== 14 || R() < 0.7) && k.pad(T + s * step, step, v, 1.5, 'stab')); else k.pad(T, barSec, v, 0.8); }
        else if (st.chords === 'keys7') { k.keys(T, barSec * 0.45, v, vol); k.keys(T + 8 * step + swing(1), barSec * 0.4, v, vol * 0.8); }
        else if (st.chords === 'pluckChords') [0, 3, 6, 10, 12].forEach((s) => v.forEach((m) => k.pluck(T + s * step + swing(s), m, 0.6 * vol, 'triangle', 0.22)));
        else k.pad(T, barSec, v, vol, st.chords === 'strings' ? 'strings' : 'pad');
      }
      if (el.id === 'melody' && lv > 0 && !(lv === 1 && bi % 2)) {
        const sc = scaleNotes(analysis.key), ct = voicing(ch, false, 67);
        const pick = (preferChord) => {
          if (preferChord || R() < 0.55) return ct[Math.floor(R() * ct.length)];
          const p = sc[Math.floor(R() * sc.length)]; let m = 60 + p; while (m < 67) m += 12; return m;
        };
        // one motif per 2 bars, repeated → catchy
        const motifKey = Math.floor(bi / 2);
        const R2 = rng((o.seed || 1) * 977 + motifKey * 31 + ch.root);
        const density = st.melody === 'pluck8' ? 0.8 : st.melody === 'bell' ? 0.35 : 0.5;
        for (let s = 0; s < 16; s += st.melody === 'pluck8' ? 2 : 1) {
          if (R2() > density * (0.6 + 0.5 * I) * (s % 4 === 0 ? 1.4 : s % 2 ? 0.5 : 1)) continue;
          const m = pick(s % 8 === 0), t = T + s * step + swing(s);
          if (st.melody === 'bell') k.bell(t, m, 0.9);
          else if (st.melody === 'keys' || st.melody === 'piano') k.keys(t, step * 2, [m], 1.4);
          else k.pluck(t, m, 0.9, st.melody === 'pluck8' ? 'sawtooth' : 'square');
        }
      }
      if (el.id === 'fx') {
        if (nextDrop) k.riser(T + (bars[bi].energy < 0.5 ? 0 : barSec / 2), T + barSec, 0.9);
        if (drops.has(bi)) k.impact(T, 0.9);
        if (bi > 0 && level(bars[bi - 1]) === 2 && lv === 0) k.downlifter(T, barSec, 0.8);
        if (bi === 0) k.impact(T, 0.5);
      }
  }
  // Render in chunks of 4 bars: few nodes per context keeps rendering linear in song length.
  const CH = 4, TAIL = 3, total = Math.ceil(length * SR);
  const outs = els.map(() => [new Float32Array(total), new Float32Array(total)]);
  const jobs = [];
  for (let ei = 0; ei < els.length; ei++) for (let c0 = 0; c0 < bars.length; c0 += CH) jobs.push([ei, c0]);
  let done = 0;
  const nJobs = jobs.length;
  const gain = 0.9 * (0.6 + 0.4 * I);
  const worker = async () => {
    while (jobs.length) {
      const [ei, c0] = jobs.shift(), el = els[ei];
      const n = Math.min(CH, bars.length - c0), cStart = bars[c0].t - t0;
      const ctx = new OfflineAudioContext(2, Math.ceil((n * barSec + TAIL) * SR), SR);
      const bus = ctx.createGain(); bus.gain.value = gain; bus.connect(ctx.destination);
      const k = new Kit(ctx, bus);
      for (let j = 0; j < n; j++) scheduleBar(k, el, c0 + j, bars[c0 + j].t - t0 - cStart);
      const buf = await ctx.startRendering();
      const off = Math.round(cStart * SR);
      for (let c = 0; c < 2; c++) {
        const src = buf.getChannelData(c), dst = outs[ei][c];
        for (let i = 0, m = Math.min(src.length, total - off); i < m; i++) dst[off + i] += src[i];
      }
      o.onProgress?.(++done / nJobs, `Création : ${el.name}…`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return els.map((el, ei) => {
    const [L, R2] = outs[ei];
    for (const d of [L, R2]) for (let i = 0; i < d.length; i++) { const v = d[i]; if (v > 0.9 || v < -0.9) d[i] = Math.sign(v) * (0.9 + 0.1 * Math.tanh((Math.abs(v) - 0.9) * 10)); }
    const buffer = new AudioBuffer({ numberOfChannels: 2, length: total, sampleRate: SR });
    buffer.copyToChannel(L, 0); buffer.copyToChannel(R2, 1);
    return { ...el, buffer, start: t0 };
  });
}
