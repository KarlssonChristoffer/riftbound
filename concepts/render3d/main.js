// HD-2D: the Proving Grounds in a real 3D world, seen through the arena's oblique projection, with a free camera.
// HOST: boots the renderer (gfx.js), the world (world.js), the player (the arena's player.js, untouched) and the
// FEATURES (features/<name>.js: combat, prop physics, weather, camera feel, wind, wildlife, depth, audio), which plug
// in through the contract below. A missing feature file is skipped, so features can land one at a time.
//
// COORDINATES. Gameplay uses the ARENA's convention everywhere: x east, y south (ground, metres), h (or z) height.
// The renderer uses X east, Y up, Z south; the host converts (host.sprite / point / line take arena coordinates).
// THE PLAYER runs in the camera's frame ("view frame": x = screen right, y = toward the camera), where the projection
// is exactly the arena's, so its aiming, cursor reading, facing and WASD work as they are (WASD is camera-relative for
// free). Features never see that: host.player is a live world-frame view of it.
//
// FEATURE CONTRACT (features/<name>.js):
//   export async function create(host) -> F
//   F.name, F.on (bool), F.toggle?() (F.key: its hotkey, e.g. '5'), F.always (update during hitstop too)
//   F.update?(dt, evs)          simulation step. evs = this step's events (player steps / lands / splashes, hits, ...)
//   F.frame?(f)                 every rendered frame, camera set: push host.sprite / point / line, paint host.layer(...)
//                               f = {dt, t (s)}
//   F.lights?() -> [{x, y, h, color ('#rrggbb' | [r, g, b]), radius, intensity, flicker, id}]   arena coordinates
//   F.hd?(q, scale)             the display-resolution overlay (2D context; scale = display px per view px)
//   F.camera?(dt) -> {x, y}     camera feel: an offset in view px (spring, lean, kick)
//   F.onKey?(k, e) -> bool      consume a key (k = e.key lower-case)
//   F.onArrowHit?(a, prop) -> 'stop' | 'pierce'   F.onArrowStuck?(a)   F.ability?(slot) -> bool   F.interact?(prop) -> bool
//   F.aimTarget?() -> {x, y, h, target} | null    F.hud?() -> string   F.settings?() -> [{label, get, set, options?}]
//   F.biomeChanged?()           after a world rebuild (N); F.dispose?()
//   F.arrow?(a)                 every arrow as it is spawned (scale its damage, tag it, spawn extras with a.extra)
//   F.prompt?(prop) -> text | {text, color}   the "E ..." prompt over a prop you can interact with
//   F.menu?() -> [{label, run}] rows at the top of the pause menu
// THE GAME (game/game.js) is the first feature: the run, enemies, items, HUD, title. It drives host.dev (the sandbox's
// dev keys + debug HUD), host.lock (no player input: menus, death, travel), host.timeScale (slow motion / frozen),
// host.setBiome / setTime / teleport / setYaw.
// HOST (see `host` below): player, arrows, spawnArrow, events, props, itemOf, elev, inStream, blocked, layout,
//   hitstop, shake, knock, play, aim, mouse, keys, toView(x, y, h) -> view px, sprite, point, line, layer(name),
//   world, biome, time, mood, wind (the wind feature, if any), feature(name), PPM / PPMY / PPMH, G, THREE.
import * as THREE from 'three';
import {createGfx, DEG} from './gfx.js';
import {buildWorld, texOf, WORLD, PLAY, TRAIL, elev, inStream, PLATEAUS, PROP_TOP} from './world.js';
import {loadAtlas} from './atlas.js';
import {BIOMES} from '../sprites/arena/biomes.js';
import {createLighting} from '../sprites/arena/lighting.js';
import {ClothRig, depthOf, CLOTH_PARAMS} from '../sprites/cloth.js';
import {createArmor} from '../sprites/arena/armor.js';   // the shiny-armour experiment: its albedo repaint (the shine is on the GPU)
import {createPlayer, atlasOf, BUSY} from '../sprites/player.js';
import {createGame} from './game/game.js';
import {createPerf} from './core/perf.js';   // the frame profiler: per-system ms against the budget (F3, ?perf=1)
import {createEnv, SEASONS, WEATHER} from './sim/env.js';   // the world clock: time of day, seasons, weather

const $ = s => document.querySelector(s);
const Q = new URLSearchParams(location.search);
const VW = 480, VH = 270;
const t00 = performance.now();
const FEATURES = ['wind', 'windlines', 'weather', 'lights', 'garden', 'combat', 'atmos', 'flow', 'wildlife', 'depth', 'contact', 'audio'];   // update order (wind first: others read it; lights before combat: it sees arrow hits first; garden before combat: its colliders are known)

// ---------------------------------------------------------------- the Ranger: loadouts (packed atlases)
const LOADOUTS = [['ranger basic', '../sprites/out/outfits/ranger_basic/'], ['ranger + cloth sim', '../sprites/out/outfits/ranger_sim/'], ['bare body', '../sprites/out/skel/']];
// default: the runtime cloth (cloak + scarf tail answer the wind; ?set=basic = the baked cloak)
let loadI = {basic: 0, body: 2, sim: 1}[Q.get('set')] ?? 1;
$('#load').textContent = 'Loading the Ranger…';
const TIMING = {}, mark = (k, t0) => { TIMING[k] = +((performance.now() - t0) / 1000).toFixed(2); };
let tp = performance.now();
let set = await loadAtlas(LOADOUTS[loadI][1], {ClothRig});
mark('atlas', tp);
const atlas = atlasOf(set);
let {SP} = set, rig = set.rig, {FW, FH, PIV, ND, DIRS} = atlas;
const PPM = set.idx.fwd_px.E[0], PPMH = PPM * Math.cos(set.idx.pitch * DEG), PPMY = PPM * Math.sin(55 * DEG);
const ctxO = {PPM, PPMY, PPMH, toS: (x, y, h = 0) => [x * PPM, y * PPMY - h * PPMH], VW, VH};

const canvas = $('#screen');
const G = createGfx(canvas, {VW, VH, PPM, PPMY, PPMH});
// the HD overlay: display resolution, over the pixel canvas (damage numbers, bars, prompts)
const hdc = document.createElement('canvas'); hdc.id = 'hd'; hdc.style.cssText = 'position:absolute;pointer-events:none;image-rendering:auto';
$('#wrap').appendChild(hdc); const hq = hdc.getContext('2d');
let scale = 1;
function fit() {
  scale = Math.max(1, Math.floor(Math.min(innerWidth / VW, innerHeight / VH)));
  canvas.style.width = VW * scale + 'px'; canvas.style.height = VH * scale + 'px';
  G.setDisplay?.(scale);   // the canvas at display size: the pixel image is blown up on the GPU, HD effects draw over it
  const dpr = devicePixelRatio || 1; hdc.width = VW * scale * dpr; hdc.height = VH * scale * dpr; hdc.style.width = canvas.style.width; hdc.style.height = canvas.style.height;
  const r = canvas.getBoundingClientRect(); hdc.style.left = r.left + 'px'; hdc.style.top = r.top + 'px';
}
fit(); addEventListener('resize', fit);

