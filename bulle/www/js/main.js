// ===== LA BULLE — point d'entrée =====
import { SPEEDS } from './config.js';
import { S } from './world.js';
import { newGame, simStep, save, load, hasSave, clearSave } from './sim.js';
import { initRender, render, cam, view, screenToTile, pickBeing, focusOn, clampCam, resize, invalidateTerrain, SPH, screenSize } from './render.js';
import { initUI, updateHUD, openInspector, closeInspector, openPanel, closePanel, selectPower, setSpeed, revelationModal, modal, closeModal, UI, fmtElapsed } from './ui.js';
import { applyPower, powerById, godReal } from './god.js';
import { byId, hurt } from './beings.js';
import { log, tribeById } from './society.js';
import { initAudio, audioTick, setMuted, isMuted } from './audio.js';
import { actionText } from './ui.js';
import { iso } from './render.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#world');
initRender(canvas);
window.__bulle = { S, cam, focusOn, setSpeed, openInspector, applyPower, byId, simStep }; // accès console / tests

// ---------- démarrage ----------
function start(fresh) {
  if (fresh || !load()) { clearSave(); newGame(); }
  S.startTime ??= S.time;
  if (S.startTime > S.time) S.startTime = S.time;
  ['#hud', '#side', '#powers', '#goalbar'].forEach((s) => $(s).classList.remove('hidden'));
  $('#intro').classList.add('hidden');
  initAudio();
  invalidateTerrain();
  // plan d'ouverture : la bulle vue de loin, puis on s'approche
  cam.x = cam.tx = SPH.x; cam.y = cam.ty = SPH.y; cam.z = cam.fit * 0.35; cam.tz = cam.fit;
  setTimeout(() => { if (cam.tz === cam.fit) { const t = S.tribes.find((t) => t.alive); if (t) focusOn(t.cx, t.cy, cam.fit * 3.2); } }, 2600);
  shown.victory = !!S.victory; shown.extinct = !!S.extinct;
  updateHUD(true);
}
if (hasSave()) $('#btn-continue').classList.remove('hidden');
$('#btn-new').onclick = () => start(true);
$('#btn-continue').onclick = () => start(false);

initUI({
  select: (b) => { openInspector(b); focusOn(b.x, b.y, Math.max(cam.tz, cam.fit * 4.5)); },
  fit: () => { cam.follow = null; cam.tx = SPH.x; cam.ty = SPH.y; cam.tz = cam.fit; },
  instantPower: (id) => {
    if (id === 'voice') return revelationModal((rv) => applyPower('voice', 0, 0, rv));
    applyPower(id, 0, 0);
  },
  beingAction: (b, act) => {
    if (act === 'follow') { cam.follow = cam.follow === b.id ? null : b.id; if (cam.follow) cam.tz = Math.max(cam.tz, cam.fit * 5); }
    else if (act === 'bless') applyPower('bless', b.x, b.y);
    else if (act === 'heal') { if (S.god.unlimited || S.god.energy >= 10) { if (!S.god.unlimited) S.god.energy -= 10; b.disease = null; b.health = Math.max(b.health, 80); b.faith = Math.min(1, b.faith + 0.15); b.memory.unshift('J’ai été guéri par un miracle.'); log(`💊 Tu guéris ${b.name}.`, 'god', false, [b.x, b.y]); } }
    else if (act === 'smite') applyPower('lightning', b.x, b.y);
  },
  isMuted: () => isMuted(),
  toggle: (k) => {
    if (k === 'sound') { setMuted(!isMuted()); try { localStorage.setItem('labulle-mute', isMuted() ? '1' : '0'); } catch { } }
    if (k === 'cinema') toggleCinema();
    if (k === 'unlimited') S.god.unlimited = !S.god.unlimited;
    if (k === 'names') view.names = !view.names;
    if (k === 'quality') { view.quality = view.quality === 'high' ? 'low' : 'high'; resize(); }
  },
  menu: (m) => {
    if (m === 'save') { save(); S.toasts.push({ text: '💾 Simulation sauvegardée.', kind: 'info' }); }
    if (m === 'new') modal('<h2>Nouvelle bulle ?</h2><p>La bulle actuelle et tous ses êtres seront perdus.</p><div class="btns"><button class="btn red" data-v="y">Créer une nouvelle bulle</button><button class="btn" data-v="n">Annuler</button></div>', (v) => { closeModal(); if (v === 'y') { closePanel(); closeInspector(); start(true); } });
  },
});

