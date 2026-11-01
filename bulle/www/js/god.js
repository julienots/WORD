// ===== POUVOIRS DU DIEU (toi) =====
import { N, R, CX, CY, T } from './config.js';
import { S, idx, inside, ignite, sculpt, setWeather, walkable, randomLand } from './world.js';
import { range, chance, dist, pick, clamp } from './util.js';
import { createBeing, infect, DISEASES, hurt, mem, say, die } from './beings.js';
import { spawnAnimal } from './animals.js';
import { log, tribeById, makeTribe, addRel, addKnowledge, endWar } from './society.js';

export const REVELATIONS = [
  { id: 'createur', text: 'JE SUIS VOTRE CRÉATEUR.', effect: (b) => { b.faith = Math.min(1, b.faith + 0.3); b.emo.fear += 15; } },
  { id: 'paix', text: 'AIMEZ-VOUS LES UNS LES AUTRES.', dogma: 'paix', effect: (b) => { b.emo.anger *= 0.3; b.genes.agg *= 0.9; for (const k in b.rel) if (b.rel[k] < 0) b.rel[k] *= 0.5; } },
  { id: 'fertilite', text: 'CROISSEZ ET MULTIPLIEZ-VOUS.', dogma: 'fertilite', effect: (b) => { b.emo.love += 25; b.flags.blessed = S.time + 24 * 12; } },
  { id: 'savoir', text: 'CHERCHEZ À COMPRENDRE LE MONDE.', dogma: 'savoir', effect: (b) => { b.genes.cur = Math.min(1, b.genes.cur + 0.08); }, know: 25 },
  { id: 'paroi', text: 'LA PAROI N’EST PAS LA FIN DU MONDE.', effect: (b) => { b.aware = Math.min(1, b.aware + 0.25); if (b.aware > 0.5 && chance(0.3)) b.wantLeave = true; }, know: 15 },
  { id: 'guerre', text: 'COMBATTEZ VOS ENNEMIS.', dogma: 'guerre', effect: (b) => { b.emo.anger += 30; b.genes.agg = Math.min(1, b.genes.agg + 0.08); } },
  { id: 'partage', text: 'PARTAGEZ VOS RÉCOLTES.', effect: (b) => { b.genes.emp = Math.min(1, b.genes.emp + 0.06); } },
];

export const POWERS = [
  { id: 'inspect', icon: '👁️', name: 'Observer', cost: 0, r: 0, desc: 'Touche un être pour lire ses pensées.' },
  { id: 'rain', icon: '🌧️', name: 'Pluie', cost: 8, r: 9, desc: 'Fait pleuvoir : eau, croissance, éteint les feux.' },
  { id: 'sun', icon: '☀️', name: 'Soleil', cost: 6, r: 0, desc: 'Dissipe les nuages, réchauffe le monde.' },
  { id: 'lightning', icon: '⚡', name: 'Foudre', cost: 12, r: 1.5, desc: 'Frappe : tue, enflamme, terrifie.' },
  { id: 'fire', icon: '🔥', name: 'Feu', cost: 6, r: 2, desc: 'Allume un incendie.' },
  { id: 'bloom', icon: '🌱', name: 'Abondance', cost: 14, r: 6, desc: 'Fait pousser arbres et baies.' },
  { id: 'bless', icon: '✨', name: 'Bénir', cost: 16, r: 4, desc: 'Soigne, rassasie, rend heureux et fertile.' },
  { id: 'plague', icon: '☣️', name: 'Épidémie', cost: 22, r: 3, desc: 'Répand la peste.' },
  { id: 'raise', icon: '⛰️', name: 'Élever', cost: 4, r: 3.5, desc: 'Soulève le terrain (montagnes).' },
  { id: 'lower', icon: '🕳️', name: 'Creuser', cost: 4, r: 3.5, desc: 'Abaisse le terrain (lacs).' },
  { id: 'deer', icon: '🦌', name: 'Gibier', cost: 8, r: 2, desc: 'Crée un troupeau de cerfs et de lapins.' },
  { id: 'wolf', icon: '🐺', name: 'Loups', cost: 12, r: 1, desc: 'Lâche une meute de loups.' },
  { id: 'human', icon: '🧍', name: 'Créer la vie', cost: 35, r: 1, desc: 'Fait naître un couple d’êtres adultes.' },
  { id: 'meteor', icon: '☄️', name: 'Météore', cost: 45, r: 4, desc: 'Une pierre tombe du dôme. Destruction.' },
  { id: 'winter', icon: '❄️', name: 'Grand froid', cost: 25, r: 0, desc: 'Plonge le monde dans le froid.' },
  { id: 'drought', icon: '🏜️', name: 'Sécheresse', cost: 25, r: 0, desc: 'Canicule et sécheresse durable.' },
  { id: 'voice', icon: '📢', name: 'Révélation', cost: 18, r: 0, desc: 'Parle à tes créatures.' },
];
export const powerById = (id) => POWERS.find((p) => p.id === id);

