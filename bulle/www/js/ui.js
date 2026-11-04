// ===== INTERFACE =====
import { SEASONS, SEASON_ICONS, SPEEDS, DAYS_PER_SEASON, DAYS_PER_YEAR, HOURS_PER_YEAR } from './config.js';
import { S, timeInfo, baseTemp, weatherInfo, isNight as isNightNow } from './world.js';
import { byId, stage, mood, moodEmoji, GENE_LABEL, SKILL_LABEL, elderAge } from './beings.js';
import { tribeById, TECHS, has, rel } from './society.js';
import { POWERS, REVELATIONS, powerById } from './god.js';
import { OBJECTIVES, save } from './sim.js';
import { view, cam, focusOn } from './render.js';
import { ROLES, TRAIT_INFO, WOUND_LABEL } from './mind.js';
import { SPECIES } from './animals.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const UI = { speed: 2, panel: null, logFilter: 'all', handlers: {} };

export function fmtDate(t) { const ti = timeInfo(t); return `An ${ti.year} · ${SEASONS[ti.season]} · J${ti.dayOfSeason + 1}`; }
export function fmtHour(t) { const h = Math.floor(t % 24), m = Math.floor((t % 1) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
export function fmtElapsed(h) {
  const y = Math.floor(h / HOURS_PER_YEAR); h -= y * HOURS_PER_YEAR; const d = Math.floor(h / 24); h -= d * 24;
  return (y ? `${y} an${y > 1 ? 's' : ''} ` : '') + (d || y ? `${d} j ` : '') + `${Math.floor(h)} h`;
}
const fmtReal = (s) => { s = Math.floor(s); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, '0')).join(':'); };
const pct = (v) => Math.round(Math.max(0, Math.min(100, v)));
const barColor = (v) => (v > 60 ? 'var(--green)' : v > 30 ? 'var(--gold)' : 'var(--red)');
const bar = (label, v, color) => `<div class="row"><span class="lbl">${label}</span><div class="bar"><i style="width:${pct(v)}%;background:${color || barColor(v)}"></i></div><span class="val">${pct(v)}</span></div>`;

export function initUI(handlers) {
  UI.handlers = handlers;
  // vitesses
  const sp = $('#speeds');
  sp.innerHTML = SPEEDS.map((s, i) => `<button data-sp="${i}">${s.label}</button>`).join('');
  sp.onclick = (e) => { const b = e.target.closest('button'); if (b) setSpeed(+b.dataset.sp); };
  // pouvoirs
  $('#powers').innerHTML = POWERS.map((p) => `<button class="pw" data-pw="${p.id}" title="${esc(p.desc)}"><span class="i">${p.icon}</span><span class="n">${p.name}</span><span class="c">${p.cost ? '✨' + p.cost : '&nbsp;'}</span></button>`).join('');
  $('#powers').onclick = (e) => { const b = e.target.closest('.pw'); if (b) selectPower(b.dataset.pw); };
  // panneaux
  $('#side').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'btn-fit') return handlers.fit();
    if (!b.dataset.panel) return;
    const p = b.dataset.panel; UI.panel === p ? closePanel() : openPanel(p);
  };
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { e.target.closest('.sheet').id === 'inspector' ? closeInspector() : closePanel(); }
    const lk = e.target.closest('[data-being]'); if (lk) { const b = byId(+lk.dataset.being); if (b) { handlers.select(b); } }
    const at = e.target.closest('[data-at]'); if (at) { const [x, y] = at.dataset.at.split(',').map(Number); focusOn(x, y, Math.max(cam.tz, cam.fit * 4)); }
  });
  setSpeed(UI.speed);
  selectPower('inspect');
}
export function setSpeed(i) { UI.speed = i; S.speedV = SPEEDS[i].v; document.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('on', +b.dataset.sp === i)); }
export function selectPower(id) {
  const p = powerById(id); view.power = id === 'inspect' ? null : id; view.powerR = p.r;
  document.querySelectorAll('.pw').forEach((b) => b.classList.toggle('on', b.dataset.pw === id));
  const h = $('#power-hint');
  if (id === 'inspect') h.classList.add('hidden');
  else if (id === 'voice' || !p.r) { h.classList.add('hidden'); UI.handlers.instantPower(id); selectPower('inspect'); }
  else { h.textContent = `${p.icon} ${p.name} — touche le monde pour agir (✨${p.cost})`; h.classList.remove('hidden'); }
}

