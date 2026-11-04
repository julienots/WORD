// ===== LE MONDE : terrain, climat, météo, végétation, feu =====
import { N, R, CX, CY, MAXLVL, WATER_H, WATER_LVL, T, DAYS_PER_SEASON, DAYS_PER_YEAR } from './config.js';
import { makeNoise, clamp, lerp, smooth, rnd, chance, range, pick, irange } from './util.js';

export const S = { ready: false }; // état global de la simulation (sérialisable)

export const idx = (x, y) => y * N + x;
export const inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N;

function newTiles() {
  const n = N * N;
  return {
    h: new Float32Array(n), type: new Uint8Array(n), lvl: new Uint8Array(n),
    moist: new Float32Array(n), wet: new Float32Array(n), fert: new Float32Array(n),
    tree: new Float32Array(n), treeKind: new Uint8Array(n), // 0 chêne, 1 pin, 2 bouleau
    bush: new Uint8Array(n), berries: new Float32Array(n),
    stone: new Float32Array(n), fish: new Float32Array(n),
    fire: new Float32Array(n), ash: new Float32Array(n),
    farm: new Int32Array(n).fill(-1), crop: new Float32Array(n),
    bld: new Int32Array(n).fill(-1), noise: new Float32Array(n),
  };
}

export function generateTerrain(seed) {
  const t = newTiles();
  S.forestNoise = makeNoise(seed * 13 + 3);
  const fh = makeNoise(seed), fm = makeNoise(seed * 3 + 11), fr = makeNoise(seed * 7 + 5);
  const raw = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = idx(x, y), d = Math.hypot(x + 0.5 - CX, y + 0.5 - CY) / R;
    t.noise[i] = rnd();
    if (d > 1) { t.type[i] = T.VOID; continue; }
    const ridge = 1 - Math.abs(fr(x * 0.045, y * 0.045, 4) * 2 - 1);
    t.h[i] = fh(x * 0.05 + 3, y * 0.05 + 7, 5) * 0.8 + ridge ** 3 * 0.35;
    t.type[i] = T.GRASS; raw.push(i);
    t.moist[i] = fm(x * 0.07, y * 0.07, 4);
  }
  // répartition des altitudes par rangs : lacs, plaines, collines, quelques sommets
  raw.sort((a, b) => t.h[a] - t.h[b]);
  const CP = [[0, 0.16], [0.13, 0.355], [0.17, 0.392], [0.68, 0.6], [0.86, 0.72], [0.95, 0.83], [1, 0.95]];
  raw.forEach((i, k) => {
    const r = k / (raw.length - 1); let j = 0; while (j < CP.length - 2 && r > CP[j + 1][0]) j++;
    const [r0, h0] = CP[j], [r1, h1] = CP[j + 1];
    const x = i % N, y = (i / N) | 0, d = Math.hypot(x + 0.5 - CX, y + 0.5 - CY) / R;
    t.h[i] = lerp(lerp(h0, h1, (r - r0) / (r1 - r0)), 0.45, smooth(0.82, 1.0, d)); // bordure en prairie douce
  });
  // humidité accrue près de l'eau
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = idx(x, y); if (t.type[i] === T.VOID) continue;
    let near = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const xx = x + dx, yy = y + dy; if (!inside(xx, yy)) continue;
      const j = idx(xx, yy); if (t.type[j] !== T.VOID && t.h[j] < WATER_H) near = Math.max(near, 1 - Math.hypot(dx, dy) / 5.7);
    }
    t.moist[i] = clamp(t.moist[i] * 0.75 + near * 0.45);
  }
  for (let i = 0; i < N * N; i++) classify(t, i, true);
  S.tiles = t;
  return t;
}

