// LIVE BODIES: characters drawn LIVE through render/rigmesh.js (rigid per-bone segments, the pixelizer's rules on the
// GPU) from a model's exported poses, many at once, with the live hero's pixel-friendly motion knobs (view/livehero.js,
// docs/exp/livehero.md: its measurements say which knobs keep the pixels from swimming). The player's live hero is its
// own module; this is the same idea for the world's characters (the desert's gunmen: features/foes/look.js; brutes and
// the merchant through the procedural models of view/rigkit.js), kept small: one model, many bodies, no per-frame
// allocation.
// A MODEL (liveModel): ragdoll_export.py's json + bin (or a rigkit model): the bones in depth-first order, every pose's
// bones as WORLD (body space: Blender axes, x his left, y back, z up, the feet at the origin facing -y) and LOCAL
// transforms (quaternion + position), made on first use; the clips' timing (json.clips, with the walk's cum strides);
// the gun's muzzle in the gun's frame (GunMuzzle0's rest under GunHold0's).
// A BODY (createLiveBody): one character on screen, its own drawn pose and history. draw(o) each frame:
//   o.pose      the pose's name (a frame the sim's timeline picked: the STEPPED time knob, the clips' own holds); or o.w, a
//               pose made in code (body space, bones x 7: view/rigkit.js) with o.key its identity (the matrices are rebuilt
//               when the key changes: the caller steps its procedural motion)
//   o.phi       his facing in the world (rad, the arena's atan2(x, y)); the caller snaps it (16 steps relative to the
//               camera: the FACE knob, as the sprites)
//   o.x, o.y, o.z   the anchor (arena x, y, height); o.sx, o.sy, o.sh the whole-pixel SNAP anchor (arena x, y, height:
//               where he stands, no shove; rigmesh uSnap)
//   o.aim       the spine twist that puts the drawn barrel on o.tx, o.ty, o.th on SCREEN (the live hero's aimTwist: the
//               body is squashed as the 20 deg sprite camera saw it, so a world-space aim is not a screen aim), within
//               o.lo .. o.hi rad, re-solved at STEP_HZ (stepped) and held by HYST deg of hysteresis; o.aim false: no twist
//               (LEVEL: first the gun arm turned so the barrel's pitch is the target's elevation: armLift; o.pitchRef: the pose
//               whose barrel sets that turn, for frames moving off it, the kick; o.hold: keep the twist and the lift as they are,
//               the kick's frames: its flip is drawn as authored)
//   o.alpha, o.flash, o.lie (0 upright .. 1 lying: the pitch the death clips' lying frames are drawn at, as the ragdolls)
//   o.drop      a Uint8Array (a byte per segment: 1 = drawn as nothing) over the pose's own hidden pieces: a gunman's hat or gun
//               lying on the ground (features/foes/look.js, docs/exp/brawl.md); o.dropV its version (the matrices rebuild when it changes)
// The matrices are rebuilt only when what they're made of changed (the pose, the facing, the twist); a body that only
// moved has its translations shifted. muzzle(out) -> the drawn muzzle (world), boneMats(out) the drawn pose as the
// ragdoll's pose object (bone -> 3x4, body space: view/ragdoll.js spawn's o.mats), screenBox.
// OWNS: the bodies' drawn poses and history. READS: the model, G (the camera, toScreenInto). EMITS: nothing.
// BUDGET: view; per body and frame ~.005 ms standing still or walking (a pose change: a copy + FK-free world pose +
//   ~22 matrices), the twist solve ~6-15 projected barrels at STEP_HZ; render: rigmesh's (A + S a model, B a rig).
import {SEGMAX} from '../render/rigmesh.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const C20 = Math.cos(20 * DEG), S55 = Math.sin(55 * DEG), K_UP = Math.tan(20 * DEG) * C20 / S55;   // the sprite camera's squash
const PITCH_LIE = Math.atan(S55 / C20);
export const KNOBS = {STEP_HZ: 12, HYST: 7, AIM: {coarse: 12 * DEG, steps: 10, stick: .12, tol: .5 * DEG, keep: 4 * DEG, jump: 20 * DEG, gain: 3 * DEG}};
const wrap = a => a - TAU * Math.round(a / TAU);

