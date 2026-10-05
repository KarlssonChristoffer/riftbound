// BELLS AND PLATES' 3D MODELS (features/bells.js): kit3d geometries in the world's style, like the trick-shot range's
// (features/trickshot/models.js): the biome's ramps tone the wood; the brass bells ('gold') and the steel ('ash': a fixed
// grey ramp, dark with a bright worn edge) keep their own; moss / snow / ash settle on what faces up.
// Three's frame: X east, Y up, Z south (world x, h, y).
//   SHAPE              the sizes the sim and the view share (m)
//   bellR(note)        a bell's radius by its note (low notes are bigger bells)
//   bellHitR(note)     the radius of the sim's sphere (sim/projectiles.js deflector: what a shot glances off)
//   bellDrop(note)     m from the pivot (the arm's hook) down to the bell's middle (the sphere's centre)
//   plateBasis(yaw, tilt) -> {nx, ny, nh, ux, uy, uh, vx, vy, vh}: a plate's normal and its face's axes (world x, y, h)
//   standsGeometry(stands) -> one geometry: every post, plate and gallows in world coordinates (one static mesh)
//   bellGeometry(note) -> the bell hanging from its pivot (the origin): the strap, the bell, the clapper (cached per note)
import * as THREE from 'three';
import {geoOf, M4, box, along} from '../../world/kit3d.js';

export const SHAPE = {
  plate: {w: .54, h: .48, t: .035, mid: 1.25, post: .08, edge: .028},   // mid: its middle over the ground (the aim's chest height: player.js AIM_H)
  bell: {r: [.24, .17], hk: 1.12, strap: .07, arm: .52, post: .08, notes: 7, mid: 1.28, hit: .8},   // r: the lowest note's .. the highest's; hk: its height x r;
  // mid: its middle over the ground (a free bell); hit: the sim's sphere x r (its waist; the lip flares past it)
};
export const bellR = note => SHAPE.bell.r[0] + (SHAPE.bell.r[1] - SHAPE.bell.r[0]) * note / (SHAPE.bell.notes - 1);
export const bellHitR = note => bellR(note) * SHAPE.bell.hit;
export const bellDrop = note => SHAPE.bell.strap + bellR(note) * SHAPE.bell.hk * .58;

export function plateBasis(yaw, tilt, o = {}) {
  const ct = Math.cos(tilt), st = Math.sin(tilt), cy = Math.cos(yaw), sy = Math.sin(yaw);
  o.nx = ct * cy; o.ny = ct * sy; o.nh = st;            // the normal (tilted up by `tilt`)
  o.ux = -sy; o.uy = cy; o.uh = 0;                      // along the face, level
  o.vx = -st * cy; o.vy = -st * sy; o.vh = ct;          // up the face
  return o;
}

// a small deterministic jitter for the timber (the same model every time)
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const _M = new THREE.Matrix4(), _U = new THREE.Vector3(), _V = new THREE.Vector3(), _N = new THREE.Vector3();
const inFrame = (M, part) => { part.m = M.clone().multiply(part.m); return part; };

