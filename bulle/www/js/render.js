// ===== RENDU 2.5D ISOMÉTRIQUE =====
import { N, R, CX, CY, TW, TH, LH, MAXLVL, WATER_LVL, T, WATER_H } from './config.js';
import { S, idx, inside, timeInfo, daylight, groundLvl, isNight, baseTemp } from './world.js';
import { clamp, lerp, rnd, range, mulberry32 } from './util.js';
import { has, tribeById, BLD } from './society.js';
import { stage, moodEmoji, byId } from './beings.js';
import { ROLES } from './mind.js';

let cv, ctx, W = 0, H = 0, DPR = 1;
export const cam = { x: 0, y: 0, z: 0.3, tz: 0.3, tx: 0, ty: 0, follow: null, fit: 0.3, shake: 0 };
export const view = { quality: 'high', names: true, hover: null, power: null, powerR: 0 };

// --- géométrie de la bulle ---
const RX = (R * TW) / Math.SQRT2, RY = (R * TH) / Math.SQRT2;
const GROUND_LVL = 7;
export const G = { cx: 0, cy: (CX + CY) * TH / 2 - GROUND_LVL * LH }; // centre du disque au sol (monde)
const RS = RX / 0.937;                                 // rayon de la sphère
export const SPH = { x: 0, y: G.cy - 0.35 * RS * 0.866, r: RS };

export const iso = (x, y, lvl = 0) => [(x - y) * TW / 2, (x + y) * TH / 2 - lvl * LH];

// --- couche terrain pré-rendue ---
const PAD = 30, OX = N * TW / 2 + PAD, OY = MAXLVL * LH + PAD;
const LW = N * TW + PAD * 2, LHgt = N * TH + MAXLVL * LH + PAD * 2 + 60;
let layer = null, layerKey = '', lastLayerT = 0;
const colTop = new Uint32Array(N * N), colL = new Uint32Array(N * N), colR = new Uint32Array(N * N);

export function initRender(canvas) {
  cv = canvas; ctx = cv.getContext('2d', { alpha: false });
  resize(); window.addEventListener('resize', resize);
  layer = document.createElement('canvas'); layer.width = LW; layer.height = LHgt;
  buildStars(); buildSprites();
}
export function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, view.quality === 'high' ? 2 : 1.25);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.floor(W * DPR); cv.height = Math.floor(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  cam.fit = Math.min(W, H * 0.92) / (2 * SPH.r * 1.1);
}
export const screenSize = () => [W, H];

// ---------- couleurs ----------
const pack = (r, g, b) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
const css = (c, a = 1) => a >= 1 ? `rgb(${c >> 16 & 255},${c >> 8 & 255},${c & 255})` : `rgba(${c >> 16 & 255},${c >> 8 & 255},${c & 255},${a})`;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const PAL = {
  grass: [[92, 170, 70], [112, 162, 58], [170, 146, 66], [122, 132, 100]],
  hill: [[86, 140, 70], [98, 134, 60], [140, 118, 70], [116, 118, 104]],
  sand: [222, 204, 150], rock: [128, 126, 122], snow: [238, 243, 250], dirt: [118, 84, 54], dirtD: [86, 60, 40],
};
function tileColor(i, season, snow) {
  const t = S.tiles, ty = t.type[i], x = i % N, y = (i / N) | 0;
  const nz = t.noise[i];
  let c;
  if (ty === T.DEEP || ty === T.WATER) {
    const depth = clamp((WATER_H - t.h[i]) / 0.18);
    c = mix([84, 168, 196], [22, 62, 120], depth);
    if (snow && baseTemp() < -4 && depth < 0.4) c = mix(c, [200, 225, 240], 0.7); // glace
  } else if (ty === T.SAND) c = mix(PAL.sand, [200, 180, 130], nz * 0.4);
  else if (ty === T.GRASS || ty === T.HILL) {
    c = (ty === T.GRASS ? PAL.grass : PAL.hill)[season];
    c = mix(c, [176, 168, 92], clamp(1 - t.moist[i] * 1.5) * 0.45 + S.climate.drought * 0.35);
    c = mix(c, mul(c, 0.82), nz);
    if (t.tree[i] > 0.3) c = mul(c, 0.86);
  } else if (ty === T.ROCK) c = mix(PAL.rock, [104, 100, 96], nz);
  else c = mix(PAL.snow, [214, 222, 232], nz * 0.5);
  if (t.ash[i] > 0 && ty > T.WATER) c = mix(c, [52, 46, 42], t.ash[i] * 0.75);
  if (snow && ty > T.WATER) c = mix(c, [236, 241, 248], ty === T.ROCK ? 0.6 : 0.88);
  // relief : lumière venant du nord-ouest
  const h = (xx, yy) => (inside(xx, yy) && t.type[idx(xx, yy)] !== T.VOID ? Math.max(t.h[idx(xx, yy)], WATER_H) : WATER_H);
  const hh = Math.max(t.h[i], WATER_H);
  const slope = ty <= T.WATER ? 0 : (h(x - 1, y) - h(x + 1, y) + h(x, y - 1) - h(x, y + 1)) * 5;
  c = mul(c, clamp(0.9 + slope, 0.62, 1.25));
  return c;
}
function rebuildColors() {
  const { season } = timeInfo(), snow = S.snowCover > 0.45;
  for (let i = 0; i < N * N; i++) {
    if (S.tiles.type[i] === T.VOID) continue;
    const c = tileColor(i, season, snow);
    colTop[i] = pack(...c.map((v) => clamp(v, 0, 255)));
    const ty = S.tiles.type[i];
    const side = ty <= T.WATER ? [40, 70, 110] : ty === T.ROCK || ty === T.SNOW ? [100, 96, 92] : ty === T.SAND ? [176, 150, 100] : PAL.dirt;
    colL[i] = pack(...mul(side, 0.78)); colR[i] = pack(...mul(side, 0.58));
  }
}
function tileLvl(i) { const ty = S.tiles.type[i]; return ty === T.WATER || ty === T.DEEP ? WATER_LVL : S.tiles.lvl[i]; }
function drawTile(c, x, y, ox, oy) {
  const i = idx(x, y), t = S.tiles; if (t.type[i] === T.VOID) return;
  const lv = tileLvl(i);
  const sx = ox + (x - y) * TW / 2, sy = oy + (x + y) * TH / 2 - lv * LH;
  // faces latérales (sud-est visibles)
  const nE = x + 1 < N ? idx(x + 1, y) : -1, nS = y + 1 < N ? idx(x, y + 1) : -1;
  const dE = nE < 0 || t.type[nE] === T.VOID ? lv * LH + 14 : (lv - tileLvl(nE)) * LH;
  const dS = nS < 0 || t.type[nS] === T.VOID ? lv * LH + 14 : (lv - tileLvl(nS)) * LH;
  if (dS > 0) {
    c.fillStyle = css(colL[i]); c.beginPath(); c.moveTo(sx - TW / 2, sy + TH / 2); c.lineTo(sx, sy + TH); c.lineTo(sx, sy + TH + dS); c.lineTo(sx - TW / 2, sy + TH / 2 + dS); c.closePath(); c.fill();
    if (t.type[i] === T.GRASS || t.type[i] === T.HILL) { c.fillStyle = css(colTop[i]); c.beginPath(); c.moveTo(sx - TW / 2, sy + TH / 2); c.lineTo(sx, sy + TH); c.lineTo(sx, sy + TH + 2.5); c.lineTo(sx - TW / 2, sy + TH / 2 + 2.5); c.fill(); }
  }
  if (dE > 0) {
    c.fillStyle = css(colR[i]); c.beginPath(); c.moveTo(sx + TW / 2, sy + TH / 2); c.lineTo(sx, sy + TH); c.lineTo(sx, sy + TH + dE); c.lineTo(sx + TW / 2, sy + TH / 2 + dE); c.closePath(); c.fill();
    if (t.type[i] === T.GRASS || t.type[i] === T.HILL) { c.fillStyle = css(colTop[i]); c.beginPath(); c.moveTo(sx + TW / 2, sy + TH / 2); c.lineTo(sx, sy + TH); c.lineTo(sx, sy + TH + 2.5); c.lineTo(sx + TW / 2, sy + TH / 2 + 2.5); c.fill(); }
  }
  // dessus
  c.fillStyle = css(colTop[i]);
  c.beginPath(); c.moveTo(sx, sy - 0.3); c.lineTo(sx + TW / 2 + 0.4, sy + TH / 2); c.lineTo(sx, sy + TH + 0.3); c.lineTo(sx - TW / 2 - 0.4, sy + TH / 2); c.closePath(); c.fill();
  // texture : brins d'herbe, cailloux, vaguelettes
  const ty = t.type[i], nz = t.noise[i];
  if (ty === T.GRASS || ty === T.HILL) {
    const r = mulberry32(i * 7 + 1);
    c.strokeStyle = css(colTop[i], 1); c.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      const px = sx + (r() - 0.5) * TW * 0.6, py = sy + TH * 0.25 + r() * TH * 0.5;
      c.strokeStyle = r() < 0.5 ? 'rgba(255,255,220,0.13)' : 'rgba(0,30,0,0.14)';
      c.beginPath(); c.moveTo(px, py); c.lineTo(px + (r() - 0.5) * 2, py - 2 - r() * 2); c.stroke();
    }
  } else if (ty === T.ROCK || ty === T.SAND) {
    const r = mulberry32(i * 13 + 5);
    for (let k = 0; k < 3; k++) { c.fillStyle = ty === T.ROCK ? 'rgba(0,0,0,0.12)' : 'rgba(120,90,40,0.12)'; c.fillRect(sx + (r() - 0.5) * TW * 0.5, sy + TH * 0.3 + r() * TH * 0.4, 2, 1.2); }
  } else if (ty <= T.WATER) {
    // écume sur le rivage
    let shore = false;
    for (let d = 0; d < 4; d++) { const xx = x + [1, -1, 0, 0][d], yy = y + [0, 0, 1, -1][d]; if (inside(xx, yy)) { const ti = S.tiles.type[idx(xx, yy)]; if (ti > T.WATER) shore = true; } }
    if (shore) { c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 1; c.beginPath(); c.moveTo(sx - TW * 0.3, sy + TH * 0.5); c.lineTo(sx, sy + TH * 0.2); c.lineTo(sx + TW * 0.3, sy + TH * 0.5); c.stroke(); }
  }
}
function renderLayer() {
  rebuildColors();
  const c = layer.getContext('2d');
  c.clearRect(0, 0, LW, LHgt);
  for (let s = 0; s <= 2 * (N - 1); s++) for (let x = Math.max(0, s - N + 1); x <= Math.min(N - 1, s); x++) drawTile(c, x, s - x, OX, OY);
  S.dirtyTerrain = false; lastLayerT = performance.now();
}
function checkLayer() {
  const { season } = timeInfo();
  const key = season + '|' + (S.snowCover > 0.45 ? 1 : 0) + '|' + Math.round(S.climate.drought * 3);
  const now = performance.now();
  if (key !== layerKey || (S.dirtyTerrain && now - lastLayerT > 1200)) { layerKey = key; renderLayer(); }
}

