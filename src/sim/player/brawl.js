// BRAWL (the player's side): the live cowboy's boot, shoulder barge, lifting, carrying and throwing (docs/exp/brawl.md). Like
// sim/player/gun.js and lasso.js it runs inside player.js's step: while it has something to do it drives the frame, the
// facing, the state and the motion the way player.js does (the player's code, in another file). What a blow or a throw DOES
// (who is thrown, what rolls, what is lifted) is features/brawl.js's: this module says when and which way.
//   kick    P.state 'kick' (BUSY): squared up to the target (a world point the feature picked), a short step in; the blow at the
//           hit mark: event player.kick {x, y, z, vx, vy (unit), barge: false}; planted till its end
//   barge   P.state 'barge' (BUSY), out of a sprint: along his run at TUNE.barge.speed (WASD steers it a little); from its hit
//           mark every step emits player.kick {barge: true, n} (the feature throws whoever it meets, each once); a wall ends it
//           (a bump back: the knock); then he runs on
//   lift    P.state 'lift' (BUSY): planted, facing what he lifts; at the grab mark player.lift {phase: 'grab'} (the feature takes
//           it off the ground then); after it he CARRIES (S.carry: 'heavy' | 'small'): his own locomotion, slower (the feature's
//           modifier note), the frames the live hero swaps for the carry's
//   throw   P.state 'throw' (BUSY): planted, facing the throw; at the release mark player.throw {x, y, z, vx, vy (unit, the way),
//           d (m to where it should land), h (the hands' height)}; the feature launches it then
//   put     E while carrying: player.lift {phase: 'put'}: set down in front; a roll (Space) or a knock / throw-off drops it
//           (player.lift {phase: 'drop'})
// The live clips (western.py BRAWL_LIVE: mv_kick, mv_barge, mv_lift, mv_throw, mv_carry*) are the view's (livehero.js
// motion() picks them by these states and P.t); their marks are TUNE's here (the sim never reads the art). The atlas
// stand-ins below are what the frame names while they play (a sprite loadout never gets here: H.canBrawl).
// OWNS: S (the move, its clock, the target, what he carries), and while it drives the frame P's frame / face / state / vx / vy.
// READS: TUNE (content/brawl.js), H.yaw (world <-> view), the cursor (cursorAim).
// EMITS (player.js's queue, turned into the world by the loop): player.kick, player.lift, player.throw.
// BUDGET: part of player.step: a few multiplies a step.
//   const B = createBrawl(PL, internals); B.step(dt, mx, my) -> true while it drives; the API below (features/brawl.js)
import {TUNE} from '../../content/brawl.js';
import {clamp} from '../../core/mathx.js';

export const STATES = ['kick', 'barge', 'lift', 'throw'];   // (player.js puts them in BUSY)
const FB = {kick: ['lunge', 'skid_b'], barge: ['lunge', 'skid_a'], lift: ['crouch', 'idle.0'], throw: ['reach_up', 'lunge']};

