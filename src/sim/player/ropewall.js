// ROPE WALL (docs/exp/ropeclimb.md): climbing a rope on a face with the legs, under the player's control. The lasso's rope-up
// hands him over here once its loop holds an anchor at a lip (sim/player/lasso.js ropeup -> start); like sim/player/lasso.js it
// runs inside player.js's step and, while it has him, drives the frame, the facing, the state ('rope', in BUSY) and his place.
// SIM: fixed steps, no random draws; it lives in the WORLD (the face, the anchor), P (the view frame) is written from it each step.
// WHAT UNDER HIS BOOTS PICKS THE TECHNIQUE (S.tech), probed each step (W.solid / W.elev; no scans over props):
//   approach  walking to the face's foot (the rope's anchor is up there)
//   walk      WALL-WALK: the boots on the face, leaning back on the rope. W / S up and down, A / D along the face (by the screen):
//             the TENSION TRAVERSE: easy near the anchor's fall line, harder out from it, drifting back past TUNE.tension.hold,
//             and pushed out past .slip the boots slip: SWING. Still on a ledge: he sits back on it (rest, a frame)
//   swing     the RUNNING PENDULUM along the face (the boots running on it): A / D with the swing pumps it; back to the walk as it
//             settles
//   bound     Space: a RAPPEL BOUND, out from the face and down, the boots back on it (near the ground Space jumps off)
//   free      FOOT LOCK: no face where his boots would go (an overhang, a gap): up / down the hanging rope in inchworm cycles
//   line      HAND-LINE: a face under TUNE.line.slope deg is walked up upright, pulling along the rope
//   top       the TOP-OUT: up and over the lip onto the top
// Off the rope: onto the top (why 'top'), back on the ground (why 'ground': S at the foot), F (why 'key': he drops), Space near the
// ground (why 'jump'). Each emits lasso.letgo (the lasso's rope comes back: features/equip/lasso.js) and hands the lasso back
// (PL.lasso.wallDone()).
// STAND-INS: the atlas's frames until the live clips exist (the lasso's hang poses, climb, mantle, crouch, walk, leap).
// OWNS: S (the technique, the face, his place on it, the swing). While on: P's frame / face / want / state / x / y / z / vx / vy
//   (+ vz / fall0 off the rope), as lasso.js does.
// READS: the keys (W A S D, Shift), the world helpers handed to start() (elev, water, solid), H.yaw (world <-> view), the lasso's
//   hang frames (PL.lasso.tls()).
// EMITS (player.js's queue, the view frame; core/events.js): rope.step (a boot on the face), rope.slip, rope.bound, rope.top,
//   lasso.letgo {why} at the end. CALLS: H.ropeCam(yaw) at the start (the adapter eases the camera side-on and back).
// BUDGET: part of player.step: a handful of probes (W.solid / W.elev) a step while he moves.
//   const R = createRopeWall(PL, internals); R.start(...) -> bool; R.step(dt, mx, my) -> true while it drives
import {TUNE} from '../../content/ropewall.js';
import {clamp, hypot2} from '../../core/mathx.js';

const DEG = Math.PI / 180;

