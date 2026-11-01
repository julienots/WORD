// ===== utilitaires : hasard, bruit, maths =====
export const rnd = () => Math.random();
export const range = (a, b) => a + Math.random() * (b - a);
export const irange = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
export function fill(str, vars) { return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '…')); }

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// bruit de valeur 2D lissé + fbm
export function makeNoise(seed) {
  const r = mulberry32(seed);
  const P = 256, perm = new Uint8Array(P * 2), val = new Float32Array(P);
  for (let i = 0; i < P; i++) { perm[i] = i; val[i] = r(); }
  for (let i = P - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < P; i++) perm[i + P] = perm[i];
  const v = (x, y) => val[perm[(perm[x & 255] + y) & 511]];
  const f = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    const u = f(xf), w = f(yf);
    return lerp(lerp(a, b, u), lerp(c, d, u), w);
  }
  return function fbm(x, y, oct = 5) {
    let s = 0, amp = 0.5, fr = 1, norm = 0;
    for (let o = 0; o < oct; o++) { s += amp * noise(x * fr, y * fr); norm += amp; amp *= 0.5; fr *= 2.03; }
    return s / norm;
  };
}

// grille spatiale pour requêtes de voisinage
export class Grid {
  constructor(n, cell) { this.cell = cell; this.w = Math.ceil(n / cell); this.cells = Array.from({ length: this.w * this.w }, () => []); }
  clear() { for (const c of this.cells) c.length = 0; }
  add(o) { const i = this.idx(o.x, o.y); if (i >= 0) this.cells[i].push(o); }
  idx(x, y) { const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell); if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.w) return -1; return cy * this.w + cx; }
  near(x, y, r, out = []) {
    out.length = 0;
    const c = this.cell, x0 = Math.max(0, Math.floor((x - r) / c)), x1 = Math.min(this.w - 1, Math.floor((x + r) / c));
    const y0 = Math.max(0, Math.floor((y - r) / c)), y1 = Math.min(this.w - 1, Math.floor((y + r) / c));
    const r2 = r * r;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) for (const o of this.cells[cy * this.w + cx]) { const dx = o.x - x, dy = o.y - y; if (dx * dx + dy * dy <= r2) out.push(o); }
    return out;
  }
}