// ---------- HUD ----------
let lastHud = 0;
export function updateHUD(force = false) {
  const now = performance.now(); if (!force && now - lastHud < 200) return; lastHud = now;
  const ti = timeInfo();
  $('#t-hour').textContent = fmtHour(S.time);
  $('#t-date').textContent = `An ${ti.year} · ${SEASON_ICONS[ti.season]} ${SEASONS[ti.season]} · Jour ${ti.dayOfSeason + 1}/${DAYS_PER_SEASON}`;
  $('#t-weather').textContent = isNightNow() && (S.weather.type === 'clair' || S.weather.type === 'canicule') ? '🌙' : weatherInfo().icon; $('#t-weather').title = weatherInfo().label;
  $('#t-temp').textContent = Math.round(baseTemp()) + '°C';
  $('#t-elapsed').textContent = fmtElapsed(S.time - S.startTime);
  $('#t-real').textContent = fmtReal(S.realTime);
  $('#s-pop').textContent = S.beings.length;
  $('#s-tribes').textContent = S.tribes.filter((t) => t.alive).length;
  $('#s-births').textContent = S.stats.births; $('#s-deaths').textContent = S.stats.deaths;
  $('#s-energy').style.width = (S.god.unlimited ? 100 : S.god.energy / S.god.max * 100) + '%';
  $('#s-energy-n').textContent = S.god.unlimited ? '∞' : Math.floor(S.god.energy);
  document.querySelectorAll('.pw').forEach((b) => { const p = powerById(b.dataset.pw); b.classList.toggle('poor', !S.god.unlimited && p.cost > S.god.energy); });
  // barre d'objectif
  const cur = OBJECTIVES.find((o) => !S.objectives[o.id]);
  const done = OBJECTIVES.filter((o) => S.objectives[o.id]).length;
  $('#goalbar').innerHTML = cur ? `🎯 <b>Objectif ${done + 1}/${OBJECTIVES.length}</b><br>${cur.text}<div class="prog"><i style="width:${done / OBJECTIVES.length * 100}%"></i></div>` : '🌀 <b>Libération accomplie</b>';
  // toasts
  while (S.toasts?.length) toast(S.toasts.shift());
  if (!$('#inspector').classList.contains('hidden')) refreshInspector();
  if (UI.panel && now - (UI.panelT || 0) > 1000) { UI.panelT = now; renderPanel(UI.panel, true); }
}
export function toast({ text, kind }) {
  const el = document.createElement('div'); el.className = 'toast k-' + kind; el.textContent = text;
  const box = $('#toasts'); box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.style.transition = 'opacity .5s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, 4200);
}

