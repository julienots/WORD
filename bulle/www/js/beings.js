// ===== LES ÊTRES : corps, besoins, émotions, esprit, comportement =====
import { N, R, CX, CY, T, HOURS_PER_YEAR, AGE, MAX_POP, DAYS_PER_YEAR } from './config.js';
import { S, idx, inside, walkable, spiral, nearWater, nearestDrink, isWater, terrainCost, tempAt, isNight, timeInfo, findPath, randomLand, groundLvl, ignite } from './world.js';
import { rnd, range, irange, pick, chance, clamp, dist, gauss, lerp } from './util.js';
import { makeName } from './names.js';
import { tribeById, has, log, addKnowledge, rel, addRel, BLD, removeBuilding, addBuilding } from './society.js';
import { conversation, finishConversation, canLove, thought } from './dialogue.js';
import { computeTraits, hasT, perceive, recall, forget, shareSpots, tribeSpots, woundsStep, woundSpeed, veilleeLine, addMyth } from './mind.js';
import { SPECIES, addFear, addWound, callHelp } from './animals.js';

const GENES = ['str', 'int', 'soc', 'agg', 'cur', 'fert', 'lon', 'emp', 'spi', 'imm', 'beauty', 'height', 'skin', 'hair'];
export const GENE_LABEL = { str: 'Force', int: 'Intelligence', soc: 'Sociabilité', agg: 'Agressivité', cur: 'Curiosité', fert: 'Fertilité', lon: 'Longévité', emp: 'Empathie', spi: 'Spiritualité', imm: 'Immunité', beauty: 'Charme' };
export const SKILL_LABEL = { gather: 'Cueillette', hunt: 'Chasse', build: 'Construction', farm: 'Agriculture', heal: 'Soin', fight: 'Combat', craft: 'Artisanat', lore: 'Savoir' };
export const DISEASES = [
  { name: 'Fièvre', growth: 0.9, cont: 0.5 }, { name: 'Toux grise', growth: 0.7, cont: 0.9 },
  { name: 'Mal des marais', growth: 1.05, cont: 0.25 }, { name: 'Dysenterie', growth: 0.95, cont: 0.6 }, { name: 'Peste', growth: 1.7, cont: 1.5 },
];

export function makeGenes(pa, pb) {
  const g = {};
  for (const k of GENES) {
    if (pa && pb) {
      const base = chance(0.5) ? pa[k] : pb[k];
      g[k] = clamp(lerp(base, (pa[k] + pb[k]) / 2, 0.4) + gauss() * 0.06);
    } else g[k] = clamp(0.5 + gauss() * 0.18);
  }
  if (!pa) { g.skin = rnd(); g.hair = rnd(); }
  return g;
}

export function createBeing({ x, y, sex, age = 0, tribeId = null, parents = [], genes = null }) {
  sex ||= chance(0.5) ? 'F' : 'M';
  const b = {
    id: S.nextId++, name: makeName(sex), sex, orient: chance(0.9) ? 'hetero' : 'homo', x, y, dir: 1, walk: 0,
    age, born: S.time - age * HOURS_PER_YEAR, genes: genes || makeGenes(), tribeId,
    health: 100, sat: range(60, 90), thirst: range(60, 90), energy: range(60, 95), social: range(50, 80), cold: 0,
    emo: { joy: 50, sadness: 10, fear: 5, anger: 5, love: 10 }, grief: 0, lostName: '',
    disease: null, immune: {}, pregnant: null, partner: null, parents, children: [],
    rel: {}, skills: { gather: 0.1, hunt: 0.05, build: 0.05, farm: 0.02, heal: 0.02, fight: 0.05, craft: 0.05, lore: 0.05 },
    carry: { food: 0, wood: 0, stone: 0 }, act: null, path: null, stuck: 0, home: null,
    faith: 0.1 + rnd() * 0.15, aware: 0, wantLeave: false, wantsLove: false, flags: {}, memory: [], thought: '…', thinkT: rnd() * 3,
    say: null, sleeping: false, inside: false, alive: true, lastHurt: null, killer: null, kills: 0,
    role: null, traits: [], wounds: [], know: { berries: [], stone: [], game: [] }, next: null, perT: rnd() * 2,
  };
  b.carry.water = 0;
  computeTraits(b);
  if (age > 16) for (const k in b.skills) b.skills[k] = clamp(b.skills[k] + rnd() * 0.25);
  S.beings.push(b);
  return b;
}
export const byId = (id) => (id == null ? null : S.beingMap?.get(id) || S.beings.find((b) => b.id === id));
export function stage(b) { return b.age < AGE.BABY ? 'bébé' : b.age < AGE.CHILD ? 'enfant' : b.age < AGE.TEEN ? 'adolescent' : b.age < elderAge(b) ? 'adulte' : 'ancien'; }
export const elderAge = (b) => 52 + b.genes.lon * 14;
const isAdult = (b) => b.age >= AGE.TEEN;
export function mem(b, text) { b.memory.unshift(text); if (b.memory.length > 16) b.memory.length = 16; }
export function say(b, text, ms = 3200) { b.say = { text, until: performance.now() + ms }; }

// ================= mise à jour d'un être =================
export function beingStep(b, dt) {
  const tr = tribeById(b.tribeId);
  b._hurtMax = 0;
  if (!b.know) { b.know = { berries: [], stone: [], game: [] }; b.wounds = []; b.carry.water = 0; b.perT = 1; computeTraits(b); }
  b.age += dt / HOURS_PER_YEAR;
  const st = b.age < AGE.BABY ? 0 : b.age < AGE.CHILD ? 1 : 2;
  // --- métabolisme ---
  const act = b.act?.type;
  const effort = act === 'fight' || act === 'flee' || act === 'hunt' ? 2 : act === 'chop' || act === 'mine' || act === 'build' ? 1.5 : b.sleeping ? 0.5 : 1;
  b.sat -= dt * 2.2 * effort * (st === 0 ? 0.8 : 1) * (b.pregnant ? 1.25 : 1);
  const temp = tempAt(b.x, b.y);
  b.thirst -= dt * (b.sleeping ? 1.8 : 3.2) * (temp > 26 ? 1 + (temp - 26) * 0.08 : 1) * (effort > 1 ? 1.3 : 1);
  if (b.sleeping) b.energy += dt * (b.inside ? 14 : 11); else b.energy -= dt * 3.6 * (effort > 1 ? 1.25 : 1);
  if (act !== 'talk' && act !== 'listen') b.social -= dt * 1.4 * (0.5 + b.genes.soc);
  // bébé nourri par la mère / l'entourage
  if (st === 0) feedBaby(b, dt, tr);
  // --- thermique ---
  let felt = temp;
  const warmUp = (k) => { if (felt < 20) felt = Math.min(22, felt + k); };
  if (b.inside) { warmUp(14); if (felt > 28) felt -= 4; } // l'abri protège aussi du soleil
  else if (tr) {
    if (has(tr, 'feu') && dist(b.x, b.y, tr.cx + 0.5, tr.cy + 0.5) < 3.5) warmUp(11);
    if (b.home) { const h = S.bmap.get(b.home); if (h && h.done && dist(b.x, b.y, h.x, h.y) < 2) warmUp(6); }
  }
  if (has(tr, 'vetements')) felt += 9;
  if (b.sleeping && !b.inside) felt += 4; // recroquevillé
  if (!b.inside && S.gridB.near(b.x, b.y, 1.8).length >= 3) felt += 4; // blottis les uns contre les autres
  if (S.weather.type === 'pluie' || S.weather.type === 'orage') felt -= b.inside ? 0 : 3;
  b.felt = felt;
  b.cold = clamp((7 - felt) / 18);
  // --- santé ---
  b.sat = clamp(b.sat, 0, 100); b.thirst = clamp(b.thirst, 0, 100); b.energy = clamp(b.energy, 0, 100); b.social = clamp(b.social, 0, 100);
  const maxH = b.age > elderAge(b) ? Math.max(25, 100 - (b.age - elderAge(b)) * 2.2) : 100;
  if (b.sat <= 0) hurt(b, dt * 2.4, 'la faim');
  if (b.thirst <= 0) hurt(b, dt * 5, 'la soif');
  if (b.cold > 0.6) hurt(b, dt * (b.cold - 0.55) * 5, 'le froid');
  if (felt > 38 && b.thirst < 40) hurt(b, dt * (felt - 38) * 0.3, 'la chaleur');
  woundsStep(b, dt, tr, hurt, (x) => infect(x, DISEASES[0], 14));
  if (b.disease) diseaseStep(b, dt, tr);
  else if (chance(dt * 0.00032 * (1 + Math.min(3, S.gridB.near(b.x, b.y, 3).length * 0.15) + (b.sat < 30 ? 2 : 0) + b.cold * 3 + (S.tiles.type[idx(Math.floor(b.x), Math.floor(b.y))] === T.SAND && nearWater(Math.floor(b.x), Math.floor(b.y)) ? 0.5 : 0) + (b.age > 60 ? 1 : 0) + (b.age < 3 ? 1 : 0)) * (has(tr, 'medecine') ? 0.6 : 1) * (1.3 - b.genes.imm))) {
    infect(b, pick(DISEASES.slice(0, 4)));
  }
  if (b.sat > 30 && b.thirst > 30 && !b.disease && b.cold < 0.4) b.health = Math.min(maxH, b.health + dt * (b.sleeping ? 1.6 : 0.7));
  b.health = Math.min(b.health, maxH);
  // --- vieillesse ---
  if (b.age > elderAge(b)) {
    const hz = 0.02 * Math.exp((b.age - elderAge(b)) / 7.5) / HOURS_PER_YEAR * dt;
    if (chance(hz)) return die(b, 'la vieillesse');
  }
  if (b.health <= 0) return die(b, b.lastHurt || 'ses blessures');
  // --- grossesse ---
  if (b.pregnant) { b.pregnant.t += dt; if (b.pregnant.t >= 0.75 * HOURS_PER_YEAR) giveBirth(b, tr); }
  // --- émotions ---
  emotions(b, dt, tr);
  // --- esprit : pensées ---
  b.thinkT -= dt;
  if (b.thinkT <= 0) {
    b.thinkT = range(2, 5); b.thought = thought(b);
    if (!b.sleeping && st > 0 && chance(0.25) && performance.now() > (b.say?.until || 0) + 3000) say(b, b.thought, 2600);
    if (b.age > 14 && /Paroi|monde|bulle|prisonnier|enferm|Créateur|ciel|soleil|mourir|nés|regarde/.test(b.thought) && chance(0.03 * (b.genes.cur + b.aware + b.faith))) log(`💭 ${b.name} se demande : « ${b.thought} »`, 'question', false, [b.x, b.y]);
  }
  // perception : on retient où sont les ressources
  b.perT -= dt; if (b.perT <= 0 && !b.sleeping && b.age > 5) { b.perT = 1.5; perceive(b, tr); }
  // rite de passage
  if (b.age >= 16 && !b.flags.adult) { b.flags.adult = true; computeTraits(b); if (has(tr, 'spiritualite')) { log(`🗿 Rite de passage : ${b.name} devient adulte chez ${tr.name}.`, 'culture', false, [b.x, b.y]); mem(b, 'Aujourd’hui, je suis devenu adulte.'); b.emo.joy += 25; } }
  b.fedBy = null;
  b.wantsLove = isAdult(b) && b.age < 55 && !b.partner && b.emo.love + b.genes.soc * 40 > 30;
  // --- comportement ---
  if (st === 0) return babyStep(b, dt);
  if (!b.act) decide(b, tr);
  if (b.act) runAct(b, dt, tr);
}

