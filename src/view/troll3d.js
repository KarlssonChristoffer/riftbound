// TROLL 3D: the forest's trolls (content/trolls.js; features/trolls/look.js drives them) as 3D figures built in code
// (view/rigkit.js) and drawn live through render/rigmesh.js, as the brutes are (view/brute3d.js: the same skeleton names, so
// view/ragdoll.js throws them when they fall):
//   big     the BERGTROLL (~2.6 m), John Bauer's: a mossy hill of a body hunched over, a long drooping nose over a mossy
//           beard, small deep-set glowing eyes under a heavy brow, shaggy hair, moss on the hump and the shoulders and a pine
//           sapling growing out of its back; arms to its knees with big hands, short thick legs, big flat feet, a tufted tail
//           and a knotted PINE CLUB in its right hand (the GunHold0 bone: the ragdoll tosses it loose as a gunman's gun);
//           a ROCK over its head (its own segment, drawn only while it lifts one: the boulder's wind-up)
//   small   the PYSSLING (~.95 m): a round belly on skinny legs, huge ears, a long thin nose, a wide grin, scruffy hair, a
//           tufted tail, yellow glowing eyes; a PINECONE in its right hand (GunHold0, drawn only while it holds one)
//   looks   'flesh' (PALETTE.hide / smallHide) or 'stone' (the same figure in PALETTE.stone greys, the moss kept a little and
//           the sapling still green: the statue a big troll is by day; the look swaps it in at stone >= .5)
//   rock    the thrown boulder (trollRock: one bone, a lumpy stone, ~.5 m), tumbling (rockPose: a turn about its own axis)
// THE POSES (st.mode = the sim's state; anything else is idle, or a walk when it moves), each in whole STEPS: the pose key
// changes only when a step does, so a body re-poses in whole steps and holds in between (as brute3d.js):
//   idle (breathing, 2 steps)  walk / run (a stride cycle from st.gait, the metres walked: big 6 steps a 2.8 m cycle, a 4.2 m
//   run; small a 4-step scamper)  roar (big: arms wide, head back, the jaw open, shaking)  wind (st.atk's wind-up in 3 steps
//   by st.u: slam = the club high over its head, both hands; sweep = the club drawn far back to its right; boulder =
//   crouched hands to the ground, then the rock lifted overhead; stomp = a foot raised high; bite = crouched low and
//   coiled; cone = the arm cocked back)  strike (2 steps: slam = the club down on the ground ahead; sweep = swung through
//   to its left; boulder = thrown; stomp = the foot down; bite = a lunge, the mouth wide, then the chomp; cone = the arm
//   thrown forward)  recover (slam: bent over, the club stuck in the ground, tugging, then pulled free; the rest ease back
//   in 3 steps)  stagger (big: reeling back, knees buckling, a hand to its head; small: tumbling over backward)  flee (small:
//   running, arms flung up)  peek (crouched, leaning out sideways and back)  hide (crouched small, hands over its eyes,
//   shivering)  laugh (bent back with a hand on its belly, pointing; then doubled over: 2 steps)  ride (sitting, legs apart,
//   an arm up waving: st.ride)  stone / freezing / waking (big: crouched, an arm over its eyes against the sun; blended in
//   3 steps by st.stone; waking shakes)  + the hit flinch from st.hit (0..1), away from the blow (st.hitBack), as a brute's.
// The legs keep a foot on the ground (the root drops by the longer leg's bend); the feet stay flat.
// API: trollModel(type, look) -> a rigkit model (+ .type, .look, .eyes, .glow, .seat (big: the rider's seat mark), .propSeg,
//   .hideProp (o.hide with the prop drawn as nothing), .attach (the ragdoll's: the jaw on the head, the tail on the hips),
//   .mass); trollKey(st) -> the pose key (bit 0: the prop (rock / pinecone) shows); trollPose(M, st, W, T) -> the key, W
//   filled (body space; T the turns' scratch). trollRock() -> the boulder's model; rockPose(M, a, W, T): tumbled by a rad.
//   st: {type, mode, atk, u (0..1 through the state), gait (m), hit (0..1), hitBack, stone (0..1), hold, ride, seed, t (s)}
//   (the small one has one look: its 'stone' is its flesh)
// OWNS: nothing (pure functions + the models it returns). READS: content/trolls.js PALETTE. BUDGET: a pose ~.003 ms (FK of
//   23-24 bones), no allocation of its own; a model built once per type and look (big: 22 segments, ~9.3k corners).
import {rigKit, tint} from './rigkit.js';
import {axisAngle} from './livebody.js';
import {PALETTE} from '../content/trolls.js';

const DEG = Math.PI / 180;
const DARK = ['#4a3a30', '#2c221c', '#1c1612', '#0e0a08'], BONE = ['#f2ead2', '#d6caa8', '#aa9c7a', '#5e5440'];
const PINE = ['#6e9a52', '#4a7438', '#30542a', '#1a3218'];
const glowRamp = c => ['#fff0c0', c, tint([c], '#000000', .35)[0], '#3a1c08'];
const raw = {raw: true};