function pay(p) {
  if (S.god.unlimited) return true;
  if (S.god.energy < p.cost) { (S.toasts ||= []).push({ text: `Pas assez d’énergie divine (${Math.floor(S.god.energy)}/${p.cost}). Elle se régénère avec la foi et les prières.`, kind: 'warn' }); return false; }
  S.god.energy -= p.cost; return true;
}
// les êtres témoins d'un miracle croient davantage
function witness(x, y, r, fear, love, text) {
  for (const b of S.beings) {
    if (!b.alive || b.age < 4) continue;
    const d = dist(b.x, b.y, x, y); if (d > r) continue;
    const k = 1 - d / r;
    b.faith = clamp(b.faith + (fear + love) * 0.12 * k * (0.5 + b.genes.spi));
    b.emo.fear += fear * 25 * k; b.emo.joy += love * 25 * k;
    if (text && chance(0.5 * k) && !b.sleeping) say(b, pick(text), 2600);
    if (k > 0.5 && chance(0.4)) mem(b, fear > love ? 'J’ai vu la colère du ciel.' : 'J’ai vu un miracle.');
  }
}

export function applyPower(id, x, y, extra) {
  const p = powerById(id); if (!p || id === 'inspect') return false;
  if (p.r && (!inside(Math.floor(x), Math.floor(y)) || Math.hypot(x - CX, y - CY) > R + 1)) return false;
  if (id === 'voice') { if (!extra) return false; }
  if (!pay(p)) return false;
  S.stats.miracles = (S.stats.miracles || 0) + 1;
  const xi = Math.floor(x), yi = Math.floor(y);
  switch (id) {
    case 'rain': {
      setWeather('pluie', 8, true);
      for (let yy = yi - 9; yy <= yi + 9; yy++) for (let xx = xi - 9; xx <= xi + 9; xx++) if (inside(xx, yy) && dist(xx, yy, x, y) < 9) { const i = idx(xx, yy); S.tiles.wet[i] = 1; if (S.tiles.fire[i] > 0) S.tiles.fire[i] = 0.01; }
      S.climate.drought = 0; S.godRain = { x, y, t: 8 };
      witness(x, y, 14, 0, 0.3, ['La pluie !', 'Le ciel nous entend !', 'Merci !']);
      log('🌧️ Tu fais tomber la pluie.', 'god'); break;
    }
    case 'sun': setWeather('clair', 12, true); S.climate.tempMod += 4; S.snowCover *= 0.5; witness(CX, CY, 99, 0, 0.1); log('☀️ Tu dissipes les nuages.', 'god'); break;
    case 'lightning': {
      S.effects.push({ kind: 'bolt', x, y, t: 0.5 }); S.flash = 1;
      ignite(xi, yi, 1.2);
      let victim = null;
      for (const b of S.gridB.near(x, y, 1.6)) { hurt(b, 120, 'la foudre divine'); victim = b; }
      for (const a of S.gridA.near(x, y, 1.6)) a.alive = false;
      witness(x, y, 16, 0.9, 0, ['Le ciel est en colère !', 'Pardon ! Pardon !', 'Les dieux nous punissent…', 'Qu’avons-nous fait ?']);
      for (const b of S.gridB.near(x, y, 16)) if (b.age > 12 && !S.flags.fireLearned && chance(0.25)) { const tr = tribeById(b.tribeId); if (tr && !tr.tech.feu) addKnowledge(tr, 30, b); }
      log(`⚡ La foudre frappe${victim ? ` ${victim.name}` : ''}.`, 'god', false, [x, y]); break;
    }
    case 'fire': for (let k = 0; k < 4; k++) ignite(xi + Math.round(range(-1, 1)), yi + Math.round(range(-1, 1)), 1); witness(x, y, 10, 0.5, 0, ['Au feu !', 'Le feu du ciel !']); log('🔥 Tu allumes un incendie.', 'god', false, [x, y]); break;
    case 'bloom': {
      for (let yy = yi - 6; yy <= yi + 6; yy++) for (let xx = xi - 6; xx <= xi + 6; xx++) {
        if (!inside(xx, yy) || dist(xx, yy, x, y) > 6) continue; const i = idx(xx, yy), ty = S.tiles.type[i];
        if (ty !== T.GRASS && ty !== T.HILL && ty !== T.SAND) continue; if (S.tiles.bld[i] >= 0) continue;
        if (S.tiles.farm[i] >= 0) { S.tiles.crop[i] = 1; continue; }
        if (S.tiles.bush[i]) S.tiles.berries[i] = 5;
        else if (S.tiles.tree[i] > 0) S.tiles.tree[i] = Math.min(1, S.tiles.tree[i] + 0.5);
        else if (chance(0.25)) { S.tiles.bush[i] = 1; S.tiles.berries[i] = 5; } else if (chance(0.2)) { S.tiles.tree[i] = 0.5; S.tiles.treeKind[i] = chance(0.7) ? 0 : 2; }
        S.tiles.ash[i] = 0; S.tiles.moist[i] = Math.max(S.tiles.moist[i], 0.55);
      }
      S.effects.push({ kind: 'glow', x, y, t: 2, r: 6, color: '120,255,140' });
      witness(x, y, 12, 0, 0.6, ['La terre est généreuse !', 'Regardez, tout pousse !', 'Un miracle !']); S.dirtyTerrain = true;
      log('🌱 Tu fais jaillir l’abondance.', 'god', false, [x, y]); break;
    }
    case 'bless': {
      for (const b of S.gridB.near(x, y, 4)) { b.health = 100; b.sat = 100; b.thirst = 100; b.disease = null; b.emo.joy = 95; b.emo.fear = 0; b.grief *= 0.3; b.flags.blessed = S.time + 24 * 10; }
      S.effects.push({ kind: 'glow', x, y, t: 2, r: 4, color: '255,240,160' });
      witness(x, y, 10, 0, 1, ['Je me sens… renaître.', 'Une lumière !', 'Merci, Créateur !']);
      log('✨ Tu bénis tes créatures.', 'god', false, [x, y]); break;
    }
    case 'plague': {
      let n = 0; for (const b of S.gridB.near(x, y, 3)) if (infect(b, DISEASES[4], 18)) n++;
      S.effects.push({ kind: 'glow', x, y, t: 2, r: 3, color: '120,200,60' });
      log(`☣️ Tu répands la peste (${n} infecté${n > 1 ? 's' : ''}).`, 'god', false, [x, y]); break;
    }
    case 'raise': sculpt(x, y, 3.5, 0.12); witness(x, y, 8, 0.4, 0, ['La terre bouge !', 'Tremblement !']); break;
    case 'lower': sculpt(x, y, 3.5, -0.12); witness(x, y, 8, 0.4, 0, ['La terre s’effondre !']); break;
    case 'deer': for (let k = 0; k < 4; k++) spawnAnimal('deer', x + range(-1.5, 1.5), y + range(-1.5, 1.5), range(1, 4)); for (let k = 0; k < 4; k++) spawnAnimal('rabbit', x + range(-2, 2), y + range(-2, 2), range(0.5, 2)); log('🦌 Tu crées du gibier.', 'god', false, [x, y]); break;
    case 'wolf': for (let k = 0; k < 4; k++) spawnAnimal('wolf', x + range(-1, 1), y + range(-1, 1), range(2, 5)).sat = 20; log('🐺 Tu lâches une meute de loups.', 'god', false, [x, y]); break;
    case 'human': {
      if (!walkable(x, y)) { S.god.energy += p.cost; return false; }
      let tr = S.tribes.filter((t) => t.alive).sort((a, b) => dist(a.cx, a.cy, x, y) - dist(b.cx, b.cy, x, y))[0];
      if (!tr || dist(tr.cx, tr.cy, x, y) > 12) tr = makeTribe(xi, yi);
      const a = createBeing({ x, y, sex: 'F', age: range(18, 24), tribeId: tr.id }), b = createBeing({ x: x + 0.6, y, sex: 'M', age: range(18, 26), tribeId: tr.id });
      a.orient = b.orient = 'hetero'; a.faith = b.faith = 0.9; addRel(a, b, 50); addRel(b, a, 50);
      for (const c of [a, b]) mem(c, 'Je me suis éveillé dans la lumière. Quelqu’un m’a créé.');
      S.effects.push({ kind: 'glow', x, y, t: 2, r: 2, color: '255,255,255' });
      log(`🧍 Tu crées ${a.name} et ${b.name}.`, 'god', true, [x, y]); break;
    }
    case 'meteor': S.effects.push({ kind: 'meteor', x, y, t: 1.2, t0: 1.2 }); S.pendingMeteor = { x, y, t: 1.1 }; break;
    case 'winter': S.climate.tempMod -= 18; setWeather('neige', 24, true); witness(CX, CY, 99, 0.4, 0, ['Quel froid…', 'Le soleil nous abandonne !']); log('❄️ Tu plonges le monde dans un grand froid.', 'god', true); break;
    case 'drought': S.climate.drought = 1; S.climate.tempMod += 6; setWeather('canicule', 36, true); witness(CX, CY, 99, 0.4, 0, ['Il fait si chaud…', 'Les sources tarissent !']); log('🏜️ Tu provoques une sécheresse.', 'god', true); break;
    case 'voice': {
      const rv = REVELATIONS.find((r) => r.id === extra); if (!rv) return false;
      S.voice = { text: rv.text, until: performance.now() + 5000 };
      for (const b of S.beings) { if (!b.alive || b.age < 5) continue; b.faith = Math.min(1, b.faith + 0.12); rv.effect(b); mem(b, `Une voix immense a dit : « ${rv.text} »`); if (chance(0.3)) say(b, pick(['Vous avez entendu ?!', 'C’est LUI !', 'La voix du ciel…', 'Je n’ai pas rêvé…']), 3000); }
      for (const t of S.tribes) if (t.alive) { if (rv.dogma) t.dogma = rv.dogma; if (rv.know) addKnowledge(t, rv.know); if (rv.id === 'paix' && t.war) { const e = tribeById(t.war.target); endWar(t, e, 'paix'); } if (rv.id === 'partage') for (const o of S.tribes) if (o !== t) t.rel[o.id] = (t.rel[o.id] || 0) + 25; }
      log(`📢 Tu parles : « ${rv.text} »`, 'god', true); break;
    }
  }
  return true;
}

