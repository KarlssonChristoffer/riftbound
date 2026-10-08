// LAUNCH: the player THROWN by the world (docs/exp/launch.md). A blast (combat's explode: barrels, the bow's blast arrow,
// dynamite; a Volatile enemy's burst: sim/hazards.js) sends him flying instead of the short skid (player.js knock), when his
// loadout can be thrown (H.canLaunch: a body drawn live, main.js; the sprites keep the skid). He slams into what stands in his
// way, lands, tumbles to a stop, lies a moment and gets up. The sim's body is a ball at his middle: it starts BODY.mid m over
// his feet (his pelvis as he stood), rests BODY.lie m over the ground, and the walls stop it as they stop him (H.blocked at
// his feet's level, any height he flies: walls, props, a cliff's face). The live hero's ragdoll (view/herorag.js) pins its
// pelvis to it; nothing here reads the view.
//   launch  P.state 'launch': gravity (G), the walls (a SLAM when it hits one faster than SLAM.min: he's hurt a little
//           (player.hurt by 'slam'), bounces off weakly (SLAM.e) and slides down the face), the ground (a bounce, then it
//           slides with friction) until it rests: 'down' (or, in the water, the fall's splash back to the bank)
//   down    lying DOWN.t s, or up sooner with Space or a direction held after DOWN.min s
//   getup   GETUP s getting up (still busy; the live hero's mv_getup_b / _f clips by its progress), then GUARD s untouchable
//           (the game's i-frames: PL.untouchable). A direction held turns him toward it as he rises, and from RUN_AT of the way
//           up (on a knee, the weight over the front foot) runs him out of it: straight into the run that way (RUN.k of the
//           run's speed), the safe GUARD s on as well
// throwOf(k) -> [out, up] (m/s) | null: a blast's throw by how close he stood (k: 1 at its heart, 0 at its edge); null below
// THROW.min (a graze: the skid). Its callers turn the 'out' along the blast's way and hand both to host.launch.
// P fields (its own): lc (the body's middle: m, absolute height), lv (its up speed, m/s), lguard (s safe left), lup (Space
// asked to get up), lhit (a slam's cool-down), lland (it has hit the ground once: the first landing's thud). P.vx / vy are the
// body's ground speed (the view frame: the adapter turns them with the camera like every P velocity); P.z while it flies is
// his feet as if he hung under it (never under the ground).
// EMITS: player.launch {x, y, vx, vy, up}, player.slam {x, y, vx, vy (its speed into the wall), speed}, player.hurt {dmg,
// by: 'slam', x, y}, player.land {x, y, z, big: 3} (the first time the body hits the ground), player.floored {x, y},
// player.getup {x, y}.
// OWNS: those P fields and the states. BUDGET: one body a step: a few blocked() tests (~.002 ms).
import {clamp} from '../../core/mathx.js';

export const STATES = ['launch', 'down', 'getup'];   // (player.js puts them in BUSY: no aiming, rolling or actions)
const G = 22;                                        // m/s^2 (the fall's is 24: a little floatier in the air)
const BODY = {mid: .95, lie: .16};                   // m: his middle over his feet standing; over the ground lying
const SLAM = {min: 2.6, e: .18, slide: .55, dmg0: 3, dmgK: 1.1, dmgMax: 10, cool: .2, up: .35};   // into a wall (m/s, x, hp)
const BOUNCE = {min: 3.2, e: .28, fric: 5.5, rest: .45};   // the ground: a bounce off a hard landing, friction, at rest (m/s)
const DOWN = {t: .5, min: .2}, GUARD = .5;   // s
export const GETUP = .8, RUN_AT = .55;   // s getting up (view/herorag.js plays it by P.t / GETUP); from this share of it a held direction runs him out
const RUN = {k: .8};   // the run-out's speed: x the run's
const THROW = {min: .3, out: [4.5, 9.5], up: [3.2, 6.2]};  // closeness k below min: no throw; m/s out and up at k = min .. 1
export function throwOf(k) {
  if (!(k >= THROW.min)) return null;
  const u = clamp((k - THROW.min) / (1 - THROW.min), 0, 1);
  return [THROW.out[0] + (THROW.out[1] - THROW.out[0]) * u, THROW.up[0] + (THROW.up[1] - THROW.up[0]) * u];
}

