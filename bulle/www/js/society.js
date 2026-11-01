// ===== SOCIÉTÉ : tribus, savoirs, bâtiments, diplomatie, guerres =====
import { N, R, CX, CY, T } from './config.js';
import { S, idx, inside, walkable, spiral, timeInfo, nearWater, randomLand } from './world.js';
import { rnd, chance, pick, clamp, dist, range } from './util.js';
import { makeTribeName, TRIBE_COLORS } from './names.js';

export const TECHS = {
  feu: { name: 'Le feu', icon: '🔥', cost: 40, pre: [], desc: 'Chaleur, cuisson des aliments, lumière la nuit.' },
  outils: { name: 'Outils de pierre', icon: '🪓', cost: 50, pre: [], desc: 'Cueillette, coupe du bois et taille de pierre plus efficaces.' },
  langage: { name: 'Langage', icon: '🗣️', cost: 60, pre: [], desc: 'Les conversations transmettent davantage de savoir.' },
  chasse: { name: 'Chasse à la lance', icon: '🏹', cost: 110, pre: ['outils'], desc: 'Chasser cerfs et lapins, se défendre des loups.' },
  abri: { name: 'Huttes', icon: '🛖', cost: 120, pre: ['outils'], desc: 'Construire des huttes : sommeil, chaleur, foyer.' },
  poterie: { name: 'Poterie', icon: '🏺', cost: 220, pre: ['feu'], desc: 'Greniers : la nourriture se conserve.' },
  spiritualite: { name: 'Spiritualité', icon: '🕯️', cost: 180, pre: ['langage'], desc: 'Temples, prières, sépultures. Ta puissance grandit.' },
  vetements: { name: 'Vêtements', icon: '🧥', cost: 240, pre: ['chasse'], desc: 'Résister au froid de l’hiver.' },
  agriculture: { name: 'Agriculture', icon: '🌾', cost: 320, pre: ['outils', 'langage'], desc: 'Champs cultivés et récoltes.' },
  medecine: { name: 'Médecine', icon: '🌿', cost: 380, pre: ['langage', 'feu'], desc: 'Les guérisseurs soignent les malades.' },
  ecriture: { name: 'Écriture', icon: '📜', cost: 700, pre: ['agriculture'], desc: 'Le savoir s’accumule 50 % plus vite.' },
  metal: { name: 'Métallurgie', icon: '⚒️', cost: 900, pre: ['poterie', 'outils'], desc: 'Armes et outils de métal.' },
  philosophie: { name: 'Philosophie', icon: '🤔', cost: 850, pre: ['ecriture', 'spiritualite'], desc: 'Ils se posent des questions sur le sens de leur monde.' },
  astronomie: { name: 'Astronomie', icon: '🔭', cost: 1100, pre: ['ecriture'], desc: 'Ils étudient le soleil captif et remarquent qu’il tourne autour d’eux.' },
  cartographie: { name: 'Cartographie', icon: '🗺️', cost: 1000, pre: ['ecriture'], desc: 'Les explorateurs cartographient la Paroi.' },
  ingenierie: { name: 'Ingénierie', icon: '🏛️', cost: 1500, pre: ['metal', 'ecriture'], desc: 'Maisons de pierre et grands ouvrages.' },
  bulle: { name: 'Théorie de la Bulle', icon: '🫧', cost: 2200, pre: ['astronomie', 'cartographie', 'philosophie'], desc: '« Notre monde est une sphère close. Il existe un dehors. »' },
  passage: { name: 'Le Passage', icon: '🌀', cost: 3000, pre: ['bulle', 'ingenierie'], desc: 'Ils savent comment percer la Paroi. Il faut construire Le Passage.' },
};

export const BLD = {
  feu: { name: 'Foyer', wood: 0, stone: 3, work: 2, solid: false },
  hutte: { name: 'Hutte', wood: 12, stone: 2, work: 9, solid: true, cap: 4 },
  maison: { name: 'Maison de pierre', wood: 8, stone: 22, work: 16, solid: true, cap: 6 },
  grenier: { name: 'Grenier', wood: 16, stone: 6, work: 12, solid: true },
  champ: { name: 'Champ', wood: 1, stone: 0, work: 3, solid: false },
  temple: { name: 'Temple', wood: 16, stone: 36, work: 34, solid: true },
  tombe: { name: 'Sépulture', wood: 0, stone: 0, work: 0, solid: false },
  passage: { name: 'Le Passage', wood: 700, stone: 1000, work: 1400, solid: true },
};