// ---------- entrées tactiles / souris ----------
const ptr = new Map(); let gesture = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
  if (ptr.size === 2) { const [a, b] = [...ptr.values()]; gesture = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.tz, pinch: true }; }
  else gesture = { pan: true, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  const p = ptr.get(e.pointerId);
  if (!p) { if (view.power) view.hover = screenToTile(e.clientX, e.clientY); return; }
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (view.power) view.hover = screenToTile(e.clientX, e.clientY);
  if (ptr.size === 2 && gesture?.pinch) {
    const [a, b] = [...ptr.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, gesture.z * d / gesture.d / cam.tz);
    cam.tx -= dx / 2 / cam.z; cam.ty -= dy / 2 / cam.z;
  } else if (gesture?.pan) {
    if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 8) gesture.moved = true;
    if (gesture.moved) { cam.follow = null; cam.tx -= dx / cam.z; cam.ty -= dy / cam.z; cam.x = cam.tx; cam.y = cam.ty; clampCam(); }
  }
});
const up = (e) => {
  const p = ptr.get(e.pointerId); ptr.delete(e.pointerId);
  if (p && gesture?.pan && !gesture.moved && performance.now() - p.t0 < 500) tap(e.clientX, e.clientY);
  if (ptr.size === 0) gesture = null; else if (ptr.size === 1) gesture = { pan: true, moved: true };
};
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
let lastTap = 0;
function zoomAt(px, py, k) {
  const [W, H] = screenSize();
  const wx = (px - W / 2) / cam.z + cam.x, wy = (py - H / 2) / cam.z + cam.y;
  cam.tz *= k; clampCam();
  cam.tx = wx - (px - W / 2) / cam.tz; cam.ty = wy - (py - H / 2) / cam.tz; cam.z = cam.tz; cam.x = cam.tx; cam.y = cam.ty; clampCam();
}
function tap(px, py) {
  const [x, y] = screenToTile(px, py);
  if (view.power) {
    if (applyPower(view.power, x, y)) { const p = powerById(view.power); if (p.cost >= 30) selectPower('inspect'); }
    return;
  }
  const b = pickBeing(px, py);
  if (b) { openInspector(b); return; }
  const now = performance.now();
  if (now - lastTap < 320) zoomAt(px, py, 2); // double-tap : zoom
  lastTap = now;
  if (!$('#inspector').classList.contains('hidden')) closeInspector();
}
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') { setSpeed(UI.speed ? 0 : 2); e.preventDefault(); }
  const n = +e.key; if (n >= 0 && n < SPEEDS.length) setSpeed(n);
  if (e.key === 'Escape') { selectPower('inspect'); closeInspector(); closePanel(); }
});

