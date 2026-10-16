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
//   F.name, F.on (bool: its presentation shows), F.toggle?() (F.key: its hotkey, e.g. '5'), F.always (update during hitstop
//   too), F.ambient (its view goes on while paused: nature behind the menu)
//   F.update?(dt, evs)          SIM step: the truth (what burns, breaks, moves, scores). Always runs, F.on or not; sim
//                               decisions draw from the feature's own seeded generator (core/rng.js), never Math.random.
//                               evs = this step's events ({type: 'player.land', ...}: core/events.js)
//   F.view?(dt, evs)            VIEW step, after every update: particles, springs, animals, sounds. Reads the finished
//                               sim, writes only its own state; runs while F.on. (?views=0 runs the sim without them)
//   F.frame?(f)                 every rendered frame, camera set: push host.sprite / point / line, paint host.layer(...)
//                               f = {dt, t (s)}
//   F.lights?() -> [{x, y, h, color ('#rrggbb' | [r, g, b]), radius, intensity, flicker, id}]   arena coordinates
//   F.hd?(q, scale)             the display-resolution overlay (2D context; scale = display px per view px at this zoom:
//                               place world-pinned things by it; size screen-fixed HUD by host.hudScale, which the
//                               wheel's zoom doesn't change, so the HUD keeps its size)
//   F.camera?(dt) -> {x, y}     camera feel: an offset in view px (spring, lean, kick)
//   F.shift?(dx, dy)            the player was moved as he was by (dx, dy) world m (host.warp: the cave's step in), right then:
//                               move any eased state that follows him (a camera spring) along, so nothing swings after him
//   F.onKey?(k, e) -> bool      consume a key (k = e.key lower-case)
//   F.lmb?(down) -> bool        take LMB before the player does (core/input.js): true on the press takes it and its let-go
//   F.onArrowHit?(a, prop) -> 'stop' | 'pierce'   F.onArrowStuck?(a)   F.ability?(slot) -> bool   F.interact?(prop) -> bool
//   F.aimTarget?() -> {x, y, h, target} | null    F.hud?() -> string   F.settings?() -> [{label, get, set, options?}]
//   F.biomeChanged?()           after a world rebuild (N); F.dispose?()
//   F.resize?(VW, VH)           the view changed size (art px: the window's shape decides, e.g. ultrawide); re-make
//                               anything view-sized. host.VW / VH (and ctxO's) are always the current size, never 0
//                               (a hidden window keeps the last view: render/camera.js)
//   F.arrow?(a)                 every arrow as it is spawned (scale its damage, tag it, spawn extras with a.extra)
//   F.prompt?(prop) -> text | {text, color}   the "E ..." prompt over a prop you can interact with
//   F.menu?() -> [{label, run}] test actions on its page in the dev menu, or the Esc menu's Game tab (ui/pause.js GAME_ROWS)
//   F.dev?: {group, rows()}     its section and its own rows in the dev menu (dev/devmenu.js, F10; docs/DEVMENU.md)
// THE MENU (Escape, ui/pause.js + ui/menu.js): pauses the game but not the world: while host.paused only the AMBIENT
// features update (nature, see stepPaused), behind a blur. A feature's toggle / settings are on its page in the dev menu,
// and also in a player tab (Graphics, Audio, Controls) when CLAIM gives them one.
// THE ORDER of the features (updates and every hook chain) is what each declares: `export const order` (core/features.js).
// THE GAME (game/game.js) is the first feature: the run, enemies, items, HUD, title. It drives host.dev (the sandbox's
// dev keys + debug HUD), host.lock (no player input: menus, death, travel), host.timeScale (slow motion / frozen),
// host.setBiome / setTime / teleport / setYaw.
// HOST (see `host` below): player, arrows, spawnArrow, events, mods (modifiers), weapon (the loadout's), props, entities (add / remove / hide /
//   query / near), itemOf, elev, inStream, blocked, layout,
//   hitstop, shake, knock, launch, play, aim, mouse, keys, toView(x, y, h) -> view px, sprite, point, line, layer(name),
//   world, biome, time, mood, wind (the wind feature, if any), feature(name), PPM / PPMY / PPMH, G, THREE,
//   paused (the menu is open), openMenu(), uiSound(name) (the menu's sounds: hover, click, confirm, back, open),
//   playerHidden (photo mode hides him: leave out what you draw of him).
// PHOTO MODE (F4, the menu's Game tab: ui/photo.js): the loop hands it the frame's step while it's open (docs/exp/photomode.md).
import * as THREE from 'three';
import {createGfx, DEG} from './render/gfx.js';
import {WORLD, elev, inStream} from './world/world.js';
import {BIOMES} from './world/biomes.js';
import {MOODS, TIMES} from './content/moods.js';   // the lighting tables (forked from the arena's lighting.js)
import {createHero, loadLoadout, SET_NAMES} from './view/hero.js';   // the Ranger's card: loadouts, the composite, cloak, hair, armour, HD bow
import {capeShown} from './content/gear.js';   // (the sprite cloak, replaced by a piece in the back slot: dressPlayer)
import {BUSY} from './sim/player/player.js';
import {createPlayerHost} from './sim/player/adapter.js';
import {createGame} from './game/game.js';
import {createPerf} from './core/perf.js';   // the frame profiler: per-system ms against the budget (F3, ?perf=1)
import {createEnv} from './sim/env.js';   // the world clock: time of day, seasons, weather
import {createPause} from './ui/pause.js';   // the pause / settings menu (Escape)
import {createPhoto} from './ui/photo.js';   // photo mode (F4, the menu's Game tab): free camera, frozen time, the look, PNG export
import {createLighting} from './render/lighting.js';
import {createProjectiles} from './sim/projectiles.js';
import {flags} from './core/flags.js';
import {SESSION} from './core/session.js';   // co-op: the server joined and its world seed, settled before the world is built
import {createModifiers} from './core/modifiers.js';
import {rgbOf} from './core/color.js';
import {createCamera} from './render/camera.js';
import {createStage} from './world/stage.js';
import {createOptions} from './render/options.js';
import * as devtools from './dev/devtools.js';   // dev/: only the boot imports it, and hands it on (E.dev)
import * as devkeys from './dev/devkeys.js';
import * as owncheck from './dev/owncheck.js';
import {createCheats} from './dev/cheats.js';   // the cheat panel (F2): a dev feature the boot adds last
import {createGunFeel} from './dev/gunfeel.js';   // the gun feel panel (F8): live sliders as modifier notes, a dev feature too
import {createWxPanel} from './dev/wxpanel.js';   // the weather panel (F9): a change of the weather and the god rays' envelope, read out (wx-D)
import {createMoveFeel} from './dev/movefeel.js';   // the move feel panel (F7): run / sprint speed, get going / stopping, the strides, as modifier notes
import {createWardrobe} from './dev/wardrobe.js';   // the dev wardrobe (Shift+Tab): the character's clothes, paint, stats, items, outfits
import {createDevMenu} from './dev/devmenu.js';   // the dev menu (F10): every feature's toggles, settings and test actions, a page each
import {loadFeatures} from './core/features.js';
import {createInput} from './core/input.js';
import {createLoop} from './core/loop.js';

