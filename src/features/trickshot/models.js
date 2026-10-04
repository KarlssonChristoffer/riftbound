// TRICK-SHOT RANGE'S 3D MODELS (features/trickshot.js): kit3d geometries in the world's style (the biome's ramps tone the
// wood and the iron; red and gold keep their own; moss / snow / ash settle on what faces up). Local frame: x east, y up,
// z south; the front faces +z (the default camera). Built once: the families are resolved in the shader, so one geometry
// serves every biome. Sizes are a little larger than life where the pixel scale needs it (a can is ~4 px across).
//   buildModels() -> {yard (the fence, the crate and the plate's frame in one static piece, at the range's anchor),
//     plate (the hanging steel plate: its pivot at the origin, the top of its chains), bottle: {amber, green}, can}
//   SHAPE: the pieces' sizes and where they stand (m, from the range's anchor: the fence's middle)
import * as THREE from 'three';
import {geoOf, M4, box, along} from '../../world/kit3d.js';

export const SHAPE = {
  fence: {half: 1.72, top: .96, posts: [-1.66, 0, 1.66], rails: [.46, .93]},       // the rail's top: the bottles stand on it
  bottles: [-1.36, -.82, -.28, .28, .82, 1.36],                                       // x along the rail
  bottle: {r: .055, h: .32},
  crate: {x: 2.5, y: .35, w: .62, d: .5, h: .6},                                    // the cans' crate (its top: the stack)
  stack: [[-.13, 0, 0], [.13, 0, 0], [0, 0, 1]],                                       // [dx, dy, row] on the crate's top
  can: {r: .068, h: .155},
  plate: {x: -2.4, y: .3, w: .46, h: .46, t: .025, pivot: 1.12, drop: .14, posts: .36, top: 1.24},   // the steel plate: its frame's posts at +-posts, beam at top
  mark: {x: 0, y: 4.5, w: 1.4},                                                       // the shooting mark on the ground
};

// a small deterministic generator for the timber's jitter (the same model every time)
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const cyl = (fam, rt, rb, h, pos, rot = [0, 0, 0], o = {}) => ({g: new THREE.CylinderGeometry(rt, rb, h, o.seg ?? 8), m: M4(pos, rot), fam, ...o});

