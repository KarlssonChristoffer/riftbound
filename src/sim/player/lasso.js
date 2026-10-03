// LASSO (the player's side): the cowboy's body while the equipment experiment's lasso is in his hands. The gadget itself
// (the loop, what it catches, the anchors, the rope) is features/equip/lasso.js; this is his part, and like
// sim/player/gun.js it runs inside player.js's step: while it has something to do it drives the frame, the facing, the
// state and the motion the way player.js does (the player's code, in another file). SIM: fixed steps, no random draws.
// THE MODES (S.mode; '' = nothing: player.js's own step runs):
//   spin   F held: the loop spins overhead; standing he faces what he aims at (lasso_spin), moving he walks or runs at a
//          share of his speed (the walk / run legs with the spinning arm: lws_ / lrs_)
//   throw  the throw clip, planted, facing the throw; its `release` mark lets the loop go (event lasso.loose)
//   haul   holding something on the rope: lasso_haul, facing it, walking slowly; the rope is a LEASH: he stays within its
//          length of what he holds (a target that won't come holds him back; a champion that pulls drags him)
//   yank   the yank clip, planted, facing what he pulls
//   hang   on a rope from an anchor (P.state 'rope', in BUSY): a pendulum in the WORLD (gravity, the rope's length reeled
//          in a little, the ground, the stream, walls, WASD pumps), lasso_hang_0..2 by the swing (legs forward / straight /
//          back), facing the way he swings; letting go he flies on with its speed (player.js's fall / land / splash)
// What ends a mode from his side: a roll or a dodge, a knock, a leap or a fall (the rope slips: lasso.drop), LMB (the gun:
// he drops the rope and draws, sim/player/gun.js takes the press), a wall or the water in a swing (lasso.bump / letgo).
// The camera may turn at any time: the swing lives in the world and P (the view frame) is written from it every step.
// OWNS: S (the mode, its clock, the leash, the swing), and while it drives the frame P's frame / face / state / x / y / z /
//   vx / vy (+ vz / fall0 when he lets go).
// READS: the atlas (the poses: content/lasso.js POSES; the rope hands in the meta bones: HANDS), the keys, the cursor, the
//   gun's pending press (PL.gun.S.want), H.yaw (world <-> view), the world helpers the gadget hands to hang() (elev, water,
//   solid).
// EMITS (player.js's queue: x / y in the view frame, turned into the world by the loop): lasso.loose (the throw lets go),
//   lasso.drop {why} (he lost the rope), lasso.letgo {vx, vy, vz} (off the rope), lasso.bump (a wall stopped the swing).
// BUDGET: part of player.step (sim group): a few multiplies a step; the swing 2 sub-steps with a wall test each.
//   const L = createLasso(PL, internals); L.step(dt, mx, my) -> true while it drives; the API below (features/equip/lasso.js)
import {TUNE, POSES, HANDS} from '../../content/lasso.js';
import {clamp, hypot2, hypot3} from '../../core/mathx.js';

