// ===== ESPRIT & CULTURE : personnalité, rôles, mémoire des lieux, blessures, mythes, rites =====
import { N, T, AGE } from './config.js';
import { S, idx, inside, walkable, nearWater, timeInfo } from './world.js';
import { rnd, range, pick, chance, clamp, dist } from './util.js';
import { log, has, rel } from './society.js';

// ---------- personnalité ----------
export const TRAIT_INFO = {
  courageux: '🦁', peureux: '🐇', généreux: '🤲', égoïste: '🫳', travailleur: '💪', paresseux: '🛌', colérique: '😤', calme: '🧘',
  curieux: '🔎', pieux: '🙏', sceptique: '🤨', sociable: '🗣️', solitaire: '🌑', séducteur: '💋', rusé: '🦊', rêveur: '☁️', traumatisé: '💔', sage: '🦉',
};
export function computeTraits(b) {
  const g = b.genes, t = [];
  if (g.agg + g.str > 1.25) t.push('courageux'); else if (g.agg + g.str < 0.7) t.push('peureux');
  if (g.emp > 0.66) t.push('généreux'); else if (g.emp < 0.3) t.push('égoïste');
  if ((g.str + g.int) / 2 > 0.62) t.push('travailleur'); else if (g.str + g.cur < 0.72) t.push('paresseux');
  if (g.agg > 0.7) t.push('colérique'); else if (g.agg < 0.25) t.push('calme');
  if (g.cur > 0.7) t.push('curieux');
  if (g.spi > 0.7) t.push('pieux'); else if (g.spi < 0.25) t.push('sceptique');
  if (g.soc > 0.72) t.push('sociable'); else if (g.soc < 0.28) t.push('solitaire');
  if (g.beauty > 0.75) t.push('séducteur');
  if (g.int > 0.72 && g.agg > 0.45) t.push('rusé');
  if (g.cur > 0.6 && g.spi > 0.6) t.push('rêveur');
  const old = (b.traits || []).filter((x) => x === 'traumatisé' || x === 'sage');
  b.traits = [...new Set([...t, ...old])].slice(0, 6);
}
export const hasT = (b, t) => !!b.traits && b.traits.includes(t);

// ---------- rôles dans la tribu ----------
export const ROLES = {
  chasseur: { icon: '🏹', name: 'Chasseur' }, cueilleur: { icon: '🧺', name: 'Cueilleur' }, batisseur: { icon: '🔨', name: 'Bâtisseur' },
  paysan: { icon: '🌾', name: 'Paysan' }, artisan: { icon: '🪓', name: 'Artisan' }, guerisseur: { icon: '🌿', name: 'Guérisseur' },
  chaman: { icon: '🔮', name: 'Chaman' }, sage: { icon: '📜', name: 'Sage' }, explorateur: { icon: '🧭', name: 'Explorateur' },
  guerrier: { icon: '⚔️', name: 'Guerrier' }, enfant: { icon: '🧒', name: 'Enfant' }, ancien: { icon: '🦯', name: 'Ancien' },
};
export function assignRoles(tr) {
  const m = tr.members, adults = m.filter((b) => b.age >= 16 && b.age < 62);
  for (const b of m) if (b.age < 16) b.role = 'enfant'; else if (b.age >= 62) b.role = 'ancien';
  const free = new Set(adults), n = adults.length;
  const sc = {
    guerisseur: has(tr, 'medecine') ? (b) => b.skills.heal * 2 + b.genes.emp : null,
    chaman: has(tr, 'spiritualite') ? (b) => b.faith + b.genes.spi : null,
    sage: has(tr, 'langage') ? (b) => b.genes.int + b.skills.lore * 2 + (b.age > 40 ? 0.4 : 0) : null,
    explorateur: (b) => b.genes.cur * 1.5 + b.aware,
    guerrier: tr.war || n > 12 ? (b) => b.genes.agg + b.genes.str + b.skills.fight : null,
    paysan: has(tr, 'agriculture') ? (b) => b.skills.farm * 2 + 0.3 : null,
    batisseur: has(tr, 'abri') ? (b) => b.skills.build * 2 + b.genes.str * 0.5 : null,
    chasseur: (b) => b.skills.hunt * 2 + b.genes.str + (has(tr, 'chasse') ? 0.4 : 0),
    artisan: (b) => b.skills.craft * 2 + b.genes.str * 0.4,
  };
  const quota = {
    guerisseur: Math.ceil(n / 12), chaman: Math.ceil(n / 16), sage: Math.ceil(n / 16), explorateur: Math.max(1, Math.round(n / 12)),
    guerrier: tr.war ? Math.ceil(n * 0.3) : Math.round(n * 0.1), paysan: Math.round(n * 0.18), batisseur: Math.round(n * 0.12), chasseur: Math.round(n * 0.2), artisan: Math.round(n * 0.1),
  };
  for (const [role, f] of Object.entries(sc)) {
    if (!f) continue;
    for (let k = 0; k < quota[role] && free.size; k++) {
      let best = null, bs = -1e9;
      for (const b of free) { const s = f(b) + (b.role === role ? 0.3 : 0); if (s > bs) { bs = s; best = b; } }
      if (best) { if (best.role !== role && best.role && best.age > 17) best.memory.unshift(`On m’a confié le rôle de ${ROLES[role].name.toLowerCase()}.`); best.role = role; free.delete(best); }
    }
  }
  for (const b of free) b.role = 'cueilleur';
}

