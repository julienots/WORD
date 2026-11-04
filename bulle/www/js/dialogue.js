// ===== DIALOGUES & PENSÉES =====
import { S, timeInfo, baseTemp, weatherInfo } from './world.js';
import { SEASONS } from './config.js';
import { pick, chance, rnd, fill } from './util.js';
import { rel, has, tribeById, TECHS } from './society.js';

const byId = (id) => S.beings.find((b) => b.id === id);
const name = (id) => (byId(id) || S.dead?.get(id) || { name: '…' }).name;

// ---- sujets de conversation ----
const TOPICS = {
  meteo: {
    w: () => 1,
    make: (a, b, c) => [
      [a, pick(['Tu as vu ce ciel ?', 'Quel temps…', 'Le soleil captif est {sun} aujourd’hui.', 'Encore {w}.'])],
      [b, pick(['Oui. {season} est {feel} cette année.', 'Il fait {temp} degrés, je le sens dans mes os.', 'Les anciens disent que le ciel ne change jamais vraiment.', 'J’aime quand il pleut, le monde sent bon.'])],
    ],
    rel: 3,
  },
  faim: {
    w: (a) => (a.sat < 40 ? 4 : 0.3),
    make: (a, b) => [
      [a, pick(['J’ai faim… les baies se font rares.', 'Il n’y a plus rien à manger près du foyer.', 'Mon ventre crie depuis l’aube.'])],
      [b, b.carry.food > 0 ? pick(['Tiens, prends un peu de ce que j’ai.', 'Partageons, je ne te laisserai pas comme ça.']) : pick(['Moi aussi. Il faudrait chasser.', 'Si l’hiver est long, nous mourrons.', 'Les autres tribus ont tout pris !'])],
    ],
    after: (a, b) => { if (b.carry.food > 0 && b.genes.emp > 0.35) { b.carry.food--; a.sat = Math.min(100, a.sat + 25); a.memory.unshift(`${b.name} a partagé sa nourriture avec moi.`); return 14; } return 2; },
  },
  ragot: {
    w: (a) => (Object.keys(a.rel).length > 3 ? 1.2 : 0),
    make: (a, b) => {
      const ids = Object.entries(a.rel).filter(([id]) => +id !== b.id && byId(+id)).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
      if (!ids.length) return null;
      const [id, v] = ids[0], n = name(+id);
      return v > 0
        ? [[a, pick([`${n} est quelqu’un de bien, tu sais.`, `J’ai passé la journée avec ${n}. On rit beaucoup.`, `Je crois que ${n} m’apprécie.`])], [b, pick(['C’est vrai, je l’aime bien aussi.', 'Méfie-toi quand même.', 'Tu devrais lui dire.'])]]
        : [[a, pick([`Je ne supporte plus ${n}.`, `${n} m’a volé ma part !`, `Un jour, ${n} paiera.`])], [b, pick(['Calme-toi…', 'Moi non plus je ne l’aime pas.', 'La colère ne nourrit personne.'])]];
    },
    rel: 4,
  },
  dieu: {
    w: (a) => a.faith * 2.5,
    make: (a, b) => [
      [a, pick(['Crois-tu que quelqu’un nous regarde ?', 'J’ai senti une présence, cette nuit. Immense.', 'Le Créateur a parlé, je l’ai entendu !', 'Pourquoi le Grand Œil nous laisse-t-il souffrir ?', 'Chaque éclair est un message d’En-Haut.'])],
      [b, b.faith > 0.5 ? pick(['Oui. Il veille sur nous, j’en suis sûr.', 'Prions ensemble ce soir.', 'Il a créé la bulle, et nous dedans.']) : pick(['Il n’y a personne. Juste nous.', 'Si un dieu existe, il est cruel.', 'Je crois ce que je vois.'])],
    ],
    after: (a, b) => { b.faith += (a.faith - b.faith) * 0.08; return b.faith > 0.5 === a.faith > 0.5 ? 6 : -4; },
  },
  paroi: {
    w: (a) => a.aware * 3 + (a.flags.wall ? 1.5 : 0),
    make: (a, b) => [
      [a, pick(['Au bout du monde, il y a un mur que l’on ne voit pas. Je l’ai touché.', 'Pourquoi le ciel s’arrête-t-il ?', 'Il y a quelque chose derrière la Paroi. Je le sais.', 'Le soleil tourne au-dessus de nous comme dans une coquille…', 'Sommes-nous enfermés ?'])],
      [b, b.aware > 0.4 ? pick(['Oui… nous sommes dans une bulle. Il faut en sortir.', 'Un jour nous traverserons.', 'J’en rêve chaque nuit : le dehors.']) : pick(['Tais-toi, tu fais peur aux enfants.', 'Le monde est le monde. Il n’y a pas de « derrière ».', 'Tu as trop regardé le ciel.'])],
    ],
    after: (a, b) => { b.aware = Math.min(1, b.aware + 0.03 * (0.5 + b.genes.cur)); return 3; }, know: 2.5,
  },
  deuil: {
    w: (a) => (a.grief > 20 ? 4 : 0),
    make: (a, b) => [
      [a, pick(['{lost} me manque tellement…', 'Pourquoi {lost} est-il parti ?', 'Je revois {lost} chaque fois que je ferme les yeux.'])],
      [b, pick(['Je suis là. Pleure si tu veux.', 'Personne n’oubliera.', 'La mort prend tout le monde, un jour.'])],
    ],
    after: (a) => { a.grief *= 0.75; a.emo.sadness *= 0.85; return 10; },
  },
  guerre: {
    w: (a) => (tribeById(a.tribeId)?.war ? 3 : 0),
    make: (a, b) => {
      const tr = tribeById(a.tribeId), en = tr?.war ? tribeById(tr.war.target) : null;
      return [[a, pick([`${en?.name || 'Eux'} doivent payer.`, 'J’ai peur pour mes enfants.', 'Pourquoi nous battons-nous, déjà ?'])], [b, b.genes.agg > 0.55 ? pick(['Nous les écraserons !', 'Prends ta lance.']) : pick(['Je veux juste la paix.', 'Assez de morts.'])]];
    },
    rel: 2,
  },
  savoir: {
    w: (a) => a.genes.int * 1.4 + a.genes.cur,
    make: (a, b, c) => [
      [a, pick(['Et si on frottait deux pierres pour faire naître le feu ?', 'J’ai remarqué que les graines repoussent là où elles tombent.', 'Les étoiles du dôme ne bougent jamais. Étrange, non ?', 'J’essaie de comprendre comment marche le monde.', 'Regarde : si je taille la pierre comme ça, elle coupe mieux.', 'Je compte les jours. Ils reviennent toujours au nombre {dpy}.'])],
      [b, pick(['Montre-moi !', 'Tu es bizarre… mais c’est intéressant.', 'Encore tes idées folles.', 'Il faudrait l’apprendre aux enfants.'])],
    ],
    rel: 3, know: 3,
  },
  famille: {
    w: (a) => (a.children.length ? 1.5 : 0) + (a.pregnant ? 2 : 0),
    make: (a, b) => [
      [a, a.pregnant ? pick(['Je sens le bébé bouger !', 'Bientôt, nous serons un de plus.']) : pick([`{child} grandit si vite.`, `{child} a fait ses premiers pas aujourd’hui.`, 'Mes enfants sont ma plus grande joie.'])],
      [b, pick(['C’est merveilleux.', 'Profite de chaque instant.', 'La vie continue malgré tout.'])],
    ],
    rel: 6,
  },
  reve: {
    w: () => 0.6,
    make: (a, b) => [
      [a, pick(['J’ai rêvé que je volais au-delà du ciel.', 'J’ai rêvé de mes ancêtres. Ils me parlaient.', 'Cette nuit, j’ai vu un œil immense qui nous regardait.', 'J’ai rêvé d’un monde sans paroi, infini.'])],
      [b, pick(['Les rêves disent la vérité, parfois.', 'Moi je ne rêve que de nourriture !', 'Raconte-moi encore.'])],
    ],
    rel: 4, know: 1,
  },
  sens: {
    w: (a) => (a.age > 30 ? a.genes.cur + a.genes.int * 0.5 : 0.2) + (has(tribeById(a.tribeId), 'philosophie') ? 1.5 : 0),
    make: (a, b) => [
      [a, pick(['Pourquoi sommes-nous nés ?', 'À quoi sert de vivre si l’on doit mourir ?', 'Qui étions-nous avant de naître ?', 'Peut-être que notre monde n’est qu’un jouet entre les mains d’un géant.', 'Est-ce que quelqu’un se souviendra de nous ?'])],
      [b, pick(['Pour aimer, sans doute.', 'Je n’en sais rien, et ça me fait peur.', 'Pour que nos enfants vivent mieux que nous.', 'Pour sortir d’ici, un jour.'])],
    ],
    rel: 5, know: 2,
  },
  partir: {
    w: (a) => (a.wantLeave ? 4 : 0),
    make: (a, b) => [
      [a, pick(['Je veux partir. Voir ce qu’il y a dehors.', 'Je ne supporte plus d’être enfermé.', 'Un jour je franchirai la Paroi, même si j’en meurs.'])],
      [b, b.wantLeave ? 'Je viendrai avec toi.' : pick(['Partir ? Mais pour aller où ?', 'Reste avec nous, c’est ici chez toi.', 'Tu es fou.'])],
    ],
    after: (a, b) => { if (b.aware > 0.5 && chance(0.4)) b.wantLeave = true; return 2; },
  },
  dispute: {
    w: (a, b) => (rel(a, b) < -30 ? 5 : 0) + a.genes.agg * (a.emo.anger > 50 ? 2 : 0),
    make: (a, b) => [
      [a, pick(['Dégage de mon chemin !', 'Tu crois que je n’ai pas vu ce que tu as fait ?', 'Encore toi…', 'Tu as pris ce qui m’appartenait.'])],
      [b, pick(['Fais attention à ce que tu dis.', 'Tu me cherches ?', 'Laisse-moi tranquille !'])],
      [a, pick(['Tu vas voir.', 'Un jour, je te le ferai payer.', 'Hmpf.'])],
    ],
    after: (a, b) => { a.emo.anger += 15; b.emo.anger += 15; return -12; },
  },
  enseigner: {
    w: (a, b) => (a.age > 40 && b.age < 16 ? 5 : 0),
    make: (a, b) => [
      [a, pick(['Écoute-moi bien, petit : ne mange jamais les baies blanches.', 'Quand j’avais ton âge, le monde était plus vert.', 'La Paroi ? Ne t’en approche pas trop.', 'Respecte le feu et il te protégera.', 'Voici comment on trouve de l’eau.'])],
      [b, pick(['D’accord, ancien !', 'Raconte encore une histoire !', 'Pourquoi ?'])],
    ],
    after: (a, b) => { for (const k in b.skills) b.skills[k] = Math.min(1, b.skills[k] + a.skills[k] * 0.02); return 8; }, know: 2,
  },
};

