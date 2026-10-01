// Core: renderer, pixel pipeline, shared state, helpers, particles and one-shot effects.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {createPixelPipeline} from './pixel.js';
export {THREE, SkeletonUtils};

// ---------- math helpers ----------
export const TAU = Math.PI * 2, UP = new THREE.Vector3(0, 1, 0);
export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerpAngle = (a, b, k) => { const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * k; };
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const C = {
  fire: new THREE.Color(1, .42, .08), ember: new THREE.Color(1, .18, .03), gold: new THREE.Color(1, .78, .3),
  ice: new THREE.Color(.45, .8, 1), white: new THREE.Color(1, 1, 1), void: new THREE.Color(.62, .25, 1),
  pink: new THREE.Color(1, .3, .75), green: new THREE.Color(.45, 1, .35), leaf: new THREE.Color(.75, 1, .25),
  bolt: new THREE.Color(.55, .75, 1), snow: new THREE.Color(.8, .85, .95), red: new THREE.Color(1, .15, .1),
};

// ---------- shared game state ----------
export const G = {
  scene: null, hero: null, enemies: [], drops: [], lights: [], shake: 0, time: 0, map: null, biome: null,
  paused: false, state: 'menu', cursor: new THREE.Vector3(), hover: null,
};

// ---------- renderer ----------
const canvas = document.getElementById('c');
export const worldUI = document.getElementById('world');
export const renderer = new THREE.WebGLRenderer({canvas, antialias: false, powerPreference: 'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Orthographic, with the same angle and framing as the old 45° perspective view at the hero:
// without perspective the world lands on a fixed pixel grid, which the pixel pipeline relies on.
export const VIEW_H = 13.8;
export const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 200);
function frameCamera() {
  camera.top = VIEW_H / 2; camera.bottom = -VIEW_H / 2; camera.right = camera.top * innerWidth / innerHeight; camera.left = -camera.right;
  camera.updateProjectionMatrix();
}
frameCamera();
const pixel = createPixelPipeline(renderer);
// biomes.js still sets bloom values per biome; the pixel pipeline has no bloom pass (glows spill through the light layer)
export const bloom = {strength: .5, radius: .4, threshold: 1};
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); frameCamera(); });
export const render = () => { parts.mat.uniforms.pr.value = pixel.scale(); pixel.render(G.scene, camera); };

// ---------- materials & mesh helpers ----------
export function std(c, o = {}) {
  return new THREE.MeshStandardMaterial({color: c, roughness: o.r ?? .8, metalness: o.m ?? 0, emissive: o.e ?? 0, emissiveIntensity: o.ei ?? 1,
    flatShading: !!o.f, transparent: !!o.t, opacity: o.o ?? 1, side: o.ds ? THREE.DoubleSide : THREE.FrontSide});
}
export function glow(c, k = 4, o = {}) {
  const m = new THREE.MeshBasicMaterial({color: new THREE.Color(c).multiplyScalar(k), transparent: !!o.add || o.o !== undefined,
    opacity: o.o ?? 1, side: o.ds ? THREE.DoubleSide : THREE.FrontSide, fog: o.fog ?? true});
  if (o.add) { m.blending = THREE.AdditiveBlending; m.depthWrite = false; }
  return m;
}
export function add(par, geo, mat, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  if (o.rx) m.rotation.x = o.rx; if (o.ry) m.rotation.y = o.ry; if (o.rz) m.rotation.z = o.rz;
  if (o.s !== undefined) typeof o.s === 'number' ? m.scale.setScalar(o.s) : m.scale.set(...o.s);
  m.castShadow = o.cast ?? !mat.isMeshBasicMaterial; m.receiveShadow = !mat.isMeshBasicMaterial;
  par.add(m); return m;
}
export function ctex(w, h, draw, rep = 1, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function blotches(g, w, h, cols, n, r0, r1, al = .3) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = al * Math.random(); g.fillStyle = cols[i % cols.length];
    const x = Math.random() * w, y = Math.random() * h, r = rand(r0, r1);
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) { g.beginPath(); g.arc(x + dx, y + dy, r, 0, TAU); g.fill(); }
  }
  g.globalAlpha = 1;
}
export function cracks(g, w, h, n, col, lw0, lw1, step = 14, len = 14) {
  g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let i = 0; i < n; i++) {
    let x = Math.random() * w, y = Math.random() * h, a = Math.random() * TAU; g.lineWidth = rand(lw0, lw1); g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < len; k++) { a += rand(-.7, .7); x += Math.cos(a) * step; y += Math.sin(a) * step; g.lineTo(x, y); }
    g.stroke();
  }
}
export const glowTex = ctex(128, 128, g => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.22, 'rgba(255,255,255,.55)');
  gr.addColorStop(.6, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
}, 1, false);
glowTex.userData.keep = true;
export function glowSprite(c, k, size, fog = true) {
  const m = new THREE.SpriteMaterial({map: glowTex, color: new THREE.Color(c).multiplyScalar(k), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog});
  const s = new THREE.Sprite(m); s.scale.setScalar(size); return s;
}