// ---------- mémoire des lieux (perception + transmission) ----------
const KINDS = ['berries', 'stone', 'game'];
export function perceive(b, tr) {
  b.know ||= { berries: [], stone: [], game: [] };
  const x0 = Math.floor(b.x), y0 = Math.floor(b.y), R = 7;
  for (let y = y0 - R; y <= y0 + R; y += 2) for (let x = x0 - R; x <= x0 + R; x += 2) {
    if (!inside(x, y)) continue; const i = idx(x, y);
    if (S.tiles.bush[i] && S.tiles.berries[i] >= 2) remember(b.know.berries, i, 8);
    if (S.tiles.stone[i] > 4) remember(b.know.stone, i, 5);
  }
  for (const a of S.gridA.near(b.x, b.y, 9)) if (a.alive && (a.sp === 'deer' || a.sp === 'boar')) { remember(b.know.game, idx(Math.floor(a.x), Math.floor(a.y)), 4); break; }
}
function remember(list, i, cap) { const k = list.indexOf(i); if (k >= 0) list.splice(k, 1); list.unshift(i); if (list.length > cap) list.length = cap; }
export function forget(b, kind, i) { if (b.know?.[kind]) { const k = b.know[kind].indexOf(i); if (k >= 0) b.know[kind].splice(k, 1); } }
// partage du savoir des lieux : conversation ou retour au foyer
export function shareSpots(from, to) {
  if (!from.know) return 0; to.know ||= { berries: [], stone: [], game: [] };
  let n = 0;
  for (const k of KINDS) for (const i of from.know[k].slice(0, 2)) { if (!to.know[k].includes(i)) n++; remember(to.know[k], i, k === 'berries' ? 10 : 6); }
  return n;
}
export function tribeSpots(tr, b) {
  tr.know ||= { berries: [], stone: [], game: [] };
  if (b.know) for (const k of KINDS) for (const i of b.know[k].slice(0, 3)) remember(tr.know[k], i, 20);
}
// cherche d'abord ce qu'on voit, puis ce dont on se souvient, puis ce que la tribu sait
export function recall(b, tr, kind, maxD) {
  const lists = [b.know?.[kind] || [], has(tr, 'langage') ? tr?.know?.[kind] || [] : []];
  let best = null, bd = maxD;
  for (const L of lists) for (const i of L) { const x = i % N, y = (i / N) | 0, d = dist(x, y, b.x, b.y); if (d < bd) { bd = d; best = [x, y, i]; } }
  return best;
}