// nouveaux sujets : lieux, mythes, chasse, travail
Object.assign(TOPICS, {
  lieux: {
    w: (a) => (a.know?.berries.length || 0) > 2 ? 1.6 : 0,
    make: (a, b) => [
      [a, pick(['J’ai trouvé des buissons pleins de baies, {place}.', 'Il y a de la bonne pierre {place}.', 'J’ai vu un troupeau de cerfs {place}.', 'Si tu as faim, va {place}, il reste des baies.'])],
      [b, pick(['Merci, j’irai demain.', 'Je n’y serais jamais allé tout seul.', 'Garde ça pour nous deux, d’accord ?'])],
    ], rel: 5,
  },
  mythe: {
    w: (a) => (tribeById(a.tribeId)?.myths?.length ? 1.4 + a.faith : 0),
    make: (a, b) => { const m = pick(tribeById(a.tribeId).myths).text; return [[a, `Tu connais l’histoire ? « ${m} »…`], [b, pick(['Mon grand-père me la racontait.', 'Je n’y crois qu’à moitié.', 'Raconte-la encore !', 'Les anciens disent que c’est vrai.'])]]; },
    after: (a, b) => { b.faith = Math.min(1, b.faith + 0.02); return 4; }, know: 1,
  },
  chasse: {
    w: (a) => (a.role === 'chasseur' ? 2 : 0),
    make: (a, b) => [
      [a, pick(['Demain on chasse le cerf, tu viens ?', 'Les bêtes nous fuient, elles ont appris à nous craindre.', 'Il faut viser les plus faibles du troupeau.', 'J’ai vu des traces d’ours. Méfie-toi.'])],
      [b, pick(['Compte sur moi.', 'Sois prudent.', 'À plusieurs, c’est plus sûr.'])],
    ], rel: 4, know: 1,
  },
});
const LOVE = {
  make: (a, b) => [
    [a, pick(['Tu sais… je pense à toi tout le temps.', 'Quand tu es là, tout est plus doux.', 'Veux-tu partager ma vie ?', 'Tes yeux sont plus beaux que le soleil du dôme.'])],
    [b, '{answer}'],
  ],
};

