// ===== FAUNE : troupeaux, meutes, prédateurs, peur apprise =====
import { N, R, CX, CY, T, HOURS_PER_YEAR } from './config.js';
import { S, walkable, randomLand, idx, inside, timeInfo, isNight, terrainCost, spiral, nearWater } from './world.js';
import { rnd, range, chance, clamp, dist, pick } from './util.js';
import { hurt, say, byId, mem } from './beings.js';
import { log, has, tribeById } from './society.js';

export const SPECIES = {
  deer: { name: 'Cerf', speed: 5.2, life: 14, mature: 1.5, gest: 8 * 24, litter: 1, max: 55, diet: 'herb', hp: 60, flight: 5, social: 'herd', meat: 10 },
  rabbit: { name: 'Lapin', speed: 4.6, life: 5, mature: 0.4, gest: 3 * 24, litter: 3, max: 90, diet: 'herb', hp: 15, flight: 3, social: 'solo', meat: 2 },
  boar: { name: 'Sanglier', speed: 4.8, life: 12, mature: 1.5, gest: 6 * 24, litter: 3, max: 24, diet: 'omni', hp: 95, flight: 3, social: 'herd', meat: 9 },
  wolf: { name: 'Loup', speed: 6.2, life: 11, mature: 1.5, gest: 6 * 24, litter: 2, max: 11, diet: 'carn', hp: 70, flight: 0, social: 'pack', meat: 3 },
  bear: { name: 'Ours', speed: 5, life: 24, mature: 3, gest: 10 * 24, litter: 1, max: 4, diet: 'omni', hp: 230, flight: 0, social: 'solo', meat: 18 },
};
export const isPrey = (a) => a.sp === 'deer' || a.sp === 'rabbit' || a.sp === 'boar';

// ---- carte de la peur : les animaux apprennent où l'on chasse ----
const FC = 6, FW = Math.ceil(N / FC);
const fearIdx = (x, y) => clamp(Math.floor(y / FC), 0, FW - 1) * FW + clamp(Math.floor(x / FC), 0, FW - 1);
export function addFear(x, y, v) { (S.fearMap ||= new Float32Array(FW * FW)); S.fearMap[fearIdx(x, y)] = Math.min(3, S.fearMap[fearIdx(x, y)] + v); }
const fearAt = (x, y) => (S.fearMap ? S.fearMap[fearIdx(x, y)] : 0);
export function fearDaily() { if (S.fearMap) for (let i = 0; i < S.fearMap.length; i++) S.fearMap[i] *= 0.92; }

export function spawnAnimal(sp, x, y, age = null, extra = {}) {
  const d = SPECIES[sp];
  if (!walkable(x, y)) [x, y] = randomLand(x, y, 4);
  const a = {
    id: S.nextId++, sp, x, y, age: age ?? range(0.5, d.life * 0.6), sex: chance(0.5) ? 'F' : 'M', sat: range(50, 90), thirst: range(60, 100),
    health: d.hp, alive: true, tx: x, ty: y, wait: 0, dir: 1, walk: 0, preg: null, fleeFrom: null, fear: 0, state: 'roam', group: null, mother: null, ...extra,
  };
  S.animals.push(a); return a;
}