const $ = s => document.querySelector(s);
const Q = flags;   // the URL switches (core/flags.js)
const t00 = performance.now();

// ---------------------------------------------------------------- the Ranger: loadouts (packed atlases)
// the loadout (view/hero.js LOADOUTS). Default: the runtime cloth (cloak + scarf tail answer the wind; ?set=basic = the baked cloak)
// (?set=gunslinger | outlaw: the cowboys, a revolver each: content/weapons.js)
// (co-op: the gunslinger, drawn live: the others see his drawn pose as it is, features/coop.js)
const loadI = SET_NAMES.includes(Q.get('set')) ? SET_NAMES.indexOf(Q.get('set')) : SESSION.mp && SET_NAMES.includes('gunslinger') ? SET_NAMES.indexOf('gunslinger') : 1;
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
const mods = createModifiers();   // game effects as notes on the owners' stats (core/modifiers.js; host.mods)
const canvas = $('#screen');
const G = createGfx(canvas, {VW: cv.VW, VH: cv.VH, PPM, PPMY, PPMH, world: WORLD});
// the HD overlay: display resolution, over the pixel canvas (damage numbers, bars, prompts)
const hdc = document.createElement('canvas'); hdc.id = 'hd'; hdc.style.cssText = 'position:absolute;pointer-events:none;image-rendering:auto';
$('#wrap').appendChild(hdc); const hq = hdc.getContext('2d');
cv.attach({G, canvas, hdc, features}); cv.fit(); addEventListener('resize', () => cv.fit());