function feedBaby(b, dt, tr) {
  const care = byId(b.parents[0]) && byId(b.parents[0]).alive ? byId(b.parents[0]) : byId(b.parents[1]);
  if (care && dist(care.x, care.y, b.x, b.y) < 2.5 && b.sat < 80) { const take = Math.min(dt * 8, 80 - b.sat); b.sat += take; care.sat -= take * 0.35; }
  if (b.sat < 40 && tr && tr.stock.food > 0 && dist(b.x, b.y, tr.cx, tr.cy) < 6) { tr.stock.food -= 0.5; b.sat += 15; }
  if (b.thirst < 80 && care && dist(care.x, care.y, b.x, b.y) < 2.5) b.thirst = Math.min(100, b.thirst + dt * 9);
}
function babyStep(b, dt) {
  const care = [byId(b.parents[0]), byId(b.parents[1])].find((p) => p && p.alive);
  b.sleeping = isNight() || b.energy < 30 || (care && care.sleeping);
  b.inside = care ? care.inside : false;
  if (care) { b.x = care.x + 0.25 * b.dir; b.y = care.y + 0.2; b.dir = care.dir; }
  else { // orphelin : adopté par un adulte de la tribu, ou par le plus proche
    const tr = tribeById(b.tribeId);
    let ad = tr?.members.find((m) => m.age > 18 && m.alive && m.sex === 'F') || tr?.members.find((m) => m.age > 16 && m.alive);
    if (!ad) { let bd = 1e9; for (const m of S.beings) if (m.alive && m.age > 16) { const d = dist(m.x, m.y, b.x, b.y); if (d < bd) { bd = d; ad = m; } } if (ad) b.tribeId = ad.tribeId; }
    if (ad) { b.parents = [ad.id, ...b.parents]; mem(ad, `J’ai recueilli ${b.name}, orphelin.`); log(`🤲 ${ad.name} recueille le petit ${b.name}.`, 'social'); }
  }
}

function emotions(b, dt, tr) {
  const e = b.emo, k = clamp(dt * 0.08);
  e.joy = lerp(e.joy, 35 + b.genes.soc * 20 - b.grief * 0.3, k);
  e.sadness = lerp(e.sadness, 8 + b.grief * 0.6, k);
  e.fear = lerp(e.fear, 4 + (tr?.war ? 18 : 0), k * 1.5);
  e.anger = lerp(e.anger, 4 + b.genes.agg * 12, k);
  e.love = lerp(e.love, b.partner ? 65 : 10 + b.genes.soc * 15, k * 0.5);
  if (b.sat < 25) { e.sadness += dt * 3; e.anger += dt * 2 * b.genes.agg; }
  if (b.cold > 0.4) e.sadness += dt * 2;
  if (b.disease) e.sadness += dt * 2;
  if (b.social > 70 && b.sat > 60) e.joy += dt * 2;
  if (b.wantLeave) e.sadness += dt * 0.6;
  if (S.weather.type === 'clair' && !isNight()) e.joy += dt * 0.5;
  for (const kk in e) e[kk] = clamp(e[kk], 0, 100);
  b.grief = Math.max(0, b.grief - dt * 0.12);
}
export function mood(b) { const e = b.emo; return e.joy + e.love * 0.3 - e.sadness - e.fear * 0.6 - e.anger * 0.4; }
export function moodEmoji(b) {
  if (!b.alive) return '💀'; if (b.sleeping) return '😴'; if (b.disease) return '🤒';
  const e = b.emo, m = Math.max(e.joy, e.sadness, e.fear, e.anger, e.love * 0.9);
  if (m === e.fear && e.fear > 30) return '😨'; if (m === e.anger && e.anger > 30) return '😠';
  if (m === e.sadness && e.sadness > 30) return b.grief > 20 ? '😢' : '😞'; if (b.partner && e.love > 55 && m === e.love * 0.9) return '😍';
  return e.joy > 60 ? '😄' : '🙂';
}

export function hurt(b, amount, cause, by = null) {
  b.health -= amount;
  if (amount >= (b._hurtMax || 0)) { b._hurtMax = amount; b.lastHurt = cause; } // la cause principale de la blessure
  if (by) b.killer = by;
}
export function infect(b, d, sev = 10) {
  if (b.disease || b.immune[d.name]) return false;
  b.disease = { name: d.name, growth: d.growth, cont: d.cont, sev, t: 0 };
  mem(b, `Je suis tombé malade (${d.name.toLowerCase()}).`);
  return true;
}
function diseaseStep(b, dt, tr) {
  const d = b.disease; d.t += dt;
  const resist = (0.45 + b.genes.imm * 1.1 + b.health / 200) * Math.min(1.35, d.t / 35) + (b.sleeping ? 0.15 : 0) + (b.treated ? 0.8 : 0) + (b.sat < 25 ? -0.2 : 0);
  d.sev += dt * (d.growth * 1.2 - resist) * (b.age > 60 || b.age < 4 ? 1.25 : 1);
  hurt(b, dt * d.sev * 0.02, d.name.toLowerCase());
  if (d.sev >= 100) { b.health = 0; return; }
  if (d.sev <= 0) { b.immune[d.name] = true; b.disease = null; b.treated = false; mem(b, 'Je suis guéri.'); b.emo.joy += 20; return; }
  // contagion
  if (chance(dt * 0.5)) for (const o of S.gridB.near(b.x, b.y, 1.6)) if (o !== b && chance(0.05 * d.cont * (1.2 - o.genes.imm))) infect(o, d, 6);
}

// ================= mort =================
export function die(b, cause) {
  if (!b.alive) return;
  b.alive = false; b.cause = cause; b.died = S.time; b.act = null;
  S.stats.deaths++; S.stats.causes[cause] = (S.stats.causes[cause] || 0) + 1;
  S.dead.set(b.id, { name: b.name, sex: b.sex, cause, died: S.time, age: b.age });
  const tr = tribeById(b.tribeId);
  const ag = Math.floor(b.age);
  log(`✝️ ${b.name} est mort${b.sex === 'F' ? 'e' : ''} de ${cause}, à ${ag} an${ag > 1 ? 's' : ''}${tr ? ` (${tr.name})` : ''}.`, 'death', ag > 3 && (b.id === S.selected || b.id === tr?.leader), [b.x, b.y]);
  // chagrin des proches
  for (const o of S.beings) {
    if (!o.alive || o === b) continue;
    const close = o.partner === b.id ? 90 : o.parents.includes(b.id) || b.parents.includes(o.id) ? 70 : Math.max(0, rel(o, b)) * 0.6;
    if (close > 15) { o.grief = Math.max(o.grief, close); o.lostName = b.name; o.emo.sadness += close * 0.5; mem(o, `${b.name} est mort${b.sex === 'F' ? 'e' : ''}.`); }
    if ((o.partner === b.id || (o.children.includes(b.id) && b.age < 16)) && chance(0.5) && !o.traits.includes('traumatisé')) o.traits.push('traumatisé');
    if (dist(o.x, o.y, b.x, b.y) < 6) o.emo.fear += 10;
    if (o.partner === b.id) o.partner = null;
  }
  // vengeance
  const k = byId(b.killer);
  if (k && k.alive) { k.kills++; for (const o of S.beings) if (o.alive && (o.partner === b.id || o.parents.includes(b.id) || b.parents.includes(o.id))) addRel(o, k, -80); }
  if (tr?.war && k && k.tribeId === tr.war.target) { tr.war.losses++; const et = tribeById(k.tribeId); if (et?.war) et.war.kills++; }
  // sépulture
  if (tr && has(tr, 'spiritualite')) {
    const p = spiral(tr.cx + 4, tr.cy + 4, 6, (x, y, i) => walkable(x + 0.5, y + 0.5) && S.tiles.bld[i] < 0 && S.tiles.farm[i] < 0);
    if (p) {
      addBuilding('tombe', p[0], p[1], tr, true, { who: b.name });
      if (b.age > 2) {
        const family = S.beings.filter((o) => o.alive && (o.partner === b.id || o.parents.includes(b.id) || b.parents.includes(o.id))).map((o) => o.id);
        (tr.funerals ||= []).push({ id: b.id, who: b.name, x: p[0] + 0.5, y: p[1] + 0.5, start: S.time + 2, end: S.time + 30, att: [], family, logged: false });
        tr.funerals = tr.funerals.filter((f) => f.end > S.time);
      }
    }
  } else S.effects.push({ kind: 'corpse', x: b.x, y: b.y, t: 48, sex: b.sex, skin: b.genes.skin });
  if (S.selected === b.id) S.selectedDead = { ...b };
}

// ================= naissance =================
function giveBirth(m, tr) {
  const f = byId(m.pregnant.father) || S.dead.get(m.pregnant.father);
  const fg = f?.genes || makeGenes();
  m.pregnant = null;
  const n = chance(0.03) ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const c = createBeing({ x: m.x, y: m.y, age: 0, tribeId: m.tribeId, parents: [m.id, f?.id ?? -1], genes: makeGenes(m.genes, fg) });
    c.faith = (m.faith + (f?.faith || m.faith)) / 2 * 0.8; c.aware = m.aware * 0.3; c.home = m.home;
    c.sat = 80; c.thirst = 90; c.energy = 70;
    // parfois, on donne à l'enfant le nom d'un aïeul disparu
    const anc = [...m.parents, ...(f?.parents || [])].map((id) => S.dead.get(id)).filter((d) => d && d.sex === c.sex);
    if (anc.length && chance(0.35)) { const d = pick(anc); c.name = d.name.replace(/ II+$/, '') + ' II'; }
    m.children.push(c.id); if (f && f.alive) f.children.push(c.id);
    addRel(m, c, 80); addRel(c, m, 80); if (f && f.alive) { addRel(f, c, 70); addRel(c, f, 70); }
    S.stats.births++;
    const first = !S.objectives.birth;
    log(`👶 Naissance de ${c.name}, ${c.sex === 'F' ? 'fille' : 'fils'} de ${m.name}${f ? ` et ${f.name}` : ''}${tr ? ` (${tr.name})` : ''}.`, 'birth', first, [m.x, m.y]);
    mem(m, `J’ai donné naissance à ${c.name}.`); m.emo.joy += 40; m.emo.love += 20;
    if (f && f.alive) { mem(f, `${c.name} est né !`); f.emo.joy += 35; }
  }
  const risk = has(tr, 'medecine') ? 0.004 : 0.012;
  if (chance(risk)) { hurt(m, 999, 'l’accouchement'); }
}

