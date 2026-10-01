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
//   F.resize?(VW, VH)           the view changed size (art px: the window's shape decides, e.g. ultrawide); re-make
//                               anything view-sized. host.VW / VH (and ctxO's) are always the current size
//   F.arrow?(a)                 every arrow as it is spawned (scale its damage, tag it, spawn extras with a.extra)
//   F.prompt?(prop) -> text | {text, color}   the "E ..." prompt over a prop you can interact with
//   F.menu?() -> [{label, run}] rows in the menu's Game tab (ui/menu.js)
// THE MENU (Escape, ui/menu.js): pauses the game but not the world: while host.paused only the AMBIENT features update
// (nature, see stepPaused), behind a blur. A feature's toggle / settings land in its Dev tab unless CLAIM (below) gives
// them to a player tab (Graphics, Audio).
// THE GAME (game/game.js) is the first feature: the run, enemies, items, HUD, title. It drives host.dev (the sandbox's
// dev keys + debug HUD), host.lock (no player input: menus, death, travel), host.timeScale (slow motion / frozen),
// host.setBiome / setTime / teleport / setYaw.
// HOST (see `host` below): player, arrows, spawnArrow, events, props, itemOf, elev, inStream, blocked, layout,
//   hitstop, shake, knock, play, aim, mouse, keys, toView(x, y, h) -> view px, sprite, point, line, layer(name),
//   world, biome, time, mood, wind (the wind feature, if any), feature(name), PPM / PPMY / PPMH, G, THREE,
//   paused (the menu is open), openMenu(), uiSound(name) (the menu's sounds: hover, click, confirm, back, open).
import * as THREE from 'three';
import {createGfx, DEG} from './render/gfx.js';
import {buildWorld, texOf, WORLD, PLAY, TRAIL, elev, inStream, PLATEAUS, PROP_TOP} from './world/world.js';
import {BIOMES} from './world/biomes.js';
import {MOODS, TIMES, CHAR} from './content/moods.js';   // the lighting tables (forked from the arena's lighting.js)
import {createHero, loadLoadout} from './view/hero.js';   // the Ranger's card: loadouts, the composite, cloak, hair, armour, HD bow
import {createPlayer, BUSY} from './sim/player/player.js';
import {createGame} from './game/game.js';
import {createPerf} from './core/perf.js';   // the frame profiler: per-system ms against the budget (F3, ?perf=1)
import {createEnv, SEASONS, WEATHER} from './sim/env.js';   // the world clock: time of day, seasons, weather
import {createMenu} from './ui/menu.js';   // the pause / settings menu (Escape)
import {createLighting} from './render/lighting.js';
import {createProjectiles} from './sim/projectiles.js';
import {flags} from './core/flags.js';
import {lum, rgbOf} from './core/color.js';
import {toView as viewOf, toWorld as worldOf} from './render/viewxf.js';

const $ = s => document.querySelector(s);
const Q = flags;   // the URL switches (core/flags.js)
let VW = 480, VH = 270;   // the view in art px: the window decides (fit, below)
const t00 = performance.now();
const FEATURES = ['wind', 'windlines', 'weather', 'lights', 'garden', 'combat', 'atmos', 'flow', 'wildlife', 'depth', 'contact', 'audio'];   // update order (wind first: others read it; lights before combat: it sees arrow hits first; garden before combat: its colliders are known)

