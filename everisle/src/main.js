import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import { initNative } from './native.js';
import Peer from 'peerjs';

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
  if (o.tool === 'pick') { const t = new THREE.Group(); t.position.set(0, -.38, 0); aR.add(t); cyl(t, .025, .025, .8, woodLight, 0, 0, .28, Math.PI / 2); const hd = box(t, .5, .07, .07, M('#9aa3ad', { metalness: .6, roughness: .4 }), 0, 0, .66); hd.rotation.y = 0; g.userData.toolHead = hd; }
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
  for (let i = 0; i < 9; i++) { const rad = rr(.25, .55), x = rr(-5, 10), z = rr(-3, 3.5); rock(scene, rad, x, H(x, z) + .05, z, [1, .75, 1], 1, .4); }
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
const PLAYER_U = { value: new THREE.Vector3(999, 0, 999) };
foliageMat.onBeforeCompile = s => {
  s.uniforms.uTime = uTime; s.uniforms.uPlayer = PLAYER_U;
  s.fragmentShader = s.fragmentShader.replace('void main() {', `varying float vFade;
void main() {
  if (vFade > .5) { float dd = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453); if (dd > .35) discard; }`);
  s.vertexShader = 'uniform float uTime;\nuniform vec3 uPlayer;\nvarying float vFade;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vFade = 0.;
    #ifdef USE_INSTANCING
    vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
    float dzp = ip.y - uPlayer.z;
    if (dzp > .3 && dzp < 14. && abs(ip.x - uPlayer.x) < 4.5 + dzp * .15) vFade = 1.;
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
  if (x > 30 && z > -10 && z < 16) continue;            // prairie de l'Est
  if (x > -5 && x < 13 && z < -23 && z > -33) continue;  // clairière de cristal
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
  scene.add(im); (window._deco = window._deco || []).push(im);
}

/* ---------- grass (instanced, wind shader) ---------- */
// masque d'herbe : l'herbe disparaît sous les bâtiments et les routes
const MASK = { x0: -34, z0: -40, w: 84, d: 68, n: 256 };
const GRASS_MASK = new THREE.DataTexture(new Uint8Array(MASK.n * MASK.n), MASK.n, MASK.n, THREE.RedFormat);
GRASS_MASK.magFilter = GRASS_MASK.minFilter = THREE.NearestFilter; GRASS_MASK.needsUpdate = true;
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
    s.uniforms.uMask = { value: GRASS_MASK };
    s.vertexShader = 'uniform float uTime;\nuniform sampler2D uMask;\nattribute float aH;\nvarying float vH;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vH = aH;
      vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      if (texture2D(uMask, (ip - vec2(-34.0, -40.0)) / vec2(84.0, 68.0)).r > .5) transformed *= 0.;
      float w = sin(uTime*1.6 + ip.x*.35 + ip.y*.22) + .5*sin(uTime*2.9 + ip.x*.9 - ip.y*.4);
      transformed.x += w * .12 * aH * aH;
      transformed.z += w * .07 * aH * aH;`);
    s.fragmentShader = 'varying float vH;\n' + s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= mix(.32, 1.25, vH);`);
  };
  const N = MOBILE ? 85000 : 150000, im = new THREE.InstancedMesh(bg, mat, N); im.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const gA = col('#4f8a2a'), gB = col('#8cbc3a'), gC = col('#c6c75a');
  let n = 0;
  for (let i = 0; i < N * 3 && n < N; i++) {
    let x, z; if (rand() < .72) { x = rr(-30, 32); z = rr(-24, 24); } else { x = rr(-30, 46); z = rr(-38, 24); if (x < 32 && z > -24) continue; }
    const d = dirt(x, z);
    if (d > .2 + rand() * .5) continue;
    if (streamD(x, z) < 1.8 || blocked(x, z)) continue;
    const meadow = sstep(3, 9, x) * sstep(0, 6, z);
    const hgt = rr(.25, .55) * (1 + meadow * .45) * (1 - d * .8) * (1 + (fbm(x * .2, z * .2) - .4));
    p.set(x, H(x, z) - .03, z); e.set(rr(-.25, .25), rr(0, 6.28), rr(-.25, .25)); q.setFromEuler(e); s.set(rr(.8, 1.4), hgt, 1);
    m4.compose(p, q, s); im.setMatrixAt(n, m4);
    c.copy(gA).lerp(gB, rand()).lerp(gC, Math.pow(rand(), 5) * .8 + meadow * .1); c.multiplyScalar(rr(.85, 1.1)); im.setColorAt(n, c); n++;
  }
  im.count = n; scene.add(im); window._grass = im; im.userData.full = n;
}

/* ---------- flowers / mushrooms ---------- */
function scatterInst(geo, mat, count, place) {
  const im = new THREE.InstancedMesh(geo, mat, count); im.castShadow = true; im.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  let n = 0; for (let i = 0; i < count * 6 && n < count; i++) { const r = place(p, q, s, c); if (!r) continue; m4.compose(p, q, s); im.setMatrixAt(n, m4); im.setColorAt(n, c); n++; }
  im.count = n; scene.add(im); (window._deco = window._deco || []).push(im); return im;
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
const kaelC = place(villager({ shirt: '#3d7fa8', pants: '#3a3a44', hair: '#2b1d14', pack: true, tool: 'pick', ring: '#4fe0d0', anim: 'idle', scale: 1.3 }), -1.9, 3.8, 2.6);
const lyra = place(villager({ shirt: '#a8452f', pants: '#4b3b2b', hair: '#7a3a1a', bun: true, tool: 'bow', pack: true, ring: '#ff9b4a', anim: 'walk', scale: 1.3 }), 9.5, 5.5, -2.2);
let player = kaelC, mate = lyra;
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
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY_LEN = 300;                       // secondes réelles pour 24 h de jeu
const isNightAt = h => h >= 20 || h < 6;
const VILLAGE = V(3, 0, 7);
// générateur déterministe : le monde est identique sur les deux téléphones
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const wr = mulberry(9001), wrr = (a, b) => a + wr() * (b - a);

/* ---------- état partagé (île) & personnel (joueur) ---------- */
const SAVE_KEY = 'everisle-save-v1';
const S = {
  v: 2, wood: 30, stone: 14, iron: 3, plank: 0, food: 8, leather: 0, crystal: 0, gold: 250, ess: 0,
  xp: 2312, lvl: 12, pop: 14, bld: 9, time: 17, day: 23, mineStone: 26, mineDone: false, hungry: false,
  builds: [], villagers: [], nextId: 100, started: false,
  stats: { woodCut: 0, stoneMined: 0, mineDeliver: 0, cabins: 0, berries: 0, kills: 0, deer: 0, fish: 0, planks: 0, upgrades: 0, farms: 0, bosses: 0 }, qdone: {}
};
const ME = { name: 'Kael', lvl: 14, xp: 0, hp: 100, st: 100 };
const LABEL2JOB = { 'Menuisier': 'carpenter', 'Fermière': 'farmer', 'Forgeronne': 'miner', 'Pêcheur': 'fisher', 'Cueilleuse': 'gatherer', 'Chasseur nocturne': 'hunter', 'Alchimiste': 'gatherer', 'Tailleur': 'lumber' };
const TRAITS = ['Travailleur', 'Joyeux', 'Courageux', 'Rêveur', 'Curieux', 'Grincheux'];
let loadedV1 = false;
try {
  const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (d && d.S) {
    const st = { ...S.stats, ...(d.S.stats || {}) };
    if (d.S.hp != null) { ME.hp = d.S.hp; ME.st = d.S.st; delete d.S.hp; delete d.S.st; }
    Object.assign(S, d.S); S.stats = st; if (d.me) Object.assign(ME, d.me);
    ME.hp = Math.max(ME.hp, 40);
    if (!d.S.v || d.S.v < 2) loadedV1 = true;
  }
} catch (e) { }
const maxHP = () => 100 + (ME.lvl - 14) * 5;
let NET_ROLE = 'solo';
function save() { if (NET_ROLE === 'guest') { try { const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (d) { d.me = ME; localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } } catch (e) { } return; } try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 2, S, me: ME })); } catch (e) { } }

const xpNeed = l => 1000 + l * 200;
const UNLOCKS = { 13: '🧺 Marché & 🗼 tour de guet', 14: '🗺️ Prairie de l\'Est', 15: '🧱 Mur de pierre', 16: '💎 Collines de cristal', 18: '🏠 Demeures', 20: '🏰 Village fortifié', 25: '⚓ Port (bientôt)' };
const nextUnlock = () => { const k = Object.keys(UNLOCKS).map(Number).find(k => k > S.lvl); return k ? `${UNLOCKS[k]} (Niv. ${k})` : '—'; };
function addXP(n) {
  S.xp += n;
  while (S.xp >= xpNeed(S.lvl)) { S.xp -= xpNeed(S.lvl); S.lvl++; sfx('level'); if (typeof banner === 'function' && window._ready) { banner(`Île niveau ${S.lvl} !`, UNLOCKS[S.lvl] ? 'Débloqué : ' + UNLOCKS[S.lvl] : 'Prospérité en hausse', '🏝️'); burst(player.position.clone().setY(player.position.y + 1.5), FX.gold, 50, { speed: 5, up: 6, life: 1.4 }); } worldToast('🎉', `Île niveau ${S.lvl} !`, UNLOCKS[S.lvl] ? 'Débloqué : ' + UNLOCKS[S.lvl] : 'Prospérité en hausse'); }
}
function gainMe(n) {
  ME.xp += n;
  const need = () => 200 + ME.lvl * 60;
  while (ME.xp >= need()) { ME.xp -= need(); ME.lvl++; ME.hp = maxHP(); toast('⭐', `${ME.name} passe niveau ${ME.lvl} !`, '+5 points de vie max'); }
}

/* ---------- toasts / textes flottants / tags ---------- */
const toastQ = []; let toastT = 0;
function toast(face, title, sub = '') { toastQ.push({ face, title, sub }); }
function worldToast(face, title, sub = '') { toast(face, title, sub); netEvent({ t: 'toast', face, title, sub }); }
function updateToast(dt) {
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.add('hidden'); return; }
  if (!toastQ.length) return;
  const q = toastQ.shift(), el = $('toast');
  el.innerHTML = `<div class="face">${q.face}</div><div><b>${esc(q.title)}</b><small>${esc(q.sub)}</small></div>`;
  el.classList.remove('hidden'); toastT = 3.2;
}
const tagsEl = $('tags'), TAGS = [], FLOATS = [];
tagsEl.style.cssText = 'position:absolute;left:0;top:0';
function addTag(html, target, off = 0, cls = '') { const el = document.createElement('div'); el.className = 'tag ' + cls; el.innerHTML = html; tagsEl.appendChild(el); const t = { el, target, off, near: / near/.test(' ' + cls) }; TAGS.push(t); return t; }
function removeTag(t) { if (!t) return; const i = TAGS.indexOf(t); if (i >= 0) TAGS.splice(i, 1); t.el.remove(); }
const pv = V();
function screenPos(v) { pv.copy(v).project(camera); return { x: (pv.x * .5 + .5) * W(), y: (-pv.y * .5 + .5) * Hh(), ok: pv.z > -1 && pv.z < 1 && Math.abs(pv.x) < 1.2 && Math.abs(pv.y) < 1.2 }; }
function floatText(txt, pos, color, share = true) {
  const el = document.createElement('div'); el.className = 'float'; el.textContent = txt; if (color) el.style.color = color;
  tagsEl.appendChild(el); FLOATS.push({ el, pos: pos.clone(), t: 0 });
  if (share) netEvent({ t: 'fx', txt, p: [pos.x, pos.y, pos.z], c: color || '' });
}
const tmpV = V();
function updateOverlay(dt) {
  TAGS.forEach(t => {
    if (t.target.isObject3D) { t.target.getWorldPosition(tmpV); tmpV.y += t.off * t.target.scale.y; } else tmpV.copy(t.target);
    const s = screenPos(tmpV);
    const far = t.near && Math.hypot(tmpV.x - player.position.x, tmpV.z - player.position.z) > 11;
    t.el.style.display = !far && s.ok && s.y > Hh() * .2 && s.y < Hh() * .9 && (!t.target.isObject3D || t.target.visible) ? '' : 'none';
    t.el.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-100%)`;
  });
  for (let i = FLOATS.length - 1; i >= 0; i--) {
    const f = FLOATS[i]; f.t += dt; tmpV.copy(f.pos); tmpV.y += f.t * 1.6; const s = screenPos(tmpV);
    f.el.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-100%)`; f.el.style.opacity = String(Math.max(0, 1 - f.t / 1.3));
    if (f.t > 1.3) { f.el.remove(); FLOATS.splice(i, 1); }
  }
}

/* ---------- limites de l'île & territoires ---------- */
const BOUNDS = { x0: -26, x1: 28, z0: -20, z1: 20 };
const REGIONS = [
  { id: 'east', name: 'Prairie de l\'Est', lvl: 14, desc: 'Des cerfs, des baies et de l\'espace pour bâtir', a: [28.5, -20], b: [28.5, 20], open: false, apply: () => { BOUNDS.x1 = 42; } },
  { id: 'north', name: 'Collines de cristal', lvl: 16, desc: 'Des cristaux rares affleurent dans la roche', a: [-26, -20.5], b: [28.5, -20.5], open: false, apply: () => { BOUNDS.z0 = -33; } },
];
const barrierMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: { uTime: uTime, uFade: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform float uTime, uFade; varying vec2 vUv;
    void main(){ float h=vUv.y; float s=.5+.5*sin(vUv.x*60.-uTime*2.+sin(h*8.+uTime)*2.);
      vec3 c=mix(vec3(.45,.3,1.),vec3(.3,.9,1.),s); float a=(1.-h)*(1.-h)*(.25+.35*s)*uFade;
      a+=smoothstep(.97,1.,1.-abs(h-.02)*10.)*.4*uFade; gl_FragColor=vec4(c*a,a); }`
});
function makeBarrier(reg) {
  const [ax, az] = reg.a, [bx, bz] = reg.b, len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len);
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) { const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = H(x, z) - .3; pos.push(x, y, z, x, y + 6, z); uv.push(t * len / 8, 0, t * len / 8, 1); if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  reg.mat = barrierMat.clone(); reg.mat.uniforms.uTime = uTime;
  reg.mesh = new THREE.Mesh(g, reg.mat); scene.add(reg.mesh);
  const mx = (ax + bx) / 2, mz = (az + bz) / 2, lx = reg.id === 'east' ? mx : 2, lz = reg.id === 'east' ? 4 : mz;
  reg.tag = addTag(`<div class="box build">🔒 <b>${reg.name}</b><small>Débloqué au niveau ${reg.lvl} de l'île</small></div>`, V(lx, H(lx, lz) + 4, lz), 0, 'build');
}
REGIONS.forEach(makeBarrier);
function updateRegions(dt, silent) {
  REGIONS.forEach(r => {
    if (!r.open && S.lvl >= r.lvl) {
      r.open = true; r.apply(); removeTag(r.tag); r.tag = null; r.fadeT = silent ? 0 : 1.5;
      if (silent) { scene.remove(r.mesh); r.mesh = null; } else banner(`Nouveau territoire : ${r.name}`, r.desc, '🗺️');
    }
    if (r.mesh && r.open) { r.fadeT -= dt; r.mat.uniforms.uFade.value = Math.max(0, r.fadeT / 1.5); if (r.fadeT <= 0) { scene.remove(r.mesh); r.mesh = null; } }
  });
}

/* ---------- masque d'herbe ---------- */
function paintMask(x, z, R, square) {
  const d = GRASS_MASK.image.data, n = MASK.n, sx2 = n / MASK.w, sz2 = n / MASK.d;
  const c0 = Math.floor((x - R - MASK.x0) * sx2), c1 = Math.ceil((x + R - MASK.x0) * sx2), r0 = Math.floor((z - R - MASK.z0) * sz2), r1 = Math.ceil((z + R - MASK.z0) * sz2);
  for (let r = Math.max(0, r0); r <= Math.min(n - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(n - 1, c1); c++) {
    const wx = MASK.x0 + (c + .5) / sx2, wz = MASK.z0 + (r + .5) / sz2;
    if (square ? (Math.abs(wx - x) <= R && Math.abs(wz - z) <= R) : Math.hypot(wx - x, wz - z) <= R) d[r * n + c] = 255;
  }
}
function repaintMask() { repaintMaskAll(); }
function repaintMaskOld() { GRASS_MASK.image.data.fill(0); SITES.forEach(s => { if (s.def.mask !== false) paintMask(s.x, s.z, s.def.maskR != null ? s.def.maskR * (s.scale || 1) : s.r * .95, s.type === 'path'); }); GRASS_MASK.needsUpdate = true; }

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
const SITES = [], BERRIES = [], MONSTERS = [], ARROWS = [], RESIDENTS = [], FIRES = [], DEER = [];
function collide(p, rad) {
  const test = (x, z, r) => { const dx = p.x - x, dz = p.z - z, m = r + rad; if (Math.abs(dx) > m || Math.abs(dz) > m) return; const d = Math.hypot(dx, dz); if (d < m) { if (d < 1e-4) { p.x += m; return; } p.x = x + dx / d * m; p.z = z + dz / d * m; } };
  for (const c of STATIC_COLS) test(c.x, c.z, c.r);
  for (const t of TREES) if (t.state === 'up' || t.state === 'growing') test(t.x, t.z, .45);
  for (const r of ROCKS) if (r.hp > 0) test(r.x, r.z, r.r);
  for (const s of SITES) if (!s.def.walk) test(s.x, s.z, s.r);
  for (const b of BERRIES) test(b.x, b.z, .75);
  p.x = clamp(p.x, BOUNDS.x0, BOUNDS.x1); p.z = clamp(p.z, BOUNDS.z0, BOUNDS.z1);
}
function isFree(x, z, R, ignore) {
  if (x < BOUNDS.x0 + 1 || x > BOUNDS.x1 - 1 || z < BOUNDS.z0 + 1 || z > BOUNDS.z1 - 1 || streamD(x, z) < R + 1.6) return false;
  const near = (cx, cz, r) => Math.hypot(cx - x, cz - z) < r + R - .15;
  if (STATIC_COLS.some(c => near(c.x, c.z, c.r))) return false;
  if (TREES.some(t => (t.state === 'up' || t.state === 'growing') && near(t.x, t.z, .45))) return false;
  if (ROCKS.some(r => r.hp > 0 && near(r.x, r.z, r.r))) return false;
  if (SITES.some(s => s !== ignore && near(s.x, s.z, s.r))) return false;
  if (BERRIES.some(b => near(b.x, b.z, .75))) return false;
  return true;
}

/* ---------- buissons à baies ---------- */
{
  const berryM = M('#d8263a', { roughness: .35, emissive: '#400010', emissiveIntensity: .3 }), bushM = M('#2f6a26', { roughness: .9 });
  const bushGeo = new THREE.IcosahedronGeometry(.75, 1), berryGeo = new THREE.SphereGeometry(.09, 8, 6);
  [[6.2, 2.6], [-8.6, 8.8], [17, 1.2], [20, 4], [-7.6, -4.6], [16, 13.5], [33, 2], [37.5, 9], [35, -5]].forEach(([x, z]) => {
    const g = new THREE.Group(); g.position.set(x, H(x, z), z); scene.add(g);
    const b = new THREE.Mesh(bushGeo, bushM); b.scale.set(1.2, .8, 1.1); b.position.y = .45; b.castShadow = b.receiveShadow = true; g.add(b);
    const bg = new THREE.Group(); g.add(bg);
    for (let i = 0; i < 12; i++) { const a = wrr(0, TAU), e2 = wrr(.1, 1.1); const m = new THREE.Mesh(berryGeo, berryM); m.position.set(Math.cos(a) * Math.cos(e2) * .92, .45 + Math.sin(e2) * .62, Math.sin(a) * Math.cos(e2) * .85); bg.add(m); }
    BERRIES.push({ g, berries: bg, x, z, ready: true, t: 0 });
  });
}
/* ---------- cristaux (collines du nord) ---------- */
{
  const cm = new THREE.MeshStandardMaterial({ color: '#8ff0ff', emissive: '#2fb8ff', emissiveIntensity: 1.4, roughness: .15, metalness: .1, flatShading: true });
  const geo = new THREE.OctahedronGeometry(.35, 0); geo.scale(.6, 1.8, .6);
  for (let i = 0, n = 0; i < 60 && n < 9; i++) {
    const x = wrr(-4, 12), z = wrr(-31, -23);
    if (ROCKS.some(r => Math.hypot(r.x - x, r.z - z) < 2.6) || TREES.some(t => Math.hypot(t.x - x, t.z - z) < 1.6)) continue;
    const g = new THREE.Group(); g.position.set(x, H(x, z), z); scene.add(g);
    rock(g, .55, 0, .2, 0, [1, .6, 1], 1, .4, ['#5a5a7a', '#9a9ab8']);
    for (let k = 0; k < 5; k++) { const c = new THREE.Mesh(geo, cm); c.position.set(wrr(-.35, .35), .55, wrr(-.35, .35)); c.rotation.set(wrr(-.5, .5), wrr(0, 3), wrr(-.5, .5)); c.scale.setScalar(wrr(.7, 1.3)); c.castShadow = true; g.add(c); }
    ROCKS.push({ mesh: g, x, z, r: .8, hp: 5, max: 5, t: 0, base: g.scale.clone(), kind: 'crystal' }); n++;
  }
}
ROCKS.forEach(r => { if (!r.max) r.max = 4; });

/* ---------- faune : cerfs ---------- */
const DEER_ZONES = [{ x0: 9, x1: 21, z0: 3, z1: 15 }, { x0: 31, x1: 40, z0: -8, z1: 13 }];
function makeDeer() {
  const g = new THREE.Group(), fur = M('#9a6a3e'), dark = M('#5e3d22'), white = M('#efe6d8');
  const body = new THREE.Mesh(new THREE.SphereGeometry(.5, 14, 10), fur); body.scale.set(.75, .75, 1.45); body.position.y = 1.15; body.castShadow = true; g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(.45, 12, 8), white); belly.scale.set(.62, .5, 1.2); belly.position.y = 1.0; g.add(belly);
  const neck = cyl(g, .12, .17, .75, fur, 0, 1.55, .55, .55); neck.castShadow = true;
  const head = new THREE.Group(); head.position.set(0, 1.9, .82); g.add(head);
  const hm = new THREE.Mesh(new THREE.SphereGeometry(.19, 12, 10), fur); hm.scale.set(.85, .85, 1.35); head.add(hm);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(.06, 8, 6), M('#2a1a10')); nose.position.set(0, -.02, .25); head.add(nose);
  [-1, 1].forEach(s => {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(.07, .22, 6), fur); ear.position.set(s * .15, .14, -.05); ear.rotation.z = -s * .9; head.add(ear);
    const an = new THREE.Group(); an.position.set(s * .08, .16, -.04); head.add(an);
    cyl(an, .025, .03, .45, M('#d8c8a8'), s * .08, .2, 0, 0, 0, -s * .35);
    cyl(an, .02, .025, .22, M('#d8c8a8'), s * .2, .3, .06, .5, 0, -s * .9);
  });
  const legs = [];
  [[-.2, .45], [.2, .45], [-.2, -.45], [.2, -.45]].forEach(([x, z]) => { const l = new THREE.Group(); l.position.set(x, 1.0, z); g.add(l); cyl(l, .06, .045, 1.0, dark, 0, -.5, 0); legs.push(l); });
  const tail = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), white); tail.position.set(0, 1.3, -.72); g.add(tail);
  g.scale.setScalar(.85); g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { g, legs, head };
}
let deerId = 0;
function placeDeerRandom(d, rng) {
  const z = d.zone; for (let k = 0; k < 20; k++) { const x = z.x0 + rng() * (z.x1 - z.x0), zz = z.z0 + rng() * (z.z1 - z.z0); if (isFreeLite(x, zz)) { d.g.position.set(x, H(x, zz), zz); return; } }
  d.g.position.set((z.x0 + z.x1) / 2, 0, (z.z0 + z.z1) / 2); d.g.position.y = H(d.g.position.x, d.g.position.z);
}
function isFreeLite(x, z) { return streamD(x, z) > 2.5 && !BERRIES.some(b => Math.hypot(b.x - x, b.z - z) < 1.6) && !TREES.some(t => Math.hypot(t.x - x, t.z - z) < 1.2); }
[0, 0, 1, 1, 1, 1].forEach(zi => {
  const m = makeDeer(); scene.add(m.g);
  const d = { id: deerId++, ...m, zone: DEER_ZONES[zi], hp: 3, state: 'graze', t: wrr(1, 4), wp: V(), dt: 0, fleeT: 0, moving: false };
  placeDeerRandom(d, wr); d.g.rotation.y = wrr(0, TAU); d.g.userData = { deer: d, dead: false };
  DEER.push(d);
});

