// BRUTE 3D: the run's brutes (game/enemies.js brute / elite / champion) and the yard's sparring pair as a 3D figure, built
// in code (view/rigkit.js) and drawn live through render/rigmesh.js (features/brutes3d.js drives them): the same stuffed
// burlap brawler the biome's card painted (world/biomes.js brute(): a sack of a body, a small head pushed forward on
// hunched shoulders, button eyes and a stitched mouth, a belt, stumpy legs, long arms with big fists), now with a body
// that turns with its facing and the camera (no mirrored card) and moves:
//   idle      it breathes (2 steps a breath) with its arms hanging
//   crouch    the wind-up before a hop (combat's squash): knees and hips down, arms back; close to you (an ATTACK: its hop
//             lands in reach) both fists go up over its head instead
//   hop       legs tucked going up, reaching down coming down, one leg leading (the leading leg alternates hop to hop: a
//             lumbering stride); an attack's fists come down in the second half: the SLAM
//   land      the impact: a deep crouch (an attack's fists in the dirt: the strike)
//   hit       recoils from the blow (combat's wobble), away from where it came, the head snapping back
//   held      rooted (a trap) or roped (the lasso): it struggles, arms flailing; flung (the lasso's throw): curled up
//   death     view/ragdoll.js (features/brutes3d.js): the drawn pose thrown by the killing hit
// Every pose is a function of the state QUANTISED into a few steps (a crouch in 3 depths, a hop in 3 phases, a recoil in 2,
// the breath and the struggle at a few Hz): the pose key changes only when a step does, so the body re-poses in whole
// steps, as the sprites' frames do (the stepped-time knob of docs/exp/livehero.md), and holds in between.
// VARIANTS (size and colours; the aura ring and light are game/game.js's): brute; elite (bigger, its hide darkened toward
// red, iron shoulder pads); champion (bigger still, broad, dark, horns, a spiked collar and bracers). The biome gives the
// hide's ramp (style.brute) and its dressing (ruins: a red target patch, straw; ember: an iron plate; frost: fur and
// icicles; rift: crystals out of its back); its glowing eyes (ember, rift, elites, champions) are emissive points.
// API: bruteModel(style, variant) -> a rigkit model (+ .eyes, .glow); brutePose(M, st, W, turns) -> the pose key (W filled).
// OWNS: nothing (pure functions + the models it returns). READS: the biome's style. BUDGET: a pose ~.004 ms (FK of 19 bones).
import {rigKit, tint} from './rigkit.js';
import {axisAngle} from './livebody.js';

const DEG = Math.PI / 180;
export const VARIANTS = {brute: {s: [1.08, 1.08, 1.06]}, elite: {s: [1.24, 1.24, 1.13], tint: ['#7a2420', .3]}, champion: {s: [1.5, 1.5, 1.22], tint: ['#2e2238', .38]}};
const RED = ['#d8573e', '#a8342b', '#72222a', '#3e1420'], IRON = ['#9a9aa2', '#6e6e78', '#4c4c56', '#2a2a32'], BONE = ['#efe6d0', '#d2c6a8', '#a89a7c', '#665c48'];
const tones = r => r?.h || null;

