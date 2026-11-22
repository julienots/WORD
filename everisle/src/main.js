import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import { initNative } from './native.js';

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* ---------- utils ---------- */
let seed = 1337;
const rand = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const rr = (a, b) => a + rand() * (b - a);
const pick = a => a[Math.floor(rand() * a.length)];
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function fbm(x, y) { let s = 0, a = .5, f = 1; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= .5; } return s; }
const n3 = (x, y, z) => fbm(x + z * 1.7 + 11.3, y - z * 0.9 + 3.1);
const col = c => new THREE.Color(c);

/* ---------- renderer ---------- */
const W = () => innerWidth, Hh = () => innerHeight;
const MOBILE = matchMedia('(pointer:coarse)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2));
renderer.setSize(W(), Hh());
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = col('#a9b98a');
scene.background = FOG.clone();
scene.fog = new THREE.FogExp2(FOG, 0.0075);

const camera = new THREE.PerspectiveCamera(34, W() / Hh(), 0.5, 400);
const CAM_POS = new THREE.Vector3(1.5, 29, 25.5), CAM_LOOK = new THREE.Vector3(1.2, 0.5, -2.2);
camera.position.copy(CAM_POS); camera.lookAt(CAM_LOOK);

/* ---------- light ---------- */
const hemi = new THREE.HemisphereLight(col('#cfe6ff'), col('#4a4a22'), 0.62); scene.add(hemi);
const sun = new THREE.DirectionalLight(col('#ffd29a'), 3.5);
sun.position.set(-26, 34, 16); sun.target.position.set(0, 0, -2);
sun.castShadow = true; sun.shadow.mapSize.set(MOBILE ? 2048 : 4096, MOBILE ? 2048 : 4096);
const sc = sun.shadow.camera; sc.left = -38; sc.right = 38; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 120;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(col('#8fb6ff'), 0.45); fill.position.set(20, 15, -20); scene.add(fill);

const uTime = { value: 0 };

/* ---------- terrain ---------- */
const sx = z => -13.5 + Math.sin(z * 0.13 + 0.8) * 2.4;
const streamD = (x, z) => Math.abs(x - sx(z));
function H(x, z) {
  let h = (fbm(x * 0.05, z * 0.05) - 0.45) * 2.4;
  const dc = Math.hypot(x - 0.8, (z + 1) * 1.05);
  h *= sstep(7, 15, dc);
  h += sstep(-10, -34, z) * 7 * (0.4 + fbm(x * .03 + 3, z * .03));
  h += sstep(14, 30, x) * sstep(-2, -26, z) * 6;
  h -= (1 - sstep(1.4, 4, streamD(x, z))) * 1.5;
  return h;
}
function dirt(x, z) {
  const n = fbm(x * 0.28, z * 0.28) * 1.6 - 0.75;
  let d = 1 - sstep(4.2, 7.6, Math.hypot((x - 0.2) / 1.05, (z - 2.2) / 0.85) + n * 1.6);
  if (z > 2) { const px = -1.5 - (z - 3) * 0.75; d = Math.max(d, 1 - sstep(1.0, 2.4, Math.abs(x - px) + n)); }
  { const pz = 1.5 + (x + 4) * 0.12; if (x < -3 && x > -12) d = Math.max(d, 1 - sstep(1.0, 2.6, Math.abs(z - pz) + n)); }
  d = Math.max(d, (1 - sstep(2.5, 4.5, Math.hypot(x - 1, z + 4.5) + n)));
  return clamp(d);
}
{
  const g = new THREE.PlaneGeometry(150, 130, 300, 260); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, cols = new Float32Array(p.count * 3);
  const gA = col('#4b7a26'), gB = col('#79a334'), gC = col('#9bb543'), gD = col('#3a6122');
  const dA = col('#a07b4d'), dB = col('#c09a62'), wet = col('#3d5a33'), sand = col('#bca57a'), cliff = col('#8a5038');
  const c = new THREE.Color(), t2 = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = H(x, z); p.setY(i, y);
    const n = fbm(x * 0.12 + 5, z * 0.12), n2 = vnoise(x * 0.9, z * 0.9);
    c.copy(gA).lerp(gB, sstep(0.3, 0.7, n)); c.lerp(gC, sstep(0.55, 0.85, fbm(x * .07 - 9, z * .07)) * 0.6); c.lerp(gD, sstep(0.6, 0.2, n2) * 0.25);
    const d = dirt(x, z); t2.copy(dA).lerp(dB, n2); c.lerp(t2, sstep(0.15, 0.6, d));
    const sd = streamD(x, z); c.lerp(wet, 1 - sstep(2.5, 4.5, sd)); c.lerp(sand, (1 - sstep(1.2, 2.4, sd)) * 0.7);
    c.lerp(cliff, sstep(3.5, 7, y) * 0.5);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  m.receiveShadow = true; scene.add(m);
}

/* ---------- water ---------- */
{
  const pts = []; for (let z = -60; z <= 60; z += 1.5) pts.push(z);
  const pos = [], idx = [], uvs = [];
  pts.forEach((z, i) => { const x = sx(z); pos.push(x - 2.6, 0, z, x + 2.6, 0, z); uvs.push(0, i * 0.2, 1, i * 0.2); if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: `varying vec2 vUv; varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vec4 mvPosition=viewMatrix*w; gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vW;
      #include <fog_pars_fragment>
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
      void main(){
        float e=1.-abs(vUv.x-.5)*2.;
        vec3 deep=vec3(.05,.42,.48), shallow=vec3(.32,.78,.74);
        vec3 c=mix(shallow,deep,smoothstep(.1,.8,e));
        float r=n(vW.xz*1.3+vec2(0.,-uTime*.9))*n(vW.xz*2.7+vec2(uTime*.3,-uTime*1.4));
        c+=smoothstep(.35,.6,r)*.35*vec3(.9,1.,.95);
        float foam=smoothstep(.25,.0,e)*(.6+.4*n(vW.xz*4.+uTime));
        c=mix(c,vec3(.95,.97,.9),foam*.7);
        gl_FragColor=vec4(c, smoothstep(0.,.25,e)*.9+.08);
        #include <fog_fragment>
      }`
  });
  mat.userData.u = mat.uniforms.uTime;
  const w = new THREE.Mesh(g, mat); w.position.y = -0.75; scene.add(w); window._water = mat;
}

/* ---------- materials ---------- */
const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .88, ...o });
const woods = ['#9b6a43', '#8a5b39', '#a8774c', '#946240', '#b0825a'].map(c => M(c));
const woodLight = M('#c49a6c'), woodDark = M('#5a3a24'), woodGrey = M('#8f8a80');
const stone = M('#9aa1a8'), stoneLight = M('#c8ced6'), slates = ['#5f82ad', '#557aa6', '#6a8db7', '#4d6f99'].map(c => M(c, { roughness: .6 }));
const wallBlue = M('#7f8f9e'), black = M('#0d0a08', { roughness: 1 });
const WIN_MAT = M('#ffd58a', { emissive: '#ffb347', emissiveIntensity: 1.2 });
const TREES = [], ROCKS = [];

function box(parent, w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}
function cyl(parent, r1, r2, h, mat, x, y, z, rx = 0, ry = 0, rz = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}
// shingled slope: local x along slope (length L), z depth D
function slope(parent, L, D, mats, rows, cols, x, y, z, rz, thick = .1) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.z = rz; parent.add(g);
  const rw = L / rows, cw = D / cols;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const b = box(g, rw * 1.18, thick, cw * 0.96, pick(mats), -L / 2 + (r + .5) * rw, r * 0.025 * Math.sign(-rz || 1) + rr(-.01, .01), -D / 2 + (c + .5) * cw);
    b.rotation.set(rr(-.03, .03), rr(-.03, .03), rr(-.04, .04));
  }
  return g;
}
function plankRoof(parent, L, D, rows, x, y, z, rz, rx = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(rx, 0, rz); parent.add(g);
  const pw = D / rows;
  for (let i = 0; i < rows; i++) { const b = box(g, L * rr(0.98, 1.06), .1, pw * 0.94, pick(woods), rr(-.05, .05), rr(-.015, .015), -D / 2 + (i + .5) * pw); b.rotation.y = rr(-.02, .02); }
  return g;
}

/* ---------- rocks ---------- */
function rockGeo(r, detail, amp, sd, tint = ['#6d7a8c', '#d3dae3']) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = n3(v.x * .45 + sd, v.y * .45, v.z * .45); v.multiplyScalar(1 + (n - .45) * amp); p.setXYZ(i, v.x, v.y, v.z); }
  const ng = g.index ? g.toNonIndexed() : g; ng.computeVertexNormals();
  const nn = ng.attributes.normal, pp = ng.attributes.position, cols = new Float32Array(pp.count * 3), a = col(tint[0]), b = col(tint[1]), c = new THREE.Color();
  for (let i = 0; i < pp.count; i++) { c.copy(a).lerp(b, clamp(nn.getY(i) * .5 + .5 + (hash(pp.getX(i), pp.getZ(i)) - .5) * .25)); cols.set([c.r, c.g, c.b], i * 3); }
  ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return ng;
}
const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, flatShading: true });
function rock(parent, r, x, y, z, s = [1, 1, 1], detail = 2, amp = .55, tint) {
  const m = new THREE.Mesh(rockGeo(r, detail, amp, rr(0, 50), tint), rockMat);
  m.position.set(x, y, z); m.scale.set(...s); m.rotation.y = rr(0, 6); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}

/* ---------- characters ---------- */
const skinTones = ['#f1c7a0', '#d9a57c', '#a8714d', '#f5d2b3'];
const charTags = {};
function villager(o) {
  const g = new THREE.Group();
  const shirt = M(o.shirt), pants = M(o.pants || '#4a3a2c'), skin = M(o.skin || pick(skinTones), { roughness: .7 }), hair = M(o.hair || '#4a2c18');
  const legL = cyl(g, .085, .075, .36, pants, -.1, .18, 0), legR = cyl(g, .085, .075, .36, pants, .1, .18, 0);
  const body = cyl(g, o.dress ? .2 : .19, o.dress ? .32 : .23, .55, shirt, 0, .62, 0, 0, 0, 0, 12);
  box(g, .44, .07, .3, M('#5a3a20'), 0, .42, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.24, 20, 16), skin); head.position.set(0, 1.12, 0); head.castShadow = true; g.add(head);
  const hm = new THREE.Mesh(new THREE.SphereGeometry(.255, 20, 12, 0, Math.PI * 2, 0, Math.PI * .55), hair); hm.position.set(0, 1.15, -.02); hm.rotation.x = -.25; hm.castShadow = true; g.add(hm);
  if (o.bun) { const b = new THREE.Mesh(new THREE.SphereGeometry(.11, 12, 10), hair); b.position.set(0, 1.3, -.2); g.add(b); }
  if (o.hat) { cyl(g, .3, .3, .04, M(o.hat), 0, 1.3, 0, 0, 0, 0, 16); cyl(g, .17, .2, .18, M(o.hat), 0, 1.4, 0, 0, 0, 0, 16); }
  const eyeM = M('#1a120c', { roughness: .3 });
  [-.08, .08].forEach(x => { const e = new THREE.Mesh(new THREE.SphereGeometry(.03, 8, 6), eyeM); e.position.set(x, 1.13, .22); g.add(e); });
  const cheek = M('#e88a7a', { transparent: true, opacity: .5 });
  [-.13, .13].forEach(x => { const e = new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 6), cheek); e.position.set(x, 1.06, .2); e.scale.z = .3; g.add(e); });
  const arm = (side) => { const a = new THREE.Group(); a.position.set(side * .25, .84, 0); g.add(a); cyl(a, .065, .06, .38, shirt, 0, -.17, 0); const h = new THREE.Mesh(new THREE.SphereGeometry(.07, 10, 8), skin); h.position.y = -.38; a.add(h); return a; };
  const aL = arm(-1), aR = arm(1);
  if (o.tool === 'pick') { const t = new THREE.Group(); t.position.set(0, -.38, 0); aR.add(t); cyl(t, .025, .025, .8, woodLight, 0, 0, .28, Math.PI / 2); const hd = box(t, .5, .07, .07, M('#9aa3ad', { metalness: .6, roughness: .4 }), 0, 0, .66); hd.rotation.y = 0; }
  if (o.tool === 'bow') { const t = new THREE.Mesh(new THREE.TorusGeometry(.45, .025, 6, 20, Math.PI * .9), woodDark); t.position.set(0, -.38, .05); t.rotation.set(0, Math.PI / 2, Math.PI * .55); aL.add(t); }
  if (o.pack) { box(g, .34, .4, .2, M('#7a5232'), 0, .72, -.25); cyl(g, .08, .08, .36, M('#c9b48a'), 0, .98, -.28, 0, 0, Math.PI / 2); }
  if (o.log) { cyl(g, .12, .12, 1.1, woods[1], 0, 1.0, .18, 0, 0, Math.PI / 2); aL.rotation.x = aR.rotation.x = -1.3; }
  if (o.ring) { const r = new THREE.Mesh(new THREE.RingGeometry(.45, .58, 40), new THREE.MeshBasicMaterial({ color: o.ring, transparent: true, opacity: .85, depthWrite: false })); r.rotation.x = -Math.PI / 2; r.position.y = .04; g.add(r); g.userData.ring = r; }
  g.scale.setScalar(o.scale || 1.25);
  g.userData = { ...g.userData, aL, aR, body, head, legL, legR, anim: o.anim || 'idle', ph: rr(0, 6), carry: !!o.log, swing: 0, shoot: 0 };
  g.traverse(m => { if (m.isMesh) m.castShadow = true; });
  return g;
}