// moods: the arena's own table (lighting.js), so both pages light the same scene the same way
const LT = createLighting({...ctxO, layout: null});
const MOODS = LT.MOODS, TIMES = LT.TIMES, CHAR = LT.CHAR;
const GRADE = {ruins: [1.039, 1.029, .818], ember: [1.166, .958, .82], frost: [.896, 1.013, 1.161], rift: [1.056, .792, 1.649]};
const BG = {ruins: [.10, .13, .11], ember: [.11, .06, .05], frost: [.10, .12, .17], rift: [.06, .04, .10]};
const lum = c => c[0] * .3 + c[1] * .55 + c[2] * .15;
const rgbOf = c => { if (Array.isArray(c)) return c; let s = String(c || '#fff').replace('#', ''); if (s.length === 3) s = s.replace(/./g, m => m + m); const n = parseInt(s, 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

let biomeI = Math.max(0, BIOMES.findIndex(b => b.id === Q.get('biome')));
// THE WORLD CLOCK (sim/env.js): time of day, seasons, weather, running in the background. It owns "what time is it":
// host.time is its day / dusk / night bucket (dawn counts as dusk), host.mood its blended mood, host.setTime jumps it
const env = createEnv({moods: MOODS, biome: () => BIOMES[biomeI].id, Q});
let world = null, propMode = Q.get('props') === 'yaw' ? 'yaw' : 'live';
let trees3d = Q.get('trees3d') !== '0';   // procedural 3D trees (trees3d.js) or the painted cards (Shift+R rebuilds)
const features = [];
// the wind sways painted foliage cards (per-row bend) and gives braziers / torches a live flame
function cardHook(it, sp) { const w = features.find(f => f.name === 'wind'); return w?.on && w.card ? w.card(it, sp) : null; }
// ... and leans the 3D trees (world.js leanTree: the lean at the top, whole pixels per vertex in the shader)
function meshHook(it) { const w = features.find(f => f.name === 'wind'); return w?.on && w.mesh ? w.mesh(it) : null; }
async function setBiome(i) {
  biomeI = ((i % BIOMES.length) + BIOMES.length) % BIOMES.length;
  $('#load').classList.remove('hidden'); $('#load').textContent = 'Building ' + BIOMES[biomeI].name + '…';
  const keep = world?.props;   // props keep their state (broken, opened, moved) across a biome switch
  world?.dispose();
  world = await buildWorld(G, {biome: BIOMES[biomeI], ctxO, PPM, PPMH, props: keep, trees3d});
  world.hooks.card = cardHook; world.hooks.mesh = meshHook;   // a rebuilt world has fresh hooks
  world.setMode(propMode);
  for (const f of features) f.biomeChanged?.();
  $('#load').classList.add('hidden');
}
tp = performance.now();
await setBiome(biomeI);
mark('world', tp);
// ?lineup=trees: the procedural trees side by side for review, 3 rows of 5 (x 12 .. 26.4), each framed by standing 3.4 m
// north of its middle (&at=19.2,6.6 / 13.1 / 19.6): oaks seeds 0-4 | oaks 5-7 + the painted oaks | dead 0-2 + the
// painted dead tree (p.painted keeps a tree's card). They join world.props, so they survive N / Shift+R
if (Q.get('lineup') === 'trees') {
  const row = (y, list) => list.forEach(([variant, seed, painted], i) => {
    const p = {kind: 'tree', x: 12 + i * 3.6, y, z: 0, variant, seed, painted, lineup: true, r: .3};
    world.props.push(p); world.addItem(p);
  });
  row(10, [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]);
  row(16.5, [[0, 5], [0, 6], [0, 7], [0, 0, true], [1, 0, true]]);
  row(23, [[2, 0], [2, 1], [2, 2], [2, 0, true]]);
}

// ---------------------------------------------------------------- the camera's frame
let yaw = (+Q.get('yaw') || 0) * DEG, zoom = Q.get('zoom') === '2' ? 2 : 1, snapMode = +(Q.get('snap') ?? 0) || 0;
const SNAP = [0, 22.5 * DEG, 90 * DEG], SNAP_NAME = ['free', '22.5° steps', '90° steps'];
const toView = (X, Z, a = yaw) => [X * Math.cos(a) - Z * Math.sin(a), X * Math.sin(a) + Z * Math.cos(a)];
const toWorld = (vx, vy, a = yaw) => [vx * Math.cos(a) + vy * Math.sin(a), -vx * Math.sin(a) + vy * Math.cos(a)];

// ---------------------------------------------------------------- the player
const keys = new Set(), mouse = {x: VW / 2, y: VH / 2, down: false}, cam = {x: 0, y: 0, fx: 0, fy: 0}, events = [];
const R_BODY = .25;
// collision in the world (round, so it doesn't change with the camera; the arena squashes it to match its 2D look)
function blockedW(x, y, z, air) {
  const arena = x > PLAY.x0 - 3 && x < PLAY.x1 + 3 && y > PLAY.y0 - 3 && y < PLAY.y1 + 3;
  const trail = x > TRAIL.x0 && x < TRAIL.x1 && y > TRAIL.y0 && y < TRAIL.y1;
  if (!arena && !trail) return true;
  if (!air && inStream(x, y)) return true;
  if (elev(x, y) > z + .3) return true;
  return world.props.some(p => !p.broken && !p.gone && Math.abs((p.z || 0) - z) < 1 && (p.rect ? x > p.rect[0] - R_BODY && x < p.rect[2] + R_BODY && y > p.rect[1] - R_BODY && y < p.rect[3] + R_BODY
    : p.r && Math.hypot(p.x - x, p.y - y) < p.r + R_BODY));
}
// the plateau as the player sees it. Exact when the camera faces north; turned, the climb spot is handled by the host
const plateausV = PLATEAUS.map(q => ({...q}));
function syncPlateaus() { PLATEAUS.forEach((q, i) => Object.assign(plateausV[i], Math.abs(yaw) < 1e-6 ? {...q} : {h: q.h, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, climbs: []})); }
const arrows = [], pops = [], dust = [];
let hits = 0;
const feat = name => features.find(f => f.name === name) || null;
const PL = createPlayer({
  ctx: ctxO, atlas, keys, mouse, cam, events, plateaus: plateausV,
  blocked: (x, y, z = PL.P.z, air = false) => { const [X, Z] = toWorld(x, y); return blockedW(X, Z, z, air); },
  elev: (x, y) => { const [X, Z] = toWorld(x, y); return elev(X, Z); },
  inStream: (x, y) => { const [X, Z] = toWorld(x, y); return inStream(X, Z); },
  pixelBow: () => !opt.hdBow,   // J: the bowstring + nocked / flying arrows at art pixels (default) or the HD overlay
  onShoot: a => { const [x, y] = toWorld(a.x, a.y), [vx, vy] = toWorld(a.vx, a.vy); spawnArrow({...a, x, y, vx, vy}); },
  aimTarget: () => { const t = hoverTarget(); if (!t) return null; const v = toView(t.x, t.y); return {x: v[0], y: v[1], h: t.h, target: t.target}; },
  nearInteract: () => nearProp(),
  onInteract: p => features.some(f => f.interact?.(p)),
  dust: (fx, fy, side, big) => {   // a foot contact at view-frame world px -> world metres
    if (BIOMES[biomeI].dust === false) return;
    const [sx, sy] = ctxO.toS(PL.P.x, PL.P.y, PL.P.z), dvx = (fx - sx) / PPM, dvy = (fy - sy) / PPMY, [x, y] = toWorld(PL.P.x + dvx, PL.P.y + dvy);
    for (let i = 0; i < 3 + big * 2; i++) { const [vx, vy] = toWorld((Math.random() - .5) * .45, 0); dust.push({x, y, h: PL.P.z + .02, vx, vy, vh: Math.random() * .2, t: 0, life: .3 + Math.random() * .2}); }
  },
  shake: (a, sec) => shake(a, sec),
});
const P = PL.P;
{ const at = (Q.get('at') || '').split(',').map(Number), sp = world.layout.spawn, [vx, vy] = toView(at.length === 2 ? at[0] : sp.x, at.length === 2 ? at[1] : sp.y); P.x = vx; P.y = vy; P.z = elev(...toWorld(vx, vy)); }
// the player as features see it: world frame, live
// (x / y are read dozens of times a frame: computed once per move or turn, not per read)
let pwX = 0, pwY = 0, pwA = NaN, pwB = NaN, pwYaw = NaN;
function pwSync() { if (P.x !== pwA || P.y !== pwB || yaw !== pwYaw) { pwA = P.x; pwB = P.y; pwYaw = yaw; const c = Math.cos(yaw), s = Math.sin(yaw); pwX = P.x * c + P.y * s; pwY = -P.x * s + P.y * c; } }
const player = {
  get x() { pwSync(); return pwX; }, get y() { pwSync(); return pwY; }, get z() { return P.z; },
  get vx() { return toWorld(P.vx, P.vy)[0]; }, get vy() { return toWorld(P.vx, P.vy)[1]; },
  get faceAngle() { return P.face * 2 * Math.PI / ND + yaw; },                          // world: 0 = south, +pi/2 = east
  get face() { return (((Math.round(P.face + yaw / (2 * Math.PI / ND))) % ND) + ND) % ND; },   // world facing index (arena's dirOf)
  get viewFace() { return P.face; }, get state() { return P.state; }, get t() { return P.t; }, get frame() { return P.frame; },
  get gait() { return P.gait; }, get sink() { return P.sink || 0; }, get aiming() { return P.state === 'draw'; }, get blink() { return P.blink || 0; },
  get raw() { return P; },
};

// the camera turned by d: everything the player keeps in view-frame coordinates turns with it
let faceAcc = 0;
function turnFrame(d) {
  const c = Math.cos(d), s = Math.sin(d), rot = (x, y) => [x * c - y * s, x * s + y * c];
  [P.x, P.y] = rot(P.x, P.y); [P.vx, P.vy] = rot(P.vx, P.vy);
  if (P.rollDir) P.rollDir = rot(...P.rollDir);
  if (P.back) P.back = rot(...P.back);
  if (P.leap) { [P.leap.x0, P.leap.y0] = rot(P.leap.x0, P.leap.y0); [P.leap.dx, P.leap.dy] = rot(P.leap.dx, P.leap.dy); }
  faceAcc -= d / (2 * Math.PI / ND);
  const n = Math.round(faceAcc);
  if (n) { P.face = (((P.face + n) % ND) + ND) % ND; P.want = (((P.want + n) % ND) + ND) % ND; faceAcc -= n; }
}
function setYaw(a) { if (a !== yaw) { turnFrame(a - yaw); yaw = a; } if (yaw > Math.PI) yaw -= 2 * Math.PI; else if (yaw <= -Math.PI) yaw += 2 * Math.PI; }

// the Ranger's card: sprite (+ runtime cloak) + pixel bow composited every frame, normals likewise
const charCv = document.createElement('canvas'), nrmCv = document.createElement('canvas');
charCv.width = nrmCv.width = 192; charCv.height = nrmCv.height = 160;   // margins: the cloth sim swings past the frame
const cq = charCv.getContext('2d', {willReadFrequently: true}), nq = nrmCv.getContext('2d', {willReadFrequently: true});
cq.imageSmoothingEnabled = nq.imageSmoothingEnabled = false;
const CX = 48, CY = 40;   // where the 96 x 80 frame sits in the composite
const hero = G.card({tex: texOf(charCv), nrm: texOf(nrmCv), w: 192, h: 160, px: PIV[0] + CX, py: PIV[1] + CY, type: 4, obj: 8, bias: .00125, xray: true});

// SHINY ARMOUR (the arena's experiment; its X key turns the camera here, so it's I / the menu): armor.js repaints the
// metal pixels dark steel / gold, and a METAL MASK aligned with the composite (255 steel, 128 gold, cleared under the
// cloth cloak) tells the lighting pass where to add the glints and reflections (gfx.js COMP_FS)
const armor = createArmor(ctxO);
const metalCv = document.createElement('canvas'); metalCv.width = 192; metalCv.height = 160;
const mq = metalCv.getContext('2d', {willReadFrequently: true}); mq.imageSmoothingEnabled = false;
hero.g.uniforms.uMetal.value = texOf(metalCv);
const maskImgs = {}, maskDir = () => LOADOUTS[loadI][1].replace('out/outfits/', 'out/experiments/armor/');
function maskOf(pose) {   // the pose's mask sheet (loaded once; null while loading, false when this loadout has none)
  const key = maskDir() + pose; if (key in maskImgs) return maskImgs[key];
  maskImgs[key] = null; const i = new Image(); i.onload = () => { maskImgs[key] = i; }; i.onerror = () => { maskImgs[key] = false; }; i.src = key + '.png';
  return null;
}
function toggleArmour() {
  armor.toggle(); armor.setAtlas(LOADOUTS[loadI][1]);
  if (armor.on) { armor.preload(Object.keys(SP)); Object.keys(SP).forEach(maskOf); }
}
function drawMetal(frame, sinkPx) {   // the metal mask of this frame into the composite's layout, minus what the cloak covers
  mq.clearRect(0, 0, 192, 160);
  const m = armor.on && !sinkPx ? maskOf(frame) : null;
  hero.g.uniforms.uHasMetal.value = m ? 1 : 0; if (!m) return;
  mq.drawImage(m, P.face * FW, 0, FW, FH, CX, CY, FW, FH);
  if (rig.active) {
    const id = mq.getImageData(CX, CY, FW, FH), d = id.data;
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const k = (y * FW + x) * 4; if (d[k] && rig.covers(x, y)) d[k] = d[k + 1] = d[k + 2] = 0; }
    mq.putImageData(id, CX, CY);
  }
  G.tex(metalCv, {dynamic: true});
}

async function switchLoadout(i) {
  loadI = ((i % LOADOUTS.length) + LOADOUTS.length) % LOADOUTS.length;
  $('#load').classList.remove('hidden'); $('#load').textContent = 'Loading ' + LOADOUTS[loadI][0] + '…';
  const s = await loadAtlas(LOADOUTS[loadI][1], {ClothRig});
  const a = atlasOf(s), old = ND;
  Object.assign(atlas, a); set = s; SP = s.SP; rig = s.rig; ({FW, FH, PIV, ND, DIRS} = a);
  if (ND !== old) { P.face = Math.round(P.face * ND / old) % ND; P.want = P.face; }
  rig.reset?.();
  hero.u.uPivot.value.set(PIV[0] + CX, PIV[1] + CY);
  armor.setAtlas(LOADOUTS[loadI][1]); if (armor.on) { armor.preload(Object.keys(SP)); Object.keys(SP).forEach(maskOf); }
  $('#load').classList.add('hidden');
}

// ---------------------------------------------------------------- feel: shake, hitstop, knock
let freeze = 0; const shakeS = {a: 0, t: 0};
function shake(a, sec) { if (a >= shakeS.a * (shakeS.t > 0 ? 1 : 0)) { shakeS.a = a; shakeS.t = sec; } }

// ---------------------------------------------------------------- targets, interaction
// ARPG targeting: the cursor over something hittable aims at it (front-most), at the height the cursor points at on it
// (head, chest or legs; kept inside its hit height). -> {x, y, h (aim height), target} world
let hoverKey = 0, hoverAt = -1, hoverMemo = null;   // hoverKey: bumped at the start of every step and draw
function hoverTarget() {
  if (hoverAt === hoverKey) return hoverMemo;
  hoverAt = hoverKey; return (hoverMemo = hoverFind());
}
function hoverFind() {
  for (const f of features) { const t = f.aimTarget?.(); if (t) return t; }
  let best = null, bn = -1e9, bh = 0;
  const mx = VW / 2 + (mouse.x - VW / 2) * zoom, my = VH / 2 + (mouse.y - VH / 2) * zoom;
  for (const it of world.items) {
    const p = it.p; if (p.broken || p.gone || !(p.target || p.hp > 0)) continue;
    const z0 = (p.z || 0) + (p.h || 0), hh = p.hitH ?? (p.kind === 'pot' ? .55 : p.kind === 'crate' ? .75 : 1.6), rr = Math.max(.3, p.hitR ?? p.r ?? .4);
    const [x0, y0] = G.toScreen(p.x, z0 + hh, p.y), [, y1] = G.toScreen(p.x, z0, p.y), w = rr * PPM * zoom;
    if (mx > x0 - w - 2 && mx < x0 + w + 2 && my > y0 - 3 && my < y1 + 3) {
      const n = toView(p.x, p.y)[1];
      if (n > bn) { bn = n; best = p; bh = z0 + hh * Math.max(.08, Math.min(.95, (y1 - my) / (y1 - y0 || 1))); }
    }
  }
  return best && {x: best.x, y: best.y, h: bh, target: best};
}
function nearProp() {
  let best = null, bd = 1.3; const px = player.x, py = player.y;
  for (const p of world.props) if (p.interact && !p.opened && Math.abs((p.z || 0) - P.z) < .5) { const d = Math.hypot(p.x - px, p.y - py); if (d < bd) { bd = d; best = p; } }
  return best;
}
// climbing at any camera angle: the climb spot is checked in the world; the climb itself runs at yaw 0 (the camera
// eases there while you climb, and back to where it was after)
let climbYaw = null;
function climbSpotW() {   // player.js climbSpot, in the world
  const x = player.x, y = player.y;
  for (const q of PLATEAUS) for (const c of q.climbs || []) {
    if (Math.abs(x - c.x) > c.w / 2 + .45) continue;
    if (P.z < .05 && y >= q.y1 - .05 && y < q.y1 + 1.3) return true;
    if (Math.abs(P.z - q.h) < .05 && y <= q.y1 && y > q.y1 - 1.3) return true;
  }
  return false;
}
let assist = null;   // {back: yaw to return to, phase: 'in' | 'climb' | 'back'}
function stepAssist(dt, ny) {
  const climbing = P.state === 'climb' || P.state === 'mantle';
  if (assist.phase === 'in') {
    ny = Math.abs(yaw) < .004 ? 0 : yaw * Math.exp(-dt * 12);
    if (ny === 0) { setYaw(0); syncPlateaus(); PL.onInteractKey(); PL.onInteractUp(); assist.phase = P.state === 'climb' ? 'climb' : 'back'; }
  } else if (assist.phase === 'climb') { ny = 0; if (!climbing) assist.phase = 'back'; }
  else {
    const d = Math.atan2(Math.sin(assist.back - yaw), Math.cos(assist.back - yaw));
    ny = Math.abs(d) < .002 ? assist.back : yaw + d * (1 - Math.exp(-dt * 8)); if (Math.abs(d) < .002) assist = null;
  }
  return ny;
}

// ---------------------------------------------------------------- arrows (arena convention), the arena's stepFx
function spawnArrow(o) { const a = {life: 1.6, vh: 0, kind: 'arrow', ...o}; for (const f of features) f.arrow?.(a); arrows.push(a); }
function stepArrows(dt) {
  for (const a of arrows) {
    if (a.stuck) { a.life -= dt; continue; }
    a.x += a.vx * dt; a.y += a.vy * dt; a.h += a.vh * dt; a.vh -= .9 * dt; a.life -= dt;
    (a.trail ??= []).push([a.x, a.y, a.h]); if (a.trail.length > 7) a.trail.shift();
    for (const p of world.props) {
      if (p.broken || p.gone || !(p.target || p.hp > 0) || (a.hitSet && a.hitSet.has(p))) continue;
      const rel = a.h - (p.z || 0) - (p.h || 0);
      if (Math.hypot(p.x - a.x, p.y - a.y) < (p.hitR ?? .45) && rel > -.2 && rel < (p.hitH ?? 1.6)) {
        hits++; pops.push({x: p.x, y: p.y, z: (p.z || 0) + (p.h || 0), t: 0}); events.push({type: 'hit', x: p.x, y: p.y, vx: a.vx, vy: a.vy, prop: p});
        let r; for (const f of features) { r = f.onArrowHit?.(a, p); if (r) break; }
        if (r === 'pierce') (a.hitSet ??= new Set()).add(p); else { a.life = -9; break; }
      }
    }
    if (a.life <= -9) continue;
    const ground = elev(a.x, a.y);
    // a 3D tree (trees3d.js) stops an arrow only in its trunk / big limbs, the tip in the bark; its round collider is skipped
    const tree = world.treeHit?.(a.x - a.vx * dt, a.y - a.vy * dt, a.h - a.vh * dt, a.x, a.y, a.h);
    if (tree) { a.x = tree.x; a.y = tree.y; a.h = tree.h; a.stuck = true; a.life = 3; features.forEach(f => f.onArrowStuck?.(a)); }
    else if (!a.stuck && world.props.some(p => !p.broken && !p.gone && !(a.hitSet && a.hitSet.has(p)) && !world.itemOf(p)?.pose && (p.rect ? a.x > p.rect[0] && a.x < p.rect[2] && a.y > p.rect[1] && a.y < p.rect[3] : p.r > .3 && Math.hypot(p.x - a.x, p.y - a.y) < p.r)
      && a.h > (p.z || 0) && a.h < (p.z || 0) + (PROP_TOP[p.kind] ?? 2.5))) { a.stuck = true; a.life = 3; features.forEach(f => f.onArrowStuck?.(a)); }
    else if (!a.stuck && a.h <= ground && ground === 0 && inStream(a.x, a.y)) { a.life = -9; events.push({type: 'splash', x: a.x, y: a.y, small: true}); features.forEach(f => f.onArrowStuck?.(a)); }
    else if (!a.stuck && (a.h <= ground || a.life <= 0)) { a.stuck = true; a.h = Math.max(ground, Math.min(a.h, ground + 2.4)); a.life = 3; features.forEach(f => f.onArrowStuck?.(a)); }
  }
  for (let i = arrows.length - 1; i >= 0; i--) if (arrows[i].life <= -9 || (arrows[i].stuck && arrows[i].life <= 0)) arrows.splice(i, 1);
  for (const p of world.props) {
    if (p.wob) p.wob = Math.max(0, p.wob - dt * 1.6);
    if (p.flash) p.flash = Math.max(0, p.flash - dt * 6);
    if (p.rail) { const r = p.rail; p.x += r.dir * r.speed * dt; if (p.x > r.x1 || p.x < r.x0) { r.dir *= -1; p.x = Math.max(r.x0, Math.min(r.x1, p.x)); } }
  }
  for (let i = pops.length - 1; i >= 0; i--) if ((pops[i].t += dt) > .8) pops.splice(i, 1);
  for (let i = dust.length - 1; i >= 0; i--) { const q = dust[i]; q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt; q.vx *= .9; q.vy *= .9; if (q.t > q.life) dust.splice(i, 1); }
}
const ARROW = {shaft: rgbOf('#9a6c44'), head: rgbOf('#cfcbbf'), fletch: rgbOf('#efe4c8')};
function drawArrows() {
  for (const a of arrows) {
    if (opt.hdBow && !a.stuck) continue;   // HD bow: arrows in flight are drawn on the HD overlay (player.js drawHD)
    const l = Math.hypot(a.vx, a.vy, a.vh) || 1, dx = a.vx / l, dy = a.vy / l, dh = a.vh / l, k = a.stuck ? .45 : .72;
    host.line(a.x - dx * k, a.y - dy * k, a.h - dh * k, a.x - dx * .1, a.y - dy * .1, a.h - dh * .1, ARROW.shaft);
    host.line(a.x - dx * .1, a.y - dy * .1, a.h - dh * .1, a.x, a.y, a.h, ARROW.head);
    if (!a.stuck) host.line(a.x - dx * k, a.y - dy * k, a.h - dh * k, a.x - dx * (k - .1), a.y - dy * (k - .1), a.h - dh * (k - .1), ARROW.fletch);
  }
}
const DUST = ['#b8a888', '#8a7a60', '#5e5444'].map(rgbOf), POP = rgbOf('#f2d27a');

// ---------------------------------------------------------------- the host features see
const host = {
  THREE, G, PPM, PPMY, PPMH, VW, VH, ctxO,
  get world() { return world; }, get biome() { return BIOMES[biomeI]; }, get time() { return env.bucket; }, get mood() { return env.mood(BIOMES[biomeI].id); }, env,
  get yaw() { return yaw; }, get zoom() { return zoom; }, get props() { return world.props; }, get layout() { return world.layout; },
  player, P, PL, arrows, spawnArrow, events, keys, mouse, BUSY,
  itemOf: p => world.itemOf(p), elev, inStream, blocked: (x, y, z = P.z, air = false) => blockedW(x, y, z, air),
  hitstop: sec => { freeze = Math.max(freeze, sec); }, shake, knock: (vx, vy) => { const [a, b] = toView(vx, vy); PL.knock(a, b); }, play: (frame, sec) => PL.hold(frame, sec),
  aim: () => { const c = PL.cursorAim(); const [x, y] = toWorld(c.x, c.y); return {x, y, h: c.h, target: c.target}; },
  toView: (x, y, h = 0) => { const s = G.toScreen(x, h, y); return [s[0], s[1]]; },         // world -> view px (rotated)
  sprite: o => G.sprite({...o, x: o.x, y: o.h ?? 0, z: o.y}),                            // {img, x, y, h, px, py, ...}
  point: (x, y, h, c, o) => G.point(x, h, y, rgbOf(c), o),
  line: (x0, y0, h0, x1, y1, h1, c, emit) => G.line(x0, h0, y0, x1, h1, y1, rgbOf(c), emit),
  layer: n => G.layer(n), rgb: rgbOf,
  get wind() { return feat('wind'); }, feature: feat,
  get hits() { return hits; },
  // game controls (game/game.js): dev keys + debug HUD on/off, player input locked, the simulation's speed, the world
  dev: true, lock: false, timeScale: 1, hudOff: false, BIOMES, TIMES,
  get biomeI() { return biomeI; }, get timeI() { return TIMES.indexOf(env.bucket); },
  setBiome: i => setBiome(i), setTime: i => env.setPart(TIMES[i]), setYaw: a => setYaw(a),
  teleport(x, y) {   // put the player at world (x, y), standing, and snap the camera there
    const [vx, vy] = toView(x, y);
    Object.assign(P, {x: vx, y: vy, z: elev(x, y), vx: 0, vy: 0, state: 'idle', t: 0, sink: 0, leap: null, hold: null});
    camInit = false;
  },
  // the Ranger as drawn this frame (sprite + runtime cloak + pixel bow, and its normals), for afterimages / reflections.
  // img / nrm are live canvases (redrawn every frame before F.frame runs): copy them if you keep a past frame. Their
  // size is img.width / img.height; h is the player's height above the ground (metres), like every host h.
  playerSprite: () => ({img: charCv, nrm: nrmCv, px: PIV[0] + CX, py: PIV[1] + CY, x: player.x, y: player.y, h: P.z, frame: P.frame, face: P.face}),
};

// ---------------------------------------------------------------- features
tp = performance.now();
const mods = await Promise.all(FEATURES.map(name => import(`./features/${name}.js`).then(m => ({name, m}), e => {
  if (!/Failed to fetch|Importing a module script failed|404|error loading/i.test(String(e))) console.warn('feature', name, e); return null; })));
for (const x of mods) {
  if (!x) continue;
  try { const f = await x.m.create(host); f.name ??= x.name; features.push(f); } catch (e) { console.warn('feature', x.name, e); }
}
features.sort((a, b) => FEATURES.indexOf(a.name) - FEATURES.indexOf(b.name));
mark('features', tp);
// the game goes first: it sees keys, arrows, hits and interactions before the engine's features
const game = await createGame(host); features.unshift(game);
const perf = createPerf({on: Q.get('perf') === '1'}); perf.instrument(features);
// the wind sways painted foliage cards and gives braziers / torches a live flame
world.hooks.card = cardHook;

// ---------------------------------------------------------------- toggles
const SAMPLING = ['auto', 'nearest', 'smooth'];
const opt = {sampling: Q.get('smooth') === '1' ? 'smooth' : SAMPLING.includes(Q.get('sampling')) ? Q.get('sampling') : 'auto',
  outline: true, banded: true, shadows: true, lantern: Q.get('lantern') === '1', debug: +(Q.get('debug') || 0), help: true, zones: false,
  hdBow: Q.get('bow') === 'hd'};   // J: the HD bow overlay instead of the pixel bow (the arena's toggle)
const DEBUG = ['final', 'albedo', 'normals', 'depth', 'object ids', 'sun shadow', 'light only'];
const SMOOTH_IN = 12, SMOOTH_OUT = 3, TURN_HOLD = .12;
let turnT = 0;
function stepSampling(dt, turned) {
  turnT = turned ? TURN_HOLD : Math.max(0, turnT - dt);
  const want = opt.sampling === 'smooth' ? 1 : opt.sampling === 'nearest' ? 0 : turnT > 0 ? 1 : 0, u = G.U.smooth;
  u.value = want > u.value ? Math.min(want, u.value + dt * SMOOTH_IN) : Math.max(want, u.value - dt * SMOOTH_OUT);
}
function applyOpts() {
  if (opt.sampling !== 'auto') G.U.smooth.value = opt.sampling === 'smooth' ? 1 : 0;
  G.compU.uOutline.value = opt.outline ? 1 : 0; G.compU.uBanded.value = opt.banded ? 1 : 0;
  G.compU.uShadowOn.value = G.compU.uPtShadow.value = opt.shadows ? 1 : 0; G.compU.uDebug.value = opt.debug; $('#help').classList.toggle('hidden', !opt.help || !host.dev);
}
applyOpts();

// ---------------------------------------------------------------- mood + lights
const HALO_A = .16, HALO_R = .3, LANTERN = {fwd: .22, side: .3, h: .95, c: [1, .76, .48], r: 4.2, k: 1, flicker: .2, id: -7};
function flick(l, t) {
  const f = l.flicker || 0; if (!f) return 1;
  const s = (l.id ?? 0) * 12.9898 % 6.283, n = .5 * Math.sin(t * 7.3 + s) + .3 * Math.sin(t * 12.7 + s * 2.3) + .2 * Math.sin(t * 23.1 + s * 3.7);
  return 1 - f * .22 * (1 + n);
}
const sunDir = new THREE.Vector3(), shadowDir = new THREE.Vector3();
// the arena's longest sun shadow (lighting.js SUN_LEN_MAX): 1.7 m per metre of height. A low dusk sun (10-14 deg) still
// LIGHTS from low down (warm grazing light, rims), but its shadows stop growing at this length: the true 1 / tan(el)
// stretched trees and towers 4-6x their height across the map
const SUN_LEN_MAX = 1.7, SHADOW_EL_MIN = Math.atan(1 / SUN_LEN_MAX);
// applyMood's light records, reused every frame
const LOUT = [], CAND = [], CW = [], FREC = [], colCache = new Map();
let nL = 0;
const colOf = c => { if (Array.isArray(c)) return c; let v = colCache.get(c); if (!v) colCache.set(c, v = rgbOf(c)); return v; };
const byD = (a, b) => a.d - b.d;
function putL(x, y, z, c, r, gain, flat) { const o = LOUT[nL] ??= {}; nL++; o.x = x; o.y = y; o.z = z; o.c = c; o.r = r; o.gain = gain; o.flat = flat; }
function applyMood(PX, PY, t) {
  const biome = BIOMES[biomeI].id, time = env.bucket, m = env.mood(biome), U = G.compU;   // the clock's blended mood
  U.uAmb.value.set(...m.amb);
  const az = m.sun.az * DEG, el = m.sun.el * DEG;
  sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  const sel = Math.max(el, SHADOW_EL_MIN);
  shadowDir.set(Math.sin(az) * Math.cos(sel), Math.sin(sel), -Math.cos(az) * Math.cos(sel));
  G.setSun(sunDir, shadowDir);
  U.uSunC.value.set(...(m.sun.c || [1, 1, 1])); U.uSunStr.value = m.sun.el > 2 ? (m.shadow.a > 0 ? 1 : .45) * (m.sun.k ?? .4) * 2.2 : 0;   // armour glints
  U.uSunK.value = m.sun.k; U.uShadowA.value = m.shadow.a > 0 && m.sun.el > 2 ? m.shadow.a : 0; U.uShadowC.value.set(...m.shadow.c);
  U.uFog.value.set(...m.fog);
  const la = Math.max(.02, lum(m.amb)), fk = lum(m.fill || [0, 0, 0]) / la * CHAR.fillK;
  U.uFill.value.set(...m.amb.map(v => v * fk)); U.uGrade.value.set(...GRADE[biome]); U.uGradeK.value = CHAR.gradeK[time] ?? 0;
  const dark = Math.max(0, 1 - lum(m.amb));
  U.uEmin.value = .1 + .2 * dark;
  U.uBg.value.set(...BG[biome].map(v => v * (.35 + .65 * lum(m.amb))));
  // lights: the lift (a flat pool at the player in dark scenes), the lantern, features' lights, the nearest world lights.
  // (every record is reused frame to frame: LOUT goes to the shader, CAND holds the candidates, FREC copies features' lights)
  nL = 0;
  if (m.lift[0] + m.lift[1] + m.lift[2] > 0) putL(PX, P.z + .9, PY, m.lift, 1.7, 1, true);
  if (opt.lantern) {
    const a = player.faceAngle, fx = Math.sin(a), fy = Math.cos(a), fk2 = flick(LANTERN, t);
    putL(PX + fx * LANTERN.fwd - fy * LANTERN.side, P.z + LANTERN.h, PY + fy * LANTERN.fwd + fx * LANTERN.side, LANTERN.c, LANTERN.r * (1 + (fk2 - 1) * .15), fk2, false);
  }
  let nc = 0, nf = 0;
  const cand = l => { const d = Math.hypot(l.x - PX, l.z - PY); if (d < 24 + l.r) { const w = CW[nc] ??= {l: null, d: 0}; w.l = l; w.d = d; CAND[nc++] = w; } };
  for (const l of world.lights) cand(l);
  for (const f of features) if (f.on !== false && f.lights) for (const l of f.lights()) {
    const o = FREC[nf++] ??= {};
    o.x = l.x; o.y = l.h || 0; o.z = l.y; o.c = colOf(l.color ?? l.c); o.r = l.radius || l.r || 3; o.k = l.intensity ?? l.k ?? 1; o.flicker = l.flicker || 0; o.id = l.id ?? 7000; o.jitter = l.jitter;
    cand(o);
  }
  CAND.length = nc; CAND.sort(byD);   // nearest first (stable: ties keep the world-then-features order)
  // a flame's light wanders a few cm (l.jitter, else from its flicker), so the shadows round a fire dance with it
  for (let i = 0; i < nc && nL < 32; i++) {
    const l = CAND[i].l, k = flick(l, t), j = l.jitter ?? (l.flicker || 0) * .035, s = (l.id ?? 0) * 7.13;
    const jx = j ? j * (Math.sin(t * 11.3 + s) + Math.sin(t * 17.9 + s * 1.7) * .6) / 1.6 : 0, jz = j ? j * (Math.sin(t * 13.1 + s * 2.1) + Math.sin(t * 7.7 + s * .9) * .6) / 1.6 : 0;
    putL(l.x + jx, l.y + Math.abs(jz) * .5, l.z + jz, l.c, l.r * (1 + (k - 1) * .15), l.k * k, false);
  }
  U.uNL.value = nL; let nh = 0;
  for (let i = 0; i < nL; i++) {
    const l = LOUT[i];
    U.uLP.value[i].set(l.x, l.y, l.z, l.r); U.uLC.value[i].set(l.c[0] * l.gain, l.c[1] * l.gain, l.c[2] * l.gain, l.flat ? 1 : 0);
    if (l.flat) continue;
    const a = Math.min(.75, HALO_A * l.gain * (m.glow ?? 1) * (.3 + .7 * dark) + Math.max(0, l.gain - 1.5) * .12); if (a < .02) continue;
    const [sx, sy] = G.toScreen(l.x, l.y, l.z);
    U.uHalo.value[nh].set(sx, VH - sy, (HALO_R + .12 * Math.min(2, l.gain) + Math.max(0, l.gain - 1.3) * .35) * PPM * zoom, a); U.uHaloC.value[nh].set(l.c[0], l.c[1], l.c[2]); nh++;
  }
  U.uNH.value = nh;
  return m;
}

// ---------------------------------------------------------------- camera target: eased (look-ahead), snapped to the pixel lattice
const T = new THREE.Vector3(), Ts = new THREE.Vector3();
let camInit = false;
// ox, oy: px offset (feel, shake) applied in the view; then the visible GROUND stays inside the world (the arena
// clamps its camera to the world the same way: no void past the edge), then the target snaps to the pixel lattice
function snapTarget(ox, oy) {
  const z = zoom, h = T.y, lift = h * PPMH / PPMY;   // the ground at screen centre lies `lift` m further back than the target
  let [vx, vy] = toView(T.x, T.z); vx += ox / PPM; vy += oy / PPMY;
  // the view's ground rectangle: half extents in the view frame, then its world-axis extents at this yaw
  const hx = VW / (2 * PPM * z), hy = VH / (2 * PPMY * z), c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const ex = hx * c + hy * s, ez = hx * s + hy * c;
  let [gx, gz] = toWorld(vx, vy - lift);
  gx = ex * 2 >= WORLD.WM ? WORLD.WM / 2 : Math.min(WORLD.WM - ex, Math.max(ex, gx));
  gz = ez * 2 >= WORLD.HM ? WORLD.HM / 2 : Math.min(WORLD.HM - ez, Math.max(ez, gz));
  [vx, vy] = toView(gx, gz); vy += lift;
  const sx = Math.round(vx * PPM * z) / (PPM * z), S = Math.round((vy * PPMY - h * PPMH) * z), vy2 = (S / z + h * PPMH) / PPMY;
  const [X, Zw] = toWorld(sx, vy2); Ts.set(X, h, Zw);
}

// ---------------------------------------------------------------- input
let dragging = false, dragX = 0, dragYaw = 0, paused = false;
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
  if (e.repeat) return;
  if (k === 'escape') { togglePause(); return; }
  if (k === 'f3') { e.preventDefault(); perf.toggle(); return; }   // the frame profiler
  if (paused) return;
  // locked (menus, death, travel) or a dev key outside dev mode: only the game hears it
  if (host.lock || (!host.dev && (DEV_KEYS.has(k) || (e.shiftKey && /^Digit[1-6]$/.test(e.code))))) { game.onKey?.(k, e); return; }
  // renderer A/B (Shift + 1..6): rotation steps, ground sampling, outlines, props live / 16-angle, bands, shadows
  if (e.shiftKey && /^Digit[1-6]$/.test(e.code)) {
    const d = +e.code.slice(5);
    if (d === 1) snapMode = (snapMode + 1) % 3;
    if (d === 2) opt.sampling = SAMPLING[(SAMPLING.indexOf(opt.sampling) + 1) % SAMPLING.length];
    if (d === 3) opt.outline = !opt.outline;
    if (d === 4) { propMode = propMode === 'live' ? 'yaw' : 'live'; world.setMode(propMode); }
    if (d === 5) opt.banded = !opt.banded;
    if (d === 6) opt.shadows = !opt.shadows;
    applyOpts(); return;
  }
  keys.add(k);
  for (const f of features) if (f.onKey?.(k, e)) return;
  for (const f of features) if (f.key && f.key === k && f.toggle) { f.toggle(); return; }
  if (k === ' ') PL.onSpace();
  if (k === 'e') { if (!nearProp() && climbSpotW() && Math.abs(yaw) > 1e-6 && !BUSY.has(P.state)) assist = {back: yaw, phase: 'in'}; else PL.onInteractKey(); }
  if (k >= '1' && k <= '4' && !BUSY.has(P.state)) features.some(f => f.ability?.(+k));
  if (k === 't') env.nextPart();   // jump to dawn / day / dusk / night; the clock runs on from there
  if (k === 'n') setBiome(biomeI + (e.shiftKey ? -1 : 1));
  if (k === 'l') opt.lantern = !opt.lantern;
  if (k === 'o') switchLoadout(loadI + 1);
  if (k === 'v') opt.banded = !opt.banded;
  if (k === 'j') opt.hdBow = !opt.hdBow;
  if (k === 'i') toggleArmour();
  if (k === 'r' && e.shiftKey) { trees3d = !trees3d; setBiome(biomeI); }   // trees: procedural 3D <-> painted cards
  else if (k === 'r') { propMode = propMode === 'live' ? 'yaw' : 'live'; world.setMode(propMode); }
  if (k === 'g') { if (e.shiftKey) opt.zones = !opt.zones; else opt.debug = (opt.debug + 1) % DEBUG.length; }
  if (k === 'h') opt.help = !opt.help;
  if (k === 'home') setYaw(0);
  applyOpts();
});
const DEV_KEYS = new Set(['n', 't', 'g', 'o', 'r', 'v', 'j', 'i', 'h', 'k', '5', '6', '7', '8', '9', 'f', 'b']);   // sandbox / test keys (9: light sources, f: the flames' look, b: wind strength)
addEventListener('keyup', e => { const k = e.key.toLowerCase(); keys.delete(k); if (k === 'e') PL.onInteractUp(); });
addEventListener('blur', () => { keys.clear(); mouse.down = false; dragging = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect(), s = r.width / VW, mx = (e.clientX - r.left) / s, my = (e.clientY - r.top) / s;
  mouse.x = VW / 2 + (mx - VW / 2) / zoom; mouse.y = VH / 2 + (my - VH / 2) / zoom;   // the player reads the screen at zoom 1
  if (dragging) { dragYaw += (e.clientX - dragX) * -.006; dragX = e.clientX; }
});
canvas.addEventListener('mousedown', e => {
  if (paused || host.lock) return;
  if (e.button === 0) { PL.press(); mouse.down = true; }
  if (e.button === 1) { e.preventDefault(); dragging = true; dragX = e.clientX; }
  if (e.button === 2 && !BUSY.has(P.state)) features.some(f => f.ability?.('rmb'));
});
addEventListener('mouseup', e => { if (e.button === 0) { if (!paused) PL.release(); mouse.down = false; } if (e.button === 1) dragging = false; });
canvas.addEventListener('wheel', e => { e.preventDefault(); zoom = e.deltaY < 0 ? 2 : 1; }, {passive: false});