// ---------------------------------------------------------------- the big one
function bigModel(look) {
  const stone = look === 'stone', St = PALETTE.stone, K = rigKit();
  K.fam('hide', stone ? St : PALETTE.hide, raw)
    .fam('moss', stone ? tint(PALETTE.moss, St[1], .55) : PALETTE.moss, raw)
    .fam('wood', stone ? tint(PALETTE.wood, St[2], .6) : PALETTE.wood, raw)
    .fam('hair', stone ? tint(PALETTE.hair, St[1], .45) : PALETTE.hair, raw)
    .fam('dark', stone ? tint(DARK, St[3], .5) : DARK, raw)
    .fam('bone', stone ? tint(BONE, St[1], .6) : BONE, raw)
    .fam('eye', stone ? tint(DARK, St[3], .5) : glowRamp(PALETTE.eyeNight), raw)
    .fam('pine', PINE, raw).fam('rock', St, raw);
  const L = (n, s) => (s < 0 ? 'Right' : 'Left') + n;
  // the skeleton: a deep hunch (the chest far forward, the head hung low in front of the hump), long arms, short legs
  K.bone('Hips', null, [0, .06, .84], [0, .02, 1.06])
    .bone('Spine', 'Hips', [0, .02, 1.06], [0, -.02, 1.26])
    .bone('Spine1', 'Spine', [0, -.02, 1.26], [0, -.14, 1.6])
    .bone('Spine2', 'Spine1', [0, -.14, 1.6], [0, -.36, 1.94])
    .bone('Neck', 'Spine2', [0, -.38, 1.92], [0, -.6, 2.0])
    .bone('Head', 'Neck', [0, -.6, 2.0], [0, -.66, 2.38])
    .bone('Jaw', 'Head', [0, -.64, 1.98], [0, -.92, 1.9])
    .bone('Tail', 'Hips', [0, .3, .9], [0, .86, .3])
    .bone('Rock', 'Spine2', [0, -.5, 2.84], [0, -.5, 3.04]);
  for (const s of [1, -1]) {
    K.bone(L('Shoulder', s), 'Spine2', [.14 * s, -.3, 1.84], [.6 * s, -.3, 1.8])
      .bone(L('Arm', s), L('Shoulder', s), [.6 * s, -.3, 1.8], [.76 * s, -.36, 1.32])
      .bone(L('ForeArm', s), L('Arm', s), [.76 * s, -.36, 1.32], [.82 * s, -.48, .84])
      .bone(L('Hand', s), L('ForeArm', s), [.82 * s, -.48, .84], [.84 * s, -.53, .58])
      .bone(L('UpLeg', s), 'Hips', [.3 * s, .04, .84], [.33 * s, -.02, .46])
      .bone(L('Leg', s), L('UpLeg', s), [.33 * s, -.02, .46], [.34 * s, .0, .13])
      .bone(L('Foot', s), L('Leg', s), [.34 * s, 0, .13], [.36 * s, -.34, .04], {z: [0, 0, 1]});
  }
  K.bone('GunHold0', 'RightHand', [-.84, -.56, .68], [-.95, -1.5, .14]);   // the club: grip in the fist, the thick end on the ground ahead
  // the body: the seat, a huge belly, the chest, the hump; a skirt of hair round the hips
  K.ball('Hips', 'seat', 'hide', [.42, .36, .3], [0, .06, .94], {detail: 1})
    .ball('Spine1', 'belly', 'hide', [.52, .46, .5], [0, -.14, 1.3], {detail: 2})
    .ball('Spine2', 'chest', 'hide', [.56, .44, .4], [0, -.24, 1.74], {detail: 2})
    .ball('Spine2', 'hump', 'hide', [.46, .38, .36], [0, -.02, 1.9], {detail: 1, bias: .1})
    .tube('Hips', 'skirt', 'hair', .5, .44, .2, [0, .0, .98], {sides: 10, bias: -.1});
  for (let k = 0; k < 7; k++) { const a = (k / 7 - .5) * 2.6; K.cone('Hips', 'fringe', 'hair', .06, .2, [Math.sin(a) * .44, -Math.cos(a) * .4 + .02, .82], {rot: [Math.PI + Math.cos(a) * .35, 0, 0], sides: 4}); }
  // moss: a cap over the hump, patches down the back, tufts; the sapling out of its back
  K.ball('Spine2', 'mossy', 'moss', [.36, .3, .16], [0, .0, 2.16], {detail: 1, bias: .15})
    .ball('Spine1', 'mossb', 'moss', [.3, .2, .2], [0, .22, 1.52], {detail: 1})
    .ball('Spine1', 'mossc', 'moss', [.14, .12, .12], [.3, .1, 1.38], {detail: 0});
  for (const [x, y, z, rx, rz] of [[.2, .06, 2.2, -.3, -.5], [-.24, .02, 2.18, -.2, .6], [.04, .2, 2.12, -.9, .1], [-.1, -.14, 2.16, .4, .3], [.28, -.1, 2.08, .2, -.8]])
    K.cone('Spine2', 'tuft', 'moss', .06, .2, [x, y, z], {rot: [rx, 0, rz], sides: 4});
  K.tube('Spine2', 'trunk', 'wood', .035, .025, .5, [.14, .06, 2.38], {rot: [-.15, 0, -.12], sides: 5})
    .cone('Spine2', 'pine1', 'pine', .19, .3, [.16, .08, 2.46], {sides: 6, bias: .05})
    .cone('Spine2', 'pine2', 'pine', .14, .26, [.17, .1, 2.6], {sides: 6, bias: .12})
    .cone('Spine2', 'pine3', 'pine', .08, .2, [.18, .11, 2.73], {sides: 5, bias: .2});
  // the head, hung forward: shaggy hair, a heavy brow, small sunken eyes, the long drooping nose, ears, a mossy beard on the jaw
  K.ball('Head', 'head', 'hide', [.3, .3, .28], [0, -.72, 2.12], {detail: 2});
  for (const [x, y, z, rx, rz, h] of [[0, -.66, 2.38, -.2, 0, .26], [.14, -.62, 2.34, -.3, -.6, .22], [-.14, -.62, 2.34, -.3, .6, .22], [.06, -.5, 2.32, -1, -.3, .24], [-.08, -.5, 2.3, -1.1, .3, .22], [.22, -.66, 2.24, 0, -1.2, .2], [-.22, -.66, 2.24, 0, 1.2, .2]])
    K.cone('Head', 'hair', 'hair', .07, h, [x, y, z], {rot: [rx, 0, rz], sides: 4});
  K.box('Head', 'brow', 'hide', [.46, .12, .1], [0, -.94, 2.22], {rot: [-.25, 0, 0], bias: .12});
  for (const s of [1, -1]) {
    K.ball('Head', 'socket' + s, 'dark', [.06, .03, .045], [.1 * s, -.97, 2.13], {fixed: 2, outline: false})
      .ball('Head', 'eye' + s, 'eye', [.032, .02, .028], [.1 * s, -.99, 2.13], {fixed: 1, outline: false, lines: false});
    K.mark('eye' + s, 'Head', [.1 * s, -1.02, 2.13]);
    K.ball('Head', 'ear' + s, 'hide', [.06, .14, .11], [.29 * s, -.66, 2.14], {rot: [0, 0, .5 * s], detail: 1});
  }
  K.tube('Head', 'nose', 'hide', .1, .065, .42, [0, -1.08, 1.94], {rot: [148 * DEG, 0, 0], sides: 8, bias: .1})
    .ball('Head', 'nosetip', 'hide', [.085, .08, .09], [0, -1.17, 1.77], {detail: 1, bias: .15})
    .box('Head', 'mouth', 'dark', [.26, .04, .05], [0, -.94, 1.98], {fixed: 3, outline: false});
  K.ball('Jaw', 'jaw', 'hide', [.22, .16, .1], [0, -.84, 1.92], {detail: 1})
    .cone('Jaw', 'beard', 'moss', .12, .3, [0, -.86, 1.76], {rot: [Math.PI - .2, 0, 0], sides: 6})
    .cone('Jaw', 'beard2', 'moss', .06, .2, [.1, -.82, 1.8], {rot: [Math.PI, 0, .3], sides: 4});
  for (const s of [1, -1]) K.cone('Jaw', 'tooth' + s, 'bone', .025, .09, [.09 * s, -.97, 1.99], {rot: [-.2, 0, 0], sides: 4, outline: false});
  // arms: a mossy hump of a shoulder, long thick arms, big hands with fat fingers; short thick legs, big flat feet, toes
  for (const s of [1, -1]) {
    K.ball(L('Shoulder', s), 'shoulder' + s, 'hide', [.26, .24, .24], [.52 * s, -.3, 1.82], {detail: 1})
      .ball(L('Shoulder', s), 'smoss' + s, 'moss', [.2, .18, .1], [.52 * s, -.28, 2.02], {detail: 1, bias: .15})
      .limb(L('Arm', s), 'arm' + s, 'hide', .16, .14)
      .limb(L('ForeArm', s), 'fore' + s, 'hide', .15, .17)
      .ball(L('Hand', s), 'hand' + s, 'hide', [.17, .15, .19], K.at(L('Hand', s), .4), {detail: 1, bias: .05});
    for (const k of [-1, 0, 1]) K.cone(L('Hand', s), 'finger' + s, 'hide', .05, .16, [.84 * s + k * .07, -.55 - Math.abs(k) * .02, .5], {rot: [Math.PI - .15, 0, 0], sides: 5});
    K.cone(L('Hand', s), 'thumb' + s, 'hide', .045, .13, [.76 * s, -.62, .62], {rot: [Math.PI / 2 + .6, 0, .5 * s], sides: 5})
      .limb(L('UpLeg', s), 'thigh' + s, 'hide', .21, .18)
      .limb(L('Leg', s), 'shin' + s, 'hide', .18, .16, {ext: .05})
      .box(L('Foot', s), 'foot' + s, 'hide', [.3, .48, .13], [.35 * s, -.12, .065], {bias: -.1});
    for (const k of [-1, 0, 1]) K.ball(L('Foot', s), 'toe' + s, 'hide', [.065, .07, .06], [.35 * s + k * .09, -.37, .06], {detail: 0});
  }
  // the tail with its tuft; the club: a knotted log, thin at the grip, a branch stub, moss on its end; the rock (lifted)
  K.limb('Tail', 'tail', 'hide', .08, .045)
    .ball('Tail', 'tuft', 'hair', [.12, .14, .13], [0, .88, .28], {detail: 1})
    .cone('Tail', 'tuft2', 'hair', .06, .2, [0, .98, .22], {rot: [-1.9, 0, 0], sides: 4});
  K.limb('GunHold0', 'club', 'wood', .065, .15, {ext: .08, sides: 7})
    .ball('GunHold0', 'knot1', 'wood', [.07, .07, .07], K.at('GunHold0', .45, [.09, 0, .02]), {detail: 0, bias: .1})
    .ball('GunHold0', 'knot2', 'wood', [.09, .08, .08], K.at('GunHold0', .75, [-.12, .02, .04]), {detail: 0, bias: .1})
    .cone('GunHold0', 'stub', 'wood', .04, .18, K.at('GunHold0', .6, [.12, 0, .1]), {rot: [-.6, 0, -1.1], sides: 4})
    .ball('GunHold0', 'clubmoss', 'moss', [.13, .12, .08], K.at('GunHold0', .92, [0, 0, .1]), {detail: 0, bias: .1});
  K.ball('Rock', 'rock', 'rock', [.3, .26, .25], [0, -.5, 2.84], {detail: 0, flat: true})
    .ball('Rock', 'rock2', 'rock', [.18, .16, .16], [.14, -.44, 2.94], {detail: 0, flat: true, bias: .1})
    .ball('Rock', 'rock3', 'moss', [.14, .1, .06], [-.08, -.48, 3.06], {detail: 0, bias: .1});
  K.mark('seat', 'RightShoulder', [-.52, -.26, 2.1]);   // where a small one rides (its seat on the moss)
  return finish(K, 'big', look, stone ? null : PALETTE.eyeNight, 'Rock');
}