// ---- organisation sociale (recalculée chaque pas) ----
let groups = new Map();
function organize() {
  groups = new Map();
  for (const a of S.animals) {
    if (!a.alive || a.group == null) continue;
    let g = groups.get(a.group); if (!g) groups.set(a.group, (g = { members: [], leader: null }));
    g.members.push(a);
    // meneur : la femelle la plus âgée (troupeau) ou le mâle dominant (meute)
    const score = a.age + (SPECIES[a.sp].social === 'pack' ? (a.sex === 'M' ? 4 : 0) : (a.sex === 'F' ? 4 : 0));
    if (!g.leader || score > g.leader._score) { a._score = score; g.leader = a; }
  }
  // dispersion : une meute trop grande se scinde, les jeunes fondent la leur
  for (const [id, g] of groups) if (g.members[0]?.sp === 'wolf' && g.members.length > 6) {
    const nid = 'p' + S.nextId++, young = g.members.filter((m) => m !== g.leader).sort((p, q) => p.age - q.age).slice(0, 3);
    const [x, y] = randomLand(young[0].x, young[0].y, 20);
    for (const m of young) { m.group = nid; m.tx = x; m.ty = y; }
    log('🐺 De jeunes loups quittent leur meute pour fonder la leur.', 'info', false, [x, y]);
  }
  (S.groupState ||= {});
  for (const [id, g] of groups) S.groupState[id] ||= { alarm: null, dest: null, den: null };
}

export function animalsStep(dt) {
  const { season } = timeInfo();
  const counts = { deer: 0, rabbit: 0, wolf: 0, boar: 0, bear: 0 };
  for (const a of S.animals) if (a.alive) counts[a.sp]++;
  S.speciesCount = counts;
  organize();
  for (const a of S.animals) {
    if (!a.alive) continue;
    const d = SPECIES[a.sp];
    a.age += dt / HOURS_PER_YEAR;
    const hib = a.state === 'hibernate';
    a.sat -= dt * (hib ? 0.15 : d.diet === 'herb' ? 1.2 : 1.05);
    a.thirst = clamp((a.thirst ?? 80) - dt * (hib ? 0 : a.sp === 'rabbit' ? 0.5 : d.diet === 'herb' ? 1.1 : 1.4), 0, 100);
    if (d.diet !== 'carn' && !hib) graze(a, d, dt, season);
    if (a.sat <= 0) { a.health -= dt * 3; a.cause = 'faim'; }
    if (a.thirst <= 0) { a.health -= dt * 4; a.cause = 'soif'; }
    if (a.health < d.hp && a.sat > 40) a.health = Math.min(d.hp, a.health + dt * 0.8);
    if (a.age > d.life || a.health <= 0) { if (a.age > d.life) a.cause = 'âge'; (S.adeaths ||= {})[a.sp + ':' + (a.cause || '?')] = ((S.adeaths || {})[a.sp + ':' + (a.cause || '?')] || 0) + 1; a.alive = false; S.effects.push({ kind: 'carcass', x: a.x, y: a.y, t: 24, sp: a.sp }); continue; }
    // reproduction saisonnière
    if (a.preg != null) {
      a.preg += dt;
      if (a.preg >= d.gest) { a.preg = null; const n = (a.sp === 'bear' || a.sp === 'deer') && chance(0.35) ? d.litter + 1 : d.litter; for (let k = 0; k < n; k++) if (counts[a.sp] < d.max) { spawnAnimal(a.sp, a.x + range(-0.3, 0.3), a.y + range(-0.3, 0.3), 0, { group: a.group, mother: a.id, sat: 80 }); counts[a.sp]++; } }
    } else if (a.sex === 'F' && a.age > d.mature && a.sat > 50 && season <= 1 && counts[a.sp] < d.max && chance(dt * (a.sp === 'bear' ? 0.0015 : a.sp === 'deer' ? 0.012 : 0.006))) a.preg = 0;
    behave(a, d, dt, season);
  }
  S.animals = S.animals.filter((a) => a.alive);
}

function graze(a, d, dt, season) {
  const i = idx(Math.floor(a.x), Math.floor(a.y)), ty = S.tiles.type[i];
  let g = (ty === T.GRASS || ty === T.HILL) ? (season === 3 ? 1.6 : 4) * (S.snowCover > 0.5 ? 0.6 : 1) * (1 - S.climate.drought * 0.6) : 0.5;
  if (a.sp === 'boar' && S.tiles.tree[i] > 0.2) g += 2; // fouille sous les arbres
  if (d.diet === 'omni' && S.tiles.bush[i] && S.tiles.berries[i] >= 1 && a.sat < 80) { S.tiles.berries[i] -= dt * (a.sp === 'bear' ? 2 : 0.6); g += a.sp === 'bear' ? 9 : 3; }
  if (a.sp === 'bear' && a.state === 'fish') g += 8;
  a.sat = Math.min(100, a.sat + dt * g * (a.sp === 'bear' ? 0.5 : 1));
}