// THE WORLD CLOCK (sim/env.js): time of day, seasons, weather, running in the background. It owns "what time is it":
// host.time is its day / dusk / night bucket (dawn counts as dusk), host.mood its blended mood, host.setTime jumps it
// THE STAGE (world/stage.js): the biome, the built world, the props' display mode, the trees
const stage = createStage({G, ctxO, PPM, PPMH, features, flags: Q});
const env = createEnv({moods: MOODS, biome: () => stage.biome.id, Q, focus: () => player, seed: SESSION.seed});   // (seed: the world's, the spells come from it and the clock: sim/wxclock.js)   // (focus: where the weather is felt: a front reaches the player; the world's x, y) (wx-B: was P, his view-frame state: wrong once the camera turned)
// APP: the engine's own context for the modules split out of this file (view/hero.js, ...): live getters, so a module
// reads the current yaw / zoom / player without this file passing them every call. (Features get `host`, below.)
const app = {
  get P() { return P; }, get PL() { return PL; }, get player() { return player; }, get yaw() { return cv.yaw; }, get zoom() { return cv.zoom; },
  get viewYaw() { return G.cine ? G.view.yaw : cv.yaw; },   // the heading things are DRAWN from (a cinema camera's; yaw: the game's frame)
  get VW() { return cv.VW; }, get VH() { return cv.VH; }, get opt() { return opt; }, get cam() { return cam; }, get arrows() { return arrows; },
  feat: name => feat(name), toView: (x, y, a) => toView(x, y, a),
  get entities() { return stage.ents; },   // (the live hero's ragdoll: what stands near his body, view/herorag.js)
};
tp = performance.now();
await stage.setBiome(stage.biomeI);
mark('world', tp);
const dev = {...devtools, ...devkeys, ...owncheck};
const ownReport = Q.get('owncheck') === '1' ? dev.installOwnCheck(stage.ents) : null;   // before the features add theirs
if (Q.get('lineup') === 'trees') dev.treeLineup(stage);   // the procedural trees side by side for review (dev/devtools.js)

// ---------------------------------------------------------------- the camera's frame
const toView = cv.toView, toWorld = cv.toWorld;   // world <-> the camera's view frame at its yaw (render/viewxf.js)

// ---------------------------------------------------------------- the player
const keys = new Set(), mouse = {x: cv.VW / 2, y: cv.VH / 2, down: false}, cam = {x: 0, y: 0, fx: 0, fy: 0};
// arrows, hit pops, footstep dust (sim/projectiles.js)
const proj = createProjectiles({world: () => stage.world, ents: () => stage.ents, features, events, opt: () => opt, toWorld, PPM, PPMH, mods});
const {arrows, dust} = proj, spawnArrow = proj.spawn;
const feat = name => { for (const f of features) if (f.name === name) return f; return null; };   // (no closure a call: host.wind is read in hot loops)
const hero = createHero({G, set, loadI, ctxO, app});
// THE PLAYER (sim/player/adapter.js): player.js in the camera's frame, bridged to the world (collision, the world-frame
// `player`, turning with the camera, the cursor's target, interaction, climbing at any angle)
const pa = createPlayerHost({G, ctxO, PPM, PPMY, cv, hero, keys, mouse, cam, events, features, world: () => stage.world, ents: () => stage.ents, biome: () => stage.biome,
  opt: () => opt, proj, flags: Q, mods, canLaunch: () => LAUNCH && !!live?.available});   // (a blast throws him only in a live body: his ragdoll, view/herorag.js)
const {PL, P, player} = pa;
const LAUNCH = Q.get('launch') !== '0';   // (a blast throws him: sim/player/launch.js; ?launch=0 the old skid)
// THE LIVE HERO (docs/exp/livehero.md): the player drawn LIVE (view/livehero.js: his Blender model through
// render/rigmesh.js) instead of his sprite. By default for the gunslinger (LIVE_LOADOUTS); ?live=1 every loadout with a
// live model (the outlaw too), ?live=0 none. The loop calls its compose instead of hero.compose while he wears one
// (dev/livekeys.js: Shift+7 flips sprite / live)
const LIVE_LOADOUTS = ['gunslinger'];
const live = Q.get('live') !== '0' ? await import('./view/livehero.js')
  .then(m => m.createLiveHero({G, app, hero, pa, mouse, cam, ctxO, only: Q.get('live') === '1' ? null : LIVE_LOADOUTS}))
  .catch(e => { console.warn('live hero: not loaded', e); return null; }) : null;
