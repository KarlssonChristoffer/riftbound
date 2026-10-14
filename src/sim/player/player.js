// THE PLAYER, shared by demo.html (skeleton playground) and arena.html (proving grounds).
// Movement, aiming, the bow, dodge roll, turn / skid / sprint frames, traversal (leap, fall, climb) and the HD bow
// layer. The host owns the world (collision, terrain, props, arrows in flight, dust, drawing the sprite); everything
// the player needs from it comes in through `H` below. With only the required hooks the player behaves exactly like
// the old demo: no terrain, no traversal, no interaction.
//
//   import {createPlayer, loadSet, AIM_H} from './player.js';
//   const PL = createPlayer(H); const P = PL.P;
//   every frame: PL.step(dt); host draws SP[P.frame] (facing P.face) at toS(P.x, P.y, P.z); PL.drawHD(og, scale, ox, oy, arrows)
//   input: Space -> PL.onSpace(), E -> PL.onInteractKey() / keyup -> PL.onInteractUp(), LMB -> PL.press() / PL.release()
//
// H (host) — required:
//   ctx      live {PPM, PPMY, PPMH, toS(x, y, h)} (metres -> world px; updated in place when the projection changes)
//   atlas    live {SP, CLIP, OV, DIRS, ND, FW, FH, PIV} of the current loadout (host Object.assigns it on a switch)
//   keys     Set of lower-case keys held; mouse {x, y, down} in view px; cam {x, y, fx, fy} (view offset, world px)
//   blocked(x, y, z, air) -> bool     collision (air = leaping / falling: ignore water)
//   onShoot(arrow)                    host adds {x, y, h, vx, vy, vh, life, dmg, kind} to its arrows
// H — optional:
//   elev(x, y) -> ground height (m); inStream(x, y) -> water you can leap over; plateaus [{x0, y0, x1, y1, h}] (the cursor's levels);
//   water(x, y) -> [surface height, current x, current y (m/s, this frame)] where deep water (inStream) can be swum, else null (SWIM)
//   climbs [{x, y, w, h0, h1, reach}]: where a face can be climbed, in this frame (the face to the north: its foot's middle, width, the
//   ground at its foot and the top, how far in the mantle goes; out of reach (x 1e9) unless the camera faces it: sim/player/adapter.js)
//   aimTarget() -> {x, y, h, target} | null   (snap the aim to something under the cursor)
//   pixelBow() -> bool: the bow set is pixel art: the host calls PL.drawPixelBow(g, spriteLeft, spriteTop) right after the
//            sprite and PL.drawPixelArrow(g, arrow) for each flying arrow in its pixel pass (before lighting); drawHD
//            then draws nothing
//   nearInteract(P) -> prop | null; onInteract(prop) -> bool   (E on chests etc.)
//   dust(fx, fy, side, big)            a foot contact at world px (fx, fy); big 0 step, 1 turn push, 2 plant / land
//   events []                          pushes {type: 'player.step'|'player.land'|'player.jump'|'player.splash'|'player.stroke', x, y, ...} (core/events.js)
//   shake(px, sec)
//   gun(PL, internals) -> a revolver (sim/player/gun.js createGun): while the loadout's weapon is a gun it gets LMB and the frame
//   canLaunch() -> bool               a blast may THROW him (sim/player/launch.js: PL.launch; false: the skid, PL.knock)
//   lasso(PL, internals) -> the lasso's hands (sim/player/lasso.js createLasso): while the equipment experiment's lasso has
//            something to do it drives the frame (before the gun); PL.lasso is its API
//   ropewall(PL, internals) -> the rope wall (sim/player/ropewall.js createRopeWall): the lasso's rope-up hands him to it, and while it
//            has him it drives the frame (before anything else); PL.ropewall is its API. ropewallOn: false -> never (?ropewall=0)
//   ropeCam(yaw)                      the rope wall's camera: side-on to a face whose outward normal is at world yaw `yaw` (the adapter)
//   ladderOld -> true: the ladder climbs by itself (?ladder=old); else sim/player/ladder.js puts it under his control
import {WEAPONS} from '../../content/weapons.js';   // the bow's numbers (shoot)
import {ramps} from './harmonize.js';   // the character palette (pixel bow layer)
import {clamp} from '../../core/mathx.js';
import {createLaunch, STATES as THROWN} from './launch.js';   // thrown by a blast: flying, slammed, down, getting up
import {STATES as BRAWLS} from './brawl.js';   // the live cowboys' boot, barge, lift, throw (sim/player/brawl.js: H.brawl)
import {STATES as FISTS} from './fists.js';   // the live cowboys' fists: a move, a slip, a clinch (sim/player/fists.js: H.fists)
import {STATES as TOOLS} from './tool.js';   // a tool in hand: the axe's swing (sim/player/tool.js: H.tool; docs/GATHERING.md)
import {createLadder} from './ladder.js';   // the ladder under his control: up, down, stop, slide (?ladder=old: the climb below)
export const AIM_H = 1.25;   // arrows fly at chest height
// walkable terrain (docs/TERRAIN.md): a step up is taken in stride up to STEP_UP m (H.blocked stops anything higher), a step
// down up to SNAP m (a slope walked or rolled down); a bigger drop is a ledge, and he falls
export const STEP_UP = .3, SNAP = .16;
// the movement profile, authored (Christoffer's 'Jog', 2026-10-12: a relaxed exploring pace near the clips' own, a gentle start and
// stop; before it, walk 1.4 / run 4.6 / sprint 7.2 m/s, 38 / 30 m/s^2 to get going / stop, the legs ~1.4-1.7x the clips' pace)
export const SPEED = {walk: 1.15, run: 3, sprint: 5};
export const SPEED0 = {...SPEED};   // the authored speeds; SPEED = these with the modifiers' 'player.speed' notes (H.mods)  // m/s; the clips follow whatever distance is really covered
export const ACC = {start: 17.1, sprintUp: 2.475, sprintDown: 4, stop: 15, skid: 6.5};   // m/s^2
export const ACC0 = {...ACC};   // the authored rates; ACC = these with the 'player.accel' (setting off, building a sprint) and 'player.decel' (stopping, easing out of a sprint, a skid) notes
// GAIT: the locomotion clips' stride as the phase advances, x the clip's own per gait: the style (STRIDE0, x the 'player.stride.walk' /
// '.run' / '.sprint' notes; the drive building into a sprint takes the sprint's), x how fast he really goes against the authored
// speed of that gait to the ADAPT power (faster: longer strides AND quicker legs, as people run; clamped to STRIDE_R): any build's
// speed (gear, items, a run rule, the wind) looks right without retuning (strideK, below; the step sounds follow by the event's pace).
// And the speeds (m/s) the gaits change at: the sprint from `sprint`, its drive below `drive`, a skid on letting go above `skid`; they
// follow the run and sprint speeds (GAIT0 between SPEED0.run and SPEED0.sprint). dev/movefeel.js tunes all of it live
export const STRIDE0 = {walk: 1, run: 1, sprint: 1.15}, ADAPT = .6, STRIDE_R = [.7, 1.6];
const GAIT0 = {sprint: 3.31, drive: 4.62, skid: 3.46};
export const GAIT = {stride: {walk: 1, run: 1, drive: 1.15, sprint: 1.15}, ...GAIT0};
// the stride factor for gait g at v m/s (its clip's stride x this per cycle): the style x the speed's share (1 at the authored speed)
export function strideK(g, v) {
  const r = clamp(v / SPEED0[g === 'drive' ? 'sprint' : g], STRIDE_R[0], STRIDE_R[1]);
  return GAIT.stride[g] * (r === 1 ? 1 : Math.pow(r, ADAPT));
}
const TURN_RATE = 900;  // deg/s: locomotion (walking / standing turns)
// Aiming turns FAST (180 deg in 0.15 s): aiming must feel immediate. (Tried 450 deg/s with the draw held until facing
// the target: it looked smoother but the user found it slow and clumsy to aim.)
const AIM_TURN_RATE = 1200;
const STANCE_HOLD = .25;  // s: a moving-aim stance (running forward / backing up) can't flip back sooner (no flip-flop)
// states in which the player is taken over by a move (no aiming, rolling or new actions); 'rope': hanging from a lasso
// (sim/player/lasso.js, the equipment experiment's)
export const BUSY = new Set(['leap', 'fall', 'land', 'climb', 'vault', 'slide', 'splash', 'swim', 'hold', 'knock', 'rope', ...THROWN, ...BRAWLS, ...FISTS, ...TOOLS]);
// The dodge (Space). The roll clip is a FORWARD roll, so a roll never reverses:
// - running into a roll more than leadMin deg off the way he faces: he plants and turns first (the run's turn frames,
//   lead s each, untouchable from the plant)
// - WASD steers a roll during its first steerEnd (while he's curled up) at steerRate deg/s, at most steerMax deg off the
//   way it started (a back diagonal turns it the full steerMax its way); input more than steerIgnore deg off it (back)
//   is ignored
// - aiming, with back, a back diagonal (input . aim < backCos) or nothing held: a short backstep instead of a roll, the
//   bow drawn on the target (backDist m in backDur s, no slower than backExit = backing up while aiming if a direction
//   is held), untouchable for its first guard s
const DODGE = {lead: .045, leadMin: 67.5, leadSpeed: 2.3, steerRate: 360, steerMax: 90, steerIgnore: 150, steerEnd: .65,
  backCos: -.3, backDist: 1.3, backDur: .3, backExit: 2.7, guard: .15};
const D2R = Math.PI / 180;
const CLIMB_T = 1.1, MANTLE_T = .28;   // (CLIMB_T: up to 2.4 m, the mesa's faces; a taller one at the same pace: the watchtower's ladder)
// VAULT (Space at a low ledge, walkable terrain): a rise of more than a step (STEP_UP) and at most VAULT_H m within VAULT_REACH m
// ahead, its top level enough to stand on and clear: up and onto it in VAULT_T s (higher: a ladder)
export const VAULT_H = 1.25, VAULT_REACH = .8, VAULT_T = .46;   // (exported: the live hero times its frames by them)
// VAULT OVER a breach in a stone wall (H.wallOver: sim/player/adapter.js finds it): up over its stones in an arc (OVER_LIFT m clear of
// them) and down on its far side, in VAULT_OVER_T s; Space as for a ledge
export const VAULT_OVER_T = .58, OVER_LIFT = .12;
// LANDING: a drop of more than LAND.big m lands hard (into the knees, LAND.hard s, he stops); anything less lands soft
// (LAND.soft s), and with a direction held he lands running: no braking, the run goes on
const LAND = {soft: .12, hard: .34, big: 1.2};
// ADAPTIVE TRAVERSAL (docs/exp/livereact.md): Space picks the move the obstacle needs, by what the plan measures (kept on
// P.vault / P.leap: the live hero picks its clip by `kind` and puts the hands on the real top; the sprites keep their frames):
//   up a ledge h m over his feet   step (h <= JUMP.step: a foot onto it, no hands: he keeps his pace), knee (<= JUMP.knee: a
//                                  hand and a knee; keeps JUMP.kneeKeep of his pace), climb (higher: both hands, the chest over)
//   over a breach, its top h up    hop (h <= JUMP.hop: a hand on the stones, the legs swung past: he keeps his pace), tuck
//                                  (<= JUMP.tuck: both hands, the knees tucked; keeps JUMP.tuckKeep), over (higher: up onto
//                                  the stones and down the far side)
//   a leap                         stride, or long from JUMP.long m; from bank to bank at their own heights. One that comes up
//                                  short within JUMP.reach m of the far bank catches its lip and climbs out ('catch')
//   a drop of more than LAND.big   with a direction held and faster than JUMP.rollSpeed: a roll out of the landing, going on
// side: the hand that plants, +1 his left, -1 his right: the one nearer the face when he meets it at more than JUMP.slant deg,
// else his left (the gun hand stays free). Times (s): step / knee / climb [base, per m of h], hop at least hopMin at hopSpeed
// m/s or faster, over [base, per m over 1 m] and catch their own (catchHang of it hanging from the lip)
export const JUMP = {step: .55, knee: .9, hop: .62, tuck: .98, long: 2.8, reach: .75, rollSpeed: 2.2, slant: 18,
  stepT: [.22, .24], kneeT: [.36, .2], climbT: [VAULT_T - .1, .1], hopMin: .3, hopSpeed: 3.2, overT: [.84, .25], catchT: .8, catchHang: .2,
  kneeKeep: .35, tuckKeep: .5};
// SLIDE (walkable terrain): on ground too steep to stand on (a grass bank: slope rise / run over `on`; a cliff, over `cliff`, is a drop
// instead) he loses his footing and slides down it, `g` m/s^2 at a 45 deg bank, `fric` 1/s, steering a little (`steer` m/s^2),
// until the ground eases under `off`. H.grad(x, y, out) -> out = [gx, gy (this frame), slope]
const SLIDE = {on: .8, off: .45, cliff: 2.6, g: 9, fric: 1.6, steer: 4, max: 7};
// SWIM (H.water): deep water that can be swum (not lava, not the rift's crack, not a fall's lip: the host says) is swum instead of a
// splash back to the bank. Walking or rolling in, a fall, a blast's throw or a leap that comes up short (no lip in reach to catch)
// puts him in it: 'swim' (BUSY: no aiming, rolling or actions). Head and shoulders out: P.sink `sink` (the views lower him 22 px per
// 1: ~.77 m), bobbing `bob` at `bobHz`, settling at `settle` 1/s; a fall goes `dunk` deeper first and comes up. WASD swims at `speed`
// m/s x the build's pace (SPEED.run's share; Shift: `fast`), getting there at `acc` m/s^2, gliding to a stop at `drag` 1/s, turning
// at `turn` deg/s; a river's current carries him on top (H.water's). Space: a kick, `kick` m/s more the way he swims, every `kickCd`
// s. Where deep water ends he wades out (onto the shelf, a bank no higher than STEP_UP over the surface; a drop beyond, over a
// fall's edge, holds him back), rising out of it over `rise` s. The arms: the walk's frames, a cycle every `stroke` m; a
// 'player.stroke' each half cycle (treading water, below `still` m/s: every `tread` s): the rings, the drops, the sound
export const SWIM = {sink: 1.6, dunk: .7, bob: .05, bobHz: .8, settle: 5, speed: 1.4, fast: 2.1, acc: 2.6, drag: 1.4, turn: 540,
  kick: 1.3, kickCd: .7, stroke: 2.2, still: .25, tread: 1.2, rise: .4, bigIn: 2.5};
