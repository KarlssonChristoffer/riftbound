// MERCHANT 3D: the light garden's merchant (features/garden.js) as a 3D figure built in code (view/rigkit.js) and drawn
// live through render/rigmesh.js (view/livebody.js), instead of his painted front / back cards mirrored to face you: a
// short, stout old trader in his wide green hat with its gold band, a white beard, a yellow scarf over his wine-red robe,
// a canvas apron, a belt with a gold buckle, boots. He does what the card did, from garden.js's own state (M):
//   turns    to face you as you come near (M.ang, garden's smoothed angle): his body in 16 steps relative to the camera,
//            held within .6 of a step; his head turns the rest of the way (in 2 steps)
//   breathes the chest and shoulders rise and fall (2 steps, the card's 1.1 Hz)
//   blinks   (M.blink) his eyes drawn as nothing for the blink
//   greets   (M.wave: on meeting you, when you talk) his near hand up to the brim of his hat, the forearm rocking
// The pose changes in whole steps (its key), re-posed only when one does. VIEW only (garden's view state, read).
// API: const m3 = createMerchant3d(host, at); m3.draw(M, t) -> true (drawn; false: not ready, the card draws).
// OWNS: its rig, model and body. READS: garden's merchant state, host.player, host.yaw. EMITS: nothing.
// BUDGET: view ~.005 ms a frame near the stall; render: A + S + B (3 draws) while he's drawn.
import {createRigMesh} from '../render/rigmesh.js';
import {liveModel, createLiveBody} from './livebody.js';
import {rigKit} from './rigkit.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const wrap = a => a - TAU * Math.round(a / TAU);
// his ramps: garden.js's painted ones (as painted)
const C = {hat: ['#6f8f7e', '#557566', '#3e5a4d', '#283c33'], gold: ['#f2d070', '#c89a3a', '#8e6a26', '#5a4018'], skin: ['#ecc0a0', '#d4a07e', '#ab7a5e', '#6e4a3a'],
  beard: ['#f2eee6', '#d0cabe', '#a49e92', '#6b675e'], robe: ['#a5566a', '#823e52', '#5f2a3c', '#3c1726'], scarf: ['#e8c26a', '#c89a46', '#94702e', '#5a421c'],
  apron: ['#c9a477', '#a78456', '#7d6140', '#4f3c28'], leather: ['#7a5a44', '#5a412f', '#3f2d20', '#261a12'], dark: ['#4a3238', '#30222a', '#201418', '#140c10']};

function merchantModel() {
  const K = rigKit(), raw = {raw: true};
  for (const [n, t] of Object.entries(C)) K.fam(n, t, raw);
  K.bone('Hips', null, [0, 0, .74], [0, 0, .84]).bone('Spine', 'Hips', [0, 0, .84], [0, 0, .94]).bone('Spine1', 'Spine', [0, 0, .94], [0, -.01, 1.06])
    .bone('Spine2', 'Spine1', [0, -.01, 1.06], [0, -.02, 1.18]).bone('Neck', 'Spine2', [0, -.02, 1.18], [0, -.03, 1.24]).bone('Head', 'Neck', [0, -.03, 1.24], [0, -.03, 1.46])
    .bone('Eyes', 'Head', [0, -.03, 1.34], [0, -.03, 1.4]);
  const L = (n, s) => (s < 0 ? 'Right' : 'Left') + n;
  for (const s of [1, -1]) {
    K.bone(L('Shoulder', s), 'Spine2', [.05 * s, -.02, 1.15], [.2 * s, -.02, 1.14])
      .bone(L('Arm', s), L('Shoulder', s), [.2 * s, -.02, 1.14], [.25 * s, -.05, .9])
      .bone(L('ForeArm', s), L('Arm', s), [.25 * s, -.05, .9], [.23 * s, -.16, .72])
      .bone(L('Hand', s), L('ForeArm', s), [.23 * s, -.16, .72], [.22 * s, -.2, .64])
      .bone(L('UpLeg', s), 'Hips', [.1 * s, 0, .74], [.1 * s, -.01, .4]).bone(L('Leg', s), L('UpLeg', s), [.1 * s, -.01, .4], [.1 * s, 0, .08])
      .bone(L('Foot', s), L('Leg', s), [.1 * s, 0, .08], [.1 * s, -.15, .03], {z: [0, 0, 1]});
  }
  // the robe: a long skirt (a cone to the ankles), the body, the sleeves; the apron in front, the belt and its buckle
  K.tube('Hips', 'skirt', 'robe', .31, .23, .74, [0, .01, .43], {sides: 12, bias: -.05})
    .ball('Spine1', 'body', 'robe', [.26, .21, .22], [0, 0, 1.0], {detail: 2})
    .ball('Spine2', 'chest', 'robe', [.27, .2, .17], [0, -.01, 1.1], {detail: 1})
    .box('Hips', 'apron', 'apron', [.34, .04, .58], [0, -.285, .48], {rot: [-.12, 0, 0], bias: .1})
    .box('Spine1', 'bib', 'apron', [.24, .04, .2], [0, -.215, .96], {rot: [.08, 0, 0], bias: .1})
    .tube('Hips', 'belt', 'leather', .245, .245, .05, [0, -.005, .81], {sides: 12})
    .box('Hips', 'buckle', 'gold', [.06, .025, .045], [0, -.255, .81], {bias: .3});
  for (const s of [1, -1]) {
    K.limb(L('Arm', s), 'sleeve' + s, 'robe', .065, .07).limb(L('ForeArm', s), 'cuff' + s, 'robe', .07, .075, {ext: .02})
      .ball(L('Hand', s), 'hand' + s, 'skin', [.045, .045, .05], K.at(L('Hand', s), .5), {detail: 1})
      .box(L('Foot', s), 'boot' + s, 'leather', [.09, .18, .07], [.1 * s, -.07, .035], {bias: -.1});
  }
  // the scarf: round the neck, its two ends down the front
  K.tube('Neck', 'scarf', 'scarf', .13, .11, .08, [0, -.03, 1.18], {sides: 10, bias: .15})
    .box('Spine2', 'scarfL', 'scarf', [.06, .03, .2], [.07, -.17, 1.06], {rot: [-.15, 0, .1], bias: .15})
    .box('Spine2', 'scarfR', 'scarf', [.06, .03, .16], [-.05, -.17, 1.08], {rot: [-.15, 0, -.15], bias: .15});
  // the head: his face, a white beard and moustache, his nose; the hat: the brim, the crown, the gold band
  K.ball('Head', 'face', 'skin', [.12, .12, .13], [0, -.05, 1.35], {detail: 2})
    .ball('Head', 'nose', 'skin', [.028, .032, .028], [0, -.155, 1.33], {detail: 0, bias: .1})
    .ball('Head', 'beard', 'beard', [.13, .09, .11], [0, -.12, 1.17], {detail: 1, bias: .1})
    .box('Head', 'stache', 'beard', [.12, .035, .028], [0, -.165, 1.29], {bias: .2})
    .tube('Head', 'brim', 'hat', .24, .24, .025, [0, -.02, 1.465], {sides: 14, bias: .1})
    .tube('Head', 'crown', 'hat', .13, .11, .16, [0, -.02, 1.55], {sides: 10})
    .tube('Head', 'band', 'gold', .132, .13, .035, [0, -.02, 1.495], {sides: 10, bias: .2});
  for (const s of [1, -1]) K.ball('Eyes', 'eye' + s, 'dark', [.02, .012, .022], [.047 * s, -.165, 1.37], {fixed: 3, outline: false});
  const M = K.build('merchant');
  M.B = {}; for (const n of M.names) M.B[n] = M.IX[n];
  M.eyeSeg = M.J.segs.findIndex(s => s.bone === 'Eyes');
  return M;
}

