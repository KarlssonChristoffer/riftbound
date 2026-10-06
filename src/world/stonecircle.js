// STONECIRCLE: a ring of standing stones on the West Downs' south-west hill (the user's brief, 2026-10-06: weathered monoliths on
// a hilltop, a trilithon, an altar stone, a gap lined up with the low sun so its beams fall into the ring at golden hour). Plain
// data for the layout (where the stones stand, the hill they crown) and the builder of their live 3D stone (world.js):
//   SITE      the ring: its centre, radii (an ellipse, a little longer east-west: the hill is), the floor's height
//   TERRAIN   the hill (in place of westland.js's dome there, whose h 1.4 cosine put a ring on its slopes): a broad raised cosine,
//             its top levelled into a floor for the ring (a terrace a little lower than the cosine's crown, which still rises under
//             the altar), walkable all round (its banks stay under terrain.js WALK)
//   PIECES    the stones, each a lofted monolith: the TRILITHON on the dusk axis (DUSK_AZ: the sun's bearing at ~19:00, sim/env.js
//             sunAz under the dusk mood), two uprights a metre apart and a lintel across them, so at golden hour the sun shines
//             through the opening onto the ALTAR (a recumbent slab in the middle) and render/godrays.js finds a slot between solid
//             things (a shaft up to 1.4 m wide, from a metre down-sun of the opening); six more uprights round the ring (2-3.1 m),
//             one snapped (its top lies at its foot), a stump (its top by it), one fallen outward on the far side and broken in two
//             (the beams' way out stays open)
//   PROPS     a 'menhir' prop per stone ([kind, x, y, extra], extra.variant: its index here): a round collider; a lying stone a row
//             of them (its middle one carries the mesh, the others are 'menhir_part': a collider and a top, no mesh, no perch).
//             Arrows stop at each one's own top (world.js TOPS), birds perch on them (wildlife.js PERCH), bullets chip them as stone
//             (content/materials.js: registered below; audio.js PROP_MAT)
//   LIGHTS    a faint cool light over the altar (world.js: a ground light, always on: lost in daylight, a glow in the ring at night)
//   stoneSward(x, y, Z) -> true where no grass grows (inside a stone's foot); else it crops the ring's floor to ankle-high turf
//             (Z: westland.js zone()'s {tall, ankle}, changed in place). features/grass.js asks it per West Downs cell
//   stoneMeshes(props, o, ground) -> [{p, geo, top}]: each menhir prop's geometry (world frame; null: a collider only) and its top
//             (m over p.z). o = {fam(name) -> family index, cover: the moss's family or null} (world.js wo), ground(x, z) -> m
// THE LOOK: weathered sarsens, not dressed blocks. A stone is LOFTED from a rounded-box section through 8 rings, tapering (more from
// one side: one edge stands straighter), a little bellied, leaning, every ring a little off the line and its corners pushed in or out
// its own way: FACETS that the art light (gfx.js uLArt) tones as planes (their shading normals exaggerated, as cliffs3d.js's block
// fronts); corners chipped in; a domed, slanted, snapped or flat top. Each stone is one part (no seams between its facets: they meet
// in tone, the outline and the crests do the rest). Pale LICHEN spots on the faces (the stone's own family and part, a tone
// lighter), MOSS creeping up the north faces and round the feet, lying on the lintel and the altar (walls3d.js mason), the biome's
// cover on what faces up (MESH_FS); small chips fallen round the broken ones (mason).
// Frame: world metres, x east, y up, z south (layout y); world.js moves each geometry into its prop's frame. ?stones=0
// (westland.js STONES_ON): none, the hill and its oak as before.
// OWNS: nothing at run time (constants, pure functions, a build-time builder). READS: core/mathx.js, core/rng.js, cliffs3d.js
// (sink), walls3d.js (mason), westland.js, content/materials.js (registers its kinds once).
import {clamp, smooth} from '../core/mathx.js';
import {mulberry32} from '../core/rng.js';
import {sink} from './cliffs3d.js';
import {mason} from './walls3d.js';
import {STONES_ON} from './westland.js';
import {setMaterials} from '../content/materials.js';