// ================= décisions =================
const A = (type, o = {}) => ({ type, phase: 'go', t: 0, ...o });
const hourNow = () => S.time % 24;
function decide(b, tr) {
  b.path = null; b.stuck = 0; b.sleeping = false; b.inside = false; b.sitting = false;
  const night = isNight(), child = b.age < AGE.CHILD, h = hourNow();
  // reprendre un projet mis de côté (on est allé boire avant de partir loin)
  if (b.next) { const n = b.next; b.next = null; if (b.thirst > 40 && b.sat > 35 && (n.target == null || byId(n.target) || S.animalMap.get(n.target) || S.bmap.get(n.target))) return (b.act = { ...n, phase: 'go', t: 0, maxT: null, tried: false }); }
  if (S.victory && b.aware > 0.3) { const p = S.bmap.get(S.victory.passage); if (p) return (b.act = A('exit', { tx: p.x + 0.5, ty: p.y + 0.5, r: 1.4 })); }
  // prévoyance : plus l'eau est loin, plus on part boire tôt
  if (b.thirst < 60 && !(b.carry.water > 0)) { const w = goDrink(b); const far = w.tx != null ? dist(w.tx, w.ty, b.x, b.y) : 0; if (b.thirst < 36 + far * 1.6) return (b.act = w); }
  if (b.thirst < 40) return (b.act = b.carry.water > 0 ? A('sip', { phase: 'do', dur: 0.1 }) : goDrink(b));
  if (b.sat < 38) { const a = goEat(b, tr); if (a) return (b.act = a); }
  if (b.disease && b.disease.sev > 40) return (b.act = goSleep(b, tr, true));
  if (b.wounds?.some((w) => w.sev > 30)) return (b.act = goSleep(b, tr, true));
  if (b.energy < 18 || (night && b.energy < 80 && !(h > 19 && h < 22.5 && b.energy > 35 && tr && has(tr, 'feu')))) return (b.act = goSleep(b, tr));
  if (b.cold > 0.4) return (b.act = goWarm(b, tr));
  const total = b.carry.food + b.carry.wood + b.carry.stone;
  if (tr && total > 0 && total < 6 && b.carry.food > 0 && hourNow() < 17) { const g = findBerries(b, tr, 6); if (g) return (b.act = A('gather', { tx: g[0] + 0.5, ty: g[1] + 0.5, dur: 0.5, r: 0.9, spot: g[2] })); } // on remplit son panier avant de rentrer
  if (tr && (total >= 6 || (total > 0 && (hourNow() > 17 || chance(0.15))))) return (b.act = A('deposit', { tx: tr.cx + 0.5 + range(-1, 1), ty: tr.cy + 0.5 + range(-1, 1), r: 1.6 }));
  // repas aux heures habituelles
  if (tr && tr.stock.food >= 1 && b.sat < 72 && ((h > 6.5 && h < 8.5) || (h > 18 && h < 20)) && dist(b.x, b.y, tr.cx, tr.cy) < 14) return (b.act = A('eat', { tx: tr.cx + 0.5 + range(-1.5, 1.5), ty: tr.cy + 0.5 + range(-1.5, 1.5), dur: 0.35, src: 'stock', r: 1.5, meal: true }));
  // guerre : défendre le village, se rassembler, lancer le raid ensemble
  if (tr?.war && isWarrior(b) && (b.role === 'guerrier' || hasT(b, 'courageux') || chance(0.25))) { const a = warDuty(b, tr); if (a) return (b.act = a); }
  if (child) return (b.act = childAct(b, tr));
  const famine = tr?.famine;
  // soigner (maladies et blessures)
  if (has(tr, 'medecine') && (b.role === 'guerisseur' || b.skills.heal + b.genes.emp > 0.8)) {
    const sick = S.beings.find((o) => o.alive && o !== b && o.tribeId === b.tribeId && ((o.disease && !o.treated) || o.wounds?.some((w) => !w.treated)) && dist(o.x, o.y, b.x, b.y) < 20);
    if (sick && chance(b.role === 'guerisseur' ? 0.9 : 0.5)) return (b.act = A('heal', { target: sick.id, r: 1.2 }));
  }
  // vie collective du soir et rites
  if (tr) {
    const fu = (tr.funerals || []).find((f) => S.time >= f.start && S.time < f.end && !f.att.includes(b.id) && (rel(b, { id: f.id }) > 25 || f.family.includes(b.id)));
    if (fu) { fu.att.push(b.id); return (b.act = A('funeral', { tx: fu.x + range(-1.2, 1.2), ty: fu.y + 0.8 + range(-0.5, 0.8), r: 0.8, dur: 1.2, fid: fu.id })); }
    if (h > 18.2 && h < 21 && dist(b.x, b.y, tr.cx, tr.cy) > 15) { if (chance(0.3)) say(b, pick(['Il faut rentrer avant la nuit.', 'La nuit tombe, rentrons.']), 1800); return (b.act = A('idle', { tx: tr.cx + 0.5 + range(-2, 2), ty: tr.cy + 0.5 + range(-2, 2), r: 2, dur: 0.1 })); }
    const fest = tr.festival && S.time < tr.festival.until;
    if (has(tr, 'feu') && h > 19 && h < 22.5 && b.energy > 30 && !(tr.famine && !fest) && chance(fest ? 0.95 : 0.35 + b.genes.soc * 0.3 - (hasT(b, 'solitaire') ? 0.25 : 0))) {
      const ang = (b.id * 2.399) % (Math.PI * 2), rr = 1.8 + (b.id % 3) * 0.35;
      return (b.act = A('veillee', { tx: tr.cx + 0.5 + Math.cos(ang) * rr, ty: tr.cy + 0.5 + Math.sin(ang) * rr, r: 0.5, dur: range(1.2, 2.2), fest }));
    }
  }
  // entraide : nourrir les faibles (malades, blessés, anciens, enfants)
  if (tr && (hasT(b, 'généreux') || b.genes.emp > 0.5) && !hasT(b, 'égoïste') && (tr.stock.food >= 2 || b.carry.food >= 1)) {
    const weak = S.gridB.near(b.x, b.y, 16).find((o) => o !== b && o.alive && o.tribeId === b.tribeId && o.age >= 3 && o.sat < 30 && (o.disease || o.wounds?.length || o.age > 64 || o.age < 9) && o.act?.type !== 'eat' && !o.fedBy);
    if (weak && chance(0.7)) { weak.fedBy = b.id; return (b.act = A('feed', { target: weak.id, r: 1 })); }
  }
  // choix pondéré selon le rôle et la personnalité
  const role = b.role, lazy = hasT(b, 'paresseux') ? 0.6 : hasT(b, 'travailleur') ? 1.4 : 1;
  const opts = [];
  opts.push(['social', ((100 - b.social) / 25) * (0.4 + b.genes.soc) * (hasT(b, 'solitaire') ? 0.4 : 1)]);
  if (b.wantsLove) opts.push(['love', 1.2 + b.genes.soc + (hasT(b, 'séducteur') ? 1 : 0)]);
  opts.push(['work', (tr ? 3.2 : 1.5) * lazy * (famine ? 3 : 1)]);
  opts.push(['explore', (b.genes.cur * 0.6 + b.aware * 0.6) * (role === 'explorateur' ? 2.5 : 1)]);
  opts.push(['think', (b.genes.int * b.genes.cur * 1.4 + (b.age > 45 ? 0.3 : 0)) * (role === 'sage' ? 2.5 : 1)]);
  opts.push(['pray', (0.08 + b.faith + b.genes.spi * 0.2) * (has(tr, 'spiritualite') ? 1.5 : 0.5) * (role === 'chaman' ? 3 : 1)]);
  if (role === 'sage' || b.age > 50) opts.push(['teach', 1]);
  if (role === 'guerrier') opts.push(['patrol', 0.8]);
  if (b.wantLeave) opts.push(['leave', 1.2 + b.aware]);
  if (b.grief > 30) opts.push(['mourn', b.grief / 40]);
  opts.push(['idle', 0.22 * (hasT(b, 'paresseux') ? 3 : 1)]);
  let tot = opts.reduce((s, o) => s + o[1], 0), r = rnd() * tot, ch = 'idle';
  for (const [k, w] of opts) { r -= w; if (r <= 0) { ch = k; break; } }
  let a = null;
  switch (ch) {
    case 'social': a = seekTalk(b, false); break;
    case 'love': a = seekTalk(b, true); break;
    case 'work': a = work(b, tr); break;
    case 'explore': a = explore(b); break;
    case 'think': a = A('think', { tx: b.x, ty: b.y, dur: range(0.8, 1.6) }); break;
    case 'pray': a = pray(b, tr); break;
    case 'teach': { const kid = S.gridB.near(b.x, b.y, 15).find((o) => o.alive && o.age >= 4 && o.age < 15 && o.tribeId === b.tribeId && !o.sleeping); if (kid) a = A('seek', { target: kid.id, r: 1.1 }); break; }
    case 'patrol': { const an = rnd() * Math.PI * 2; a = A('patrol', { tx: tr.cx + 0.5 + Math.cos(an) * 7, ty: tr.cy + 0.5 + Math.sin(an) * 7, r: 1, dur: 0.3 }); break; }
    case 'leave': a = goWall(b); break;
    case 'mourn': { const g = S.buildings.find((x) => x.type === 'tombe' && x.tribeId === b.tribeId && x.who === b.lostName); a = g ? A('mourn', { tx: g.x + 0.5, ty: g.y + 1.2, dur: 1.2 }) : A('mourn', { tx: b.x, ty: b.y, dur: 1 }); break; }
  }
  a ||= idle(b, tr);
  // prévoyance : avant de partir loin, on boit et on mange
  if (a.tx != null && dist(a.tx, a.ty, b.x, b.y) > 13 && ['explore', 'wall', 'hunt', 'chop', 'mine', 'gather'].includes(a.type)) {
    if (b.thirst < 62 && !(b.carry.water > 0)) { b.next = a; a = goDrink(b); }
    else if (b.sat < 55 && (b.carry.food > 0 || tr?.stock.food >= 1)) { b.next = a; a = goEat(b, tr) || a; }
  }
  b.act = a;
}
const isWarrior = (b) => isAdult(b) && b.age < 55 && !b.pregnant && b.health > 50 && !b.wounds?.some((w) => w.sev > 15) && (b.role === 'guerrier' || b.genes.agg > 0.5 || b.genes.str > 0.6 || hasT(b, 'courageux')) && !hasT(b, 'peureux');
function warDuty(b, tr) {
  const en = tribeById(tr.war.target); if (!en?.alive) return null;
  // des ennemis approchent du village : on le défend
  let inv = null;
  for (const o of S.gridB.near(tr.cx, tr.cy, 12)) if (o.alive && o.tribeId === en.id && o.age >= 14) { inv = o; break; }
  if (inv) { if (chance(0.3)) say(b, pick(['Ils attaquent ! Défendons le village !', 'Aux armes !']), 1800); return A('fight', { target: inv.id, run: true }); }
  if (S.time < (tr.nextRaid || 0)) return null;
  if (!tr.band) { tr.band = { t0: S.time, ids: [] }; if (chance(0.5)) say(b, 'Rassemblez-vous ! Nous partons en guerre !', 2200); }
  if (!tr.band.ids.includes(b.id)) { if (tr.band.ids.length >= 7) return null; tr.band.ids.push(b.id); }
  return A('rally', { tx: tr.cx + 0.5 + range(-1.5, 1.5), ty: tr.cy + 1.5 + range(-1, 1), r: 1, dur: 0.6 });
}
function idle(b, tr) {
  const [x, y] = tr ? randomLand(tr.cx, tr.cy, 6) : randomLand(b.x, b.y, 5);
  return A('idle', { tx: x, ty: y, dur: range(0.4, 1.2) });
}
function goDrink(b) {
  const p = spiral(b.x, b.y, 6, (x, y) => walkable(x + 0.5, y + 0.5) && nearWater(x, y));
  if (p) return A('drink', { tx: p[0] + 0.5, ty: p[1] + 0.5, dur: 0.25, r: 0.6 });
  const q = nearestDrink(b.x, b.y);
  if (!q) return idle(b, tribeById(b.tribeId));
  return A('drink', { tx: q[0], ty: q[1], dur: 0.25, r: 0.6, run: b.thirst < 25 });
}
function goEat(b, tr) {
  if (b.carry.food > 0) return A('eat', { tx: b.x, ty: b.y, dur: 0.3, src: 'carry' });
  const g0 = findBerries(b, tr, 8); if (g0) return A('gather', { tx: g0[0] + 0.5, ty: g0[1] + 0.5, dur: 0.5, eat: true, r: 0.9, spot: g0[2] });
  if (tr && tr.stock.food >= 1) return A('eat', { tx: tr.cx + 0.5 + range(-1.2, 1.2), ty: tr.cy + 0.5 + range(-1.2, 1.2), dur: 0.35, src: 'stock', r: 1.5 });
  const g = findBerries(b, tr, 40); if (g) return A('gather', { tx: g[0] + 0.5, ty: g[1] + 0.5, dur: 0.5, eat: true, r: 0.9, spot: g[2] });
  if (b.age > 12) { const h = huntTarget(b, tr); if (h) return A('hunt', { target: h.id, run: true }); }
  if (b.age > 12 && has(tr, 'outils')) { const f = goFish(b); if (f) return f; }
  // rien à manger ici : errer à la recherche de nourriture
  const [x, y] = randomLand(b.x, b.y, 14); return A('idle', { tx: x, ty: y, dur: 0.2 });
}
// d'abord ce qu'on voit, puis ce dont on se souvient (et ce que la tribu raconte), enfin le flair
function findBerries(b, tr, r) {
  const pred = (x, y, i) => S.tiles.bush[i] && S.tiles.berries[i] >= 1 && S.tiles.fire[i] <= 0;
  const seen = spiral(b.x, b.y, Math.min(r, 8), pred);
  if (seen) return [seen[0], seen[1], idx(seen[0], seen[1])];
  if (r <= 8) return null;
  const k = recall(b, tr, 'berries', r);
  if (k) return k;
  if (b.sat < 40 || chance(0.8)) { const p = spiral(b.x, b.y, r, pred); if (p) return [p[0], p[1], idx(p[0], p[1])]; }
  return null;
}
function goFish(b) {
  const p = spiral(b.x, b.y, 22, (x, y) => walkable(x + 0.5, y + 0.5) && nearWater(x, y) && fishAround(x, y) > 1.5);
  return p ? A('fish', { tx: p[0] + 0.5, ty: p[1] + 0.5, dur: 1.2, r: 0.7 }) : null;
}
function fishAround(x, y) { let f = 0; for (let d = 0; d < 8; d++) { const xx = x + [1, -1, 0, 0, 1, 1, -1, -1][d], yy = y + [0, 0, 1, -1, 1, -1, 1, -1][d]; if (isWater(xx, yy)) f = Math.max(f, S.tiles.fish[idx(xx, yy)]); } return f; }
function huntTarget(b, tr) {
  const hasHunt = has(tr, 'chasse');
  let best = null, bs = -1e9;
  const R0 = hasHunt ? 22 : 10;
  for (const a of S.gridA.near(b.x, b.y, R0)) {
    if (!a.alive || a.hidden || a.state === 'hibernate') continue;
    if ((a.sp === 'wolf' || a.sp === 'boar') && !hasHunt) continue;
    if (a.sp === 'bear' && (!hasHunt || S.gridB.near(b.x, b.y, 8).filter((o) => o.tribeId === b.tribeId && o.age > 16 && o.health > 60).length < 4)) continue;
    const d = dist(a.x, a.y, b.x, b.y), sp = SPECIES[a.sp];
    if (!tr?.famine && (a.sp === 'deer' || a.sp === 'boar') && (S.speciesCount?.[a.sp] || 99) < 8) continue; // on épargne une espèce devenue rare
    // le chasseur intelligent vise les proies faibles ou isolées, rentables, proches
    const s = sp.meat * 0.5 - d * 0.35 + (1 - a.health / sp.hp) * 3 + (a.age < sp.mature ? 1 : 0) - (a.sp === 'boar' ? 1.5 - b.skills.hunt * 2 : 0) - (a.sp === 'wolf' ? 3 : 0);
    if (s > bs) { bs = s; best = a; }
  }
  return best;
}
function goSleep(b, tr, sick = false) {
  const h = b.home && S.bmap.get(b.home);
  if (h && h.done && dist(b.x, b.y, h.x, h.y) < 30) return A('sleep', { tx: h.x + 0.5, ty: h.y + 1.4, r: 1, home: true, sick });
  const p = byId(b.partner);
  if (p && p.act?.type === 'sleep' && dist(p.act.tx, p.act.ty, b.x, b.y) < 25) return A('sleep', { tx: p.act.tx + 0.35, ty: p.act.ty + 0.2, r: 0.5, sick });
  if (tr && dist(b.x, b.y, tr.cx, tr.cy) < 25) { const [x, y] = randomLand(tr.cx + 0.5, tr.cy + 0.5, 2.8); return A('sleep', { tx: x, ty: y, r: 0.6, sick }); }
  return A('sleep', { tx: b.x, ty: b.y, sick });
}
function goWarm(b, tr) {
  const h = b.home && S.bmap.get(b.home);
  if (h && h.done) return A('warm', { tx: h.x + 0.5, ty: h.y + 1.4, r: 1, dur: 2, home: true });
  if (tr && has(tr, 'feu')) { const a = rnd() * 6.28; return A('warm', { tx: tr.cx + 0.5 + Math.cos(a) * 1.4, ty: tr.cy + 0.5 + Math.sin(a) * 1.4, r: 0.7, dur: 1.5 }); }
  return goSleep(b, tr);
}
function seekTalk(b, love) {
  let best = null, bs = -1e9;
  for (const o of S.gridB.near(b.x, b.y, love ? 26 : 14)) {
    if (o === b || !o.alive || o.sleeping || o.age < 3 || ['talk', 'listen', 'fight', 'exit', 'flee', 'veillee'].includes(o.act?.type)) continue;
    let s = rel(b, o) * 0.05 + (o.tribeId === b.tribeId ? 2 : 0) - dist(o.x, o.y, b.x, b.y) * 0.15 + rnd();
    if (love) { if (!canLove(b, o)) continue; s += o.genes.beauty * 3 + rel(b, o) * 0.06 + (o.partner ? -3 : 1); }
    if (s > bs) { bs = s; best = o; }
  }
  if (!best) return null;
  return A('seek', { target: best.id, love, r: 1.1 });
}
function explore(b) {
  let x, y;
  if (b.aware > 0.15 || chance(0.25 * b.genes.cur)) { const a = rnd() * Math.PI * 2; x = CX + Math.cos(a) * (R - 1.4); y = CY + Math.sin(a) * (R - 1.4); }
  else[x, y] = randomLand(b.x, b.y, 16);
  return A('explore', { tx: x, ty: y, r: 1.2, dur: 0.6 });
}
function goWall(b) {
  const p = S.buildings.find((x) => x.type === 'passage' && x.tribeId === b.tribeId);
  if (p && !p.done) return A('build', { target: p.id, tx: p.x + 0.5, ty: p.y + 1.3, r: 1.5 });
  const a = Math.atan2(b.y - CY, b.x - CX) + range(-0.5, 0.5);
  return A('wall', { tx: CX + Math.cos(a) * (R - 1.1), ty: CY + Math.sin(a) * (R - 1.1), r: 1.3, dur: 2 });
}
function pray(b, tr) {
  const t = S.buildings.find((x) => x.type === 'temple' && x.done && x.tribeId === b.tribeId);
  if (t && dist(t.x, t.y, b.x, b.y) < 30) return A('pray', { tx: t.x + 0.5 + range(-1, 1), ty: t.y + 1.6, r: 1, dur: 1, temple: true });
  return A('pray', { tx: b.x, ty: b.y, dur: 0.8 });
}
function childAct(b, tr) {
  if (b.age > 6 && chance(tr?.famine ? 0.9 : 0.5)) { const g = findBerries(b, tr, 14); if (g) return A('gather', { tx: g[0] + 0.5, ty: g[1] + 0.5, dur: 0.7, r: 0.9, spot: g[2] }); }
  // les enfants jouent ensemble
  if (chance(0.35)) { const mate = S.gridB.near(b.x, b.y, 10).find((o) => o !== b && o.alive && o.age > 3 && o.age < 13 && !o.sleeping); if (mate) return A('play', { tx: mate.x + range(-1, 1), ty: mate.y + range(-1, 1), dur: 0.8, run: true, with: mate.id }); }
  if (chance(0.25)) { const a = seekTalk(b, false); if (a) return a; }
  const p = byId(b.parents[0]) || byId(b.parents[1]);
  if (p && p.alive && chance(0.5)) return A('follow', { target: p.id, dur: range(0.6, 1.5), r: 1.4 });
  return A('play', { ...(() => { const [x, y] = randomLand(tr ? tr.cx : b.x, tr ? tr.cy : b.y, 5); return { tx: x, ty: y }; })(), dur: 0.6, run: true });
}

