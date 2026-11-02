// Generates every app icon / splash image from resources/logo-mark.svg.
// Usage: npm run icons   (run after `npx cap add android`)
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const mark = readFileSync('resources/logo-mark.svg', 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const BG = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#1c1c1c"/><stop offset="1" stop-color="#000"/></linearGradient>
  <radialGradient id="glow" cx=".3" cy=".25" r=".8"><stop offset="0" stop-color="#FFCB1F" stop-opacity=".22"/>
  <stop offset="1" stop-color="#FFCB1F" stop-opacity="0"/></radialGradient></defs>`;

// full icon (rounded square) — store / launcher legacy / web
const icon = (rounded = true) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${BG}
  <rect width="1024" height="1024" rx="${rounded ? 228 : 0}" fill="url(#bg)"/>
  <rect width="1024" height="1024" rx="${rounded ? 228 : 0}" fill="url(#glow)"/>
  <g transform="translate(512 512) scale(.86) translate(-512 -522)">${mark}</g></svg>`;
const round = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${BG}
  <circle cx="512" cy="512" r="512" fill="url(#bg)"/><circle cx="512" cy="512" r="512" fill="url(#glow)"/>
  <g transform="translate(512 512) scale(.74) translate(-512 -522)">${mark}</g></svg>`;
// adaptive foreground: content must sit inside the central 66% safe zone
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <g transform="translate(512 512) scale(.6) translate(-512 -522)">${mark}</g></svg>`;
const bg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${BG}
  <rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#glow)"/></svg>`;
const splash = (w, h) => {
  const s = Math.min(w, h) * 0.45;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#000"/>
  <g transform="translate(${w / 2} ${h / 2 - s * 0.15}) scale(${s / 1024}) translate(-512 -522)">${mark}</g>
  <text x="${w / 2}" y="${h / 2 + s * 0.62}" font-family="Arial Black, Arial, sans-serif" font-weight="900"
    font-size="${s * 0.26}" text-anchor="middle" fill="#fff">.<tspan fill="#FFCB1F">BEATS</tspan></text>
  <text x="${w / 2}" y="${h - s * 0.25}" font-family="Arial, sans-serif" font-weight="700"
    font-size="${s * 0.075}" letter-spacing="${s * 0.01}" text-anchor="middle" fill="#9a9a9a">SUPERESSENCE STUDIO</text></svg>`;
};

const out = async (svg, file, size) => {
  mkdirSync(dirname(file), { recursive: true });
  const img = sharp(Buffer.from(svg));
  await (size ? img.resize(size[0], size[1]) : img).png().toFile(file);
};

writeFileSync('resources/icon.svg', icon());
writeFileSync('public/icon.svg', icon());
await out(icon(), 'resources/icon-1024.png', [1024, 1024]);
await out(icon(), 'public/icon-512.png', [512, 512]);
await out(icon(), 'public/icon-192.png', [192, 192]);

const res = 'android/app/src/main/res';
if (existsSync(res)) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    await out(icon(), `${res}/mipmap-${d}/ic_launcher.png`, [48 * k, 48 * k]);
    await out(round, `${res}/mipmap-${d}/ic_launcher_round.png`, [48 * k, 48 * k]);
    await out(fg, `${res}/mipmap-${d}/ic_launcher_foreground.png`, [108 * k, 108 * k]);
    await out(bg, `${res}/mipmap-${d}/ic_launcher_background.png`, [108 * k, 108 * k]);
  }
  const anydpi = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  mkdirSync(`${res}/mipmap-anydpi-v26`, { recursive: true });
  writeFileSync(`${res}/mipmap-anydpi-v26/ic_launcher.xml`, anydpi);
  writeFileSync(`${res}/mipmap-anydpi-v26/ic_launcher_round.xml`, anydpi);
  // splash screens
  const sp = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
  await out(splash(1280, 1920), `${res}/drawable/splash.png`);
  for (const [d, [w, h]] of Object.entries(sp)) {
    await out(splash(w, h), `${res}/drawable-port-${d}/splash.png`);
    await out(splash(h, w), `${res}/drawable-land-${d}/splash.png`);
  }
}
await out(splash(1080, 1920), 'resources/splash-preview.png');
console.log('icons generated');