/* ---------- mine : amélioration ---------- */
const MINE_PT = new THREE.Vector3(); window._cart.getWorldPosition(MINE_PT);
const mineTag = addTag(`<div class="box build"><b>⛏️ Mine de pierre</b> · <span id="mt-l"></span><small id="mt-s"></small><div class="pb"><i id="mt-b"></i></div></div><div class="arrow"></div>`, V(0.2, 7.2, -1.6), 0, 'build');
function addMineFlag() {
  if (window._flag) return;
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

/* ---------- bâtiments ---------- */
const RES_IC = { wood: '🪵', stone: '🪨', iron: '⛓️', plank: '🟫', food: '🍒', leather: '🦌', crystal: '💎', gold: '🪙', ess: '🔮' };
const RES_NAME = { wood: 'Bois', stone: 'Pierre', iron: 'Fer', plank: 'Planches', food: 'Nourriture', leather: 'Cuir', crystal: 'Cristaux', gold: 'Pièces', ess: 'Essence d\'ombre' };
const BUILDS = {
  cabin: { name: 'Cabane', ic: '🏠', cat: 'Habitat', cost: { wood: 40, stone: 15 }, r: 2.6, time: 26, xp: 150, th: 6.8, lvl: 1, desc: 'Loge un habitant · améliorable', names: ['Cabane', 'Maison', 'Demeure'], up: [null, { plank: 20, stone: 30 }, { plank: 40, stone: 40, iron: 8 }], upLvl: [0, 12, 18], cap: 1 },
  cottage: { name: 'Chaumière rustique', ic: '🏡', cat: 'Habitat', cost: { wood: 50, stone: 20 }, r: 2.8, time: 30, xp: 180, th: 6.6, lvl: 12, cap: 2, desc: 'Maison complète au toit de chaume · 2 habitants' },
  nordic: { name: 'Maison nordique', ic: '🛖', cat: 'Habitat', cost: { wood: 70, stone: 15 }, r: 2.9, time: 32, xp: 200, th: 7.4, lvl: 13, cap: 2, desc: 'Rondins et toit végétal · 2 habitants' },
  timber: { name: 'Maison à colombages', ic: '🏘️', cat: 'Habitat', cost: { wood: 60, stone: 40, plank: 10 }, r: 3.1, time: 38, xp: 260, th: 8.6, lvl: 13, cap: 3, desc: 'Style médiéval à étage · 3 habitants' },
  tropical: { name: 'Villa tropicale', ic: '🌴', cat: 'Habitat', cost: { wood: 55, plank: 15 }, r: 3.1, time: 34, xp: 230, th: 7.6, lvl: 14, cap: 2, desc: 'Sur pilotis, toit de palmes · 2 habitants' },
  manor: { name: 'Manoir élégant', ic: '🏛️', cat: 'Habitat', cost: { stone: 90, plank: 30, iron: 10, gold: 100 }, r: 3.7, time: 50, xp: 420, th: 9.2, lvl: 16, cap: 4, desc: 'Grande demeure en pierre · 4 habitants' },
  magetower: { name: 'Tour enchantée', ic: '🔮', cat: 'Habitat', cost: { stone: 60, crystal: 6, ess: 5 }, r: 2.6, time: 45, xp: 380, th: 10.6, lvl: 16, cap: 2, desc: 'Style fantastique, brille la nuit · 2 habitants' },
  farm: { name: 'Ferme', ic: '🌾', cat: 'Production', cost: { wood: 35, stone: 10 }, r: 3.3, time: 24, xp: 140, th: 3.6, lvl: 12, desc: 'Le fermier cultive de la nourriture', job: 'farmer', names: ['Ferme', 'Grande ferme'], up: [null, { plank: 15, wood: 20 }], upLvl: [0, 13] },
  workshop: { name: 'Atelier', ic: '🪚', cat: 'Production', cost: { wood: 45, stone: 20, iron: 2 }, r: 2.5, time: 28, xp: 160, th: 5.8, lvl: 12, desc: 'Le menuisier transforme le bois en planches', job: 'carpenter', names: ['Atelier', 'Grand atelier'], up: [null, { plank: 20, stone: 25, iron: 4 }], upLvl: [0, 14] },
  market: { name: 'Marché', ic: '🧺', cat: 'Production', cost: { wood: 30, plank: 8, stone: 10 }, r: 2.3, time: 22, xp: 170, th: 5.2, lvl: 13, desc: 'Vends tes ressources · le marchand rapporte des pièces', job: 'merchant' },
  fire: { name: 'Feu de camp', ic: '🔥', cat: 'Défense', cost: { wood: 8, stone: 4 }, r: 1.0, time: 6, xp: 25, th: 2.6, lvl: 1, desc: 'Éclaire et réchauffe la nuit' },
  wall: { name: 'Palissade', ic: '🪵', cat: 'Défense', cost: { wood: 12 }, r: 1.3, time: 9, xp: 30, th: 3.6, lvl: 1, desc: 'Bloque les ombres nocturnes', maskR: .7 },
  stonewall: { name: 'Mur de pierre', ic: '🧱', cat: 'Défense', cost: { stone: 24 }, r: 1.3, time: 14, xp: 45, th: 3.4, lvl: 15, desc: 'Défense solide en pierre', maskR: .7 },
  tower: { name: 'Tour de guet', ic: '🗼', cat: 'Défense', cost: { wood: 45, stone: 25 }, r: 1.6, time: 30, xp: 180, th: 8.2, lvl: 13, desc: 'Tire sur les monstres la nuit' },
  lamp: { name: 'Lampadaire', ic: '🏮', cat: 'Décoration', cost: { wood: 3, iron: 1 }, r: .45, time: 0, xp: 8, th: 3.4, lvl: 1, desc: 'Éclaire les rues la nuit', mask: false },
  flowers: { name: 'Parterre fleuri', ic: '🌷', cat: 'Décoration', cost: { wood: 2, food: 2 }, r: .9, time: 0, xp: 6, th: 1.4, lvl: 1, desc: 'Embellit le village' },
  bench: { name: 'Banc', ic: '🪑', cat: 'Décoration', cost: { plank: 2 }, r: .8, time: 0, xp: 6, th: 1.6, lvl: 1, desc: 'Un coin pour se reposer' },
  path: { name: 'Dalles de route', ic: '🛤️', cat: 'Décoration', cost: { stone: 4 }, r: 1.0, time: 0, xp: 4, th: 1, lvl: 1, desc: 'Trace routes et places', walk: true },
};
const ghostMat = new THREE.MeshBasicMaterial({ color: '#6dff8a', transparent: true, opacity: .42, depthWrite: false });
const LAMP_MAT = M('#ffe2a0', { emissive: '#ffb347', emissiveIntensity: .4 });
const CRY_MAT = new THREE.MeshStandardMaterial({ color: '#8ff0ff', emissive: '#2fb8ff', emissiveIntensity: 1.6, roughness: .2 });
const cream = M('#e8dcc2'), redRoof = ['#a0563a', '#8e4a32', '#b0644a'].map(c => M(c)), blueRoof = ['#5f82ad', '#557aa6', '#6a8db7', '#4d6f99'].map(c => M(c, { roughness: .6 }));
function gableRoof(parent, half, depth, mats, y0, ang = .62, thick = .1, gmat = cream) {
  const L = half / Math.cos(ang), rise = Math.tan(ang) * half;
  slope(parent, L, depth, mats, 6, 7, -half / 2, y0 + rise / 2, 0, ang, thick); slope(parent, L, depth, mats, 6, 7, half / 2, y0 + rise / 2, 0, -ang, thick);
  const sh = new THREE.Shape(); sh.moveTo(-half + .4, 0); sh.lineTo(half - .4, 0); sh.lineTo(0, rise - .1); sh.closePath();
  const gm = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: depth - .6, bevelEnabled: false }), gmat); gm.position.set(0, y0, -(depth - .6) / 2); gm.castShadow = true; parent.add(gm);
  return rise;
}
function makeBuild(type, ghost, level = 1) {
  const g = new THREE.Group(), found = new THREE.Group(), wall = new THREE.Group(), roof = new THREE.Group();
  g.add(found, wall, roof); const ex = {};
  if (type === 'cabin') {
    const L = level, wd = [3.8, 4.4, 4.4][L - 1], dp = [3.2, 3.6, 3.6][L - 1], hw = [2.4, 3.4, 3.6][L - 1];
    box(found, wd + .4, .4, dp + .4, stone, 0, .2, 0);
    wall.position.y = .4;
    if (L === 1) box(wall, wd, hw, dp, cream, 0, hw / 2, 0);
    else {
      box(wall, wd, 1.4, dp, L === 3 ? stoneLight : stone, 0, .7, 0);
      box(wall, wd - .1, hw - 1.4, dp - .1, cream, 0, 1.4 + (hw - 1.4) / 2, 0);
      for (let i = -2; i <= 2; i++) box(wall, .14, hw - 1.4, .06, woodDark, i * wd / 4.4, 1.4 + (hw - 1.4) / 2, dp / 2 + .02);
      box(wall, wd + .1, .16, dp + .1, woodDark, 0, 1.45, 0);
    }
    [-wd / 2 + .05, wd / 2 - .05].forEach(x => box(wall, .22, hw, dp + .1, woods[1], x, hw / 2, 0));
    box(wall, wd + .1, .22, .22, woods[1], 0, hw - .1, dp / 2 + .02);
    box(wall, .9, 1.5, .1, woods[0], 0, .75, dp / 2 + .02);
    const wy = L === 1 ? 1.4 : 2.3;
    [-1, 1].forEach(sx => { box(wall, .6, .6, .08, WIN_MAT, sx * wd * .29, wy, dp / 2 + .03); if (L > 1) box(wall, .55, .5, .08, WIN_MAT, sx * wd * .29, .95, dp / 2 + .03); if (L === 3) { box(wall, .7, .18, .25, woods[2], sx * wd * .29, wy - .42, dp / 2 + .15); for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(new THREE.SphereGeometry(.07, 6, 5), M(['#ff5a7a', '#ffd24a', '#ff8a3a', '#d070ff'][k])); f.position.set(sx * wd * .29 - .24 + k * .16, wy - .27, dp / 2 + .2); wall.add(f); } } });
    if (L === 3) { box(wall, 2.2, .12, 1.0, pick(woods), 0, 1.5, dp / 2 + .5); for (let k = -2; k <= 2; k++) box(wall, .08, .6, .08, woodDark, k * .5, 1.8, dp / 2 + .98); box(wall, 2.2, .08, .08, woodLight, 0, 2.1, dp / 2 + .98); }
    roof.position.y = hw + .4;
    gableRoof(roof, wd / 2 + .4, dp + .7, L === 3 ? blueRoof : redRoof, 0);
    box(roof, .5, 1.6, .5, stone, wd * .29, 1.2, -.6);
    if (L === 3) box(roof, .45, 1.4, .45, stone, -wd * .29, 1.1, .5);
  } else if (type === 'cottage') {          // Chaumière rustique
    box(found, 4.8, .45, 4.0, stone, 0, .22, 0);
    for (let i = 0; i < 9; i++) rock(found, rr(.2, .28), -2.2 + i * .55, .32, 2.0, [1, .7, 1], 0, .3);
    wall.position.y = .45;
    box(wall, 4.2, 2.3, 3.4, M('#efe2c4'), 0, 1.15, 0);
    [[-2.1, 1.7], [2.1, 1.7], [-2.1, -1.7], [2.1, -1.7]].forEach(([x, z]) => box(wall, .24, 2.4, .24, woodDark, x, 1.2, z));
    box(wall, 4.4, .2, .2, woodDark, 0, 2.25, 1.72); box(wall, 4.4, .16, .16, woodDark, 0, 1.0, 1.72);
    box(wall, .95, 1.55, .1, woods[0], 0, .78, 1.73); box(wall, 1.15, .14, .14, woodDark, 0, 1.6, 1.75);
    [-1.3, 1.3].forEach(x => { box(wall, .62, .62, .08, WIN_MAT, x, 1.45, 1.73); box(wall, .2, .7, .06, M('#4f7a4a'), x - .45, 1.45, 1.76); box(wall, .2, .7, .06, M('#4f7a4a'), x + .45, 1.45, 1.76); box(wall, .8, .16, .25, woods[2], x, 1.05, 1.85); for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(new THREE.SphereGeometry(.08, 6, 5), M(['#ff5a7a', '#ffd24a', '#ff8a3a', '#ffffff'][k])); f.position.set(x - .27 + k * .18, 1.2, 1.88); wall.add(f); } });
    roof.position.y = 2.75;
    gableRoof(roof, 2.65, 4.3, ['#c9a24a', '#b8913e', '#d4ae58'].map(c => M(c, { roughness: 1 })), 0, .72, .3, M('#efe2c4'));
    box(roof, .55, 2.0, .55, stone, 1.2, 1.4, -.7);
  } else if (type === 'nordic') {           // Maison nordique en rondins
    box(found, 4.9, .4, 4.3, stone, 0, .2, 0);
    wall.position.y = .4;
    box(wall, 4.1, 2.4, 3.5, M('#3e2a18'), 0, 1.2, 0);
    const logM = [M('#5a3a22'), M('#6a4428'), M('#4e321e')];
    for (let i = 0; i < 8; i++) { const y = .16 + i * .3; cyl(wall, .17, .17, 4.7, pick(logM), 0, y, 1.85, 0, 0, Math.PI / 2, 8); cyl(wall, .17, .17, 4.7, pick(logM), 0, y, -1.85, 0, 0, Math.PI / 2, 8); cyl(wall, .17, .17, 4.0, pick(logM), 2.15, y + .15, 0, Math.PI / 2, 0, 0, 8); cyl(wall, .17, .17, 4.0, pick(logM), -2.15, y + .15, 0, Math.PI / 2, 0, 0, 8); }
    box(wall, .95, 1.7, .12, woods[1], 0, .85, 2.04); box(wall, 1.2, .16, .2, woodDark, 0, 1.78, 2.06);
    [-1.3, 1.3].forEach(x => { box(wall, .6, .55, .1, WIN_MAT, x, 1.5, 2.04); box(wall, .78, .1, .16, woodLight, x, 1.2, 2.08); });
    [-.9, .9].forEach(x => cyl(wall, .1, .1, 2.4, woods[2], x, 1.2, 2.9));
    box(wall, 2.2, .1, 1.2, pick(woods), 0, .05, 2.5);
    roof.position.y = 2.75;
    const rise = gableRoof(roof, 2.7, 4.9, ['#4f7a2a', '#5f8a32', '#3f6a22'].map(c => M(c, { roughness: 1 })), 0, .85, .25, M('#4e321e'));
    box(roof, .16, 1.5, .16, woodLight, -.35, rise + .35, 2.5, 0, 0, .55); box(roof, .16, 1.5, .16, woodLight, .35, rise + .35, 2.5, 0, 0, -.55);
    plankRoof(roof, 1.6, 2.4, 6, 0, -.2, 2.65, 0, .35).rotation.set(.35, Math.PI / 2, 0);
    box(roof, .6, 2.2, .6, stone, -1.2, 1.6, -.8);
  } else if (type === 'timber') {           // Maison à colombages (médiévale)
    box(found, 5.0, .4, 4.2, stone, 0, .2, 0);
    wall.position.y = .4;
    box(wall, 4.6, 1.7, 3.8, stoneLight, 0, .85, 0);
    box(wall, 5.0, 2.0, 4.2, cream, 0, 2.7, 0);
    box(wall, 5.1, .16, 4.3, woodDark, 0, 1.75, 0); box(wall, 5.1, .16, 4.3, woodDark, 0, 3.65, 0);
    [-2.45, -1.2, 0, 1.2, 2.45].forEach(x => box(wall, .14, 2.0, .06, woodDark, x, 2.7, 2.12));
    [-1.85, -.6, .6, 1.85].forEach((x, i) => box(wall, .11, 1.95, .05, woodDark, x, 2.7, 2.13, 0, 0, i % 2 ? .52 : -.52));
    [-2.0, -.7, .7, 2.0].forEach(z => { box(wall, .06, 2.0, .14, woodDark, 2.52, 2.7, z); box(wall, .06, 2.0, .14, woodDark, -2.52, 2.7, z); });
    box(wall, 1.0, 1.5, .1, woods[0], 0, .75, 1.92); box(wall, 1.25, .2, .2, stone, 0, 1.6, 1.95);
    [-1.5, 1.5].forEach(x => { box(wall, .6, .6, .08, WIN_MAT, x, .95, 1.92); box(wall, .76, .12, .14, stone, x, .6, 1.96); });
    [-1.8, 0, 1.8].forEach(x => { box(wall, .62, .72, .08, WIN_MAT, x, 2.75, 2.12); box(wall, .78, .1, .16, woodLight, x, 2.33, 2.16); });
    roof.position.y = 4.1;
    gableRoof(roof, 2.95, 4.9, redRoof, 0, .8, .12);
    box(roof, .9, .85, .9, cream, 0, 1.0, 1.25); box(roof, .5, .45, .06, WIN_MAT, 0, 1.0, 1.71);
    plankRoof(roof, .8, 1.1, 4, -.3, 1.55, 1.25, .7); plankRoof(roof, .8, 1.1, 4, .3, 1.55, 1.25, -.7);
    box(roof, .6, 2.4, .6, stone, 1.6, 1.6, -1.0);
  } else if (type === 'tropical') {         // Villa tropicale sur pilotis
    [[-2.2, -1.9], [0, -1.9], [2.2, -1.9], [-2.2, 1.9], [0, 1.9], [2.2, 1.9]].forEach(([x, z]) => cyl(found, .13, .15, 1.35, woodLight, x, .67, z));
    for (let i = 0; i < 12; i++) box(found, .42, .12, 4.6, pick(woods), -2.35 + i * .43, 1.38, 0);
    for (let i = 0; i < 4; i++) box(found, 1.1, .1, .32, woods[2], 0, .25 + i * .33, 3.25 - i * .3);
    wall.position.y = 1.44;
    box(wall, 3.8, 2.1, 3.2, M('#cfae70'), 0, 1.05, -.2);
    for (let x = -1.85; x <= 1.86; x += .31) { box(wall, .27, 2.1, .08, pick([M('#d8b878'), M('#c8a868')]), x, 1.05, 1.42); box(wall, .27, 2.1, .08, pick([M('#d8b878'), M('#c8a868')]), x, 1.05, -1.82); }
    box(wall, .9, 1.7, .06, black, 0, .85, 1.47);
    [-1.2, 1.2].forEach(x => box(wall, .7, .6, .06, WIN_MAT, x, 1.25, 1.48));
    for (let k = 0; k < 9; k++) box(wall, .07, .55, .07, woodDark, -2.3 + k * .575, .28, 2.2);
    box(wall, 4.7, .08, .1, woodLight, 0, .56, 2.2);
    roof.position.y = 3.55;
    gableRoof(roof, 3.1, 5.6, ['#6a9a32', '#5a8a2a', '#c8b060', '#b8a050'].map(c => M(c, { roughness: 1, side: THREE.DoubleSide })), 0, .5, .2, M('#c8a868'));
    for (let k = 0; k < 9; k++) { const lf = new THREE.Mesh(new THREE.ConeGeometry(.22, .7, 4), M('#5a8a2a')); lf.position.set(-2.8 + k * .7, -.15, 2.85); lf.rotation.x = Math.PI; roof.add(lf); }
  } else if (type === 'manor') {            // Manoir élégant
    box(found, 6.4, .5, 5.2, stoneLight, 0, .25, 0);
    box(found, 2.2, .25, .7, stoneLight, 0, .12, 2.9); box(found, 1.8, .2, .5, stoneLight, 0, .35, 2.75);
    wall.position.y = .5;
    const white = M('#f2ede2');
    box(wall, 5.8, 4.0, 4.6, white, 0, 2.0, 0);
    for (let y = 0; y < 8; y++) [[-2.9, 2.3], [2.9, 2.3], [-2.9, -2.3], [2.9, -2.3]].forEach(([x, z]) => box(wall, y % 2 ? .4 : .55, .48, y % 2 ? .55 : .4, stone, x, .25 + y * .5, z));
    box(wall, 6.0, .18, 4.8, stone, 0, 2.05, 0); box(wall, 6.1, .25, 4.9, stone, 0, 3.95, 0);
    const shut = M('#4a6a9a');
    [[-1.9, 1.1], [1.9, 1.1], [-1.9, 3.0], [0, 3.0], [1.9, 3.0]].forEach(([x, y]) => { box(wall, .75, 1.05, .08, WIN_MAT, x, y, 2.32); box(wall, .95, .14, .14, stoneLight, x, y + .62, 2.35); box(wall, .22, 1.05, .06, shut, x - .5, y, 2.34); box(wall, .22, 1.05, .06, shut, x + .5, y, 2.34); });
    box(wall, 1.0, 1.8, .1, M('#3a4a6a'), 0, .9, 2.33);
    [-.85, .85].forEach(x => cyl(wall, .13, .15, 2.2, stoneLight, x, 1.1, 2.65, 0, 0, 0, 10));
    const ped = new THREE.Shape(); ped.moveTo(-1.15, 0); ped.lineTo(1.15, 0); ped.lineTo(0, .6); ped.closePath();
    const pm = new THREE.Mesh(new THREE.ExtrudeGeometry(ped, { depth: .6, bevelEnabled: false }), stoneLight); pm.position.set(0, 2.2, 2.35); pm.castShadow = true; wall.add(pm);
    roof.position.y = 4.5;
    gableRoof(roof, 3.3, 5.3, blueRoof, 0, .6, .12, white);
    [-1.9, 1.9].forEach(x => box(roof, .55, 2.0, .55, stoneLight, x, 1.3, -.4));
    const ow = new THREE.Mesh(new THREE.CircleGeometry(.3, 16), WIN_MAT); ow.position.set(0, .9, 2.36); roof.add(ow);
  } else if (type === 'magetower') {        // Tour fantastique
    cyl(found, 2.1, 2.3, .4, stone, 0, .2, 0, 0, 0, 0, 20);
    wall.position.y = .4;
    cyl(wall, 1.6, 1.8, 5.2, M('#9a98a8'), 0, 2.6, 0, 0, 0, 0, 20);
    [1.0, 2.6, 4.2].forEach((y, i) => cyl(wall, 1.82 - i * .08, 1.82 - i * .08, .2, stone, 0, y, 0, 0, 0, 0, 20));
    for (let k = 0; k < 4; k++) [2.0, 3.6].forEach(y => { const a = k * Math.PI / 2 + .4; const w = box(wall, .38, .75, .1, CRY_MAT, Math.sin(a) * 1.7, y, Math.cos(a) * 1.7); w.rotation.y = a; });
    box(wall, .85, 1.5, .14, woods[1], 0, .75, 1.76);
    cyl(wall, .8, .85, 2.4, M('#8a889a'), 1.9, 1.2, -.7, 0, 0, 0, 14);
    const ac = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.4, 14), M('#5a3a8a')); ac.position.set(1.9, 3.1, -.7); ac.castShadow = true; wall.add(ac);
    roof.position.y = 5.6;
    cyl(roof, 2.0, 2.0, .22, stone, 0, .1, 0, 0, 0, 0, 20);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.3, 3.4, 20), M('#5a3a8a', { roughness: .6 })); cone.position.y = 1.9; cone.castShadow = true; roof.add(cone);
    cyl(roof, .05, .05, 1.0, M('#d8c070', { metalness: .7 }), 0, 4.0, 0);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(.28, 16, 12), CRY_MAT); orb.position.y = 4.6; roof.add(orb);
  } else if (type === 'farm') {
    box(found, 6.2, .1, 4.4, M('#6b4a2a'), 0, .05, 0);
    for (let i = 0; i < 6; i++) box(found, 5.6, .1, .28, M('#5a3a20'), 0, .1, -1.75 + i * .7);
    const crops = new THREE.Group(); wall.add(crops); ex.crops = crops;
    const cropM = M('#7fb83a'), wheatM = M('#e2b84a');
    for (let i = 0; i < 6; i++) for (let k = 0; k < 9; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(.13, .7, 5), (i + k) % 3 ? cropM : wheatM); c.position.set(-2.6 + k * .65, .35, -1.75 + i * .7); c.castShadow = true; crops.add(c); }
    for (let k = 0; k <= 8; k++) { box(wall, .1, .8, .1, woods[1], -3.1 + k * .775, .4, 2.2); box(wall, .1, .8, .1, woods[1], -3.1 + k * .775, .4, -2.2); }
    box(wall, 6.3, .08, .06, woodLight, 0, .62, 2.2); box(wall, 6.3, .08, .06, woodLight, 0, .62, -2.2);
    roof.position.set(2.6, 0, -1.6);
    cyl(roof, .05, .05, 1.8, woodDark, 0, .9, 0); cyl(roof, .04, .04, 1.1, woodDark, 0, 1.4, 0, 0, 0, Math.PI / 2);
    const hd = new THREE.Mesh(new THREE.SphereGeometry(.18, 10, 8), M('#e8d4a0')); hd.position.y = 1.95; roof.add(hd);
    cyl(roof, .26, .26, .04, M('#c9a25a'), 0, 2.08, 0, 0, 0, 0, 12); cyl(roof, .12, .16, .18, M('#c9a25a'), 0, 2.18, 0, 0, 0, 0, 12);
    box(roof, .5, .5, .25, M('#a8452f'), 0, 1.35, 0);
    if (level > 1) { const silo = cyl(roof, .55, .55, 2.6, M('#c8b490'), -1.2, 1.3, -.2, 0, 0, 0, 14); const cap = new THREE.Mesh(new THREE.ConeGeometry(.65, .6, 14), redRoof[0]); cap.position.set(-1.2, 2.9, -.2); roof.add(cap); }
  } else if (type === 'workshop') {
    box(found, 4.4, .35, 3.6, stone, 0, .17, 0);
    wall.position.y = .35;
    box(wall, 4, 2.2, .2, woods[1], 0, 1.1, -1.5); box(wall, .2, 2.2, 3.2, woods[2], -1.9, 1.1, 0); box(wall, .2, 2.2, 3.2, woods[2], 1.9, 1.1, 0);
    [-1.9, 1.9].forEach(x => box(wall, .26, 2.4, .26, woodDark, x, 1.2, 1.6));
    box(wall, 2.2, .12, .8, woodLight, -.5, .9, .4); [-1.4, .4].forEach(x => box(wall, .1, .85, .7, woodDark, x, .43, .4));
    cyl(wall, .25, .25, 1.4, woods[0], .9, .3, .9, 0, 0, Math.PI / 2, 10);
    const saw = new THREE.Mesh(new THREE.CylinderGeometry(.32, .32, .03, 16), M('#c8ced6', { metalness: .7, roughness: .3 })); saw.position.set(-.5, 1.12, .4); saw.rotation.x = Math.PI / 2; wall.add(saw); ex.saw = saw;
    roof.position.y = 2.55;
    plankRoof(roof, 2.6, 4.4, 10, -1.1, .5, 0, .45).rotation.set(0, 0, .45); plankRoof(roof, 2.6, 4.4, 10, 1.1, .5, 0, -.45).rotation.set(0, 0, -.45);
    box(roof, .5, 1.5, .5, stone, 1.2, .7, -1.1);
    if (level > 1) { box(wall, 1.4, 1.6, 1.4, stoneLight, 2.6, .8, -.8); box(roof, 1.6, .12, 1.6, pick(woods), 2.6, -.75, -.8); }
  } else if (type === 'market') {
    box(found, 4.0, .25, 3.2, stoneLight, 0, .12, 0);
    [[-1.7, -1.3], [1.7, -1.3], [-1.7, 1.3], [1.7, 1.3]].forEach(([x, z]) => box(wall, .18, 2.6, .18, woodDark, x, 1.3, z));
    box(wall, 3.6, .9, .7, woods[2], 0, .45, 1.0); box(wall, 3.8, .1, .9, woodLight, 0, .92, 1.0);
    const prod = [['#d8263a', .1], ['#f0a030', .12], ['#7fb83a', .11], ['#e8d4a0', .1]];
    for (let i = 0; i < 4; i++) { box(wall, .7, .25, .55, woods[i % 5], -1.2 + i * .8, 1.1, 1.0); for (let k = 0; k < 5; k++) { const f = new THREE.Mesh(new THREE.SphereGeometry(prod[i][1], 8, 6), M(prod[i][0])); f.position.set(-1.2 + i * .8 + (k % 3 - 1) * .2, 1.3, 1.0 + (k < 3 ? -.1 : .12)); wall.add(f); } }
    box(wall, .8, .6, .6, woods[3], 1.3, .3, -.8); box(wall, .6, .5, .5, woods[4], -1.2, .25, -.7);
    roof.position.y = 2.6;
    for (let i = 0; i < 8; i++) box(roof, .5, .08, 3.4, M(i % 2 ? '#f2ead8' : '#c8402e'), -1.75 + i * .5, 0, 0, 0, 0, 0).rotation.x = .25;
  } else if (type === 'wall') {
    box(found, 3.6, .12, .8, M('#8a6a44'), 0, .06, 0);
    for (let i = 0; i < 8; i++) {
      const x = -1.6 + i * .46; cyl(wall, .19, .21, 2.1, pick(woods), x, 1.05, 0, 0, 0, rr(-.03, .03), 8);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(.19, .45, 8), woods[2]); tip.position.set(x, 2.32, 0); tip.castShadow = true; wall.add(tip);
    }
    box(wall, 3.8, .16, .14, woodDark, 0, .7, .22); box(wall, 3.8, .16, .14, woodDark, 0, 1.6, .22);
  } else if (type === 'stonewall') {
    box(found, 3.8, .2, 1.0, stone, 0, .1, 0);
    for (let row = 0; row < 4; row++) for (let i = 0; i < 5; i++) box(wall, .74, .44, .8, pick([stone, stoneLight, M('#8a9098')]), -1.5 + i * .75 + (row % 2) * .37 - .18, .22 + row * .45, 0);
    for (let i = 0; i < 4; i++) box(wall, .5, .4, .85, stoneLight, -1.5 + i, 2.0, 0);
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
  } else if (type === 'lamp') {
    cyl(found, .22, .28, .25, stone, 0, .12, 0, 0, 0, 0, 8);
    cyl(wall, .05, .06, 2.6, M('#3a3a40', { metalness: .6, roughness: .4 }), 0, 1.4, 0);
    box(wall, .5, .05, .05, M('#3a3a40', { metalness: .6 }), .2, 2.6, 0);
    roof.position.set(.42, 2.35, 0);
    box(roof, .26, .34, .26, LAMP_MAT, 0, 0, 0); const cap = new THREE.Mesh(new THREE.ConeGeometry(.24, .2, 4), M('#3a3a40')); cap.position.y = .27; cap.rotation.y = Math.PI / 4; roof.add(cap);
  } else if (type === 'flowers') {
    for (let i = 0; i < 4; i++) { const b = box(found, 1.7, .22, .14, woods[1], 0, .11, 0); b.rotation.y = i * Math.PI / 2; b.position.set(Math.sin(i * Math.PI / 2) * .8, .11, Math.cos(i * Math.PI / 2) * .8); }
    box(found, 1.5, .12, 1.5, M('#5a3a20'), 0, .08, 0);
    const cols = ['#ff5a7a', '#ffd24a', '#ff8a3a', '#d070ff', '#ffffff', '#5ab8ff'];
    for (let i = 0; i < 14; i++) { const x = rr(-.6, .6), z = rr(-.6, .6), h = rr(.3, .6); cyl(wall, .015, .015, h, M('#3f7a2a'), x, h / 2 + .1, z, 0, 0, 0, 4); const f = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), M(pick(cols), { roughness: .5 })); f.position.set(x, h + .12, z); wall.add(f); }
  } else if (type === 'bench') {
    for (let i = 0; i < 3; i++) box(found, 1.6, .06, .14, pick(woods), 0, .5, -.16 + i * .16);
    [-.65, .65].forEach(x => { box(wall, .1, .5, .1, woodDark, x, .25, -.18); box(wall, .1, .5, .1, woodDark, x, .25, .18); box(wall, .1, .6, .08, woodDark, x, .8, -.26); });
    box(wall, 1.6, .14, .06, pick(woods), 0, .9, -.27); box(wall, 1.6, .12, .06, pick(woods), 0, .7, -.27);
  } else if (type === 'path') {
    const pm = [M('#b8b2a4'), M('#a8a294'), M('#c4bfb2')];
    for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) box(found, .94, .1, .94, pick(pm), -.5 + i, .04 + rr(0, .03), -.5 + k, 0, rr(-.05, .05), 0);
  }
  if (level > 1 && type !== 'cabin' && type !== 'farm' && type !== 'workshop') { }
  const CH = { cottage: [1.2, 2.55, -.7], nordic: [-1.2, 2.85, -.8], timber: [1.6, 2.95, -1.0], manor: [1.9, 2.4, -.4], workshop: [1.2, 1.55, -1.1] };
  if (type === 'cabin') CH.cabin = [[3.8, 4.4, 4.4][level - 1] * .29, 2.1, -.6];
  if (CH[type] && !ghost) { const cm = new THREE.Object3D(); cm.position.set(...CH[type]); roof.add(cm); ex.chimney = cm; }
  if (ghost) g.traverse(o => { if (o.isMesh) { o.material = ghostMat; o.castShadow = o.receiveShadow = false; } });
  return { g, found, wall, roof, roofY: roof.position.y, ...ex };
}