// ---- perception ----
function humansNear(x, y, r) { let n = 0, armed = 0; for (const o of S.gridB.near(x, y, r)) if (o.alive && o.age > 12) { n++; if (has(tribeById(o.tribeId), 'chasse')) armed++; } return { n, armed }; }
function fireNear(x, y, r) { for (const t of S.tribes) if (t.alive && has(t, 'feu') && dist(t.cx, t.cy, x, y) < r) return true; for (const i of S.fires) if (dist(i % N, (i / N) | 0, x, y) < r) return true; return false; }
function waterSpot(a) { const p = spiral(a.x, a.y, 40, (x, y) => walkable(x + 0.5, y + 0.5) && nearWater(x, y)); return p && [p[0] + 0.5, p[1] + 0.5]; }

function behave(a, d, dt, season) {
  const night = isNight(), h = S.time % 24;
  let run = false;
  const g = a.group != null ? groups.get(a.group) : null, gs = a.group != null ? S.groupState[a.group] : null;
  const leader = g?.leader;
  // jeune : suit sa mère
  const mother = a.mother != null && a.age < d.mature ? S.animalMap.get(a.mother) : null;
  // ---------- OURS : hibernation ----------
  if (a.sp === 'bear') {
    if (season === 3 && S.time % 24 > 0) {
      a.den ||= denSpot(a);
      if (dist(a.x, a.y, a.den[0], a.den[1]) < 1) { a.state = 'hibernate'; return; }
      a.tx = a.den[0]; a.ty = a.den[1];
    } else if (a.state === 'hibernate') { a.state = 'roam'; a.sat = Math.max(a.sat, 30); }
  }
  // ---------- FUITE (proies) ----------
  if (isPrey(a)) {
    const vig = d.flight * (1 + a.fear * 0.8) * (night ? 0.7 : 1);
    let th = null, td = vig;
    for (const o of S.gridA.near(a.x, a.y, vig + 1)) if ((o.sp === 'wolf' || o.sp === 'bear') && o.alive && o.state !== 'hibernate') { const dd = dist(o.x, o.y, a.x, a.y); if (dd < td) { td = dd; th = o; } }
    if (!th) for (const o of S.gridB.near(a.x, a.y, vig)) if (o.alive && o.age > 6 && !o.sleeping) {
      const dd = dist(o.x, o.y, a.x, a.y), hunting = o.act?.type === 'hunt';
      if (dd < (hunting ? vig : vig * 0.5) * (1 + a.fear) && dd < td) { td = dd; th = o; }
    }
    if (a.fleeFrom) { th = th || a.fleeFrom; a.fleeFrom = null; a.fear = Math.min(1, a.fear + 0.15); }
    // l'alarme du troupeau se propage à tous
    if (th && gs) gs.alarm = { x: th.x, y: th.y, t: S.time };
    if (!th && gs?.alarm && S.time - gs.alarm.t < 0.4 && dist(a.x, a.y, gs.alarm.x, gs.alarm.y) < 14) th = gs.alarm;
    if (th) {
      // sanglier adulte acculé : il charge au lieu de fuir
      if (a.sp === 'boar' && th.act?.type === 'hunt' && th.act.target === a.id && dist(th.x, th.y, a.x, a.y) < 2.2 && (a.sex === 'M' || hasYoung(a)) && a.age > d.mature && chance(0.6)) { a.state = 'charge'; a.target = th.id; }
      else {
        let ang = Math.atan2(a.y - th.y, a.x - th.x) + range(-0.35, 0.35);
        // lapin : se réfugie dans un buisson ou la forêt
        if (a.sp === 'rabbit') { const p = spiral(a.x, a.y, 3, (x, y, i) => S.tiles.bush[i] || S.tiles.tree[i] > 0.4); if (p && dist(p[0], p[1], th.x, th.y) > 1.2) { a.tx = p[0] + 0.5; a.ty = p[1] + 0.5; a.hidden = true; } else { a.tx = a.x + Math.cos(ang) * 5; a.ty = a.y + Math.sin(ang) * 5; } }
        else { a.tx = a.x + Math.cos(ang) * 6; a.ty = a.y + Math.sin(ang) * 6; }
        run = true; a.wait = 0; a.state = 'flee';
      }
    } else if (a.state === 'flee') { a.state = 'roam'; a.hidden = false; }
  }
  if (a.state === 'charge') {
    const t = byId(a.target);
    if (!t || !t.alive || dist(t.x, t.y, a.x, a.y) > 6) a.state = 'roam';
    else {
      a.tx = t.x; a.ty = t.y; run = true;
      if (dist(t.x, t.y, a.x, a.y) < 0.8) {
        hurt(t, range(10, 26), 'la charge d’un sanglier'); addWound(t, 'plaie', 25, 'la charge d’un sanglier'); t.emo.fear += 35; say(t, pick(['Aaah ! Le sanglier !', 'Il m’a chargé !']), 1600);
        a.state = 'flee'; a.fleeFrom = { x: t.x, y: t.y }; callHelp(t, a);
      }
    }
  }
  // ---------- SOIF : aller boire passe avant le reste (sauf danger) ----------
  if (a.state !== 'hibernate' && !run && a.state !== 'charge' && a.state !== 'attack' && (a.thirst < 35 || a.state === 'drink')) {
    if (a.state !== 'drink') { const w = waterSpot(a); if (w) { a.state = 'drink'; [a.tx, a.ty] = w; } }
    if (a.state === 'drink' && dist(a.x, a.y, a.tx, a.ty) < 0.7) { a.thirst = 100; a.state = 'roam'; a.wait = range(0.2, 1); }
    if (a.state === 'drink') { moveAnimal(a, d, dt, a.thirst < 15); return; }
  }
  // ---------- PRÉDATEURS ----------
  if (a.sp === 'wolf') run = wolfBrain(a, g, gs, leader, dt, night, h) || run;
  if (a.sp === 'bear' && a.state !== 'hibernate') run = bearBrain(a, d, dt, season) || run;
  // ---------- SOIF, TROUPEAU, ERRANCE ----------
  if (!run && a.state !== 'hibernate') {
    a.wait -= dt;
    const arrived = dist(a.x, a.y, a.tx, a.ty) < 0.6;
    if (mother && mother.alive) { a.tx = mother.x + Math.cos(a.id) * 0.6; a.ty = mother.y + Math.sin(a.id) * 0.6; if (dist(a.x, a.y, mother.x, mother.y) > 3) run = true; }
    else if (g && leader && leader !== a && a.sp !== 'wolf') {
      // suivre le meneur en gardant ses distances (cohésion + séparation)
      const k = a.id * 2.399, rr = 1.2 + (a.id % 4) * 0.5;
      const fx = leader.x + Math.cos(k) * rr, fy = leader.y + Math.sin(k) * rr;
      if (dist(a.tx, a.ty, fx, fy) > 1 || arrived) { a.tx = fx; a.ty = fy; }
      if (dist(a.x, a.y, leader.x, leader.y) > 9) run = true;
    } else if (arrived && a.wait <= 0 && a.sp !== 'wolf') {
      // le meneur (ou l'isolé) choisit un pâturage : herbe, eau, sécurité
      const p = chooseGround(a, d, night);
      a.tx = p[0]; a.ty = p[1];
      a.wait = range(0.5, 2.5) * (night ? 2.5 : 1);
    }
  }
  if (a.state === 'hibernate') return;
  moveAnimal(a, d, dt, run);
}
const hasYoung = (a) => S.animals.some((o) => o.mother === a.id && o.alive && o.age < 1);