// ---------- particles (one additive point cloud, ring buffer) ----------
class Particles {
  constructor(max) {
    this.max = max; this.i = 0; const A = n => new Float32Array(max * n);
    this.p = A(3); this.v = A(3); this.c = A(3); this.s = A(1); this.a = A(1); this.l = A(1); this.ml = A(1); this.s0 = A(1); this.gr = A(1); this.dr = A(1); this.at = A(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); g.setAttribute('pcol', new THREE.BufferAttribute(this.c, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.s, 1)); g.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {pr: {value: renderer.getPixelRatio()}},
      vertexShader: `uniform float pr;attribute float size;attribute float alpha;attribute vec3 pcol;varying vec3 vC;varying float vA;
        void main(){vC=pcol;vA=alpha;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=alpha<=0.0?0.0:max(1.0,size*pr*(420.0/-mv.z));gl_Position=projectionMatrix*mv;}`,
      // alpha = brightness: in the pixel pipeline alpha marks how much a pixel glows (and ignores lighting)
      fragmentShader: `varying vec3 vC;varying float vA;void main(){float r=length(gl_PointCoord-.5);if(r>.5)discard;float a=pow(1.0-r*2.0,1.5);vec3 c=vC*a*vA;gl_FragColor=vec4(c,min(1.0,max(c.r,max(c.g,c.b))*.6));}`,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, depthWrite: false, transparent: true});
    this.mat.userData.keep = true; g.userData.keep = true;
    this.obj = new THREE.Points(g, this.mat); this.obj.frustumCulled = false; this.g = g; this.attr = null; this.attrK = 0;
  }
  reset() { this.l.fill(0); this.a.fill(0); this.attr = null; }
  emit(x, y, z, vx, vy, vz, col, b, life, size, grav = 0, drag = 0, at = 0) {
    const i = this.i; this.i = (i + 1) % this.max; const j = i * 3;
    this.p[j] = x; this.p[j + 1] = y; this.p[j + 2] = z; this.v[j] = vx; this.v[j + 1] = vy; this.v[j + 2] = vz;
    this.c[j] = col.r * b; this.c[j + 1] = col.g * b; this.c[j + 2] = col.b * b;
    this.l[i] = this.ml[i] = life; this.s0[i] = size; this.gr[i] = grav; this.dr[i] = drag; this.at[i] = at;
  }
  burst(pos, n, o) {
    const J = o.jit || 0;
    for (let k = 0; k < n; k++) {
      const col = o.cols ? o.cols[k % o.cols.length] : o.col;
      let dx = rand(-1, 1), dy = rand(-1, 1), dz = rand(-1, 1); const L = Math.hypot(dx, dy, dz) || 1; const sp = o.speed * rand(.25, 1);
      dx /= L; dy /= L; dz /= L; if (o.flat) dy *= .25;
      this.emit(pos.x + rand(-J, J), pos.y + rand(-J, J), pos.z + rand(-J, J), dx * sp, dy * sp + (o.up || 0), dz * sp, col,
        (o.b || 3) * rand(.6, 1.2), (o.life || .8) * rand(.6, 1.2), (o.size || .25) * rand(.6, 1.3), o.grav || 0, o.drag || 0, 0);
    }
  }
  update(dt) {
    const {p, v, l, ml, s, s0, a, gr, dr, at} = this, A = this.attr, K = this.attrK;
    for (let i = 0; i < this.max; i++) {
      if (l[i] <= 0) { a[i] = 0; continue; }
      l[i] -= dt; const j = i * 3;
      if (at[i] && A) {
        const dx = A.x - p[j], dy = A.y - p[j + 1], dz = A.z - p[j + 2]; const d = Math.hypot(dx, dy, dz) + .001; const f = K * dt / Math.max(d, .6);
        v[j] += dx / d * f; v[j + 1] += dy / d * f; v[j + 2] += dz / d * f; if (d < .45) l[i] = 0;
      }
      v[j + 1] -= gr[i] * dt; const dk = 1 - Math.min(1, dr[i] * dt); v[j] *= dk; v[j + 1] *= dk; v[j + 2] *= dk;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      const k = Math.max(0, l[i] / ml[i]); a[i] = Math.min(1, (1 - k) * 12) * Math.min(1, k * 2.2); s[i] = s0[i] * (.35 + .65 * k);
    }
    for (const n of ['position', 'pcol', 'size', 'alpha']) this.g.attributes[n].needsUpdate = true;
  }
}
export const parts = new Particles(14000);