export function createLasso(PL, I) {
  const {P, A, H, has, ev, dirOf, turnToward, moveBy, puff, stepTraverse, SPEED, BUSY, TURN_RATE, AIM_TURN_RATE} = I;
  const {keys} = H, T = H.ctx, SW = TUNE.swing;
  const S = {mode: '', t: 0, ph: 0, tx: 0, ty: 0, faceOn: false, loose: false, leashOn: false, lx: 0, ly: 0, len: 0, prevK: '',
    // the swing (world): the anchor, the grip (where the rope meets his hands), its velocity, the rope's length now and
    // the one it reels in to, time on the ground, the last facing way
    ax: 0, ay: 0, ah: 0, gx: 0, gy: 0, gh: 0, vx: 0, vy: 0, vh: 0, L: 0, L0: 0, Lt: 0, ground: 0, air: false, fx: 0, fy: 1, W: null};

  // ---- world <-> view at the camera's yaw (render/viewxf.js's maths, without allocating: these run every step) ----
  let c = 1, s = 0;
  const yaw = () => { const a = H.yaw ? H.yaw() : 0; c = Math.cos(a); s = Math.sin(a); };
  const OV = [0, 0];
  const toV = (x, y) => { OV[0] = x * c - y * s; OV[1] = x * s + y * c; return OV; };
  const toW = (x, y) => { OV[0] = x * c + y * s; OV[1] = -x * s + y * c; return OV; };

  // ---- the poses (content/lasso.js POSES): per atlas, the frame names in play order and when each step ends ----
  let TL = null, TLsp = null;
  function tls() {
    if (TLsp === A.SP && TL) return TL;
    TLsp = A.SP; TL = {};
    for (const k of ['spin', 'throw', 'yank', 'take', 'hangIn']) {
      const Q = POSES[k], c0 = A.CLIP[Q.clip];
      let names, ms = null, fps = Q.fps || 12, rel = Q.at ?? 0;   // rel: the clip's mark (POSES mark: release, pull)
      if (c0 && has(Q.clip + '.0')) {
        const n = c0.play ? c0.play.length : c0.frames; names = [];
        for (let i = 0; i < n; i++) names.push(Q.clip + '.' + (c0.play ? c0.play[i] : i));
        ms = c0.ms || null; fps = c0.fps || fps; rel = (Q.mark && c0.marks?.[Q.mark]) ?? Math.min(Q.at ?? 0, c0.frames - 1);
        const at = c0.play ? c0.play.indexOf(rel) : rel; rel = at < 0 ? 0 : at;   // (the mark is a frame: the first step showing it)
      } else { names = Q.fb.filter(has); if (!names.length) names = k === 'hangIn' ? [] : ['idle.0']; rel = Math.max(0, Math.min(rel, names.length - 1)); }
      const ends = new Float64Array(names.length); let t = 0;
      for (let i = 0; i < names.length; i++) { t += ms ? ms[i] / 1000 : 1 / fps; ends[i] = t; }
      TL[k] = {names, ends, total: t, rel: rel > 0 ? ends[rel - 1] : 0, real: !!(c0 && has(Q.clip + '.0'))};
    }
    for (const k of ['haul', 'hang']) TL[k] = POSES[k].pose.map((n, i) => has(n) ? n : has(POSES[k].fb[i]) ? POSES[k].fb[i] : 'idle.0');
    for (const k of ['walk', 'run']) { const C = A.CLIP[k], Q = POSES[k]; TL[k] = []; for (let f = 0; f < (C?.frames || 8); f++) TL[k].push(has(Q.pre + f) ? Q.pre + f : Q.fb + f); }
    return TL;
  }
  const at = (L, t, loop) => { if (loop) t %= L.total; let i = 0; while (i < L.names.length - 1 && t >= L.ends[i]) i++; return L.names[i]; };

  // the pose preview's list: [kind, which, s, label, pose index]
  const PV = [['clip', 'spin', 2, 'lasso_spin'], ['clip', 'throw', 1.6, 'lasso_throw'], ['clip', 'take', 1.2, 'lasso_take'],
    ['pose', 'haul', 1.4, 'lasso_haul_0', 0], ['pose', 'haul', 1.4, 'lasso_haul_1', 1], ['clip', 'yank', 1.6, 'lasso_yank'],
    ['pose', 'hang', 1.4, 'lasso_hang_0', 0], ['pose', 'hang', 1.4, 'lasso_hang_1', 1], ['pose', 'hang', 1.4, 'lasso_hang_2', 2],
    ['cycle', 'walk', 2.4, 'lws_0..7'], ['cycle', 'run', 2.4, 'lrs_0..7']];
  // ---- the rope hands: where the pose's grip is this frame, in the world (the meta bones: [hx, hy, tx, ty], the HEAD is the
  //      grip; without the markers the higher hand's fist, the hand bone's tail) ----
  const HB = {x: 0, y: 0};
  function handPx(frame, face, upper) {
    const b = A.SP[frame]?.bones?.[A.DIRS[face]], m = b && b[upper ? HANDS.upper : HANDS.grip];
    if (m) { HB.x = m[0]; HB.y = m[1]; return HB; }
    const r = b && b[HANDS.fb[0]], l = b && b[HANDS.fb[1]];
    if (r || l) { const q = !l || (r && r[3] <= l[3]) ? r : l; HB.x = q[2]; HB.y = q[3]; return HB; }
    HB.x = A.PIV[0]; HB.y = A.PIV[1] - 1.5 * T.PPMH; return HB;
  }
  // the hand at (pivot-relative) px -> world; out = [x, y, h]
  function hand(upper, out) {
    yaw();
    if (upper && S.mode === 'hang') { const go = gripOff(P.frame), w = toW(P.x + go.x, P.y); out[0] = w[0]; out[1] = w[1]; out[2] = P.z + go.z; return out; }   // (as the swing has it)
    const m = handPx(P.frame, P.face, upper), ox = (m.x - A.PIV[0]) / T.PPM, oz = (A.PIV[1] - m.y) / T.PPMH;
    const w = toW(P.x + ox, P.y); out[0] = w[0]; out[1] = w[1]; out[2] = P.z + oz; return out;
  }

  // ---- helpers ----
  function abort(why) {
    const m = S.mode; S.mode = ''; S.leashOn = false;
    if (m === 'hang' && P.state === 'rope') { P.state = 'idle'; P.t = 0; }
    ev({type: 'lasso.drop', x: P.x, y: P.y, z: P.z, why});
  }
  function plant(dt) { const d = Math.exp(-dt * 18); P.vx *= d; P.vy *= d; moveBy(P.vx * dt, P.vy * dt); }
  function faceTo(dt, rate) {   // toward S.tx, S.ty (world)
    yaw(); const dx = S.tx - wx(), dy = S.ty - wy(); if (dx * dx + dy * dy < 1e-4) return;
    const v = toV(dx, dy); P.want = dirOf(v[0], v[1]); if (rate) turnToward(P.want, dt, rate); else P.face = P.want;
  }
  const wx = () => P.x * c + P.y * s, wy = () => -P.x * s + P.y * c;   // (after yaw())
  // walking with the rope: speed toward the input, a share of his own (the modifiers' SPEED), sliding along what blocks
  // -> WK {d: the distance moved, sp: the speed} (one kept object: this runs every step)
  const WK = {d: 0, sp: 0};
  function walk(dt, mx, my, share) {
    const target = (keys.has('q') ? SPEED.walk : keys.has('shift') ? SPEED.sprint : SPEED.run) * share;
    let sp = hypot2(P.vx, P.vy);
    if (mx || my) { sp = sp < target ? Math.min(target, sp + 22 * dt) : Math.max(target, sp - 22 * dt); P.vx = mx * sp; P.vy = my * sp; }
    else { const k = Math.max(0, sp - 26 * dt); if (sp > 1e-6) { P.vx *= k / sp; P.vy *= k / sp; } sp = k; }
    WK.d = moveBy(P.vx * dt, P.vy * dt); WK.sp = sp; return WK;
  }
  // the legs' phase by the distance walked: the walk / run frame and its foot puffs (as player.js gaitDistance)
  function gait(d, sp, L) {
    const run = sp >= 2.3 && A.CLIP.run, C = A.CLIP[run ? 'run' : 'walk'];
    P.ph = (P.ph + d / C.stride) % 1;
    const at2 = P.ph * C.stride; let f = 0; while (f < C.frames - 1 && at2 >= C.cum[f + 1]) f++;
    const name = (run ? L.run : L.walk)[f], key = (run ? 'lr' : 'lw') + f;
    if (key !== P.prevF) { const ci = C.contacts.indexOf(f); if (ci >= 0 && P.prevF !== -1) puff(C.contact_foot[ci], A.SP[name] ? name : (run ? 'run.' : 'walk.') + f, 0); P.prevF = key; }
    return name;
  }

  // ---------------------------------------------------------------- the step
  function step(dt, mx, my) {
    if (!S.mode) return false;
    if (S.mode === 'drop') return drop(dt);
    if (S.mode === 'hang') { if (P.state !== 'rope') { S.mode = ''; ev({type: 'lasso.drop', x: P.x, y: P.y, z: P.z, why: P.state}); return false; } }
    else if (BUSY.has(P.state) || P.state === 'roll' || P.state === 'backstep') { abort(P.state); return false; }
    else if (PL.gun?.S.want) { abort('gun'); return false; }   // LMB: he lets the rope go and draws (gun.js takes the press)
    const L = tls();
    S.t += dt; yaw();
    switch (S.mode) {
      case 'spin': {
        const {d, sp} = walk(dt, mx, my, TUNE.spin.walk);
        if (mx || my) { P.want = dirOf(mx, my); turnToward(P.want, dt, TURN_RATE); }
        else if (S.faceOn) faceTo(dt, AIM_TURN_RATE);
        if (sp > .2 && d > 0) { P.state = 'move'; P.frame = gait(d, sp, L); }
        else { P.state = 'idle'; P.frame = at(L.spin, S.t, true); P.prevF = -1; }
        return true;
      }
      case 'throw': {   // (planted: the clip is a standing throw; his speed is kept for a swing: throwAt)
        plant(dt); P.state = 'idle';
        if (S.t <= dt * 1.5) faceTo(dt, 0); else faceTo(dt, AIM_TURN_RATE);
        P.frame = at(L.throw, S.t, false);
        if (!S.loose && S.t >= L.throw.rel) { S.loose = true; ev({type: 'lasso.loose', x: P.x, y: P.y, z: P.z}); }
        if (S.t >= L.throw.total) { S.mode = ''; P.t = 0; }
        return true;
      }
      case 'haul': {
        const {d, sp} = walk(dt, mx, my, TUNE.hold.haul);
        if (S.leashOn) leash();
        faceTo(dt, AIM_TURN_RATE);
        P.state = sp > .2 ? 'move' : 'idle';
        if (sp > .2) S.ph = (S.ph + d / .5) % 1;   // a step every half metre: the two hold poses
        P.frame = sp <= .2 && L.take.real && S.t < L.take.total ? at(L.take, S.t, false) : L.haul[sp > .2 ? (S.ph < .5 ? 0 : 1) : 0];   // (the rope goes taut: take)
        return true;
      }
      case 'preview': {   // (the sandbox's "Lasso: preview poses": every lasso pose in place, in turn; moving ends it)
        if (mx || my) { S.mode = ''; P.t = 0; return false; }
        plant(dt); P.state = 'idle';
        const it = PV[S.pi % PV.length], k = it[0], per = it[2] || 1.6;
        if (S.t >= per) { S.t -= per; S.pi = (S.pi + 1) % PV.length; }
        const t = S.t, n = PV[S.pi % PV.length];
        S.pvName = n[3];
        P.frame = n[0] === 'pose' ? L[n[1]][n[4]] : n[0] === 'cycle' ? L[n[1]][Math.floor(t * 10) % L[n[1]].length] : at(L[n[1]], t, true);
        return true;
      }
      case 'yank': {   // (its pull mark: lasso.pull, the gadget throws what it holds then)
        plant(dt); P.state = 'idle'; faceTo(dt, AIM_TURN_RATE);
        P.frame = at(L.yank, S.t, false);
        if (!S.loose && S.t >= L.yank.rel) { S.loose = true; ev({type: 'lasso.pull', x: P.x, y: P.y, z: P.z}); }
        if (S.t >= L.yank.total) { S.mode = ''; P.t = 0; }
        return true;
      }
      case 'hang': swing(dt, mx, my, L); return true;
    }
    return false;
  }
  // the rope holds him within its length of what he holds: back along it by what he's past (a wall may stop that)
  function leash() {
    const px = wx(), py = wy(), dx = px - S.lx, dy = py - S.ly, d = hypot2(dx, dy), over = d - S.len;
    if (over <= 1e-4) return;
    const k = Math.min(over, .5) / d, v = toV(-dx * k, -dy * k);
    moveBy(v[0], v[1]);
  }

  // ---------------------------------------------------------------- the swing
  const GP = [0, 0, 0];
  function gripOff(frame) {   // the hang pose's upper grip (RopeHand1): m right of the pivot (view), m above it; a stand-in
    const b = A.SP[frame]?.bones?.[A.DIRS[P.face]], g = POSES.hang.grip;   // (POSES.hang.grip: which hand holds the rope)
    let m = null;
    if (b) { if (g === 'auto') { const a0 = b[HANDS.grip], a1 = b[HANDS.upper]; m = a0 && a1 ? (a0[1] <= a1[1] ? a0 : a1) : a0 || a1 || null; } else m = b[g] || null; }   // pose without it hangs from straight over his head
    if (!m) { GO.x = 0; GO.z = SW.hang; return GO; }
    GO.x = (m[0] - A.PIV[0]) / T.PPM; GO.z = (A.PIV[1] - m[1]) / T.PPMH; return GO;
  }
  const GO = {x: 0, z: 0};
  function swing(dt, mx, my, L) {
    const W = S.W, n = 2, h = dt / n;
    // the pose first (its grip says where his feet hang from the rope's end)
    const ux = S.gx - S.ax, uy = S.gy - S.ay, sv = hypot2(S.vx, S.vy);
    if (sv > .6) { S.fx = S.vx / sv; S.fy = S.vy / sv; }
    const along = (ux * S.fx + uy * S.fy) / Math.max(.5, S.L);
    const fr = L.hangIn.names.length && S.t < L.hangIn.total ? at(L.hangIn, S.t, false) : L.hang[along > .3 ? 0 : along < -.3 ? 2 : 1];   // (onto the rope first)
    { const v = toV(S.fx, S.fy); P.want = dirOf(v[0], v[1]); turnToward(P.want, dt, TURN_RATE); }
    P.frame = fr;
    if (S.grab) {   // the grab (lasso_hang_in up to its grip mark): still on his feet, running on; then the swing lifts him
      moveBy(P.vx * dt, P.vy * dt);
      if (S.t < L.hangIn.rel) return;
      lift(fr);
    }
    S.pt += dt;
    const go = gripOff(fr);
    // pumping: WASD (the camera's frame) in the world
    const iw = toW(mx, my), ix = iw[0], iy = iw[1];
    // the rope's length: reeled in to Lt over reelT s at the catch; F held climbs it (shorter: the swing quickens, as
    // his angular momentum keeps: the speed across the rope x the old length / the new)
    if (S.climb && S.pt >= SW.reelT) S.Lt = Math.max(SW.minLen, S.Lt - SW.climb * dt);
    const Lold = S.L;
    S.L = S.pt < SW.reelT ? S.L0 + (S.Lt - S.L0) * (S.pt / SW.reelT) : S.Lt;
    if (S.pt >= SW.reelT && S.L < Lold && S.air) { const q = Math.min(1.06, Lold / S.L); S.vx *= q; S.vy *= q; S.vh *= q; }
    for (let k = 0; k < n; k++) {
      S.vh -= SW.g * h; S.vx += ix * SW.pump * h; S.vy += iy * SW.pump * h;
      const dk = 1 - SW.damp * h; S.vx *= dk; S.vy *= dk; S.vh *= dk;
      let nx = S.gx + S.vx * h, ny = S.gy + S.vy * h, nh = S.gh + S.vh * h;
      // the rope: never longer than L (it only pulls): back onto the sphere, no speed outward
      const dx = nx - S.ax, dy = ny - S.ay, dz = nh - S.ah, d = hypot3(dx, dy, dz);
      if (d > S.L && d > 1e-6) {
        const q = S.L / d; nx = S.ax + dx * q; ny = S.ay + dy * q; nh = S.ah + dz * q;
        const ex = dx / d, ey = dy / d, ez = dz / d, vr = S.vx * ex + S.vy * ey + S.vh * ez;
        if (vr > 0) { S.vx -= vr * ex; S.vy -= vr * ey; S.vh -= vr * ez; }
      }
      // a wall, a trunk, a cliff face (higher ground than his feet: never stepped up onto): bump and drop
      const feet = nh - go.z, gz = W.elev(nx, ny);
      if (W.solid(nx, ny, Math.max(feet, Math.min(gz, W.elev(S.gx, S.gy))), feet + 1.6, .26)) {
        S.vx *= -SW.bump; S.vy *= -SW.bump; S.vh = Math.min(S.vh, 0);
        place(go); ev({type: 'lasso.bump', x: P.x, y: P.y, z: P.z}); letGo('bump'); return;
      }
      // the ground (and the water) under his feet: he runs / slides on it
      S.air = feet > gz + .12;
      if (feet < gz + .02) {
        if (gz <= 0 && W.water(nx, ny)) { S.gx = nx; S.gy = ny; S.gh = nh; place(go); letGo('water'); return; }   // he touches the creek: he falls in
        nh = gz + go.z; if (S.vh < 0) S.vh = 0;
        const fk = Math.exp(-h * SW.drag); S.vx *= fk; S.vy *= fk;
      }
      S.gx = nx; S.gy = ny; S.gh = nh;
    }
    S.ground = S.air ? 0 : S.ground + dt;
    place(go);
    if (S.pt > SW.max) { letGo('time'); return; }
    if (!S.air && S.ground > SW.rest && hypot2(S.vx, S.vy) < 1.5) { S.mode = ''; P.state = 'idle'; P.t = 0; P.vx = P.vy = 0; P.z = W.elev(wx(), wy()); ev({type: 'lasso.letgo', x: P.x, y: P.y, z: P.z, vx: 0, vy: 0, vz: 0, why: 'ground'}); }
  }
  // the fist closes on the rope (lasso_hang_in's grip mark, or at once): the pendulum starts from where his fist is, his run
  // + up + a push toward the anchor's foot (he jumps off), the rope as long as it is now, reeled in to clear the ground
  function lift(fr) {
    S.grab = false; S.pt = 0; yaw();
    const go = gripOff(fr), px = wx(), py = wy(), r = toW(go.x, 0), W = S.W;
    S.gx = px + r[0]; S.gy = py + r[1]; S.gh = P.z + go.z;
    const ex = S.ax - px, ey = S.ay - py, el = hypot2(ex, ey) || 1, w = toW(P.vx, P.vy);
    S.vx = w[0] + ex / el * SW.push; S.vy = w[1] + ey / el * SW.push; S.vh = SW.up;
    const d0 = hypot3(S.gx - S.ax, S.gy - S.ay, S.gh - S.ah), floor = S.ah - W.elev(S.ax, S.ay) - go.z - SW.clear;
    S.L0 = S.L = d0; S.Lt = Math.max(SW.minLen, Math.min(d0 * (1 - SW.lift), floor >= SW.minLen ? floor : d0));
  }
  // his feet from the grip (the pose's grip offset), into P (the view frame)
  function place(go) {
    const v = toV(S.gx, S.gy); P.x = v[0] - go.x; P.y = v[1]; P.z = S.gh - go.z;
    const u = toV(S.vx, S.vy); P.vx = u[0]; P.vy = u[1];
  }
  // off the rope with the onto-the-rope clip (lasso_hang_in) backward over his fall, so the hat comes back on: the
  // player's own fall and landing (stepTraverse), its frame overridden while the clip lasts
  function drop(dt) {
    const L = tls(); S.t += dt;
    if (!L.hangIn.names.length || S.t >= L.hangIn.total || P.state !== 'fall') { S.mode = ''; return false; }
    stepTraverse(dt);
    if (P.state === 'fall') P.frame = at(L.hangIn, Math.max(0, L.hangIn.total - S.t - 1e-4), false);
    return true;
  }
  function letGo(why) {
    if (S.mode !== 'hang') return;
    S.mode = tls().hangIn.names.length ? 'drop' : ''; S.t = 0; yaw();
    const v = toV(S.vx, S.vy);
    P.state = 'fall'; P.t = 0; P.vx = v[0]; P.vy = v[1]; P.vz = S.vh; P.fall0 = Math.max(P.z, S.W.elev(wx(), wy())); P.aimRoll = false;
    ev({type: 'lasso.letgo', x: P.x, y: P.y, z: P.z, vx: P.vx, vy: P.vy, vz: S.vh, why});
  }

  // ---------------------------------------------------------------- the API (features/equip/lasso.js)
  // (views) the rope hand's marker in pose `frame` at facing f: px in the frame, or null without one (upper: RopeHand1)
  const MK = {x: 0, y: 0};
  function marker(frame, f, upper) { const m = A.SP[frame]?.bones?.[A.DIRS[f]]?.[upper ? HANDS.upper : HANDS.grip]; if (!m) return null; MK.x = m[0]; MK.y = m[1]; return MK; }
  return {
    S, step, hand, tls, marker, get atlas() { return A; },
    get mode() { return S.mode; },
    // the sandbox's pose preview (features/equip.js menu): on / off
    preview(on) { if (on) { PL.gun?.stow?.(); S.mode = 'preview'; S.t = 0; S.pi = 0; } else if (S.mode === 'preview') { S.mode = ''; P.t = 0; } return S.mode === 'preview'; },
    // spin the loop overhead (on) / stop (off: only from spin)
    spin(on) {
      if (on) { if (S.mode === 'hang' || S.mode === 'haul') return false; PL.gun?.stow?.(); S.mode = 'spin'; S.t = 0; S.faceOn = false; P.prevF = -1; return true; }
      if (S.mode === 'spin') { S.mode = ''; P.t = 0; } return true;
    },
    // face this world point while standing (the aim) / throw at it (the clip; lasso.loose at its release mark)
    face(x, y) { S.tx = x; S.ty = y; S.faceOn = true; },
    // (his speed as he throws is kept for a swing: the clip plants him, the swing starts from his run)
    throwAt(x, y) { PL.gun?.stow?.(); yaw(); const v = toW(P.vx, P.vy); S.v0x = v[0]; S.v0y = v[1]; S.mode = 'throw'; S.t = 0; S.tx = x; S.ty = y; S.loose = false; },
    // hold something on the rope: face it, the leash (world: what he holds, the rope's length)
    haul(on) { if (on) { S.mode = 'haul'; S.t = 0; S.ph = 0; S.leashOn = false; } else if (S.mode === 'haul') { S.mode = ''; S.leashOn = false; P.t = 0; } },
    leash(x, y, len) { S.tx = x; S.ty = y; S.lx = x; S.ly = y; S.len = len; S.leashOn = true; },
    yank(x, y) { if (x !== undefined) { S.tx = x; S.ty = y; } S.mode = 'yank'; S.t = 0; S.leashOn = false; S.loose = false; },
    // swing from the anchor (world ax, ay, ah); W: {elev(x, y), water(x, y), solid(x, y, h0, h1, r)} in the world; v0: his
    // velocity (world) to start from. -> false when he can't (mid-air already, a dodge)
    hang(ax, ay, ah, W) {
      if (BUSY.has(P.state) || P.state === 'roll' || P.state === 'backstep') return false;
      yaw();
      S.W = W; S.ax = ax; S.ay = ay; S.ah = ah; S.mode = 'hang'; S.t = 0; S.pt = 0; S.ground = 0; S.air = false; S.climb = false; S.grab = true;
      // his run: the speed as he threw (the throw clip planted him) or now, whichever is more; he runs on through the grab
      const vv = toW(P.vx, P.vy), big = hypot2(S.v0x || 0, S.v0y || 0) > hypot2(vv[0], vv[1]);
      S.vx = big ? S.v0x : vv[0]; S.vy = big ? S.v0y : vv[1]; S.v0x = S.v0y = 0;
      const v = toV(S.vx, S.vy); P.vx = v[0]; P.vy = v[1];
      const px = wx(), py = wy(), ex = ax - px, ey = ay - py, el = hypot2(ex, ey) || 1, sv = hypot2(S.vx, S.vy);
      if (sv > .3) { S.fx = S.vx / sv; S.fy = S.vy / sv; } else { S.fx = ex / el; S.fy = ey / el; }
      P.state = 'rope'; P.t = 0; P.aimRoll = false;
      return true;
    },
    climb(on) { S.climb = !!on && S.mode === 'hang'; },   // F held on a swing: up the rope
    // off the rope: from a swing he flies on; from anything else he stands again
    letGo() { if (S.mode === 'hang') letGo('key'); else if (S.mode) { S.mode = ''; S.leashOn = false; P.t = 0; } },
    stop() { if (S.mode === 'hang') letGo('stop'); S.mode = ''; S.leashOn = false; },
  };
}