// the fence (posts, two rails), the cans' crate, the plate's frame: one static piece
function yard() {
  const L = [], r = rng(97), F = SHAPE.fence, C = SHAPE.crate, Pl = SHAPE.plate;
  for (const x of F.posts) L.push(box('wood', [.09, F.top + .07, .09], [x, (F.top + .07) / 2, 0], [(r() - .5) * .05, (r() - .5) * .3, (r() - .5) * .05], {bias: -.05}));
  for (const [i, y] of F.rails.entries()) L.push(box('wood', [F.half * 2, .06, .05], [0, y, .045], [0, 0, (r() - .5) * .012], {bias: i ? .15 : 0}));
  // the crate: a box of boards with a frame round its faces, two iron bands
  const cx = C.x, cz = C.y, hw = C.w / 2, hd = C.d / 2;
  L.push(box('wood', [C.w - .04, C.h - .02, C.d - .04], [cx, C.h / 2, cz], [0, 0, 0], {bias: -.05}));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.push(box('wood', [.05, C.h, .05], [cx + sx * (hw - .025), C.h / 2, cz + sz * (hd - .025)], [0, 0, 0], {bias: .1}));
  for (const y of [.03, C.h - .03]) for (const sz of [-1, 1]) L.push(box('wood', [C.w, .05, .05], [cx, y, cz + sz * (hd - .025)], [0, 0, 0], {bias: .1}));
  for (const y of [.03, C.h - .03]) for (const sx of [-1, 1]) L.push(box('wood', [.05, .05, C.d], [cx + sx * (hw - .025), y, cz], [0, 0, 0], {bias: .1}));
  for (const y of [.2, .42]) L.push(box('metal', [C.w + .01, .03, C.d + .01], [cx, y, cz], [0, 0, 0], {bias: .2}));
  L.push(box('void', [C.w - .1, .01, C.d - .1], [cx, C.h - .004, cz], [0, 0, 0], {fixed: 0}));   // the open top: dark inside
  // the plate's frame: two posts and a beam; the plate hangs from it (a mesh of its own: it swings)
  const px = Pl.x, pz = Pl.y;
  for (const sx of [-1, 1]) L.push(box('wood', [.08, Pl.top, .08], [px + sx * Pl.posts, Pl.top / 2, pz], [0, 0, sx * .03], {bias: -.05}));
  L.push(box('wood', [Pl.posts * 2 + .2, .08, .09], [px, Pl.top - .03, pz], [0, 0, 0], {bias: .15}));
  for (const sx of [-1, 1]) L.push(box('wood', [.05, .3, .05], [px + sx * (Pl.posts - .12), Pl.top - .2, pz], [0, 0, sx * .7], {bias: .05}));   // braces
  return geoOf(L);
}
// the steel plate: two chains down from the beam, the plate (a rusty face, a pale scuffed middle where the shots land)
function plate() {
  const L = [], P = SHAPE.plate, y0 = -P.drop - P.h / 2;
  for (const sx of [-1, 1]) L.push({...along([sx * .14, 0, 0], [sx * .16, -P.drop, 0], .012, .012, 4), fam: 'metal', bias: .1});
  L.push(box('metal', [P.w, P.h, P.t], [0, y0, 0], [0, 0, 0], {bias: -.05}));
  L.push(box('metal', [P.w * .55, P.h * .55, .006], [0, y0, P.t / 2 + .002], [0, 0, 0], {fixed: 0}));   // the bright, shot-scuffed middle
  for (const sx of [-1, 1]) L.push(cyl('void', .018, .018, .01, [sx * .16, -P.drop - .02, P.t / 2 + .004], [Math.PI / 2, 0, 0], {seg: 6, fixed: 1}));   // the bolts
  return geoOf(L);
}
// a bottle standing on its base (the origin): a body, a shoulder, a neck, a lip; a glint down its front
function bottle(fam) {
  const B = SHAPE.bottle, L = [], hb = B.h * .6;
  L.push(cyl(fam, B.r, B.r * .96, hb, [0, hb / 2, 0], [0, 0, 0], {seg: 8, bias: -.1}));
  L.push(cyl(fam, B.r * .45, B.r, .055, [0, hb + .0275, 0], [0, 0, 0], {seg: 8}));
  L.push(cyl(fam, B.r * .4, B.r * .45, B.h - hb - .07, [0, hb + .055 + (B.h - hb - .07) / 2, 0], [0, 0, 0], {seg: 6, bias: .1}));
  L.push(cyl(fam, B.r * .52, B.r * .52, .018, [0, B.h - .009, 0], [0, 0, 0], {seg: 6, bias: .2}));
  L.push(box(fam, [.012, hb * .7, .01], [-B.r * .45, hb * .55, B.r * .85], [0, 0, 0], {fixed: 0}));   // the glint
  return geoOf(L);
}
// a tin can about its middle (it tumbles round it): the tin, a red label round the middle, the rims
function can() {
  const C = SHAPE.can, L = [];
  L.push(cyl('metal', C.r, C.r, C.h, [0, 0, 0], [0, 0, 0], {seg: 10, bias: .05}));
  L.push(cyl('red', C.r + .003, C.r + .003, C.h * .56, [0, -.005, 0], [0, 0, 0], {seg: 10, bias: .05}));
  for (const s of [-1, 1]) L.push(cyl('metal', C.r + .004, C.r + .004, .012, [0, s * (C.h / 2 - .006), 0], [0, 0, 0], {seg: 10, bias: .25}));
  L.push(cyl('void', C.r * .8, C.r * .8, .004, [0, C.h / 2 + .001, 0], [0, 0, 0], {seg: 10, fixed: 2}));   // the open top
  return geoOf(L);
}

let built = null;
export function buildModels() {
  return built ??= {yard: yard(), plate: plate(), bottle: {amber: bottle('gold'), green: bottle('berryGreen')}, can: can()};
}