function chooseGround(a, d, night) {
  let best = null, bs = -1e9;
  for (let k = 0; k < 8; k++) {
    const [x, y] = randomLand(a.x, a.y, a.sp === 'rabbit' ? 5 : 12);
    const i = idx(Math.floor(x), Math.floor(y)), ty = S.tiles.type[i];
    let s = (ty === T.GRASS ? 2 : ty === T.HILL ? 1.5 : 0.3) - fearAt(x, y) * 2.2 * (0.5 + a.fear) - dist(a.x, a.y, x, y) * 0.04;
    const hn = humansNear(x, y, 6); s -= hn.n * (0.4 + a.fear);
    if (a.thirst < 60 && nearWater(Math.floor(x), Math.floor(y))) s += 1.5;
    if (night && S.tiles.tree[i] > 0.3) s += 1; // à l'abri sous les arbres la nuit
    if (a.sp === 'boar' && S.tiles.tree[i] > 0.3) s += 1.2;
    if (a.sp === 'bear' && S.tiles.bush[i] && S.tiles.berries[i] > 2) s += 3;
    for (const o of S.gridA.near(x, y, 7)) if (o.sp === 'wolf' && isPrey(a)) s -= 2.5;
    s += rnd() * 0.6;
    if (s > bs) { bs = s; best = [x, y]; }
  }
  return best;
}

