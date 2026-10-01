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
import {BUSY} from './sim/player/player.js';
import {createPlayerHost} from './sim/player/adapter.js';
import {createGame} from './game/game.js';
import {createPerf} from './core/perf.js';   // the frame profiler: per-system ms against the budget (F3, ?perf=1)
import {createEnv, SEASONS, WEATHER} from './sim/env.js';   // the world clock: time of day, seasons, weather
import {createMenu} from './ui/menu.js';   // the pause / settings menu (Escape)
import {createLighting} from './render/lighting.js';
import {createProjectiles} from './sim/projectiles.js';
import {flags} from './core/flags.js';
import {lum, rgbOf} from './core/color.js';
import {createCamera, ROT_SPEED, SNAP_NAME} from './render/camera.js';

const $ = s => document.querySelector(s);
const Q = flags;   // the URL switches (core/flags.js)
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
const ctxO = {PPM, PPMY, PPMH, toS: (x, y, h = 0) => [x * PPM, y * PPMY - h * PPMH], VW: 0, VH: 0};
// THE CAMERA (render/camera.js): the view's size (window + zoom), the yaw, the target, shake, ground sampling. cv.VW / VH /
// scale / zoom / yaw are read live from it; a turn of the yaw turns the player's view-frame state with it (turnFrame)
const cv = createCamera({ctxO, PPM, PPMY, PPMH, WORLD, opt: () => opt, onTurn: d => pa.turnFrame(d), flags: Q});

const features = [], events = [];
const canvas = $('#screen');
const G = createGfx(canvas, {VW: cv.VW, VH: cv.VH, PPM, PPMY, PPMH});
// the HD overlay: display resolution, over the pixel canvas (damage numbers, bars, prompts)
const hdc = document.createElement('canvas'); hdc.id = 'hd'; hdc.style.cssText = 'position:absolute;pointer-events:none;image-rendering:auto';
$('#wrap').appendChild(hdc); const hq = hdc.getContext('2d');
cv.attach({G, canvas, hdc, features}); cv.fit(); addEventListener('resize', () => cv.fit());