// ===== travail =====
function work(b, tr) {
  if (!tr) { const g = findBerries(b, tr, 20); return g ? A('gather', { tx: g[0] + 0.5, ty: g[1] + 0.5, dur: 0.6, r: 0.9, spot: g[2] }) : null; }
  const m = tr.members.length, { season } = timeInfo(), role = b.role;
  const pend = S.buildings.filter((x) => x.tribeId === tr.id && !x.done && x.type !== 'champ');
  const needW = pend.reduce((s, x) => s + BLD[x.type].wood * (1 - x.progress), 0), needS = pend.reduce((s, x) => s + BLD[x.type].stone * (1 - x.progress), 0);
  const foodGoal = m * (season === 2 ? 30 : season === 3 ? 14 : 16);
  const scarce = tr.stock.food < m * 4; // disette : tout le monde s'y met
  const w = [];
  w.push(['food', (tr.stock.food < foodGoal ? 3 + (foodGoal - tr.stock.food) / Math.max(1, foodGoal) * 3 : 0.4) * (role === 'chasseur' || role === 'cueilleur' ? 2.2 : 1) * (scarce ? 2.5 : 1)]);
  w.push(['wood', (tr.stock.wood < needW + 10 + (season >= 2 ? m * 1.5 : 0) ? 1.6 + b.genes.str : 0.2) * (role === 'artisan' || role === 'batisseur' ? 2 : 1)]);
  w.push(['stone', (tr.stock.stone < needS + 6 ? 1.1 + b.genes.str * 0.5 : 0.1) * (role === 'artisan' ? 2 : 1)]);
  if (pend.length) w.push(['build', (2.2 + b.skills.build * 2) * (role === 'batisseur' ? 2.5 : 1)]);
  const fields = S.buildings.filter((x) => x.type === 'champ' && x.tribeId === tr.id && (S.tiles.crop[idx(x.x, x.y)] >= 1 || (S.tiles.crop[idx(x.x, x.y)] === 0 && season < 2) || !x.done));
  if (fields.length) w.push(['farm', (2.5 + b.skills.farm * 2) * (role === 'paysan' ? 3 : 1)]);
  let tot = w.reduce((s, x) => s + x[1], 0), r = rnd() * tot, ch = 'food';
  for (const [k, v] of w) { r -= v; if (r <= 0) { ch = k; break; } }
  if (ch === 'build') { const site = pend.sort((p, q) => dist(p.x, p.y, b.x, b.y) - dist(q.x, q.y, b.x, b.y))[0]; return A('build', { target: site.id, tx: site.x + 0.5, ty: site.y + 1.3, r: 1.5 }); }
  if (ch === 'farm') { const f = fields.sort((p, q) => dist(p.x, p.y, b.x, b.y) - dist(q.x, q.y, b.x, b.y))[0]; return A('farm', { target: f.id, tx: f.x + 0.5, ty: f.y + 0.5, r: 0.8, dur: 1 }); }
  if (ch === 'wood') { const p = spiral(b.x, b.y, 22, (x, y, i) => S.tiles.tree[i] > 0.4 && S.tiles.fire[i] <= 0); if (p) return A('chop', { tx: p[0] + 0.5, ty: p[1] + 0.9, dur: 1.4, r: 0.9, tile: p }); }
  if (ch === 'stone') {
    const p = spiral(b.x, b.y, 12, (x, y, i) => S.tiles.stone[i] > 1) || (() => { const k = recall(b, tr, 'stone', 30); return k && S.tiles.stone[k[2]] > 1 ? k : spiral(b.x, b.y, 24, (x, y, i) => S.tiles.stone[i] > 1); })();
    if (p) return A('mine', { tx: p[0] + 0.5, ty: p[1] + 0.5, dur: 1.8, r: 1.3, tile: [p[0], p[1]] });
  }
  // nourriture
  const opts = [];
  const g = findBerries(b, tr, 22); if (g) opts.push([A('gather', { tx: g[0] + 0.5, ty: g[1] + 0.5, dur: 0.6, r: 0.9, spot: g[2] }), (1.5 + b.skills.gather) * (role === 'cueilleur' ? 2.5 : 1)]);
  if (has(tr, 'chasse') || b.genes.str > 0.65 || scarce) { const h = huntTarget(b, tr); if (h && h.sp !== 'wolf') opts.push([A('hunt', { target: h.id, run: true, lead: true }), (1 + b.skills.hunt * 2 + b.genes.str) * (role === 'chasseur' ? 3 : 1) * (season === 3 || scarce ? 2 : 1)]); }
  if (has(tr, 'outils') || scarce) { const f = goFish(b); if (f) opts.push([f, (0.8 + b.skills.gather) * (season === 3 || scarce ? 2.5 : 1)]); }
  // pister le gibier là où on l'a vu pour la dernière fois
  if (role === 'chasseur' && !opts.some((o) => o[0].type === 'hunt')) { const k = recall(b, tr, 'game', 32); if (k) opts.push([A('idle', { tx: k[0] + 0.5, ty: k[1] + 0.5, r: 2, dur: 0.1, track: true }), 2]); }
  if (!opts.length) return idle(b, tr);
  tot = opts.reduce((s, x) => s + x[1], 0); r = rnd() * tot;
  for (const [a, v] of opts) { r -= v; if (r <= 0) return a; }
  return opts[0][0];
}
// le commerce entre tribus : un messager porte les surplus
export function startTrade(b, from, to, give, ret) {
  for (const k in give) { from.stock[k] -= give[k]; b.carry[k] += give[k]; }
  b.act = A('trade', { tx: to.cx + 0.5 + range(-1, 1), ty: to.cy + 1.5, r: 1.8, to: to.id, give, ret, urgent: true });
  say(b, `Je pars commercer avec ${to.name}.`, 2200);
}