if (live && Q.get('livereload') === '1') dev.watchLive(live, hero);   // (dev: a re-exported live model shows at once: dev/livekeys.js)

const setYaw = cv.setYaw, setBiome = i => stage.setBiome(i);

// ---------------------------------------------------------------- feel: shake (render/camera.js), hitstop (core/loop.js), knock
const shake = cv.shake;
let loop = null, photo = null;

// ---------------------------------------------------------------- the host features see
// host.sprite's arguments for G.sprite (arena -> world axes), in ONE reused object: G.sprite reads it at once and keeps
// nothing, so no copy per sprite (a spread made a new object for every sprite of every frame)
// Its number fields always hold numbers (the defaults G.sprite would take, worked out here): a field that also held
// undefined kept its doubles as boxes, a new box for every number written (~10 a sprite, every sprite, every frame)
const SPR = {img: null, em: null, nrm: null, type: 3, shadow: false, dynamic: false, sx: 0, sy: 0, sw: 0, sh: 0,
  x: 0, y: 0, z: 0, px: 0, py: 0, alpha: 1, flip: false, sway: 0, flash: 0, lie: 0};
const sprite = o => {
  const s = SPR; s.img = o.img; s.em = o.em; s.nrm = o.nrm; s.type = o.type ?? 3; s.shadow = !!o.shadow; s.dynamic = !!o.dynamic;
  s.sx = o.sx || 0; s.sy = o.sy || 0; s.sw = o.sw ?? o.img.width; s.sh = o.sh ?? o.img.height; s.x = o.x; s.y = o.h ?? 0; s.z = o.y;
  s.px = o.px ?? s.sw / 2; s.py = o.py ?? s.sh; s.alpha = o.alpha ?? 1; s.flip = !!o.flip; s.sway = o.sway || 0; s.flash = o.flash || 0; s.lie = o.lie || 0;   // lie: features/foes/look.js (gfx.js BATCH_VS)
  G.sprite(s); s.img = s.em = s.nrm = null;   // (don't hold the images)
};
const host = {
  THREE, G, PPM, PPMY, PPMH, get VW() { return cv.VW; }, get VH() { return cv.VH; }, ctxO,
  get world() { return stage.world; }, get biome() { return stage.biome; }, get time() { return env.bucket; }, get mood() { return env.mood(stage.biome.id); }, env,
  get yaw() { return cv.yaw; }, get viewYaw() { return G.cine ? G.view.yaw : cv.yaw; }, get zoom() { return cv.zoom; }, get hudScale() { return cv.dsBase * (devicePixelRatio || 1); }, get props() { return stage.world.props; }, get layout() { return stage.world.layout; },
  // the entity registry (world/entities.js): add / remove props, live queries by kind, near(x, y, r); props = its list
  get entities() { return stage.ents; }, get propsVersion() { return stage.ents.ver; },
  player, P, PL, arrows, spawnArrow, events, keys, mouse, BUSY, mods,
  get weapon() { return hero.weapon; },   // the loadout's weapon (content/weapons.js): kind 'bow' | 'gun', abilities
  get live() { return !!live?.available; },   // the loadout he wears is drawn live (view/livehero.js): its body has the live-only moves (features/brawl.js)
  itemOf: p => stage.world.itemOf(p), elev, inStream, blocked: (x, y, z = P.z, air = false) => pa.blocked(x, y, z, air),
  hitstop: sec => loop.hitstop(sec), shake, knock: (vx, vy) => { const [a, b] = toView(vx, vy); PL.knock(a, b); },
  launch: (vx, vy, vz) => { const [a, b] = toView(vx, vy); return PL.launch(a, b, vz); },   // thrown (sim/player/launch.js): false -> knock him instead
  play: (frame, sec) => PL.hold(frame, sec),
  aim: () => { const c = PL.cursorAim(); const [x, y] = toWorld(c.x, c.y); return {x, y, h: c.h, target: c.target, ray: c.ray}; },
  toView: (x, y, h = 0) => { const s = G.toScreen(x, h, y); return [s[0], s[1]]; },         // world -> view px (rotated)
  sprite,                                                                              // {img, x, y, h, px, py, ...}
  point: (x, y, h, c, o) => G.point(x, h, y, rgbOf(c), o),
  line: (x0, y0, h0, x1, y1, h1, c, emit) => G.line(x0, h0, y0, x1, h1, y1, rgbOf(c), emit),
  layer: n => G.layer(n), glayer: n => G.glayer(n), rgb: rgbOf,
  get wind() { return feat('wind'); }, feature: feat,
  get hits() { return proj.hits; },
  // the menu (ui/menu.js): open it (the title's Settings), its wooden UI sounds (the audio feature), open or not
  get paused() { return pause.paused; }, openMenu: () => pause.toggle(true), uiSound: n => feat('audio')?.ui?.(n),
  // photo mode (ui/photo.js) has hidden the player: a feature that draws something of him (his contact shadow, the lantern) leaves it out
  get playerHidden() { return !!photo?.hidePlayer; },
  get photoOpen() { return !!photo?.open; },   // photo mode is open (its own camera: the cinematic mode keeps out)
  get lantern() { return !!opt.lantern; },   // the player's lantern is lit (L, menu > Character; a run rule's 'light.lantern' note is the mods'): features/uncanny.js
  // game controls (game/game.js): dev keys + debug HUD on/off, player input locked, the simulation's speed, the world
  dev: true, lock: false, timeScale: 1, hudOff: false, BIOMES, TIMES,
  get biomeI() { return stage.biomeI; }, get timeI() { return TIMES.indexOf(env.bucket); },
  setBiome: i => setBiome(i), setTime: i => env.setPart(TIMES[i]), setYaw: a => setYaw(a),
  teleport: (x, y) => pa.teleport(x, y),   // put the player at world (x, y), standing, and snap the camera there
  warp: (dx, dy) => { pa.shift(dx, dy); for (const f of features) f.shift?.(dx, dy); },   // move the player by (dx, dy) world m as he is (moving, mid-jump), the camera and the features' eased state with him (features/caves.js)
  // the Ranger as drawn this frame (sprite + runtime cloak + pixel bow, and its normals), for afterimages / reflections.
  // img / nrm are live canvases (redrawn every frame before F.frame runs): copy them if you keep a past frame. Their
  // size is img.width / img.height; h is the player's height above the ground (metres), like every host h.
  playerSprite: () => live?.on ? live.sprite() : hero.sprite(),
  // the muzzle of the gun as DRAWN (live: the live hero's stances and kicks move it off the sim's atlas muzzle): world
  // {x, y, h}, the last frame's, or null (the sprite: the sim's muzzle is the drawn one). For the shot's flash (gunfx)
  playerMuzzle: () => live?.on ? live.muzzle() : null,
  // the rope hands as DRAWN (live: the lasso's live clips and the spin's IK hand; docs/exp/lasso.md): world {x, y, h (RopeHand0), ux, uy, uh
  // (RopeHand1), spin, cx, cy, ch, r (the spin's circle)}, the last frame's, or null (the sprite: the sim's hand is the drawn one)
  playerRopeHand: () => live?.on ? live.ropeHand() : null,
  // the melee blade as DRAWN (view/heldweapon.js on the live hand): world {x, y, h (its guard), tx, ty, th (its point)}; null
  // on the sprite path (features/melee.js draws its stand-in line from the sim's facing then)
  playerBlade: () => live?.on ? live.blade() : null,
  // his DRAWN live pose (view/livehero.js DRAWN: body-space bones in BN order, 7 a bone; phi his facing; n counts the frames drawn;
  // rig the live model's name), or null when he isn't drawn live: co-op sends it to the others (features/coop.js). One reused object
  playerPose: () => { const d = live?.on ? live.drawn : null; if (!d?.w) return null; PPOSE.w = d.w; PPOSE.phi = d.phi; PPOSE.n = d.n; PPOSE.BN = live.BN; PPOSE.rig = hero.loadName; return PPOSE; },
  // GEAR (features/gear.js, docs/GEAR.md): draw him in these pieces (content/gear.js entries, SLOTS order; key: their setKey).
  // The live body; a sprite loadout looks the same but for its runtime cloak (gone with a piece in the back slot: content/gear.js
  // capeShown). On a change of set, never per frame
  dressPlayer: (pieces, key) => { hero.setCape(capeShown(pieces)); live?.dress(pieces, key); },
};
const PPOSE = {w: null, phi: 0, n: 0, BN: null, rig: ''};