// ---------- fiche d'un être ----------
const ACT_LABEL = {
  drink: 'va boire', eat: 'mange', gather: 'cueille des baies', fish: 'pêche', chop: 'coupe du bois', mine: 'taille la pierre', deposit: 'rapporte des ressources au foyer',
  build: 'construit', farm: 'travaille aux champs', sleep: 'dort', warm: 'se réchauffe', seek: 'cherche quelqu’un à qui parler', talk: 'discute', listen: 'écoute',
  think: 'réfléchit', pray: 'prie', mourn: 'se recueille', wall: 'contemple la Paroi', explore: 'explore', idle: 'flâne', play: 'joue', follow: 'suit ses parents',
  flee: 'fuit !', fight: 'se bat', hunt: 'chasse', raid: 'part en raid', heal: 'soigne', exit: 'marche vers Le Passage',
  sip: 'boit à sa gourde', veillee: 'veille au coin du feu', funeral: 'assiste à des funérailles', feed: 'nourrit', rally: 'se rassemble pour la guerre', trade: 'part commercer', patrol: 'monte la garde',
};
export function actionText(b) {
  if (b.age < 3) return b.sleeping ? 'dort dans les bras de sa mère' : 'est porté par ses parents';
  const a = b.act; if (!a) return 'hésite…';
  let t = ACT_LABEL[a.type] || a.type;
  if ((a.type === 'talk' || a.type === 'listen') && byId(a.with)) t += ' avec ' + byId(a.with).name;
  if (a.type === 'seek' && byId(a.target)) t = (a.love ? 'va voir ' : 'va parler à ') + byId(a.target).name;
  if (a.type === 'fight' && !a.animal && byId(a.target)) t += ' contre ' + byId(a.target).name;
  if (a.type === 'fight' && a.animal && S.animalMap?.get(a.target)) t += ' contre un ' + SPECIES[S.animalMap.get(a.target).sp].name.toLowerCase();
  if (a.type === 'hunt' && S.animalMap?.get(a.target)) t += ' un ' + SPECIES[S.animalMap.get(a.target).sp].name.toLowerCase();
  if ((a.type === 'feed' || a.type === 'heal') && byId(a.target)) t += ' ' + byId(a.target).name;
  if (a.type === 'trade' && tribeById(a.to)) t += ' avec ' + tribeById(a.to).name;
  if (a.type === 'veillee' && a.fest) t = 'danse à la fête';
  if (a.track) t = 'piste le gibier';
  if (a.type === 'build' && S.bmap.get(a.target)) t += ' : ' + ({ hutte: 'une hutte', maison: 'une maison', grenier: 'un grenier', temple: 'le temple', passage: 'Le Passage', champ: 'un champ', feu: 'le foyer' }[S.bmap.get(a.target).type] || '');
  if (a.phase === 'go' && !['flee', 'fight', 'seek', 'hunt', 'explore', 'raid', 'exit'].includes(a.type)) t = '→ ' + t;
  return t;
}
let insId = null;
export function openInspector(b) { insId = b.id; S.selected = b.id; $('#inspector').classList.remove('hidden'); closePanel(); refreshInspector(true); }
export function closeInspector() { insId = null; S.selected = null; cam.follow = null; $('#inspector').classList.add('hidden'); }
export function refreshInspector() {
  const el = $('#inspector'); const b = byId(insId);
  if (!b) {
    const d = S.dead.get(insId);
    if (d) el.innerHTML = `<div class="ins-top"><div class="avatar" style="border-color:#888">${d.cause?.includes('Paroi') ? '🌀' : '🪦'}</div><div><h2>${esc(d.name)}</h2><div class="sub">${d.cause?.includes('Paroi') ? 'A quitté la bulle' : `Mort${d.sex === 'F' ? 'e' : ''} de ${esc(d.cause)}`} à ${Math.floor(d.age)} ans · ${fmtDate(d.died)}</div></div><span class="spacer"></span><button class="close" data-close>✕</button></div>`;
    return;
  }
  const tr = tribeById(b.tribeId), col = tr?.color || '#aaa';
  const p = byId(b.partner), parents = b.parents.map((id) => byId(id) || (S.dead.get(id) && { ...S.dead.get(id), dead: true, id })).filter(Boolean);
  const kids = b.children.map((id) => byId(id) || (S.dead.get(id) && { ...S.dead.get(id), dead: true, id })).filter(Boolean);
  const rels = Object.entries(b.rel).map(([id, v]) => [byId(+id), v]).filter(([o]) => o && o.id !== b.partner && !b.children.includes(o.id) && !b.parents.includes(o.id)).sort((x, y) => y[1] - x[1]);
  const friends = rels.filter((r) => r[1] > 25).slice(0, 5), rivals = rels.filter((r) => r[1] < -15).slice(-4).reverse();
  const who = (o, extra = '') => o ? `<span class="chip link" data-being="${o.id}">${o.dead ? '✝ ' : ''}${esc(o.name)}${extra}</span>` : '';
  const st = stage(b);
  const ageStr = b.age < 1 ? `${Math.floor(b.age * 12)} mois` : `${Math.floor(b.age)} ans`;
  el.innerHTML = `
    <div class="ins-top"><div class="avatar" style="border-color:${col}">${moodEmoji(b)}</div>
      <div><h2>${esc(b.name)} <small style="color:var(--mute)">${b.sex === 'F' ? '♀' : '♂'}</small></h2>
      <div class="sub">${ageStr} · ${st}${b.pregnant ? ' · enceinte 🤰' : ''} · <span style="color:${col}">${esc(tr?.name || 'sans peuple')}</span>${tr?.leader === b.id ? ' · 👑 chef' : ''}</div>
      <div class="sub">${b.role && ROLES[b.role] ? `${ROLES[b.role].icon} ${ROLES[b.role].name}` : ''} ▸ ${esc(actionText(b))}</div></div>
      <span class="spacer"></span><button class="close" data-close>✕</button></div>
    <div class="ins-body">
      <div class="thought">« ${esc(b.thought)} »</div>
      ${b.traits?.length ? `<div>${b.traits.map((t) => `<span class="chip">${TRAIT_INFO[t] || ''} ${t}</span>`).join('')}</div>` : ''}
      <div class="btns">
        <button class="btn ${cam.follow === b.id ? 'acc' : ''}" data-act="follow">🎥 ${cam.follow === b.id ? 'Suivi actif' : 'Suivre'}</button>
        <button class="btn gold" data-act="bless">✨ Bénir</button>
        <button class="btn" data-act="heal">💊 Guérir</button>
        <button class="btn red" data-act="smite">⚡ Foudroyer</button>
      </div>
      <div class="sec">Corps</div>
      ${bar('Santé', b.health)}${bar('Satiété', b.sat)}${bar('Hydratation', b.thirst)}${bar('Énergie', b.energy)}${bar('Lien social', b.social)}${bar('Chaleur', 100 - b.cold * 100)}
      ${b.disease ? `<div class="row" style="color:#c9f19a">🤒 ${esc(b.disease.name)} — gravité ${pct(b.disease.sev)}%${b.treated ? ' (soigné)' : ''}</div>` : ''}
      ${(b.wounds || []).map((w) => `<div class="row" style="color:#ffb3b3">🩹 ${WOUND_LABEL[w.kind]} — ${pct(w.sev)}%${w.infected ? ' (infectée)' : ''}${w.treated ? ' (soignée)' : ''}</div>`).join('')}${b.flags?.limp ? '<div class="row" style="color:var(--mute)">🦯 Boite depuis une fracture</div>' : ''}
      <div class="row" style="color:var(--mute);font-size:12px">Ressenti ${Math.round(b.felt ?? 0)}°C · porte ${b.carry.food.toFixed(0)} nourriture, ${b.carry.wood.toFixed(0)} bois, ${b.carry.stone.toFixed(0)} pierre${b.carry.water ? `, gourde ${b.carry.water}/3` : ''} · se souvient de ${(b.know?.berries.length || 0) + (b.know?.stone.length || 0) + (b.know?.game.length || 0)} lieux</div>
      <div class="sec">Émotions</div>
      ${bar('Joie', b.emo.joy, '#ffd36b')}${bar('Tristesse', b.emo.sadness, '#7aa7ff')}${bar('Peur', b.emo.fear, '#b48cff')}${bar('Colère', b.emo.anger, '#ff6b6b')}${bar('Amour', b.emo.love, '#ff8fc7')}
      <div class="sec">Esprit</div>
      ${bar('Foi en toi', b.faith * 100, '#e5ccff')}${bar('Conscience de la bulle', b.aware * 100, '#8fd3ff')}
      ${b.wantLeave ? '<div class="row">🚪 Veut quitter la bulle</div>' : ''}${b.grief > 20 ? `<div class="row">🖤 En deuil de ${esc(b.lostName)}</div>` : ''}
      <div class="sec">Famille & liens</div>
      <div>${p ? `💞 ${who(p)}` : '<span class="chip">célibataire</span>'} ${parents.length ? '· parents ' + parents.map((o) => who(o)).join('') : ''}</div>
      ${kids.length ? `<div>👶 ${kids.map((o) => who(o)).join('')}</div>` : ''}
      ${friends.length ? `<div>🤝 ${friends.map(([o, v]) => who(o, ' ' + Math.round(v))).join('')}</div>` : ''}
      ${rivals.length ? `<div>⚔️ ${rivals.map(([o, v]) => who(o, ' ' + Math.round(v))).join('')}</div>` : ''}
      ${familyTree(b, who)}
      ${b.kills ? `<div class="row" style="color:#ffb3b3">A tué ${b.kills} être${b.kills > 1 ? 's' : ''}</div>` : ''}
      <div class="sec">Génome (hérité, avec mutations)</div>
      <div class="grid2">${Object.entries(GENE_LABEL).map(([k, l]) => bar(l, b.genes[k] * 100, '#8fd3ff')).join('')}</div>
      <div class="sec">Compétences (apprises)</div>
      <div class="grid2">${Object.entries(SKILL_LABEL).map(([k, l]) => bar(l, b.skills[k] * 100, '#6be39a')).join('')}</div>
      <div class="sec">Souvenirs</div>
      ${b.memory.map((m) => `<div class="mem">${esc(m)}</div>`).join('') || '<div class="mem">—</div>'}
    </div>`;
  el.querySelectorAll('[data-act]').forEach((bt) => (bt.onclick = () => UI.handlers.beingAction(b, bt.dataset.act)));
}