// ================= exécution des actions =================
function speed(b, run) {
  const st = b.age < AGE.CHILD ? 0.75 : b.age > elderAge(b) ? 0.7 : 1;
  return 7 * st * woundSpeed(b) * (0.5 + 0.55 * b.health / 100) * (b.energy < 15 ? 0.6 : 1) * (run ? 1.65 : 1) * (0.85 + b.genes.str * 0.3) * (S.snowCover > 0.5 ? 0.8 : 1);
}
// déplacement physique : pas fins, pente, obstacles, contournement
function move(b, a, dt) {
  const tx = a.tx, ty = a.ty, r = a.r ?? 0.5;
  let left = speed(b, a.run) * dt;
  while (left > 0) {
    let gx = tx, gy = ty;
    if (b.path && b.path.length) { [gx, gy] = b.path[0]; if (dist(b.x, b.y, gx, gy) < 0.35) { b.path.shift(); if (!b.path.length) b.path = null; continue; } }
    const d = dist(b.x, b.y, tx, ty);
    if (d <= r) return true;
    const step = Math.min(left, 0.35, dist(b.x, b.y, gx, gy)) || 0.01;
    const lv0 = groundLvl(b.x, b.y);
    const ang = Math.atan2(gy - b.y, gx - b.x);
    let moved = false;
    for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.45, -1.45, 2.1, -2.1]) {
      const a = ang + off * (b.turn || 1);
      const nx = b.x + Math.cos(a) * step, ny = b.y + Math.sin(a) * step;
      if (!walkable(nx, ny)) continue;
      const lv1 = groundLvl(nx, ny), slope = Math.max(0, lv1 - lv0);
      if (lv0 - lv1 >= 3 && chance(a.run ? 0.08 : 0.025)) { const dmg = range(15, 55) * (b.age > 60 ? 1.5 : 1); hurt(b, dmg, 'une chute'); addWound(b, chance(0.4) ? 'fracture' : 'plaie', dmg, 'une chute'); b.emo.fear += 20; say(b, 'Aïe ! Ma jambe !', 1400); } // gravité : on dévale
      const cost = terrainCost(nx, ny) * (1 + slope * 0.35);
      b.x = nx; b.y = ny; b.dir = Math.cos(a) - Math.sin(a) >= 0 ? 1 : -1;
      b.walk += step * 3; left -= step * cost; moved = true;
      if (off !== 0) b.stuck += step * 0.5; else b.stuck = Math.max(0, b.stuck - step * 0.3);
      break;
    }
    if (!moved) { b.stuck += 1; left -= 0.2; b.turn = -(b.turn || 1); }
    if (b.stuck > 3 && !b.path) {
      if (a.tried) { b.stuck = 0; return 'fail'; }
      a.tried = true; b.path = findPath(b.x, b.y, tx, ty); b.stuck = 0;
      if (!b.path || !b.path.length) { b.path = null; return 'fail'; }
    } else if (b.stuck > 6) { b.stuck = 0; b.path = null; return 'fail'; }
  }
  return dist(b.x, b.y, tx, ty) <= r;
}

function runAct(b, dt, tr) {
  if (b.act !== b._last) { b.path = null; b.stuck = 0; b._last = b.act; }
  const a = b.act;
  // besoins vitaux : on interrompt ce qu'on fait
  // la soif passe avant tout, puis la faim, puis l'épuisement
  if (!['fight', 'flee', 'drink', 'sip'].includes(a.type)) {
    let alt = null;
    if (b.thirst < 40 && !(b.carry.water > 0) && (b._wT ||= 0) < S.time) { b._wT = S.time + 1; const q = nearestDrink(b.x, b.y); b._wD = q ? dist(q[0], q[1], b.x, b.y) : 0; }
    if (b.thirst < 22 + (b._wD || 0) * 1.6 && b.thirst < 60) alt = b.carry.water > 0 ? A('sip', { phase: 'do', dur: 0.1 }) : goDrink(b);
    else if (b.sat < 14 && !['gather', 'hunt', 'fish', 'deposit', 'eat', 'feed', 'trade'].includes(a.type) && !(a.urgent && a.type !== 'sleep')) alt = goEat(b, tr);
    else if (b.energy < 4 && b.sat >= 14 && !a.urgent && !['sleep', 'gather', 'hunt', 'fish', 'eat', 'talk', 'listen', 'trade', 'feed'].includes(a.type)) alt = goSleep(b, tr);
    if (alt) { alt.urgent = true; b.act = alt; b.sleeping = false; b.inside = false; return; }
  }
  // réflexes : danger proche
  if (a.type !== 'flee' && a.type !== 'fight' && !b.sleeping || (b.sleeping && chance(dt))) {
    let th = threat(b, tr);
    // après une fuite, ou poussé par la faim/soif, on ne fuit que les dangers immédiats
    if (th && !th.fight && (S.time < (b.fleeCool || 0) || b.sat < 22 || b.thirst < 22) && dist(th.x, th.y, b.x, b.y) > 1.3) th = null;
    if (th) {
      if (th.fight) { b.sleeping = false; b.act = A('fight', { target: th.id, animal: th.animal, run: true }); return; }
      b.sleeping = false; b.inside = false; b.emo.fear += 20;
      const ang = Math.atan2(b.y - th.y, b.x - th.x);
      b.act = fleeAct(b, ang, 6); b.path = null; b.fleeCool = S.time + 0.8;
      if (chance(0.4)) say(b, pick(['Au secours !', 'Fuyez !', 'Aaah !', 'Cours !']), 1800);
      return;
    }
  }
  // cible mobile
  if (a.target != null && ['seek', 'heal', 'follow', 'fight'].includes(a.type)) {
    const t = a.animal ? S.animalMap.get(a.target) : byId(a.target);
    if (!t || !t.alive) { b.act = null; return; }
    a.tx = t.x; a.ty = t.y;
  }
  if (a.type === 'hunt') {
    const t = S.animalMap.get(a.target);
    if (!t || !t.alive) { b.act = null; return; }
    a.tx = t.x; a.ty = t.y; a.r = has(tr, 'chasse') ? 3.2 : 1.2;
    a.t += dt; if (a.t > 6) { b.act = null; return; }
  }
  if (a.phase === 'go') {
    if (a.maxT == null) a.maxT = 1.5 + dist(b.x, b.y, a.tx, a.ty) / speed(b, a.run) * 2.5;
    const res = move(b, a, dt);
    if (a.type === 'raid') {
      const en = enemyNear(b, tr, 6);
      if (en && chance(dt * 3)) { // tactique : se replier si l'on est en infériorité numérique
        const allies = S.gridB.near(b.x, b.y, 6).filter((o) => o.tribeId === b.tribeId && o.age > 14).length;
        const foes = S.gridB.near(b.x, b.y, 6).filter((o) => o.tribeId === en.tribeId && o.age > 14).length;
        if (foes > allies + 1) { say(b, pick(['Repli ! Ils sont trop nombreux !', 'Retraite !']), 1800); b.act = A('idle', { tx: tr.cx + 0.5, ty: tr.cy + 0.5, run: true, r: 2, dur: 0.1, urgent: true }); return; }
      }
      if (en) { b.act = A('fight', { target: en.id, run: true }); return; }
    }
    if (res === 'fail') { b.act = null; return; }
    if (res) { a.phase = 'do'; a.t = 0; onArrive(b, a, tr); }
    else { a.t += dt; if (a.t > a.maxT) { b.act = null; b.path = null; } }
    return;
  }
  // phase "faire"
  a.t += dt;
  doAct(b, a, dt, tr);
}

function fleeAct(b, ang, d) {
  for (let k = 0; k < 8; k++) {
    const a = ang + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5, x = b.x + Math.cos(a) * d, y = b.y + Math.sin(a) * d;
    if (walkable(x, y)) return A('flee', { tx: x, ty: y, run: true, r: 0.8 });
  }
  const [x, y] = randomLand(b.x, b.y, d); return A('flee', { tx: x, ty: y, run: true, r: 0.8 });
}
function threat(b, tr) {
  for (const w of S.gridA.near(b.x, b.y, 3.5)) {
    if (w.sp !== 'wolf' || !w.alive) continue;
    if (w.sat > 55 && dist(w.x, w.y, b.x, b.y) > 1.6) continue; // un loup repu passe son chemin
    const armed = has(tr, 'chasse') && isAdult(b) && b.health > 50;
    if (armed && !hasT(b, 'peureux') && (b.genes.str + b.skills.fight + b.genes.agg + (hasT(b, 'courageux') ? 0.4 : 0) > 1.1)) return { id: w.id, animal: true, fight: true, x: w.x, y: w.y };
    return { x: w.x, y: w.y };
  }
  for (const w of S.gridA.near(b.x, b.y, 4)) {
    if (!w.alive) continue;
    if (w.sp === 'bear' && w.state !== 'hibernate' && (w.state === 'attack' && w.target === b.id || dist(w.x, w.y, b.x, b.y) < 1.8)) {
      const group = S.gridB.near(b.x, b.y, 5).filter((o) => o.tribeId === b.tribeId && o.age > 16 && o.health > 50).length;
      if (group >= 3 && has(tr, 'chasse') && hasT(b, 'courageux')) return { id: w.id, animal: true, fight: true, x: w.x, y: w.y };
      return { x: w.x, y: w.y };
    }
    if (w.sp === 'boar' && w.state === 'charge' && dist(w.x, w.y, b.x, b.y) < 3) return { x: w.x, y: w.y };
  }
  const i = idx(Math.floor(b.x), Math.floor(b.y));
  if (S.fires.size) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = Math.floor(b.x) + dx, yy = Math.floor(b.y) + dy; if (inside(xx, yy) && S.tiles.fire[idx(xx, yy)] > 0) return { x: xx + 0.5, y: yy + 0.5 }; }
  if (tr?.war && b.act?.type !== 'raid') {
    const en = enemyNear(b, tr, 4);
    if (en && (isWarrior(b) || b.genes.agg > 0.6)) return { id: en.id, fight: true, x: en.x, y: en.y };
    if (en && ['fight', 'raid'].includes(en.act?.type) && dist(en.x, en.y, b.x, b.y) < (b.thirst < 25 || b.sat < 20 ? 1.5 : 3.2)) return { x: en.x, y: en.y };
  }
  return null;
}
function enemyNear(b, tr, r) {
  if (!tr?.war) return null;
  let best = null, bd = r;
  for (const o of S.gridB.near(b.x, b.y, r)) if (o.alive && o.tribeId === tr.war.target && o.age >= 12) { const d = dist(o.x, o.y, b.x, b.y); if (d < bd) { bd = d; best = o; } }
  return best;
}