export function classify(t, i, init = false) {
  if (t.type[i] === T.VOID) return;
  const h = t.h[i];
  t.lvl[i] = Math.round(clamp(h) * MAXLVL);
  let ty;
  if (h < WATER_H - 0.07) ty = T.DEEP; else if (h < WATER_H) ty = T.WATER;
  else if (h < WATER_H + 0.035) ty = T.SAND; else if (h < 0.62) ty = T.GRASS;
  else if (h < 0.74) ty = T.HILL; else if (h < 0.86) ty = T.ROCK; else ty = T.SNOW;
  t.type[i] = ty;
  const m = t.moist[i];
  t.fert[i] = ty === T.GRASS ? clamp(0.3 + m * 0.8) : ty === T.HILL ? 0.3 : 0;
  if (ty <= T.WATER) { t.tree[i] = 0; t.bush[i] = 0; t.berries[i] = 0; t.fish[i] = init ? range(2, 8) : t.fish[i]; t.stone[i] = 0; }
  if (!init) return;
  const forest = S.forestNoise ? S.forestNoise(i % N * 0.09, ((i / N) | 0) * 0.09, 3) : 0.5;
  if ((ty === T.GRASS || ty === T.HILL) && (rnd() < (forest - 0.5) * 2.4 + (m - 0.5) * 0.8 || rnd() < 0.04)) {
    t.tree[i] = range(0.35, 1);
    t.treeKind[i] = ty === T.HILL || rnd() < (h - 0.45) * 2.5 ? 1 : rnd() < 0.2 ? 2 : 0;
  } else if (ty === T.GRASS && rnd() < 0.09 + m * 0.1) { t.bush[i] = 1; t.berries[i] = irange(1, 5); }
  if (ty === T.ROCK || ty === T.SNOW) t.stone[i] = range(20, 60);
  else if ((ty === T.GRASS || ty === T.HILL || ty === T.SAND) && rnd() < 0.035) t.stone[i] = range(4, 14);
}

// === requêtes terrain ===
export function walkable(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  if (!inside(xi, yi)) return false;
  const i = idx(xi, yi), ty = S.tiles.type[i];
  if (ty === T.VOID || ty === T.DEEP || ty === T.WATER) return false;
  if (Math.hypot(x - CX, y - CY) > R - 0.6) return false; // la paroi
  const b = S.tiles.bld[i]; if (b >= 0) { const B = S.bmap.get(b); if (B && B.solid && B.done) return false; }
  return true;
}
export function isWater(xi, yi) { if (!inside(xi, yi)) return false; const ty = S.tiles.type[idx(xi, yi)]; return ty === T.WATER || ty === T.DEEP; }
export function groundLvl(x, y) {
  const xi = clamp(Math.floor(x), 0, N - 1), yi = clamp(Math.floor(y), 0, N - 1), i = idx(xi, yi);
  const ty = S.tiles.type[i]; if (ty === T.WATER || ty === T.DEEP) return WATER_LVL;
  return S.tiles.lvl[i];
}
export function terrainCost(x, y) {
  const i = idx(Math.floor(x), Math.floor(y)), t = S.tiles;
  let c = 1; const ty = t.type[i];
  if (ty === T.SAND) c = 1.15; else if (ty === T.HILL) c = 1.3; else if (ty === T.ROCK) c = 1.7; else if (ty === T.SNOW) c = 2.2;
  if (t.tree[i] > 0.3) c += 0.35; if (S.snowCover > 0.4) c += 0.3;
  return c;
}

