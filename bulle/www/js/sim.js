// ===== ORCHESTRATION : boucle de simulation, objectifs, sauvegarde =====
import { N, R, CX, CY, T, MAX_STEP, HOURS_PER_YEAR } from './config.js';
import { S, freshWorldState, worldStep, randomLand, nearWater, idx, walkable, timeInfo, isNight, ignite } from './world.js';
import { Grid, range, chance, dist, rnd, pick } from './util.js';
import { createBeing, beingStep, housing, mem, byId } from './beings.js';
import { animalsStep, seedAnimals, fearDaily } from './animals.js';
import { makeTribe, tribesDaily, checkConquest, log, addRel, tribeById, has, removeBuilding, addKnowledge } from './society.js';
import { godStep } from './god.js';

export const OBJECTIVES = [
  { id: 'birth', text: 'Une première naissance dans la bulle', test: () => S.stats.births > 0 },
  { id: 'fire', text: 'Maîtriser le feu', test: () => anyTech('feu') },
  { id: 'wall', text: 'Toucher la Paroi du monde', test: () => !!S.flags.firstWall },
  { id: 'pop30', text: 'Atteindre 30 êtres vivants', test: () => alive() >= 30 },
  { id: 'village', text: 'Bâtir un village de 5 habitations', test: () => S.tribes.some((t) => t.alive && S.buildings.filter((b) => b.tribeId === t.id && b.done && (b.type === 'hutte' || b.type === 'maison')).length >= 5) },
  { id: 'agri', text: 'Inventer l’agriculture', test: () => anyTech('agriculture') },
  { id: 'ecriture', text: 'Inventer l’écriture', test: () => anyTech('ecriture') },
  { id: 'pop80', text: 'Une civilisation de 80 êtres', test: () => alive() >= 80 },
  { id: 'bulle', text: 'Qu’ils comprennent qu’ils vivent dans une bulle', test: () => anyTech('bulle') },
  { id: 'passage', text: 'Construire Le Passage et briser la Paroi', test: () => !!S.victory },
];
const anyTech = (t) => S.tribes.some((tr) => tr.tech[t]);
const alive = () => S.beings.length;

export function newGame(seed = Math.floor(Math.random() * 1e9)) {
  freshWorldState(seed);
  S.startTime = S.time;
  S.dead = new Map();
  S.gridB = new Grid(N, 6); S.gridA = new Grid(N, 6); S.beingMap = new Map();
  // deux peuples fondateurs, loin l'un de l'autre, près de l'eau
  const spots = [];
  for (let k = 0; k < 600 && spots.length < 2; k++) {
    const [x, y] = randomLand(CX, CY, R - 6);
    const xi = Math.floor(x), yi = Math.floor(y);
    if (S.tiles.type[idx(xi, yi)] !== T.GRASS) continue;
    let w = false; for (let dy = -4; dy <= 4 && !w; dy++) for (let dx = -4; dx <= 4; dx++) if (nearWater(xi + dx, yi + dy)) { w = true; break; }
    if (!w) continue;
    if (spots.length && dist(x, y, spots[0][0], spots[0][1]) < 26) continue;
    spots.push([xi, yi]);
  }
  while (spots.length < 2) { const [x, y] = randomLand(); spots.push([Math.floor(x), Math.floor(y)]); }
  for (const [sx, sy] of spots) {
    const tr = makeTribe(sx, sy);
    const group = [];
    for (let k = 0; k < 9; k++) {
      const [x, y] = randomLand(sx + 0.5, sy + 0.5, 3);
      group.push(createBeing({ x, y, sex: k % 2 ? 'M' : 'F', age: k === 8 ? range(45, 55) : range(16, 30), tribeId: tr.id }));
    }
    // trois couples déjà formés
    for (let k = 0; k < 6; k += 2) { const a = group[k], b = group[k + 1]; a.orient = b.orient = 'hetero'; a.partner = b.id; b.partner = a.id; addRel(a, b, 70); addRel(b, a, 70); }
    for (const a of group) for (const b of group) if (a !== b) addRel(a, b, range(5, 30));
    for (const a of group) mem(a, 'Je me suis éveillé dans ce monde avec les miens. Je ne me souviens de rien d’avant.');
  }
  seedAnimals();
  log('🫧 Une nouvelle bulle s’éveille. Deux peuples ouvrent les yeux.', 'major', true);
  rebuildIndex();
}