/* ================= VILLAGE : place, routes, décor ================= */
const BANNERS = [], LAMPS = [];
const SQ = V(4, 0, 10);                       // centre de la place du village
const ROADS = [], STATIC_MASK = [];
const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
let roadLift = 0;
function roadMesh(a, b, w, kind) {
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || .01, ux = dx / len, uz = dz / len, sxv = -uz, szv = ux;
  const ext = w * .45, L = len + ext * 2, n = Math.max(2, Math.ceil(L / .5)), cols = [-1, -.55, 0, .55, 1];
  const pos = [], colA = [], idx = [], c = new THREE.Color();
  const base = col(kind === 'stone' ? '#a49c8c' : '#a8875a'), dark = col(kind === 'stone' ? '#837b6e' : '#8a6a44'), edge = col('#6f7d3a');
  const lift = .035 + (roadLift = (roadLift + .002) % .02);
  for (let i = 0; i <= n; i++) {
    const t = -ext + L * i / n, cx = a.x + ux * t, cz = a.z + uz * t;
    cols.forEach(sv => {
      const x = cx + sxv * sv * w / 2, z = cz + szv * sv * w / 2;
      pos.push(x, H(x, z) + lift, z);
      const nn = vnoise(x * 1.7, z * 1.7);
      c.copy(base).lerp(dark, nn * .6); if (kind === 'stone' && (Math.abs(x * 1.3 % 1) < .12 || Math.abs(z * 1.3 % 1) < .12)) c.lerp(dark, .5);
      if (Math.abs(sv) === 1) c.lerp(edge, .55);
      colA.push(c.r, c.g, c.b);
    });
    if (i) { const k = (i - 1) * 5; for (let j = 0; j < 4; j++) idx.push(k + j, k + j + 1, k + j + 5, k + j + 1, k + j + 6, k + j + 5); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colA, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, roadMat); m.receiveShadow = true; scene.add(m); return m;
}
function addRoad(a, b, w = 2.2, kind = 'dirt') { const seg = { a: a.clone(), b: b.clone(), w, kind }; seg.mesh = roadMesh(seg.a, seg.b, w, kind); ROADS.push(seg); return seg; }
function removeRoad(seg) { const i = ROADS.indexOf(seg); if (i >= 0) ROADS.splice(i, 1); scene.remove(seg.mesh); seg.mesh.geometry.dispose(); }
function closestOnSeg(p, a, b) { const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1; const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2); return V(a.x + dx * t, 0, a.z + dz * t); }
function nearestRoad(p, skip) { let best = null, bd = 1e9; ROADS.forEach(s => { if (s === skip) return; const q = closestOnSeg(p, s.a, s.b), d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bd) { bd = d; best = q; } }); return { q: best, d: bd }; }
const CONNECT = new Set(['cabin', 'cottage', 'nordic', 'timber', 'tropical', 'manor', 'magetower', 'farm', 'workshop', 'market', 'tower']);
function connectSite(s) {
  if (!CONNECT.has(s.type) || s.road) return;
  const door = V(s.x + Math.sin(s.ry) * (s.r + .5), 0, s.z + Math.cos(s.ry) * (s.r + .5));
  const { q, d } = nearestRoad(door); if (!q || d < 1.2 || d > 26) return;
  s.road = addRoad(door, q, 1.5, 'dirt');
}
// tracé de base : place + routes vers la mine, le dépôt, la prairie et le sud
const ROAD_PLAN = [[SQ, V(1.2, 0, 5.2), 'stone'], [V(1.2, 0, 5.2), V(-.6, 0, 2.7), 'stone'], [V(1.2, 0, 5.2), V(-4, 0, 5.6), 'dirt'], [V(-4, 0, 5.6), V(-6.6, 0, 3.4), 'dirt'],
  [SQ, V(10, 0, 9.2), 'dirt'], [V(10, 0, 9.2), V(18, 0, 8.2), 'dirt'], [V(18, 0, 8.2), V(27, 0, 7), 'dirt'], [SQ, V(4.4, 0, 16), 'dirt'], [V(4.4, 0, 16), V(3.4, 0, 20), 'dirt']];
ROAD_PLAN.forEach(([a, b, k]) => addRoad(a, b, 2.3, k));
// place pavée
{
  const R = 3.6, g = new THREE.PlaneGeometry(R * 2, R * 2, 44, 44); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, cols = [], c = new THREE.Color(), a = col('#b4ac9c'), b = col('#8e8676');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), z = p.getZ(i); const d = Math.hypot(x, z); if (d > R) { x *= R / d; z *= R / d; }
    const wx = SQ.x + x, wz = SQ.z + z; p.setXYZ(i, x, H(wx, wz) + .06, z);
    const ring = Math.floor(Math.hypot(x, z) * 1.6), ang = Math.floor((Math.atan2(z, x) + Math.PI) * (2 + ring) * .9);
    c.copy(a).lerp(b, hash(ring, ang) * .8); if (Math.abs(Math.hypot(x, z) * 1.6 % 1) < .1) c.lerp(b, .6); if (d > R - .25) c.copy(b);
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, roadMat); m.position.set(SQ.x, 0, SQ.z); m.receiveShadow = true; scene.add(m);
  STATIC_MASK.push([SQ.x, SQ.z, R + .2]);
}
// fontaine
const waterMat = new THREE.MeshStandardMaterial({ color: '#4fc0d0', emissive: '#1a6a7a', emissiveIntensity: .35, roughness: .08, transparent: true, opacity: .85 });
const jetMat = new THREE.MeshBasicMaterial({ color: '#c8f4ff', transparent: true, opacity: .45, depthWrite: false });
const FOUNTAIN = new THREE.Group(); FOUNTAIN.position.set(SQ.x, H(SQ.x, SQ.z) + .05, SQ.z); scene.add(FOUNTAIN);
{
  const f = FOUNTAIN;
  cyl(f, 1.65, 1.75, .55, stoneLight, 0, .27, 0, 0, 0, 0, 28); cyl(f, 1.45, 1.45, .04, waterMat, 0, .5, 0, 0, 0, 0, 28);
  cyl(f, .25, .32, 1.3, stone, 0, .9, 0, 0, 0, 0, 12); cyl(f, .8, .42, .32, stoneLight, 0, 1.6, 0, 0, 0, 0, 20); cyl(f, .7, .7, .04, waterMat, 0, 1.74, 0, 0, 0, 0, 20);
  const jet = cyl(f, .05, .13, .7, jetMat, 0, 2.05, 0, 0, 0, 0, 8); jet.castShadow = false;
  const fall = new THREE.Mesh(new THREE.CylinderGeometry(.74, 1.05, .9, 24, 1, true), jetMat); fall.position.y = 1.2; f.add(fall);
  window._jet = jet; window._fall = fall;
  addCol(SQ.x, SQ.z, 1.8);
}
// décor statique réutilisant les modèles de bâtiments
function decor(type, x, z, ry, colR) { const b = makeBuild(type, false); b.g.position.set(x, H(x, z), z); b.g.rotation.y = ry; scene.add(b.g); if (colR) addCol(x, z, colR); return b; }
const faceSQ = (x, z) => Math.atan2(SQ.x - x, SQ.z - z);
decor('market', 7.6, 5.8, faceSQ(7.6, 5.8), 2.1); STATIC_MASK.push([7.6, 5.8, 2.3]);
[[4.0, 6.8], [6.4, 8.2], [7.4, 11.3], [5.8, 14.6], [2.6, 15.4], [-3.6, 7.2], [1.6, 3.2], [13.5, 10.6]].forEach(([x, z]) => { const b = decor('lamp', x, z, rr(0, 6), .35); LAMPS.push(b); });
LAMPS.slice(0, 4).forEach(b => { const l = new THREE.PointLight('#ffc070', 0, 9, 2); l.position.set(.42, 2.2, 0); b.g.add(l); b.light = l; });
[[1.6, 9.2], [6.6, 10.9]].forEach(([x, z]) => decor('bench', x, z, faceSQ(x, z), .7));
[[.3, 11.6], [2.0, 13.4]].forEach(([x, z]) => { decor('flowers', x, z, 0, .8); STATIC_MASK.push([x, z, .9]); });
// puits
{
  const x = .6, z = 17.4, g = new THREE.Group(); g.position.set(x, H(x, z), z); g.rotation.y = .4; scene.add(g);
  cyl(g, .72, .78, .85, stone, 0, .42, 0, 0, 0, 0, 16); cyl(g, .58, .58, .03, black, 0, .86, 0, 0, 0, 0, 16);
  [-.62, .62].forEach(px => box(g, .12, 1.7, .12, woodDark, px, .85, 0)); box(g, 1.5, .1, .1, woodDark, 0, 1.62, 0);
  plankRoof(g, .9, 1.5, 5, -.35, 1.85, 0, .6); plankRoof(g, .9, 1.5, 5, .35, 1.85, 0, -.6);
  cyl(g, .12, .1, .2, woods[2], 0, 1.25, 0); addCol(x, z, .9); STATIC_MASK.push([x, z, 1]);
}
// panneau indicateur
function signBoard(text, w = 1.5) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const x = cv.getContext('2d');
  x.fillStyle = '#8a5b39'; x.fillRect(0, 0, 256, 64); x.fillStyle = 'rgba(0,0,0,.15)'; for (let i = 0; i < 5; i++) x.fillRect(0, i * 13, 256, 2);
  x.fillStyle = '#fff3d8'; x.font = 'bold 30px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: t, roughness: .9, side: THREE.DoubleSide })); m.castShadow = true; return m;
}
{
  const x = 2.9, z = 4.4, g = new THREE.Group(); g.position.set(x, H(x, z), z); scene.add(g);
  cyl(g, .07, .08, 2.6, woodDark, 0, 1.3, 0);
  [['⛏ Mine', 2.3, Math.PI * .9], ['Prairie ➜', 1.9, Math.PI * .5], ['Place ⛲', 1.5, 0]].forEach(([t, y, r]) => { const b = signBoard(t, 1.3); b.position.set(Math.sin(r) * .55, y, Math.cos(r) * .55); b.rotation.y = r - Math.PI / 2; g.add(b); });
  addCol(x, z, .3);
}
// bannières à l'entrée de la place
[[0, 7.0, '#e0a32a'], [3.9, 5.6, '#3d9fa8']].forEach(([x, z, c]) => {
  const g = new THREE.Group(); g.position.set(x, H(x, z), z); scene.add(g); cyl(g, .06, .07, 3.6, woodDark, 0, 1.8, 0);
  const cl = new THREE.Mesh(new THREE.PlaneGeometry(.7, 1.3, 4, 6), M(c, { side: THREE.DoubleSide, emissive: c, emissiveIntensity: .12 })); cl.position.set(.38, 2.9, 0); g.add(cl); BANNERS.push(cl);
  addCol(x, z, .25);
});
// on dégage les rochers et baies qui gêneraient routes et place
function blockedByVillage(x, z, r) { if (Math.hypot(x - SQ.x, z - SQ.z) < 4 + r) return true; if ([[-2.4, 13.8, 3.3], [11.2, 15.0, 3.6], [12.8, 4.2, 3.4], [7.6, 5.8, 2.6]].some(([a, b, rr2]) => Math.hypot(a - x, b - z) < rr2 + r)) return true; return ROADS.some(s => { const q = closestOnSeg(V(x, 0, z), s.a, s.b); return Math.hypot(q.x - x, q.z - z) < s.w / 2 + r + .2; }); }
for (let i = ROCKS.length - 1; i >= 0; i--) { const r = ROCKS[i]; if (r.kind !== 'crystal' && blockedByVillage(r.x, r.z, r.r)) { scene.remove(r.mesh); ROCKS.splice(i, 1); } }
// buissons et fleurs qui se trouveraient sur une route ou la place
{
  const m4 = new THREE.Matrix4(), pp = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  (window._deco || []).forEach(im => { let ch = false; for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m4); m4.decompose(pp, q, sc); if (blockedByVillage(pp.x, pp.z, .3)) { sc.setScalar(0); m4.compose(pp, q, sc); im.setMatrixAt(i, m4); ch = true; } } if (ch) im.instanceMatrix.needsUpdate = true; });
}
function repaintMaskAll() {
  GRASS_MASK.image.data.fill(0);
  STATIC_MASK.forEach(([x, z, r]) => paintMask(x, z, r));
  ROADS.forEach(s => { const l = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z), n = Math.ceil(l / .4); for (let i = 0; i <= n; i++) paintMask(s.a.x + (s.b.x - s.a.x) * i / n, s.a.z + (s.b.z - s.a.z) * i / n, s.w / 2 + .15); });
  SITES.forEach(s => { if (s.def.mask !== false) paintMask(s.x, s.z, s.def.maskR != null ? s.def.maskR : s.r * .95, s.type === 'path'); });
  GRASS_MASK.needsUpdate = true;
}

/* ---------- fumée des cheminées ---------- */
const smokeTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(235,235,235,.9)'); g.addColorStop(1, 'rgba(235,235,235,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv); })();
const SMOKE = [];
for (let i = 0; i < 70; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; scene.add(s); SMOKE.push({ s, t: 99, life: 3.2 }); }
let smokeI = 0;
COTTAGES.forEach(c => { const m = new THREE.Object3D(); m.position.set(1.1, 4.95, -.6); c.add(m); c.userData.chimney = m; });
const chimneyList = () => { const out = []; COTTAGES.forEach(c => out.push(c.userData.chimney)); SITES.forEach(s => { if (s.done && !s.upg && s.chimney) out.push(s.chimney); }); return out; };
let smokeT = 0;
function updateSmoke(dt) {
  smokeT -= dt;
  if (smokeT <= 0) { smokeT = .35; const list = chimneyList(); if (list.length) { const src = list[Math.floor(Math.random() * list.length)]; const p = SMOKE[smokeI++ % SMOKE.length]; src.getWorldPosition(p.s.position); p.base = p.s.position.clone(); p.t = 0; p.s.visible = true; p.dx = (Math.random() - .5) * .4; } }
  SMOKE.forEach(p => { if (p.t > p.life) { p.s.visible = false; return; } p.t += dt; const k = p.t / p.life; p.s.position.set(p.base.x + p.dx * k * 3 + k * .8, p.base.y + k * 3, p.base.z); p.s.scale.setScalar(.5 + k * 1.6); p.s.material.opacity = Math.sin(Math.min(1, k) * Math.PI) * .45; });
}

/* ---------- poules du village ---------- */
const CHICKENS = [];
for (let i = 0; i < 6; i++) {
  const g = new THREE.Group(), white = M(i % 3 ? '#f4efe4' : '#c8863a');
  const b = new THREE.Mesh(new THREE.SphereGeometry(.22, 10, 8), white); b.scale.set(1, .9, 1.25); b.position.y = .32; g.add(b);
  const h = new THREE.Group(); h.position.set(0, .55, .2); g.add(h);
  const hm = new THREE.Mesh(new THREE.SphereGeometry(.12, 8, 6), white); h.add(hm);
  const comb = new THREE.Mesh(new THREE.BoxGeometry(.04, .08, .12), M('#d83030')); comb.position.y = .12; h.add(comb);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(.04, .1, 5), M('#f0a030')); beak.rotation.x = Math.PI / 2; beak.position.z = .13; h.add(beak);
  [-.08, .08].forEach(x => cyl(g, .015, .015, .2, M('#e0a030'), x, .1, 0));
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const x = SQ.x + wrr(-6, 6), z = SQ.z + wrr(4, 7); g.position.set(x, H(x, z), z); scene.add(g);
  CHICKENS.push({ g, h, wp: V(x, 0, z), t: wrr(0, 3), peck: 0 });
}
function chickensAI(dt, t) {
  CHICKENS.forEach(c => {
    const p = c.g.position;
    if (c.t > 0) { c.t -= dt; c.h.rotation.x = c.peck > 0 ? Math.abs(Math.sin(t * 14)) * .9 : 0; c.peck -= dt; if (c.t <= 0) { const a = Math.random() * TAU, r = 2 + Math.random() * 5; c.wp.set(clamp(SQ.x + Math.cos(a) * r * 1.4, BOUNDS.x0, BOUNDS.x1), 0, clamp(SQ.z + 5 + Math.sin(a) * r * .6, BOUNDS.z0, BOUNDS.z1)); } return; }
    const dx = c.wp.x - p.x, dz = c.wp.z - p.z, d = Math.hypot(dx, dz);
    if (d < .2) { c.t = 1 + Math.random() * 4; c.peck = Math.random() < .6 ? 1.2 : 0; return; }
    p.x += dx / d * 1.1 * dt; p.z += dz / d * 1.1 * dt; collide(p, .25); p.y = H(p.x, p.z) + Math.abs(Math.sin(t * 18)) * .04;
    c.g.rotation.y = lerpAng(c.g.rotation.y, Math.atan2(dx, dz), .2);
  });
}

/* ---------- son (synthétisé, sans fichiers) ---------- */
const SETTINGS = { sound: true, music: true, quality: 'auto' };
try { Object.assign(SETTINGS, JSON.parse(localStorage.getItem('everisle-settings') || '{}')); } catch (e) { }
const saveSettings = () => { try { localStorage.setItem('everisle-settings', JSON.stringify(SETTINGS)); } catch (e) { } };
const AU = { ctx: null, master: null, music: null, amb: null, noise: null, nextBird: 2, nextNote: 1, nextCricket: 0 };
function audioInit() {
  if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    AU.ctx = new C(); AU.master = AU.ctx.createGain(); AU.master.gain.value = SETTINGS.sound ? .55 : 0; AU.master.connect(AU.ctx.destination);
    AU.music = AU.ctx.createGain(); AU.music.gain.value = SETTINGS.music ? .5 : 0; AU.music.connect(AU.master);
    const len = AU.ctx.sampleRate * 2, buf = AU.ctx.createBuffer(1, len, AU.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; AU.noise = buf;
    const src = AU.ctx.createBufferSource(); src.buffer = buf; src.loop = true; const lp = AU.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    AU.amb = AU.ctx.createGain(); AU.amb.gain.value = .05; src.connect(lp); lp.connect(AU.amb); AU.amb.connect(AU.master); src.start();
  } catch (e) { AU.ctx = null; }
}
['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, audioInit, { passive: true }));
function tone(f0, f1, dur, type = 'sine', vol = .3, dest, delay = 0) {
  if (!AU.ctx || !SETTINGS.sound) return; const t = AU.ctx.currentTime + delay;
  const o = AU.ctx.createOscillator(), g = AU.ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(.02, dur / 4)); g.gain.exponentialRampToValueAtTime(.001, t + dur);
  o.connect(g); g.connect(dest || AU.master); o.start(t); o.stop(t + dur + .05);
}
function noiseHit(dur, freq, type = 'lowpass', vol = .4, delay = 0) {
  if (!AU.ctx || !SETTINGS.sound) return; const t = AU.ctx.currentTime + delay;
  const s = AU.ctx.createBufferSource(); s.buffer = AU.noise; const f = AU.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; const g = AU.ctx.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); s.connect(f); f.connect(g); g.connect(AU.master); s.start(t, Math.random()); s.stop(t + dur + .05);
}
function sfx(k) {
  switch (k) {
    case 'chop': noiseHit(.16, 700, 'lowpass', .5); tone(110, 55, .14, 'sine', .45); break;
    case 'pick': tone(1500, 1100, .09, 'triangle', .22); noiseHit(.08, 3000, 'highpass', .25); break;
    case 'berry': tone(660, 700, .07, 'sine', .25); tone(990, 1000, .08, 'sine', .22, null, .07); break;
    case 'hit': noiseHit(.12, 900, 'lowpass', .45); tone(220, 90, .15, 'sawtooth', .18); break;
    case 'hurt': tone(320, 110, .22, 'sawtooth', .22); break;
    case 'arrow': noiseHit(.18, 2200, 'bandpass', .35); break;
    case 'splash': noiseHit(.35, 1200, 'lowpass', .35); break;
    case 'build': tone(180, 120, .1, 'square', .15); tone(160, 100, .1, 'square', .15, null, .14); break;
    case 'done': [523, 659, 784].forEach((f, i) => tone(f, f, .25, 'triangle', .2, null, i * .09)); break;
    case 'level': [523, 659, 784, 1046].forEach((f, i) => tone(f, f, .35, 'triangle', .22, null, i * .11)); break;
    case 'coin': tone(1320, 1320, .07, 'square', .12); tone(1760, 1760, .12, 'square', .12, null, .07); break;
    case 'click': tone(900, 700, .04, 'sine', .15); break;
  }
}
const PENTA = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3];
function updateAudio(dt, night) {
  if (!AU.ctx) return;
  AU.master.gain.value = SETTINGS.sound ? .55 : 0; AU.music.gain.value = SETTINGS.music ? .5 : 0;
  if (!SETTINGS.sound) return;
  if (!night) { AU.nextBird -= dt; if (AU.nextBird <= 0) { AU.nextBird = 2 + Math.random() * 5; const b = 2200 + Math.random() * 1800; for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) tone(b, b * (1.2 + Math.random() * .3), .08, 'sine', .05, null, i * .11); } }
  else { AU.nextCricket -= dt; if (AU.nextCricket <= 0) { AU.nextCricket = .6 + Math.random() * 1.2; for (let i = 0; i < 3; i++) tone(4600, 4500, .03, 'square', .012, null, i * .06); } }
  AU.nextNote -= dt;
  if (AU.nextNote <= 0 && SETTINGS.music) {
    AU.nextNote = 1.6 + Math.random() * 2.2;
    const scale = night ? PENTA.map(f => f * .75) : PENTA, f = scale[Math.floor(Math.random() * scale.length)];
    const t = AU.ctx.currentTime, o = AU.ctx.createOscillator(), o2 = AU.ctx.createOscillator(), g = AU.ctx.createGain();
    o.type = 'sine'; o2.type = 'triangle'; o.frequency.value = f; o2.frequency.value = f / 2;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.07, t + .4); g.gain.exponentialRampToValueAtTime(.001, t + 3.2);
    o.connect(g); o2.connect(g); g.connect(AU.music); o.start(t); o2.start(t); o.stop(t + 3.3); o2.stop(t + 3.3);
  }
}

/* ---------- qualité graphique ---------- */
const QUALITY = { cur: null, fpsAcc: 0, fpsN: 0, fpsT: 0, checks: 0 };
function applyQuality(q) {
  QUALITY.cur = q;
  const pr = q === 'low' ? 1 : q === 'medium' ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(pr); resize();
  tH.enabled = tV.enabled = q !== 'low'; bloom.enabled = q !== 'low';
  const g = window._grass; if (g) g.count = Math.floor(g.userData.full * (q === 'low' ? .4 : q === 'medium' ? .7 : 1));
  const ms = q === 'low' ? 1024 : q === 'medium' ? 2048 : 4096;
  if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  window._pollen.visible = q !== 'low';
}
applyQuality(SETTINGS.quality === 'auto' ? (MOBILE ? 'medium' : 'high') : SETTINGS.quality);
function autoQuality(rawDt) {
  if (SETTINGS.quality !== 'auto' || QUALITY.checks >= 2) return;
  QUALITY.fpsT += rawDt; QUALITY.fpsN++;
  if (QUALITY.fpsT >= 5) {
    const fps = QUALITY.fpsN / QUALITY.fpsT; QUALITY.fpsT = 0; QUALITY.fpsN = 0;
    if (fps < 28 && QUALITY.cur !== 'low') { applyQuality(QUALITY.cur === 'high' ? 'medium' : 'low'); QUALITY.checks++; }
    else QUALITY.checks = 2;
  }
}
function openSettings() {
  modalRefresh = openSettings;
  const q = SETTINGS.quality, opt = (v, l) => `<button class="gbtn tap qbtn ${q === v ? '' : 'off'}" data-q="${v}">${l}</button>`;
  openModal('⚙️ Réglages', `<div class="duo-row"><button class="gbtn tap ${SETTINGS.sound ? '' : 'off'}" id="st-sound">🔊 Sons : ${SETTINGS.sound ? 'oui' : 'non'}</button><button class="gbtn tap ${SETTINGS.music ? '' : 'off'}" id="st-music">🎵 Musique : ${SETTINGS.music ? 'oui' : 'non'}</button></div>
    <h5 class="sub">Qualité graphique</h5><div class="duo-row">${opt('auto', 'Auto')}${opt('low', 'Basse')}${opt('medium', 'Moyenne')}${opt('high', 'Haute')}</div>
    <p class="note">Actuelle : ${{ low: 'basse', medium: 'moyenne', high: 'haute' }[QUALITY.cur]}. Si le jeu saccade, choisis « Basse ».</p>
    <h5 class="sub">Partie</h5><button class="gbtn red tap" id="st-reset">🗑️ Recommencer une nouvelle île</button>`);
  $('st-sound').addEventListener('click', () => { SETTINGS.sound = !SETTINGS.sound; saveSettings(); openSettings(); });
  $('st-music').addEventListener('click', () => { SETTINGS.music = !SETTINGS.music; saveSettings(); openSettings(); });
  document.querySelectorAll('.qbtn').forEach(b => b.addEventListener('click', () => { SETTINGS.quality = b.dataset.q; saveSettings(); QUALITY.checks = 0; applyQuality(b.dataset.q === 'auto' ? (MOBILE ? 'medium' : 'high') : b.dataset.q); openSettings(); }));
  let armed = false;
  $('st-reset').addEventListener('click', () => { if (!armed) { armed = true; $('st-reset').textContent = '⚠️ Toucher encore : tout sera effacé'; return; } NET_ROLE = 'guest'; try { localStorage.removeItem(SAVE_KEY); } catch (e) { } location.reload(); });
}
$('b-set').addEventListener('click', openSettings);