// === temps & climat ===
export const timeInfo = (t = S.time) => {
  const day = Math.floor(t / 24), hour = t % 24;
  return { day, hour, season: Math.floor(day / DAYS_PER_SEASON) % 4, dayOfSeason: day % DAYS_PER_SEASON, year: Math.floor(day / DAYS_PER_YEAR) + 1, yearFrac: (day % DAYS_PER_YEAR + hour / 24) / DAYS_PER_YEAR };
};
// lumière du soleil intérieur (0 nuit, 1 plein jour)
export function daylight(t = S.time) { const h = t % 24; return clamp(Math.sin(((h - 6) / 12) * Math.PI) * 1.4 + 0.15); }
export const isNight = () => { const h = S.time % 24; return h < 5.5 || h > 20.5; };
export function baseTemp(t = S.time) {
  const { yearFrac, hour } = timeInfo(t);
  const seasonal = 13 + 14 * Math.sin((yearFrac - 0.125) * Math.PI * 2); // ~ -1 °C cœur de l'hiver .. 27 °C cœur de l'été
  const diurnal = 5 * Math.sin(((hour - 9) / 24) * Math.PI * 2);
  let tmp = seasonal + diurnal + S.climate.tempMod;
  if (S.weather.type === 'pluie' || S.weather.type === 'orage') tmp -= 3;
  if (S.weather.type === 'canicule') tmp += 9;
  return tmp;
}
export function tempAt(x, y) { const lv = S.tiles.lvl[idx(clamp(Math.floor(x), 0, N - 1), clamp(Math.floor(y), 0, N - 1))]; return baseTemp() - Math.max(0, lv - 8) * 1.6; }

// === météo ===
const WEATHER = {
  clair: { icon: '☀️', label: 'Ciel clair' }, nuageux: { icon: '☁️', label: 'Nuageux' }, pluie: { icon: '🌧️', label: 'Pluie' },
  orage: { icon: '⛈️', label: 'Orage' }, neige: { icon: '🌨️', label: 'Neige' }, canicule: { icon: '🔥', label: 'Canicule' }, brume: { icon: '🌫️', label: 'Brume' },
};
export const weatherInfo = () => WEATHER[S.weather.type] || WEATHER.clair;
export function setWeather(type, hours, forced = false) { S.weather.type = type; S.weather.left = hours; S.weather.forced = forced; }

function weatherStep() {
  const w = S.weather; w.left -= 1;
  if (w.left > 0) return;
  w.forced = false;
  const { season } = timeInfo(); const temp = baseTemp();
  const table = [
    { clair: 4, nuageux: 3, pluie: 3, orage: 0.6, brume: 1 },
    { clair: 7, nuageux: 2, pluie: 1, orage: 1.2, canicule: 0.4 },
    { clair: 3, nuageux: 4, pluie: 3, orage: 0.5, brume: 2 },
    { clair: 4, nuageux: 4, pluie: 1, neige: 3, brume: 1 },
  ][season];
  const tot = Object.values(table).reduce((a, b) => a + b, 0);
  let r = rnd() * tot, choice = 'clair';
  for (const [k, v] of Object.entries(table)) { r -= v; if (r <= 0) { choice = k; break; } }
  if (choice === 'neige' && temp > 2) choice = 'pluie';
  if (choice === 'pluie' && temp < -1) choice = 'neige';
  w.type = choice; w.left = irange(3, 14);
  w.wind = { x: range(-1, 1), y: range(-1, 1) };
}