/* ---------- MINE COMPLEX ---------- */
const mine = new THREE.Group(); mine.position.set(0.3, H(0.3, -3.2), -3.2); mine.rotation.y = -0.32; scene.add(mine);
{
  // stone base
  box(mine, 5.8, .45, 5.2, stone, 0, .22, 0);
  for (let i = 0; i < 9; i++) rock(mine, rr(.25, .4), rr(-2.9, 2.9), .2, 2.6 + rr(-.1, .1), [1, .7, 1], 1, .3);
  // body
  box(mine, 5.0, 2.5, 4.6, wallBlue, 0, 1.7, -.1);
  for (let x = -2.3; x <= 2.31; x += .41) { const b = box(mine, .39, 2.5, .09, pick([woodGrey, M('#9a948a'), M('#7f7a72')]), x, 1.7, 2.18); b.rotation.z = rr(-.01, .01); }
  for (let z = -2.2; z <= 2.0; z += .41) box(mine, .09, 2.5, .39, pick([woodGrey, M('#9a948a'), M('#7f7a72')]), -2.52, 1.7, z);
  // stone corners
  [[-2.55, 2.25], [2.55, 2.25], [-2.55, -2.4]].forEach(([x, z]) => { for (let y = 0; y < 5; y++) box(mine, y % 2 ? .58 : .7, .5, y % 2 ? .7 : .58, pick([stoneLight, stone]), x, .7 + y * .5, z); });
  // roof (gable facing camera)
  const y0 = 2.95, half = 3.15, a = 0.66, L = half / Math.cos(a), rise = Math.tan(a) * half;
  slope(mine, L, 5.6, slates, 8, 10, -half / 2, y0 + rise / 2, -.1, a);
  slope(mine, L, 5.6, slates, 8, 10, half / 2, y0 + rise / 2, -.1, -a);
  box(mine, .36, .26, 5.8, M('#3f5a7d'), 0, y0 + rise + .05, -.1, 0, 0, Math.PI / 4);
  // gable
  const sh = new THREE.Shape(); sh.moveTo(-half + .3, 0); sh.lineTo(half - .3, 0); sh.lineTo(0, rise - .1); sh.closePath();
  const gm = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: .2, bevelEnabled: false }), wallBlue); gm.position.set(0, y0, 2.05); gm.castShadow = true; mine.add(gm);
  const trim = M('#d9d2c4');
  const tri = new THREE.Shape(); tri.moveTo(-.85, 0); tri.lineTo(.85, 0); tri.lineTo(0, .95); tri.closePath(); const hole = new THREE.Path(); hole.moveTo(-.55, .12); hole.lineTo(.55, .12); hole.lineTo(0, .72); hole.closePath(); tri.holes.push(hole);
  const tm = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: .12, bevelEnabled: false }), trim); tm.position.set(0, y0 + .35, 2.24); mine.add(tm);
  box(mine, 6.7, .16, .2, woodLight, -half / 2, y0 + rise / 2 + .02, 2.62, 0, 0, a).scale.x = .5;
  box(mine, 6.7, .16, .2, woodLight, half / 2, y0 + rise / 2 + .02, 2.62, 0, 0, -a).scale.x = .5;
  // porch + door
  box(mine, 1.7, 2.0, .12, black, 0, 1.45, 2.24);
  box(mine, .2, 2.3, .2, woodDark, -.95, 1.5, 2.3); box(mine, .2, 2.3, .2, woodDark, .95, 1.5, 2.3); box(mine, 2.3, .22, .24, woodDark, 0, 2.62, 2.32);
  box(mine, .18, 2.4, .18, woods[0], -1.25, 1.5, 3.55); box(mine, .18, 2.4, .18, woods[0], 1.25, 1.5, 3.55);
  plankRoof(mine, 2.9, 1.8, 8, 0, 2.78, 3.05, 0, 0.32).rotation.set(0.32, Math.PI / 2, 0);
  // lantern
  const lan = box(mine, .2, .28, .2, M('#ffcf7a', { emissive: '#ffae3a', emissiveIntensity: 3 }), 1.25, 2.25, 3.72);
  const pl = new THREE.PointLight('#ffb050', 6, 7, 2); pl.position.set(1.25, 2.1, 3.9); mine.add(pl); window._lantern = pl;
}

// big boulder behind the mine
const boulder = new THREE.Group(); scene.add(boulder);
{
  const by = H(2, -8);
  rock(boulder, 4.2, 2.6, by + 3.0, -8.2, [1.35, 1.05, 1.0], 2, .6);
  rock(boulder, 3.0, -1.6, by + 2.0, -6.8, [1.1, 1.05, 1], 2, .55);
  rock(boulder, 2.9, 6.6, by + 2.0, -5.2, [1.0, 1.2, 1.1], 2, .55);
  rock(boulder, 2.2, 1.4, by + 6.6, -8.0, [1.3, .8, 1.2], 2, .5);
  rock(boulder, 2.1, 5.2, by + 5.2, -9.4, [1, 1, 1], 2, .5);
  rock(boulder, 1.6, -3.4, by + 1.1, -4.4, [1, .8, 1], 1, .45);
  rock(boulder, 1.3, 8.4, by + .9, -2.6, [1, .8, 1], 1, .45);
  for (let i = 0; i < 9; i++) rock(scene, rr(.25, .55), rr(-5, 10), H(0, 0) + .1, rr(-3, 3.5), [1, .75, 1], 1, .4);
}

// headframe tower on top of boulder
const tower = new THREE.Group(); tower.position.set(0.6, H(2, -8) + 7.4, -8.6); tower.rotation.y = -.3; scene.add(tower);
{
  const P = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  P.forEach(([x, z]) => box(tower, .22, 4.2, .22, pick(woods), x, 2.1, z));
  [1.2, 2.6, 3.9].forEach(y => { box(tower, 2.3, .16, .16, pick(woods), 0, y, 1); box(tower, 2.3, .16, .16, pick(woods), 0, y, -1); box(tower, .16, .16, 2.3, pick(woods), 1, y, 0); box(tower, .16, .16, 2.3, pick(woods), -1, y, 0); });
  box(tower, .12, 2.6, .12, woods[2], 0, 1.95, 1.02, 0, 0, .75); box(tower, .12, 2.6, .12, woods[2], 1.02, 1.95, 0, .75, 0, 0);
  plankRoof(tower, 1.7, 2.8, 7, -.7, 4.75, 0, .6); plankRoof(tower, 1.7, 2.8, 7, .7, 4.75, 0, -.6);
  box(tower, .18, .18, 3.4, woodDark, 0, 3.9, 2.2);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(.32, .06, 8, 18), woodDark); wheel.position.set(0, 3.7, 3.7); wheel.rotation.y = Math.PI / 2; tower.add(wheel);
  const rope = new THREE.Group(); rope.position.set(0, 3.5, 3.8); tower.add(rope);
  cyl(rope, .025, .025, 3.6, M('#c8b48a'), 0, -1.8, 0);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(.17, .045, 6, 14, Math.PI * 1.4), M('#5b6168', { metalness: .7, roughness: .4 })); hook.position.y = -3.75; hook.rotation.z = 2.3; rope.add(hook);
  window._rope = rope;
}

// side scaffold platform (right)
const deck = new THREE.Group(); deck.position.set(6.4, H(6.4, -4), -4.2); deck.rotation.y = -.32; scene.add(deck);
{
  const DY = 4.6;
  for (let i = 0; i < 12; i++) box(deck, .36, .1, 4.2, pick(woods), -2.0 + i * .37, DY, 0, 0, rr(-.02, .02), 0);
  [[-2, -1.9], [2.1, -1.9], [-2, 1.9], [2.1, 1.9], [0, 1.9]].forEach(([x, z]) => box(deck, .24, DY, .24, woodDark, x, DY / 2, z));
  box(deck, .14, 5.6, .14, woods[1], 1.05, 2.3, 1.9, 0, 0, .83); box(deck, .14, 5.6, .14, woods[1], -1, 2.3, 1.9, 0, 0, -.83);
  box(deck, .14, 5.6, .14, woods[1], 2.1, 2.3, 0, .83, 0, 0);
  // railings
  [[0, 2.05, 4.3, true], [2.2, 0, 4.1, false]].forEach(([x, z, len, alongX]) => {
    for (let k = 0; k < 5; k++) { const t = -len / 2 + k * len / 4; box(deck, .12, .9, .12, woodDark, alongX ? t : x, DY + .45, alongX ? z : t); }
    box(deck, alongX ? len : .12, .12, alongX ? .12 : len, woodLight, x, DY + .9, z); box(deck, alongX ? len : .12, .1, alongX ? .1 : len, pick(woods), x, DY + .5, z);
  });
  // crane
  box(deck, .2, 2.6, .2, woodDark, -1.6, DY + 1.3, -1.4);
  box(deck, 2.4, .16, .16, woods[0], -2.6, DY + 2.5, -1.4);
  const ch = cyl(deck, .02, .02, 2.2, M('#7c8288', { metalness: .6 }), -3.6, DY + 1.4, -1.4);
  box(deck, .5, .4, .4, M('#c7cfd8', { flatShading: true }), -3.6, DY + .25, -1.4);
  // crates & barrels
  box(deck, .6, .55, .6, woods[3], 1.3, DY + .33, -1.2, 0, .3); box(deck, .5, .45, .5, woods[4], 1.5, DY + .82, -1.1, 0, .6);
  cyl(deck, .28, .25, .7, woods[2], -.6, DY + .4, -1.4, 0, 0, 0, 12);
}

// left wooden stair landing near rock
const land = new THREE.Group(); land.position.set(-3.3, H(-3.3, -2.4), -2.4); land.rotation.y = -.3; scene.add(land);
{
  for (let i = 0; i < 6; i++) box(land, .3, .1, 1.6, pick(woods), -0.75 + i * .3, 1.35, 0);
  [[-.8, -.7], [.8, -.7], [-.8, .7], [.8, .7]].forEach(([x, z]) => box(land, .16, 1.35, .16, woodDark, x, .68, z));
  // ramp
  const r = new THREE.Group(); r.position.set(.5, .65, 1.6); r.rotation.x = .62; land.add(r);
  for (let i = 0; i < 5; i++) box(r, 1.2, .09, .34, pick(woods), 0, 0, -0.8 + i * .36);
  for (let i = 0; i < 6; i++) box(land, .22, .22, rr(.8, 1.4), pick(woods), -.95, .12 + (i % 3) * .2, rr(-.5, .5), 0, rr(-.2, .2), 0);
}

// rails + cart (in mine local space)
{
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, .32, 2.3), new THREE.Vector3(0, .1, 4.2), new THREE.Vector3(-.5, .06, 6.2), new THREE.Vector3(-1.9, .05, 8.0), new THREE.Vector3(-3.6, .05, 9.0)]);
  const N = 40, l = [], r = [], up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= N; i++) { const t = i / N, p = curve.getPoint(t), tg = curve.getTangent(t), side = new THREE.Vector3().crossVectors(up, tg).normalize(); l.push(p.clone().addScaledVector(side, .38).setY(p.y + .14)); r.push(p.clone().addScaledVector(side, -.38).setY(p.y + .14)); }
  const railM = M('#6d5048', { metalness: .5, roughness: .45 });
  [l, r].forEach(pts => { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, .05, 5), railM); m.castShadow = true; mine.add(m); });
  for (let i = 0; i <= 22; i++) { const t = i / 22, p = curve.getPoint(t), tg = curve.getTangent(t); const s = box(mine, 1.15, .1, .22, pick(woods), p.x, p.y + .05, p.z); s.rotation.y = Math.atan2(tg.x, tg.z); }
  // end bumper
  { const p = curve.getPoint(1); const b = box(mine, .9, .5, .25, woods[0], p.x, .3, p.z); b.rotation.y = 1.1; }
  // cart
  const cart = new THREE.Group(); const cp = curve.getPoint(.36), ct = curve.getTangent(.36); cart.position.set(cp.x, cp.y + .25, cp.z); cart.rotation.y = Math.atan2(ct.x, ct.z); mine.add(cart);
  const blue = M('#3d6fbf', { metalness: .35, roughness: .5 }), rim = M('#2a4f8c', { metalness: .4, roughness: .45 });
  box(cart, 1.15, .1, 1.5, blue, 0, .3, 0);
  box(cart, 1.25, .7, .1, blue, 0, .65, .72); box(cart, 1.25, .7, .1, blue, 0, .65, -.72); box(cart, .1, .7, 1.45, blue, .6, .65, 0); box(cart, .1, .7, 1.45, blue, -.6, .65, 0);
  box(cart, 1.4, .1, 1.62, rim, 0, 1.02, 0).scale.set(1, 1, 1);
  box(cart, 1.42, .08, .14, rim, 0, .5, .75); box(cart, 1.42, .08, .14, rim, 0, .5, -.75);
  [[-.45, .48], [.45, .48], [-.45, -.48], [.45, -.48]].forEach(([x, z]) => cyl(cart, .17, .17, .1, M('#2b2420', { metalness: .6 }), x * 1.25, .15, z, 0, 0, Math.PI / 2, 12));
  const ore = new THREE.MeshStandardMaterial({ color: '#dfe9f7', roughness: .35, metalness: .1, flatShading: true, emissive: '#7fb0ff', emissiveIntensity: .25 });
  for (let i = 0; i < 9; i++) { const o = new THREE.Mesh(new THREE.IcosahedronGeometry(rr(.17, .27), 0), ore); o.position.set(rr(-.4, .4), rr(.85, 1.12), rr(-.5, .5)); o.rotation.set(rr(0, 3), rr(0, 3), 0); o.castShadow = true; cart.add(o); }
  window._cart = cart;
}

/* ---------- shed (wood depot) ---------- */
const shed = new THREE.Group(); shed.position.set(-8.2, H(-8.2, 1.6), 1.6); shed.rotation.y = .55; scene.add(shed);
{
  [[-1.5, -1.1], [1.5, -1.1], [-1.5, 1.1], [1.5, 1.1]].forEach(([x, z]) => box(shed, .22, 2.6, .22, woods[1], x, 1.3, z, 0, 0, rr(-.04, .04)));
  box(shed, 3.4, .18, .18, woodDark, 0, 2.55, 1.1); box(shed, 3.4, .18, .18, woodDark, 0, 2.55, -1.1);
  plankRoof(shed, 1.9, 3.8, 11, 0, 3.05, -.75, 0).rotation.set(.62, Math.PI / 2, 0);
  plankRoof(shed, 1.9, 3.8, 11, 0, 3.05, .75, 0).rotation.set(-.62, Math.PI / 2, 0);
  box(shed, 3.9, .18, .2, woodDark, 0, 3.62, 0);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6 - row; i++) cyl(shed, .2, .2, 2.4, pick(woods), -1.0 + i * .42 + row * .21, .22 + row * .36, -.3, 0, 0, Math.PI / 2, 10);
  cyl(shed, .42, .45, .5, woods[2], 2.4, .25, 1.4, 0, 0, 0, 14);
  box(shed, .08, .7, .08, woodLight, 2.4, .8, 1.4, .4, 0, .3); box(shed, .32, .16, .06, M('#9aa3ad', { metalness: .6 }), 2.48, 1.1, 1.55, .4, 0, .3);
}

/* ---------- fence ---------- */
{
  const f = new THREE.Group(); f.position.set(-3.6, H(-3.6, 9.5), 9.5); f.rotation.y = .25; scene.add(f); window._fence = f;
  [[0, 0], [1.8, 0], [3.5, 0], [3.5, -1.6]].forEach(([x, z]) => box(f, .2, 1.1, .2, woods[1], x, .55, z, 0, rr(-.3, .3), rr(-.06, .06)));
  box(f, 3.6, .14, .12, pick(woods), 1.75, .85, 0); box(f, 3.6, .14, .12, pick(woods), 1.75, .45, 0, 0, 0, .03);
  box(f, .12, .14, 1.7, pick(woods), 3.5, .85, -.8); box(f, .12, .14, 1.7, pick(woods), 3.5, .45, -.8, .05);
}