// the figure, metres, Blender axes (x his left, y back, z up), the feet at the origin facing -y; s: the variant's [x, y, z] scale
export function bruteModel(S, variant = 'brute') {
  const VA = VARIANTS[variant] || VARIANTS.brute, [sx, sy, sz] = VA.s, P = (x, y, z) => [x * sx, y * sy, z * sz];
  let hide = tones(S.brute) || ['#bca985', '#9e8d6b', '#7d6f53', '#514836'];
  if (VA.tint) hide = tint(hide, VA.tint[0], VA.tint[1]);
  const belt = tones(S.id === 'ember' || !S.straw ? S.metal : S.straw) || IRON, K = rigKit();
  const raw = {raw: true};   // (the biome's ramps as painted: the card's colours)
  K.fam('hide', hide, raw).fam('belt', belt, raw).fam('dark', ['#4a3a34', '#2e2420', '#1e1816', '#120e0c'], raw);
  const L = (n, s) => (s < 0 ? 'Right' : 'Left') + n;
  // the skeleton: hunched (the spine leaning forward, the neck forward), long arms, short legs
  K.bone('Hips', null, P(0, .02, .54), P(0, 0, .70))
    .bone('Spine', 'Hips', P(0, 0, .70), P(0, -.02, .80))
    .bone('Spine1', 'Spine', P(0, -.02, .80), P(0, -.07, 1.0))
    .bone('Spine2', 'Spine1', P(0, -.07, 1.0), P(0, -.16, 1.19))
    .bone('Neck', 'Spine2', P(0, -.17, 1.18), P(0, -.27, 1.26))
    .bone('Head', 'Neck', P(0, -.27, 1.26), P(0, -.3, 1.5));
  for (const s of [1, -1]) {
    K.bone(L('Shoulder', s), 'Spine2', P(.08 * s, -.1, 1.14), P(.38 * s, -.1, 1.1))
      .bone(L('Arm', s), L('Shoulder', s), P(.38 * s, -.1, 1.1), P(.5 * s, -.15, .88))
      .bone(L('ForeArm', s), L('Arm', s), P(.5 * s, -.15, .88), P(.54 * s, -.24, .68))
      .bone(L('Hand', s), L('ForeArm', s), P(.54 * s, -.24, .68), P(.55 * s, -.27, .52))
      .bone(L('UpLeg', s), 'Hips', P(.18 * s, 0, .54), P(.2 * s, -.03, .3))
      .bone(L('Leg', s), L('UpLeg', s), P(.2 * s, -.03, .3), P(.2 * s, 0, .09))
      .bone(L('Foot', s), L('Leg', s), P(.2 * s, 0, .09), P(.2 * s, -.18, .03), {z: [0, 0, 1]});
  }
  const R3 = (x, y, z) => [x * sx, y * sy, z * sz];
  // the sack: belly, seat, the hump of the chest and back; a stitched seam down its front; the belt
  K.ball('Spine1', 'belly', 'hide', R3(.41, .35, .36), P(0, -.05, .84), {detail: 2})
    .ball('Hips', 'seat', 'hide', R3(.33, .28, .17), P(0, .02, .6), {detail: 1})
    .ball('Spine2', 'chest', 'hide', R3(.42, .32, .26), P(0, -.1, 1.06), {detail: 2})
    .ball('Spine2', 'hump', 'hide', R3(.32, .23, .2), P(0, .04, 1.12), {detail: 1, bias: .1})
    .tube('Hips', 'belt', 'belt', .39 * sx, .39 * sx, .075 * sz, P(0, -.03, .66), {sides: 12, bias: .1});
  for (let k = 0; k < 6; k++) K.box(k < 3 ? 'Spine1' : 'Spine2', 'seam', 'hide', R3(.022, .025, .028), P(-.03, -.4 + (k > 3 ? .02 : 0), .74 + k * .07), {fixed: 3, outline: false});   // the stitched seam (the card's dotted one)
  // the head, pushed forward: button eyes, a stitched mouth
  K.ball('Head', 'head', 'hide', R3(.17, .16, .16), P(0, -.31, 1.38), {detail: 2});
  for (const s of [1, -1]) {
    K.ball('Head', 'eye' + s, 'dark', R3(.034, .02, .036), P(.068 * s, -.455, 1.42), {fixed: 3, outline: false});
    K.mark('eye' + s, 'Head', P(.068 * s, -.48, 1.42));
  }
  K.box('Head', 'mouth', 'hide', R3(.12, .016, .018), P(0, -.462, 1.33), {fixed: 3, outline: false});
  // arms: a hump of a shoulder, a thick arm, a thicker forearm, a big fist; stumpy legs, flat feet
  for (const s of [1, -1]) {
    K.ball(L('Shoulder', s), 'shoulder' + s, 'hide', R3(.15, .14, .13), P(.32 * s, -.1, 1.11), {detail: 1})
      .limb(L('Arm', s), 'arm' + s, 'hide', .11 * sx, .1 * sx)
      .limb(L('ForeArm', s), 'fore' + s, 'hide', .115 * sx, .13 * sx)
      .ball(L('Hand', s), 'fist' + s, 'hide', R3(.145, .15, .15), K.at(L('Hand', s), .45), {detail: 1, bias: .05})
      .limb(L('UpLeg', s), 'thigh' + s, 'hide', .14 * sx, .12 * sx)
      .limb(L('Leg', s), 'shin' + s, 'hide', .12 * sx, .11 * sx, {ext: .05})
      .box(L('Foot', s), 'foot' + s, 'hide', R3(.16, .24, .09), P(.2 * s, -.08, .045), {bias: -.1});
  }
  // the biome's dressing
  const id = S.id, glow = [];
  if (id === 'ruins' || id === 'desert') {
    // the card's red target patch (a ring round a cloth centre) on the belly, facing forward (a disc along the body's y)
    K.fam('red', RED, raw).tube('Spine1', 'patch', 'red', .1 * sx, .1 * sx, .03, P(.1, -.375, .9), {rot: [Math.PI / 2 + .2, 0, 0], sides: 12, bias: .2})
      .fam('cloth', tones(S.cloth) || ['#bca985', '#9e8d6b', '#7d6f53', '#514836'], raw).tube('Spine1', 'patchc', 'cloth', .045 * sx, .045 * sx, .034, P(.1, -.38, .9), {rot: [Math.PI / 2 + .2, 0, 0], sides: 8, bias: .25});
    K.fam('straw', tones(S.straw) || ['#cdb577', '#ad935a', '#877043', '#594a2b'], raw);
    for (const [b, x, y, z, rx, rz] of [['Spine2', .2, -.02, 1.27, .3, -.5], ['Spine2', -.12, .05, 1.3, -.2, .6], ['Head', .07, -.24, 1.52, .4, -.3], ['LeftShoulder', .42, -.08, 1.2, 0, -1.1]])
      K.cone(b, 'straw', 'straw', .025 * sx, .12 * sz, P(x, y, z), {rot: [rx, 0, rz], sides: 4});
  }
  if (id === 'ember') {
    K.fam('metal', tones(S.metal) || IRON, raw).box('Spine1', 'plate', 'metal', R3(.28, .05, .24), P(0, -.355, .93), {rot: [-.15, 0, 0], bias: .2});
    glow.push('#ffb050');
  }
  if (id === 'frost') {
    K.fam('fur', tones(S.snow) || ['#e2e9f2', '#c8d3e2', '#a9b8ce', '#8191ae'], raw).fam('ice', tones(S.ice) || ['#cdeeff', '#9dd2ef', '#70a8d4', '#44709c'], raw);
    for (const [b, x, y, z] of [['Spine2', .22, .02, 1.24], ['Spine2', -.2, .04, 1.25], ['Spine2', 0, .12, 1.2], ['LeftShoulder', .34, -.1, 1.24], ['RightShoulder', -.34, -.1, 1.24]])
      K.ball(b, 'fur', 'fur', R3(.07, .06, .05), P(x, y, z), {detail: 0});
    for (const s of [1, -1]) K.cone(L('Hand', s), 'ice' + s, 'ice', .03 * sx, .12 * sz, P(.53 * s, -.3, .33), {rot: [Math.PI, 0, 0], sides: 4});
  }
  if (id === 'rift') {
    K.fam('gem', tones(S.gem) || ['#ffc6f2', '#ea7ee4', '#ad48bd', '#5c2474'], raw);
    for (const [x, y, z, rx, rz, h] of [[-.12, .14, 1.28, -.5, .35, .26], [.06, .17, 1.32, -.4, -.2, .32], [-.22, .1, 1.18, -.6, .7, .2], [.2, .12, 1.2, -.5, -.6, .18]])
      K.cone('Spine2', 'gem', 'gem', .05 * sx, h * sz, P(x, y, z), {rot: [rx, 0, rz], sides: 5, bias: .3});
    glow.push(S.rune || '#ff8ae8');
  }
  // the variants' gear
  if (variant !== 'brute') {
    K.fam('iron', IRON, raw);
    for (const s of [1, -1]) K.ball(L('Shoulder', s), 'pad' + s, 'iron', R3(.17, .15, .1), P(.32 * s, -.09, 1.2), {detail: 1, bias: .2});
  }
  if (variant === 'champion') {
    K.fam('bone', BONE, raw);
    for (const s of [1, -1]) {
      K.cone('Head', 'horn' + s, 'bone', .04 * sx, .2 * sz, P(.12 * s, -.28, 1.53), {rot: [-.2, 0, -.7 * s], sides: 5, bias: .2});
      K.tube(L('ForeArm', s), 'bracer' + s, 'iron', .125 * sx, .13 * sx, .12 * sz, K.at(L('ForeArm', s), .55), {rot: [0, 0, .12 * s], sides: 8, bias: .15});
      for (const k of [0, 1]) K.cone(L('Shoulder', s), 'spike' + s, 'iron', .03 * sx, .12 * sz, P((.3 + k * .1) * s, -.06 + k * .04, 1.3 - k * .03), {rot: [0, 0, -.35 * s - k * .3 * s], sides: 4});
    }
    K.tube('Neck', 'collar', 'iron', .17 * sx, .15 * sx, .07 * sz, P(0, -.18, 1.2), {rot: [.6, 0, 0], sides: 10, bias: .1});
  }
  if (variant !== 'brute' && !glow.length) glow.push(variant === 'champion' ? '#ffb040' : '#ff5a3a');
  const M = K.build(`brute:${id}:${variant}`);
  M.glow = glow[0] || null; M.eyes = [M.marks.eye1, M.marks['eye-1']]; M.variant = variant; M.scale = VA.s;
  M.B = {}; M.LR = {};
  for (const n of M.names) { M.B[n] = M.IX[n]; if (n.startsWith('Left')) M.LR[n.slice(4)] = [M.IX[n], M.IX['Right' + n.slice(4)]]; }
  return M;
}