// ---------------------------------------------------------------- features
tp = performance.now();
await loadFeatures(features, host);   // core/features.js
stage.ents.sync();   // features placed and moved props as they were made (lights' sconces): the grid follows
mark('features', tp);
// the game goes first: it sees keys, arrows, hits and interactions before the engine's features
const game = await createGame(host); features.unshift(game);
// the cheat panel (dev/cheats.js, F2 in dev mode): last, so what it asks for lands after every feature's step
features.push(createCheats({host, cam, canvas}));
features.push(createGunFeel({host}));   // (dev/gunfeel.js: F8 in dev mode)
features.push(createWxPanel({host}));   // (dev/wxpanel.js: F9 in dev mode; wx-D)
features.push(createMoveFeel({host, atlas: hero.atlas}));   // (dev/movefeel.js: F7 in dev mode)
features.push(createWardrobe({host, hero, live, engine: () => E}));   // (dev/wardrobe.js: Shift+Tab in dev mode; a screen of its own: loop.hold)
if (Q.get('lab')) features.push(await import('./dev/assetlab.js').then(m => m.createLab({host})));   // the asset lab (?lab=1: dev/assetlab.js)
features.push(createDevMenu({host, engine: () => E}));   // (dev/devmenu.js: F10 in dev mode; last, it lists the others)
const perf = createPerf({on: Q.get('perf') === '1'}); perf.instrument(features);
// the wind sways painted foliage cards and gives braziers / torches a live flame
stage.world.hooks.card = stage.cardHook;