// === végétation (traitée par tranches) ===
function vegSlice(slice, slices) {
  const t = S.tiles, { season } = timeInfo(), wetG = S.climate.wetness;
  if (slice === 0) { let n = 0, land = 0; for (let i = 0; i < N * N; i++) { if (t.type[i] > T.WATER) { land++; if (t.tree[i] > 0) n++; } } S.treeFrac = n / Math.max(1, land); }
  const grow = [1.5, 1.0, 0.35, 0.0][season];
  for (let i = slice; i < N * N; i += slices) {
    const ty = t.type[i]; if (ty === T.VOID) continue;
    t.wet[i] *= 0.6;
    const m = clamp(t.moist[i] * 0.7 + wetG * 0.35 + t.wet[i] * 0.5 - S.climate.drought * 0.5);
    if (ty <= T.WATER) { t.fish[i] = Math.min(10, t.fish[i] + 0.4 * grow + 0.05); continue; }
    if (t.ash[i] > 0) t.ash[i] = Math.max(0, t.ash[i] - 0.06);
    if (t.fire[i] > 0) continue;
    // arbres
    if (t.tree[i] > 0) {
      if (m < 0.18 && S.climate.drought > 0.5 && chance(0.05)) t.tree[i] *= 0.7; // sécheresse
      t.tree[i] = Math.min(1, t.tree[i] + 0.018 * grow * (0.4 + m));
    } else if ((ty === T.GRASS || ty === T.HILL) && t.bld[i] < 0 && t.farm[i] < 0 && grow > 0.3 && m > 0.45) {
      const x = i % N, y = (i / N) | 0; let nb = 0;
      for (let d = 0; d < 8; d++) { const xx = x + [1, -1, 0, 0, 1, 1, -1, -1][d], yy = y + [0, 0, 1, -1, 1, -1, 1, -1][d]; if (inside(xx, yy) && t.tree[idx(xx, yy)] > 0.5) nb++; }
      if (nb >= 3 && S.treeFrac < 0.3 && chance(0.0012 * nb)) { t.tree[i] = 0.05; t.treeKind[i] = ty === T.HILL ? 1 : chance(0.15) ? 2 : 0; S.dirtyTerrain = true; }
    }
    // baies
    if (t.bush[i]) {
      if (season === 3) t.berries[i] *= 0.6;
      else t.berries[i] = Math.min(6, t.berries[i] + 1.25 * grow * (0.5 + m));
    } else if (ty === T.GRASS && t.tree[i] === 0 && t.bld[i] < 0 && t.farm[i] < 0 && grow > 0.9 && m > 0.4 && chance(0.0015)) t.bush[i] = 1;
    // cultures
    if (t.farm[i] >= 0 && t.crop[i] > 0) {
      if (season === 3) { if (t.crop[i] < 1) t.crop[i] = 0; }
      else if (t.crop[i] < 1) t.crop[i] = Math.min(1, t.crop[i] + 0.11 * grow * (0.4 + m) * (0.6 + t.fert[i] * 0.6));
    }
  }
}

// === feu ===
export function ignite(x, y, power = 1) {
  if (!inside(x, y)) return; const i = idx(x, y), t = S.tiles;
  if (t.type[i] <= T.WATER || t.type[i] === T.VOID) return;
  if (t.fire[i] <= 0) { t.fire[i] = 2 + power * 3; S.fires.add(i); }
}
function fireStep(dt) {
  const t = S.tiles; const raining = S.weather.type === 'pluie' || S.weather.type === 'orage' || S.weather.type === 'neige';
  for (const i of [...S.fires]) {
    const x = i % N, y = (i / N) | 0;
    t.fire[i] -= dt * (raining ? 3 : 1) + t.wet[i] * dt * 4;
    if (t.tree[i] > 0) t.tree[i] = Math.max(0, t.tree[i] - dt * 0.25);
    if (t.bush[i]) { t.berries[i] = 0; if (chance(dt * 0.3)) t.bush[i] = 0; }
    if (t.farm[i] >= 0) t.crop[i] = 0;
    t.ash[i] = 1;
    const b = t.bld[i]; if (b >= 0) { const B = S.bmap.get(b); if (B && B.type !== 'feu') B.hp -= dt * 25; }
    // propagation (vent, sécheresse, combustible)
    const dry = clamp(1 - (t.moist[i] * 0.6 + S.climate.wetness * 0.6 + t.wet[i]) + S.climate.drought * 0.5 + (S.weather.type === 'canicule' ? 0.3 : 0));
    for (let d = 0; d < 4; d++) {
      const dx = [1, -1, 0, 0][d], dy = [0, 0, 1, -1][d], xx = x + dx, yy = y + dy;
      if (!inside(xx, yy)) continue; const j = idx(xx, yy);
      if (t.fire[j] > 0) continue;
      const fuel = t.tree[j] + (t.bush[j] ? 0.3 : 0) + (t.bld[j] >= 0 ? 0.5 : 0) + (t.type[j] === T.GRASS ? 0.08 : 0);
      const wind = 1 + (dx * S.weather.wind.x + dy * S.weather.wind.y) * 0.8;
      if (fuel > 0.05 && !raining && chance(dt * 0.35 * fuel * dry * wind)) ignite(xx, yy, fuel);
    }
    if (t.fire[i] <= 0 || (t.tree[i] <= 0 && !t.bush[i] && t.bld[i] < 0 && t.fire[i] < 1.5 && chance(0.5))) { t.fire[i] = 0; S.fires.delete(i); S.dirtyTerrain = true; }
  }
}