export function log(text, kind = 'info', toast = false, at = null) {
  S.log.push({ t: S.time, text, kind, at });
  if (S.log.length > 400) S.log.shift();
  if (toast) (S.toasts ||= []).push({ text, kind });
}

export function makeTribe(cx, cy, name, color) {
  const used = S.tribes.map((t) => t.name);
  const tr = {
    id: S.nextId++, name: name || makeTribeName(used), color: color || TRIBE_COLORS.find((c) => !S.tribes.some((t) => t.color === c && t.alive)) || pick(TRIBE_COLORS),
    cx, cy, alive: true, founded: S.time, stock: { food: 25, wood: 8, stone: 4 }, tech: {}, knowledge: 0, research: null,
    rel: {}, war: null, leader: null, members: [], dogma: null, faith: 0.1, peaceT: 0,
  };
  S.tribes.push(tr);
  addBuilding('feu', Math.floor(cx), Math.floor(cy), tr, true);
  return tr;
}
export const tribeById = (id) => S.tribes.find((t) => t.id === id);
export const has = (tr, tech) => !!(tr && tr.tech[tech]);

export function addBuilding(type, x, y, tribe, done = false, extra = {}) {
  const d = BLD[type];
  const b = { id: S.nextId++, type, x, y, tribeId: tribe ? tribe.id : null, progress: done ? 1 : 0, done, hp: 100, solid: d.solid, owner: null, built: done ? S.time : null, ...extra };
  S.buildings.push(b); S.bmap.set(b.id, b);
  const i = idx(x, y);
  if (type === 'champ') S.tiles.farm[i] = b.id; else S.tiles.bld[i] = b.id;
  if (type !== 'champ') { S.tiles.tree[i] = 0; S.tiles.bush[i] = 0; }
  return b;
}
export function removeBuilding(b) {
  const i = idx(b.x, b.y);
  if (S.tiles.bld[i] === b.id) S.tiles.bld[i] = -1;
  if (S.tiles.farm[i] === b.id) { S.tiles.farm[i] = -1; S.tiles.crop[i] = 0; }
  S.buildings = S.buildings.filter((o) => o !== b); S.bmap.delete(b.id);
  for (const p of S.beings) if (p.home === b.id) p.home = null;
}

export function addKnowledge(tr, pts, who) {
  if (!tr) return;
  tr.knowledge += pts * 0.3 * (has(tr, 'ecriture') ? 1.5 : 1) * (has(tr, 'langage') ? 1.15 : 1);
  if (!tr.research) tr.research = nextResearch(tr);
  if (tr.research && tr.knowledge >= TECHS[tr.research].cost) {
    const id = tr.research; tr.knowledge -= TECHS[id].cost; tr.tech[id] = S.time;
    const tt = TECHS[id];
    log(`${tt.icon} ${tr.name} découvre : ${tt.name}${who ? ` (grâce à ${who.name})` : ''}.`, 'tech', true, who ? [who.x, who.y] : [tr.cx, tr.cy]);
    if (who) { who.memory.unshift(`J’ai compris ${tt.name.toLowerCase()} !`); who.emo.joy += 25; }
    if (id === 'bulle') log(`🫧 ${tr.name} a compris qu’ils vivent dans une bulle. Beaucoup veulent partir.`, 'major', true);
    tr.research = nextResearch(tr);
  }
}
function nextResearch(tr) {
  const avail = Object.keys(TECHS).filter((k) => !tr.tech[k] && TECHS[k].pre.every((p) => tr.tech[p]));
  if (!avail.length) return null;
  avail.sort((a, b) => TECHS[a].cost - TECHS[b].cost + (rnd() - 0.5) * 30);
  return avail[0];
}

