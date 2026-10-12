// FISTS (the player's side): unarmed fighting for the live cowboys (docs/exp/fists.md). Like brawl.js and gun.js it runs
// inside player.js's step: while the fists are up it drives the frame, the facing, the state and the motion the way
// player.js does (the player's code, in another file). What a blow DOES (who is hit, how he reacts, the hitstop) is
// features/fists.js's: this module says when, which way and with what.
//   rest    the fists selected, no fight on (S.up false): player.js has him (idle / move, his own walk, Space his own); a
//           hand pressed, the switch, a blow taken or the feature's alert (a foe near) raises the guard (alert()), TUNE.rest.calm
//           s of none lowers it
//   guard   P.state 'guard' (NOT busy: E, chests, signs still work): the stance. Footwork at TUNE.stance's speeds, facing the
//           soft lock (the feature's, each step) or the cursor; Shift (a sprint) lets player.js run him (the guard drops)
//   fist    P.state 'fist' (BUSY): a move (MOVES): its WIND while the press is held (at least `wind` s), a heavy's CHARGE past
//           input.heavyAt, the THROW on the release: a step in toward the lock so the contact lands at the move's `dist`, the
//           blow at `hit` (player.punch), planted after it; from `chain` a press goes into the next move (STRING); at `dur`
//           back to the guard (the string stays open chain.grace s)
//   slip    P.state 'slip' (BUSY): Space in the guard (or out of a wind, a charge or a move's chain window): a dip the way he
//           holds (sideways), else back; untouchable from slip.i0 to i1. A foe's punch that meets him then (dodged()) opens
//           the counter window: the next punch is a counter (player.punch counter: true)
//   clinch  P.state 'clinch' (BUSY): he holds a foe (the feature's, by grab -> clinched(true)); slow footwork with him; the
//           clinch moves (CLINCH: L / R short punches, V knee, both the headbutt, E the toss: player.toss, Space the shove:
//           player.shove); the feature ends it (release())
// The live clips (western.py FISTS_LIVE: fs_*) are the view's (livehero.js fistsMotion() picks them by S.mv, S.ph and S.t;
// MOVES' times are the truth, the clips are timed to them). The atlas stand-ins below are what P.frame names meanwhile.
// OWNS: S (the fists, the move, its clock, the string, the queued presses, the slip, the clinch), and while it drives the
//   frame P's frame / face / state / vx / vy / ph.
// READS: content/fists.js, H.yaw (world <-> view), the soft lock (lock(): the feature's), the cursor (cursorAim).
// EMITS (player.js's queue, turned into the world by the loop): player.punch, player.grab, player.toss, player.shove,
//   player.fist (presentation cues: charge / throw / slip / counter), player.step (the footwork).
// BUDGET: part of player.step: a few multiplies a step, no allocation.
//   const F = createFists(PL, internals); F.step(dt, mx, my) -> true while it drives; the API below (features/fists.js,
//   player.js's press / release / space, foes/brawler.js: guards / dodged / blocked / hurt)
import {TUNE, MOVES, STRING, HEAVY, CLINCH} from '../../content/fists.js';
import {clamp} from '../../core/mathx.js';

export const STATES = ['fist', 'slip', 'clinch'];   // (player.js puts them in BUSY; the guard isn't)
const FB = {guard: 'idle.0', fist: 'lunge', slip: 'crouch', clinch: 'idle.0'};
const QN = 6;   // queued presses at most (a ring: no allocation)
const FOOT = .6;   // m a footwork cycle (two steps: western.py fs_step_*)
const TOSS_TURN = Math.PI / 4;   // (the hip toss: his facing left of the throw's way, his left = + in the view frame's angle)