export {STONES_ON};
const DEG = Math.PI / 180;
// the sun's compass bearing at golden hour (the direction its light comes from; sim/env.js: ~295 from 18:50 to 19:25)
export const DUSK_AZ = 295;
export const SITE = {x: -29.2, y: 20.75, rx: 3, ry: 2.6, floor: 1.1};

// ---- the hill: a raised cosine (the old one's place, a little north: the ravine's rim holds the ground flat south of y ~25) and
// the floor levelled into its top (an outline that wanders a little, so the shelf isn't a drawn ellipse)
const shelf = (ax, ay, n = 20) => Array.from({length: n}, (_, i) => {
  const t = i / n * Math.PI * 2, k = 1 + .06 * Math.sin(i * 2.1 + .7) + .04 * Math.sin(i * 4.3);
  return [SITE.x + Math.cos(t) * ax * k, SITE.y + Math.sin(t) * ay * k];
});
export const TERRAIN = !STONES_ON ? [] : [
  {type: 'hill', x: SITE.x, y: SITE.y + .1, rx: 6.4, ry: 4.7, h: 1.3, rot: -.12},
  {type: 'terrace', pts: shelf(3.6, 2.8), h: SITE.floor, bank: 2.4},
];

// ---- the ring: a point at angle t (deg, a compass bearing from the centre on the ellipse), its frame there (u along it, clockwise
// seen from above; w outward), layout axes
const onRing = (t, k = 1) => [SITE.x + SITE.rx * k * Math.sin(t * DEG), SITE.y - SITE.ry * k * Math.cos(t * DEG)];
const ringFrame = t => {
  const tx = SITE.rx * Math.cos(t * DEG), ty = SITE.ry * Math.sin(t * DEG), l = Math.hypot(tx, ty);
  return {u: [tx / l, ty / l], w: [ty / l, -tx / l]};
};
// the dusk axis: toward the sun (layout axes), where it crosses the ring, and across it
const SUN = [Math.sin(DUSK_AZ * DEG), -Math.cos(DUSK_AZ * DEG)];
const T_SUN = 1 / Math.hypot(SUN[0] / SITE.rx, SUN[1] / SITE.ry);
const GATE = [SITE.x + SUN[0] * T_SUN, SITE.y + SUN[1] * T_SUN], ACROSS = [-SUN[1], SUN[0]];
const OPEN = 1.02;   // m between the trilithon's uprights (render/godrays.js TUNE.reach .7: a shaft up to 1.4 m wide)