export function conversation(a, b) {
  const lovePossible = a.wantsLove && canLove(a, b) && rel(a, b) > 35;
  if (lovePossible && chance(0.6)) {
    const accept = b.partner == null && canLove(b, a) && rel(b, a) > 25 + rnd() * 30;
    const lines = LOVE.make(a, b);
    lines[1][1] = accept ? pick(['Oui… oui, moi aussi.', 'J’attendais que tu le dises.', 'Je t’aime aussi.']) : pick(['Je… je ne ressens pas la même chose.', 'Non. Désolé.', 'Laisse-moi du temps.']);
    return { topic: 'amour', lines: lines.map(([s, t]) => [s, vars(t, s, s === a ? b : a)]), love: accept, delta: accept ? 20 : -6 };
  }
  let tot = 0; const ws = [];
  for (const [k, t] of Object.entries(TOPICS)) { const w = Math.max(0, t.w(a, b)); ws.push([k, w]); tot += w; }
  let r = rnd() * tot, key = 'meteo';
  for (const [k, w] of ws) { r -= w; if (r <= 0) { key = k; break; } }
  const T = TOPICS[key];
  const raw = T.make(a, b) || TOPICS.meteo.make(a, b);
  return { topic: key, lines: raw.map(([s, t]) => [s, vars(t, s, s === a ? b : a)]), T };
}
export function finishConversation(a, b, conv) {
  let d = conv.delta ?? conv.T?.rel ?? 3;
  if (conv.T?.after) d = conv.T.after(a, b) ?? d;
  // compatibilité de caractère
  const comp = 1 - (Math.abs(a.genes.soc - b.genes.soc) + Math.abs(a.genes.agg - b.genes.agg) + Math.abs(a.faith - b.faith)) / 3;
  d += (comp - 0.5) * 8 + (a.genes.soc + b.genes.soc - 1) * 3;
  return { d, know: conv.T?.know || 0.6 };
}