// ---------------------------------------------------------------- the small one
function smallModel(look) {
  const K = rigKit();
  K.fam('hide', PALETTE.smallHide, raw).fam('hair', PALETTE.hair, raw).fam('dark', DARK, raw).fam('bone', BONE, raw)
    .fam('eye', glowRamp(PALETTE.eye), raw).fam('moss', PALETTE.moss, raw).fam('wood', PALETTE.wood, raw);
  const L = (n, s) => (s < 0 ? 'Right' : 'Left') + n;
  K.bone('Hips', null, [0, .02, .3], [0, 0, .38])
    .bone('Spine', 'Hips', [0, 0, .38], [0, -.01, .44])
    .bone('Spine1', 'Spine', [0, -.01, .44], [0, -.02, .56])
    .bone('Spine2', 'Spine1', [0, -.02, .56], [0, -.04, .66])
    .bone('Neck', 'Spine2', [0, -.04, .66], [0, -.06, .7])
    .bone('Head', 'Neck', [0, -.06, .7], [0, -.07, .92])
    .bone('Jaw', 'Head', [0, -.08, .73], [0, -.2, .7])
    .bone('Tail', 'Hips', [0, .08, .32], [0, .3, .16]);
  for (const s of [1, -1]) {
    K.bone(L('Shoulder', s), 'Spine2', [.04 * s, -.03, .63], [.12 * s, -.03, .62])
      .bone(L('Arm', s), L('Shoulder', s), [.12 * s, -.03, .62], [.15 * s, -.04, .48])
      .bone(L('ForeArm', s), L('Arm', s), [.15 * s, -.04, .48], [.16 * s, -.07, .35])
      .bone(L('Hand', s), L('ForeArm', s), [.16 * s, -.07, .35], [.165 * s, -.08, .29])
      .bone(L('UpLeg', s), 'Hips', [.07 * s, .01, .3], [.08 * s, -.01, .17])
      .bone(L('Leg', s), L('UpLeg', s), [.08 * s, -.01, .17], [.08 * s, .01, .05])
      .bone(L('Foot', s), L('Leg', s), [.08 * s, .01, .05], [.085 * s, -.11, .02], {z: [0, 0, 1]});
  }
  K.bone('GunHold0', 'RightHand', [-.165, -.09, .3], [-.165, -.15, .3]);   // the pinecone
  // the body: a big round belly on a small seat, a narrow chest; a skirt of moss
  K.ball('Hips', 'seat', 'hide', [.12, .1, .08], [0, .02, .32], {detail: 1})
    .ball('Spine1', 'belly', 'hide', [.17, .16, .16], [0, -.05, .47], {detail: 2, bias: .08})
    .ball('Spine2', 'chest', 'hide', [.12, .1, .09], [0, -.02, .61], {detail: 1})
    .tube('Hips', 'skirt', 'moss', .13, .12, .06, [0, .0, .33], {sides: 8, bias: -.05});
  // the head: scruffy hair, huge ears, the eyes, a long thin nose, the wide grin (teeth), the jaw
  K.ball('Head', 'head', 'hide', [.14, .13, .13], [0, -.08, .79], {detail: 2});
  for (const [x, y, z, rx, rz, h] of [[0, -.06, .91, -.2, 0, .1], [.06, -.04, .9, -.4, -.6, .09], [-.06, -.04, .9, -.4, .6, .09], [.02, .02, .88, -1.1, -.2, .1], [-.03, .03, .87, -1.2, .3, .09]])
    K.cone('Head', 'hair', 'hair', .03, h, [x, y, z], {rot: [rx, 0, rz], sides: 4});
  for (const s of [1, -1]) {
    K.ball('Head', 'ear' + s, 'hide', [.13, .022, .065], [.2 * s, -.05, .83], {rot: [0, -.45 * s, 0], detail: 1})
      .ball('Head', 'earin' + s, 'hide', [.08, .012, .035], [.2 * s, -.072, .83], {rot: [0, -.45 * s, 0], detail: 0, bias: -.35, outline: false})
      .ball('Head', 'eye' + s, 'eye', [.03, .02, .028], [.055 * s, -.19, .83], {fixed: 1, outline: false, lines: false})
      .box('Head', 'brow' + s, 'hair', [.06, .02, .014], [.055 * s, -.19, .868], {rot: [0, .35 * s, 0], outline: false});
    K.mark('eye' + s, 'Head', [.055 * s, -.215, .83]);
    K.box('Head', 'grinc' + s, 'dark', [.04, .02, .016], [.085 * s, -.17, .736], {rot: [0, .55 * s, 0], fixed: 3, outline: false});
  }
  K.tube('Head', 'nose', 'hide', .028, .016, .17, [0, -.25, .775], {rot: [106 * DEG, 0, 0], sides: 6, bias: .1})
    .ball('Head', 'nosetip', 'hide', [.024, .024, .024], [0, -.33, .755], {detail: 0, bias: .15})
    .box('Head', 'mouth', 'dark', [.14, .02, .024], [0, -.185, .722], {fixed: 3, outline: false});
  for (let k = 0; k < 4; k++) K.box('Head', 'teeth', 'bone', [.022, .012, .016], [-.05 + k * .033, -.198, .728], {fixed: 0, outline: false, lines: false});
  K.ball('Jaw', 'jaw', 'hide', [.09, .07, .035], [0, -.14, .695], {detail: 1});
  // skinny arms with claws, skinny legs, big feet; the tail and its tuft; the pinecone
  for (const s of [1, -1]) {
    K.ball(L('Shoulder', s), 'shoulder' + s, 'hide', [.045, .045, .045], [.11 * s, -.03, .62], {detail: 0})
      .limb(L('Arm', s), 'arm' + s, 'hide', .026, .022)
      .limb(L('ForeArm', s), 'fore' + s, 'hide', .022, .026)
      .ball(L('Hand', s), 'hand' + s, 'hide', [.04, .035, .045], K.at(L('Hand', s), .4), {detail: 0});
    for (const k of [-1, 1]) K.cone(L('Hand', s), 'claw' + s, 'bone', .01, .04, [.165 * s + k * .018, -.09, .265], {rot: [Math.PI - .2, 0, 0], sides: 3, outline: false});
    K.limb(L('UpLeg', s), 'thigh' + s, 'hide', .036, .028)
      .limb(L('Leg', s), 'shin' + s, 'hide', .028, .024, {ext: .05})
      .box(L('Foot', s), 'foot' + s, 'hide', [.07, .14, .04], [.082 * s, -.04, .02], {bias: -.1});
  }
  K.limb('Tail', 'tail', 'hide', .018, .012)
    .ball('Tail', 'tuft', 'hair', [.04, .05, .05], [0, .31, .16], {detail: 0});
  K.ball('GunHold0', 'cone', 'wood', [.04, .055, .04], [-.165, -.12, .3], {detail: 0, flat: true, bias: .05})
    .cone('GunHold0', 'scale', 'wood', .02, .04, [-.14, -.12, .32], {rot: [0, 1, 0], sides: 3});
  return finish(K, 'small', look, PALETTE.eye, 'GunHold0');
}

