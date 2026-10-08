// HERO RAGDOLL: the live hero THROWN (sim/player/launch.js: P.state launch, down, getup; docs/exp/launch.md). The body on
// screen when the blast came is handed to a ragdoll (view/ragdoll.js: its bodies in HIS rig, never drawn by it; this hands
// their bones back to livehero.js as his pose) whose pelvis is DRIVEN to the sim's body (P.lc over his ground point): it flies
// the sim's path while the limbs trail and flail (they start with the throw's speed, the legs a little more: he goes over
// backwards), and what stops the sim's body (a wall, the ground) stops the pelvis while the rest carries on into it, against
// the ragdoll's own walls and ground: slammed flat on the wall's face, folded on the ground. Lying, the pull is soft: the body
// settles as it fell.
// GETTING UP (the sim's GETUP s, by its progress): the get-up clip for how he lies (western.py GETUP_LIVE: mv_getup_b from his
// back, mv_getup_f from his front: his front facing up or down), turned so its first frame lies the way his body lies (the
// head's way), blended in from the ragdoll's last pose over the first TUNE.in of the way, then turned toward his facing as he
// rises (TUNE.turn: a direction held turns the sim's facing, so he gets up turning to it). Leaving it (standing, or the sim's
// run-out: a direction held from RUN_AT on) the drawn pose blends into the animation's over TUNE.exit s, in the world (his
// facing may step): from a knee into the run's first stride. A model without the clips blends straight to the animation.
// Each frame it also says how far down he is drawn (hr.k, hr.pitch: rigmesh draws a body lying on the ground at the world's
// angle, as the gunmen's corpses, and a standing one at the sprite camera's).
// VIEW only: writes its own state and its ragdoll's; the sim never reads it.
// API: const hr = createHeroRag({app, G, rig, model, J, BN, PI, toLocal, fk, blendLocal, poseOf, K}); hr.frame(show, P, phi, AX, AY, AZ,
//   dt) -> the pose to draw (body space, BN order: show itself unless he's thrown); hr.k / hr.pitch; hr.on; hr.reset(); hr.warm()
// OWNS: the ragdoll (one body), the pose it hands over. READS: P (state, t, lc, vx / vy, lv), the camera's yaw (app), the ground and
//   the entities near the body (the ragdoll's walls), his rig and model (livehero.js).
// BUDGET: thrown: the ragdoll's step (one body: ~.02 ms) and 25 bones' frames to quaternions; else one copy of the pose (25 x 7).
import {createRagdolls} from './ragdoll.js';
import {elev} from '../world/world.js';
import {GETUP} from '../sim/player/launch.js';

const DEG = Math.PI / 180, C20 = Math.cos(20 * DEG), S55 = Math.sin(55 * DEG), PITCH_LIE = Math.atan(S55 / C20);
const kOf = pitch => Math.tan(pitch) * C20 / S55;   // (rigmesh's squash at a pitch: K_UP at 20 deg)
// pull: the drive a constraint pass while he flies / lies; off: s the start's offset (pelvis vs the sim's body) fades over;
// spin: the legs' extra share of the throw's speed; muscles: x the ragdoll's hold on the pose it starts in (a blast takes him
// limp at once, not the gunmen's stagger); lie: how fast the drawn pitch follows his tilt (1/s); headR: his head's reach
// against the ground and walls (m: the hat stays on, its brim must stay out of them); lift: m the body is drawn up lying (its
// coat and boots reach past the points: sunk in the ground they'd show the x-ray's outline); in: the share of the get-up the
// ragdoll's pose blends into the clip over; turn: the shares of it between which he turns from how he lay to his facing;
// exit: s the blend out of it into the animation (the run's first stride, or standing)
const TUNE = {pull: .45, pullDown: .08, off: .15, spin: .6, muscles: .3, lie: 10, headR: .2, lift: .035, in: .16, turn: [.25, .95], exit: .22};
const UP = {b: 'mv_getup_b', f: 'mv_getup_f'};   // (western.py GETUP_LIVE)
const THROWN = new Set(['launch', 'down', 'getup']);