// === modification du relief (pouvoir divin) ===
export function sculpt(cx, cy, r, amount) {
  const t = S.tiles;
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    if (!inside(x, y)) continue; const i = idx(x, y); if (t.type[i] === T.VOID) continue;
    const d = Math.hypot(x - cx, y - cy) / r; if (d > 1) continue;
    const before = t.type[i];
    t.h[i] = clamp(t.h[i] + amount * (1 - d * d), 0.05, 1);
    if (Math.hypot(x + 0.5 - CX, y + 0.5 - CY) > R - 1.5) t.h[i] = Math.max(t.h[i], WATER_H + 0.04);
    classify(t, i);
    if (before > T.WATER && t.type[i] <= T.WATER) { t.fish[i] = 1; const b = t.bld[i]; if (b >= 0) { const B = S.bmap.get(b); if (B) B.hp = -1; } }
    if (t.type[i] > T.WATER && before <= T.WATER) t.moist[i] = Math.max(t.moist[i], 0.7);
  }
  S.dirtyTerrain = true; S.terrainVersion++;
}

// === boucle du monde ===
let hourAcc = 0, vegI = 0;
export function worldStep(dt) {
  S.time += dt;
  hourAcc += dt;
  fireStep(dt);
  // humidité globale & neige
  const w = S.weather.type, temp = baseTemp();
  const wetTarget = w === 'pluie' ? 0.9 : w === 'orage' ? 1 : w === 'neige' ? 0.6 : w === 'brume' ? 0.55 : w === 'canicule' ? 0 : 0.35;
  S.climate.wetness = lerp(S.climate.wetness, wetTarget, clamp(dt * 0.05));
  if (w === 'neige' && temp < 1) S.snowCover = Math.min(1, S.snowCover + dt * 0.06);
  else if (temp > 2) S.snowCover = Math.max(0, S.snowCover - dt * 0.03 * (temp - 1));
  // modificateurs divins qui s'estompent
  S.climate.tempMod *= Math.pow(0.985, dt);
  if (Math.abs(S.climate.tempMod) < 0.1) S.climate.tempMod = 0;
  S.climate.drought = Math.max(0, S.climate.drought - dt * 0.01);
  while (hourAcc >= 1) {
    hourAcc -= 1;
    weatherStep();
    vegSlice(vegI, 24); vegI = (vegI + 1) % 24;
    // foudre naturelle pendant les orages
    if (S.weather.type === 'orage' && chance(0.12)) S.events.push({ kind: 'lightning', natural: true });
  }
}

export function freshWorldState(seed) {
  Object.assign(S, {
    ready: true, seed, time: 6 + 24 * 2, realTime: 0,
    beings: [], animals: [], tribes: [], buildings: [], bmap: new Map(), log: [], nextId: 1,
    weather: { type: 'clair', left: 8, wind: { x: 0.4, y: 0.2 }, forced: false },
    climate: { tempMod: 0, drought: 0, wetness: 0.4 }, snowCover: 0,
    fires: new Set(), events: [], projectiles: [], effects: [],
    god: { energy: 60, max: 100, unlimited: false },
    stats: { births: 0, deaths: 0, wars: 0, maxPop: 0, causes: {} },
    objectives: {}, victory: null, extinct: false, dirtyTerrain: true, terrainVersion: 0,
    history: [], fearMap: null, groupState: {},
    flags: {},
  });
  generateTerrain(seed);
}