function finish(K, type, look, glow, prop) {
  const M = K.build(`troll:${type}:${look}`);
  M.type = type; M.look = look; M.glow = glow; M.eyes = [M.marks.eye1, M.marks['eye-1']]; M.seat = M.marks.seat || null;
  M.B = {}; M.LR = {};
  for (const n of M.names) { M.B[n] = M.IX[n]; if (n.startsWith('Left')) M.LR[n.slice(4)] = [M.IX[n], M.IX['Right' + n.slice(4)]]; }
  const len = n => { const B = M.J.bones[n]; return Math.hypot(B.tail[0] - B.head[0], B.tail[1] - B.head[1], B.tail[2] - B.head[2]); };
  M.L1 = len('LeftUpLeg'); M.L2 = len('LeftLeg');
  M.propSeg = M.J.segs.findIndex(s => s.bone === prop);
  M.hideProp = new Uint8Array(M.J.segs.length); if (M.propSeg >= 0) M.hideProp[M.propSeg] = 1;
  M.attach = {Jaw: 'Head', Tail: 'Hips'};
  return M;
}

export function trollModel(type, look = 'flesh') { return type === 'big' ? bigModel(look) : smallModel(look); }

// the boulder: one bone through its middle (the origin: the anchor is its centre), lumps on a lump
export function trollRock() {
  const K = rigKit();
  K.fam('rock', PALETTE.stone, raw).fam('moss', PALETTE.moss, raw);
  K.bone('Hips', null, [0, 0, 0], [0, 0, .2]);
  K.ball('Hips', 'rock', 'rock', [.27, .24, .22], [0, 0, 0], {detail: 0, flat: true})
    .ball('Hips', 'rock2', 'rock', [.16, .15, .14], [.13, .06, .09], {detail: 0, flat: true, bias: .1})
    .ball('Hips', 'rock3', 'rock', [.13, .12, .12], [-.12, -.08, -.07], {detail: 0, flat: true, bias: -.05})
    .ball('Hips', 'moss', 'moss', [.12, .1, .05], [-.04, .02, .2], {detail: 0, bias: .1});
  const M = K.build('troll:rock'); M.type = 'rock';
  return M;
}
const RQR = new Float64Array(4);
export function rockPose(M, a, W, T) { M.reset(T); axisAngle(1, 0, 0, a, RQR); M.pose(W, T, null, RQR); return W; }