// ===== relations interpersonnelles =====
export function rel(a, b) { return a.rel[b.id] || 0; }
export function addRel(a, b, v) { a.rel[b.id] = clamp((a.rel[b.id] || 0) + v, -100, 100); }

// ===== mise à jour quotidienne des tribus =====
export function tribesDaily() {
  const { season } = timeInfo();
  for (const tr of S.tribes) {
    if (!tr.alive) continue;
    const m = tr.members;
    if (!m.length) { tr.alive = false; log(`☠️ ${tr.name} a disparu.`, 'death', true); if (tr.war) endWar(tr, tribeById(tr.war.target), 'disparition'); continue; }
    // conservation
    tr.stock.food *= has(tr, 'poterie') && S.buildings.some((b) => b.type === 'grenier' && b.tribeId === tr.id && b.done) ? 0.99 : 0.955;
    if (season === 3) tr.stock.wood = Math.max(0, tr.stock.wood - m.length * 0.15 * (has(tr, 'feu') ? 1 : 0));
    // chef
    const adults = m.filter((b) => b.age >= 16);
    if (!tr.leader || !m.some((b) => b.id === tr.leader)) {
      const cand = adults.sort((a, b) => score(b) - score(a))[0];
      if (cand) { tr.leader = cand.id; log(`👑 ${cand.name} devient chef de ${tr.name}.`, 'social'); }
    }
    planBuildings(tr, m);
    // foi moyenne
    tr.faith = m.reduce((s, b) => s + b.faith, 0) / m.length;
    // scission
    if (m.length > 18 && chance(0.04 + (m.length - 18) * 0.01 + (S.tribes.filter((t) => t.alive).length < 2 ? 0.05 : 0))) splitTribe(tr);
  }
  diplomacy();
}
const score = (b) => b.genes.str + b.genes.int + b.genes.soc + b.skills.fight * 0.5 + (b.age > 25 ? 0.3 : 0) - (b.age > 65 ? 0.6 : 0);

function freeSpot(tr, rmin, rmax, pred = null) {
  for (let k = 0; k < 60; k++) {
    const a = rnd() * Math.PI * 2, r = range(rmin, rmax);
    const x = Math.floor(tr.cx + Math.cos(a) * r), y = Math.floor(tr.cy + Math.sin(a) * r);
    if (!inside(x, y)) continue; const i = idx(x, y);
    if (!walkable(x + 0.5, y + 0.5) || S.tiles.bld[i] >= 0 || S.tiles.farm[i] >= 0) continue;
    if (pred && !pred(x, y, i)) continue;
    return [x, y];
  }
  return null;
}
function planBuildings(tr, m) {
  const mine = S.buildings.filter((b) => b.tribeId === tr.id);
  const pending = mine.filter((b) => !b.done && b.type !== 'champ').length;
  if (pending >= 2) return;
  const count = (t) => mine.filter((b) => b.type === t).length;
  const houses = count('hutte') + count('maison');
  const want = (t, x, y) => { const b = addBuilding(t, x, y, tr); return b; };
  if (has(tr, 'abri') && houses < Math.ceil(m.length / 3.2)) {
    const p = freeSpot(tr, 2, 4 + houses * 0.5); if (p) { want(has(tr, 'ingenierie') ? 'maison' : 'hutte', ...p); return; }
  }
  if (has(tr, 'poterie') && !count('grenier')) { const p = freeSpot(tr, 2, 4); if (p) { want('grenier', ...p); return; } }
  if (has(tr, 'spiritualite') && !count('temple') && m.length >= 8) { const p = freeSpot(tr, 3, 6); if (p) { want('temple', ...p); return; } }
  if (has(tr, 'agriculture') && count('champ') < Math.ceil(m.length / 2.5)) {
    for (let k = 0; k < 3; k++) { const p = freeSpot(tr, 3, 9, (x, y, i) => S.tiles.type[i] === T.GRASS && S.tiles.tree[i] < 0.1 && !S.tiles.bush[i]); if (p) want('champ', ...p); }
  }
  if (has(tr, 'passage') && m.length >= 18 && !S.buildings.some((b) => b.type === 'passage' && b.tribeId === tr.id)) {
    const a = Math.atan2(tr.cy - CY, tr.cx - CX) || 0;
    for (let k = 0; k < 40; k++) {
      const aa = a + (rnd() - 0.5) * 1.2, x = Math.floor(CX + Math.cos(aa) * (R - 2.2)), y = Math.floor(CY + Math.sin(aa) * (R - 2.2));
      if (walkable(x + 0.5, y + 0.5) && S.tiles.bld[idx(x, y)] < 0) { want('passage', x, y); log(`🌀 ${tr.name} commence la construction du Passage, contre la Paroi.`, 'major', true, [x, y]); break; }
    }
  }
}

