// ===== AMBIANCE SONORE SYNTHÉTISÉE (aucun fichier audio) =====
import { S, daylight, isNight } from './world.js';
import { clamp, rnd, range } from './util.js';

let A = null, master, windG, rainG, fireG, noiseBuf, muted = false;
export const audioState = { enabled: true };

function noiseSource() { const s = A.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; }
export function initAudio() {
  if (A || !audioState.enabled) return;
  try { A = new (window.AudioContext || window.webkitAudioContext)(); } catch { A = null; return; }
  master = A.createGain(); master.gain.value = muted ? 0 : 0.7; master.connect(A.destination);
  noiseBuf = A.createBuffer(1, A.sampleRate * 2, A.sampleRate);
  const d = noiseBuf.getChannelData(0); let b = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 2; }
  // vent : bruit filtré grave
  const wn = noiseSource(), wf = A.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 380;
  windG = A.createGain(); windG.gain.value = 0.02; wn.connect(wf).connect(windG).connect(master); wn.start();
  // pluie : bruit aigu
  const rn = noiseSource(), rf = A.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 2400; rf.Q.value = 0.6;
  rainG = A.createGain(); rainG.gain.value = 0; rn.connect(rf).connect(rainG).connect(master); rn.start();
  fireG = A.createGain(); fireG.gain.value = 0; fireG.connect(master);
}
export function setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.7, A.currentTime, 0.2); }
export const isMuted = () => muted;

function env(g, t0, a, peak, dcy) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dcy); }
function chirp() {
  const t = A.currentTime, n = 2 + Math.floor(rnd() * 4), base = range(2600, 4200);
  for (let k = 0; k < n; k++) {
    const o = A.createOscillator(), g = A.createGain(), t0 = t + k * range(0.08, 0.16);
    o.type = 'sine'; o.frequency.setValueAtTime(base, t0); o.frequency.exponentialRampToValueAtTime(base * range(1.2, 1.7), t0 + 0.05);
    env(g, t0, 0.01, 0.035, 0.07); o.connect(g).connect(master); o.start(t0); o.stop(t0 + 0.12);
  }
}
function cricket() {
  const t = A.currentTime, o = A.createOscillator(), g = A.createGain(); o.type = 'triangle'; o.frequency.value = range(4300, 4800);
  g.gain.value = 0; o.connect(g).connect(master);
  for (let k = 0; k < 6; k++) { const t0 = t + k * 0.05; g.gain.setValueAtTime(0.012, t0); g.gain.setValueAtTime(0, t0 + 0.025); }
  o.start(t); o.stop(t + 0.35);
}
function crackle(vol) {
  const t = A.currentTime, s = noiseSource(), f = A.createBiquadFilter(), g = A.createGain();
  f.type = 'highpass'; f.frequency.value = 1500; env(g, t, 0.002, vol, 0.04);
  s.connect(f).connect(g).connect(master); s.start(t, rnd()); s.stop(t + 0.06);
}
export function thunder(power = 1) {
  if (!A || muted) return;
  const t = A.currentTime, s = noiseSource(), f = A.createBiquadFilter(), g = A.createGain();
  f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(90, t + 2.5);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * power, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
  s.connect(f).connect(g).connect(master); s.start(t, rnd()); s.stop(t + 3.1);
}
export function howl() {
  if (!A || muted) return;
  const t = A.currentTime, o = A.createOscillator(), v = A.createOscillator(), vg = A.createGain(), g = A.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(380, t); o.frequency.linearRampToValueAtTime(720, t + 0.9); o.frequency.linearRampToValueAtTime(560, t + 2.6);
  v.frequency.value = 5; vg.gain.value = 12; v.connect(vg).connect(o.frequency);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
  o.connect(g).connect(master); o.start(t); v.start(t); o.stop(t + 2.9); v.stop(t + 2.9);
}
export function chime() { // découverte, objectif
  if (!A || muted) return;
  const t = A.currentTime;
  [660, 880, 1320].forEach((f, k) => { const o = A.createOscillator(), g = A.createGain(); o.type = 'sine'; o.frequency.value = f; env(g, t + k * 0.09, 0.01, 0.05, 0.6); o.connect(g).connect(master); o.start(t + k * 0.09); o.stop(t + k * 0.09 + 0.7); });
}

let birdT = 0, crickT = 0, crackT = 0, lastFlash = 0;
export function audioTick(rdt, zoomFrac, nearFire) {
  if (!A || muted) return;
  if (A.state === 'suspended') A.resume();
  const w = S.weather.type, day = daylight();
  const storm = w === 'orage' ? 1 : w === 'pluie' ? 0.6 : w === 'neige' ? 0.2 : 0;
  windG.gain.setTargetAtTime(0.015 + storm * 0.05 + (1 - zoomFrac) * 0.03, A.currentTime, 0.5);
  rainG.gain.setTargetAtTime((w === 'pluie' ? 0.05 : w === 'orage' ? 0.09 : 0) * (0.4 + zoomFrac * 0.6), A.currentTime, 0.8);
  const near = zoomFrac > 0.35;
  birdT -= rdt; if (near && day > 0.5 && storm < 0.5 && birdT <= 0) { birdT = range(0.8, 3.5); chirp(); }
  crickT -= rdt; if (near && isNight() && storm < 0.5 && S.snowCover < 0.3 && crickT <= 0) { crickT = range(0.4, 1.6); cricket(); }
  crackT -= rdt; if (nearFire > 0 && crackT <= 0) { crackT = range(0.05, 0.3); crackle(0.03 * nearFire); }
  if (S.flash > 0.5 && performance.now() - lastFlash > 1500) { lastFlash = performance.now(); setTimeout(() => thunder(0.6 + rnd() * 0.4), 300 + rnd() * 900); }
  while (S.sfx?.length) { const k = S.sfx.shift(); if (k === 'howl' && zoomFrac > 0.15) howl(); if (k === 'chime') chime(); }
}
