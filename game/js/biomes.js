// Biomes: how each generated map is dressed (lighting, floor, walls, props, ambient particles, enemies).
import {THREE, G, V, TAU, rand, randi, pick, std, glow, add, glowSprite, parts, C, bloom, renderer} from './core.js';
import {CS} from './map.js';
import {paintedTex} from './pixel.js';

function envBase(scene, o) {
  scene.background = new THREE.Color(o.bg); scene.fog = new THREE.Fog(o.bg, 26, 60);
  scene.add(new THREE.HemisphereLight(o.hemi[0], o.hemi[1], o.hemi[2]));
  const sun = new THREE.DirectionalLight(o.sun[0], o.sun[1]); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 70}); sun.shadow.bias = -.0004; sun.shadow.normalBias = .03;
  sun.userData.offset = V(...o.sun[2]); scene.add(sun, sun.target); G.sun = sun;
  renderer.toneMappingExposure = o.exp || 1; bloom.strength = o.bloom[0]; bloom.radius = o.bloom[1]; bloom.threshold = o.bloom[2];
}
// ---------- pixel-art surfaces: tiled floors, brick walls, torches (the look of the pixel sample) ----------
// Everything is laid out in world units first, then painted at exactly one texel per screen pixel (paintedTex repaints
// when the resolution setting changes). The camera sees floors and wall tops squashed by sin(pitch), wall faces by cos(pitch).
const PITCH = Math.atan2(13.7, 9.5), FLOOR_SQ = Math.sin(PITCH), WALL_SQ = Math.cos(PITCH);
const REP = 16; // the floor pattern repeats every 16 world units: 16 x 16 one-unit tiles
const seeded = s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return (h ^ (h >>> 16)) / 4294967296 + .5; };
export const PAL = {
  ember: {seed: 11, floor: ['#4a2a33', '#52303a', '#5a3540'], dark: '#2a1720', light: '#6b4048', wall: ['#3a2029', '#45262f', '#2f1a22'], top: '#7a4a4f', accent: 'lava', glow: '#ff7a2e', glowI: 1.3, flame: 0xffb04a},
  frost: {seed: 23, floor: ['#3a4a66', '#40527a', '#46597f'], dark: '#232e45', light: '#5b6f96', wall: ['#2b3a55', '#33456a', '#26324a'], top: '#86b3d9', accent: 'snow', flame: 0x86d9ff},
  ruins: {seed: 37, floor: ['#4a4236', '#524a3c', '#5a5142'], dark: '#2b261e', light: '#6e6450', wall: ['#3a3a2e', '#444436', '#303026'], top: '#85705a', accent: 'grass', flame: 0xffd35c},
  rift: {seed: 53, floor: ['#241a38', '#2a1f42', '#30244a'], dark: '#140e22', light: '#3f305e', wall: ['#1d1530', '#241a3a', '#171027'], top: '#6a3fa0', accent: 'specks', glow: '#d68cff', glowI: 1, flame: 0xd68cff},
};
// P.detail (default 1) scales speckles, cracks, tufts and patches: lower = calmer floor that lets characters stand out
function surface(P) {
  const R = seeded(P.seed), tiles = [], glowPts = [], blobs = [], det = P.detail ?? 1;
  for (let k = 0; k < REP * REP; k++) {
    const t = {c: P.floor[R() * 3 | 0], s: [], crack: null};
    for (let s = 0; s < Math.round(7 * det); s++) t.s.push([R(), R(), R() < .5]);
    if (R() < .25 * det) { const pts = []; let x = .2 + R() * .5, y = .2 + R() * .5; for (let s = 0; s < 8; s++) { pts.push([x, y]); x += R() < .6 ? .06 : 0; y += R() < .5 ? .06 : (R() < .5 ? -.06 : 0); } t.crack = pts; }
    tiles.push(t);
  }
  if (P.accent === 'lava') for (let i = 0; i < 12; i++) { let x = R() * REP, y = R() * REP; const n = 14 + R() * 22 | 0; for (let s = 0; s < n; s++) { glowPts.push([x, y]); x += R() < .7 ? .05 : 0; y += R() < .4 ? .05 : (R() < .5 ? -.05 : 0); } }
  if (P.accent === 'specks') for (let i = 0; i < 110; i++) glowPts.push([R() * REP, R() * REP]);
  if (P.accent === 'snow') for (let i = 0; i < 30 * det; i++) blobs.push({x: R() * REP, y: R() * REP, r: .3 + R() * .5, cols: ['#bfd0e6', '#dfe9f5'], keep: .08});
  if (P.accent === 'grass') {
    for (let i = 0; i < 90 * det; i++) blobs.push({x: (R() * REP | 0) + (R() < .5 ? .96 : .02), y: R() * REP, tuft: true});
    for (let i = 0; i < 22 * det; i++) blobs.push({x: R() * REP, y: R() * REP, r: .25 + R() * .35, cols: ['#3f5a3a', '#46602e'], keep: .5});
  }
  return {tiles, glowPts, blobs};
}
const wrapPx = (g, c, x, y, w, h) => { g.fillStyle = c; g.fillRect(((Math.floor(x) % w) + w) % w, ((Math.floor(y) % h) + h) % h, 1, 1); };
function paintFloor(P, S) {
  return (g, w, h) => {
    const tw = w / REP, th = h / REP;
    S.tiles.forEach((t, k) => {
      const i = k % REP, j = k / REP | 0, x0 = Math.round(i * tw), y0 = Math.round(j * th), W = Math.round((i + 1) * tw) - x0, H = Math.round((j + 1) * th) - y0;
      g.fillStyle = t.c; g.fillRect(x0, y0, W, H);
      g.fillStyle = P.light; g.fillRect(x0, y0, W - 1, 1); g.fillRect(x0, y0, 1, H - 1);
      g.fillStyle = P.dark; g.fillRect(x0, y0 + H - 1, W, 1); g.fillRect(x0 + W - 1, y0, 1, H);
      for (const [a, b, d] of t.s) wrapPx(g, d ? P.dark : P.light, x0 + 2 + a * (W - 4), y0 + 2 + b * (H - 4), w, h);
      if (t.crack) for (const [a, b] of t.crack) wrapPx(g, P.dark, x0 + a * W, y0 + b * H, w, h);
    });
    if (P.accent === 'lava') for (const [x, y] of S.glowPts) for (let d = -1; d <= 1; d++) wrapPx(g, '#1a0a0c', x * tw, y * th + d, w, h);
    for (const b of S.blobs) {
      if (b.tuft) { const cols = ['#46602e', '#6b8f45', '#9dbb5a']; for (let j = 0; j < 4; j++) { wrapPx(g, cols[j % 3], b.x * tw + (j % 2 ? 1 : -1) * (j >> 1), b.y * th - j, w, h); if (!j) wrapPx(g, cols[0], b.x * tw, b.y * th + 1, w, h); } continue; }
      const cx = b.x * tw, cy = b.y * th, rx = b.r * tw, ry = b.r * th;
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue;
        const v = hash(x, y); if (v < b.keep) continue; wrapPx(g, b.cols[v > .75 ? 1 : 0], x, y, w, h);
      }
    }
  };
}
const paintGlow = (P, S) => (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); for (const [x, y] of S.glowPts) wrapPx(g, P.glow, x * w / REP, y * h / REP, w, h); };
function paintBricks(P, wallH) {
  return (g, w, h) => {
    const R = seeded(P.seed + 1), rows = Math.max(3, Math.round(wallH / .3)), bh = h / rows, per = 4, bw = w / per;
    for (let r = 0; r < rows; r++) {
      const y0 = Math.round(r * bh), y1 = Math.round((r + 1) * bh), off = r % 2 ? bw / 2 : 0;
      for (let c = -1; c <= per; c++) {
        const x0 = Math.round(c * bw + off), x1 = Math.round((c + 1) * bw + off);
        g.fillStyle = P.wall[R() * 3 | 0]; g.fillRect(x0, y0, x1 - x0, y1 - y0);
        g.fillStyle = P.dark; g.fillRect(x0, y1 - 1, x1 - x0, 1); g.fillRect(x0, y0, 1, y1 - y0);
        g.globalAlpha = .35; g.fillStyle = P.light; g.fillRect(x0 + 1, y0, x1 - x0 - 1, 1); g.globalAlpha = 1;
        if (R() < .35) { g.fillStyle = P.dark; g.fillRect(x0 + 2 + (R() * Math.max(1, x1 - x0 - 4) | 0), y0 + 1 + (R() * Math.max(1, y1 - y0 - 3) | 0), 1, 1); }
      }
    }
    g.fillStyle = P.dark; g.fillRect(0, h - 1, w, 1);
  };
}
const paintCap = P => (g, w, h) => {
  g.fillStyle = P.top; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = hash(x + 911, y + P.seed); if (v > .975) wrapPx(g, P.light, x, y, w, h); else if (v < .03) wrapPx(g, P.wall[1], x, y, w, h); }
  g.fillStyle = P.light; g.fillRect(0, 0, w, 1); g.fillStyle = P.dark; g.fillRect(0, h - 1, w, 1);
};
export function floorAndWalls(scene, map, P, wallH = 2.4) {
  const size = map.W * CS, S = surface(P);
  const map0 = paintedTex([REP, REP], paintFloor(P, S), FLOOR_SQ); map0.repeat.set(size / REP, size / REP);
  const fm = new THREE.MeshStandardMaterial({map: map0, roughness: .95});
  if (P.glow) { const gm = paintedTex([REP, REP], paintGlow(P, S), FLOOR_SQ); gm.repeat.copy(map0.repeat); Object.assign(fm, {emissiveMap: gm, emissive: new THREE.Color(0xffffff), emissiveIntensity: P.glowI}); }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), fm); floor.rotation.x = -Math.PI / 2; floor.position.set(size / 2, 0, size / 2); floor.receiveShadow = true; scene.add(floor);
  const walls = [];
  for (let j = 0; j < map.H; j++) for (let i = 0; i < map.W; i++) {
    if (map.floor(i, j)) continue; let near = false;
    for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1; di++) if (map.floor(i + di, j + dj)) { near = true; break; }
    if (near) walls.push([i, j]);
  }
  const side = new THREE.MeshStandardMaterial({map: paintedTex([CS, wallH], paintBricks(P, wallH), WALL_SQ), roughness: .95});
  const top = new THREE.MeshStandardMaterial({map: paintedTex([CS, CS], paintCap(P), FLOOR_SQ), roughness: .95});
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(CS, wallH, CS), [side, side, top, side, side, side], walls.length);
  const m = new THREE.Matrix4(), R = seeded(P.seed + 5), crown = [];
  walls.forEach(([i, j], k) => { m.makeTranslation((i + .5) * CS, wallH / 2, (j + .5) * CS); inst.setMatrixAt(k, m); if (R() < .45) crown.push([i, j, R()]); });
  inst.castShadow = inst.receiveShadow = true; scene.add(inst);
  // battlements on some wall tops break up the skyline
  const merlon = new THREE.MeshStandardMaterial({color: P.top, roughness: .95, flatShading: true}), mi = new THREE.InstancedMesh(new THREE.BoxGeometry(CS * .45, .42, CS * .55), merlon, crown.length);
  crown.forEach(([i, j, r], k) => { m.makeTranslation((i + .25 + r * .5) * CS, wallH + .21, (j + .5) * CS); mi.setMatrixAt(k, m); });
  mi.castShadow = mi.receiveShadow = true; scene.add(mi);
  addTorches(scene, map, P, wallH);
}
// torches on wall faces the camera can see; the four nearest the hero get real lights
function addTorches(scene, map, P, wallH) {
  const R = seeded(P.seed + 9), spots = [], metal = std(0x3b3346, {r: .6, f: true}), flameM = glow(P.flame, 4);
  for (let j = 0; j < map.H; j++) for (let i = 0; i < map.W; i++) if (!map.floor(i, j) && map.floor(i, j + 1) && map.floor(i - 1, j + 1) && map.floor(i + 1, j + 1)) spots.push([i, j, R()]);
  spots.sort((a, b) => a[2] - b[2]);
  const torches = [];
  for (const [i, j] of spots) {
    const x = (i + .5) * CS, z = (j + 1) * CS, y = wallH * .6;
    if (torches.some(t => Math.hypot(t.x - x, t.z - z) < 7)) continue;
    add(scene, new THREE.BoxGeometry(.14, .28, .18), metal, x, y - .1, z + .06);
    const f = add(scene, new THREE.OctahedronGeometry(.13), flameM, x, y + .14, z + .12, {cast: false});
    const s = glowSprite(P.flame, 1.6, .9); s.position.set(x, y + .18, z + .16); scene.add(s);
    torches.push({x, z, y, f, s, seed: R() * 10});
    if (torches.length >= 60) break;
  }
  const lights = [0, 1, 2, 3].map(() => { const L = new THREE.PointLight(P.flame, 0, 9, 2); scene.add(L); return L; });
  G.torches = {list: torches, lights, t: 0};
}
export function updateTorches(p, dt, t) {
  const T = G.torches; if (!T) return;
  if ((T.t -= dt) <= 0) { T.t = .3; T.near = T.list.slice().sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)).slice(0, T.lights.length); }
  T.lights.forEach((L, k) => { const tc = T.near && T.near[k]; L.intensity = tc ? 16 + Math.sin(t * 13 + tc.seed) * 2 + Math.random() * 2 : 0; if (tc) L.position.set(tc.x, tc.y + .3, tc.z + .7); });
  for (const tc of T.list) { tc.f.scale.set(1, 1.2 + Math.sin(t * 17 + tc.seed) * .25, 1); tc.f.rotation.y = t * 3 + tc.seed; }
}
// camera-facing pixel grass cards, one texel per screen pixel
const GRASS = [['...a...', '.a.a..b', 'ab.ab.b', 'ab.abbc', 'bbcabbc', 'bcbcbcc'], ['a....b.', 'a..a.b.', 'ab.abbc', '.bcabc.', 'bbcbcc.']];
function grassCards(scene, map, n) {
  const cols = {a: '#9dbb5a', b: '#6b8f45', c: '#46602e'};
  GRASS.forEach((rows, v) => {
    const gw = rows[0].length, gh = rows.length, wu = gw * .05, hu = gh * .05;
    const tex = paintedTex([wu, hu], (g, w, h) => { g.clearRect(0, 0, w, h); rows.forEach((r, y) => [...r].forEach((ch, x) => { if (cols[ch]) { g.fillStyle = cols[ch]; g.fillRect(Math.floor(x * w / gw), Math.floor(y * h / gh), Math.ceil(w / gw), Math.ceil(h / gh)); } })); });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const geo = new THREE.PlaneGeometry(wu, hu); geo.translate(0, hu / 2, 0);
    const mat = new THREE.MeshStandardMaterial({map: tex, alphaTest: .5, side: THREE.DoubleSide, roughness: 1});
    const inst = new THREE.InstancedMesh(geo, mat, n), m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-PITCH, 0, 0)), s = V(1, 1, 1);
    for (let k = 0; k < n; k++) { const r = pick(map.rooms), p = map.randomIn(r, .6); p.x += rand(-.5, .5); m.compose(p, q, s); inst.setMatrixAt(k, m); }
    inst.receiveShadow = true; scene.add(inst);
  });
}
// floor cells next to a wall: good spots for decoration that never blocks a corridor
function edgeSpots(map, n) {
  const out = [];
  for (const r of map.rooms) for (let t = 0; t < 30 && out.length < n * 3; t++) {
    const i = randi(r.x, r.x + r.w - 1), j = randi(r.y, r.y + r.h - 1);
    if (!map.floor(i - 1, j) || !map.floor(i + 1, j) || !map.floor(i, j - 1) || !map.floor(i, j + 1)) out.push(map.center(i, j));
  }
  return out.sort(() => Math.random() - .5).slice(0, n);
}
function ambientAround(fn) { return (dt, t) => { const h = G.hero; if (h) { fn(h.g.position, dt, t); updateTorches(h.g.position, dt, t); } }; }

