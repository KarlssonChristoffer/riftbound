// MELEE (the player's side): a weapon in his hand (content/melee.js; the shared combat model:
// /mnt/project-files/briefs/combat-shared.md). Like fists.js and tool.js it runs inside player.js's step: while it drives (a
// swing, the guard, a jump, a smash) it sets the frame, the facing, the state and the motion the way player.js does (the player's
// code, in another file). What a blow DOES (who is hit, how hard, the thrown blade's flight) is features/melee.js's: this module
// says when, which way and with what.
//   out     S.on: drawn. He walks and runs as ever (player.js), the weapon in his hand; LMB / RMB / Space / R are this module's
//   blade   P.state 'blade' (BUSY): a move (MOVES): its WIND while the press is held (at least `wind` s), past input.heavyAt the
//           weapon's HEAVY charging (k 0..1 over input.full s), the SWING on the release: a step in (toward the lock: the feature's
//           assist), the blow at `hit` (player.blade), planted after it; from `chain` a queued press goes into the combo's next
//           move; at `dur` free again. Shift on the run + LMB: the DASH (a long lunge); RMB held + LMB: the shield's BASH
//   mguard  P.state 'mguard' (NOT busy): RMB held: the shield (or the blade) up, facing the cursor, walking slowly; raised in the
//           last parry s it PARRIES (the feature's defend asks parryOpen()); a tower shield + C: crouched behind it (hide)
//   mair    P.state 'mair' (BUSY): Space with nothing to leap or vault: a jump, steered a little; LMB in the air: the SMASH, a
//           dive at the ground (player.smash on landing: the feature's shockwave)
//   mland   P.state 'mland' (BUSY): planted after a smash
//   R       the THROW (move 'throw': player.bladethrow at its `hit`, the blade leaves his hand: S.held false) / when it's away,
//           the feature calls it back (features/melee.js recall); back in his hand: catch()
// OWNS: S (drawn, the weapon, the shield, the move, its clock, the combo, the queue, the jump, the guard), and while it drives
//   P's frame / face / state / vx / vy / z.
// READS: content/melee.js, H.yaw (world <-> view), the lock (the feature's), the cursor (cursorGround), H.mods ('melee.speed').
// EMITS (player.js's queue, turned into the world by the loop): player.blade, player.smash, player.bladethrow, player.jump,
//   player.land, player.step.
// BUDGET: part of player.step: a few multiplies a step, no allocation.
import {MOVES, WEAPONS, SHIELDS, TUNE} from '../../content/melee.js';
import {clamp} from '../../core/mathx.js';

export const STATES = ['blade', 'mair', 'mland'];   // (player.js puts them in BUSY; the guard isn't)
const QN = 6;