// ---------- boucle principale ----------
const shown = { victory: false, extinct: false };
let last = performance.now(), saveT = 0, simBudget = 0;
function frame(now) {
  const rdt = Math.min(0.1, (now - last) / 1000); last = now;
  if (S.ready && !$('#hud').classList.contains('hidden')) {
    const sp = S.speedV || 0;
    if (sp > 0) {
      S.realTime += rdt;
      // pas fixes, budget de temps limité pour rester fluide
      let hours = sp * rdt; const t0 = performance.now(); const step = sp >= 20 ? 0.5 : 0.25;
      while (hours > 1e-6 && performance.now() - t0 < 22) { const dt = Math.min(step, hours); simStep(dt); hours -= dt; }
    }
    godReal(rdt);
    render();
    updateHUD();
    cinemaTick(rdt);
    audioTick(rdt, Math.min(1, cam.z / (cam.fit * 4)), fireNearCamera());
    saveT += rdt; if (saveT > 40) { saveT = 0; save(); }
    if (S.victory && !shown.victory) { shown.victory = true; victory(); }
    if (S.extinct && !shown.extinct) { shown.extinct = true; extinction(); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.addEventListener('visibilitychange', () => { if (document.hidden && S.ready) save(); });

function victory() {
  setSpeed(1);
  modal(`<h2>🌀 Libération !</h2><p>Après <b>${fmtElapsed(S.time - S.startTime)}</b>, ${S.victory.tribe} a percé la Paroi du monde. La bulle se fissure, la lumière du dehors entre. Tes créatures franchissent Le Passage, une à une, vers l’inconnu.</p>
    <p style="color:var(--mute)">${S.stats.births} naissances · ${S.stats.deaths} morts · ${S.stats.wars} guerres · population maximale ${S.stats.maxPop}</p>
    <div class="btns"><button class="btn gold" data-v="watch">Regarder leur départ</button><button class="btn" data-v="new">Créer une nouvelle bulle</button></div>`,
  (v) => { closeModal(); if (v === 'new') start(true); });
}
function extinction() {
  modal(`<h2>☠️ Extinction</h2><p>Il ne reste plus aucun être vivant dans la bulle, après ${fmtElapsed(S.time - S.startTime)}.</p>
    <p style="color:var(--mute)">${S.stats.births} naissances · ${S.stats.deaths} morts · population maximale ${S.stats.maxPop}</p>
    <div class="btns"><button class="btn gold" data-v="life">🧍 Recréer la vie ici</button><button class="btn" data-v="new">Nouvelle bulle</button></div>`,
  (v) => { closeModal(); if (v === 'new') start(true); else { S.extinct = false; shown.extinct = false; const gu = S.god.unlimited; S.god.unlimited = true; selectPower('human'); S.god.unlimited = gu; S.god.energy = Math.max(S.god.energy, 40); } });
}

// ---------- son : proximité d'un feu ----------
function fireNearCamera() {
  if (cam.z < cam.fit * 2.5) return 0;
  const [W, H] = screenSize(); const [x, y] = screenToTile(W / 2, H / 2);
  let best = 99;
  for (const t of S.tribes) if (t.alive && t.tech.feu) best = Math.min(best, Math.hypot(t.cx - x, t.cy - y));
  for (const i of S.fires) best = Math.min(best, Math.hypot((i % 72) - x, Math.floor(i / 72) - y) * 0.6);
  return Math.max(0, 1 - best / 8);
}
try { if (localStorage.getItem('labulle-mute') === '1') setMuted(true); } catch { }

// ---------- mode cinéma : la caméra suit les moments forts ----------
let cineT = 0;
function toggleCinema() {
  UI.cinema = !UI.cinema; cineT = 0;
  $('#btn-cine').classList.toggle('on', UI.cinema);
  if (!UI.cinema) { cam.follow = null; $('#cine-cap').classList.add('hidden'); }
}
$('#btn-cine').onclick = toggleCinema;
function interest(b) {
  const a = b.act?.type;
  let s = Math.random() * 1.5;
  if (a === 'fight') s += 6; if (a === 'raid' || a === 'rally') s += 4; if (a === 'talk' && b.act.conv?.topic === 'amour') s += 5;
  if (a === 'veillee') s += b.act.fest ? 4 : 2.5; if (a === 'funeral') s += 4; if (a === 'hunt') s += 3; if (a === 'trade') s += 3;
  if (a === 'wall') s += 3.5; if (a === 'flee') s += 4; if (a === 'heal' || a === 'feed') s += 2.5; if (b.age < 0.1) s += 4;
  if (b.say && performance.now() < b.say.until) s += 1.5;
  return s;
}
function cinemaTick(rdt) {
  if (!UI.cinema || !S.ready) return;
  cineT -= rdt;
  const cur = byId(cam.follow);
  if (cineT <= 0 || !cur || !cur.alive) {
    let best = null, bs = -1;
    for (const b of S.beings) { if (!b.alive || b.inside || b.id === cam.follow && cineT > -2) continue; const s = interest(b); if (s > bs) { bs = s; best = b; } }
    if (best) { cam.follow = best.id; cam.tz = cam.fit * (4 + Math.random() * 2.5); cineT = 9; }
  }
  const b = byId(cam.follow);
  if (b) { const tr = tribeById(b.tribeId); $('#cine-cap').textContent = `🎬 ${b.name}${tr ? ' (' + tr.name + ')' : ''} — ${actionText(b)}`; $('#cine-cap').classList.remove('hidden'); }
}

// ---------- bouton retour Android ----------
try {
  const App = window.Capacitor?.Plugins?.App;
  App?.addListener('backButton', () => {
    if (!$('#modal').classList.contains('hidden')) return closeModal();
    if (!$('#inspector').classList.contains('hidden')) return closeInspector();
    if (!$('#panel').classList.contains('hidden')) return closePanel();
    if (view.power) return selectPower('inspect');
    if (UI.cinema) return toggleCinema();
    save(); App.minimizeApp?.();
  });
} catch { }
