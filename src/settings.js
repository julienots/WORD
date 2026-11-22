// User preferences (kept in localStorage — survives app restarts in the Android WebView).
const KEY = 'dotworks.settings';

export const DEFAULTS = {
  theme: 'auto', // auto | light | dark
  author: 'Utilisateur .WORKS',
  autosave: 8, // seconds, 0 = off
  zoom: 'fit', // fit | 100
  sort: 'date', // date | name
  spellcheck: true,
  versions: true,
  awake: false,
};

let current = { ...DEFAULTS };
try {
  current = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
} catch {
  /* private mode / blocked storage */
}

const listeners = new Set();
export const settings = () => current;
export function setSettings(patch) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  applyTheme();
  listeners.forEach((fn) => fn(current));
}
export const onSettings = (fn) => listeners.add(fn);

const media = window.matchMedia?.('(prefers-color-scheme: dark)');
export const isDark = () => current.theme === 'dark' || (current.theme === 'auto' && !!media?.matches);
export function applyTheme() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#000000' : '#111111');
  listeners.forEach((fn) => fn(current));
}
media?.addEventListener?.('change', applyTheme);