// ---------------------------------------------------------------- the poses
const MODES = {idle: 0, walk: 1, run: 2, roar: 3, wind: 4, strike: 5, recover: 6, stagger: 7, flee: 8, peek: 9, hide: 10, laugh: 11, ride: 12, stone: 13, freezing: 13, waking: 13};
const ATKS = {slam: 1, sweep: 2, boulder: 3, stomp: 4, bite: 5, cone: 6};
const QS = {key: 0, mi: 0, ai: 0, sub: 0, hit: 0, prop: 0, N: 1};
const c01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
function quant(st) {   // the state in whole steps
  const big = st.type === 'big', t = st.t || 0, sd = st.seed || 0, u = c01(st.u || 0);
  let mi = st.ride ? 12 : MODES[st.mode] ?? 0, ai = ATKS[st.atk] || 0, sub = 0, N = 1;
  switch (mi) {
    case 0: sub = Math.floor(t * (big ? .8 : 1.7) + sd * 2) & 1; break;
    case 1: case 2: case 8: {   // the stride: a phase of the cycle from the metres walked
      N = big ? 6 : 4; const cyc = big ? (mi === 1 ? 2.8 : 4.2) : (mi === 1 ? .7 : 1.15);
      sub = Math.floor(((st.gait || 0) / cyc + sd) * N) % N; if (sub < 0) sub += N; break;
    }
    case 3: sub = u < .18 ? 0 : 1 + (Math.floor(t * 7) & 1); break;
    case 4: sub = u < .3 ? 0 : u < .65 ? 1 : 2; break;
    case 5: sub = u < .5 ? 0 : 1; break;
    case 6: sub = ai === 1 ? (u > .78 ? 2 : Math.floor(t * 3.2) & 1) : u < .34 ? 0 : u < .67 ? 1 : 2; break;
    case 7: sub = Math.floor(t * 3.5 + sd * 2) & 1; break;
    case 9: sub = Math.floor(t * .7 + sd * 2) & 1; break;
    case 10: sub = Math.floor(t * 2.5) & 1; break;
    case 11: sub = Math.floor(t * 5) & 1; break;
    case 12: sub = Math.floor(t * 1.4 + sd * 2) & 1; break;
    case 13: { const q = st.mode === 'stone' ? 3 : Math.min(3, Math.max(0, Math.round((st.stone || 0) * 3))); sub = q * 2 + (st.mode === 'waking' && q > 0 && q < 3 ? Math.floor(t * 9) & 1 : 0); break; }
  }
  if (mi !== 4 && mi !== 5 && mi !== 6) ai = 0;
  const prop = big ? (mi === 4 && ai === 3 && sub >= 1 ? 1 : 0) : (st.hold || ((mi === 4 || (mi === 5 && sub === 0)) && ai === 6) ? 1 : 0);
  const stoneStill = mi === 13 && sub >= 4;   // (stone: no flinch)
  const hit = stoneStill ? 0 : st.hit > .55 ? 2 : st.hit > .2 ? 1 : 0;
  QS.key = ((((((mi * 8 + ai) * 16 + sub) * 3 + hit) * 2 + (hit && st.hitBack ? 1 : 0)) * 2 + (big ? 1 : 0)) * 2) + prop;   // (bit 0: the prop shows; the look's hide array)
  QS.mi = mi; QS.ai = ai; QS.sub = sub; QS.hit = hit; QS.prop = prop; QS.N = N;
  return QS;
}
export const trollKey = st => quant(st).key;

