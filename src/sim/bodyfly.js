// BODYFLY: a body THROWN through the world (a kick, a shoulder barge: docs/exp/brawl.md), for any owner of bodies (combat's
// brutes, the desert's gunmen). It is the player's launch (sim/player/launch.js) in the WORLD frame: the body is a ball at its
// middle (`mid` m over its feet as it stood, `lie` m over the ground once down) that flies with gravity, and the owner's world
// decides what stops it:
//   walls    W.solid(x, y, h0, h1, r): anything solid in that column between h0 and h1 (a wall up to its own top, a prop, a
//            trunk). Tested from the ball's bottom (its centre - lie) up: a breach whose stones are lower than that is flown
//            OVER, a whole wall stops it. Hitting one faster than SLAM.min is a SLAM (ev 'slam', F.speed: the speed into it): it
//            bounces off weakly and slides down the face
//   ledges   higher ground than its bottom + STEP (a cliff's face from below) stops it as a wall; lower ground lets it fall on:
//            the drop from where it was thrown (F.g0, or the highest ground it passed) is counted at the landing (F.drop)
//   water    W.water(x, y) where it comes down: ev 'water' (the owner decides: splash, stun, out on a bank)
//   void     W.void?.(x, y): ground that is no ground (the desert's canyon): ev 'void' as it falls past its rim
//   ground   a hard landing bounces once (ev 'land' the first time: F.drop), then it slides with friction until it RESTS (ev 'rest')
// Pure and deterministic: no random draws, no allocation per step (the record is the owner's, made once with flight()).
//   const F = flight(); throwBody(F, x, y, z (the ground), vx, vy, up, o?); each sim step: stepFlight(F, dt, W) -> F.ev
//   F.x / y / c (the ball, absolute height) / vx / vy / vc; feetOf(F): where its feet hang (absolute: the owner's p.z + p.h);
//   F.on false once it rests (or splashed, or fell into the void)
// OWNS: nothing outside the record. BUDGET: per flying body a step: two or three solid() tests, two elev() reads.
export const FLY = {
  g: 22,                                // m/s^2 (the player's launch: a little floatier than a fall)
  slam: {min: 2.6, e: .18, slide: .5, up: .35, cool: .2},   // into a wall: faster than min m/s is a slam; e: x the speed back off it
  bounce: {min: 3.2, e: .26, fric: 5.5, rest: .45},         // the ground: a bounce off a hard landing, friction (1/s), at rest under (m/s)
  step: .3,                             // m: ground higher than the ball's bottom by more than this is a face (a step lower is climbed)
  max: 4,                               // s: a flight never lasts longer (it rests where it is)
};

export function flight() {
  return {on: false, x: 0, y: 0, c: 0, vx: 0, vy: 0, vc: 0, mid: .95, lie: .16, r: .3, t: 0, g0: 0, top: 0, landed: false, air: true, cool: 0,
    ev: '', speed: 0, drop: 0, hx: 0, hy: 0};
}
// where its feet hang under the ball as it flies (absolute height): the owner's p.z + p.h (never under the ground's lie)
export const feetOf = F => F.c - F.mid;
// a new throw from where it stands (z: the ground under its feet), or a second one adding to a flight (a barge into a kicked one)
export function throwBody(F, x, y, z, vx, vy, up, o = null) {
  if (!F.on) {
    F.on = true; F.x = x; F.y = y; F.mid = o?.mid ?? .95; F.lie = o?.lie ?? .16; F.r = o?.r ?? .3;
    F.c = z + (o?.h0 ?? F.mid); F.vx = F.vy = F.vc = 0; F.t = 0; F.g0 = z; F.top = z; F.landed = false; F.air = true; F.cool = 0; F.drop = 0;
  }
  F.vx += vx; F.vy += vy; F.vc = Math.max(F.vc, 0) + up; F.ev = '';
  return F;
}
// one step: moves the ball, F.ev says what happened ('' | slam | land | water | void | rest)
export function stepFlight(F, dt, W) {
  F.ev = ''; if (!F.on) return F;
  F.t += dt; if (F.cool > 0) F.cool -= dt;
  F.vc -= FLY.g * dt; F.c += F.vc * dt;
  // along the ground, per axis (as the player's moveBy): what's solid in the ball's column, the ground's faces
  const sx = F.vx, sy = F.vy, dx = sx * dt, dy = sy * dt, h0 = F.c - F.lie, h1 = F.c + .3;
  let hx = false, hy = false;
  if (dx) { const nx = F.x + dx; if (W.elev(nx, F.y) > h0 + FLY.step || W.solid(nx, F.y, h0, h1, F.r)) hx = true; else F.x = nx; }
  if (dy) { const ny = F.y + dy; if (W.elev(F.x, ny) > h0 + FLY.step || W.solid(F.x, ny, h0, h1, F.r)) hy = true; else F.y = ny; }
  if (hx || hy) {
    const vn = hx && hy ? Math.hypot(sx, sy) : hx ? Math.abs(sx) : Math.abs(sy);
    if (vn > FLY.slam.min && !(F.cool > 0)) {   // the SLAM (the owner hurts it; the views take it from its event)
      F.cool = FLY.slam.cool; F.ev = 'slam'; F.speed = vn; F.hx = hx ? Math.sign(sx) : 0; F.hy = hy ? Math.sign(sy) : 0;
      if (F.vc > 0) F.vc *= FLY.slam.up;   // (the wall takes its rise: it slides down the face)
    }
    if (hx) F.vx = -sx * FLY.slam.e; else F.vx *= FLY.slam.slide;
    if (hy) F.vy = -sy * FLY.slam.e; else F.vy *= FLY.slam.slide;
  }
  const g = W.elev(F.x, F.y);
  if (W.void?.(F.x, F.y) && F.c - F.lie < g + .5) { F.ev = 'void'; F.on = false; return F; }
  const floor = g + F.lie;
  if (F.c <= floor) {
    F.c = floor;
    if (W.water(F.x, F.y)) { F.ev = 'water'; F.drop = Math.max(0, F.top - g); F.vx = F.vy = F.vc = 0; F.on = false; return F; }
    if (F.air) {   // down from the air: the drop from the ground it last stood or slid on (off a ledge: the ledge's)
      F.air = false; F.drop = Math.max(0, F.top - g);
      if (!F.ev && (!F.landed || F.drop > .6)) F.ev = 'land';
      F.landed = true;
    }
    F.top = g;
    if (F.vc < -FLY.bounce.min) { F.vc = -F.vc * FLY.bounce.e; F.air = true; } else F.vc = 0;
    const k = Math.exp(-dt * FLY.bounce.fric); F.vx *= k; F.vy *= k;
    if (F.vc === 0 && Math.hypot(F.vx, F.vy) < FLY.bounce.rest) { F.vx = F.vy = 0; if (!F.ev) F.ev = 'rest'; F.on = false; return F; }
  } else if (F.c > floor + .05) { F.air = true; if (g > F.top) F.top = g; }
  if (F.t > FLY.max) { F.c = Math.max(F.c, floor); F.vx = F.vy = F.vc = 0; if (!F.ev) F.ev = 'rest'; F.on = false; }
  return F;
}