/* ---------- cottages hinting the village ---------- */
function cottage(x, z, ry, s = 1, roofC) {
  const g = new THREE.Group(); g.position.set(x, H(x, z), z); g.rotation.y = ry; g.scale.setScalar(s); scene.add(g);
  box(g, 4.2, .4, 3.6, stone, 0, .2, 0);
  box(g, 3.8, 2.4, 3.2, M('#e8dcc2'), 0, 1.6, 0);
  [-1.85, 1.85].forEach(x => box(g, .22, 2.4, 3.3, woods[1], x, 1.6, 0)); box(g, 3.9, .22, .22, woods[1], 0, 2.7, 1.62);
  const a = .62, half = 2.3, L = half / Math.cos(a), rise = Math.tan(a) * half;
  const rm = (roofC || ['#a0563a', '#8e4a32', '#b0644a']).map(c => M(c));
  slope(g, L, 3.9, rm, 6, 7, -half / 2, 2.8 + rise / 2, 0, a); slope(g, L, 3.9, rm, 6, 7, half / 2, 2.8 + rise / 2, 0, -a);
  const sh = new THREE.Shape(); sh.moveTo(-1.9, 0); sh.lineTo(1.9, 0); sh.lineTo(0, rise - .1); sh.closePath();
  const gm = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 3.2, bevelEnabled: false }), M('#e8dcc2')); gm.position.set(0, 2.8, -1.6); g.add(gm);
  box(g, .9, 1.5, .1, woods[0], 0, 1.15, 1.62);
  const win = WIN_MAT;
  box(g, .6, .6, .08, win, -1.1, 1.8, 1.63); box(g, .6, .6, .08, win, 1.1, 1.8, 1.63);
  box(g, .5, 1.6, .5, stone, 1.1, 4.0, -.6);
  return g;
}
const COTTAGES = [cottage(-10.5, -13.5, .35, 1.0), cottage(13.5, -15, -.45, 1.05, ['#5f82ad', '#557aa6', '#6a8db7']), cottage(-19, -6, .9, .95)];