const _grad = [0, 0, 0];
const angDiff = (a, b) => Math.abs(((a - b) + Math.PI * 3) % (Math.PI * 2) - Math.PI);

// ---------------- atlas loading (one atlas per loadout: body + garments rendered together) ----------------
// Loading: an atlas is ~1000 small files (sheet, meta, depth, normals per pose). Firing them all at once overflows a
// simple dev server's connection queue (refused connections), so requests go through a small pool and failed images
// are retried; one bad file can't hang the load any more.
let active = 0; const queue = [];
const slot = () => new Promise(ok => { if (active < 128) { active++; ok(); } else queue.push(ok); });
const free = () => { const next = queue.shift(); next ? next() : active--; };
async function pooled(fn) { await slot(); try { return await fn(); } finally { free(); } }
const loadOnce = src => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => err(new Error('image ' + src)); i.src = src; });
async function load(src, tries = 4) {
  for (let k = 0; ; k++) {
    try { return await pooled(() => loadOnce(src)); }
    catch (e) { if (k >= tries - 1) throw e; await new Promise(r => setTimeout(r, 150 * (k + 1))); }
  }
}
const json = async (url, tries = 4) => {
  for (let k = 0; ; k++) {
    try { return await pooled(() => fetch(url).then(r => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); })); }
    catch (e) { if (k >= tries - 1) throw e; await new Promise(r => setTimeout(r, 150 * (k + 1))); }
  }
};
const sets = {};
// opts: {normals: true} loads body_normals.png in the background (lighting); ClothRig: the cloth.js class for sim sets
export async function loadSet(root, opts = {}) {
  if (sets[root]) return sets[root];
  const idx = await json(root + 'poses.json'), SP = {};
  await Promise.all(idx.poses.map(async p => {
    const [meta, img, depth] = await Promise.all([json(`${root}${p}/meta.json`), load(`${root}${p}/body_sheet.png`),
      idx.sim ? load(`${root}${p}/body_depth.png`) : null]);   // the three files of a pose in parallel
    SP[p] = {img, bones: meta.bones, sim: meta.sim, depth};
  }));
  if (opts.normals) for (const [p, sp] of Object.entries(SP)) load(`${root}${p}/body_normals.png`).then(i => { sp.nrm = i; }).catch(() => {});
  for (const c of Object.values(idx.clips)) if (c.advance) { c.cum = [0]; c.advance.forEach((a, i) => c.cum.push(c.cum[i] + a)); }  // phase boundaries
  const OV = await fetch(root + 'overlays.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
  const rig = opts.ClothRig ? new opts.ClothRig(idx) : {active: false, update() {}, draw() {}, reset() {}};
  return (sets[root] = {idx, SP, CLIP: idx.clips, OV, rig});
}
// the per-atlas fields the player reads (assign into H.atlas after loading / switching)
export const atlasOf = s => ({SP: s.SP, CLIP: s.CLIP, OV: s.OV, DIRS: s.idx.dirs || Object.keys(s.idx.fwd_px),
  ND: (s.idx.dirs || Object.keys(s.idx.fwd_px)).length, FW: s.idx.w, FH: s.idx.h, PIV: s.idx.pivot});

export function createPlayer(H) {
  const A = H.atlas, {keys, mouse, cam} = H, T = H.ctx;
  const elev = H.elev || (() => 0), inStream = H.inStream || (() => false), plateaus = H.plateaus || [], climbs = H.climbs || [];
  const P = {x: 0, y: 0, z: 0, vx: 0, vy: 0, face: 0, want: 0, turnT: 0, state: 'idle', t: 0, ph: 0, gait: 'walk',
    frame: 'idle.0', prevF: -1, rollDir: [0, 1]};
  const PL = {P, shots: 0, BUSY};
  const has = f => !!A.SP[f];
  const ev = e => { if (H.events) H.events.push(e); };
  // the run speeds follow the modifiers (an item's +speed): recomputed when the notes change, never written from outside
  // (a gait's own speed note first, 'player.speed.run', then the whole body's), and so do the rates and the strides (GAIT, above)
  const applySpeed = () => {
    const M = H.mods;
    for (const k of Object.keys(SPEED0)) SPEED[k] = M.value('player.speed', M.value('player.speed.' + k, SPEED0[k]));
    for (const k of ['start', 'sprintUp']) ACC[k] = M.value('player.accel', ACC0[k]);
    for (const k of ['sprintDown', 'stop', 'skid']) ACC[k] = M.value('player.decel', ACC0[k]);
    for (const k of ['walk', 'run', 'sprint']) GAIT.stride[k] = M.value('player.stride.' + k, STRIDE0[k]);
    GAIT.stride.drive = GAIT.stride.sprint;
    const same = SPEED.run === SPEED0.run && SPEED.sprint === SPEED0.sprint;   // (as authored: the literal speeds)
    const at = v => same ? v : SPEED.run + (SPEED.sprint - SPEED.run) * (v - SPEED0.run) / (SPEED0.sprint - SPEED0.run);
    GAIT.sprint = at(GAIT0.sprint); GAIT.drive = at(GAIT0.drive); GAIT.skid = at(GAIT0.skid);
  };
  if (H.mods) { H.mods.watch(applySpeed); applySpeed(); }

  // ---------------- facing ----------------
  const dirOf = (dx, dy) => ((Math.round(Math.atan2(dx, dy) / (2 * Math.PI / A.ND)) % A.ND) + A.ND) % A.ND;  // ground vector -> facing
  const vecOf = i => [Math.sin(i * 2 * Math.PI / A.ND), Math.cos(i * 2 * Math.PI / A.ND)];
  // facing turns toward a target at a turn rate, stepping through the real rendered facings (no blended sprites)
  function turnToward(target, dt, rate = TURN_RATE) {
    P.turnAcc = (P.turnAcc || 0) + dt * rate;
    const step = 360 / A.ND;
    while (P.face !== target && P.turnAcc >= step) {
      const d = (target - P.face + A.ND) % A.ND; P.face = (P.face + (d <= A.ND / 2 ? 1 : A.ND - 1)) % A.ND; P.turnAcc -= step;
    }
    if (P.face === target) P.turnAcc = Math.min(P.turnAcc, step);
  }
  // ---------------- aiming ----------------
  // Aiming by what you SEE: the sprite camera (20 deg) squashes directions toward/away from the viewer, so the rendered
  // arrows are dense near horizontal and sparse near vertical on screen. Facing/twist are therefore chosen by the
  // rendered arrow's screen angle closest to the cursor, not by the ground angle.
  function screenAim() { const [x, y] = T.toS(P.x, P.y, P.z + AIM_H); return Math.atan2(mouse.y - (y - cam.fy), mouse.x - (x - cam.fx)); }
  // (only poses this atlas really has: a sprite AND its overlay. Atlases differ, e.g. ranger_sim lacks the fine twists)
  function arrowAngle(frame, f) { const d = A.SP[frame] && A.OV[frame]?.[A.DIRS[f]]?.arrow; return d ? Math.atan2(d[0][3] - d[0][1], d[0][2] - d[0][0]) : null; }
  // stick: keep facing `stick` if its best pose is within `slack` rad of the best overall (the torso twist variants
  // absorb small aim changes, so the feet don't step for every little cursor move)
  function bestFacing(frame, fallback, variants = [], stick = -1, slack = 0) {
    const sa = screenAim(); let best = fallback, be = 9, se = 9;
    for (let f = 0; f < A.ND; f++) for (const v of [frame, ...variants]) {
      const ra = arrowAngle(v, f); if (ra === null) continue;
      const e = angDiff(ra, sa);
      if (e < be - (v === frame ? .02 : 0)) { be = e; best = f; }
      if (f === stick) se = Math.min(se, e);
    }
    return stick >= 0 && se <= be + slack ? stick : best;
  }
  // the cursor read at ARROW height, not on the ground: pointing at a target's chest aims at the target itself. With
  // terrain, the higher levels are tried first (they are drawn on top). A host target under the cursor wins.
  function cursorAim() {
    const t = H.aimTarget?.(); if (t) return t;
    for (const h0 of [...plateaus.map(q => q.h), 0]) {
      const x = (mouse.x + cam.x) / T.PPM, y = (mouse.y + cam.y + (h0 + AIM_H) * T.PPMH) / T.PPMY;
      if (elev(x, y) === h0) return {x, y, h: h0 + AIM_H};
    }
    if (H.terrain) { const g = pickGround(AIM_H); if (g) return g; }   // sloping ground (walkable terrain)
    return {x: (mouse.x + cam.x) / T.PPM, y: (mouse.y + cam.y + AIM_H * T.PPMH) / T.PPMY, h: AIM_H};
  }
  // the ground point under the cursor read `lift` m above the ground there, on sloping ground: a damped fixed point from his
  // own height (it settles on any walkable slope: the view rises PPMH / PPMY m on screen per metre of height). null: no settle
  function pickGround(lift) {
    const x = (mouse.x + cam.x) / T.PPM, my = mouse.y + cam.y;
    let h = P.z, y = 0;
    for (let i = 0; i < 12; i++) {
      y = (my + (h + lift) * T.PPMH) / T.PPMY;
      const e = elev(x, y); if (Math.abs(e - h) < .01) return {x, y, h: e + lift};
      h += (e - h) * .6;
    }
    return null;
  }
  const cursorGround = () => { if (H.terrain) { const g = pickGround(0); if (g) return {x: g.x, y: g.y}; } return {x: (mouse.x + cam.x) / T.PPM, y: (mouse.y + cam.y) / T.PPMY}; };
  function moveInput() {
    const dx = (keys.has('d') || keys.has('arrowright')) - (keys.has('a') || keys.has('arrowleft'));
    const dy = (keys.has('s') || keys.has('arrowdown')) - (keys.has('w') || keys.has('arrowup'));
    const l = Math.hypot(dx, dy); return l ? [dx / l, dy / l] : [0, 0];
  }

  // ---------------- actions ----------------
  const dodging = () => P.state === 'roll' || P.state === 'backstep';
  function startRoll() {
    // rolling out of an aim keeps it: remember we were drawn. Aiming and going back (or nothing held): a backstep
    const aiming = P.state === 'draw' && mouse.down;
    let [dx, dy] = moveInput();
    if (aiming) {
      const c = cursorAim(), ax = c.x - P.x, ay = c.y - P.y, al = Math.hypot(ax, ay) || 1;
      if (!dx && !dy) { startBackstep(-ax / al, -ay / al); return; }
      if ((dx * ax + dy * ay) / al < DODGE.backCos) { startBackstep(dx, dy); return; }
    } else if (!dx && !dy) [dx, dy] = vecOf(P.face);
    P.aimRoll = aiming; P.queuedShot = false; P.recover = 0;
    const nd = dirOf(dx, dy), ND = A.ND, deg = ((nd - P.face + ND) % ND) * 360 / ND, left = deg <= 180, m = left ? deg : 360 - deg;
    const set = m <= 112.5 ? 90 : 135, s = left ? 'l' : 'r', a = `turn_${s}${set}a`, b = `turn_${s}${set}b`;
    P.state = 'roll'; P.t = 0; P.rollDev = 0; P.rollLead = null;
    if (!aiming && m >= DODGE.leadMin && Math.hypot(P.vx, P.vy) > DODGE.leadSpeed && has(a) && has(b)) {
      // running, a sharp new way: plant (outside foot) and push (inside foot) first; the roll proper starts at t = 0
      P.rollLead = {frames: [a, b], feet: left ? ['R', 'L'] : ['L', 'R'], i: -1}; P.t = -2 * DODGE.lead;
    }
    P.face = P.want = nd; P.rollDir = vecOf(P.face);
  }
  function startBackstep(dx, dy) {
    const l = Math.hypot(dx, dy) || 1;
    P.rollDir = [dx / l, dy / l]; P.state = 'backstep'; P.t = 0; P.aimRoll = false; P.queuedShot = false; P.recover = 0; P.prevF = -1;
  }
  // WASD during a roll: turn its direction toward the input, within steerMax of where it started (P.rollDev: how far off)
  function steerRoll(mx, my, dt) {
    const D = P.rollDir, cur = Math.atan2(D[0], D[1]), max = DODGE.steerMax * D2R, rate = DODGE.steerRate * D2R * dt;
    const rel = ((Math.atan2(mx, my) - (cur - P.rollDev)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    if (Math.abs(rel) > DODGE.steerIgnore * D2R) return;
    const turn = clamp(clamp(rel, -max, max) - P.rollDev, -rate, rate);
    if (!turn) return;
    P.rollDev += turn; D[0] = Math.sin(cur + turn); D[1] = Math.cos(cur + turn);
    P.face = P.want = dirOf(D[0], D[1]);
  }
  // untouchable: rolling (from the plant on), or the first moment of a backstep (the game's i-frames)
  const untouchable = () => P.state === 'roll' || (P.state === 'backstep' && P.t < DODGE.guard) || thrown.guard() || !!fists?.untouchable();   // (thrown: sim/player/launch.js; a slip: fists.js)
  function shoot() {
    if (gun?.on()) return;   // a gun fires on the press (sim/player/gun.js); a release does nothing here
    const W = WEAPONS.bow;
    const c = cursorAim(); let dx = c.x - P.x, dy = c.y - P.y; let l = Math.hypot(dx, dy) || 1;
    if (P.moveAim) {  // on the move the arrow goes where the body can aim: within +-35 deg of the torso's aim
      const [bx, by] = vecOf(P.bodyAim), a = Math.atan2(dx, dy), b = Math.atan2(bx, by);
      let da = ((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      da = Math.max(-Math.PI * W.cone / 180, Math.min(Math.PI * W.cone / 180, da));   // covers the legs still turning into the
      dx = Math.sin(b + da); dy = Math.cos(b + da); l = 1;                        // stance; never a shot over the shoulder
    }
    const v = W.v0 + Math.min(1, P.t * W.drawK) * W.vDraw;  // longer draw, faster arrow
    const fx = dx / l, fy = dy / l;   // launch from the bow, along the flight line (not the legs' facing)
    // flat at the same level; aimed down / up across levels or at a snapped target (plus the drop over the flight)
    const h0 = P.z + AIM_H, dist = Math.hypot(c.x - P.x, c.y - P.y) || 1;
    const vh = c.target || Math.abs(c.h - h0) > .5 ? Math.max(W.vhMin, Math.min(W.vhMax, (c.h - h0) / (dist / v) + W.lift * dist / v)) : 0;
    const dmg = Math.round(W.dmg0 + Math.min(1, P.t * W.drawK) * W.dmgDraw);   // a full draw hits harder
    H.onShoot({x: P.x + fx * W.muzzle, y: P.y + fy * W.muzzle, h: h0, vx: fx * v, vy: fy * v, vh, life: W.life, dmg, kind: 'arrow'});
    P.twang = 0; PL.shots++; P.t = 0;
    // moving: hold the aiming stance briefly after the shot (rapid fire while strafing never leaves it); standing: release anim
    if (P.moveAim) { P.state = 'draw'; P.recover = .25; } else P.state = 'release';
  }
  // move by (dx, dy); returns the distance actually travelled. H.move (the adapter: world/collide.js, docs/COLLISION.md): move and
  // slide; where something stopped him his velocity turns the way he went, its speed kept while he got a third of the way or more (a
  // glancing slide, a slip round a pot), less the more squarely he met it (none: stopped). Without it (?collide=old): per axis of the
  // view, an axis that meets something stops
  function moveBy(dx, dy, air = false) {
    const w = H.wind ? H.wind() : null;   // a run rule's wind (features/omens.js, a gale; H.wind: the adapter): with it faster, against it slower
    if (w) { const l = Math.hypot(dx, dy); if (l > 1e-9) { const k = Math.max(.3, 1 + (dx * w[0] + dy * w[1]) / l); dx *= k; dy *= k; } }
    if (H.move) {
      const m = H.move(P.x, P.y, dx, dy, P.z, air), ex = m.x - P.x, ey = m.y - P.y, d = Math.hypot(ex, ey);
      P.x = m.x; P.y = m.y;
      if (m.hit) {
        const want = Math.hypot(dx, dy);
        if (d > 1e-9 && want > 1e-9) { const v = Math.hypot(P.vx, P.vy) * Math.min(1, 3 * d / want); P.vx = ex / d * v; P.vy = ey / d * v; }
        else P.vx = P.vy = 0;
      }
      if (!air && d) groundFollow();
      return d;
    }
    let d = 0;
    if (dx && !H.blocked(P.x + dx, P.y, P.z, air)) { P.x += dx; d += dx * dx; } else P.vx = 0;
    if (dy && !H.blocked(P.x, P.y + dy, P.z, air)) { P.y += dy; d += dy * dy; } else P.vy = 0;
    if (!air && d) groundFollow();
    return Math.sqrt(d);
  }
  // on his feet, the ground carries him: up a slope or a small step, down a slope (flat ground and a plateau's top: no change)
  function groundFollow() {
    const e = elev(P.x, P.y), dz = e - P.z;
    if (dz !== 0 && (dz > 0 ? dz <= STEP_UP : dz >= -SNAP)) P.z = e;
  }
  // a footfall's pace for its sound (features/audio.js): his speed where the authored speeds would put it (its place between walk,
  // run and sprint), so a run sounds like a run at whatever m/s the modifiers made it; the speed itself when they changed none
  function pace(v) {
    const a = SPEED, b = SPEED0;
    if (a.walk === b.walk && a.run === b.run && a.sprint === b.sprint) return v;
    if (v <= a.walk) return v * b.walk / a.walk;
    if (v <= a.run) return b.walk + (v - a.walk) * (b.run - b.walk) / Math.max(a.run - a.walk, 1e-3);
    return b.run + (v - a.run) * (b.sprint - b.run) / Math.max(a.sprint - a.run, 1e-3);
  }
  function puff(side, frameName, big = 1) {
    // at the landing foot, read from the rendered bone positions of the contact frame
    ev({type: big > 1 ? 'player.land' : 'player.step', x: P.x, y: P.y, z: P.z, foot: side, big, pace: pace(Math.hypot(P.vx, P.vy))});
    if (!H.dust || !A.SP[frameName]) return;
    const b = A.SP[frameName].bones[A.DIRS[P.face]], f = b[(side === 'L' ? 'Left' : 'Right') + 'Foot'];
    const [sx, sy] = T.toS(P.x, P.y, P.z);
    H.dust(sx - A.PIV[0] + (f[0] + f[2]) / 2, sy - A.PIV[1] + Math.max(f[1], f[3]) + 1, side, big);
  }

  // ---------------- traversal: leap, fall, climb, interact ----------------
  // LEAP (Space toward water). Scans along the direction for the water and the far bank. If the far bank is within
  // reach for the run-up speed (stand 1.9 m, run ~3.0 m, sprint ~3.6 m, from where you are), the leap is stretched to
  // land just past it: no doomed leaps from too far back. Out of reach: a full-reach leap only if you're right at the
  // edge (then you fall in: the wide part needs a sprint); otherwise it's an ordinary roll (which stops at the bank).
  function leapPlan(dx, dy) {
    const sp = Math.hypot(P.vx, P.vy), reach = 1.9 + sp * .24;
    let s0 = -1; for (let d = .05; d <= 1.3; d += .05) if (inStream(P.x + dx * d, P.y + dy * d)) { s0 = d; break; }
    if (s0 < 0) return null;
    let s1 = -1; for (let d = s0; d <= s0 + 5; d += .05) if (!inStream(P.x + dx * d, P.y + dy * d)) { s1 = d; break; }
    const land = s1 + .25, lx = P.x + dx * land, ly = P.y + dy * land;
    // (a leap never lands higher than it started: the plateau's pool lies right under its south face, so the far "bank" there is the cliff's top,
    // and a roll toward the pool from a metre away would turn into a leap that ends against the face, in the water)
    if (s1 > 0 && land <= reach && elev(lx, ly) <= elev(P.x, P.y) + .3 && !H.blocked(lx, ly, elev(lx, ly), false)) {
      const dist = Math.max(1.2, land); return {dist, safe: true, z1: elev(P.x + dx * dist, P.y + dy * dist), gap: s1 - s0};
    }
    if (s0 <= .5) return {dist: reach, safe: false, z1: null, gap: s1 > 0 ? s1 - s0 : -1};
    return null;
  }
  function tryLeap() {
    if (P.z > elev(P.x, P.y) + .05 || BUSY.has(P.state) || !H.inStream) return false;
    let [dx, dy] = moveInput(); if (!dx && !dy) [dx, dy] = vecOf(P.face);
    const plan = leapPlan(dx, dy); if (!plan) return false;
    P.face = P.want = dirOf(dx, dy);
    const dur = .36 + plan.dist * .05;
    P.leap = {x0: P.x, y0: P.y, dx, dy, dist: plan.dist, dur, top: .35 + plan.dist * .12, safe: plan.safe,
      kind: plan.dist >= JUMP.long ? 'long' : 'stride', z1: plan.z1, gap: plan.gap};   // (z1: the far bank's height where he lands; null: short)
    P.state = 'leap'; P.t = 0; P.aimRoll = false; P.vx = dx * plan.dist / dur; P.vy = dy * plan.dist / dur;
    ev({type: 'player.jump', x: P.x, y: P.y, z: P.z});
    return true;
  }
  // a low ledge ahead along (dx, dy): -> {d: metres to where he lands, z: the top's height} or null. The ledge's foot (the ground
  // rising more than a step) within VAULT_REACH, its top no more than VAULT_H up, and level for .3 m where he lands (not a slope
  // running on up), clear of anything solid
  function vaultPlan(dx, dy) {
    if (!H.terrain) return null;
    const z0 = elev(P.x, P.y); let foot = -1;
    if (elev(P.x + dx * VAULT_REACH, P.y + dy * VAULT_REACH) <= z0 + STEP_UP && elev(P.x + dx * .45, P.y + dy * .45) <= z0 + STEP_UP) return null;   // (no ledge: the usual case, two reads)
    for (let d = .1; d <= VAULT_REACH; d += .05) { if (elev(P.x + dx * d, P.y + dy * d) > z0 + STEP_UP) { foot = d; break; } }
    if (foot < 0) return null;
    for (let d = foot; d <= foot + .9; d += .05) {
      const x = P.x + dx * d, y = P.y + dy * d, e = elev(x, y);
      if (e > z0 + VAULT_H) return null;
      const e1 = elev(x + dx * .3, y + dy * .3);
      if (Math.abs(e1 - e) < .06 && e > z0 + STEP_UP) { const l = d + .2; return H.blocked(P.x + dx * l, P.y + dy * l, e, false) ? null : {d: l, z: elev(P.x + dx * l, P.y + dy * l), foot}; }
    }
    return null;
  }
  const vaultDir = () => { let [dx, dy] = moveInput(); if (!dx && !dy) [dx, dy] = vecOf(P.face); return [dx, dy]; };
  // a way over a breach in a stone wall ahead: {d, top, z1} or null (the adapter's H.wallOver)
  const overPlan = (dx, dy) => H.wallOver ? H.wallOver(P.x, P.y, dx, dy, P.z) : null;
  // (the hint: 'up' Space climbs a ledge here, 'over' vaults a breach, false neither)
  const canVault = () => { if (BUSY.has(P.state) || dodging()) return false; const [dx, dy] = vaultDir(); return vaultPlan(dx, dy) ? 'up' : overPlan(dx, dy) ? 'over' : false; };
  // the hand that plants (+1 his left, -1 his right) and how slanted the face is (deg) from {slant (rad), side} | null
  function sideOf(sl) {
    const deg = sl ? sl.slant / D2R : 0;
    return {slant: deg, side: sl && deg > JUMP.slant && sl.side ? sl.side : 1};
  }
  // a ledge's face at its foot, from the ground's slope there (uphill: into the ledge): {slant, side (+1: nearer on his left)}
  function ledgeSlant(dx, dy, foot) {
    if (!H.grad) return null;
    const g = H.grad(P.x + dx * (foot + .05), P.y + dy * (foot + .05), _grad), l = Math.hypot(g[0], g[1]); if (l < 1e-4) return null;
    const ux = g[0] / l, uy = g[1] / l, c = Math.max(-1, Math.min(1, dx * ux + dy * uy)), lr = dy * ux - dx * uy;   // (his left: (dy, -dx))
    return {slant: Math.acos(c), side: lr > .02 ? 1 : lr < -.02 ? -1 : 0};
  }
  function tryVault() {
    if (P.z > elev(P.x, P.y) + .05 || BUSY.has(P.state)) return false;
    const [dx, dy] = vaultDir(), up = vaultPlan(dx, dy), over = up ? null : overPlan(dx, dy), plan = up || over; if (!plan) return false;
    P.face = P.want = dirOf(dx, dy);
    const spd = Math.max(0, P.vx * dx + P.vy * dy);   // (his pace along the way he vaults)
    if (over) {
      const h = over.top - P.z, kind = h <= JUMP.hop ? 'hop' : h <= JUMP.tuck ? 'tuck' : 'over', sl = H.wallSlant ? H.wallSlant(P.x, P.y, dx, dy, over.near) : null;
      const sp = Math.max(spd, JUMP.hopSpeed), dur = kind === 'hop' ? Math.max(JUMP.hopMin, over.d / sp) : kind === 'tuck' ? VAULT_OVER_T : JUMP.overT[0] + JUMP.overT[1] * Math.max(0, h - 1);
      P.vault = {x0: P.x, y0: P.y, dx, dy, d: over.d, z0: P.z, z1: over.z1, top: over.top, kind, h, dur, near: over.near, thick: over.thick,
        exit: kind === 'hop' ? spd : kind === 'tuck' ? spd * JUMP.tuckKeep : 0, ...sideOf(sl)};
    } else {
      const h = plan.z - P.z, kind = h <= JUMP.step ? 'step' : h <= JUMP.knee ? 'knee' : 'climb', T = JUMP[kind + 'T'];
      let d = plan.d;
      if (kind === 'step') {   // (at his pace he carries on further onto the top, where it is clear and level)
        const far = spd * (T[0] + T[1] * h), fx = P.x + dx * far, fy = P.y + dy * far;
        if (far > d && Math.abs(elev(fx, fy) - plan.z) < .08 && !H.blocked(fx, fy, plan.z, false)) d = far;
      }
      P.vault = {x0: P.x, y0: P.y, dx, dy, d, z0: P.z, z1: plan.z, kind, h, dur: T[0] + T[1] * h, near: plan.foot, thick: 0,
        exit: kind === 'step' ? spd : kind === 'knee' ? spd * JUMP.kneeKeep : 0, ...sideOf(ledgeSlant(dx, dy, plan.foot))};
    }
    P.state = 'vault'; P.t = 0; P.aimRoll = false; P.vx = P.vy = 0;
    ev({type: 'player.jump', x: P.x, y: P.y, z: P.z});
    return true;
  }
  // a vault's end: on the ground there; with a direction held he goes on at the pace the kind keeps (V.exit: the step and
  // the hop all of it), else he stands
  function endVault(V) {
    P.z = elev(P.x, P.y); P.vault = null; P.t = 0; P.prevF = -1;
    const [mx, my] = moveInput(), ex = (mx || my) ? V.exit || 0 : 0;
    P.vx = V.dx * ex; P.vy = V.dy * ex; P.curSpeed = P.lastSpeed = ex;
    if (ex > 2.3) { P.state = 'move'; P.gait = 'run'; P.ph = .02; P.prevF = 'run0'; P.frame = 'run.0'; }
    else P.state = 'idle';
  }
  function startFall() { P.state = 'fall'; P.t = 0; P.vz = 0; P.fall0 = P.z; P.vx *= .8; P.vy *= .8; P.aimRoll = false; }
  function land(drop) {
    const [mx, my] = moveInput(), sp = Math.hypot(P.vx, P.vy);
    if (drop > LAND.big && (mx || my) && sp > JUMP.rollSpeed && has('roll.0')) { landRoll(sp); return; }
    P.state = 'land'; P.t = 0; P.z = elev(P.x, P.y); P.landDur = drop > LAND.big ? LAND.hard : LAND.soft;
    const f = A.SP[P.frame] ? P.frame : 'idle.0';
    puff('L', f, 2); puff('R', f, 1);
    if (drop > LAND.big) { H.shake?.(2, .18); ev({type: 'player.land', x: P.x, y: P.y, z: P.z, big: 3}); }
  }
  // a big drop while running: the landing goes into a roll the way he was going (a roll's own steering, its speed easing from
  // his down to the run's: P.rollV0), no hard stop
  function landRoll(sp) {
    P.z = elev(P.x, P.y);
    const f = A.SP[P.frame] ? P.frame : 'idle.0'; puff('L', f, 2); puff('R', f, 1);
    ev({type: 'player.land', x: P.x, y: P.y, z: P.z, big: 2}); H.shake?.(1, .1);
    P.rollDir = [P.vx / sp, P.vy / sp]; P.face = P.want = dirOf(P.vx, P.vy);
    P.state = 'roll'; P.t = 0; P.rollDev = 0; P.rollLead = null; P.aimRoll = false; P.queuedShot = false; P.recover = 0; P.rollV0 = sp;
  }
  // a leap that came up short: the far bank's lip within JUMP.reach m ahead, its top no more than 1.4 m over the water's bed and
  // clear: he catches it and climbs out (a vault of kind 'catch'); -> false: none (he falls in)
  function catchBank(L) {
    for (let s = 0; s <= JUMP.reach; s += .05) {
      if (inStream(P.x + L.dx * s, P.y + L.dy * s)) continue;
      const l = s + .3, bx = P.x + L.dx * l, by = P.y + L.dy * l, z1 = elev(bx, by), zb = elev(P.x, P.y);
      if (z1 - zb > 1.4 || inStream(bx, by) || H.blocked(bx, by, z1, false)) return false;
      P.vault = {x0: P.x, y0: P.y, dx: L.dx, dy: L.dy, d: l, z0: zb, z1, kind: 'catch', h: z1 - zb, dur: JUMP.catchT, near: s, thick: 0, exit: 0, slant: 0, side: 1};
      P.state = 'vault'; P.t = 0; P.vx = P.vy = 0; P.z = Math.max(zb + .08, z1 - 1.35);
      ev({type: 'player.splash', x: P.x, y: P.y, small: true});
      return true;
    }
    return false;
  }
  function splash(backTo) {
    if (water(P.x, P.y)) { startSwim(true); return; }   // (water to swim in: SWIM)
    P.state = 'splash'; P.t = 0; P.z = 0; P.back = backTo;
    ev({type: 'player.splash', x: P.x, y: P.y}); H.shake?.(1, .12);
  }
  // Where a FALL that ended in the water puts you back: behind the landing, against the drift. Off the plateau's south edge at the fall that
  // spot can be water too (the pool under the waterfall is wider than the drift), so it goes on back, a body's length past the water's edge:
  // onto the plateau, where you stepped off. Anywhere else the first spot is dry and is used as it is
  function dryBack(bx, by, vx, vy) {
    const l = Math.hypot(vx, vy);
    if (!inStream(bx, by) || l < .05) return [bx, by];
    const ux = vx / l, uy = vy / l;
    for (let d = .1; d <= 6; d += .1) {
      const x = bx - ux * d, y = by - uy * d;
      if (!inStream(x, y)) { const x2 = x - ux * .3, y2 = y - uy * .3; return H.blocked(x2, y2, elev(x2, y2), true) ? [x, y] : [x2, y2]; }
    }
    return [bx, by];
  }
  // SWIM: WV = H.water's answer, copied (the host reuses its array)
  const WV = [0, 0, 0];
  function water(x, y) { const w = H.water?.(x, y); if (!w) return false; WV[0] = w[0]; WV[1] = w[1]; WV[2] = w[2]; return true; }
  function startSwim(fell) {   // (WV: the water there)
    const sp = Math.hypot(P.vx, P.vy), k = fell ? .35 : .7;
    P.state = 'swim'; P.t = 0; P.z = WV[0]; P.vz = 0; P.leap = null; P.vault = null; P.aimRoll = false; P.queuedShot = false; P.rollV0 = 0; P.turn = null; P.skid = 0;
    P.svx = P.vx * k; P.svy = P.vy * k; P.swimPh = 0; P.kickT = 0; P.strokeT = 0;
    if (fell) P.sink = SWIM.sink + SWIM.dunk;   // (under for a moment, then up)
    ev({type: 'player.splash', x: P.x, y: P.y, small: !fell && sp < SWIM.bigIn, swim: true}); if (fell) H.shake?.(1, .12);
  }
  function outOfWater() {   // onto the shelf or the bank: on his feet, walking on (the sink eases off in step)
    P.z = elev(P.x, P.y); P.state = 'idle'; P.t = 0; P.prevF = -1; P.svx = P.svy = 0; P.curSpeed = P.lastSpeed = Math.hypot(P.vx, P.vy);
    ev({type: 'player.splash', x: P.x, y: P.y, small: true, out: true});
  }
  function swimStep(dt) {
    if (!water(P.x, P.y)) { outOfWater(); return; }   // (the water went from under him: a crate sunk to a stepping stone)
    const [mx, my] = moveInput(), top = (keys.has('shift') ? SWIM.fast : SWIM.speed) * SPEED.run / SPEED0.run;
    if (mx || my) {
      const dx = mx * top - P.svx, dy = my * top - P.svy, d = Math.hypot(dx, dy), a = SWIM.acc * dt;
      if (d > a) { P.svx += dx / d * a; P.svy += dy / d * a; } else { P.svx += dx; P.svy += dy; }
      P.want = dirOf(mx, my);
    } else { const k = Math.exp(-SWIM.drag * dt); P.svx *= k; P.svy *= k; }
    turnToward(P.want ?? P.face, dt, SWIM.turn);
    if (P.kickT > 0) P.kickT -= dt;
    P.vx = P.svx + WV[1]; P.vy = P.svy + WV[2];
    const x0 = P.x, y0 = P.y, z0 = WV[0];
    moveBy(P.vx * dt, P.vy * dt, true);   // (air: the water is no wall; a bank more than STEP_UP over him is)
    if (!inStream(P.x, P.y)) {
      if (elev(P.x, P.y) >= z0 - STEP_UP) { outOfWater(); return; }
      P.x = x0; P.y = y0; P.svx = P.svy = P.vx = P.vy = 0;   // (a drop beyond: over a fall's edge. Held back)
    } else if (!water(P.x, P.y)) { P.x = x0; P.y = y0; P.svx = P.svy = P.vx = P.vy = 0; }   // (not to be swum: a fall's lip)
    water(P.x, P.y); P.z = WV[0];
    const want = SWIM.sink + SWIM.bob * Math.sin(P.t * SWIM.bobHz * 2 * Math.PI);
    P.sink = (P.sink || 0) + (want - (P.sink || 0)) * Math.min(1, dt * SWIM.settle);
    const sv = Math.hypot(P.svx, P.svy), W = A.CLIP.walk; P.gait = 'walk'; P.curSpeed = sv;
    if (sv > SWIM.still) {   // the arms: the walk's cycle by the distance swum
      const ph0 = P.swimPh; P.swimPh = (ph0 + sv * dt / SWIM.stroke) % 1; P.strokeT = 0;
      P.frame = W && has('walk.0') ? `walk.${Math.floor(P.swimPh * W.frames) % W.frames}` : 'idle.0';
      if ((ph0 < .5) !== (P.swimPh < .5)) ev({type: 'player.stroke', x: P.x, y: P.y, z: P.z, pace: sv, vx: P.svx, vy: P.svy});
    } else {   // treading water
      P.frame = 'idle.0';
      if ((P.strokeT += dt) > SWIM.tread) { P.strokeT = 0; ev({type: 'player.stroke', x: P.x, y: P.y, z: P.z, pace: sv, tread: true}); }
    }
  }
  function swimKick() {
    if (P.kickT > 0) return;
    const [mx, my] = moveInput(), [fx, fy] = mx || my ? [mx, my] : vecOf(P.face);
    P.svx += fx * SWIM.kick; P.svy += fy * SWIM.kick; P.kickT = SWIM.kickCd; P.want = dirOf(fx, fy);
    ev({type: 'player.stroke', x: P.x, y: P.y, z: P.z, pace: Math.hypot(P.svx, P.svy), vx: P.svx, vy: P.svy, big: true});
  }
  function climbSpot() {   // a climb spot within reach: from below (up) or from the top (down)
    for (const c of climbs) {
      if (Math.abs(P.x - c.x) > c.w / 2 + .45) continue;
      if (P.z < c.h0 + .05 && P.y >= c.y - .05 && P.y < c.y + 1.3) return {c, dir: 1};
      if (Math.abs(P.z - c.h1) < .05 && P.y <= c.y && P.y > c.y - 1.3) return {c, dir: -1};
    }
    return null;
  }
  const nearInteract = () => H.nearInteract?.(P) || null;
  function interact() {
    if (BUSY.has(P.state) || dodging()) return false;
    const p = nearInteract(); if (p) return !!H.onInteract?.(p);
    const cs = climbSpot(); if (!cs) return false;
    P.climb = cs; P.state = 'climb'; P.t = 0; P.vx = P.vy = 0; P.face = P.want = A.ND / 2;   // face the wall (N)
    P.x = cs.c.x; return true;
  }
  function stepTraverse(dt) {   // returns true when it handled this frame
    if (thrown.step(dt)) return true;   // thrown by a blast (sim/player/launch.js)
    if (!BUSY.has(P.state) && inStream(P.x, P.y) && water(P.x, P.y)) startSwim(false);   // walked or rolled into deep water (SWIM)
    if (P.state === 'swim') { swimStep(dt); return true; }
    // walked or rolled off a ledge: fall (any edge; climbing UP needs a climb spot)
    if (!BUSY.has(P.state) && P.z > elev(P.x, P.y) + .05) startFall();
    if (H.grad && !BUSY.has(P.state) && !dodging() && H.grad(P.x, P.y, _grad)[2] > SLIDE.on && _grad[2] < SLIDE.cliff) {   // (a bank: still steep half a metre on down it, not a small step)
      const k = .5 / _grad[2]; if (H.grad(P.x - _grad[0] * k, P.y - _grad[1] * k, _grad)[2] > SLIDE.off) { P.state = 'slide'; P.t = 0; P.aimRoll = false; }
    }
    if (P.state === 'slide') {   // down the bank: pulled along its fall line, a little steering, friction; off it where it eases
      const g = H.grad(P.x, P.y, _grad), sl = g[2], [ix, iy] = moveInput();
      if (sl > 1e-4) { const a = SLIDE.g * sl / Math.sqrt(1 + sl * sl) * Math.SQRT2; P.vx -= g[0] / sl * a * dt; P.vy -= g[1] / sl * a * dt; }
      P.vx += ix * SLIDE.steer * dt; P.vy += iy * SLIDE.steer * dt;
      const damp = Math.exp(-dt * SLIDE.fric), sp = Math.hypot(P.vx, P.vy), cap = sp > SLIDE.max ? SLIDE.max / sp : 1; P.vx *= damp * cap; P.vy *= damp * cap;
      const z0 = P.z; moveBy(P.vx * dt, P.vy * dt, true); const e = elev(P.x, P.y);
      if (e < z0 - .5) { P.z = z0; startFall(); return true; }   // (over an edge: a fall)
      P.z = e;
      if (Math.hypot(P.vx, P.vy) > .6) P.face = P.want = dirOf(P.vx, P.vy);
      P.frame = A.SP.crouch ? 'crouch' : 'lunge';
      if (sl < SLIDE.off && P.t > .15) { P.state = 'idle'; P.t = 0; P.prevF = -1; puff('L', P.frame, 1); }
      return true;
    }
    if (P.state === 'leap') {
      const L = P.leap, k = Math.min(1, P.t / L.dur), z0 = elev(L.x0, L.y0), z1 = L.z1 ?? z0;
      moveBy(P.vx * dt, P.vy * dt, true);
      P.z = z0 + (z1 - z0) * k + 4 * L.top * k * (1 - k);
      P.frame = has('leap.1') ? `leap.${k < .15 ? 0 : k < .5 ? 1 : k < .85 ? 2 : 3}` : k < .12 || k > .9 ? 'crouch' : 'lunge';
      if (k >= 1) { if (inStream(P.x, P.y)) { if (!catchBank(L)) splash([L.x0, L.y0]); } else land(Math.max(0, z0 + L.top * .5 - elev(P.x, P.y))); }
      return true;
    }
    if (P.state === 'splash') {   // fell in: sink for a moment, then back on the bank you came from
      P.frame = 'crouch'; P.sink = Math.min(1, P.t / .35);
      if (P.t > .6) { [P.x, P.y] = P.back; P.z = elev(P.x, P.y); P.vx = P.vy = 0; P.sink = 0; P.state = 'idle'; P.t = 0; P.blink = .6; }
      return true;
    }
    if (P.state === 'fall') {
      P.vz -= 24 * dt; P.z += P.vz * dt; const x0 = P.x, y0 = P.y; moveBy(P.vx * dt, P.vy * dt, true);
      P.frame = has('fall') ? 'fall' : 'lunge';
      const e = elev(P.x, P.y);
      if (P.z <= e) { if (inStream(P.x, P.y)) splash(dryBack(x0 - P.vx * .3, y0 - P.vy * .3, P.vx, P.vy)); else land(P.fall0 - e); }
      return true;
    }
    if (P.state === 'land') {
      const [mx, my] = moveInput(), dur = P.landDur ?? LAND.soft;
      if (!(mx || my) || dur > LAND.soft) { const damp = Math.exp(-dt * 14); P.vx *= damp; P.vy *= damp; }   // (soft, a direction held: running on)
      moveBy(P.vx * dt, P.vy * dt);
      P.frame = has('land') ? 'land' : 'crouch';
      if (P.t > dur) { P.state = 'idle'; P.t = 0; P.prevF = -1; }
      return true;
    }
    if (P.state === 'climb') {
      if (ladder.step(dt)) return true;   // under his control (sim/player/ladder.js; ?ladder=old: this automatic climb)
      const C = P.climb, Hh = C.c.h1, face = C.c.y + .05, top = C.c.y - C.c.reach, CL = A.CLIP.climb;
      // (down: to the ground where he steps off, a hand out from the face: under a ladder on a hill it lies lower than the climb's foot)
      const H0 = C.dir > 0 ? C.c.h0 : Math.min(C.c.h0, elev(C.c.x, face + .35)), CT = CLIMB_T * Math.max(1, (Hh - H0) / 2.4);
      const climbF = has('climb.0') ? `climb.${Math.floor(P.t * (CL?.fps || 7)) % (CL?.frames || 4)}` : Math.floor(P.t / .2) % 2 ? 'reach_up' : 'idle.0';
      const mantleF = has('mantle.0') ? 'mantle.0' : 'crouch';
      if (C.dir > 0) {   // up the face, then mantle over the lip
        if (P.t < CT) { P.y = face; P.z = H0 + (Hh - H0) * (P.t / CT); P.frame = climbF; }
        else { const k = Math.min(1, (P.t - CT) / MANTLE_T); P.z = Hh; P.y = face + (top - face) * k; P.frame = mantleF; if (k >= 1) { P.state = 'idle'; P.t = 0; } }
      } else {           // over the lip, then down the face
        if (P.t < MANTLE_T) { const k = P.t / MANTLE_T; P.z = Hh; P.y = top + (face - top) * k; P.frame = mantleF; }
        else {
          const k = Math.min(1, (P.t - MANTLE_T) / CT); P.y = face; P.z = H0 + (Hh - H0) * (1 - k); P.frame = climbF;
          if (k >= 1) { P.z = H0; P.y = face + .35; P.state = 'idle'; P.t = 0; P.face = P.want = 0; }
        }
      }
      return true;
    }
    if (P.state === 'vault' && P.vault?.top !== undefined) {   // over a breach: up over its stones and down beyond, moving on through it
      const V = P.vault, k = Math.min(1, P.t / (V.dur || VAULT_OVER_T)), sm = t => t * t * (3 - 2 * t), K = V.kind || 'tuck';
      if (K === 'hop') {   // a hand on the stones, the legs swung past: straight through at his pace, just clearing them
        const zc = Math.max(V.z0, V.z1, V.top + .06);
        P.z = k < .4 ? V.z0 + (zc - V.z0) * sm(k / .4) : zc + (V.z1 - zc) * sm((k - .4) / .6);
        const f = V.d * k; P.x = V.x0 + V.dx * f; P.y = V.y0 + V.dy * f;
      } else if (K === 'over') {   // up onto the stones (a knee), a moment on top, then down the far side
        const on = Math.min(V.d, V.near + V.thick * .5), f = k < .45 ? on * sm(k / .45) : k < .55 ? on : on + (V.d - on) * sm((k - .55) / .45);
        P.z = k < .4 ? V.z0 + (V.top - V.z0) * sm(k / .4) : k < .55 ? V.top : V.top + (V.z1 - V.top) * ((k - .55) / .45) ** 2;
        P.x = V.x0 + V.dx * f; P.y = V.y0 + V.dy * f;
      } else {
        const zc = Math.max(V.z0, V.z1, V.top + OVER_LIFT);
        P.z = k < .45 ? V.z0 + (zc - V.z0) * sm(k / .45) : zc + (V.z1 - zc) * sm((k - .45) / .55) ** 1.6;
        const f = V.d * (k * .35 + .65 * sm(k)); P.x = V.x0 + V.dx * f; P.y = V.y0 + V.dy * f;
      }
      // (the leap's frames, facing his way: the climbing frames face the wall, his back to the camera when he vaults toward it)
      P.frame = K === 'over' && k < .55 ? (k < .4 && has('mantle.0') ? 'mantle.0' : 'crouch')
        : has('leap.1') ? `leap.${k < .15 ? 0 : k < .45 ? 1 : k < .78 ? 2 : 3}` : k < .12 || k > .9 ? 'crouch' : 'lunge';
      if (k >= 1) {
        puff('L', A.SP.crouch ? 'crouch' : 'idle.0', 2); puff('R', A.SP.crouch ? 'crouch' : 'idle.0', 1);
        ev({type: 'player.land', x: P.x, y: P.y, z: elev(P.x, P.y)});
        endVault(V);
      }
      return true;
    }
    if (P.state === 'vault') {   // up onto the ledge: the body rises first, then he steps forward onto the top
      const V = P.vault, K = V.kind || 'climb', k = Math.min(1, P.t / (V.dur || VAULT_T)), sm = t => t * t * (3 - 2 * t);
      if (K === 'step') {   // a foot onto it and up, at his pace
        const up = Math.min(1, k / .55); P.z = V.z0 + (V.z1 - V.z0) * sm(up);
        const f = V.d * k; P.x = V.x0 + V.dx * f; P.y = V.y0 + V.dy * f;
        P.frame = has('leap.1') ? (k < .45 ? 'leap.0' : 'leap.3') : 'lunge';
      } else if (K === 'catch') {   // hanging from the lip (his legs in the water), then up and out
        const hang = JUMP.catchHang / V.dur, zh = Math.max(V.z0 + .08, V.z1 - 1.35), up = Math.max(0, Math.min(1, (k - hang) / (.75 - hang))), on = Math.max(0, (k - .45) / .55);
        P.z = zh + (V.z1 - zh) * sm(up);
        const f = V.d * sm(on); P.x = V.x0 + V.dx * f; P.y = V.y0 + V.dy * f;
        P.frame = k < hang ? (has('reach_up') ? 'reach_up' : 'crouch') : k < .7 ? (has('mantle.0') ? 'mantle.0' : 'crouch') : 'crouch';
      } else {   // knee (a hand and a knee: up sooner, onto it later) and climb (both hands, the chest over)
        const kn = K === 'knee', up = Math.min(1, k / (kn ? .6 : .55)), on = Math.max(0, (k - (kn ? .25 : .22)) / (kn ? .75 : .78));
        P.z = V.z0 + (V.z1 - V.z0) * sm(up);
        const f = V.d * sm(on); P.x = V.x0 + V.dx * f; P.y = V.y0 + V.dy * f;
        P.frame = k < .55 ? (has('mantle.0') ? 'mantle.0' : has('reach_up') ? 'reach_up' : 'crouch') : 'crouch';
      }
      if (k >= 1) { puff('L', A.SP.crouch ? 'crouch' : 'idle.0', 1); endVault(V); }
      return true;
    }
    if (P.state === 'hold') {   // a pose held briefly (abilities)
      const damp = Math.exp(-dt * 16); P.vx *= damp; P.vy *= damp; moveBy(P.vx * dt, P.vy * dt);
      P.frame = P.hold.frame; if (P.t >= P.hold.sec) { P.state = 'idle'; P.t = 0; }
      return true;
    }
    if (P.state === 'knock') {
      const damp = Math.exp(-dt * 7); P.vx *= damp; P.vy *= damp; moveBy(P.vx * dt, P.vy * dt);
      P.frame = 'skid_b'; if (P.t > .28) { P.state = 'idle'; P.t = 0; }
      return true;
    }
    return false;
  }

  // ---------------- pivoting on the spot while aiming ----------------
  // Standing and turning to aim, the feet STEP around instead of the whole body spinning on the spot: the legs play
  // a stepping cycle (for now the walk-with-full-draw frames ws_0_*, in place, no movement), one step per 90 deg turned,
  // at most PIVOT_RATE cycles/s so a quick turn finishes its steps just after. Then the feet come together (a passing
  // frame) and it's back to the standing draw. Dedicated pivot-step frames (aim_pivot.0-7) are used when an atlas has them.
  const PIVOT_RATE = 3.2, PIVOT_SLACK = 8 * Math.PI / 180;
  function pivotFeet(f0, dt) {
    const ND = A.ND, turned = ((P.face - f0 + ND + ND / 2) % ND) - ND / 2;
    if (turned) { P.pivotDebt = (P.pivotDebt || 0) + Math.abs(turned) * (360 / ND) / 90 * .5; P.pivotSettle = false; }
    if (!(P.pivotDebt > 0)) return;
    const clip = has('aim_pivot.0') ? 'aim_pivot.' : has('ws_0_0') ? 'ws_0_' : null;
    if (!clip) { P.pivotDebt = 0; return; }
    const adv = Math.min(P.pivotDebt, dt * PIVOT_RATE);
    P.pivotDebt -= adv; P.pivotPh = ((P.pivotPh ?? .25) + adv) % 1;
    if (P.pivotDebt <= 1e-6) {
      if (!P.pivotSettle) {   // finish on the next passing frame (feet close together)
        const next = P.pivotPh <= .25 ? .25 : P.pivotPh <= .75 ? .75 : 1.25;
        P.pivotDebt = next - P.pivotPh; P.pivotSettle = true;
        if (P.pivotDebt < .02) { P.pivotDebt = 0; P.pivotSettle = false; P.pivotPh = next % 1; return; }
      } else { P.pivotSettle = false; P.pivotDebt = 0; return; }
    }
    const f = Math.floor(P.pivotPh * 8 + 1e-6) % 8;
    if (A.SP[clip + f]) P.frame = clip + f;
  }

  // ---------------- standing at full draw: torso twist first, then the feet ----------------
  // The legs stay planted and the torso takes the aim (twist poses up to +-45 deg, facing = the LEGS). Only when the
  // aim leaves that range do the feet move: a SLOW sweep re-plants one foot 45 deg (aim_step_*, facing = the torso,
  // which stays on target), a quick FLICK spins on the balls of the feet (aim_pivot_*, facing = the final aim). Which
  // one is decided by how fast the aim moves on screen. Used as soon as an atlas has the poses; otherwise returns false
  // and the older behaviour (+-11 deg twists, walk-legs stepping) runs.
  const TWISTS = [['aim_tw_m45', -45], ['aim_tw_m34', -33.75], ['aim_tw_m22', -22.5], ['draw_m11', -11.25], ['draw.2', 0],
    ['draw_p11', 11.25], ['aim_tw_p22', 22.5], ['aim_tw_p34', 33.75], ['aim_tw_p45', 45]];
  const TWIST_TOL = 7 * Math.PI / 180;     // aim error still covered by the twist poses
  const FLICK = 6;                         // rad/s of cursor angle around the player: faster = a flick
  const ACLIP = {step: {frames: 4, fps: 16}, pivot: {frames: 3, fps: 24}};
  function trackAimSpeed(dt) {
    const sa = screenAim(), v = P.lastSa === undefined ? 0 : angDiff(sa, P.lastSa) / Math.max(dt, 1e-3);
    P.lastSa = sa; P.aimSpeed = (P.aimSpeed || 0) * .6 + v * .4;
  }
  function standingAim(dt) {
    if (!(has('aim_tw_p22') || has('aim_step_l.0') || has('aim_pivot_l.0'))) return false;
    if (P.aclip) {   // a step / pivot in progress: play it out (the torso already faces the aim)
      const C = P.aclip, D = ACLIP[C.kind]; C.t += dt;
      const i = Math.floor(C.t * D.fps);
      if (i < D.frames) { P.frame = `aim_${C.kind}_${C.side}.${i}`; return true; }
      P.aclip = null;
    }
    const sa = screenAim(); let tw = 'draw.2', be = 9;
    for (const [nm] of TWISTS) { const ra = arrowAngle(nm, P.face); if (ra !== null && angDiff(ra, sa) < be) { be = angDiff(ra, sa); tw = nm; } }
    P.pivotDebt = 0;
    if (be <= TWIST_TOL) { P.frame = tw; return true; }   // the torso reaches it: the feet stay put
    // out of reach: where the legs should point (twist 0 on target), and how far that is
    const c = cursorAim(), ND = A.ND, Lt = bestFacing('draw.2', dirOf(c.x - P.x, c.y - P.y));
    const delta = ((Lt - P.face + ND + ND / 2) % ND) - ND / 2, side = delta > 0 ? 'l' : 'r';   // + = to his left
    // only move the feet if another leg facing really aims better (near vertical on screen the rendered angles are
    // sparse, so even the best pose can miss by more than the tolerance)
    let bL = 9; for (const [nm] of TWISTS) { const ra = arrowAngle(nm, Lt); if (ra !== null) bL = Math.min(bL, angDiff(ra, sa)); }
    if (!delta || be - bL < 4 * Math.PI / 180) { P.frame = tw; return true; }
    const flick = P.aimSpeed > FLICK || Math.abs(delta) * 360 / ND >= 100;
    if (flick && has(`aim_pivot_${side}.0`)) {           // spin on the balls of the feet straight onto the aim
      P.face = P.want = Lt; P.aclip = {kind: 'pivot', side, t: 0}; P.frame = `aim_pivot_${side}.0`; return true;
    }
    if (has(`aim_step_${side}.0`)) {                      // re-plant one foot 45 deg; the torso turns with it
      const n = Math.sign(delta) * Math.min(Math.abs(delta), Math.round(ND / 8));
      P.face = P.want = (P.face + n + ND) % ND; P.aclip = {kind: 'step', side, t: 0}; P.frame = `aim_step_${side}.0`; return true;
    }
    // twist poses but no step / pivot frames yet: legs turn at the aim rate with the walk-leg stepping
    const f0 = P.face; P.want = Lt; turnToward(Lt, dt, AIM_TURN_RATE);
    let t2 = 'draw.2', b2 = 9;
    for (const [nm] of TWISTS) { const ra = arrowAngle(nm, P.face); if (ra !== null && angDiff(ra, sa) < b2) { b2 = angDiff(ra, sa); t2 = nm; } }
    P.frame = t2; pivotFeet(f0, dt);
    return true;
  }

  // ---------------- the frame ----------------
  function step(dt) {
    const {SP, CLIP} = A, WALK = CLIP.walk, RUN = CLIP.run, ND = A.ND;
    const [mx, my] = moveInput();
    P.t += dt; P.twang = (P.twang ?? 9) + dt; if (P.blink) P.blink = Math.max(0, P.blink - dt); thrown.tick(dt);
    if (P.sink && P.state !== 'swim' && P.state !== 'splash') P.sink = Math.max(0, P.sink - dt * SWIM.sink / SWIM.rise);   // (out of the water: rising out of it)
    if (ropewall && ropewall.step(dt, mx, my)) return;   // on a rope against a face (sim/player/ropewall.js; nothing while he isn't)
    if (fists && fists.step(dt, mx, my)) return;   // the fists up: the guard, a punch, a slip, a clinch (sim/player/fists.js; nothing while they're down)
    if (brawl && brawl.step(dt, mx, my)) return;   // a boot, a barge, a lift, a throw (sim/player/brawl.js; nothing while it's idle)
    if (tool && tool.step(dt, mx, my)) return;   // a tool's swing: the axe (sim/player/tool.js; nothing while it isn't swinging)
    if (lasso && lasso.step(dt, mx, my)) return;   // the lasso in his hands (sim/player/lasso.js; nothing while it's idle)
    if (gun && gun.step(dt, mx, my)) return;   // a gun loadout: the revolver drives the frame while it's in hand (sim/player/gun.js)
    if (stepTraverse(dt)) return;
    if (P.state === 'roll' && P.t < 0) {
      // the plant-and-turn into it (startRoll): the run's turn frames, the momentum biting into the plant
      const L = P.rollLead, fi = Math.min(1, Math.floor((P.t + 2 * DODGE.lead) / DODGE.lead));
      if (fi !== L.i) { L.i = fi; puff(L.feet[fi], L.frames[fi], fi ? 1 : 2); }
      const bite = fi ? .8 : .35; moveBy(P.vx * bite * dt, P.vy * bite * dt);
      P.frame = L.frames[fi];
      return;
    }
    if (P.state === 'roll') {
      const R = CLIP.roll, dur = R.frames / R.fps, k = Math.min(1, P.t / dur);
      const held = !!(mx || my), exit = held ? (keys.has('shift') ? SPEED.run + 1 : SPEED.run) : 1.2;
      if (held && k < DODGE.steerEnd) steerRoll(mx, my, dt);
      const v0 = P.rollV0 ? Math.max(exit, P.rollV0) : 8.6, sp = exit + (v0 - exit) * (1 - k) * (1 - k);   // quick launch (a landing's: his speed), then ease DOWN TO the exit speed (no stop)
      moveBy(P.rollDir[0] * sp * dt, P.rollDir[1] * sp * dt);
      P.frame = `roll.${Math.min(R.frames - 1, Math.floor(P.t * R.fps))}`;
      if (P.t >= dur) {
        P.vx = P.rollDir[0] * exit; P.vy = P.rollDir[1] * exit; P.curSpeed = P.lastSpeed = exit; P.rollV0 = 0;
        if (mouse.down || P.queuedShot) {
          // come out of the roll straight into full draw (no re-draw); a release during the roll fires right now
          P.state = 'draw'; P.t = 1; P.moveAim = false; P.snapFace = true;   // land already in the aiming stance
          const c = cursorAim(); P.want = dirOf(c.x - P.x, c.y - P.y);
          if (P.queuedShot) { P.queuedShot = false; P.moveAim = held; shoot(); }
        } else if (held) {
          // straight into the run, already at speed; the roll's rise pose has the left leg forward = the run's
          // left heel strike, so the stride continues from there instead of restarting from a stand
          P.state = 'move'; P.gait = 'run'; P.ph = .02; P.prevF = 'run0'; P.frame = 'run.0'; P.t = 0;
        } else { P.state = 'idle'; P.t = 0; }
        P.aimRoll = false;
      }
      return;
    }
    if (P.state === 'backstep') {
      // aiming, going back: a quick shuffle on the drawn bow, facing the target. The legs: the run-with-full-draw
      // cycle (rs_0_*) run backwards by the distance covered (a dedicated backstep clip can replace it)
      const B = DODGE, k = Math.min(1, P.t / B.backDur), held = !!(mx || my);
      const sp = Math.max(held ? B.backExit : 0, 3 * B.backDist / B.backDur * (1 - k) * (1 - k));   // a hard push, easing out
      P.vx = P.rollDir[0] * sp; P.vy = P.rollDir[1] * sp;
      const d = moveBy(P.vx * dt, P.vy * dt);
      const c = cursorAim(); P.want = bestFacing('draw.2', dirOf(c.x - P.x, c.y - P.y)); turnToward(P.want, dt, AIM_TURN_RATE);
      const pre = SP['rs_0_0'] ? 'rs' : 'ws', C = pre === 'rs' ? RUN : WALK, fa = P.face * 2 * Math.PI / ND;
      P.ph = ((P.ph + (P.rollDir[0] * Math.sin(fa) + P.rollDir[1] * Math.cos(fa)) * d / C.stride) % 1 + 1) % 1;
      const at = P.ph * C.stride; let f = 0; while (f < C.frames - 1 && at >= C.cum[f + 1]) f++;
      const name = `${pre}_0_${f}`, key = 'back' + f;
      if (key !== P.prevF) { const ci = C.contacts.indexOf(f); if (ci >= 0 && P.prevF !== -1 && SP[name]) puff(C.contact_foot[ci], name, 0); P.prevF = key; }
      P.frame = SP[name] ? name : `draw.${CLIP.draw.frames - 1}`;
      if (k >= 1) {
        if (mouse.down || P.queuedShot) {
          // land still at full draw; carry on backing up if a direction is held. A release during it fires now
          P.state = 'draw'; P.t = 1; P.moveAim = held; P.aimBack = true; P.stanceAge = 0; P.bodyAim = P.face;   // (twist 0)
          if (P.queuedShot) { P.queuedShot = false; shoot(); }
        } else { P.state = 'idle'; P.t = 0; }
      }
      return;
    }
    if (P.state === 'draw' && !mouse.down && P.recover > 0) {   // the short hold after a moving shot (before the
      // moving-aim branch below, which returns early)
      P.recover -= dt;
      if (!(mx || my)) { P.state = 'release'; P.t = 0; P.recover = 0; }
      else if (P.recover <= 0) { P.state = 'idle'; P.moveAim = false; P.fromAim = true; }   // then turn back smoothly
    }
    if (P.state === 'draw' && (mx || my) && SP['ws_0_0']) {
      // moving + shooting. A stance = legs running forward or backing up, angled up to 45 deg off the movement (like a
      // strafe), plus an upper-body twist of 0..90 deg to the character's left (bow in the left hand; never over the
      // shoulder). Together they reach every aim direction. Cost: leg angle, running forward with the target behind (he
      // should back up then), and switching stance (so it doesn't flicker).
      const c = cursorAim(), aim = dirOf(c.x - P.x, c.y - P.y), mv = dirOf(mx, my);
      const Q = ND / 4, HALF = ND / 2, CRAB = ND / 8, rel = (aim - mv + ND) % ND;
      const behind = rel > Q && rel < ND - Q;
      const TW = [[0, '0'], [11.25, 'p11'], [22.5, 'p22'], [33.75, 'p33'], [45, 'p45'], [56.25, 'p56'], [67.5, 'p67'], [78.75, 'p78'], [90, 'p90']];
      // 1) motion with the stance we're in (stride along the legs; backing up runs the cycle in reverse)
      const back0 = !!P.aimBack, run = !keys.has('q'), C = run ? RUN : WALK, pre = run ? 'rs' : 'ws';
      const R = SPEED.run / SPEED0.run, target = run ? (back0 ? 2.7 : keys.has('shift') ? 3.6 : 3.0) * R : (back0 ? 1.6 * SPEED.walk / SPEED0.walk : SPEED.walk);   // (R: the build's pace)
      let speed = Math.hypot(P.vx, P.vy);
      speed = speed < target ? Math.min(target, speed + 25 * dt) : Math.max(target, speed - 30 * dt);
      P.vx = mx * speed; P.vy = my * speed;
      const d = moveBy(P.vx * dt, P.vy * dt);
      const [lx, ly] = vecOf(P.face), along = (mx * lx + my * ly) / (Math.hypot(mx, my) || 1);
      P.ph = ((P.ph + along * d / (C.stride * strideK(run ? 'run' : 'walk', speed))) % 1 + 1) % 1;   // (the stride follows his real speed: player.js GAIT)
      const at = P.ph * C.stride;
      let f = 0; while (f < C.frames - 1 && at >= C.cum[f + 1]) f++;
      // 2) stance + twist by what you SEE, for THIS gait frame: every (legs forward/back, leg angle, twist) is scored by
      //    how far its rendered arrow points from the cursor on screen (6 deg ~ one step of leg angle), plus leg costs
      const sa = screenAim(), errOf = (nm, face) => { const ra = arrowAngle(`${pre}_${nm}_${f}`, face); return ra === null ? 99 : angDiff(ra, sa) * 180 / Math.PI; };
      let best = null;
      for (const back of [false, true]) for (let k = -CRAB; k <= CRAB; k++) {
        const face = ((back ? mv + HALF : mv) + k + ND) % ND;
        if (back !== back0 && P.stanceAge < STANCE_HOLD) continue;   // no flip-flopping between forward and backing up
        const legCost = Math.abs(k) + (back !== behind ? 2.5 : 0) + (back !== back0 ? 1.0 : 0) + (face !== P.want ? .3 : 0);
        let e = 99; for (const [, nm] of TW) e = Math.min(e, errOf(nm, face));
        const cost = legCost + e / 6;
        if (!best || cost < best.cost) best = {cost, back, face};
      }
      P.stanceAge = best.back !== back0 ? 0 : (P.stanceAge ?? 9) + dt;
      P.aimBack = best.back; P.want = best.face;
      if (P.snapFace) { P.face = P.want; P.snapFace = false; } else turnToward(P.want, dt, AIM_TURN_RATE);
      // 3) the twist for the legs as they are right now (they may still be turning): best on screen, but keep the
      //    current twist unless another is clearly better (3 deg) so the torso doesn't flicker between frames
      let twName = P.twName && errOf(P.twName, P.face) < 99 ? P.twName : '0', te = errOf(twName, P.face);
      for (const [, nm] of TW) { const e = errOf(nm, P.face); if (e < te - 3) { te = e; twName = nm; } }
      P.twName = twName;
      const twDeg = TW.find(t => t[1] === twName)[0];
      P.bodyAim = (P.face + Math.round(twDeg / (360 / ND))) % ND;
      const name = `${pre}_${twName}_${f}`, key = (run ? 'run' : 'walk') + f;
      if (key !== P.prevF) { const ci = C.contacts.indexOf(f); if (ci >= 0 && P.prevF !== -1 && SP[name]) puff(C.contact_foot[ci], name, 0); P.prevF = key; }
      P.frame = SP[name] ? name : SP[`ws_${twName}_${f}`] ? `ws_${twName}_${f}` : `${pre}_0_${f}`; P.moveAim = true;
      return;
    }
    if (P.state === 'draw' || P.state === 'release') {
      // standing: aiming plants the feet, decelerate to a stop, face the cursor
      const damp = Math.exp(-dt * 18); P.vx *= damp; P.vy *= damp; moveBy(P.vx * dt, P.vy * dt);
      P.moveAim = false;
      if (P.state === 'draw') {
        trackAimSpeed(dt);
        if (!P.snapFace && P.t * CLIP.draw.fps >= CLIP.draw.frames - 1 && standingAim(dt)) return;   // full draw: twist / step / pivot
        const c = cursorAim(); P.want = bestFacing('draw.2', dirOf(c.x - P.x, c.y - P.y), ['draw_m11', 'draw_p11'], P.face, PIVOT_SLACK);
        const f0 = P.face;
        if (P.snapFace) { P.face = P.want; P.snapFace = false; } else turnToward(P.want, dt, AIM_TURN_RATE);
        P.frame = `draw.${Math.min(CLIP.draw.frames - 1, Math.floor(P.t * CLIP.draw.fps))}`;
        if (P.frame === `draw.${CLIP.draw.frames - 1}`) {   // held full draw: +-11.25 deg twist variants halve the aim step
          const sa = screenAim(); let be = 9;
          for (const v of ['draw_m11', P.frame, 'draw_p11']) { const ra = arrowAngle(v, P.face); if (ra !== null && angDiff(ra, sa) < be) { be = angDiff(ra, sa); P.frame = v; } }
        }
        pivotFeet(f0, dt);
      } else {
        const f = Math.floor(P.t * CLIP.release.fps);
        if (f >= CLIP.release.frames) { P.state = 'idle'; P.t = 0; } else P.frame = `release.${f}`;
      }
      return;
    }
    if (keys.has('c') || (keys.has('e') && !P.eUsed)) {   // hold C: crouch, hold E (when it didn't interact): wave
      const damp = Math.exp(-dt * 12); P.vx *= damp; P.vy *= damp; moveBy(P.vx * dt, P.vy * dt);
      P.frame = keys.has('c') ? 'crouch' : 'reach_up'; P.state = 'pose'; return;
    }
    // ---- locomotion: the direction snaps to the input (no gliding arc), only the speed ramps ----
    const target = keys.has('q') ? SPEED.walk : keys.has('shift') ? SPEED.sprint : SPEED.run;
    let speed = Math.hypot(P.vx, P.vy), dir = speed > 1e-3 ? [P.vx / speed, P.vy / speed] : vecOf(P.face);
    if (mx || my) {
      const nd = dirOf(mx, my);
      if (nd !== P.face) {  // (a new direction mid-turn starts a fresh turn from the current facing)
        if (P.fromAim) P.want = nd;       // coming out of an aiming stance: turn smoothly, no plant/push snap
        else if (speed > 2.3) startTurn(nd);   // running: rendered plant/push frames carry the body into the new way
        else P.want = nd;                 // walking / standing: turn toward it at the turn rate
      }
      dir = [mx, my];
      P.skid = 0;
      if (speed < target) speed = Math.min(target, speed + (speed < SPEED.run ? ACC.start : ACC.sprintUp) * dt);  // run fast, sprint builds
      else speed = Math.max(target, speed - (speed > SPEED.run ? ACC.sprintDown : ACC.stop) * dt);                 // ease out of a sprint
    } else {
      if (speed > GAIT.skid && !P.skid) { P.skid = 1; P.skidT = 0; }   // let go at sprint speed: skid to a stop
      speed = Math.max(0, speed - (P.skid ? ACC.skid : ACC.stop) * dt); P.turn = null;
    }
    P.lastSpeed = P.curSpeed ?? speed; P.curSpeed = speed;
    P.vx = dir[0] * speed; P.vy = dir[1] * speed;
    if (!P.turn && P.want !== undefined && P.want !== P.face && (speed <= 2.3 || P.fromAim)) turnToward(P.want, dt, P.fromAim ? AIM_TURN_RATE : TURN_RATE);
    if (P.fromAim && P.want === P.face) P.fromAim = false;
    if (P.turn) {
      // turn frames: time-based, the plant frame bites into the speed (weight changing direction), then push off
      const Tn = P.turn; Tn.t += dt;
      const fi = Math.min(Tn.frames.length - 1, Math.floor(Tn.t / .06));
      if (fi !== Tn.i || !Tn.started) { Tn.i = fi; Tn.started = true; puff(Tn.feet[fi], Tn.frames[fi], Tn.frames[fi].endsWith('a') ? 2 : 1); }
      const bite = Tn.frames[fi].endsWith('a') ? .35 : .8;
      moveBy(P.vx * bite * dt, P.vy * bite * dt);
      P.frame = Tn.frames[fi]; P.state = 'move';
      if (Tn.t >= Tn.frames.length * .06) {  // continue the run with the leg that just reached out landing first
        P.turn = null; P.gait = 'run'; P.ph = Tn.side === 'l' ? .01 : .51; P.prevF = 'run' + (Tn.side === 'l' ? 0 : 4);
      }
      return;
    }
    const d = moveBy(P.vx * dt, P.vy * dt);
    if (P.skid && SP['skid_a']) {
      P.skidT += dt;
      P.frame = speed > 1.6 ? 'skid_a' : 'skid_b';
      if (speed > 1.2 && Math.random() < .6) puff('L', P.frame, 0);
      if (speed < .25) { P.skid = 0; P.state = 'idle'; P.t = 0; P.prevF = -1; }
      else { P.state = 'move'; return; }
    }
    if (speed > .2 || (d > 0 && (mx || my))) {
      P.state = 'move';
      // gait from the real speed: walk / run / drive (building into a sprint) / sprint
      const accel = (speed - P.lastSpeed) / Math.max(dt, 1e-3);   // m/s^2
      P.gait = speed < 2.3 ? 'walk' : speed < GAIT.sprint || !CLIP.sprint ? 'run' : accel > 1 && speed < GAIT.drive && CLIP.drive ? 'drive' : 'sprint';
      gaitDistance(d);
    } else {
      if (P.state !== 'idle') { P.state = 'idle'; P.t = 0; P.prevF = -1; }
      P.frame = `idle.${Math.floor(P.t * CLIP.idle.fps) % CLIP.idle.frames}`;
    }
  }
  function startTurn(nd) {
    // + = counter-clockwise = the character turns to its left. Small turns just face; bigger ones play rendered
    // plant/push frames (45 / 90 / 135 sets), a 180 pivots over the foot already down.
    const ND = A.ND, CLIP = A.CLIP;
    const deg = ((nd - P.face + ND) % ND) * 360 / ND, planted = P.frame.includes('.') && CLIP[P.frame.split('.')[0]]?.planted
      ? CLIP[P.frame.split('.')[0]].planted[+P.frame.split('.')[1]] : 'R';
    const left = deg < 180 || (deg === 180 && planted === 'R'), m = left ? deg : 360 - deg, s = left ? 'l' : 'r';
    const outside = left ? 'R' : 'L', inside = left ? 'L' : 'R';
    P.face = P.want = nd;
    if (m < 30) { P.turn = null; return; }
    const set = m <= 67.5 ? 45 : m <= 112.5 ? 90 : 135;
    P.turn = set === 45 ? {frames: [`turn_${s}45b`], feet: [inside], side: s, t: 0, i: 0}
      : {frames: [`turn_${s}${set}a`, `turn_${s}${set}b`], feet: [outside, inside], side: s, t: 0, i: 0};
  }
  function gaitDistance(d) {
    // one shared, normalised phase for walk and run (both start on the left heel strike), so switching gait
    // mid-stride keeps the same foot on the ground. The phase only advances with distance really travelled.
    if (P.state !== 'move') return;
    const C = A.CLIP[P.gait];
    P.ph = (P.ph + d / (C.stride * strideK(P.gait, P.curSpeed ?? 0))) % 1;   // (GAIT: the style x his real speed's share)
    const at = P.ph * C.stride;
    let f = 0; while (f < C.frames - 1 && at >= C.cum[f + 1]) f++;
    const key = P.gait + f;
    if (key !== P.prevF) {
      const c = C.contacts.indexOf(f);
      if (c >= 0 && P.prevF !== -1) puff(C.contact_foot[c], `${P.gait}.${f}`, {sprint: 2, drive: 2}[P.gait] ?? 0);  // bigger kicks when sprinting
      P.prevF = key;
    }
    P.frame = `${P.gait}.${f}`;
  }

  // ---------------- input (the host maps its keys / buttons to these) ----------------
  function onSpace() { if (P.state === 'swim') { swimKick(); return; } if (fists?.space()) return; if (thrown.onSpace() || dodging() || BUSY.has(P.state)) return; if (!tryLeap() && !tryVault()) startRoll(); }   // also while aiming
  function onInteractKey() { P.eUsed = interact(); return P.eUsed; }
  function onInteractUp() { P.eUsed = false; }
  function press() {   // LMB down: draw (kept through a roll)
    if (tool?.press()) return;   // a tool in hand: LMB swings it (sim/player/tool.js)
    if (fists?.press('L')) return;   // the fists up: the left hand (sim/player/fists.js)
    if (brawl?.press()) return;   // carrying something: LMB throws it (sim/player/brawl.js)
    if (gun?.on()) return gun.press();   // a gun loadout: the trigger (sim/player/gun.js)
    mouse.down = true; P.recover = 0;
    if (!dodging() && !BUSY.has(P.state)) {
      if (P.state !== 'draw') { P.aimBack = false; P.stanceAge = 9; P.pivotDebt = 0; P.pivotSettle = false; P.aclip = null; P.lastSa = undefined; }   // a fresh aim starts from the legs as they are
      P.state = 'draw'; P.t = 0;
    }
  }
  function release() {   // LMB up: shoot, or buffer the shot during an aimed roll / a backstep
    mouse.down = false;
    if (tool?.release()) return;
    if (fists?.release('L')) return;
    if (P.state === 'draw') shoot(); else if ((P.state === 'roll' && P.aimRoll) || P.state === 'backstep') P.queuedShot = true;
  }
  // RMB (core/input.js): the right hand while the fists are up -> true: taken (else RMB is an ability's)
  const pressR = () => !!fists?.press('R'), releaseR = () => !!fists?.release('R');
  function hold(frame, sec) { if (BUSY.has(P.state) || dodging()) return; P.hold = {frame: A.SP[frame] ? frame : 'release.0', sec}; P.state = 'hold'; P.t = 0; }
  function knock(vx, vy) { if (P.state === 'climb' || THROWN.includes(P.state)) return; P.vx = vx; P.vy = vy; P.state = 'knock'; P.t = 0; }   // (thrown: a skid doesn't cut the flight short)

  // ---------------- HD bow layer (display resolution, over the pixel art) ----------------
  // The bowstring is left out of the pixel sprite; its tip -> nock -> tip path and per-sample visibility (hidden where
  // the body is in front) come from the render. It glows with tension while drawn and twangs after the shot.
  function drawTension() {
    const f = P.frame;
    if (P.recover > 0 && !mouse.down) return 0;
    if (/^aim_pivot_.\.0$/.test(f)) return 0;   // mid-spin, bow tucked in
    if (f.startsWith('ws_') || f.startsWith('rs_') || f.startsWith('draw_') || f.startsWith('aim_') || f === 'bow_draw') return 1;
    if (f.startsWith('draw.')) return +f.split('.')[1] / (A.CLIP.draw.frames - 1);
    return 0;
  }
  function hdString(og, scale, ox, oy) {
    const data = A.OV[P.frame]?.[A.DIRS[P.face]]?.string;
    if (!data) return;
    let [[ax, ay, nx, ny, bx, by], visA, visB] = data; const n = visA.length;
    if (P.recover > 0 && !mouse.down) { nx = (ax + bx) / 2; ny = (ay + by) / 2; }   // just shot: the string is back at rest
    const Pa = [ox + ax * scale, oy + ay * scale], N = [ox + nx * scale, oy + ny * scale], B = [ox + bx * scale, oy + by * scale];
    // twang: the nocking point oscillates across the string and dies out in ~0.3 s
    let off = [0, 0];
    if (P.twang < .35) {
      const dx = B[0] - Pa[0], dy = B[1] - Pa[1], l = Math.hypot(dx, dy) || 1;
      const amp = 2.6 * scale * Math.exp(-P.twang * 11) * Math.sin(P.twang * 110);
      off = [-dy / l * amp, dx / l * amp];
    }
    const M = [N[0] + off[0], N[1] + off[1]];
    const C = [2 * M[0] - (Pa[0] + B[0]) / 2, 2 * M[1] - (Pa[1] + B[1]) / 2];   // quadratic through the (moving) nock
    const k = off[0] || off[1] ? 1 : 0, pt = t => k
      ? [(1 - t) ** 2 * Pa[0] + 2 * (1 - t) * t * C[0] + t * t * B[0], (1 - t) ** 2 * Pa[1] + 2 * (1 - t) * t * C[1] + t * t * B[1]]
      : t < .5 ? [Pa[0] + (N[0] - Pa[0]) * t * 2, Pa[1] + (N[1] - Pa[1]) * t * 2] : [N[0] + (B[0] - N[0]) * (t * 2 - 1), N[1] + (B[1] - N[1]) * (t * 2 - 1)];
    const visible = t => t < .5 ? visA[Math.round(t * 2 * (n - 1))] : visB[Math.round((t * 2 - 1) * (n - 1))];
    const ten = drawTension(), steps = 2 * n;
    og.save();
    og.lineCap = 'round'; og.lineJoin = 'round';
    og.lineWidth = Math.max(1, scale * .38);
    og.strokeStyle = `rgba(246, 238, 216, ${.82 + .18 * ten})`;
    if (ten > 0) { og.shadowColor = `rgba(255, 226, 160, ${.7 * ten})`; og.shadowBlur = (2 + 5 * ten) * scale / 3; }
    let open = false;
    og.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, q = pt(t);
      if (visible(t)) { open ? og.lineTo(q[0], q[1]) : og.moveTo(q[0], q[1]); open = true; } else open = false;
    }
    og.stroke();
    if (ten > .99) {  // a glint on the nocking point at full draw
      og.shadowBlur = 0; og.fillStyle = `rgba(255, 250, 232, ${.45 + .35 * Math.sin(performance.now() / 90)})`;
      og.beginPath(); og.arc(N[0], N[1], Math.max(1.2, scale * .45), 0, 7); og.fill();
    }
    og.restore();
  }
  // an HD arrow: dark hairline outline, light shaft, red fletching at the back, dark head at the front
  function drawArrowHD(og, scale, bx, by, fx, fy, vis) {
    const L = Math.hypot(fx - bx, fy - by) || 1, ux = (fx - bx) / L, uy = (fy - by) / L, nx = -uy, ny = ux, n = vis ? vis.length : 1;
    const seen = t => !vis || vis[Math.min(n - 1, Math.round(t * (n - 1)))];
    const w = Math.max(1, scale * .42);
    og.save(); og.lineCap = 'round';
    for (const [col, lw] of [['rgba(34, 22, 14, .9)', w + 1.4], ['#d9ad6c', w]]) {   // outline, then shaft
      og.strokeStyle = col; og.lineWidth = lw; og.beginPath(); let open = false;
      for (let i = 0; i <= 24; i++) { const t = i / 24, x = bx + ux * L * t, y = by + uy * L * t;
        if (seen(t)) { open ? og.lineTo(x, y) : og.moveTo(x, y); open = true; } else open = false; }
      og.stroke();
    }
    if (seen(.06)) {   // fletching
      og.strokeStyle = '#c8402f'; og.lineWidth = Math.max(1, scale * .5);
      for (const sgn of [-1, 1]) { og.beginPath(); og.moveTo(bx + ux * L * .02, by + uy * L * .02);
        og.lineTo(bx + ux * L * .1 + nx * sgn * scale * .9, by + uy * L * .1 + ny * sgn * scale * .9); og.stroke(); }
    }
    if (seen(.97)) {   // head
      const hl = Math.max(3, scale * 1.4), hw = Math.max(1.5, scale * .6);
      og.fillStyle = '#2a2530'; og.beginPath(); og.moveTo(fx + ux * hl * .4, fy + uy * hl * .4);
      og.lineTo(fx - ux * hl * .6 + nx * hw, fy - uy * hl * .6 + ny * hw); og.lineTo(fx - ux * hl * .6 - nx * hw, fy - uy * hl * .6 - ny * hw); og.fill();
    }
    og.restore();
  }
  // the nocked arrow stays locked to the bow and the rendered pose (rendered length and occlusion)
  function hdNockedArrow(og, scale, ox, oy) {
    if (drawTension() <= 0) return;
    const data = A.OV[P.frame]?.[A.DIRS[P.face]]?.arrow;
    if (!data) return;
    const [[nx, ny, tx, ty, k], vis] = data;
    const N = [ox + nx * scale, oy + ny * scale], R = [(tx - nx) * k * scale, (ty - ny) * k * scale];
    const len = Math.hypot(R[0], R[1]); if (len < 2) return;
    const a = Math.atan2(R[1], R[0]);
    PL.lastArrow = {drawn: a, toCursor: Math.atan2(mouse.y * scale - N[1], mouse.x * scale - N[0]), turned: 0};   // test hook
    drawArrowHD(og, scale, N[0] - Math.cos(a) * len * .03, N[1] - Math.sin(a) * len * .03, N[0] + Math.cos(a) * len, N[1] + Math.sin(a) * len, vis);
  }
  function hdArrowTrails(og, scale, arrows) {
    // a thin streak of disturbed air behind each flying arrow, fading toward the tail
    og.save(); og.lineCap = 'round';
    for (const a of arrows) {
      if (a.stuck || !a.trail || a.trail.length < 2) continue;
      const pts = a.trail.map(([x, y, h]) => { const [sx, sy] = T.toS(x, y, h); return [(sx - cam.x) * scale, (sy - cam.y) * scale]; });
      const [h0, h1] = [pts[0], pts[pts.length - 1]];
      const gr = og.createLinearGradient(h0[0], h0[1], h1[0], h1[1]);
      gr.addColorStop(0, 'rgba(230, 240, 255, 0)'); gr.addColorStop(1, 'rgba(236, 244, 255, .55)');
      og.strokeStyle = gr; og.lineWidth = Math.max(1, scale * .5);
      og.beginPath(); og.moveTo(h0[0], h0[1]); for (const q of pts.slice(1)) og.lineTo(q[0], q[1]); og.stroke();
    }
    og.restore();
    for (const a of arrows) {
      if (a.stuck) continue;
      const [sx, sy] = T.toS(a.x, a.y, a.h), hx = (sx - cam.x) * scale, hy = (sy - cam.y) * scale;
      const svx = a.vx * T.PPM, svy = a.vy * T.PPMY - a.vh * T.PPMH, l = Math.hypot(svx, svy) || 1, L = 1.05 * T.PPM * scale * .8;
      drawArrowHD(og, scale, hx - svx / l * L, hy - svy / l * L, hx, hy, null);
    }
  }
  // all of the above; ox, oy = the sprite's top-left on the overlay (display px). With H.pixelBow() true the whole bow
  // set is pixel art instead: the string and nocked arrow from drawPixelBow, flying arrows from drawPixelArrow (the host
  // calls both in its pixel pass), so this draws nothing.
  function drawHD(og, scale, ox, oy, arrows) {
    if (H.pixelBow?.()) return;
    hdArrowTrails(og, scale, arrows); hdString(og, scale, ox, oy); hdNockedArrow(og, scale, ox, oy);
  }

  // ---------------- pixel bow layer (game resolution, lit with the world) ----------------
  // The same string / nocked-arrow data as the HD layer (render paths + per-sample visibility), drawn into the PIXEL
  // canvas right after the sprite, before the host's lighting pass: one art pixel wide, palette tones (linen string,
  // wood shaft, dark head, red fletching), darkened by the light layer like the rest of the scene. Tension brightens
  // the string one tone, the full-draw glint is a blinking pixel, the twang moves the nock in whole pixels.
  // sx, sy = the sprite's top-left on the pixel canvas (view px).
  const PAL = ramps(), rgbCss = c => `rgb(${c[0]},${c[1]},${c[2]})`;
  const PX = {str: rgbCss(PAL.linen[1]), strTight: rgbCss(PAL.linen[0]), shaft: rgbCss(PAL.wood[1]), head: rgbCss(PAL.char[3]), fletch: rgbCss(PAL.red[1])};
  function pxLine(g, x0, y0, x1, y1, vis, col) {   // Bresenham; vis(t) with t = 0..1 along the line; col string or t => string
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, N = Math.max(dx, -dy) || 1;
    let e = dx + dy, i = 0;
    for (;;) {
      const t = i / N;
      if (!vis || vis(t)) { g.fillStyle = typeof col === 'function' ? col(t) : col; g.fillRect(x0, y0, 1, 1); }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; }
      i++;
    }
  }
  function drawPixelBow(g, sx, sy, face = P.face) {   // (face: the column as drawn: view/hero.js faceCol, a cinema camera's)
    const ov = A.OV[P.frame]?.[A.DIRS[face]]; if (!ov) return;
    const ten = drawTension();
    g.save(); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (ov.string) {
      let [[ax, ay, nx, ny, bx, by], visA, visB] = ov.string; const n = visA.length;
      if (P.recover > 0 && !mouse.down) { nx = (ax + bx) / 2; ny = (ay + by) / 2; }   // just shot: back at rest
      if (P.twang < .35) {   // the nock oscillates across the string (art px) and dies out in ~0.3 s
        const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, amp = 2.6 * Math.exp(-P.twang * 11) * Math.sin(P.twang * 110);
        nx += -dy / l * amp; ny += dx / l * amp;
      }
      const col = ten > .99 ? PX.strTight : PX.str;
      pxLine(g, sx + ax, sy + ay, sx + nx, sy + ny, t => visA[Math.round(t * (n - 1))], col);
      pxLine(g, sx + nx, sy + ny, sx + bx, sy + by, t => visB[Math.round(t * (n - 1))], col);
      if (ten > .99 && Math.sin(performance.now() / 90) > .3) { g.fillStyle = rgbCss(PAL.linen[0]); g.fillRect(Math.round(sx + nx), Math.round(sy + ny), 1, 1); }
    }
    if (ov.arrow && ten > 0) {
      const [[nx, ny, tx, ty, k], vis] = ov.arrow, rx = (tx - nx) * k, ry = (ty - ny) * k, len = Math.hypot(rx, ry);
      if (len >= 2) {
        const m = vis.length, seen = t => vis[Math.min(m - 1, Math.round(t * (m - 1)))], hd = 2 / len, fl = 2.5 / len;
        pxLine(g, sx + nx - rx * .03, sy + ny - ry * .03, sx + nx + rx, sy + ny + ry, seen, t => t > 1 - hd ? PX.head : t < fl ? PX.fletch : PX.shaft);
      }
    }
    g.restore();
  }
  // a flying arrow at art pixels (host: in its depth-sorted pixel pass, before lighting): a streak of disturbed air in
  // two alpha steps along the recent trail, then the shaft (wood), fletching (red) at the back and the head (dark).
  // Same length and direction as the HD one (1.05 m at 80 %, along the screen velocity). eg (optional): the streak is
  // also drawn there, for the host to add as an emitter, so the flight stays readable at night (lit, it goes dark).
  function drawPixelArrow(g, a, eg = null) {
    if (a.stuck) return;
    const [sx, sy] = T.toS(a.x, a.y, a.h), hx = sx - cam.x, hy = sy - cam.y;
    const svx = a.vx * T.PPM, svy = a.vy * T.PPMY - a.vh * T.PPMH, l = Math.hypot(svx, svy) || 1, L = 1.05 * T.PPM * .8;
    const tx = hx - svx / l * L, ty = hy - svy / l * L;
    g.save(); g.globalCompositeOperation = 'source-over';
    if (a.trail && a.trail.length > 1) {
      const [ox, oy] = T.toS(...a.trail[0]), qx = ox - cam.x, qy = oy - cam.y, mx = (qx + tx) / 2, my = (qy + ty) / 2;
      if (Math.hypot(tx - qx, ty - qy) > 2) {
        g.globalAlpha = .22; pxLine(g, qx, qy, mx, my, null, PX.strTight);
        g.globalAlpha = .45; pxLine(g, mx, my, tx, ty, null, PX.strTight);
        if (eg) { eg.globalAlpha = .35; pxLine(eg, qx, qy, mx, my, null, PX.strTight); eg.globalAlpha = .7; pxLine(eg, mx, my, tx, ty, null, PX.strTight); eg.globalAlpha = 1; }
      }
    }
    g.globalAlpha = 1;
    const hd = 2 / L, fl = 2.5 / L;
    pxLine(g, tx, ty, hx, hy, null, t => t > 1 - hd ? PX.head : t < fl ? PX.fletch : PX.shaft);
    g.restore();
  }
  // a gun loadout's revolver (H.gun: sim/player/gun.js) gets the player's internals; the bow's code above stays as it is
  const internals = {P, A, H, has, ev, dirOf, vecOf, turnToward, moveBy, moveInput, cursorAim, puff, stepTraverse, angDiff,
    SPEED, SPEED0, strideK, BUSY, AIM_TURN_RATE, TURN_RATE, AIM_H};
  const gun = H.gun ? H.gun(PL, internals) : null;
  PL.gun = gun;
  const lasso = H.lasso ? H.lasso(PL, internals) : null;   // (the equipment experiment's lasso: sim/player/lasso.js)
  PL.lasso = lasso;
  const brawl = H.brawl ? H.brawl(PL, internals) : null;   // (the live cowboys' boot, barge, lift and throw: sim/player/brawl.js)
  PL.brawl = brawl;
  const fists = H.fists ? H.fists(PL, internals) : null;   // (the live cowboys' fists: sim/player/fists.js)
  PL.fists = fists;
  const tool = H.tool ? H.tool(PL, internals) : null;   // (a tool in hand, the axe: sim/player/tool.js)
  PL.tool = tool;
  const ropewall = H.ropewall ? H.ropewall(PL, internals) : null;   // (the rope wall: sim/player/ropewall.js; the lasso's rope-up hands him to it)
  PL.ropewall = ropewall;
  const thrown = createLaunch({...internals, elev, inStream, splash, dryBack});   // a blast's throw (sim/player/launch.js: PL.launch)
  const ladder = createLadder({...internals, elev});   // the ladder under his control (sim/player/ladder.js)
  PL.ladder = ladder;

  // for the systems around him (they ask, they don't write P): face a shot along a view-frame direction (the string
  // settles: twang 0), flicker as he's hurt (i-frames; the respawn's flicker too), re-count the facings for an atlas
  // with another number of directions (a loadout switch)
  const faceShot = (dx, dy) => { P.face = P.want = dirOf(dx, dy); P.twang = 0; };
  const flicker = sec => { P.blink = sec; };
  const regrid = (n0, n1) => { P.face = Math.round(P.face * n1 / n0) % n1; P.want = P.face; };
  return Object.assign(PL, {step, startRoll, untouchable, shoot, tryLeap, leapPlan, tryVault, canVault, interact, climbSpot, nearInteract, onSpace, onInteractKey, onInteractUp, faceShot, flicker, regrid,
    press, release, pressR, releaseR, hold, knock, launch: thrown.start, moveInput, dirOf, vecOf, cursorAim, cursorGround, screenAim, drawTension, drawHD, drawPixelBow, drawPixelArrow, drawArrowHD, turnToward});
}
