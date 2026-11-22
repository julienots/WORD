import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/700.css';
// Écran de lancement : logo SuperEssence Studio, puis titre Everisle pendant le chargement du jeu.
import iconUrl from './brand/icon.svg';
const $ = id => document.getElementById(id);
const intro = $('intro'), bar = $('lbar-i'), txt = $('ltxt');
$('emblem').src = iconUrl;
const wait = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const t0 = performance.now();
let prog = 0; const setP = p => { prog = Math.max(prog, p); bar.style.width = (prog * 100) + '%'; };
(async () => {
  document.body.classList.add('intro-on');
  await frame(); await frame();
  // 1) logo SuperEssence Studio (le jeu n'est chargé qu'après, pour que l'animation reste fluide)
  await wait(Math.max(0, 2900 - (performance.now() - t0)));
  intro.classList.add('stage2');
  setP(.15); await wait(700); await frame(); await frame();
  // 2) écran titre : chargement du jeu
  let ok = true;
  try { await import('./main.js'); } catch (e) { ok = false; console.error(e); }
  setP(.85); await frame(); await wait(300);
  if (!ok) { txt.textContent = 'Erreur de chargement. Redémarre le jeu.'; return; }
  setP(1); txt.textContent = 'Île prête !';
  await wait(500);
  intro.classList.add('ready');
  $('play').addEventListener('click', () => {
    if (matchMedia('(pointer:coarse)').matches && document.documentElement.requestFullscreen && !document.fullscreenElement)
      document.documentElement.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => { });
    intro.classList.add('out'); document.body.classList.remove('intro-on');
    setTimeout(() => intro.remove(), 900);
    if (window.__onPlay) window.__onPlay();
  }, { once: true });
})();