let biomeI = Math.max(0, BIOMES.findIndex(b => b.id === Q.get('biome')));
// THE WORLD CLOCK (sim/env.js): time of day, seasons, weather, running in the background. It owns "what time is it":
// host.time is its day / dusk / night bucket (dawn counts as dusk), host.mood its blended mood, host.setTime jumps it
const env = createEnv({moods: MOODS, biome: () => BIOMES[biomeI].id, Q});
let world = null, propMode = Q.get('props') === 'yaw' ? 'yaw' : 'live';
let trees3d = Q.get('trees3d') !== '0';   // procedural 3D trees (trees3d.js) or the painted cards (Shift+R rebuilds)
// APP: the engine's own context for the modules split out of this file (view/hero.js, ...): live getters, so a module
// reads the current yaw / zoom / player without this file passing them every call. (Features get `host`, below.)
const app = {
  get P() { return P; }, get PL() { return PL; }, get player() { return player; }, get yaw() { return cv.yaw; }, get zoom() { return cv.zoom; },
  get VW() { return cv.VW; }, get VH() { return cv.VH; }, get opt() { return opt; }, get cam() { return cam; }, get arrows() { return arrows; },
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
const toView = cv.toView, toWorld = cv.toWorld;   // world <-> the camera's view frame at its yaw (render/viewxf.js)

// ---------------------------------------------------------------- the player
const keys = new Set(), mouse = {x: cv.VW / 2, y: cv.VH / 2, down: false}, cam = {x: 0, y: 0, fx: 0, fy: 0};
// arrows, hit pops, footstep dust (sim/projectiles.js)
const proj = createProjectiles({world: () => world, features, events, opt: () => opt, toWorld, PPM, PPMH});
const {arrows, dust} = proj, spawnArrow = proj.spawn;
const feat = name => features.find(f => f.name === name) || null;
const hero = createHero({G, set, loadI, ctxO, app});
// THE PLAYER (sim/player/adapter.js): player.js in the camera's frame, bridged to the world (collision, the world-frame
// `player`, turning with the camera, the cursor's target, interaction, climbing at any angle)
const pa = createPlayerHost({G, ctxO, PPM, PPMY, cv, hero, keys, mouse, cam, events, features, world: () => world, biome: () => BIOMES[biomeI],
  opt: () => opt, proj, flags: Q});
const {PL, P, player} = pa;

const setYaw = cv.setYaw;

// ---------------------------------------------------------------- feel: shake, hitstop, knock
let freeze = 0; const shake = cv.shake;   // (render/camera.js; menu > Graphics > Screen shake)



// ---------------------------------------------------------------- the host features see
const host = {
  THREE, G, PPM, PPMY, PPMH, get VW() { return cv.VW; }, get VH() { return cv.VH; }, ctxO,
  get world() { return world; }, get biome() { return BIOMES[biomeI]; }, get time() { return env.bucket; }, get mood() { return env.mood(BIOMES[biomeI].id); }, env,
  get yaw() { return cv.yaw; }, get zoom() { return cv.zoom; }, get props() { return world.props; }, get layout() { return world.layout; },
  player, P, PL, arrows, spawnArrow, events, keys, mouse, BUSY,
  itemOf: p => world.itemOf(p), elev, inStream, blocked: (x, y, z = P.z, air = false) => pa.blocked(x, y, z, air),
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
  teleport: (x, y) => pa.teleport(x, y),   // put the player at world (x, y), standing, and snap the camera there
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
function applyOpts() {
  if (opt.sampling !== 'auto') G.U.smooth.value = opt.sampling === 'smooth' ? 1 : 0;
  G.compU.uOutline.value = opt.outline ? 1 : 0; G.compU.uBanded.value = opt.banded ? 1 : 0;
  G.compU.uShadowOn.value = G.compU.uPtShadow.value = opt.shadows ? 1 : 0; G.compU.uDebug.value = opt.debug; $('#help').classList.toggle('hidden', !opt.help || !host.dev);
}
applyOpts();
const lighting = createLighting({G, host, features, opt});   // render/lighting.js: the mood + lights -> the composite


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
    if (d === 1) cv.snapMode = (cv.snapMode + 1) % 3;
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
  if (k === 'e') { if (!pa.nearProp() && pa.climbSpotW() && Math.abs(cv.yaw) > 1e-6 && !BUSY.has(P.state)) pa.assist = {back: cv.yaw, phase: 'in'}; else PL.onInteractKey(); }
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
  const r = canvas.getBoundingClientRect(), s = r.width / cv.VW, mx = (e.clientX - r.left) / s, my = (e.clientY - r.top) / s;
  mouse.x = cv.VW / 2 + (mx - cv.VW / 2) / cv.zoom; mouse.y = cv.VH / 2 + (my - cv.VH / 2) / cv.zoom;   // the player reads the screen at zoom 1
  if (dragging) { dragYaw += (e.clientX - dragX) * -.006; dragX = e.clientX; }
});
canvas.addEventListener('mousedown', e => {
  if (paused || host.lock) return;
  if (e.button === 0) { PL.press(); mouse.down = true; }
  if (e.button === 1) { e.preventDefault(); dragging = true; dragX = e.clientX; }
  if (e.button === 2 && !BUSY.has(P.state)) features.some(f => f.ability?.('rmb'));
});
addEventListener('mouseup', e => { if (e.button === 0) { if (!paused) PL.release(); mouse.down = false; } if (e.button === 1) dragging = false; });
canvas.addEventListener('wheel', e => { e.preventDefault(); cv.onWheel(e); }, {passive: false});


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
  if (paused) { keys.clear(); dragging = false; pauseYaw = cv.yaw; pauseGoal = cv.dsGoal; lookT = 0; menu.show(); return; }
  menu.hide(snd); cv.zoomTo(pauseGoal);   // back to the zoom you played at (it eases)
  const d = Math.atan2(Math.sin(cv.yaw - pauseYaw), Math.cos(cv.yaw - pauseYaw));
  if (game.mode !== 'title' && !pa.assist && Math.abs(d) > .002) pa.assist = {back: pauseYaw, phase: 'back'};   // back to where you were looking
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
  out.push({tab: 'controls', group: 'Camera', label: 'Camera turning', id: 'snap', keep: 'snap', ...pick(SNAP_NAME, () => SNAP_NAME[cv.snapMode], v => { cv.snapMode = SNAP_NAME.indexOf(v); })},
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
  zoom: e => cv.onWheel(e),
});
menu.restore(Q);   // the player's remembered settings (Graphics, Controls)
addEventListener('fullscreenchange', () => menu.refresh());