function splitTribe(tr) {
  const m = tr.members, leader = m.find((b) => b.id === tr.leader);
  // la famille la moins attachée au chef part
  const cands = m.filter((b) => b.age >= 18 && b.id !== tr.leader).sort((a, b) => (leader ? rel(a, leader) - rel(b, leader) : 0));
  const head = cands[0]; if (!head) return;
  const group = new Set([head]);
  for (const b of m) {
    if (group.size > m.length * 0.45) break;
    if (b.id === tr.leader) continue;
    if (b.partner === head.id || b.parents.includes(head.id) || head.parents.includes(b.id) || rel(b, head) > 40) group.add(b);
  }
  for (const b of [...group]) if (b.partner) { const p = S.beings.find((o) => o.id === b.partner); if (p && p.id !== tr.leader) group.add(p); }
  for (const b of m) if (b.age < 12 && b.parents.some((p) => [...group].some((g) => g.id === p))) group.add(b);
  if (group.size < 4) return;
  // trouver un nouveau territoire loin des autres
  let best = null, bd = -1;
  for (let k = 0; k < 80; k++) {
    const [x, y] = randomLand(); if (!nearWater(Math.floor(x), Math.floor(y)) && chance(0.7)) continue;
    const d = Math.min(...S.tribes.filter((t) => t.alive).map((t) => dist(x, y, t.cx, t.cy)));
    if (d > bd) { bd = d; best = [x, y]; }
  }
  if (!best || bd < 9) return;
  const nt = makeTribe(best[0], best[1]);
  nt.tech = { ...tr.tech }; nt.stock.food = 10; nt.faith = tr.faith; nt.leader = head.id;
  tr.rel[nt.id] = -10; nt.rel[tr.id] = -10;
  for (const b of group) { b.tribeId = nt.id; b.home = null; b.memory.unshift(`Nous avons quitté ${tr.name} pour fonder ${nt.name}.`); }
  log(`🚶 Exode : ${head.name} et ${group.size - 1} autres quittent ${tr.name} et fondent ${nt.name}.`, 'social', true, best);
}

