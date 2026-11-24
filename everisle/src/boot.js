// Lancement : logo SuperEssence Studio animé pendant le chargement, puis entrée directe dans le jeu.
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/700.css';
import iconUrl from './brand/icon.svg';
window.__icon = iconUrl;
const intro = document.getElementById('intro');
const wait = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const t0 = performance.now();
(async () => {
  document.body.classList.add('intro-on');
  await frame(); await frame();
  // l'animation du logo se joue d'abord, puis le jeu se charge (la barre continue de défiler)
  await wait(Math.max(0, 1900 - (performance.now() - t0)));
  let ok = true;
  try { await import('./main.js'); } catch (e) { ok = false; console.error(e); }
  if (!ok) { intro.querySelector('.studio-sub').textContent = 'Erreur de chargement · redémarre le jeu'; return; }
  await wait(Math.max(300, 3000 - (performance.now() - t0)));
  await frame(); await frame();
  intro.classList.add('out'); document.body.classList.remove('intro-on');
  setTimeout(() => intro.remove(), 900);
  if (window.__onPlay) window.__onPlay();
})();