/* ---------- pines (instanced) ---------- */
function pineGeo(tiers, sd) {
  seed = sd;
  const geos = [];
  const dark = col('#0f2c17'), mid = col('#23552a'), light = col('#5f9a30'), tip = col('#a6c845');
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = .42 * (1 - t * .82) + .05, h = .3 * (1 - t * .35), y = .2 + t * .66;
    const seg = 18, g = new THREE.ConeGeometry(r, h, seg, 3, true);
    g.rotateY(rr(0, 6));
    const p = g.attributes.position, cols = new Float32Array(p.count * 3), c = new THREE.Color(), nrm = new Float32Array(p.count * 3);
    const off = rr(0, 6);
    for (let k = 0; k < p.count; k++) {
      let x = p.getX(k), yy = p.getY(k), z = p.getZ(k);
      const yn = (yy + h / 2) / h, ang = Math.atan2(z, x) + off;
      const spike = Math.pow(Math.abs(Math.cos(ang * seg / 4)), 3);
      const rad = Math.hypot(x, z);
      const edge = 1 - yn;
      const f = 1 + edge * (spike * .28 - .08) + rr(-.05, .05);
      x *= f; z *= f;
      yy -= edge * edge * h * (.35 + spike * .35) - rr(-.01, .01);
      p.setXYZ(k, x, yy + y, z);
      c.copy(dark).lerp(mid, clamp(edge * 1.3)).lerp(light, clamp(edge * spike * 1.2)).lerp(tip, clamp(edge * spike - .6) * 1.5);
      c.lerp(dark, (1 - t) * .15);
      cols.set([c.r, c.g, c.b], k * 3);
      const nx = x, ny = (yy + y) - y + .25 + .3, nz = z, l = Math.hypot(nx, ny, nz) || 1; nrm.set([nx / l, ny / l, nz / l], k * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geos.push(g);
  }
  return mergeGeometries(geos);
}
const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, side: THREE.DoubleSide });
foliageMat.onBeforeCompile = s => {
  s.uniforms.uTime = uTime;
  s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    #ifdef USE_INSTANCING
    vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
    #else
    vec2 ip = vec2(0.);
    #endif
    float sw = sin(uTime*1.1 + ip.x*.3 + ip.y*.2)*.5 + sin(uTime*2.3 + ip.x)*.25;
    transformed.x += sw * .018 * position.y * position.y;
    transformed.z += sw * .01 * position.y * position.y;`);
};
const trunkMat = M('#5a3b26');
const trunkGeo = new THREE.CylinderGeometry(.03, .06, .45, 7); trunkGeo.translate(0, .22, 0);
const pineVariants = [pineGeo(6, 11), pineGeo(7, 22), pineGeo(5, 33)];
seed = 4242;
const treeSpots = [];
const fixed = [[-15.5, 5, 13], [-19, -2, 12], [-7, -15, 12], [-1.5, -17, 13], [5, -16.5, 12], [9.5, -12.5, 11], [15.5, -9, 12], [21, -3, 13], [26, 4, 12], [-11, -7.5, 10], [-6.5, -9.5, 10],
  [-17.5, 13, 12], [-22, 9, 13], [24, 11, 11], [28, -10, 12], [18, -18, 13], [-13, -16, 11], [3, -22, 13], [11.5, -6.5, 9.5], [-9.5, 9.5, 9]];
fixed.forEach(([x, z, h]) => treeSpots.push([x, z, h * .72]));
for (let i = 0; i < 900 && treeSpots.length < 135; i++) {
  const x = rr(-40, 42), z = rr(-40, 22);
  const dc = Math.hypot((x - 1) / 1.15, (z - 0.5) / 1.0);
  if (dc < 13) continue;
  if (x > 5 && x < 22 && z > -1 && z < 22) continue;   // open meadow
  if (streamD(x, z) < 3) continue;
  if (x > -12 && x < -4 && z > -2 && z < 5) continue;
  if (z > 9 && x > -17 && x < 25) continue;
  if (treeSpots.some(([a, b]) => Math.hypot(a - x, b - z) < 3.0)) continue;
  treeSpots.push([x, z, rr(6.5, 9.5)]);
}
{
  const groups = [[], [], []];
  treeSpots.forEach((t, i) => groups[i % 3].push(t));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length); trunks.castShadow = true; scene.add(trunks); let ti = 0;
  groups.forEach((list, gi) => {
    const im = new THREE.InstancedMesh(pineVariants[gi], foliageMat, list.length); im.castShadow = true; im.receiveShadow = true;
    list.forEach(([x, z, h], i) => {
      const w = h * rr(.85, 1.1);
      p.set(x, H(x, z) - .2, z); e.set(rr(-.04, .04), rr(0, 6.28), rr(-.04, .04)); q.setFromEuler(e); s.set(w, h, w);
      m4.compose(p, q, s); im.setMatrixAt(i, m4); trunks.setMatrixAt(ti++, m4);
      TREES.push({ im, i, trunks, ti: ti - 1, x, z, p: p.clone(), q: q.clone(), s: s.clone(), hp: 4, state: 'up', t: 0, shake: 0 });
      c.setHSL(rr(.25, .3), rr(.75, 1), rr(.92, 1.08) * .5 + .5); im.setColorAt(i, c);
    });
    scene.add(im);
  });
}

/* ---------- bushes ---------- */
{
  const g = new THREE.IcosahedronGeometry(1, 2); const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(1 + (n3(v.x * 2, v.y * 2, v.z * 2) - .45) * .7); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  const cols = new Float32Array(p.count * 3), a = col('#244f1e'), b = col('#8fbf3e'), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { c.copy(a).lerp(b, clamp(p.getY(i) * .5 + .5)); cols.set([c.r, c.g, c.b], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const spots = [];
  for (let i = 0; i < 2000 && spots.length < 140; i++) {
    const x = rr(-34, 36), z = rr(-30, 22), dc = Math.hypot((x - 1) / 1.15, z - .5);
    if (dc < 9.5 || streamD(x, z) < 2.2) continue;
    if (x > 5 && x < 22 && z > 3 && z < 22 && rand() < .85) continue;
    if (x > -12 && x < -4 && z > -2 && z < 5) continue;
    spots.push([x, z]);
  }
  const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 }), spots.length); im.castShadow = im.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pp = new THREE.Vector3(), cc = new THREE.Color();
  spots.forEach(([x, z], i) => { const r = rr(.7, 1.6); pp.set(x, H(x, z) + r * .2, z); q.setFromEuler(new THREE.Euler(0, rr(0, 6), 0)); s.set(r * rr(1, 1.4), r * rr(.55, .8), r); m4.compose(pp, q, s); im.setMatrixAt(i, m4); cc.setHSL(rr(.22, .3), .7, .5 * rr(.85, 1.1)); im.setColorAt(i, cc); });
  scene.add(im);
}

/* ---------- grass (instanced, wind shader) ---------- */
const GRASS_HOLES = { value: Array.from({ length: 24 }, () => new THREE.Vector3()) };
const blockers = [[-3.5, 4.5, -11, 1], [-11, -5.5, -1.5, 4.5], [3.5, 9.5, -7, -1.5], [-4.6, -2, -3.8, -1]];
const blocked = (x, z) => blockers.some(([a, b, c, d]) => x > a && x < b && z > c && z < d);
{
  const bg = new THREE.BufferGeometry();
  const segs = 4, Wd = .085, pos = [], hgt = [], idx = [];
  for (let i = 0; i <= segs; i++) { const t = i / segs, w = Wd * (1 - t * .95), bend = t * t * .12; pos.push(-w, t, bend, w, t, bend); hgt.push(t, t); if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('aH', new THREE.Float32BufferAttribute(hgt, 1)); bg.setIndex(idx);
  const nrm = []; for (let i = 0; i < pos.length / 3; i++) nrm.push(0, 1, 0); bg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const mat = new THREE.MeshStandardMaterial({ roughness: .9, side: THREE.DoubleSide });
  mat.onBeforeCompile = s => {
    s.uniforms.uTime = uTime;
    s.uniforms.uHoles = GRASS_HOLES;
    s.vertexShader = 'uniform float uTime;\nuniform vec3 uHoles[24];\nattribute float aH;\nvarying float vH;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vH = aH;
      vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      for (int k = 0; k < 24; k++) { if (uHoles[k].z > 0. && distance(ip, uHoles[k].xy) < uHoles[k].z) transformed *= 0.; }
      float w = sin(uTime*1.6 + ip.x*.35 + ip.y*.22) + .5*sin(uTime*2.9 + ip.x*.9 - ip.y*.4);
      transformed.x += w * .12 * aH * aH;
      transformed.z += w * .07 * aH * aH;`);
    s.fragmentShader = 'varying float vH;\n' + s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= mix(.32, 1.25, vH);`);
  };
  const N = MOBILE ? 70000 : 120000, im = new THREE.InstancedMesh(bg, mat, N); im.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const gA = col('#4f8a2a'), gB = col('#8cbc3a'), gC = col('#c6c75a');
  let n = 0;
  for (let i = 0; i < N * 3 && n < N; i++) {
    const x = rr(-30, 32), z = rr(-24, 24);
    const d = dirt(x, z);
    if (d > .2 + rand() * .5) continue;
    if (streamD(x, z) < 1.8 || blocked(x, z)) continue;
    const meadow = sstep(3, 9, x) * sstep(0, 6, z);
    const hgt = rr(.25, .55) * (1 + meadow * .45) * (1 - d * .8) * (1 + (fbm(x * .2, z * .2) - .4));
    p.set(x, H(x, z) - .03, z); e.set(rr(-.25, .25), rr(0, 6.28), rr(-.25, .25)); q.setFromEuler(e); s.set(rr(.8, 1.4), hgt, 1);
    m4.compose(p, q, s); im.setMatrixAt(n, m4);
    c.copy(gA).lerp(gB, rand()).lerp(gC, Math.pow(rand(), 5) * .8 + meadow * .1); c.multiplyScalar(rr(.85, 1.1)); im.setColorAt(n, c); n++;
  }
  im.count = n; scene.add(im);
}

/* ---------- flowers / mushrooms ---------- */
function scatterInst(geo, mat, count, place) {
  const im = new THREE.InstancedMesh(geo, mat, count); im.castShadow = true; im.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  let n = 0; for (let i = 0; i < count * 6 && n < count; i++) { const r = place(p, q, s, c); if (!r) continue; m4.compose(p, q, s); im.setMatrixAt(n, m4); im.setColorAt(n, c); n++; }
  im.count = n; scene.add(im); return im;
}
const clusters = (k, area, test) => { const out = []; for (let i = 0; i < 500 && out.length < k; i++) { const x = rr(...area[0]), z = rr(...area[1]); if (test(x, z)) out.push([x, z]); } return out; };
const okSpot = (x, z) => dirt(x, z) < .2 && streamD(x, z) > 2.5 && !blocked(x, z);
{ // goldenrod plumes
  const g = new THREE.ConeGeometry(.1, .7, 6); g.translate(0, .75, 0); const st = new THREE.CylinderGeometry(.015, .02, .5, 4); st.translate(0, .25, 0);
  const geo = mergeGeometries([g, st]);
  const cl = clusters(40, [[-24, 26], [-16, 22]], (x, z) => okSpot(x, z) && Math.hypot(x - 1, z) > 6.5);
  const cA = col('#e9a92a'), cB = col('#f6cf4a'), cC = col('#d9772a');
  scatterInst(geo, M('#ffffff', { roughness: .8 }), 900, (p, q, s, c) => { const [cx, cz] = pick(cl); const x = cx + rr(-1.3, 1.3), z = cz + rr(-1.3, 1.3); if (!okSpot(x, z)) return 0; p.set(x, H(x, z), z); q.setFromEuler(new THREE.Euler(rr(-.2, .2), 0, rr(-.2, .2))); const k = rr(.7, 1.3); s.set(k, k, k); c.copy(cA).lerp(cB, rand()).lerp(cC, rand() * .3); return 1; });
}
{ // lavender
  const g = new THREE.ConeGeometry(.05, .4, 5); g.translate(0, .65, 0); const st = new THREE.CylinderGeometry(.01, .015, .5, 3); st.translate(0, .25, 0);
  const geo = mergeGeometries([g, st]);
  const cl = clusters(28, [[-14, 26], [-6, 22]], (x, z) => okSpot(x, z) && Math.hypot(x - 1, z) > 6);
  scatterInst(geo, M('#ffffff', { roughness: .8 }), 700, (p, q, s, c) => { const [cx, cz] = pick(cl); const x = cx + rr(-1, 1), z = cz + rr(-1, 1); if (!okSpot(x, z)) return 0; p.set(x, H(x, z), z); q.setFromEuler(new THREE.Euler(rr(-.25, .25), 0, rr(-.25, .25))); const k = rr(.8, 1.3); s.set(k, k, k); c.setHSL(rr(.72, .78), rr(.45, .65), rr(.5, .65)); return 1; });
}
{ // tiny white & pink flowers
  const geo = new THREE.IcosahedronGeometry(.07, 0); geo.translate(0, .45, 0);
  scatterInst(geo, M('#ffffff', { roughness: .6, emissive: '#222', }), 2600, (p, q, s, c) => { const x = rr(-20, 28), z = rr(-12, 22); if (!okSpot(x, z)) return 0; const m = sstep(2, 8, x); if (rand() > .3 + m * .7) return 0; p.set(x, H(x, z) + rr(-.1, .2), z); q.identity(); const k = rr(.7, 1.3); s.set(k, k, k); c.set(rand() < .85 ? '#fbfbf2' : '#ffb6d0'); return 1; });
}
{ // mushrooms
  const cap = new THREE.SphereGeometry(.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2); cap.scale(1, .55, 1); cap.translate(0, .28, 0);
  const stem = new THREE.CylinderGeometry(.05, .07, .3, 8); stem.translate(0, .14, 0);
  const capM = M('#f08a2a', { roughness: .5, emissive: '#5a2000', emissiveIntensity: .2 }), stemM = M('#f3e6cf');
  [[5.4, .6], [5.9, .9], [6.2, .4], [4.8, 1.3], [-6, -4], [-5.6, -3.6], [10.5, -2.5], [10.9, -2.1]].forEach(([x, z]) => { const k = rr(.8, 1.5); const a = new THREE.Mesh(cap, capM), b = new THREE.Mesh(stem, stemM); [a, b].forEach(m => { m.position.set(x, H(x, z), z); m.scale.setScalar(k); m.castShadow = true; scene.add(m); }); });
}
// stray rocks
for (let i = 0; i < 40 && ROCKS.length < 26; i++) { const x = rr(-22, 26), z = rr(-14, 19); if (streamD(x, z) < 2.5 || blocked(x, z) || Math.hypot(x + 1.9, z - 3.6) < 3 || Math.hypot(x - 1, z - 2) < 4) continue; if (ROCKS.some(r => Math.hypot(r.x - x, r.z - z) < 2.5)) continue; const rad = rr(.4, .7); const m = rock(scene, rad, x, H(x, z) + .05, z, [1, .7, 1], 1, .45); ROCKS.push({ mesh: m, x, z, r: rad * .95, hp: 4, t: 0, base: m.scale.clone() }); }
// background cliff
rock(scene, 14, 34, H(34, -26) + 2, -26, [1.1, 1.3, .8], 3, .7, ['#6b3826', '#b0664a']);
rock(scene, 10, 22, H(22, -34) + 2, -34, [1.2, 1.1, .8], 3, .7, ['#6b3826', '#a85e44']);

/* ---------- characters placement ---------- */
const chars = [];
function place(v, x, z, ry, yOff = 0) { v.position.set(x, H(x, z) + yOff, z); v.rotation.y = ry; v.userData.yOff = yOff; scene.add(v); chars.push(v); return v; }
const brune = place(villager({ shirt: '#e2763a', dress: true, hair: '#3a2010', bun: true, tool: 'pick', anim: 'mine' }), -3.6, -2.7, 2.9, 1.4);
const tobin = place(villager({ shirt: '#d8c9a8', pants: '#5a4630', hair: '#2a1a10', tool: 'pick', anim: 'mine' }), 4.6, -5.3, 2.5, 4.62 + H(6.4, -4) - H(4.6, -5.3));
const pip = place(villager({ shirt: '#f2efe4', pants: '#6a4a30', hair: '#c88a3a', hat: '#c9a25a', anim: 'rest' }), 7.6, -3.2, 2.2, 4.62 + H(6.4, -4) - H(7.6, -3.2));
const carrier = place(villager({ shirt: '#6a8f4a', pants: '#4a3a2c', hair: '#5a3018', log: true, anim: 'walk' }), -5.2, 3.4, 1.9);
const player = place(villager({ shirt: '#3d7fa8', pants: '#3a3a44', hair: '#2b1d14', pack: true, tool: 'pick', ring: '#4fe0d0', anim: 'idle', scale: 1.3 }), -1.9, 3.8, 2.6);
const lyra = place(villager({ shirt: '#a8452f', pants: '#4b3b2b', hair: '#7a3a1a', bun: true, tool: 'bow', pack: true, ring: '#ff9b4a', anim: 'walk', scale: 1.3 }), 9.5, 5.5, -2.2);
const builder = place(villager({ shirt: '#c9a24a', pants: '#4a3a2c', hair: '#1a120c', hat: '#8a5a30', tool: 'pick', anim: 'idle' }), 8.8, 0.8, -1);

/* ---------- pollen / fireflies ---------- */
{
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(.3, 'rgba(255,210,120,.6)'); gr.addColorStop(1, 'rgba(255,200,100,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  const N = 220, pos = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const px = rr(-22, 26), pz = rr(-16, 20); pos.set([px, H(px, pz) + rr(.4, 6), pz], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: .32, map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffe0a0' }));
  scene.add(pts); window._pollen = pts;
}
/* ---------- god rays ---------- */
{
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const x = cv.getContext('2d'); const gr = x.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,230,170,0)'); gr.addColorStop(.35, 'rgba(255,225,160,.55)'); gr.addColorStop(1, 'rgba(255,220,150,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 256);
  const g2 = x.createLinearGradient(0, 0, 64, 0); g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(.5, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)'); x.globalCompositeOperation = 'destination-out'; x.fillStyle = g2; x.fillRect(0, 0, 64, 256);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: .09, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  [[-12, -6, 5], [-4, -10, 3.5], [8, -12, 4], [-16, 4, 4]].forEach(([x0, z0, w]) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 30), mat); m.position.set(x0 + 6, 13, z0 - 2); m.rotation.set(0, .5, .62); scene.add(m); });
}

/* ---------- post-processing ---------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const TiltShift = {
  uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() }, focus: { value: .52 }, range: { value: .5 }, amount: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 dir; uniform float focus, range, amount; varying vec2 vUv;
    void main(){ float d=abs(vUv.y-focus) + max(0.,.18-vUv.x)*1.2*step(.6,vUv.y); float b=smoothstep(range*.35,range,d)*amount;
      vec4 c=vec4(0.); float tw=0.; for(int i=-5;i<=5;i++){ float fi=float(i); float w=exp(-fi*fi/12.); c+=texture2D(tDiffuse,vUv+dir*fi*b)*w; tw+=w; } gl_FragColor=c/tw; }`
};
const tH = new ShaderPass(TiltShift), tV = new ShaderPass(TiltShift);
composer.addPass(tH); composer.addPass(tV);
const bloom = new UnrealBloomPass(new THREE.Vector2(W(), Hh()), .22, .6, .9); composer.addPass(bloom);
composer.addPass(new OutputPass());
const Grade = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uNight: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uNight; varying vec2 vUv;
    void main(){ vec2 cc=vUv-.5; float r2=dot(cc,cc); float ca=r2*.012;
      vec3 c=vec3(texture2D(tDiffuse,vUv+cc*ca).r, texture2D(tDiffuse,vUv).g, texture2D(tDiffuse,vUv-cc*ca).b);
      float l=dot(c,vec3(.299,.587,.114)); c=mix(vec3(l),c,1.2);
      c=(c-.5)*1.07+.5; c*=vec3(1.04,1.0,.93);
      c+=vec3(.05,.03,0.)*smoothstep(.4,1.,vUv.y)*smoothstep(.7,0.,vUv.x);
      c=mix(c, c*vec3(.85,.95,1.08), smoothstep(.5,0.,vUv.y)*.35);
      c=mix(c, c*vec3(.62,.74,1.12), uNight*.55);
      float v=smoothstep(.95,.25,length(cc*vec2(1.,1.25))); c*=mix(.5 - uNight*.15,1.,v);
      float g=fract(sin(dot(vUv*uTime,vec2(12.9898,78.233)))*43758.5453); c+=(g-.5)*.015;
      gl_FragColor=vec4(c,1.); }`
};
const grade = new ShaderPass(Grade); composer.addPass(grade);
function resize() {
  const w = W(), h = Hh(); renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h;
  camera.fov = w / h < 1.6 ? 44 : 34; camera.updateProjectionMatrix();
  const pr = renderer.getPixelRatio(); tH.uniforms.dir.value.set(2.2 / (w * pr) * pr, 0); tV.uniforms.dir.value.set(0, 2.2 / (h * pr) * pr);
}
addEventListener('resize', resize); resize();

/* ================= GAMEPLAY ================= */
const $ = id => document.getElementById(id);
const fmt = n => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const lerpAng = (a, b, t) => { const d = (((b - a + Math.PI) % TAU) + TAU) % TAU - Math.PI; return a + d * t; };
const DAY_LEN = 300;                       // secondes réelles pour 24 h de jeu
const isNightAt = h => h >= 20 || h < 6;
const VILLAGE = V(0.5, 0, 2.5);

/* ---------- état & sauvegarde ---------- */
const SAVE_KEY = 'everisle-save-v1';
const S = {
  wood: 30, stone: 14, iron: 3, food: 6, gold: 250, ess: 0, xp: 2312, lvl: 12, pop: 14, bld: 9, hp: 100, st: 100,
  time: 17, day: 23, mineStone: 26, mineDone: false, builds: [], villagers: [],
  stats: { woodCut: 0, stoneMined: 0, mineDeliver: 0, cabins: 0, berries: 0, kills: 0 }, qdone: {}
};
try {
  const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (d && d.v === 1 && d.S) { const st = { ...S.stats, ...(d.S.stats || {}) }; Object.assign(S, d.S); S.stats = st; S.hp = Math.max(S.hp, 40); }
} catch (e) { }
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, S })); } catch (e) { } }

const xpNeed = l => 1000 + l * 200;
const UNLOCKS = { 13: '🗼 Tour de guet', 14: '🐄 Ferme & élevage', 15: '🔨 Quartier artisanal', 16: '🧺 Marché', 18: '🏹 Poste d\'archers', 20: '🛡️ Murs de pierre', 25: '🗺️ Nouveaux terrains', 30: '⚓ Port' };
const nextUnlock = () => { const k = Object.keys(UNLOCKS).map(Number).find(k => k > S.lvl); return k ? `${UNLOCKS[k]} (Niv. ${k})` : '—'; };
function addXP(n) {
  S.xp += n;
  while (S.xp >= xpNeed(S.lvl)) { S.xp -= xpNeed(S.lvl); S.lvl++; toast('🎉', `Île niveau ${S.lvl} !`, UNLOCKS[S.lvl] ? 'Débloqué : ' + UNLOCKS[S.lvl] : 'Prospérité en hausse'); }
}

/* ---------- toasts / textes flottants / tags ---------- */
const toastQ = []; let toastT = 0;
function toast(face, title, sub = '') { toastQ.push({ face, title, sub }); }
function updateToast(dt) {
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.add('hidden'); return; }
  if (!toastQ.length) return;
  const q = toastQ.shift(), el = $('toast');
  el.innerHTML = `<div class="face">${q.face}</div><div><b>${q.title}</b><small>${q.sub}</small></div>`;
  el.classList.remove('hidden'); toastT = 3.2;
}
const tagsEl = $('tags'), TAGS = [], FLOATS = [];
function addTag(html, target, off = 0, cls = '') { const el = document.createElement('div'); el.className = 'tag ' + cls; el.innerHTML = html; tagsEl.appendChild(el); const t = { el, target, off }; TAGS.push(t); return t; }
function removeTag(t) { const i = TAGS.indexOf(t); if (i >= 0) TAGS.splice(i, 1); t.el.remove(); }
const pv = V();
function screenPos(v) { pv.copy(v).project(camera); return { x: (pv.x * .5 + .5) * W(), y: (-pv.y * .5 + .5) * Hh(), ok: pv.z > -1 && pv.z < 1 && Math.abs(pv.x) < 1.2 && Math.abs(pv.y) < 1.2 }; }
function floatText(txt, pos, color) {
  const el = document.createElement('div'); el.className = 'float'; el.textContent = txt; if (color) el.style.color = color;
  tagsEl.appendChild(el); FLOATS.push({ el, pos: pos.clone(), t: 0 });
}
const tmpV = V();
function updateOverlay(dt) {
  TAGS.forEach(t => {
    if (t.target.isObject3D) { t.target.getWorldPosition(tmpV); tmpV.y += t.off * t.target.scale.y; } else tmpV.copy(t.target);
    const s = screenPos(tmpV); t.el.style.display = s.ok && s.y > Hh() * .2 && s.y < Hh() * .9 && (!t.target.isObject3D || t.target.visible) ? '' : 'none';
    t.el.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-100%)`;
  });
  for (let i = FLOATS.length - 1; i >= 0; i--) {
    const f = FLOATS[i]; f.t += dt; tmpV.copy(f.pos); tmpV.y += f.t * 1.6; const s = screenPos(tmpV);
    f.el.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-100%)`; f.el.style.opacity = String(Math.max(0, 1 - f.t / 1.3));
    if (f.t > 1.3) { f.el.remove(); FLOATS.splice(i, 1); }
  }
}
// les tags utilisent transform : on fixe leur origine en haut à gauche
tagsEl.style.cssText = 'position:absolute;left:0;top:0';

/* ---------- collisions ---------- */
scene.updateMatrixWorld(true);
const wp = (g, lx, lz) => g.localToWorld(V(lx, 0, lz));
const STATIC_COLS = [];
const addCol = (x, z, r) => STATIC_COLS.push({ x, z, r });
[[-1.6, -1], [1.6, -1], [-1.6, 1.1], [1.6, 1.1], [0, -1.6]].forEach(([a, b]) => { const v = wp(mine, a, b); addCol(v.x, v.z, 1.75); });
[[-1.25, 3.55], [1.25, 3.55]].forEach(([a, b]) => { const v = wp(mine, a, b); addCol(v.x, v.z, .3); });
{ const v = new THREE.Vector3(); window._cart.getWorldPosition(v); addCol(v.x, v.z, .95); }
boulder.children.forEach(m => { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); addCol(m.position.x, m.position.z, m.geometry.boundingSphere.radius * m.scale.x * .82); });
{ const v = wp(deck, 0, 0); addCol(v.x, v.z, 2.7); }
{ const v = wp(land, 0, 0); addCol(v.x, v.z, 1.3); const r = wp(land, .5, 1.8); addCol(r.x, r.z, .8); }
{ const v = wp(shed, 0, 0); addCol(v.x, v.z, 2.1); const s2 = wp(shed, 2.4, 1.4); addCol(s2.x, s2.z, .55); }
for (let k = 0; k <= 7; k++) { const v = wp(window._fence, k * .5, 0); addCol(v.x, v.z, .25); }
for (let k = 1; k <= 3; k++) { const v = wp(window._fence, 3.5, -k * .5); addCol(v.x, v.z, .25); }
COTTAGES.forEach(c => addCol(c.position.x, c.position.z, 2.7 * c.scale.x));
const SITES = [], BERRIES = [], MONSTERS = [], ARROWS = [], RESIDENTS = [], FIRES = [];
function collide(p, rad) {
  const test = (x, z, r) => { const dx = p.x - x, dz = p.z - z, m = r + rad; if (Math.abs(dx) > m || Math.abs(dz) > m) return; const d = Math.hypot(dx, dz); if (d < m) { if (d < 1e-4) { p.x += m; return; } p.x = x + dx / d * m; p.z = z + dz / d * m; } };
  for (const c of STATIC_COLS) test(c.x, c.z, c.r);
  for (const t of TREES) if (t.state === 'up' || t.state === 'growing') test(t.x, t.z, .45);
  for (const r of ROCKS) if (r.hp > 0) test(r.x, r.z, r.r);
  for (const s of SITES) test(s.x, s.z, s.r);
  for (const b of BERRIES) test(b.x, b.z, .75);
  p.x = clamp(p.x, -26, 28); p.z = clamp(p.z, -20, 20);
}
function isFree(x, z, R) {
  if (x < -24 || x > 26 || z < -18 || z > 18 || streamD(x, z) < R + 1.6) return false;
  const near = (cx, cz, r) => Math.hypot(cx - x, cz - z) < r + R - .15;
  if (STATIC_COLS.some(c => near(c.x, c.z, c.r))) return false;
  if (TREES.some(t => (t.state === 'up' || t.state === 'growing') && near(t.x, t.z, .45))) return false;
  if (ROCKS.some(r => r.hp > 0 && near(r.x, r.z, r.r))) return false;
  if (SITES.some(s => near(s.x, s.z, s.r))) return false;
  if (BERRIES.some(b => near(b.x, b.z, .75))) return false;
  return true;
}

/* ---------- buissons à baies ---------- */
{
  const berryM = M('#d8263a', { roughness: .35, emissive: '#400010', emissiveIntensity: .3 }), bushM = M('#2f6a26', { roughness: .9 });
  const bushGeo = new THREE.IcosahedronGeometry(.75, 1), berryGeo = new THREE.SphereGeometry(.09, 8, 6);
  [[7.2, 3.6], [-6.4, 6.8], [11.8, 2.2], [4.6, 8.6], [-7.6, -4.6], [13.5, 7.5]].forEach(([x, z]) => {
    const g = new THREE.Group(); g.position.set(x, H(x, z), z); scene.add(g);
    const b = new THREE.Mesh(bushGeo, bushM); b.scale.set(1.2, .8, 1.1); b.position.y = .45; b.castShadow = b.receiveShadow = true; g.add(b);
    const bg = new THREE.Group(); g.add(bg);
    for (let i = 0; i < 12; i++) { const a = rr(0, TAU), e2 = rr(.1, 1.1); const m = new THREE.Mesh(berryGeo, berryM); m.position.set(Math.cos(a) * Math.cos(e2) * .92, .45 + Math.sin(e2) * .62, Math.sin(a) * Math.cos(e2) * .85); bg.add(m); }
    BERRIES.push({ g, berries: bg, x, z, ready: true, t: 0 });
  });
}

/* ---------- mine : amélioration ---------- */
const MINE_PT = new THREE.Vector3(); window._cart.getWorldPosition(MINE_PT);
const mineTag = addTag(`<div class="box build"><b>⛏️ Mine de pierre</b> · <span id="mt-l"></span><small id="mt-s"></small><div class="pb"><i id="mt-b"></i></div></div><div class="arrow"></div>`, V(0.2, 7.2, -1.6), 0, 'build');
function addMineFlag() {
  const f = new THREE.Group(); f.position.set(0, 4.9, 0); tower.add(f);
  cyl(f, .04, .04, 2, woodDark, 0, 1, 0);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.1, .7, 6, 2), M('#e0a32a', { side: THREE.DoubleSide, emissive: '#5a3000', emissiveIntensity: .3 }));
  cloth.position.set(.58, 1.6, 0); f.add(cloth); window._flag = cloth;
}
function updateMineTag() {
  $('mt-l').textContent = S.mineDone ? 'Niv. 3 ✔' : 'Niv. 2 → 3';
  $('mt-s').textContent = S.mineDone ? 'Production de pierre +50 %' : `🪨 ${S.mineStone}/60 · dépose la pierre dans le wagonnet`;
  $('mt-b').style.width = (S.mineStone / 60 * 100) + '%';
}
if (S.mineDone) addMineFlag();

/* ---------- constructions ---------- */
const BUILDS = {
  cabin: { name: 'Cabane', ic: '🏠', cost: { wood: 40, stone: 15 }, r: 2.6, time: 26, xp: 150, th: 6.8, lvl: 1, desc: 'Accueille un nouvel habitant' },
  wall: { name: 'Palissade', ic: '🪵', cost: { wood: 12 }, r: 1.3, time: 9, xp: 30, th: 3.6, lvl: 1, desc: 'Bloque les monstres nocturnes' },
  fire: { name: 'Feu de camp', ic: '🔥', cost: { wood: 8, stone: 4 }, r: 1.0, time: 6, xp: 25, th: 2.6, lvl: 1, desc: 'Éclaire et réchauffe la nuit' },
  tower: { name: 'Tour de guet', ic: '🗼', cost: { wood: 45, stone: 25 }, r: 1.6, time: 30, xp: 180, th: 8.2, lvl: 13, desc: 'Tire sur les monstres la nuit' },
};
const RES_IC = { wood: '🪵', stone: '🪨', iron: '⛓️', food: '🍒', gold: '🪙' };
const ghostMat = new THREE.MeshBasicMaterial({ color: '#6dff8a', transparent: true, opacity: .42, depthWrite: false });
function makeBuild(type, ghost) {
  const g = new THREE.Group(), found = new THREE.Group(), wall = new THREE.Group(), roof = new THREE.Group();
  g.add(found, wall, roof); const ex = {};
  if (type === 'cabin') {
    box(found, 4.2, .4, 3.6, stone, 0, .2, 0);
    wall.position.y = .4;
    box(wall, 3.8, 2.4, 3.2, M('#e8dcc2'), 0, 1.2, 0);
    [-1.85, 1.85].forEach(x => box(wall, .22, 2.4, 3.3, woods[1], x, 1.2, 0));
    box(wall, 3.9, .22, .22, woods[1], 0, 2.3, 1.62);
    box(wall, .9, 1.5, .1, woods[0], 0, .75, 1.62);
    box(wall, .6, .6, .08, WIN_MAT, -1.1, 1.4, 1.63); box(wall, .6, .6, .08, WIN_MAT, 1.1, 1.4, 1.63);
    roof.position.y = 2.8;
    const a = .62, half = 2.3, L = half / Math.cos(a), rise = Math.tan(a) * half, rm = ['#a0563a', '#8e4a32', '#b0644a'].map(c => M(c));
    slope(roof, L, 3.9, rm, 6, 7, -half / 2, rise / 2, 0, a); slope(roof, L, 3.9, rm, 6, 7, half / 2, rise / 2, 0, -a);
    const sh = new THREE.Shape(); sh.moveTo(-1.9, 0); sh.lineTo(1.9, 0); sh.lineTo(0, rise - .1); sh.closePath();
    const gm = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 3.2, bevelEnabled: false }), M('#e8dcc2')); gm.position.set(0, 0, -1.6); gm.castShadow = true; roof.add(gm);
    box(roof, .5, 1.6, .5, stone, 1.1, 1.2, -.6);
  } else if (type === 'wall') {
    box(found, 3.6, .12, .8, M('#8a6a44'), 0, .06, 0);
    for (let i = 0; i < 8; i++) {
      const x = -1.6 + i * .46; cyl(wall, .19, .21, 2.1, pick(woods), x, 1.05, 0, 0, 0, rr(-.03, .03), 8);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(.19, .45, 8), woods[2]); tip.position.set(x, 2.32, 0); tip.castShadow = true; wall.add(tip);
    }
    box(wall, 3.8, .16, .14, woodDark, 0, .7, .22); box(wall, 3.8, .16, .14, woodDark, 0, 1.6, .22);
  } else if (type === 'tower') {
    box(found, 2.6, .3, 2.6, stone, 0, .15, 0);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, z]) => box(wall, .24, 4.2, .24, pick(woods), x, 2.1, z));
    [1.4, 2.8].forEach(y => { box(wall, 2.3, .14, .14, pick(woods), 0, y, 1); box(wall, 2.3, .14, .14, pick(woods), 0, y, -1); box(wall, .14, .14, 2.3, pick(woods), 1, y, 0); box(wall, .14, .14, 2.3, pick(woods), -1, y, 0); });
    box(wall, .12, 3, .12, woods[2], 0, 2.1, 1.02, 0, 0, .7);
    roof.position.y = 4.2;
    for (let i = 0; i < 7; i++) box(roof, .36, .1, 2.6, pick(woods), -1.1 + i * .37, 0, 0);
    [[0, 1.25, true], [0, -1.25, true], [1.25, 0, false], [-1.25, 0, false]].forEach(([x, z, ax]) => box(roof, ax ? 2.6 : .1, .1, ax ? .1 : 2.6, woodLight, x, .8, z));
    [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]].forEach(([x, z]) => box(roof, .12, 1.8, .12, woodDark, x, .9, z));
    plankRoof(roof, 1.8, 3, 7, -.75, 2.1, 0, .55); plankRoof(roof, 1.8, 3, 7, .75, 2.1, 0, -.55);
    if (!ghost) { box(roof, .18, .25, .18, M('#ffcf7a', { emissive: '#ffae3a', emissiveIntensity: 3 }), 1.1, 1.0, 1.3); ex.light = new THREE.PointLight('#ffb050', 0, 12, 2); ex.light.position.set(1.1, 1.0, 1.6); roof.add(ex.light); }
  } else if (type === 'fire') {
    for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; const r = new THREE.Mesh(new THREE.IcosahedronGeometry(.2, 0), stone); r.position.set(Math.cos(a) * .7, .12, Math.sin(a) * .7); r.castShadow = true; found.add(r); }
    for (let i = 0; i < 4; i++) { const ay = i * Math.PI / 2; const l = cyl(wall, .07, .09, 1.1, pick(woods), Math.sin(ay) * .24, .42, Math.cos(ay) * .24); l.rotation.order = 'YXZ'; l.rotation.set(-.5, ay, 0); }
    if (!ghost) {
      const fm = new THREE.Mesh(new THREE.ConeGeometry(.32, 1.0, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.7, .4) })); fm.position.y = .75; roof.add(fm);
      const fi = new THREE.Mesh(new THREE.ConeGeometry(.18, .6, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4, 1.2) })); fi.position.y = .62; roof.add(fi);
      ex.flame = fm; ex.flame2 = fi; ex.light = new THREE.PointLight('#ff9a40', 0, 11, 2); ex.light.position.y = 1.2; roof.add(ex.light);
    }
  }
  if (ghost) g.traverse(o => { if (o.isMesh) { o.material = ghostMat; o.castShadow = o.receiveShadow = false; } });
  return { g, found, wall, roof, roofY: roof.position.y, ...ex };
}
function addScaffold(s) {
  const h = { cabin: 4.8, wall: 2.6, tower: 5.6, fire: 0 }[s.type]; if (!h) return;
  const sc2 = new THREE.Group(), R = s.r * .82; s.g.add(sc2); s.scaf = sc2;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => cyl(sc2, .05, .05, h, woodLight, a * R, h / 2, b * R * (s.type === 'wall' ? .35 : 1)));
  for (let y = 1.2; y < h; y += 1.4) { box(sc2, R * 2, .06, .06, woodLight, 0, y, R * (s.type === 'wall' ? .35 : 1)); box(sc2, .06, .06, R * 2 * (s.type === 'wall' ? .35 : 1), woodLight, R, y, 0); }
  const pile = new THREE.Group(); pile.position.set(s.r + .6, 0, .4); s.g.add(pile); s.pile = pile;
  for (let i = 0; i < 4; i++) box(pile, 1.4, .12, .26, pick(woods), 0, .08 + i * .13, (i % 2) * .1 - .05, 0, rr(-.1, .1), 0);
  rock(pile, .22, .1, .2, .7, [1, .8, 1], 0, .3); rock(pile, .2, -.35, .18, .75, [1, .8, 1], 0, .3);
}
function applySite(s) {
  const k = s.p;
  s.found.scale.y = Math.max(.05, sstep(0, .1, k));
  s.wall.visible = k > .1; s.wall.scale.y = Math.max(.001, sstep(.1, .68, k));
  const kr = sstep(.68, 1, k); s.roof.visible = k > .68; s.roof.scale.setScalar(Math.max(.001, kr)); s.roof.position.y = s.roofY + (1 - kr) * 1.6;
  if (s.pile) s.pile.scale.setScalar(Math.max(.001, 1 - sstep(0, .95, k)));
}
function createSite(type, x, z, ry, instant) {
  const def = BUILDS[type], b = makeBuild(type, false);
  b.g.position.set(x, H(x, z), z); b.g.rotation.y = ry; scene.add(b.g);
  const s = { type, def, ...b, x, z, ry, r: def.r, p: instant ? 1 : 0, done: false, cd: 0 };
  SITES.push(s);
  { const hi = GRASS_HOLES.value.findIndex(h => h.z === 0); if (hi >= 0) GRASS_HOLES.value[hi].set(x, z, def.r * (type === 'wall' ? .55 : .95)); }
  if (!instant) {
    addScaffold(s);
    s.tag = addTag(`<div class="box build"><b>🏗️ ${def.name}</b><small class="st">Le constructeur arrive…</small><div class="pb"><i style="width:0%"></i></div></div><div class="arrow"></div>`, V(x, H(x, z) + def.th, z), 0, 'build');
  }
  applySite(s); if (instant) finishSite(s, true);
  drawMinimapBuilds();
  return s;
}
const RES_NAMES = [['Oswin', 'Menuisier', '🪚', '#8a6a3a'], ['Mira', 'Fermière', '🌾', '#7a9a3a'], ['Elsa', 'Forgeronne', '⚒️', '#5a5a6a'], ['Tilo', 'Pêcheur', '🎣', '#3a6a9a'], ['Nora', 'Cueilleuse', '🧺', '#9a5a7a'], ['Fenn', 'Chasseur nocturne', '🏹', '#3a3a5a'], ['Ida', 'Alchimiste', '🧪', '#6a3a8a'], ['Jory', 'Tailleur', '🧵', '#aa7a3a']];
function finishSite(s, silent) {
  s.done = true; s.p = 1; applySite(s);
  if (s.scaf) { s.g.remove(s.scaf); s.scaf = null; } if (s.pile) { s.g.remove(s.pile); s.pile = null; }
  if (s.tag) { removeTag(s.tag); s.tag = null; }
  if (s.type === 'fire') FIRES.push(s);
  if (silent) return;
  S.bld++; addXP(s.def.xp); S.builds.push({ type: s.type, x: s.x, z: s.z, ry: s.ry });
  floatText(`+${s.def.xp} XP`, V(s.x, H(s.x, s.z) + 3, s.z), '#9fe8ff');
  if (s.type === 'cabin') {
    S.stats.cabins++;
    const info = RES_NAMES[S.villagers.length % RES_NAMES.length];
    const rec = { name: info[0], job: info[1], ic: info[2], color: info[3], hx: s.x, hz: s.z };
    S.villagers.push(rec); S.pop++;
    spawnResident(rec, s, true);
    toast(info[2], `Nouvel habitant ! ${info[0]} (${info[1]})`, 'Il arrive pour s\'installer dans la cabane');
  } else toast(s.def.ic, `${s.def.name} terminé(e) !`, `+${s.def.xp} XP pour l'île`);
  checkQuests(); save();
}
function homeDoor(s) { return V(s.x + Math.sin(s.ry) * (s.r + 1), 0, s.z + Math.cos(s.ry) * (s.r + 1)); }
function spawnResident(rec, site, walkIn) {
  const d = homeDoor(site);
  const v = place(villager({ shirt: rec.color, pants: '#4a3a2c', hair: pick(['#2a1a10', '#6a3a1a', '#c88a3a', '#1a120c']), dress: /e$/.test(rec.job.split(' ')[0]), anim: 'walk' }), walkIn ? -11 : d.x, walkIn ? 17 : d.z, 0);
  const r = { v, rec, site, state: walkIn ? 'arrive' : 'wander', wp: d.clone(), t: 0 };
  r.tag = addTag(`<div class="box">${rec.name}<small>${rec.ic} ${rec.job}</small></div>`, v, 1.75);
  RESIDENTS.push(r);
}
// restauration de la sauvegarde
S.builds.forEach(b => createSite(b.type, b.x, b.z, b.ry, true));
S.villagers.forEach(rec => { const s = SITES.find(x => x.done && x.type === 'cabin' && Math.abs(x.x - rec.hx) < .01 && Math.abs(x.z - rec.hz) < .01); if (s) spawnResident(rec, s, false); });