// ---------- blessures ----------
export function woundsStep(b, dt, tr, hurt, infectFever) {
  if (!b.wounds?.length) return;
  for (const w of b.wounds) {
    w.t += dt; w.max = Math.max(w.max || 0, w.sev);
    if (w.kind !== 'fracture' && w.t < 6) hurt(b, dt * w.sev * 0.025 * (1 - w.t / 6), w.cause || 'ses blessures');
    w.sev -= dt * (0.12 + (b.sleeping ? 0.1 : 0) + (w.treated ? 0.3 : 0) + b.genes.imm * 0.06) * (w.kind === 'fracture' ? 0.3 : 1);
    if (!w.infected && w.kind !== 'fracture' && !w.treated && chance(dt * 0.0025 * w.sev / 20 * (has(tr, 'medecine') ? 0.3 : 1))) { w.infected = true; infectFever(b); b.memory.unshift('Ma plaie s’est infectée.'); }
  }
  for (const w of b.wounds) if (w.sev <= 0 && w.kind === 'fracture' && w.max > 32 && chance(0.4)) { b.flags.limp = true; b.memory.unshift('Ma jambe a mal guéri. Je boiterai toute ma vie.'); }
  b.wounds = b.wounds.filter((w) => w.sev > 0);
}
export const woundSpeed = (b) => (b.wounds?.some((w) => w.kind === 'fracture' && w.sev > 5) ? 0.5 : 1) * (b.flags?.limp ? 0.85 : 1);
export const WOUND_LABEL = { plaie: 'Plaie', fracture: 'Fracture', morsure: 'Morsure' };

// ---------- mythes & culture ----------
export function addMyth(tr, text) {
  tr.myths ||= [];
  if (tr.myths.some((m) => m.text === text)) return;
  tr.myths.push({ t: S.time, text }); if (tr.myths.length > 12) tr.myths.shift();
  log(`📖 ${tr.name} raconte désormais : « ${text} »`, 'culture', false);
}
export function mythsWitnessed(x, y, r, text) { for (const tr of S.tribes) if (tr.alive && tr.members.some((b) => dist(b.x, b.y, x, y) < r)) addMyth(tr, text); }
const SONGS = ['♪ La la lalaa… ♪', '♪ Ô soleil captif, ne nous quitte pas ♪', '♪ Dansons autour du feu ♪', '♪ Hey ! Ho ! Hey ! ♪', '♪ Chantons pour les ancêtres ♪', '♪ Le vent, la pierre et l’eau ♪'];
export function veilleeLine(b, tr) {
  const r = rnd();
  if (tr.myths?.length && r < 0.35) { const m = pick(tr.myths); return { text: `Écoutez… ${m.text}.`, myth: true }; }
  if (r < 0.65) return { text: pick(SONGS), song: true };
  return { text: pick(['Quand j’étais jeune, la forêt allait jusqu’au lac.', 'On raconte que la Paroi chante la nuit.', 'Mon père chassait le cerf à mains nues !', 'Un jour, nos enfants verront le dehors.', 'Les anciens disaient que le soleil était un œil.', 'Rions, demain sera dur.', 'À nos morts !']) };
}

// ---------- élection du chef ----------
export function electLeader(tr) {
  const cands = tr.members.filter((b) => b.age >= 20 && b.age < 70);
  if (!cands.length) return null;
  const voters = tr.members.filter((b) => b.age >= 14);
  const votes = new Map();
  for (const v of voters) {
    let best = null, bs = -1e9;
    for (const c of cands) {
      const s = (v === c ? 15 : rel(v, c)) + (c.genes.int + c.genes.soc) * 10 + (hasT(c, 'courageux') ? 6 : 0) + (hasT(c, 'sage') ? 8 : 0) + (c.age > 30 ? 5 : 0) + (tr.war ? c.genes.str * 10 : 0) + rnd() * 8;
      if (s > bs) { bs = s; best = c; }
    }
    if (best) votes.set(best, (votes.get(best) || 0) + 1);
  }
  const [win, n] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (!win) return null;
  if (tr.leader !== win.id) { log(`🗳️ ${win.name} est choisi${win.sex === 'F' ? 'e' : ''} comme chef de ${tr.name} (${n} voix sur ${voters.length}).`, 'social', false, [win.x, win.y]); win.memory.unshift(`Mon peuple m’a choisi${win.sex === 'F' ? 'e' : ''} comme chef.`); win.emo.joy += 20; }
  tr.leader = win.id;
  return win;
}

// ---------- fêtes du calendrier ----------
export function calendarFestival(tr) {
  const { season, dayOfSeason } = timeInfo();
  if (season === 2 && dayOfSeason === 5 && has(tr, 'agriculture')) return 'Fête des Récoltes';
  if (season === 3 && dayOfSeason === 2 && has(tr, 'feu')) return 'Fête de la Longue Nuit';
  if (season === 0 && dayOfSeason === 0 && has(tr, 'spiritualite')) return 'Fête du Renouveau';
  return null;
}