// 3x4 rigid frames (row-major: r00 r01 r02 tx | r10 .. | r20 ..), as ragdoll.js
function compose(A, a, B, b, O, o) {   // O = A x B
  for (let i = 0; i < 3; i++) {
    const r0 = A[a + i * 4], r1 = A[a + i * 4 + 1], r2 = A[a + i * 4 + 2];
    for (let j = 0; j < 4; j++) O[o + i * 4 + j] = r0 * B[b + j] + r1 * B[b + 4 + j] + r2 * B[b + 8 + j] + (j === 3 ? A[a + i * 4 + 3] : 0);
  }
}
function invert(A, a, O, o) {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) O[o + i * 4 + j] = A[a + j * 4 + i];
  for (let i = 0; i < 3; i++) O[o + i * 4 + 3] = -(O[o + i * 4] * A[a + 3] + O[o + i * 4 + 1] * A[a + 7] + O[o + i * 4 + 2] * A[a + 11]);
}
// a rotation's rows -> its quaternion (x, y, z, w) at o[k]
function quatOf(r00, r01, r02, r10, r11, r12, r20, r21, r22, o, k) {
  const tr = r00 + r11 + r22; let x, y, z, w;
  if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; w = .25 * S; x = (r21 - r12) / S; y = (r02 - r20) / S; z = (r10 - r01) / S; }
  else if (r00 > r11 && r00 > r22) { const S = Math.sqrt(1 + r00 - r11 - r22) * 2; w = (r21 - r12) / S; x = .25 * S; y = (r01 + r10) / S; z = (r02 + r20) / S; }
  else if (r11 > r22) { const S = Math.sqrt(1 + r11 - r00 - r22) * 2; w = (r02 - r20) / S; x = (r01 + r10) / S; y = .25 * S; z = (r12 + r21) / S; }
  else { const S = Math.sqrt(1 + r22 - r00 - r11) * 2; w = (r10 - r01) / S; x = (r02 + r20) / S; y = (r12 + r21) / S; z = .25 * S; }
  const l = Math.hypot(x, y, z, w) || 1; o[k] = x / l; o[k + 1] = y / l; o[k + 2] = z / l; o[k + 3] = w / l;
}
const wrap = a => a - Math.PI * 2 * Math.round(a / (Math.PI * 2)), smooth = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);