// ---- the pieces. A standing stone: at (ring angle | x, y), its frame (u: its width, w: its depth, outward), half width a, half depth
// b, height h over the ground at its foot, taper (the top's scale), lean [m along u, m along w at the top], cap, seed. lie: a stone
// lying on the ground along `dir` from its foot (x, y), len long (follows the ground's slope), roll: its section turned about its
// length. prop: the 'menhir' prop it belongs to (its mesh); r: that prop's collider
const STAND = (t, o) => ({kind: 'stand', at: onRing(t, o.k || 1), ...ringFrame(t), ...o});
const tri = s => [GATE[0] + ACROSS[0] * s * (OPEN / 2 + .43), GATE[1] + ACROSS[1] * s * (OPEN / 2 + .43)];
const FALL_T = 108, FALL_AT = onRing(FALL_T, 1.04), FALL_DIR = ringFrame(FALL_T).w, FALL_A = 1.55;
const turn = ([x, y], a) => [x * Math.cos(a * DEG) - y * Math.sin(a * DEG), x * Math.sin(a * DEG) + y * Math.cos(a * DEG)];
const FALL_DIR2 = turn(FALL_DIR, 9), FALL_AT2 = [FALL_AT[0] + FALL_DIR[0] * (FALL_A + .09) + FALL_DIR[1] * .05, FALL_AT[1] + FALL_DIR[1] * (FALL_A + .09) - FALL_DIR[0] * .05];
const SNAP_T = 24, SNAP_F = ringFrame(SNAP_T), STUMP_T = 246, STUMP_F = ringFrame(STUMP_T);
export const PIECES = !STONES_ON ? [] : [
  // the trilithon: its uprights square to the dusk axis (broad faces to the sun), flat-topped, the lintel resting across them
  {kind: 'stand', at: tri(-1), u: ACROSS, w: SUN, a: .43, b: .31, h: 2.72, taper: .86, lean: [-.04, .02], cap: 'flat', seed: 11, prop: 0, r: .42},
  {kind: 'stand', at: tri(1), u: ACROSS, w: SUN, a: .43, b: .32, h: 2.66, taper: .84, lean: [.03, -.03], cap: 'flat', seed: 12, prop: 1, r: .42},
  {kind: 'lintel', seed: 13, prop: 0},
  // the ring round from the north (bearings): tall ones, a snapped one, a stump, one fallen outward on the far side of the axis
  STAND(338, {a: .58, b: .3, h: 2.5, taper: .72, lean: [.04, .1], cap: 'dome', seed: 21, prop: 2, r: .5}),
  STAND(SNAP_T, {a: .52, b: .3, h: 1.55, taper: .9, lean: [0, .05], cap: 'snap', seed: 22, prop: 3, r: .46}),
  {kind: 'lie', at: [onRing(SNAP_T, 1.42)[0] - SNAP_F.u[0] * .25, onRing(SNAP_T, 1.42)[1] - SNAP_F.u[1] * .25], dir: [SNAP_F.w[0] * .6 + SNAP_F.u[0] * .8, SNAP_F.w[1] * .6 + SNAP_F.u[1] * .8],
    a: .42, b: .26, len: .95, roll: .5, cap: 'dome', foot: 'snap', taper: .8, seed: 23, prop: 3},   // (its top, broken off: lying at its foot)
  STAND(64, {a: .62, b: .34, h: 3.1, taper: .66, lean: [-.08, .06], cap: 'slant', seed: 24, prop: 4, r: .54}),
  {kind: 'lie', at: FALL_AT, dir: FALL_DIR, a: .52, b: .3, len: FALL_A, roll: .25, cap: 'snap', foot: 'snap', taper: .86, seed: 25, prop: 5},   // (it broke in two as it fell)
  {kind: 'lie', at: FALL_AT2, dir: FALL_DIR2, a: .45, b: .27, len: 1.1, roll: .45, cap: 'dome', foot: 'snap', taper: .7, seed: 32, prop: 5},
  STAND(152, {a: .5, b: .28, h: 2.05, taper: .76, lean: [.1, .13], cap: 'dome', seed: 26, prop: 6, r: .45}),
  STAND(201, {a: .57, b: .31, h: 2.38, taper: .72, lean: [-.05, .07], cap: 'slant', seed: 27, prop: 7, r: .5}),
  STAND(STUMP_T, {a: .55, b: .32, h: .82, taper: .95, lean: [0, 0], cap: 'snap', seed: 28, prop: 8, r: .48}),
  {kind: 'lie', at: [onRing(STUMP_T, 1.5)[0] + STUMP_F.u[0] * .35, onRing(STUMP_T, 1.5)[1] + STUMP_F.u[1] * .35], dir: [STUMP_F.w[0] * .4 - STUMP_F.u[0] * .9, STUMP_F.w[1] * .4 - STUMP_F.u[1] * .9],
    a: .5, b: .28, len: 1.5, roll: -.4, cap: 'dome', foot: 'snap', taper: .75, seed: 29, prop: 8},
  // the altar: a recumbent slab on the crown, its length on the dusk axis
  {kind: 'lie', at: [SITE.x + SUN[0] * .95, SITE.y + SUN[1] * .95], dir: [-SUN[0], -SUN[1]], a: .47, b: .26, len: 1.8, roll: .04, cap: 'dome', foot: 'flat', taper: .88, altar: true, seed: 31, prop: 9},
];
// the props: one per stone where its mesh is (a standing stone's foot; a lying stone's middle), with its round collider; and a lying
// stone's other colliders along it ('menhir_part', extra.variant: 100 + its piece's index; no mesh)
const mid = P => [P.at[0] + P.dir[0] / Math.hypot(...P.dir) * P.len / 2, P.at[1] + P.dir[1] / Math.hypot(...P.dir) * P.len / 2];
export const PROPS = [];
if (STONES_ON) {
  const own = new Map();
  for (const P of PIECES) if (P.kind === 'stand') own.set(P.prop, ['menhir', P.at[0], P.at[1], {r: P.r, variant: P.prop}]);
  PIECES.forEach((P, i) => {
    if (P.kind !== 'lie') return;
    const [mx, my] = mid(P), l = Math.hypot(...P.dir), ux = P.dir[0] / l, uy = P.dir[1] / l, r = Math.min(P.a + .02, .48);
    const n = Math.max(1, Math.round(P.len / (r * 1.9))), step = (P.len - 2 * r) / Math.max(1, n - 1);
    for (let j = 0; j < n; j++) {
      const s = n === 1 ? 0 : -P.len / 2 + r + j * step, x = mx + ux * s, y = my + uy * s;
      if (!own.has(P.prop) && Math.abs(s) < step / 2 + 1e-6) { own.set(P.prop, ['menhir', x, y, {r, variant: P.prop}]); continue; }
      PROPS.push(['menhir_part', x, y, {r: r * .95, variant: 100 + i}]);
    }
  });
  PROPS.unshift(...[...own.values()]);
  setMaterials({menhir: 'stone', menhir_part: 'stone'});
}