export function canLove(a, b) {
  if (a.age < 16 || b.age < 16 || a.id === b.id) return false;
  if (a.parents.includes(b.id) || b.parents.includes(a.id) || a.parents.some((p) => b.parents.includes(p))) return false;
  if (Math.abs(a.age - b.age) > 24) return false;
  return a.orient === 'hetero' ? a.sex !== b.sex : a.sex === b.sex;
}

function vars(t, s, o) {
  const { season } = timeInfo(), temp = Math.round(baseTemp());
  const child = s.children.map((id) => byId(id)).filter(Boolean)[0];
  return fill(t, {
    w: weatherInfo().label.toLowerCase(), season: SEASONS[season], temp,
    feel: temp > 22 ? 'brûlant' : temp < 4 ? 'glacial' : 'doux',
    sun: pick(['éclatant', 'pâle', 'étrange', 'bas']),
    place: pick(['près du lac', 'vers la colline', 'au bord de la forêt', 'du côté de la Paroi', 'derrière les rochers']),
    lost: s.lostName || 'mon proche', child: child ? child.name : 'Mon petit', dpy: 24, other: o.name,
  });
}

// ---- pensées intérieures ----
export function thought(b) {
  const tr = tribeById(b.tribeId);
  const c = [];
  if (b.sat < 25) c.push([5, pick(['J’ai tellement faim…', 'Il faut que je trouve à manger.', 'Si je ne mange pas, je vais mourir.'])]);
  if (b.thirst < 25) c.push([5, pick(['De l’eau… vite.', 'Ma gorge brûle.'])]);
  if (b.energy < 20) c.push([3, 'Je tombe de fatigue.']);
  if (b.cold > 0.5) c.push([4, pick(['J’ai si froid…', 'Le froid me ronge les os.'])]);
  if (b.disease) c.push([4, pick(['Je me sens si faible…', `Cette ${b.disease.name.toLowerCase()} va m’emporter ?`, 'Ma tête brûle.'])]);
  if (b.grief > 20) c.push([4, pick([`${b.lostName} me manque.`, `Pourquoi ${b.lostName} ?`, 'Le monde est vide sans lui.'])]);
  if (b.partner) { const p = byId(b.partner); if (p) c.push([1.5, pick([`J’aime ${p.name}.`, `Je pense à ${p.name}.`, `${p.name} me rend heureux.`])]); }
  else if (b.age > 17 && b.age < 45) c.push([1, pick(['Trouverai-je quelqu’un à aimer ?', 'Je me sens seul.'])]);
  if (b.faith > 0.6) c.push([1.5, pick(['Ô Créateur, protège-nous.', 'Je sens ton regard sur nous.', 'Dis-moi ce que tu attends de nous.'])]);
  if (b.faith < 0.15 && b.age > 20) c.push([0.6, 'Personne ne nous regarde. Nous sommes seuls.']);
  if (b.aware > 0.3) c.push([b.aware * 3, pick(['Qu’y a-t-il derrière la Paroi ?', 'Pourquoi notre monde est-il rond et fermé ?', 'Le soleil… il est à l’intérieur avec nous.', 'Sommes-nous des prisonniers ?', 'Qui nous a enfermés ici ?'])]);
  if (b.wantLeave) c.push([3, pick(['Je dois sortir d’ici.', 'Dehors… il doit y avoir un dehors.', 'Je n’en peux plus de cette bulle.'])]);
  if (tr?.war) c.push([2, b.genes.agg > 0.5 ? pick(['Je vais les écraser.', 'Ils ont tué les nôtres.']) : pick(['J’ai peur de la guerre.', 'Pourvu que mes enfants survivent.'])]);
  if (b.age > 60) c.push([1.2, pick(['Je n’ai plus beaucoup de temps.', 'J’ai vu tant de saisons…', 'Qui se souviendra de moi ?'])]);
  if (b.age < 10) c.push([1.2, pick(['Je veux jouer !', 'Pourquoi le ciel est-il bleu ?', 'Maman, où es-tu ?', 'Quand je serai grand, j’irai au bout du monde.'])]);
  if (b.wounds?.length) c.push([3, pick(['Ma blessure me lance…', 'J’ai mal, mais je tiendrai.', b.wounds.some((w) => w.kind === 'fracture') ? 'Ma jambe… je ne peux presque plus marcher.' : 'Il faut que ça cicatrise.'])]);
  if (b.role === 'chasseur') c.push([1, pick(['Où sont passés les cerfs ?', 'Le gibier se méfie de plus en plus.', 'Il me faut une meilleure lance.'])]);
  if (b.role === 'chaman') c.push([1, pick(['Les esprits me parlent la nuit.', 'Je dois raconter les vieilles histoires.'])]);
  if (b.traits?.includes('traumatisé')) c.push([2, pick(['Je revois encore ce jour-là…', 'Je n’arrive plus à dormir.'])]);
  if (tr?.famine) c.push([2.5, pick(['Les réserves sont vides…', 'Il faut que je trouve à manger pour les enfants.', 'Si l’hiver dure, nous mourrons tous.'])]);
  if (tr?.myths?.length && b.faith > 0.3) c.push([0.8, `Les anciens racontent : « ${pick(tr.myths).text} ».`]);
  if (b.emo.joy > 70) c.push([1.5, pick(['La vie est belle.', 'Quelle belle journée.', 'Je suis heureux.'])]);
  if (b.emo.anger > 60) c.push([2, pick(['Je bous de colère.', 'Quelqu’un va payer.'])]);
  if (b.genes.cur > 0.7) c.push([1, pick(['Comment fonctionne le monde ?', 'Il faut que j’explore plus loin.', 'Pourquoi les choses tombent-elles toujours vers le sol ?'])]);
  if (tr && !has(tr, 'feu') && TECHS.feu) c.push([0.5, 'Si seulement on pouvait garder la lumière de l’éclair…']);
  c.push([0.5, pick(['Hmm…', 'Que vais-je faire aujourd’hui ?', 'Le vent sent bon.', 'Les oiseaux tournent toujours en rond, eux aussi.'])]);
  let tot = c.reduce((s, x) => s + x[0], 0), r = rnd() * tot;
  for (const [w, t] of c) { r -= w; if (r <= 0) return t; }
  return c[0][1];
}
