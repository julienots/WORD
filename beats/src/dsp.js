// .BEATS — DSP helpers: FFT, buffer ops, pitch / time processing, encoders.
import { Mp3Encoder } from '@breezystack/lamejs';

/* ---------- FFT (in-place radix-2) ---------- */
const fftCache = new Map();
function tables(n) {
  let t = fftCache.get(n);
  if (t) return t;
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  const win = new Float32Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  t = { rev, cos, sin, win };
  fftCache.set(n, t);
  return t;
}
export function fft(re, im) {
  const n = re.length, { rev, cos, sin } = tables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half;
        const tr = re[b] * cos[k] - im[b] * sin[k];
        const ti = re[b] * sin[k] + im[b] * cos[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}
export const hann = (n) => tables(n).win;

/* ---------- buffers ---------- */
export function mono(buf) {
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}
/** Linear-interp resample of a Float32Array. */
export function resample(data, fromRate, toRate) {
  if (fromRate === toRate) return data;
  const ratio = fromRate / toRate, n = Math.floor(data.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio, i0 = x | 0, f = x - i0;
    out[i] = data[i0] * (1 - f) + (data[i0 + 1] ?? 0) * f;
  }
  return out;
}
export function makeBuffer(ctx, channels, rate) {
  const len = channels[0].length;
  const b = ctx.createBuffer(channels.length, Math.max(1, len), rate);
  channels.forEach((d, c) => b.copyToChannel(d, c));
  return b;
}
const chans = (buf) => Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
export const mapBuffer = (ctx, buf, fn) => makeBuffer(ctx, chans(buf).map((d, c) => fn(d, c)), buf.sampleRate);

export function sliceBuffer(ctx, buf, startSec, endSec) {
  const a = Math.max(0, Math.floor(startSec * buf.sampleRate)), b = Math.min(buf.length, Math.floor(endSec * buf.sampleRate));
  return mapBuffer(ctx, buf, (d) => d.slice(a, Math.max(a + 1, b)));
}
export const reverseBuffer = (ctx, buf) => mapBuffer(ctx, buf, (d) => d.slice().reverse());
export function normalizeBuffer(ctx, buf, target = 0.97) {
  let peak = 0;
  for (const d of chans(buf)) for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const g = peak > 0 ? target / peak : 1;
  return mapBuffer(ctx, buf, (d) => d.map((v) => v * g));
}
export function peakAndRms(data) {
  let p = 0, s = 0;
  for (let i = 0; i < data.length; i++) { const v = Math.abs(data[i]); if (v > p) p = v; s += v * v; }
  return { peak: p, rms: Math.sqrt(s / Math.max(1, data.length)) };
}

/* ---------- WSOLA time-stretch (keeps pitch) ---------- */
export function timeStretch(data, factor, rate) {
  // factor > 1 => longer
  const N = Math.round(rate * 0.046) & ~1, Ha = Math.round(N / 2 / factor), Hs = N / 2, tol = Math.round(rate * 0.012);
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const outLen = Math.ceil(data.length * factor) + N;
  const out = new Float32Array(outLen), norm = new Float32Array(outLen);
  let prevStart = 0, outPos = 0;
  for (let inPos = 0; inPos + N < data.length && outPos + N < outLen; inPos += Ha, outPos += Hs) {
    // search best alignment around inPos matching the natural continuation of previous frame
    let best = inPos, bestScore = -Infinity;
    if (outPos > 0) {
      const nat = prevStart + Hs, lo = Math.max(0, inPos - tol), hi = Math.min(data.length - N - 1, inPos + tol);
      for (let c = lo; c <= hi; c += 2) {
        let s = 0;
        for (let k = 0; k < N / 2; k += 4) s += data[c + k] * (data[nat + k] ?? 0);
        if (s > bestScore) { bestScore = s; best = c; }
      }
    }
    for (let k = 0; k < N; k++) { out[outPos + k] += data[best + k] * w[k]; norm[outPos + k] += w[k]; }
    prevStart = best;
  }
  const n = Math.round(data.length * factor);
  const res = new Float32Array(n);
  for (let i = 0; i < n; i++) res[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
  return res;
}
/** Pitch shift in semitones keeping duration. */
export function pitchShift(data, semis, rate) {
  if (!semis) return data.slice();
  const r = Math.pow(2, semis / 12);
  const stretched = timeStretch(data, r, rate);
  const out = new Float32Array(data.length);
  for (let i = 0; i < out.length; i++) {
    const x = i * r, i0 = x | 0, f = x - i0;
    out[i] = (stretched[i0] ?? 0) * (1 - f) + (stretched[i0 + 1] ?? 0) * f;
  }
  return out;
}
/** Median fundamental frequency (Hz) of a voice via normalised autocorrelation. */
export function medianPitch(data, rate) {
  const sr = 16000, x = resample(data, rate, sr), N = 1024, hop = 512;
  const minLag = Math.floor(sr / 500), maxLag = Math.floor(sr / 70), pitches = [];
  for (let s = 0; s + N + maxLag < x.length; s += hop) {
    let e = 0;
    for (let i = 0; i < N; i++) e += x[s + i] * x[s + i];
    if (e / N < 1e-4) continue;
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0, e2 = 0;
      for (let i = 0; i < N; i++) { c += x[s + i] * x[s + i + lag]; e2 += x[s + i + lag] * x[s + i + lag]; }
      const v = c / Math.sqrt(e * e2 + 1e-9);
      if (v > best) { best = v; bestLag = lag; }
    }
    if (best > 0.6) pitches.push(sr / bestLag);
  }
  if (!pitches.length) return 0;
  pitches.sort((a, b) => a - b);
  return pitches[pitches.length >> 1];
}

/* ---------- encoders ---------- */
export function encodeWav(buf) {
  const ch = Math.min(2, buf.numberOfChannels), len = buf.length, rate = buf.sampleRate;
  const ab = new ArrayBuffer(44 + len * ch * 2), v = new DataView(ab);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, len * ch * 2, true);
  const data = chans(buf).slice(0, ch);
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, data[c][i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return new Blob([ab], { type: 'audio/wav' });
}
export async function encodeMp3(buf, kbps = 192, onProgress) {
  const ch = Math.min(2, buf.numberOfChannels), enc = new Mp3Encoder(ch, buf.sampleRate, kbps);
  const toI16 = (d) => { const o = new Int16Array(d.length); for (let i = 0; i < d.length; i++) { const s = Math.max(-1, Math.min(1, d[i])); o[i] = s < 0 ? s * 0x8000 : s * 0x7fff; } return o; };
  const L = toI16(buf.getChannelData(0)), R = ch > 1 ? toI16(buf.getChannelData(1)) : null;
  const parts = [], block = 1152 * 64;
  for (let i = 0; i < L.length; i += block) {
    const out = R ? enc.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block)) : enc.encodeBuffer(L.subarray(i, i + block));
    if (out.length) parts.push(new Uint8Array(out));
    if (onProgress && (i / block) % 8 === 0) { onProgress(i / L.length); await new Promise((r) => setTimeout(r)); }
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  return new Blob(parts, { type: 'audio/mpeg' });
}