function familyTree(b, who) {
  const get = (id) => byId(id) || (S.dead.get(id) && { ...S.dead.get(id), dead: true, id });
  const parents = b.parents.map(get).filter(Boolean);
  const gp = parents.flatMap((p) => (byId(p.id)?.parents || [])).map(get).filter(Boolean);
  const sib = S.beings.filter((o) => o !== b && o.parents.some((x) => x >= 0 && b.parents.includes(x)));
  const gc = b.children.map((id) => byId(id)).filter(Boolean).flatMap((c) => c.children).map(get).filter(Boolean);
  if (!gp.length && !sib.length && !gc.length) return '';
  return `<div class="sec">Arbre familial</div>
    ${gp.length ? `<div>👴 Grands-parents : ${gp.map((o) => who(o)).join('')}</div>` : ''}
    ${sib.length ? `<div>🧑‍🤝‍🧑 Frères et sœurs : ${sib.slice(0, 8).map((o) => who(o)).join('')}</div>` : ''}
    ${gc.length ? `<div>🍼 Petits-enfants : ${gc.slice(0, 10).map((o) => who(o)).join('')}</div>` : ''}`;
}

// ---------- graphiques ----------
function chart(canvas, xs, series, yLabel) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = canvas.clientWidth || 340, H = 150;
  canvas.width = W * dpr; canvas.height = H * dpr; const c = canvas.getContext('2d'); c.scale(dpr, dpr);
  const L = 34, Rr = 8, T = 10, B = 20, max = Math.max(4, ...series.flatMap((s) => s.values)) * 1.08;
  c.strokeStyle = 'rgba(255,255,255,0.08)'; c.fillStyle = '#95a1c0'; c.font = '10px system-ui'; c.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const y = T + (H - T - B) * (1 - k / 4); c.beginPath(); c.moveTo(L, y); c.lineTo(W - Rr, y); c.stroke(); c.fillText(Math.round(max * k / 4), 4, y + 3); }
  if (xs.length > 1) { c.fillText(`An ${timeInfo(xs[0]).year}`, L, H - 5); const t = `An ${timeInfo(xs[xs.length - 1]).year}`; c.fillText(t, W - Rr - c.measureText(t).width, H - 5); }
  const X = (i) => L + (W - L - Rr) * (xs.length > 1 ? i / (xs.length - 1) : 0), Y = (v) => T + (H - T - B) * (1 - v / max);
  for (const s of series) { c.strokeStyle = s.color; c.lineWidth = s.width || 1.8; c.beginPath(); s.values.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)))); c.stroke(); }
}

