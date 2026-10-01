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
// HOST (see `host` below): player, arrows, spawnArrow, events, props, itemOf, elev, inStream, blocked, layout,
//   hitstop, shake, knock, play, aim, mouse, keys, toView(x, y, h) -> view px, sprite, point, line, layer(name),
//   world, biome, time, mood, wind (the wind feature, if any), feature(name), PPM / PPMY / PPMH, G, THREE.
import * as THREE from 'three';
import {createGfx, DEG} from './gfx.js';
import {buildWorld, texOf, PLAY, TRAIL, elev, inStream, PLATEAUS} from './world.js';
import {loadAtlas} from './atlas.js';
import {BIOMES} from '../sprites/arena/biomes.js';
import {createLighting} from '../sprites/arena/lighting.js';
import {ClothRig, depthOf, CLOTH_PARAMS} from '../sprites/cloth.js';
import {createPlayer, atlasOf, BUSY, AIM_H} from '../sprites/player.js';

const $ = s => document.querySelector(s);
const Q = new URLSearchParams(location.search);
const VW = 480, VH = 270;
const t00 = performance.now();
const FEATURES = ['wind', 'combat', 'atmos', 'flow', 'wildlife', 'depth', 'audio'];   // update order (wind first: others read it)

// ---------------------------------------------------------------- the Ranger: loadouts (packed atlases)
const LOADOUTS = [['ranger basic', '../sprites/out/outfits/ranger_basic/'], ['ranger + cloth sim', '../sprites/out/outfits/ranger_sim/'], ['bare body', '../sprites/out/skel/']];
let loadI = {body: 2, sim: 1}[Q.get('set')] ?? 0;
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