// ---- intelligence de meute ----
function wolfBrain(a, g, gs, leader, dt, night, h) {
  gs ||= {};
  gs.den ||= denSpot(a);
  const hungry = a.sat < 60 || (night && a.sat < 80);
  // le hurlement du soir
  if (leader === a && h > 19 && h < 19.6 && gs.howl !== Math.floor(S.time / 24)) { gs.howl = Math.floor(S.time / 24); S.effects.push({ kind: 'howl', x: a.x, y: a.y, t: 3 }); (S.sfx ||= []).push('howl'); }
  if (!hungry) { // repos à la tanière le jour
    if (dist(a.x, a.y, gs.den[0], gs.den[1]) > 3 && (!a.tx || dist(a.tx, a.ty, gs.den[0], gs.den[1]) > 3)) { a.tx = gs.den[0] + range(-1.5, 1.5); a.ty = gs.den[1] + range(-1.5, 1.5); }
    a.huntTgt = null; return false;
  }
  // peur du feu et des groupes armés
  if (fireNear(a.x, a.y, 4.5)) { const ang = Math.atan2(a.y - gs.den[1], a.x - gs.den[0]); a.tx = gs.den[0]; a.ty = gs.den[1]; return true; }
  const hn = humansNear(a.x, a.y, 4);
  if (hn.armed >= 2 || hn.n >= 4) { a.tx = gs.den[0]; a.ty = gs.den[1]; return true; }
  // le chef choisit la proie la plus faible ; la meute encercle
  let tgt = gs.prey != null ? (S.animalMap.get(gs.prey) || byId(gs.prey)) : null;
  if (!tgt || !tgt.alive) tgt = null;
  if (leader === a && (!tgt || chance(dt * 0.3))) {
    let best = null, bs = -1e9;
    for (const o of S.gridA.near(a.x, a.y, 22)) {
      if (!o.alive || !isPrey(o) || o.hidden) continue;
      const od = SPECIES[o.sp];
      const s = (1 - o.health / od.hp) * 3 + (o.age < od.mature ? 1.6 : 0) + (o.age > od.life * 0.8 ? 1.2 : 0) + (o.sp === 'deer' ? 1 : o.sp === 'rabbit' ? 0.2 : -0.8) - dist(o.x, o.y, a.x, a.y) * 0.08;
      if (s > bs) { bs = s; best = o; }
    }
    // un être isolé, la nuit, quand la famine menace
    if (!best && a.sat < 25 && night) {
      for (const o of S.gridB.near(a.x, a.y, 12)) { if (!o.alive || o.inside) continue; const crowd = S.gridB.near(o.x, o.y, 4).length; if (crowd > 1 && o.age > 12) continue; if (fireNear(o.x, o.y, 4)) continue; best = o; break; }
    }
    gs.prey = best ? best.id : null; tgt = best;
  }
  if (!tgt) { if (dist(a.x, a.y, a.tx, a.ty) < 0.6) { const [x, y] = randomLand(leader ? leader.x : a.x, leader ? leader.y : a.y, 8); a.tx = x; a.ty = y; } return false; }
  const members = g ? g.members : [a];
  const k = members.indexOf(a), n = members.length;
  const dd = dist(a.x, a.y, tgt.x, tgt.y);
  // approche en tenaille : chacun vient d'un angle différent
  const baseAng = Math.atan2(tgt.y - gs.den[1], tgt.x - gs.den[0]) + Math.PI;
  const ang = baseAng + (k - (n - 1) / 2) * 0.9;
  if (dd > 2.2) { a.tx = tgt.x + Math.cos(ang) * 1.8; a.ty = tgt.y + Math.sin(ang) * 1.8; }
  else { a.tx = tgt.x; a.ty = tgt.y; }
  if (dd < 0.9) {
    const around = members.filter((m) => dist(m.x, m.y, tgt.x, tgt.y) < 1.6).length;
    if (tgt.act !== undefined) { // un être humain
      if (tgt.health > 0) { hurt(tgt, dt * 14 * around, 'une attaque de loups'); addWound(tgt, 'morsure', 20, 'une attaque de loups'); tgt.emo.fear += 30; if (chance(dt * 3)) say(tgt, 'À l’aide ! Des loups !', 1500); callHelp(tgt, a); if (tgt.health <= 0) { for (const m of members) m.sat = 100; gs.prey = null; log(`🐺 La meute a tué ${tgt.name}.`, 'death', false, [tgt.x, tgt.y]); } }
    } else {
      tgt.health -= dt * 25 * around; tgt.fleeFrom = { x: a.x, y: a.y };
      const od = SPECIES[tgt.sp];
      if (chance(dt * (1.2 + around * 1.6) * (1.4 - tgt.health / od.hp) * (tgt.sp === 'rabbit' ? 2 : tgt.sp === 'boar' ? 0.5 : 1))) tgt.health = 0; // mise à mort
      if (tgt.health <= 0) { tgt.alive = false; (S.adeaths ||= {})[tgt.sp + ':loups'] = (S.adeaths[tgt.sp + ':loups'] || 0) + 1; for (const m of members) if (dist(m.x, m.y, tgt.x, tgt.y) < 8 || m.age < SPECIES.wolf.mature) m.sat = Math.min(100, m.sat + Math.min(80, (tgt.sp === 'rabbit' ? 70 : 220) / n)); gs.prey = null; S.effects.push({ kind: 'carcass', x: tgt.x, y: tgt.y, t: 24, sp: tgt.sp }); }
    }
  }
  return true;
}
function bearBrain(a, d, dt, season) {
  // pêche l'été, se méfie des groupes, attaque si surpris
  const hn = humansNear(a.x, a.y, 5);
  if (hn.n >= 3 && hn.armed >= 2) { const o = S.gridB.near(a.x, a.y, 5)[0]; if (o) { const ang = Math.atan2(a.y - o.y, a.x - o.x); a.tx = a.x + Math.cos(ang) * 7; a.ty = a.y + Math.sin(ang) * 7; } return true; }
  if (a.state !== 'attack') {
    for (const o of S.gridB.near(a.x, a.y, 2)) {
      if (!o.alive || o.inside) continue;
      const provoked = o.act?.type === 'hunt' && o.act.target === a.id;
      if (provoked || (hasYoung(a) && dist(o.x, o.y, a.x, a.y) < 1.4 && chance(dt * 2)) || (a.sat < 12 && chance(dt * 0.5))) { a.state = 'attack'; a.target = o.id; a.atkT = 0; o.emo.fear += 50; say(o, pick(['UN OURS !', 'Fuyez !']), 1800); callHelp(o, a); break; }
    }
    // l'ours évite les hommes et leurs villages
    if (a.state !== 'attack') {
      const o = S.gridB.near(a.x, a.y, 4.5).find((p) => p.alive);
      const v = S.tribes.find((t) => t.alive && dist(t.cx, t.cy, a.x, a.y) < 10);
      const from = o || (v && { x: v.cx, y: v.cy });
      if (from) { const ang = Math.atan2(a.y - from.y, a.x - from.x); a.tx = a.x + Math.cos(ang) * 6; a.ty = a.y + Math.sin(ang) * 6; if (a.state === 'fish') a.state = 'roam'; return !!o; }
    }
  }
  if (a.state === 'attack') {
    const t = byId(a.target);
    a.atkT = (a.atkT || 0) + dt;
    if (!t || !t.alive || dist(t.x, t.y, a.x, a.y) > 6 || a.atkT > 1.2) { a.state = 'roam'; return false; }
    a.tx = t.x; a.ty = t.y;
    if (dist(t.x, t.y, a.x, a.y) < 0.9 && chance(dt * 2.5)) {
      hurt(t, range(14, 34), 'un ours'); addWound(t, chance(0.3) ? 'fracture' : 'plaie', 35, 'un ours');
      if (t.health <= 0) log(`🐻 Un ours a tué ${t.name}.`, 'death', false, [t.x, t.y]);
      if (chance(0.65)) { a.state = 'roam'; const ang = Math.atan2(a.y - t.y, a.x - t.x); a.tx = a.x + Math.cos(ang) * 8; a.ty = a.y + Math.sin(ang) * 8; }
    }
    return true;
  }
  if (season === 1 && a.sat < 80 && a.state !== 'fish' && chance(dt * 0.2)) { const w = waterSpot(a); if (w) { a.state = 'fish'; [a.tx, a.ty] = w; } }
  if (a.state === 'fish' && dist(a.x, a.y, a.tx, a.ty) < 0.7) { const i = idx(Math.floor(a.x), Math.floor(a.y)); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = idx(Math.floor(a.x) + dx, Math.floor(a.y) + dy); if (S.tiles.type[j] <= T.WATER) S.tiles.fish[j] = Math.max(0, S.tiles.fish[j] - dt * 0.5); } if (a.sat > 90) a.state = 'roam'; }
  return false;
}
function denSpot(a) {
  const p = spiral(a.x, a.y, 14, (x, y, i) => walkable(x + 0.5, y + 0.5) && (S.tiles.tree[i] > 0.5 || S.tiles.type[i] === T.ROCK || S.tiles.type[i] === T.HILL) && !S.tribes.some((t) => t.alive && dist(t.cx, t.cy, x, y) < 12));
  return p ? [p[0] + 0.5, p[1] + 0.5] : [a.x, a.y];
}