// a faint cool light over the altar (world.js: one of its ground lights)
export const LIGHTS = !STONES_ON ? [] : [{x: SITE.x + SUN[0] * .05, y: SITE.y + SUN[1] * .05, h: 2.2, color: '#a6d4dc', radius: 3.2, intensity: .2, halo: false}];

// ---- the grass: none inside a stone's foot, the ring's floor cropped short (sheep, wind and feet: the tall drifts stop at the ring)
const FEET = [];   // [x, y, ux, uy, half along u, half along the other] (a lying stone: along its length)
for (const P of PIECES) {
  if (P.kind === 'stand') FEET.push([P.at[0], P.at[1], P.u[0], P.u[1], P.a + .02, P.b + .02]);
  else if (P.kind === 'lie') { const [x, y] = mid(P), l = Math.hypot(...P.dir); FEET.push([x, y, P.dir[0] / l, P.dir[1] / l, P.len / 2 + .02, P.a + .02]); }
}
export function stoneSward(x, y, Z) {
  const dx = x - SITE.x, dy = y - SITE.y;
  if (!STONES_ON || dx * dx + dy * dy > 49) return false;
  for (const [fx, fy, ux, uy, hu, hv] of FEET) {
    const ex = x - fx, ey = y - fy, s = ex * ux + ey * uy, t = -ex * uy + ey * ux;
    if ((s / hu) * (s / hu) + (t / hv) * (t / hv) < 1) return true;
  }
  const r = Math.hypot(dx / SITE.rx, dy / SITE.ry), k = 1 - smooth((r - 1.08) / .4);
  if (k > 0) { Z.ankle = Math.max(Z.ankle, k); Z.tall = Math.min(Z.tall * (1 - k), 1 - Z.ankle); }
  return false;
}