// ---------------------------------------------------------------- quaternions (x, y, z, w) in Float64Arrays
export function qmul(a, i, b, j, o, k) {   // o = a * b
  const ax = a[i], ay = a[i + 1], az = a[i + 2], aw = a[i + 3], bx = b[j], by = b[j + 1], bz = b[j + 2], bw = b[j + 3];
  o[k] = aw * bx + ax * bw + ay * bz - az * by; o[k + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[k + 2] = aw * bz + ax * by - ay * bx + az * bw; o[k + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
export function qrot(q, i, x, y, z, o, k) {   // o = q v q*
  const qx = q[i], qy = q[i + 1], qz = q[i + 2], qw = q[i + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  o[k] = x + qw * tx + qy * tz - qz * ty; o[k + 1] = y + qw * ty + qz * tx - qx * tz; o[k + 2] = z + qw * tz + qx * ty - qy * tx;
}
export function axisAngle(x, y, z, a, o, k = 0) { const s = Math.sin(a / 2); o[k] = x * s; o[k + 1] = y * s; o[k + 2] = z * s; o[k + 3] = Math.cos(a / 2); return o; }
const R4 = new Float64Array(4), V3 = new Float64Array(3), QI = new Float64Array(4);

// ---------------------------------------------------------------- a model
// J: ragdoll_export.py's json (segs, bones, poses, clips, hide, families), bin its corners; or a rigkit model's same shape
export function liveModel(rig, J, bin) {
  if (J.segs.length > SEGMAX) throw new Error(`livebody: ${J.segs.length} segments (max ${SEGMAX})`);
  const model = rig.addModel(J, bin);
  const CL = J.clips || {}, HIDE = J.hide || {};
  for (const c of Object.values(CL)) if (c.advance && !c.cum) { c.cum = [0]; c.advance.forEach((a, i) => c.cum.push(c.cum[i] + a)); }
  // the bones in depth-first order (a bone's subtree is the range [b, END[b])), those the poses carry
  const first = J.poses['idle.0'] || J.poses[Object.keys(J.poses)[0]];
  const names = Object.keys(J.bones).filter(b => first[b]);
  const kids = {}; for (const b of names) { const p = names.includes(J.bones[b].parent) ? J.bones[b].parent : null; (kids[p] ??= []).push(b); }
  const BN = []; (function dfs(p) { for (const b of kids[p] || []) { BN.push(b); dfs(b); } })(null);
  const NB = BN.length, IX = Object.fromEntries(BN.map((b, i) => [b, i]));
  const PI = Int16Array.from(BN.map(b => IX[J.bones[b].parent] ?? -1)), END = new Int16Array(NB);
  for (let i = NB - 1; i >= 0; i--) { END[i] = i + 1; for (let j = i + 1; j < NB; j++) { let q = PI[j]; while (q > i) q = PI[q]; if (q === i) END[i] = j + 1; else if (q < i) break; } }
  const LEN = Float64Array.from(BN.map(b => { const B = J.bones[b]; return Math.hypot(B.tail[0] - B.head[0], B.tail[1] - B.head[1], B.tail[2] - B.head[2]); }));
  const SEG = Int16Array.from(J.segs.map(s => IX[s.bone] ?? 0)), NS = J.segs.length;
  const B_ = n => IX[n] ?? -1;
  const MZ = new Float64Array(3);   // the muzzle in the gun's frame (GunMuzzle0 is a fixed child of GunHold0: rest^-1 x rest)
  if (J.bones.GunMuzzle0 && J.bones.GunHold0) {
    const r = J.bones.GunHold0.rest, h = J.bones.GunMuzzle0.head, d = [h[0] - r[3], h[1] - r[7], h[2] - r[11]];
    for (let k = 0; k < 3; k++) MZ[k] = r[k] * d[0] + r[4 + k] * d[1] + r[8 + k] * d[2];
  }
  const POSE = new Map();
  function toLocal(w, l) {
    for (let i = 0; i < NB; i++) {
      const o = i * 7, p = PI[i] * 7;
      if (PI[i] < 0) { for (let k = 0; k < 7; k++) l[o + k] = w[o + k]; continue; }
      QI[0] = -w[p]; QI[1] = -w[p + 1]; QI[2] = -w[p + 2]; QI[3] = w[p + 3];
      qmul(QI, 0, w, o, l, o);
      qrot(QI, 0, w[o + 4] - w[p + 4], w[o + 5] - w[p + 5], w[o + 6] - w[p + 6], l, o + 4);
    }
  }
  function fk(l, w) {   // local -> world, parents first
    for (let i = 0; i < NB; i++) {
      const o = i * 7, p = PI[i] * 7;
      if (PI[i] < 0) { for (let k = 0; k < 7; k++) w[o + k] = l[o + k]; continue; }
      qmul(w, p, l, o, w, o);
      qrot(w, p, l[o + 4], l[o + 5], l[o + 6], V3, 0);
      w[o + 4] = w[p + 4] + V3[0]; w[o + 5] = w[p + 5] + V3[1]; w[o + 6] = w[p + 6] + V3[2];
    }
  }
  // a pose by name (null: the model lacks it): {w, l, hide} made on first use
  function poseOf(name) {
    let p = POSE.get(name); if (p !== undefined) return p;
    const src = J.poses[name]; if (!src) { POSE.set(name, null); return null; }
    const w = new Float64Array(NB * 7), l = new Float64Array(NB * 7);
    for (let i = 0; i < NB; i++) { const v = src[BN[i]] || src.Hips; for (let k = 0; k < 7; k++) w[i * 7 + k] = v[k]; }
    toLocal(w, l);
    const h = HIDE[name], hide = h ? Uint8Array.from(J.segs, s => h.includes(s.bone) ? 1 : 0) : null;
    POSE.set(name, p = {w, l, name, hide});
    return p;
  }
  // a subtree [b, END[b]) turned by quaternion q about point c (body space)
  function turnTree(w, b, q, cx, cy, cz) {
    for (let i = b; i < END[b]; i++) {
      const o = i * 7; qmul(q, 0, w, o, w, o);
      qrot(q, 0, w[o + 4] - cx, w[o + 5] - cy, w[o + 6] - cz, V3, 0);
      w[o + 4] = cx + V3[0]; w[o + 5] = cy + V3[1]; w[o + 6] = cz + V3[2];
    }
  }
  return {J, model, CL, BN, NB, IX, PI, END, LEN, SEG, NS, MZ, poseOf, toLocal, fk, turnTree,
    HIPS: B_('Hips'), SPINE: B_('Spine'), SPINE1: B_('Spine1'), SPINE2: B_('Spine2'), GUN: B_('GunHold0'), HAND_R: B_('RightHand'), ARM_R: B_('RightArm'),
    has: n => !!J.poses[n]};
}

// ---------------------------------------------------------------- a body
export function createLiveBody(LM, rig, slot, G) {
  const {NB, NS, SEG, MZ, GUN, HAND_R, ARM_R} = LM;
  const W = new Float64Array(NB * 7), TW = new Float64Array(NB * 7), PW = new Float64Array(NB * 7);
  const MATS = new Float32Array(NS * 12), TB = new Float64Array(NS * 3);   // (TB: each segment's translation before the anchor)
  const PV = new Float64Array(12);   // the body's params for the rig (rigmesh putv)
  const SC = [0, 0, 0], SO = [0, 0, 0], WP = new Float64Array(3), MUZ = new Float64Array(3), CUR = new Float64Array(2);
  let kPose = null, kPhi = NaN, kTw = NaN, kLie = -1, kHide = null, kDropV = -1;   // what the matrices were built from
  const HM = new Uint8Array(NS);   // (the pose's hidden pieces and o.drop together)
  let twist = 0, twistHeld = NaN, stepK = -1, aimBase = null, aimPhi = NaN, haveMuz = false, lift = 0, kLift = 0;
  // body space -> the render's world (X east, Y up, Z south) at the facing (N[0], N[1]: cos, sin) and anchor (N[2], N[3], N[4]);
  // N[5], N[6] the camera's forward on the ground, N[7] the squash, N[8..10] the anchor the matrices were placed at
  // (the frame's numbers live in a typed array: a closure's own variables would box every double written into them, and
  // these are written every frame for every body: ~180 bytes a body a frame)
  const N = new Float64Array(11); N[0] = 1; N[6] = -1; N[7] = K_UP; N[8] = NaN;
  const toWorld = (x, y, z, o, k) => { o[k] = N[0] * x - N[1] * y + N[2]; o[k + 1] = z + N[3]; o[k + 2] = -N[1] * x - N[0] * y + N[4]; };
  function screenOf(x, y, z, out) {   // body space -> view px, the sprite camera's squash applied
    toWorld(x, y, z, WP, 0);
    const dd = (WP[0] - N[2]) * N[5] + (WP[2] - N[4]) * N[6], X = WP[0] - N[5] * dd * (1 - N[7]), Z = WP[2] - N[6] * dd * (1 - N[7]);
    return G.toScreenInto(X, WP[1], Z, out);
  }
  function barrel(w) {   // the muzzle into MUZ (body space)
    const o = GUN * 7; qrot(w, o, MZ[0], MZ[1], MZ[2], V3, 0);
    MUZ[0] = w[o + 4] + V3[0]; MUZ[1] = w[o + 5] + V3[1]; MUZ[2] = w[o + 6] + V3[2];
  }
  // the barrel's pitch in a pose (rad, + up), kept on the pose
  function pitchOf(P) {
    if (P.p0 !== undefined) return P.p0;
    const o = GUN * 7; qrot(P.w, o, MZ[0], MZ[1], MZ[2], V3, 0);
    return (P.p0 = Math.atan2(V3[2], Math.hypot(V3[0], V3[1])));
  }
  // LEVEL: the gun arm turned about the shoulder (about the barrel's side axis: + lifts it) by a rad. The atlas's aim holds
  // the barrel ~12 deg up (it reads level from the sprite camera only side-on); live, the barrel is pitched at the target
  // instead, so the twist that puts it on the target on screen stays small (side-on it was ~45 deg toward the camera)
  function armLift(w, a) {
    if (ARM_R < 0 || Math.abs(a) < 1e-4) return;
    const o = GUN * 7; qrot(w, o, MZ[0], MZ[1], MZ[2], V3, 0); const l = Math.hypot(V3[0], V3[1]); if (l < 1e-4) return;
    axisAngle(V3[1] / l, -V3[0] / l, 0, a, R4); const s = ARM_R * 7; LM.turnTree(w, ARM_R, R4, w[s + 4], w[s + 5], w[s + 6]);
  }
  const gunNear = w => { if (GUN < 0 || HAND_R < 0) return false; const g = GUN * 7, h = HAND_R * 7, x = w[g + 4] - w[h + 4], y = w[g + 5] - w[h + 5], z = w[g + 6] - w[h + 6]; return x * x + y * y + z * z < .0225; };   // (the gun in the hand: within 15 cm)
  // the spine twist (western.py _TWIST: .4 / .3 / .3 over Spine, Spine1, Spine2, about the vertical through each)
  const TWB = Int16Array.of(LM.SPINE, LM.SPINE1, LM.SPINE2), TWF = Float64Array.of(.4, .3, .3);
  function spineTwist(w, d) {
    for (let k = 0; k < 3; k++) { const b = TWB[k]; if (b < 0) continue; axisAngle(0, 0, 1, d * TWF[k], R4); LM.turnTree(w, b, R4, w[b * 7 + 4], w[b * 7 + 5], w[b * 7 + 6]); }
  }
  // the barrel's SCREEN direction vs the line from the muzzle to the target on screen, at twist d
  function screenErr(w, d) {
    TW.set(w); spineTwist(TW, d); barrel(TW);
    screenOf(MUZ[0], MUZ[1], MUZ[2], SC); const sx = SC[0], sy = SC[1];
    const o = GUN * 7; screenOf(TW[o + 4], TW[o + 5], TW[o + 6], SO);
    return wrap(Math.atan2(CUR[1] - sy, CUR[0] - sx) - Math.atan2(sy - SO[1], sx - SO[0]));
  }
  // the live hero's aimTwist: a coarse look over the range when the last answer is far off, then a secant search; it
  // moves only for a clear gain (no hop between the many twists that look alike side-on)
  function aimTwist(w, d0, lo, hi) {
    const A = KNOBS.AIM, c0 = d0 === d0 ? Math.max(lo, Math.min(hi, d0)) : 0, e0 = screenErr(w, c0);
    let a = c0, ea = e0;
    if (Math.abs(e0) > A.coarse) {
      let best = Math.abs(e0);
      for (let k = 0; k <= A.steps; k++) {
        const x = lo + (hi - lo) * k / A.steps, e = screenErr(w, x), c = Math.abs(e) + A.stick * Math.abs(x - c0);
        if (c < best) { best = c; a = x; ea = e; }
      }
    }
    let b = Math.max(lo, Math.min(hi, a + (ea > 0 ? -1 : 1) * 8 * DEG)), eb = screenErr(w, b);
    for (let it = 0; it < 5 && Math.abs(eb) > A.tol; it++) {
      const den = eb - ea; let c = Math.abs(den) < 1e-6 ? b + 6 * DEG : b - eb * (b - a) / den;
      c = Math.max(lo, Math.min(hi, c)); a = b; ea = eb; b = c; eb = screenErr(w, b);
    }
    const r = Math.abs(eb) <= Math.abs(ea) ? b : a, er = Math.min(Math.abs(eb), Math.abs(ea));
    if (Math.abs(e0) < A.keep && Math.abs(r - c0) > A.jump) return c0;
    return er < Math.abs(e0) - A.gain || Math.abs(r - c0) < 2 * DEG ? r : c0;
  }
  function place() { for (let s = 0; s < NS; s++) { const m = s * 12; MATS[m + 3] = TB[s * 3] + N[2]; MATS[m + 7] = TB[s * 3 + 1] + N[3]; MATS[m + 11] = TB[s * 3 + 2] + N[4]; } }
  function mats(w, hide) {
    for (let s = 0; s < NS; s++) {
      const o = SEG[s] * 7, m = s * 12, x = w[o], y = w[o + 1], z = w[o + 2], q = w[o + 3];
      const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * q), r02 = 2 * (x * z + y * q);
      const r10 = 2 * (x * y + z * q), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * q);
      const r20 = 2 * (x * z - y * q), r21 = 2 * (y * z + x * q), r22 = 1 - 2 * (x * x + y * y);
      MATS[m] = N[0] * r00 - N[1] * r10; MATS[m + 1] = N[0] * r01 - N[1] * r11; MATS[m + 2] = N[0] * r02 - N[1] * r12;
      MATS[m + 4] = r20; MATS[m + 5] = r21; MATS[m + 6] = r22;
      MATS[m + 8] = -N[1] * r00 - N[0] * r10; MATS[m + 9] = -N[1] * r01 - N[0] * r11; MATS[m + 10] = -N[1] * r02 - N[0] * r12;
      const px = w[o + 4], py = w[o + 5]; TB[s * 3] = N[0] * px - N[1] * py; TB[s * 3 + 1] = w[o + 6]; TB[s * 3 + 2] = -N[1] * px - N[0] * py;
    }
    place();
    if (hide) for (let s = 0; s < NS; s++) if (hide[s]) { MATS.fill(0, s * 12, s * 12 + 12); TB.fill(0, s * 3, s * 3 + 3); }   // (a zero matrix draws nothing)
  }
  const body = {
    slot, W, get twist() { return twistHeld; }, stats: {solves: 0, rebuilds: 0},
    reset() { kPose = null; kPhi = NaN; twistHeld = NaN; twist = 0; stepK = -1; aimBase = null; haveMuz = false; N[8] = NaN; kDropV = -1; },
    // the frame's draw (see the header). t: the view's clock (s), for the twist's stepped sampling
    draw(o, t) {
      const A = o.w ? null : LM.poseOf(o.pose) || LM.poseOf('idle.0'); if (!A && !o.w) return false;
      const key = A || o.key, src = A ? A.w : o.w, hide0 = A ? A.hide : o.hide || null;   // (o.w: a pose made in code, view/rigkit.js; o.key: its identity, o.hide its pieces drawn as nothing: a blink)
      let hide = hide0; const dropV = o.drop ? o.dropV ?? 0 : -1;
      if (o.drop) { for (let s = 0; s < NS; s++) HM[s] = (hide0 ? hide0[s] : 0) | o.drop[s]; hide = HM; }   // (a dropped hat or gun: features/foes/look.js)
      const phi = o.phi, yaw = G.view.yaw, lie = o.lie || 0;
      N[0] = Math.cos(phi); N[1] = Math.sin(phi); N[2] = o.x; N[3] = o.z; N[4] = o.y; N[5] = -Math.sin(yaw); N[6] = -Math.cos(yaw);
      const pitch = 20 * DEG + (PITCH_LIE - 20 * DEG) * lie; N[7] = Math.tan(pitch) * C20 / S55;
      // the twist: re-solved when its sample ticks (STEP_HZ), the pose or the facing changed; held by the hysteresis
      let tw = 0, lf = 0;
      if (A && o.aim && GUN >= 0 && gunNear(A.w)) {
        const tk = Math.floor(t * KNOBS.STEP_HZ), fresh = A !== aimBase || phi !== aimPhi;
        if (o.hold && twistHeld === twistHeld && phi === aimPhi) aimBase = A;   // (o.hold: the kick's frames keep the aim's twist and lift)
        else if (tk !== stepK || fresh || !(twistHeld === twistHeld)) {
          stepK = tk; G.toScreenInto(o.tx, o.th, o.ty, SC); CUR[0] = SC[0]; CUR[1] = SC[1];
          // the lift: the reference pose's barrel (o.pitchRef: the kick's frames take the aim's, so the kick still flips up)
          // onto the target's elevation from the muzzle, in whole degrees
          barrel(A.w); const d = Math.hypot(o.tx - N[2], o.ty - N[4]) || 1, el = Math.atan2(o.th - (N[3] + MUZ[2]), d);
          lift = Math.round((el - pitchOf((o.pitchRef && LM.poseOf(o.pitchRef)) || A)) / DEG) * DEG;
          PW.set(A.w); armLift(PW, lift);
          twist = aimTwist(PW, fresh ? (twistHeld === twistHeld ? twistHeld : 0) : twist, o.lo ?? -50 * DEG, o.hi ?? 50 * DEG); body.stats.solves++;
          twistHeld = fresh || !(twistHeld === twistHeld) || Math.abs(wrap(twist - twistHeld)) > KNOBS.HYST * DEG ? twist : twistHeld;
          aimBase = A; aimPhi = phi;
        }
        tw = twistHeld; lf = lift;
      } else { twistHeld = NaN; aimBase = null; }
      if (key !== kPose || phi !== kPhi || tw !== kTw || lf !== kLift || lie !== kLie || dropV !== kDropV) {   // what the matrices are made of changed: rebuild
        W.set(src); if (lf) armLift(W, lf); if (tw) spineTwist(W, tw);
        mats(W, hide); kPose = key; kPhi = phi; kTw = tw; kLift = lf; kLie = lie; kHide = hide; kDropV = dropV; N[8] = N[2]; N[9] = N[3]; N[10] = N[4]; body.stats.rebuilds++;
        haveMuz = GUN >= 0 && gunNear(W); if (haveMuz) barrel(W);
      } else if (N[2] !== N[8] || N[3] !== N[9] || N[4] !== N[10]) {   // moved only: the translations follow
        place(); if (kHide) for (let s = 0; s < NS; s++) if (kHide[s]) { const m = s * 12; MATS[m + 3] = MATS[m + 7] = MATS[m + 11] = 0; }
        N[8] = N[2]; N[9] = N[3]; N[10] = N[4];
      }
      // the params (rigmesh putv's order: x, z, k, alpha, flash, pitch, y, type, sx, sy, sz, snap)
      PV[0] = N[2]; PV[1] = N[4]; PV[2] = N[7]; PV[3] = o.alpha ?? 1; PV[4] = o.flash || 0; PV[5] = pitch; PV[6] = N[3]; PV[7] = o.type || 7;
      PV[8] = o.sx ?? o.x; PV[9] = o.sh ?? o.z; PV[10] = o.sy ?? o.y; PV[11] = o.snap === false ? 0 : 1;
      rig.putv(LM.model, slot, MATS, PV);
      return true;
    },
    // the drawn muzzle: world (arena x, y, height) -> out[0..2], on screen -> out[3..4]; false without a gun in hand
    muzzle(out) {
      if (!haveMuz) return false;
      toWorld(MUZ[0], MUZ[1], MUZ[2], WP, 0); out[0] = WP[0]; out[1] = WP[2]; out[2] = WP[1];
      screenOf(MUZ[0], MUZ[1], MUZ[2], SC); out[3] = SC[0]; out[4] = SC[1];
      return true;
    },
    // a point riding bone b (its index; x, y, z in its frame) in the drawn pose -> the world (arena x, y, height), squashed
    // as the body is drawn (so a point laid on the body lands on it: the brutes' glowing eyes)
    pointOn(b, x, y, z, out) {
      const o = b * 7; qrot(W, o, x, y, z, V3, 0); toWorld(W[o + 4] + V3[0], W[o + 5] + V3[1], W[o + 6] + V3[2], WP, 0);
      const dd = (WP[0] - N[2]) * N[5] + (WP[2] - N[4]) * N[6]; out[0] = WP[0] - N[5] * dd * (1 - N[7]); out[1] = WP[2] - N[6] * dd * (1 - N[7]); out[2] = WP[1];
      return out;
    },
    // the drawn pose as view/ragdoll.js's pose object (bone name -> 3x4 row-major, body space, Blender axes): the death
    // starts from exactly what was on screen (the twist included)
    boneMats(out) {
      for (let i = 0; i < NB; i++) {
        const o = i * 7, x = W[o], y = W[o + 1], z = W[o + 2], q = W[o + 3], m = out[LM.BN[i]] ??= new Float64Array(12);
        m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - z * q); m[2] = 2 * (x * z + y * q); m[3] = W[o + 4];
        m[4] = 2 * (x * y + z * q); m[5] = 1 - 2 * (x * x + z * z); m[6] = 2 * (y * z - x * q); m[7] = W[o + 5];
        m[8] = 2 * (x * z - y * q); m[9] = 2 * (y * z + x * q); m[10] = 1 - 2 * (x * x + y * y); m[11] = W[o + 6];
      }
      return out;
    },
  };
  return body;
}
