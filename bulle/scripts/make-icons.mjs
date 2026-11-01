// Génère icônes et écrans de démarrage Android depuis www/icon.svg
// Usage : npm run icons   (après `npx cap add android`)
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const icon = readFileSync('www/icon.svg', 'utf8');
const inner = icon.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const round = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><clipPath id="r"><circle cx="256" cy="256" r="256"/></clipPath><g clip-path="url(#r)">${inner}</g></svg>`;
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="translate(256 256) scale(.62) translate(-256 -256)">${inner.replace(/<rect width="512" height="512"[^>]*\/>/, '')}</g></svg>`;
const bg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><radialGradient id="s" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#1b2a5a"/><stop offset="1" stop-color="#05060f"/></radialGradient></defs><rect width="512" height="512" fill="url(#s)"/></svg>`;
const splash = (w, h) => {
  const s = Math.min(w, h) * 0.42;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#05060f"/>
  <g transform="translate(${w / 2 - s / 2} ${h / 2 - s * 0.62}) scale(${s / 512})">${inner.replace(/<rect width="512" height="512"[^>]*\/>/, '')}</g>
  <text x="${w / 2}" y="${h / 2 + s * 0.62}" font-family="Georgia, serif" font-weight="700" font-size="${s * 0.22}" text-anchor="middle" fill="#dff2ff">La Bulle</text>
  <text x="${w / 2}" y="${h - s * 0.25}" font-family="Arial, sans-serif" font-weight="700" font-size="${s * 0.07}" letter-spacing="${s * 0.01}" text-anchor="middle" fill="#7f8db0">SUPERESSENCE STUDIO</text></svg>`;
};
const out = async (svg, file, size) => {
  mkdirSync(dirname(file), { recursive: true });
  const img = sharp(Buffer.from(svg));
  await (size ? img.resize(size[0], size[1]) : img).png().toFile(file);
};
await out(icon, 'resources/icon-1024.png', [1024, 1024]);
const res = 'android/app/src/main/res';
if (existsSync(res)) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    await out(icon, `${res}/mipmap-${d}/ic_launcher.png`, [48 * k, 48 * k]);
    await out(round, `${res}/mipmap-${d}/ic_launcher_round.png`, [48 * k, 48 * k]);
    await out(fg, `${res}/mipmap-${d}/ic_launcher_foreground.png`, [108 * k, 108 * k]);
    await out(bg, `${res}/mipmap-${d}/ic_launcher_background.png`, [108 * k, 108 * k]);
  }
  const anydpi = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  mkdirSync(`${res}/mipmap-anydpi-v26`, { recursive: true });
  writeFileSync(`${res}/mipmap-anydpi-v26/ic_launcher.xml`, anydpi);
  writeFileSync(`${res}/mipmap-anydpi-v26/ic_launcher_round.xml`, anydpi);
  const sp = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
  await out(splash(1280, 1920), `${res}/drawable/splash.png`);
  for (const [d, [w, h]] of Object.entries(sp)) {
    await out(splash(w, h), `${res}/drawable-port-${d}/splash.png`);
    await out(splash(h, w), `${res}/drawable-land-${d}/splash.png`);
  }
  // fond de l'écran de démarrage
  const colors = `${res}/values/colors.xml`;
  if (!existsSync(colors)) writeFileSync(colors, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="splash_bg">#05060f</color>\n</resources>\n`);
}
await out(splash(1080, 1920), 'resources/splash-preview.png');
console.log('icônes générées');