/* ---------- placement ---------- */
let buildMode = null, ghost = null, ghostRot = 0, ghostOK = false;
const ghostPos = V();
function canAfford(def) { return Object.entries(def.cost).every(([k, v]) => S[k] >= v); }
function renderBuildMenu() {
  $('bmenu').innerHTML = '<h5>Construire · les villageois bâtissent pour toi</h5>' + Object.entries(BUILDS).map(([k, d]) => {
    const locked = S.lvl < d.lvl, ok = !locked && canAfford(d);
    const cost = locked ? `<span class="miss">🔒 Île Niv. ${d.lvl}</span>` : Object.entries(d.cost).map(([r, v]) => `<span class="${S[r] < v ? 'miss' : ''}">${RES_IC[r]} ${v}</span>`).join(' ');
    return `<div class="bcard tap ${ok ? '' : 'no'}" data-b="${k}"><span class="ic">${d.ic}</span><b>${d.name}</b>${d.desc}<br><span class="cost">${cost}</span></div>`;
  }).join('');
}
function toggleBuild() {
  if (buildMode) { cancelBuild(); return; }
  closeModal();
  const m = $('bmenu'); if (m.classList.contains('hidden')) { renderBuildMenu(); m.classList.remove('hidden'); } else m.classList.add('hidden');
}
$('bmenu').addEventListener('click', e => {
  const c = e.target.closest('.bcard'); if (!c) return;
  const type = c.dataset.b, def = BUILDS[type];
  if (S.lvl < def.lvl) { toast('🔒', `${def.name} : île niveau ${def.lvl} requis`); return; }
  if (!canAfford(def)) { toast('🪵', 'Ressources insuffisantes', Object.entries(def.cost).map(([r, v]) => `${RES_IC[r]} ${v}`).join('  ')); return; }
  $('bmenu').classList.add('hidden'); startPlacement(type);
});
function startPlacement(type) {
  buildMode = type; ghost = makeBuild(type, true).g; scene.add(ghost); ghostRot = player.rotation.y;
  $('b-cancel').classList.remove('hidden'); $('b-rot').classList.remove('hidden'); $('b-build').classList.add('hidden'); $('b-village').classList.add('hidden');
}
function cancelBuild() {
  if (ghost) scene.remove(ghost); ghost = null; buildMode = null;
  $('b-cancel').classList.add('hidden'); $('b-rot').classList.add('hidden'); $('b-build').classList.remove('hidden'); $('b-village').classList.remove('hidden');
}
function updateGhost() {
  if (!ghost) return;
  const def = BUILDS[buildMode], d = def.r + 1.8, f = player.rotation.y;
  ghostPos.set(player.position.x + Math.sin(f) * d, 0, player.position.z + Math.cos(f) * d);
  ghostPos.y = H(ghostPos.x, ghostPos.z);
  ghost.position.copy(ghostPos); ghost.rotation.y = ghostRot;
  ghostOK = isFree(ghostPos.x, ghostPos.z, def.r) && Math.hypot(ghostPos.x - player.position.x, ghostPos.z - player.position.z) > def.r + .3;
  ghostMat.color.set(ghostOK ? '#6dff8a' : '#ff5a4a');
}
function placeBuild() {
  const def = BUILDS[buildMode];
  if (!ghostOK) { toast('⚠️', 'Emplacement impossible', 'Trouve un terrain dégagé (pas d\'arbre, de rocher ni d\'eau)'); return; }
  if (!canAfford(def)) { toast('🪵', 'Ressources insuffisantes'); cancelBuild(); return; }
  Object.entries(def.cost).forEach(([r, v]) => S[r] -= v);
  createSite(buildMode, ghostPos.x, ghostPos.z, ghostRot, false);
  toast('🏗️', `Chantier : ${def.name}`, 'Bram le constructeur va chercher les matériaux');
  cancelBuild(); save();
}