export function createBrawl(PL, I) {
  const {P, H, has, ev, dirOf, vecOf, turnToward, moveBy, moveInput, cursorAim, SPEED, BUSY, AIM_TURN_RATE} = I;
  const K = TUNE.kick, BG = TUNE.barge, C = TUNE.carry, TH = TUNE.throw;
  const S = {mode: '', t: 0, done: false, n: 0, tx: 0, ty: 0, carry: '', want: '', wantX: 0, wantY: 0, wantKind: '', dx: 0, dy: 0, cool: 0, moved: 0};
  let c = 1, s = 0;
  const yaw = () => { const a = H.yaw ? H.yaw() : 0; c = Math.cos(a); s = Math.sin(a); };
  const OV = [0, 0];
  const toV = (x, y) => { OV[0] = x * c - y * s; OV[1] = x * s + y * c; return OV; };   // world -> his view frame (viewxf's)
  const toW = (x, y) => { OV[0] = x * c + y * s; OV[1] = -x * s + y * c; return OV; };
  const fb = k => { const L = FB[k]; for (let i = 0; i < L.length; i++) if (has(L[i])) return L[i]; return 'idle.0'; };
  const free = () => !BUSY.has(P.state) && P.state !== 'roll' && P.state !== 'backstep';
  function plant(dt, k = 18) { const d = Math.exp(-dt * k); P.vx *= d; P.vy *= d; moveBy(P.vx * dt, P.vy * dt); }
  function face(wx, wy) {   // toward a world point
    yaw(); const v = toV(wx, wy), dx = v[0] - P.x, dy = v[1] - P.y;
    if (dx * dx + dy * dy > 1e-4) P.face = P.want = dirOf(dx, dy);
  }
  function emit(type, o) { o.type = type; o.x = P.x; o.y = P.y; o.z = P.z; ev(o); }

  // ---------------------------------------------------------------- the step
  function step(dt, mx, my) {
    if (S.cool > 0) S.cool -= dt;
    if (S.want) {   // a move asked for between steps (a key): starts now if he's free
      const w = S.want; S.want = '';
      if (w === 'kick' && free()) startKick();
      else if (w === 'barge' && free()) startBarge(mx, my);
      else if (w === 'lift' && free() && !S.carry) startLift();
      else if (w === 'throw' && free() && S.carry) startThrow();
      else if (w === 'put' && free() && S.carry) { emit('player.lift', {phase: 'put', vx: vecOf(P.face)[0], vy: vecOf(P.face)[1]}); S.carry = ''; }
    }
    if (S.carry && !S.mode && P.state !== 'idle' && P.state !== 'move' && P.state !== 'pose' && P.state !== 'land' && P.state !== 'slide') {
      S.carry = ''; emit('player.lift', {phase: 'drop', vx: P.vx, vy: P.vy});   // (a roll, a knock, a blast, off a ledge, a leap, a climb: it falls from his hands)
    }
    if (!S.mode) return false;
    if (P.state !== S.mode) { S.mode = ''; return false; }   // (something else took him: a blast, a knock)
    S.t += dt; P.t = S.t;
    switch (S.mode) {
      case 'kick': {
        if (!S.done) { const k = Math.min(1, S.t / K.hit); P.vx = S.dx * K.step * (1 - k); P.vy = S.dy * K.step * (1 - k); moveBy(P.vx * dt, P.vy * dt); }
        else plant(dt);
        if (!S.done && S.t >= K.hit) { S.done = true; emit('player.kick', {vx: S.dx, vy: S.dy, barge: false, n: 0}); }
        P.frame = fb('kick');
        if (S.t >= K.dur) end();
        return true;
      }
      case 'barge': {
        if (mx || my) {   // a little steering
          const a = Math.atan2(S.dx, S.dy), b = Math.atan2(mx, my); let d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          d = clamp(d, -BG.steer * dt, BG.steer * dt); S.dx = Math.sin(a + d); S.dy = Math.cos(a + d); P.face = P.want = dirOf(S.dx, S.dy);
        }
        const k = S.t / BG.dur, sp = BG.speed * (1 - .35 * k * k);
        P.vx = S.dx * sp; P.vy = S.dy * sp;
        if (S.t >= BG.hit) { S.n++; emit('player.kick', {vx: S.dx, vy: S.dy, barge: true, n: S.n}); }   // (the shoulder first: what it meets is thrown out of his way this step)
        const want = sp * dt, got = moveBy(P.vx * dt, P.vy * dt);
        P.frame = fb('barge');
        S.moved = got < want * .4 ? S.moved + 1 : 0;
        if (S.moved >= 3) {   // a wall (three steps against it: a body would have been thrown aside): bump back off it
          S.mode = ''; P.vx = -S.dx * BG.bump; P.vy = -S.dy * BG.bump; P.state = 'knock'; P.t = 0; H.shake?.(2, .12);
          return true;
        }
        if (S.t >= BG.dur) {   // into the run
          S.mode = ''; const ex = SPEED.run * BG.exit, [ix, iy] = moveInput();
          if (ix || iy) { P.vx = S.dx * ex; P.vy = S.dy * ex; P.curSpeed = P.lastSpeed = ex; P.state = 'move'; P.gait = 'run'; P.ph = .02; P.prevF = 'run0'; P.frame = 'run.0'; P.t = 0; }
          else { P.vx *= .3; P.vy *= .3; P.state = 'idle'; P.t = 0; P.prevF = -1; }
        }
        return true;
      }
      case 'lift':
        plant(dt);
        if (!S.done && S.t >= C.grab) { S.done = true; S.carry = S.wantKind || 'heavy'; emit('player.lift', {phase: 'grab', vx: S.dx, vy: S.dy}); }
        P.frame = fb('lift');
        if (S.t >= C.lift) end();
        return true;
      case 'throw': {
        plant(dt);
        if (!S.done && S.t >= TH.release) {
          S.done = true; S.carry = '';
          yaw(); const v = toV(S.tx, S.ty), dx = v[0] - P.x, dy = v[1] - P.y, d = Math.hypot(dx, dy) || 1;
          emit('player.throw', {vx: dx / d, vy: dy / d, d, h: P.z + TH.h0});
        }
        P.frame = fb('throw');
        if (S.t >= TH.dur) end();
        return true;
      }
    }
    return false;
  }
  function end() { S.mode = ''; P.state = 'idle'; P.t = 0; P.prevF = -1; }
  function startKick() {
    PL.gun?.stow?.();   // (the gun goes back in the holster: the kick wants his balance)
    face(S.tx, S.ty); const f = vecOf(P.face); S.dx = f[0]; S.dy = f[1];
    S.mode = 'kick'; S.t = 0; S.done = false; P.state = 'kick'; P.t = 0; P.aimRoll = false; P.queuedShot = false;
  }
  function startBarge(mx, my) {
    let dx = P.vx, dy = P.vy; const l = Math.hypot(dx, dy);
    if (l > .1) { dx /= l; dy /= l; } else if (mx || my) { dx = mx; dy = my; } else { const f = vecOf(P.face); dx = f[0]; dy = f[1]; }
    PL.gun?.stow?.();
    S.dx = dx; S.dy = dy; P.face = P.want = dirOf(dx, dy);
    S.mode = 'barge'; S.t = 0; S.n = 0; S.moved = 0; S.done = false; P.state = 'barge'; P.t = 0; P.aimRoll = false; P.queuedShot = false;
  }
  function startLift() {
    PL.gun?.stow?.();
    face(S.tx, S.ty); const f = vecOf(P.face); S.dx = f[0]; S.dy = f[1];
    S.mode = 'lift'; S.t = 0; S.done = false; P.state = 'lift'; P.t = 0;
    emit('player.lift', {phase: 'start', vx: S.dx, vy: S.dy});
  }
  function startThrow() {
    face(S.tx, S.ty);
    S.mode = 'throw'; S.t = 0; S.done = false; P.state = 'throw'; P.t = 0;
  }

  // ---------------------------------------------------------------- the API (features/brawl.js: between steps, flags the step reads)
  return {
    S, step, STATES,
    get mode() { return S.mode; }, get carrying() { return S.carry; },
    get progress() { return S.mode === 'kick' ? S.t / K.dur : S.mode === 'barge' ? S.t / BG.dur : S.mode === 'lift' ? S.t / C.lift : S.mode === 'throw' ? S.t / TH.dur : 0; },
    // the boot at a world point (x, y): false if he can't now (busy, mid-air, cooling down)
    kick(x, y) { if (!free() || S.mode || S.cool > 0) return false; S.tx = x; S.ty = y; S.want = 'kick'; S.cool = K.dur + K.cool; return true; },
    // the barge (sprinting): false if he isn't going fast enough
    barge() { if (!free() || S.mode || S.cool > 0 || Math.hypot(P.vx, P.vy) < BG.min) return false; S.want = 'barge'; S.cool = BG.dur + K.cool; return true; },
    // lift what's at world (x, y) (kind: heavy | small)
    lift(x, y, kind) { if (!free() || S.mode || S.carry) return false; S.tx = x; S.ty = y; S.wantKind = kind; S.want = 'lift'; return true; },
    // throw it at world (x, y) / set it down / let it fall from his hands now (the feature's: a stage change, the loadout)
    throwAt(x, y) { if (!S.carry || S.mode) return false; S.tx = x; S.ty = y; S.want = 'throw'; return true; },
    // LMB (player.js press, before the gun): while he carries something it's thrown at the cursor (an enemy under it: at him;
    // else the ground under it) -> true: the press is taken
    press() {
      if (!S.carry) return false;
      if (S.mode) return true;
      const t = cursorAim(), g = t.target ? t : PL.cursorGround(); yaw(); const w = toW(g.x, g.y);
      S.tx = w[0]; S.ty = w[1]; S.want = 'throw'; return true;
    },
    put() { if (!S.carry || S.mode) return false; S.want = 'put'; return true; },
    clear() { S.carry = ''; S.want = ''; if (S.mode && P.state === S.mode) { P.state = 'idle'; P.t = 0; } S.mode = ''; },
  };
}
