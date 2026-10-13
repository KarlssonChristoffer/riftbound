// GUN: the revolver of a gun loadout (content/weapons.js, kind 'gun'), as a part of the player. sim/player/player.js
// creates it through the host's H.gun (the adapter passes createGun) with its internals, and while the loadout carries a
// gun it hands this module LMB (press) and the frame (step: it returns true when it drove the frame); the bow's own code
// is untouched. SIM: the cylinder, the trigger, the reload, the shots (bullets through H.onShoot: fast, no drop, spread
// from this module's own seeded generator, core/rng.js), and the gun's poses on the atlas: the revolver is in the hand
// only in gun poses (gun_*, gws_* / grs_* aiming on walk / run legs, gwr_* / grr_* reloading on them); every other pose
// shows it holstered, so plain locomotion (player.js) is "holstered".
// OWNS: S (rounds, the action, timers, the cues) and, while it drives the frame, the player's frame / facing / state the
//   way player.js does (it runs inside player.js's step: the player's code, in two files).
// READS: the atlas (gun poses; the GunMuzzle0 / GunHold0 bones = the barrel on screen), the cursor, the modifiers' notes
//   (weapon.dmg / reload / gap / spread / fanSpread / last / quick / endless / kick: the recoil's push, dev/gunfeel.js),
//   H.weapon() (the loadout's weapon).
// EMITS (player.js's queue, turned into world coordinates by the loop): player.draw / shoot / dryfire / reload / holster /
//   melee (the pistol whip's blow: features/gun.js lands it through combat).
// BUDGET: part of player.step (sim group): aiming on the move scores <= 70 poses a step, like the bow's stance search.
//
// THE ANGLES (an atlas that has them: tools/blender/western.py ANGLE_FAMS): on the move the stances also aim with TWX, upper
// bodies the twists can't reach: the gun back over the right shoulder (ob), back past the left side under the arm (ub),
// across the chest to his left (cx). Running (not walking, Q) with the target behind him he keeps running his way and
// shoots back over his shoulder instead of backing up (TUNE.angles); their shots are 'rear' (spread.rear: less sure).
// THE ACTIONS (S.act): '' ready (the gun up, aimed at the cursor: standing twists / steps / pivots, or the walk / run
// stances) | draw (from the holster; the gunslinger's first shot leaves from the hip: hip) | fire (the kick) | fan (RMB:
// the palm sweeps the hammer, a shot each sweep, the feet planted) | reload (R, or after the empty click: dry) | twirl
// (the cylinder closed) | holster (the twirl into the holster, after `ready` s without a shot) | the gunslinger's blow
// (smoke off the barrel: after a kill or an emptied cylinder, when calm), duel (crouched over the holster while an elite
// is near), tip (Y: the hat), and from an atlas that has them (the gunslinger's): turn (a draw at a target behind him while
// he stands: the spin round onto it, the shot at its end; gun_turnshot) | whip (V, or the empty click with a foe in reach:
// the pistol whip, gun_whip; its blow is player.melee). P.state is 'draw' while the gun is up (the reticle, the hover
// pulse, player.aiming) and 'pose' during holster / blow / tip / duel.
//   const gun = createGun(PL, internals); gun.on() / step(dt, mx, my) / press() / fan() / reload() / melee() / emote('tip') /
//   cue('kill') / setCues(calm, duel, near); gun.S (read: the HUD, the views)
import {mulberry32} from '../../core/rng.js';
import {clamp} from '../../core/mathx.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
export const TUNE = {
  twistTol: 7,      // deg: aim error the standing twists still cover (the feet stay)
  stepGain: 4,      // deg: another leg facing must aim this much better before the feet move
  flick: 6,         // rad/s of the cursor round the player: faster = a pivot on the balls of the feet, slower = a step
  stanceHold: .25,  // s: a moving stance (forward / backing up) can't flip back sooner
  hyst: 3,          // deg: the moving twist changes only for one clearly better
  buffer: .35,      // s a press waits for the gun (the gap between shots, a draw)
  blowAfter: .7,    // s still and calm after the cause before the gunslinger blows the smoke off
  moveSpeed: {run: 3, sprint: 3.6, back: 2.7, walkBack: 1.6},   // m/s on the move with the gun up (the bow's)
  depth: .45,       // m: the muzzle sits this far along the aim (its screen x and height come from the pose)
  back: .9,         // m: the first step's hit test starts this far behind the muzzle (a brute in your face)
  fanKick: .5,      // x the weapon's recoil push for a fanned shot (the palm, not the arm, takes it)
  settle: 2.5,      // the cursor on open ground (no target under it, the same level): the shot meets the ground this x the
  settleMin: 6,     //   cursor's distance out (at least settleMin m), so a miss kicks up dirt you can see; 0: flat to its range
  turnBehind: 115,  // deg: a draw at a target this far round from his facing, standing, spins him round onto it (gun_turnshot)
  whipLunge: 2.4,   // m/s: the whip's blow carries him forward into it (plant() takes it up: ~.13 m)
  // the angles (TWX) in the moving stance search: cost added to a stance aimed with one (the twists win a tie), and to
  // backing up while running when the atlas has them (he'd rather keep running and shoot over his shoulder)
  angles: {cost: .6, backRun: 2.2},
  melee: {dmg: 20, reach: 1.5, arc: 80, push: 1},   // a gun without its own `melee` (content/weapons.js)
  clipFb: {gun_draw: [4, 16], gun_fire: [3, 20], gun_fan: [2, 14], gun_reload: [6, 6], gun_twirl: [4, 16], gun_holster: [5, 16],
    gaim_step_l: [4, 16], gaim_step_r: [4, 16], gaim_pivot_l: [3, 24], gaim_pivot_r: [3, 24], gun_hipfire: [3, 18], gun_blow: [5, 6], gun_fan_out: [3, 28],
    duel_ready: [4, 5], hat_tip: [5, 6]},
};
// the standing twists (facing = the legs; + = toward his left) and the moving ones (the gun in the RIGHT hand: out to
// the right up to 90 deg, across to the left up to 45)
const TWS = ['gun_aim_m45', 'gun_aim_m34', 'gun_aim_m22', 'gun_aim_m11', 'gun_aim', 'gun_aim_p11', 'gun_aim_p22', 'gun_aim_p34', 'gun_aim_p45'];
const TWM = ['m90', 'm67', 'm45', 'm22', '0', 'p22', 'p45'], TWM_DEG = [-90, -67.5, -45, -22.5, 0, 22.5, 45];
// the angles' upper bodies on the same legs (forward legs only): each one's barrel from the legs' facing (deg, + = his
// left: western.py's LIVE_GUN dirs), and whether its shot is 'rear' (behind him: the wider spread) or 'move'
const TWX = ['ob', 'ub', 'cx'], TWX_DEG = [-161, 163, 83], TWX_REAR = [true, true, false];
const RELOAD_STAND = {up: 0, eject: 1, fetch: 3, close: 5};   // gun_reload frames (load: 2 / 4 by the round)

