// RAGDOLL: a gunman's death as a live 3D body thrown by the killing shot (features/foes/look.js spawns one where the
// death clip would play; the default (?ragdoll=0: the clips) for the bandit, the sheriff, the bruiser). VIEW only: nothing in the sim reads it (?views=0 changes nothing).
// The body is the sprite atlas's own Blender model in rigid per-bone segments (tools/blender/ragdoll_export.py), drawn
// by render/rigmesh.js with the pixelizer's rules; this module moves it.
// THE PHYSICS (position based, no library): 16 points on the body (the pelvis block: pelvis, the hips, the belly; the
// chest block: the belly, the neck's base, the shoulders; the head; elbows, wrists, knees, ankles), 3 on the gun, 4 on
// the hat, each with a mass and a radius. Fixed substeps (TUNE.ragdoll.sub a second), verlet with damping; per substep
// `iters` passes of distance constraints (the bones and the two torso blocks rigid; the spine, the neck, elbows and knees
// within limits: elbows and knees bend one way, the torso bends and twists a little, the head tilts), then the ground
// (the world's elevation) and the walls / props near the body (host.entities.near once a frame per body: no scan over
// all props), with friction. A body still for a while sleeps (no more steps, no more uploads).
// PER TYPE (a model each): the loose pieces' points from their boxes (a revolver, the coach gun; each hat), the gun in
// the hand or not (its offset from the grip against gun_aim), the body's mass (TUNE.ragdoll.mass: the shot's push / it).
// THE START: the exported pose nearest the sprite he showed (poseFor), facing as the sprite faced, every point placed by
// the pose's bones; for a short while the MUSCLES hold that pose against gravity, fading out (the legs first, so the
// knees give), and the killing shot pushes the points round where it hit (its way, the gun's power). The gun and the hat
// fly loose with their own toss and spin (viewRandom('ragdoll'), never Math.random).
// THE DRAW: each segment's world matrix = its driving frame (built from its points: the pelvis, the belly, the chest,
// the head from their blocks; the limbs by parallel transport, so a straight arm never flips) x the offset fixed at the
// start (frame^-1 x the bone's posed matrix); the body's pitch follows how far down it is (`lie`: the hips -> head tilt,
// a running max), the sprite camera's 20 deg upright .. the world's 41 deg lying (render/rigmesh.js).
// API: const R = createRagdolls(host); await R.load(name, url); R.warm(name) (once, at load); R.ready(name); R.spawn(slot, name, o) (o: x, y, z (the
//   ground), face (rad), pose (a sprite pose name), hit {x, y, h, dx, dy, power} | null, flash, frozen); R.step(dt);
//   R.frame(); R.alpha(slot, a); R.free(slot); R.onGround = (slot) => {} (the torso first hits the ground); R.bytes; R.ms.
// OWNS: the bodies (points, offsets, frames), the models, its rig renderer.
// EMITS: nothing (onGround tells its owner: features/foes/look.js emits foe.ground).
// READS: host.elev, host.entities (near), host.G (via render/rigmesh.js), TUNE.ragdoll.
// BUDGET: view; per body and substep ~23 points x 8 constraint passes (~40 constraints); 6 bodies settling ~.1 ms a frame
//   (measured in the report: tmp/western/ragdoll). No allocation per step or frame.
import {createRigMesh, SEGMAX} from '../render/rigmesh.js';
import {viewRandom} from '../core/rng.js';
import {PROP_TOP} from '../world/world.js';
import {TUNE} from '../content/foes.js';