/* ---------- chantiers & bâtiments ---------- */
const siteR = (type, level) => type === 'cabin' ? [2.6, 2.95, 3.0][level - 1] : BUILDS[type].r;
const bName = s => (s.def.names ? s.def.names[s.level - 1] : s.def.name);
let siteSeq = 1;
function addScaffold(s) {
  const h = { cottage: 4.8, nordic: 5.6, timber: 6.6, tropical: 5.8, manor: 7.6, magetower: 9.2, cabin: s.level > 1 ? 6 : 4.8, wall: 2.6, stonewall: 2.6, tower: 5.6, farm: 1.5, workshop: 4, market: 3.6 }[s.type]; if (!h) return;
  const sc2 = new THREE.Group(), R = s.r * .82, k = (s.type === 'wall' || s.type === 'stonewall') ? .35 : 1; s.g.add(sc2); s.scaf = sc2;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => cyl(sc2, .05, .05, h, woodLight, a * R, h / 2, b * R * k));
  for (let y = 1.2; y < h; y += 1.4) { box(sc2, R * 2, .06, .06, woodLight, 0, y, R * k); box(sc2, .06, .06, R * 2 * k, woodLight, R, y, 0); }
  const pile = new THREE.Group(); pile.position.set(s.r + .6, 0, .4); s.g.add(pile); s.pile = pile;
  for (let i = 0; i < 4; i++) box(pile, 1.4, .12, .26, pick(woods), 0, .08 + i * .13, (i % 2) * .1 - .05, 0, rr(-.1, .1), 0);
  rock(pile, .22, .1, .2, .7, [1, .8, 1], 0, .3); rock(pile, .2, -.35, .18, .75, [1, .8, 1], 0, .3);
}
function removeScaffold(s) { if (s.scaf) { s.g.remove(s.scaf); s.scaf = null; } if (s.pile) { s.g.remove(s.pile); s.pile = null; } }
function applySite(s) {
  if (s.upg) { if (s.pile) s.pile.scale.setScalar(Math.max(.001, 1 - sstep(0, .95, s.upg.p))); return; }
  const k = s.p;
  s.found.scale.y = Math.max(.05, sstep(0, .1, k));
  s.wall.visible = k > .1; s.wall.scale.y = Math.max(.001, sstep(.1, .68, k));
  const kr = sstep(.68, 1, k); s.roof.visible = k > .68; s.roof.scale.setScalar(Math.max(.001, kr)); s.roof.position.y = s.roofY + (1 - kr) * 1.6;
  if (s.pile) s.pile.scale.setScalar(Math.max(.001, 1 - sstep(0, .95, k)));
}
function setModel(s, level) {
  if (s.g) scene.remove(s.g);
  const b = makeBuild(s.type, false, level);
  Object.assign(s, { g: b.g, found: b.found, wall: b.wall, roof: b.roof, roofY: b.roofY, light: b.light, flame: b.flame, flame2: b.flame2, crops: b.crops, saw: b.saw, chimney: b.chimney });
  s.g.position.set(s.x, H(s.x, s.z), s.z); s.g.rotation.y = s.ry; scene.add(s.g);
  s.level = level; s.r = siteR(s.type, level);
}
function siteTagHtml(s, txt) { return `<div class="box build"><b>🏗️ ${esc(s.upg ? (s.def.names[s.upg.level - 1]) : bName(s))}</b><small class="st">${txt}</small><div class="pb"><i style="width:0%"></i></div></div><div class="arrow"></div>`; }
function createSite(type, x, z, ry, opts = {}) {
  const def = BUILDS[type];
  const s = { id: opts.id || siteSeq++, type, def, x, z, ry, level: opts.level || 1, p: opts.p != null ? opts.p : 0, done: false, cd: 0, upg: null };
  siteSeq = Math.max(siteSeq, s.id + 1);
  setModel(s, s.level);
  SITES.push(s);
  // les arbres sous un bâtiment sont dégagés
  TREES.forEach(t => { if ((t.state === 'up' || t.state === 'growing') && Math.hypot(t.x - x, t.z - z) < s.r + .4) { t.state = 'cleared'; setTree(t, null, .0001, true); } });
  if (s.p < 1) { addScaffold(s); s.tag = addTag(siteTagHtml(s, 'Les constructeurs arrivent…'), V(x, H(x, z) + def.th, z), 0, 'build'); }
  applySite(s);
  if (s.p >= 1) finishSite(s, true);
  repaintMask(); drawMinimapBuilds();
  return s;
}
function siteProgress(s, amount) {
  if (s.upg) { s.upg.p = Math.min(1, s.upg.p + amount); applySite(s); if (s.upg.p >= 1) finishUpgrade(s); }
  else { s.p = Math.min(1, s.p + amount); applySite(s); if (s.p >= 1) finishSite(s); }
  if (s.tag) { const p = s.upg ? s.upg.p : s.p; s.tag.el.querySelector('.st').textContent = `👷 Construction… ${Math.floor(p * 100)} %`; s.tag.el.querySelector('.pb i').style.width = (p * 100) + '%'; }
}
const needsWork = s => !s.done || !!s.upg;
function finishSite(s, silent) {
  s.done = true; s.p = 1; applySite(s); removeScaffold(s); removeTag(s.tag); s.tag = null;
  if (s.type === 'fire' && !FIRES.includes(s)) FIRES.push(s);
  connectSite(s); repaintMask(); drawMinimapBuilds();
  if (silent || NET_ROLE === 'guest') return;
  sfx('done'); burst(V(s.x, H(s.x, s.z) + .4, s.z), FX.dust, 26, { speed: 4, up: 1.5, size: .16, life: 1.1, spread: s.r * 1.6 }); burst(V(s.x, H(s.x, s.z) + s.def.th * .6, s.z), FX.gold, 24, { speed: 3.5, up: 4, size: .07 }); S.bld++; addXP(s.def.xp); S.builds.push({ id: s.id, type: s.type, x: s.x, z: s.z, ry: s.ry, level: 1 });
  if (s.def.time > 0) floatText(`+${s.def.xp} XP`, V(s.x, H(s.x, s.z) + 3, s.z), '#9fe8ff');
  if (s.type === 'farm') S.stats.farms++;
  if (s.def.cap) { S.stats.cabins++; for (let i = 0; i < s.def.cap; i++) newResident(s); }
  else if (s.def.time > 0) worldToast(s.def.ic, `${s.def.name} terminé(e) !`, s.def.job ? `Assigne un ${JOBS[s.def.job].n.toLowerCase()} dans le menu Village` : `+${s.def.xp} XP pour l'île`);
  netEvent({ t: 'site', s: siteNet(s) });
  checkQuests(); save();
}
function startUpgrade(s) {
  const L = s.level + 1, cost = s.def.up && s.def.up[L - 1];
  if (!cost || s.upg || !s.done) return false;
  if (S.lvl < s.def.upLvl[L - 1]) { toast('🔒', `Île niveau ${s.def.upLvl[L - 1]} requis`); return false; }
  if (!Object.entries(cost).every(([k, v]) => S[k] >= v)) { toast('🪵', 'Ressources insuffisantes', costTxt(cost)); return false; }
  Object.entries(cost).forEach(([k, v]) => S[k] -= v);
  s.upg = { level: L, p: 0 }; addScaffold(s);
  s.tag = addTag(siteTagHtml(s, 'Amélioration…'), V(s.x, H(s.x, s.z) + s.def.th + 1, s.z), 0, 'build');
  worldToast('🏗️', `Amélioration : ${s.def.names[L - 1]}`, 'Les constructeurs s\'y mettent');
  netEvent({ t: 'site', s: siteNet(s) }); save();
  return true;
}
function finishUpgrade(s) {
  const L = s.upg.level; s.upg = null; removeScaffold(s); removeTag(s.tag); s.tag = null;
  setModel(s, L); applySite(s); repaintMask(); drawMinimapBuilds();
  if (NET_ROLE === 'guest') return;
  const b = S.builds.find(b => b.id === s.id); if (b) b.level = L;
  S.stats.upgrades++; addXP(120 * L); floatText(`+${120 * L} XP`, V(s.x, H(s.x, s.z) + 4, s.z), '#9fe8ff');
  worldToast('✨', `${s.def.names[L - 1]} terminée !`, s.type === 'cabin' ? 'Une place de plus : un habitant arrive' : 'Production augmentée');
  if (s.type === 'cabin') newResident(s);
  netEvent({ t: 'site', s: siteNet(s) });
  checkQuests(); save();
}
function demolish(s) {
  const i = SITES.indexOf(s); if (i < 0) return;
  scene.remove(s.g); removeTag(s.tag); SITES.splice(i, 1); if (s.road) { removeRoad(s.road); s.road = null; } const fi = FIRES.indexOf(s); if (fi >= 0) FIRES.splice(fi, 1);
  if (NET_ROLE !== 'guest') {
    const cost = s.def.cost; Object.entries(cost).forEach(([k, v]) => S[k] += Math.floor(v / 2));
    S.builds = S.builds.filter(b => b.id !== s.id); if (s.done) S.bld = Math.max(0, S.bld - 1);
    RESIDENTS.filter(r => r.rec.homeId === s.id).forEach(r => { r.rec.homeId = null; });
    netEvent({ t: 'sitedel', id: s.id }); save();
  }
  repaintMask(); drawMinimapBuilds();
}
const siteNet = s => ({ id: s.id, type: s.type, x: s.x, z: s.z, ry: s.ry, level: s.level, p: s.p, done: s.done, upg: s.upg });
const costTxt = c => Object.entries(c).map(([r, v]) => `${RES_IC[r]} ${v}`).join('  ');

/* ---------- habitants & métiers ---------- */
const JOBS = {
  none: { n: 'Sans emploi', ic: '💤' },
  lumber: { n: 'Bûcheron', ic: '🪓' },
  miner: { n: 'Mineur', ic: '⛏️' },
  gatherer: { n: 'Cueilleur', ic: '🧺' },
  builder: { n: 'Constructeur', ic: '🔨' },
  farmer: { n: 'Fermier', ic: '🌾', need: 'farm' },
  carpenter: { n: 'Menuisier', ic: '🪚', need: 'workshop' },
  merchant: { n: 'Marchand', ic: '🪙', need: 'market' },
  fisher: { n: 'Pêcheur', ic: '🎣' },
  hunter: { n: 'Chasseur nocturne', ic: '🏹' },
};
const NAMES = ['Oswin', 'Mira', 'Elsa', 'Tilo', 'Nora', 'Fenn', 'Ida', 'Jory', 'Basile', 'Rosa', 'Anouk', 'Gaspard', 'Yuna', 'Milo', 'Célia', 'Arno', 'Zélie', 'Théo', 'Maëlle', 'Ivo', 'Lou', 'Edwin', 'Sacha', 'Inès'];
const SHIRTS = ['#8a6a3a', '#7a9a3a', '#5a5a6a', '#3a6a9a', '#9a5a7a', '#3a3a5a', '#6a3a8a', '#aa7a3a', '#c86a3a', '#4a8a7a'];
const stars = rec => Math.min(5, 1 + Math.floor((rec.xp || 0) / 25));
const starTxt = rec => '★'.repeat(stars(rec)) + '☆'.repeat(5 - stars(rec));
const hasBuilding = t => SITES.some(s => s.type === t && s.done);
function suggestJob() {
  const count = j => RESIDENTS.filter(r => r.rec.job === j).length;
  for (const j of ['farmer', 'carpenter', 'merchant']) if (hasBuilding(JOBS[j].need) && !count(j)) return j;
  return ['lumber', 'miner', 'gatherer', 'builder', 'hunter', 'fisher'].sort((a, b) => count(a) - count(b))[0];
}
function homeOf(rec) {
  if (rec.homeId != null) { const s = SITES.find(s => s.id === rec.homeId); if (s) return { x: s.x, z: s.z, ry: s.ry, r: s.r }; }
  if (rec.cottage != null) { const c = COTTAGES[rec.cottage]; return { x: c.position.x, z: c.position.z, ry: c.rotation.y, r: 2.3 * c.scale.x }; }
  return { x: VILLAGE.x, z: VILLAGE.z + 4, ry: 0, r: 0 };
}
function homeDoor(rec) { const h = homeOf(rec); return V(h.x + Math.sin(h.ry) * (h.r + 1), 0, h.z + Math.cos(h.ry) * (h.r + 1)); }
function newResident(site) {
  const rec = { id: S.nextId++, name: NAMES[(S.villagers.length + 2) % NAMES.length], job: 'none', color: SHIRTS[S.villagers.length % SHIRTS.length], trait: TRAITS[S.villagers.length % TRAITS.length], xp: 0, homeId: site ? site.id : null, dress: S.villagers.length % 2 === 1 };
  rec.job = suggestJob();
  S.villagers.push(rec); S.pop++;
  spawnResident(rec, true);
  worldToast(JOBS[rec.job].ic, `Nouvel habitant : ${rec.name} !`, `${JOBS[rec.job].n} · ${rec.trait} · arrive au village`);
  netEvent({ t: 'res', rec });
  return rec;
}
function spawnResident(rec, walkIn) {
  const d = homeDoor(rec);
  const v = place(villager({ shirt: rec.color, pants: '#4a3a2c', hair: ['#2a1a10', '#6a3a1a', '#c88a3a', '#1a120c'][rec.id % 4], dress: !!rec.dress, bun: !!rec.dress && rec.id % 3 === 0, hat: rec.job === 'farmer' ? '#c9a25a' : undefined, anim: 'walk' }), walkIn ? -11 : d.x, walkIn ? 17 : d.z, 0);
  v.userData.netId = rec.id;
  const r = { v, rec, state: walkIn ? 'arrive' : 'work', wp: d.clone(), t: 0, t2: 4, target: null, carry: null, status: '' };
  r.tag = addTag(`<div class="bubble chat" style="display:none"></div><div class="box">${esc(rec.name)}<small class="jt">${JOBS[rec.job].ic} ${JOBS[rec.job].n}</small></div>`, v, 1.75, 'near');
  RESIDENTS.push(r);
  return r;
}
function setJob(id, job) {
  const r = RESIDENTS.find(r => r.rec.id === id); if (!r || !JOBS[job]) return false;
  if (JOBS[job].need && !hasBuilding(JOBS[job].need)) { toast('🏗️', `Construis d'abord : ${BUILDS[JOBS[job].need].name}`); return false; }
  if (NET_ROLE === 'guest') { netSend({ t: 'req', k: 'job', id, job }); return true; }
  release(r); r.rec.job = job; r.carry = null; r.v.userData.carry = false;
  r.tag.el.querySelector('.jt').textContent = `${JOBS[job].ic} ${JOBS[job].n}`;
  netEvent({ t: 'job', id, job }); save();
  return true;
}
function release(r) { if (r.target) { if (r.target.res === r) r.target.res = null; r.target = null; } }

/* ---------- PNJ : déplacements ---------- */
function walkTo(c, tx, tz, speed, dt) {
  const p = c.position, u = c.userData, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
  if (d < .25) { u.stuck = 0; return true; }
  const st = Math.min(d, speed * dt), ox = p.x, oz = p.z;
  p.x += dx / d * st; p.z += dz / d * st;
  if (u.ghostT > 0) { u.ghostT -= dt; p.x = clamp(p.x, BOUNDS.x0, BOUNDS.x1); p.z = clamp(p.z, BOUNDS.z0, BOUNDS.z1); } else collide(p, .35);
  if (Math.hypot(p.x - ox, p.z - oz) < st * .3) { u.stuck = (u.stuck || 0) + dt; if (u.stuck > 1.2) { u.ghostT = 1.5; u.stuck = 0; } } else u.stuck = 0;
  p.y = Math.max(H(p.x, p.z), -1.05) + (u.yOff || 0);
  c.rotation.y = lerpAng(c.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10));
  return false;
}
const faceTo = (c, x, z) => { c.rotation.y = lerpAng(c.rotation.y, Math.atan2(x - c.position.x, z - c.position.z), .25); };
const WOOD_DEPOT = wp(shed, 2.6, 0.6), STONE_DEPOT = wp(mine, 1.9, 5.6);
const FISH_SPOT = V(sx(5) + 2.9, 0, 5);
const PATROL = [V(-6, 0, 9), V(8, 0, 9), V(12, 0, -2), V(-8, 0, -6), V(-4, 0, 2)];
function workerSpeed(r) { return (1 + .15 * (stars(r.rec) - 1)) * (r.rec.trait === 'Travailleur' ? 1.15 : 1) * (S.hungry ? .6 : 1); }
function approach(r, ox, oz, reach, spd, dt) {
  const p = r.v.position, d = Math.hypot(p.x - ox, p.z - oz);
  if (d <= reach) return true;
  const k = (reach * .5) / (d || 1);
  walkTo(r.v, ox + (p.x - ox) * k, oz + (p.z - oz) * k, spd, dt);
  return Math.hypot(p.x - ox, p.z - oz) <= reach;
}
function findWork(kind, pos) {
  let best = null, bd = 34;
  const ok = (x, z) => x > BOUNDS.x0 && x < BOUNDS.x1 && z > BOUNDS.z0 && z < BOUNDS.z1 && Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < 30;
  const list = kind === 'lumber' ? TREES : kind === 'miner' ? ROCKS : BERRIES;
  for (const o of list) {
    if (o.res) continue;
    if (kind === 'lumber' && o.state !== 'up') continue;
    if (kind === 'miner' && (o.hp <= 0 || o.kind === 'crystal')) continue;
    if (kind === 'gatherer' && !o.ready) continue;
    if (!ok(o.x, o.z)) continue;
    const d = Math.hypot(o.x - pos.x, o.z - pos.z); if (d < bd) { bd = d; best = o; }
  }
  return best;
}
function gatherJob(r, dt, kind, spd) {
  const u = r.v.userData;
  if (r.carry) {
    const dep = kind === 'miner' ? STONE_DEPOT : WOOD_DEPOT;
    r.status = `Rapporte ${r.carry.n} ${RES_IC[r.carry.res]} au dépôt`;
    u.carry = kind === 'lumber';
    if (walkTo(r.v, dep.x, dep.z, 2.8 * spd, dt)) {
      S[r.carry.res] += r.carry.n; if (r.carry.iron) S.iron += r.carry.iron;
      floatText(`+${r.carry.n} ${RES_IC[r.carry.res]}${r.carry.iron ? ` +${r.carry.iron} ⛓️` : ''}`, V(dep.x, H(dep.x, dep.z) + 2, dep.z));
      if (kind === 'lumber') S.stats.woodCut += r.carry.n; if (kind === 'miner') S.stats.stoneMined += r.carry.n; if (kind === 'gatherer') S.stats.berries++;
      r.rec.xp++; r.carry = null; u.carry = false; checkQuests();
    } else u.anim = 'walk';
    return;
  }
  let o = r.target;
  if (o && ((kind === 'lumber' && o.state !== 'up') || (kind === 'miner' && o.hp <= 0) || (kind === 'gatherer' && !o.ready))) { release(r); o = null; }
  if (!o) { o = findWork(kind, r.v.position); if (!o) { r.status = 'Ne trouve rien à récolter'; idleNear(r, dt); return; } o.res = r; r.target = o; r.t = .8; }
  const reach = kind === 'lumber' ? 1.5 : kind === 'miner' ? o.r + 1.0 : 1.5;
  r.status = kind === 'lumber' ? 'Coupe un arbre' : kind === 'miner' ? 'Mine un rocher' : 'Cueille des baies';
  if (!approach(r, o.x, o.z, reach, 3 * spd, dt)) { u.anim = 'walk'; return; }
  u.anim = 'mine'; faceTo(r.v, o.x, o.z);
  r.t -= dt; if (r.t > 0) return; r.t = 1.4 / spd;
  if (kind === 'lumber') { if (hitTree(o, r.v.position)) { release(r); r.carry = { res: 'wood', n: 6 }; } }
  else if (kind === 'miner') { const iron = wr() < .2 ? 1 : 0; const done = hitRock(o); r.ironAcc = (r.ironAcc || 0) + iron; if (done) { release(r); r.carry = { res: 'stone', n: S.mineDone ? 9 : 6, iron: r.ironAcc }; r.ironAcc = 0; } }
  else { pickBerry(o); release(r); r.carry = { res: 'food', n: 3 }; }
}
function idleNear(r, dt) {
  const u = r.v.userData, d = homeDoor(r.rec);
  if (r.t > 0) { r.t -= dt; u.anim = 'idle'; return; }
  if (walkTo(r.v, r.wp.x, r.wp.z, 1.8, dt)) { r.t = rr(2, 6); if (r.tag && Math.random() < .35) { const b = r.tag.el.querySelector('.chat'); if (b) { b.textContent = pick(['💬', '☕', '🎵', '😊', '❤️', '🌻', '😄', '🍞']); b.style.display = ''; r.bubT = 2.6; } } for (let k = 0; k < 6; k++) { const x = d.x + rr(-4, 4), z = d.z + rr(-4, 4); if (isFree(x, z, .4)) { r.wp.set(x, 0, z); break; } } u.anim = 'idle'; }
  else u.anim = 'walk';
}
function stationJob(r, dt, type, spd, period, produce, label) {
  const u = r.v.userData, s = SITES.filter(s => s.type === type && s.done).sort((a, b) => Math.hypot(a.x - r.v.position.x, a.z - r.v.position.z) - Math.hypot(b.x - r.v.position.x, b.z - r.v.position.z))[0];
  if (!s) { r.status = `Attend un(e) ${BUILDS[type].name.toLowerCase()}`; idleNear(r, dt); return; }
  if (!r.spot || r.spotSite !== s.id) { r.spotSite = s.id; const a = s.ry + rr(-.5, .5); r.spot = V(s.x + Math.sin(a) * (s.r + 1.1), 0, s.z + Math.cos(a) * (s.r + 1.1)); }
  if (!approach(r, r.spot.x, r.spot.z, .7, 2.6 * spd, dt) && Math.hypot(r.v.position.x - s.x, r.v.position.z - s.z) > s.r + 1.6) { u.anim = 'walk'; r.status = `Va à : ${bName(s)}`; return; }
  u.anim = 'mine'; faceTo(r.v, s.x, s.z); r.status = label;
  r.t2 -= dt * spd * (s.level || 1) ** .5; if (r.t2 <= 0) { r.t2 = period; if (produce(s)) r.rec.xp++; }
}
function workerAI(r, dt, night) {
  const u = r.v.userData, job = r.rec.job, spd = workerSpeed(r);
  if (r.bubT > 0) { r.bubT -= dt; if (r.bubT <= 0 && r.tag) { const b = r.tag.el.querySelector('.chat'); if (b) b.style.display = 'none'; } }
  if (r.state === 'arrive') { const d = homeDoor(r.rec); r.status = 'Arrive au village'; if (walkTo(r.v, d.x, d.z, 3, dt)) r.state = 'work'; u.anim = 'walk'; return; }
  if (night && job !== 'hunter' && !(job === 'builder' && SITES.some(needsWork))) {
    release(r); if (r.carry) { S[r.carry.res] += r.carry.n; r.carry = null; u.carry = false; }
    const d = homeDoor(r.rec); r.status = 'À l\'abri pour la nuit';
    if (walkTo(r.v, d.x, d.z, 3.2, dt)) { r.v.visible = false; u.anim = 'idle'; } else { r.v.visible = true; u.anim = 'walk'; }
    return;
  }
  r.v.visible = true;
  switch (job) {
    case 'lumber': case 'miner': case 'gatherer': gatherJob(r, dt, job, spd); break;
    case 'builder': {
      const s = SITES.find(needsWork);
      if (!s) { r.status = 'Attend un chantier'; idleNear(r, dt); break; }
      r.status = `Construit : ${bName(s)}`;
      if (!approach(r, s.x, s.z, s.r + 1.1, 3.4 * spd, dt)) { u.anim = 'walk'; break; }
      u.anim = 'mine'; faceTo(r.v, s.x, s.z); siteProgress(s, dt / (s.def.time || 1) * .8 * spd); r.workAcc = (r.workAcc || 0) + dt; if (r.workAcc > 20) { r.workAcc = 0; r.rec.xp++; }
      break;
    }
    case 'farmer': stationJob(r, dt, 'farm', spd, 8, s => { const fa = Math.round((2 + s.level) * (S.rain ? 1.5 : 1)); S.food += fa; floatText(`+${fa} 🍒`, V(s.x, H(s.x, s.z) + 2, s.z)); return true; }, 'Cultive les champs'); break;
    case 'carpenter': stationJob(r, dt, 'workshop', spd, 7, s => { if (S.wood < 3) { r.status = 'Manque de bois'; return false; } S.wood -= 3; S.plank += s.level; S.stats.planks += s.level; floatText(`+${s.level} 🟫`, V(s.x, H(s.x, s.z) + 2.5, s.z)); checkQuests(); return true; }, 'Scie des planches'); break;
    case 'merchant': stationJob(r, dt, 'market', spd, 10, s => { const g = 4 + Math.floor(S.pop / 4); S.gold += g; floatText(`+${g} 🪙`, V(s.x, H(s.x, s.z) + 2.5, s.z)); return true; }, 'Tient le marché'); break;
    case 'fisher': {
      r.status = 'Pêche à la rivière';
      if (!approach(r, FISH_SPOT.x, FISH_SPOT.z, .6, 2.6 * spd, dt)) { u.anim = 'walk'; break; }
      u.anim = 'mine'; faceTo(r.v, sx(5), 5); r.t2 -= dt * spd; if (r.t2 <= 0) { r.t2 = 9; if (rand() < .55) { S.food += 3; S.stats.fish++; r.rec.xp++; floatText('+3 🐟', V(FISH_SPOT.x, H(FISH_SPOT.x, 5) + 2, 5)); } }
      break;
    }
    case 'hunter': {
      if (night) {
        const m = nearestMonster(r.v.position, 18);
        if (m) { r.status = 'Combat une ombre'; if (!approach(r, m.position.x, m.position.z, 1.3, 4.2 * spd, dt)) { u.anim = 'walk'; break; } u.anim = 'mine'; faceTo(r.v, m.position.x, m.position.z); r.t -= dt; if (r.t <= 0) { r.t = .9 / spd; hurtMonster(m, r.rec.trait === 'Courageux' ? 2 : 1, r.v.position); r.rec.xp++; } }
        else { r.status = 'Patrouille'; r.pi = r.pi || 0; const p = PATROL[r.pi % PATROL.length]; if (walkTo(r.v, p.x, p.z, 2.6, dt)) r.pi++; u.anim = 'walk'; }
      } else { r.status = 'Se repose (garde de nuit)'; idleNear(r, dt); }
      break;
    }
    default: r.status = 'Flâne au village'; idleNear(r, dt);
  }
}
// Bram, le constructeur du village (toujours présent)
const bram = { v: builder, rec: { id: 1, name: 'Bram', job: 'builder', xp: 60, trait: 'Travailleur' }, state: 'work', wp: V(8.8, 0, .8), t: 0, t2: 0, status: '', fixed: true };
builder.userData.netId = 1;
bram.rec.homeId = null;