// ---------------------------------------------------------------- frame
let last = performance.now(), fps = 60, hudT = 0, lastDt = 1 / 60, leafVer = -1, leafWorld = null;
function step(dt) {
  pa.tick();
  // camera rotation: keys / middle-drag, then (in a step mode) ease onto the nearest step once you let go.
  // A climb started at an angle eases the camera to north first, climbs, then returns.
  const rot = (keys.has('x') ? 1 : 0) - (keys.has('z') ? 1 : 0);
  // paused: the menu's slow drift + dragging its backdrop
  let ny = cv.yaw + (paused ? pauseTurn(dt) + dragYaw : rot * ROT_SPEED * dt + dragYaw); dragYaw = 0;
  if (!paused && pa.assist) ny = pa.stepAssist(dt, ny);
  else if (!paused && !rot && !dragging && cv.snapMode) ny = cv.snapEase(ny, dt);
  const y0 = cv.yaw; setYaw(ny); pa.syncPlateaus();
  cv.stepSampling(dt, cv.yaw !== y0);
  if (paused) { stepPaused(dt); return; }   // the game stands still, nature goes on
  dt *= host.timeScale; if (dt <= 0) return;   // the game's slow motion / frozen world (the camera above stays live)
  perf.begin('env', 'sim'); env.step(dt); perf.end('env');   // the world clock first: everything after reads this step's time / weather
  if (freeze > 0) { freeze -= dt; for (const f of features) if (f.always) f.update?.(dt, []); return; }
  const n0 = events.length, px0 = P.x, py0 = P.y;
  perf.begin('player.step', 'sim'); PL.step(dt); perf.end('player.step');
  for (let i = n0; i < events.length; i++) pa.toWorldEvent(events[i]);   // the player's events are in the view frame
  clothPos[0] += P.x - px0; clothPos[1] += P.y - py0;               // its motion in the view frame, without the camera's turns
  perf.begin('arrows', 'sim'); proj.step(dt); perf.end('arrows');
  hero.stepCloth(dt, clothPos, perf);
  const evs = events.splice(0);
  for (const f of features) if (f.on !== false || f.always) f.update?.(dt, evs);
  cv.stepShake(dt);
}
const clothPos = [0, 0];
function draw(t) {
  pa.tick();
  cv.stepZoom(lastDt);
  const [PX, PY] = [player.x, player.y];
  cv.follow(lastDt, PX, PY, P, cam);   // the camera eases after him (render/camera.js)
  // the Ranger: sprite (+ runtime cloak) + pixel bow, albedo and normals, sinking when he falls in (view/hero.js)
  const sinkPx = hero.compose(PX, PY, perf);
  // props, hover pulse on the aimed target
  const hov = P.state === 'draw' ? pa.hoverTarget()?.target : null;
  for (const it of world.items) it.hover = it.p === hov ? .16 + .08 * Math.sin(performance.now() / 110) : 0;
  perf.begin('world.update', 'view'); world.update(cv.yaw); perf.end('world.update');
  // the season's leaves (env.leafRamp: changes a few times per season; a rebuilt world starts from the biome's own ramp)
  const lr = env.leafRamp(); if (lr && (env.ver.leaf !== leafVer || world !== leafWorld)) { world.setFamily?.('leaf', lr); leafVer = env.ver.leaf; leafWorld = world; }
  proj.draw(host);
  for (const f of features) if (f.on !== false) f.frame?.({dt: lastDt, t});
  // the aim reticle (pixel cross at the cursor, front layer)
  if (P.state === 'draw') {
    const q = G.layer('front'), mx = Math.round(cv.VW / 2 + (mouse.x - cv.VW / 2) * cv.zoom), my = Math.round(cv.VH / 2 + (mouse.y - cv.VH / 2) * cv.zoom);
    q.fillStyle = P.t > .5 ? '#f2d27a' : '#e9e4da';
    q.fillRect(mx - 3, my, 2, 1); q.fillRect(mx + 2, my, 2, 1); q.fillRect(mx, my - 3, 1, 2); q.fillRect(mx, my + 2, 1, 2);
  }
  if (opt.zones) drawZones();
  perf.begin('mood+lights', 'view'); lighting.apply(PX, PY, t); perf.end('mood+lights');
  perf.begin('G.render', 'render'); G.render(); perf.end('G.render');
  // HD overlay
  const dpr = devicePixelRatio || 1, sc = cv.scale * dpr;
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
  const p = pa.nearProp(); if (p && !BUSY.has(P.state)) {
    const r = features.map(f => f.prompt?.(p)).find(Boolean);
    at = [p.x, p.y, (p.z || 0) + 1.1]; txt = r?.text ?? r ?? 'E  open'; col = r?.color ?? col;
  }
  else if (!BUSY.has(P.state) && pa.climbSpotW()) { at = [player.x, player.y, P.z + 2]; txt = P.z > .1 ? 'E  climb down' : 'E  climb'; }
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
  const b = BIOMES[biomeI], deg = ((cv.yaw / DEG) % 360 + 360) % 360, s = G.stats;
  const fh = features.map(f => f.hud?.()).filter(Boolean).join(' · ');
  $('#hud').innerHTML = [
    `<div class="row"><b>Proving Grounds 3D</b> · ${b.name} · ${env.label()}${opt.lantern ? ' · lantern' : ''} · ${hero.loadName}</div>`,
    fh ? `<div class="row">${fh}</div>` : '',
    `<div class="row">camera <b>${deg.toFixed(1)}°</b> (${SNAP_NAME[cv.snapMode]}) · zoom ${(cv.scale * cv.zoom / cv.dsBase).toFixed(2)}x (${cv.scale}:1)${opt.debug ? ` · view <b>${DEBUG[opt.debug]}</b>` : ''}</div>`,
    `<div class="row dim">features: ${features.map(f => `${f.name}${f.on === false ? ' (off)' : ''}`).join(', ') || 'none yet'}</div>`,
    `<div class="row dim">${fps.toFixed(0)} fps · ${s.ms.toFixed(1)} ms CPU · ${s.calls} draws · ${s.sprites} sprites · ${s.points} pts · hits ${proj.hits}/${PL.shots}</div>`,
  ].join('');
}
$('#load').classList.add('hidden');
console.log(`render3d ready in ${((performance.now() - t00) / 1000).toFixed(1)} s (${set.packed ? 'packed atlas' : 'per-file atlas'})`, JSON.stringify(TIMING));

// debug handle for scripted tests (drive frames while the pane is hidden: rAF pauses there)
window.__r3d = {G, THREE, P, PL, host, player, keys, mouse, cam, opt, arrows, features, game, toView, toWorld, setYaw, setBiome, switchLoadout: i => hero.switchLoadout(i), TIMING, perf,
  get world() { return world; }, get yaw() { return cv.yaw; }, set zoom(v) { cv.zoomTo(Math.round(cv.dsBase * v)); }, get zoomState() { return {scale: cv.scale, zoom: cv.zoom, dsBase: cv.dsBase, dsGoal: cv.dsGoal}; }, set time(i) { env.setPart(TIMES[i]); }, env, set snap(i) { cv.snapMode = i; },
  set props(m) { propMode = m; world.setMode(m); }, get rig() { return hero.rig; },
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { lastDt = dt; step(dt); draw(performance.now() / 1000); } },
  applyOpts, hud};
requestAnimationFrame(frame);