function onArrive(b, a, tr) {
  switch (a.type) {
    case 'sleep': b.sleeping = true; b.inside = !!a.home; break;
    case 'gather': if (a.spot != null && S.tiles.berries[a.spot] < 1) { forget(b, 'berries', a.spot); if (tr?.know) { const k = tr.know.berries.indexOf(a.spot); if (k >= 0) tr.know.berries.splice(k, 1); } if (chance(0.3)) say(b, 'Plus rien… quelqu’un est passé avant moi.', 1600); b.act = null; return; } break;
    case 'veillee': b.sitting = true; break;
    case 'funeral': { const f = (tr?.funerals || []).find((x) => x.id === a.fid); if (f && !f.logged) { f.logged = true; log(`⚱️ Funérailles de ${f.who} : ses proches se recueillent.`, 'culture', false, [f.x, f.y]); } b.sitting = true; break; }
    case 'warm': b.inside = !!a.home; break;
    case 'seek': {
      const o = byId(a.target);
      if (!o || o.sleeping || o.act?.type === 'talk' || o.act?.type === 'listen' || o.act?.type === 'fight') { b.act = null; return; }
      const conv = conversation(b, o);
      if (a.love && !conv.love && conv.topic !== 'amour') conv.lines = conv.lines; // simple discussion
      b.act = A('talk', { phase: 'do', with: o.id, conv, line: -1, lt: 0, dur: conv.lines.length * 0.16 + 0.05 });
      o.act = A('listen', { phase: 'do', with: b.id, dur: b.act.dur + 0.1 });
      o.sleeping = false; o.path = null;
      break;
    }
    case 'explore':
      if (Math.hypot(b.x - CX, b.y - CY) > R - 2.4) touchWall(b, tr);
      break;
    case 'wall': touchWall(b, tr); break;
    case 'exit': {
      const p = S.victory && S.bmap.get(S.victory.passage);
      if (p) { S.stats.escaped = (S.stats.escaped || 0) + 1; log(`🌀 ${b.name} franchit le Passage et quitte la bulle.`, 'major', false, [b.x, b.y]); S.effects.push({ kind: 'ascend', x: b.x, y: b.y, t: 2 }); b.alive = false; b.escaped = true; S.dead.set(b.id, { name: b.name, cause: 'parti au-delà de la Paroi', died: S.time, age: b.age });
        for (const c of S.beings) if (c.alive && c.age < 3 && c.parents.includes(b.id) && !c.parents.some((pid) => { const q = byId(pid); return q && q.alive && q !== b; })) { c.alive = false; c.escaped = true; S.dead.set(c.id, { name: c.name, cause: 'parti au-delà de la Paroi', died: S.time, age: c.age }); } }
      b.act = null; break;
    }
  }
}
function touchWall(b, tr) {
  b.aware = Math.min(1, b.aware + 0.03 + b.genes.cur * 0.03 + (has(tr, 'cartographie') ? 0.06 : 0) + (has(tr, 'astronomie') ? 0.04 : 0));
  b.emo.fear += 6;
  S.effects.push({ kind: 'ripple', x: b.x, y: b.y, t: 1.2 });
  if (!b.flags.wall) {
    b.flags.wall = true;
    mem(b, 'J’ai touché la Paroi du monde. Elle est froide, lisse, infranchissable.');
    say(b, pick(['Le monde… s’arrête ici ?', 'Un mur invisible !', 'Qu’y a-t-il derrière ?', 'Je vois au travers… mais je ne passe pas.']), 3500);
    if (!S.flags.firstWall) { S.flags.firstWall = true; log(`🫧 ${b.name} est le premier à toucher la Paroi du monde.`, 'major', true, [b.x, b.y]); }
    addKnowledge(tr, 5, b);
  } else addKnowledge(tr, 1.5, b);
  if (b.aware > 0.6 && !b.wantLeave && (has(tr, 'philosophie') || b.aware > 0.85) && chance(0.2 + b.genes.cur * 0.3)) { b.wantLeave = true; mem(b, 'Je veux sortir de ce monde.'); log(`🚪 ${b.name} veut quitter la bulle.`, 'question', false, [b.x, b.y]); }
}