export function godStep(dt) {
  // énergie divine : régénérée par la foi
  let faith = 0; for (const b of S.beings) if (b.alive) faith += b.faith;
  S.god.energy = Math.min(S.god.max, S.god.energy + dt * (0.8 + faith * 0.05));
}
// le météore tombe en temps réel (animation), même en pause
export function godReal(rdt) {
  if (S.pendingMeteor) {
    S.pendingMeteor.t -= rdt;
    if (S.pendingMeteor.t <= 0) {
      const { x, y } = S.pendingMeteor; S.pendingMeteor = null;
      sculpt(x, y, 4, -0.16); S.flash = 1; S.shake = 1;
      for (let k = 0; k < 10; k++) ignite(Math.floor(x + range(-3, 3)), Math.floor(y + range(-3, 3)), 1);
      for (const b of S.gridB.near(x, y, 4.5)) hurt(b, 150 * (1 - dist(b.x, b.y, x, y) / 5), 'un météore');
      for (const a of S.gridA.near(x, y, 4.5)) a.alive = false;
      for (const bd of S.buildings) if (dist(bd.x, bd.y, x, y) < 4.5) bd.hp = -1;
      const tileS = idx(Math.floor(x), Math.floor(y)); S.tiles.stone[tileS] += 40;
      witness(x, y, 30, 1, 0, ['Le ciel tombe !', 'C’est la fin du monde !', 'Fuyez !']);
      log('☄️ Un météore s’écrase dans la bulle !', 'god', true, [x, y]);
    }
  }
}
