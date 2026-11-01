// ===== INTERFACE =====
import { SEASONS, SEASON_ICONS, SPEEDS, DAYS_PER_SEASON, DAYS_PER_YEAR, HOURS_PER_YEAR } from './config.js';
import { S, timeInfo, baseTemp, weatherInfo, isNight as isNightNow } from './world.js';
import { byId, stage, mood, moodEmoji, GENE_LABEL, SKILL_LABEL, elderAge } from './beings.js';
import { tribeById, TECHS, has, rel } from './society.js';
import { POWERS, REVELATIONS, powerById } from './god.js';
import { OBJECTIVES, save } from './sim.js';
import { view, cam, focusOn } from './render.js';

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
  flee: 'fuit !', fight: 'se bat', hunt: 'chasse', raid: 'part en raid', heal: 'soigne un malade', exit: 'marche vers Le Passage',
};
export function actionText(b) {
  if (b.age < 3) return b.sleeping ? 'dort dans les bras de sa mère' : 'est porté par ses parents';
  const a = b.act; if (!a) return 'hésite…';
  let t = ACT_LABEL[a.type] || a.type;
  if ((a.type === 'talk' || a.type === 'listen') && byId(a.with)) t += ' avec ' + byId(a.with).name;
  if (a.type === 'seek' && byId(a.target)) t = (a.love ? 'va voir ' : 'va parler à ') + byId(a.target).name;
  if (a.type === 'fight' && !a.animal && byId(a.target)) t += ' contre ' + byId(a.target).name;
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
      <div class="sub">▸ ${esc(actionText(b))}</div></div>
      <span class="spacer"></span><button class="close" data-close>✕</button></div>
    <div class="ins-body">
      <div class="thought">« ${esc(b.thought)} »</div>
      <div class="btns">
        <button class="btn ${cam.follow === b.id ? 'acc' : ''}" data-act="follow">🎥 ${cam.follow === b.id ? 'Suivi actif' : 'Suivre'}</button>
        <button class="btn gold" data-act="bless">✨ Bénir</button>
        <button class="btn" data-act="heal">💊 Guérir</button>
        <button class="btn red" data-act="smite">⚡ Foudroyer</button>
      </div>
      <div class="sec">Corps</div>
      ${bar('Santé', b.health)}${bar('Satiété', b.sat)}${bar('Hydratation', b.thirst)}${bar('Énergie', b.energy)}${bar('Lien social', b.social)}${bar('Chaleur', 100 - b.cold * 100)}
      ${b.disease ? `<div class="row" style="color:#c9f19a">🤒 ${esc(b.disease.name)} — gravité ${pct(b.disease.sev)}%${b.treated ? ' (soigné)' : ''}</div>` : ''}
      <div class="row" style="color:var(--mute);font-size:12px">Ressenti ${Math.round(b.felt ?? 0)}°C · porte ${b.carry.food.toFixed(0)} nourriture, ${b.carry.wood.toFixed(0)} bois, ${b.carry.stone.toFixed(0)} pierre</div>
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
    const F = [['all', 'Tout'], ['major', 'Majeur'], ['birth', 'Naissances'], ['death', 'Morts'], ['love', 'Amour'], ['war', 'Guerre'], ['tech', 'Savoir'], ['question', 'Pensées'], ['god', 'Toi']];
    const f = UI.logFilter;
    const items = S.log.filter((l) => f === 'all' || l.kind === f || (f === 'major' && (l.kind === 'goal' || l.kind === 'major')) || (f === 'war' && l.kind === 'peace') || (f === 'love' && l.kind === 'social')).slice(-150).reverse();
    body.innerHTML = `<div class="filters">${F.map(([k, l]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}</div>` +
      items.map((l) => `<div class="log-item k-${l.kind}" ${l.at ? `data-at="${l.at[0]},${l.at[1]}"` : ''}><span class="d">An ${timeInfo(l.t).year} ${fmtHour(l.t)}</span><span>${esc(l.text)}</span></div>`).join('');
    body.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { UI.logFilter = b.dataset.f; renderPanel('log'); }));
  } else if (name === 'people') {
    title.textContent = '👥 Peuples de la bulle';
    const alive = S.tribes.filter((t) => t.alive);
    body.innerHTML = alive.map((t) => {
      const lead = byId(t.leader), en = t.war ? tribeById(t.war.target) : null;
      const rels = alive.filter((o) => o !== t).map((o) => `<span class="chip">${o.name} : ${Math.round(t.rel[o.id] || 0)}</span>`).join('');
      const mem = [...t.members].sort((a, b) => b.age - a.age);
      return `<div class="tribe"><h3><span class="sw" style="background:${t.color}"></span>${esc(t.name)} <small style="color:var(--mute)">${t.members.length} membres</small></h3>
        <div style="font-size:12px;color:var(--mute)">${lead ? `👑 ${esc(lead.name)} · ` : ''}🍖 ${Math.floor(t.stock.food)} · 🪵 ${Math.floor(t.stock.wood)} · 🪨 ${Math.floor(t.stock.stone)} · 🙏 foi ${Math.round(t.faith * 100)}%${t.dogma ? ` · dogme : ${t.dogma}` : ''}</div>
        ${en ? `<div style="color:var(--red);margin-top:4px">⚔️ En guerre contre ${esc(en.name)} (pertes ${t.war.losses}, victimes ennemies ${t.war.kills})</div>` : ''}
        ${rels ? `<div style="margin-top:4px">Relations : ${rels}</div>` : ''}
        <div class="techs">${Object.keys(TECHS).filter((k) => t.tech[k]).map((k) => `<span class="tech">${TECHS[k].icon} ${TECHS[k].name}</span>`).join('')}${t.research ? `<span class="tech next">🔍 ${TECHS[t.research].name} ${Math.floor(t.knowledge / TECHS[t.research].cost * 100)}%</span>` : ''}</div>
        <details ${soft && UI.openTribes?.has(t.id) ? 'open' : ''} data-tribe="${t.id}"><summary style="margin-top:8px;cursor:pointer;color:var(--acc)">Voir les membres</summary>
        ${mem.map((b) => `<div class="member" data-being="${b.id}"><span>${moodEmoji(b)}</span><b>${esc(b.name)}</b> <span style="color:var(--mute)">${b.sex === 'F' ? '♀' : '♂'} ${Math.floor(b.age)} ans</span><span class="m">${esc(actionText(b))}</span></div>`).join('')}
        </details></div>`;
    }).join('') || '<p>Plus aucun peuple.</p>';
    UI.openTribes ||= new Set();
    body.querySelectorAll('details').forEach((d) => d.addEventListener('toggle', () => { d.open ? UI.openTribes.add(+d.dataset.tribe) : UI.openTribes.delete(+d.dataset.tribe); }));
  } else if (name === 'menu') {
    if (soft) return;
    title.textContent = '⚙️ Menu';
    const tg = (id, label, on) => `<div class="toggle"><span>${label}</span><button class="sw-t ${on ? 'on' : ''}" data-tg="${id}"></button></div>`;
    body.innerHTML = `${tg('unlimited', '♾️ Énergie divine illimitée (bac à sable)', S.god.unlimited)}${tg('names', '🏷️ Afficher les noms de près', view.names)}${tg('quality', '✨ Haute qualité graphique', view.quality === 'high')}
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