// recherche en spirale (tuile la plus proche satisfaisant un prédicat)
export function spiral(x0, y0, maxR, pred) {
  const cx = Math.floor(x0), cy = Math.floor(y0);
  if (inside(cx, cy) && pred(cx, cy, idx(cx, cy))) return [cx, cy];
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = 1e9;
    for (let k = -r; k <= r; k++) {
      const cand = [[cx + k, cy - r], [cx + k, cy + r], [cx - r, cy + k], [cx + r, cy + k]];
      for (const [x, y] of cand) {
        if (!inside(x, y)) continue;
        if (pred(x, y, idx(x, y))) { const d = Math.hypot(x - x0, y - y0); if (d < bd) { bd = d; best = [x, y]; } }
      }
    }
    if (best) return best;
  }
  return null;
}
// tous les points où l'on peut boire (recalculés quand le relief change)
let drinkVer = -1, drinkList = [];
export function nearestDrink(x0, y0) {
  if (drinkVer !== S.terrainVersion || !drinkList.length) {
    drinkVer = S.terrainVersion; drinkList = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (walkable(x + 0.5, y + 0.5) && nearWater(x, y)) drinkList.push([x + 0.5, y + 0.5]);
  }
  let best = null, bd = 1e9;
  for (const p of drinkList) { const d = (p[0] - x0) ** 2 + (p[1] - y0) ** 2; if (d < bd) { bd = d; best = p; } }
  return best;
}
export function nearWater(x, y) {
  for (let d = 0; d < 8; d++) if (isWater(x + [1, -1, 0, 0, 1, 1, -1, -1][d], y + [0, 0, 1, -1, 1, -1, 1, -1][d])) return true;
  return false;
}
export function randomLand(nearX = CX, nearY = CY, rad = R) {
  for (let k = 0; k < 400; k++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * rad;
    const x = nearX + Math.cos(a) * r, y = nearY + Math.sin(a) * r;
    if (walkable(x, y)) return [x, y];
  }
  return [CX, CY];
}

// A* limité pour se sortir des impasses
export function findPath(sx, sy, tx, ty, maxNodes = 2500) {
  sx = Math.floor(sx); sy = Math.floor(sy); tx = Math.floor(tx); ty = Math.floor(ty);
  if (!inside(tx, ty)) return null;
  const open = [[sx, sy, 0, Math.hypot(tx - sx, ty - sy)]], came = new Map(), g = new Map();
  const key = (x, y) => y * N + x; g.set(key(sx, sy), 0);
  let n = 0, best = null, bestH = 1e9;
  while (open.length && n++ < maxNodes) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][2] + open[i][3] < open[bi][2] + open[bi][3]) bi = i;
    const [x, y, gc, h] = open.splice(bi, 1)[0];
    if (h < bestH) { bestH = h; best = [x, y]; }
    if (Math.abs(x - tx) <= 1 && Math.abs(y - ty) <= 1) { best = [x, y]; break; }
    for (let d = 0; d < 8; d++) {
      const dx = [1, -1, 0, 0, 1, 1, -1, -1][d], dy = [0, 0, 1, -1, 1, -1, 1, -1][d], xx = x + dx, yy = y + dy;
      if (!walkable(xx + 0.5, yy + 0.5)) continue;
      if (dx && dy && (!walkable(x + dx + 0.5, y + 0.5) || !walkable(x + 0.5, y + dy + 0.5))) continue;
      const ng = gc + (dx && dy ? 1.414 : 1) * terrainCost(xx, yy), k = key(xx, yy);
      if (g.has(k) && g.get(k) <= ng) continue;
      g.set(k, ng); came.set(k, key(x, y)); open.push([xx, yy, ng, Math.hypot(tx - xx, ty - yy)]);
    }
  }
  if (!best) return null;
  const path = []; let k = key(best[0], best[1]); const start = key(sx, sy);
  while (k !== undefined && k !== start) { path.push([k % N + 0.5, Math.floor(k / N) + 0.5]); k = came.get(k); }
  return path.reverse();
}