function moveAnimal(a, d, dt, run) {
  const dd = dist(a.x, a.y, a.tx, a.ty);
  if (dd < 0.1) return;
  const sp = d.speed * (a.age < d.mature * 0.5 ? 0.7 : 1) * (a.health < d.hp * 0.4 ? 0.6 : 1);
  let step = Math.min(dd, sp * (run ? 1.7 : 0.45) * dt / terrainCost(a.x, a.y));
  while (step > 0) {
    const s = Math.min(step, 0.35), ang = Math.atan2(a.ty - a.y, a.tx - a.x);
    let ok = false;
    for (const off of [0, 0.6, -0.6, 1.2, -1.2, 2, -2]) {
      const nx = a.x + Math.cos(ang + off) * s, ny = a.y + Math.sin(ang + off) * s;
      if (walkable(nx, ny)) { a.x = nx; a.y = ny; a.dir = Math.cos(ang + off) - Math.sin(ang + off) >= 0 ? 1 : -1; a.walk += s * 3; ok = true; break; }
    }
    if (!ok) { a.tx = a.x; a.ty = a.y; break; }
    step -= s;
  }
}

// appel à l'aide : les proches courageux accourent
export function callHelp(victim, attacker) {
  if (!victim.alive) return;
  for (const o of S.gridB.near(victim.x, victim.y, 9)) {
    if (o === victim || !o.alive || o.tribeId !== victim.tribeId || o.age < 16 || o.health < 45 || o.sleeping && dist(o.x, o.y, victim.x, victim.y) > 3) continue;
    if (o.act?.type === 'fight') continue;
    const brave = o.genes.agg + o.genes.str + (o.traits?.includes('courageux') ? 0.6 : 0) - (o.traits?.includes('peureux') ? 0.6 : 0) + (o.partner === victim.id || victim.parents.includes(o.id) ? 0.8 : 0);
    if (brave > 0.9 && has(tribeById(o.tribeId), 'chasse') || brave > 1.4) {
      o.sleeping = false; o.inside = false;
      o.act = { type: 'fight', phase: 'go', t: 0, target: attacker.id, animal: attacker.act === undefined, run: true, r: 1 };
      if (chance(0.5)) say(o, pick([`J’arrive, ${victim.name} !`, 'Tenez bon !', 'Laisse-le !']), 1500);
    }
  }
}
export function addWound(b, kind, sev, cause = null) {
  (b.wounds ||= []);
  if (b.wounds.length > 3) return;
  b.wounds.push({ kind, sev: sev * range(0.6, 1.2), t: 0, infected: false, cause });
}