let biomeI = Math.max(0, BIOMES.findIndex(b => b.id === Q.get('biome'))), timeI = Math.max(0, TIMES.indexOf(Q.get('time')));
let world = null, propMode = Q.get('props') === 'yaw' ? 'yaw' : 'live';
const features = [];
async function setBiome(i) {
  biomeI = ((i % BIOMES.length) + BIOMES.length) % BIOMES.length;
  $('#load').classList.remove('hidden'); $('#load').textContent = 'Building ' + BIOMES[biomeI].name + '…';
  const keep = world?.props;
  world?.dispose();
  world = await buildWorld(G, {biome: BIOMES[biomeI], ctxO, PPM, PPMH});
  if (keep) { world.props.length = 0; keep.forEach(p => world.props.push(p)); }   // (the layout is rebuilt identically; props keep their state)
  world.setMode(propMode);
  for (const f of features) f.biomeChanged?.();
  $('#load').classList.add('hidden');
}
tp = performance.now();
await setBiome(biomeI);
mark('world', tp);

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
  pixelBow: () => true,
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
const player = {
  get x() { return toWorld(P.x, P.y)[0]; }, get y() { return toWorld(P.x, P.y)[1]; }, get z() { return P.z; },
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
const hero = G.card({tex: texOf(charCv), nrm: texOf(nrmCv), w: 192, h: 160, px: PIV[0] + CX, py: PIV[1] + CY, type: 4, obj: 8, bias: .0025, xray: true});

async function switchLoadout(i) {
  loadI = ((i % LOADOUTS.length) + LOADOUTS.length) % LOADOUTS.length;
  $('#load').classList.remove('hidden'); $('#load').textContent = 'Loading ' + LOADOUTS[loadI][0] + '…';
  const s = await loadAtlas(LOADOUTS[loadI][1], {ClothRig});
  const a = atlasOf(s), old = ND;
  Object.assign(atlas, a); set = s; SP = s.SP; rig = s.rig; ({FW, FH, PIV, ND, DIRS} = a);
  if (ND !== old) { P.face = Math.round(P.face * ND / old) % ND; P.want = P.face; }
  rig.reset?.();
  hero.u.uPivot.value.set(PIV[0] + CX, PIV[1] + CY);
  $('#load').classList.add('hidden');
}

// ---------------------------------------------------------------- feel: shake, hitstop, knock
let freeze = 0; const shakeS = {a: 0, t: 0};
function shake(a, sec) { if (a >= shakeS.a * (shakeS.t > 0 ? 1 : 0)) { shakeS.a = a; shakeS.t = sec; } }

// ---------------------------------------------------------------- targets, interaction
// ARPG targeting: the cursor over something hittable aims at it (front-most). -> {x, y, h (aim height), target} world
function hoverTarget() {
  for (const f of features) { const t = f.aimTarget?.(); if (t) return t; }
  let best = null, bn = -1e9;
  const mx = VW / 2 + (mouse.x - VW / 2) * zoom, my = VH / 2 + (mouse.y - VH / 2) * zoom;
  for (const it of world.items) {
    const p = it.p; if (p.broken || p.gone || !(p.target || p.hp > 0)) continue;
    const z0 = (p.z || 0) + (p.h || 0), hh = p.hitH ?? (p.kind === 'pot' ? .55 : p.kind === 'crate' ? .75 : 1.6), rr = Math.max(.3, p.hitR ?? p.r ?? .4);
    const [x0, y0] = G.toScreen(p.x, z0 + hh, p.y), [, y1] = G.toScreen(p.x, z0, p.y), w = rr * PPM * zoom;
    if (mx > x0 - w - 2 && mx < x0 + w + 2 && my > y0 - 3 && my < y1 + 3) { const n = toView(p.x, p.y)[1]; if (n > bn) { bn = n; best = p; } }
  }
  return best && {x: best.x, y: best.y, h: (best.z || 0) + (best.h || 0) + Math.min(AIM_H, (best.hitH ?? 1.6) * .55), target: best};
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
function spawnArrow(o) { arrows.push({life: 1.6, vh: 0, kind: 'arrow', ...o}); }
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
    if (!a.stuck && world.props.some(p => !p.broken && !p.gone && !(a.hitSet && a.hitSet.has(p)) && (p.rect ? a.x > p.rect[0] && a.x < p.rect[2] && a.y > p.rect[1] && a.y < p.rect[3] : p.r > .3 && Math.hypot(p.x - a.x, p.y - a.y) < p.r)
      && a.h > (p.z || 0) && a.h < (p.z || 0) + (p.kind === 'wall_s' ? .5 : 2.5))) { a.stuck = true; a.life = 3; features.forEach(f => f.onArrowStuck?.(a)); }
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
  get world() { return world; }, get biome() { return BIOMES[biomeI]; }, get time() { return TIMES[timeI]; }, get mood() { return MOODS[BIOMES[biomeI].id][TIMES[timeI]]; },
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
// the wind sways painted foliage cards and gives braziers / torches a live flame
world.hooks.card = (it, sp) => { const w = feat('wind'); return w?.on && w.card ? w.card(it, sp) : null; };

// ---------------------------------------------------------------- toggles
const SAMPLING = ['auto', 'nearest', 'smooth'];
const opt = {sampling: Q.get('smooth') === '1' ? 'smooth' : SAMPLING.includes(Q.get('sampling')) ? Q.get('sampling') : 'auto',
  outline: true, banded: true, shadows: true, lantern: Q.get('lantern') === '1', debug: +(Q.get('debug') || 0), help: true, zones: false};
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
  G.compU.uShadowOn.value = opt.shadows ? 1 : 0; G.compU.uDebug.value = opt.debug; $('#help').classList.toggle('hidden', !opt.help);
}
applyOpts();

// ---------------------------------------------------------------- mood + lights
const HALO_A = .16, HALO_R = .3, LANTERN = {fwd: .22, side: .3, h: .95, c: [1, .76, .48], r: 4.2, k: 1, flicker: .2, id: -7};
function flick(l, t) {
  const f = l.flicker || 0; if (!f) return 1;
  const s = (l.id ?? 0) * 12.9898 % 6.283, n = .5 * Math.sin(t * 7.3 + s) + .3 * Math.sin(t * 12.7 + s * 2.3) + .2 * Math.sin(t * 23.1 + s * 3.7);
  return 1 - f * .22 * (1 + n);
}
const sunDir = new THREE.Vector3();
function applyMood(PX, PY, t) {
  const biome = BIOMES[biomeI].id, time = TIMES[timeI], m = MOODS[biome][time], U = G.compU;
  U.uAmb.value.set(...m.amb);
  const az = m.sun.az * DEG, el = m.sun.el * DEG;
  sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  G.setSun(sunDir);
  U.uSunK.value = m.sun.k; U.uShadowA.value = m.shadow.a > 0 && m.sun.el > 2 ? m.shadow.a : 0; U.uShadowC.value.set(...m.shadow.c);
  U.uFog.value.set(...m.fog);
  const la = Math.max(.02, lum(m.amb)), fk = lum(m.fill || [0, 0, 0]) / la * CHAR.fillK;
  U.uFill.value.set(...m.amb.map(v => v * fk)); U.uGrade.value.set(...GRADE[biome]); U.uGradeK.value = CHAR.gradeK[time] ?? 0;
  const dark = Math.max(0, 1 - lum(m.amb));
  U.uEmin.value = .1 + .2 * dark;
  U.uBg.value.set(...BG[biome].map(v => v * (.35 + .65 * lum(m.amb))));
  // lights: the lift (a flat pool at the player in dark scenes), the lantern, features' lights, the nearest world lights
  const L = [];
  if (m.lift[0] + m.lift[1] + m.lift[2] > 0) L.push({x: PX, y: P.z + .9, z: PY, c: m.lift, r: 1.7, gain: 1, flat: true});
  if (opt.lantern) {
    const a = player.faceAngle, fx = Math.sin(a), fy = Math.cos(a), fk2 = flick(LANTERN, t);
    L.push({x: PX + fx * LANTERN.fwd - fy * LANTERN.side, y: P.z + LANTERN.h, z: PY + fy * LANTERN.fwd + fx * LANTERN.side, c: LANTERN.c, r: LANTERN.r * (1 + (fk2 - 1) * .15), gain: fk2});
  }
  const pool = world.lights.slice();
  for (const f of features) if (f.on !== false && f.lights) for (const l of f.lights()) pool.push({x: l.x, y: (l.h || 0), z: l.y, c: rgbOf(l.color ?? l.c), r: l.radius || l.r || 3, k: l.intensity ?? l.k ?? 1, flicker: l.flicker || 0, id: l.id ?? 7000});
  const near = pool.map(l => ({l, d: Math.hypot(l.x - PX, l.z - PY)})).filter(o => o.d < 24 + o.l.r).sort((a, b) => a.d - b.d);
  for (const {l} of near) { if (L.length >= 16) break; const k = flick(l, t); L.push({x: l.x, y: l.y, z: l.z, c: l.c, r: l.r * (1 + (k - 1) * .15), gain: l.k * k}); }
  U.uNL.value = L.length; let nh = 0;
  L.forEach((l, i) => {
    U.uLP.value[i].set(l.x, l.y, l.z, l.r); U.uLC.value[i].set(l.c[0] * l.gain, l.c[1] * l.gain, l.c[2] * l.gain, l.flat ? 1 : 0);
    if (l.flat) return;
    const a = Math.min(.75, HALO_A * l.gain * (m.glow ?? 1) * (.3 + .7 * dark) + Math.max(0, l.gain - 1.5) * .12); if (a < .02) return;
    const [sx, sy] = G.toScreen(l.x, l.y, l.z);
    U.uHalo.value[nh].set(sx, VH - sy, (HALO_R + .12 * Math.min(2, l.gain) + Math.max(0, l.gain - 1.3) * .35) * PPM * zoom, a); U.uHaloC.value[nh].set(...l.c); nh++;
  });
  U.uNH.value = nh;
  return m;
}

// ---------------------------------------------------------------- camera target: eased (look-ahead), snapped to the pixel lattice
const T = new THREE.Vector3(), Ts = new THREE.Vector3();
let camInit = false;
function snapTarget(ox, oy) {   // ox, oy: px offset (feel, shake) applied in the view, then snapped
  const [vx, vy] = toView(T.x, T.z), z = zoom;
  const sx = Math.round((vx * PPM + ox) * z) / (PPM * z), S = Math.round((vy * PPMY - T.y * PPMH + oy) * z), vy2 = (S / z + T.y * PPMH) / PPMY;
  const [X, Zw] = toWorld(sx, vy2); Ts.set(X, T.y, Zw);
}

// ---------------------------------------------------------------- input
let dragging = false, dragX = 0, dragYaw = 0, paused = false;
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
  if (e.repeat) return;
  if (k === 'escape') { togglePause(); return; }
  if (paused) return;
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
  if (k === 't') timeI = (timeI + 1) % TIMES.length;
  if (k === 'n') setBiome(biomeI + (e.shiftKey ? -1 : 1));
  if (k === 'l') opt.lantern = !opt.lantern;
  if (k === 'o') switchLoadout(loadI + 1);
  if (k === 'v') opt.banded = !opt.banded;
  if (k === 'r') { propMode = propMode === 'live' ? 'yaw' : 'live'; world.setMode(propMode); }
  if (k === 'g') { if (e.shiftKey) opt.zones = !opt.zones; else opt.debug = (opt.debug + 1) % DEBUG.length; }
  if (k === 'h') opt.help = !opt.help;
  if (k === 'home') setYaw(0);
  applyOpts();
});
addEventListener('keyup', e => { const k = e.key.toLowerCase(); keys.delete(k); if (k === 'e') PL.onInteractUp(); });
addEventListener('blur', () => { keys.clear(); mouse.down = false; dragging = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect(), s = r.width / VW, mx = (e.clientX - r.left) / s, my = (e.clientY - r.top) / s;
  mouse.x = VW / 2 + (mx - VW / 2) / zoom; mouse.y = VH / 2 + (my - VH / 2) / zoom;   // the player reads the screen at zoom 1
  if (dragging) { dragYaw += (e.clientX - dragX) * -.006; dragX = e.clientX; }
});
canvas.addEventListener('mousedown', e => {
  if (paused) return;
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
  rows.push(`<h3>Renderer</h3>`, btn('Rotation', SNAP_NAME[snapMode], 'snap'), btn('Ground texture', opt.sampling, 'sampling'), btn('Prop outlines', opt.outline ? 'on' : 'off', 'outline'),
    btn('Props', propMode === 'live' ? 'live 3D' : '16-angle sprites', 'props'), btn('Banded light', opt.banded ? 'on' : 'off', 'banded'), btn('Sun shadows', opt.shadows ? 'on' : 'off', 'shadows'),
    btn('Debug view', DEBUG[opt.debug], 'debug'));
  rows.push(`<h3>World</h3>`, btn('Biome', BIOMES[biomeI].name, 'biome'), btn('Time', TIMES[timeI], 'time'), btn('Lantern', opt.lantern ? 'on' : 'off', 'lantern'), btn('Loadout', LOADOUTS[loadI][0], 'loadout'));
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
  if (a === 'snap') snapMode = (snapMode + 1) % 3;
  if (a === 'sampling') opt.sampling = SAMPLING[(SAMPLING.indexOf(opt.sampling) + 1) % 3];
  if (a === 'outline') opt.outline = !opt.outline;
  if (a === 'props') { propMode = propMode === 'live' ? 'yaw' : 'live'; world.setMode(propMode); }
  if (a === 'banded') opt.banded = !opt.banded;
  if (a === 'shadows') opt.shadows = !opt.shadows;
  if (a === 'debug') opt.debug = (opt.debug + 1) % DEBUG.length;
  if (a === 'biome') setBiome(biomeI + 1);
  if (a === 'time') timeI = (timeI + 1) % TIMES.length;
  if (a === 'lantern') opt.lantern = !opt.lantern;
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
let last = performance.now(), fps = 60, hudT = 0, lastDt = 1 / 60;
function step(dt) {
  // camera rotation: keys / middle-drag, then (in a step mode) ease onto the nearest step once you let go.
  // A climb started at an angle eases the camera to north first, climbs, then returns.
  const rot = (keys.has('x') ? 1 : 0) - (keys.has('z') ? 1 : 0);
  let ny = yaw + (paused ? 0 : rot * ROT_SPEED * dt + dragYaw); dragYaw = 0;
  if (assist) ny = stepAssist(dt, ny);
  else if (!rot && !dragging && snapMode) { const s = SNAP[snapMode], tg = Math.round(ny / s) * s, d = tg - ny; ny = Math.abs(d) < .0015 ? tg : ny + d * (1 - Math.exp(-dt * 14)); }
  const y0 = yaw; setYaw(ny); syncPlateaus();
  stepSampling(dt, yaw !== y0);
  if (paused) return;
  if (freeze > 0) { freeze -= dt; for (const f of features) if (f.always) f.update?.(dt, []); return; }
  const n0 = events.length, px0 = P.x, py0 = P.y;
  PL.step(dt);
  for (let i = n0; i < events.length; i++) toWorldEvent(events[i]);   // the player's events are in the view frame
  clothPos[0] += P.x - px0; clothPos[1] += P.y - py0;               // its motion in the view frame, without the camera's turns
  stepArrows(dt);
  if (rig.active) {
    Object.assign(CLOTH_PARAMS, feat('wind')?.on && feat('wind').cloth?.() || CLOTH_CALM);
    rig.update(dt, SP[P.frame]?.sim, P.face, clothPos);
  }
  const evs = events.splice(0);
  for (const f of features) if (f.on !== false || f.always) f.update?.(dt, evs);
  if (shakeS.t > 0) shakeS.t -= dt;
}
const CLOTH_CALM = {wind: [...CLOTH_PARAMS.wind], gust: CLOTH_PARAMS.gust};
const clothPos = [0, 0];
function toWorldEvent(e) {
  if (e.x !== undefined && e.y !== undefined) [e.x, e.y] = toWorld(e.x, e.y);
  if (e.vx !== undefined && e.vy !== undefined) [e.vx, e.vy] = toWorld(e.vx, e.vy);
}
function draw(t) {
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
  const fr = SP[P.frame] ? P.frame : 'idle.0', sp = SP[fr];
  cq.clearRect(0, 0, 192, 160); nq.clearRect(0, 0, 192, 160);
  const sinkPx = Math.round((P.sink || 0) * 22);
  cq.drawImage(sp.img, P.face * FW, 0, FW, FH - sinkPx, CX, CY + sinkPx, FW, FH - sinkPx);
  if (sp.nrm) nq.drawImage(sp.nrm, P.face * FW, 0, FW, FH - sinkPx, CX, CY + sinkPx, FW, FH - sinkPx);
  if (rig.active && sp.depth && !sinkPx) rig.draw(cq, CX, CY, depthOf(sp.depth), P.face, nq);
  if (!sinkPx) PL.drawPixelBow(cq, CX, CY);
  G.tex(charCv, {dynamic: true}); G.tex(nrmCv, {dynamic: true});
  hero.g.uniforms.uHasNrm.value = sp.nrm ? 1 : 0;
  hero.u.uAnchor.value.set(PX, P.z, PY);
  hero.setVisible(!(P.blink && Math.floor(P.blink * 12) % 2));
  G.compU.uPlayer.value.set(PX, P.z + .9, PY);
  // props, hover pulse on the aimed target
  const hov = P.state === 'draw' ? hoverTarget()?.target : null;
  for (const it of world.items) it.hover = it.p === hov ? .16 + .08 * Math.sin(performance.now() / 110) : 0;
  world.update(yaw);
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
  applyMood(PX, PY, t);
  G.render();
  // HD overlay
  const dpr = devicePixelRatio || 1, sc = scale * dpr;
  hq.setTransform(1, 0, 0, 1, 0, 0); hq.clearRect(0, 0, hdc.width, hdc.height);
  for (const f of features) if (f.on !== false && f.hd) { hq.save(); f.hd(hq, sc); hq.restore(); }
  drawPrompt(sc);
}
function drawPrompt(sc) {   // "E climb" / "E open" over the thing you can interact with
  let at = null, txt = '';
  const p = nearProp(); if (p && !BUSY.has(P.state)) { at = [p.x, p.y, (p.z || 0) + 1.1]; txt = 'E  open'; }
  else if (!BUSY.has(P.state) && climbSpotW()) { at = [player.x, player.y, P.z + 2]; txt = P.z > .1 ? 'E  climb down' : 'E  climb'; }
  if (!at) return;
  const [sx, sy] = G.toScreen(at[0], at[2], at[1]);
  hq.font = `${Math.round(11 * (devicePixelRatio || 1))}px ui-monospace, Consolas, monospace`; hq.textAlign = 'center';
  const w = hq.measureText(txt).width + 12 * (devicePixelRatio || 1);
  hq.fillStyle = 'rgba(14,16,15,.8)'; hq.fillRect(sx * sc - w / 2, sy * sc - 16 * (devicePixelRatio || 1), w, 18 * (devicePixelRatio || 1));
  hq.fillStyle = '#f0c060'; hq.fillText(txt, sx * sc, sy * sc - 3 * (devicePixelRatio || 1));
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
  step(dt); draw(now / 1000);
  fps = fps * .95 + (dt > 0 ? 1 / dt : 60) * .05;
  if (now - hudT > 250) { hudT = now; hud(); }
  requestAnimationFrame(frame);
}
function hud() {
  const b = BIOMES[biomeI], deg = ((yaw / DEG) % 360 + 360) % 360, s = G.stats;
  const fh = features.map(f => f.hud?.()).filter(Boolean).join(' · ');
  $('#hud').innerHTML = [
    `<div class="row"><b>Proving Grounds 3D</b> · ${b.name} · ${TIMES[timeI]}${opt.lantern ? ' · lantern' : ''} · ${LOADOUTS[loadI][0]}</div>`,
    fh ? `<div class="row">${fh}</div>` : '',
    `<div class="row">camera <b>${deg.toFixed(1)}°</b> (${SNAP_NAME[snapMode]}) · zoom ${zoom}x${opt.debug ? ` · view <b>${DEBUG[opt.debug]}</b>` : ''}</div>`,
    `<div class="row dim">features: ${features.map(f => `${f.name}${f.on === false ? ' (off)' : ''}`).join(', ') || 'none yet'}</div>`,
    `<div class="row dim">${fps.toFixed(0)} fps · ${s.ms.toFixed(1)} ms CPU · ${s.calls} draws · ${s.sprites} sprites · ${s.points} pts · hits ${hits}/${PL.shots}</div>`,
  ].join('');
}
$('#load').classList.add('hidden');
console.log(`render3d ready in ${((performance.now() - t00) / 1000).toFixed(1)} s (${set.packed ? 'packed atlas' : 'per-file atlas'})`, JSON.stringify(TIMING));

// debug handle for scripted tests (drive frames while the pane is hidden: rAF pauses there)
window.__r3d = {G, THREE, P, PL, host, player, keys, mouse, cam, opt, arrows, features, toView, toWorld, setYaw, setBiome, switchLoadout, TIMING,
  get world() { return world; }, get yaw() { return yaw; }, set zoom(v) { zoom = v; }, set time(i) { timeI = i; }, set snap(i) { snapMode = i; },
  set props(m) { propMode = m; world.setMode(m); }, get rig() { return rig; },
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { lastDt = dt; step(dt); draw(performance.now() / 1000); } },
  applyOpts, hud};
requestAnimationFrame(frame);