/* ---------- monstres ---------- */
const monGeo = new THREE.SphereGeometry(.55, 18, 14), eyeGeo = new THREE.SphereGeometry(.075, 8, 6), hornGeo = new THREE.ConeGeometry(.09, .3, 6);
const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, .8, 1.8) });
function spawnMonster() {
  for (let tries = 0; tries < 12; tries++) {
    const a = rr(0, TAU), x = clamp(VILLAGE.x + Math.cos(a) * rr(17, 22), -25, 27), z = clamp(VILLAGE.z + Math.sin(a) * rr(14, 18), -19, 19);
    if (streamD(x, z) < 3 || Math.hypot(x - player.position.x, z - player.position.z) < 9) continue;
    const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: '#2b1a3d', roughness: .35, emissive: '#3a1060', emissiveIntensity: .5 });
    const body = new THREE.Mesh(monGeo, mat); body.castShadow = true; g.add(body);
    [-.17, .17].forEach(ex => { const e = new THREE.Mesh(eyeGeo, eyeMat); e.position.set(ex, .12, .48); body.add(e); const h = new THREE.Mesh(hornGeo, mat); h.position.set(ex * 1.8, .5, 0); h.rotation.z = -ex * 2.5; body.add(h); });
    g.position.set(x, H(x, z), z); g.scale.setScalar(.01); scene.add(g);
    g.userData = { hp: 4, cd: 0, hurt: 0, age: 0, dead: false, dt: 0, body, mat, ph: rr(0, 6), kb: V() };
    MONSTERS.push(g); return;
  }
}
function hurtMonster(m, dmg, from) {
  const u = m.userData; if (u.dead) return;
  u.hp -= dmg; u.hurt = .18;
  u.kb.set(m.position.x - from.x, 0, m.position.z - from.z).normalize().multiplyScalar(1.6);
  if (u.hp <= 0) {
    u.dead = true; u.dt = 0; S.ess++; S.gold += 5; S.stats.kills++; addXP(20);
    floatText('+1 ✨ +5 🪙', m.position.clone().setY(m.position.y + 1.4), '#d9b3ff'); checkQuests();
  }
}
let shakeT = 0, deathT = 0;
function damagePlayer(n) {
  if (S.hp <= 0) return;
  S.hp = Math.max(0, S.hp - n); $('hurt').style.opacity = '1'; shakeT = .25;
  floatText('-' + n, player.position.clone().setY(player.position.y + 2.2), '#ff6a5a');
  if (S.hp <= 0) { deathT = 2.5; toast('💫', 'Tu t\'es évanoui…', 'Lyra te ramène au village'); }
}
let spawnT = 3;
function monstersAI(dt, t, night) {
  if (night) { spawnT -= dt; const max = 4 + Math.floor(S.lvl / 6); if (spawnT <= 0 && MONSTERS.filter(m => !m.userData.dead).length < max) { spawnMonster(); spawnT = rr(4, 7); } }
  for (let i = MONSTERS.length - 1; i >= 0; i--) {
    const m = MONSTERS[i], u = m.userData;
    if (u.dead) { u.dt += dt; m.scale.setScalar(Math.max(.001, 1 - u.dt / .45)); m.position.y += dt * 1.5; if (u.dt >= .45) { scene.remove(m); u.mat.dispose(); MONSTERS.splice(i, 1); } continue; }
    if (!night) { u.dead = true; u.dt = 0; continue; }
    u.age += dt; u.cd -= dt; u.hurt -= dt;
    if (u.age < .6) m.scale.setScalar(Math.max(.01, u.age / .6)); else m.scale.setScalar(1);
    const chase = S.hp > 0 && m.position.distanceTo(player.position) < 16;
    const tgt = chase ? player.position : VILLAGE;
    const dx = tgt.x - m.position.x, dz = tgt.z - m.position.z, d = Math.hypot(dx, dz);
    if (d > 1.15) { const sp = (chase ? 2.6 : 1.6) * dt; m.position.x += dx / d * sp; m.position.z += dz / d * sp; }
    else if (chase && u.cd <= 0) { u.cd = 1.3; damagePlayer(7); }
    m.position.addScaledVector(u.kb, dt * 6); u.kb.multiplyScalar(Math.max(0, 1 - dt * 7));
    collide(m.position, .5);
    m.position.y = Math.max(H(m.position.x, m.position.z), -1.05);
    m.rotation.y = lerpAng(m.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-dt * 8));
    const hop = Math.abs(Math.sin(t * 6 + u.ph)); u.body.position.y = .5 + hop * .32; u.body.scale.set(1 + (1 - hop) * .12, .8 + hop * .15, 1 + (1 - hop) * .12);
    u.mat.emissive.set(u.hurt > 0 ? '#ff2020' : '#3a1060'); u.mat.emissiveIntensity = u.hurt > 0 ? 2 : .5;
  }
}
const arrowGeo = new THREE.CylinderGeometry(.03, .03, .8, 4); arrowGeo.rotateX(Math.PI / 2);
const arrowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.2) });
function shootArrow(from, target, dmg) { const m = new THREE.Mesh(arrowGeo, arrowMat); m.position.copy(from); scene.add(m); ARROWS.push({ m, from: from.clone(), target, dmg, t: 0, dur: Math.max(.15, from.distanceTo(target.position) / 22) }); }
function arrowsAI(dt) {
  for (let i = ARROWS.length - 1; i >= 0; i--) {
    const a = ARROWS[i]; a.t += dt; const k = Math.min(1, a.t / a.dur);
    const pos = a.from.clone().lerp(tmpV.copy(a.target.position).setY(a.target.position.y + .5), k); pos.y += Math.sin(k * Math.PI) * 1.1;
    a.m.lookAt(pos); a.m.position.copy(pos);
    if (k >= 1) { scene.remove(a.m); ARROWS.splice(i, 1); if (!a.target.userData.dead) hurtMonster(a.target, a.dmg, a.from); }
  }
}
function nearestMonster(p, maxD) { let best = null, bd = maxD; MONSTERS.forEach(m => { if (m.userData.dead || m.userData.age < .6) return; const d = m.position.distanceTo(p); if (d < bd) { bd = d; best = m; } }); return best; }
function towersAI(dt, night) {
  SITES.forEach(s => {
    if (!s.done || s.type !== 'tower') return;
    if (s.light) s.light.intensity = night ? 7 : 0;
    s.cd -= dt; if (!night || s.cd > 0) return;
    const top = V(s.x, H(s.x, s.z) + 5.4, s.z), m = nearestMonster(top, 14);
    if (m) { s.cd = 1.6; shootArrow(top, m, 1); }
  });
}

/* ---------- PNJ ---------- */
function walkTo(c, tx, tz, speed, dt) {
  const p = c.position, u = c.userData, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
  if (d < .25) { u.stuck = 0; return true; }
  const st = Math.min(d, speed * dt), ox = p.x, oz = p.z;
  p.x += dx / d * st; p.z += dz / d * st;
  if (u.ghostT > 0) { u.ghostT -= dt; p.x = clamp(p.x, -26, 28); p.z = clamp(p.z, -20, 20); } else collide(p, .35);
  if (Math.hypot(p.x - ox, p.z - oz) < st * .3) { u.stuck = (u.stuck || 0) + dt; if (u.stuck > 1.2) { u.ghostT = 1.5; u.stuck = 0; } } else u.stuck = 0;
  p.y = Math.max(H(p.x, p.z), -1.05) + (u.yOff || 0);
  c.rotation.y = lerpAng(c.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10));
  return false;
}
const BUILDER_HOME = V(8.8, 0, .8);
function builderAI(dt) {
  const u = builder.userData, site = SITES.find(s => !s.done);
  if (!site) { u.anim = walkTo(builder, BUILDER_HOME.x, BUILDER_HOME.z, 3.4, dt) ? 'idle' : 'walk'; return; }
  if (!site.bp) { const a = Math.atan2(builder.position.x - site.x, builder.position.z - site.z); site.bp = V(site.x + Math.sin(a) * (site.r + .9), 0, site.z + Math.cos(a) * (site.r + .9)); }
  const close = Math.hypot(builder.position.x - site.x, builder.position.z - site.z) < site.r + 1.5;
  const arrived = walkTo(builder, site.bp.x, site.bp.z, 3.8, dt) || close;
  if (arrived) {
    u.anim = 'mine'; builder.rotation.y = lerpAng(builder.rotation.y, Math.atan2(site.x - builder.position.x, site.z - builder.position.z), .2);
    site.p = Math.min(1, site.p + dt / site.def.time); applySite(site);
    if (site.tag) { site.tag.el.querySelector('.st').textContent = `👷 Bram construit… ${Math.floor(site.p * 100)} %`; site.tag.el.querySelector('.pb i').style.width = (site.p * 100) + '%'; }
    if (site.p >= 1) finishSite(site);
  } else u.anim = 'walk';
}
const CARRY_PTS = [wp(shed, 2.6, 0.6), V(-3.6, 0, 5.4), wp(mine, 1.9, 5.6)];
const CR = { i: 1, dir: 1, wait: 0 };
function carrierAI(dt) {
  const u = carrier.userData;
  if (CR.wait > 0) { CR.wait -= dt; u.anim = 'idle'; return; }
  const p = CARRY_PTS[CR.i];
  if (walkTo(carrier, p.x, p.z, 2.4, dt)) {
    if (CR.i === 0 || CR.i === CARRY_PTS.length - 1) { CR.wait = 1.6; CR.dir *= -1; }
    CR.i += CR.dir;
  }
  u.anim = 'walk';
}
const LY = { wp: V(12, 0, 6), t: 0, cd: 0, mode: '' };
function lyraAI(dt, night) {
  const u = lyra.userData; LY.cd -= dt;
  const foe = nearestMonster(lyra.position, 20);
  let mode;
  if (foe) {
    mode = 'Défend le village';
    const d = foe.position.distanceTo(lyra.position);
    if (d > 7) { u.anim = 'walk'; walkTo(lyra, foe.position.x, foe.position.z, 5.2, dt); }
    else { u.anim = 'idle'; lyra.rotation.y = lerpAng(lyra.rotation.y, Math.atan2(foe.position.x - lyra.position.x, foe.position.z - lyra.position.z), .3); if (LY.cd <= 0) { LY.cd = 1.4; u.shoot = .35; shootArrow(lyra.position.clone().setY(lyra.position.y + 1.3), foe, 1); } }
  } else if (night) {
    mode = 'Monte la garde';
    const tx = player.position.x + 1.8, tz = player.position.z + 1.8;
    u.anim = Math.hypot(lyra.position.x - tx, lyra.position.z - tz) > 1 ? (walkTo(lyra, tx, tz, 5.5, dt), 'walk') : 'idle';
  } else {
    mode = 'Chasse en prairie';
    if (LY.t > 0) { LY.t -= dt; u.anim = 'idle'; }
    else if (walkTo(lyra, LY.wp.x, LY.wp.z, 2.6, dt)) { LY.t = rr(2, 5); LY.wp.set(rr(6, 20), 0, rr(1, 16)); u.anim = 'idle'; }
    else u.anim = 'walk';
  }
  if (mode !== LY.mode) { LY.mode = mode; $('ly-s').textContent = 'Duo · ' + mode; }
}
function residentsAI(dt, night) {
  RESIDENTS.forEach(r => {
    const u = r.v.userData, door = homeDoor(r.site);
    if (r.state === 'arrive') { if (walkTo(r.v, door.x, door.z, 3, dt)) { r.state = 'wander'; r.t = 2; } u.anim = 'walk'; return; }
    if (night) { u.anim = walkTo(r.v, door.x, door.z, 3, dt) ? 'idle' : 'walk'; return; }   // à l'abri la nuit
    if (r.t > 0) { r.t -= dt; u.anim = 'idle'; return; }
    if (walkTo(r.v, r.wp.x, r.wp.z, 1.8, dt)) { r.t = rr(2, 6); for (let k = 0; k < 6; k++) { const x = door.x + rr(-4, 4), z = door.z + rr(-4, 4); if (isFree(x, z, .4)) { r.wp.set(x, 0, z); break; } } u.anim = 'idle'; }
    else u.anim = 'walk';
  });
}

