// ===== FAUNE : cerfs, lapins, loups =====
import { N, R, CX, CY, T, HOURS_PER_YEAR } from './config.js';
import { S, walkable, randomLand, idx, timeInfo, isNight, terrainCost } from './world.js';
import { rnd, range, chance, clamp, dist, pick } from './util.js';
import { hurt, say, byId } from './beings.js';
import { log } from './society.js';

export const SPECIES = {
  deer: { name: 'Cerf', speed: 5.2, life: 14, mature: 1.5, gest: 8 * 24, litter: 1, max: 55, herb: true, hp: 60 },
  rabbit: { name: 'Lapin', speed: 4.6, life: 5, mature: 0.4, gest: 3 * 24, litter: 3, max: 90, herb: true, hp: 15 },
  wolf: { name: 'Loup', speed: 6.2, life: 11, mature: 1.5, gest: 6 * 24, litter: 2, max: 14, herb: false, hp: 70 },
};

export function spawnAnimal(sp, x, y, age = null) {
  const d = SPECIES[sp];
  if (!walkable(x, y)) [x, y] = randomLand(x, y, 4);
  const a = { id: S.nextId++, sp, x, y, age: age ?? range(0.5, d.life * 0.6), sex: chance(0.5) ? 'F' : 'M', sat: range(50, 90), health: d.hp, alive: true, tx: x, ty: y, wait: 0, dir: 1, walk: 0, preg: null, fleeFrom: null };
  S.animals.push(a); return a;
}

export function animalsStep(dt) {
  const { season } = timeInfo();
  const counts = { deer: 0, rabbit: 0, wolf: 0 };
  for (const a of S.animals) if (a.alive) counts[a.sp]++;
  for (const a of S.animals) {
    if (!a.alive) continue;
    const d = SPECIES[a.sp];
    a.age += dt / HOURS_PER_YEAR;
    a.sat -= dt * (d.herb ? 1.2 : 1.1);
    // herbivores : pâturage selon saison et neige
    if (d.herb) {
      const i = idx(Math.floor(a.x), Math.floor(a.y)), ty = S.tiles.type[i];
      const graze = (ty === T.GRASS || ty === T.HILL) ? (season === 3 ? 1.6 : 4) * (S.snowCover > 0.5 ? 0.6 : 1) * (1 - S.climate.drought * 0.6) : 0.5;
      a.sat = Math.min(100, a.sat + dt * graze);
    }
    if (a.sat <= 0) a.health -= dt * 3;
    if (a.age > d.life || a.health <= 0) { a.alive = false; S.effects.push({ kind: 'carcass', x: a.x, y: a.y, t: 24, sp: a.sp }); continue; }
    // reproduction
    if (a.preg != null) { a.preg += dt; if (a.preg >= d.gest) { a.preg = null; for (let k = 0; k < d.litter; k++) if (counts[a.sp] < d.max) { spawnAnimal(a.sp, a.x, a.y, 0); counts[a.sp]++; } } }
    else if (a.sex === 'F' && a.age > d.mature && a.sat > 50 && (season <= 1) && counts[a.sp] < d.max && chance(dt * 0.006)) a.preg = 0;
    behave(a, d, dt);
  }
  if (S.animals.length > 400 || chance(0.01)) S.animals = S.animals.filter((a) => a.alive);
}