function diplomacy() {
  const alive = S.tribes.filter((t) => t.alive);
  for (const a of alive) for (const b of alive) {
    if (a.id >= b.id) continue;
    let ra = a.rel[b.id] || 0;
    const d = dist(a.cx, a.cy, b.cx, b.cy);
    const scarcity = (a.stock.food / Math.max(1, a.members.length) < 3 ? 1 : 0) + (b.stock.food / Math.max(1, b.members.length) < 3 ? 1 : 0);
    // liens personnels
    let ties = 0;
    for (const p of a.members) for (const q of b.members) { const r = rel(p, q); if (r > 50) ties++; if (r < -40) ties -= 1.5; if (p.partner === q.id) ties += 3; }
    const leaderA = a.members.find((x) => x.id === a.leader), leaderB = b.members.find((x) => x.id === b.leader);
    const agg = ((leaderA ? leaderA.genes.agg : 0.5) + (leaderB ? leaderB.genes.agg : 0.5)) / 2;
    ra += ties * 0.3 - (d < 32 ? (32 - d) * 0.14 : 0) - scarcity * 3 - (agg - 0.4) * 6 + (a.dogma === 'paix' || b.dogma === 'paix' ? 5 : 0) - (a.dogma === 'guerre' || b.dogma === 'guerre' ? 6 : 0);
    // incidents : vols, meurtres, disputes de territoire
    if (d < 34 && chance(0.06 + agg * 0.1)) {
      const [x, y] = chance(0.5) ? [a, b] : [b, a];
      const thief = pick(x.members.filter((p) => p.age > 14)), victim = pick(y.members);
      if (thief && victim) {
        const kind = pick(['vol', 'vol', 'chasse', 'insulte', 'rixe']);
        const loot = Math.min(y.stock.food, 5 + rnd() * 15);
        if (kind === 'vol') { y.stock.food -= loot; x.stock.food += loot; }
        if (kind === 'rixe') { victim.health -= 25; victim.lastHurt = 'une rixe'; victim.killer = thief.id; }
        addRel(victim, thief, -30); victim.emo.anger += 25;
        ra -= kind === 'insulte' ? 6 : kind === 'rixe' ? 14 : 10;
        const txt = { vol: `🥷 ${thief.name} (${x.name}) a volé des vivres chez ${y.name}.`, chasse: `🦌 ${x.name} chasse sur le territoire de ${y.name}.`, insulte: `💢 ${thief.name} a insulté ${victim.name} de ${y.name}.`, rixe: `👊 ${thief.name} (${x.name}) a frappé ${victim.name} (${y.name}).` }[kind];
        log(txt, 'social', false, [thief.x, thief.y]);
      }
    }
    ra = clamp(ra * 0.98, -100, 100);
    a.rel[b.id] = ra; b.rel[a.id] = ra;
    // guerre / paix
    if (!a.war && !b.war && ra < -40 && S.time > a.peaceT && S.time > b.peaceT && S.time > 24 * 24 * 3 && a.members.length >= 8 && b.members.length >= 6 && chance(0.2 + agg * 0.4)) declareWar(a, b);
    else if (a.war && a.war.target === b.id) {
      const days = (S.time - a.war.since) / 24;
      const weary = (a.war.losses + b.war.losses) * 0.9 + days * 0.3;
      if ((weary > 4 && chance(0.35)) || ra > -10 || a.dogma === 'paix' || b.dogma === 'paix') endWar(a, b, 'paix');
    }
  }
}
export function declareWar(a, b) {
  a.war = { target: b.id, since: S.time, kills: 0, losses: 0 };
  b.war = { target: a.id, since: S.time, kills: 0, losses: 0 };
  S.stats.wars++;
  log(`⚔️ GUERRE ! ${a.name} et ${b.name} prennent les armes.`, 'war', true, [(a.cx + b.cx) / 2, (a.cy + b.cy) / 2]);
  for (const p of [...a.members, ...b.members]) { p.emo.fear += 20; p.emo.anger += 25; p.memory.unshift('La guerre a commencé.'); }
}
export function endWar(a, b, why) {
  if (a) { a.war = null; a.peaceT = S.time + 24 * 8; if (b) a.rel[b.id] = Math.max(a.rel[b.id] || 0, -15); }
  if (b) { b.war = null; b.peaceT = S.time + 24 * 8; if (a) b.rel[a.id] = Math.max(b.rel[a.id] || 0, -15); }
  if (a && b && why === 'paix') {
    log(`🕊️ Paix signée entre ${a.name} et ${b.name}.`, 'peace', true);
    for (const p of [...a.members, ...b.members]) { p.emo.joy += 15; p.emo.fear *= 0.5; p.memory.unshift('La paix est revenue.'); }
  }
}
// absorption d'une tribe trop petite par son ennemie
export function checkConquest() {
  for (const a of S.tribes) {
    if (!a.alive || !a.war) continue;
    const b = tribeById(a.war.target); if (!b || !b.alive) { a.war = null; continue; }
    if (b.members.length <= 2 && a.members.length >= 6) {
      for (const p of b.members) { p.tribeId = a.id; p.home = null; p.memory.unshift(`${a.name} nous a soumis.`); p.emo.sadness += 30; }
      a.stock.food += b.stock.food; a.stock.wood += b.stock.wood; a.stock.stone += b.stock.stone;
      for (const bd of S.buildings) if (bd.tribeId === b.id) bd.tribeId = a.id;
      b.alive = false; b.members = [];
      log(`🏳️ ${b.name} est vaincu et absorbé par ${a.name}.`, 'war', true);
      a.war = null; a.peaceT = S.time + 24 * 6;
    }
  }
}