// ================================================================ THE BUILDER
const EXAG = 1.7, UP = [0, 1, 0];
const v3 = (u, k) => [u[0] * k, u[1] * k, u[2] * k];
const add3 = (...a) => a.reduce((s, q) => [s[0] + q[0], s[1] + q[1], s[2] + q[2]], [0, 0, 0]);
const nrm3 = q => { const l = Math.hypot(q[0], q[1], q[2]) || 1; return [q[0] / l, q[1] / l, q[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ONE MONOLITH, lofted along its own length: S = {c (its foot's centre, world), U (across), V (along its length), W (its depth): unit
// vectors; a, b (half width / depth at the foot), len (foot to shoulder), sinkD (m of it under the ground: a standing stone's), taper,
// bulge, lean [u, w] (m at the shoulder), cap ('dome' | 'slant' | 'snap' | 'flat'), capH, foot (a lying stone's exposed foot: 'snap' |
// 'flat'), fam, part, tone, north (moss on the faces looking this way, low down), lichen (0..1)} -> the highest point (world y)
function monolith(B, S, R, fc) {
  const N = 8, rr = (a, b) => a + (b - a) * R();
  const KS = S.rings || [0, .1, .25, .42, .6, .78, .92, 1];
  const side = R() < .5 ? -1 : 1, edge = S.edge ?? .6;   // (it narrows more from one side: one edge of the slab stands straighter)
  // the section: a rounded box (a superellipse, exponent ~3), its corners jittered
  const sec = [];
  for (let i = 0; i < N; i++) {
    const t = (i + .5 + (R() - .5) * .3) / N * Math.PI * 2, c = Math.cos(t), s = Math.sin(t), p = 2.6 + R() * .8;
    const r = Math.pow(Math.pow(Math.abs(c) / S.a, p) + Math.pow(Math.abs(s) / S.b, p), -1 / p) * (1 + (R() - .5) * .1);
    sec.push([c * r, s * r]);
  }
  // the rings along its length: scaled (taper, a little belly), leaning (more toward the top), twisted a hair, each corner in or out
  const rings = KS.map((t, k) => {
    const nar = (1 - S.taper) * Math.pow(t, 1.4), sc = 1 + (S.bulge ?? .06) * Math.sin(Math.PI * t) - nar;
    const wob = k === 0 ? 0 : S.wob ?? 1, du = (R() - .5) * .07 * S.a * wob, dw = (R() - .5) * .06 * S.b * wob;   // (each ring a little off the line: no ruler-straight edges)
    const lu = S.lean[0] * t * t + side * S.a * nar * edge + du, lw = S.lean[1] * t * t + dw, tw = (R() - .5) * .1, ct = Math.cos(tw), st = Math.sin(tw);
    const v = -S.sinkD + (S.len + S.sinkD) * t, j = k === 0 && !S.foot ? 0 : .13;
    return sec.map(([x, z]) => { const q = 1 + (R() - .5) * j; return [(x * ct - z * st) * sc * q + lu, v, (x * st + z * ct) * sc * q + lw]; });
  });
  const top = rings[rings.length - 1];
  // chips: a corner knocked in somewhere up the stone, and one at the shoulder pulled down and in
  const axis = k => rings[k].reduce((s, q) => [s[0] + q[0] / N, s[1] + q[2] / N], [0, 0]);
  for (let n = 0; n < 2 + (R() < .5 ? 1 : 0); n++) {
    const k = 2 + (R() * (rings.length - 3) | 0), i = R() * N | 0, [cu, cw] = axis(k), f = rr(.7, .84);
    for (const [kk, ii, ff] of [[k, i, f], [k + 1, i, (1 + f) / 2], [k - 1, i, (1 + f) / 2]]) { const q = rings[kk]?.[ii]; if (q && kk > 0) { q[0] = cu + (q[0] - cu) * ff; q[2] = cw + (q[2] - cw) * ff; } }
  }
  if (S.cap !== 'flat' && R() < .7) { const i = R() * N | 0, q = top[i]; q[1] -= rr(.08, .2); q[0] *= .9; q[2] *= .9; }
  if (S.cap === 'snap') for (const q of top) q[1] += (R() - .5) * .3;
  // to the world
  let hi = -1e9;   // (the highest point it reaches: its top)
  const P = q => { const y = S.c[1] + S.U[1] * q[0] + S.V[1] * q[1] + S.W[1] * q[2]; if (y > hi) hi = y; return [S.c[0] + S.U[0] * q[0] + S.V[0] * q[1] + S.W[0] * q[2], y, S.c[2] + S.U[2] * q[0] + S.V[2] * q[1] + S.W[2] * q[2]]; };
  const D = q => nrm3([S.U[0] * q[0] + S.V[0] * q[1] + S.W[0] * q[2], S.U[1] * q[0] + S.V[1] * q[1] + S.W[1] * q[2], S.U[2] * q[0] + S.V[2] * q[1] + S.W[2] * q[2]]);
  const fam = S.fam, p = S.part, axes = rings.map((_, k) => axis(k));
  // the faces round it: a facet per ring band and corner, toned on its own (a little bias each), turned out from the axis
  const lerpQ = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  for (let k = 0; k + 1 < rings.length; k++) for (let i = 0; i < N; i++) {
    const a = rings[k][i], b = rings[k][(i + 1) % N], c = rings[k + 1][(i + 1) % N], d = rings[k + 1][i];
    const A0 = axes[k], A1 = axes[k + 1], cu = (A0[0] + A1[0]) / 2, cw = (A0[1] + A1[1]) / 2;
    const h = D([(a[0] + b[0] + c[0] + d[0]) / 4 - cu, 0, (a[2] + b[2] + c[2] + d[2]) / 4 - cw]), fb = S.tone + (R() - .5) * .1;
    B.poly([P(a), P(b), (P(c)), (P(d))], h, fam, p, fb, -1, EXAG);
    const off = v3(h, .007);
    // moss creeping up a face that looks north (or down, a lying stone's underside), from the ground: a ragged band over its lower part
    // (and round its foot on any side now and then: a fringe in the grass)
    const north = h[2] * S.north[2] + h[0] * S.north[0] > .35;
    if (fc !== null && (north ? k <= 2 && R() < (k < 2 ? .85 : .4) : k <= 1 && R() < .3)) {
      const f1 = k === 0 ? rr(.6, 1) : rr(0, north ? .6 : .3), f2 = k === 0 ? rr(.6, 1) : rr(0, north ? .6 : .3);
      if (k === 0 || f1 + f2 > .25) B.poly([add3(P(a), off), add3(P(b), off), add3(P(lerpQ(b, c, f1)), off), add3(P(lerpQ(a, d, f2)), off)], h, fc, p, -.08 + (R() - .5) * .1, -1, EXAG);
    }
    // a lichen spot (the stone a tone lighter: its own family and part, no seam round it)
    if (k >= 1 && R() < S.lichen) {
      const u0 = rr(.25, .75), w0 = rr(.25, .75), rU = rr(.12, .24), rW = rr(.1, .2), at = (u, w) => add3(P(lerpQ(lerpQ(a, b, u), lerpQ(d, c, u), w)), off);
      const n = 5 + (R() * 3 | 0), poly = [];
      for (let j = 0; j < n; j++) { const an = j / n * Math.PI * 2, m = rr(.6, 1); poly.push(at(clamp(u0 + Math.cos(an) * rU * m, 0, 1), clamp(w0 + Math.sin(an) * rW * m, 0, 1))); }
      B.poly(poly, h, fam, p, fb + rr(.38, .55), -1, EXAG);
    }
  }
  // the top
  const cen = top.reduce((s, q) => [s[0] + q[0] / N, s[1] + q[1] / N, s[2] + q[2] / N], [0, 0, 0]);
  const capH = S.capH ?? rr(.12, .26), sd = R() * Math.PI * 2;
  if (S.cap === 'flat') {   // a bevel round a flat top (the lintel's seat, a slab's end)
    const I = top.map(q => [cen[0] + (q[0] - cen[0]) * .82, cen[1] + .035 + (R() - .5) * .01, cen[2] + (q[2] - cen[2]) * .82]);
    for (let i = 0; i < N; i++) { const a = top[i], b = top[(i + 1) % N], h = D([(a[0] + b[0]) / 2 - cen[0], .7, (a[2] + b[2]) / 2 - cen[2]]); B.poly([P(a), P(b), (P(I[(i + 1) % N])), (P(I[i]))], h, fam, p, S.tone + .04, -1, EXAG); }
    B.poly(I.map(P), D([0, 1, 0]), fam, p, S.tone + .06);
  } else if (S.cap === 'snap') {   // broken off: a jagged fan, fresher (lighter) stone
    const c = [cen[0] + (R() - .5) * .1, cen[1] + rr(-.08, .1), cen[2] + (R() - .5) * .1];
    for (let i = 0; i < N; i++) { const a = top[i], b = top[(i + 1) % N], h = D([(a[0] + b[0]) / 2 - c[0], .9, (a[2] + b[2]) / 2 - c[2]]); B.poly([(P(a)), (P(b)), (P(c))], h, fam, p, S.tone + .1 + (R() - .5) * .14, -1, EXAG); }
  } else {   // a dome (shoulders and a top facet) or slanted (one side higher: the top facet tilted)
    const tx = Math.cos(sd), tz = Math.sin(sd);
    const I = top.map(q => {
      const dx = q[0] - cen[0], dz = q[2] - cen[2], dl = Math.hypot(dx, dz) || 1;
      const up = S.cap === 'slant' ? capH * (.15 + 1.5 * Math.max(0, (dx * tx + dz * tz) / dl)) : capH * (.75 + (R() - .5) * .3);
      return [cen[0] + dx * rr(.5, .62), cen[1] + up, cen[2] + dz * rr(.5, .62)];
    });
    for (let i = 0; i < N; i++) { const a = top[i], b = top[(i + 1) % N], h = D([(a[0] + b[0]) / 2 - cen[0], .8, (a[2] + b[2]) / 2 - cen[2]]); B.poly([P(a), P(b), (P(I[(i + 1) % N])), (P(I[i]))], h, fam, p, S.tone + (R() - .5) * .1, -1, EXAG); }
    B.poly(I.map(q => (P(q))), D([0, 1, 0]), fam, p, S.tone + .05);
  }
  // a lying stone's exposed foot: broken off rough (a low fan) or flat
  if (S.foot) {
    const f = rings[0], fcen = f.reduce((s, q) => [s[0] + q[0] / N, s[1] + q[1] / N, s[2] + q[2] / N], [0, 0, 0]);
    if (S.foot === 'snap') { const c = [fcen[0] + (R() - .5) * .08, fcen[1] - rr(.02, .12), fcen[2] + (R() - .5) * .08]; for (let i = 0; i < N; i++) { const a = f[i], b = f[(i + 1) % N]; B.poly([P(a), P(b), P(c)], D([(a[0] + b[0]) / 2 - c[0], -.9, (a[2] + b[2]) / 2 - c[2]]), fam, p, S.tone + .08, -1, EXAG); } }
    else B.poly(f.map(P), D([0, -1, 0]), fam, p, S.tone);
  }
  return hi;
}

export function stoneMeshes(props, o, ground = () => 0) {
  if (!STONES_ON) return [];
  const fs = o.fam('stone'), fc = o.cover ?? null, out = [], byK = new Map();
  for (const p of props) if (p.kind === 'menhir' && (p.variant | 0) < 100) byK.set(p.variant | 0, p);
  const sinks = new Map(), tops = new Map(), pieceHi = [], seatTop = [];
  const sinkOf = k => { let B = sinks.get(k); if (!B) sinks.set(k, B = sink()); return B; };
  const M = mason(97, o);   // (its moss on the flat tops, its fallen chips)
  for (const [i, P] of PIECES.entries()) {
    if (!byK.has(P.prop)) continue;
    const B = sinkOf(P.prop), R = mulberry32(P.seed * 7919 + 5), tone = (R() - .5) * .16 + (R() < .2 ? .14 : 0);
    let hi;
    if (P.kind === 'stand') {
      // standing: the foot sunk under the lowest ground round it, its height from the highest (it stands on a slope a little)
      let g0 = 1e9, g1 = -1e9;
      for (let i = 0; i < 8; i++) { const an = i / 8 * Math.PI * 2, x = P.at[0] + (P.u[0] * Math.cos(an) * P.a + P.w[0] * Math.sin(an) * P.b), y = P.at[1] + (P.u[1] * Math.cos(an) * P.a + P.w[1] * Math.sin(an) * P.b), g = ground(x, y); g0 = Math.min(g0, g); g1 = Math.max(g1, g); }
      const S = {c: [P.at[0], g1, P.at[1]], U: [P.u[0], 0, P.u[1]], V: UP, W: [P.w[0], 0, P.w[1]], a: P.a, b: P.b, len: P.h, sinkD: g1 - g0 + .3,
        taper: P.taper, lean: P.lean, cap: P.cap, capH: P.cap === 'flat' ? 0 : undefined, fam: fs, part: B.part(), tone, north: [0, 0, -1], lichen: .22};
      hi = monolith(B, S, R, fc);
      if (P.cap === 'flat') seatTop.push(hi);
      if (P.cap === 'snap') for (let n = 0; n < 3 + (R() * 3 | 0); n++) { const an = R() * Math.PI * 2, d = .55 + R() * .75; M.fallen(B, P.at[0] + Math.cos(an) * d, P.at[1] + Math.sin(an) * d, ground, .6 + R() * .4); }
    } else if (P.kind === 'lie') {
      // lying: along dir from its foot, following the ground between its ends, half sunk (an altar a little less)
      const l = Math.hypot(...P.dir), dx = P.dir[0] / l, dy = P.dir[1] / l, ex = P.at[0] + dx * P.len, ey = P.at[1] + dy * P.len;
      const sinkK = P.altar ? .12 : .45, ga = ground(P.at[0], P.at[1]), gb = ground(ex, ey), gm = ground((P.at[0] + ex) / 2, (P.at[1] + ey) / 2);
      const lift = Math.max(0, gm - (ga + gb) / 2), y0 = ga + lift + P.b * (1 - sinkK * 2), y1 = gb + lift + P.b * (1 - sinkK * 2);
      const V = nrm3([ex - P.at[0], y1 - y0, ey - P.at[1]]), across = [-dy, 0, dx], cr = Math.cos(P.roll), sr = Math.sin(P.roll);
      let W = nrm3(cross(V, across)); if (W[1] < 0) W = v3(W, -1);
      const U = nrm3(add3(v3(across, cr), v3(W, sr))), W2 = nrm3(add3(v3(W, cr), v3(across, -sr)));
      const S = {c: [P.at[0], y0, P.at[1]], U, V, W: W2, a: P.a, b: P.b, len: P.len, sinkD: 0, taper: P.taper ?? .97, bulge: P.altar ? .03 : .08, lean: [0, 0], wob: P.altar ? 1.5 : 3,
        cap: P.cap, capH: P.altar ? .07 : .1, foot: P.foot, fam: fs, part: B.part(), tone: tone - (P.altar ? 0 : .05), north: [0, -1, 0], lichen: .3,
        rings: P.altar ? [0, .22, .5, .78, 1] : undefined};
      hi = monolith(B, S, R, fc);
      if (P.altar && fc !== null) M.moss({x: (P.at[0] + ex) / 2 + dx * .25, z: (P.at[1] + ey) / 2 + dy * .25, u: [dx, 0, dy], w: across, l: P.len * .36, d: P.a * 1.2, y: hi - .03, B, cope: false, broken: true}, 31);
    } else if (P.kind === 'lintel') {
      // across the uprights' seats (the two pieces above), resting on the lower one's top, overhanging both a little
      const L = (OPEN + 4 * .43) + .26, y = Math.min(...seatTop) - .02, b = .24;
      const S = {c: [GATE[0] - ACROSS[0] * L / 2, y + b, GATE[1] - ACROSS[1] * L / 2], U: [SUN[0], 0, SUN[1]], V: nrm3([ACROSS[0], (Math.max(...seatTop) - Math.min(...seatTop)) / L * .5, ACROSS[1]]), W: UP,
        a: .3, b, len: L, sinkD: 0, taper: .94, bulge: .03, lean: [0, 0], cap: 'flat', capH: 0, foot: 'flat', fam: fs, part: B.part(), tone, north: [0, -1, 0], lichen: .25,
        rings: [0, .25, .5, .75, 1]};
      S.W = nrm3(cross(S.V, S.U)); if (S.W[1] < 0) S.W = v3(S.W, -1);
      hi = monolith(B, S, R, fc);
      if (fc !== null) M.moss({x: GATE[0], z: GATE[1], u: [ACROSS[0], 0, ACROSS[1]], w: [SUN[0], 0, SUN[1]], l: L * .7, d: .64, y: hi - .03, B, cope: false, broken: true}, 13);
    }
    tops.set(P.prop, Math.max(tops.get(P.prop) ?? -1e9, hi)); pieceHi[i] = hi;
  }
  for (const p of props) {
    if (p.kind !== 'menhir' && p.kind !== 'menhir_part') continue;
    const k = p.variant | 0, B = k < 100 ? sinks.get(k) : null, t = k < 100 ? tops.get(k) : pieceHi[k - 100];   // (100 + i: a lying piece's collider)
    out.push({p, geo: B ? B.geometry() : null, top: t === undefined ? .5 : Math.max(.2, t - (p.z || 0))});
  }
  return out;
}