export const BIOMES = [
  {
    name: 'Ember Wastes', roster: [['scaleguard', 3], ['cinderimp', 2], ['magmahorn', 1.2], ['emberling', 1.5]], bossMob: 'scaleguard', bossSpecial: 'molten', boss: 'Scaleborn Tyrant', mini: 'Ashjaw the Burner', accent: '#ff7a2f', deathCols: [C.fire, C.ember, C.gold],
    build(scene, map) {
      envBase(scene, {bg: 0x1a0805, hemi: [0xffc0a0, 0x2a0c06, .75], sun: [0xffb070, 1.5, [-8, 16, -5]], exp: 1, bloom: [.55, .45, 1.25]});
      floorAndWalls(scene, map, PAL.ember, 2.6);
      const bas = std(0x45262f, {r: .9, f: true}), pool = glow(0xc4532e, 1.3), core = glow(0xffb04a, 1.4), crust = std(0x2a1720, {r: 1, f: true});
      for (const p of edgeSpots(map, 40)) {
        if (Math.random() < .5) { for (let k = 0; k < 3; k++) { const h = rand(1, 3.5); add(scene, new THREE.CylinderGeometry(.3, .32, h, 6), bas, p.x + rand(-.5, .5), h / 2, p.z + rand(-.5, .5)); } }
        else { const r = rand(.6, 1.1); add(scene, new THREE.CircleGeometry(r + .18, 10), crust, p.x, .02, p.z, {rx: -Math.PI / 2}); add(scene, new THREE.CircleGeometry(r, 10), pool, p.x, .03, p.z, {rx: -Math.PI / 2}); add(scene, new THREE.CircleGeometry(r * .45, 8), core, p.x + rand(-.2, .2), .04, p.z + rand(-.2, .2), {rx: -Math.PI / 2}); }
      }
    },
    ambient: ambientAround((p, dt, t) => {
      for (let i = 0; i < 2; i++) parts.emit(p.x + rand(-14, 14), rand(.1, .6), p.z + rand(-12, 12), rand(-.3, .3), rand(.5, 1.5), rand(-.3, .3), Math.random() < .7 ? C.ember : C.fire, rand(2, 5), rand(2, 4), rand(.06, .14), -.15, .2);
    }),
  },
  {
    name: 'Frost Hollow', roster: [['rimestalker', 2.5], ['frostwraith', 2], ['glaciergolem', 1.2], ['rimeshaman', 1]], bossMob: 'rimestalker', bossSpecial: 'howl', boss: 'The Pale Alpha', mini: 'Rimefang', accent: '#7fd0ff', deathCols: [C.ice, C.white],
    build(scene, map) {
      envBase(scene, {bg: 0x0b1628, hemi: [0xb0c4f0, 0x14203a, .6], sun: [0xd0e0ff, 1.2, [7, 16, -9]], exp: 1, bloom: [.55, .45, 1.5]});
      floorAndWalls(scene, map, PAL.frost, 2.4);
      const drift = std(0xdfe9f5, {r: .9, f: true});
      for (const p of edgeSpots(map, 30)) add(scene, new THREE.SphereGeometry(.7, 8, 4), drift, p.x, 0, p.z, {s: [rand(.9, 1.6), .3, rand(.7, 1.1)], ry: rand(0, TAU)});
      const leaf = std(0x1d3a2c, {r: .9, f: true}), cap = std(0xb8c6da, {r: .8, f: true}), trunk = std(0x3a2a1e, {r: .9}), ice = std(0xbfe8ff, {r: .1, m: .1, e: 0x3a9cff, ei: .6, f: true});
      for (const p of edgeSpots(map, 36)) {
        if (Math.random() < .6) { const g = new THREE.Group(); g.position.copy(p); g.scale.setScalar(rand(.6, 1)); scene.add(g); add(g, new THREE.CylinderGeometry(.12, .18, 1, 6), trunk, 0, .5, 0);
          for (let i = 0; i < 3; i++) { const y = .9 + i * .8; add(g, new THREE.ConeGeometry(1.2 - i * .32, 1.5 - i * .25, 7), leaf, 0, y + .7, 0); add(g, new THREE.ConeGeometry((1.2 - i * .32) * .75, .7, 7), cap, 0, y + 1.1, 0); } }
        else for (let k = 0; k < 4; k++) add(scene, new THREE.OctahedronGeometry(.25), ice, p.x + rand(-.5, .5), .4, p.z + rand(-.5, .5), {s: [rand(.6, 1), rand(2, 3.5), rand(.6, 1)], rx: rand(-.4, .4), rz: rand(-.4, .4)});
      }
    },
    ambient: ambientAround((p, dt, t) => {
      for (let i = 0; i < 4; i++) parts.emit(p.x + rand(-16, 16), rand(7, 10), p.z + rand(-14, 12), rand(-.2, .2) + Math.sin(t * .4) * .3, -rand(.8, 1.4), rand(-.2, .2), C.snow, rand(.7, 1.1), 8, rand(.07, .13));
    }),
  },
  {
    name: 'Overgrown Ruins', roster: [['myconid', 3], ['sporepod', 1.2], ['thornback', 1.3], ['sporecaller', 1]], bossMob: 'myconid', bossSpecial: 'spores', boss: 'The Sporemother', mini: 'Capwarden Mossbrow', accent: '#9aff6a', deathCols: [C.green, C.leaf, C.white],
    build(scene, map) {
      envBase(scene, {bg: 0x2a3a24, hemi: [0xf0f4e0, 0x3f5a2a, 1], sun: [0xfff0c8, 2.2, [10, 16, 6]], exp: 1, bloom: [.45, .45, 1.5]});
      floorAndWalls(scene, map, PAL.ruins, 2.4); grassCards(scene, map, 180);
      const st = std(0x9a968a, {r: .9}), moss = std(0x4f7d2f, {r: 1, f: true}), l1 = std(0x3d7a2a, {r: .9, f: true}), ico = new THREE.IcosahedronGeometry(1, 0);
      for (const p of edgeSpots(map, 40)) {
        const r = Math.random();
        if (r < .35) { const h = rand(1.2, 3.5); add(scene, new THREE.CylinderGeometry(.45, .5, h, 10), st, p.x, h / 2, p.z); add(scene, new THREE.SphereGeometry(.55, 10, 6, 0, TAU, 0, Math.PI / 2), moss, p.x, h, p.z, {s: [1, .35, 1]}); }
        else if (r < .7) add(scene, ico, l1, p.x, .3, p.z, {s: [rand(.5, .9), rand(.4, .7), rand(.5, .9)], ry: rand(0, TAU)});
        else add(scene, new THREE.BoxGeometry(.95, .14, .9), st, p.x, .05, p.z, {ry: rand(0, TAU)});
      }
    },
    ambient: ambientAround((p) => {
      if (Math.random() < .8) parts.emit(p.x + rand(-14, 14), rand(.3, 2.6), p.z + rand(-12, 12), rand(-.3, .3), rand(-.1, .2), rand(-.3, .3), C.leaf, rand(2, 4), rand(3, 5), rand(.07, .12));
    }),
  },
  {
    name: 'The Rift', roster: [['watcher', 2], ['voidcrawler', 2], ['nullsentinel', 1.2], ['riftacolyte', 1]], bossMob: 'watcher', bossSpecial: 'beams', boss: 'The Unblinking', mini: 'Gazer Prime', accent: '#c070ff', deathCols: [C.void, C.pink, C.white],
    build(scene, map) {
      envBase(scene, {bg: 0x12061e, hemi: [0xc0a0ff, 0x100418, .9], sun: [0xe0c8ff, 1.7, [-8, 16, 6]], exp: 1, bloom: [.6, .5, 1.3]});
      floorAndWalls(scene, map, PAL.rift, 2.6);
      const cm = std(0xb070ff, {r: .15, m: .2, e: 0x9a40ff, ei: .7, f: true});
      for (const p of edgeSpots(map, 34)) for (let i = 0; i < 3; i++) add(scene, new THREE.OctahedronGeometry(.25), cm, p.x + rand(-.5, .5), .35, p.z + rand(-.5, .5), {s: [rand(.6, 1), rand(1.8, 3.4), rand(.6, 1)], rx: rand(-.5, .5), rz: rand(-.5, .5)});
    },
    ambient: ambientAround((p, dt, t) => {
      for (let i = 0; i < 2; i++) parts.emit(p.x + rand(-14, 14), .1, p.z + rand(-12, 12), 0, rand(.3, .9), 0, C.void, 2.5, rand(2, 3.5), rand(.06, .12), -.1);
    }),
  },
];