// ---------------------------------------------------------------- the poses
// st: {mode: 'idle' | 'crouch' | 'air' | 'land' | 'held' | 'fling', c (crouch 0..1), u (hop 0..1), lead (1 | -1: the leading
// leg), attack (bool), hit (0..1), hitBack (bool: the blow from behind), t (s, the view's clock), seed (0..1)}
// bruteKey(st) -> the pose key (equal keys: the same pose); brutePose(M, st, W, T): W filled (body space; T: the turns' scratch)
const ROOT = [0, 0, 0], QS = {key: 0, c: 0, u: 0, breath: 0, flail: 0, hit: 0};
const q3 = v => v < .2 ? 0 : v < .6 ? 1 : 2, DEPTH = [0, .5, 1];
// (the turns go through these, not closures made per pose: no allocation)
let cM = null, cT = null;
const tn = (n, ax, a) => cM.turn(cT, cM.B[n], ax, a);
const S2 = (n, ax, aL, aR = aL) => { const p = cM.LR[n]; cM.turn(cT, p[0], ax, aL); cM.turn(cT, p[1], ax, aR); };   // (both sides: M.LR's indices)
function quant(st) {   // the state in whole steps
  let key = 0, c = 0, u = 0;
  const breath = Math.floor(st.t * 1.6 + st.seed * 2) & 1, flail = Math.floor(st.t * 5 + st.seed * 3) & 1, hit = st.hit > .55 ? 2 : st.hit > .2 ? 1 : 0;
  switch (st.mode) {
    case 'crouch': c = DEPTH[q3(st.c)]; key = 10 + q3(st.c) * 2 + (st.attack ? 1 : 0); break;
    case 'land': c = 1; key = 20 + (st.attack ? 1 : 0); break;
    case 'air': u = st.u < .4 ? 0 : st.u < .62 ? 1 : 2; key = 30 + u * 4 + (st.attack ? 1 : 0) + (st.lead > 0 ? 2 : 0); break;
    case 'held': key = 50 + flail; break;
    case 'fling': key = 60; break;
    default: key = breath;
  }
  QS.key = key * 8 + hit * 2 + (st.hitBack ? 1 : 0); QS.c = c; QS.u = u; QS.breath = breath; QS.flail = flail; QS.hit = hit;
  return QS;
}
export const bruteKey = st => quant(st).key;
export function brutePose(M, st, W, T) {
  cM = M; cT = T; M.reset(T);
  const {key, c, u, breath, flail, hit} = quant(st);
  // the base stance: arms a little forward and bent, a slight crouch
  S2('Arm', 0, 12 * DEG); S2('ForeArm', 0, 18 * DEG); S2('UpLeg', 0, 8 * DEG); S2('Leg', 0, -12 * DEG); S2('Foot', 0, 4 * DEG);
  ROOT[0] = ROOT[1] = 0; ROOT[2] = -.015 * M.scale[2];
  switch (st.mode) {
    case 'idle':
      if (breath) { tn('Spine2', 0, -3 * DEG); S2('Shoulder', 2, 4 * DEG, -4 * DEG); tn('Head', 0, 3 * DEG); }
      break;
    case 'crouch': case 'land': {
      const d = c;
      S2('UpLeg', 0, 38 * DEG * d); S2('Leg', 0, -62 * DEG * d); S2('Foot', 0, 26 * DEG * d); ROOT[2] -= .13 * d * M.scale[2];
      tn('Spine1', 0, 14 * DEG * d); tn('Spine2', 0, 10 * DEG * d);
      if (st.attack && st.mode === 'crouch') { S2('Arm', 0, 150 * DEG * d); S2('ForeArm', 0, 25 * DEG * d); tn('Head', 0, -18 * DEG * d); }   // the wind-up: fists over its head
      else if (st.attack) { S2('Arm', 0, 62 * DEG); S2('ForeArm', 0, 8 * DEG); tn('Spine1', 0, 18 * DEG); tn('Spine2', 0, 18 * DEG); }   // the strike: fists in the dirt
      else { S2('Arm', 0, -34 * DEG * d); S2('ForeArm', 0, 20 * DEG * d); }   // arms back to leap
      break;
    }
    case 'air': {
      const up = u === 0, top = u === 1, ld = st.lead;
      // legs: tucked going up, reaching down coming down; the leading leg forward
      const tuck = up ? 1 : top ? .7 : .25;
      tn('LeftUpLeg', 0, (45 * tuck + 22 * ld) * DEG); tn('RightUpLeg', 0, (45 * tuck - 22 * ld) * DEG);
      S2('Leg', 0, -70 * DEG * tuck); S2('Foot', 0, -10 * DEG);
      tn('Spine1', 0, (up ? 4 : 12) * DEG);
      if (st.attack) {
        if (up || top) { S2('Arm', 0, (up ? 155 : 165) * DEG); S2('ForeArm', 0, 22 * DEG); tn('Spine1', 0, -10 * DEG); tn('Head', 0, -14 * DEG); }
        else { S2('Arm', 0, 95 * DEG); S2('ForeArm', 0, 10 * DEG); tn('Spine2', 0, 18 * DEG); }   // the slam coming down
      } else { S2('Arm', 0, (up ? 48 : 26) * DEG, (up ? 48 : 26) * DEG); tn('LeftArm', 0, -16 * ld * DEG); tn('RightArm', 0, 16 * ld * DEG); }
      break;
    }
    case 'held':   // a trap or a rope: arms flailing, one up, one down, in turns
      tn('LeftArm', 0, (flail ? 130 : 40) * DEG); tn('RightArm', 0, (flail ? 40 : 130) * DEG); S2('ForeArm', 0, 30 * DEG);
      tn('Spine1', 2, (flail ? 6 : -6) * DEG); tn('Head', 0, -12 * DEG);
      break;
    case 'fling':   // thrown: curled up
      S2('UpLeg', 0, 80 * DEG); S2('Leg', 0, -100 * DEG); tn('Spine1', 0, 30 * DEG); tn('Spine2', 0, 20 * DEG); S2('Arm', 0, 70 * DEG); S2('ForeArm', 0, 60 * DEG);
      break;
  }
  if (hit) {   // the recoil: the body thrown back (forward if the blow came from behind), the head snapping, the arms flung out
    const k = hit === 2 ? 1 : .5, b = st.hitBack ? -1 : 1;
    tn('Spine1', 0, -14 * DEG * k * b); tn('Spine2', 0, -12 * DEG * k * b); tn('Neck', 0, -18 * DEG * k * b);
    tn('LeftShoulder', 2, -14 * DEG * k); tn('RightShoulder', 2, 14 * DEG * k); S2('Arm', 0, -18 * DEG * k);
  }
  M.pose(W, T, ROOT, null);
  return key;
}
export {axisAngle};