// ---------------------------------------------------------------- pause menu (Escape)
function togglePause(force) {
  paused = force ?? !paused; $('#pause').classList.toggle('hidden', !paused);
  if (paused) { keys.clear(); renderMenu(); }
}
function renderMenu() {
  const rows = [];
  const btn = (label, value, act) => `<button data-act="${act}">${label}: <b>${value}</b></button>`;
  const gm = features.flatMap(f => f.menu?.() || []);
  if (gm.length) rows.push(`<h3>Game</h3>`, `<button data-act="resume"><b>Resume</b></button>`, ...gm.map((m, i) => `<button data-act="menu:${i}"><b>${m.label}</b></button>`));
  rows.push(`<h3>Renderer</h3>`, btn('Rotation', SNAP_NAME[snapMode], 'snap'), btn('Ground texture', opt.sampling, 'sampling'), btn('Prop outlines', opt.outline ? 'on' : 'off', 'outline'),
    btn('Props', propMode === 'live' ? 'live 3D' : '16-angle sprites', 'props'), btn('Trees', trees3d ? '3D (grown)' : 'painted cards', 'trees'), btn('Banded light', opt.banded ? 'on' : 'off', 'banded'), btn('Shadows (sun + lights)', opt.shadows ? 'on' : 'off', 'shadows'),
    btn('Debug view', DEBUG[opt.debug], 'debug'));
  if (host.dev) rows.push(`<h3>World</h3>`, btn('Biome', BIOMES[biomeI].name, 'biome'), btn('Time', `${env.clock()} ${env.part}`, 'time'),
    btn('Season', env.seasonLock || `auto (${env.season})`, 'season'), btn('Weather', env.weatherLock || `auto (${env.weather})`, 'weather'),
    btn('Day length', env.frozen ? 'stopped' : `${env.TUNE.dayMinutes} min`, 'daylen'), btn('Lantern', opt.lantern ? 'on' : 'off', 'lantern'), btn('Loadout', LOADOUTS[loadI][0], 'loadout'),
    btn('Bow', opt.hdBow ? 'HD overlay' : 'pixel art', 'hdbow'), btn('Shiny armour', armor.on ? 'on' : 'off', 'armour'));
  const fs = features.filter(f => f.toggle || f.settings);
  if (fs.length) {
    rows.push(`<h3>Features</h3>`);
    fs.forEach((f, i) => {
      if (f.toggle) rows.push(btn(f.label || f.name, f.on ? 'on' : 'off', 'feat:' + i));
      (f.settings?.() || []).forEach((s, j) => rows.push(s.options ? btn(s.label, s.get(), `set:${i}:${j}`) :
        `<label>${s.label} <input type="range" min="${s.min ?? 0}" max="${s.max ?? 1}" step="${s.step ?? .01}" value="${s.get()}" data-act="range:${i}:${j}"></label>`));
    });
  }
  $('#menu').innerHTML = rows.join('');
}
$('#pause').addEventListener('click', e => {
  const a = e.target.closest('[data-act]')?.dataset.act; if (!a) { if (e.target === $('#pause')) togglePause(false); return; }
  if (a === 'resume') { togglePause(false); return; }
  if (a.startsWith('menu:')) { const m = features.flatMap(f => f.menu?.() || [])[+a.slice(5)]; togglePause(false); m?.run(); return; }
  if (a === 'snap') snapMode = (snapMode + 1) % 3;
  if (a === 'sampling') opt.sampling = SAMPLING[(SAMPLING.indexOf(opt.sampling) + 1) % 3];
  if (a === 'outline') opt.outline = !opt.outline;
  if (a === 'props') { propMode = propMode === 'live' ? 'yaw' : 'live'; world.setMode(propMode); }
  if (a === 'trees') { trees3d = !trees3d; setBiome(biomeI); }
  if (a === 'banded') opt.banded = !opt.banded;
  if (a === 'shadows') opt.shadows = !opt.shadows;
  if (a === 'debug') opt.debug = (opt.debug + 1) % DEBUG.length;
  if (a === 'biome') setBiome(biomeI + 1);
  if (a === 'time') env.nextPart();
  const cyc = (o, cur, set) => set(o[(o.indexOf(cur) + 1) % o.length]);
  if (a === 'season') cyc(['auto', ...SEASONS], env.seasonLock || 'auto', env.setSeason);
  if (a === 'weather') cyc(['auto', ...Object.keys(WEATHER).filter(w => !WEATHER[w].precip || env.TUNE.precip)], env.weatherLock || 'auto', env.setWeather);
  if (a === 'daylen') cyc([20, 5, 60, 0], env.frozen ? 0 : env.TUNE.dayMinutes, env.setDayMinutes);
  if (a === 'lantern') opt.lantern = !opt.lantern;
  if (a === 'hdbow') opt.hdBow = !opt.hdBow;
  if (a === 'armour') toggleArmour();
  if (a === 'loadout') switchLoadout(loadI + 1);
  if (a.startsWith('feat:')) features.filter(f => f.toggle || f.settings)[+a.slice(5)].toggle();
  if (a.startsWith('set:')) { const [, i, j] = a.split(':').map(Number), s = features.filter(f => f.toggle || f.settings)[i].settings()[j]; const o = s.options, c = o.indexOf(s.get()); s.set(o[(c + 1) % o.length]); }
  applyOpts(); renderMenu();
});
$('#pause').addEventListener('input', e => {
  const a = e.target.dataset.act; if (!a?.startsWith('range:')) return;
  const [, i, j] = a.split(':').map(Number); features.filter(f => f.toggle || f.settings)[i].settings()[j].set(+e.target.value);
});