// Procedural floating eyeball for the Rift (it has no humanoid model)
export function watcherModel(scale = 1) {
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); inner.scale.setScalar(scale);
  const sclera = std(0xe8e2f2, {r: .25}), shell = std(0x241a33, {r: .5, m: .4, f: true});
  add(inner, new THREE.SphereGeometry(.45, 24, 16), sclera);
  add(inner, new THREE.SphereGeometry(.2, 20, 14), glow(0xb050ff, 3), 0, 0, .38, {s: [1, 1, .35]});
  add(inner, new THREE.SphereGeometry(.09, 12, 10), new THREE.MeshBasicMaterial({color: 0x000000}), 0, 0, .445, {s: [1, 1, .3]});
  add(inner, new THREE.SphereGeometry(.5, 16, 12, 0, TAU, 0, Math.PI * .36), shell, 0, 0, 0, {rx: -.35});
  add(inner, new THREE.SphereGeometry(.5, 16, 12, 0, TAU, Math.PI * .7, Math.PI * .3), shell, 0, 0, 0, {rx: .2});
  const ring = add(inner, new THREE.TorusGeometry(.72, .025, 6, 48), glow(0xc070ff, 4));
  const tents = []; for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + .4; tents.push(add(inner, new THREE.ConeGeometry(.07, .9, 6), shell, Math.cos(a) * .22, -.7, Math.sin(a) * .22, {rx: Math.PI})); }
  inner.position.y = 1.2 * scale;
  const mats = [sclera, shell];
  return {g, mats, anim: (t, seed) => { ring.rotation.x = t * 1.5 + seed; ring.rotation.y = t; tents.forEach((m, i) => { m.rotation.z = Math.sin(t * 3 + i + seed) * .3; }); inner.position.y = (1.2 + Math.sin(t * 2 + seed) * .15) * scale; }};
}