export function createMelee(PL, I) {
  const {P, H, has, ev, dirOf, vecOf, turnToward, moveBy, moveInput, cursorAim, SPEED} = I;
  const IN = TUNE.input, JP = TUNE.jump, SM = TUNE.smash;
  const S = {
    on: false, wid: 'sword', sid: 'round', held: true,   // drawn; the weapon, the shield; the blade in his hand (not thrown)
    mv: '', ph: '', t: 0, done: false, k: 0, n: 0, dx: 0, dy: 1,   // the move, its phase (wind | charge | swing), s in it, the blow went, the charge, the combo index, its way
    chainT: 9, readyT: 9, clock: 0,
    down: false, downT: -9,   // LMB as it is now, when it went down
    rmb: false, raiseT: -9, lowT: 0,   // RMB held (the guard), when it went up, s it was down before that (a parry needs a fresh raise)
    hide: false,          // crouched behind a tower shield
    vz: 0, top: 0, smash: false, jumpCool: 0, landT: 0,   // the jump: up speed, the highest point, diving
    lock: false, lx: 0, ly: 0, lr: .3,   // the assist's foe (view frame)
    ax: 0, ay: 1,         // the way he faces the cursor (unit, view frame)
    hurtT: 0, sprint: false, riposte: 0,
    stepDir: 'f', ph0: 0,
  };
  let speedK = 1;   // ('melee.speed' notes: the attachments' grips)
  if (H.mods) { const f = () => { speedK = H.mods.value('melee.speed', 1); }; H.mods.watch(f); f(); }
  const QK = new Array(QN).fill(''), QT = new Float64Array(QN); let qh = 0, qn = 0;
  const push = k => { if (qn === QN) { qh = (qh + 1) % QN; qn--; } const i = (qh + qn) % QN; QK[i] = k; QT[i] = S.clock; qn++; };
  const pop = () => { const k = QK[qh]; qh = (qh + 1) % QN; qn--; return k; };
  const dropStale = () => { while (qn && S.clock - QT[qh] > IN.buffer) pop(); };
  let c = 1, s = 0;
  const yaw = () => { const a = H.yaw ? H.yaw() : 0; c = Math.cos(a); s = Math.sin(a); };
  const OV = [0, 0];
  const toV = (x, y) => { OV[0] = x * c - y * s; OV[1] = x * s + y * c; return OV; };
  const elev = H.elev || (() => 0);
  const W = () => WEAPONS[S.wid] || WEAPONS.sword;
  const SH = () => W().hands === 2 ? null : SHIELDS[S.sid] || null;
  const pace = () => (W().speed || 1) * speedK;
  const moveOf = () => MOVES[S.mv];
  const busy = () => P.state === 'blade' || P.state === 'mair' || P.state === 'mland';
  const mine = () => P.state === 'mguard' || busy();
  const free = () => P.state === 'idle' || P.state === 'move' || P.state === 'pose' || P.state === 'draw' || P.state === 'mguard';
  function emit(type, o) { o.type = type; o.x = P.x; o.y = P.y; o.z = P.z; ev(o); return o; }
  function plant(dt, k = 14) { const d = Math.exp(-dt * k); P.vx *= d; P.vy *= d; moveBy(P.vx * dt, P.vy * dt); }
  function aimWay() {
    const g = PL.cursorGround ? PL.cursorGround() : cursorAim();
    let dx = g.x - P.x, dy = g.y - P.y; const l = Math.hypot(dx, dy);
    if (l > .05) { S.ax = dx / l; S.ay = dy / l; }
  }
  const lockGap = () => S.lock ? Math.hypot(S.lx - P.x, S.ly - P.y) : 0;

  // ---------------------------------------------------------------- starting things
  function startMove(name) {
    const m = MOVES[name]; if (!m) return false;
    S.mv = name; S.ph = 'wind'; S.t = 0; S.k = 0; S.done = false;
    P.state = 'blade'; P.t = 0; P.frame = has(m.fb) ? m.fb : 'idle.0';
    aimWay(); S.dx = S.ax; S.dy = S.ay;
    if (S.lock && name !== 'throw') { const d = lockGap(); if (d > .05 && d < TUNE.assist.range + S.lr) { S.dx = (S.lx - P.x) / d; S.dy = (S.ly - P.y) / d; } }
    P.face = P.want = dirOf(S.dx, S.dy);
    return true;
  }
  function takeInput() {
    dropStale();
    while (qn) {
      const k = pop(), w = W();
      if (k === 'T') { if (S.held) { startMove('throw'); return true; } continue; }
      if (k === 'L') {
        if (!S.held) { if (SH()) { startMove('bash'); return true; } continue; }   // (the blade away: the shield still bashes)
        if (S.rmb && SH()) { startMove('bash'); return true; }
        if (S.sprint && Math.hypot(P.vx, P.vy) > SPEED.run * .8) { S.n = 0; startMove('dash'); return true; }
        const combo = w.combo; if (S.chainT > IN.buffer + .25) S.n = 0;
        startMove(combo[S.n % combo.length]); return true;
      }
    }
    return false;
  }
  function endMove() {
    const m = moveOf();
    if (m) { if (S.mv !== 'throw' && S.mv !== 'bash') S.n = m.fin ? 0 : S.n + 1; S.chainT = 0; S.readyT = 0; }
    S.mv = ''; S.ph = ''; S.t = 0;
    P.state = S.rmb ? 'mguard' : 'idle'; P.t = 0; P.prevF = -1; P.frame = 'idle.0';
  }

  // ---------------------------------------------------------------- the step
  function step(dt, mx, my) {
    S.clock += dt; S.chainT += dt; S.readyT += dt;
    if (S.jumpCool > 0) S.jumpCool -= dt;
    if (S.riposte > 0) S.riposte -= dt;
    if (!S.rmb) S.lowT += dt;
    if (!S.on) { if (mine()) { S.mv = ''; P.state = 'idle'; P.t = 0; } return false; }
    if (PL.brawl?.carrying) return false;
    if (S.hurtT > 0) S.hurtT -= dt;
    // someone else has him (a knock, a blast, a fall off a ledge, a roll): let go of what we did
    if (!mine() && !free()) { if (S.mv) { S.mv = ''; S.ph = ''; } S.smash = false; return false; }
    S.sprint = !!(mx || my) && H.keys?.has('shift') && !H.keys.has('q');
    if (P.state === 'mair') return stepAir(dt, mx, my);
    if (P.state === 'mland') { S.landT -= dt; plant(dt, 20); P.frame = has('land') ? 'land' : 'crouch'; if (S.landT <= 0) { P.state = 'idle'; P.t = 0; } return true; }
    if (P.state === 'blade') return stepMove(dt);
    // free: a queued press starts a move; RMB held: the guard; else player.js walks him
    if (S.hurtT <= 0 && takeInput()) return stepMove(dt);
    if (S.rmb) { guard(dt, mx, my); return true; }
    if (P.state === 'mguard') { P.state = 'idle'; P.t = 0; P.prevF = -1; S.hide = false; }
    return false;
  }
  function guard(dt, mx, my) {
    if (P.state !== 'mguard') { P.state = 'mguard'; P.t = 0; }
    aimWay();
    const sh = SH(), hide = !!(sh?.hide && H.keys?.has('c'));
    S.hide = hide;
    const sp = hide ? 0 : TUNE.block.walk * (sh ? sh.speed / .78 : 1);
    const held = !!(mx || my), a = Math.min(1, dt * 10);
    P.vx += ((held ? mx : 0) * sp - P.vx) * a; P.vy += ((held ? my : 0) * sp - P.vy) * a;
    const d = moveBy(P.vx * dt, P.vy * dt);
    P.want = dirOf(S.ax, S.ay); turnToward(P.want, dt, 720);
    const along = mx * S.ax + my * S.ay;
    if (held) S.stepDir = along > .5 ? 'f' : along < -.5 ? 'b' : S.ax * my - S.ay * mx < 0 ? 'l' : 'r';
    P.ph = ((P.ph || 0) + d / .6) % 1;
    const half = P.ph < .5 ? 0 : 1;
    if (d > 0 && half !== S.ph0) { S.ph0 = half; ev({type: 'player.step', x: P.x, y: P.y, z: P.z, foot: half ? 'R' : 'L', big: 0}); }
    P.frame = hide && has('crouch') ? 'crouch' : 'idle.0';
  }
  function stepMove(dt) {
    const m = moveOf(); if (!m) { endMove(); return true; }
    const k = pace(), wind = m.wind / k, hit = m.hit / k, dur = m.dur / k, chain = (m.chain ?? m.dur) / k;
    S.t += dt; P.t = S.t;
    if (S.ph === 'wind') {
      const w = W(), held = S.down && S.downT <= S.clock - S.t + 1e-9;
      if (held && S.mv !== 'throw' && S.mv !== 'bash' && S.mv !== 'dash' && S.t >= IN.heavyAt && w.heavy && S.mv !== w.heavy) {
        S.mv = w.heavy; S.ph = 'charge'; S.t = 0; S.k = 0;
        emit('player.bladecue', {phase: 'charge', mv: S.mv, wid: S.wid, k: 0});
      } else if (!held && S.t >= wind) { S.ph = 'swing'; S.t = 0; swingStart(); }
      else { aimWay(); if (!S.lock) { S.dx = S.ax; S.dy = S.ay; } P.face = P.want = dirOf(S.dx, S.dy); plant(dt); }
      return true;
    }
    if (S.ph === 'charge') {
      S.k = clamp(S.t / IN.full, 0, 1);
      aimWay(); S.dx = S.ax; S.dy = S.ay; P.face = P.want = dirOf(S.dx, S.dy);
      const [ix, iy] = moveInput(), sp = 1;
      P.vx += (ix * sp - P.vx) * Math.min(1, dt * 10); P.vy += (iy * sp - P.vy) * Math.min(1, dt * 10); moveBy(P.vx * dt, P.vy * dt);
      if (!S.down || S.t >= IN.full + .8) { S.ph = 'swing'; S.t = 0; swingStart(); }
      return true;
    }
    // the swing: the step in up to the blow, planted after it
    if (!S.done) {
      if (S.lock && S.mv !== 'throw') { const d = lockGap(); if (d > .05) { S.dx = (S.lx - P.x) / d; S.dy = (S.ly - P.y) / d; P.face = P.want = dirOf(S.dx, S.dy); } }
      let st = (m.step || 0) * (S.mv === 'dash' ? 1 : 1 + S.k * .6);
      if (S.lock && S.mv !== 'dash') { const reach = (W().reach || 1.4) * (m.reach || 1) * .7; st = clamp(lockGap() - reach - S.lr, 0, st * 1.6); }
      const v = st / Math.max(.05, hit);
      P.vx = S.dx * v; P.vy = S.dy * v; moveBy(P.vx * dt, P.vy * dt);
      if (S.t >= hit) { S.done = true; blow(m); }
    } else plant(dt, S.mv === 'dash' ? 6 : 14);
    P.frame = has(m.fb) ? m.fb : 'idle.0';
    if (S.done && S.t >= chain && S.hurtT <= 0 && qn) {   // the chain: a queued press goes on
      const was = S.mv; endMove();
      if (takeInput()) return true;
      void was; return true;
    }
    if (S.t >= dur) endMove();
    return true;
  }
  function swingStart() {
    if (S.lock && S.mv !== 'throw') { const d = lockGap(); if (d > .05) { S.dx = (S.lx - P.x) / d; S.dy = (S.ly - P.y) / d; } }
    P.face = P.want = dirOf(S.dx, S.dy);
    emit('player.bladecue', {phase: 'swing', mv: S.mv, wid: S.wid, k: S.k, vx: S.dx, vy: S.dy});
  }
  function blow(m) {
    if (S.mv === 'throw') {   // at the cursor's way (on the ground)
      aimWay(); S.held = false;
      emit('player.bladethrow', {wid: S.wid, vx: S.ax, vy: S.ay});
      return;
    }
    const rip = S.riposte > 0; if (rip) S.riposte = 0;
    emit('player.blade', {mv: S.mv, wid: S.held ? S.wid : '', sid: SH() ? S.sid : '', vx: S.dx, vy: S.dy, k: S.k, n: S.n, riposte: rip, unarmed: !S.held});
  }

  // ---------------------------------------------------------------- the jump and the smash
  function jump() {
    if (S.jumpCool > 0 || !free() || P.z > elev(P.x, P.y) + .05) return false;
    const keep = JP.keep;
    S.vz = JP.vz * (S.sprint ? 1.08 : 1); S.top = P.z; S.smash = false;
    P.vx *= keep; P.vy *= keep;
    P.state = 'mair'; P.t = 0; P.frame = has('leap.1') ? 'leap.1' : 'lunge'; S.mv = ''; S.ph = '';
    emit('player.jump', {});
    return true;
  }
  function stepAir(dt, mx, my) {
    P.t += dt;
    if (!S.smash) {   // steering a little
      const run = S.sprint ? SPEED.sprint : SPEED.run, a = Math.min(1, dt * JP.air / Math.max(1, run));
      if (mx || my) { P.vx += (mx * run - P.vx) * a; P.vy += (my * run - P.vy) * a; P.want = dirOf(mx, my); turnToward(P.want, dt, 600); }
      S.vz -= JP.g * dt;
      if (qn) { dropStale(); while (qn) { const k = pop(); if (k === 'L' && S.held) { startSmash(); break; } } }
    } else S.vz = -SM.dive;
    moveBy(P.vx * dt, P.vy * dt, true);
    P.z += S.vz * dt; if (P.z > S.top) S.top = P.z;
    const g = elev(P.x, P.y);
    if (P.z <= g && S.vz <= 0) {
      P.z = g;
      if (S.smash) {
        S.smash = false; P.state = 'mland'; S.landT = SM.land; P.vx *= .2; P.vy *= .2;
        emit('player.smash', {wid: S.wid, vx: S.dx, vy: S.dy, fall: Math.max(0, S.top - g)});
      } else {
        P.state = 'idle'; P.t = 0; P.prevF = -1;
        emit('player.land', {foot: 'L', big: 2, pace: Math.hypot(P.vx, P.vy)});
        if (S.down && S.held) push('L');   // (held through the landing: swing as he lands)
      }
      S.jumpCool = JP.cool;
      return true;
    }
    P.frame = S.smash ? (has('leap.2') ? 'leap.2' : 'lunge') : has('leap.1') ? (S.vz > 1.5 ? 'leap.1' : S.vz > -1.5 ? 'leap.2' : 'leap.3') : 'lunge';
    return true;
  }
  function startSmash() {
    S.smash = true; aimWay();
    const [mx, my] = moveInput(), l = Math.hypot(mx, my);
    if (l > .1) { S.dx = mx / l; S.dy = my / l; } else { S.dx = S.ax; S.dy = S.ay; }
    P.face = P.want = dirOf(S.dx, S.dy);
    P.vx = S.dx * SM.fwd; P.vy = S.dy * SM.fwd;
    emit('player.bladecue', {phase: 'smash', mv: 'smash', wid: S.wid, k: 1, vx: S.dx, vy: S.dy});
  }

  // ---------------------------------------------------------------- the API
  return {
    S, step, STATES,
    get on() { return S.on; },
    get weapon() { return S.wid; },
    get shield() { return SH() ? S.sid : ''; },
    get held() { return S.held; },
    get mode() { return mine() ? P.state : ''; },
    get pace() { return pace(); },
    weaponOf: W, shieldOf: SH,
    // drawn (the gun holstered, the fists down, the tool away: the feature) or not
    select(on) {
      on = !!on; if (on === S.on) return false;
      S.on = on; qn = 0; S.n = 0; S.rmb = false; S.hide = false;
      if (on) { PL.gun?.stow?.(); PL.fists?.select?.(false); PL.tool?.clear?.(); if (PL.tool?.S.on) PL.tool.put?.(); }
      else if (mine() && P.state !== 'mair') { S.mv = ''; S.ph = ''; P.state = 'idle'; P.t = 0; P.prevF = -1; }
      return true;
    },
    equip(wid, sid) { if (wid && WEAPONS[wid]) { S.wid = wid; S.n = 0; } if (sid !== undefined && sid in SHIELDS) S.sid = sid; },
    // LMB (player.js press / release): true = taken
    press() {
      if (!S.on || PL.brawl?.carrying) return false;
      S.down = true; S.downT = S.clock;
      push('L'); return true;
    },
    release() { if (!S.on) return false; S.down = false; return true; },
    // RMB: the guard up / down
    pressR() { if (!S.on || PL.brawl?.carrying) return false; if (!S.rmb) { S.rmb = true; if (S.lowT >= .3) S.raiseT = S.clock; S.lowT = 0; } return true; },
    releaseR() { if (!S.on) return false; S.rmb = false; S.hide = false; return true; },
    // Space: a jump (true: taken). A leap or a vault where there's one to take (player.js's own)
    space() {
      if (!S.on || PL.brawl?.carrying) return false;
      if (busy()) return true;
      if (PL.tryLeap?.() || PL.tryVault?.()) return true;
      return jump();
    },
    // R: throw the blade (false: it's away: the feature calls it back)
    throwOut() { if (!S.on || !S.held) return false; push('T'); return true; },
    catch() { S.held = true; S.readyT = 0; },   // back in his hand (caught, picked up)
    lose() { S.held = false; },
    // the guard as the feature's defend asks it: up, its way (view frame) and whether a parry is open
    guarding() { return S.on && (P.state === 'mguard' || (P.state === 'blade' && S.mv === 'bash' && !S.done)); },
    parryOpen(win) { return S.clock - S.raiseT <= win; },
    faceWay() { return vecOf(P.face); },
    parried() { S.riposte = TUNE.parry.riposte; S.raiseT = -9; },
    blocked(vx, vy, k) { yaw(); const v = toV(vx, vy); P.vx += v[0] * TUNE.block.push * k; P.vy += v[1] * TUNE.block.push * k; },
    // the assist (the feature, each step; world coordinates) / none
    lock(x, y, r = .3) { yaw(); const v = toV(x, y); S.lock = true; S.lx = v[0]; S.ly = v[1]; S.lr = r; },
    unlock() { S.lock = false; },
    hurt() { if (S.ph === 'wind' || S.ph === 'charge') { S.mv = ''; S.ph = ''; endMove(); } S.hurtT = .25; qn = 0; },
    clear() { qn = 0; S.mv = ''; S.ph = ''; S.smash = false; if (mine()) { P.state = 'idle'; P.t = 0; } },
    has,
  };
}