export function createHeroRag({app, G, rig, model, J, BN, PI, toLocal, fk, blendLocal, poseOf, K}) {
  const NB = BN.length, S = 0, KEY = 'hero';   // (its one body: slot 0 of its own ragdolls)
  const rag = createRagdolls({G, elev, get zoom() { return app.zoom; }, get entities() { return app.entities; }}, {rig});
  rag.adopt(KEY, J, model, {mass: 1});
  const FRM = new Float64Array(rag.NF * 12), BOFF = new Float64Array(NB * 12), BF = new Int8Array(NB), MW = new Float64Array(12), MI = new Float64Array(12);
  const MOBJ = {}; for (const b of BN) MOBJ[b] = new Float64Array(12);   // the pose it starts from (bone -> 3x4, body space: ragdoll spawn's mats)
  const PREV = new Float64Array(NB * 7), OUT = new Float64Array(NB * 7), LA = new Float64Array(NB * 7), LB = new Float64Array(NB * 7);
  const OFF = [0, 0, 0], PT = [0, 0, 0], own = BN.map(b => rag.boneFrame(b)), GUN_F = rag.boneFrame('GunHold0'), HAT_F = rag.boneFrame('HatHold0');
  const HIPS = BN.indexOf('Hips'), HEAD = BN.indexOf('Head'), ULEG_L = BN.indexOf('LeftUpLeg'), ULEG_R = BN.indexOf('RightUpLeg');
  const GW = new Float64Array(NB * 7), CW = new Float64Array(NB * 7), T1 = new Float64Array(NB * 7), LC = new Float64Array(NB * 7);   // (getting up)
  const CL = J.clips || {}, NAMES = {}, nm = (c, i) => (NAMES[c] ??= [])[i] ??= c + '.' + i;   // (frame names, made once)
  let mode = 0, havePrev = false, pPhi = 0, pX = 0, pY = 0, pZ = 0, tA = 0, lie = 0;   // mode: 0 none, 1 the ragdoll (flying, down), 2 getting up, 3 out of it
  let upClip = '', psi0 = 0, lastPhi = 0, tX = 0;   // (the get-up's clip, the heading it starts at (world), the facing last drawn, the way out's time)

  function keep(w, phi, AX, AY, AZ) { PREV.set(w); pPhi = phi; pX = AX; pY = AY; pZ = AZ; havePrev = true; }
  // a bone's rotation (rows, Blender body axes) from its quaternion at w[o]
  function rowsOf(w, o, M) {
    const x = w[o], y = w[o + 1], z = w[o + 2], q = w[o + 3];
    M[0] = 1 - 2 * (y * y + z * z); M[1] = 2 * (x * y - z * q); M[2] = 2 * (x * z + y * q);
    M[4] = 2 * (x * y + z * q); M[5] = 1 - 2 * (x * x + z * z); M[6] = 2 * (y * z - x * q);
    M[8] = 2 * (x * z - y * q); M[9] = 2 * (y * z + x * q); M[10] = 1 - 2 * (x * x + y * y);
  }
  // THE START: the pose last drawn, where it was drawn, into the ragdoll; each bone's offset from its driving frame (the hat
  // rides the head; the gun the right hand, or where the ragdoll holsters it); the throw's speed to every point
  function begin(P) {
    for (let i = 0; i < NB; i++) { const m = MOBJ[BN[i]], o = i * 7; rowsOf(PREV, o, m); m[3] = PREV[o + 4]; m[7] = PREV[o + 5]; m[11] = PREV[o + 6]; }
    if (!rag.spawn(S, KEY, {x: pX, y: pZ, z: pY, face: pPhi, mats: MOBJ, muscles: TUNE.muscles, headR: TUNE.headR})) return false;
    const B = rag.body(S), gunSeg = B.model.segBone.indexOf('GunHold0'), gunF = B.holstered && gunSeg >= 0 ? B.segFrame[gunSeg] : rag.boneFrame('RightHand');
    rag.frames(S, FRM);
    const c = Math.cos(pPhi), s = Math.sin(pPhi);
    for (let i = 0; i < NB; i++) {
      let j = i; while (j >= 0 && own[j] < 0) j = PI[j];
      const f = j < 0 ? 0 : own[j]; BF[i] = f === HAT_F ? rag.boneFrame('Head') : f === GUN_F ? gunF : f;
      rowsOf(PREV, i * 7, MI);   // the bone's world (render axes) as drawn: livehero.js mats()
      for (let a = 0; a < 3; a++) { MW[a] = c * MI[a] - s * MI[4 + a]; MW[4 + a] = MI[8 + a]; MW[8 + a] = -s * MI[a] - c * MI[4 + a]; }
      const o = i * 7; MW[3] = c * PREV[o + 4] - s * PREV[o + 5] + pX; MW[7] = PREV[o + 6] + pY; MW[11] = -s * PREV[o + 4] - c * PREV[o + 5] + pZ;
      invert(FRM, BF[i] * 12, MI, 0); compose(MI, 0, MW, 0, BOFF, i * 12);
    }
    // where the pelvis is against the sim's body (fades: TUNE.off), and the throw's speed (the view frame's turned to the world's)
    OFF[0] = OFF[1] = OFF[2] = 0;
    for (let i = 0; i < 4; i++) { rag.point(S, i, PT); OFF[0] += PT[0] / 4; OFF[1] += PT[1] / 4; OFF[2] += PT[2] / 4; }
    OFF[0] -= app.player.x; OFF[1] -= P.lc; OFF[2] -= app.player.y;
    const cy = Math.cos(app.yaw), sy = Math.sin(app.yaw);
    rag.shove(S, P.vx * cy + P.vy * sy, P.lv || 0, -P.vx * sy + P.vy * cy, TUNE.spin);
    tA = 0; return true;
  }
  // the ragdoll's bones -> body space at this frame's facing and anchor (what livehero.js mats() turns back)
  function pose(phi, AX, AY, AZ) {
    rag.frames(S, FRM);
    const c = Math.cos(phi), s = Math.sin(phi);
    for (let i = 0; i < NB; i++) {
      compose(FRM, BF[i] * 12, BOFF, i * 12, MW, 0);
      const o = i * 7, dX = MW[3] - AX, dZ = MW[11] - AZ;
      quatOf(c * MW[0] - s * MW[8], c * MW[1] - s * MW[9], c * MW[2] - s * MW[10],
        -s * MW[0] - c * MW[8], -s * MW[1] - c * MW[9], -s * MW[2] - c * MW[10],
        MW[4], MW[5], MW[6], OUT, o);
      OUT[o + 4] = c * dX - s * dZ; OUT[o + 5] = -s * dX - c * dZ; OUT[o + 6] = MW[7] - AY + TUNE.lift * lie;
    }
  }
  // how far down the drawn body is: the hips -> head tilt from upright, 12 .. 78 deg eased (ragdoll.js frame's), followed
  function lieOf(w, dt) {
    let u = 0;
    if (HIPS >= 0 && HEAD >= 0) {
      const a = HIPS * 7, b = HEAD * 7, dx = w[b + 4] - w[a + 4], dy = w[b + 5] - w[a + 5], dz = w[b + 6] - w[a + 6];
      const ang = Math.acos(Math.max(-1, Math.min(1, dz / (Math.hypot(dx, dy, dz) || 1)))) / DEG;
      u = Math.max(0, Math.min(1, (ang - 12) / 66)); u = u * u * (3 - 2 * u);
    }
    lie += (u - lie) * Math.min(1, dt * TUNE.lie);
  }
  function end() { if (mode === 1) rag.free(S); mode = 0; }
  // the whole pose turned about the vertical through his anchor by b (rad: + counter-clockwise from above, body space)
  function turn(w, b) {
    if (!b) return;
    const qs = Math.sin(b / 2), qc = Math.cos(b / 2), c = Math.cos(b), s = Math.sin(b);
    for (let i = 0; i < NB; i++) {
      const o = i * 7, x = w[o], y = w[o + 1], z = w[o + 2], q = w[o + 3], px = w[o + 4], py = w[o + 5];
      w[o] = qc * x - qs * y; w[o + 1] = qc * y + qs * x; w[o + 2] = qc * z + qs * q; w[o + 3] = qc * q - qs * z;
      w[o + 4] = c * px - s * py; w[o + 5] = s * px + c * py;
    }
  }
  const at = (w, i, k) => w[i * 7 + 4 + k];
  // THE WAY UP: the ragdoll's last pose kept as it lies in the world (GW: turned by the facing it was drawn at), the clip for
  // how he lies (his front facing up: from his back), the heading its first frame starts at so it lies as he does
  function startUp(phi) {
    GW.set(OUT); turn(GW, phi); rag.free(S); mode = 2;
    upClip = '';
    if (HIPS < 0 || HEAD < 0 || ULEG_L < 0 || ULEG_R < 0) return;
    const ux = at(OUT, HEAD, 0) - at(OUT, HIPS, 0), uy = at(OUT, HEAD, 1) - at(OUT, HIPS, 1);
    const lx = at(OUT, ULEG_L, 0) - at(OUT, ULEG_R, 0), ly = at(OUT, ULEG_L, 1) - at(OUT, ULEG_R, 1);
    const sky = lx * uy - ly * ux;   // (his front = left x up: its height; > 0 he faces the sky)
    const c = sky > 0 ? UP.b : UP.f; if (!CL[c] || !poseOf(nm(c, 0))) return;
    upClip = c;
    // his head's way against the clip's first frame's (from his back: behind him, +y; from his front: before him, -y)
    psi0 = Math.atan2(uy, ux) + phi - (c === UP.b ? Math.PI / 2 : -Math.PI / 2);
  }
  // the clip at u of the way up (stepped at its frames, or between them), into CW (body space, his own frame)
  function clipAt(u) {
    const n = CL[upClip].frames;
    if (K?.step) { CW.set(poseOf(nm(upClip, Math.min(n - 1, Math.floor(u * n)))).w); return; }
    const t = u * (n - 1), a = Math.min(n - 2, Math.floor(t)), A = poseOf(nm(upClip, a)), B = poseOf(nm(upClip, a + 1));
    blendLocal(A.l, B.l, t - a, LC); fk(LC, CW);
  }

  const hr = {
    get on() { return mode !== 0; },
    get clip() { return mode === 2 ? upClip : ''; },   // (tests: the get-up playing)
    get pitch() { return 20 * DEG + (PITCH_LIE - 20 * DEG) * lie; },
    get k() { return kOf(hr.pitch); },
    frame(show, P, phi, AX, AY, AZ, dt) {
      const st = P.state;
      if (!THROWN.has(st)) {
        if (mode === 1) end();
        if (mode === 2) { GW.set(OUT); turn(GW, lastPhi); mode = 3; tX = 0; }   // up (standing, or running out): the way out
        if (mode === 3) {   // from the get-up's last pose (as it stood in the world) into the animation's, at his facing now
          tX += dt; const e = smooth(tX / TUNE.exit);
          T1.set(GW); turn(T1, -phi); toLocal(T1, LA); toLocal(show, LB); blendLocal(LA, LB, e, LC); fk(LC, OUT);
          if (e >= 1) mode = 0;
          lieOf(OUT, dt); keep(OUT, phi, AX, AY, AZ);
          return OUT;
        }
        if (lie > 0) lie = lie < 1e-3 ? 0 : lie * Math.max(0, 1 - dt * TUNE.lie);
        keep(show, phi, AX, AY, AZ);
        return show;
      }
      if (st === 'getup') {   // up: the clip for how he lies, turned to it, from the ragdoll's last pose, turning to his facing
        if (mode === 1) startUp(phi);
        if (mode !== 2) { keep(show, phi, AX, AY, AZ); return show; }   // (thrown while not drawn live: the animation)
        const u = Math.min(1, P.t / GETUP);
        if (upClip) {
          clipAt(u);
          const psi = psi0 + wrap(phi - psi0) * smooth((u - TUNE.turn[0]) / (TUNE.turn[1] - TUNE.turn[0]));   // (the heading: as he lay -> his facing)
          turn(CW, psi - phi);
        } else CW.set(show);   // (a model without the clips: straight to the animation)
        T1.set(GW); turn(T1, -phi); toLocal(T1, LA); toLocal(CW, LB);   // (the ragdoll's last pose, at his facing now)
        blendLocal(LA, LB, smooth(upClip ? u / TUNE.in : u), LC); fk(LC, OUT);
        lastPhi = phi; lieOf(OUT, dt); keep(OUT, phi, AX, AY, AZ);
        return OUT;
      }
      // flying or down: the ragdoll, its pelvis pulled to the sim's body (not before the sim moves him: the blast's hitstop
      // holds the pose last drawn, as it holds everything)
      if (mode !== 1) {
        if (mode === 2 || mode === 3) { mode = 0; keep(OUT, phi, AX, AY, AZ); }   // (thrown again on the way up: from the pose drawn)
        if (!havePrev) keep(show, phi, AX, AY, AZ);
        if (st === 'launch' && !(P.t > 0)) return PREV;
        if (!begin(P)) return show;
        mode = 1;
      }
      tA += dt; const d = Math.exp(-tA / TUNE.off);
      rag.drive(S, AX + OFF[0] * d, P.lc + OFF[1] * d, AZ + OFF[2] * d, st === 'launch' ? TUNE.pull : TUNE.pullDown);
      rag.step(dt);
      pose(phi, AX, AY, AZ); lieOf(OUT, dt);
      return OUT;
    },
    reset() { end(); mode = 0; havePrev = false; lie = 0; },
    warm: () => rag.warm(KEY),   // (its code paths once, off the first throw)
  };
  return hr;
}