export function seedAnimals() {
  let gid = 1;
  for (let h = 0; h < 5; h++) { const [x, y] = randomLand(); const id = 'h' + gid++; for (let k = 0; k < 6; k++) spawnAnimal('deer', x + range(-1.5, 1.5), y + range(-1.5, 1.5), null, { group: id }); }
  for (let k = 0; k < 34; k++) { const [x, y] = randomLand(); spawnAnimal('rabbit', x, y); }
  for (let h = 0; h < 2; h++) { const [x, y] = randomLand(); const id = 'b' + gid++; for (let k = 0; k < 5; k++) spawnAnimal('boar', x + range(-1, 1), y + range(-1, 1), null, { group: id }); }
  const far = () => { for (let k = 0; k < 60; k++) { const p = randomLand(); if (!S.tribes.some((t) => dist(t.cx, t.cy, p[0], p[1]) < 16)) return p; } return randomLand(); };
  { const [x, y] = far(); const id = 'p' + gid++; for (let k = 0; k < 4; k++) spawnAnimal('wolf', x + range(-1, 1), y + range(-1, 1), null, { group: id }); }
  for (let k = 0; k < 2; k++) { const [x, y] = far(); spawnAnimal('bear', x, y, range(4, 12), { sex: k ? 'M' : 'F' }); }
}
// rattache les nouveau-nés sans groupe et les animaux créés par le dieu
export function assignGroup(a) {
  if (SPECIES[a.sp].social === 'solo') return;
  let best = null, bd = 10;
  for (const o of S.animals) if (o !== a && o.alive && o.sp === a.sp && o.group != null) { const dd = dist(o.x, o.y, a.x, a.y); if (dd < bd) { bd = dd; best = o; } }
  a.group = best ? best.group : (a.sp === 'wolf' ? 'p' : 'h') + S.nextId++;
}