export function createFists(PL, I) {
  const {P, H, has, ev, dirOf, vecOf, turnToward, moveBy, moveInput, cursorAim} = I;
  const T = TUNE, IN = T.input, LK = T.lock, ST = T.stance, SL = T.slip, CL = T.clinch, GD = T.guard, RS = T.rest;
  const S = {
    on: false,            // the fists are selected (slot 2)
    up: false, calm: 0,   // the guard is up (a fight on); s since the last thing that raised it
    mv: '', ph: '', t: 0,   // the move ('' in the guard / holding a clinch), its phase (wind | charge | throw), s in it
    hand: '', k: 0, done: false, mt: 0,   // its hand (L R B V E S), a heavy's charge 0..1, the blow went, s since the move began
    chain: '', chainT: 9, n: 0,   // the string: the last move, s since it ended, the punches thrown in it
    lock: false, lx: 0, ly: 0, lr: .3,   // the soft lock (view frame) and its body's radius
    ax: 0, ay: 1,         // the way he squares up (unit, view frame): the lock's or the cursor's
    dx: 0, dy: 1,         // the move's way
    down: {L: false, R: false}, downT: {L: -9, R: -9},   // the buttons as they are now, when each went down (S.clock)
    clock: 0,
    slip: '', sdx: 0, sdy: 0, counter: 0, cool: 0,   // the slip's kind (l | r | b) and way; the counter window (s); a cooldown
    blockT: 0, hurtT: 0,  // showing a block; can't act (hit)
    clinch: false, held: false, grabbed: 0,   // in a clinch; the feature said the grab caught (1) / missed (-1)
    stepDir: 'f', ph0: 0, // the footwork's way relative to his facing (f b l r) and its last half-cycle (footfalls)
    sprint: false,
  };
  // the queued presses: kind (L R V E S B), the clock when made
  const QK = new Array(QN).fill(''), QT = new Float64Array(QN); let qh = 0, qn = 0;
  const push = (k) => { if (qn === QN) { qh = (qh + 1) % QN; qn--; } const i = (qh + qn) % QN; QK[i] = k; QT[i] = S.clock; qn++; };
  const peek = () => qn ? QK[qh] : '';
  const pop = () => { const k = QK[qh]; qh = (qh + 1) % QN; qn--; return k; };
  const dropStale = () => { while (qn && S.clock - QT[qh] > IN.buffer) pop(); };
  // the other hand pressed within input.both s of this one (queued): the headbutt
  function pairQueued(k, t0) {
    for (let j = 0; j < qn; j++) { const i = (qh + j) % QN; if ((QK[i] === 'L' || QK[i] === 'R') && QK[i] !== k && Math.abs(QT[i] - t0) <= IN.both) { removeAt(j); return true; } }
    return false;
  }
  function removeAt(j) { for (let a = j; a < qn - 1; a++) { const i = (qh + a) % QN, n = (qh + a + 1) % QN; QK[i] = QK[n]; QT[i] = QT[n]; } qn--; }

  let c = 1, s = 0;
  const yaw = () => { const a = H.yaw ? H.yaw() : 0; c = Math.cos(a); s = Math.sin(a); };
  const OV = [0, 0];
  const toV = (x, y) => { OV[0] = x * c - y * s; OV[1] = x * s + y * c; return OV; };   // world -> his view frame (viewxf's)
  const elev = H.elev || (() => 0);
  const moveOf = () => MOVES[S.mv];
  const busy = () => P.state === 'fist' || P.state === 'slip' || P.state === 'clinch';
  const mine = () => P.state === 'guard' || busy();
  function emit(type, o) { o.type = type; o.x = P.x; o.y = P.y; o.z = P.z; ev(o); return o; }
  function plant(dt, k = 18) { const d = Math.exp(-dt * k); P.vx *= d; P.vy *= d; moveBy(P.vx * dt, P.vy * dt); }
  // the way he squares up: the lock, else the cursor on the ground
  function aimWay() {
    let dx, dy;
    if (S.lock) { dx = S.lx - P.x; dy = S.ly - P.y; }
    else { const g = PL.cursorGround ? PL.cursorGround() : cursorAim(); dx = g.x - P.x; dy = g.y - P.y; }
    const l = Math.hypot(dx, dy);
    if (l > .05) { S.ax = dx / l; S.ay = dy / l; }
  }
  // the gap to the lock's body (middle to middle) and how far a move wants it: >0 = step in
  const lockGap = () => S.lock ? Math.hypot(S.lx - P.x, S.ly - P.y) : 0;
  const want = m => m.dist + Math.max(0, S.lr - .3);
  function stepIn(m, left, dt) {   // toward the lock so the contact lands at m.dist, `left` s to it
    if (!S.lock || m.dist === undefined) return;
    const d = lockGap(), gap = d - want(m); if (gap <= .02) return;
    const v = Math.min(LK.maxV, gap / Math.max(left, dt));
    const ux = (S.lx - P.x) / d, uy = (S.ly - P.y) / d;
    P.vx = ux * v; P.vy = uy * v; moveBy(P.vx * dt, P.vy * dt);
  }

  // ---------------------------------------------------------------- starting things
  function startMove(name, hand) {
    const m = MOVES[name]; if (!m) return;
    S.mv = name; S.hand = hand; S.ph = 'wind'; S.t = 0; S.mt = 0; S.k = 0; S.done = false;
    P.state = S.clinch ? 'clinch' : 'fist'; P.t = 0; P.frame = FB.fist;
    aimWay(); S.dx = S.ax; S.dy = S.ay;
    if (name === 'toss') {   // the hip toss sweeps him over to the RIGHT (western.py fs_toss): turned 45 deg left of the cursor's way, he lands where it points
      const g = PL.cursorGround ? PL.cursorGround() : cursorAim(), a = Math.atan2(g.x - P.x, g.y - P.y) + TOSS_TURN;
      S.dx = Math.sin(a); S.dy = Math.cos(a);
    }
    P.face = P.want = dirOf(S.dx, S.dy);
  }
  // the next queued press: what it starts (null: nothing now)
  function takeInput() {
    dropStale();
    while (qn) {
      const k = peek(), t0 = QT[qh];
      if (S.clinch) {
        pop();
        if ((k === 'L' || k === 'R') && pairQueued(k, t0)) { startMove(CLINCH.B, 'B'); return true; }
        const nm = CLINCH[k]; if (nm) { startMove(nm, k); return true; }
        continue;
      }
      pop();
      if (k === 'L' || k === 'R') {
        if (pairQueued(k, t0)) { startMove('head', 'B'); return true; }
        const nm = (STRING[S.chainT <= T.chain.grace || S.mv ? S.chain : ''] || STRING[''])[k];
        startMove(nm, k); return true;
      }
      if (k === 'V') { if (S.chain && (S.chainT <= T.chain.grace || S.mv)) { startMove('round', 'V'); return true; } continue; }
      if (k === 'E') { startMove('grab', 'E'); S.grabbed = 0; return true; }
      if (k === 'S') { startSlip(); return true; }
    }
    return false;
  }
  function startSlip() {
    const [mx, my] = moveInput();
    // sideways (the input across his facing: the way he holds, a little back with it), else back. His left: the cross
    // product facing x input < 0 (facing south (0, 1), his left is east)
    const fx = S.ax, fy = S.ay, along = mx * fx + my * fy, px = mx - along * fx, py = my - along * fy, pl = Math.hypot(px, py);
    let kind = 'b', ux = -fx, uy = -fy;
    if ((mx || my) && pl >= .35) {
      kind = fx * my - fy * mx < 0 ? 'l' : 'r';
      ux = px / pl * .92 - fx * .3; uy = py / pl * .92 - fy * .3; const l = Math.hypot(ux, uy); ux /= l; uy /= l;
    }
    S.slip = kind; S.sdx = ux; S.sdy = uy; S.mv = ''; S.ph = ''; S.t = 0;
    P.state = 'slip'; P.t = 0; P.frame = FB.slip;
    emit('player.fist', {phase: 'slip', mv: 'slip_' + kind, hand: '', k: 0});
  }
  function alert() { if (S.on) { S.up = true; S.calm = 0; } }
  function toGuard() {
    if (S.mv) { const m = moveOf(); S.chain = m && !m.fin ? S.mv : ''; S.chainT = 0; }
    S.mv = ''; S.ph = ''; S.t = 0; S.slip = '';
    P.state = S.clinch ? 'clinch' : S.on ? 'guard' : 'idle'; P.t = 0; P.prevF = -1; P.frame = FB[P.state] || 'idle.0';
  }

  // ---------------------------------------------------------------- the step
  function step(dt, mx, my) {
    S.clock += dt;
    if (S.cool > 0) S.cool -= dt;
    if (S.counter > 0) S.counter -= dt;
    if (S.blockT > 0) S.blockT -= dt;
    S.chainT += dt;
    if (!S.on) { if (busy()) { S.clinch = false; toGuard(); } return false; }
    if (PL.brawl?.carrying) { if (P.state === 'guard') { P.state = 'idle'; P.t = 0; } return false; }   // (both hands on a load)
    // someone else has him (a knock, a blast, a fall, a kick, a lift): let go of what we did
    if (!mine() && P.state !== 'idle' && P.state !== 'move' && P.state !== 'draw' && P.state !== 'pose') {
      if (S.mv || S.clinch) { S.mv = ''; S.ph = ''; S.slip = ''; S.clinch = false; S.held = false; }
      return false;
    }
    if (S.hurtT > 0) S.hurtT -= dt;
    // the guard: down (no fight on), off his feet (a ledge) or sprinting, player.js has him
    if (!busy()) {
      if (S.up && (S.calm += dt) >= RS.calm && !qn && S.hurtT <= 0) S.up = false;   // (nothing for a while: the guard goes down)
      S.sprint = !!(mx || my) && H.keys?.has('shift') && !H.keys.has('q');
      if (!S.up || S.sprint || P.z > elev(P.x, P.y) + .05) { if (P.state === 'guard') { P.state = 'idle'; P.t = 0; P.prevF = -1; } return false; }
      if (P.state !== 'guard') { P.state = 'guard'; P.t = 0; }
      if (S.hurtT <= 0 && takeInput()) return stepMove(dt, mx, my);
      guard(dt, mx, my);
      return true;
    }
    S.calm = 0;   // (a move, a slip, a clinch: the fight is on)
    if (P.state === 'slip') return stepSlip(dt, mx, my);
    return stepMove(dt, mx, my);
  }
  // the stance: footwork toward / away / round, facing the lock or the cursor
  function guard(dt, mx, my) {
    aimWay();
    const fx = S.ax, fy = S.ay, along = mx * fx + my * fy, held = !!(mx || my);
    const sp = !held ? 0 : along > .5 ? ST.fwd : along < -.5 ? ST.back : ST.side;
    const a = Math.min(1, dt * ST.acc / Math.max(1.5, sp || 1.5));   // (~.1 s to his speed)
    P.vx += (mx * sp - P.vx) * a; P.vy += (my * sp - P.vy) * a;
    if (S.blockT > 0) { const d = Math.exp(-dt * 8); P.vx *= d; P.vy *= d; }
    const d = moveBy(P.vx * dt, P.vy * dt);
    P.want = dirOf(fx, fy); turnToward(P.want, dt, ST.turn);
    // the footwork's way and phase (one cycle FOOT m: two steps; the fs_step clips' feet move .3 m a half cycle)
    if (held) S.stepDir = along > .5 ? 'f' : along < -.5 ? 'b' : fx * my - fy * mx < 0 ? 'l' : 'r';   // (his left: see startSlip)
    P.ph = (P.ph + d / FOOT) % 1;
    const half = P.ph < .5 ? 0 : 1;
    if (d > 0 && half !== S.ph0) { S.ph0 = half; ev({type: 'player.step', x: P.x, y: P.y, z: P.z, foot: half ? 'R' : 'L', big: 0}); }
    P.frame = FB.guard;
  }
  function stepMove(dt, mx, my) {
    const m = moveOf();
    if (!m) {   // holding a clinch (no move out)
      if (!S.clinch) { toGuard(); return true; }
      if (S.hurtT <= 0 && takeInput()) return stepMove(dt, mx, my);
      aimWay(); P.want = dirOf(S.ax, S.ay); turnToward(P.want, dt, ST.turn);
      const sp = ST.side * CL.walk, k = Math.min(1, dt * 12);
      P.vx += (mx * sp - P.vx) * k; P.vy += (my * sp - P.vy) * k; moveBy(P.vx * dt, P.vy * dt);
      P.ph = (P.ph + Math.hypot(P.vx, P.vy) * dt / FOOT) % 1;
      P.frame = FB.clinch;
      return true;
    }
    S.t += dt; S.mt += dt; P.t = S.mt;
    if (S.ph === 'wind') {
      // the other hand within input.both s while it winds: the headbutt
      if ((S.hand === 'L' || S.hand === 'R') && qn && pairQueued(S.hand, S.clock - S.t)) { S.mv = S.clinch ? CLINCH.B : 'head'; S.hand = 'B'; }
      const m2 = moveOf(), held = (S.hand === 'L' || S.hand === 'R') && S.down[S.hand] && S.downT[S.hand] <= S.clock - S.t + 1e-9;
      if (held && !S.clinch && S.t >= IN.heavyAt && HEAVY[S.hand] && !m2.heavy) {   // held: the heavy of that hand, charging
        S.mv = HEAVY[S.hand]; S.ph = 'charge'; S.t = 0; S.k = 0;
        emit('player.fist', {phase: 'charge', mv: S.mv, hand: S.hand, k: 0});
      } else if (!held && S.t >= m2.wind) { S.ph = 'throw'; S.t = 0; throwStart(); }
      else {
        if (S.mv !== 'toss') { aimWay(); S.dx = S.ax; S.dy = S.ay; P.face = P.want = dirOf(S.dx, S.dy); }
        if (!S.clinch) stepIn(m2, Math.max(0, m2.wind - S.t) + m2.hit, dt); else plant(dt);
      }
      P.frame = FB.fist;
      return true;
    }
    if (S.ph === 'charge') {
      const full = Math.max(.05, m.full - IN.heavyAt); S.k = clamp(S.t / full, 0, 1);
      aimWay(); S.dx = S.ax; S.dy = S.ay; P.face = P.want = dirOf(S.dx, S.dy);
      // creeping in while it charges (the throw's own step does the rest)
      const [ix, iy] = moveInput(), sp = ST.fwd * IN.drift;
      P.vx += (ix * sp - P.vx) * Math.min(1, dt * 10); P.vy += (iy * sp - P.vy) * Math.min(1, dt * 10); moveBy(P.vx * dt, P.vy * dt);
      if (!S.down[S.hand] || S.t >= IN.autoFire - IN.heavyAt) { S.ph = 'throw'; S.t = 0; throwStart(); }
      P.frame = FB.fist;
      return true;
    }
    // the throw
    if (!S.done) {
      if (!S.clinch) {
        if (S.lock) { const d = lockGap(); if (d > .05) { S.dx = (S.lx - P.x) / d; S.dy = (S.ly - P.y) / d; } }   // (tracking the lock to the contact)
        stepIn(m, m.hit - S.t, dt);
        if (!S.lock) { const v = LK.idle / Math.max(.05, m.hit); P.vx = S.dx * v; P.vy = S.dy * v; moveBy(P.vx * dt, P.vy * dt); }
      } else plant(dt);
      if (S.t >= m.hit) { S.done = true; blow(m); }
    } else plant(dt);
    P.frame = FB.fist;
    // the grab: caught -> the clinch at its end; missed -> its longer recovery
    if (S.mv === 'grab' && S.done) {
      if (S.grabbed > 0 && S.t >= m.dur) { S.clinch = true; S.held = true; S.mv = ''; S.ph = ''; P.state = 'clinch'; P.t = 0; }
      else if (S.t >= (S.grabbed < 0 ? m.miss : m.dur)) toGuard();
      return true;
    }
    if (S.mv === 'toss' || S.mv === 'shove') { if (S.done && S.clinch) { S.clinch = false; S.held = false; } }
    // the chain window: a press goes into the next move
    if (m.chain !== undefined && S.t >= m.chain && S.hurtT <= 0 && qn) {
      S.chain = m.fin ? '' : S.mv; S.chainT = 0;
      const was = S.mv; S.mv = '';
      if (takeInput()) return true;
      S.mv = was;
    }
    if (S.t >= m.dur) toGuard();
    return true;
  }
  function throwStart() {
    if (!S.clinch && S.lock) { const d = lockGap(); if (d > .05) { S.dx = (S.lx - P.x) / d; S.dy = (S.ly - P.y) / d; } }
    P.face = P.want = dirOf(S.dx, S.dy);
    if (S.hand === 'L' || S.hand === 'R' || S.hand === 'B' || S.hand === 'V') S.n++;
    emit('player.fist', {phase: 'throw', mv: S.mv, hand: S.hand, k: S.k, vx: S.dx, vy: S.dy});
  }
  function blow(m) {
    const counter = S.counter > 0 && S.mv !== 'grab' && S.mv !== 'toss' && S.mv !== 'shove';
    if (counter) S.counter = 0;
    if (S.mv === 'grab') { emit('player.grab', {vx: S.dx, vy: S.dy, reach: m.reach, arc: m.arc}); return; }
    if (S.mv === 'toss') {   // at the cursor's way (on the ground), else ahead
      const g = PL.cursorGround ? PL.cursorGround() : cursorAim(); let dx = g.x - P.x, dy = g.y - P.y; const l = Math.hypot(dx, dy);
      if (l > .3) { dx /= l; dy /= l; } else { dx = S.dx; dy = S.dy; }
      emit('player.toss', {vx: dx, vy: dy}); return;
    }
    if (S.mv === 'shove') { emit('player.shove', {vx: S.dx, vy: S.dy}); return; }
    emit('player.punch', {mv: S.mv, hand: S.hand, vx: S.dx, vy: S.dy, k: S.k, n: S.n, counter, clinch: S.clinch});
  }
  function stepSlip(dt, mx, my) {
    S.t += dt; P.t = S.t;
    const k = Math.min(1, S.t / SL.dur), v = 3 * SL.dist / SL.dur * (1 - k) * (1 - k);   // (the integral: dist)
    P.vx = S.sdx * v; P.vy = S.sdy * v; moveBy(P.vx * dt, P.vy * dt);
    P.frame = FB.slip;
    if (S.t >= SL.dur) { S.cool = SL.cool; S.slip = ''; toGuard(); }
    else if (S.t >= SL.i1 && qn && takeInput()) return true;   // (out of the slip into the counter)
    return true;
  }

  // ---------------------------------------------------------------- the API
  return {
    S, step, STATES,
    get on() { return S.on; },
    get up() { return S.on && S.up; },
    get mode() { return P.state === 'guard' || busy() ? P.state : ''; },
    // the slot: selected (the gun goes in the holster; the guard comes up, and down again when nothing happens) or not
    select(on) {
      on = !!on; if (on === S.on) return false;
      S.on = on; qn = 0; S.chain = ''; S.counter = 0;
      if (on) { PL.gun?.stow?.(); alert(); if (P.state === 'idle' || P.state === 'move' || P.state === 'draw' || P.state === 'pose') { P.state = 'guard'; P.t = 0; } }
      else { S.up = false; S.clinch = false; S.held = false; if (mine()) { S.mv = ''; S.ph = ''; P.state = 'idle'; P.t = 0; P.prevF = -1; } }
      return true;
    },
    // a fight is on (a foe near: the feature; a blow taken): the guard up, the calm clock from 0
    alert,
    // the buttons (player.js press / release, pressR / releaseR): true = taken (a press at rest raises the guard and goes)
    press(h) { if (!S.on || PL.brawl?.carrying) return false; S.down[h] = true; S.downT[h] = S.clock; push(h); alert(); return true; },
    release(h) { if (!S.on) return false; S.down[h] = false; return !PL.brawl?.carrying; },
    // V: the roundhouse in a string / the knee in a clinch -> false: not ours (the push kick: brawl's)
    kick() { if (!S.on) return false; if (S.clinch || (S.chain && (S.chainT <= T.chain.grace || (S.mv && S.done)))) { push('V'); return true; } return false; },
    // E: the grab (the feature found a foe in reach) / the toss in a clinch
    grab() { if (!S.on || S.mv) return false; push('E'); alert(); return true; },
    toss() { if (!S.on || !S.clinch) return false; push('E'); return true; },
    // Space: the slip (the shove in a clinch) -> false: not ours (sprinting: the roll)
    space() {
      if (!S.on || PL.brawl?.carrying || !mine()) return false;
      if (S.clinch) { push('S'); return true; }
      if (P.state === 'guard' && S.sprint) return false;
      if (S.cool > 0 || P.state === 'slip') return true;
      const m = moveOf();
      if (!S.mv || S.ph === 'wind' || S.ph === 'charge' || (m && m.chain !== undefined && S.done && S.t >= m.chain)) { S.mv = ''; startSlip(); return true; }
      push('S'); return true;
    },
    // the soft lock (the feature, each step; world coordinates) / none
    lock(x, y, r = .3) { yaw(); const v = toV(x, y); S.lock = true; S.lx = v[0]; S.ly = v[1]; S.lr = r; },
    unlock() { S.lock = false; },
    // the grab caught / missed (the feature, on player.grab)
    clinched(ok) { S.grabbed = ok ? 1 : -1; },
    // the clinch is over (he broke free, he fell, he died): a step apart
    letGo(why = '') {
      if (!S.clinch) return;
      S.clinch = false; S.held = false;
      if (P.state === 'clinch' && !S.mv) { toGuard(); P.vx = -S.ax * 1.2; P.vy = -S.ay * 1.2; }
      void why;
    },
    // the foes' side (features/foes/brawler.js): is he guarding against a blow from world (x, y)? untouchable now (a slip)?
    guards(x, y) {
      if (!S.on || P.state !== 'guard' || S.hurtT > 0) return false;
      yaw(); const v = toV(x, y), dx = v[0] - P.x, dy = v[1] - P.y, l = Math.hypot(dx, dy) || 1;
      return (dx * S.ax + dy * S.ay) / l >= Math.cos(GD.cone * Math.PI / 180);
    },
    untouchable: () => P.state === 'slip' && S.t >= SL.i0 && S.t <= SL.i1,
    slipping: () => P.state === 'slip',
    // a foe's punch met him untouchable: the counter window opens
    dodged() { if (S.counter <= 0) emit('player.fist', {phase: 'counter', mv: '', hand: '', k: 0}); S.counter = SL.counter; },
    // blocked (on the guard): pushed back (world way), the block shown
    blocked(vx, vy) { yaw(); const v = toV(vx, vy); P.vx = v[0] * GD.push; P.vy = v[1] * GD.push; S.blockT = GD.show; },
    // hit: a wind / charge is cut; can't act a moment
    hurt() { if (S.ph === 'wind' || S.ph === 'charge') { S.mv = ''; S.ph = ''; toGuard(); } S.hurtT = T.hurt.stun; qn = 0; alert(); },
    clear() { qn = 0; S.mv = ''; S.ph = ''; S.clinch = false; S.held = false; S.slip = ''; if (busy() || P.state === 'guard') { P.state = 'idle'; P.t = 0; } },
    has,
  };
}