function rebuildIndex() {
  S.gridB.clear(); S.gridA.clear(); S.beingMap.clear(); (S.animalMap ||= new Map()).clear();
  for (const b of S.beings) if (b.alive) { S.gridB.add(b); S.beingMap.set(b.id, b); }
  for (const a of S.animals) { S.animalMap.set(a.id, a); if (a.alive) S.gridA.add(a); }
  for (const t of S.tribes) t.members = [];
  for (const b of S.beings) if (b.alive) { const t = tribeById(b.tribeId); if (t) t.members.push(b); }
}

let dayMark = -1;
export function simStep(dt) {
  rebuildIndex();
  worldStep(dt);
  for (const b of S.beings) if (b.alive) beingStep(b, dt);
  S.beings = S.beings.filter((b) => b.alive);
  animalsStep(dt);
  godStep(dt);
  // projectiles (balistique : gravité 9.8 m/s² en unités de jeu)
  for (const p of S.projectiles) { p.t += dt * 10; p.x += p.vx * dt * 10 * 0.1; p.y += p.vy * dt * 10 * 0.1; p.vz -= 9.8 * dt; p.z += p.vz * dt * 10 * 0.1; }
  S.projectiles = S.projectiles.filter((p) => p.z > 0 && p.t < 1.5);
  for (const e of S.effects) if (e.kind === 'corpse' || e.kind === 'carcass') e.t -= dt;
  // destruction des bâtiments
  for (const b of [...S.buildings]) if (b.hp <= 0) { if (b.type !== 'tombe') log(`💥 ${b.type === 'passage' ? 'Le Passage' : 'Un bâtiment'} a été détruit.`, 'info', false, [b.x, b.y]); removeBuilding(b); }
  // éclairs naturels
  while (S.events.length) {
    const ev = S.events.shift();
    if (ev.kind === 'lightning') {
      const [x, y] = randomLand(); S.effects.push({ kind: 'bolt', x, y, t: 0.5 }); S.flash = 0.8;
      const i = idx(Math.floor(x), Math.floor(y)); if (S.tiles.tree[i] > 0.3 && chance(0.5)) ignite(Math.floor(x), Math.floor(y), 1);
      // l'observation du feu né de la foudre fait avancer la découverte du feu
      for (const b of S.gridB.near(x, y, 10)) { const tr = tribeById(b.tribeId); if (tr && !tr.tech.feu) addKnowledge(tr, 6, b); b.emo.fear += 15; b.faith = Math.min(1, b.faith + 0.03); }
    }
  }
  // quotidien
  const day = Math.floor(S.time / 24);
  if (day !== dayMark) { dayMark = day; daily(); }
  // statistiques & objectifs
  S.stats.maxPop = Math.max(S.stats.maxPop, S.beings.length);
  for (const o of OBJECTIVES) if (!S.objectives[o.id] && o.test()) { S.objectives[o.id] = S.time; log(`🏆 Objectif atteint : ${o.text}`, 'goal', true); (S.sfx ||= []).push('chime'); }
  if (!S.beings.length && !S.extinct && !S.victory) { S.extinct = S.time; log('☠️ Il ne reste plus personne dans la bulle.', 'death', true); }
}

function daily() {
  fearDaily();
  // historique pour les graphiques
  S.history ||= [];
  const sp = { deer: 0, rabbit: 0, wolf: 0, boar: 0, bear: 0 }; for (const a of S.animals) if (a.alive) sp[a.sp] = (sp[a.sp] || 0) + 1;
  S.history.push({ t: S.time, pop: S.beings.length, births: S.stats.births, deaths: S.stats.deaths, tribes: Object.fromEntries(S.tribes.filter((t) => t.alive).map((t) => [t.id, t.members.length])), sp, food: Math.round(S.tribes.reduce((a, t) => a + (t.alive ? t.stock.food : 0), 0)), know: S.tribes.reduce((a, t) => Math.max(a, Object.keys(t.tech).length), 0) });
  if (S.history.length > 4000) S.history = S.history.filter((_, i) => i % 2 === 0);
  rebuildIndex();
  tribesDaily();
  checkConquest();
  for (const tr of S.tribes) if (tr.alive) {
    housing(tr);
    // la connaissance collective nourrit la conscience de la bulle
    for (const b of tr.members) {
      if (has(tr, 'astronomie')) b.aware = Math.min(1, b.aware + 0.01);
      if (has(tr, 'cartographie')) b.aware = Math.min(1, b.aware + 0.008);
      if (has(tr, 'bulle')) { b.aware = Math.max(b.aware, 0.6); if (!b.wantLeave && b.age > 14 && chance(0.05 + b.genes.cur * 0.08)) b.wantLeave = true; }
      b.faith = Math.max(0.03 + b.genes.spi * 0.1, b.faith - 0.004 * (1 - b.genes.spi)); // la foi s'étiole sans signe divin
    }
    // orphelins de tribu
  }
  for (const b of S.beings) if (!tribeById(b.tribeId)?.alive) {
    const t = S.tribes.filter((x) => x.alive).sort((p, q) => dist(p.cx, p.cy, b.x, b.y) - dist(q.cx, q.cy, b.x, b.y))[0];
    if (t) { b.tribeId = t.id; mem(b, `J’ai rejoint ${t.name}.`); } else if (b.age > 14) { const nt = makeTribe(Math.floor(b.x), Math.floor(b.y)); b.tribeId = nt.id; }
  }
}

