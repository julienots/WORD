// .BEATS — music analysis: tempo, beat phase, key, chords per bar, energy per bar.
import { fft, hann, mono, resample } from './dsp.js';

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const NOTES_FR = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a, b) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db + 1e-12);
}
const tick = () => new Promise((r) => setTimeout(r));

/**
 * Analyse an AudioBuffer (or a part of it).
 * @returns {{bpm, firstBeat, key:{root,mode,name}, bars:[{t, chord:{root,minor}, energy}], duration}}
 */
export async function analyse(buffer, { start = 0, end = buffer.duration, onProgress } = {}) {
  const SR = 22050;
  let x = mono(buffer);
  x = x.subarray(Math.floor(start * buffer.sampleRate), Math.floor(end * buffer.sampleRate));
  x = resample(x, buffer.sampleRate, SR);

  /* --- onset envelope (spectral flux) + chroma --- */
  const N = 2048, hop = 512, nFrames = Math.max(1, Math.floor((x.length - N) / hop));
  const win = hann(N), re = new Float32Array(N), im = new Float32Array(N);
  let prev = new Float32Array(N / 2);
  const flux = new Float32Array(nFrames), low = new Float32Array(nFrames), rms = new Float32Array(nFrames);
  for (let fr = 0; fr < nFrames; fr++) {
    const o = fr * hop;
    let e = 0;
    for (let i = 0; i < N; i++) { const v = x[o + i]; re[i] = v * win[i]; im[i] = 0; e += v * v; }
    rms[fr] = Math.sqrt(e / N);
    fft(re, im);
    const mag = new Float32Array(N / 2);
    let fl = 0;
    for (let k = 1; k < N / 2; k++) {
      const m = Math.log1p(10 * Math.hypot(re[k], im[k]));
      mag[k] = m;
      const d = m - prev[k];
      if (d > 0 && k < 300) { fl += d; if (k < 16) low[fr] += d; }
    }
    flux[fr] = fl;
    prev = mag;
    if (fr % 400 === 0) { onProgress?.(fr / nFrames * 0.5); await tick(); }
  }

  /* --- chroma (high resolution, spectral peaks only) --- */
  const CN = 8192, CH = 2048, nC = Math.max(1, Math.floor((x.length - CN) / CH) + 1), cfps = SR / CH;
  const cwin = hann(CN), cre = new Float32Array(CN), cim = new Float32Array(CN);
  const binNote = new Int8Array(CN / 2).fill(-1), binW = new Float32Array(CN / 2);
  for (let k = 1; k < CN / 2; k++) {
    const f = (k * SR) / CN;
    if (f < 62 || f > 2100) continue;
    const midi = 69 + 12 * Math.log2(f / 440), near = Math.round(midi);
    binNote[k] = ((near % 12) + 12) % 12;
    binW[k] = Math.max(0, 1 - Math.abs(midi - near) * 2.2); // only bins close to a real note
  }
  const chroma = Array.from({ length: nC }, () => new Float32Array(12));
  for (let fr = 0; fr < nC; fr++) {
    const o = fr * CH;
    for (let i = 0; i < CN; i++) { cre[i] = (x[o + i] || 0) * cwin[i]; cim[i] = 0; }
    fft(cre, cim);
    let p0 = 0, p1 = Math.hypot(cre[1], cim[1]);
    for (let k = 1; k < CN / 2 - 1; k++) {
      const p2 = Math.hypot(cre[k + 1], cim[k + 1]);
      if (binNote[k] >= 0 && p1 > p0 && p1 >= p2) chroma[fr][binNote[k]] += Math.sqrt(p1) * binW[k];
      p0 = p1; p1 = p2;
    }
    let mx = 1e-9; for (let k = 0; k < 12; k++) mx = Math.max(mx, chroma[fr][k]);
    for (let k = 0; k < 12; k++) chroma[fr][k] /= mx; // per-frame normalisation
    if (fr % 100 === 0) { onProgress?.(0.5 + (fr / nC) * 0.4); await tick(); }
  }
  const cAt = (t) => chroma[Math.min(nC - 1, Math.max(0, Math.floor(t * cfps)))];

  /* --- tempo via autocorrelation of the onset envelope --- */
  const fps = SR / hop;
  const env = new Float32Array(nFrames);
  const meanWin = Math.round(fps * 0.5);
  for (let i = 0; i < nFrames; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - meanWin); j < Math.min(nFrames, i + meanWin); j++) { s += flux[j]; c++; }
    env[i] = Math.max(0, flux[i] - s / c);
  }
  let bestLag = 0, bestScore = -Infinity;
  const scores = [];
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = (60 / bpm) * fps;
    let s = 0;
    for (const mult of [1, 2, 4]) {
      const L = lag * mult, l0 = Math.floor(L), f = L - l0;
      let acc = 0;
      for (let i = 0; i + l0 + 1 < nFrames; i++) acc += env[i] * (env[i + l0] * (1 - f) + env[i + l0 + 1] * f);
      s += acc / mult;
    }
    const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2); // prefer musical tempos
    scores.push([bpm, s * w]);
    if (s * w > bestScore) { bestScore = s * w; bestLag = bpm; }
  }
  // joint fine tempo + phase search (comb over the whole track), beats weighted towards low-end onsets
  const lowEnv = new Float32Array(nFrames);
  let mx1 = 1e-9, mx2 = 1e-9;
  for (let i = 0; i < nFrames; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - meanWin); j < Math.min(nFrames, i + meanWin); j++) { s += low[j]; c++; }
    lowEnv[i] = Math.max(0, low[i] - s / c);
    mx1 = Math.max(mx1, env[i]); mx2 = Math.max(mx2, lowEnv[i]);
  }
  const pe = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) pe[i] = env[i] / mx1 + 2 * (lowEnv[i] / mx2);
  const at = (t) => { const i = Math.floor(t), f = t - i; return (pe[i] || 0) * (1 - f) + (pe[i + 1] || 0) * f; };
  let bpm = bestLag, bestPhase = 0, best = -Infinity;
  for (let cand = bestLag - 1.5; cand <= bestLag + 1.5; cand += 0.05) {
    const period = (60 / cand) * fps;
    for (let ph = 0; ph < period; ph += 0.25) {
      let s = 0;
      for (let t = ph; t < nFrames - 1; t += period) s += at(t);
      if (s > best) { best = s; bpm = cand; bestPhase = ph; }
    }
  }
  if (bpm < 80) { bpm *= 2; bestPhase %= (60 / bpm) * fps; } // half-time feel → report the real tempo
  if (Math.abs(bpm - Math.round(bpm)) <= 0.35) {
    // snap to integer tempo and re-fit phase
    bpm = Math.round(bpm);
    const period = (60 / bpm) * fps; best = -Infinity;
    for (let ph = 0; ph < period; ph += 0.25) { let s = 0; for (let t = ph; t < nFrames - 1; t += period) s += at(t); if (s > best) { best = s; bestPhase = ph; } }
  } else bpm = Math.round(bpm * 10) / 10;
  const period = (60 / bpm) * fps;
  // downbeat: chord changes + low-end hits happen on beat 1
  const beatSec = 60 / bpm;
  const chromaDist = (a, b) => { let d = 0; for (let k = 0; k < 12; k++) d += Math.abs(a[k] - b[k]); return d; };
  let bestDown = 0, bestDs = -Infinity;
  for (let d = 0; d < 4; d++) {
    let s = 0;
    for (let t = bestPhase / fps + d * beatSec; t + beatSec < x.length / SR; t += beatSec * 4) {
      if (t - beatSec / 2 < 0) continue;
      s += chromaDist(cAt(t - beatSec / 2), cAt(t + beatSec / 2)) + 0.5 * (lowEnv[Math.round(t * fps)] || 0) / mx2;
    }
    if (s > bestDs) { bestDs = s; bestDown = d; }
  }
  // frame index → time of the window centre (where the onset really is)
  const lag = (N / 2 + hop / 2) / SR;
  const firstBeat = ((bestPhase + bestDown * period) / fps + lag) % ((60 / bpm) * 4);

  /* --- key --- */
  const total = new Float32Array(12);
  chroma.forEach((c) => c.forEach((v, i) => (total[i] += v)));
  let key = { root: 0, mode: 'major', score: -Infinity };
  for (let r = 0; r < 12; r++) {
    const rot = Array.from({ length: 12 }, (_, i) => total[(i + r) % 12]);
    const sMaj = corr(rot, MAJ), sMin = corr(rot, MIN);
    if (sMaj > key.score) key = { root: r, mode: 'major', score: sMaj };
    if (sMin > key.score) key = { root: r, mode: 'minor', score: sMin };
  }
  key.name = `${NOTES_FR[key.root]} ${key.mode === 'major' ? 'majeur' : 'mineur'}`;
  const diatonic = diatonicChords(key);

  /* --- bars: chord + energy --- */
  const barSec = (60 / bpm) * 4, dur = x.length / SR, bars = [];
  let maxE = 1e-9;
  for (let t = firstBeat - (firstBeat > 0.05 ? barSec : 0); t < dur; t += barSec) {
    const a = Math.max(0, Math.floor(t * fps)), b = Math.min(nFrames, Math.floor((t + barSec) * fps));
    const ca = Math.max(0, Math.round(t * cfps)), cb = Math.min(nC, Math.round((t + barSec) * cfps) - 1);
    const c = new Float32Array(12);
    let e = 0;
    for (let i = a; i < b; i++) e += rms[i];
    for (let i = ca; i < Math.max(ca + 1, cb); i++) for (let k = 0; k < 12; k++) c[k] += chroma[Math.min(nC - 1, i)][k];
    e /= Math.max(1, b - a);
    maxE = Math.max(maxE, e);
    let best = diatonic[0], bs = -Infinity;
    for (const ch of diatonic) {
      const tpl = new Array(12).fill(0);
      [0, ch.minor ? 3 : 4, 7].forEach((iv) => (tpl[(ch.root + iv) % 12] = 1));
      const s = corr(Array.from(c), tpl) + (ch.degree === 0 ? 0.05 : 0);
      if (s > bs) { bs = s; best = ch; }
    }
    bars.push({ t: t + start, energy: e, chord: { root: best.root, minor: best.minor } });
  }
  bars.forEach((b) => (b.energy /= maxE));
  // relative major / minor share the same notes: decide with the chord the song keeps coming back to
  const rel = key.mode === 'major' ? { root: (key.root + 9) % 12, mode: 'minor' } : { root: (key.root + 3) % 12, mode: 'major' };
  const tonicScore = (k) => {
    const is = (b) => b && b.chord.root === k.root && b.chord.minor === (k.mode === 'minor');
    return bars.filter(is).length + (is(bars.find((b) => b.energy > 0.2)) ? 2 : 0) + (is(bars[bars.length - 1]) ? 1 : 0);
  };
  if (tonicScore(rel) > tonicScore(key)) key = { ...rel, score: key.score };
  key.name = `${NOTES_FR[key.root]} ${key.mode === 'major' ? 'majeur' : 'mineur'}`;
  onProgress?.(1);
  return { bpm, firstBeat: firstBeat + start, key, bars, duration: dur };
}

export function diatonicChords(key) {
  const steps = key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  const qual = key.mode === 'major' ? [0, 1, 1, 0, 0, 1, -1] : [1, -1, 0, 1, 1, 0, 0];
  return steps.map((s, i) => ({ root: (key.root + s) % 12, minor: qual[i] !== 0, degree: i })).filter((c, i) => qual[i] !== -1);
}
export const chordName = (c) => `${NOTES[c.root]}${c.minor ? 'm' : ''}`;

/** Synthetic analysis when the user starts from nothing. */
export function blankAnalysis(bpm, key, barsCount, progression = [0, 5, 3, 4]) {
  const dia = diatonicChords(key), barSec = 240 / bpm;
  const pick = (deg) => dia.find((c) => c.degree === deg) || dia[0];
  return {
    bpm, firstBeat: 0, key: { ...key, name: `${NOTES_FR[key.root]} ${key.mode === 'major' ? 'majeur' : 'mineur'}` },
    bars: Array.from({ length: barsCount }, (_, i) => ({ t: i * barSec, energy: i < 2 ? 0.5 : 1, chord: { ...pick(progression[i % progression.length]) } })),
    duration: barsCount * barSec,
  };
}