// ---------------------------------------------------------------- toggles
const options = createOptions({G, flags: Q, dev: () => host.dev}), opt = options.opt, applyOpts = options.apply;   // render/options.js
applyOpts();
const lighting = createLighting({G, host, features, opt});   // render/lighting.js: the mood + lights -> the composite

// ---------------------------------------------------------------- the engine
// E: the engine's context for its own modules (core/input.js, ui/pause.js, core/loop.js): what boot made, by name.
// Boot fills it once; the modules read it and never write it. (Features get `host`, above.)
const E = {G, canvas, hdc, hq, cv, stage, env, hero, live, proj, pa, PL, P, player, keys, mouse, cam, events, features, host, game, perf, opt, flags: Q,
  applyOpts, lighting, feat, setBiome, setYaw, dev, input: null, pause: null, photo: null, loop: null};
E.input = createInput(E);   // the keyboard + mouse (before the menu: the order its listeners run in)
const pause = E.pause = createPause(E);
photo = E.photo = createPhoto(E);   // (before the loop: it hands photo mode the frame's step while it's open)
pause.menu.restore(Q);   // the player's remembered settings (Graphics, Controls)
addEventListener('fullscreenchange', () => pause.menu.refresh());
loop = E.loop = createLoop(E);
if (Q.get('photo') === '1') photo.toggle(true);   // ?photo=1: straight into photo mode (tests)
$('#load').classList.add('hidden');
console.log(`render3d ready in ${((performance.now() - t00) / 1000).toFixed(1)} s (${set.packed ? 'packed atlas' : 'per-file atlas'})`, JSON.stringify(TIMING));

// debug handle for scripted tests (drive frames while the pane is hidden: rAF pauses there)
window.__r3d = {G, THREE, P, PL, host, player, keys, mouse, cam, opt, arrows, features, game, toView, toWorld, setYaw, setBiome, switchLoadout: i => hero.switchLoadout(i), TIMING, perf,
  get world() { return stage.world; }, get yaw() { return cv.yaw; }, set zoom(v) { cv.zoomTo(Math.round(cv.dsBase * v)); }, get zoomState() { return {scale: cv.scale, zoom: cv.zoom, dz: cv.dz, dsBase: cv.dsBase, dsGoal: cv.dsGoal}; }, set time(i) { env.setPart(TIMES[i]); }, env, set snap(i) { cv.snapMode = i; },
  set props(m) { stage.propMode = m; }, get rig() { return hero.rig; },
  step: (n, dt) => loop.run(n, dt), applyOpts, hud: loop.hud, owncheck: ownReport, live, photo};
loop.start();