export function createRopeWall(PL, I) {
  const {P, A, H, has, ev, dirOf, turnToward, moveBy, BUSY, TURN_RATE} = I;
  const {keys} = H, T = TUNE;
  const S = {on: false, tech: '', t: 0, W: null, why: '',
    ax: 0, ay: 0, ah: 0,            // the anchor (world)
    fx: 0, fy: 0,                   // the face's foot, out from the face (where he walks to)
    tx: 0, ty: 0, tz: 0,            // the top he climbs onto (a standable spot by the anchor)
    px: 0, py: 0, nx: 0, ny: 1,     // the face: a point on it, its outward normal (horizontal); along it: (-ny, nx)
    u: 0, h: 0, ua: 0,              // his boots on the face: along it (from px, py), height (world); the anchor's u
    off: 0, g: 0,                   // his body out from the face; the ground under him
    th: 0, om: 0, R: 1,             // the swing: angle from the fall line (rad, + toward +u), its rate, the pendulum's length
    k: 0, h0: 0, u0: 0,             // a move's progress and its start (bound, top)
    dist: 0, still: 0, foot: 0, slope: false, want: false, sp: false,
    mv: '', dir: 0, rest: false};   // (for the view: moving 'up' | 'down' | 'side' | 'walk' (the hand-line), along -1 / +1 (u), sat on a ledge)

  // ---- world <-> view at the camera's yaw (render/viewxf.js's maths, no allocation) ----
  let c = 1, s = 0;
  const yaw = () => { const a = H.yaw ? H.yaw() : 0; c = Math.cos(a); s = Math.sin(a); };
  const OV = [0, 0];
  const toV = (x, y) => { OV[0] = x * c - y * s; OV[1] = x * s + y * c; return OV; };
  const toW = (x, y) => { OV[0] = x * c + y * s; OV[1] = -x * s + y * c; return OV; };
  const wx = () => P.x * c + P.y * s, wy = () => -P.x * s + P.y * c;

  // ---- the face ----
  // is there face at world (x, y), height h? (stone over his boots there, or ground higher than them)
  const solidAt = (x, y, h) => S.W.solid(x, y, h + .04, h + .45, .06) || S.W.elev(x, y) > h + .08;
  // from (x, y) inward along -n: how far to the face at height h (0..max, max: none within it)
  function depth(x, y, h, max) {
    for (let d = 0; d <= max; d += .05) if (solidAt(x - S.nx * d, y - S.ny * d, h)) return d;
    return max;
  }
  // the face from the top toward the foot: its point (px, py) and outward normal, found by marching out from the top at
  // `h` until the stone ends, there and half a metre to each side (their line is the face)
  const FS = [0, 0, 0, 0, 0, 0];
  function faceOut(x0, y0, ux, uy, h, i) {
    for (let d = 0; d < 4; d += .04) if (!solidAt(x0 + ux * d, y0 + uy * d, h)) { FS[i] = x0 + ux * d; FS[i + 1] = y0 + uy * d; return true; }
    return false;
  }
  function findFace(fx, fy, tx, ty, h) {
    let ux = fx - tx, uy = fy - ty; const l = hypot2(ux, uy) || 1; ux /= l; uy /= l;
    S.nx = ux; S.ny = uy;
    if (!faceOut(tx, ty, ux, uy, h, 0)) { S.px = fx - ux * .32; S.py = fy - uy * .32; return; }
    S.px = FS[0]; S.py = FS[1];
    const ax = -uy * .5, ay = ux * .5;
    if (faceOut(tx + ax, ty + ay, ux, uy, h, 2) && faceOut(tx - ax, ty - ay, ux, uy, h, 4)) {
      let ex = FS[2] - FS[4], ey = FS[3] - FS[5]; const el = hypot2(ex, ey);
      if (el > .5) {
        ex /= el; ey /= el; let nx = ey, ny = -ex;
        if (nx * ux + ny * uy < 0) { nx = -nx; ny = -ny; }
        if (nx * ux + ny * uy > .6) { S.nx = nx; S.ny = ny; }
      }
    }
  }
  // the boots' point on the face at u (the face's plane; the stone's own depth there corrects it each step)
  const fpx = u => S.px - S.ny * u, fpy = u => S.py + S.nx * u;   // (along: (-ny, nx))
  const uOf = (x, y) => (x - S.px) * -S.ny + (y - S.py) * S.nx;

  // ---- the stand-in frames ----
  let HANG = null;
  function hang(i) {
    if (!HANG) HANG = PL.lasso?.tls?.()?.hang || [];
    return HANG[i] || (has('climb.0') ? 'climb.0' : 'idle.0');
  }
  function cycle(clip, dist, stride) {   // a clip's frame by distance (m), stride m a cycle
    const C = A.CLIP[clip]; if (!C || !has(clip + '.0')) return null;
    const n = C.frames || 4; return clip + '.' + (Math.floor(((dist / stride) % 1 + 1) % 1 * n) % n);
  }

  // ---- placing him (view frame) ----
  function place(dt) {
    const bx = fpx(S.u) + S.nx * S.off, by = fpy(S.u) + S.ny * S.off, v = toV(bx, by);
    const ox = P.x, oy = P.y; P.x = v[0]; P.y = v[1]; P.z = S.h;
    if (dt > 0) { P.vx = (P.x - ox) / dt; P.vy = (P.y - oy) / dt; }
    const f = toV(-S.nx, -S.ny); P.want = dirOf(f[0], f[1]); turnToward(P.want, dt || 1, TURN_RATE);
  }
  const ground = () => S.W.elev(fpx(S.u) + S.nx * .5, fpy(S.u) + S.ny * .5);
  const thOf = () => Math.atan2(S.u - S.ua, Math.max(.3, S.ah - (S.h + 1.2)));

  // ---- off the rope ----
  function end(why, vx = 0, vy = 0, vz = 0) {
    S.on = false; S.tech = ''; S.want = false;
    if (why === 'top' || why === 'ground') { P.state = 'idle'; P.vx = P.vy = 0; }
    else { const v = toV(vx, vy); P.state = 'fall'; P.vx = v[0]; P.vy = v[1]; P.vz = vz; P.fall0 = P.z; }
    P.t = 0; P.prevF = -1;
    ev({type: 'lasso.letgo', x: P.x, y: P.y, z: P.z, vx: P.vx, vy: P.vy, vz, why});
    PL.lasso?.wallDone?.();
  }

  // ---- input on the face: up (W) / down (S); along (A / D by the screen: +1 toward +u) ----
  const IN = {up: 0, side: 0, shift: false};
  function input() {
    IN.up = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    const lr = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const r = toW(1, 0), along = r[0] * -S.ny + r[1] * S.nx;   // (screen right, in the world, along the face)
    IN.side = lr * (along >= 0 ? 1 : -1); IN.shift = keys.has('shift');
  }

  function stepWalk(dt) {
    const W = T.walk, TN = T.tension;
    S.g = ground();
    // up / down
    let dh = 0;
    if (IN.up > 0) dh = W.up * dt; else if (IN.up < 0) dh = -W.down * dt;
    if (dh < 0 && S.h + dh <= S.g + .02) {   // down to the ground: S there steps him off
      S.h = S.g; S.off = .32; place(dt); P.frame = 'idle.0'; end('ground'); return;
    }
    // along the face: the tension traverse
    const th = thOf(), out = IN.side !== 0 && Math.sign(IN.side) === Math.sign(S.u - S.ua || IN.side);
    let du = 0;
    if (IN.side) {
      const q = out ? Math.max(TN.floor, 1 - (Math.abs(th) / (TN.slip * DEG)) ** 2) : 1;   // (harder the further out, never stuck: he can push on into the slip)
      du = IN.side * W.side * q * dt;
      if (out && Math.abs(th) >= TN.slip * DEG) {   // the boots slip: he swings
        S.tech = 'swing'; S.t = 0; S.th = th; S.om = 0; S.R = Math.max(1, Math.hypot(S.u - S.ua, S.ah - (S.h + 1.2)));
        ev({type: 'rope.slip', x: P.x, y: P.y, z: P.z}); return;
      }
    } else if (Math.abs(th) > TN.hold * DEG) du = -Math.sign(th) * TN.drift * dt;   // the rope pulls him back toward the fall line
    // the face where he would go: none there (an overhang, a gap): the foot lock; the top in reach with W held: over it
    const nu = S.u + du, nh = S.h + dh;
    if (IN.up > 0 && nh >= S.tz - T.top.reach) { S.tech = 'top'; S.t = 0; S.k = 0; S.h0 = S.h; S.u0 = S.u; return; }
    const d = depth(fpx(nu) + S.nx * .3, fpy(nu) + S.ny * .3, nh, .3 + T.lock.reach);
    if (d >= .3 + T.lock.reach) { S.tech = 'free'; S.t = 0; S.foot = 0; return; }
    const moved = Math.abs(du) + Math.abs(dh);
    const before = Math.floor(S.foot / W.step);
    S.u = nu; S.h = nh; S.foot += moved;
    if (Math.floor(S.foot / W.step) !== before) ev({type: 'rope.step', x: P.x, y: P.y, z: P.z});
    S.dist = d - .3;   // (the stone's own depth here past the face's plane: the view puts the boots on it)
    S.still = moved > 0 ? 0 : S.still + dt;
    S.mv = dh > 0 ? 'up' : dh < 0 ? 'down' : du ? 'side' : ''; S.dir = Math.sign(du); S.rest = !moved && S.still > T.rest.after && ledge();
    // the frame: moving up / down hand over hand, along the face the hang's legs by turns, still: the lean back (a ledge: sitting)
    if (dh) P.frame = cycle('climb', S.foot, W.step * 2) || hang(S.foot % (W.step * 2) < W.step ? 0 : 1);
    else if (du) P.frame = hang(S.foot % (W.step * 2) < W.step ? 0 : 2);
    else if (S.rest) P.frame = has('crouch') ? 'crouch' : hang(0);
    else P.frame = hang(0);
  }
  // a ledge under his boots (a sill, a string course, a step in the face): stone ends just under them and is clear just over
  const ledge = () => { const x = fpx(S.u) - S.nx * T.rest.deep, y = fpy(S.u) - S.ny * T.rest.deep; return Math.abs(S.W.elev(x, y) - S.h) < .08 && !S.W.solid(x, y, S.h + .1, S.h + .6, .05); };

  function stepSwing(dt) {
    const SW = T.swing, n = 2, h = dt / n, max = SW.max * DEG;
    for (let k = 0; k < n; k++) {
      const pump = IN.side && Math.sign(IN.side) === Math.sign(S.om || IN.side);   // running with the swing: pumping it
      let a = -(SW.g / S.R) * Math.sin(S.th) - (pump ? SW.damp : SW.brake) * S.om;   // (not running: the boots drag on the face)
      if (pump) a += IN.side * SW.pump;
      S.om += a * h; S.th += S.om * h;
      if (Math.abs(S.th) > max) { S.th = Math.sign(S.th) * max; S.om = 0; }
    }
    const nu = S.ua + S.R * Math.sin(S.th), nh = Math.max(ground(), S.ah - 1.2 - S.R * Math.cos(S.th));
    const before = Math.floor(S.foot / T.walk.step);
    S.foot += Math.abs(nu - S.u) + Math.abs(nh - S.h); S.u = nu; S.h = nh;
    if (Math.floor(S.foot / T.walk.step) !== before) ev({type: 'rope.step', x: P.x, y: P.y, z: P.z});
    P.frame = cycle('run', S.foot, T.walk.step * 2.4) || hang(S.om > 0 ? 0 : 2);
    if (Math.hypot(S.th, S.om * Math.sqrt(S.R / SW.g)) < SW.settle * DEG) { S.tech = 'walk'; S.t = 0; }   // (its amplitude: settled)
  }

  function stepBound(dt) {
    const B = T.bound, k = Math.min(1, S.t / B.t), e = k * k * (3 - 2 * k);
    S.g = ground();
    S.h = Math.max(S.g, S.h0 - B.drop * e); S.off = T.walk.off + Math.sin(Math.PI * k) * B.out;
    P.frame = has('leap.1') ? (k < .5 ? 'leap.1' : 'leap.2') : hang(2);
    if (k >= 1 || S.h <= S.g + .01) {
      S.tech = 'walk'; S.t = 0; S.off = T.walk.off; ev({type: 'rope.step', x: P.x, y: P.y, z: P.z, big: 1});
      if (S.h <= S.g + .01) { S.h = S.g; S.off = .32; place(dt); end('ground'); }
    }
  }

  function stepFree(dt) {
    const L = T.lock;
    S.g = ground();
    let dh = 0;
    if (IN.up > 0) { const ph = (S.foot / L.cycle) % 1; dh = L.up * dt * (ph < .6 ? 1.3 : .55); }   // (the stand-up of the inchworm, then the reach)
    else if (IN.up < 0) dh = -L.down * dt;
    if (dh < 0 && S.h + dh <= S.g + .02) { S.h = S.g; place(dt); end('ground'); return; }
    if (IN.up > 0 && S.h + dh >= S.tz - T.top.reach) { S.tech = 'top'; S.t = 0; S.k = 0; S.h0 = S.h; S.u0 = S.u; return; }
    S.h += dh; S.foot += Math.abs(dh); S.mv = dh > 0 ? 'up' : dh < 0 ? 'down' : '';
    // the rope hangs from the anchor: his body under it (out from the face by the anchor's own distance, a little more)
    const ad = (S.ax - S.px) * S.nx + (S.ay - S.py) * S.ny;
    S.off = Math.max(.25, ad + .2); S.u += (S.ua - S.u) * Math.min(1, dt * 4);
    const d = depth(fpx(S.u) + S.nx * .3, fpy(S.u) + S.ny * .3, S.h, .3 + L.reach);
    if (d < .3 + L.reach * .8) { S.tech = 'walk'; S.t = 0; S.off = T.walk.off; return; }   // the face again under his boots
    P.frame = dh > 0 && (S.foot / L.cycle) % 1 > .6 ? (has('reach_up') ? 'reach_up' : hang(1)) : hang(1);
  }

  function stepTop(dt) {
    const k = Math.min(1, S.t / T.top.t), e = k * k * (3 - 2 * k);
    // from the face over the lip to the top: in toward the top, up to its height first
    const fx = fpx(S.u0) + S.nx * T.walk.off, fy = fpy(S.u0) + S.ny * T.walk.off;
    const x = fx + (S.tx - fx) * e, y = fy + (S.ty - fy) * e, v = toV(x, y);
    P.x = v[0]; P.y = v[1]; P.vx = P.vy = 0;
    S.h = S.h0 + (S.tz - S.h0) * Math.min(1, e * 1.7); P.z = S.h;
    P.frame = k < .6 ? (has('mantle.0') ? 'mantle.0' : 'crouch') : 'crouch';
    if (k >= 1) { P.z = S.tz; ev({type: 'rope.top', x: P.x, y: P.y, z: P.z}); end('top'); }
  }

  function stepLine(dt) {
    const L = T.line;
    // up the slope toward the top (W), down it (S), along it (A / D) as on the wall, upright on the ground
    const x = wx(), y = wy();
    let ix = 0, iy = 0;
    if (IN.up > 0) { const dx = S.tx - x, dy = S.ty - y, d = hypot2(dx, dy) || 1; ix = dx / d * L.walk; iy = dy / d * L.walk; }
    else if (IN.up < 0) { ix = S.nx * L.down; iy = S.ny * L.down; }
    if (IN.side) { ix += -S.ny * IN.side * L.side; iy += S.nx * IN.side * L.side; }
    const nx2 = x + ix * dt, ny2 = y + iy * dt;
    if (!S.W.solid(nx2, ny2, S.W.elev(nx2, ny2) + .1, S.W.elev(nx2, ny2) + 1.5, .2)) {
      const v = toV(nx2, ny2); P.x = v[0]; P.y = v[1];
      const vv = toV(ix, iy); P.vx = vv[0]; P.vy = vv[1];
    } else { P.vx = P.vy = 0; }
    P.z = S.W.elev(wx(), wy()); S.foot += hypot2(ix, iy) * dt; S.mv = ix || iy ? 'walk' : '';
    const f = IN.up < 0 ? toV(S.nx, S.ny) : toV(-S.nx, -S.ny); P.want = dirOf(f[0], f[1]); turnToward(P.want, dt, TURN_RATE);
    P.frame = (ix || iy) ? cycle('walk', S.foot, 1.1) || 'idle.0' : 'idle.0';
    if (hypot2(S.tx - wx(), S.ty - wy()) < .35 && Math.abs(P.z - S.tz) < .1) { ev({type: 'rope.top', x: P.x, y: P.y, z: P.z}); end('top'); return; }
    if (IN.up < 0 && hypot2(S.fx - wx(), S.fy - wy()) < .3) end('ground');
  }

  function stepApproach(dt) {
    const x = wx(), y = wy(), dx = S.fx - x, dy = S.fy - y, d = hypot2(dx, dy);
    if (d < .1 || S.t > T.approach.max) { take(); return; }
    const v = toV(dx / d, dy / d), sp = Math.min(T.approach.walk, d / dt);
    P.vx = v[0] * sp; P.vy = v[1] * sp; const got = moveBy(P.vx * dt, P.vy * dt);
    if (got < sp * dt * .3 && S.t > .3) { take(); return; }   // (against the face already)
    P.want = dirOf(v[0], v[1]); turnToward(P.want, dt, TURN_RATE);
    S.foot += got; P.frame = cycle('walk', S.foot, 1.1) || 'idle.0';
  }
  // at the foot: onto the face (the walk) or up the slope (the hand-line)
  function take() {
    yaw();
    S.t = 0; S.foot = 0;
    if (S.slope) { S.tech = 'line'; return; }
    S.u = uOf(wx(), wy()); S.ua = uOf(S.ax, S.ay); S.g = ground();
    S.h = S.g + T.walk.onto; S.off = T.walk.off; S.tech = 'walk';
    ev({type: 'rope.step', x: P.x, y: P.y, z: P.z});
  }

  return {
    S,
    get active() { return S.on; },
    get tech() { return S.tech; },
    // the rope from anchor (ax, ay, ah) at a lip over the top (tx, ty, tz), the face's foot (fx, fy) out on his side; W: {elev,
    // water, solid} in the world (the lasso's) -> false: not now (off by ?ropewall=0, busy, mid-air)
    start(ax, ay, ah, fx, fy, tx, ty, tz, W) {
      if (H.ropewallOn === false || BUSY.has(P.state) && P.state !== 'rope' || P.state === 'roll' || P.state === 'backstep') return false;
      yaw();
      Object.assign(S, {on: true, tech: 'approach', t: 0, W, ax, ay, ah, fx, fy, tx, ty, tz, th: 0, om: 0, foot: 0, still: 0, want: false, sp: keys.has(' '), mv: '', dir: 0, rest: false});
      findFace(fx, fy, tx, ty, Math.max(W.elev(fx, fy) + .5, tz - 1));
      S.ua = uOf(ax, ay);
      // a slope, not a face: the ground rises from the foot to the top at under TUNE.line.slope deg, nothing in the way
      const run = Math.max(.1, hypot2(tx - fx, ty - fy)), rise = tz - W.elev(fx, fy);
      let clear = true;
      for (let k = .1; k < .95 && clear; k += .1) { const x = fx + (tx - fx) * k, y = fy + (ty - fy) * k, e = W.elev(x, y); if (W.solid(x, y, e + .1, e + 1.2, .1)) clear = false; }
      S.slope = clear && Math.atan2(rise, run) < T.line.slope * DEG;
      P.state = 'rope'; P.t = 0; P.aimRoll = false; P.vx = P.vy = 0;
      H.ropeCam?.(Math.atan2(S.nx, S.ny));   // (the camera: side-on to the face; sim/player/adapter.js)
      return true;
    },
    // F: off the rope, he drops (with a little push off the face)
    letGo() { if (!S.on) return; yaw(); end('key', S.nx * .8, S.ny * .8, 0); },
    // Space: a bound on the wall; near the ground, a jump off (read as a key press in step; this is for a caller that has the key)
    space() { if (!S.on) return false; S.want = true; return true; },
    step(dt, mx, my) {
      if (!S.on) return false;
      if (P.state !== 'rope') { S.on = false; PL.lasso?.wallDone?.(); return false; }   // (something else took him: a blast)
      yaw(); input(); S.t += dt; P.t += dt;
      const sp = keys.has(' '); if (sp && !S.sp) S.want = true; S.sp = sp;   // (Space: player.js onSpace is a no-op while he's on the rope)
      if (S.want) {
        S.want = false;
        if (S.tech === 'walk' || S.tech === 'swing') {
          if (S.h - ground() > T.bound.low) { S.tech = 'bound'; S.t = 0; S.h0 = S.h; ev({type: 'rope.bound', x: P.x, y: P.y, z: P.z}); }
          else { end('jump', S.nx * T.bound.jump, S.ny * T.bound.jump, 2); return true; }
        } else if (S.tech === 'free') { end('key'); return true; }
      }
      switch (S.tech) {
        case 'approach': stepApproach(dt); break;
        case 'walk': stepWalk(dt); break;
        case 'swing': stepSwing(dt); break;
        case 'bound': stepBound(dt); break;
        case 'free': stepFree(dt); break;
        case 'line': stepLine(dt); break;
        case 'top': stepTop(dt); break;
      }
      if (S.on && S.tech !== 'approach' && S.tech !== 'line' && S.tech !== 'top') place(dt);
      return true;
    },
    stop() { if (S.on) { yaw(); end('key'); } },
  };
}