// avance la simulation de `hours` heures en pas fixes
export function advance(hours) {
  let left = hours, n = 0;
  while (left > 1e-6 && n < 10) { const dt = Math.min(MAX_STEP, left); simStep(dt); left -= dt; n++; }
}

// ===== sauvegarde =====
const KEY = 'labulle-save-v1';
const TILE_KEYS = ['h', 'type', 'lvl', 'moist', 'wet', 'fert', 'tree', 'treeKind', 'bush', 'berries', 'stone', 'fish', 'fire', 'ash', 'farm', 'crop', 'bld', 'noise'];
export function save() {
  try {
    const tiles = {};
    for (const k of TILE_KEYS) tiles[k] = Array.from(S.tiles[k], (v) => (Number.isInteger(v) ? v : Math.round(v * 1000) / 1000));
    const data = {
      v: 1, seed: S.seed, time: S.time, startTime: S.startTime, realTime: S.realTime, tiles,
      beings: S.beings.map((b) => ({ ...b, say: null, act: null, _last: null, path: null })), animals: S.animals.filter((a) => a.alive), tribes: S.tribes.map((t) => ({ ...t, members: [] })),
      buildings: S.buildings, log: S.log.slice(-200), nextId: S.nextId, weather: S.weather, climate: S.climate, snowCover: S.snowCover,
      fires: [...S.fires], god: S.god, stats: S.stats, objectives: S.objectives, victory: S.victory, extinct: S.extinct, flags: S.flags,
      dead: [...S.dead.entries()].slice(-600), history: S.history || [], fearMap: S.fearMap ? Array.from(S.fearMap, (v) => Math.round(v * 100) / 100) : null, groupState: S.groupState || {},
    };
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) { console.warn('save failed', e); return false; }
}
export function hasSave() { try { return !!localStorage.getItem(KEY); } catch { return false; } }
export function load() {
  let data; try { data = JSON.parse(localStorage.getItem(KEY)); } catch { return false; }
  if (!data || data.v !== 1) return false;
  freshWorldState(data.seed);
  const t = S.tiles;
  for (const k of TILE_KEYS) if (data.tiles[k]) t[k].set(data.tiles[k]);
  Object.assign(S, {
    time: data.time, startTime: data.startTime ?? data.time, realTime: data.realTime || 0, beings: data.beings, animals: data.animals, tribes: data.tribes, buildings: data.buildings,
    log: data.log, nextId: data.nextId, weather: data.weather, climate: data.climate, snowCover: data.snowCover, fires: new Set(data.fires),
    god: data.god, stats: data.stats, objectives: data.objectives, victory: data.victory, extinct: data.extinct, flags: data.flags || {},
    dead: new Map(data.dead || []), dirtyTerrain: true, history: data.history || [], fearMap: data.fearMap ? Float32Array.from(data.fearMap) : null, groupState: data.groupState || {},
  });
  S.bmap = new Map(S.buildings.map((b) => [b.id, b]));
  S.gridB = new Grid(N, 6); S.gridA = new Grid(N, 6); S.beingMap = new Map();
  for (const b of S.beings) { b.say = null; b.act = null; b.path = null; }
  rebuildIndex();
  return true;
}
export function clearSave() { try { localStorage.removeItem(KEY); } catch { } }