// (the turns go through these, not closures made per pose: no allocation)
let cM = null, cT = null, big = false;
const ROOT = [0, 0, 0], RQ = new Float64Array(4);
const tn = (n, ax, a) => { const b = cM.B[n]; if (b !== undefined) cM.turn(cT, b, ax, a); };
const S2 = (n, ax, aL, aR = aL) => { const p = cM.LR[n]; cM.turn(cT, p[0], ax, aL); cM.turn(cT, p[1], ax, aR); };
// the legs (deg: the thigh forward, the knee bent back as a negative), the feet kept flat, the root dropped so the longer
// leg's foot stays on the ground
function legs(aL, kL, aR = aL, kR = kL) {
  tn('LeftUpLeg', 0, aL * DEG); tn('LeftLeg', 0, kL * DEG); tn('LeftFoot', 0, -(aL + kL) * DEG);
  tn('RightUpLeg', 0, aR * DEG); tn('RightLeg', 0, kR * DEG); tn('RightFoot', 0, -(aR + kR) * DEG);
  const dL = cM.L1 * (1 - Math.cos(aL * DEG)) + cM.L2 * (1 - Math.cos((aL + kL) * DEG)), dR = cM.L1 * (1 - Math.cos(aR * DEG)) + cM.L2 * (1 - Math.cos((aR + kR) * DEG));
  ROOT[2] -= Math.min(dL, dR);
}
const D = a => a * DEG;
// arms: pitch (forward / up +), roll (outward +), the forearm's bend
function arm(side, p, r = 0, f = 0) {
  const s = side > 0; tn(s ? 'LeftArm' : 'RightArm', 0, D(p)); tn(s ? 'LeftArm' : 'RightArm', 2, D(s ? r : -r)); tn(s ? 'LeftForeArm' : 'RightForeArm', 0, D(f));
}
const spine = (p1, p2 = p1, roll = 0, twist = 0) => { tn('Spine1', 0, D(p1)); tn('Spine2', 0, D(p2)); if (roll) tn('Spine', 2, D(roll)); if (twist) { tn('Spine1', 1, D(twist * .5)); tn('Spine2', 1, D(twist * .5)); } };
const head = (p, roll = 0, twist = 0) => { tn('Head', 0, D(p)); if (roll) tn('Head', 2, D(roll)); if (twist) tn('Head', 1, D(twist)); };
const jaw = a => tn('Jaw', 0, D(-a));   // (a: how far open, deg)
const club = a => tn('RightHand', 0, D(a));   // the wrist: the club's (the pinecone's) angle