/* ---------- récolte ---------- */
const tm4 = new THREE.Matrix4(), tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion(), ts = V(), tAxis = V();
function setTree(t, extraQ, k = 1, stump = false) {
  tq.copy(t.q); if (extraQ) tq.premultiply(extraQ);
  ts.copy(t.s).multiplyScalar(k); tm4.compose(t.p, tq, ts); t.im.setMatrixAt(t.i, tm4); t.im.instanceMatrix.needsUpdate = true;
  if (stump) { ts.copy(t.s); ts.y *= .3; tm4.compose(t.p, t.q, ts); }
  else { ts.copy(t.s).multiplyScalar(Math.max(k, .001)); tm4.compose(t.p, tq, ts); }
  t.trunks.setMatrixAt(t.ti, tm4); t.trunks.instanceMatrix.needsUpdate = true;
}
function updateTrees(dt) {
  for (const t of TREES) {
    if (t.state === 'up' && t.shake > 0) { t.shake -= dt; const a = Math.sin(t.shake * 60) * t.shake * .25; tq2.setFromAxisAngle(tAxis.set(1, 0, 0), a); setTree(t, tq2); if (t.shake <= 0) setTree(t); }
    else if (t.state === 'falling') {
      t.t += dt; const k = Math.min(1, t.t / 1.0);
      tq2.setFromAxisAngle(tAxis.set(t.fdz, 0, -t.fdx), k * k * Math.PI * .48);
      if (t.t < 1.6) setTree(t, tq2, 1, true); else { t.state = 'gone'; t.t = 0; setTree(t, null, .0001, true); }
    } else if (t.state === 'gone') { t.t += dt; if (t.t > 60) { t.state = 'growing'; t.t = 0; t.hp = 4; } }
    else if (t.state === 'growing') { t.t += dt; const k = Math.min(1, t.t / 4); setTree(t, null, .1 + .9 * (1 - Math.pow(1 - k, 3))); if (k >= 1) t.state = 'up'; }
  }
}
function updateResources(dt) {
  ROCKS.forEach(r => {
    if (r.shake > 0) { r.shake -= dt; r.mesh.position.x = r.x + Math.sin(r.shake * 80) * r.shake * .3; if (r.shake <= 0) r.mesh.position.x = r.x; }
    if (r.hp <= 0) { r.t += dt; if (r.t > 45) { r.hp = 4; r.t = 0; r.mesh.visible = true; r.mesh.scale.copy(r.base); } }
  });
  BERRIES.forEach(b => { if (!b.ready) { b.t += dt; if (b.t > 35) { b.ready = true; b.berries.visible = true; } } });
}
function gain(res, n, pos, ic) { S[res] += n; floatText(`+${n} ${ic}`, pos); }
let curTarget = null, actCD = 0, actHeld = false;
function findTarget() {
  const p = player.position; let best = null, bd = 1e9;
  const cand = (obj, d, type) => { if (d < bd) { bd = d; best = { obj, type }; } };
  for (const m of MONSTERS) { if (m.userData.dead) continue; const d = m.position.distanceTo(p); if (d < 2.6) cand(m, d - 10, 'monster'); }
  for (const t of TREES) { if (t.state !== 'up') continue; const dx = t.x - p.x, dz = t.z - p.z; if (Math.abs(dx) > 2.2 || Math.abs(dz) > 2.2) continue; const d = Math.hypot(dx, dz); if (d < 1.85) cand(t, d, 'tree'); }
  for (const r of ROCKS) { if (r.hp <= 0) continue; const d = Math.hypot(r.x - p.x, r.z - p.z) - r.r; if (d < 1.4) cand(r, d, 'rock'); }
  for (const b of BERRIES) { if (!b.ready) continue; const d = Math.hypot(b.x - p.x, b.z - p.z) - .75; if (d < 1.3) cand(b, d, 'berry'); }
  for (const s of SITES) { if (s.done) continue; const d = Math.hypot(s.x - p.x, s.z - p.z) - s.r; if (d < 1.5) cand(s, d, 'site'); }
  if (!S.mineDone) { const d = Math.hypot(MINE_PT.x - p.x, MINE_PT.z - p.z); if (d < 2.9) cand(null, d, 'mine'); }
  return best;
}
const ACT = { tree: ['🪓', 'Couper', 1], rock: ['⛏️', 'Miner', 0], berry: ['🍒', 'Cueillir', 5], monster: ['🗡️', 'Attaquer', 2], site: ['🔨', 'Aider', 0], mine: ['🪨', 'Livrer', 0] };
function targetPos(tg) {
  if (!tg) return null;
  switch (tg.type) {
    case 'tree': return V(tg.obj.x, H(tg.obj.x, tg.obj.z) + 2.4, tg.obj.z);
    case 'rock': return V(tg.obj.x, H(tg.obj.x, tg.obj.z) + 1.2, tg.obj.z);
    case 'berry': return V(tg.obj.x, H(tg.obj.x, tg.obj.z) + 1.6, tg.obj.z);
    case 'monster': return tg.obj.position.clone().setY(tg.obj.position.y + 1.6);
    case 'site': return null;
    case 'mine': return V(MINE_PT.x, MINE_PT.y + 1.6, MINE_PT.z);
  }
}
function doAction() {
  if (buildMode) { placeBuild(); return; }
  if (S.hp <= 0 || actCD > 0) return;
  const tg = curTarget; if (!tg) return;
  if (S.st < 4) { floatText('😮‍💨 Fatigué', player.position.clone().setY(player.position.y + 2.4), '#ffe08a'); actCD = .5; return; }
  actCD = .42; S.st -= 4; player.userData.swing = .35;
  const tp = targetPos(tg) || V(tg.obj.x, 0, tg.obj.z);
  player.rotation.y = Math.atan2(tp.x - player.position.x, tp.z - player.position.z);
  useSlot(ACT[tg.type][2], true);
  const o = tg.obj;
  switch (tg.type) {
    case 'tree': {
      o.hp--; o.shake = .3; gain('wood', 2, tp, '🪵'); S.stats.woodCut += 2; addXP(4);
      if (o.hp <= 0) { o.state = 'falling'; o.t = 0; const dx = o.x - player.position.x, dz = o.z - player.position.z, l = Math.hypot(dx, dz) || 1; o.fdx = dx / l; o.fdz = dz / l; S.wood += 4; S.stats.woodCut += 4; addXP(10); floatText('+4 🪵 Timber !', tp.clone().setY(tp.y + .8), '#ffd08a'); }
      break;
    }
    case 'rock': {
      o.hp--; o.shake = .25; gain('stone', S.mineDone ? 3 : 2, tp, '🪨'); S.stats.stoneMined += S.mineDone ? 3 : 2; addXP(4);
      if (rand() < .22) { S.iron++; floatText('+1 ⛓️ Fer', tp.clone().setY(tp.y + .6), '#cfe0ff'); }
      if (o.hp <= 0) { o.mesh.visible = false; o.t = 0; } else o.mesh.scale.copy(o.base).multiplyScalar(.55 + o.hp / 4 * .45);
      break;
    }
    case 'berry': { o.ready = false; o.t = 0; o.berries.visible = false; gain('food', 3, tp, '🍒'); S.stats.berries++; addXP(5); break; }
    case 'monster': hurtMonster(o, 1, player.position); break;
    case 'site': o.p = Math.min(1, o.p + .05); applySite(o); addXP(3); floatText('🔨 +5 %', V(o.x, H(o.x, o.z) + 2.5, o.z)); if (o.p >= 1) finishSite(o); break;
    case 'mine': {
      const amt = Math.min(10, S.stone, 60 - S.mineStone);
      if (amt <= 0) { floatText('Pas de pierre 🪨', tp, '#ff9a8a'); break; }
      S.stone -= amt; S.mineStone += amt; S.stats.mineDeliver += amt; addXP(amt * 3); floatText(`-${amt} 🪨 livrées`, tp);
      if (S.mineStone >= 60) { S.mineDone = true; addXP(250); addMineFlag(); toast('⛏️', 'Mine de pierre niveau 3 !', 'Chaque coup de pioche rapporte +50 % de pierre'); }
      updateMineTag(); break;
    }
  }
  checkQuests();
}

/* ---------- quêtes ---------- */
const QUESTS = [
  { id: 'wood', ic: '🪓', txt: 'Couper du bois', goal: 20, key: 'woodCut', xp: 80, gold: 50 },
  { id: 'berry', ic: '🍒', txt: 'Cueillir des baies', goal: 4, key: 'berries', xp: 40, gold: 20 },
  { id: 'stone', ic: '⛏️', txt: 'Miner de la pierre', goal: 16, key: 'stoneMined', xp: 80, gold: 50 },
  { id: 'cabin', ic: '🏠', txt: 'Faire bâtir une cabane', goal: 1, key: 'cabins', xp: 150, gold: 80 },
  { id: 'mine', ic: '🏗️', txt: 'Améliorer la mine (livrer 🪨)', goal: 34, key: 'mineDeliver', xp: 200, gold: 120 },
  { id: 'night', ic: '🌙', txt: 'Vaincre des ombres nocturnes', goal: 3, key: 'kills', xp: 150, gold: 100 },
];
let questSig = '';
function renderQuests() {
  const sig = QUESTS.map(q => (S.qdone[q.id] ? 'd' : Math.min(S.stats[q.key], q.goal))).join(',');
  if (sig === questSig) return; questSig = sig;
  const act = QUESTS.filter(q => !S.qdone[q.id]).slice(0, 4), done = QUESTS.filter(q => S.qdone[q.id]).slice(-1);
  $('qlist').innerHTML = act.map(q => { const v = Math.min(S.stats[q.key], q.goal); return `<div class="q"><div class="ic">${q.ic}</div><div style="flex:1">${q.txt} <b style="color:var(--gold)">${v}/${q.goal}</b><div class="mini"><i style="width:${v / q.goal * 100}%"></i></div></div></div>`; }).join('')
    + done.map(q => `<div class="q done"><div class="ic">✔️</div><div>${q.txt}</div></div>`).join('')
    + (act.length ? '' : '<div class="q"><div class="ic">⭐</div><div>Tous les objectifs sont faits ! Agrandis ton village.</div></div>');
  $('qcount').textContent = `${Object.keys(S.qdone).length}/${QUESTS.length}`;
}
function checkQuests() {
  QUESTS.forEach(q => { if (!S.qdone[q.id] && S.stats[q.key] >= q.goal) { S.qdone[q.id] = true; S.gold += q.gold; addXP(q.xp); toast('📜', 'Objectif accompli : ' + q.txt, `+${q.xp} XP · +${q.gold} 🪙`); } });
  renderQuests();
}

/* ---------- jour / nuit ---------- */
const DC = { sunDay: col('#fff0d6'), sunSet: col('#ff9a4a'), skyD: col('#cfe6ff'), skyN: col('#33467a'), gndD: col('#4a4a22'), gndN: col('#161a2a'), fogD: col('#a9b98a'), fogS: col('#caa070'), fogN: col('#1b2338') };
const moon = new THREE.DirectionalLight(col('#8aa6ff'), 0); scene.add(moon, moon.target);
let nightK = 0, wasNight = isNightAt(S.time);
const camTarget = player.position.clone();
function updateDay(dt) {
  S.time += dt * 24 / DAY_LEN; if (S.time >= 24) { S.time -= 24; S.day++; }
  const h = S.time, ph = (h - 6) / 12 * Math.PI, el = Math.sin(ph);
  const dayF = sstep(-.12, .22, el); nightK = 1 - dayF;
  const sunset = sstep(.45, .05, el) * dayF;
  sun.intensity = 3.5 * dayF; sun.color.copy(DC.sunDay).lerp(DC.sunSet, sunset);
  sun.target.position.set(camTarget.x, 0, camTarget.z - 2);
  sun.position.set(sun.target.position.x - Math.cos(ph) * 30, 8 + Math.max(el, 0) * 32, sun.target.position.z + 16);
  moon.intensity = .9 * nightK; moon.target.position.copy(sun.target.position); moon.position.copy(sun.target.position).add(tmpV.set(18, 30, 12));
  hemi.intensity = .62 * (.5 + .5 * dayF); hemi.color.copy(DC.skyN).lerp(DC.skyD, dayF); hemi.groundColor.copy(DC.gndN).lerp(DC.gndD, dayF);
  scene.fog.color.copy(DC.fogN).lerp(DC.fogD, dayF).lerp(DC.fogS, sunset * .5); scene.background.copy(scene.fog.color);
  fill.intensity = .45 * dayF;
  WIN_MAT.emissiveIntensity = 1.2 + nightK * 2.6;
  grade.uniforms.uNight.value = nightK;
  window._pollen.material.color.set(nightK > .5 ? '#c8ff7a' : '#ffe0a0'); window._pollen.material.size = .32 + nightK * .25;
  const night = isNightAt(h);
  if (night !== wasNight) {
    wasNight = night;
    if (night) toast('🌙', 'La nuit tombe…', 'Des ombres sortent de la forêt. Les habitants rentrent chez eux.');
    else { toast('☀️', `Jour ${S.day} — l'aube se lève`, 'Les ombres se dissipent.'); addXP(30); }
  }
  return night;
}
const pad = n => String(n).padStart(2, '0');
function hud() {
  $('r-wood').textContent = fmt(S.wood); $('r-stone').textContent = fmt(S.stone); $('r-iron').textContent = fmt(S.iron); $('r-food').textContent = fmt(S.food); $('r-gold').textContent = fmt(S.gold);
  $('food-c').textContent = fmt(S.food);
  $('lvl').textContent = S.lvl; $('lvlt').textContent = 'Île Niv. ' + S.lvl;
  $('xpb').style.width = Math.min(100, S.xp / xpNeed(S.lvl) * 100) + '%';
  $('xpt').textContent = `${fmt(S.xp)} / ${fmt(xpNeed(S.lvl))} XP · Prochain : ${nextUnlock()}`;
  $('pop').textContent = `👥 ${S.pop} habitants`; $('bld').textContent = `🏠 ${S.bld} bâtiments`; $('ess').textContent = `✨ ${S.ess} essences`;
  $('hp1').style.width = S.hp + '%'; $('st1').style.width = S.st + '%';
  const h = S.time, night = isNightAt(h), hh = Math.floor(h), mm = Math.floor((h % 1) * 60);
  $('clk').textContent = `${night ? '🌙' : '☀️'} ${pad(hh)}:${pad(mm)}`;
  $('dayl').textContent = `Jour ${S.day} · Été`;
  const until = night ? ((6 - h + 24) % 24) : (20 - h), uh = Math.floor(until), um = Math.floor((until % 1) * 60);
  $('nightl').textContent = night ? `⚠️ Monstres actifs · aube dans ${uh}h${pad(um)}` : `🌙 Nuit dans ${uh}h${pad(um)}`;
  const mp = (x, z) => [52 + x * .85, 52 + z * .85];
  const [px, pz] = mp(player.position.x, player.position.z); $('mmP').setAttribute('cx', px); $('mmP').setAttribute('cy', pz);
  const [lx, lz] = mp(lyra.position.x, lyra.position.z); $('mmL').setAttribute('cx', lx); $('mmL').setAttribute('cy', lz);
  $('mmMon').innerHTML = MONSTERS.filter(m => !m.userData.dead).map(m => { const [x, z] = mp(m.position.x, m.position.z); return `<circle cx="${x}" cy="${z}" r="1.8" fill="#ff3d7a"/>`; }).join('');
}
function drawMinimapBuilds() { $('mmBuilds').innerHTML = SITES.map(s => `<rect x="${52 + s.x * .85 - 1.6}" y="${52 + s.z * .85 - 1.6}" width="3.2" height="3.2" fill="${s.done ? '#9b6a43' : '#ffcf5a'}"/>`).join(''); }