// ---------- sprites ----------
const SPR = {}; const SC = 3;
function sprite(key, w, h, draw) {
  if (SPR[key]) return SPR[key];
  const c = document.createElement('canvas'); c.width = w * SC; c.height = h * SC;
  const g = c.getContext('2d'); g.scale(SC, SC); draw(g, w, h);
  return (SPR[key] = c);
}
function blob(g, x, y, r, base, light) {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, light); gr.addColorStop(1, base);
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}
function treeSprite(kind, season, snow) {
  return sprite(`t${kind}${season}${snow ? 's' : ''}`, 34, 56, (g, w, h) => {
    const cx = w / 2, base = h - 4;
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(cx + 3, base, 11, 4.5, 0, 0, Math.PI * 2); g.fill();
    if (kind === 1) { // pin
      g.fillStyle = '#5b3d24'; g.fillRect(cx - 1.6, base - 10, 3.2, 10);
      const greens = snow ? ['#2d5a3d', '#3c6e4c'] : ['#1f4d2e', '#2f6b3d'];
      for (let k = 0; k < 4; k++) {
        const yy = base - 8 - k * 9.5, ww = 13 - k * 2.6;
        g.fillStyle = greens[0]; g.beginPath(); g.moveTo(cx, yy - 14); g.lineTo(cx + ww, yy); g.lineTo(cx - ww, yy); g.closePath(); g.fill();
        g.fillStyle = greens[1]; g.beginPath(); g.moveTo(cx, yy - 14); g.lineTo(cx - ww, yy); g.lineTo(cx - ww * 0.1, yy - 1); g.closePath(); g.fill();
        if (snow) { g.fillStyle = 'rgba(245,250,255,0.95)'; g.beginPath(); g.moveTo(cx, yy - 14); g.lineTo(cx + ww * 0.5, yy - 6); g.lineTo(cx - ww * 0.6, yy - 5); g.closePath(); g.fill(); }
      }
    } else {
      const birch = kind === 2;
      g.fillStyle = birch ? '#e8e2d6' : '#5e4128'; g.fillRect(cx - 2, base - 18, 4, 18);
      if (birch) { g.fillStyle = '#333'; for (let k = 0; k < 4; k++) g.fillRect(cx - 2, base - 16 + k * 4, 2.5, 1); }
      if (season === 3) { // branches nues
        g.strokeStyle = birch ? '#cfc7b8' : '#4d3420'; g.lineWidth = 1.4;
        for (let k = 0; k < 7; k++) { const a = -Math.PI / 2 + (k - 3) * 0.38; g.beginPath(); g.moveTo(cx, base - 16); g.lineTo(cx + Math.cos(a) * 14, base - 18 + Math.sin(a) * 16); g.stroke(); }
        if (snow) { g.fillStyle = 'rgba(250,252,255,0.9)'; for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(cx + (k - 2.5) * 4, base - 26 - (k % 2) * 6, 2.6, 0, 7); g.fill(); } }
        return;
      }
      const pal = birch ? [['#7fae3f', '#c8e27a'], ['#6f9a35', '#b8d46a'], ['#d6a429', '#f4d56a']] : [['#2f7a32', '#7cc35a'], ['#2c6d2a', '#6fae48'], ['#b2511f', '#f0a040']];
      const [b0, l0] = pal[season === 2 ? 2 : season === 1 ? 1 : 0];
      const blobs = birch ? [[0, -30, 8], [-6, -24, 7], [6, -24, 7], [0, -38, 6]] : [[0, -32, 11], [-8, -24, 9], [8, -25, 9], [-3, -40, 8], [5, -38, 7]];
      for (const [dx, dy, r] of blobs) blob(g, cx + dx, base + dy, r, b0, l0);
    }
  });
}
function bushSprite(season, snow) {
  return sprite(`b${season}${snow ? 's' : ''}`, 20, 16, (g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,0.2)'; g.beginPath(); g.ellipse(w / 2 + 1, h - 3, 8, 3, 0, 0, 7); g.fill();
    const [b, l] = season === 2 ? ['#7a5a22', '#b48a3a'] : season === 3 ? ['#4a5240', '#6a7460'] : ['#2b5d26', '#5b9a42'];
    blob(g, w / 2 - 3, h - 7, 5, b, l); blob(g, w / 2 + 3, h - 7, 5, b, l); blob(g, w / 2, h - 10, 5, b, l);
    if (snow) { g.fillStyle = 'rgba(250,252,255,0.9)'; g.beginPath(); g.ellipse(w / 2, h - 13, 6, 2.2, 0, 0, 7); g.fill(); }
  });
}
function rockSprite(big) {
  return sprite(`r${big}`, 20, 14, (g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(w / 2 + 1, h - 3, 8, 3, 0, 0, 7); g.fill();
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#b4b0a8'); gr.addColorStop(1, '#6d6964');
    g.fillStyle = gr; g.beginPath(); g.moveTo(3, h - 4); g.lineTo(5, h - 9 - big * 2); g.lineTo(10, h - 11 - big * 2); g.lineTo(16, h - 8); g.lineTo(17, h - 4); g.closePath(); g.fill();
  });
}
function buildSprites() { for (const k of Object.keys(SPR)) delete SPR[k]; }

// ---------- étoiles / espace ----------
let stars = [], nebula = null;
function buildStars() {
  const r = mulberry32(42);
  stars = Array.from({ length: 420 }, () => ({ x: r(), y: r(), s: r() * 1.4 + 0.3, a: r() * 0.8 + 0.2, tw: r() * 6 }));
  nebula = document.createElement('canvas'); nebula.width = 512; nebula.height = 512;
  const g = nebula.getContext('2d');
  for (let k = 0; k < 18; k++) {
    const x = r() * 512, y = r() * 512, rad = 60 + r() * 160;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const col = [[90, 60, 160], [40, 90, 170], [150, 50, 120], [30, 120, 140]][k % 4];
    gr.addColorStop(0, `rgba(${col},0.16)`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  }
}
// oiseaux (décor) et nuages
const birds = Array.from({ length: 3 }, (_, k) => ({ x: CX + (k - 1) * 8, y: CY + (k - 1) * 5, a: k * 2, n: 5 + k * 2, alt: 70 + k * 20 }));
let clouds = [];
const drops = Array.from({ length: 320 }, () => ({ x: CX + range(-R, R), y: CY + range(-R, R), z: range(0, 260) }));

// ---------- boucle de rendu ----------
let lastT = performance.now();
export function render() {
  const now = performance.now(), rdt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (!S.ready) return;
  checkLayer();
  // caméra
  if (cam.follow) { const b = byId(cam.follow); if (b && b.alive) { const [x, y] = iso(b.x, b.y, groundLvl(b.x, b.y)); cam.tx = x; cam.ty = y - 8; } else cam.follow = null; }
  cam.z += (cam.tz - cam.z) * Math.min(1, rdt * 6);
  cam.x += (cam.tx - cam.x) * Math.min(1, rdt * 6); cam.y += (cam.ty - cam.y) * Math.min(1, rdt * 6);
  let shx = 0, shy = 0;
  if (S.shake > 0) { S.shake -= rdt * 1.5; shx = range(-1, 1) * S.shake * 12; shy = range(-1, 1) * S.shake * 12; }
  const z = cam.z, glass = clamp(1 - (z / cam.fit - 1.1) / 2.2);
  const day = daylight(), { hour, season } = timeInfo();
  // --- fond spatial ---
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#03040c'); bg.addColorStop(1, '#0a0b1e');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.9; const nS = Math.max(W, H) * 1.6;
  ctx.drawImage(nebula, -cam.x * 0.02 * z - nS * 0.2, -cam.y * 0.02 * z - nS * 0.2, nS, nS); ctx.globalAlpha = 1;
  for (const s of stars) {
    const x = ((s.x * W * 1.3 - cam.x * 0.03 * s.s) % W + W) % W, y = ((s.y * H * 1.3 - cam.y * 0.03 * s.s) % H + H) % H;
    ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(now / 900 + s.tw)); ctx.fillStyle = '#fff'; ctx.fillRect(x, y, s.s, s.s);
  }
  ctx.globalAlpha = 1;
  // --- monde ---
  ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (W / 2 - cam.x * z + shx), DPR * (H / 2 - cam.y * z + shy));
  const vx0 = cam.x - W / 2 / z - 60, vx1 = cam.x + W / 2 / z + 60, vy0 = cam.y - H / 2 / z - 120, vy1 = cam.y + H / 2 / z + 120;
  drawSkyDome(day, hour, glass);
  drawBowl();
  if (z * DPR > 1.5) drawTilesDirect(vx0, vx1, vy0, vy1); else ctx.drawImage(layer, -OX, -OY);
  drawWater(now, vx0, vx1, vy0, vy1, z);
  drawGroundDecals(vx0, vx1, vy0, vy1);
  drawCloudShadows(rdt);
  const labels = [];
  drawEntities(vx0, vx1, vy0, vy1, z, now, labels, season);
  drawProjectiles(rdt);
  drawEffects(rdt, now);
  drawWeather(rdt, z);
  drawLighting(day, hour, now);
  drawBirds(rdt, z);
  drawClouds(z);
  drawGlass(glass, z, now);
  drawPowerCursor(z);
  // --- écran ---
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (S.flash > 0) { ctx.fillStyle = `rgba(230,240,255,${S.flash * 0.7})`; ctx.fillRect(0, 0, W, H); S.flash -= rdt * 3; }
  drawLabels(labels, z, now);
  if (S.voice && now < S.voice.until) {
    const a = clamp((S.voice.until - now) / 1000);
    ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.font = `700 ${Math.min(34, W / 18)}px Georgia, serif`;
    ctx.shadowColor = 'rgba(255,220,120,0.9)'; ctx.shadowBlur = 24; ctx.fillStyle = '#fff6d8';
    const words = S.voice.text.split(' '), lines = []; let cur = '';
    for (const w of words) { if (cur && ctx.measureText(cur + ' ' + w).width > W * 0.88) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
    lines.push(cur); const lh = Math.min(40, W / 15);
    lines.forEach((l, k) => ctx.fillText(l, W / 2, H * 0.32 + k * lh)); ctx.restore();
  }
  if (S.victory) drawVictoryRays(now);
}