function walk(sub, N, run) {
  const th = sub / N * Math.PI * 2, s = Math.sin(th), c = Math.cos(th);
  const A = big ? (run ? 34 : 24) : (run ? 46 : 32), KN = big ? (run ? 70 : 42) : (run ? 85 : 55), lean = big ? (run ? 16 : 6) : (run ? 18 : 4);
  legs(6 + A * s, -(8 + KN * Math.max(0, c)), 6 - A * s, -(8 + KN * Math.max(0, -c)));
  spine(lean * .6, lean * .4, (big ? 5 : 6) * s, (big ? 10 : 14) * s);
  head(-lean * .7, -(big ? 3 : 4) * s);
  const sw = big ? (run ? 32 : 20) : (run ? 45 : 30);
  arm(1, 10 - sw * s, 4, run ? (big ? 30 : 75) : 15);
  arm(-1, 10 + (big ? sw * .5 : sw) * s, 4, run ? (big ? 25 : 75) : 15);
  if (big) tn('Tail', 2, D(10 * s));
  else tn('Tail', 0, D(run ? -30 : -12));
}
// strike / its easing back (k: 1 the blow .. 0 standing)
function strike(ai, k, sub) {
  switch (ai) {
    case 1:   // slam: the club down on the ground ahead, bent over it
      legs(32 * k, -55 * k); spine((24 + sub * 6) * k, (20 + sub * 4) * k); head(-14 * k);
      arm(-1, 80 * k, -6 * k, 4 * k); arm(1, 72 * k, -14 * k, 10 * k); club(-58 * k); break;
    case 2:   // sweep: swung through to its left
      legs(14 * k, -26 * k); tn('LeftUpLeg', 2, D(10 * k)); tn('RightUpLeg', 2, D(-10 * k));
      spine(8 * k, 8 * k, -4 * k, (54 + sub * 16) * k); head(-4 * k, 0, -30 * k);
      arm(-1, 78 * k, -48 * k, 8 * k); arm(1, -18 * k, 26 * k, 20 * k); club(-50 * k); break;
    case 3:   // boulder: thrown, arms flung forward
      legs(26 * k, -22 * k, -16 * k, -12 * k); spine(20 * k, 14 * k); head(-8 * k);
      arm(1, 112 * k, -8 * k, 8 * k); arm(-1, 112 * k, -8 * k, 8 * k); break;
    case 4:   // stomp: the foot down, deep in the knees, arms flung out
      legs(36 * k, -62 * k); spine(16 * k, 10 * k); head(12 * k);
      arm(1, 18 * k, 34 * k, 22 * k); arm(-1, 18 * k, 34 * k, 22 * k); break;
    case 5:   // bite: a lunge (legs flung back, the body tipped forward), the mouth wide; then the chomp
      legs(-24 * k, -18 * k, -36 * k, -28 * k); ROOT[1] -= .12 * k; ROOT[2] += .03 * k;
      axisAngle(1, 0, 0, D(28 * k), RQ);
      spine(10 * k, 8 * k); head(-30 * k); jaw((sub ? 6 : 42) * k);
      arm(1, 78 * k, 8 * k, 0); arm(-1, 78 * k, 8 * k, 0); return true;
    case 6:   // cone: the arm thrown forward
      legs(20 * k, -10 * k, -14 * k, -8 * k); spine(12 * k, 8 * k, 0, 24 * k); head(-6 * k, 0, -18 * k);
      arm(-1, (sub ? 80 : 104) * k, -14 * k, 6 * k); arm(1, -30 * k, 10 * k, 20 * k); break;
  }
  return false;
}