export function createGun(PL, I) {
  const {P, A, H, has, ev, dirOf, vecOf, turnToward, moveBy, moveInput, cursorAim, puff, stepTraverse, angDiff, SPEED, SPEED0, strideK, BUSY,
    AIM_TURN_RATE, TURN_RATE, AIM_H} = I;
  const {keys, mouse, cam} = H, T = H.ctx;
  const rng = mulberry32(0x6a09e667);   // the spread (a fixed seed: the sim replays; no Math.random)
  const mv = (stat, base) => H.mods ? H.mods.value(stat, base) : base;
  const S = {wid: '', out: false, act: '', at: 0, ammo: 6, cap: 6, cool: 0, idle: 0, next: '',
    want: 0, wantT: 0, fanWant: false, reloadWant: false, tipWant: false,
    rph: '', rt: 0, rmul: 1, resume: false, hip: false, quick: false, fanT: 0,
    flourish: false, calm: true, duel: false, aimSpeed: 0, lastSa: NaN, aclip: null, twName: '0', rear: false,
    shotN: 0, lastHow: '', lastShotAt: -9, clock: 0, reloadK: 0, rfirst: true,
    whipWant: false, near: false, done: false};   // (the whip's key; a foe in reach: the gun feature's cue; turn / whip: its shot / blow is out)
  const weapon = () => H.weapon?.() || null;
  const on = () => { const w = weapon(); return !!w && w.kind === 'gun' && has('gun_aim'); };

  // ---- names, made once (no strings built per step) ----
  const NM = {}, nm = (base, i) => (NM[base] ??= [])[i] ??= base + '.' + i;
  const ST = {}, st = (pre, tw, f) => ((ST[pre] ??= {})[tw] ??= [])[f] ??= `${pre}_${tw}_${f}`;
  const FB = {}; for (const [k, [frames, fps]] of Object.entries(TUNE.clipFb)) FB[k] = {frames, fps};
  const clip = name => A.CLIP[name] || FB[name];
  // ---- clip timelines: a clip may carry `play` (the order its rendered frames show in), `ms` (each step's time) and
  //      `marks` (named frames; tools/blender/western.py _clip); without them, one step per frame at fps. Built once per
  //      atlas clip (a loadout switch brings another), so a step allocates nothing ----
  const TL = {};
  function tl(name) {
    const c = clip(name), L = TL[name];
    if (L && L.c === c) return L;
    const n = c.play ? c.play.length : c.frames, ends = new Float64Array(n); let t = 0;
    for (let i = 0; i < n; i++) { t += c.ms ? c.ms[i] / 1000 : 1 / c.fps; ends[i] = t; }
    return (TL[name] = {c, n, ends, total: t, play: c.play || null});
  }
  const stepAt = (name, t) => { const L = tl(name); let i = 0; while (i < L.n - 1 && t >= L.ends[i]) i++; return i; };
  const frameAt = (name, t) => { const L = tl(name), i = stepAt(name, L.c.loop ? t % L.total : t); return nm(name, L.play ? L.play[i] : i); };
  const over = (name, t) => t >= tl(name).total;
  const startOf = (name, i) => i > 0 ? tl(name).ends[i - 1] : 0;   // when step i begins (s)
  const mark = (name, k, fb) => clip(name).marks?.[k] ?? fb;
  const lastOf = name => nm(name, clip(name).frames - 1);

  // ---- the barrel on screen: aiming by what you SEE (as the bow's arrowAngle), from the pose's GunMuzzle0 + GunHold0 ----
  let ox = 0, oy = 0, sa0 = 0;   // the sprite's top-left in view px this step; the body's screen aim (fallback)
  function aimOrigin() {
    const s = T.toS(P.x, P.y, P.z); ox = s[0] - cam.fx - A.PIV[0]; oy = s[1] - cam.fy - A.PIV[1];
    sa0 = Math.atan2(mouse.y - (oy + A.PIV[1] - AIM_H * T.PPMH), mouse.x - (ox + A.PIV[0]));
  }
  // how far (rad) pose `frame` at facing f points off the cursor: the barrel's screen angle vs muzzle -> cursor
  function aimErr(frame, f) {
    const sp = A.SP[frame], b = sp && sp.bones && sp.bones[A.DIRS[f]], m = b && b.GunMuzzle0;
    if (!m) return 9;
    let dx = m[2] - m[0], dy = m[3] - m[1]; const g = b.GunHold0; if (g) { dx += g[2] - g[0]; dy += g[3] - g[1]; }
    const tx = mouse.x - (ox + m[0]), ty = mouse.y - (oy + m[1]);
    return angDiff(Math.atan2(dy, dx), tx * tx + ty * ty < 36 ? sa0 : Math.atan2(ty, tx));
  }
  function bestFacing(frame) { let best = P.face, be = 9; for (let f = 0; f < A.ND; f++) { const e = aimErr(frame, f); if (e < be) { be = e; best = f; } } return best; }
  let twErr = 9;
  function bestTwist(f) { let tw = 'gun_aim'; twErr = 9; for (const n of TWS) { const e = aimErr(n, f); if (e < twErr) { twErr = e; tw = n; } } return tw; }
  function trackAimSpeed(dt) { const v = S.lastSa !== S.lastSa ? 0 : angDiff(sa0, S.lastSa) / Math.max(dt, 1e-3); S.lastSa = sa0; S.aimSpeed = S.aimSpeed * .6 + v * .4; }

  // ---- the muzzle as a point in the player's frame: its screen x and height from the pose, the depth along the aim ----
  const MZ = {x: 0, y: 0, h: 0};
  function muzzle(frame, f, c) {
    let ux = c.x - P.x, uy = c.y - P.y; const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l;
    const sp = A.SP[frame], m = sp && sp.bones && sp.bones[A.DIRS[f]]?.GunMuzzle0;
    if (!m) { MZ.x = P.x + ux * .5; MZ.y = P.y + uy * .5; MZ.h = P.z + AIM_H; return MZ; }
    MZ.x = P.x + (m[0] - A.PIV[0]) / T.PPM; MZ.y = P.y + uy * TUNE.depth;
    MZ.h = P.z + clamp(((MZ.y - P.y) * T.PPMY - (m[1] - A.PIV[1])) / T.PPMH, .5, 1.7);
    return MZ;
  }

  // ---- the weapon changed (a loadout switch): a full cylinder, holstered ----
  function sync(w) {
    if (S.wid === w.id) return;
    if (S.wid && (P.state === 'draw' || P.state === 'pose')) { P.state = 'idle'; P.t = 0; }   // another revolver: it starts holstered
    Object.assign(S, {wid: w.id, cap: w.rounds, ammo: w.rounds, out: false, act: '', next: '', want: 0, fanWant: false, reloadWant: false,
      tipWant: false, resume: false, flourish: false, aclip: null, cool: 0});
  }
  // a roll, a leap, a knock: the gun goes back in the holster (a reload resumes after)
  function interrupt() {
    if (S.act === 'reload') S.resume = S.ammo < S.cap;
    S.act = ''; S.out = false; S.aclip = null; S.fanWant = false; S.next = '';
  }
  function plant(dt) { const d = Math.exp(-dt * 18); P.vx *= d; P.vy *= d; moveBy(P.vx * dt, P.vy * dt); }
  const emit = (type, w, o) => { o.type = type; o.x = P.x; o.y = P.y; o.z = P.z; o.gun = w.id; ev(o); };

  // ---------------------------------------------------------------- the shot
  function fire(w, how) {   // how: 'aim' | 'move' | 'rear' (on the move, over the shoulder: TWX) | 'hip' | 'fan'
    // the muzzle of the pose the shot leaves from (a draw frame still holds the gun low: its aim pose instead)
    const pose = how === 'hip' ? 'gun_hipfire.0' : how === 'fan' ? nm('gun_fan', mark('gun_fan', 'shot', 1))
      : how === 'turn' ? nm('gun_turnshot', mark('gun_turnshot', 'shot', 7))   // (the frame is turned round: his facing is still the start's)
      : /^(gun_aim|gws_|grs_)/.test(P.frame) ? P.frame : 'gun_aim';
    const c = cursorAim(), m = muzzle(pose, P.face, c), ND = A.ND;
    let a = Math.atan2(c.x - m.x, c.y - m.y);
    if (how === 'move' || how === 'rear') {   // on the move the shot leaves where the torso can aim (over the shoulder: TWX)
      const b = (P.bodyAim ?? P.face) * TAU / ND, da = ((a - b + Math.PI * 3) % TAU) - Math.PI;
      a = b + clamp(da, -w.cone * DEG, w.cone * DEG);
    }
    const sp = (w.spread[how] ?? w.spread.hip) * DEG * mv(how === 'fan' ? 'weapon.fanSpread' : 'weapon.spread', 1);   // (the turn: the hip's)
    a += sp * (rng() - rng());   // triangular: most shots near the line
    const v = w.speed, fx = Math.sin(a), fy = Math.cos(a), dist = Math.max(1, Math.hypot(c.x - m.x, c.y - m.y));
    let vh = c.target || Math.abs(c.h - m.h) > .5 ? clamp((c.h - m.h) / (dist / v), -v * .4, v * .4) : 0;   // straight at it: no drop
    // open ground under the cursor: a slight slope down (at the cursor it's still at ~.6 of the muzzle's height, inside
    // every body's hit height: nothing short of where it lands is any harder to hit)
    if (!vh && !c.target && TUNE.settle) vh = -(m.h - (H.terrain ? c.h - AIM_H : P.z)) / (Math.max(TUNE.settleMin, dist * TUNE.settle) / v);   // (walkable terrain: the ground at the cursor)
    vh += v * sp * .3 * (rng() - rng());
    let dmg = mv('weapon.dmg', w.dmg) * (how === 'fan' ? w.fanDmg : 1);
    if (S.ammo === 1) dmg *= 1 + mv('weapon.last', 0);
    if (S.quick) { dmg *= 1 + mv('weapon.quick', 0); S.quick = false; }
    H.onShoot({x: m.x, y: m.y, h: m.h, vx: fx * v, vy: fy * v, vh, life: w.range / v, dmg: Math.round(dmg), kind: 'bullet', gun: w.id, push: w.push, back: TUNE.back, pen: w.pen});
    if (how !== 'move' && how !== 'rear' && w.kick) { const k = w.kick * mv('weapon.kick', 1) * (how === 'fan' ? TUNE.fanKick : 1); P.vx -= fx * k; P.vy -= fy * k; }   // the recoil: back against the shot (plant() takes it up)
    S.ammo--; PL.shots++; S.shotN++; S.idle = 0; S.lastHow = how; S.lastShotAt = S.clock;
    if (!S.ammo && how !== 'fan' && mv('weapon.endless', 0) > 0) S.ammo = S.cap;   // endless (a dev cheat: dev/cheats.js); a fan refills as it ends
    S.cool = (how === 'fan' ? 0 : w.gap) * mv('weapon.gap', 1);
    ev({type: 'player.shoot', x: m.x, y: m.y, h: m.h, z: P.z, vx: fx, vy: fy, gun: w.id, fan: how === 'fan', hip: how === 'hip', left: S.ammo});
    if (!S.ammo && has('gun_blow.0')) S.flourish = true;   // an emptied cylinder: the smoke wants blowing off
    if (how === 'aim') {   // square up to the target for the kick: the fire clip's last (aim) frame on the cursor
      P.face = P.want = bestFacing(lastOf('gun_fire')); S.act = 'fire'; S.at = 0; S.aclip = null; P.frame = nm('gun_fire', 0);
    }
  }
  function dry(w) { S.act = 'dry'; S.at = 0; S.want = 0; S.idle = 0; emit('player.dryfire', w, {}); }

  // ---------------------------------------------------------------- starting things
  function startDraw(w, shot, fast = false) {
    S.out = false; S.act = 'draw'; S.at = 0; S.quick = shot; S.aclip = null; S.lastSa = NaN;
    S.hip = shot && w.hip && S.ammo > 0 && has('gun_hipfire.0');   // (an empty cylinder: no hip shot; the draw ends in the dry click)
    if (fast) S.at = startOf('gun_draw', mark('gun_draw', 'lift', 2)) / w.draw;   // from the duel stance: the hand is already on the grip
    P.state = 'draw'; P.aimBack = false; P.stanceAge = 9; P.snapFace = false;
    P.face = P.want = bestFacing(S.hip ? 'gun_hipfire.0' : 'gun_aim');   // a quick draw turns at once
    emit('player.draw', w, {hip: S.hip});
  }
  function startReload(w, resume) {
    if (S.ammo >= S.cap) return false;
    S.act = 'reload'; S.out = true; S.rph = resume ? 'fetch' : 'up'; S.rfirst = true; S.rt = 0; S.rmul = mv('weapon.reload', 1); S.resume = false; S.idle = 0; S.want = 0;
    P.state = 'draw'; S.aclip = null;
    emit('player.reload', w, {phase: 'start', n: S.ammo});
    return true;
  }
  function startFan(w) {
    if (!S.out) { if (S.act !== 'draw') startDraw(w, true); S.next = 'fan'; S.hip = false; return; }
    if (S.ammo <= 0) { dry(w); return; }
    S.act = 'fan'; S.fanT = 0; S.aclip = null; S.idle = 0; P.state = 'draw';
  }
  // the turn shot: a draw at a target behind him. He faces away from it and the clip's frames (turned round) spin him onto it;
  // the shot leaves at its mark, from that frame's muzzle (at the start's facing: the frame carries the turn), then his
  // facing turns round to where the frames ended (the turn's last frame is gun_aim there)
  function behind() { const c = cursorAim(); return angDiff(Math.atan2(c.x - P.x, c.y - P.y), P.face * TAU / A.ND) > TUNE.turnBehind * DEG; }
  function startTurn(w) {
    const c = cursorAim(), ND = A.ND;
    S.out = false; S.act = 'turn'; S.done = false; S.quick = true; S.hip = false; S.aclip = null; S.lastSa = NaN; S.want = 0; S.next = '';
    P.face = P.want = (dirOf(c.x - P.x, c.y - P.y) + ND / 2) % ND;
    S.at = startOf('gun_turnshot', 1) / w.draw;   // (frame 0 is the ready idle he stands in: from mid-turn, the facing's change unseen)
    P.state = 'draw'; P.aimBack = false; P.stanceAge = 9; P.snapFace = false; P.frame = frameAt('gun_turnshot', S.at * w.draw);
    emit('player.draw', w, {hip: false});
  }
  // the pistol whip: squared up to the cursor, the clip from the aim; its blow (mark hit) is the melee
  function startWhip(w) {
    const c = cursorAim();
    P.face = P.want = dirOf(c.x - P.x, c.y - P.y);
    S.act = 'whip'; S.at = 0; S.done = false; S.want = 0; S.idle = 0; S.aclip = null; S.next = ''; P.state = 'draw'; P.frame = nm('gun_whip', 0);
  }
  function whipLands(w) {   // the blow: along his facing (features/gun.js lands it on what's in its arc, through combat), a lunge into it
    const f = vecOf(P.face), M = w.melee || TUNE.melee;
    P.vx += f[0] * TUNE.whipLunge; P.vy += f[1] * TUNE.whipLunge;
    emit('player.melee', w, {vx: f[0], vy: f[1], reach: M.reach, arc: M.arc, dmg: Math.round(mv('weapon.melee', M.dmg)), push: M.push});
  }
  // LMB, in the step: what a press means right now
  function consumePress(w, moving) {
    switch (S.act) {
      case 'draw': case 'fan': case 'dry': case 'turn': case 'whip': return;   // the draw fires it once the gun is out; the rest run their course
      case 'hip': if (stepAt('gun_hipfire', S.at) < mark('gun_hipfire', 'free', 99)) return; S.act = ''; break;   // its rise to the aim: cut short
      case 'raise': S.act = ''; break;
      case 'reload': if (S.ammo > 0) { S.act = ''; S.resume = false; break; } S.want = 0; return;   // rounds in: fire them (R reloads on later)
      case 'holster': if (stepAt('gun_holster', S.at) < mark('gun_holster', 'in', 4)) { S.act = ''; S.out = true; break; } S.act = ''; S.out = false; break;
      case 'blow': case 'twirl': S.act = ''; break;
      case 'tip': S.act = ''; break;
      case 'duel': S.act = ''; startDraw(w, true, true); return;
    }
    if (!S.out) {
      if (S.resume && S.ammo <= 0) { S.want = 0; startReload(w, true); return; }   // a reload a roll cut short: on with it
      if (!moving && S.ammo > 0 && has('gun_turnshot.0') && behind()) { startTurn(w); return; }   // a target behind him: the turn shot
      startDraw(w, true); return;
    }
    if (S.ammo <= 0) { if (S.near && has('gun_whip.0')) { S.want = 0; startWhip(w); return; } dry(w); return; }   // empty, a foe in reach: whip him
    if (S.cool > 0) return;   // the gap between shots: the press waits (buffered)
    S.want = 0; fire(w, moving ? (S.rear ? 'rear' : 'move') : 'aim');
  }

  // ---------------------------------------------------------------- legs on the move (aiming / reloading)
  function legs(dt, mx, my, back, run) {   // speed toward the target, stride along the legs -> the gait frame
    const C = run ? A.CLIP.run : A.CLIP.walk, M = TUNE.moveSpeed, R = SPEED.run / SPEED0.run;   // (R: the build's pace, player.js)
    const target = run ? (back ? M.back : keys.has('shift') ? M.sprint : M.run) * R : (back ? M.walkBack * SPEED.walk / SPEED0.walk : SPEED.walk);
    let speed = Math.hypot(P.vx, P.vy);
    speed = speed < target ? Math.min(target, speed + 25 * dt) : Math.max(target, speed - 30 * dt);
    P.vx = mx * speed; P.vy = my * speed;
    const d = moveBy(P.vx * dt, P.vy * dt), fa = P.face * TAU / A.ND;
    const along = (mx * Math.sin(fa) + my * Math.cos(fa)) / (Math.hypot(mx, my) || 1);
    P.ph = ((P.ph + along * d / (C.stride * strideK(run ? 'run' : 'walk', speed))) % 1 + 1) % 1;   // (the stride follows his real speed: player.js GAIT)
    const at = P.ph * C.stride; let f = 0; while (f < C.frames - 1 && at >= C.cum[f + 1]) f++;
    return f;
  }
  function stepPuff(run, f, name) {
    const C = run ? A.CLIP.run : A.CLIP.walk, key = (run ? 'grun' : 'gwalk') + f;
    if (key !== P.prevF) { const ci = C.contacts.indexOf(f); if (ci >= 0 && P.prevF !== -1 && A.SP[name]) puff(C.contact_foot[ci], name, 0); P.prevF = key; }
  }
  // moving with the gun up: a stance (legs forward or backing up, up to 45 deg off the way, like a strafe) + a torso
  // twist (-90..+45), each scored by how far its rendered barrel points from the cursor on screen (the bow's search)
  function movingAim(dt, mx, my) {
    const ND = A.ND, c = cursorAim(), aim = dirOf(c.x - P.x, c.y - P.y), mvd = dirOf(mx, my);
    const Q = ND / 4, HALF = ND / 2, CRAB = ND / 8, rel = (aim - mvd + ND) % ND, behind = rel > Q && rel < ND - Q;
    const back0 = !!P.aimBack, run = !keys.has('q'), pre = run ? 'grs' : 'gws';
    const f = legs(dt, mx, my, back0, run), X = has(st(pre, TWX[0], f));   // (the angles, if this atlas has them)
    let bc = 1e9, bb = false, bf = P.face;
    for (let bi = 0; bi < 2; bi++) for (let k = -CRAB; k <= CRAB; k++) {
      const back = bi === 1, face = ((back ? mvd + HALF : mvd) + k + ND) % ND;
      if (back !== back0 && P.stanceAge < TUNE.stanceHold) continue;
      const legBase = Math.abs(k) + (back !== back0 ? 1 : 0) + (face !== P.want ? .3 : 0) + (back && run && X ? TUNE.angles.backRun : 0);
      let e = 9; for (const tw of TWM) e = Math.min(e, aimErr(st(pre, tw, f), face));
      let cost = legBase + (back !== behind ? 2.5 : 0) + e / DEG / 6;
      if (X && !back) {   // forward legs aimed with an angle: no 'behind' cost (that's what they're for)
        let ex = 9; for (const tw of TWX) ex = Math.min(ex, aimErr(st(pre, tw, f), face));
        cost = Math.min(cost, legBase + TUNE.angles.cost + ex / DEG / 6);
      }
      if (cost < bc) { bc = cost; bb = back; bf = face; }
    }
    P.stanceAge = bb !== back0 ? 0 : (P.stanceAge ?? 9) + dt;
    P.aimBack = bb; P.want = bf;
    if (P.snapFace) { P.face = P.want; P.snapFace = false; } else turnToward(P.want, dt, AIM_TURN_RATE);
    let tw = S.twName; const xi0 = TWX.indexOf(tw);
    if (xi0 >= 0 && (!X || P.aimBack)) tw = '0';   // (an angle needs forward legs and an atlas with them)
    let te = aimErr(st(pre, tw, f), P.face) / DEG + (TWX.includes(tw) ? TUNE.angles.cost * 6 : 0);
    for (const n of TWM) { const e = aimErr(st(pre, n, f), P.face) / DEG; if (e < te - TUNE.hyst) { te = e; tw = n; } }
    if (X && !P.aimBack) for (const n of TWX) { const e = aimErr(st(pre, n, f), P.face) / DEG + TUNE.angles.cost * 6; if (e < te - TUNE.hyst) { te = e; tw = n; } }
    S.twName = tw;
    const xi = TWX.indexOf(tw); S.rear = xi >= 0 && TWX_REAR[xi];
    P.bodyAim = (P.face + Math.round((xi >= 0 ? TWX_DEG[xi] : TWM_DEG[TWM.indexOf(tw)]) / (360 / ND)) + ND) % ND;
    const name = st(pre, tw, f);
    stepPuff(run, f, name);
    P.frame = A.SP[name] ? name : st('gws', tw, f); P.moveAim = true;
  }
  // standing with the gun up: the torso twists first (+-45), then the feet: a slow sweep re-plants a foot 45 deg
  // (gaim_step_*, facing = the torso, still on target), a quick flick spins on the balls of the feet (gaim_pivot_*)
  function standingAim(dt) {
    plant(dt); P.moveAim = false;
    if (S.aclip) {
      const C = S.aclip, name = 'gaim_' + C.kind + '_' + C.side, cl = clip(name); C.t += dt;
      const i = Math.floor(C.t * cl.fps);
      if (i < cl.frames) { P.frame = nm(name, i); return; }
      S.aclip = null;
    }
    const tw = bestTwist(P.face), e0 = twErr;
    if (e0 <= TUNE.twistTol * DEG) { P.frame = tw; return; }
    const ND = A.ND, Lt = bestFacing('gun_aim'), delta = ((Lt - P.face + ND + ND / 2) % ND) - ND / 2, side = delta > 0 ? 'l' : 'r';
    bestTwist(Lt); const eL = twErr;
    if (!delta || e0 - eL < TUNE.stepGain * DEG) { P.frame = tw; return; }
    const flick = S.aimSpeed > TUNE.flick || Math.abs(delta) * 360 / ND >= 100;
    if (flick && has(nm('gaim_pivot_' + side, 0))) { P.face = P.want = Lt; S.aclip = {kind: 'pivot', side, t: 0}; P.frame = nm('gaim_pivot_' + side, 0); return; }
    if (has(nm('gaim_step_' + side, 0))) {
      const n = Math.sign(delta) * Math.min(Math.abs(delta), Math.round(ND / 8));
      P.face = P.want = (P.face + n + ND) % ND; S.aclip = {kind: 'step', side, t: 0}; P.frame = nm('gaim_step_' + side, 0); return;
    }
    P.want = Lt; turnToward(Lt, dt, AIM_TURN_RATE); P.frame = bestTwist(P.face);
  }

  // ---------------------------------------------------------------- the reload's timeline
  function reloadStep(dt, w, moving, mx, my) {
    const R = w.reload, k = S.rmul;
    const dur = S.rph === 'up' ? R.up : S.rph === 'eject' ? R.eject : S.rph === 'close' ? R.close : R.round / 2;
    S.rt += dt;
    if (S.rt >= dur * k) {
      S.rt -= dur * k;
      if (S.rph === 'up') { S.rph = 'eject'; emit('player.reload', w, {phase: 'eject', n: S.cap - S.ammo}); }
      else if (S.rph === 'eject') { S.rph = 'fetch'; S.rfirst = true; }
      else if (S.rph === 'fetch') { S.rph = 'load'; S.rfirst = false; }
      else if (S.rph === 'load') { S.ammo++; emit('player.reload', w, {phase: 'round', n: S.ammo}); S.rph = S.ammo < S.cap ? 'fetch' : 'close'; }
      else {   // closed: the cylinder spins home
        emit('player.reload', w, {phase: 'done', n: S.ammo});
        S.act = !moving && has('gun_twirl.0') ? 'twirl' : ''; S.at = 0; S.idle = 0; S.rph = '';
        return;
      }
    }
    S.reloadK = clamp(S.rt / (dur * k), 0, 1);
    if (moving) {   // reloading on the move: the legs face the way, the hands do the work (gwr_* walk / grr_* run)
      const run = !keys.has('q'), mvd = dirOf(mx, my);
      P.want = mvd; turnToward(mvd, dt, TURN_RATE); P.aimBack = false;
      const f = legs(dt, mx, my, false, run), key = S.rph === 'load' ? 'load' : S.rph === 'fetch' ? 'fetch' : S.rph === 'close' ? null : 'up';
      const name = key ? st(run ? 'grr' : 'gwr', key, f) : st(run ? 'grs' : 'gws', '0', f);
      stepPuff(run, f, name); P.frame = A.SP[name] ? name : st('gwr', key || 'up', f); P.moveAim = false;
    } else {
      plant(dt);
      P.frame = nm('gun_reload', reloadFrame());
    }
  }
  // standing: each phase plays its stretch of gun_reload by the phase's progress (the clip's marks: up, eject, the first
  // fetch from the eject, then load <-> fetch per round, close); an atlas without marks holds one frame per phase
  function reloadFrame() {
    const M = clip('gun_reload').marks, k = S.reloadK;
    if (!M) return S.rph === 'load' ? (S.ammo % 2 ? 4 : 2) : RELOAD_STAND[S.rph];
    let a, b, back = false;
    switch (S.rph) {
      case 'up': a = M.up; b = M.eject - 1; break;
      case 'eject': a = M.eject; b = M.first - 1; break;
      case 'fetch': if (S.rfirst) { a = M.first; b = M.fetch; } else { a = M.fetch; b = M.load - 1; back = true; } break;   // the hand off to the belt
      case 'load': a = M.fetch + 1; b = M.load; break;
      default: a = M.close; b = clip('gun_reload').frames - 1;
    }
    const i = Math.min(b - a, Math.floor(k * (b - a + 1)));
    return back ? b - i : a + i;
  }

  // ---------------------------------------------------------------- the frame
  function step(dt, mx, my) {
    if (!on()) {   // (a bow loadout now: if a revolver was up when the loadout changed, let go of its pose once)
      if (S.out || S.act) { S.out = false; S.act = ''; S.wid = ''; if (P.state === 'draw' || P.state === 'pose') { P.state = 'idle'; P.t = 0; } }
      return false;
    }
    const w = weapon(); sync(w);
    S.clock += dt; S.cool = Math.max(0, S.cool - dt);
    if (P.state === 'backstep' && P.rollDir) {   // (main's dodge rework: its backstep plays the bow's frames; a gun rolls that way)
      P.state = 'roll'; P.t = 0; P.rollDev = 0; P.rollLead = null; P.face = P.want = dirOf(P.rollDir[0], P.rollDir[1]);
    }
    if (BUSY.has(P.state) || P.state === 'roll' || P.state === 'backstep') { interrupt(); return false; }
    if (P.state === 'release') { P.state = 'idle'; P.t = 0; }   // (a bow's leftover after a loadout switch)
    if (S.want && (S.wantT += dt) > TUNE.buffer) S.want = 0;   // a stale press is dropped
    const moving = !!(mx || my), sprint = keys.has('shift') && !keys.has('q');
    aimOrigin(); trackAimSpeed(dt);
    // ---- input that ends a pose at once ----
    if (moving && (S.act === 'holster' || S.act === 'tip' || S.act === 'duel' || S.act === 'blow' || S.act === 'twirl')) {
      if (S.act === 'holster' || S.act === 'tip' || S.act === 'duel') { S.out = false; P.state = 'idle'; P.t = 0; }
      S.act = ''; S.next = '';
    }
    if (S.out && !S.act && moving && !mouse.down && !S.want && (sprint || S.idle > w.ready)) { S.out = false; P.state = 'idle'; P.t = 0; P.fromAim = true; }   // running off: back in the holster
    // ---- intents ----
    if (S.reloadWant) {
      S.reloadWant = false;
      if (S.act === '' || S.act === 'fire' || S.act === 'raise' || S.act === 'twirl' || S.act === 'dry' || S.act === 'blow' || S.act === 'duel' || S.act === 'tip') startReload(w, S.resume);
    }
    if (S.tipWant) {
      S.tipWant = false;
      if (!moving && has('hat_tip.0') && (S.act === '' || S.act === 'duel')) { if (S.out) { S.act = 'holster'; S.at = 0; S.next = 'tip'; } else { S.act = 'tip'; S.at = 0; } }
    }
    if (S.fanWant) { S.fanWant = false; if (S.act !== 'fan' && S.act !== 'reload') startFan(w); }
    if (S.whipWant) {
      S.whipWant = false;
      if (has('gun_whip.0') && (S.act === '' || S.act === 'fire' || S.act === 'raise' || S.act === 'twirl' || S.act === 'dry' || S.act === 'blow' || S.act === 'tip' || S.act === 'duel' || S.act === 'hip')) {
        if (S.out) startWhip(w); else { startDraw(w, false); S.next = 'whip'; }
      }
    }
    if (!S.want && H.autoFire?.() && S.act !== 'reload' && S.act !== 'fan') { S.want = 1; S.wantT = 0; }   // AUTO FIRE (features/aim.js 'auto'): a press, at the gun's own pace
    if (S.want) consumePress(w, moving);
    if (S.resume && S.out && !S.act && !S.want) startReload(w, true);
    if (!S.out && !S.act && P.state === 'draw') startDraw(w, false);   // LMB held out of a roll: the gun comes up (no shot)
    if (!S.out && !S.act && S.duel && !moving && !mouse.down && has('duel_ready.0') && (P.state === 'idle' || P.state === 'pose')) { S.act = 'duel'; S.at = 0; }
    if (!S.out && !S.act) return false;   // holstered, nothing to do: player.js's locomotion
    if (stepTraverse(dt)) { interrupt(); return true; }   // (off a ledge: falling)

    // ---- the action ----
    switch (S.act) {
      case 'draw': {
        S.at += dt;
        const td = S.at * w.draw;   // (the draw's speed: the weapon's)
        if (S.hip && !moving && stepAt('gun_draw', td) >= mark('gun_draw', 'hip', 2)) { S.out = true; S.act = 'hip'; S.at = 0; S.want = 0; S.hip = false; plant(dt); fire(w, 'hip'); P.frame = nm('gun_hipfire', 0); break; }
        if (!over('gun_draw', td)) { if (moving) movingAim(dt, mx, my); else { plant(dt); P.frame = frameAt('gun_draw', td); } break; }
        S.out = true; S.act = ''; S.at = 0; S.hip = false;   // out: the shot it was drawn for, or the ready pose
        if (S.next === 'fan') { S.next = ''; startFan(w); } else if (S.next === 'whip') startWhip(w); else if (S.want) consumePress(w, moving);
        if (S.act === 'fan' || S.act === 'fire' || S.act === 'dry' || S.act === 'whip') { plant(dt); P.frame = S.act === 'fan' ? nm('gun_fan', 0) : S.act === 'fire' ? nm('gun_fire', 0) : S.act === 'whip' ? nm('gun_whip', 0) : P.frame; break; }
        if (moving) movingAim(dt, mx, my); else standingAim(dt);
        break;
      }
      case 'turn': {   // the spin round onto a target behind him (at the draw's speed): the shot at its mark, then his facing round
        S.at += dt; plant(dt);
        const td = S.at * w.draw;
        if (!S.done && stepAt('gun_turnshot', td) >= mark('gun_turnshot', 'shot', 7)) { S.done = true; S.out = true; if (S.ammo > 0) fire(w, 'turn'); }   // (it starts only with a round in)
        if (over('gun_turnshot', td) || (S.done && moving)) {   // (moving off after the shot: the gun stays up)
          P.face = P.want = (P.face + A.ND / 2) % A.ND; S.out = true; S.act = ''; S.at = 0;
          if (moving) movingAim(dt, mx, my); else standingAim(dt);
        } else P.frame = frameAt('gun_turnshot', td);
        break;
      }
      case 'whip':   // the pistol whip (feet planted, the blow's lunge): the melee at its mark, back to the aim
        S.at += dt; plant(dt);
        if (!S.done && stepAt('gun_whip', S.at) >= mark('gun_whip', 'hit', 4)) { S.done = true; whipLands(w); }
        if (over('gun_whip', S.at)) { S.act = ''; S.idle = 0; if (moving) movingAim(dt, mx, my); else standingAim(dt); }
        else P.frame = frameAt('gun_whip', S.at);
        break;
      case 'hip':
        S.at += dt;
        if (over('gun_hipfire', S.at)) { S.act = ''; standingAim(dt); } else { plant(dt); P.frame = frameAt('gun_hipfire', S.at); }
        break;
      case 'fire':
        S.at += dt;
        if (moving || over('gun_fire', S.at)) { S.act = ''; if (moving) movingAim(dt, mx, my); else standingAim(dt); }
        else { plant(dt); P.frame = frameAt('gun_fire', S.at); }
        break;
      case 'fan': {   // the palm sweeps the hammer: a shot each sweep (the frame's swing), the feet planted
        plant(dt); P.want = bestFacing(nm('gun_fan', mark('gun_fan', 'shot', 1))); turnToward(P.want, dt, AIM_TURN_RATE);
        const gap = w.fanGap * mv('weapon.gap', 1), t0 = S.fanT; S.fanT += dt;
        for (let n = Math.floor(t0 / gap + .5); n < Math.floor(S.fanT / gap + .5) && S.ammo > 0; n++) fire(w, 'fan');
        const ph = (S.fanT / gap) % 1, fc = clip('gun_fan').frames;
        if (S.ammo <= 0 && ph >= .5 + .5 / fc) {   // empty: back up to the aim (an atlas without the rise: the kick's tail)
          if (mv('weapon.endless', 0) > 0) S.ammo = S.cap;
          if (has('gun_fan_out.0')) { S.act = 'raise'; S.at = 0; P.frame = nm('gun_fan_out', 0); }
          else { S.act = 'fire'; S.at = startOf('gun_fire', 1); P.frame = nm('gun_fire', 1); }
          break;
        }
        P.frame = nm('gun_fan', Math.floor(ph * fc) % fc);   // the shot leaves halfway through a sweep (mark shot)
        break;
      }
      case 'raise':   // from the hip (the fan) up to the aim
        S.at += dt;
        if (moving || over('gun_fan_out', S.at)) { S.act = ''; if (moving) movingAim(dt, mx, my); else standingAim(dt); }
        else { plant(dt); P.frame = frameAt('gun_fan_out', S.at); }
        break;
      case 'reload': reloadStep(dt, w, moving, mx, my); break;
      case 'dry':
        S.at += dt;
        if (moving) movingAim(dt, mx, my); else standingAim(dt);
        if (S.at >= w.dry) { S.act = ''; startReload(w, S.resume); }
        break;
      case 'twirl':
        S.at += dt;
        if (over('gun_twirl', S.at)) { S.act = ''; standingAim(dt); } else { plant(dt); P.frame = frameAt('gun_twirl', S.at); }
        break;
      case 'holster':
        S.at += dt; plant(dt); P.state = 'pose';
        if (over('gun_holster', S.at)) {
          S.out = false; S.act = S.next || ''; S.next = ''; S.at = 0; emit('player.holster', w, {});
          if (S.act === 'tip') P.frame = nm('hat_tip', 0); else { P.state = 'idle'; P.t = 0; P.frame = 'idle.0'; }
        } else P.frame = frameAt('gun_holster', S.at);
        break;
      case 'blow':
        S.at += dt; plant(dt); P.state = 'pose';
        if (over('gun_blow', S.at)) { S.act = 'holster'; S.at = startOf('gun_holster', mark('gun_holster', 'hip', 0)); P.frame = frameAt('gun_holster', S.at); }   // (already at the hip)
        else P.frame = frameAt('gun_blow', S.at);
        break;
      case 'tip':
        S.at += dt; plant(dt); P.state = 'pose';
        if (over('hat_tip', S.at)) { S.act = ''; P.state = 'idle'; P.t = 0; P.frame = 'idle.0'; } else P.frame = frameAt('hat_tip', S.at);
        break;
      case 'duel': {   // crouched, the hand twitching over the holster, while the cue lasts
        plant(dt); P.state = 'pose'; S.at += dt;
        const c = cursorAim(); P.want = dirOf(c.x - P.x, c.y - P.y); turnToward(P.want, dt, TURN_RATE);
        if (!S.duel) { S.act = ''; P.state = 'idle'; P.t = 0; P.frame = 'idle.0'; }
        else P.frame = frameAt('duel_ready', S.at);
        break;
      }
      default:   // ready: the gun up and on the cursor
        S.idle = mouse.down ? 0 : S.idle + dt;
        if (!moving && S.flourish && S.calm && !mouse.down && S.idle > TUNE.blowAfter && has('gun_blow.0')) { S.flourish = false; S.act = 'blow'; S.at = 0; plant(dt); P.state = 'pose'; P.frame = nm('gun_blow', 0); break; }
        if (!moving && !mouse.down && S.idle > w.ready) {
          if (has('gun_holster.0')) { S.act = 'holster'; S.at = 0; plant(dt); P.state = 'pose'; P.frame = nm('gun_holster', 0); }
          else { S.out = false; P.state = 'idle'; P.t = 0; }
          break;
        }
        if (moving) movingAim(dt, mx, my); else standingAim(dt);
    }
    if (S.act === 'draw' || S.act === 'hip' || S.act === 'fire' || S.act === 'fan' || S.act === 'raise' || S.act === 'reload' || S.act === 'dry' || S.act === 'twirl' || S.act === 'turn' || S.act === 'whip' || (S.out && !S.act)) P.state = 'draw';
    P.t = S.out && S.ammo > 0 && (S.act === '' || S.act === 'fire' || S.act === 'raise' || S.act === 'twirl') ? 1 : 0;   // the reticle: gold when a shot is ready
    return true;
  }

  // ---------------------------------------------------------------- input (between steps: flags the step reads)
  function press() {   // LMB down
    mouse.down = true; P.recover = 0; S.want = 1; S.wantT = 0;
    if (P.state !== 'draw' && P.state !== 'roll' && !BUSY.has(P.state)) { P.aimBack = false; P.stanceAge = 9; S.aclip = null; S.lastSa = NaN; }
  }
  return {
    S, TUNE, on, step, press, weapon,
    fan() { if (on()) S.fanWant = true; return on(); },             // RMB
    reload() { if (on()) S.reloadWant = true; return on(); },       // R
    melee() { if (on() && has('gun_whip.0')) { S.whipWant = true; return true; } return false; },   // V: the pistol whip (an atlas with it)
    get canMelee() { return on() && has('gun_whip.0'); },
    emote(kind) { if (on() && kind === 'tip' && has('hat_tip.0')) { S.tipWant = true; return true; } return false; },   // Y
    cue(kind) { if (kind === 'kill' && S.out && has('gun_blow.0')) S.flourish = true; },   // a kill: smoke to blow off, when calm
    setCues(calm, duel, near = false) { S.calm = calm; S.duel = duel; S.near = near; },   // the gun feature, each step: nothing hunting
                                                                    // nearby / an elite near / a foe within the whip's reach
    // the hands are wanted for something else (sim/player/lasso.js: the lasso): the gun goes back in the holster at once
    stow() { if (!S.out && !S.act) return; interrupt(); if (P.state === 'draw' || P.state === 'pose') { P.state = 'idle'; P.t = 0; } },
    get reloading() { return S.act === 'reload'; },
    // (views) the gunslinger is blowing on the barrel: the clip's puff frames (an atlas without marks: its middle frames)
    get blowing() {
      if (S.act !== 'blow') return false;
      const M = clip('gun_blow').marks, a = M ? M.puff0 : 1, b = M ? M.puff1 : 3;
      for (let i = a; i <= b; i++) if (P.frame === nm('gun_blow', i)) return true;
      return false;
    },
    // (views) the muzzle of pose `frame` at facing f: out.x / out.y = sprite px from the pivot (the feet), out.a = the
    // barrel's screen angle; null when the pose has no gun bones
    barrel(frame, f, out) {
      const sp = A.SP[frame], b = sp && sp.bones && sp.bones[A.DIRS[f]], m = b && b.GunMuzzle0; if (!m) return null;
      let dx = m[2] - m[0], dy = m[3] - m[1]; const g = b.GunHold0; if (g) { dx += g[2] - g[0]; dy += g[3] - g[1]; }
      out.x = m[0] - A.PIV[0]; out.y = m[1] - A.PIV[1]; out.a = Math.atan2(dy, dx); return out;
    },
  };
}