function doAct(b, a, dt, tr) {
  const done = () => { b.act = null; };
  const prod = (k, v) => { const P = (S.stats.prod ||= {}); P[k] = (P[k] || 0) + v; };
  const timeUp = a.dur != null && a.t >= a.dur;
  const learn = (k, r = 0.02) => { b.skills[k] = Math.min(1, b.skills[k] + dt * r * (0.4 + b.genes.int) * (1 - b.skills[k])); };
  const tools = has(tr, 'metal') ? 1.9 : has(tr, 'outils') ? 1.45 : 1;
  switch (a.type) {
    case 'drink': if (timeUp) { b.thirst = 100; if (has(tr, 'poterie')) b.carry.water = 3; done(); } break;
    case 'sip': if (timeUp) { b.thirst = Math.min(100, b.thirst + 45); b.carry.water = Math.max(0, b.carry.water - 1); done(); } break;
    case 'veillee': {
      b.sitting = true; b.social = Math.min(100, b.social + dt * 20); b.emo.joy += dt * (a.fest ? 12 : 5); b.emo.sadness *= 1 - dt * 0.15;
      b.dir = tr && tr.cx + 0.5 - (tr.cy + 0.5) > b.x - b.y ? 1 : -1;
      const teller = b.role === 'chaman' || b.role === 'sage' || b.role === 'ancien' || b.age > 50;
      if (a.fest) b.walk += dt * 5;
      if (tr && chance(dt * (teller ? 2.2 : 0.7)) && performance.now() > (b.say?.until || 0)) {
        const l = veilleeLine(b, tr); say(b, l.text, 3000); b.singing = l.song ? performance.now() + 3000 : 0;
        for (const o of S.gridB.near(b.x, b.y, 4)) if (o !== b && o.act?.type === 'veillee') { addRel(o, b, 1.5); if (l.myth) o.faith = Math.min(1, o.faith + 0.01); if (l.song) o.emo.joy += 3; }
        addKnowledge(tr, l.myth ? 0.8 : 0.3, b);
      }
      if (timeUp || hourNow() > 23.3 || hourNow() < 5) { b.sitting = false; done(); }
    } break;
    case 'funeral': if (timeUp) { b.grief *= 0.75; b.emo.sadness *= 0.85; b.social = Math.min(100, b.social + 20); b.sitting = false; if (chance(0.3)) say(b, pick(['Repose en paix.', 'Nous ne t’oublierons pas.', 'Que le Créateur t’accueille.']), 2400); done(); } else b.sitting = true; break;
    case 'feed': {
      const o = byId(a.target); if (!o || !o.alive) return done();
      if (b.carry.food >= 1) b.carry.food -= 1; else if (tr && tr.stock.food >= 1) tr.stock.food -= 1.5; else return done();
      o.sat = Math.min(100, o.sat + 40); addRel(o, b, 15); addRel(b, o, 4); b.emo.joy += 6; o.emo.joy += 10;
      say(b, pick(['Mange, ça va aller.', 'Tiens, prends ça.', 'Reprends des forces.']), 1800);
      if (chance(0.25)) log(`🤲 ${b.name} nourrit ${o.name}${o.disease ? ', malade' : o.age > 64 ? ', son aîné' : o.wounds?.length ? ', blessé' : ''}.`, 'social', false, [b.x, b.y]);
      mem(o, `${b.name} m’a nourri quand j’étais faible.`); done();
    } break;
    case 'rally': {
      const band = tr?.band;
      if (!band || !tr.war) return done();
      if (!timeUp) break;
      const ready = band.ids.map(byId).filter((o) => o && o.alive && o.act?.type === 'rally' && dist(o.x, o.y, tr.cx, tr.cy) < 4);
      if (ready.length >= 3 || (S.time - band.t0 > 5 && ready.length >= 2)) {
        const en = tribeById(tr.war.target);
        if (en?.alive) {
          for (const o of ready) { o.act = A('raid', { tx: en.cx + 0.5 + range(-1.5, 1.5), ty: en.cy + 0.5 + range(-1.5, 1.5), r: 2.2, enemy: en.id }); o.path = null; }
          log(`⚔️ Une bande de ${ready.length} guerriers de ${tr.name} part à l’assaut de ${en.name}.`, 'war', false, [tr.cx, tr.cy]);
          say(b, pick(['En avant !', 'Pour notre peuple !', 'À l’attaque !']), 2000);
        }
        tr.band = null; tr.nextRaid = S.time + range(10, 26); return;
      }
      if (S.time - band.t0 > 8) { tr.band = null; tr.nextRaid = S.time + 6; }
      done();
    } break;
    case 'trade': {
      const to = tribeById(a.to);
      if (to?.alive && tr) {
        for (const k in a.give) { to.stock[k] += b.carry[k]; b.carry[k] = 0; }
        for (const k in a.ret) { const q = Math.min(a.ret[k], to.stock[k]); to.stock[k] -= q; b.carry[k] += q; }
        tr.rel[to.id] = (tr.rel[to.id] || 0) + 8; to.rel[tr.id] = (to.rel[tr.id] || 0) + 8;
        const fmt = (o) => Object.entries(o).map(([k, v]) => `${Math.round(v)} ${({ food: 'vivres', wood: 'bois', stone: 'pierre' })[k]}`).join(', ');
        log(`🤝 Commerce : ${b.name} (${tr.name}) échange ${fmt(a.give)} contre ${fmt(a.ret)} avec ${to.name}.`, 'trade', false, [b.x, b.y]);
        // diffusion culturelle : on rapporte des idées
        const lack = Object.keys(to.tech).filter((t) => !tr.tech[t]);
        if (lack.length && chance(0.5)) { addKnowledge(tr, 12 + b.genes.int * 10, b); mem(b, `Chez ${to.name}, j’ai vu des choses étonnantes.`); }
        for (const o of S.gridB.near(b.x, b.y, 4)) if (o.tribeId === to.id) { addRel(o, b, 6); addRel(b, o, 6); }
      }
      done();
    } break;
    case 'patrol': if (timeUp) done(); break;
    case 'eat': if (timeUp) {
      const val = 24 * (has(tr, 'feu') ? 1.3 : 1);
      let n = Math.max(1, Math.ceil((92 - b.sat) / val));
      if (a.src === 'carry') { const k = Math.min(n, b.carry.food); b.carry.food -= k; b.sat += k * val; }
      else if (tr) { const k = Math.min(n, Math.floor(tr.stock.food)); tr.stock.food -= k; b.sat += k * val; if (k === 0) b.emo.anger += 5; }
      if (!has(tr, 'feu') && chance(0.004)) infect(b, DISEASES[3]);
      done();
    } break;
    case 'gather': if (timeUp) {
      const [x, y] = [Math.floor(a.tx), Math.floor(a.ty)], i = idx(x, y);
      const take = Math.min(S.tiles.berries[i], 2.4 + b.skills.gather * 2.5 * tools + rnd());
      S.tiles.berries[i] -= take; learn('gather', 0.5);
      if (a.eat) { b.sat += take * 18; } else b.carry.food += take * 0.9;
      prod('baies', take * 0.9);
      done();
    } break;
    case 'fish': if (timeUp) {
      let got = 0;
      for (let d = 0; d < 8; d++) { const xx = Math.floor(a.tx) + [1, -1, 0, 0, 1, 1, -1, -1][d], yy = Math.floor(a.ty) + [0, 0, 1, -1, 1, -1, 1, -1][d]; if (isWater(xx, yy)) { const j = idx(xx, yy); if (S.tiles.fish[j] > 1 && chance(0.35 + b.skills.gather * 0.5)) { const k = Math.min(S.tiles.fish[j], 1 + rnd() * 2 * tools); S.tiles.fish[j] -= k; got += k; } } if (got > 2) break; }
      b.carry.food += got; prod('pêche', got); learn('gather', 0.3); if (got) say(b, pick(['Un poisson !', 'Belle prise.']), 1500); done();
    } break;
    case 'chop': if (timeUp) {
      const i = idx(a.tile[0], a.tile[1]);
      if (S.tiles.tree[i] > 0.1) { const k = (1.6 + b.genes.str * 1.6) * tools; b.carry.wood += k; S.tiles.tree[i] = Math.max(0, S.tiles.tree[i] - 0.3); if (S.tiles.tree[i] < 0.08) S.tiles.tree[i] = 0; }
      learn('craft', 0.2); done();
    } break;
    case 'mine': if (timeUp) {
      const i = idx(a.tile[0], a.tile[1]);
      const k = Math.min(S.tiles.stone[i], (1.4 + b.genes.str * 1.6) * tools); S.tiles.stone[i] -= k; b.carry.stone += k;
      if (S.tiles.stone[i] < 0.5 && S.tiles.type[i] !== T.ROCK && S.tiles.type[i] !== T.SNOW) S.tiles.stone[i] = 0;
      learn('craft', 0.2); done();
    } break;
    case 'deposit': if (tr) { tr.stock.food += b.carry.food; tr.stock.wood += b.carry.wood; tr.stock.stone += b.carry.stone; tribeSpots(tr, b); } b.carry = { food: 0, wood: 0, stone: 0, water: b.carry.water || 0 }; done(); break;
    case 'build': {
      const s = S.bmap.get(a.target);
      if (!s || s.done) return done();
      const d = BLD[s.type], dp = dt * (0.6 + b.skills.build * 1.4) * (has(tr, 'ingenierie') ? 1.4 : 1) / d.work;
      const nw = d.wood * dp, ns = d.stone * dp;
      if (!tr || tr.stock.wood < nw || tr.stock.stone < ns) { // il manque des matériaux
        if (tr && tr.stock.wood < nw) { const p = spiral(b.x, b.y, 22, (x, y, i) => S.tiles.tree[i] > 0.4); if (p) { b.act = A('chop', { tx: p[0] + 0.5, ty: p[1] + 0.9, dur: 1.4, r: 0.9, tile: p }); return; } }
        if (tr && tr.stock.stone < ns) { const p = spiral(b.x, b.y, 24, (x, y, i) => S.tiles.stone[i] > 1); if (p) { b.act = A('mine', { tx: p[0] + 0.5, ty: p[1] + 0.5, dur: 1.8, r: 1.3, tile: p }); return; } }
        return done();
      }
      tr.stock.wood -= nw; tr.stock.stone -= ns; s.progress += dp; learn('build', 0.15); b.walk += dt * 8;
      if (s.progress >= 1) completeBuilding(s, b, tr);
      if (a.t > 2.5) done();
    } break;
    case 'farm': {
      const f = S.bmap.get(a.target); if (!f) return done();
      if (!f.done) { f.progress += dt / BLD.champ.work; if (f.progress >= 1) { f.done = true; f.progress = 1; } if (a.t > 1.2) done(); break; }
      if (!timeUp) { b.walk += dt * 4; break; }
      const i = idx(f.x, f.y); const { season } = timeInfo();
      if (S.tiles.crop[i] >= 1) { const k = (7 + b.skills.farm * 7) * (has(tr, 'metal') ? 1.3 : 1); b.carry.food += k; prod('récoltes', k); S.tiles.crop[i] = 0; if (season < 2) S.tiles.crop[i] = 0.02; say(b, 'Belle récolte !', 1400); }
      else if (S.tiles.crop[i] === 0 && season < 2) S.tiles.crop[i] = 0.02;
      learn('farm', 0.4); done();
    } break;
    case 'sleep': {
      b.sleeping = true;
      const h = S.time % 24, morning = h >= 6 && h < 20;
      if ((b.energy >= 98 && (morning || !isNight())) || (a.sick && b.disease && b.disease.sev < 25 && b.energy > 90) || (!a.sick && morning && b.energy > 60 && a.t > 3)) { b.sleeping = false; b.inside = false; if (chance(0.25)) mem(b, 'Rêve : ' + dream(b)); done(); break; }
      // intimité et conception
      if (b.partner && b.sex === 'F' && chance(dt * 0.6)) tryConceive(b, tr);
      if ((b.sat < 12 || b.thirst < 12) && b.energy > 25) { b.sleeping = false; b.inside = false; done(); }
    } break;
    case 'warm': if (timeUp || b.cold < 0.1) { b.inside = false; done(); } break;
    case 'talk': {
      const o = byId(a.with); if (!o || !o.alive) return done();
      a.lt -= dt; b.social = Math.min(100, b.social + dt * 25); o.social = Math.min(100, o.social + dt * 25);
      b.dir = o.x - o.y > b.x - b.y ? 1 : -1; o.dir = -b.dir;
      if (a.lt <= 0) {
        a.line++; a.lt = 0.16;
        if (a.line < a.conv.lines.length) { const [sp, text] = a.conv.lines[a.line]; say(sp, text, 3000); }
        else {
          const { d, know } = finishConversation(b, o, a.conv);
          addRel(b, o, d); addRel(o, b, d * 0.9);
          if (b.tribeId === o.tribeId || has(tr, 'langage')) { shareSpots(b, o); shareSpots(o, b); }
          if (tr) addKnowledge(tr, know * (0.5 + (b.genes.int + o.genes.int) / 2) * (has(tr, 'langage') ? 1.3 : 1), chance(0.3) ? b : o);
          if (a.conv.topic === 'amour') {
            if (a.conv.love) {
              b.partner = o.id; o.partner = b.id; b.emo.love = 80; o.emo.love = 80; b.emo.joy += 30; o.emo.joy += 30;
              if (o.home) b.home = o.home; else o.home = b.home;
              mem(b, `${o.name} et moi sommes ensemble.`); mem(o, `${b.name} et moi sommes ensemble.`);
              const tb = tribeById(b.tribeId), to = tribeById(o.tribeId);
              if (tb && to && tb !== to) { if (to.members.length < tb.members.length) { o.tribeId = b.tribeId; o.home = b.home; } else { b.tribeId = o.tribeId; b.home = o.home; } tb.rel[to.id] = (tb.rel[to.id] || 0) + 15; to.rel[tb.id] = (to.rel[tb.id] || 0) + 15; }
              const tw = tribeById(b.tribeId);
              if (has(tw, 'spiritualite')) { log(`💍 Mariage de ${b.name} et ${o.name} chez ${tw.name} ! Toute la tribu fait la fête.`, 'love', false, [b.x, b.y]); tw.festival = { name: 'Noces', until: S.time + 18 }; for (const m of tw.members) m.emo.joy += 10; }
              else log(`❤️ ${b.name} et ${o.name} s’aiment.`, 'love', false, [b.x, b.y]);
            } else {
              b.emo.sadness += 20; mem(b, `${o.name} m’a repoussé.`);
              const jealous = o.partner && byId(o.partner);
              if (jealous && dist(jealous.x, jealous.y, b.x, b.y) < 8) { addRel(jealous, b, -35); jealous.emo.anger += 35; say(jealous, pick(['Ne touche pas à ce qui est à moi !', 'Éloigne-toi d’elle !', 'Je t’ai vu !']), 2500); if (jealous.genes.agg > 0.6 && chance(0.5)) jealous.act = A('fight', { target: b.id, duel: true, run: true }); }
            }
          }
          if (a.conv.topic === 'dispute' && b.emo.anger > 60 && b.genes.agg > 0.6 && chance(0.45)) { b.act = A('fight', { target: o.id, duel: true, run: true, phase: 'go' }); return; }
          o.act = null; done();
        }
      }
    } break;
    case 'listen': if (timeUp) done(); break;
    case 'think': if (timeUp) {
      addKnowledge(tr, b.genes.int * (0.5 + b.genes.cur) * 2.2 * (1 + b.skills.lore), b); learn('lore', 0.6);
      if (has(tr, 'astronomie') || has(tr, 'philosophie')) b.aware = Math.min(1, b.aware + 0.012);
      done();
    } break;
    case 'pray': if (timeUp) {
      b.faith = Math.min(1, b.faith + 0.025 * (0.5 + b.genes.spi)); b.emo.fear *= 0.8; b.emo.joy += 4;
      S.god.energy = Math.min(S.god.max, S.god.energy + 0.6 * (a.temple ? 2.2 : 1) * (0.3 + b.faith));
      if (chance(0.15)) say(b, pick(['Ô Créateur, entends-moi.', 'Protège les miens.', 'Donne-nous la pluie.', 'Montre-toi !', 'Pardonne-nous.']), 2200);
      done();
    } break;
    case 'mourn': if (timeUp) { b.grief *= 0.7; b.emo.sadness *= 0.8; done(); } break;
    case 'wall': if (timeUp) {
      b.emo.sadness += 8;
      say(b, pick(['Laisse-nous sortir !', 'Il doit y avoir un moyen…', 'Je vois les étoiles de l’autre côté.', 'Pourquoi nous enfermer ?']), 3000);
      if (has(tr, 'bulle') && chance(0.3)) addKnowledge(tr, 3, b);
      done();
    } break;
    case 'heal': {
      const o = byId(a.target);
      if (!o || (!o.disease && !o.wounds?.length)) return done();
      if (timeUp || a.t > 1) { if (o.disease) { o.disease.sev -= 25 * (0.5 + b.skills.heal * 1.5); o.treated = true; } for (const w of o.wounds || []) { w.treated = true; w.infected = false; } learn('heal', 0.8); addRel(o, b, 10); say(b, 'Bois ça, ça va aller.', 1800); done(); }
    } break;
    case 'follow': case 'play': case 'idle': case 'explore': if (timeUp || a.dur == null) { if (a.with) { const o = byId(a.with); if (o) { addRel(b, o, 3); b.social = Math.min(100, b.social + 15); b.emo.joy += 6; } } done(); } else if (a.type === 'play') b.walk += dt * 6; break;
    case 'flee': done(); break;
    case 'raid': { // arrivé chez l'ennemi
      const en = tribeById(a.enemy);
      if (en && en.alive) {
        const loot = Math.min(en.stock.food, 6); en.stock.food -= loot; b.carry.food += loot;
        if (has(tr, 'feu') && b.genes.agg > 0.6 && chance(0.25)) { const h = S.buildings.find((x) => x.tribeId === en.id && (x.type === 'hutte' || x.type === 'grenier') && x.done); if (h) { ignite(h.x, h.y, 1); log(`🔥 ${b.name} met le feu au village de ${en.name} !`, 'war', false, [h.x, h.y]); } }
      }
      done();
    } break;
    case 'fight': fight(b, a, dt, tr); break;
    case 'hunt': hunt(b, a, dt, tr); break;
    default: done();
  }
}