// ---------------------------------------------------------------- the Ranger: loadouts (packed atlases)
// the loadout (view/hero.js LOADOUTS). Default: the runtime cloth (cloak + scarf tail answer the wind; ?set=basic = the baked cloak)
const loadI = {basic: 0, body: 2, sim: 1}[Q.get('set')] ?? 1;
$('#load').textContent = 'Loading the Ranger…';
const TIMING = {}, mark = (k, t0) => { TIMING[k] = +((performance.now() - t0) / 1000).toFixed(2); };
let tp = performance.now();
const set = await loadLoadout(loadI);
mark('atlas', tp);
const PPM = set.idx.fwd_px.E[0], PPMH = PPM * Math.cos(set.idx.pitch * DEG), PPMY = PPM * Math.sin(55 * DEG);
// THE VIEW follows the window and the zoom. `scale` is the DISPLAY SCALE (screen px per art px, whole: the art stays crisp)
// and the view is as many art px as fill the window at it, so a wide or ultrawide screen sees more of the world to the
// sides instead of black bars. The window's own scale (base: the biggest that still fits 480 x 270, the design) is the
// default zoom; the wheel moves `scale` (zoom levels, below). Capped at the world's size (bars past that). A change
// resizes the renderer (G.resize) and tells the features (F.resize?(VW, VH)); host.VW / VH and ctxO.VW / VH are current
const VIEW = {w: 480, h: 270, maxW: Math.min(1920, Math.floor(WORLD.WM * PPM / 2) * 2), maxH: Math.min(1080, Math.floor(WORLD.HM * PPMY / 2) * 2)};
const even = v => Math.floor(v / 2) * 2;
const baseScale = () => Math.max(1, Math.floor(Math.min(innerWidth / VIEW.w, innerHeight / VIEW.h)));
const viewAt = s => [Math.min(VIEW.maxW, even(innerWidth / s)), Math.min(VIEW.maxH, even(innerHeight / s))];
// zoom levels: out to half the base scale (twice the world on screen), in to twice it. ?zoom=2 starts zoomed in
const scaleRange = b => [Math.max(1, Math.ceil(b / 2)), b * 2];
let dsBase = baseScale(), dsGoal = Q.get('zoom') === '2' ? dsBase * 2 : dsBase, scale = dsGoal;   // the window's scale, the wheel's goal, the view's scale now
[VW, VH] = viewAt(scale);
const ctxO = {PPM, PPMY, PPMH, toS: (x, y, h = 0) => [x * PPM, y * PPMY - h * PPMH], VW, VH};

const canvas = $('#screen');
const G = createGfx(canvas, {VW, VH, PPM, PPMY, PPMH});
// the HD overlay: display resolution, over the pixel canvas (damage numbers, bars, prompts)
const hdc = document.createElement('canvas'); hdc.id = 'hd'; hdc.style.cssText = 'position:absolute;pointer-events:none;image-rendering:auto';
$('#wrap').appendChild(hdc); const hq = hdc.getContext('2d');
function fit() {   // the window changed, or a zoom arrived (stepZoom): the view at `scale`
  const b = baseScale();
  if (b !== dsBase) { const [lo, hi] = scaleRange(b); dsGoal = Math.max(lo, Math.min(hi, Math.round(dsGoal * b / dsBase))); dsBase = b; scale = dsGoal; zoom = 1; }   // (the same zoom, relative)
  const [w, h] = viewAt(scale);
  if (w !== VW || h !== VH) { VW = ctxO.VW = w; VH = ctxO.VH = h; G.resize(w, h); for (const f of features) f.resize?.(w, h); }
  canvas.style.width = VW * scale + 'px'; canvas.style.height = VH * scale + 'px';
  G.setDisplay?.(scale);   // the canvas at display size: the pixel image is blown up on the GPU, HD effects draw over it
  const dpr = devicePixelRatio || 1; hdc.width = VW * scale * dpr; hdc.height = VH * scale * dpr; hdc.style.width = canvas.style.width; hdc.style.height = canvas.style.height;
  const r = canvas.getBoundingClientRect(); hdc.style.left = r.left + 'px'; hdc.style.top = r.top + 'px';
}
fit(); addEventListener('resize', fit);

let biomeI = Math.max(0, BIOMES.findIndex(b => b.id === Q.get('biome')));
// THE WORLD CLOCK (sim/env.js): time of day, seasons, weather, running in the background. It owns "what time is it":
// host.time is its day / dusk / night bucket (dawn counts as dusk), host.mood its blended mood, host.setTime jumps it
const env = createEnv({moods: MOODS, biome: () => BIOMES[biomeI].id, Q});
let world = null, propMode = Q.get('props') === 'yaw' ? 'yaw' : 'live';
let trees3d = Q.get('trees3d') !== '0';   // procedural 3D trees (trees3d.js) or the painted cards (Shift+R rebuilds)
const features = [], events = [];
// APP: the engine's own context for the modules split out of this file (view/hero.js, ...): live getters, so a module
// reads the current yaw / zoom / player without this file passing them every call. (Features get `host`, below.)
const app = {
  get P() { return P; }, get PL() { return PL; }, get player() { return player; }, get yaw() { return yaw; }, get zoom() { return zoom; },
  get VW() { return VW; }, get VH() { return VH; }, get opt() { return opt; }, get cam() { return cam; }, get arrows() { return arrows; },
  feat: name => feat(name), toView: (x, y, a) => toView(x, y, a),
};
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
// zoom: the projection's extra scale ON TOP of `scale` (the display scale). 1 at rest; between zoom levels it carries the
// easing (stepZoom). host.zoom is this (view px per art px), so features size their pixels right while it eases
let yaw = (+Q.get('yaw') || 0) * DEG, zoom = 1, snapMode = +(Q.get('snap') ?? 0) || 0;
const SNAP = [0, 22.5 * DEG, 90 * DEG], SNAP_NAME = ['free', '22.5° steps', '90° steps'];
const toView = (X, Z, a = yaw) => viewOf(X, Z, a), toWorld = (vx, vy, a = yaw) => worldOf(vx, vy, a);   // (render/viewxf.js at this camera's yaw)