// I: player.js's internals (P, A, H, has, ev, dirOf, turnToward, moveInput, SPEED, TURN_RATE, elev, inStream, splash, dryBack)
export function createLaunch(I) {
  const {P, H, has, ev, elev, inStream} = I;
  // a throw of (vx, vy) along the ground (the view frame) and vz up: a new flight, or a second blast adding to this one
  function start(vx, vy, vz) {
    if (!H.canLaunch?.() || P.state === 'climb') return false;
    const flying = P.state === 'launch';
    if (!flying) { P.lc = P.z + BODY.mid; P.lv = 0; P.vx = P.vy = 0; P.lland = false; }
    if (!flying && (vx || vy)) P.face = P.want = I.dirOf(-vx, -vy);   // (he comes up facing the blast: thrown off it, he mostly lands
                                                                    // feet toward it, so the get-up needs little turning)
    P.vx += vx; P.vy += vy; P.lv = Math.max(P.lv, 0) + vz;
    P.state = 'launch'; P.t = 0; P.lup = false; P.lhit = 0; P.aimRoll = false; P.queuedShot = false; P.sink = 0;
    ev({type: 'player.launch', x: P.x, y: P.y, vx, vy, up: vz});
    return true;
  }
  // the step (player.js stepTraverse, first): true while it drives him
  function step(dt) {
    if (P.state === 'launch') { fly(dt); return true; }
    if (P.state === 'down') {
      P.vx = P.vy = 0; P.z = elev(P.x, P.y); P.lc = P.z + BODY.lie;
      P.frame = has('land') ? 'land' : 'crouch';
      const [mx, my] = I.moveInput(); if (mx || my) P.lup = true;   // (a direction held gets him up too)
      if (P.t >= DOWN.t || (P.lup && P.t >= DOWN.min)) { P.state = 'getup'; P.t = 0; P.lup = false; ev({type: 'player.getup', x: P.x, y: P.y}); }
      return true;
    }
    if (P.state === 'getup') {
      P.vx = P.vy = 0; P.frame = has('crouch') ? 'crouch' : 'idle.0';
      const [mx, my] = I.moveInput();
      if (mx || my) {   // a direction held: he turns to it as he rises, and runs out of it from RUN_AT on
        P.want = I.dirOf(mx, my); I.turnToward(P.want, dt, I.TURN_RATE);
        if (P.t >= GETUP * RUN_AT) {
          const l = Math.hypot(mx, my), sp = I.SPEED.run * RUN.k;
          P.face = P.want; P.vx = mx / l * sp; P.vy = my / l * sp; P.curSpeed = P.lastSpeed = sp;
          P.state = 'move'; P.gait = 'run'; P.ph = .02; P.prevF = 'run0'; P.frame = 'run.0'; P.t = 0; P.lguard = GUARD;
          return true;
        }
      }
      if (P.t >= GETUP) { P.state = 'idle'; P.t = 0; P.prevF = -1; P.lguard = GUARD; }
      return true;
    }
    return false;
  }
  function fly(dt) {
    P.lv -= G * dt; P.lc += P.lv * dt; if (P.lhit > 0) P.lhit -= dt;
    // along the ground, per axis (as moveBy, but no wind, no ground following): the walls at his feet's level, any height
    const sx = P.vx, sy = P.vy, dx = sx * dt, dy = sy * dt, zc = Math.min(P.z, elev(P.x, P.y) + .5);
    let hx = false, hy = false;
    if (dx) { if (!H.blocked(P.x + dx, P.y, zc, true)) P.x += dx; else hx = true; }
    if (dy) { if (!H.blocked(P.x, P.y + dy, zc, true)) P.y += dy; else hy = true; }
    if (hx || hy) {
      const vn = hx && hy ? Math.hypot(sx, sy) : hx ? Math.abs(sx) : Math.abs(sy);
      if (vn > SLAM.min && !(P.lhit > 0)) {   // the SLAM: hurt a little, the camera shakes, the views take it from the event
        P.lhit = SLAM.cool;
        ev({type: 'player.slam', x: P.x, y: P.y, vx: hx ? sx : 0, vy: hy ? sy : 0, speed: vn});
        ev({type: 'player.hurt', dmg: Math.round(clamp(SLAM.dmg0 + (vn - SLAM.min) * SLAM.dmgK, 1, SLAM.dmgMax)), by: 'slam', x: P.x, y: P.y});
        H.shake?.(vn > 6 ? 4 : 3, .22);
        if (P.lv > 0) P.lv *= SLAM.up;   // (the wall takes his rise: he slides down its face)
      }
      if (hx) P.vx = -sx * SLAM.e; else P.vx *= SLAM.slide;
      if (hy) P.vy = -sy * SLAM.e; else P.vy *= SLAM.slide;
    }
    // the ground
    const g = elev(P.x, P.y), floor = g + BODY.lie;
    if (P.lc <= floor) {
      P.lc = floor;
      if (P.lv < -BOUNCE.min) {
        if (!P.lland) { P.lland = true; ev({type: 'player.land', x: P.x, y: P.y, z: g, big: 3}); H.shake?.(2, .16); }
        P.lv = -P.lv * BOUNCE.e;
      } else P.lv = 0;
      const k = Math.exp(-dt * BOUNCE.fric); P.vx *= k; P.vy *= k;
      if (P.lv === 0 && Math.hypot(P.vx, P.vy) < BOUNCE.rest) {   // at rest
        P.vx = P.vy = 0; P.z = g;
        if (inStream(P.x, P.y)) { I.splash(I.dryBack(P.x - sx * .3, P.y - sy * .3, sx || 1e-3, sy)); return; }   // (in the water: back to the bank, as a fall)
        P.state = 'down'; P.t = 0; P.lup = false; ev({type: 'player.floored', x: P.x, y: P.y});
        P.frame = has('land') ? 'land' : 'crouch';
        return;
      }
    }
    P.z = Math.max(g, P.lc - BODY.mid);
    P.frame = has('fall') ? 'fall' : 'lunge';
  }
  return {
    start, step,
    // Space: down -> up sooner; nothing else while thrown (true: Space is taken)
    onSpace() { if (P.state === 'down') { P.lup = true; return true; } return P.state === 'launch' || P.state === 'getup'; },
    guard: () => STATES.includes(P.state) || P.lguard > 0,   // (no blows land while he's thrown, down, up, and just after)
    tick(dt) { if (P.lguard > 0) P.lguard = Math.max(0, P.lguard - dt); },   // (every step, whoever drives him)
  };
}