// ---------- panneaux ----------
export function openPanel(name) { UI.panel = name; closeInspectorSoft(); $('#panel').classList.remove('hidden'); renderPanel(name); document.querySelectorAll('#side button').forEach((b) => b.classList.toggle('on', b.dataset.panel === name)); }
export function closePanel() { UI.panel = null; $('#panel').classList.add('hidden'); document.querySelectorAll('#side button').forEach((b) => b.classList.remove('on')); }
function closeInspectorSoft() { $('#inspector').classList.add('hidden'); insId = null; S.selected = null; }
function renderPanel(name, soft = false) {
  const body = $('#panel-body'), title = $('#panel-title');
  const keepScroll = $('#panel').scrollTop;
  if (name === 'goal') {
    title.textContent = '🎯 Le But';
    const cur = OBJECTIVES.find((o) => !S.objectives[o.id]);
    body.innerHTML = `<p>Tu es le dieu de cette bulle. Les êtres qui y vivent ignorent tout de leur monde. <b>Ton but : les mener jusqu’à la Libération</b> — qu’ils survivent, prospèrent, apprennent, comprennent qu’ils sont enfermés dans une sphère… puis construisent <b>Le Passage</b> pour franchir la Paroi.</p>
      <p style="color:var(--mute);font-size:12px">Ton énergie divine se régénère grâce à leur foi et à leurs prières. Les miracles renforcent la foi de ceux qui en sont témoins ; la colère divine aussi, mais par la peur.</p>
      ${OBJECTIVES.map((o) => `<div class="obj ${S.objectives[o.id] ? 'done' : o === cur ? 'cur' : ''}"><div class="ck">${S.objectives[o.id] ? '✓' : ''}</div><div><div class="t">${o.text}</div>${S.objectives[o.id] ? `<div class="w">${fmtDate(S.objectives[o.id])}</div>` : ''}</div></div>`).join('')}
      <div class="sec">Bilan</div>
      <div class="row">Population maximale : ${S.stats.maxPop} · Naissances : ${S.stats.births} · Morts : ${S.stats.deaths} · Guerres : ${S.stats.wars}${S.stats.escaped ? ` · Partis au-delà : ${S.stats.escaped}` : ''}</div>
      <div class="row" style="flex-wrap:wrap">${Object.entries(S.stats.causes).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<span class="chip">${esc(c)} : ${n}</span>`).join('')}</div>`;
  } else if (name === 'log') {
    title.textContent = '📜 Chroniques de la bulle';
    const F = [['all', 'Tout'], ['major', 'Majeur'], ['birth', 'Naissances'], ['death', 'Morts'], ['love', 'Amour'], ['war', 'Guerre'], ['tech', 'Savoir'], ['culture', 'Culture'], ['trade', 'Commerce'], ['question', 'Pensées'], ['god', 'Toi']];
    const f = UI.logFilter;
    const items = S.log.filter((l) => f === 'all' || l.kind === f || (f === 'major' && (l.kind === 'goal' || l.kind === 'major')) || (f === 'war' && l.kind === 'peace') || (f === 'trade' && l.kind === 'peace') || (f === 'love' && l.kind === 'social')).slice(-150).reverse();
    body.innerHTML = `<div class="filters">${F.map(([k, l]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}</div>` +
      items.map((l) => `<div class="log-item k-${l.kind}" ${l.at ? `data-at="${l.at[0]},${l.at[1]}"` : ''}><span class="d">An ${timeInfo(l.t).year} ${fmtHour(l.t)}</span><span>${esc(l.text)}</span></div>`).join('');
    body.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { UI.logFilter = b.dataset.f; renderPanel('log'); }));
  } else if (name === 'people') {
    title.textContent = '👥 Peuples de la bulle';
    const alive = S.tribes.filter((t) => t.alive), q = (UI.search || '').toLowerCase();
    const list = alive.map((t) => {
      const lead = byId(t.leader), en = t.war ? tribeById(t.war.target) : null;
      const rels = alive.filter((o) => o !== t).map((o) => `<span class="chip">${(t.allies || []).includes(o.id) ? '🤝 ' : ''}${esc(o.name)} : ${Math.round(t.rel[o.id] || 0)}</span>`).join('');
      const mem = [...t.members].filter((b) => !q || b.name.toLowerCase().includes(q)).sort((a, b) => b.age - a.age);
      const roles = {}; for (const b of t.members) if (b.role) roles[b.role] = (roles[b.role] || 0) + 1;
      return `<div class="tribe"><h3><span class="sw" style="background:${t.color}"></span>${esc(t.name)} <small style="color:var(--mute)">${t.members.length} membres</small></h3>
        <div style="font-size:12px;color:var(--mute)">${lead ? `👑 ${esc(lead.name)} · ` : ''}🍖 ${Math.floor(t.stock.food)} · 🪵 ${Math.floor(t.stock.wood)} · 🪨 ${Math.floor(t.stock.stone)} · 🙏 foi ${Math.round(t.faith * 100)}%${t.dogma ? ` · dogme : ${t.dogma}` : ''}${t.famine ? ' · <b style="color:var(--red)">disette</b>' : ''}${t.festival && S.time < t.festival.until ? ` · 🎉 ${esc(t.festival.name)}` : ''}</div>
        <div style="font-size:12px;margin-top:3px">${Object.entries(roles).map(([r, n]) => `<span class="chip">${ROLES[r]?.icon || ''} ${n}</span>`).join('')}</div>
        ${en ? `<div style="color:var(--red);margin-top:4px">⚔️ En guerre contre ${esc(en.name)} (pertes ${t.war.losses}, victimes ennemies ${t.war.kills})</div>` : ''}
        ${rels ? `<div style="margin-top:4px">Relations : ${rels}</div>` : ''}
        <div class="techs">${Object.keys(TECHS).filter((k) => t.tech[k]).map((k) => `<span class="tech">${TECHS[k].icon} ${TECHS[k].name}</span>`).join('')}${t.research ? `<span class="tech next">🔍 ${TECHS[t.research].name} ${Math.floor(t.knowledge / TECHS[t.research].cost * 100)}%</span>` : ''}</div>
        ${t.myths?.length ? `<details><summary style="margin-top:6px;cursor:pointer;color:var(--gold)">📖 Mythes et légendes (${t.myths.length})</summary>${t.myths.map((m) => `<div class="mem">« ${esc(m.text)} » <span style="color:var(--mute)">— An ${timeInfo(m.t).year}</span></div>`).join('')}</details>` : ''}
        <details ${(soft && UI.openTribes?.has(t.id)) || q ? 'open' : ''} data-tribe="${t.id}"><summary style="margin-top:8px;cursor:pointer;color:var(--acc)">Voir les membres</summary>
        ${mem.map((b) => `<div class="member" data-being="${b.id}"><span>${moodEmoji(b)}</span><b>${b.role && b.age >= 16 ? ROLES[b.role]?.icon + ' ' : ''}${esc(b.name)}</b> <span style="color:var(--mute)">${b.sex === 'F' ? '♀' : '♂'} ${Math.floor(b.age)} ans</span><span class="m">${esc(actionText(b))}</span></div>`).join('')}
        </details></div>`;
    }).join('') || '<p>Plus aucun peuple.</p>';
    if (soft && $('#ppl-list')) { $('#ppl-list').innerHTML = list; }
    else {
      body.innerHTML = `<input id="ppl-search" class="search" placeholder="🔎 Chercher un être par son nom…" value="${esc(UI.search || '')}"><div id="ppl-list">${list}</div>`;
      $('#ppl-search').oninput = (e) => { UI.search = e.target.value; renderPanel('people', true); };
    }
    UI.openTribes ||= new Set();
    body.querySelectorAll('details[data-tribe]').forEach((d) => d.addEventListener('toggle', () => { d.open ? UI.openTribes.add(+d.dataset.tribe) : UI.openTribes.delete(+d.dataset.tribe); }));
  } else if (name === 'stats') {
    title.textContent = '📈 Statistiques';
    const H = S.history || [], xs = H.map((h) => h.t);
    const P = S.stats.prod || {};
    if (!soft || !$('#ch-pop')) {
      body.innerHTML = `<div class="sec">Population (tous les peuples)</div><canvas id="ch-pop" class="chart"></canvas><div id="lg-pop" class="legend"></div>
        <div class="sec">Faune</div><canvas id="ch-fauna" class="chart"></canvas><div id="lg-fauna" class="legend"></div>
        <div class="sec">Naissances et morts (cumul)</div><canvas id="ch-bd" class="chart"></canvas><div class="legend"><span><i style="background:#6be39a"></i>naissances</span><span><i style="background:#ff6b6b"></i>morts</span></div>
        <div class="sec">Nourriture produite depuis le début</div><div id="st-prod"></div>`;
    }
    if (H.length < 2) { $('#st-prod').innerHTML = '<p style="color:var(--mute)">Les courbes apparaîtront après quelques jours de simulation.</p>'; }
    else {
      const tribes = S.tribes.filter((t) => H.some((h) => h.tribes[t.id]));
      chart($('#ch-pop'), xs, [{ name: 'Total', color: '#e9eefc', values: H.map((h) => h.pop), width: 2.4 }, ...tribes.map((t) => ({ name: t.name, color: t.color, values: H.map((h) => h.tribes[t.id] || 0) }))]);
      $('#lg-pop').innerHTML = `<span><i style="background:#e9eefc"></i>Total</span>` + tribes.filter((t) => t.alive).map((t) => `<span><i style="background:${t.color}"></i>${esc(t.name)}</span>`).join('');
      const FC = { deer: '#c98a4b', rabbit: '#b8b0a2', boar: '#7a5a44', wolf: '#8fa3c7', bear: '#5b3a24' };
      chart($('#ch-fauna'), xs, Object.keys(FC).map((k) => ({ name: SPECIES[k].name, color: FC[k], values: H.map((h) => h.sp?.[k] || 0) })));
      $('#lg-fauna').innerHTML = Object.keys(FC).map((k) => `<span><i style="background:${FC[k]}"></i>${SPECIES[k].name}</span>`).join('');
      chart($('#ch-bd'), xs, [{ color: '#6be39a', values: H.map((h) => h.births) }, { color: '#ff6b6b', values: H.map((h) => h.deaths) }]);
      $('#st-prod').innerHTML = Object.entries(P).map(([k, v]) => `<span class="chip">${({ baies: '🫐', chasse: '🍖', 'pêche': '🐟', 'récoltes': '🌾' })[k] || ''} ${k} : ${Math.round(v)}</span>`).join('') || '—';
    }
  } else if (name === 'menu') {
    if (soft) return;
    title.textContent = '⚙️ Menu';
    const tg = (id, label, on) => `<div class="toggle"><span>${label}</span><button class="sw-t ${on ? 'on' : ''}" data-tg="${id}"></button></div>`;
    body.innerHTML = `${tg('unlimited', '♾️ Énergie divine illimitée (bac à sable)', S.god.unlimited)}${tg('names', '🏷️ Afficher les noms de près', view.names)}${tg('quality', '✨ Haute qualité graphique', view.quality === 'high')}${tg('sound', '🔊 Sons d’ambiance', !UI.handlers.isMuted())}${tg('cinema', '🎬 Mode cinéma (caméra automatique)', !!UI.cinema)}
      <div class="btns" style="margin-top:14px"><button class="btn acc" data-m="save">💾 Sauvegarder</button><button class="btn" data-m="new">🫧 Nouvelle bulle</button></div>
      <p style="color:var(--mute);font-size:12px;margin-top:14px">La simulation est sauvegardée automatiquement. <br>Graine du monde : ${S.seed}</p>
      <div class="sec">Lois de ce monde</div>
      <p style="font-size:12px;color:#c4cce6">Gravité (chutes, projectiles balistiques), thermique (température selon saison, heure, altitude, abri, feu, vêtements), métabolisme (faim, soif, fatigue), cycle de l’eau (pluie → humidité → croissance), combustion (le feu a besoin de combustible et de sécheresse, le vent le propage), génétique (gènes hérités des deux parents avec mutations → évolution), épidémiologie (contagion par proximité, immunité acquise), vieillissement.</p>`;
    body.querySelectorAll('[data-tg]').forEach((b) => (b.onclick = () => { UI.handlers.toggle(b.dataset.tg); renderPanel('menu'); }));
    body.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => UI.handlers.menu(b.dataset.m)));
  }
  if (soft) $('#panel').scrollTop = keepScroll;
}

// ---------- modales ----------
export function modal(html, onClick) {
  $('#modal-card').innerHTML = html; $('#modal').classList.remove('hidden');
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') return closeModal(); const b = e.target.closest('[data-v]'); if (b) onClick?.(b.dataset.v); };
}
export function closeModal() { $('#modal').classList.add('hidden'); }
export function revelationModal(cb) {
  modal(`<h2>📢 Révélation</h2><p>Ta voix résonnera dans toute la bulle. Chaque être éveillé l’entendra. Que veux-tu leur dire ?</p>
    ${REVELATIONS.map((r) => `<button class="rev" data-v="${r.id}">« ${r.text} »</button>`).join('')}
    <div class="btns"><button class="btn" data-v="cancel">Se taire</button></div>`, (v) => { closeModal(); if (v !== 'cancel') cb(v); });
}