function drawSkyDome(day, hour, glass) {
  ctx.save();
  ctx.beginPath(); ctx.arc(SPH.x, SPH.y, SPH.r, 0, Math.PI * 2); ctx.clip();
  const top = SPH.y - SPH.r, dusk = clamp(1 - Math.abs(hour - 6.5) / 1.6) + clamp(1 - Math.abs(hour - 19.5) / 1.6);
  const g = ctx.createLinearGradient(0, top, 0, G.cy);
  const dayTop = [74, 140, 220], dayHor = [190, 222, 245], nightTop = [6, 10, 30], nightHor = [24, 32, 70];
  const t = mix(nightTop, dayTop, day), hzn = mix(mix(nightHor, dayHor, day), [250, 150, 90], clamp(dusk) * 0.6);
  let wk = S.weather.type === 'orage' ? 0.45 : S.weather.type === 'pluie' ? 0.7 : S.weather.type === 'nuageux' || S.weather.type === 'brume' ? 0.85 : 1;
  g.addColorStop(0, css(pack(...mul(t, wk)))); g.addColorStop(1, css(pack(...mul(hzn, wk))));
  ctx.fillStyle = g; ctx.fillRect(SPH.x - SPH.r, top, SPH.r * 2, SPH.r * 2);
  // étoiles du dôme la nuit
  if (day < 0.5) { const r = mulberry32(9); ctx.fillStyle = '#fff'; for (let k = 0; k < 90; k++) { ctx.globalAlpha = (0.5 - day) * 1.6 * r(); const a = r() * Math.PI * 2, d = Math.sqrt(r()) * SPH.r; ctx.fillRect(SPH.x + Math.cos(a) * d, SPH.y + Math.sin(a) * d * 0.9 - SPH.r * 0.1, 2, 2); } ctx.globalAlpha = 1; }
  // soleil captif / lune
  const th = ((hour - 6) / 12) * Math.PI;
  const sunX = SPH.x - Math.cos(th) * SPH.r * 0.78, sunY = G.cy - Math.sin(th) * SPH.r * 1.05;
  if (Math.sin(th) > -0.15) {
    const gr = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 160);
    gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.12, 'rgba(255,236,160,0.95)'); gr.addColorStop(0.3, 'rgba(255,200,110,0.3)'); gr.addColorStop(1, 'rgba(255,180,90,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sunX, sunY, 160, 0, 7); ctx.fill();
  }
  const mth = th + Math.PI, mx = SPH.x - Math.cos(mth) * SPH.r * 0.7, my = G.cy - Math.sin(mth) * SPH.r * 0.95;
  if (Math.sin(mth) > -0.1) {
    ctx.fillStyle = 'rgba(230,236,255,0.92)'; ctx.beginPath(); ctx.arc(mx, my, 26, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(150,160,190,0.35)'; ctx.beginPath(); ctx.arc(mx - 7, my - 4, 6, 0, 7); ctx.arc(mx + 8, my + 6, 4, 0, 7); ctx.fill();
    const gr = ctx.createRadialGradient(mx, my, 20, mx, my, 120); gr.addColorStop(0, 'rgba(200,210,255,0.25)'); gr.addColorStop(1, 'rgba(200,210,255,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(mx, my, 120, 0, 7); ctx.fill();
  }
  ctx.restore();
}
function drawBowl() {
  // coupe de terre sous le disque : la bulle est un monde clos flottant
  ctx.save();
  ctx.beginPath(); ctx.arc(SPH.x, SPH.y, SPH.r - 1, 0, Math.PI * 2); ctx.clip();
  const y0 = G.cy + 4;
  const g = ctx.createLinearGradient(0, y0, 0, SPH.y + SPH.r);
  g.addColorStop(0, '#5a3d24'); g.addColorStop(0.18, '#6e4a2a'); g.addColorStop(0.35, '#7a6248'); g.addColorStop(0.55, '#5c5650');
  g.addColorStop(0.8, '#3a3434'); g.addColorStop(1, '#1d1a1c');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(SPH.x - SPH.r, y0); ctx.ellipse(G.cx, G.cy + 6, RX + 6, RY + 6, 0, Math.PI, 0, true); ctx.lineTo(SPH.x + SPH.r, SPH.y + SPH.r); ctx.lineTo(SPH.x - SPH.r, SPH.y + SPH.r); ctx.closePath(); ctx.fill();
  // strates
  const r = mulberry32(5);
  for (let k = 1; k < 9; k++) {
    const yy = G.cy + RY + k * (SPH.r * 0.07);
    ctx.strokeStyle = `rgba(${k % 2 ? '30,20,10' : '200,170,130'},${0.12 + r() * 0.1})`; ctx.lineWidth = 2 + r() * 4;
    ctx.beginPath();
    for (let x = -SPH.r; x <= SPH.r; x += 40) { const yy2 = yy - Math.sqrt(Math.max(0, 1 - (x / (RX + 30)) ** 2)) * 0 + Math.sin(x * 0.01 + k) * 8 + (r() - 0.5) * 6; x === -SPH.r ? ctx.moveTo(x, yy2) : ctx.lineTo(x, yy2); }
    ctx.stroke();
  }
  // racines & pierres
  for (let k = 0; k < 60; k++) { const a = r() * Math.PI, d = r(); const x = Math.cos(a) * RX * 0.9 * d, y = G.cy + RY * Math.sin(a) * d + 20 + r() * SPH.r * 0.5; ctx.fillStyle = `rgba(${r() < 0.5 ? '160,150,140' : '40,30,25'},0.35)`; ctx.beginPath(); ctx.ellipse(x, y, 4 + r() * 10, 2 + r() * 5, 0, 0, 7); ctx.fill(); }
  // ombre de contact sous le sol
  const sh = ctx.createLinearGradient(0, G.cy + RY - 20, 0, G.cy + RY + 60); sh.addColorStop(0, 'rgba(0,0,0,0.0)'); sh.addColorStop(0.4, 'rgba(0,0,0,0.25)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sh; ctx.fillRect(-SPH.r, G.cy, SPH.r * 2, RY + 80);
  ctx.restore();
}
function drawTilesDirect(x0, x1, y0, y1) {
  for (let s = 0; s <= 2 * (N - 1); s++) {
    const wy = s * TH / 2; if (wy < y0 - 20 || wy > y1 + MAXLVL * LH + 40) continue;
    for (let x = Math.max(0, s - N + 1); x <= Math.min(N - 1, s); x++) {
      const y = s - x, wx = (x - y) * TW / 2; if (wx < x0 - TW || wx > x1 + TW) continue;
      drawTile(ctx, x, y, 0, 0);
    }
  }
}
function drawWater(now, x0, x1, y0, y1, z) {
  if (z < 0.45) return;
  const t = S.tiles, k = now / 1000;
  ctx.lineWidth = 1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = idx(x, y); if (t.type[i] !== T.WATER && t.type[i] !== T.DEEP) continue;
    const [sx, sy] = iso(x + 0.5, y + 0.5, WATER_LVL); if (sx < x0 || sx > x1 || sy < y0 || sy > y1) continue;
    const ph = Math.sin(k * 1.6 + t.noise[i] * 12 + x * 0.5);
    if (ph > 0.55) { ctx.strokeStyle = `rgba(255,255,255,${(ph - 0.55) * 0.7})`; ctx.beginPath(); ctx.moveTo(sx - 6, sy); ctx.lineTo(sx + 6, sy); ctx.stroke(); }
    if (t.fish[i] > 6 && Math.sin(k * 0.7 + t.noise[i] * 40) > 0.97) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(sx, sy, 5, 2.5, 0, 0, 7); ctx.stroke(); }
  }
}
function drawGroundDecals(x0, x1, y0, y1) {
  for (const b of S.buildings) {
    if (b.type !== 'champ') continue;
    const i = idx(b.x, b.y), lv = tileLvl(i), [sx, sy] = iso(b.x, b.y, lv);
    if (sx < x0 || sx > x1 || sy < y0 || sy > y1) continue;
    ctx.globalAlpha = b.done ? 1 : 0.5;
    ctx.fillStyle = '#6b4a2c'; ctx.beginPath(); ctx.moveTo(sx, sy + 1); ctx.lineTo(sx + TW / 2 - 1, sy + TH / 2); ctx.lineTo(sx, sy + TH - 1); ctx.lineTo(sx - TW / 2 + 1, sy + TH / 2); ctx.closePath(); ctx.fill();
    const c = S.tiles.crop[i];
    const row = (f) => { ctx.beginPath(); ctx.moveTo(lerp(sx, sx - TW / 2, f) + 1, lerp(sy, sy + TH / 2, f)); ctx.lineTo(lerp(sx + TW / 2, sx, f) - 1, lerp(sy + TH / 2, sy + TH, f)); ctx.stroke(); };
    if (c > 0) {
      ctx.strokeStyle = c >= 1 ? '#e2c04a' : `rgb(${lerp(90, 170, c) | 0},${lerp(170, 175, c) | 0},${lerp(60, 50, c) | 0})`; ctx.lineWidth = 1 + c * 1.6;
      for (let k = 1; k < 5; k++) row(k / 5);
      if (c > 0.5) { ctx.fillStyle = c >= 1 ? '#f1d461' : '#7fb24a'; for (let k = 0; k < 7; k++) ctx.fillRect(sx - 10 + k * 3, sy + TH / 2 - 3 - c * 3 + (k % 2), 1.4, 3 + c * 3); }
    } else { ctx.strokeStyle = 'rgba(40,25,10,0.5)'; ctx.lineWidth = 1; for (let k = 1; k < 4; k++) row(k / 4); }
    ctx.globalAlpha = 1;
  }
}