function fight(b, a, dt, tr) {
  const t = a.animal ? S.animalMap.get(a.target) : byId(a.target);
  if (!t || !t.alive) { b.act = null; return; }
  if (dist(b.x, b.y, t.x, t.y) > 1.4) { a.phase = 'go'; a.r = 1; return; }
  a.cd = (a.cd || 0) - dt;
  if (a.cd > 0) return;
  a.cd = 0.12; b.walk += 2; b.dir = t.x - t.y > b.x - b.y ? 1 : -1;
  const weapon = has(tr, 'metal') ? 9 : has(tr, 'chasse') ? 4 : 0;
  const dmg = (5 + b.genes.str * 10 + b.skills.fight * 10 + weapon) * range(0.3, 1.1) * (b.health / 100 * 0.5 + 0.5);
  b.skills.fight = Math.min(1, b.skills.fight + 0.004);
  S.effects.push({ kind: 'hit', x: t.x, y: t.y, t: 0.25 });
  if (a.animal) {
    t.health -= dmg; if (t.sp === 'bear' && t.state !== 'attack') { t.state = 'attack'; t.target = b.id; }
    if (t.health <= 0) { t.alive = false; t.cause = 'tué'; b.carry.food += SPECIES[t.sp].meat * 0.6; addFear(t.x, t.y, 0.8); log(`${t.sp === 'bear' ? '🐻' : t.sp === 'boar' ? '🐗' : '🐺'} ${b.name} a tué un${t.sp === 'boar' ? '' : ''} ${SPECIES[t.sp].name.toLowerCase()}.`, 'info', false, [t.x, t.y]); b.act = null; if (t.sp === 'bear' && tr) addMyth(tr, `${b.name}, celui qui vainquit l’ours`); }
    return;
  }
  hurt(t, dmg, a.duel ? 'une rixe' : 'la guerre', b.id);
  if (chance(0.3)) addWound(t, chance(0.12) ? 'fracture' : 'plaie', dmg * 1.2, a.duel ? 'une rixe' : 'la guerre');
  if (!a.duel && chance(0.2)) callHelp(t, b);
  t.emo.fear += 6; t.emo.anger += 8; addRel(t, b, -6);
  if (t.act?.type !== 'fight' && t.age >= 12 && (t.genes.agg + t.genes.str > 0.8 || chance(0.4))) { t.sleeping = false; t.inside = false; t.act = A('fight', { target: b.id, duel: a.duel, run: true, phase: 'do' }); }
  if (chance(0.15)) say(b, pick(['Prends ça !', 'Meurs !', 'Pour les miens !', 'Rends-toi !']), 1200);
  if (!a.duel && t.health < 32 && t.health > 0 && chance(0.55)) { // l'ennemi blessé s'enfuit, on ne l'achève pas toujours
    b.act = null; t.act = fleeAct(t, Math.atan2(t.y - b.y, t.x - b.x), 8); t.emo.fear += 30; mem(t, `${b.name} m’a blessé au combat.`); if (chance(0.5)) say(t, pick(['Pitié !', 'Je me rends !', 'Retraite !']), 1600); return;
  }
  if (a.duel && t.health < 45) { b.act = null; t.act = null; addRel(t, b, -30); mem(t, `${b.name} m’a battu.`); log(`👊 ${b.name} a battu ${t.name} lors d’une rixe.`, 'social', false, [b.x, b.y]); return; }
  if (b.health < 28 && chance(0.5)) { b.act = fleeAct(b, Math.atan2(b.y - t.y, b.x - t.x), 7); b.path = null; }
}
function hunt(b, a, dt, tr) {
  const t = S.animalMap.get(a.target);
  if (!t || !t.alive) { b.act = null; return; }
  const d = dist(b.x, b.y, t.x, t.y);
  if (d > (a.r || 1.2) + 0.6) { a.phase = 'go'; return; }
  // chasse collective : on appelle les autres chasseurs
  if (a.lead && !a.called && has(tr, 'chasse')) {
    a.called = true; let n = 0;
    for (const o of S.gridB.near(b.x, b.y, 10)) {
      if (n >= (t.sp === 'bear' ? 4 : 2) || o === b || !o.alive || o.tribeId !== b.tribeId || o.age < 15 || o.sleeping || ['fight', 'flee', 'talk', 'hunt', 'trade', 'raid', 'rally'].includes(o.act?.type) || o.act?.urgent) continue;
      if (o.role !== 'chasseur' && o.genes.str < 0.55) continue;
      o.act = A('hunt', { target: t.id, run: true }); n++;
    }
    if (n) { say(b, pick(['Encerclez-le !', 'Par ici, les chasseurs !', 'On le prend à revers !']), 1600); if (chance(0.25)) log(`🏹 ${b.name} mène une chasse en groupe (${n + 1} chasseurs).`, 'info', false, [b.x, b.y]); }
  }
  const spear = has(tr, 'chasse');
  const helpers = S.gridB.near(t.x, t.y, 4).filter((o) => o.tribeId === b.tribeId && o.act?.type === 'hunt' && o.act.target === t.id).length - 1;
  const sp = SPECIES[t.sp];
  let p = ((spear ? 0.48 : 0.16) + b.skills.hunt * 0.45 + (has(tr, 'metal') ? 0.1 : 0) - (t.sp === 'rabbit' ? 0.12 : 0) + Math.max(0, helpers) * 0.12 + (1 - t.health / sp.hp) * 0.3 - t.fear * 0.15) * (t.sp === 'bear' ? 0.35 : t.sp === 'boar' ? 0.7 : 1);
  if (spear) S.projectiles.push({ x: b.x, y: b.y, z: 0.5, vx: (t.x - b.x) / 0.5, vy: (t.y - b.y) / 0.5, vz: 4.9 * 0.5, t: 0, life: 0.5 }); // tir balistique (g ≈ 9.8)
  b.skills.hunt = Math.min(1, b.skills.hunt + 0.02 * (0.4 + b.genes.int));
  if (chance(p)) {
    if (t.sp === 'bear' || t.sp === 'boar') { t.health -= (25 + b.genes.str * 20) * (has(tr, 'metal') ? 1.5 : 1); if (t.health > 0) { t.state = t.sp === 'bear' ? 'attack' : 'charge'; t.target = b.id; b.act = null; return; } }
    t.alive = false; t.cause = 'chassé'; (S.adeaths ||= {})[t.sp + ':chasse'] = (S.adeaths[t.sp + ':chasse'] || 0) + 1;
    addFear(t.x, t.y, 0.5); // les autres bêtes apprennent à fuir ce lieu
    const share = Math.max(1, helpers + 1);
    b.carry.food += sp.meat / share * (share > 1 ? 1.3 : 1); (S.stats.prod ||= {}).chasse = (S.stats.prod.chasse || 0) + sp.meat * (share > 1 ? 1.3 : 1);
    for (const o of S.gridB.near(t.x, t.y, 4)) if (o !== b && o.act?.type === 'hunt' && o.act.target === t.id) { o.carry.food += sp.meat / share * 1.3; o.act = null; addRel(o, b, 4); }
    say(b, pick(['Touché !', 'On mangera ce soir !', 'Merci, frère cerf.', 'Belle chasse, mes frères !']), 1600);
    if (!S.flags.firstHunt) { S.flags.firstHunt = true; log(`🦌 Première chasse réussie par ${b.name}.`, 'info', false, [b.x, b.y]); }
    if (t.sp === 'bear' && tr) { log(`🐻 Les chasseurs de ${tr.name} ont abattu un ours !`, 'major', false, [t.x, t.y]); addMyth(tr, `La chasse de l’ours menée par ${b.name}`); }
  } else {
    if (t.sp === 'boar' && t.age > SPECIES.boar.mature && chance(0.45)) { t.state = 'charge'; t.target = b.id; }
    else if (t.sp !== 'wolf' && t.sp !== 'bear') t.fleeFrom = { x: b.x, y: b.y };
    else if (t.sp === 'bear') { t.state = 'attack'; t.target = b.id; }
  }
  b.act = null;
}
function tryConceive(b, tr) {
  const p = byId(b.partner);
  if (!p || !p.alive || p.sex === b.sex || b.pregnant || !p.sleeping || dist(p.x, p.y, b.x, b.y) > 2.5) return;
  if (b.age < 16 || b.age > 46 || p.age < 16 || b.sat < 35 || b.health < 50) return;
  const popF = clamp(1 - S.beings.length / MAX_POP) ** 0.7;
  const kids = b.children.filter((id) => { const c = byId(id); return c && c.alive && c.age < 3; }).length;
  const famine = tr && (tr.famine || tr.stock.food / Math.max(1, tr.members.length) < 6) ? 0.35 : 1;
  const pr = famine * 0.16 * (0.4 + b.genes.fert) * (0.4 + p.genes.fert) * popF * (kids ? 0.35 : 1) * (b.flags.blessed > S.time ? 3 : 1) * (tr?.dogma === 'fertilite' ? 1.8 : 1) * (b.age > 38 ? 0.5 : 1);
  if (chance(pr)) { b.pregnant = { father: p.id, t: 0 }; mem(b, 'Je porte un enfant.'); mem(p, `${b.name} attend un enfant de moi.`); }
}
function dream(b) {
  return pick(['je volais au-dessus du dôme.', 'un œil immense me regardait.', `${b.lostName || 'un ancêtre'} me parlait.`, 'la Paroi se brisait en mille éclats de lumière.', 'il n’y avait plus de faim.', 'je tombais sans fin dans le noir.', 'un monde infini, sans bord.']);
}
function completeBuilding(s, b, tr) {
  s.done = true; s.progress = 1; s.built = S.time;
  const n = BLD[s.type].name;
  if (s.type === 'passage') {
    log(`🌀✨ LE PASSAGE EST ACHEVÉ ! ${tr.name} a percé la Paroi du monde.`, 'major', true, [s.x, s.y]);
    S.victory = { t: S.time, tribe: tr.name, passage: s.id };
  } else log(`🔨 ${tr?.name || ''} : ${n} terminé${s.type === 'temple' || s.type === 'champ' ? '' : 'e'}${b ? ` (par ${b.name})` : ''}.`, 'build', false, [s.x, s.y]);
  if ((s.type === 'hutte' || s.type === 'maison') && tr) {
    // attribuer le logement à une famille
    const cap = BLD[s.type].cap; let n0 = 0;
    const homeless = tr.members.filter((m) => !m.home || !S.bmap.get(m.home)?.done).sort((p, q) => (q.partner ? 1 : 0) - (p.partner ? 1 : 0));
    for (const m of homeless) {
      if (n0 >= cap) break; if (m.age < 16) continue;
      m.home = s.id; n0++;
      const p = byId(m.partner); if (p && n0 < cap) { p.home = s.id; n0++; }
      for (const cid of m.children) { const c = byId(cid); if (c && c.alive && c.age < 16 && n0 < cap + 2) { c.home = s.id; n0++; } }
    }
  }
}

// rafraîchit la répartition des logements (appelé chaque jour)
export function housing(tr) {
  for (const m of tr.members) {
    if (m.home && !S.bmap.get(m.home)) m.home = null;
    if (!m.home && m.age < 16) { const p = byId(m.parents[0]) || byId(m.parents[1]); if (p?.home) m.home = p.home; }
  }
}