// ---------- scene lifecycle ----------
function disposeScene(s) {
  s.traverse(o => {
    if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (m.userData.keep) return;
      for (const k in m) { const v = m[k]; if (v && v.isTexture && !v.userData.keep) v.dispose(); }
      m.dispose();
    });
  });
}
export function newScene() {
  FX = []; if (G.scene) { G.scene.remove(parts.obj); disposeScene(G.scene); }
  worldUI.innerHTML = ''; G.scene = new THREE.Scene();
  G.enemies = []; G.drops = []; G.lights = []; G.shake = 0; parts.reset(); G.scene.add(parts.obj);
  for (let i = 0; i < 5; i++) { const L = new THREE.PointLight(0xffffff, 0, 8, 2); L.userData.busy = false; G.scene.add(L); G.lights.push(L); }
  return G.scene;
}

// ---------- timed effects ----------
let FX = [];
export function fx(dur, up, end) { const f = {t: 0, dur, up, end}; FX.push(f); return f; }
export function after(t, fn) { return fx(t, null, fn); }
export function updateFX(dt) {
  for (let i = 0; i < FX.length; i++) {
    const f = FX[i]; f.t += dt; const k = Math.min(1, f.t / f.dur);
    if (f.up && f.up(k, dt, f) === true) f.t = f.dur;
    if (f.t >= f.dur) { f.done = true; f.end && f.end(); }
  }
  FX = FX.filter(f => !f.done);
}
export function takeLight(col, int, dist) {
  const L = G.lights.find(l => !l.userData.busy);
  if (!L) return {position: V(), intensity: 0, color: new THREE.Color(), userData: {}};
  L.userData.busy = true; L.color.set(col); L.intensity = int; L.distance = dist; return L;
}
export function freeLight(L) { L.intensity = 0; L.userData.busy = false; }
export function flashLight(pos, col, int, dur, dist = 8) {
  const L = takeLight(col, int, dist); L.position.copy(pos);
  fx(dur, k => { L.intensity = int * (1 - k) * (1 - k); }, () => freeLight(L));
}
const ringGeo = new THREE.RingGeometry(.86, 1, 72); ringGeo.userData.keep = true;
const thinRing = new THREE.RingGeometry(.95, 1, 72); thinRing.userData.keep = true;
const discGeo = new THREE.CircleGeometry(1, 48); discGeo.userData.keep = true;
const planeGeo = new THREE.PlaneGeometry(2, 2); planeGeo.userData.keep = true;
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true); cylGeo.userData.keep = true;
export function shockwave(pos, col, R, dur = .5, k = 4, y = .07) {
  const m = glow(col, k, {add: true, ds: true}); const r = new THREE.Mesh(ringGeo, m); r.rotation.x = -Math.PI / 2; r.position.set(pos.x, y, pos.z); G.scene.add(r);
  fx(dur, t => { const e = 1 - Math.pow(1 - t, 3); r.scale.setScalar(.2 + R * e); m.opacity = 1 - t; }, () => { G.scene.remove(r); m.dispose(); });
}
export function scorch(pos, R, dur = 4, op = .75) {
  const m = new THREE.MeshBasicMaterial({map: glowTex, color: 0x000000, transparent: true, opacity: op, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2});
  const d = new THREE.Mesh(planeGeo, m); d.rotation.x = -Math.PI / 2; d.position.set(pos.x, .04, pos.z); d.scale.setScalar(R); G.scene.add(d);
  fx(dur, k => { m.opacity = op * (1 - k * k); }, () => { G.scene.remove(d); m.dispose(); });
}
export function marker(pos, R, col, dur) {
  const g = new THREE.Group(); g.position.set(pos.x, .06, pos.z); G.scene.add(g);
  const m1 = glow(col, 3, {add: true, ds: true}), m2 = glow(col, .6, {add: true, ds: true});
  const ring = new THREE.Mesh(thinRing, m1), fill = new THREE.Mesh(discGeo, m2); ring.rotation.x = fill.rotation.x = -Math.PI / 2; g.add(ring, fill);
  fx(dur, k => {
    ring.scale.setScalar(R); fill.scale.setScalar(R * Math.min(1, k * 3));
    m1.opacity = Math.min(1, k * 4) * (k > .9 ? (1 - k) * 10 : 1); m2.opacity = .5 * (k > .9 ? (1 - k) * 10 : 1);
  }, () => { G.scene.remove(g); m1.dispose(); m2.dispose(); });
}
export function ghost(obj, col, dur, op = .45) {
  const c = SkeletonUtils.clone(obj); const rm = [];
  c.traverse(o => { if (o.isLight || o.isSprite || o.isPoints) rm.push(o); }); rm.forEach(o => o.parent.remove(o));
  const m = glow(col, 1.6, {add: true}); m.opacity = op;
  c.traverse(o => { if (o.isMesh) { o.material = m; o.castShadow = false; } }); G.scene.add(c);
  fx(dur, k => { m.opacity = op * (1 - k); }, () => { G.scene.remove(c); m.dispose(); });
}
export function orient(m, a, b, r) {
  const d = b.clone().sub(a); const L = d.length(); m.position.copy(a).addScaledVector(d, .5);
  m.quaternion.setFromUnitVectors(UP, d.normalize()); m.scale.set(r, L, r);
}
export function bolt(a, b, dur, col = 0xbfe0ff) {
  const g = new THREE.Group(); G.scene.add(g); const segs = 14; const m = glow(col, 7, {add: true}), m2 = glow(0x5a8cff, 1.4, {add: true}); m2.opacity = .5;
  const inner = [], outer = []; for (let i = 0; i < segs; i++) { inner.push(add(g, cylGeo, m)); outer.push(add(g, cylGeo, m2)); }
  const regen = () => {
    const pts = []; for (let i = 0; i <= segs; i++) { const t = i / segs; const p = a.clone().lerp(b, t); if (i > 0 && i < segs) { const j = Math.sin(t * Math.PI) * .5; p.x += rand(-j, j); p.y += rand(-j, j); p.z += rand(-j, j); } pts.push(p); }
    for (let i = 0; i < segs; i++) { orient(inner[i], pts[i], pts[i + 1], .035); orient(outer[i], pts[i], pts[i + 1], .11); }
  };
  regen(); let rt = 0;
  fx(dur, (k, dt) => { rt -= dt; if (rt <= 0) { rt = .04; regen(); } m.opacity = 1 - k * k; m2.opacity = .5 * (1 - k); }, () => { G.scene.remove(g); m.dispose(); m2.dispose(); });
}

// ---------- screen-space labels ----------
const pv = V();
export function toScreen(p) { pv.copy(p).project(camera); return {x: (pv.x * .5 + .5) * innerWidth, y: (-pv.y * .5 + .5) * innerHeight, vis: pv.z < 1}; }
export function place(el, p) {
  const s = toScreen(p); if (!s.vis) { el.style.display = 'none'; return; }
  el.style.display = ''; el.style.left = s.x + 'px'; el.style.top = s.y + 'px';
}
export function dmgNum(pos, amt, col, crit, big) {
  const d = document.createElement('div'); d.className = 'dmg'; d.textContent = amt + (crit ? '!' : ''); d.style.color = col;
  if (crit || big) d.style.fontSize = '27px'; worldUI.appendChild(d);
  const p = pos.clone(); const vx = rand(-.8, .8);
  fx(.95, (k, dt) => {
    p.y += dt * 1.6; p.x += vx * dt; place(d, p);
    d.style.opacity = k < .65 ? 1 : 1 - (k - .65) / .35; d.style.transform = `translate(-50%,-50%) scale(${k < .12 ? 1.7 - k * 5.8 : 1})`;
  }, () => d.remove());
}