// ---------- entités ----------
const drawList = [];
function drawEntities(x0, x1, y0, y1, z, now, labels, season) {
  drawList.length = 0;
  const t = S.tiles, snow = S.snowCover > 0.45;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = idx(x, y);
    if (t.tree[i] <= 0.03 && !t.bush[i] && t.stone[i] < 2 && t.fire[i] <= 0) continue;
    if (t.type[i] === T.ROCK || t.type[i] === T.SNOW) { if (t.fire[i] <= 0 && t.tree[i] <= 0.03) continue; }
    const [sx, sy] = iso(x + 0.5, y + 0.5, tileLvl(i));
    if (sx < x0 || sx > x1 || sy < y0 || sy > y1 + 60) continue;
    drawList.push({ d: x + y + 1, k: 0, i, sx, sy });
  }
  for (const b of S.buildings) {
    if (b.type === 'champ') continue;
    const [sx, sy] = iso(b.x + 0.5, b.y + 0.5, tileLvl(idx(b.x, b.y)));
    if (sx < x0 - 80 || sx > x1 + 80 || sy < y0 || sy > y1 + 120) continue;
    drawList.push({ d: b.x + b.y + 1.05, k: 1, o: b, sx, sy });
  }
  for (const b of S.beings) {
    if (!b.alive || b.inside) continue;
    const [sx, sy] = iso(b.x, b.y, groundLvl(b.x, b.y));
    if (sx < x0 || sx > x1 || sy < y0 || sy > y1 + 40) continue;
    drawList.push({ d: b.x + b.y + 0.2, k: 2, o: b, sx, sy });
  }
  for (const a of S.animals) {
    if (!a.alive) continue;
    const [sx, sy] = iso(a.x, a.y, groundLvl(a.x, a.y));
    if (sx < x0 || sx > x1 || sy < y0 || sy > y1 + 40) continue;
    drawList.push({ d: a.x + a.y + 0.2, k: 3, o: a, sx, sy });
  }
  for (const e of S.effects) if (e.kind === 'corpse' || e.kind === 'carcass') { const [sx, sy] = iso(e.x, e.y, groundLvl(e.x, e.y)); drawList.push({ d: e.x + e.y, k: 4, o: e, sx, sy }); }
  drawList.sort((a, b) => a.d - b.d);
  const detail = z > 0.55;
  for (const e of drawList) {
    if (e.k === 0) drawTileObj(e, season, snow, now, detail);
    else if (e.k === 1) drawBuilding(e.o, e.sx, e.sy, now, labels, z);
    else if (e.k === 2) drawBeing(e.o, e.sx, e.sy, z, now, labels, detail);
    else if (e.k === 3) drawAnimal(e.o, e.sx, e.sy, detail);
    else drawCorpse(e.o, e.sx, e.sy);
  }
}
function drawTileObj(e, season, snow, now, detail) {
  const t = S.tiles, i = e.i, { sx, sy } = e;
  const nz = t.noise[i];
  if (t.tree[i] > 0.03) {
    const sp = treeSprite(t.treeKind[i], season, snow), sc = 0.4 + t.tree[i] * 0.65 + nz * 0.15;
    const w = 34 * sc, h = 56 * sc;
    if (t.ash[i] > 0.5 && t.fire[i] <= 0) ctx.filter = 'none';
    const burnt = t.fire[i] > 0 || t.ash[i] > 0.6;
    if (burnt) ctx.globalAlpha = 0.85;
    if (nz > 0.5) { ctx.save(); ctx.translate(sx, 0); ctx.scale(-1, 1); ctx.drawImage(sp, -w / 2, sy - h + 4 * sc, w, h); ctx.restore(); }
    else ctx.drawImage(sp, sx - w / 2, sy - h + 4 * sc, w, h);
    if (burnt) { ctx.globalAlpha = 0.5; ctx.fillStyle = '#1a1410'; ctx.beginPath(); ctx.ellipse(sx, sy - h * 0.5, w * 0.35, h * 0.38, 0, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  } else if (t.bush[i]) {
    const sp = bushSprite(season, snow); ctx.drawImage(sp, sx - 10, sy - 14, 20, 16);
    if (detail && t.berries[i] >= 1 && season < 3) { ctx.fillStyle = '#d0213a'; const n = Math.floor(t.berries[i]); for (let k = 0; k < n; k++) { ctx.beginPath(); ctx.arc(sx - 5 + ((k * 37 + i) % 10), sy - 9 + ((k * 13 + i) % 5), 1.2, 0, 7); ctx.fill(); } }
  } else if (t.stone[i] >= 2) { ctx.drawImage(rockSprite(t.stone[i] > 8 ? 1 : 0), sx - 10, sy - 11, 20, 14); }
  if (t.fire[i] > 0) drawFlames(sx, sy - 6, 1 + Math.min(1, t.tree[i]), now, i);
}
function drawFlames(x, y, s, now, seed = 0) {
  const k = now / 90 + seed;
  for (let j = 0; j < 4; j++) {
    const h = (10 + Math.sin(k + j * 1.7) * 4) * s, w = 4 * s, ox = (j - 1.5) * 3 * s;
    const g = ctx.createLinearGradient(0, y - h, 0, y); g.addColorStop(0, 'rgba(255,240,120,0)'); g.addColorStop(0.3, 'rgba(255,190,60,0.9)'); g.addColorStop(1, 'rgba(220,60,20,0.95)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x + ox - w, y); ctx.quadraticCurveTo(x + ox - w * 0.5, y - h * 0.6, x + ox + Math.sin(k * 1.3 + j) * 2, y - h); ctx.quadraticCurveTo(x + ox + w * 0.5, y - h * 0.5, x + ox + w, y); ctx.fill();
  }
  ctx.fillStyle = 'rgba(60,60,60,0.25)'; for (let j = 0; j < 3; j++) { const p = ((now / 1400 + j / 3 + seed * 0.1) % 1); ctx.beginPath(); ctx.arc(x + Math.sin(p * 6 + seed) * 5, y - 14 * s - p * 40, 3 + p * 7, 0, 7); ctx.fill(); }
}

function isoBox(x, y, w, d, h, top, left, right) { // boîte isométrique centrée au sol
  const hw = w / 2, hd = d / 2;
  const p = (dx, dy, dz) => [x + (dx - dy) * TW / 2 / 1, y + (dx + dy) * TH / 2 - dz];
  const A = p(-hw, -hd, h), B = p(hw, -hd, h), C = p(hw, hd, h), D = p(-hw, hd, h), Cb = p(hw, hd, 0), Db = p(-hw, hd, 0), Bb = p(hw, -hd, 0);
  ctx.fillStyle = left; ctx.beginPath(); ctx.moveTo(...D); ctx.lineTo(...C); ctx.lineTo(...Cb); ctx.lineTo(...Db); ctx.closePath(); ctx.fill();
  ctx.fillStyle = right; ctx.beginPath(); ctx.moveTo(...C); ctx.lineTo(...B); ctx.lineTo(...Bb); ctx.lineTo(...Cb); ctx.closePath(); ctx.fill();
  if (top) { ctx.fillStyle = top; ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(...B); ctx.lineTo(...C); ctx.lineTo(...D); ctx.closePath(); ctx.fill(); }
  return { A, B, C, D };
}
function drawBuilding(b, sx, sy, now, labels, z) {
  const tr = tribeById(b.tribeId), p = b.done ? 1 : b.progress, col = tr?.color || '#999';
  ctx.globalAlpha = b.done ? 1 : 0.45 + p * 0.5;
  const night = daylight() < 0.4;
  switch (b.type) {
    case 'feu': {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx, sy, 9, 4.5, 0, 0, 7); ctx.fill();
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; ctx.fillStyle = k % 2 ? '#8d8a84' : '#a9a59c'; ctx.beginPath(); ctx.ellipse(sx + Math.cos(a) * 7, sy + Math.sin(a) * 3.5, 2.6, 1.8, 0, 0, 7); ctx.fill(); }
      ctx.fillStyle = '#4a3020'; ctx.fillRect(sx - 4, sy - 1.5, 8, 2);
      if (has(tr, 'feu')) drawFlames(sx, sy, 0.9, now, b.id);
      // mât et bannière de la tribu
      ctx.fillStyle = '#5a3d24'; ctx.fillRect(sx + 11, sy - 34, 1.6, 34);
      const wv = Math.sin(now / 300 + b.id) * 2;
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(sx + 12.6, sy - 34); ctx.quadraticCurveTo(sx + 20, sy - 33 + wv, sx + 26, sy - 31); ctx.lineTo(sx + 26, sy - 24); ctx.quadraticCurveTo(sx + 20, sy - 25 + wv, sx + 12.6, sy - 25); ctx.fill();
      if (tr && z > 0.35) labels.push({ x: sx, y: sy - 40, text: tr.name, color: col, kind: 'tribe', war: !!tr.war });
      break;
    }
    case 'hutte': case 'grenier': {
      const stilts = b.type === 'grenier' ? 6 : 0;
      if (stilts) { ctx.fillStyle = '#4b3220'; for (const dx of [-7, 7, -3, 3]) ctx.fillRect(sx + dx, sy - stilts - 2, 1.5, stilts + 2); }
      const by = sy - stilts;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx, sy + 1, 13, 6, 0, 0, 7); ctx.fill();
      const wh = 10 * Math.min(1, p * 2);
      const wg = ctx.createLinearGradient(sx - 11, 0, sx + 11, 0); wg.addColorStop(0, '#9b7448'); wg.addColorStop(1, '#5d4128');
      ctx.fillStyle = wg; ctx.beginPath(); ctx.ellipse(sx, by, 11, 5.5, 0, 0, Math.PI); ctx.lineTo(sx - 11, by - wh); ctx.ellipse(sx, by - wh, 11, 5.5, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
      if (p > 0.5) {
        ctx.fillStyle = night && b.type === 'hutte' ? 'rgba(255,190,90,0.95)' : '#2c1d12'; ctx.beginPath(); ctx.ellipse(sx - 2, by + 1.2, 2.8, 5, 0, Math.PI, 0); ctx.fill();
        const rh = 16 * Math.min(1, (p - 0.5) * 2);
        const rg = ctx.createLinearGradient(sx - 14, 0, sx + 14, 0); rg.addColorStop(0, '#e2c27a'); rg.addColorStop(1, '#9c7d3e');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(sx, by - wh, 14, 7, 0, 0, Math.PI); ctx.lineTo(sx, by - wh - rh); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(90,60,20,0.35)'; ctx.lineWidth = 0.8; for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(sx, by - wh - rh); ctx.lineTo(sx + k * 4, by - wh + 6 - Math.abs(k) * 0.8); ctx.stroke(); }
        if (S.snowCover > 0.45) { ctx.fillStyle = 'rgba(245,248,255,0.92)'; ctx.beginPath(); ctx.moveTo(sx, by - wh - rh); ctx.lineTo(sx + 9, by - wh - rh * 0.35); ctx.lineTo(sx - 9, by - wh - rh * 0.35); ctx.fill(); }
      } else { ctx.strokeStyle = '#6b4a2c'; ctx.lineWidth = 1.2; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(sx + k * 5, by + 2); ctx.lineTo(sx, by - 24); ctx.stroke(); } }
      if (b.type === 'hutte' && night && p >= 1 && has(tr, 'feu')) { ctx.fillStyle = 'rgba(180,180,180,0.18)'; ctx.beginPath(); ctx.arc(sx + 2, by - 32 - (now / 50 % 20), 3, 0, 7); ctx.fill(); }
      break;
    }
    case 'maison': {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx + 2, sy + 2, 16, 8, 0, 0, 7); ctx.fill();
      const h = 14 * Math.min(1, p * 1.6);
      const { A, B, C, D } = isoBox(sx, sy - TH / 2, 0.75, 0.75, h, null, '#b9b2a4', '#8a8478');
      ctx.fillStyle = night ? 'rgba(255,200,110,0.95)' : '#3b3a40'; ctx.fillRect(sx - 9, sy - h * 0.6, 3, 4); ctx.fillRect(sx + 5, sy - h * 0.6, 3, 4);
      if (p > 0.6) { const rh = 11; ctx.fillStyle = '#8f3b2a'; ctx.beginPath(); ctx.moveTo(...A); ctx.lineTo(A[0] + (C[0] - A[0]) / 2, A[1] + (C[1] - A[1]) / 2 - rh); ctx.lineTo(...D); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#b4513a'; ctx.beginPath(); ctx.moveTo(...D); ctx.lineTo(A[0] + (C[0] - A[0]) / 2, A[1] + (C[1] - A[1]) / 2 - rh); ctx.lineTo(...B); ctx.lineTo(...C); ctx.closePath(); ctx.fill(); }
      break;
    }
    case 'temple': {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx + 3, sy + 3, 24, 12, 0, 0, 7); ctx.fill();
      const lv = Math.ceil(p * 4);
      for (let k = 0; k < lv; k++) isoBox(sx, sy - TH / 2 - k * 8, 1.2 - k * 0.25, 1.2 - k * 0.25, 8, k === lv - 1 ? '#e2dccd' : null, '#cfc6b2', '#a69d8a');
      if (b.done) { const f = tr ? tr.faith : 0.3; const g = ctx.createRadialGradient(sx, sy - 40, 0, sx, sy - 40, 30); g.addColorStop(0, `rgba(255,230,150,${0.4 + f * 0.5})`); g.addColorStop(1, 'rgba(255,230,150,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy - 40, 30, 0, 7); ctx.fill(); ctx.fillStyle = '#fff4c8'; ctx.beginPath(); ctx.arc(sx, sy - 40, 3, 0, 7); ctx.fill(); }
      break;
    }
    case 'tombe': {
      ctx.fillStyle = '#6a4d33'; ctx.beginPath(); ctx.ellipse(sx, sy, 6, 3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#9d9a92'; ctx.fillRect(sx - 2, sy - 9, 4, 8); ctx.beginPath(); ctx.arc(sx, sy - 9, 2, Math.PI, 0); ctx.fill();
      if (z > 2.2 && b.who) labels.push({ x: sx, y: sy - 14, text: '✝ ' + b.who, color: '#ccc', kind: 'small' });
      break;
    }
    case 'passage': drawPassage(b, sx, sy, now, p); break;
  }
  ctx.globalAlpha = 1;
  if (!b.done && b.type !== 'tombe' && b.type !== 'feu') { // barre de progression du chantier
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(sx - 12, sy + 6, 24, 3); ctx.fillStyle = '#ffd34d'; ctx.fillRect(sx - 12, sy + 6, 24 * p, 3);
  }
}
function drawPassage(b, sx, sy, now, p) {
  const H = 110 * Math.max(0.15, p);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sx, sy + 2, 30, 13, 0, 0, 7); ctx.fill();
  for (const dx of [-20, 20]) { const g = ctx.createLinearGradient(sx + dx - 6, 0, sx + dx + 6, 0); g.addColorStop(0, '#d8d2c4'); g.addColorStop(1, '#8b8577'); ctx.fillStyle = g; ctx.fillRect(sx + dx - 6, sy - H, 12, H); }
  if (p > 0.7) { ctx.strokeStyle = '#c9c2b2'; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(sx, sy - H, 20, Math.PI, 0); ctx.stroke(); }
  if (!b.done) { ctx.strokeStyle = 'rgba(120,85,50,0.8)'; ctx.lineWidth = 1.2; for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(sx - 30, sy - k * H / 6); ctx.lineTo(sx + 30, sy - k * H / 6 - 8); ctx.stroke(); } return; }
  const t = now / 1000;
  const g = ctx.createRadialGradient(sx, sy - H * 0.55, 2, sx, sy - H * 0.55, 26); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(160,220,255,0.9)'); g.addColorStop(1, 'rgba(120,80,255,0.2)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, sy - H * 0.5, 14, H * 0.5, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.2;
  for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(sx, sy - H * 0.5, 4 + k * 3, H * 0.15 + k * 8, t * (k + 1) * 0.7, 0, 5); ctx.stroke(); }
  // faisceau jusqu'à la paroi
  const bg = ctx.createLinearGradient(0, sy - H, 0, SPH.y - SPH.r); bg.addColorStop(0, 'rgba(190,230,255,0.5)'); bg.addColorStop(1, 'rgba(190,230,255,0)');
  ctx.fillStyle = bg; ctx.fillRect(sx - 6, SPH.y - SPH.r, 12, sy - H - (SPH.y - SPH.r));
}