/* ---------- récolte ---------- */
const tm4 = new THREE.Matrix4(), tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion(), ts = V(), tAxis = V();
function setTree(t, extraQ, k = 1, stump = false) {
  tq.copy(t.q); if (extraQ) tq.premultiply(extraQ);
  ts.copy(t.s).multiplyScalar(k); tm4.compose(t.p, tq, ts); t.im.setMatrixAt(t.i, tm4); t.im.instanceMatrix.needsUpdate = true;
  if (stump) { ts.copy(t.s); ts.y *= t.state === 'cleared' ? .0001 : .3; if (t.state === 'cleared') ts.multiplyScalar(.0001); tm4.compose(t.p, t.q, ts); }
  else { ts.copy(t.s).multiplyScalar(Math.max(k, .001)); tm4.compose(t.p, tq, ts); }
  t.trunks.setMatrixAt(t.ti, tm4); t.trunks.instanceMatrix.needsUpdate = true;
}
TREES.forEach((t, i) => { t.id = i; });
function hitTree(t, from, dmg = 1) {
  if (t.state !== 'up') return false;
  t.hp -= dmg; t.shake = .3; fxTree(t, dmg > 1);
  if (t.hp <= 0) {
    t.state = 'falling'; t.t = 0; const dx = t.x - from.x, dz = t.z - from.z, l = Math.hypot(dx, dz) || 1; t.fdx = dx / l; t.fdz = dz / l;
    if (t.res) { t.res.target = null; t.res = null; }
  }
  netEvent({ t: 'tree', i: t.id, st: t.state, hp: t.hp, fdx: t.fdx || 0, fdz: t.fdz || 0 });
  return t.state === 'falling';
}
function hitRock(r, dmg = 1) {
  if (r.hp <= 0) return false;
  r.hp = Math.max(0, r.hp - dmg); r.shake = .25; fxRock(r, dmg > 1);
  if (r.hp <= 0) { r.mesh.visible = false; r.t = 0; if (r.res) { r.res.target = null; r.res = null; } } else r.mesh.scale.copy(r.base).multiplyScalar(.55 + r.hp / r.max * .45);
  netEvent({ t: 'rock', i: ROCKS.indexOf(r), hp: r.hp });
  return r.hp <= 0;
}
function pickBerry(b) { burst(V(b.x, H(b.x, b.z) + .8, b.z), FX.berry, 10, { speed: 2.5, up: 2.5, size: .06 }); b.ready = false; b.t = 0; b.berries.visible = false; netEvent({ t: 'berry', i: BERRIES.indexOf(b), ready: false }); }
function updateTrees(dt) {
  for (const t of TREES) {
    if (t.state === 'up' && t.shake > 0) { t.shake -= dt; const a = Math.sin(t.shake * 60) * t.shake * .25; tq2.setFromAxisAngle(tAxis.set(1, 0, 0), a); setTree(t, tq2); if (t.shake <= 0) setTree(t); }
    else if (t.state === 'falling') {
      t.t += dt; const k = Math.min(1, t.t / 1.0);
      tq2.setFromAxisAngle(tAxis.set(t.fdz, 0, -t.fdx), k * k * Math.PI * .48);
      if (t.t < 1.6) setTree(t, tq2, 1, true); else { t.state = 'gone'; t.t = 0; setTree(t, null, .0001, true); const fx = V(t.x + t.fdx * 3, H(t.x + t.fdx * 3, t.z + t.fdz * 3) + .3, t.z + t.fdz * 3); burst(fx, FX.dust, 14, { speed: 3, up: 1.5, size: .13, life: 1, spread: 2.5 }); burst(fx, FX.leaves, 12, { speed: 2.5, up: 2, size: .09, life: 1.6, spread: 3, gravity: 3 }); }
    } else if (t.state === 'gone') { t.t += dt; if (t.t > 75 && NET_ROLE !== 'guest' && !SITES.some(s => Math.hypot(s.x - t.x, s.z - t.z) < s.r + .6)) { t.state = 'growing'; t.t = 0; t.hp = 4; netEvent({ t: 'tree', i: t.id, st: 'growing', hp: 4 }); } }
    else if (t.state === 'growing') { t.t += dt; const k = Math.min(1, t.t / 4); setTree(t, null, .1 + .9 * (1 - Math.pow(1 - k, 3))); if (k >= 1) t.state = 'up'; }
  }
}
function updateResources(dt) {
  ROCKS.forEach((r, i) => {
    if (r.shake > 0) { r.shake -= dt; r.mesh.position.x = r.x + Math.sin(r.shake * 80) * r.shake * .3; if (r.shake <= 0) r.mesh.position.x = r.x; }
    if (r.hp <= 0 && NET_ROLE !== 'guest') { r.t += dt; if (r.t > 50) { r.hp = r.max; r.t = 0; r.mesh.visible = true; r.mesh.scale.copy(r.base); netEvent({ t: 'rock', i, hp: r.hp }); } }
  });
  BERRIES.forEach((b, i) => { if (!b.ready && NET_ROLE !== 'guest') { b.t += dt; if (b.t > 35) { b.ready = true; b.berries.visible = true; netEvent({ t: 'berry', i, ready: true }); } } });
}

/* ---------- monstres ---------- */
const monGeo = new THREE.SphereGeometry(.55, 18, 14), eyeGeo = new THREE.SphereGeometry(.075, 8, 6), hornGeo = new THREE.ConeGeometry(.09, .3, 6);
const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, .8, 1.8) }), bossEyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, .6, .3) });
let monSeq = 1;
function makeMonster(id, boss, x, z) {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: boss ? '#3a1018' : '#2b1a3d', roughness: .35, emissive: boss ? '#601020' : '#3a1060', emissiveIntensity: .5 });
  const body = new THREE.Mesh(monGeo, mat); body.castShadow = true; g.add(body);
  [-.17, .17].forEach(ex => { const e = new THREE.Mesh(eyeGeo, boss ? bossEyeMat : eyeMat); e.position.set(ex, .12, .48); body.add(e); const h = new THREE.Mesh(hornGeo, mat); h.position.set(ex * 1.8, .5, 0); h.rotation.z = -ex * 2.5; body.add(h); });
  if (boss) for (let k = 0; k < 6; k++) { const sp = new THREE.Mesh(hornGeo, mat); const a = k / 6 * TAU; sp.position.set(Math.cos(a) * .4, .3, Math.sin(a) * .4 - .1); sp.rotation.set(Math.sin(a) * .8, 0, -Math.cos(a) * .8); body.add(sp); }
  g.position.set(x, H(x, z), z); g.scale.setScalar(.01); scene.add(g);
  g.userData = { id, boss, hp: boss ? 24 : 4, cd: 0, hurt: 0, age: 0, dead: false, dt: 0, body, mat, ph: rr(0, 6), kb: V(), size: boss ? 2.3 : 1 };
  MONSTERS.push(g);
  return g;
}
let bossDay = -1, bossTag = null;
const bloodMoon = () => S.day % 4 === 0;
function spawnMonster(boss) {
  for (let tries = 0; tries < 12; tries++) {
    const a = rr(0, TAU), x = clamp(VILLAGE.x + Math.cos(a) * rr(17, 22), BOUNDS.x0 + 1, BOUNDS.x1 - 1), z = clamp(VILLAGE.z + Math.sin(a) * rr(14, 18), BOUNDS.z0 + 1, BOUNDS.z1 - 1);
    if (streamD(x, z) < 3 || Math.hypot(x - player.position.x, z - player.position.z) < 9) continue;
    const m = makeMonster(monSeq++, boss, x, z);
    if (boss) { bossTag = addTag('<div class="box" style="border-color:#ff5a4a;color:#ffd0c8">💀 Colosse d\'ombre<small>Boss de la Lune rouge</small></div>', m, 2.6); }
    return m;
  }
}
function hurtMonster(m, dmg, from) {
  const u = m.userData; if (u.dead) return;
  if (NET_ROLE === 'guest') { netSend({ t: 'req', k: 'hitmon', id: u.id, dmg }); u.hurt = .18; return; }
  u.hp -= dmg; u.hurt = .18; burst(m.position.clone().setY(m.position.y + .6 * u.size), FX.shadow, 8, { speed: 3, up: 2.5, size: .07 });
  u.kb.set(m.position.x - from.x, 0, m.position.z - from.z).normalize().multiplyScalar(u.boss ? .5 : 1.6);
  if (u.hp <= 0) {
    u.dead = true; u.dt = 0; S.stats.kills++; burst(m.position.clone().setY(m.position.y + .6 * u.size), FX.shadow, u.boss ? 60 : 22, { speed: u.boss ? 6 : 4, up: 4, size: u.boss ? .16 : .1, life: 1.1 }); burst(m.position.clone().setY(m.position.y + .8), FX.gold, u.boss ? 30 : 6, { speed: 3, up: 4, size: .06 });
    if (u.boss) { S.ess += 5; S.gold += 60; S.stats.bosses++; addXP(200); removeTag(bossTag); bossTag = null; worldToast('🏆', 'Colosse d\'ombre vaincu !', '+60 🪙 · +5 ✨ · +200 XP'); banner('Colosse d\'ombre vaincu !', '+60 🪙 · +5 🔮 · +200 XP', '🏆'); }
    else { S.ess++; S.gold += 5; addXP(20); }
    floatText(u.boss ? '+5 ✨ +60 🪙' : '+1 ✨ +5 🪙', m.position.clone().setY(m.position.y + 1.4 * u.size), '#d9b3ff'); checkQuests();
  }
}
let shakeT = 0, deathT = 0;
function damagePlayer(n) {
  if (ME.hp <= 0) return;
  n = Math.max(1, Math.round(n * (1 - [0, .25, .45][ME.gear.armor])));
  ME.hp = Math.max(0, ME.hp - n); $('hurt').style.opacity = '1'; shakeT = .25; sfx('hurt');
  floatText('-' + n, player.position.clone().setY(player.position.y + 2.2), '#ff6a5a', false);
  if (ME.hp <= 0) { deathT = 2.5; toast('💫', 'Tu t\'es évanoui…', 'On te ramène au village'); }
}
let spawnT = 3;
function monstersAI(dt, t, night) {
  if (night) {
    if (bloodMoon() && bossDay !== S.day && S.time >= 20.5) { bossDay = S.day; spawnMonster(true); }
    spawnT -= dt; const max = 4 + Math.floor(S.lvl / 5) + (bloodMoon() ? 3 : 0);
    if (spawnT <= 0 && MONSTERS.filter(m => !m.userData.dead).length < max) { spawnMonster(false); spawnT = bloodMoon() ? rr(2.5, 4.5) : rr(4, 7); }
  }
  const targets = [player]; if (NET_ROLE === 'host' && netMate.on) targets.push(mate);
  for (let i = MONSTERS.length - 1; i >= 0; i--) {
    const m = MONSTERS[i], u = m.userData;
    if (u.dead) { u.dt += dt; m.scale.setScalar(Math.max(.001, (1 - u.dt / .45) * u.size)); m.position.y += dt * 1.5; if (u.dt >= .45) { scene.remove(m); u.mat.dispose(); MONSTERS.splice(i, 1); if (u.boss) { removeTag(bossTag); bossTag = null; } } continue; }
    if (!night) { u.dead = true; u.dt = 0; continue; }
    u.age += dt; u.cd -= dt; u.hurt -= dt;
    m.scale.setScalar((u.age < .6 ? Math.max(.01, u.age / .6) : 1) * u.size);
    let tgt = null, td = 16;
    targets.forEach(p => { const hp = p === player ? ME.hp : netMate.hp; if (hp <= 0) return; const d = m.position.distanceTo(p.position); if (d < td) { td = d; tgt = p; } });
    const tp = tgt ? tgt.position : VILLAGE;
    const dx = tp.x - m.position.x, dz = tp.z - m.position.z, d = Math.hypot(dx, dz), reach = 1.15 * (u.boss ? 1.8 : 1);
    if (d > reach) { const sp = (tgt ? (u.boss ? 1.9 : 2.6) : 1.6) * dt; m.position.x += dx / d * sp; m.position.z += dz / d * sp; }
    else if (tgt && u.cd <= 0) { u.cd = u.boss ? 1.6 : 1.3; const dmg = u.boss ? 14 : 7; if (tgt === player) damagePlayer(dmg); else netSend({ t: 'dmg', n: dmg }); }
    m.position.addScaledVector(u.kb, dt * 6); u.kb.multiplyScalar(Math.max(0, 1 - dt * 7));
    collide(m.position, .5 * u.size);
    m.position.y = Math.max(H(m.position.x, m.position.z), -1.05);
    m.rotation.y = lerpAng(m.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-dt * 8));
    animMonster(m, t);
  }
}
function animMonster(m, t) {
  const u = m.userData, hop = Math.abs(Math.sin(t * (u.boss ? 4 : 6) + u.ph)); u.body.position.y = .5 + hop * .32; u.body.scale.set(1 + (1 - hop) * .12, .8 + hop * .15, 1 + (1 - hop) * .12);
  u.mat.emissive.set(u.hurt > 0 ? '#ff2020' : (u.boss ? '#601020' : '#3a1060')); u.mat.emissiveIntensity = u.hurt > 0 ? 2 : .5;
}
const arrowGeo = new THREE.CylinderGeometry(.03, .03, .8, 4); arrowGeo.rotateX(Math.PI / 2);
const arrowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.2) });
function shootArrow(from, target, onHit, share = true) {
  const m = new THREE.Mesh(arrowGeo, arrowMat); m.position.copy(from); scene.add(m);
  ARROWS.push({ m, from: from.clone(), target, onHit, t: 0, dur: Math.max(.15, from.distanceTo(target.position) / 22) });
  if (share) netEvent({ t: 'arrow', f: [from.x, from.y, from.z], to: [target.position.x, target.position.y, target.position.z] });
}
function arrowsAI(dt) {
  for (let i = ARROWS.length - 1; i >= 0; i--) {
    const a = ARROWS[i]; a.t += dt; const k = Math.min(1, a.t / a.dur);
    const pos = a.from.clone().lerp(tmpV.copy(a.target.position).setY(a.target.position.y + .5), k); pos.y += Math.sin(k * Math.PI) * 1.1;
    a.m.lookAt(pos); a.m.position.copy(pos);
    if (k >= 1) { scene.remove(a.m); ARROWS.splice(i, 1); if (a.onHit) a.onHit(); }
  }
}
function nearestMonster(p, maxD) { let best = null, bd = maxD; MONSTERS.forEach(m => { if (m.userData.dead || m.userData.age < .6) return; const d = m.position.distanceTo(p); if (d < bd) { bd = d; best = m; } }); return best; }
function towersAI(dt, night) {
  SITES.forEach(s => {
    if (!s.done || s.type !== 'tower') return;
    if (s.light) s.light.intensity = night ? 7 : 0;
    s.cd -= dt; if (!night || s.cd > 0 || NET_ROLE === 'guest') return;
    const top = V(s.x, H(s.x, s.z) + 5.4, s.z), m = nearestMonster(top, 14);
    if (m) { s.cd = 1.6; shootArrow(top, m, () => hurtMonster(m, 1, top)); }
  });
}

/* ---------- cerfs ---------- */
function hurtDeer(d, dmg, from, byMe) {
  if (d.state === 'dead') return;
  if (NET_ROLE === 'guest') { netSend({ t: 'req', k: 'hitdeer', id: d.id }); return; }
  d.hp -= dmg; d.fleeT = 3; burst(d.g.position.clone().setY(d.g.position.y + 1.2), FX.fur, 8, { speed: 2.5, up: 2, size: .06 }); d.flee = V(d.g.position.x - from.x, 0, d.g.position.z - from.z).normalize();
  if (d.hp <= 0) {
    d.state = 'dead'; d.dt = 0; S.food += 6; S.leather += 1; S.stats.deer++; addXP(15);
    floatText('+6 🍖 +1 🦌', d.g.position.clone().setY(d.g.position.y + 2), '#ffd08a'); checkQuests();
  }
}
function deerAI(dt, t) {
  DEER.forEach(d => {
    const p = d.g.position;
    if (d.state === 'dead') {
      d.dt += dt; d.g.rotation.z = Math.min(1.5, d.dt * 3);
      if (d.dt > 2) d.g.visible = false;
      if (d.dt > 70) { d.state = 'graze'; d.hp = 3; d.g.rotation.z = 0; d.g.visible = true; placeDeerRandom(d, rand); }
      return;
    }
    let near = 99; [player, mate].forEach(c => { near = Math.min(near, Math.hypot(c.position.x - p.x, c.position.z - p.z)); });
    if (near < 4.5 && d.fleeT <= 0) { d.fleeT = 2.5; const c = Math.hypot(player.position.x - p.x, player.position.z - p.z) < Math.hypot(mate.position.x - p.x, mate.position.z - p.z) ? player : mate; d.flee = V(p.x - c.position.x, 0, p.z - c.position.z).normalize(); }
    let mv = 0;
    if (d.fleeT > 0) { d.fleeT -= dt; const sp = 6.5 * dt; p.x += d.flee.x * sp; p.z += d.flee.z * sp; mv = 1; d.g.rotation.y = lerpAng(d.g.rotation.y, Math.atan2(d.flee.x, d.flee.z), .3); }
    else if (d.state === 'walk') { const dx = d.wp.x - p.x, dz = d.wp.z - p.z, l = Math.hypot(dx, dz); if (l < .3) { d.state = 'graze'; d.t = rr(2, 6); } else { p.x += dx / l * 1.4 * dt; p.z += dz / l * 1.4 * dt; mv = .5; d.g.rotation.y = lerpAng(d.g.rotation.y, Math.atan2(dx, dz), .1); } }
    else { d.t -= dt; if (d.t <= 0) { d.state = 'walk'; const z = d.zone; d.wp.set(z.x0 + rand() * (z.x1 - z.x0), 0, z.z0 + rand() * (z.z1 - z.z0)); } }
    const z = d.zone; p.x = clamp(p.x, z.x0 - 3, z.x1 + 3); p.z = clamp(p.z, z.z0 - 3, z.z1 + 3);
    collide(p, .6); p.y = Math.max(H(p.x, p.z), -1);
    animDeer(d, t, mv);
  });
}
function animDeer(d, t, mv) {
  const s = Math.sin(t * (mv > .8 ? 16 : 8)) * .55 * Math.min(1, mv * 1.6);
  d.legs[0].rotation.x = s; d.legs[3].rotation.x = s; d.legs[1].rotation.x = -s; d.legs[2].rotation.x = -s;
  d.head.rotation.x = mv ? 0 : .6 + Math.sin(t * 2 + d.id) * .1;
}

/* ---------- PNJ : porteur & Lyra ---------- */
const CARRY_PTS = [WOOD_DEPOT, V(-3.6, 0, 5.4), STONE_DEPOT];
const CR = { i: 1, dir: 1, wait: 0 };
function carrierAI(dt) {
  const u = carrier.userData;
  if (CR.wait > 0) { CR.wait -= dt; u.anim = 'idle'; return; }
  const p = CARRY_PTS[CR.i];
  if (walkTo(carrier, p.x, p.z, 2.4, dt)) { if (CR.i === 0 || CR.i === CARRY_PTS.length - 1) { CR.wait = 1.6; CR.dir *= -1; } CR.i += CR.dir; }
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
    else { u.anim = 'idle'; faceTo(lyra, foe.position.x, foe.position.z); if (LY.cd <= 0) { LY.cd = 1.4; u.shoot = .35; const from = lyra.position.clone().setY(lyra.position.y + 1.3); shootArrow(from, foe, () => hurtMonster(foe, 1, from)); } }
  } else if (night) {
    mode = 'Monte la garde';
    const tx = player.position.x + 1.8, tz = player.position.z + 1.8;
    u.anim = Math.hypot(lyra.position.x - tx, lyra.position.z - tz) > 1 ? (walkTo(lyra, tx, tz, 5.5, dt), 'walk') : 'idle';
  } else {
    mode = 'Chasse en prairie';
    const prey = DEER.find(d => d.state !== 'dead' && d.g.visible && Math.hypot(d.g.position.x - lyra.position.x, d.g.position.z - lyra.position.z) < 11);
    if (prey && LY.cd <= 0 && rand() < .02) { LY.cd = 6; u.shoot = .35; faceTo(lyra, prey.g.position.x, prey.g.position.z); const from = lyra.position.clone().setY(lyra.position.y + 1.3); shootArrow(from, prey.g, () => hurtDeer(prey, 1, from)); }
    if (LY.t > 0) { LY.t -= dt; u.anim = 'idle'; }
    else if (walkTo(lyra, LY.wp.x, LY.wp.z, 2.6, dt)) { LY.t = rr(2, 5); LY.wp.set(rr(6, Math.min(20, BOUNDS.x1 - 2)), 0, rr(1, 16)); u.anim = 'idle'; }
    else u.anim = 'walk';
  }
  if (mode !== LY.mode) { LY.mode = mode; $('ly-s').textContent = 'IA · ' + mode; }
}

/* ---------- actions du joueur ---------- */
let curTarget = null, actCD = 0, actHeld = false;
function findTarget(from) {
  const p = from || player.position; let best = null, bd = 1e9;
  const cand = (obj, d, type) => { if (d < bd) { bd = d; best = { obj, type }; } };
  for (const m of MONSTERS) { if (m.userData.dead) continue; const d = m.position.distanceTo(p); if (d < 2.6 * m.userData.size) cand(m, d - 100, 'monster'); else if (d < 11) cand(m, d - 50, 'shoot'); }
  for (const t of TREES) { if (t.state !== 'up') continue; const dx = t.x - p.x, dz = t.z - p.z; if (Math.abs(dx) > 2.2 || Math.abs(dz) > 2.2) continue; const d = Math.hypot(dx, dz); if (d < 1.85) cand(t, d, 'tree'); }
  for (const r of ROCKS) { if (r.hp <= 0) continue; const d = Math.hypot(r.x - p.x, r.z - p.z) - r.r; if (d < 1.4) cand(r, d, 'rock'); }
  for (const b of BERRIES) { if (!b.ready) continue; const d = Math.hypot(b.x - p.x, b.z - p.z) - .75; if (d < 1.3) cand(b, d, 'berry'); }
  for (const dd of DEER) { if (dd.state === 'dead') continue; const d = Math.hypot(dd.g.position.x - p.x, dd.g.position.z - p.z); if (d < 12) cand(dd, d + 3, 'deer'); }
  for (const s of SITES) { const d = Math.hypot(s.x - p.x, s.z - p.z) - s.r; if (d < 1.5) cand(s, d + (needsWork(s) ? 0 : 2), needsWork(s) ? 'site' : 'bsite'); }
  if (!S.mineDone) { const d = Math.hypot(MINE_PT.x - p.x, MINE_PT.z - p.z); if (d < 2.9) cand(null, d, 'mine'); }
  if (!best && streamD(p.x, p.z) < 3.4) best = { obj: null, type: 'fish' };
  return best;
}
const ACT = { tree: ['🪓', 'Couper', 1], rock: ['⛏️', 'Miner', 0], berry: ['🍒', 'Cueillir', 5], monster: ['🗡️', 'Attaquer', 2], shoot: ['🏹', 'Tirer', 3], deer: ['🏹', 'Chasser', 3], site: ['🔨', 'Aider', 0], bsite: ['⚙️', 'Gérer', 0], mine: ['🪨', 'Livrer', 0], fish: ['🎣', 'Pêcher', 4] };
function targetPos(tg) {
  if (!tg) return null;
  switch (tg.type) {
    case 'tree': return V(tg.obj.x, H(tg.obj.x, tg.obj.z) + 2.4, tg.obj.z);
    case 'rock': return V(tg.obj.x, H(tg.obj.x, tg.obj.z) + 1.2, tg.obj.z);
    case 'berry': return V(tg.obj.x, H(tg.obj.x, tg.obj.z) + 1.6, tg.obj.z);
    case 'monster': case 'shoot': return tg.obj.position.clone().setY(tg.obj.position.y + 1.6 * tg.obj.userData.size);
    case 'deer': return tg.obj.g.position.clone().setY(tg.obj.g.position.y + 2.3);
    case 'site': case 'bsite': return V(tg.obj.x, H(tg.obj.x, tg.obj.z) + Math.min(tg.obj.def.th - 1.2, 5), tg.obj.z);
    case 'mine': return V(MINE_PT.x, MINE_PT.y + 1.6, MINE_PT.z);
    case 'fish': return null;
  }
}
const tgId = tg => { switch (tg.type) { case 'tree': return tg.obj.id; case 'rock': return ROCKS.indexOf(tg.obj); case 'berry': return BERRIES.indexOf(tg.obj); case 'monster': case 'shoot': return tg.obj.userData.id; case 'deer': return tg.obj.id; case 'site': case 'bsite': return tg.obj.id; default: return 0; } };
function tgFromId(type, id) {
  switch (type) {
    case 'tree': return TREES[id]; case 'rock': return ROCKS[id]; case 'berry': return BERRIES[id];
    case 'monster': case 'shoot': return MONSTERS.find(m => m.userData.id === id); case 'deer': return DEER[id];
    case 'site': case 'bsite': return SITES.find(s => s.id === id); default: return null;
  }
}
function doAction() {
  if (buildMode) { placeBuild(); return; }
  if (ME.hp <= 0 || actCD > 0) return;
  const tg = curTarget; if (!tg) return;
  if (tg.type === 'bsite') { actCD = .4; openBuilding(tg.obj); return; }
  if (ME.st < 4) { floatText('😮‍💨 Fatigué', player.position.clone().setY(player.position.y + 2.4), '#ffe08a', false); actCD = .5; return; }
  actCD = tg.type === 'fish' ? 1.2 : .42; ME.st -= 4;
  player.userData[tg.type === 'shoot' || tg.type === 'deer' ? 'shoot' : 'swing'] = .35;
  const tp = targetPos(tg);
  if (tp) player.rotation.y = Math.atan2(tp.x - player.position.x, tp.z - player.position.z);
  else if (tg.type === 'fish') player.rotation.y = Math.atan2(sx(player.position.z) - player.position.x, 0);
  useSlot(ACT[tg.type][2], true);
  sfx({ tree: 'chop', rock: 'pick', berry: 'berry', monster: 'hit', shoot: 'arrow', deer: 'arrow', site: 'build', mine: 'pick', fish: 'splash' }[tg.type]);
  gainMe(3);
  if (NET_ROLE === 'guest') { netSend({ t: 'req', k: 'act', type: tg.type, id: tgId(tg) }); const fr = { tree: 'wood', rock: tg.obj && tg.obj.kind === 'crystal' ? null : 'stone', berry: 'food' }[tg.type]; if (fr && tp) flyRes(fr, tp, 2); return; }
  performAction(tg.type, tg.obj, player);
}
// exécutée sur l'hôte (ou en solo) pour le joueur local comme pour le joueur distant
function performAction(type, o, actor) {
  const ap = actor.position, tp = targetPos(type === 'fish' ? null : { type, obj: o }) || ap.clone().setY(ap.y + 2.2);
  const g = gearOf(actor), me = actor === player, crit = Math.random() < .12;
  const critFx = () => { if (crit) { floatText('CRITIQUE !', tp.clone().setY(tp.y + 1.2), '#ffe14a'); if (me) shakeT = Math.max(shakeT, .12); } };
  switch (type) {
    case 'tree': {
      if (!o || o.state !== 'up') return; const n = 2 + g.tool; S.wood += n; S.stats.woodCut += n; floatText(`+${n} 🪵`, tp); if (me) flyRes('wood', tp, 2); addXP(4); critFx();
      if (hitTree(o, ap, 1 + (g.tool >= 1 ? 1 : 0) + (crit ? 1 : 0))) { S.wood += 4; S.stats.woodCut += 4; addXP(10); floatText('+4 🪵 Timber !', tp.clone().setY(tp.y + .8), '#ffd08a'); if (me) flyRes('wood', tp, 3); }
      break;
    }
    case 'rock': {
      if (!o || o.hp <= 0) return; critFx();
      if (o.kind === 'crystal') { const c = 1 + (g.tool >= 2 ? 1 : 0); S.crystal += c; S.stone++; floatText(`+${c} 💎 +1 🪨`, tp, '#9ff0ff'); if (me) flyRes('stone', tp, 1); addXP(8); }
      else { const n = (S.mineDone ? 3 : 2) + g.tool; S.stone += n; S.stats.stoneMined += n; floatText(`+${n} 🪨`, tp); if (me) flyRes('stone', tp, 2); addXP(4); if (rand() < .22) { S.iron++; floatText('+1 ⛓️ Fer', tp.clone().setY(tp.y + .6), '#cfe0ff'); if (me) flyRes('iron', tp, 1); } }
      hitRock(o, 1 + (g.tool >= 2 ? 1 : 0) + (crit ? 1 : 0)); break;
    }
    case 'berry': { if (!o || !o.ready) return; pickBerry(o); S.food += 3; S.stats.berries++; floatText('+3 🍒', tp); if (me) flyRes('food', tp, 2); addXP(5); break; }
    case 'monster': if (o && !o.userData.dead) { critFx(); hurtMonster(o, 1 + g.weapon + (crit ? 1 : 0), ap); } break;
    case 'shoot': if (o && !o.userData.dead) { const from = ap.clone().setY(ap.y + 1.4), dmg = 1 + g.bow + (crit ? 1 : 0); critFx(); shootArrow(from, o, () => hurtMonster(o, dmg, from)); } break;
    case 'deer': if (o && o.state !== 'dead') { const from = ap.clone().setY(ap.y + 1.4), dmg = 1 + g.bow; shootArrow(from, o.g, () => hurtDeer(o, dmg, from)); } break;
    case 'site': if (o && needsWork(o)) { siteProgress(o, .05); addXP(3); floatText('🔨 +5 %', V(o.x, H(o.x, o.z) + 2.5, o.z)); burst(V(o.x, H(o.x, o.z) + 1, o.z), FX.dust, 5, { speed: 2, up: 2, size: .08 }); } break;
    case 'mine': {
      const amt = Math.min(10, S.stone, 60 - S.mineStone);
      if (amt <= 0) { floatText(S.mineDone ? 'Mine déjà améliorée' : 'Pas de pierre 🪨', tp, '#ff9a8a'); break; }
      S.stone -= amt; S.mineStone += amt; S.stats.mineDeliver += amt; addXP(amt * 3); floatText(`-${amt} 🪨 livrées`, tp); burst(tp, FX.stone, 8, { speed: 2, up: 2 });
      if (S.mineStone >= 60) { S.mineDone = true; addXP(250); addMineFlag(); banner('Mine niveau 3 !', '+50 % de pierre à chaque coup', '⛏️'); worldToast('⛏️', 'Mine de pierre niveau 3 !', 'Chaque coup de pioche rapporte +50 % de pierre'); }
      updateMineTag(); break;
    }
    case 'fish': {
      const wpt = V(sx(ap.z), -.7, ap.z); burst(wpt, FX.water, 8, { speed: 1.5, up: 2.5, size: .06 });
      if (rand() < .5 + g.tool * .1) { S.food += 3; S.stats.fish++; addXP(6); floatText('+3 🐟', ap.clone().setY(ap.y + 2.2)); if (me) flyRes('food', ap.clone().setY(ap.y + 1.5), 2); }
      else floatText('… ça ne mord pas', ap.clone().setY(ap.y + 2.2), '#cfe0ff');
      break;
    }
  }
  checkQuests();
}