// a plate on its post: two crossed feet, the post, a bracket, the steel plate (dark, a bright worn edge, a scuffed middle)
function plateStand(L, s, r) {
  const P = SHAPE.plate, x = s.x, y = s.y, z = s.z, top = P.mid - P.h / 2 - .01;
  const fa = r() * Math.PI;
  for (const a of [fa, fa + Math.PI / 2]) L.push(box('wood', [.46, .05, .08], [x, z + .025, y], [0, a, 0], {bias: -.1}));
  L.push(box('wood', [P.post, top + .02, P.post], [x, z + (top + .02) / 2, y], [(r() - .5) * .03, r() * 6, (r() - .5) * .03], {bias: -.05}));
  L.push(box('metal', [P.post + .03, .06, P.post + .03], [x, z + top - .03, y], [0, s.yaw, 0], {bias: .1}));
  // the plate, in its own frame: X along the face, Y up it, Z its normal
  const b = s.basis;
  _U.set(b.ux, b.uh, b.uy); _V.set(b.vx, b.vh, b.vy); _N.crossVectors(_U, _V);
  const M = _M.makeBasis(_U, _V, _N).setPosition(x, z + P.mid, y);
  L.push(inFrame(M, box('ash', [P.w, P.h, P.t], [0, 0, 0], [0, 0, 0], {bias: -.3})));
  const e = P.edge, hw = P.w / 2, hh = P.h / 2;
  for (const sy of [-1, 1]) L.push(inFrame(M, box('ash', [P.w + .004, e, P.t + .006], [0, sy * (hh - e / 2), 0], [0, 0, 0], {fixed: 0})));
  for (const sx of [-1, 1]) L.push(inFrame(M, box('ash', [e, P.h - 2 * e, P.t + .006], [sx * (hw - e / 2), 0, 0], [0, 0, 0], {fixed: 0})));
  for (const sz of [-1, 1]) L.push(inFrame(M, box('ash', [P.w * .42, P.h * .38, .004], [(r() - .5) * .06, (r() - .5) * .05, sz * (P.t / 2 + .002)], [0, 0, (r() - .5) * .6], {fixed: 1})));
  for (const sx of [-1, 1]) L.push(inFrame(M, box('void', [.022, .022, P.t + .012], [sx * .06, -hh + .05, 0], [0, 0, 0], {fixed: 1})));   // the bolts to the bracket
}
// a bell's gallows: feet, the post, the arm out over the bell, a brace, the hook (the bell is a mesh of its own: it swings)
function gallows(L, s, r) {
  const B = SHAPE.bell, qx = s.px, qy = s.py, z = s.pz, top = s.pivot + .08 - z;   // the post's top over its own ground
  const fa = r() * Math.PI;
  for (const a of [fa, fa + Math.PI / 2]) L.push(box('wood', [.56, .05, .09], [qx, z + .025, qy], [0, a, 0], {bias: -.1}));
  L.push(box('wood', [B.post, top, B.post], [qx, z + top / 2, qy], [(r() - .5) * .02, r() * 6, (r() - .5) * .02], {bias: -.05}));
  const ax = s.x - qx, ay = s.y - qy, al = Math.hypot(ax, ay) || 1, ux = ax / al, uy = ay / al, ya = Math.atan2(-uy, ux);
  const armL = al + .1, armY = z + top - .04;
  L.push(box('wood', [armL, .07, .07], [qx + ux * (armL / 2 - .04), armY, qy + uy * (armL / 2 - .04)], [0, ya, 0], {bias: .12}));
  L.push({...along([qx + ux * .03, armY - .32, qy + uy * .03], [qx + ux * .3, armY - .03, qy + uy * .3], .022, .022, 4), fam: 'wood', bias: .05});   // the brace
  L.push(box('metal', [.05, .05, .05], [s.x, s.pivot + .02, s.y], [0, ya, 0], {bias: .1}));   // the hook's block
}
export function standsGeometry(stands) {
  const L = [], r = rng(4447);
  for (const s of stands) if (s.kind === 'plate') plateStand(L, s, r); else gallows(L, s, r);
  return L.length ? geoOf(L) : null;
}

// the bell, hanging from the origin (its pivot): a strap, a crown loop, the brass body (a lathe: shoulder, waist, a flared
// lip with a bright band), the clapper's ball just under the mouth
const bellCache = new Map();
export function bellGeometry(note) {
  if (bellCache.has(note)) return bellCache.get(note);
  const B = SHAPE.bell, R = bellR(note), H = R * B.hk, y0 = -B.strap, L = [];
  L.push(box('metal', [.026, B.strap + .01, .012], [0, -B.strap / 2, 0], [0, 0, 0], {bias: .05}));
  L.push({g: new THREE.TorusGeometry(R * .2, R * .07, 4, 8), m: M4([0, y0 + R * .06, 0]), fam: 'gold', bias: .1});
  // the profile, top down: [radius x R, depth x H]
  const prof = [[0, 0], [.42, 0], [.56, -.06], [.63, -.22], [.66, -.45], [.73, -.66], [.86, -.82]], lip = [[.86, -.82], [.99, -.93], [1.04, -1], [.9, -1.01]];
  const lathe = (pts, fam, o) => ({g: new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a * R, y0 + b * H)), 12), m: M4([0, 0, 0]), fam, ...o});
  L.push(lathe([...prof].reverse(), 'gold', {bias: -.05}));
  L.push(lathe([...lip].reverse(), 'gold', {bias: .25}));
  L.push({g: new THREE.CircleGeometry(R * .9, 12), m: M4([0, y0 - H * 1.005, 0], [Math.PI / 2, 0, 0]), fam: 'void', fixed: 2});   // the dark mouth
  L.push({g: new THREE.SphereGeometry(R * .17, 6, 4), m: M4([0, y0 - H * .98, 0]), fam: 'metal', bias: -.1});   // the clapper's ball
  const geo = geoOf(L);
  bellCache.set(note, geo);
  return geo;
}