export function createMerchant3d(host, at) {
  const G = host.G;
  let rig = null, M = null, LM = null, body = null, ready = false, failed = false;
  let W = null, T = null, key = -1, f = -999, hide = null, wasHide = null;
  function setup() {
    try {
      rig = createRigMesh(G, {slots: 1}); M = merchantModel(); LM = liveModel(rig, M.J, M.bin); body = createLiveBody(LM, rig, 0, G); T = M.turns();
      W = D.w = new Float64Array(LM.NB * 7);
      hide = new Uint8Array(M.J.segs.length); hide[M.eyeSeg] = 1;
      rig.warm().then(() => { ready = true; });
    } catch (e) { failed = true; console.warn('merchant3d: no 3D merchant (his card instead)', e); }
  }
  const D = {w: null, key: 0, phi: 0, x: 0, y: 0, z: 0, sx: 0, sy: 0, sh: 0, aim: false, alpha: 1, flash: 0, lie: 0, type: 7, hide: null};
  function pose(m, t, headTurn) {
    const tn = (n, ax, a) => M.turn(T, M.B[n], ax, a), breath = Math.floor(t * 1.1) & 1, blink = m.blink > 0, wave = m.wave > 0;
    const rock = wave ? Math.floor(t * 6) & 1 : 0, hs = Math.round(headTurn / (22.5 * DEG));
    const k = ((breath * 2 + (blink ? 1 : 0)) * 3 + (wave ? 1 + rock : 0)) * 9 + hs + 4;
    if (k === key) return;
    key = k; M.reset(T);
    // stance: hands folded a little forward, a slight stoop
    for (const s of ['Left', 'Right']) { tn(s + 'Arm', 0, 14 * DEG); tn(s + 'ForeArm', 0, 30 * DEG); }
    tn('Spine1', 0, 4 * DEG);
    if (breath) { tn('Spine2', 0, -3 * DEG); tn('LeftShoulder', 2, 5 * DEG); tn('RightShoulder', 2, -5 * DEG); }
    if (hs) tn('Neck', 1, hs * 22.5 * DEG);   // (his head the rest of the way to you)
    if (wave) {   // the near hand to the hat's brim, the forearm rocking: a greeting
      tn('RightArm', 0, 130 * DEG); tn('RightArm', 2, -25 * DEG); tn('RightForeArm', 0, 70 * DEG); tn('RightForeArm', 1, (rock ? 18 : -18) * DEG);
      tn('Head', 0, -6 * DEG);
    }
    M.pose(W, T, null, null);
    D.hide = blink ? hide : null;
  }
  return {
    get ready() { return ready; }, get rig() { return rig; },
    // his frame (garden's M: ang (rad, the arena's atan2(dy, dx)), blink, wave), t: the view's clock
    draw(m, t) {
      if (failed) return false;
      if (!rig) setup();
      if (!ready) return false;
      const yaw = host.yaw, step = TAU / 16, a = Math.atan2(Math.cos(m.ang), Math.sin(m.ang));   // (garden's angle -> the facing's convention: atan2(x, y))
      if (!(f > -999) || Math.abs(wrap(a - (f * step + yaw))) > .6 * step) f = Math.round(wrap(a - yaw) / step);
      const phi = f * step + yaw;
      pose(m, t, Math.max(-step, Math.min(step, wrap(a - phi))));
      D.key = key; D.phi = phi; D.x = D.sx = at.x; D.y = D.sy = at.y; D.z = D.sh = 0;
      body.draw(D, t); rig.render();
      return true;
    },
  };
}