/* ---------- entrées ---------- */
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true; if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') { e.preventDefault(); actHeld = true; doAction(); }
  else if (e.code === 'KeyB') toggleBuild();
  else if (e.code === 'KeyR' && buildMode) ghostRot += Math.PI / 4;
  else if (e.code === 'Escape') { cancelBuild(); closeModal(); $('bmenu').classList.add('hidden'); }
  else if (/^Digit[1-7]$/.test(e.code)) useSlot(+e.code.slice(5) - 1);
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') actHeld = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; actHeld = false; joyEnd(); });
const joy = $('joy'), knob = $('knob'), joyV = { x: 0, y: 0 }; let joyId = null;
function joyMove(e) {
  const r = joy.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const R = r.width * .4, d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d; }
  joyV.x = dx / R; joyV.y = dy / R; knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}
function joyEnd(e) { if (e && e.pointerId !== joyId) return; joyId = null; joyV.x = joyV.y = 0; knob.style.transform = 'translate(-50%,-50%)'; }
joy.addEventListener('pointerdown', e => { e.preventDefault(); joyId = e.pointerId; try { joy.setPointerCapture(e.pointerId); } catch (_) { } joyMove(e); });
joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e); });
joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd); joy.addEventListener('lostpointercapture', joyEnd);
const act = $('act');
act.addEventListener('pointerdown', e => { e.preventDefault(); actHeld = true; doAction(); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => act.addEventListener(ev, () => { actHeld = false; }));
$('b-build').addEventListener('click', toggleBuild);
$('b-cancel').addEventListener('click', cancelBuild);
$('b-rot').addEventListener('click', () => { ghostRot += Math.PI / 4; });
let slot = 0;
function useSlot(i, silent) {
  slot = i; document.querySelectorAll('.slot').forEach(s => s.classList.toggle('sel', +s.dataset.i === i));
  if (silent) return;
  if (i === 5) { if (S.food >= 2 && S.hp < 100) { S.food -= 2; S.hp = Math.min(100, S.hp + 20); S.st = Math.min(100, S.st + 30); floatText('+20 ❤️', player.position.clone().setY(player.position.y + 2.3), '#9fff8a'); } else if (S.food < 2) toast('🍒', 'Plus de baies', 'Cueille des buissons rouges'); }
  if (i === 6) toast('🧪', 'Potions', 'L\'alchimiste les fabriquera quand tu l\'auras recruté');
}
$('hotbar').addEventListener('click', e => { const s = e.target.closest('.slot'); if (s) useSlot(+s.dataset.i); });
function openModal(title, html) { $('bmenu').classList.add('hidden'); $('mtitle').textContent = title; $('mbody').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); }
$('mclose').addEventListener('click', closeModal);
$('b-bag').addEventListener('click', () => openModal('🎒 Sac & réserves de l\'île', `<div class="grid">${[['🪵', 'Bois', S.wood], ['🪨', 'Pierre', S.stone], ['⛓️', 'Fer', S.iron], ['🍒', 'Baies', S.food], ['🪙', 'Pièces', S.gold], ['✨', 'Essence d\'ombre', S.ess], ['🏹', 'Flèches', 42], ['🧪', 'Potions', 3]].map(([i, n, v]) => `<div class="cell"><b>${i}</b>${n}<br><span style="color:var(--gold)">${fmt(v)}</span></div>`).join('')}</div><p style="margin-top:1.4vh;opacity:.8">Les ressources sont partagées avec Lyra : tout ce que vous récoltez sert au village commun.</p>`));
$('b-village').addEventListener('click', () => {
  const base = [['⛏️', 'Brune', 'Mineuse ★★★', 'Extrait la pierre du rocher'], ['⛏️', 'Tobin', 'Mineur ★★', 'Travaille sur l\'échafaudage'], ['🛡️', 'Pip', 'Garde', 'Se repose avant sa ronde'], ['📦', 'Aldo', 'Transporteur', 'Porte le bois du dépôt à la mine'], ['🔨', 'Bram', 'Constructeur ★★', SITES.some(s => !s.done) ? 'Sur un chantier' : 'Attend un plan de construction']];
  const res = S.villagers.map(v => [v.ic, v.name, v.job, 'Vit dans sa cabane']);
  openModal(`🏘️ Village · ${S.pop} habitants`, [...base, ...res].map(([f, n, j, s]) => `<div class="vrow"><span class="f">${f}</span><div><b>${n}</b> — ${j}<small>${s}</small></div></div>`).join('') + `<p style="margin-top:1.2vh;opacity:.8">${Math.max(0, S.pop - base.length - res.length)} autres habitants vivent dans les maisons du village. Construis des cabanes pour en attirer de nouveaux.</p>`);
});
const openDuo = () => openModal('💬 Duo avec Lyra', `<p>Lyra joue avec toi sur la même île : elle chasse en prairie le jour et défend le village la nuit avec son arc.</p><p style="margin-top:1vh">L'île, le village, les villageois et les ressources sont communs ; chacun garde son personnage, son niveau et son équipement.</p><p style="margin-top:1vh;color:var(--gold)">Dans cette version, Lyra est contrôlée par le jeu. Le duo en ligne (deux téléphones) arrive dans la prochaine étape.</p>`);
$('b-duo').addEventListener('click', openDuo); $('p2card').addEventListener('click', openDuo);
// zoom : molette & pincement
let zoom = 1; const pinch = new Map(); let pinchD = 0;
renderer.domElement.addEventListener('wheel', e => { zoom = clamp(zoom + Math.sign(e.deltaY) * .08, .6, 1.35); }, { passive: true });
renderer.domElement.addEventListener('pointerdown', e => { pinch.set(e.pointerId, e); if (MOBILE && document.fullscreenElement == null && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => { }); });
renderer.domElement.addEventListener('pointermove', e => {
  if (!pinch.has(e.pointerId)) return; pinch.set(e.pointerId, e);
  if (pinch.size === 2) { const [a, b] = [...pinch.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (pinchD) zoom = clamp(zoom * pinchD / d, .6, 1.35); pinchD = d; }
});
['pointerup', 'pointercancel'].forEach(ev => renderer.domElement.addEventListener(ev, e => { pinch.delete(e.pointerId); pinchD = 0; }));

/* ---------- animation des personnages ---------- */
function animChar(c, t, dt) {
  const u = c.userData, ph = t + u.ph; let la = 0, ra = 0, ll = 0, lr = 0, bx = 0, rz = 0;
  if (u.anim === 'mine') { const s = Math.sin(ph * 4.2); ra = -1.6 - s; la = -1.2 - s * .6; bx = s * .06; }
  else if (u.anim === 'walk') { const s = Math.sin(ph * 9); ll = s * .6; lr = -s * .6; la = -s * .5; ra = s * .5; }
  else if (u.anim === 'rest') { rz = .5; u.head.rotation.z = Math.sin(t * .7) * .1; }
  else { const s = Math.sin(ph * 1.6); la = s * .05; ra = -s * .05; bx = s * .015; }
  if (u.carry) la = ra = -1.3;
  if (u.swing > 0) { u.swing -= dt; const k = 1 - Math.max(0, u.swing) / .35; ra = -2.8 + Math.sin(k * Math.PI * .5) * 2.3; bx = .12 * Math.sin(k * Math.PI); }
  if (u.shoot > 0) { u.shoot -= dt; la = -1.5; ra = -1.4; }
  u.aL.rotation.x = la; u.aR.rotation.x = ra; u.aR.rotation.z = rz; u.legL.rotation.x = ll; u.legR.rotation.x = lr; u.body.rotation.x = bx;
  if (u.ring) u.ring.material.opacity = .6 + Math.sin(t * 3) * .25;
}

/* ---------- joueur & caméra ---------- */
let facing = player.rotation.y;
function updatePlayer(dt, night) {
  let mx = joyV.x, mz = joyV.y;
  if (keys.KeyW || keys.ArrowUp) mz -= 1; if (keys.KeyS || keys.ArrowDown) mz += 1; if (keys.KeyA || keys.ArrowLeft) mx -= 1; if (keys.KeyD || keys.ArrowRight) mx += 1;
  const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
  const u = player.userData, pp = player.position;
  if (deathT > 0) {
    deathT -= dt; u.anim = 'idle'; player.rotation.z = Math.min(1.4, player.rotation.z + dt * 3);
    if (deathT <= 0) { player.rotation.z = 0; pp.set(-1.9, 0, 3.8); S.hp = 60; S.st = 100; }
  } else if (Math.hypot(mx, mz) > .08) {
    const sp = 6.2 * (streamD(pp.x, pp.z) < 2 ? .55 : 1);
    pp.x += mx * sp * dt; pp.z += mz * sp * dt; facing = Math.atan2(mx, mz); u.anim = 'walk';
  } else u.anim = 'idle';
  collide(pp, .42);
  pp.y = Math.max(H(pp.x, pp.z), -1.05);
  if (Math.hypot(mx, mz) > .08) player.rotation.y = lerpAng(player.rotation.y, facing, 1 - Math.exp(-dt * 14));
  S.st = Math.min(100, S.st + dt * 10);
  if (deathT <= 0) S.hp = Math.min(100, S.hp + dt * (night ? .4 : 1.5));
}
const CAM_OFF = V(0.2, 21, 19.5), LOOK_OFF = V(0, .8, -1.2), lookV = V();
function updateCamera(dt) {
  camTarget.lerp(player.position, 1 - Math.exp(-dt * 5));
  camera.position.copy(camTarget).addScaledVector(CAM_OFF, zoom);
  if (shakeT > 0) { shakeT -= dt; camera.position.x += (Math.random() - .5) * shakeT * 1.2; camera.position.y += (Math.random() - .5) * shakeT * 1.2; }
  camera.lookAt(lookV.copy(camTarget).add(LOOK_OFF));
}

/* ---------- boucle ---------- */
const clock = new THREE.Clock(); let hudT = 0, saveT = 0, lastAct = '', errShown = false;
const marker = $('marker');
updateMineTag(); renderQuests(); hud(); drawMinimapBuilds();
let simT = 0;
function loop() {
  requestAnimationFrame(loop);
  try {
    const dt = Math.min(clock.getDelta(), .1); simT += dt;
    tick(dt, simT);
    composer.render();
  } catch (err) { if (!errShown) { errShown = true; console.error(err); } }
}
function tick(dt, t) {
  {
    uTime.value = t; window._water.uniforms.uTime.value = t; grade.uniforms.uTime.value = t;
    const night = updateDay(dt);
    updatePlayer(dt, night);
    updateTrees(dt); updateResources(dt);
    builderAI(dt); carrierAI(dt); lyraAI(dt, night); residentsAI(dt, night);
    monstersAI(dt, t, night); towersAI(dt, night); arrowsAI(dt);
    chars.forEach(c => animChar(c, t, dt));
    FIRES.forEach(f => { const k = 1 + Math.sin(t * 13 + f.x) * .08 + Math.sin(t * 29) * .05; f.flame.scale.set(1, k, 1); f.flame2.scale.set(1, 2 - k, 1); f.light.intensity = (3 + nightK * 9) * k; });
    if (window._flag) window._flag.rotation.y = Math.sin(t * 2) * .25;
    window._rope.rotation.z = Math.sin(t * .9) * .05; window._rope.rotation.x = Math.sin(t * .7) * .03;
    window._lantern.intensity = (4 + nightK * 6) + Math.sin(t * 9) * .4 + Math.sin(t * 23) * .3;
    window._pollen.position.y = Math.sin(t * .6) * .15;
    actCD -= dt; if (actHeld && !buildMode && actCD <= 0) doAction();
    curTarget = buildMode ? null : findTarget();
    const a = buildMode ? ['✔️', 'Placer'] : curTarget ? ACT[curTarget.type] : ['✋', 'Action'];
    const sig = a[0] + a[1];
    if (sig !== lastAct) { lastAct = sig; $('act-i').textContent = a[0]; $('act-l').textContent = a[1]; act.classList.toggle('pulse', !!curTarget || !!buildMode); }
    updateGhost(); updateCamera(dt);
    const mp = buildMode ? null : (curTarget && curTarget.type === 'site' ? V(curTarget.obj.x, H(curTarget.obj.x, curTarget.obj.z) + curTarget.obj.def.th - 1.4, curTarget.obj.z) : targetPos(curTarget));
    if (mp) { const s = screenPos(mp); marker.style.display = s.ok ? 'block' : 'none'; marker.style.left = s.x + 'px'; marker.style.top = s.y + 'px'; } else marker.style.display = 'none';
    updateOverlay(dt); updateToast(dt);
    const hurtEl = $('hurt'), ho = parseFloat(hurtEl.style.opacity || 0); if (ho > 0) hurtEl.style.opacity = String(Math.max(0, ho - dt * 2.5));
    hudT -= dt; if (hudT <= 0) { hudT = .2; hud(); renderQuests(); if (!$('bmenu').classList.contains('hidden')) renderBuildMenu(); }
    saveT -= dt; if (saveT <= 0) { saveT = 5; save(); }
  }
}
loop();
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
setTimeout(() => { toast('🏝️', 'Bienvenue sur Everisle !', 'Coupe du bois, mine de la pierre et fais grandir ton village avec Lyra.'); }, 600);
setTimeout(() => { const l = $('loading'); if (l) { l.style.opacity = 0; setTimeout(() => l.remove(), 700); } }, 300);
window._ready = true;
window.__game = { step: (sec) => { for (let i = 0; i < sec * 20; i++) { simT += .05; tick(.05, simT); } }, keysDown: keys, joyV, S, player, MONSTERS, SITES, TREES, ROCKS, BERRIES, startPlacement, placeBuild, doAction, findTarget, keys, setTime: h => { S.time = h; } };


initNative();