// ---------------------------------------------------------------- the player
const keys = new Set(), mouse = {x: VW / 2, y: VH / 2, down: false}, cam = {x: 0, y: 0, fx: 0, fy: 0};
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
// arrows, hit pops, footstep dust (sim/projectiles.js)
const proj = createProjectiles({world: () => world, features, events, opt: () => opt, toWorld, PPM, PPMH});
const {arrows, dust} = proj, spawnArrow = proj.spawn;
const feat = name => features.find(f => f.name === name) || null;
const hero = createHero({G, set, loadI, ctxO, app});
const PL = createPlayer({
  ctx: ctxO, atlas: hero.atlas, keys, mouse, cam, events, plateaus: plateausV,
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
  get faceAngle() { return P.face * 2 * Math.PI / hero.ND + yaw; },                          // world: 0 = south, +pi/2 = east
  get face() { const ND = hero.ND; return (((Math.round(P.face + yaw / (2 * Math.PI / ND))) % ND) + ND) % ND; },   // world facing index (arena's dirOf)
  get viewFace() { return P.face; }, get state() { return P.state; }, get t() { return P.t; }, get frame() { return P.frame; },
  get gait() { return P.gait; }, get sink() { return P.sink || 0; }, get aiming() { return P.state === 'draw'; }, get blink() { return P.blink || 0; },
  get raw() { return P; },
};

// the camera turned by d: everything the player keeps in view-frame coordinates turns with it
let faceAcc = 0;
function turnFrame(d) {
  const ND = hero.ND, c = Math.cos(d), s = Math.sin(d), rot = (x, y) => [x * c - y * s, x * s + y * c];
  [P.x, P.y] = rot(P.x, P.y); [P.vx, P.vy] = rot(P.vx, P.vy);
  if (P.rollDir) P.rollDir = rot(...P.rollDir);
  if (P.back) P.back = rot(...P.back);
  if (P.leap) { [P.leap.x0, P.leap.y0] = rot(P.leap.x0, P.leap.y0); [P.leap.dx, P.leap.dy] = rot(P.leap.dx, P.leap.dy); }
  faceAcc -= d / (2 * Math.PI / ND);
  const n = Math.round(faceAcc);
  if (n) { P.face = (((P.face + n) % ND) + ND) % ND; P.want = (((P.want + n) % ND) + ND) % ND; faceAcc -= n; }
}
function setYaw(a) { if (a !== yaw) { turnFrame(a - yaw); yaw = a; } if (yaw > Math.PI) yaw -= 2 * Math.PI; else if (yaw <= -Math.PI) yaw += 2 * Math.PI; }

// ---------------------------------------------------------------- feel: shake, hitstop, knock
let freeze = 0; const shakeS = {a: 0, t: 0};
function shake(a, sec) { if (opt.shake && a >= shakeS.a * (shakeS.t > 0 ? 1 : 0)) { shakeS.a = a; shakeS.t = sec; } }   // (menu > Graphics > Screen shake)

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


// ---------------------------------------------------------------- the host features see
const host = {
  THREE, G, PPM, PPMY, PPMH, get VW() { return VW; }, get VH() { return VH; }, ctxO,
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
  get hits() { return proj.hits; },
  // the menu (ui/menu.js): open it (the title's Settings), its wooden UI sounds (the audio feature), open or not
  get paused() { return paused; }, openMenu: () => togglePause(true), uiSound: n => feat('audio')?.ui?.(n),
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
  playerSprite: () => hero.sprite(),
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
  hdBow: Q.get('bow') === 'hd',   // J: the HD bow overlay instead of the pixel bow (the arena's toggle)
  shake: true};                   // screen shake (menu > Graphics)
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
const lighting = createLighting({G, host, features, opt});   // render/lighting.js: the mood + lights -> the composite

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
  if (k === 'escape') { if (!e.repeat) togglePause(); return; }
  if (k === 'f3') { e.preventDefault(); if (!e.repeat) { perf.toggle(); menu.refresh(); } return; }   // the frame profiler
  if (paused) { menu.key(k, e); return; }   // the menu has the keys: arrows, Tab, Enter
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
  if (e.repeat) return;
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
  if (k === 'o') hero.switchLoadout(hero.loadI + 1);
  if (k === 'v') opt.banded = !opt.banded;
  if (k === 'j') opt.hdBow = !opt.hdBow;
  if (k === 'i') hero.toggleArmour();
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
canvas.addEventListener('wheel', e => { e.preventDefault(); onWheel(e); }, {passive: false});

// ---------------------------------------------------------------- zoom (the wheel)
// LEVELS are whole display scales, so every zoom at rest is pixel-perfect (scaleRange: out to twice the world on screen,
// in to twice the size). A wheel notch moves the goal one level; the view EASES there (in log space, so in and out feel
// alike, ZOOM.ease per second) drawn at its current size with `zoom` as the in-between factor, and when it arrives it's
// re-made at the new scale (fit): crisp again. Trackpads' small deltas add up to notches (ZOOM.notch). The camera
// centres the Ranger's chest (FOCUS_H), so he stays put on screen while the world scales around him
const ZOOM = {ease: 11, notch: 100, done: .004}, FOCUS_H = .9;
let wheelAcc = 0, wheelT = 0;
function zoomTo(goal) { const [lo, hi] = scaleRange(dsBase); dsGoal = Math.max(lo, Math.min(hi, goal)); }
function onWheel(e) {
  const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY, now = performance.now();
  if (now - wheelT > 400 || Math.sign(d) !== Math.sign(wheelAcc)) wheelAcc = 0;   // a new gesture, or turned around
  wheelT = now; wheelAcc += d;
  while (Math.abs(wheelAcc) >= ZOOM.notch) { zoomTo(dsGoal - Math.sign(wheelAcc)); wheelAcc -= Math.sign(wheelAcc) * ZOOM.notch; }   // up = in
}
function stepZoom(dt) {   // every rendered frame (the menu's backdrop zooms too)
  const eff = scale * zoom; if (eff === dsGoal) return;
  const le = Math.log(eff), lg = Math.log(dsGoal), l = Math.abs(lg - le) < ZOOM.done ? lg : le + (lg - le) * (1 - Math.exp(-dt * ZOOM.ease));
  if (l === lg) { scale = dsGoal; zoom = 1; fit(); } else zoom = Math.exp(l) / scale;   // arrived: the view re-made at the goal scale
}

// ---------------------------------------------------------------- the menu (Escape): ui/menu.js draws it, these are its items
// PAUSED, the game stands still (player, arrows, enemies, the run, the clock) but the world doesn't: the AMBIENT features
// are presentation only and keep running in real time behind the blurred menu, so the wind blows, birds fly, rain falls
// and fires flicker (lights.js skips its burn-through while host.paused). The cloak still answers the wind. The camera
// drifts slowly (drag the backdrop to look around) and eases back to where it was on resume. The audio feature ducks
// music + effects; the ambience plays on. (flow is left out: its streaks / tracks follow the player's frozen speed)
const AMBIENT = new Set(['wind', 'windlines', 'weather', 'lights', 'garden', 'atmos', 'wildlife', 'depth', 'contact', 'audio']);
const NO_EVS = [], PAUSE_TURN = .035, LOOK_HOLD = 3000;   // drift rad/s (the title turns at .07); ms after a drag before it drifts again
let pauseYaw = 0, pauseGoal = 1, lookT = 0;
function stepPaused(dt) {
  hero.stepCloth(dt, clothPos);
  const evs = events.length ? events.splice(0) : NO_EVS;   // wildlife's calls, fire crackles: for the audio feature
  for (const f of features) if (AMBIENT.has(f.name) && f.on !== false) f.update?.(dt, evs);
}
const pauseTurn = dt => game.mode === 'title' || performance.now() - lookT < LOOK_HOLD ? 0 : PAUSE_TURN * dt;   // (the title turns itself)
function togglePause(force, snd) {
  const was = paused; paused = force ?? !paused; if (paused === was) return;
  feat('audio')?.duck?.(paused);
  if (paused) { keys.clear(); dragging = false; pauseYaw = yaw; pauseGoal = dsGoal; lookT = 0; menu.show(); return; }
  menu.hide(snd); zoomTo(pauseGoal);   // back to the zoom you played at (it eases)
  const d = Math.atan2(Math.sin(yaw - pauseYaw), Math.cos(yaw - pauseYaw));
  if (game.mode !== 'title' && !assist && Math.abs(d) > .002) assist = {back: pauseYaw, phase: 'back'};   // back to where you were looking
}

const onOff = (get, set) => ({options: ['on', 'off'], get: () => get() ? 'on' : 'off', set: v => set(v === 'on')});
const pick = (options, get, set) => ({options, get, set});
const cyc = (o, cur, d, set) => set(o[((o.indexOf(cur) + d) % o.length + o.length) % o.length]);
// features' toggles / settings a player sees, by feature and setting label ('' = its on / off); the rest go to Dev.
// id + keep: remembered on this machine (keep: the URL parameter that overrides it)
const gfx = (group, label, id, keep = true) => ({tab: 'graphics', group, label, id, keep});
const vol = label => ({tab: 'audio', group: 'Volume', label});
const CLAIM = {
  depth: {'': gfx('World', 'Clouds, light shafts & reflections', 'depth', 'depth'), 'Foreground silhouettes': gfx('World', 'Foreground foliage', 'fg')},
  weather: {'Weather fx': gfx('World', 'Rain, snow & lightning', 'rain')},
  lights: {'Heat ripple': gfx('Effects', 'Heat shimmer', 'heat')},
  atmos: {'Vignette + haze': gfx('Effects', 'Vignette', 'vignette', 'hd')},
  audio: {'': {tab: 'audio', group: 'Sound', label: 'Sound', key: 'M'}, Volume: vol('Master'), Music: vol('Music'), Effects: vol('Effects'), Ambience: vol('Ambience'),
    'Music mode': {tab: 'dev', group: 'Tools', label: 'Music mode'}},
};
const KEYS = [[['W', 'A', 'S', 'D'], 'move (camera-relative)'], [['Shift'], 'sprint'], [['Q'], 'walk'], [['C'], 'crouch'], [['Space'], 'roll · leap'],
  [['LMB'], 'hold to draw, release to shoot'], [['RMB'], 'multishot'], [['1', '2', '3', '4'], 'abilities'], [['E'], 'open · talk · climb'],
  [['Z', 'X'], 'turn the camera (or drag with the middle button)'], [['Home'], 'reset the camera'], [['Wheel'], 'zoom in / out'],
  [['M'], 'mute'], [['U'], 'music on / off'], [['Esc'], 'this menu']];
function menuItems() {
  const out = [], dv = (group, it) => out.push({tab: 'dev', group, ...it}), A = feat('audio')?.AU;
  // Game: resume, then the game's own rows (start / abandon a run, back to title)
  if (game.mode !== 'title') out.push({tab: 'game', label: 'Resume', main: true, sound: 'back', run() {}});
  for (const m of features.flatMap(f => f.menu?.() || [])) out.push({tab: 'game', label: m.label, run: m.run});
  // Graphics, Controls: the host's own
  // (fullscreen keeps Escape for the menu: keyboard lock, where the browser has it; holding Esc still leaves fullscreen)
  out.push({tab: 'graphics', group: 'Display', label: 'Fullscreen', ...onOff(() => !!document.fullscreenElement, v => {
    try { (v ? document.documentElement.requestFullscreen?.().then(() => navigator.keyboard?.lock?.(['Escape'])) : document.fullscreenElement && document.exitFullscreen())?.catch?.(() => {}); } catch (e) {} })});
  out.push({tab: 'graphics', group: 'World', label: 'Shadows', id: 'shadows', keep: true, ...onOff(() => opt.shadows, v => { opt.shadows = v; })});
  out.push({tab: 'controls', group: 'Camera', label: 'Camera turning', id: 'snap', keep: 'snap', ...pick(SNAP_NAME, () => SNAP_NAME[snapMode], v => { snapMode = SNAP_NAME.indexOf(v); })},
    {tab: 'controls', group: 'Keys', keys: KEYS});
  // Dev: the character, the world's dials, the renderer's A/B (each with its dev key)
  dv('Character', {label: 'Loadout', key: 'O', value: () => hero.loadName, run: d => hero.switchLoadout(hero.loadI + d)});
  dv('Character', {label: 'Bow', key: 'J', ...pick(['pixel art', 'HD overlay'], () => opt.hdBow ? 'HD overlay' : 'pixel art', v => { opt.hdBow = v === 'HD overlay'; })});
  dv('Character', {label: 'Shiny armour', key: 'I', ...onOff(() => hero.armor.on, v => { if (hero.armor.on !== v) hero.toggleArmour(); })});
  dv('Character', {label: 'Lantern', key: 'L', ...onOff(() => opt.lantern, v => { opt.lantern = v; })});
  dv('World', {label: 'Biome', key: 'N', value: () => BIOMES[biomeI].name, run: d => setBiome(biomeI + d)});
  dv('World', {label: 'Time', key: 'T', value: () => `${env.clock()} ${env.part}`, run: () => env.nextPart()});
  dv('World', {label: 'Season', value: () => env.seasonLock || `auto (${env.season})`, run: d => cyc(['auto', ...SEASONS], env.seasonLock || 'auto', d, env.setSeason)});
  dv('World', {label: 'Weather', value: () => env.weatherLock || `auto (${env.weather})`,
    run: d => cyc(['auto', ...Object.keys(WEATHER).filter(w => !WEATHER[w].precip || env.TUNE.precip)], env.weatherLock || 'auto', d, env.setWeather)});
  dv('World', {label: 'Day length', value: () => env.frozen ? 'stopped' : `${env.TUNE.dayMinutes} min`, run: d => cyc([20, 5, 60, 0], env.frozen ? 0 : env.TUNE.dayMinutes, d, env.setDayMinutes)});
  dv('Renderer', {label: 'Ground texture', key: 'Shift+2', ...pick(SAMPLING, () => opt.sampling, v => { opt.sampling = v; })});
  dv('Renderer', {label: 'Prop outlines', key: 'Shift+3', ...onOff(() => opt.outline, v => { opt.outline = v; })});
  dv('Renderer', {label: 'Props', key: 'R', ...pick(['live 3D', '16-angle sprites'], () => propMode === 'live' ? 'live 3D' : '16-angle sprites', v => { propMode = v === 'live 3D' ? 'live' : 'yaw'; world.setMode(propMode); })});
  dv('Renderer', {label: 'Trees', key: 'Shift+R', ...pick(['3D (grown)', 'painted cards'], () => trees3d ? '3D (grown)' : 'painted cards', v => { trees3d = v === '3D (grown)'; setBiome(biomeI); })});
  dv('Renderer', {label: 'Banded light', key: 'V', ...onOff(() => opt.banded, v => { opt.banded = v; })});
  dv('Renderer', {label: 'Debug view', key: 'G', ...pick(DEBUG, () => DEBUG[opt.debug], v => { opt.debug = DEBUG.indexOf(v); })});
  dv('Renderer', {label: 'Colliders', key: 'Shift+G', ...onOff(() => opt.zones, v => { opt.zones = v; })});
  // the features' toggles and settings: Dev > Features, unless CLAIMed for a player tab
  for (const f of features) {
    if (!f.toggle && !f.settings) continue;
    const claim = CLAIM[f.name] || {}, put = (k, it) => out.push(claim[k] ? {...it, key: undefined, ...claim[k]} : {...it, tab: 'dev', group: 'Features'});
    if (f.toggle) put('', {label: f.label || f.name, key: f.key?.toUpperCase(), ...onOff(() => f.on !== false, v => { if ((f.on !== false) !== v) f.toggle(); })});
    for (const s of f.settings?.() || []) put(s.label, s.options ? {label: s.label, ...pick(s.options, s.get, s.set)} : {label: s.label, min: s.min ?? 0, max: s.max ?? 1, step: s.step ?? .01, get: s.get, set: s.set});
  }
  if (A) out.push({tab: 'audio', group: 'Sound', label: 'Music', key: 'U', ...onOff(() => A.musicOn, v => { if (A.musicOn !== v) A.toggleMusic(); })});
  out.push({tab: 'graphics', group: 'Effects', label: 'Screen shake', id: 'shake', keep: true, ...onOff(() => opt.shake, v => { opt.shake = v; })});
  dv('Tools', {label: 'Frame profiler', key: 'F3', ...onOff(() => perf.on, v => { if (perf.on !== v) perf.toggle(); })});
  dv('Tools', {label: 'Key help panel', key: 'H', ...onOff(() => opt.help, v => { opt.help = v; })});
  dv('Tools', {label: 'Dev mode', key: '`', ...onOff(() => host.dev, v => { host.dev = v; })});
  return out;
}
const menu = createMenu({
  root: $('#pause'), items: menuItems, dev: () => host.dev, sound: host.uiSound, changed: applyOpts,
  title: () => game.mode === 'title' ? ['Settings', ''] : ['Paused', game.mode === 'run' && game.run ? `Run · stage ${game.run.stage + 1}` : game.mode === 'sandbox' ? 'Proving Grounds' : ''],
  groups: {graphics: ['Display', 'World', 'Effects'], audio: ['Sound', 'Volume'], controls: ['Camera', 'Keys'], dev: ['Character', 'World', 'Renderer', 'Features', 'Tools']},
  resume: snd => togglePause(false, snd),
  look: dx => { dragYaw += dx * -.006; lookT = performance.now(); },
  zoom: e => onWheel(e),
});
menu.restore(Q);   // the player's remembered settings (Graphics, Controls)
addEventListener('fullscreenchange', () => menu.refresh());

// ---------------------------------------------------------------- frame
const ROT_SPEED = 110 * DEG;
let last = performance.now(), fps = 60, hudT = 0, lastDt = 1 / 60, leafVer = -1, leafWorld = null;
function step(dt) {
  hoverKey++;
  // camera rotation: keys / middle-drag, then (in a step mode) ease onto the nearest step once you let go.
  // A climb started at an angle eases the camera to north first, climbs, then returns.
  const rot = (keys.has('x') ? 1 : 0) - (keys.has('z') ? 1 : 0);
  // paused: the menu's slow drift + dragging its backdrop
  let ny = yaw + (paused ? pauseTurn(dt) + dragYaw : rot * ROT_SPEED * dt + dragYaw); dragYaw = 0;
  if (!paused && assist) ny = stepAssist(dt, ny);
  else if (!paused && !rot && !dragging && snapMode) { const s = SNAP[snapMode], tg = Math.round(ny / s) * s, d = tg - ny; ny = Math.abs(d) < .0015 ? tg : ny + d * (1 - Math.exp(-dt * 14)); }
  const y0 = yaw; setYaw(ny); syncPlateaus();
  stepSampling(dt, yaw !== y0);
  if (paused) { stepPaused(dt); return; }   // the game stands still, nature goes on
  dt *= host.timeScale; if (dt <= 0) return;   // the game's slow motion / frozen world (the camera above stays live)
  perf.begin('env', 'sim'); env.step(dt); perf.end('env');   // the world clock first: everything after reads this step's time / weather
  if (freeze > 0) { freeze -= dt; for (const f of features) if (f.always) f.update?.(dt, []); return; }
  const n0 = events.length, px0 = P.x, py0 = P.y;
  perf.begin('player.step', 'sim'); PL.step(dt); perf.end('player.step');
  for (let i = n0; i < events.length; i++) toWorldEvent(events[i]);   // the player's events are in the view frame
  clothPos[0] += P.x - px0; clothPos[1] += P.y - py0;               // its motion in the view frame, without the camera's turns
  perf.begin('arrows', 'sim'); proj.step(dt); perf.end('arrows');
  hero.stepCloth(dt, clothPos, perf);
  const evs = events.splice(0);
  for (const f of features) if (f.on !== false || f.always) f.update?.(dt, evs);
  if (shakeS.t > 0) shakeS.t -= dt;
}
const clothPos = [0, 0];
function toWorldEvent(e) {
  if (e.x !== undefined && e.y !== undefined) [e.x, e.y] = toWorld(e.x, e.y);
  if (e.vx !== undefined && e.vy !== undefined) [e.vx, e.vy] = toWorld(e.vx, e.vy);
}
function draw(t) {
  hoverKey++;
  stepZoom(lastDt);
  const [PX, PY] = [player.x, player.y];
  // camera: eases after the player with a little look-ahead (the arena's), feel offsets from features, shake. It aims at
  // his chest (FOCUS_H m up, as the ground point that projects there), so he's in the same spot on screen at every zoom
  if (!camInit) { T.set(PX, P.z, PY); camInit = true; }
  const [lvx, lvy] = toWorld(P.vx * .12, P.vy * .12 - FOCUS_H * PPMH / PPMY);
  const k = 1 - Math.exp(-lastDt * 9); T.x += (PX + lvx - T.x) * k; T.y += (P.z - T.y) * k; T.z += (PY + lvy - T.z) * k;
  let ox = 0, oy = 0;
  for (const f of features) if (f.on !== false && f.camera) { const o = f.camera(lastDt); if (o) { ox += o.x || 0; oy += o.y || 0; } }
  const sk = shakeS.t > 0 ? shakeS.a * Math.min(1, shakeS.t * 8) : 0;
  ox += Math.round((Math.random() * 2 - 1) * sk); oy += Math.round((Math.random() * 2 - 1) * sk);
  snapTarget(ox, oy); G.setView(Ts, yaw, zoom);
  const [tvx, tvy] = toView(Ts.x, Ts.z);
  cam.x = cam.fx = tvx * PPM - VW / 2; cam.y = cam.fy = tvy * PPMY - Ts.y * PPMH - VH / 2;
  // the Ranger: sprite (+ runtime cloak) + pixel bow, albedo and normals, sinking when he falls in (view/hero.js)
  const sinkPx = hero.compose(PX, PY, perf);
  // props, hover pulse on the aimed target
  const hov = P.state === 'draw' ? hoverTarget()?.target : null;
  for (const it of world.items) it.hover = it.p === hov ? .16 + .08 * Math.sin(performance.now() / 110) : 0;
  perf.begin('world.update', 'view'); world.update(yaw); perf.end('world.update');
  // the season's leaves (env.leafRamp: changes a few times per season; a rebuilt world starts from the biome's own ramp)
  const lr = env.leafRamp(); if (lr && (env.ver.leaf !== leafVer || world !== leafWorld)) { world.setFamily?.('leaf', lr); leafVer = env.ver.leaf; leafWorld = world; }
  proj.draw(host);
  for (const f of features) if (f.on !== false) f.frame?.({dt: lastDt, t});
  // the aim reticle (pixel cross at the cursor, front layer)
  if (P.state === 'draw') {
    const q = G.layer('front'), mx = Math.round(VW / 2 + (mouse.x - VW / 2) * zoom), my = Math.round(VH / 2 + (mouse.y - VH / 2) * zoom);
    q.fillStyle = P.t > .5 ? '#f2d27a' : '#e9e4da';
    q.fillRect(mx - 3, my, 2, 1); q.fillRect(mx + 2, my, 2, 1); q.fillRect(mx, my - 3, 1, 2); q.fillRect(mx, my + 2, 1, 2);
  }
  if (opt.zones) drawZones();
  perf.begin('mood+lights', 'view'); lighting.apply(PX, PY, t); perf.end('mood+lights');
  perf.begin('G.render', 'render'); G.render(); perf.end('G.render');
  // HD overlay
  const dpr = devicePixelRatio || 1, sc = scale * dpr;
  hq.setTransform(1, 0, 0, 1, 0, 0); hq.clearRect(0, 0, hdc.width, hdc.height);
  for (const f of features) if (f.on !== false && f.hd && (!host.hudOff || f === game)) { hq.save(); f.hd(hq, sc); hq.restore(); }   // hudOff: the title
  if (opt.hdBow && !sinkPx) hero.drawHDBow(hq, sc);
  drawPrompt(sc);
  perf.draw(hq, sc);
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
    `<div class="row"><b>Proving Grounds 3D</b> · ${b.name} · ${env.label()}${opt.lantern ? ' · lantern' : ''} · ${hero.loadName}</div>`,
    fh ? `<div class="row">${fh}</div>` : '',
    `<div class="row">camera <b>${deg.toFixed(1)}°</b> (${SNAP_NAME[snapMode]}) · zoom ${(scale * zoom / dsBase).toFixed(2)}x (${scale}:1)${opt.debug ? ` · view <b>${DEBUG[opt.debug]}</b>` : ''}</div>`,
    `<div class="row dim">features: ${features.map(f => `${f.name}${f.on === false ? ' (off)' : ''}`).join(', ') || 'none yet'}</div>`,
    `<div class="row dim">${fps.toFixed(0)} fps · ${s.ms.toFixed(1)} ms CPU · ${s.calls} draws · ${s.sprites} sprites · ${s.points} pts · hits ${proj.hits}/${PL.shots}</div>`,
  ].join('');
}
$('#load').classList.add('hidden');
console.log(`render3d ready in ${((performance.now() - t00) / 1000).toFixed(1)} s (${set.packed ? 'packed atlas' : 'per-file atlas'})`, JSON.stringify(TIMING));

// debug handle for scripted tests (drive frames while the pane is hidden: rAF pauses there)
window.__r3d = {G, THREE, P, PL, host, player, keys, mouse, cam, opt, arrows, features, game, toView, toWorld, setYaw, setBiome, switchLoadout: i => hero.switchLoadout(i), TIMING, perf,
  get world() { return world; }, get yaw() { return yaw; }, set zoom(v) { zoomTo(Math.round(dsBase * v)); }, get zoomState() { return {scale, zoom, dsBase, dsGoal}; }, set time(i) { env.setPart(TIMES[i]); }, env, set snap(i) { snapMode = i; },
  set props(m) { propMode = m; world.setMode(m); }, get rig() { return hero.rig; },
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { lastDt = dt; step(dt); draw(performance.now() / 1000); } },
  applyOpts, hud};
requestAnimationFrame(frame);