// ---------------------------------------------------------------- frame
const ROT_SPEED = 110 * DEG;
let last = performance.now(), fps = 60, hudT = 0, lastDt = 1 / 60, leafVer = -1, leafWorld = null;
function step(dt) {
  hoverKey++;
  // camera rotation: keys / middle-drag, then (in a step mode) ease onto the nearest step once you let go.
  // A climb started at an angle eases the camera to north first, climbs, then returns.
  const rot = (keys.has('x') ? 1 : 0) - (keys.has('z') ? 1 : 0);
  let ny = yaw + (paused ? 0 : rot * ROT_SPEED * dt + dragYaw); dragYaw = 0;
  if (assist) ny = stepAssist(dt, ny);
  else if (!rot && !dragging && snapMode) { const s = SNAP[snapMode], tg = Math.round(ny / s) * s, d = tg - ny; ny = Math.abs(d) < .0015 ? tg : ny + d * (1 - Math.exp(-dt * 14)); }
  const y0 = yaw; setYaw(ny); syncPlateaus();
  stepSampling(dt, yaw !== y0);
  if (paused) return;
  dt *= host.timeScale; if (dt <= 0) return;   // the game's slow motion / frozen world (the camera above stays live)
  env.step(dt);   // the world clock first: everything after reads this step's time / weather
  if (freeze > 0) { freeze -= dt; for (const f of features) if (f.always) f.update?.(dt, []); return; }
  const n0 = events.length, px0 = P.x, py0 = P.y;
  perf.begin('player.step', 'sim'); PL.step(dt); perf.end('player.step');
  for (let i = n0; i < events.length; i++) toWorldEvent(events[i]);   // the player's events are in the view frame
  clothPos[0] += P.x - px0; clothPos[1] += P.y - py0;               // its motion in the view frame, without the camera's turns
  perf.begin('arrows', 'sim'); stepArrows(dt); perf.end('arrows');
  if (rig.active) {
    Object.assign(CLOTH_PARAMS, feat('wind')?.on && feat('wind').cloth?.() || CLOTH_CALM);
    perf.begin('cloth.sim', 'char'); rig.update(dt, SP[P.frame]?.sim, P.face, clothPos); perf.end('cloth.sim');
  }
  const evs = events.splice(0);
  for (const f of features) if (f.on !== false || f.always) f.update?.(dt, evs);
  if (shakeS.t > 0) shakeS.t -= dt;
}
const CLOTH_CALM = {wind: [...CLOTH_PARAMS.wind], gust: CLOTH_PARAMS.gust};
// HAIR IN THE WIND: once the wind at the Ranger is more than a breeze (the wind feature's strength), the hair's edge pixels
// stream downwind on the screen by a pixel or two and lift at the crown, flickering at 10 fps like the arena's flame licks.
// Hair = the harmonized hair ramp (a57a58 / 845f46 / 624535, read off the ID passes), inside a box round the Head bone;
// the normals go along, so the lighting treats the strands as hair.
// No read-back per frame: each sprite frame + facing is read ONCE off its atlas (hairOf: the hair pixels in the box,
// which neighbours are empty, their colours) and cached; a frame then only paints the few strands that stream, one
// fillRect each, into the composite and its normals. (Where the cloak covers a pixel it is neither hair nor empty.)
const HAIR = new Set([0xa57a58, 0x845f46, 0x624535]);
const hh32 = (a, b, c) => { let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1442695041) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const HB = 26, hairCache = new WeakMap(), hairCv = document.createElement('canvas'), hairQ = hairCv.getContext('2d', {willReadFrequently: true}), HAIR_A = {x: 0, y: 0, g: 0};
hairCv.width = HB; hairCv.height = HB * 2;
const rgbaOf = (d, i) => `rgba(${d[i]},${d[i + 1]},${d[i + 2]},${(d[i + 3] / 255).toFixed(3)})`;
// -> {bx, by (the box in frame px), n, x, y (box px), f (bits: empty at x-1, x+1, x-2, x+2, y-1), ca, cn (colours)}
function hairOf(sp, face, hb) {
  let byFace = hairCache.get(sp); if (!byFace) hairCache.set(sp, byFace = []);
  if (byFace[face]) return byFace[face];
  if (sp.img.complete === false) return null;   // (an atlas still loading: try again next frame)
  const bx = Math.round((hb[0] + hb[2]) / 2) - 13, by = Math.round(Math.min(hb[1], hb[3])) - 6;
  const sx0 = Math.max(0, bx), sy0 = Math.max(0, by), sx1 = Math.min(FW, bx + HB), sy1 = Math.min(FH, by + HB);   // (inside this facing's frame)
  hairQ.clearRect(0, 0, HB, HB * 2);
  if (sx1 > sx0 && sy1 > sy0) {
    hairQ.drawImage(sp.img, face * FW + sx0, sy0, sx1 - sx0, sy1 - sy0, sx0 - bx, sy0 - by, sx1 - sx0, sy1 - sy0);
    if (sp.nrm) hairQ.drawImage(sp.nrm, face * FW + sx0, sy0, sx1 - sx0, sy1 - sy0, sx0 - bx, HB + sy0 - by, sx1 - sx0, sy1 - sy0);
  }
  const all = hairQ.getImageData(0, 0, HB, HB * 2).data, nOff = HB * HB * 4, a = i => all[i + 3] > 0;
  const xs = [], ys = [], fs = [], ca = [], cn = [];
  for (let y = 1; y < HB; y++) for (let x = 1; x < HB - 1; x++) {
    const i = (y * HB + x) * 4; if (!a(i) || !HAIR.has(all[i] << 16 | all[i + 1] << 8 | all[i + 2])) continue;
    const f = (a(i - 4) ? 0 : 1) | (a(i + 4) ? 0 : 2) | (x >= 2 && !a(i - 8) ? 4 : 0) | (x + 2 < HB && !a(i + 8) ? 8 : 0) | (a(i - HB * 4) ? 0 : 16);
    if (!f) continue;
    xs.push(x); ys.push(y); fs.push(f); ca.push(rgbaOf(all, i)); cn.push(sp.nrm ? rgbaOf(all, nOff + i) : null);
  }
  return (byFace[face] = {bx, by, n: xs.length, x: Int16Array.from(xs), y: Int16Array.from(ys), f: Uint8Array.from(fs), ca, cn});
}
function hairWind(fr) {
  const W = feat('wind'); if (!W?.on || !W.at) return;
  const k = Math.min(1, Math.max(0, ((W.strength || 0) - 1.05) / 1.3)); if (k <= 0) return;
  const sp = SP[fr], hb = sp?.bones?.[DIRS[P.face]]?.Head; if (!hb) return;
  const a = W.at(player.x, player.y, HAIR_A), dir = Math.sign(a.x * Math.cos(yaw) - a.y * Math.sin(yaw)) || 1;   // downwind on screen
  const H = hairOf(sp, P.face, hb); if (!H) return;
  const x0 = CX + H.bx, y0 = CY + H.by, tk = Math.floor(performance.now() / 100), cl = rig.active ? rig : null;
  const fOut = dir > 0 ? 2 : 1, fOut2 = dir > 0 ? 8 : 4;
  for (let i = 0; i < H.n; i++) {
    const x = H.x[i], y = H.y[i], f = H.f[i], fx = H.bx + x, fy = H.by + y;   // fx, fy: frame px (the cloak's covers())
    if (cl && cl.covers(fx, fy)) continue;
    const r = hh32(x0 + x, y0 + y, tk);
    let n = 0, ux = 0, uy = 0;
    if (f & fOut && r < k * .6 && !(cl && cl.covers(fx + dir, fy))) { n = k > .5 && f & fOut2 && r < (k - .5) * .5 && !(cl && cl.covers(fx + 2 * dir, fy)) ? 2 : 1; ux = dir; }   // a lock streams out
    else if (f & 16 && r > 1 - k * .2 && !(cl && cl.covers(fx, fy - 1))) { n = 1; uy = -1; }   // a tuft lifts at the crown
    for (let s = 1; s <= n; s++) {
      cq.fillStyle = H.ca[i]; cq.fillRect(x0 + x + ux * s, y0 + y + uy * s, 1, 1);
      if (H.cn[i]) { nq.fillStyle = H.cn[i]; nq.fillRect(x0 + x + ux * s, y0 + y + uy * s, 1, 1); }
    }
  }
}
const clothPos = [0, 0];
function toWorldEvent(e) {
  if (e.x !== undefined && e.y !== undefined) [e.x, e.y] = toWorld(e.x, e.y);
  if (e.vx !== undefined && e.vy !== undefined) [e.vx, e.vy] = toWorld(e.vx, e.vy);
}
function draw(t) {
  hoverKey++;
  const [PX, PY] = [player.x, player.y];
  // camera: eases after the player with a little look-ahead (the arena's), feel offsets from features, shake
  if (!camInit) { T.set(PX, P.z, PY); camInit = true; }
  const [lvx, lvy] = toWorld(P.vx * .12, P.vy * .12 - 30 / PPMY);   // look-ahead + 30 px of headroom (arena: ty - 30)
  const k = 1 - Math.exp(-lastDt * 9); T.x += (PX + lvx - T.x) * k; T.y += (P.z - T.y) * k; T.z += (PY + lvy - T.z) * k;
  let ox = 0, oy = 0;
  for (const f of features) if (f.on !== false && f.camera) { const o = f.camera(lastDt); if (o) { ox += o.x || 0; oy += o.y || 0; } }
  const sk = shakeS.t > 0 ? shakeS.a * Math.min(1, shakeS.t * 8) : 0;
  ox += Math.round((Math.random() * 2 - 1) * sk); oy += Math.round((Math.random() * 2 - 1) * sk);
  snapTarget(ox, oy); G.setView(Ts, yaw, zoom);
  const [tvx, tvy] = toView(Ts.x, Ts.z);
  cam.x = cam.fx = tvx * PPM - VW / 2; cam.y = cam.fy = tvy * PPMY - Ts.y * PPMH - VH / 2;
  // the Ranger: sprite (+ runtime cloak) + pixel bow, albedo and normals, sinking when he falls in
  perf.begin('hero.compose', 'char');
  const fr = SP[P.frame] ? P.frame : 'idle.0', sp = SP[fr];
  cq.clearRect(0, 0, 192, 160); nq.clearRect(0, 0, 192, 160);
  const sinkPx = Math.round((P.sink || 0) * 22);
  cq.drawImage(armor.albedo(fr, sp.img), P.face * FW, 0, FW, FH - sinkPx, CX, CY + sinkPx, FW, FH - sinkPx);   // (armor: metal repainted)
  if (sp.nrm) nq.drawImage(sp.nrm, P.face * FW, 0, FW, FH - sinkPx, CX, CY + sinkPx, FW, FH - sinkPx);
  if (rig.active && sp.depth && !sinkPx) rig.draw(cq, CX, CY, depthOf(sp.depth), P.face, nq);
  if (!sinkPx) hairWind(fr);
  if (!sinkPx && !opt.hdBow) PL.drawPixelBow(cq, CX, CY);
  drawMetal(fr, sinkPx);
  G.tex(charCv, {dynamic: true}); G.tex(nrmCv, {dynamic: true});
  perf.end('hero.compose');
  hero.g.uniforms.uHasNrm.value = sp.nrm ? 1 : 0;
  hero.u.uAnchor.value.set(PX, P.z, PY);
  hero.setVisible(!(P.blink && Math.floor(P.blink * 12) % 2));
  G.compU.uPlayer.value.set(PX, P.z + .9, PY);
  // props, hover pulse on the aimed target
  const hov = P.state === 'draw' ? hoverTarget()?.target : null;
  for (const it of world.items) it.hover = it.p === hov ? .16 + .08 * Math.sin(performance.now() / 110) : 0;
  perf.begin('world.update', 'view'); world.update(yaw); perf.end('world.update');
  // the season's leaves (env.leafRamp: changes a few times per season; a rebuilt world starts from the biome's own ramp)
  const lr = env.leafRamp(); if (lr && (env.ver.leaf !== leafVer || world !== leafWorld)) { world.setFamily?.('leaf', lr); leafVer = env.ver.leaf; leafWorld = world; }
  drawArrows();
  for (const q of dust) { const kk = q.t / q.life; host.point(q.x, q.y, q.h, DUST[kk < .4 ? 0 : kk < .75 ? 1 : 2]); }
  for (const p of pops) { const h = p.z + 1.7 + p.t * .5; for (const [dx, dh] of [[0, 0], [-1, 0], [1, 0], [0, 1], [0, -1]]) { const [vx, vy] = toWorld(dx / PPM, 0); host.point(p.x + vx, p.y + vy, h + dh / PPMH, POP, {emit: true}); } }
  for (const f of features) if (f.on !== false) f.frame?.({dt: lastDt, t});
  // the aim reticle (pixel cross at the cursor, front layer)
  if (P.state === 'draw') {
    const q = G.layer('front'), mx = Math.round(VW / 2 + (mouse.x - VW / 2) * zoom), my = Math.round(VH / 2 + (mouse.y - VH / 2) * zoom);
    q.fillStyle = P.t > .5 ? '#f2d27a' : '#e9e4da';
    q.fillRect(mx - 3, my, 2, 1); q.fillRect(mx + 2, my, 2, 1); q.fillRect(mx, my - 3, 1, 2); q.fillRect(mx, my + 2, 1, 2);
  }
  if (opt.zones) drawZones();
  perf.begin('mood+lights', 'view'); applyMood(PX, PY, t); perf.end('mood+lights');
  perf.begin('G.render', 'render'); G.render(); perf.end('G.render');
  // HD overlay
  const dpr = devicePixelRatio || 1, sc = scale * dpr;
  hq.setTransform(1, 0, 0, 1, 0, 0); hq.clearRect(0, 0, hdc.width, hdc.height);
  for (const f of features) if (f.on !== false && f.hd && (!host.hudOff || f === game)) { hq.save(); f.hd(hq, sc); hq.restore(); }   // hudOff: the title
  if (opt.hdBow && !sinkPx) drawHDBow(sc);
  drawPrompt(sc);
  perf.draw(hq, sc);
}
// the HD bow (J): player.js's display-resolution string, nocked arrow and flying arrows, drawn on the HD overlay. It works
// in the view frame at zoom 1 (its own toS / cam), so arrows go in as view-frame copies and the zoom is a transform
function drawHDBow(sc) {
  const z = zoom, s2 = sc * z, [px, py] = ctxO.toS(P.x, P.y, P.z);
  const view = arrows.map(a => {
    const [x, y] = toView(a.x, a.y), [vx, vy] = toView(a.vx, a.vy);
    return {...a, x, y, vx, vy, trail: a.trail?.map(([tx, ty, th]) => { const [u, v] = toView(tx, ty); return [u, v, th]; })};
  });
  hq.save(); hq.translate(VW / 2 * sc * (1 - z), VH / 2 * sc * (1 - z));
  PL.drawHD(hq, s2, (Math.round(px - cam.fx) - PIV[0]) * s2, (Math.round(py - cam.fy) - PIV[1]) * s2, view);
  hq.restore();
}
function drawPrompt(sc) {   // "E climb" / "E open" over the thing you can interact with
  let at = null, txt = '';
  if (host.lock) return;
  let col = '#f0c060';
  const p = nearProp(); if (p && !BUSY.has(P.state)) {
    const r = features.map(f => f.prompt?.(p)).find(Boolean);
    at = [p.x, p.y, (p.z || 0) + 1.1]; txt = r?.text ?? r ?? 'E  open'; col = r?.color ?? col;
  }
  else if (!BUSY.has(P.state) && climbSpotW()) { at = [player.x, player.y, P.z + 2]; txt = P.z > .1 ? 'E  climb down' : 'E  climb'; }
  if (!at) return;
  const [sx, sy] = G.toScreen(at[0], at[2], at[1]);
  hq.font = `${Math.round(11 * (devicePixelRatio || 1))}px ui-monospace, Consolas, monospace`; hq.textAlign = 'center';
  const w = hq.measureText(txt).width + 12 * (devicePixelRatio || 1);
  hq.fillStyle = 'rgba(14,16,15,.8)'; hq.fillRect(sx * sc - w / 2, sy * sc - 16 * (devicePixelRatio || 1), w, 18 * (devicePixelRatio || 1));
  hq.fillStyle = col; hq.fillText(txt, sx * sc, sy * sc - 3 * (devicePixelRatio || 1));
}
function drawZones() {   // Shift+G: colliders (red), the playable rectangle (cyan)
  const q = G.layer('front'); q.lineWidth = 1;
  const poly = (pts, col) => { q.strokeStyle = col; q.beginPath(); pts.forEach(([x, y], i) => { const [sx, sy] = host.toView(x, y, 0); i ? q.lineTo(sx, sy) : q.moveTo(sx, sy); }); q.closePath(); q.stroke(); };
  poly([[PLAY.x0, PLAY.y0], [PLAY.x1, PLAY.y0], [PLAY.x1, PLAY.y1], [PLAY.x0, PLAY.y1]], '#3ad0ff');
  for (const p of world.props) {
    if (p.rect) poly([[p.rect[0], p.rect[1]], [p.rect[2], p.rect[1]], [p.rect[2], p.rect[3]], [p.rect[0], p.rect[3]]], '#ff5050');
    else if (p.r) poly(Array.from({length: 10}, (_, i) => [p.x + Math.cos(i / 10 * 6.283) * p.r, p.y + Math.sin(i / 10 * 6.283) * p.r]), '#ff5050');
  }
}
function frame(now) {
  const dt = Math.max(0, Math.min(.05, (now - last) / 1000)); last = now; lastDt = dt;
  perf.frameStart(); step(dt); draw(now / 1000); perf.frameEnd();
  fps = fps * .95 + (dt > 0 ? 1 / dt : 60) * .05;
  if (now - hudT > 250) { hudT = now; hud(); }
  requestAnimationFrame(frame);
}
function hud() {
  $('#hud').classList.toggle('hidden', !host.dev); $('#help').classList.toggle('hidden', !host.dev || !opt.help);
  if (!host.dev) return;
  const b = BIOMES[biomeI], deg = ((yaw / DEG) % 360 + 360) % 360, s = G.stats;
  const fh = features.map(f => f.hud?.()).filter(Boolean).join(' · ');
  $('#hud').innerHTML = [
    `<div class="row"><b>Proving Grounds 3D</b> · ${b.name} · ${env.label()}${opt.lantern ? ' · lantern' : ''} · ${LOADOUTS[loadI][0]}</div>`,
    fh ? `<div class="row">${fh}</div>` : '',
    `<div class="row">camera <b>${deg.toFixed(1)}°</b> (${SNAP_NAME[snapMode]}) · zoom ${zoom}x${opt.debug ? ` · view <b>${DEBUG[opt.debug]}</b>` : ''}</div>`,
    `<div class="row dim">features: ${features.map(f => `${f.name}${f.on === false ? ' (off)' : ''}`).join(', ') || 'none yet'}</div>`,
    `<div class="row dim">${fps.toFixed(0)} fps · ${s.ms.toFixed(1)} ms CPU · ${s.calls} draws · ${s.sprites} sprites · ${s.points} pts · hits ${hits}/${PL.shots}</div>`,
  ].join('');
}
$('#load').classList.add('hidden');
console.log(`render3d ready in ${((performance.now() - t00) / 1000).toFixed(1)} s (${set.packed ? 'packed atlas' : 'per-file atlas'})`, JSON.stringify(TIMING));

// debug handle for scripted tests (drive frames while the pane is hidden: rAF pauses there)
window.__r3d = {G, THREE, P, PL, host, player, keys, mouse, cam, opt, arrows, features, game, toView, toWorld, setYaw, setBiome, switchLoadout, TIMING, perf,
  get world() { return world; }, get yaw() { return yaw; }, set zoom(v) { zoom = v; }, set time(i) { env.setPart(TIMES[i]); }, env, set snap(i) { snapMode = i; },
  set props(m) { propMode = m; world.setMode(m); }, get rig() { return rig; },
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { lastDt = dt; step(dt); draw(performance.now() / 1000); } },
  applyOpts, hud};
requestAnimationFrame(frame);