export function trollPose(M, st, W, T) {
  cM = M; cT = T; big = M.type === 'big'; M.reset(T);
  const {key, mi, ai, sub, hit, N} = quant(st);
  ROOT[0] = ROOT[1] = ROOT[2] = 0; let rq = null;
  const sd = (st.seed || 0) > .5 ? 1 : -1;
  // the base: arms hanging a little forward and bent (the big one's to its knees)
  if (mi !== 1 && mi !== 2 && mi !== 8) { S2('Arm', 0, D(10)); S2('ForeArm', 0, D(14)); }
  if (big) club(-30);   // (the club's thick end down on the ground ahead)
  switch (mi) {
    case 0:   // idle: breathing, the arms hanging
      legs(10, -18);
      if (sub) { tn('Spine2', 0, D(-3)); S2('Shoulder', 2, D(4), D(-4)); head(4); }
      if (!big) { tn('Spine', 2, D(sub ? 4 : -4)); head(0, sub ? -8 : 6); tn('Tail', 2, D(sub ? 20 : -20)); }
      break;
    case 1: case 2: walk(sub, N, mi === 2); break;
    case 8:   // flee: running, the arms flung up
      walk(sub, N, true); S2('Arm', 0, D(150 + (sub & 1 ? 12 : -8)), D(150 + (sub & 1 ? -8 : 12))); S2('ForeArm', 0, D(20)); tn('Spine1', 0, D(-14)); head(-24); jaw(25);
      break;
    case 3: {   // roar: a breath in, then arms wide, the head back, the jaw open, shaking
      if (sub === 0) { legs(14, -24); spine(-6, -6); head(12); arm(1, 24, 20, 30); arm(-1, 24, 20, 30); break; }
      const sh = sub === 1 ? 1 : -1;
      legs(18, -30); spine(-14, -10, 2 * sh); head(-30, 4 * sh); jaw(38);
      arm(1, 50 + 5 * sh, 64, 32); arm(-1, 50 - 5 * sh, 64, 32); tn('Tail', 0, D(-20));
      break;
    }
    case 4: {   // the wind-up
      const k = sub === 0 ? .5 : sub === 1 ? .82 : 1;
      switch (ai) {
        case 1:   // slam: the club raised high over its head in both hands
          legs(18 * k, -30 * k); spine(-12 * k, -10 * k); head(-18 * k);
          arm(-1, 142 * k, -12 * k, 16 * k); arm(1, 136 * k, -18 * k, 26 * k); club(-10 * k); break;
        case 2:   // sweep: the club drawn far back to its right, the body wound round
          legs(12 * k, -24 * k); tn('LeftUpLeg', 2, D(10)); tn('RightUpLeg', 2, D(-10));
          spine(4 * k, 6 * k, 4 * k, -60 * k); head(0, 0, 36 * k);
          arm(-1, -34 * k, 52 * k, 12 * k); arm(1, 52 * k, -30 * k, 30 * k); club(10 * k); break;
        case 3:   // boulder: down to the ground for the rock, then lifting it overhead
          if (sub === 0) { legs(50, -86); spine(34, 22); head(-24); arm(1, 50, -8, 10); arm(-1, 50, -8, 10); club(36); }
          else { legs(sub === 1 ? 28 : 18, sub === 1 ? -46 : -32); spine(sub === 1 ? 0 : -12, sub === 1 ? 0 : -10); head(sub === 1 ? -12 : -20); arm(1, 110, 5, 51); arm(-1, 110, 5, 51); }
          break;
        case 4:   // stomp: a foot raised high, leaning back, arms out for balance
          legs(4, -8, 72 * k, -88 * k); spine(-8 * k, -4 * k, -6 * k); head(-8 * k);
          arm(1, 30 * k, 40 * k, 20); arm(-1, 30 * k, 40 * k, 20); break;
        case 5:   // bite: crouched low and coiled, head up, arms back
          legs(64 * k, -110 * k); spine(28 * k, 16 * k); head(-34 * k); jaw(12 * k);
          arm(1, -40 * k, 14 * k, 34 * k); arm(-1, -40 * k, 14 * k, 34 * k); tn('Tail', 0, D(-30 * k)); break;
        case 6:   // cone: the arm cocked back behind its head
          legs(18 * k, -16 * k, -10 * k, -10 * k); spine(-6 * k, -4 * k, 0, -26 * k); head(-8 * k, 0, 20 * k);
          arm(-1, 150 * k, -6 * k, 110 * k); arm(1, 64 * k, -10 * k, 6 * k); break;
        default: legs(20, -30); spine(10, 6); break;
      }
      break;
    }
    case 5: if (strike(ai, 1, sub)) rq = RQ; break;
    case 6:   // recover: the slam's club stuck in the ground (tugging), the rest easing back
      if (ai === 1) {
        if (sub === 2) { legs(18, -30); spine(10, 8); head(-10); arm(-1, 44, -6, 10); arm(1, 40, -12, 14); club(-26); }
        else { strike(1, 1, 1); if (sub) { tn('Spine1', 0, D(-8)); tn('RightArm', 0, D(-8)); tn('LeftArm', 0, D(-8)); legs(6, -10); head(-6); } }
      } else if (strike(ai, sub === 0 ? .66 : sub === 1 ? .4 : .15, 1)) rq = RQ;
      break;
    case 7:   // stagger
      if (big) {   // reeling back, knees buckling, a hand to its head, the club flung out
        const sw = sub ? 1 : -1;
        legs(24, -52, 16, -40); spine(-16, -12, 6 * sw); head(-10, 14 * sw); jaw(16);
        arm(1, 58, -50, 86); arm(-1, -22, 36, 10); club(20);
        axisAngle(1, 0, 0, D(-5), RQ); rq = RQ;
      } else {   // tumbling over backward
        legs(54, -34, 12, -24); spine(-16, -10); head(22); jaw(20);
        arm(1, 128 + 18 * sub, 36, 20); arm(-1, 128 + 18 * sub, 36, 20);
        axisAngle(1, 0, 0, D(sub ? -44 : -24), RQ); rq = RQ;
      }
      break;
    case 9:   // peek: crouched, leaning out sideways (and back)
      legs(52, -92); spine(14, 6, sd * (sub ? 30 : 10)); tn('Spine1', 2, D(sd * (sub ? 10 : 2))); head(-6, -sd * (sub ? 22 : 8));
      arm(sd, 74, 8, 30); arm(-sd, 20, 0, 40);
      break;
    case 10:   // hide: crouched small, hands over its eyes, shivering
      legs(72, -124); spine(30, 20, sub ? 3 : -3); head(18);
      arm(1, 74, -5, 36); arm(-1, 74, -5, 36);
      break;
    case 11:   // laugh: bent back with a hand on its belly, pointing; then doubled over
      legs(20, -36);
      if (sub === 0) { spine(-20, -14); head(-26); jaw(34); }
      else { spine(18, 10); head(12); jaw(22); }
      if (sub) arm(1, -22, -50, 76); else arm(1, -34, -40, 66);
      arm(-1, sub ? 104 : 46, -10, 4); tn('Tail', 2, D(sub ? 30 : -30));   // (the other one pointing at you)
      break;
    case 12:   // ride: sitting on a shoulder, legs apart, an arm up waving
      tn('LeftUpLeg', 0, D(84)); tn('RightUpLeg', 0, D(84)); tn('LeftUpLeg', 2, D(26)); tn('RightUpLeg', 2, D(-26));
      S2('Leg', 0, D(-72)); ROOT[2] = -.25; spine(-6, -4); head(-8, 0, sub ? 18 : -10);
      arm(-1, 150, 10 + (sub ? 16 : -10), 20); arm(1, 34, -22, 60); tn('Tail', 0, D(-40)); jaw(sub ? 20 : 0);
      break;
    case 13: {   // stone (freezing / waking): crouched, an arm over its eyes against the sun, the head bowed away
      const q = sub >> 1, k = q / 3, sh = sub & 1 ? 1 : 0;
      legs(44 * k + 10 * (1 - k), -76 * k - 18 * (1 - k), 36 * k + 10 * (1 - k), -64 * k - 18 * (1 - k));
      spine(24 * k, 16 * k, sh ? 3 : 0); head(26 * k, sh ? -5 : 0, 22 * k);
      arm(1, 38 * k, -35 * k, 66 * k); arm(-1, 24 * k, 4 * k, 10 * k); club(22 * k);
      tn('Tail', 2, D(24 * k));
      break;
    }
  }
  if (hit) {   // the flinch: thrown back (forward if the blow came from behind), the head snapping, the arms flung out
    const k = hit === 2 ? 1 : .5, b = st.hitBack ? -1 : 1, g = big ? .6 : 1.2;   // (the big one barely rocks; the small one is thrown)
    tn('Spine1', 0, D(-14 * k * b * g)); tn('Spine2', 0, D(-12 * k * b * g)); tn('Neck', 0, D(-18 * k * b * g));
    tn('LeftShoulder', 2, D(-14 * k)); tn('RightShoulder', 2, D(14 * k)); S2('Arm', 0, D(-18 * k));
    jaw(14 * k);
  }
  M.pose(W, T, ROOT, rq);
  return key;
}
