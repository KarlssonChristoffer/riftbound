// LOOSE PIECES: one piece of a live model (view/livebody.js: a segment, e.g. a gunman's hat or gun) drawn on its own, free of
// the body: placed and turned in the world by its owner (a hat shot off and lying in the dust, a gun knocked out of a hand:
// features/foes/look.js, docs/exp/brawl.md). It is drawn in a rig slot of its own with every other segment as nothing (a zero
// matrix), the ground's own projection (no sprite-camera squash: as the ragdolls' loose pieces), so it lies on the ground true.
//   const P = pieceOf(LM, 'HatHold0', 'idle.0') -> {seg, q (its turn in that pose, body space), c (its middle there), half}
//   drawPiece(rig, LM, slot, P, x, y, h, phi, ax, ay, az, a, alpha, flash): its middle at world (x, y, h) (arena x, y, height),
//     facing phi (the world's angle, as a body's), tumbled by a rad about the body-space axis (ax, ay, az) through its middle
// OWNS: per model, one matrix block (made once). READS: the model (LM). BUDGET: view; per piece a frame a quaternion product and 12 floats.
import {qmul, qrot, axisAngle} from './livebody.js';

const DEG = Math.PI / 180, C20 = Math.cos(20 * DEG), S55 = Math.sin(55 * DEG), PITCH_LIE = Math.atan(S55 / C20);
const BLK = new Map(), PV = new Float64Array(12), QT = new Float64Array(4), QA = new Float64Array(4), V3 = new Float64Array(3);

export function pieceOf(LM, bone, pose) {
  const s = LM.J.segs.findIndex(g => g.bone === bone), P = LM.poseOf(pose) || LM.poseOf('idle.0'), b = LM.IX[bone];
  if (s < 0 || !P || b === undefined) return null;
  const g = LM.J.segs[s], o = b * 7, q = Float64Array.of(P.w[o], P.w[o + 1], P.w[o + 2], P.w[o + 3]);
  const lc = [(g.min[0] + g.max[0]) / 2, (g.min[1] + g.max[1]) / 2, (g.min[2] + g.max[2]) / 2];
  qrot(q, 0, lc[0], lc[1], lc[2], V3, 0);
  return {seg: s, q, p: Float64Array.of(P.w[o + 4], P.w[o + 5], P.w[o + 6]), c: Float64Array.of(P.w[o + 4] + V3[0], P.w[o + 5] + V3[1], P.w[o + 6] + V3[2]),
    half: Math.max(g.max[0] - g.min[0], g.max[1] - g.min[1], g.max[2] - g.min[2]) / 2};
}

export function drawPiece(rig, LM, slot, P, x, y, h, phi, ax, ay, az, a, alpha = 1, flash = 0) {
  let M = BLK.get(LM); if (!M) BLK.set(LM, M = new Float32Array(LM.NS * 12));
  const m = P.seg * 12;
  // its turn: the tumble (about its middle, body space) after its pose's
  axisAngle(ax, ay, az, a, QA, 0); qmul(QA, 0, P.q, 0, QT, 0);
  const X = QT[0], Y = QT[1], Z = QT[2], W = QT[3];
  const r00 = 1 - 2 * (Y * Y + Z * Z), r01 = 2 * (X * Y - Z * W), r02 = 2 * (X * Z + Y * W);
  const r10 = 2 * (X * Y + Z * W), r11 = 1 - 2 * (X * X + Z * Z), r12 = 2 * (Y * Z - X * W);
  const r20 = 2 * (X * Z - Y * W), r21 = 2 * (Y * Z + X * W), r22 = 1 - 2 * (X * X + Y * Y);
  // the bone's head after the tumble about the middle (body space), then into the world (livebody's body -> world at phi)
  qrot(QA, 0, P.p[0] - P.c[0], P.p[1] - P.c[1], P.p[2] - P.c[2], V3, 0);
  const bx = P.c[0] + V3[0], by = P.c[1] + V3[1], bz = P.c[2] + V3[2], N0 = Math.cos(phi), N1 = Math.sin(phi);
  const cx = N0 * P.c[0] - N1 * P.c[1], cz = -N1 * P.c[0] - N0 * P.c[1];   // (where its middle would land with the anchor at 0)
  const AX = x - cx, AY = h - P.c[2], AZ = y - cz;
  M.fill(0);
  M[m] = N0 * r00 - N1 * r10; M[m + 1] = N0 * r01 - N1 * r11; M[m + 2] = N0 * r02 - N1 * r12; M[m + 3] = N0 * bx - N1 * by + AX;
  M[m + 4] = r20; M[m + 5] = r21; M[m + 6] = r22; M[m + 7] = bz + AY;
  M[m + 8] = -N1 * r00 - N0 * r10; M[m + 9] = -N1 * r01 - N0 * r11; M[m + 10] = -N1 * r02 - N0 * r12; M[m + 11] = -N1 * bx - N0 * by + AZ;
  // the params (rigmesh putv: x, z, k, alpha, flash, pitch, y, type, sx, sy, sz, snap): its middle the anchor, no squash
  PV[0] = x; PV[1] = y; PV[2] = 1; PV[3] = alpha; PV[4] = flash; PV[5] = PITCH_LIE; PV[6] = h; PV[7] = 7; PV[8] = x; PV[9] = h; PV[10] = y; PV[11] = 1;
  rig.putv(LM.model, slot, M, PV);
}