const T = TUNE.ragdoll, NB = 16, NG = 3, NH = 4, NP = NB + NG + NH, G0 = NB, H0 = NB + NG;
const DEG = Math.PI / 180, C20 = Math.cos(20 * DEG), S55 = Math.sin(55 * DEG), PITCH_LIE = Math.atan(S55 / C20);
// the points: [bone, local x, y, z] (the bone's rest frame: y along the bone; z is the body's forward on the spine bones)
const PTS = [
  ['Hips', 0, 0, -.06], ['LeftUpLeg', 0, 0, 0], ['RightUpLeg', 0, 0, 0], ['Spine1', 0, 0, .08], ['Neck', 0, 0, 0],
  ['LeftArm', 0, 0, 0], ['RightArm', 0, 0, 0], ['Head', 0, .2, 0], ['LeftForeArm', 0, 0, 0], ['LeftHand', 0, 0, 0],
  ['RightForeArm', 0, 0, 0], ['RightHand', 0, 0, 0], ['LeftLeg', 0, 0, 0], ['LeftFoot', 0, 0, 0], ['RightLeg', 0, 0, 0], ['RightFoot', 0, 0, 0],
  ['GunHold0', 0, -.03, 0], ['GunHold0', 0, .19, 0], ['GunHold0', .06, 0, 0],
  ['HatHold0', .3, .02, 0], ['HatHold0', -.15, .02, .26], ['HatHold0', -.15, .02, -.26], ['HatHold0', 0, .25, 0],
];
const MASS = [3, 2, 2, 2.5, 3, 1.5, 1.5, 1.6, .8, .5, .8, .5, 1.5, .9, 1.5, .9, .3, .3, .3, .08, .08, .08, .08];
const RAD = [.11, .09, .09, .11, .1, .07, .07, .11, .05, .045, .05, .045, .06, .075, .06, .075, .025, .02, .025, .012, .012, .012, .03];
const RH = .035;   // m: a gun's origin further than this off its grip (against gun_aim) is not in the hand
const LEG = new Uint8Array(NP); for (const i of [12, 13, 14, 15]) LEG[i] = 1;
// distance constraints: [a, b, lo, hi] x the start distance (1, 1: rigid)
const CON = [
  [0, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 1], [0, 3, 1, 1], [1, 3, 1, 1], [2, 3, 1, 1],          // the pelvis block
  [3, 4, 1, 1], [3, 5, 1, 1], [3, 6, 1, 1], [4, 5, 1, 1], [4, 6, 1, 1], [5, 6, 1, 1],          // the chest block
  [4, 7, 1, 1], [5, 8, 1, 1], [8, 9, 1, 1], [6, 10, 1, 1], [10, 11, 1, 1],                      // the neck, the arms
  [1, 12, 1, 1], [12, 13, 1, 1], [2, 14, 1, 1], [14, 15, 1, 1],                                 // the legs
  [1, 5, .86, 1.07], [2, 6, .86, 1.07], [1, 6, .9, 1.06], [2, 5, .9, 1.06], [0, 4, .88, 1.03],  // the spine bends, twists
  [5, 7, .8, 1.16], [6, 7, .8, 1.16], [3, 7, .9, 1.06],                                         // the head tilts
  [12, 4, .55, 9], [14, 4, .55, 9], [12, 14, .4, 9], [13, 15, .3, 9], [8, 0, .3, 9], [10, 0, .3, 9],  // limbs keep out of each other
  [16, 17, 1, 1], [16, 18, 1, 1], [17, 18, 1, 1],                                               // the gun
  [19, 20, 1, 1], [19, 21, 1, 1], [20, 21, 1, 1], [19, 22, 1, 1], [20, 22, 1, 1], [21, 22, 1, 1],  // the hat
];
const NC = CON.length;
// the joints: [outer a, middle, outer b, fold] the a..b distance from fold x (upper + lower) to straight, the middle bending
// toward the block's front only (elbows: the chest's; knees: the pelvis's, the shin going back)
const JOINT = [[5, 8, 9, .3, 1], [6, 10, 11, .3, 1], [1, 12, 13, .38, 0], [2, 14, 15, .38, 0]];
// the driving frames: [origin, axis from, axis to, hint from, hint to, hint2 from, hint2 to, transported]
const FR = [
  [0, 0, 3, 2, 1, -1, -1, 0],      // 0 pelvis
  [3, 0, 4, 2, 1, 6, 5, 0],        // 1 the middle of the spine
  [4, 3, 4, 6, 5, -1, -1, 0],      // 2 the chest
  [7, 4, 7, 6, 5, -1, -1, 0],      // 3 the head and neck
  [5, 5, 8, 6, 5, -1, -1, 1], [8, 8, 9, 6, 5, -1, -1, 1],        // 4, 5 the left arm
  [6, 6, 10, 6, 5, -1, -1, 1], [10, 10, 11, 6, 5, -1, -1, 1],    // 6, 7 the right arm
  [1, 1, 12, 2, 1, -1, -1, 1], [12, 12, 13, 2, 1, -1, -1, 1],    // 8, 9 the left leg
  [2, 2, 14, 2, 1, -1, -1, 1], [14, 14, 15, 2, 1, -1, -1, 1],    // 10, 11 the right leg
  [16, 16, 17, 16, 18, -1, -1, 0], [19, 19, 20, 19, 21, -1, -1, 0],   // 12 the gun, 13 the hat
];
const NF = FR.length;
const FRAME_OF = {Hips: 0, Spine: 1, Spine1: 1, Spine2: 2, LeftShoulder: 2, RightShoulder: 2, Neck: 3, Head: 3, LeftArm: 4, LeftForeArm: 5, LeftHand: 5,
  RightArm: 6, RightForeArm: 7, RightHand: 7, LeftUpLeg: 8, LeftLeg: 9, LeftFoot: 9, LeftToeBase: 9, RightUpLeg: 10, RightLeg: 11, RightFoot: 11, RightToeBase: 11,
  GunHold0: 12, HatHold0: 13};

// ---------------------------------------------------------------- 3x4 rigid frames (row-major: r00 r01 r02 tx | r10 .. | r20 ..)
function compose(A, a, B, b, O, o) {   // O = A x B
  for (let i = 0; i < 3; i++) {
    const r0 = A[a + i * 4], r1 = A[a + i * 4 + 1], r2 = A[a + i * 4 + 2];
    for (let j = 0; j < 4; j++) O[o + i * 4 + j] = r0 * B[b + j] + r1 * B[b + 4 + j] + r2 * B[b + 8 + j] + (j === 3 ? A[a + i * 4 + 3] : 0);
  }
}
function invert(A, a, O, o) {   // a rigid frame's inverse: R^T, -R^T t
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) O[o + i * 4 + j] = A[a + j * 4 + i];
  for (let i = 0; i < 3; i++) O[o + i * 4 + 3] = -(O[o + i * 4] * A[a + 3] + O[o + i * 4 + 1] * A[a + 7] + O[o + i * 4 + 2] * A[a + 11]);
}