/* ---------- placement ---------- */
let buildMode = null, ghost = null, ghostRot = 0, ghostOK = false, ghostManual = false;
const ghostPos = V();
const canAfford = cost => Object.entries(cost).every(([k, v]) => S[k] >= v);
let bmenuCat = 'Habitat';
function renderBuildMenu() {
  const cats = ['Habitat', 'Production', 'Défense', 'Décoration'];
  $('bmenu').innerHTML = `<div class="tabs">${cats.map(c => `<span class="tab tap ${c === bmenuCat ? 'on' : ''}" data-cat="${c}">${c}</span>`).join('')}</div>` + Object.entries(BUILDS).filter(([, d]) => d.cat === bmenuCat).map(([k, d]) => {
    const locked = S.lvl < d.lvl, ok = !locked && canAfford(d.cost);
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
  const tab = e.target.closest('.tab'); if (tab) { bmenuCat = tab.dataset.cat; renderBuildMenu(); return; }
  const c = e.target.closest('.bcard'); if (!c) return;
  const type = c.dataset.b, def = BUILDS[type];
  if (S.lvl < def.lvl) { toast('🔒', `${def.name} : île niveau ${def.lvl} requis`); return; }
  if (!canAfford(def.cost)) { toast('🪵', 'Ressources insuffisantes', costTxt(def.cost)); return; }
  $('bmenu').classList.add('hidden'); startPlacement(type);
});
function startPlacement(type) {
  if (ghost) scene.remove(ghost);
  buildMode = type; ghost = makeBuild(type, true).g; scene.add(ghost); ghostRot = type === 'path' ? 0 : player.rotation.y; ghostManual = type === 'path'; sfx('click');
  ['b-cancel', 'b-rot'].forEach(id => $(id).classList.remove('hidden')); ['b-build', 'b-village'].forEach(id => $(id).classList.add('hidden'));
}
function cancelBuild() {
  if (ghost) scene.remove(ghost); ghost = null; buildMode = null;
  ['b-cancel', 'b-rot'].forEach(id => $(id).classList.add('hidden')); ['b-build', 'b-village'].forEach(id => $(id).classList.remove('hidden'));
}
function updateGhost() {
  if (!ghost) return;
  const def = BUILDS[buildMode], d = def.r + 1.8, f = player.rotation.y;
  ghostPos.set(player.position.x + Math.sin(f) * d, 0, player.position.z + Math.cos(f) * d);
  if (buildMode === 'path') { ghostPos.x = Math.round(ghostPos.x / 2) * 2; ghostPos.z = Math.round(ghostPos.z / 2) * 2; }
  ghostPos.y = H(ghostPos.x, ghostPos.z);
  if (!ghostManual) { const { q } = nearestRoad(ghostPos); if (q) ghostRot = Math.round(Math.atan2(q.x - ghostPos.x, q.z - ghostPos.z) / (Math.PI / 12)) * (Math.PI / 12); }
  ghost.position.copy(ghostPos); ghost.rotation.y = ghostRot;
  ghostOK = isFree(ghostPos.x, ghostPos.z, def.r) && (def.walk || Math.hypot(ghostPos.x - player.position.x, ghostPos.z - player.position.z) > def.r + .3);
  ghostMat.color.set(ghostOK ? '#6dff8a' : '#ff5a4a');
}
function placeBuild() {
  const def = BUILDS[buildMode];
  if (!ghostOK) { toast('⚠️', 'Emplacement impossible', 'Trouve un terrain dégagé (pas d\'arbre, de rocher ni d\'eau)'); return; }
  if (!canAfford(def.cost)) { toast('🪵', 'Ressources insuffisantes'); cancelBuild(); return; }
  const req = { type: buildMode, x: ghostPos.x, z: ghostPos.z, ry: ghostRot }; sfx('build');
  if (NET_ROLE === 'guest') netSend({ t: 'req', k: 'build', ...req });
  else doBuild(req);
  if (buildMode === 'path' || def.cat === 'Décoration') { if (!canAfford(def.cost)) cancelBuild(); }   // on enchaîne les routes / décorations
  else cancelBuild();
}
function doBuild({ type, x, z, ry }) {
  const def = BUILDS[type]; if (!def || S.lvl < def.lvl || !canAfford(def.cost) || !isFree(x, z, def.r)) return false;
  Object.entries(def.cost).forEach(([r, v]) => S[r] -= v);
  const s = createSite(type, x, z, ry, { p: def.time ? 0 : 1 });
  if (!def.time) { finishSite(s); }
  else { worldToast('🏗️', `Chantier : ${def.name}`, 'Les constructeurs vont chercher les matériaux'); netEvent({ t: 'site', s: siteNet(s) }); }
  save(); return true;
}

/* ---------- quêtes ---------- */
const QUESTS = [
  { id: 'wood', ic: '🪓', txt: 'Couper du bois', goal: 20, key: 'woodCut', xp: 80, gold: 50 },
  { id: 'berry', ic: '🍒', txt: 'Cueillir des baies', goal: 4, key: 'berries', xp: 40, gold: 20 },
  { id: 'stone', ic: '⛏️', txt: 'Miner de la pierre', goal: 16, key: 'stoneMined', xp: 80, gold: 50 },
  { id: 'cabin', ic: '🏠', txt: 'Faire bâtir une maison', goal: 1, key: 'cabins', xp: 150, gold: 80 },
  { id: 'farm', ic: '🌾', txt: 'Construire une ferme', goal: 1, key: 'farms', xp: 150, gold: 80 },
  { id: 'mine', ic: '🏗️', txt: 'Améliorer la mine (livrer 🪨)', goal: 34, key: 'mineDeliver', xp: 200, gold: 120 },
  { id: 'deer', ic: '🦌', txt: 'Chasser 3 cerfs (en duo)', goal: 3, key: 'deer', xp: 120, gold: 60 },
  { id: 'night', ic: '🌙', txt: 'Vaincre des ombres nocturnes', goal: 5, key: 'kills', xp: 150, gold: 100 },
  { id: 'fish', ic: '🎣', txt: 'Pêcher des poissons', goal: 3, key: 'fish', xp: 60, gold: 30 },
  { id: 'planks', ic: '🟫', txt: 'Produire 10 planches (atelier)', goal: 10, key: 'planks', xp: 150, gold: 80 },
  { id: 'upgrade', ic: '✨', txt: 'Améliorer une maison', goal: 1, key: 'upgrades', xp: 200, gold: 120 },
  { id: 'boss', ic: '💀', txt: 'Vaincre le colosse de la Lune rouge', goal: 1, key: 'bosses', xp: 300, gold: 200 },
];
let questSig = '';
function renderQuests() {
  const sig = QUESTS.map(q => (S.qdone[q.id] ? 'd' : Math.min(S.stats[q.key] || 0, q.goal))).join(',');
  if (sig === questSig) return; questSig = sig;
  const act = QUESTS.filter(q => !S.qdone[q.id]).slice(0, 4), done = QUESTS.filter(q => S.qdone[q.id]).slice(-1);
  $('qlist').innerHTML = act.map(q => { const v = Math.min(S.stats[q.key] || 0, q.goal); return `<div class="q"><div class="ic">${q.ic}</div><div style="flex:1">${q.txt} <b style="color:var(--gold)">${v}/${q.goal}</b><div class="mini"><i style="width:${v / q.goal * 100}%"></i></div></div></div>`; }).join('')
    + done.map(q => `<div class="q done"><div class="ic">✔️</div><div>${q.txt}</div></div>`).join('')
    + (act.length ? '' : '<div class="q"><div class="ic">⭐</div><div>Tous les objectifs sont faits ! Agrandis ton royaume.</div></div>');
  $('qcount').textContent = `${Object.keys(S.qdone).length}/${QUESTS.length}`;
}
function checkQuests() {
  if (NET_ROLE === 'guest') { renderQuests(); return; }
  QUESTS.forEach(q => { if (!S.qdone[q.id] && (S.stats[q.key] || 0) >= q.goal) { S.qdone[q.id] = true; sfx('coin'); S.gold += q.gold; addXP(q.xp); worldToast('📜', 'Objectif accompli : ' + q.txt, `+${q.xp} XP · +${q.gold} 🪙`); } });
  renderQuests();
}

/* ---------- jour / nuit ---------- */
const DC = { sunDay: col('#fff0d6'), sunSet: col('#ff9a4a'), skyD: col('#cfe6ff'), skyN: col('#33467a'), gndD: col('#4a4a22'), gndN: col('#161a2a'), fogD: col('#a9b98a'), fogS: col('#caa070'), fogN: col('#1b2338'), fogR: col('#3a1418') };
const moon = new THREE.DirectionalLight(col('#8aa6ff'), 0); scene.add(moon, moon.target);
let nightK = 0, wasNight = isNightAt(S.time);
const camTarget = player.position.clone();
function updateDay(dt) {
  S.time += dt * 24 / DAY_LEN; if (S.time >= 24) { S.time -= 24; S.day++; }
  const h = S.time, ph = (h - 6) / 12 * Math.PI, el = Math.sin(ph);
  const dayF = sstep(-.12, .22, el); nightK = 1 - dayF;
  const sunset = sstep(.45, .05, el) * dayF, red = bloodMoon() && isNightAt(h) ? nightK : 0;
  sun.intensity = 3.5 * dayF; sun.color.copy(DC.sunDay).lerp(DC.sunSet, sunset);
  sun.target.position.set(camTarget.x, 0, camTarget.z - 2);
  sun.position.set(sun.target.position.x - Math.cos(ph) * 30, 8 + Math.max(el, 0) * 32, sun.target.position.z + 16);
  moon.intensity = .9 * nightK; moon.color.set(red ? '#ff8a8a' : '#8aa6ff'); moon.target.position.copy(sun.target.position); moon.position.copy(sun.target.position).add(tmpV.set(18, 30, 12));
  hemi.intensity = .62 * (.5 + .5 * dayF); hemi.color.copy(DC.skyN).lerp(DC.skyD, dayF); hemi.groundColor.copy(DC.gndN).lerp(DC.gndD, dayF);
  scene.fog.color.copy(DC.fogN).lerp(DC.fogD, dayF).lerp(DC.fogS, sunset * .5).lerp(DC.fogR, red * .6); scene.background.copy(scene.fog.color);
  fill.intensity = .45 * dayF;
  WIN_MAT.emissiveIntensity = 1.2 + nightK * 2.6; LAMP_MAT.emissiveIntensity = .4 + nightK * 4;
  grade.uniforms.uNight.value = nightK;
  window._pollen.material.color.set(nightK > .5 ? '#c8ff7a' : '#ffe0a0'); window._pollen.material.size = .32 + nightK * .25;
  const night = isNightAt(h);
  if (night !== wasNight) {
    wasNight = night;
    if (night) toast(bloodMoon() ? '🔴' : '🌙', bloodMoon() ? 'Nuit de la Lune rouge !' : 'La nuit tombe…', bloodMoon() ? 'Un colosse d\'ombre approche. Prépare tes défenses !' : 'Des ombres sortent de la forêt. Les habitants rentrent chez eux.');
    else { toast('☀️', `Jour ${S.day} — l'aube se lève`, 'Les ombres se dissipent.'); if (NET_ROLE !== 'guest') dawn(); }
  }
  return night;
}
function dawn() {
  addXP(30);
  const need = S.villagers.length;
  if (S.food >= need) { S.food -= need; S.hungry = false; if (need) toast('🍞', `Les habitants ont mangé (${need} 🍒)`, 'Village heureux : travail à pleine vitesse'); }
  else { S.food = 0; S.hungry = true; worldToast('😟', 'Les habitants ont faim !', 'Récolte de la nourriture : baies, chasse, pêche, ferme'); }
}
const pad = n => String(n).padStart(2, '0');
function hud() {
  [['wood', 'r-wood'], ['stone', 'r-stone'], ['iron', 'r-iron'], ['plank', 'r-plank'], ['food', 'r-food'], ['gold', 'r-gold']].forEach(([k, id]) => { $(id).textContent = fmt(S[k]); });
  $('food-c').textContent = fmt(S.food);
  $('lvl').textContent = S.lvl; $('lvlt').textContent = 'Île Niv. ' + S.lvl;
  $('xpb').style.width = Math.min(100, S.xp / xpNeed(S.lvl) * 100) + '%';
  $('xpt').textContent = `${fmt(S.xp)} / ${fmt(xpNeed(S.lvl))} XP · Prochain : ${nextUnlock()}`;
  $('pop').textContent = `👥 ${S.pop} habitants`; $('bld').textContent = `🏠 ${S.bld} bâtiments`; $('ess').textContent = S.hungry ? '😟 Faim' : '😊 Heureux';
  $('hp1').style.width = (ME.hp / maxHP() * 100) + '%'; $('st1').style.width = ME.st + '%'; $('plv').textContent = ME.lvl;
  const h = S.time, night = isNightAt(h), hh = Math.floor(h), mm = Math.floor((h % 1) * 60);
  $('clk').textContent = `${night ? (bloodMoon() ? '🔴' : '🌙') : '☀️'} ${pad(hh)}:${pad(mm)}`;
  $('dayl').textContent = `Jour ${S.day} · ${bloodMoon() ? 'Lune rouge' : 'Été'}`;
  const until = night ? ((6 - h + 24) % 24) : (20 - h), uh = Math.floor(until), um = Math.floor((until % 1) * 60);
  $('nightl').textContent = night ? `⚠️ Monstres actifs · aube dans ${uh}h${pad(um)}` : `🌙 Nuit dans ${uh}h${pad(um)}`;
  const mp = (x, z) => [50 + x * .78, 54 + z * .78];
  const [px, pz] = mp(player.position.x, player.position.z); $('mmP').setAttribute('cx', px); $('mmP').setAttribute('cy', pz);
  const [lx, lz] = mp(mate.position.x, mate.position.z); $('mmL').setAttribute('cx', lx); $('mmL').setAttribute('cy', lz);
  $('mmMon').innerHTML = MONSTERS.filter(m => !m.userData.dead).map(m => { const [x, z] = mp(m.position.x, m.position.z); return `<circle cx="${x}" cy="${z}" r="${m.userData.boss ? 3 : 1.8}" fill="#ff3d7a"/>`; }).join('');
}
function drawMinimapBuilds() { $('mmBuilds').innerHTML = SITES.filter(s => s.type !== 'path').map(s => `<rect x="${50 + s.x * .78 - 1.6}" y="${54 + s.z * .78 - 1.6}" width="3.2" height="3.2" fill="${s.done ? '#9b6a43' : '#ffcf5a'}"/>`).join(''); }

/* ---------- panneaux ---------- */
function openModal(title, html) { sfx('click'); $('bmenu').classList.add('hidden'); $('mtitle').textContent = title; $('mbody').innerHTML = html; $('modal').classList.remove('hidden'); modalOpen = title; }
let modalOpen = null, modalRefresh = null;
function closeModal() { $('modal').classList.add('hidden'); modalOpen = null; modalRefresh = null; }
$('mclose').addEventListener('click', closeModal);
function openBag() {
  modalRefresh = openBag;
  openModal('🎒 Sac, réserves & équipement', `<div class="grid">${Object.keys(RES_IC).map(k => `<div class="cell"><b>${RES_IC[k]}</b>${RES_NAME[k]}<br><span style="color:var(--gold)">${fmt(S[k])}</span></div>`).join('')}</div>
  <p class="note">Les ressources sont communes aux deux joueurs. Ton personnage : <b>${esc(ME.name)}</b>, niveau ${ME.lvl} (${fmt(ME.xp)} XP), ${Math.round(ME.hp)}/${maxHP()} PV.</p>${gearHtml()}`);
  document.querySelectorAll('.craft').forEach(b => b.addEventListener('click', () => craft(b.dataset.k)));
}
function openVillage() {
  modalRefresh = openVillage;
  const base = [['⛏️', 'Brune', 'Mineuse ★★★', 'Extrait la pierre du rocher'], ['⛏️', 'Tobin', 'Mineur ★★', 'Travaille sur l\'échafaudage'], ['🛡️', 'Pip', 'Garde', 'Se repose avant sa ronde'], ['📦', 'Aldo', 'Transporteur', 'Porte le bois du dépôt à la mine'], ['🔨', 'Bram', 'Constructeur ★★★', bram.status || 'Attend un chantier']];
  const opts = rec => Object.entries(JOBS).map(([k, j]) => `<option value="${k}" ${rec.job === k ? 'selected' : ''} ${j.need && !hasBuilding(j.need) ? 'disabled' : ''}>${j.ic} ${j.n}${j.need && !hasBuilding(j.need) ? ' (' + BUILDS[j.need].name + ' requis)' : ''}</option>`).join('');
  const rows = RESIDENTS.map(r => `<div class="vrow"><span class="f">${JOBS[r.rec.job].ic}</span><div style="flex:1"><b>${esc(r.rec.name)}</b> <span class="stars">${starTxt(r.rec)}</span> · <i>${r.rec.trait}</i><small>${esc(r.status || '')}</small></div><select class="tap jobsel" data-id="${r.rec.id}">${opts(r.rec)}</select></div>`).join('');
  const others = Math.max(0, S.pop - base.length - RESIDENTS.length);
  openModal(`🏘️ Village · ${S.pop} habitants`, `<h5 class="sub">Habitants à qui tu peux donner un métier</h5>${rows || '<p class="note">Construis une cabane pour accueillir un habitant.</p>'}
    <h5 class="sub">Artisans du village</h5>${base.map(([f, n, j, s]) => `<div class="vrow"><span class="f">${f}</span><div><b>${n}</b> — ${j}<small>${esc(s)}</small></div></div>`).join('')}
    <p class="note">${others} autres habitants vivent dans les maisons du village. ${S.hungry ? '😟 Le village a faim : il travaille moins vite.' : '😊 Le village est nourri.'} Chaque matin, chaque habitant mange 1 🍒.</p>`);
  document.querySelectorAll('.jobsel').forEach(sel => sel.addEventListener('change', () => { if (!setJob(+sel.dataset.id, sel.value)) openVillage(); }));
}
function openBuilding(s) {
  modalRefresh = () => openBuilding(s);
  const L = s.level, next = s.def.up && s.def.up[L], nlvl = next ? s.def.upLvl[L] : 0;
  const workers = s.def.job ? RESIDENTS.filter(r => r.rec.job === s.def.job) : [];
  const residents = s.def.cap ? RESIDENTS.filter(r => r.rec.homeId === s.id) : [];
  let html = `<p>${s.def.desc}</p>`;
  if (s.def.cap) html += `<p class="note">Habitants : ${residents.map(r => esc(r.rec.name)).join(', ') || 'aucun'} · capacité ${s.type === 'cabin' ? L : s.def.cap}</p>`;
  if (s.def.job) html += `<p class="note">${JOBS[s.def.job].ic} ${JOBS[s.def.job].n}s : ${workers.map(r => esc(r.rec.name)).join(', ') || 'aucun — assigne-en un dans le menu Village'}</p>`;
  if (s.type === 'market') html += marketHtml();
  if (next) html += `<div class="upbox"><b>Améliorer en ${s.def.names[L]}</b><br><span class="cost">${Object.entries(next).map(([r, v]) => `<span class="${S[r] < v ? 'miss' : ''}">${RES_IC[r]} ${v}</span>`).join(' ')}</span>${S.lvl < nlvl ? ` <span class="miss">🔒 Île Niv. ${nlvl}</span>` : ''}<br><button class="gbtn tap" id="bt-up" ${s.upg ? 'disabled' : ''}>${s.upg ? 'Amélioration en cours…' : '✨ Améliorer'}</button></div>`;
  html += `<button class="gbtn red tap" id="bt-del">🗑️ Démolir (rembourse 50 %)</button>`;
  openModal(`${s.def.ic} ${bName(s)}${s.def.names ? ' · niv. ' + L : ''}`, html);
  const up = $('bt-up'); if (up) up.addEventListener('click', () => { if (NET_ROLE === 'guest') { netSend({ t: 'req', k: 'up', id: s.id }); closeModal(); } else if (startUpgrade(s)) closeModal(); });
  $('bt-del').addEventListener('click', () => { if (!confirmDel) { confirmDel = true; $('bt-del').textContent = '⚠️ Toucher encore pour confirmer'; return; } confirmDel = false; if (NET_ROLE === 'guest') netSend({ t: 'req', k: 'del', id: s.id }); else demolish(s); closeModal(); });
  bindMarket();
}
let confirmDel = false;
const TRADES = [['wood', 10, 8], ['stone', 10, 10], ['food', 10, 7], ['plank', 5, 12], ['leather', 1, 9], ['crystal', 1, 30], ['ess', 1, 15]];
function marketHtml() { return `<h5 class="sub">Vendre</h5><div class="trades">${TRADES.map(([r, q, p], i) => `<button class="gbtn tap tr" data-i="${i}" ${S[r] < q ? 'disabled' : ''}>${q} ${RES_IC[r]} → ${p} 🪙</button>`).join('')}</div><h5 class="sub">Acheter</h5><div class="trades"><button class="gbtn tap tb" data-k="iron" ${S.gold < 25 ? 'disabled' : ''}>5 ⛓️ ← 25 🪙</button><button class="gbtn tap tb" data-k="food" ${S.gold < 15 ? 'disabled' : ''}>10 🍒 ← 15 🪙</button></div>`; }
function bindMarket() {
  document.querySelectorAll('.tr').forEach(b => b.addEventListener('click', () => { trade('sell', +b.dataset.i); }));
  document.querySelectorAll('.tb').forEach(b => b.addEventListener('click', () => { trade('buy', b.dataset.k); }));
}
function trade(kind, arg) {
  if (NET_ROLE === 'guest') { netSend({ t: 'req', k: 'trade', kind, arg }); setTimeout(() => modalRefresh && modalRefresh(), 350); return; }
  doTrade(kind, arg); if (modalRefresh) modalRefresh();
}
function doTrade(kind, arg) {
  if (kind === 'sell') { const tr = TRADES[arg]; if (!tr) return; const [r, q, p] = tr; if (S[r] < q) return; S[r] -= q; S.gold += p; }
  else if (arg === 'iron' && S.gold >= 25) { S.gold -= 25; S.iron += 5; }
  else if (arg === 'food' && S.gold >= 15) { S.gold -= 15; S.food += 10; }
}
$('b-bag').addEventListener('click', openBag);
$('b-village').addEventListener('click', openVillage);

/* ---------- entrées ---------- */
const keys = {};
addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  keys[e.code] = true; if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') { e.preventDefault(); actHeld = true; doAction(); }
  else if (e.code === 'KeyB') toggleBuild();
  else if (e.code === 'KeyR' && buildMode) { ghostManual = true; ghostRot += Math.PI / 4; }
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
$('b-rot').addEventListener('click', () => { ghostManual = true; ghostRot += Math.PI / 4; sfx('click'); });
let slot = 0;
function useSlot(i, silent) {
  slot = i; document.querySelectorAll('.slot').forEach(s => s.classList.toggle('sel', +s.dataset.i === i));
  if (silent) return;
  if (i === 5) {
    if (S.food >= 2 && ME.hp < maxHP()) { if (NET_ROLE === 'guest') netSend({ t: 'req', k: 'eat' }); else S.food -= 2; ME.hp = Math.min(maxHP(), ME.hp + 20); ME.st = Math.min(100, ME.st + 30); floatText('+20 ❤️', player.position.clone().setY(player.position.y + 2.3), '#9fff8a', false); }
    else if (S.food < 2) toast('🍒', 'Plus de nourriture', 'Cueille, chasse ou pêche');
  }
  if (i === 6) toast('🧪', 'Potions', 'L\'alchimiste les fabriquera dans une prochaine mise à jour');
}
$('hotbar').addEventListener('click', e => { const s = e.target.closest('.slot'); if (s) useSlot(+s.dataset.i); });
let zoom = 1; const pinch = new Map(); let pinchD = 0;
renderer.domElement.addEventListener('wheel', e => { zoom = clamp(zoom + Math.sign(e.deltaY) * .08, .6, 1.35); }, { passive: true });
renderer.domElement.addEventListener('pointerdown', e => { pinch.set(e.pointerId, e); if (MOBILE && document.fullscreenElement == null && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => { }); });
renderer.domElement.addEventListener('pointermove', e => {
  if (!pinch.has(e.pointerId)) return; pinch.set(e.pointerId, e);
  if (pinch.size === 2) { const [a, b] = [...pinch.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (pinchD && d) zoom = clamp(zoom * pinchD / d, .6, 1.35); pinchD = d; }
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
    if (deathT <= 0) { player.rotation.z = 0; pp.set(3, 0, 6.4); ME.hp = maxHP() * .6; ME.st = 100; }
  } else if (Math.hypot(mx, mz) > .08) {
    const sp = 6.2 * (streamD(pp.x, pp.z) < 2 ? .55 : 1);
    pp.x += mx * sp * dt; pp.z += mz * sp * dt; facing = Math.atan2(mx, mz); u.anim = 'walk';
    u.stepT = (u.stepT || 0) - dt; if (u.stepT <= 0) { u.stepT = .3; burst(V(pp.x, pp.y + .05, pp.z), streamD(pp.x, pp.z) < 2 ? FX.water : FX.dust, 2, { speed: .6, up: .8, size: .06, life: .5, gravity: 2, spread: .2 }); }
  } else u.anim = 'idle';
  collide(pp, .42);
  pp.y = Math.max(H(pp.x, pp.z), -1.05);
  if (Math.hypot(mx, mz) > .08) player.rotation.y = lerpAng(player.rotation.y, facing, 1 - Math.exp(-dt * 14));
  ME.st = Math.min(100, ME.st + dt * 10);
  if (deathT <= 0) ME.hp = Math.min(maxHP(), ME.hp + dt * (night ? .4 : 1.5));
}
const CAM_OFF = V(0.2, 21, 19.5), LOOK_OFF = V(0, .8, -1.2), lookV = V();
function updateCamera(dt) {
  camTarget.lerp(player.position, 1 - Math.exp(-dt * 5));
  camera.position.copy(camTarget).addScaledVector(CAM_OFF, zoom);
  if (shakeT > 0) { shakeT -= dt; camera.position.x += (Math.random() - .5) * shakeT * 1.2; camera.position.y += (Math.random() - .5) * shakeT * 1.2; }
  camera.lookAt(lookV.copy(camTarget).add(LOOK_OFF));
}


/* ================= SENSATIONS : particules, équipement, météo, coffre du jour, guide ================= */
/* ---------- particules ---------- */
const PART_N = 380;
const partMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: .7, color: '#ffffff' }), PART_N);
partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); partMesh.frustumCulled = false;
const PARTS = Array.from({ length: PART_N }, () => ({ life: 0, t: 0, p: V(), v: V(), s: .1, g: 9, drag: 1, spin: 0 }));
let partI = 0;
const pm4 = new THREE.Matrix4(), pq = new THREE.Quaternion(), pe = new THREE.Euler(), psv = V(), pcol = new THREE.Color();
for (let i = 0; i < PART_N; i++) { pm4.makeScale(0, 0, 0); partMesh.setMatrixAt(i, pm4); partMesh.setColorAt(i, pcol.set('#ffffff')); }
scene.add(partMesh);
const FX = {
  chips: ['#8a5a36', '#a8784a', '#c89a64'], leaves: ['#4f8a2a', '#7fb83a', '#a6c845'], stone: ['#9aa3ad', '#c8ced6', '#7a828c'], spark: ['#ffe08a', '#fff3c0'],
  berry: ['#d8263a', '#ff5a6a', '#7fb83a'], shadow: ['#5a2a8a', '#2b1a3d', '#ff3d7a', '#9a4ad8'], gold: ['#ffd35a', '#ffb02e', '#fff3c0', '#ff7a4a', '#4fe0d0', '#ff5a9a'],
  dust: ['#c8b08a', '#d8c8a8', '#b09a78'], fur: ['#9a6a3e', '#efe6d8'], crystal: ['#8ff0ff', '#5fd0ff', '#ffffff'], water: ['#a8e8ff', '#ffffff', '#5fc8e0'],
};
function burst(pos, colors, n, o = {}) {
  if (QUALITY.cur === 'low') n = Math.ceil(n / 2);
  for (let k = 0; k < n; k++) {
    const i = partI++ % PART_N, q = PARTS[i], sp = (o.speed ?? 3) * (.5 + Math.random() * .7), a = Math.random() * TAU, spr = o.spread ?? .4;
    q.p.set(pos.x + (Math.random() - .5) * spr, pos.y + (Math.random() - .5) * spr * .5, pos.z + (Math.random() - .5) * spr);
    q.v.set(Math.cos(a) * sp, (o.up ?? 3) * (.6 + Math.random() * .8), Math.sin(a) * sp);
    q.life = (o.life ?? .8) * (.7 + Math.random() * .6); q.t = 0; q.s = (o.size ?? .08) * (.6 + Math.random() * .8); q.g = o.gravity ?? 9; q.drag = o.drag ?? 1; q.spin = Math.random() * 10;
    partMesh.setColorAt(i, pcol.set(colors[Math.floor(Math.random() * colors.length)]));
  }
  partMesh.instanceColor.needsUpdate = true;
}
function updateParticles(dt) {
  let any = false;
  for (let i = 0; i < PART_N; i++) {
    const q = PARTS[i];
    if (q.t >= q.life) { if (q.life > 0) { pm4.makeScale(0, 0, 0); partMesh.setMatrixAt(i, pm4); q.life = 0; any = true; } continue; }
    q.t += dt; q.v.y -= q.g * dt; q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt)); q.p.addScaledVector(q.v, dt);
    const gy = H(q.p.x, q.p.z) + .03; if (q.p.y < gy) { q.p.y = gy; q.v.y *= -.3; q.v.x *= .6; q.v.z *= .6; }
    const k = 1 - Math.max(0, (q.t - q.life * .6) / (q.life * .4));
    pe.set(q.spin * q.t, q.spin * q.t * .7, 0); pq.setFromEuler(pe); psv.setScalar(Math.max(.0001, q.s * k));
    pm4.compose(q.p, pq, psv); partMesh.setMatrixAt(i, pm4); any = true;
  }
  if (any) partMesh.instanceMatrix.needsUpdate = true;
}
const fxTree = (t, big) => { const y = H(t.x, t.z); burst(V(t.x, y + 1.2, t.z), FX.chips, big ? 12 : 7, { speed: 3, up: 3, size: .07 }); burst(V(t.x, y + t.s.y * .55, t.z), FX.leaves, big ? 10 : 5, { speed: 1.5, up: .5, gravity: 1.2, drag: 1.5, life: 2, spread: 2.5, size: .09 }); };
const fxRock = (r, big) => { const p = V(r.x, H(r.x, r.z) + .6, r.z); if (r.kind === 'crystal') burst(p, FX.crystal, big ? 14 : 9, { speed: 3.5, size: .07 }); else { burst(p, FX.stone, big ? 12 : 7, { speed: 3.2, size: .08 }); burst(p, FX.spark, 3, { speed: 4, up: 4, size: .04, life: .4 }); } };