const SKIN = [[255, 224, 196], [234, 186, 146], [198, 140, 98], [150, 98, 64], [96, 62, 42]];
const HAIR = [[30, 24, 20], [70, 44, 26], [110, 72, 40], [150, 70, 36], [214, 180, 110]];
const palAt = (pal, t) => { const f = clamp(t) * (pal.length - 1), i = Math.floor(f), k = f - i; return mix(pal[i], pal[Math.min(pal.length - 1, i + 1)], k); };
function drawBeing(b, sx, sy, z, now, labels, detail) {
  const tr = tribeById(b.tribeId), sel = S.selected === b.id;
  const a = b.age, s = (a < 3 ? 0.42 + a * 0.04 : a < 12 ? 0.55 + (a - 3) / 9 * 0.3 : a < 16 ? 0.88 : 1) * (0.9 + b.genes.height * 0.2) * (a > 70 ? 0.95 : 1);
  if (sel) { ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1.5 / Math.max(0.5, z); ctx.beginPath(); ctx.ellipse(sx, sy, 7, 3.5, 0, 0, 7); ctx.stroke(); }
  if (!detail) { ctx.fillStyle = tr?.color || '#ddd'; ctx.beginPath(); ctx.arc(sx, sy - 4, 2.6, 0, 7); ctx.fill(); return; }
  const skin = palAt(SKIN, b.genes.skin), sick = b.disease ? clamp(b.disease.sev / 80) : 0;
  const skinC = css(pack(...mix(skin, [150, 190, 120], sick * 0.5)));
  const hairC = a > elder(b) ? '#d8d8d8' : a > elder(b) - 8 ? '#9a9590' : css(pack(...palAt(HAIR, b.genes.hair)));
  const cloth = has(tr, 'vetements') ? (tr.color) : '#8a5f3a';
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx, sy, 4.5 * s, 2 * s, 0, 0, 7); ctx.fill();
  const H = 19 * s;
  if (b.sleeping) {
    ctx.fillStyle = cloth; ctx.beginPath(); ctx.ellipse(sx, sy - 2 * s, 7 * s, 2.6 * s, -0.15, 0, 7); ctx.fill();
    ctx.fillStyle = skinC; ctx.beginPath(); ctx.arc(sx - 7 * s * b.dir, sy - 2.5 * s, 2.4 * s, 0, 7); ctx.fill();
    if (z > 0.9) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = `${6 + Math.sin(now / 400 + b.id) * 1}px sans-serif`; ctx.fillText('z', sx + 3, sy - 8 - (now / 200 % 6)); }
    if (sel || z > 2.4) labels.push({ x: sx, y: sy - 10, text: b.name, kind: 'name', color: tr?.color });
    return;
  }
  const act = b.act?.type, moving = b.act?.phase === 'go';
  const sw = moving ? Math.sin(b.walk * 2.2) : 0;
  const sit = b.sitting && b.act?.phase === 'do' && !b.act?.fest;
  const kneel = sit || act === 'pray' || act === 'mourn' || act === 'gather' && b.act.phase === 'do' || act === 'farm' && b.act.phase === 'do';
  const old = a > elder(b) - 4, bend = old ? 1.2 * s * b.dir : 0;
  const legH = kneel ? H * 0.18 : H * 0.36, bodyY = sy - legH;
  // jambes
  ctx.strokeStyle = skinC; ctx.lineWidth = 1.6 * s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(sx - 1.2 * s, bodyY); ctx.lineTo(sx - 1.2 * s + sw * 2.4 * s, sy); ctx.moveTo(sx + 1.2 * s, bodyY); ctx.lineTo(sx + 1.2 * s - sw * 2.4 * s, sy); ctx.stroke();
  // corps
  const bw = (b.sex === 'F' ? 3.4 : 3.8) * s + (b.pregnant ? 1.5 * s * Math.min(1, b.pregnant.t / 300) : 0), bh = H * 0.36;
  ctx.fillStyle = cloth; ctx.beginPath(); ctx.ellipse(sx, bodyY - bh / 2, bw, bh / 1.6, 0, 0, 7); ctx.fill();
  if (b.sex === 'F' && has(tr, 'vetements')) { ctx.beginPath(); ctx.moveTo(sx - bw * 1.1, bodyY + 1); ctx.lineTo(sx + bw * 1.1, bodyY + 1); ctx.lineTo(sx + bw * 0.7, bodyY - bh * 0.4); ctx.lineTo(sx - bw * 0.7, bodyY - bh * 0.4); ctx.fill(); }
  // bras (selon l'action)
  const shY = bodyY - bh * 0.8; ctx.strokeStyle = skinC; ctx.lineWidth = 1.4 * s;
  let ax = 0, ay = 0;
  if (act === 'pray' || act === 'wall') { ax = 0; ay = -6 * s; }
  else if ((act === 'chop' || act === 'mine' || act === 'build' || act === 'fight') && b.act.phase === 'do') { const ph = Math.sin(now / 90 + b.id); ax = 4 * s * b.dir; ay = -3 * s + ph * 4 * s; }
  else { ax = -sw * 2 * s; ay = 5 * s; }
  ctx.beginPath(); ctx.moveTo(sx - bw * 0.9, shY); ctx.lineTo(sx - bw * 0.9 - (act === 'pray' || act === 'wall' ? 1.5 * s : -ax * 0.5), shY + ay);
  ctx.moveTo(sx + bw * 0.9, shY); ctx.lineTo(sx + bw * 0.9 + ax, shY + ay); ctx.stroke();
  if ((act === 'chop' || act === 'mine' || act === 'fight' || act === 'hunt') && has(tr, 'outils')) { ctx.strokeStyle = '#6b4a2c'; ctx.lineWidth = 1 * s; ctx.beginPath(); ctx.moveTo(sx + bw * 0.9 + ax, shY + ay); ctx.lineTo(sx + bw * 0.9 + ax + 3 * s * b.dir, shY + ay - 5 * s); ctx.stroke(); }
  // charge sur le dos
  const load = b.carry.food + b.carry.wood + b.carry.stone;
  if (load > 0.5) { ctx.fillStyle = b.carry.wood > b.carry.food ? '#7a5532' : b.carry.stone > b.carry.food ? '#8d8a84' : '#b5452f'; ctx.beginPath(); ctx.ellipse(sx - 3 * s * b.dir, bodyY - bh * 0.6, 2.4 * s, 2.8 * s, 0, 0, 7); ctx.fill(); }
  // tête
  const hy = bodyY - bh - 2.6 * s, hr = (a < 12 ? 2.9 : 2.6) * s;
  ctx.fillStyle = skinC; ctx.beginPath(); ctx.arc(sx, hy, hr, 0, 7); ctx.fill();
  ctx.fillStyle = hairC; ctx.beginPath();
  if (b.sex === 'F') { ctx.arc(sx, hy - 0.4 * s, hr * 1.08, Math.PI * 0.95, Math.PI * 2.05); ctx.fill(); ctx.fillRect(sx - hr * 1.05 + (b.dir > 0 ? 0 : hr * 1.2), hy - 0.5 * s, hr * 0.9, hr * 2.1); }
  else { ctx.arc(sx, hy - 0.6 * s, hr * 1.02, Math.PI * 1.02, Math.PI * 1.98); ctx.fill(); }
  if (z > 2) { ctx.fillStyle = '#1a1a1a'; ctx.fillRect(sx + b.dir * hr * 0.4 - 0.4, hy - 0.3, 0.8, 0.8); }
  if (b.health < 30) { ctx.fillStyle = 'rgba(200,0,0,0.6)'; ctx.fillRect(sx - 0.8, bodyY - bh * 0.6, 1.6, 1.6); }
  // blessures : bandage ; anciens et boiteux : bâton
  if (b.wounds?.length) { ctx.strokeStyle = '#f4f1ea'; ctx.lineWidth = 1.1 * s; ctx.beginPath(); const fr = b.wounds.some((w) => w.kind === 'fracture'); if (fr) { ctx.moveTo(sx - 2.2 * s, sy - legH * 0.5); ctx.lineTo(sx - 0.2 * s, sy - legH * 0.5); } else { ctx.moveTo(sx - bw, bodyY - bh * 0.5); ctx.lineTo(sx + bw, bodyY - bh * 0.4); } ctx.stroke(); if (b.wounds.some((w) => w.t < 4 && w.kind !== 'fracture')) { ctx.fillStyle = 'rgba(190,20,20,0.8)'; ctx.fillRect(sx + bw * 0.2, bodyY - bh * 0.55, 1.2 * s, 1.2 * s); } }
  if ((old || b.flags?.limp) && !kneel) { ctx.strokeStyle = '#6b4a2c'; ctx.lineWidth = 0.9 * s; ctx.beginPath(); ctx.moveTo(sx + bw * 1.3 * b.dir, sy); ctx.lineTo(sx + bw * 1.1 * b.dir + bend * 0.3, shY + 1 * s); ctx.stroke(); }
  if (b.singing && now < b.singing && z > 0.9) labels.push({ x: sx + 6 * s, y: hy - 4 * s - ((now / 30) % 12), text: '♪', kind: 'icon' });
  // étiquettes en espace écran
  const icon = act === 'veillee' && b.act?.fest && z > 1.2 ? '💃' : act === 'funeral' ? '🕯️' : act === 'feed' ? '🤲' : act === 'trade' ? '🤝' : act === 'rally' ? '🚩' : act === 'fight' ? '⚔️' : act === 'talk' && b.act.conv?.topic === 'amour' ? '💕' : b.disease ? '🤒' : act === 'pray' ? '🙏' : act === 'flee' ? '😱' : act === 'wall' ? '🫧' : null;
  if (icon && z > 0.8) labels.push({ x: sx, y: hy - 7 * s, text: icon, kind: 'icon' });
  if (b.say && now < b.say.until && (z > 0.85 || sel)) labels.push({ x: sx, y: hy - 6 * s, text: b.say.text, kind: 'say', a: clamp((b.say.until - now) / 500) });
  else if ((view.names && z > 1.9) || sel) labels.push({ x: sx, y: hy - 6 * s, text: (b.role && ROLES[b.role] && b.age >= 16 ? ROLES[b.role].icon + ' ' : '') + b.name, kind: 'name', color: tr?.color });
}
const elder = (b) => 52 + b.genes.lon * 14;
function drawAnimal(a, sx, sy, detail) {
  const sc = a.age < 0.5 ? 0.6 : 1, sw = Math.sin(a.walk * 3) * 1.4, d = a.dir;
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(sx, sy, 5 * sc, 2 * sc, 0, 0, 7); ctx.fill();
  if (!detail) { ctx.fillStyle = a.sp === 'wolf' ? '#666' : a.sp === 'bear' ? '#3d2a1c' : a.sp === 'boar' ? '#4a3a2e' : '#8b5a2b'; ctx.fillRect(sx - 1.5, sy - 3, a.sp === 'bear' ? 4 : 3, 2); return; }
  if (a.hidden) ctx.globalAlpha = 0.45;
  if (a.sp === 'boar') { // sanglier
    ctx.strokeStyle = '#2e241c'; ctx.lineWidth = 1.2 * sc;
    ctx.beginPath(); for (const lx of [-3, 2.5]) { ctx.moveTo(sx + lx * sc, sy - 3 * sc); ctx.lineTo(sx + lx * sc + sw * 0.6 * (lx > 0 ? 1 : -1), sy); } ctx.stroke();
    ctx.fillStyle = a.age < 1 ? '#8a6a44' : '#4a3a2e'; ctx.beginPath(); ctx.ellipse(sx, sy - 4.5 * sc, 5.5 * sc, 3 * sc, 0, 0, 7); ctx.fill();
    if (a.age < 1) { ctx.strokeStyle = '#d8c4a0'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(sx - 4 * sc, sy - 5 * sc); ctx.lineTo(sx + 4 * sc, sy - 5 * sc); ctx.stroke(); }
    ctx.fillStyle = '#3a2d23'; ctx.beginPath(); ctx.moveTo(sx + 4 * sc * d, sy - 6.5 * sc); ctx.lineTo(sx + 8.5 * sc * d, sy - 4 * sc); ctx.lineTo(sx + 4 * sc * d, sy - 2.5 * sc); ctx.fill();
    if (a.sex === 'M' && a.age > 1.5) { ctx.strokeStyle = '#efe6d2'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(sx + 7.5 * sc * d, sy - 4 * sc); ctx.lineTo(sx + 8.5 * sc * d, sy - 6 * sc); ctx.stroke(); }
    ctx.fillStyle = '#2a1f18'; ctx.beginPath(); ctx.moveTo(sx - 1 * sc, sy - 7.5 * sc); ctx.lineTo(sx + 3 * sc * d, sy - 7.8 * sc); ctx.lineTo(sx + 2 * sc * d, sy - 6.5 * sc); ctx.fill();
    ctx.globalAlpha = 1; return;
  }
  if (a.sp === 'bear') { // ours
    const bs = (a.age < 2 ? 0.55 : 1) * 1.25;
    if (a.state === 'hibernate') { ctx.fillStyle = '#3d2a1c'; ctx.beginPath(); ctx.ellipse(sx, sy - 3 * bs, 7 * bs, 3.5 * bs, 0, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '7px sans-serif'; ctx.fillText('z', sx + 5, sy - 9 - (performance.now() / 300 % 5)); return; }
    ctx.strokeStyle = '#2b1d13'; ctx.lineWidth = 2.2 * bs;
    ctx.beginPath(); for (const lx of [-3.5, 3.5]) { ctx.moveTo(sx + lx * bs, sy - 4 * bs); ctx.lineTo(sx + lx * bs + sw * 0.6 * (lx > 0 ? 1 : -1), sy); } ctx.stroke();
    const g = ctx.createRadialGradient(sx - 2 * bs, sy - 8 * bs, 1, sx, sy - 6 * bs, 8 * bs); g.addColorStop(0, '#6b4a31'); g.addColorStop(1, '#3a2719');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, sy - 6 * bs, 6.5 * bs, 4.2 * bs, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + 5.5 * bs * d, sy - 8 * bs, 2.8 * bs, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + 4.2 * bs * d, sy - 10.6 * bs, 1 * bs, 0, 7); ctx.arc(sx + 6.8 * bs * d, sy - 10.4 * bs, 1 * bs, 0, 7); ctx.fill();
    ctx.fillStyle = '#c9a57a'; ctx.beginPath(); ctx.ellipse(sx + 7.6 * bs * d, sy - 7.6 * bs, 1.3 * bs, 1 * bs, 0, 0, 7); ctx.fill();
    if (a.state === 'attack') { ctx.fillStyle = '#fff'; ctx.font = 'bold 8px sans-serif'; ctx.fillText('!', sx + 2, sy - 16 * bs); }
    return;
  }
  if (a.sp === 'deer') {
    ctx.strokeStyle = '#5b3a1e'; ctx.lineWidth = 1 * sc;
    ctx.beginPath(); for (const lx of [-3, 3]) { ctx.moveTo(sx + lx * sc, sy - 5 * sc); ctx.lineTo(sx + lx * sc + sw * (lx > 0 ? 1 : -1), sy); } ctx.stroke();
    ctx.fillStyle = '#a0683a'; ctx.beginPath(); ctx.ellipse(sx, sy - 6 * sc, 5 * sc, 2.6 * sc, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#f2e6d0'; ctx.beginPath(); ctx.ellipse(sx - 4.5 * sc * d, sy - 6.5 * sc, 1.2 * sc, 1 * sc, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#a0683a'; ctx.beginPath(); ctx.moveTo(sx + 3 * sc * d, sy - 7 * sc); ctx.lineTo(sx + 5.5 * sc * d, sy - 11 * sc); ctx.lineTo(sx + 7 * sc * d, sy - 10.5 * sc); ctx.lineTo(sx + 5 * sc * d, sy - 6 * sc); ctx.fill();
    ctx.beginPath(); ctx.ellipse(sx + 6.8 * sc * d, sy - 11 * sc, 1.8 * sc, 1.2 * sc, 0, 0, 7); ctx.fill();
    if (a.sex === 'M' && a.age > 1) { ctx.strokeStyle = '#d8c7a0'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(sx + 6 * sc * d, sy - 12 * sc); ctx.lineTo(sx + 5 * sc * d, sy - 16 * sc); ctx.lineTo(sx + 3.5 * sc * d, sy - 17 * sc); ctx.moveTo(sx + 5.4 * sc * d, sy - 14.5 * sc); ctx.lineTo(sx + 7.5 * sc * d, sy - 16 * sc); ctx.stroke(); }
  } else if (a.sp === 'rabbit') {
    ctx.fillStyle = '#9c8b78'; ctx.beginPath(); ctx.ellipse(sx, sy - 2 - Math.abs(sw), 2.6 * sc, 1.9 * sc, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + 2.2 * d * sc, sy - 3.4 - Math.abs(sw), 1.3 * sc, 0, 7); ctx.fill();
    ctx.fillRect(sx + 2 * d * sc, sy - 7 - Math.abs(sw), 0.8, 3); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx - 2.4 * d * sc, sy - 2.2, 0.9, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    ctx.strokeStyle = '#4a4a4a'; ctx.lineWidth = 1.1;
    ctx.beginPath(); for (const lx of [-3, 3]) { ctx.moveTo(sx + lx, sy - 4); ctx.lineTo(sx + lx + sw * (lx > 0 ? 1 : -1), sy); } ctx.stroke();
    ctx.fillStyle = '#6e6e6e'; ctx.beginPath(); ctx.ellipse(sx, sy - 5, 5, 2.4, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx - 4.5 * d, sy - 5.5); ctx.lineTo(sx - 9 * d, sy - 3.5); ctx.lineTo(sx - 4.5 * d, sy - 4); ctx.fill();
    ctx.beginPath(); ctx.ellipse(sx + 5 * d, sy - 6.5, 2.4, 1.8, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx + 6.8 * d, sy - 6.6); ctx.lineTo(sx + 9 * d, sy - 6); ctx.lineTo(sx + 6.8 * d, sy - 5.4); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx + 4 * d, sy - 8); ctx.lineTo(sx + 4.6 * d, sy - 10.5); ctx.lineTo(sx + 5.6 * d, sy - 8); ctx.fill();
    if (isNight()) { ctx.fillStyle = '#ffe680'; ctx.fillRect(sx + 6 * d, sy - 7.2, 0.9, 0.9); }
  }
}
function drawCorpse(e, sx, sy) {
  ctx.globalAlpha = clamp(e.t / 12);
  if (e.kind === 'corpse') { ctx.fillStyle = '#5d5048'; ctx.beginPath(); ctx.ellipse(sx, sy - 1.5, 6, 2, 0.1, 0, 7); ctx.fill(); ctx.fillStyle = '#8a7a6a'; ctx.beginPath(); ctx.arc(sx - 6, sy - 2, 1.8, 0, 7); ctx.fill(); }
  else { ctx.fillStyle = e.sp === 'wolf' ? '#555' : '#7a5030'; ctx.beginPath(); ctx.ellipse(sx, sy - 1.5, e.sp === 'rabbit' ? 2.5 : 5, 1.8, 0, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(120,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(sx + 1, sy, 3, 1.2, 0, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
}

function drawProjectiles(rdt) {
  ctx.strokeStyle = '#3d2a18'; ctx.lineWidth = 1.2;
  for (const p of S.projectiles) {
    const [sx, sy] = iso(p.x, p.y, groundLvl(p.x, p.y));
    const vy = p.vz, [nx, ny] = iso(p.x + p.vx * 0.05, p.y + p.vy * 0.05, groundLvl(p.x, p.y));
    const zz = p.z * 14;
    ctx.beginPath(); ctx.moveTo(sx, sy - zz); ctx.lineTo(sx + (nx - sx) * 1.5, sy - zz + (ny - sy) * 1.5 - vy * 0.6); ctx.stroke();
  }
}
function drawEffects(rdt, now) {
  for (const e of S.effects) {
    if (e.kind === 'corpse' || e.kind === 'carcass') continue;
    e.t -= rdt;
    const [sx, sy] = iso(e.x, e.y, groundLvl(e.x, e.y));
    if (e.kind === 'ripple') { const k = 1 - e.t / 1.2; ctx.strokeStyle = `rgba(200,235,255,${(1 - k) * 0.8})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(sx, sy - 12, 4 + k * 22, 8 + k * 30, 0, 0, 7); ctx.stroke(); }
    else if (e.kind === 'hit') { ctx.fillStyle = `rgba(220,30,30,${e.t * 3})`; ctx.beginPath(); ctx.arc(sx, sy - 8, 4 * (1 - e.t * 2) + 2, 0, 7); ctx.fill(); }
    else if (e.kind === 'bolt') {
      ctx.strokeStyle = `rgba(230,240,255,${clamp(e.t * 2.5)})`; ctx.lineWidth = 3; ctx.shadowColor = '#9cf'; ctx.shadowBlur = 20;
      ctx.beginPath(); let x = sx + range(-40, 40), y = SPH.y - SPH.r * 0.6; ctx.moveTo(x, y);
      while (y < sy) { y += range(20, 50); x += range(-25, 25); ctx.lineTo(Math.min(y, sy) === sy ? sx : x, Math.min(y, sy)); }
      ctx.stroke(); ctx.shadowBlur = 0;
    } else if (e.kind === 'glow') { const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, e.r * TW * 0.7); g.addColorStop(0, `rgba(${e.color},${clamp(e.t / 2) * 0.6})`); g.addColorStop(1, `rgba(${e.color},0)`); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, sy, e.r * TW * 0.7, e.r * TW * 0.4, 0, 0, 7); ctx.fill(); }
    else if (e.kind === 'meteor') {
      const k = clamp(1 - e.t / e.t0), x = lerp(sx - 300, sx, k), y = lerp(SPH.y - SPH.r * 0.9, sy, k);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 30); g.addColorStop(0, 'rgba(255,255,220,1)'); g.addColorStop(0.3, 'rgba(255,150,40,0.9)'); g.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 30, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,170,80,0.5)'; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 80, y - 60); ctx.stroke();
    } else if (e.kind === 'howl') { ctx.save(); ctx.globalAlpha = clamp(e.t / 1.5); ctx.fillStyle = '#dfe6ff'; ctx.font = 'italic 10px Georgia, serif'; ctx.fillText('Aouuuuh…', sx - 18, sy - 16 - (3 - e.t) * 6); ctx.restore(); }
    else if (e.kind === 'ascend') { const g = ctx.createLinearGradient(0, sy - 200, 0, sy); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(220,240,255,${e.t / 2})`); ctx.fillStyle = g; ctx.fillRect(sx - 6, sy - 200, 12, 200); }
  }
  S.effects = S.effects.filter((e) => e.t > 0);
}
function drawCloudShadows(rdt) {
  const w = S.weather.type, want = w === 'clair' ? 3 : w === 'nuageux' || w === 'brume' ? 10 : w === 'canicule' ? 0 : 14;
  while (clouds.length < want) clouds.push({ x: CX + range(-R, R), y: CY + range(-R, R), r: range(3, 7), alt: range(150, 230), seed: rnd() * 1000, a: 0 });
  const wind = S.weather.wind;
  for (const c of clouds) {
    c.x += wind.x * rdt * 0.3 * (S.speedV || 0.2) * 5 + rdt * 0.05; c.y += wind.y * rdt * 0.3 * (S.speedV || 0.2) * 5;
    if (Math.hypot(c.x - CX, c.y - CY) > R + 4) { const a = Math.atan2(c.y - CY, c.x - CX) + Math.PI; c.x = CX + Math.cos(a) * (R + 2); c.y = CY + Math.sin(a) * (R + 2); }
    c.a = clamp(c.a + rdt * (clouds.indexOf(c) < want ? 0.3 : -0.3));
  }
  clouds = clouds.filter((c, k) => k < want || c.a > 0);
  ctx.save(); ctx.beginPath(); ctx.ellipse(G.cx, G.cy, RX, RY, 0, 0, 7); ctx.clip();
  for (const c of clouds) {
    const [sx, sy] = iso(c.x + 3, c.y + 3, GROUND_LVL);
    ctx.fillStyle = `rgba(0,10,30,${0.13 * c.a})`; ctx.beginPath(); ctx.ellipse(sx, sy, c.r * TW * 0.7, c.r * TH * 0.7, 0, 0, 7); ctx.fill();
  }
  ctx.restore();
}
function drawClouds(z) {
  const fade = clamp(1.6 - z / cam.fit * 0.35) * (S.weather.type === 'brume' ? 0.5 : 1);
  if (fade <= 0.02) return;
  const dark = S.weather.type === 'orage' ? 0.45 : S.weather.type === 'pluie' || S.weather.type === 'neige' ? 0.7 : 1;
  const day = Math.max(0.25, daylight());
  for (const c of clouds) {
    const [sx, sy] = iso(c.x, c.y, GROUND_LVL); const y = sy - c.alt;
    const r = mulberry32(Math.floor(c.seed));
    for (let k = 0; k < 6; k++) {
      const ox = (r() - 0.5) * c.r * 30, oy = (r() - 0.5) * c.r * 8, rr = c.r * (7 + r() * 6);
      const v = Math.floor(255 * dark * day);
      const g = ctx.createRadialGradient(sx + ox - rr * 0.3, y + oy - rr * 0.3, rr * 0.1, sx + ox, y + oy, rr);
      g.addColorStop(0, `rgba(${v},${v},${Math.min(255, v + 10)},${0.85 * fade * c.a})`); g.addColorStop(1, `rgba(${v * 0.8},${v * 0.8},${v * 0.85},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx + ox, y + oy, rr, 0, 7); ctx.fill();
    }
  }
}
function drawWeather(rdt, z) {
  const w = S.weather.type; const rain = w === 'pluie' || w === 'orage', snow = w === 'neige';
  if (S.godRain && S.godRain.t > 0) S.godRain.t -= rdt * 0.4;
  if (!rain && !snow) return;
  ctx.save(); ctx.beginPath(); ctx.arc(SPH.x, SPH.y, SPH.r, 0, 7); ctx.clip();
  const n = Math.floor(drops.length * (w === 'orage' ? 1 : 0.65));
  ctx.strokeStyle = 'rgba(190,210,235,0.5)'; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1 / Math.max(0.6, z);
  const wx = S.weather.wind.x * 6;
  for (let k = 0; k < n; k++) {
    const d = drops[k];
    d.z -= rdt * (snow ? 60 : 520);
    if (snow) d.x += Math.sin(performance.now() / 700 + k) * rdt * 0.2;
    if (d.z < 0) { d.z = range(200, 280); d.x = CX + range(-R, R); d.y = CY + range(-R, R); if (Math.hypot(d.x - CX, d.y - CY) > R) { d.x = CX; d.y = CY; } }
    const [sx, sy] = iso(d.x, d.y, GROUND_LVL);
    if (snow) { ctx.fillRect(sx, sy - d.z, 1.6, 1.6); }
    else { ctx.beginPath(); ctx.moveTo(sx, sy - d.z); ctx.lineTo(sx - wx, sy - d.z + 9); ctx.stroke(); }
  }
  if (w === 'orage' && Math.random() < rdt * 0.4) S.flash = 0.6;
  ctx.restore();
}
function drawLighting(day, hour, now) {
  const dusk = clamp(1 - Math.abs(hour - 6.5) / 1.5) + clamp(1 - Math.abs(hour - 19.5) / 1.5);
  const dark = 1 - day;
  ctx.save(); ctx.beginPath(); ctx.arc(SPH.x, SPH.y, SPH.r, 0, 7); ctx.clip();
  const wDark = S.weather.type === 'orage' ? 0.25 : S.weather.type === 'pluie' ? 0.12 : 0;
  if (dark > 0.02 || wDark) { ctx.fillStyle = `rgba(8,14,40,${dark * 0.66 + wDark})`; ctx.fillRect(SPH.x - SPH.r, SPH.y - SPH.r, SPH.r * 2, SPH.r * 2); }
  if (dusk > 0.05) { ctx.fillStyle = `rgba(255,120,40,${dusk * 0.12})`; ctx.fillRect(SPH.x - SPH.r, SPH.y - SPH.r, SPH.r * 2, SPH.r * 2); }
  if (S.weather.type === 'brume') { ctx.fillStyle = 'rgba(220,226,232,0.28)'; ctx.fillRect(SPH.x - SPH.r, SPH.y - SPH.r, SPH.r * 2, SPH.r * 2); }
  if (S.weather.type === 'canicule') { ctx.fillStyle = 'rgba(255,190,90,0.08)'; ctx.fillRect(SPH.x - SPH.r, SPH.y - SPH.r, SPH.r * 2, SPH.r * 2); }
  // sources de lumière
  if (dark > 0.25 || S.fires.size) {
    ctx.globalCompositeOperation = 'lighter';
    const light = (x, y, r, a, col = '255,150,60') => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); };
    const fl = 0.85 + Math.sin(now / 120) * 0.08;
    for (const b of S.buildings) {
      const tr = tribeById(b.tribeId);
      const [sx, sy] = iso(b.x + 0.5, b.y + 0.5, tileLvl(idx(b.x, b.y)));
      if (b.type === 'feu' && has(tr, 'feu')) light(sx, sy - 4, 70, 0.45 * dark * fl + 0.05);
      else if ((b.type === 'hutte' || b.type === 'maison') && b.done && dark > 0.3) light(sx, sy - 4, 26, 0.25 * dark);
      else if (b.type === 'temple' && b.done) light(sx, sy - 40, 50, 0.3 * dark, '255,230,160');
      else if (b.type === 'passage' && b.done) light(sx, sy - 55, 140, 0.6, '170,220,255');
    }
    for (const i of S.fires) { const x = i % N, y = (i / N) | 0; const [sx, sy] = iso(x + 0.5, y + 0.5, tileLvl(i)); light(sx, sy - 8, 46, 0.35 + dark * 0.3); }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}
function drawBirds(rdt, z) {
  if (daylight() < 0.3) return;
  ctx.strokeStyle = 'rgba(30,30,40,0.75)'; ctx.lineWidth = 1.1 / Math.max(0.6, z);
  for (const f of birds) {
    f.a += rdt * (rnd() - 0.5) * 0.8;
    f.x += Math.cos(f.a) * rdt * 1.6; f.y += Math.sin(f.a) * rdt * 1.6;
    if (Math.hypot(f.x - CX, f.y - CY) > R - 3) { f.a = Math.atan2(CY - f.y, CX - f.x) + range(-0.6, 0.6); } // ils rebondissent sur la paroi
    for (let k = 0; k < f.n; k++) {
      const off = k - f.n / 2, bx = f.x - Math.cos(f.a) * Math.abs(off) * 0.6 + Math.sin(f.a) * off * 0.5, by = f.y - Math.sin(f.a) * Math.abs(off) * 0.6 - Math.cos(f.a) * off * 0.5;
      const [sx, sy] = iso(bx, by, GROUND_LVL); const y = sy - f.alt, fl = Math.sin(performance.now() / 120 + k) * 2;
      ctx.beginPath(); ctx.moveTo(sx - 3, y - fl); ctx.lineTo(sx, y); ctx.lineTo(sx + 3, y - fl); ctx.stroke();
    }
  }
}
function drawGlass(glass, z, now) {
  // paroi visible au sol, même de près : une bulle qui enferme le monde
  ctx.save();
  ctx.strokeStyle = `rgba(190,230,255,${0.25 + 0.15 * Math.sin(now / 800)})`; ctx.lineWidth = 2.5 / Math.max(0.5, z);
  ctx.beginPath(); ctx.ellipse(G.cx, G.cy, RX - 2, RY - 1, 0, 0, 7); ctx.stroke();
  const band = ctx.createLinearGradient(0, G.cy + RY, 0, G.cy + RY - 140);
  band.addColorStop(0, 'rgba(180,220,255,0.18)'); band.addColorStop(1, 'rgba(180,220,255,0)');
  ctx.fillStyle = band; ctx.beginPath(); ctx.ellipse(G.cx, G.cy, RX - 2, RY - 1, 0, 0, Math.PI); ctx.ellipse(G.cx, G.cy - 140, RX - 2, RY - 1, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
  // reflets verticaux sur la paroi
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI + 0.1, x = G.cx + Math.cos(a) * (RX - 2), y = G.cy + Math.sin(a) * (RY - 1);
    const g = ctx.createLinearGradient(0, y, 0, y - 120); g.addColorStop(0, `rgba(230,245,255,${0.12 + 0.06 * Math.sin(now / 1000 + k)})`); g.addColorStop(1, 'rgba(230,245,255,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 1.5, y - 120, 3, 120);
  }
  ctx.restore();
  if (glass <= 0.01) return;
  // la sphère de verre vue de loin
  ctx.save(); ctx.globalAlpha = glass;
  const fr = ctx.createRadialGradient(SPH.x, SPH.y, SPH.r * 0.7, SPH.x, SPH.y, SPH.r);
  fr.addColorStop(0, 'rgba(180,220,255,0)'); fr.addColorStop(0.85, 'rgba(180,220,255,0.08)'); fr.addColorStop(1, 'rgba(210,240,255,0.42)');
  ctx.fillStyle = fr; ctx.beginPath(); ctx.arc(SPH.x, SPH.y, SPH.r, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(220,245,255,0.75)'; ctx.lineWidth = 3 / z; ctx.beginPath(); ctx.arc(SPH.x, SPH.y, SPH.r, 0, 7); ctx.stroke();
  ctx.strokeStyle = 'rgba(120,180,255,0.35)'; ctx.lineWidth = 10 / z; ctx.beginPath(); ctx.arc(SPH.x, SPH.y, SPH.r + 5 / z, 0, 7); ctx.stroke();
  // reflets spéculaires
  ctx.save(); ctx.translate(SPH.x - SPH.r * 0.42, SPH.y - SPH.r * 0.5); ctx.rotate(-0.7);
  const sp = ctx.createRadialGradient(0, 0, 0, 0, 0, SPH.r * 0.35); sp.addColorStop(0, 'rgba(255,255,255,0.55)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sp; ctx.scale(1, 0.45); ctx.beginPath(); ctx.arc(0, 0, SPH.r * 0.35, 0, 7); ctx.fill(); ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 6 / z; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(SPH.x, SPH.y, SPH.r * 0.9, Math.PI * 1.08, Math.PI * 1.38); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.arc(SPH.x, SPH.y, SPH.r * 0.92, Math.PI * 0.12, Math.PI * 0.32); ctx.stroke();
  if (S.victory) { // la paroi se fissure
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2 / z; const r = mulberry32(77);
    for (let k = 0; k < 12; k++) { let a = r() * Math.PI * 2, x = SPH.x + Math.cos(a) * SPH.r, y = SPH.y + Math.sin(a) * SPH.r; ctx.beginPath(); ctx.moveTo(x, y); for (let j = 0; j < 5; j++) { x += (SPH.x - x) * 0.12 + (r() - 0.5) * 60; y += (SPH.y - y) * 0.12 + (r() - 0.5) * 60; ctx.lineTo(x, y); } ctx.stroke(); }
  }
  ctx.restore();
}
function drawVictoryRays(now) {
  const g = ctx.createRadialGradient(W / 2, H * 0.1, 0, W / 2, H * 0.1, H);
  g.addColorStop(0, `rgba(255,250,220,${0.12 + 0.05 * Math.sin(now / 600)})`); g.addColorStop(1, 'rgba(255,250,220,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function drawPowerCursor(z) {
  if (!view.power || !view.hover || !view.powerR) return;
  const [x, y] = view.hover, [sx, sy] = iso(x, y, groundLvl(x, y));
  ctx.strokeStyle = 'rgba(255,230,120,0.9)'; ctx.lineWidth = 2 / z; ctx.setLineDash([6 / z, 4 / z]);
  ctx.beginPath(); ctx.ellipse(sx, sy, view.powerR * TW / Math.SQRT2, view.powerR * TH / Math.SQRT2, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
}

// étiquettes lisibles quel que soit le zoom
function drawLabels(labels, z, now) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  // bulles : priorité au centre de l'écran, pas de chevauchement, 7 au plus
  const placed = []; let nSay = 0;
  const cxs = W / 2, cys = H / 2;
  labels.sort((p, q) => (p.kind === 'say') - (q.kind === 'say') || Math.hypot(p.x - cam.x, p.y - cam.y) - Math.hypot(q.x - cam.x, q.y - cam.y));
  for (const l of labels) {
    const sx = (l.x - cam.x) * z + W / 2, sy = (l.y - cam.y) * z + H / 2;
    if (sx < -100 || sx > W + 100 || sy < -40 || sy > H + 40) continue;
    if (l.kind === 'say') {
      ctx.font = '12px system-ui, sans-serif';
      const words = l.text.split(' '); const lines = []; let cur = '';
      for (const w of words) { if (ctx.measureText(cur + ' ' + w).width > 150 && cur) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
      lines.push(cur);
      const w = Math.max(...lines.map((s) => ctx.measureText(s).width)) + 14, h = lines.length * 15 + 8;
      if (nSay >= 7) continue;
      let oy = 0, ok = false;
      for (let k = 0; k < 3 && !ok; k++) { const r = [sx - w / 2, sy - h - 8 - oy, w, h]; ok = !placed.some((p) => r[0] < p[0] + p[2] && r[0] + r[2] > p[0] && r[1] < p[1] + p[3] && r[1] + r[3] > p[1]); if (!ok) oy += h + 4; }
      if (!ok) continue;
      placed.push([sx - w / 2, sy - h - 8 - oy, w, h]); nSay++;
      if (oy) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx, sy - 8 - oy); ctx.lineTo(sx, sy - 4); ctx.stroke(); }
      ctx.save(); ctx.translate(0, -oy);
      ctx.globalAlpha = l.a ?? 1;
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
      roundRect(sx - w / 2, sy - h - 8, w, h, 8); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - 5, sy - 8.5); ctx.lineTo(sx, sy - 2); ctx.lineTo(sx + 5, sy - 8.5); ctx.fill();
      ctx.fillStyle = '#1b1b22'; lines.forEach((s, k) => ctx.fillText(s, sx, sy - h - 8 + 17 + k * 15));
      ctx.globalAlpha = 1; ctx.restore();
    } else if (l.kind === 'icon') { ctx.font = '14px sans-serif'; ctx.fillText(l.text, sx, sy - 2); }
    else if (l.kind === 'tribe') {
      ctx.font = '600 12px system-ui, sans-serif'; const w = ctx.measureText(l.text).width + 14;
      ctx.fillStyle = 'rgba(10,12,24,0.7)'; roundRect(sx - w / 2, sy - 16, w, 18, 9); ctx.fill();
      ctx.fillStyle = l.color; ctx.fillRect(sx - w / 2 + 6, sy - 9, 5, 5);
      ctx.fillStyle = '#fff'; ctx.fillText((l.war ? '⚔ ' : '') + l.text, sx + 3, sy - 3);
    } else {
      ctx.font = l.kind === 'small' ? '10px system-ui' : '600 11px system-ui, sans-serif';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(l.text, sx, sy); ctx.fillStyle = l.color ? '#fff' : '#eee'; ctx.fillText(l.text, sx, sy);
    }
  }
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// ---------- conversions écran ↔ monde ----------
export function screenToWorld(px, py) { return [(px - W / 2) / cam.z + cam.x, (py - H / 2) / cam.z + cam.y]; }
export function screenToTile(px, py) {
  const [wx, wy] = screenToWorld(px, py);
  let lv = GROUND_LVL, x = 0, y = 0;
  for (let k = 0; k < 4; k++) {
    const a = wx / (TW / 2), b = (wy + lv * LH) / (TH / 2);
    x = (a + b) / 2; y = (b - a) / 2;
    lv = inside(Math.floor(x), Math.floor(y)) ? groundLvl(x, y) : GROUND_LVL;
  }
  return [x, y];
}
export function pickBeing(px, py) {
  let best = null, bd = 26;
  for (const b of S.beings) {
    if (!b.alive || b.inside) continue;
    const [wx, wy] = iso(b.x, b.y, groundLvl(b.x, b.y));
    const sx = (wx - cam.x) * cam.z + W / 2, sy = (wy - 8 - cam.y) * cam.z + H / 2;
    const d = Math.hypot(sx - px, sy - py); if (d < bd) { bd = d; best = b; }
  }
  return best;
}
export function focusOn(x, y, zoom = null) { const [wx, wy] = iso(x, y, groundLvl(x, y)); cam.tx = wx; cam.ty = wy; if (zoom) cam.tz = zoom; }
export function clampCam() {
  cam.tz = clamp(cam.tz, cam.fit * 0.4, 6);
  cam.tx = clamp(cam.tx, -SPH.r * 1.1, SPH.r * 1.1); cam.ty = clamp(cam.ty, SPH.y - SPH.r * 1.1, SPH.y + SPH.r * 1.1);
}
export function invalidateTerrain() { layerKey = ''; }