function behave(a, d, dt) {
  let sp = d.speed * (a.age < d.mature * 0.5 ? 0.7 : 1);
  let run = false;
  // fuite devant les prédateurs / êtres
  if (d.herb) {
    let th = null, td = a.sp === 'deer' ? 5 : 3.5;
    for (const o of S.gridA.near(a.x, a.y, 6)) if (o.sp === 'wolf' && o.alive) { const dd = dist(o.x, o.y, a.x, a.y); if (dd < td) { td = dd; th = o; } }
    if (!th) for (const o of S.gridB.near(a.x, a.y, 4)) if (o.alive && o.age > 6 && !o.sleeping) { const dd = dist(o.x, o.y, a.x, a.y); if (dd < (o.act?.type === 'hunt' ? 5 : 2.5) && dd < td) { td = dd; th = o; } }
    if (a.fleeFrom) { th = th || a.fleeFrom; a.fleeFrom = null; }
    if (th) { const ang = Math.atan2(a.y - th.y, a.x - th.x) + range(-0.4, 0.4); a.tx = a.x + Math.cos(ang) * 6; a.ty = a.y + Math.sin(ang) * 6; run = true; a.wait = 0; }
  } else {
    // loup : chasse quand il a faim
    if (a.sat < 55) {
      let prey = a.prey && S.animals.find((x) => x.id === a.prey && x.alive);
      if (!prey) {
        let bd = 16; a.prey = null;
        for (const o of S.gridA.near(a.x, a.y, 16)) if (o.alive && o.sp !== 'wolf') { const dd = dist(o.x, o.y, a.x, a.y); if (dd < bd) { bd = dd; prey = o; } }
        if (prey) a.prey = prey.id;
      }
      // les êtres isolés, quand la faim est grande (surtout la nuit)
      if (!prey && a.sat < 22 && (isNight() || a.sat < 10)) {
        let bd = 10;
        for (const o of S.gridB.near(a.x, a.y, 10)) { if (!o.alive) continue; const crowd = S.gridB.near(o.x, o.y, 3).length; if (crowd > 2 && o.age > 12) continue; const dd = dist(o.x, o.y, a.x, a.y); if (dd < bd) { bd = dd; a.human = o.id; } }
      }
      const hum = a.human && byId(a.human);
      const tgt = prey || (hum && hum.alive ? hum : null);
      if (tgt) {
        a.tx = tgt.x; a.ty = tgt.y; run = true;
        if (dist(a.x, a.y, tgt.x, tgt.y) < 0.8) {
          if (tgt === prey) { if (chance(dt * 6)) { prey.alive = false; a.sat = 100; a.prey = null; S.effects.push({ kind: 'carcass', x: prey.x, y: prey.y, t: 24, sp: prey.sp }); } }
          else if (tgt.health > 0) { hurt(tgt, dt * 22, 'une attaque de loups'); tgt.emo.fear += 30; if (chance(dt * 3)) say(tgt, 'À l’aide ! Un loup !', 1500); if (tgt.health <= 0) { a.sat = 100; a.human = null; log(`🐺 Des loups ont tué ${tgt.name}.`, 'death', false, [tgt.x, tgt.y]); } }
        }
      } else a.human = null;
    }
  }
  if (!run) {
    a.wait -= dt;
    if (a.wait <= 0 && dist(a.x, a.y, a.tx, a.ty) < 0.5) {
      // troupeau : rester près des congénères
      const mates = S.gridA.near(a.x, a.y, 8).filter((o) => o.sp === a.sp && o !== a);
      if (mates.length && chance(0.6)) { const m = pick(mates); a.tx = m.x + range(-2, 2); a.ty = m.y + range(-2, 2); }
      else { const [x, y] = randomLand(a.x, a.y, 7); a.tx = x; a.ty = y; }
      a.wait = range(0.3, 2.5) * (isNight() && d.herb ? 2 : 1);
    }
  }
  const dd = dist(a.x, a.y, a.tx, a.ty);
  if (dd > 0.1) {
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
}

export function seedAnimals() {
  for (let k = 0; k < 26; k++) { const [x, y] = randomLand(); spawnAnimal('deer', x, y); }
  for (let k = 0; k < 34; k++) { const [x, y] = randomLand(); spawnAnimal('rabbit', x, y); }
  for (let p = 0; p < 1; p++) { const [x, y] = randomLand(); for (let k = 0; k < 3; k++) spawnAnimal('wolf', x + range(-1, 1), y + range(-1, 1)); }
}