/* ---------- ressources qui volent vers le compteur ---------- */
const PILL = { wood: 'r-wood', stone: 'r-stone', iron: 'r-iron', plank: 'r-plank', food: 'r-food', gold: 'r-gold' };
function flyRes(res, wpos, n = 1) {
  const id = PILL[res]; if (!id || document.hidden) return; const pill = $(id).parentElement, tr = pill.getBoundingClientRect(), s = screenPos(wpos); if (!s.ok) return;
  for (let i = 0; i < Math.min(n, 4); i++) {
    const el = document.createElement('div'); el.className = 'flyres'; el.textContent = RES_IC[res]; el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; $('hud').appendChild(el);
    const dx = tr.left + tr.width * .3 - s.x, dy = tr.top + tr.height / 2 - s.y, jx = (Math.random() - .5) * 60;
    const an = el.animate([{ transform: 'translate(-50%,-50%) scale(.5)', opacity: 0 }, { transform: `translate(calc(-50% + ${jx}px), calc(-50% - ${40 + Math.random() * 30}px)) scale(1.25)`, opacity: 1, offset: .3 }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.6)`, opacity: .9 }], { duration: 700 + i * 80, delay: i * 70, easing: 'cubic-bezier(.55,0,.65,1)', fill: 'forwards' });
    an.onfinish = () => { el.remove(); pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump'); };
  }
}

/* ---------- grande annonce ---------- */
function banner(title, sub = '', ic = '✨') {
  const el = $('banner'); el.innerHTML = `<div class="bi">${ic}</div><div class="bt">${esc(title)}</div><div class="bs">${esc(sub)}</div>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

/* ---------- équipement personnel ---------- */
const GEAR = {
  tool: { ic: '⛏️', names: ['Outils en pierre', 'Outils en fer', 'Outils en cristal'], cost: [null, { iron: 6, plank: 4 }, { crystal: 4, iron: 8, ess: 3 }], fx: ['Récolte normale', 'Arbres abattus 2× plus vite · +1 ressource', 'Roche taillée 2× plus vite · +2 ressources'] },
  weapon: { ic: '🗡️', names: ['Épée en bois', 'Épée de fer', 'Lame de cristal'], cost: [null, { iron: 5, leather: 1 }, { crystal: 5, iron: 6, ess: 4 }], fx: ['1 dégât', '2 dégâts', '3 dégâts'] },
  bow: { ic: '🏹', names: ['Arc simple', 'Arc renforcé', 'Arc enchanté'], cost: [null, { plank: 4, leather: 2 }, { crystal: 3, ess: 3, plank: 4 }], fx: ['1 dégât par flèche', '2 dégâts par flèche', '3 dégâts par flèche'] },
  armor: { ic: '🛡️', names: ['Tunique', 'Armure de cuir', 'Armure de fer'], cost: [null, { leather: 4, plank: 2 }, { iron: 10, leather: 3 }], fx: ['Aucune protection', '-25 % de dégâts', '-45 % de dégâts'] },
};
ME.gear = Object.assign({ tool: 0, weapon: 0, bow: 0, armor: 0 }, ME.gear || {});
const gearOf = a => (a === player ? ME.gear : (netMate.gear || { tool: 0, weapon: 0, bow: 0, armor: 0 }));
const HEAD_COL = ['#9aa3ad', '#e4e8ee', '#7ff0ff'];
function applyGearVisual(c, g) {
  const u = c.userData;
  if (u.toolHead) { u.toolHead.material = M(HEAD_COL[g.tool], { metalness: .7, roughness: .3, emissive: g.tool === 2 ? '#2fb8ff' : '#000', emissiveIntensity: g.tool === 2 ? .8 : 0 }); }
  if (u.armorMesh) { c.remove(u.armorMesh); u.armorMesh = null; }
  if (g.armor > 0) {
    const a = new THREE.Group(), m = M(g.armor === 1 ? '#7a4a2a' : '#9aa3b0', { metalness: g.armor === 2 ? .6 : 0, roughness: .5 });
    box(a, .46, .34, .36, m, 0, .72, 0); box(a, .2, .1, .22, m, -.25, .9, 0); box(a, .2, .1, .22, m, .25, .9, 0);
    c.add(a); u.armorMesh = a;
  }
  document.querySelectorAll('.slot').forEach(s => { const k = { 0: 'tool', 1: 'tool', 2: 'weapon', 3: 'bow' }[s.dataset.i]; if (!k) return; s.dataset.tier = (c === player ? ME.gear : g)[k]; });
}
function craft(item) {
  const tier = ME.gear[item] + 1, cost = GEAR[item].cost[tier]; if (!cost) return;
  if (!canAfford(cost)) { toast('🛠️', 'Ressources insuffisantes', costTxt(cost)); return; }
  if (NET_ROLE === 'guest') { netSend({ t: 'req', k: 'craft', item, tier }); return; }
  Object.entries(cost).forEach(([k, v]) => S[k] -= v);
  gearDone(item, tier);
}
function gearDone(item, tier) {
  ME.gear[item] = tier; applyGearVisual(player, ME.gear); sfx('level');
  burst(player.position.clone().setY(player.position.y + 1.2), FX.gold, 30, { speed: 3, up: 4 });
  banner(GEAR[item].names[tier], GEAR[item].fx[tier], GEAR[item].ic); save();
  if (modalRefresh) modalRefresh();
}
function gearHtml() {
  return `<h5 class="sub">Équipement de ${esc(ME.name)}</h5>` + Object.entries(GEAR).map(([k, g]) => {
    const t = ME.gear[k], next = g.cost[t + 1];
    return `<div class="vrow"><span class="f">${g.ic}</span><div style="flex:1"><b>${g.names[t]}</b> <span class="stars">${'★'.repeat(t + 1)}${'☆'.repeat(2 - t)}</span><small>${g.fx[t]}</small></div>${next ? `<button class="gbtn tap craft" data-k="${k}" ${canAfford(next) ? '' : 'disabled'}>🛠️ ${g.names[t + 1]}<br><small>${costTxt(next)}</small></button>` : '<span class="ok">Max</span>'}</div>`;
  }).join('');
}

/* ---------- météo : pluie ---------- */
const RAIN_N = MOBILE ? 900 : 1600, RB = { x: 46, y: 22, z: 40 };
const rainGeo = new THREE.BufferGeometry(), rainPos = new Float32Array(RAIN_N * 6), rainSeed = new Float32Array(RAIN_N * 3);
for (let i = 0; i < RAIN_N; i++) { rainSeed[i * 3] = Math.random() * RB.x - RB.x / 2; rainSeed[i * 3 + 1] = Math.random() * RB.y; rainSeed[i * 3 + 2] = Math.random() * RB.z - RB.z / 2; }
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.LineBasicMaterial({ color: '#b8d4ec', transparent: true, opacity: 0, depthWrite: false });
const rain = new THREE.LineSegments(rainGeo, rainMat); rain.frustumCulled = false; scene.add(rain);
let rainK = 0, weatherT = 50, wasRain = !!S.rain;
function updateWeather(dt) {
  if (NET_ROLE !== 'guest') { weatherT -= dt; if (weatherT <= 0) { weatherT = rr(45, 110); S.rain = Math.random() < .3 ? 1 : 0; } }
  const want = S.rain ? 1 : 0; rainK += (want - rainK) * Math.min(1, dt * .5);
  if (!!S.rain !== wasRain) { wasRain = !!S.rain; toast(S.rain ? '🌧️' : '🌤️', S.rain ? 'Il commence à pleuvoir' : 'La pluie s\'arrête', S.rain ? 'Les cultures poussent 50 % plus vite' : ''); }
  rain.visible = rainK > .02; rainMat.opacity = .55 * rainK;
  if (rain.visible) {
    const cx = camTarget.x, cz = camTarget.z + 4;
    for (let i = 0; i < RAIN_N; i++) {
      let y = rainSeed[i * 3 + 1] - dt * 24; if (y < 0) y += RB.y; rainSeed[i * 3 + 1] = y;
      const x = cx + rainSeed[i * 3] + y * .12, z = cz + rainSeed[i * 3 + 2], gy = H(cx, cz) - 2;
      rainPos.set([x, gy + y, z, x + .06, gy + y + .7, z], i * 6);
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
  sun.intensity *= 1 - .4 * rainK; hemi.intensity *= 1 + .1 * rainK; fill.intensity *= 1 - .3 * rainK;
  scene.fog.density = .0075 + .004 * rainK; scene.fog.color.lerp(tmpC.set('#8a98a0'), rainK * .45); scene.background.copy(scene.fog.color);
  if (AU.rainG) AU.rainG.gain.value = SETTINGS.sound ? .16 * rainK : 0;
  else if (AU.ctx && AU.noise) { const s = AU.ctx.createBufferSource(); s.buffer = AU.noise; s.loop = true; const f = AU.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = .4; AU.rainG = AU.ctx.createGain(); AU.rainG.gain.value = 0; s.connect(f); f.connect(AU.rainG); AU.rainG.connect(AU.master); s.start(); }
}
const tmpC = new THREE.Color();

/* ---------- coffre du jour ---------- */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
function dailyReward(streak) { const r = { wood: 20 + streak * 5, stone: 15 + streak * 4, food: 10 + streak * 2, gold: 30 + streak * 10 }; if (streak % 7 === 0) { r.crystal = 3; r.ess = 3; } if (streak >= 3) r.iron = 2 + Math.floor(streak / 3); return r; }
function checkDaily() {
  let d = { last: '', streak: 0 }; try { d = Object.assign(d, JSON.parse(localStorage.getItem('everisle-daily') || '{}')); } catch (e) { }
  const t = today(); if (d.last === t) return;
  const y = new Date(Date.now() - 864e5), ys = `${y.getFullYear()}-${y.getMonth() + 1}-${y.getDate()}`;
  const streak = d.last === ys ? d.streak + 1 : 1, rew = dailyReward(streak);
  openModal('🎁 Coffre du jour', `<div class="chest">🎁</div><p style="text-align:center">Série de connexion : <b style="color:var(--gold)">${streak} jour${streak > 1 ? 's' : ''}</b> ${'🔥'.repeat(Math.min(streak, 7))}</p>
    <div class="grid" style="margin-top:1vh">${Object.entries(rew).map(([k, v]) => `<div class="cell"><b>${RES_IC[k]}</b>+${v}</div>`).join('')}</div>
    <p class="note" style="text-align:center">Reviens chaque jour : la récompense grandit, et tous les 7 jours le coffre contient des cristaux !</p>
    <div style="text-align:center"><button class="gbtn tap" id="chest-open" style="font-size:2.2vh;padding:1.2vh 4vh">Ouvrir le coffre</button></div>`);
  $('chest-open').addEventListener('click', () => {
    try { localStorage.setItem('everisle-daily', JSON.stringify({ last: t, streak })); } catch (e) { }
    if (NET_ROLE === 'guest') netSend({ t: 'req', k: 'gift', rew }); else Object.entries(rew).forEach(([k, v]) => { S[k] += v; });
    Object.keys(rew).forEach(k => flyRes(k, player.position.clone().setY(player.position.y + 1.5), 3));
    burst(player.position.clone().setY(player.position.y + 1.4), FX.gold, 40, { speed: 4, up: 5 }); sfx('coin'); sfx('level');
    closeModal(); save();
  }, { once: true });
}

/* ---------- flèche-guide vers l'objectif ---------- */
let guideT = 0, guideTgt = null;
function nearestOf(list, ok, p) { let b = null, bd = 1e9; for (const o of list) { if (!ok(o)) continue; const x = o.x ?? o.g.position.x, z = o.z ?? o.g.position.z, d = Math.hypot(x - p.x, z - p.z); if (d < bd) { bd = d; b = o; } } return b; }
function findGuide() {
  const q = QUESTS.find(q => !S.qdone[q.id]); if (!q) return null; const P = player.position; let o;
  switch (q.key) {
    case 'woodCut': o = nearestOf(TREES, t => t.state === 'up' && t.x > BOUNDS.x0 && t.x < BOUNDS.x1 && t.z > BOUNDS.z0 && t.z < BOUNDS.z1, P); return o && { p: V(o.x, H(o.x, o.z) + 3, o.z), ic: '🪓' };
    case 'berries': o = nearestOf(BERRIES, b => b.ready && b.x < BOUNDS.x1, P); return o && { p: V(o.x, H(o.x, o.z) + 2, o.z), ic: '🍒' };
    case 'stoneMined': o = nearestOf(ROCKS, r => r.hp > 0 && r.kind !== 'crystal' && r.z > BOUNDS.z0, P); return o && { p: V(o.x, H(o.x, o.z) + 1.6, o.z), ic: '⛏️' };
    case 'mineDeliver': return S.mineDone ? null : { p: V(MINE_PT.x, MINE_PT.y + 2, MINE_PT.z), ic: '🪨' };
    case 'deer': o = nearestOf(DEER, d => d.state !== 'dead' && d.g.position.x < BOUNDS.x1, P); return o && { p: o.g.position.clone().setY(o.g.position.y + 2.6), ic: '🦌' };
    case 'fish': return { p: V(FISH_SPOT.x, H(FISH_SPOT.x, FISH_SPOT.z) + 1.5, FISH_SPOT.z), ic: '🎣' };
    case 'kills': case 'bosses': o = nearestMonster(P, 60); return o && { p: o.position.clone().setY(o.position.y + 2), ic: '⚔️' };
  }
  return null;
}
function updateGuide(dt) {
  const el = $('guide'); guideT -= dt; if (guideT <= 0) { guideT = .3; guideTgt = findGuide(); }
  if (!guideTgt || buildMode || Math.hypot(guideTgt.p.x - player.position.x, guideTgt.p.z - player.position.z) < 3.5) { el.style.display = 'none'; return; }
  const s = screenPos(guideTgt.p), w = W(), h = Hh(), mx = w * .07, my = h * .2, onScreen = s.x > mx && s.x < w - mx && s.y > my && s.y < h - h * .2 && pv.z < 1;
  el.style.display = 'block';
  if (onScreen) { el.className = 'pin'; el.innerHTML = `<span>${guideTgt.ic}</span>`; el.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-100%)`; return; }
  const cx = w / 2, cy = h / 2; let dx = s.x - cx, dy = s.y - cy; if (pv.z > 1) { dx = -dx; dy = -dy; }
  const k = Math.min((w / 2 - mx * 2.2) / Math.abs(dx || 1), (h / 2 - my) / Math.abs(dy || 1)), ex = cx + dx * k, ey = Math.min(cy + dy * k, h * .68), ang = Math.atan2(dy, dx) * 180 / Math.PI;
  el.className = 'edge'; el.innerHTML = `<i style="transform:rotate(${ang}deg)">➤</i><span>${guideTgt.ic}</span>`; el.style.transform = `translate(${ex}px,${ey}px) translate(-50%,-50%)`;
}

/* ================= DUO EN LIGNE (pair à pair) =================
   L'hôte fait tourner la simulation de l'île et la sauvegarde ; l'invité envoie ses
   déplacements et ses actions, et reçoit l'état du monde 10 fois par seconde. */
const netMate = { on: false, name: 'Lyra', hp: 100, p: V(), ry: 0, anim: 'idle', sw: 0, sh: 0 };
const NET = { peer: null, conn: null, code: '', status: '' };
const BASE_BOUNDS = { ...BOUNDS };
function peerOpts() {
  const q = new URLSearchParams(location.search), o = { debug: 0 };
  if (q.get('peerhost')) Object.assign(o, { host: q.get('peerhost'), port: +(q.get('peerport') || 9000), path: q.get('peerpath') || '/', secure: false, config: { iceServers: [] } });
  return o;
}
function netSend(m) { if (NET.conn && NET.conn.open) { try { NET.conn.send(m); } catch (e) { } } }
function netEvent(m) { if (NET_ROLE === 'host' && netMate.on) netSend(m); }
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function hostGame() {
  if (NET.peer) return;
  const code = Array.from({ length: 5 }, () => CODE_CH[Math.floor(Math.random() * CODE_CH.length)]).join('');
  NET.code = code; NET.status = 'Ouverture de ton île…'; refreshDuo();
  const peer = new Peer('everisle-' + code, peerOpts()); NET.peer = peer;
  peer.on('open', () => { NET.status = 'host-wait'; refreshDuo(); });
  peer.on('connection', c => { if (NET.conn) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); }); return; } bindConn(c, 'host'); });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { } });
  peer.on('error', e => { NET.status = 'Erreur réseau : ' + (e.type || e.message); refreshDuo(); if (e.type === 'unavailable-id') { try { peer.destroy(); } catch (_) { } NET.peer = null; } });
}
function joinGame(code) {
  code = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) { toast('⚠️', 'Code invalide', 'Le code fait 5 caractères'); return; }
  if (ME.name === 'Kael') ME.name = 'Lyra';
  if (NET.peer) { try { NET.peer.destroy(); } catch (_) { } NET.peer = null; }
  NET.status = 'Connexion à l\'île ' + code + '…'; refreshDuo();
  const peer = new Peer(undefined, peerOpts()); NET.peer = peer;
  peer.on('open', () => { bindConn(peer.connect('everisle-' + code, { reliable: true }), 'guest'); });
  peer.on('error', e => { NET.status = e.type === 'peer-unavailable' ? 'Aucune île ouverte avec ce code' : 'Erreur réseau : ' + (e.type || e.message); refreshDuo(); try { peer.destroy(); } catch (_) { } if (NET.peer === peer) NET.peer = null; });
}
function bindConn(c, role) {
  c.on('open', () => {
    NET.conn = c;
    if (role === 'host') { NET_ROLE = 'host'; netMate.on = true; netMate.p.copy(lyra.position); c.send({ t: 'hello', name: ME.name, full: fullState() }); }
    else c.send({ t: 'join', name: ME.name });
    refreshDuo();
  });
  c.on('data', m => { try { onNet(m, role); } catch (e) { console.error(e); } });
  const closed = () => onClose(role, c);
  c.on('close', closed); c.on('error', closed);
}
function onClose(role, c) {
  if (NET.conn !== c) return;
  NET.conn = null;
  if (role === 'host') { netMate.on = false; NET_ROLE = 'solo'; NET.status = 'host-wait'; toast('🔌', `${netMate.name} s'est déconnecté(e)`, 'Lyra reprend en mode IA'); updateMateTag(); refreshDuo(); }
  else { toast('🔌', 'Déconnecté de l\'île de ton duo', 'Retour sur ton île…'); setTimeout(() => location.reload(), 2500); }
}
function leaveDuo() {
  if (NET.conn) try { NET.conn.close(); } catch (e) { }
  if (NET.peer) try { NET.peer.destroy(); } catch (e) { }
  NET.peer = null; NET.status = '';
  if (NET_ROLE === 'guest') setTimeout(() => location.reload(), 200);
  else { NET_ROLE = 'solo'; netMate.on = false; NET.conn = null; updateMateTag(); }
  refreshDuo();
}
const sharedS = () => { const o = {}; for (const k in S) if (k !== 'builds' && k !== 'villagers') o[k] = S[k]; return JSON.parse(JSON.stringify(o)); };
function fullState() {
  return {
    S: sharedS(), sites: SITES.map(siteNet), trees: TREES.filter(t => t.state !== 'up').map(t => [t.id, t.state, t.hp]),
    rocks: ROCKS.map(r => r.hp), berries: BERRIES.map(b => b.ready ? 1 : 0),
    res: RESIDENTS.map(r => ({ rec: r.rec, x: r.v.position.x, z: r.v.position.z })),
    mon: MONSTERS.filter(m => !m.userData.dead).map(m => [m.userData.id, m.userData.boss ? 1 : 0, m.position.x, m.position.z, m.userData.hp]),
    me: [player.position.x, player.position.z]
  };
}
const ANIMS = ['idle', 'walk', 'mine', 'rest'];
function applyFull(f, hostName) {
  NET_ROLE = 'guest'; netMate.on = true; netMate.name = hostName || 'Hôte';
  SITES.slice().forEach(s => { scene.remove(s.g); removeTag(s.tag); }); SITES.length = 0; FIRES.length = 0;
  RESIDENTS.forEach(r => { scene.remove(r.v); removeTag(r.tag); const i = chars.indexOf(r.v); if (i >= 0) chars.splice(i, 1); }); RESIDENTS.length = 0;
  MONSTERS.forEach(m => scene.remove(m)); MONSTERS.length = 0;
  Object.assign(S, f.S);
  TREES.forEach(t => { if (t.state !== 'up') { t.state = 'up'; t.hp = 4; setTree(t); } });
  f.trees.forEach(([i, st, hp]) => { const t = TREES[i]; if (!t) return; t.hp = hp; t.state = st === 'falling' ? 'gone' : st; t.t = 0; setTree(t, null, st === 'growing' ? .5 : .0001, st !== 'growing'); });
  f.rocks.forEach((hp, i) => { const r = ROCKS[i]; if (!r) return; r.hp = hp; r.mesh.visible = hp > 0; r.mesh.scale.copy(r.base); });
  f.berries.forEach((v, i) => { const b = BERRIES[i]; if (!b) return; b.ready = !!v; b.berries.visible = !!v; });
  f.sites.forEach(n => { const s = createSite(n.type, n.x, n.z, n.ry, { id: n.id, level: n.level, p: n.p }); if (n.upg) { s.upg = n.upg; addScaffold(s); s.tag = addTag(siteTagHtml(s, 'Amélioration…'), V(s.x, H(s.x, s.z) + s.def.th + 1, s.z), 0, 'build'); } });
  f.res.forEach(o => { const r = spawnResident(o.rec, false); r.v.position.set(o.x, H(o.x, o.z), o.z); r.state = 'work'; });
  f.mon.forEach(([id, boss, x, z, hp]) => { const m = makeMonster(id, !!boss, x, z); m.userData.hp = hp; m.userData.age = 1; });
  Object.assign(BOUNDS, BASE_BOUNDS);
  REGIONS.forEach(r => { if (r.open) { r.open = false; if (!r.mesh) makeBarrier(r); } });
  updateRegions(0, true);
  if (S.mineDone) addMineFlag(); updateMineTag();
  player = lyra; mate = kaelC; player.userData.anim = 'idle'; applyGearVisual(kaelC, { tool: 0, weapon: 0, bow: 0, armor: 0 }); applyGearVisual(lyra, ME.gear);
  $('av1').firstChild.textContent = '👩🏽'; $('av2').firstChild.textContent = '🧑🏻';
  $('p1card').classList.add('p2'); $('p2card').classList.remove('p2');
  player.position.set(f.me[0] + 1.5, 0, f.me[1] + 1.5); player.position.y = H(player.position.x, player.position.z);
  collide(player.position, .42); camTarget.copy(player.position);
  questSig = ''; renderQuests(); repaintMask(); drawMinimapBuilds(); updateMateTag();
  wasNight = isNightAt(S.time);
  toast('🤝', `Bienvenue sur l'île de ${netMate.name} !`, 'Tout ce que vous faites est partagé');
}
function onNet(m, role) {
  if (role === 'host') {
    switch (m.t) {
      case 'join': netMate.name = String(m.name || 'Lyra').slice(0, 14); updateMateTag(); worldToast('🤝', `${netMate.name} a rejoint ton île !`, 'Jouez ensemble : tout est partagé'); refreshDuo(); break;
      case 'me': { const [x, z, ry, a, sw, sh] = m.p; netMate.p.set(x, 0, z); netMate.ry = ry; netMate.anim = ANIMS[a] || 'idle'; if (sw) lyra.userData.swing = .35; if (sh) lyra.userData.shoot = .35; netMate.hp = m.hp; if (m.g && JSON.stringify(m.g) !== JSON.stringify(netMate.gear)) { netMate.gear = m.g; applyGearVisual(lyra, m.g); } break; }
      case 'req': hostRequest(m); break;
    }
    return;
  }
  switch (m.t) {
    case 'hello': applyFull(m.full, m.name); break;
    case 'full': toast('🚫', 'Cette île a déjà deux joueurs'); break;
    case 'snap': applySnap(m); break;
    case 'toast': toast(m.face, m.title, m.sub); break;
    case 'fx': floatText(m.txt, V(...m.p), m.c || undefined, false); break;
    case 'tree': { const t = TREES[m.i]; if (!t) break; t.hp = m.hp; fxTree(t); if (m.st === 'falling' && t.state === 'up') { t.state = 'falling'; t.t = 0; t.fdx = m.fdx; t.fdz = m.fdz; } else if (m.st === 'growing') { t.state = 'growing'; t.t = 0; } else if (m.st === 'up' && t.state === 'up') t.shake = .3; break; }
    case 'rock': { const r = ROCKS[m.i]; if (!r) break; if (m.hp < r.hp) fxRock(r); r.hp = m.hp; r.shake = .25; r.mesh.visible = m.hp > 0; r.mesh.scale.copy(r.base).multiplyScalar(m.hp >= r.max ? 1 : .55 + m.hp / r.max * .45); break; }
    case 'berry': { const b = BERRIES[m.i]; if (b) { if (!m.ready) burst(V(b.x, H(b.x, b.z) + .8, b.z), FX.berry, 10, { speed: 2.5, up: 2.5, size: .06 }); b.ready = m.ready; b.berries.visible = m.ready; } break; }
    case 'site': {
      const n = m.s; let s = SITES.find(x => x.id === n.id);
      if (!s) { s = createSite(n.type, n.x, n.z, n.ry, { id: n.id, level: n.level, p: n.p }); }
      if (n.upg && !s.upg) { s.upg = { ...n.upg }; addScaffold(s); s.tag = addTag(siteTagHtml(s, 'Amélioration…'), V(s.x, H(s.x, s.z) + s.def.th + 1, s.z), 0, 'build'); }
      if (!n.upg && s.upg) { s.upg.level = n.level; finishUpgrade(s); }
      if (n.done && !s.done) finishSite(s, true);
      break;
    }
    case 'sitedel': { const s = SITES.find(x => x.id === m.id); if (s) demolish(s); break; }
    case 'res': if (!RESIDENTS.some(r => r.rec.id === m.rec.id)) spawnResident(m.rec, true); break;
    case 'job': { const r = RESIDENTS.find(r => r.rec.id === m.id); if (r) { r.rec.job = m.job; r.tag.el.querySelector('.jt').textContent = `${JOBS[m.job].ic} ${JOBS[m.job].n}`; } break; }
    case 'arrow': shootArrow(V(...m.f), { position: V(...m.to).setY(m.to[1] - .5) }, null, false); break;
    case 'dmg': damagePlayer(m.n); break;
    case 'crafted': gearDone(m.item, m.tier); break;
  }
}
function hostRequest(m) {
  switch (m.k) {
    case 'act': { const o = tgFromId(m.type, m.id); if (m.type === 'mine' || m.type === 'fish' || o) performAction(m.type, o, lyra); break; }
    case 'build': doBuild(m); break;
    case 'up': { const s = SITES.find(x => x.id === m.id); if (s) startUpgrade(s); break; }
    case 'del': { const s = SITES.find(x => x.id === m.id); if (s) demolish(s); break; }
    case 'job': setJob(m.id, m.job); break;
    case 'trade': doTrade(m.kind, m.arg); break;
    case 'eat': if (S.food >= 2) S.food -= 2; break;
    case 'hitmon': { const mo = MONSTERS.find(x => x.userData.id === m.id); if (mo) hurtMonster(mo, Math.min(2, m.dmg || 1), lyra.position); break; }
    case 'hitdeer': { const d = DEER[m.id]; if (d) hurtDeer(d, 1 + ((netMate.gear || {}).bow || 0), lyra.position); break; }
    case 'craft': { const g = GEAR[m.item], cost = g && (m.tier === 1 || m.tier === 2) && g.cost[m.tier]; if (cost && canAfford(cost)) { Object.entries(cost).forEach(([k, v]) => S[k] -= v); netSend({ t: 'crafted', item: m.item, tier: m.tier }); } else netSend({ t: 'toast', face: '🛠️', title: 'Ressources insuffisantes', sub: '' }); break; }
    case 'gift': { if (m.rew) Object.entries(m.rew).forEach(([k, v]) => { if (RES_IC[k] && v > 0 && v < 400) S[k] += v; }); break; }
  }
}
const npcList = () => [[1, builder], [2, carrier], ...RESIDENTS.map(r => [r.rec.id, r.v])];
let rstatT = 0;
function sendSnap() {
  const u = player.userData;
  const snap = {
    t: 'snap', s: sharedS(),
    me: [player.position.x, player.position.z, player.rotation.y, Math.max(0, ANIMS.indexOf(u.anim)), u.swing > .25 ? 1 : 0, u.shoot > .25 ? 1 : 0],
    npc: npcList().map(([id, c]) => [id, +c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2), +c.rotation.y.toFixed(2), Math.max(0, ANIMS.indexOf(c.userData.anim)), c.visible ? 1 : 0, c.userData.carry ? 1 : 0]),
    mon: MONSTERS.filter(m => !m.userData.dead).map(m => [m.userData.id, +m.position.x.toFixed(2), +m.position.z.toFixed(2), m.userData.boss ? 1 : 0, m.userData.hurt > 0 ? 1 : 0]),
    deer: DEER.map(d => [+d.g.position.x.toFixed(2), +d.g.position.z.toFixed(2), +d.g.rotation.y.toFixed(2), d.state === 'dead' ? 1 : 0, d.fleeT > 0 ? 1 : d.state === 'walk' ? .5 : 0]),
    sites: SITES.filter(needsWork).map(s => [s.id, s.p, s.upg ? s.upg.p : -1]), mg: ME.gear,
  };
  rstatT -= .1; if (rstatT <= 0) { rstatT = 1; snap.rs = RESIDENTS.map(r => [r.rec.id, r.status, r.rec.xp]); snap.bs = bram.status; }
  netSend(snap);
}
function applySnap(m) {
  if (m.s.lvl > S.lvl && S.lvl) { banner(`Île niveau ${m.s.lvl} !`, UNLOCKS[m.s.lvl] ? 'Débloqué : ' + UNLOCKS[m.s.lvl] : 'Prospérité en hausse', '🏝️'); burst(player.position.clone().setY(player.position.y + 1.5), FX.gold, 50, { speed: 5, up: 6, life: 1.4 }); sfx('level'); }
  if (m.mg && JSON.stringify(m.mg) !== JSON.stringify(netMate.gear)) { netMate.gear = m.mg; applyGearVisual(kaelC, m.mg); }
  const keep = { builds: S.builds, villagers: S.villagers };
  Object.assign(S, m.s, keep);
  const [x, z, ry, a, sw, sh] = m.me; netMate.p.set(x, 0, z); netMate.ry = ry; netMate.anim = ANIMS[a]; if (sw) kaelC.userData.swing = .35; if (sh) kaelC.userData.shoot = .35;
  const map = new Map(npcList());
  m.npc.forEach(([id, x2, y2, z2, r2, a2, vis, carry]) => { const c = map.get(id); if (!c) return; c.userData.net = { x: x2, y: y2, z: z2, ry: r2 }; c.userData.anim = ANIMS[a2]; c.visible = !!vis; c.userData.carry = !!carry; });
  const seen = new Set();
  m.mon.forEach(([id, x2, z2, boss, hurt]) => { seen.add(id); let mo = MONSTERS.find(q => q.userData.id === id); if (!mo) { mo = makeMonster(id, !!boss, x2, z2); mo.userData.age = 1; } mo.userData.net = { x: x2, z: z2 }; if (hurt) mo.userData.hurt = .18; });
  MONSTERS.forEach(mo => { if (!seen.has(mo.userData.id) && !mo.userData.dead) { mo.userData.dead = true; mo.userData.dt = 0; burst(mo.position.clone().setY(mo.position.y + .6), FX.shadow, 20, { speed: 4, up: 4, size: .1, life: 1.1 }); } });
  m.deer.forEach(([x2, z2, r2, dead, mv], i) => { const d = DEER[i]; if (!d) return; d.net = { x: x2, z: z2, ry: r2 }; d.netMv = mv; if (dead && d.state !== 'dead') { d.state = 'dead'; d.dt = 0; } else if (!dead && d.state === 'dead') { d.state = 'graze'; d.g.rotation.z = 0; d.g.visible = true; d.g.position.set(x2, H(x2, z2), z2); } });
  m.sites.forEach(([id, p, up]) => { const s = SITES.find(q => q.id === id); if (!s) return; if (up >= 0 && s.upg) { s.upg.p = up; applySite(s); } else if (!s.upg) { s.p = p; applySite(s); } if (s.tag) { const pp = up >= 0 ? up : p; s.tag.el.querySelector('.st').textContent = `👷 Construction… ${Math.floor(pp * 100)} %`; s.tag.el.querySelector('.pb i').style.width = (pp * 100) + '%'; } });
  if (m.rs) { m.rs.forEach(([id, st, xp]) => { const r = RESIDENTS.find(q => q.rec.id === id); if (r) { r.status = st; r.rec.xp = xp; } }); bram.status = m.bs; }
}
function guestSim(dt, t) {
  const k = 1 - Math.exp(-dt * 12);
  npcList().forEach(([, c]) => { const n = c.userData.net; if (!n) return; c.position.x += (n.x - c.position.x) * k; c.position.y += (n.y - c.position.y) * k; c.position.z += (n.z - c.position.z) * k; c.rotation.y = lerpAng(c.rotation.y, n.ry, k); });
  for (let i = MONSTERS.length - 1; i >= 0; i--) {
    const mo = MONSTERS[i], u = mo.userData;
    if (u.dead) { u.dt += dt; mo.scale.setScalar(Math.max(.001, (1 - u.dt / .45) * u.size)); if (u.dt >= .45) { scene.remove(mo); MONSTERS.splice(i, 1); } continue; }
    if (u.net) { mo.position.x += (u.net.x - mo.position.x) * k; mo.position.z += (u.net.z - mo.position.z) * k; mo.position.y = Math.max(H(mo.position.x, mo.position.z), -1.05); mo.rotation.y = lerpAng(mo.rotation.y, Math.atan2(player.position.x - mo.position.x, player.position.z - mo.position.z), k); }
    u.hurt -= dt; mo.scale.setScalar(u.size); animMonster(mo, t);
  }
  DEER.forEach(d => {
    if (d.state === 'dead') { d.dt += dt; d.g.rotation.z = Math.min(1.5, d.dt * 3); if (d.dt > 2) d.g.visible = false; return; }
    if (d.net) { const p = d.g.position; p.x += (d.net.x - p.x) * k; p.z += (d.net.z - p.z) * k; p.y = Math.max(H(p.x, p.z), -1); d.g.rotation.y = lerpAng(d.g.rotation.y, d.net.ry, k); }
    animDeer(d, t, d.netMv || 0);
  });
}
function remoteMate(dt) {
  const k = 1 - Math.exp(-dt * 12), p = lyra.position;
  p.x += (netMate.p.x - p.x) * k; p.z += (netMate.p.z - p.z) * k; p.y = Math.max(H(p.x, p.z), -1.05);
  lyra.rotation.y = lerpAng(lyra.rotation.y, netMate.ry, k); lyra.userData.anim = netMate.anim;
}
function guestMate(dt) {
  const k = 1 - Math.exp(-dt * 12), p = kaelC.position;
  p.x += (netMate.p.x - p.x) * k; p.z += (netMate.p.z - p.z) * k; p.y = Math.max(H(p.x, p.z), -1.05);
  kaelC.rotation.y = lerpAng(kaelC.rotation.y, netMate.ry, k); kaelC.userData.anim = netMate.anim;
}
let mateTag = null;
function updateMateTag() {
  const online = netMate.on, name = online ? netMate.name : 'Lyra';
  if (!mateTag) mateTag = addTag('', mate, 1.95, 'player2');
  mateTag.target = mate;
  mateTag.el.innerHTML = `<div class="box">${esc(name)}<small>${online ? '🟢 En ligne' : '🤖 IA (solo)'}</small></div>`;
  $('p2n').textContent = name; $('ly-s').textContent = online ? 'Duo · 🟢 en ligne' : 'IA · ' + (LY.mode || 'Chasse en prairie');
  $('p1n').textContent = ME.name;
}
function duoHtml() {
  const connected = netMate.on;
  let state;
  if (connected) state = `<p class="ok">🟢 Connecté avec <b>${esc(netMate.name)}</b> ${NET_ROLE === 'host' ? '(tu héberges l\'île)' : '(tu joues sur son île)'}</p><button class="gbtn red tap" id="d-leave">Se déconnecter</button>`;
  else if (NET.status === 'host-wait') state = `<p>Ton île est ouverte. Donne ce code à ton duo :</p><div class="bigcode">${NET.code}</div><p class="note">En attente de connexion… garde le jeu ouvert.</p><button class="gbtn red tap" id="d-leave">Fermer l'île</button>`;
  else state = `<div class="duo-row"><button class="gbtn tap" id="d-host">🏝️ Héberger mon île</button></div>
    <div class="duo-row"><input id="d-code" class="tap" maxlength="5" placeholder="CODE" autocomplete="off" autocapitalize="characters"><button class="gbtn tap" id="d-join">🤝 Rejoindre</button></div>
    ${NET.status ? `<p class="note">${esc(NET.status)}</p>` : ''}`;
  return `<p>Jouez à deux sur la même île, chacun sur son téléphone (connexion internet nécessaire).</p>
    <div class="duo-row"><label>Ton nom <input id="d-name" class="tap" maxlength="12" value="${esc(ME.name)}" ${connected ? 'disabled' : ''}></label></div>
    ${state}
    <p class="note">L'hôte garde la sauvegarde de l'île. Vous partagez les ressources, les bâtiments, les villageois, les territoires et le niveau de l'île ; chacun garde son personnage, son niveau et sa vie. Sans duo, Lyra joue avec toi en IA.</p>`;
}
function openDuo() {
  modalRefresh = openDuo;
  openModal('💬 Jouer en duo', duoHtml());
  const nm = $('d-name'); if (nm) nm.addEventListener('change', () => { ME.name = nm.value.trim().slice(0, 12) || ME.name; updateMateTag(); save(); });
  const h = $('d-host'); if (h) h.addEventListener('click', hostGame);
  const j = $('d-join'); if (j) j.addEventListener('click', () => { if (nm) { ME.name = nm.value.trim().slice(0, 12) || 'Lyra'; if (ME.name === 'Kael') ME.name = 'Lyra'; } joinGame($('d-code').value); });
  const l = $('d-leave'); if (l) l.addEventListener('click', leaveDuo);
}
function refreshDuo() { if (modalOpen === '💬 Jouer en duo') openDuo(); }
$('b-duo').addEventListener('click', openDuo); $('p2card').addEventListener('click', openDuo);

/* ================= DÉMARRAGE ================= */
if (loadedV1) {
  S.builds.forEach(b => { if (b.id == null) b.id = siteSeq++; b.level = b.level || 1; });
  S.villagers = S.villagers.map((r, i) => ({ id: S.nextId++, name: r.name, job: LABEL2JOB[r.job] || 'lumber', color: r.color || SHIRTS[i % SHIRTS.length], trait: TRAITS[i % TRAITS.length], xp: 0, homeKey: [r.hx, r.hz] }));
  S.v = 2;
}
siteSeq = Math.max(siteSeq, ...S.builds.map(b => (b.id || 0) + 1));
if (!S.villageV) {
  S.villageV = 1;
  [['cottage', -2.4, 13.8, 'Rosa', 'miner', '#b06a4a', true], ['timber', 11.2, 15.0, 'Théo', 'builder', '#4a7a9a', false], ['nordic', 12.8, 4.2, 'Inès', 'hunter', '#5a4a7a', true]].forEach(([type, x, z, name, job, color, dress]) => {
    const r = BUILDS[type].r;
    if (S.builds.some(b => Math.hypot(b.x - x, b.z - z) < r + 3.2) || STATIC_COLS.some(c => Math.hypot(c.x - x, c.z - z) < c.r + r - .2)) return;
    const id = siteSeq++; S.builds.push({ id, type, x, z, ry: faceSQ(x, z), level: 1, pre: true });
    S.villagers.push({ id: S.nextId++, name, job, color, trait: 'Joyeux', xp: 15, homeId: id, dress });
  });
}
S.builds.forEach(b => createSite(b.type, b.x, b.z, b.ry, { id: b.id, level: b.level || 1, p: 1 }));
S.villagers.forEach(rec => { if (rec.homeKey) { const s = SITES.find(s => s.type === 'cabin' && Math.abs(s.x - rec.homeKey[0]) < .01 && Math.abs(s.z - rec.homeKey[1]) < .01); rec.homeId = s ? s.id : null; delete rec.homeKey; } });
if (!S.started) {
  S.started = true;
  S.villagers.push({ id: S.nextId++, name: 'Hugo', job: 'lumber', color: '#7a5a3a', trait: 'Travailleur', xp: 10, cottage: 0 });
  S.villagers.push({ id: S.nextId++, name: 'Lina', job: 'gatherer', color: '#9a5a7a', trait: 'Joyeux', xp: 10, cottage: 2, dress: true });
}
S.villagers.forEach(rec => spawnResident(rec, false));
if (S.mineDone) addMineFlag();
updateRegions(0, true);
addTag('<div class="box">Bram<small>🔨 Constructeur</small></div>', builder, 1.75, 'near');
updateMateTag();
applyGearVisual(player, ME.gear);

/* ---------- boucle ---------- */
const clock = new THREE.Clock(); let hudT = 0, saveT = 0, netT = 0, lastAct = '', errShown = false, simT = 0;
const marker = $('marker');
updateMineTag(); renderQuests(); hud(); drawMinimapBuilds();
function loop() {
  requestAnimationFrame(loop);
  try { const raw = clock.getDelta(), dt = Math.min(raw, .1); simT += dt; autoQuality(raw); tick(dt, simT); composer.render(); }
  catch (err) { if (!errShown) { errShown = true; console.error(err); } }
}
function tick(dt, t) {
  uTime.value = t; window._water.uniforms.uTime.value = t; grade.uniforms.uTime.value = t;
  const guest = NET_ROLE === 'guest';
  const night = updateDay(guest ? 0 : dt); updateWeather(dt);
  updatePlayer(dt, night);
  updateTrees(dt); updateResources(dt); updateRegions(dt, false);
  if (guest) { guestSim(dt, t); guestMate(dt); }
  else {
    workerAI(bram, dt, night); RESIDENTS.forEach(r => workerAI(r, dt, night)); carrierAI(dt);
    if (netMate.on) remoteMate(dt); else lyraAI(dt, night);
    monstersAI(dt, t, night); towersAI(dt, night); deerAI(dt, t);
  }
  arrowsAI(dt); updateParticles(dt); updateSmoke(dt); chickensAI(dt, t); updateAudio(dt, night);
  PLAYER_U.value.copy(player.position);
  LAMPS.forEach(b => { if (b.light) b.light.intensity = nightK * (QUALITY.cur === 'low' ? 0 : 5); });
  BANNERS.forEach((b, i) => { b.rotation.y = Math.sin(t * 1.6 + i) * .3; });
  if (window._jet) { window._jet.scale.y = 1 + Math.sin(t * 9) * .12; window._fall.material.opacity = .35 + Math.sin(t * 5) * .08; }
  chars.forEach(c => { if (c.visible) animChar(c, t, dt); });
  FIRES.forEach(f => { if (!f.flame) return; const k = 1 + Math.sin(t * 13 + f.x) * .08 + Math.sin(t * 29) * .05; f.flame.scale.set(1, k, 1); f.flame2.scale.set(1, 2 - k, 1); f.light.intensity = (3 + nightK * 9) * k; });
  SITES.forEach(s => { if (s.crops && s.done) s.crops.children.forEach((c, i) => { c.scale.y = .55 + .45 * (.5 + .5 * Math.sin(t * .4 + i * .3)); }); if (s.saw && s.done) s.saw.rotation.y += dt * 8; });
  if (window._flag) window._flag.rotation.y = Math.sin(t * 2) * .25;
  window._rope.rotation.z = Math.sin(t * .9) * .05; window._rope.rotation.x = Math.sin(t * .7) * .03;
  window._lantern.intensity = (4 + nightK * 6) + Math.sin(t * 9) * .4 + Math.sin(t * 23) * .3;
  window._pollen.position.y = Math.sin(t * .6) * .15;
  actCD -= dt; if (actHeld && !buildMode && actCD <= 0 && curTarget && curTarget.type !== 'bsite') doAction();
  curTarget = buildMode ? null : findTarget();
  const a = buildMode ? ['✔️', 'Placer'] : curTarget ? ACT[curTarget.type] : ['✋', 'Action'];
  const sig = a[0] + a[1];
  if (sig !== lastAct) { lastAct = sig; $('act-i').textContent = a[0]; $('act-l').textContent = a[1]; act.classList.toggle('pulse', !!curTarget || !!buildMode); }
  updateGhost(); updateCamera(dt); updateGuide(dt);
  const mp = buildMode ? null : targetPos(curTarget);
  if (mp) { const s = screenPos(mp); marker.style.display = s.ok ? 'block' : 'none'; marker.style.left = s.x + 'px'; marker.style.top = s.y + 'px'; } else marker.style.display = 'none';
  updateOverlay(dt); updateToast(dt);
  const hurtEl = $('hurt'), ho = parseFloat(hurtEl.style.opacity || 0); if (ho > 0) hurtEl.style.opacity = String(Math.max(0, ho - dt * 2.5));
  hudT -= dt; if (hudT <= 0) { hudT = .2; hud(); renderQuests(); if (!$('bmenu').classList.contains('hidden')) renderBuildMenu(); if (!guest && !netMate.on && LY.mode) $('ly-s').textContent = 'IA · ' + LY.mode; }
  saveT -= dt; if (saveT <= 0) { saveT = 5; save(); }
  netT -= dt; if (netT <= 0 && NET.conn) { netT = .1; if (NET_ROLE === 'host') sendSnap(); else if (guest) { const u = player.userData; netSend({ t: 'me', p: [player.position.x, player.position.z, player.rotation.y, Math.max(0, ANIMS.indexOf(u.anim)), u.swing > .25 ? 1 : 0, u.shoot > .25 ? 1 : 0], hp: ME.hp, g: ME.gear }); } }
}
loop();
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.__onPlay = () => { audioInit(); setTimeout(() => banner('Everisle', 'Bâtissez votre royaume insulaire à deux', `<img src="${window.__icon || ''}" style="height:11vh;border-radius:2.6vh;box-shadow:0 .8vh 2vh rgba(0,0,0,.5)">`), 500); setTimeout(checkDaily, 3600); toast('🏝️', 'Bienvenue sur Everisle !', 'Récolte, construis et fais grandir ton village. Menu 💬 Duo pour jouer à deux.'); };
setTimeout(() => { const l = $('loading'); if (l) { l.style.opacity = 0; setTimeout(() => l.remove(), 700); } }, 300);
window._ready = true;
window.__game = { ROADS, ME, craft, banner, burst, checkDaily, performAction, createSite, camera, isFree, addXP, openBuilding, step: sec => { for (let i = 0; i < sec * 20; i++) { simT += .05; tick(.05, simT); } }, S, ME, get player() { return player; }, kaelC, lyra, MONSTERS, SITES, TREES, ROCKS, BERRIES, DEER, RESIDENTS, BOUNDS, REGIONS, NET, netMate, startPlacement, placeBuild, doAction, findTarget, setJob, startUpgrade, doBuild, hostGame, joinGame, doTrade, keys, joyV, setTime: h => { S.time = h; }, role: () => NET_ROLE };

initNative();