export function createRagdolls(host) {
  const rig = createRigMesh(host.G, {slots: NB});
  const RND = viewRandom('ragdoll'), RR = (a, b) => a + RND() * (b - a), RA = r => RR(r[0], r[1]);
  const models = {};
  // per body (slot): the points (current, previous), the constraints' lengths, the segments' offsets, the frames, its state
  const SL = 16, P = new Float64Array(SL * NP * 3), Q = new Float64Array(SL * NP * 3), LEN = new Float64Array(SL * NC);
  const JL = new Float64Array(SL * 4), HOLD = new Float64Array(SL * NB * 3), XP = new Float64Array(SL * NF * 3);   // the muscles' targets (pelvis frame), the transported x axes
  const OFF = new Float32Array(SL * SEGMAX * 12), FRM = new Float64Array(NF * 12), FI = new Float64Array(12), MATS = new Float32Array(SEGMAX * 12);
  const BODY = []; for (let s = 0; s < SL; s++) BODY.push({on: false, model: null, t: 0, acc: 0, asleep: false, frozen: false, still: 0, lie: 0, alpha: 1, flash: 0,
    thud: false, ground: 0, props: new Float64Array(8 * 7), np: 0, segFrame: new Int8Array(SEGMAX), sx: 0, sy: 0, sz: 0, holstered: false, drawn: false, mats: new Float32Array(SEGMAX * 12)});
  const nearOut = [], TMP = new Float64Array(12);
  let ms = 0, msF = 0;   // the steps' time, the draw's (matrices + the rig's pass A): ms a frame, smoothed

  async function load(name, url) {
    if (models[name]) return models[name];
    const [J, bin] = await Promise.all([fetch(url + 'model.json').then(r => r.json()), fetch(url + 'model.bin').then(r => r.arrayBuffer())]);
    const M = rig.addModel(J, bin);
    // the bones' rest lengths; each pose's bones as render-ready 3x4 Blender-world matrices (made once)
    const poses = {};
    for (const [pn, bones] of Object.entries(J.poses)) {
      const out = {};
      for (const [bn, v] of Object.entries(bones)) {
        const [x, y, z, w, tx, ty, tz] = v, m = new Float64Array(12);
        m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - z * w); m[2] = 2 * (x * z + y * w); m[3] = tx;
        m[4] = 2 * (x * y + z * w); m[5] = 1 - 2 * (x * x + z * z); m[6] = 2 * (y * z - x * w); m[7] = ty;
        m[8] = 2 * (x * z - y * w); m[9] = 2 * (y * z + x * w); m[10] = 1 - 2 * (x * x + y * y); m[11] = tz;
        out[bn] = m;
      }
      poses[pn] = out;
    }
    const segFrame = J.segs.map(s => FRAME_OF[s.bone] ?? 0);
    // the loose pieces' points from their boxes (the bone's frame: y along the gun / up through the hat): the gun's grip
    // (half the stock behind the hand), its muzzle, a point off its side; the hat's brim in three and its crown
    const pts = PTS.map(q => q.slice()), box = bone => J.segs.find(s => s.bone === bone);
    const g = box('GunHold0'), h = box('HatHold0');
    if (g) { pts[G0] = ['GunHold0', 0, g.min[1] * .5, 0]; pts[G0 + 1] = ['GunHold0', 0, g.max[1] * .96, 0]; pts[G0 + 2] = ['GunHold0', g.max[0] * .85, 0, 0]; }
    if (h) {
      const r = Math.min(h.max[0], h.max[2]) * .8, y = h.min[1] + .02;
      pts[H0] = ['HatHold0', r, y, 0]; pts[H0 + 1] = ['HatHold0', -r / 2, y, r * .866]; pts[H0 + 2] = ['HatHold0', -r / 2, y, -r * .866]; pts[H0 + 3] = ['HatHold0', 0, h.max[1] * .88, 0];
    }
    const gunRef = poses.gun_aim ? handOffset(poses.gun_aim, [0, 0, 0]) : null;
    return (models[name] = {J, M, poses, names: Object.keys(poses), segFrame, segBone: J.segs.map(s => s.bone), pts, gunRef, mass: T.mass?.[name] ?? 1});
  }
  // where the gun's origin sits in the right hand's frame in a pose (Blender axes): in the hand it rides the grip (as in
  // gun_aim, give or take a spin about it); in the holster it is a hand's span and more away
  function handOffset(pose, out) {
    const H = pose.RightHand, Gm = pose.GunHold0; if (!H || !Gm) return null;
    const dx = Gm[3] - H[3], dy = Gm[7] - H[7], dz = Gm[11] - H[11];
    out[0] = H[0] * dx + H[4] * dy + H[8] * dz; out[1] = H[1] * dx + H[5] * dy + H[9] * dz; out[2] = H[2] * dx + H[6] * dy + H[10] * dz;
    return out;
  }
  const HO = [0, 0, 0];
  // the exported pose nearest a sprite pose name (features/foes/look.js poseOf's names)
  function poseFor(m, name) {
    if (m.poses[name]) return name;
    const [clip, i] = name.split('.');
    if (clip === 'idle') return +i >= 2 && +i < 6 ? 'idle.4' : 'idle.0';
    if (clip === 'gun_holster' && m.poses[`gun_holster.${Math.max(0, i - 1)}`]) return `gun_holster.${Math.max(0, i - 1)}`;
    let g = /^g[wr][sr]_([mp]?\d+|0|up|load|fetch)_(\d)$/.exec(name);
    if (g && name.startsWith('gws') || g && name.startsWith('grs')) {
      const d = g[1] === '0' ? 0 : (g[1][0] === 'm' ? -1 : 1) * +g[1].slice(1), tw = ['m90', 'm45', '0', 'p45'];
      let best = '0', bd = 1e9; for (const t of tw) { const v = t === '0' ? 0 : (t[0] === 'm' ? -1 : 1) * +t.slice(1); if (Math.abs(v - d) < bd) { bd = Math.abs(v - d); best = t; } }
      return `gws_${best}_${g[2]}`;
    }
    if (clip.startsWith('gun_fan')) return 'gun_fire.0';
    if (clip.startsWith('gaim') || name.startsWith('gun_aim')) return 'gun_aim';
    if (name.startsWith('gwr') || name.startsWith('grr')) return 'gun_reload.4';
    if (clip.startsWith('gun_') || clip.startsWith('hit_')) return 'gun_aim';
    return 'idle.0';
  }

  // ---------------------------------------------------------------- frames from points
  function frameOf(s, f, out, o, init) {
    const b = s * NP * 3, F = FR[f], ox = P[b + F[0] * 3], oy = P[b + F[0] * 3 + 1], oz = P[b + F[0] * 3 + 2];
    let zx = P[b + F[2] * 3] - P[b + F[1] * 3], zy = P[b + F[2] * 3 + 1] - P[b + F[1] * 3 + 1], zz = P[b + F[2] * 3 + 2] - P[b + F[1] * 3 + 2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let hx, hy, hz;
    const xp = (s * NF + f) * 3;
    if (F[7] && !init) { hx = XP[xp]; hy = XP[xp + 1]; hz = XP[xp + 2]; }
    else {
      hx = P[b + F[4] * 3] - P[b + F[3] * 3]; hy = P[b + F[4] * 3 + 1] - P[b + F[3] * 3 + 1]; hz = P[b + F[4] * 3 + 2] - P[b + F[3] * 3 + 2];
      if (F[5] >= 0) { hx += P[b + F[6] * 3] - P[b + F[5] * 3]; hy += P[b + F[6] * 3 + 1] - P[b + F[5] * 3 + 1]; hz += P[b + F[6] * 3 + 2] - P[b + F[5] * 3 + 2]; }
    }
    let d = hx * zx + hy * zy + hz * zz, xx = hx - zx * d, xy = hy - zy * d, xz = hz - zz * d;
    l = Math.hypot(xx, xy, xz);
    if (l < 1e-5) {   // (the hint along the axis: any perpendicular)
      if (Math.abs(zy) < .9) { xx = zz; xy = 0; xz = -zx; } else { xx = 1; xy = 0; xz = 0; }
      d = xx * zx + xy * zy + xz * zz; xx -= zx * d; xy -= zy * d; xz -= zz * d; l = Math.hypot(xx, xy, xz) || 1;
    }
    xx /= l; xy /= l; xz /= l;
    if (F[7]) { XP[xp] = xx; XP[xp + 1] = xy; XP[xp + 2] = xz; }
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;   // y = z x x
    out[o] = xx; out[o + 1] = yx; out[o + 2] = zx; out[o + 3] = ox;
    out[o + 4] = xy; out[o + 5] = yy; out[o + 6] = zy; out[o + 7] = oy;
    out[o + 8] = xz; out[o + 9] = yz; out[o + 10] = zz; out[o + 11] = oz;
  }

  // ---------------------------------------------------------------- a body
  const MW = new Float64Array(12);   // a bone's posed matrix in the world (render axes), scratch
  function boneWorld(pose, bone, c, sn, x, y, z, out) {   // Blender (x his left, y back, z up) at facing (c, sn) -> render X, Y up, Z
    const m = pose[bone];
    for (let j = 0; j < 4; j++) {
      const a = m[j], b = m[4 + j], h = m[8 + j];
      out[j] = c * a - sn * b + (j === 3 ? x : 0); out[4 + j] = h + (j === 3 ? z : 0); out[8 + j] = -sn * a - c * b + (j === 3 ? y : 0);
    }
  }
  function spawn(s, name, o) {
    const m = models[name]; if (!m) return false;
    const B = BODY[s], pose = m.poses[poseFor(m, o.pose || 'idle.0')] || m.poses['idle.0'] || m.poses[m.names[0]];
    const c = Math.cos(o.face), sn = Math.sin(o.face), b = s * NP * 3;
    for (let i = 0; i < NP; i++) {
      const [bone, lx, ly, lz] = m.pts[i];
      boneWorld(pose, pose[bone] ? bone : 'Hips', c, sn, o.x, o.y, o.z, MW);
      for (let k = 0; k < 3; k++) P[b + i * 3 + k] = Q[b + i * 3 + k] = MW[k * 4] * lx + MW[k * 4 + 1] * ly + MW[k * 4 + 2] * lz + MW[k * 4 + 3];
    }
    for (let k = 0; k < NC; k++) { const [i, j] = CON[k]; LEN[s * NC + k] = Math.hypot(P[b + i * 3] - P[b + j * 3], P[b + i * 3 + 1] - P[b + j * 3 + 1], P[b + i * 3 + 2] - P[b + j * 3 + 2]); }
    for (let k = 0; k < 4; k++) {
      const [a, mid, e] = JOINT[k];
      JL[s * 4 + k] = Math.hypot(P[b + a * 3] - P[b + mid * 3], P[b + a * 3 + 1] - P[b + mid * 3 + 1], P[b + a * 3 + 2] - P[b + mid * 3 + 2])
        + Math.hypot(P[b + e * 3] - P[b + mid * 3], P[b + e * 3 + 1] - P[b + mid * 3 + 1], P[b + e * 3 + 2] - P[b + mid * 3 + 2]);
    }
    // the frames now, and each segment's offset from its frame (frame^-1 x the bone's posed matrix)
    for (let f = 0; f < NF; f++) frameOf(s, f, FRM, f * 12, true);
    for (let i = 0; i < m.segBone.length; i++) {
      boneWorld(pose, pose[m.segBone[i]] ? m.segBone[i] : 'Hips', c, sn, o.x, o.y, o.z, MW);
      invert(FRM, m.segFrame[i] * 12, FI, 0); compose(FI, 0, MW, 0, TMP, 0);
      for (let k = 0; k < 12; k++) OFF[(s * SEGMAX + i) * 12 + k] = TMP[k];
    }
    // the muscles' targets: every body point in the pelvis frame
    invert(FRM, 0, FI, 0);
    for (let i = 0; i < NB; i++) {
      const x = P[b + i * 3], y = P[b + i * 3 + 1], z = P[b + i * 3 + 2], h = (s * NB + i) * 3;
      for (let k = 0; k < 3; k++) HOLD[h + k] = FI[k * 4] * x + FI[k * 4 + 1] * y + FI[k * 4 + 2] * z + FI[k * 4 + 3];
    }
    B.sx = o.x; B.sy = o.z; B.sz = o.y;   // (the snap anchor: where he stood, render axes)
    Object.assign(B, {on: true, model: m, t: 0, acc: 0, asleep: !!o.frozen, frozen: !!o.frozen, drawn: false, still: 0, lie: 0, alpha: o.alpha ?? 1, flash: o.flash || 0, thud: false, np: 0});
    B.segFrame.set(m.segFrame);
    // a gun not in the hand (its origin off the grip by more than RH m against gun_aim: holstered, slung) stays on the
    // body, on the right thigh or the chest, whichever it is nearer (it flies only from the hand)
    const ho = m.gunRef && handOffset(pose, HO);
    B.holstered = !!ho && Math.hypot(ho[0] - m.gunRef[0], ho[1] - m.gunRef[1], ho[2] - m.gunRef[2]) > RH;
    if (B.holstered) for (let i = 0; i < m.segBone.length; i++) if (m.segBone[i] === 'GunHold0') {
      boneWorld(pose, 'GunHold0', c, sn, o.x, o.y, o.z, MW);
      const dT = Math.hypot(MW[3] - (P[b + 6] + P[b + 42]) / 2, MW[7] - (P[b + 7] + P[b + 43]) / 2, MW[11] - (P[b + 8] + P[b + 44]) / 2);
      const dC = Math.hypot(MW[3] - P[b + 12], MW[7] - P[b + 13], MW[11] - P[b + 14]), fr = dT <= dC ? 10 : 2;
      B.segFrame[i] = fr; invert(FRM, fr * 12, FI, 0); compose(FI, 0, MW, 0, TMP, 0);
      for (let k = 0; k < 12; k++) OFF[(s * SEGMAX + i) * 12 + k] = TMP[k];
    }
    if (o.hit && !o.frozen) push(s, o.hit);
    return true;
  }
  // the killing shot: a push round its point (and some through the whole body), as a velocity (verlet: the previous
  // points); the gun and the hat tossed along it and up, spinning. H: x, y, h (where it met him), dx, dy (its way), power
  function push(s, H) {
    const B = BODY[s]; if (!B.on || B.frozen) return;
    const b = s * NP * 3, dt = 1 / T.sub, dl = Math.hypot(H.dx, H.dy) || 1, ux = H.dx / dl, uz = H.dy / dl;
    const V = Math.min(T.hit.max, H.power * T.hit.k) / B.model.mass, r2 = 2 * T.hit.r * T.hit.r;   // (a heavier body takes the same shot slower)
    for (let i = 0; i < NB; i++) {
      const dx = P[b + i * 3] - H.x, dy = P[b + i * 3 + 1] - H.h, dz = P[b + i * 3 + 2] - H.y, w = T.hit.all + (1 - T.hit.all) * 2.2 * Math.exp(-(dx * dx + dy * dy + dz * dz) / r2);
      Q[b + i * 3] -= ux * V * w * dt; Q[b + i * 3 + 2] -= uz * V * w * dt;
    }
    // the legs give way: the knees nudged forward (the pelvis block's front: left x up), so they fold as the muscles let go
    const lx = P[b + 3] - P[b + 6], ly = P[b + 4] - P[b + 7], lz = P[b + 5] - P[b + 8], vx = P[b + 9] - P[b], vy = P[b + 10] - P[b + 1], vz = P[b + 11] - P[b + 2];
    let fx = ly * vz - lz * vy, fy = lz * vx - lx * vz, fz = lx * vy - ly * vx; const fl = Math.hypot(fx, fy, fz) || 1, kb = T.muscles.buckle * dt / fl;
    for (const i of [12, 14]) { Q[b + i * 3] -= fx * kb; Q[b + i * 3 + 1] -= fy * kb; Q[b + i * 3 + 2] -= fz * kb; }
    if (!B.holstered) toss(s, G0, NG, ux, uz, T.gun, V);
    toss(s, H0, NH, ux, uz, T.hat, V * (H.h > 1.25 ? 1.3 : .8));
  }
  function toss(s, i0, n, ux, uz, U, V) {
    const b = s * NP * 3, dt = 1 / T.sub, f = RA(U.fwd) * (.6 + .15 * V), up = RA(U.up), side = RR(-.5, .5);
    const vx = ux * f - uz * side, vz = uz * f + ux * side;
    let cx = 0, cy = 0, cz = 0; for (let i = i0; i < i0 + n; i++) { cx += P[b + i * 3] / n; cy += P[b + i * 3 + 1] / n; cz += P[b + i * 3 + 2] / n; }
    let ax = RR(-1, 1), ay = RR(-1, 1), az = RR(-1, 1); const al = Math.hypot(ax, ay, az) || 1, w = RA(U.spin); ax *= w / al; ay *= w / al; az *= w / al;
    for (let i = i0; i < i0 + n; i++) {   // v = the toss + spin x r
      const rx = P[b + i * 3] - cx, ry = P[b + i * 3 + 1] - cy, rz = P[b + i * 3 + 2] - cz;
      Q[b + i * 3] -= (vx + ay * rz - az * ry) * dt; Q[b + i * 3 + 1] -= (up + az * rx - ax * rz) * dt; Q[b + i * 3 + 2] -= (vz + ax * ry - ay * rx) * dt;
    }
  }

  // ---------------------------------------------------------------- the step
  // what stands near the body this frame (walls, crates, solid props: rect or round, from z to its top): no scan of all props
  function gather(B, s) {
    const b = s * NP * 3, x = P[b], z = P[b + 2]; B.np = 0;
    for (const p of host.entities.near(x, z, 2.2, nearOut)) {
      if (B.np >= 8 || p.broken || p.gone || p.kind === 'gunman') continue;
      const k = B.np * 7, top = (p.z || 0) + (PROP_TOP[p.kind] ?? 2.5);
      if (p.rect) { B.props[k] = 1; B.props[k + 1] = p.rect[0]; B.props[k + 2] = p.rect[1]; B.props[k + 3] = p.rect[2]; B.props[k + 4] = p.rect[3]; }
      else if (p.r > .2) { B.props[k] = 2; B.props[k + 1] = p.x; B.props[k + 2] = p.y; B.props[k + 3] = p.r; }
      else continue;
      B.props[k + 5] = p.z || 0; B.props[k + 6] = top; B.np++;
    }
  }
  function collide(B, s, i) {
    const b = s * NP * 3 + i * 3, r = RAD[i];
    let x = P[b], y = P[b + 1], z = P[b + 2], hit = false;
    for (let k = 0; k < B.np; k++) {
      const q = k * 7; if (y - r > B.props[q + 6] || y + r < B.props[q + 5]) continue;
      if (B.props[q] === 1) {
        const x0 = B.props[q + 1] - r, z0 = B.props[q + 2] - r, x1 = B.props[q + 3] + r, z1 = B.props[q + 4] + r;
        if (x <= x0 || x >= x1 || z <= z0 || z >= z1) continue;
        if (y - r > B.props[q + 6] - .12) { y = B.props[q + 6] + r; hit = true; continue; }   // (on top of it)
        const dl = x - x0, dr = x1 - x, du = z - z0, dd = z1 - z, mn = Math.min(dl, dr, du, dd);
        if (mn === dl) x = x0; else if (mn === dr) x = x1; else if (mn === du) z = z0; else z = z1;
      } else {
        const dx = x - B.props[q + 1], dz = z - B.props[q + 2], R = B.props[q + 3] + r, d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        if (y - r > B.props[q + 6] - .12) { y = B.props[q + 6] + r; hit = true; continue; }
        const d = Math.sqrt(d2) || 1e-4; x = B.props[q + 1] + dx / d * R; z = B.props[q + 2] + dz / d * R;
      }
    }
    let g = host.elev(x, z) + r;
    if (g - y > .3) {   // a step up higher than a stair (the mesa's cliff, a plateau): a wall, not ground to stand on
      const b0 = s * NP * 3 + i * 3; x = Q[b0]; z = Q[b0 + 2]; g = host.elev(x, z) + r;
    }
    if (y < g) { y = g; hit = true; }
    P[b] = x; P[b + 1] = y; P[b + 2] = z;
    return hit;
  }
  const CONTACT = new Uint8Array(NP);
  function substep(B, s, dt) {
    const b = s * NP * 3, g = T.gravity * dt * dt, damp = T.damp;
    for (let i = 0; i < NP; i++) {   // verlet
      const k = b + i * 3;
      for (let a = 0; a < 3; a++) { const v = (P[k + a] - Q[k + a]) * damp; Q[k + a] = P[k + a]; P[k + a] += v - (a === 1 ? g : 0); }
    }
    // the muscles: the pose held in the pelvis frame, fading (the legs first)
    const M = T.muscles;
    if (B.t < M.body) {
      frameOf(s, 0, FRM, 0, true);
      for (let i = 4; i < NB; i++) {
        const tl = LEG[i] ? M.legs : M.body; if (B.t >= tl) continue;
        const u = 1 - B.t / tl, kk = M.k * u * u, h = (s * NB + i) * 3, k = b + i * 3;
        for (let a = 0; a < 3; a++) {
          const tg = FRM[a * 4] * HOLD[h] + FRM[a * 4 + 1] * HOLD[h + 1] + FRM[a * 4 + 2] * HOLD[h + 2] + FRM[a * 4 + 3];
          P[k + a] += (tg - P[k + a]) * kk;
        }
      }
    }
    CONTACT.fill(0);
    for (let it = 0; it < T.iters; it++) {
      for (let c = 0; c < NC; c++) {
        const C = CON[c], i = b + C[0] * 3, j = b + C[1] * 3, L = LEN[s * NC + c];
        const dx = P[j] - P[i], dy = P[j + 1] - P[i + 1], dz = P[j + 2] - P[i + 2], d = Math.hypot(dx, dy, dz) || 1e-6;
        const lo = L * C[2], hi = L * C[3], goal = d < lo ? lo : d > hi ? hi : d; if (goal === d) continue;
        const wi = 1 / MASS[C[0]], wj = 1 / MASS[C[1]], f = (d - goal) / d / (wi + wj);
        P[i] += dx * f * wi; P[i + 1] += dy * f * wi; P[i + 2] += dz * f * wi;
        P[j] -= dx * f * wj; P[j + 1] -= dy * f * wj; P[j + 2] -= dz * f * wj;
      }
      joints(s);
      for (let i = 0; i < NP; i++) if (collide(B, s, i)) CONTACT[i] = 1;
    }
    // friction where it touches (the sliding speed along the ground), a little bounce for the gun and the hat
    let mx = 0;
    for (let i = 0; i < NP; i++) {
      const k = b + i * 3;
      if (CONTACT[i]) {
        const mu = i < NB ? T.mu[0] : i < H0 ? T.mu[1] : T.mu[2];
        Q[k] = P[k] - (P[k] - Q[k]) * (1 - mu); Q[k + 2] = P[k + 2] - (P[k + 2] - Q[k + 2]) * (1 - mu);
        if (i >= NB) { const vy = P[k + 1] - Q[k + 1]; if (vy < 0) Q[k + 1] = P[k + 1] + vy * T.bounce; }
        if (!B.thud && (i === 0 || i === 3 || i === 4)) { B.thud = true; R.onGround?.(s); }
      }
      mx = Math.max(mx, Math.abs(P[k] - Q[k]), Math.abs(P[k + 1] - Q[k + 1]), Math.abs(P[k + 2] - Q[k + 2]));
    }
    B.t += dt;
    if (B.t > T.sleep.after && mx < T.sleep.eps) { if ((B.still += dt) > T.sleep.still) B.asleep = true; } else B.still = 0;
  }
  // elbows and knees: within their fold .. straight, and bending one way (the middle toward the block's front: elbows
  // the chest's, knees the pelvis's: the shin goes back)
  function joints(s) {
    const b = s * NP * 3;
    for (let k = 0; k < 4; k++) {
      const [a, m, e, fold, arm] = JOINT[k], A = b + a * 3, Mi = b + m * 3, E = b + e * 3, L = JL[s * 4 + k];
      let dx = P[E] - P[A], dy = P[E + 1] - P[A + 1], dz = P[E + 2] - P[A + 2], d = Math.hypot(dx, dy, dz) || 1e-6;
      if (d < L * fold) {
        const wi = 1 / MASS[a], wj = 1 / MASS[e], f = (d - L * fold) / d / (wi + wj);
        P[A] += dx * f * wi; P[A + 1] += dy * f * wi; P[A + 2] += dz * f * wi; P[E] -= dx * f * wj; P[E + 1] -= dy * f * wj; P[E + 2] -= dz * f * wj;
        dx = P[E] - P[A]; dy = P[E + 1] - P[A + 1]; dz = P[E + 2] - P[A + 2]; d = Math.hypot(dx, dy, dz) || 1e-6;
      }
      // the block's forward: (left x up) of the pelvis (knees) or the chest (elbows)
      const lx = arm ? P[b + 15] - P[b + 18] : P[b + 3] - P[b + 6], ly = arm ? P[b + 16] - P[b + 19] : P[b + 4] - P[b + 7], lz = arm ? P[b + 17] - P[b + 20] : P[b + 5] - P[b + 8];
      const ux = arm ? P[b + 12] - P[b + 9] : P[b + 9] - P[b], uy = arm ? P[b + 13] - P[b + 10] : P[b + 10] - P[b + 1], uz = arm ? P[b + 14] - P[b + 11] : P[b + 11] - P[b + 2];
      const fx = ly * uz - lz * uy, fy = lz * ux - lx * uz, fz = lx * uy - ly * ux, fl = Math.hypot(fx, fy, fz) || 1;
      // the middle's offset from the line a..e; knees must not be behind it (hyperextension), elbows not in front
      const t = ((P[Mi] - P[A]) * dx + (P[Mi + 1] - P[A + 1]) * dy + (P[Mi + 2] - P[A + 2]) * dz) / (d * d);
      const ox = P[Mi] - (P[A] + dx * t), oy = P[Mi + 1] - (P[A + 1] + dy * t), oz = P[Mi + 2] - (P[A + 2] + dz * t);
      const side = (ox * fx + oy * fy + oz * fz) / fl, want = arm ? -1 : 1;
      if (side * want < -.005) {
        const push = -(side + want * .005) / fl;
        P[Mi] += fx * push; P[Mi + 1] += fy * push; P[Mi + 2] += fz * push;
      }
    }
  }
  function step(dt) {
    const t0 = performance.now(), h = 1 / T.sub;
    for (let s = 0; s < SL; s++) {
      const B = BODY[s]; if (!B.on) continue;
      if (B.asleep) continue;
      gather(B, s);
      B.acc = Math.min(B.acc + dt, 6 * h);
      while (B.acc >= h) { substep(B, s, h); B.acc -= h; }
    }
    ms = ms * .9 + (performance.now() - t0) * .1;
  }
  // every body this frame: its segments' matrices (frame x offset) and its pitch, to the rig
  const PR = {x: 0, z: 0, y: 0, k: 1, alpha: 1, flash: 0, pitch: 0, sx: 0, sy: 0, sz: 0, snap: 1};
  function frame(dt = 1 / 60) {
    const t0 = performance.now();
    for (let s = 0; s < SL; s++) {
      const B = BODY[s]; if (!B.on) continue;
      if (B.flash > 0) B.flash = Math.max(0, B.flash - dt * 8);   // (combat's hit flash, carried over from the last sprite: by the frame's time)
      const b = s * NP * 3, m = B.model;
      if (!B.asleep || !B.drawn) {   // (a body asleep or frozen keeps the matrices it was last drawn with: no work, no upload)
        B.drawn = true;
        for (let f = 0; f < NF; f++) frameOf(s, f, FRM, f * 12, B.frozen);
        for (let i = 0; i < m.segBone.length; i++) compose(FRM, B.segFrame[i] * 12, OFF, (s * SEGMAX + i) * 12, MATS, i * 12);
        // how far down: the hips -> head tilt from upright, 12 .. 78 deg eased (a running max: tools/blender/western.py _lie_now)
        const hx = P[b + 21] - P[b], hy = P[b + 22] - P[b + 1], hz = P[b + 23] - P[b + 2];
        const a = Math.acos(Math.max(-1, Math.min(1, hy / (Math.hypot(hx, hy, hz) || 1)))) / DEG, u = Math.max(0, Math.min(1, (a - 12) / 66));
        B.lie = Math.max(B.lie, u * u * (3 - 2 * u));
        B.mats.set(MATS);
      }
      const pitch = 20 * DEG + (PITCH_LIE - 20 * DEG) * B.lie;
      PR.x = P[b]; PR.y = P[b + 1]; PR.z = P[b + 2]; PR.k = Math.tan(pitch) * C20 / S55; PR.alpha = B.alpha; PR.flash = B.flash; PR.pitch = pitch; PR.sx = B.sx; PR.sy = B.sy; PR.sz = B.sz;
      rig.put(m.M, s, B.mats, PR);
      contact(B, s);
    }
    rig.render();
    msF = msF * .9 + (performance.now() - t0) * .1;
  }
  // the contact shadow (as the death clips' corpses have one: gfx.js G.ao, laid on the ground pixels by the composite at the
  // mood's tint): a soft blob under each body point that rests on the ground, bigger under the torso and the head
  const AO_BIG = blob(13, 6), AO_SMALL = blob(9, 4), AOP = [0, 3, 4, 7, 1, 2, 12, 14, 13, 15, 8, 10, 9, 11], SCR = [0, 0, 0];
  function blob(w, h) {
    const d = new Uint8ClampedArray(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = (i - (w - 1) / 2) / (w / 2), y = (j - (h - 1) / 2) / (h / 2), e = x * x + y * y;
      d[j * w + i] = e <= .45 ? 200 : e <= 1 ? 80 : 0;
    }
    return {d, w, h, r: null};
  }
  function contact(B, s) {
    const G = host.G; if (!G.ao || B.frozen) return;   // (frozen: the look test, beside a sprite that has none)
    const b = s * NP * 3, z = host.zoom;
    for (const i of AOP) {
      const k = b + i * 3, x = P[k], y = P[k + 1], zz = P[k + 2], up = y - RAD[i] - host.elev(x, zz);
      if (up > .12) continue;
      const S = i < 8 ? AO_BIG : AO_SMALL;
      if (!S.r || S.r.epoch !== G.aoEpoch) S.r = G.aoStamp(S.w, S.h, S.d);
      G.toScreenInto(x, y - RAD[i] - up, zz, SCR);
      G.ao(Math.round(SCR[0]) - (S.w >> 1) * z, Math.round(SCR[1]) - (S.h >> 1) * z, z, B.alpha * (1 - up / .12) * .9, S.r);
    }
  }
  // WARM (once a model has loaded: the first death then costs nothing extra; it was a 196 ms frame, then a 78 ms one): the
  // code paths run once on a hidden body (spawned, pushed, stepped, posed, freed: never drawn), the contact stamps made
  // (the stamp atlas uploads once), the rig's programs, target and textures (render/rigmesh.js warm)
  const WARMHIT = {x: 1, y: 1, h: 1.2, dx: 1, dy: 0, power: 20};
  async function warm(name) {
    const m = models[name], s = SL - 1, B = BODY[s]; if (!m) return;
    if (!B.on && spawn(s, name, {x: 1, y: 1, z: host.elev(1, 1), face: 0, pose: poseFor(m, 'gws_m22_3'), hit: WARMHIT})) {
      for (let i = 0; i < 40; i++) substep(B, s, 1 / T.sub);
      for (let f = 0; f < NF; f++) frameOf(s, f, FRM, f * 12, false);
      for (let i = 0; i < m.segBone.length; i++) compose(FRM, B.segFrame[i] * 12, OFF, (s * SEGMAX + i) * 12, MATS, i * 12);
      B.on = false;
    }
    const G = host.G;
    if (G.aoStamp) for (const S of [AO_BIG, AO_SMALL]) if (!S.r || S.r.epoch !== G.aoEpoch) S.r = G.aoStamp(S.w, S.h, S.d);
    await rig.warm();
  }
  const R = {
    load, warm, ready: name => !!models[name], spawn, push, step, frame, poseFor: (name, p) => models[name] && poseFor(models[name], p),
    alpha(s, a) { BODY[s].alpha = a; },
    free(s) { BODY[s].on = false; },
    body: s => BODY[s], onGround: null,
    get ms() { return ms; }, get msFrame() { return msF; }, get bytes() { return rig.bytes; }, get count() { let n = 0; for (const B of BODY) if (B.on) n++; return n; },
    get awake() { let n = 0; for (const B of BODY) if (B.on && !B.asleep) n++; return n; },
    point: (s, i, out) => { const b = s * NP * 3 + i * 3; out[0] = P[b]; out[1] = P[b + 1]; out[2] = P[b + 2]; return out; },
  };
  return R;
}
