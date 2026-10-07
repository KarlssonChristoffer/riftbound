// FRONTIER MODELS: the frontier dressing's pieces as part lists for kit3d.geoOf (features/frontier.js places them):
// chunky low-poly shapes in the props' style, toned on the GPU by the biome's families (wood, metal = rusted iron,
// ash = galvanised grey, stone, rock, rope, cover = canvas / sand, bark = darker wood, red, void = a dark opening).
// Each builder works in its own frame: x east, y up, z south (the arena's y), metres, origin on the ground at the piece's
// foot unless it says otherwise. Nothing here touches the world or Math.random (ART.rng, seeded, for the odd jitter).
//   beam(fam, a, b, w, d?, o?)    a box from point a to point b (w x d across)
//   flip(geometry)                the same surface seen from inside (an inner wall, a canvas's lining)
//   at(parts, matrix)             parts moved into a parent frame
//   millTower / millRod / millHead / millWheel, stockTank, waterTower, wagon, wheel, hitchRail, trough, wantedBoard,
//   signpost, fence, well, outhouse, minePortal, oreCart: part lists
import * as THREE from 'three';
import {M4, box, along} from '../../world/kit3d.js';
import {ART} from '../../world/biomes.js';

const TAU = Math.PI * 2, PI = Math.PI;
const UP = new THREE.Vector3(0, 1, 0);

export function beam(fam, a, b, w, d = w, o = {}) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), dir = B.clone().sub(A), len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.divideScalar(len));
  return {g: new THREE.BoxGeometry(w, len, d), m: new THREE.Matrix4().compose(A.add(B).multiplyScalar(.5), q, new THREE.Vector3(1, 1, 1)), fam, ...o};
}
const rod = (fam, a, b, r, o = {}, seg = 6) => ({...along(a, b, r, r, seg), fam, ...o});
// a cylinder standing on y (r0 at the bottom, r1 at the top), centred at pos
const cyl = (fam, r0, r1, h, pos, rot = [0, 0, 0], seg = 10, o = {}, open = false) => ({g: new THREE.CylinderGeometry(r1, r0, h, seg, 1, open), m: M4(pos, rot), fam, ...o});
const ring = (fam, r, tube, pos, rot, o = {}, seg = 20, rs = 4) => ({g: new THREE.TorusGeometry(r, tube, rs, seg), m: M4(pos, rot), fam, ...o});
export function flip(g) {
  const n = g.index ? g.toNonIndexed() : g, P = n.attributes.position.array, N = n.attributes.normal.array;
  for (let i = 0; i < P.length; i += 9) for (let k = 0; k < 3; k++) {
    let t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t;
    t = N[i + 3 + k]; N[i + 3 + k] = N[i + 6 + k]; N[i + 6 + k] = t;
  }
  for (let i = 0; i < N.length; i++) N[i] = -N[i];
  return n;
}
export function at(parts, m) { for (const q of parts) q.m.premultiply(m); return parts; }

// ================================================================ the windmill (a water pumper): tower, head, wheel, rod
// The tower is wood (four legs tapering from 1.6 m to .5 m, girts and cross braces, a deck, a ladder on its south
// face), the pump stands at its foot with a spout reaching the stock tank (MILL.tank: the tank's centre from the tower's),
// the pump rod runs up the middle. The head turns on the tower's top (its own frame: y 0 = the deck; +x = downwind, the
// tail; the wheel on -x), the wheel spins about its shaft (its own frame: the hub at 0, the shaft along x)
export const MILL = {H: 5, hub: [-.64, .3, 0], tank: [.75, 1.75], wheelR: 1.15, blades: 18};
export function millTower() {
  const L = [], H = MILL.H, o = h => .8 - .55 * h / H;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    L.push(beam('wood', [sx * .8, 0, sz * .8], [sx * .25, H, sz * .25], .12, .12, {bias: -.05}));
    L.push(box('stone', [.3, .18, .3], [sx * .8, .05, sz * .8], [0, .2 * sx * sz, 0], {bias: -.15}));   // footings
  }
  const corners = (f, h) => { const q = o(h); return [[[-q, h, q], [q, h, q]], [[-q, h, -q], [q, h, -q]], [[q, h, -q], [q, h, q]], [[-q, h, -q], [-q, h, q]]][f]; };
  const LV = [.35, 1.55, 2.75, 3.9, 4.86];
  for (let f = 0; f < 4; f++) {
    for (const h of LV) { const [a, b] = corners(f, h); L.push(beam('wood', a, b, .07, .08, {bias: .05})); }
    for (let i = 0; i < LV.length - 1; i++) {
      const [a0, b0] = corners(f, LV[i]), [a1, b1] = corners(f, LV[i + 1]);
      L.push(beam('wood', a0, b1, .045, .045, {bias: -.08}));
      if (i < 2) L.push(beam('wood', b0, a1, .045, .045, {bias: -.08}));   // X braces low, a zig-zag higher up
    }
  }
  for (let i = 0; i < 4; i++) L.push(box('wood', [1.05, .05, .24], [0, 4.93, -.36 + i * .24], [0, 0, 0], {bias: .2 - (i & 1) * .1}));   // the deck
  for (const sx of [-1, 1]) L.push(beam('wood', [sx * .19, 0, o(0) + .08], [sx * .19, 4.9, o(4.9) + .08], .045, .05));   // ladder
  for (let h = .32; h < 4.8; h += .34) L.push(beam('wood', [-.19, h, o(h) + .08], [.19, h, o(h) + .08], .03, .03, {bias: .15}));
  // the pump at the foot: the standpipe, its head, the spout over the tank
  L.push(cyl('metal', .07, .07, .95, [0, .47, 0], [0, 0, 0], 8));
  L.push(box('metal', [.16, .12, .16], [0, .98, 0], [0, 0, 0], {bias: .1}));
  L.push(rod('metal', [0, .74, 0], [.6, .6, 1.05], .032));   // (out through the south face east of the ladder)
  L.push(rod('metal', [.6, .6, 1.05], [.62, .5, 1.1], .028));
  return L;
}
export function millRod() { return [rod('metal', [0, 1.02, 0], [0, MILL.H + .2, 0], .022)]; }
export function millHead() {
  const L = [];
  L.push(cyl('ash', .17, .17, .08, [0, .04, 0], [0, 0, 0], 10));
  L.push(box('ash', [.52, .26, .28], [-.06, .25, 0], [0, 0, 0], {bias: .1}));
  L.push(box('ash', [.3, .06, .3], [-.02, .41, 0], [0, 0, 0], {bias: .25}));   // the gearbox's lid
  L.push(rod('ash', [-.3, MILL.hub[1], 0], [MILL.hub[0] + .06, MILL.hub[1], 0], .035));
  for (const sz of [-1, 1]) L.push(rod('ash', [.18, .3, sz * .07], [1.45, .44, 0], .022));   // the tail's boom
  L.push(rod('ash', [.18, .18, 0], [1.4, .38, 0], .018));
  L.push(box('ash', [1.05, .62, .025], [1.95, .44, 0], [0, 0, .03], {bias: -.05}));               // the vane
  L.push(box('red', [1.02, .1, .03], [1.95, .44, 0], [0, 0, .03], {bias: -.1}));                   // its painted band
  return L;
}
export function millWheel() {
  const L = [], R = MILL.wheelR, rotX = [0, PI / 2, 0];
  L.push(cyl('metal', .1, .1, .2, [0, 0, 0], [0, 0, PI / 2], 8, {bias: .1}));
  L.push(ring('metal', .4, .022, [-.02, 0, 0], rotX, {}, 18, 3));
  L.push(ring('metal', .78, .018, [-.04, 0, 0], rotX, {}, 24, 3));
  L.push(ring('metal', R, .026, [-.06, 0, 0], rotX, {bias: .1}, 28, 3));
  for (let k = 0; k < 6; k++) { const a = k * TAU / 6 + .26; L.push(rod('metal', [0, Math.cos(a) * .1, Math.sin(a) * .1], [-.06, Math.cos(a) * R, Math.sin(a) * R], .016)); }
  for (let k = 0; k < MILL.blades; k++) {
    const a = k * TAU / MILL.blades, rm = (.42 + R - .02) / 2;
    L.push(box('ash', [.014, R - .44, .22], [-.04, Math.cos(a) * rm, Math.sin(a) * rm], [a, .55, 0], {bias: k & 1 ? .4 : .3}));   // (lifted: the sheet is bright even edge on)
  }
  return L;
}
// the stock tank: a round galvanised trough (the water is the feature's painted face at y .46, inside the lining)
export const TANK = {r: .85, h: .56, water: .46};
export function stockTank() {
  return [
    {g: new THREE.CylinderGeometry(TANK.r, TANK.r, TANK.h, 22, 1, true), m: M4([0, TANK.h / 2, 0]), fam: 'ash'},
    ring('ash', TANK.r - .005, .03, [0, TANK.h, 0], [PI / 2, 0, 0], {bias: .25}, 22, 3),
    {g: flip(new THREE.CylinderGeometry(TANK.r - .035, TANK.r - .035, TANK.h - TANK.water + .02, 22, 1, true)), m: M4([0, (TANK.h + TANK.water) / 2, 0]), fam: 'ash', fixed: 2},
  ];
}

// ================================================================ the water tower: a stave tank on a timber frame
export function waterTower() {
  const L = [], r = ART.rng(41), H = 3.2, o = h => 1.0 - .15 * h / H;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    L.push(beam('wood', [sx * 1.0, 0, sz * 1.0], [sx * .85, H, sz * .85], .2, .2, {bias: -.05}));
    L.push(box('stone', [.36, .16, .36], [sx * 1.0, .04, sz * 1.0], [0, .3, 0], {bias: -.15}));
  }
  const corners = (f, h) => { const q = o(h); return [[[-q, h, q], [q, h, q]], [[-q, h, -q], [q, h, -q]], [[q, h, -q], [q, h, q]], [[-q, h, -q], [-q, h, q]]][f]; };
  const LV = [.2, 1.1, 2.2, 3.1];
  for (let f = 0; f < 4; f++) {
    for (const h of LV.slice(1)) { const [a, b] = corners(f, h); L.push(beam('wood', a, b, .1, .12, {bias: .05})); }
    for (let i = 0; i < LV.length - 1; i++) {
      const [a0, b0] = corners(f, LV[i]), [a1, b1] = corners(f, LV[i + 1]);
      L.push(beam('wood', a0, b1, .06, .06, {bias: -.1}), beam('wood', b0, a1, .06, .06, {bias: -.1}));
    }
  }
  for (let i = 0; i < 6; i++) L.push(box('wood', [2.4, .07, .38], [0, H + .1, -.98 + i * .392], [0, 0, 0], {bias: .2 - (i % 3) * .08}));   // the deck
  // the tank: 18 staves, three iron hoops, a shingled cone, a ball on top
  const N = 18, tr = 1.05, t0 = H + .14, th = 2.0;
  for (let i = 0; i < N; i++) {
    const a = i * TAU / N;
    L.push(box('wood', [tr * TAU / N + .01, th, .08], [Math.cos(a) * tr, t0 + th / 2, Math.sin(a) * tr], [0, PI / 2 - a, 0], {bias: (r() - .5) * .25}));
  }
  for (const h of [.3, 1.0, 1.7]) L.push(ring('metal', tr + .045, .024, [0, t0 + h, 0], [PI / 2, 0, 0], {bias: .1}, 24, 3));
  L.push({g: new THREE.ConeGeometry(tr + .22, .72, 12), m: M4([0, t0 + th + .36, 0], [0, .13, 0]), fam: 'bark', bias: .05});
  L.push({g: new THREE.IcosahedronGeometry(.08, 0), m: M4([0, t0 + th + .76, 0]), fam: 'metal'});
  // the spout: a pipe out of the tank's bottom (east side), its swing spout hanging down, a rope to pull it
  L.push(rod('metal', [.75, t0 + .1, .55], [1.35, t0 + .02, .95], .06), rod('metal', [1.35, t0 + .02, .95], [1.55, t0 - .9, 1.08], .05));
  L.push(rod('rope', [1.5, t0 - .85, 1.06], [1.45, .9, 1.1], .012));
  // the ladder: up the south face to the deck, then up the tank to the roof
  for (const sx of [-1, 1]) {
    L.push(beam('wood', [sx * .22, 0, o(0) + .12], [sx * .22, H + .1, o(H) + .12], .05, .06));
    L.push(beam('wood', [sx * .22, H + .14, tr + .12], [sx * .22, t0 + th + .05, tr + .12], .045, .05));
  }
  for (let h = .3; h < H; h += .32) L.push(beam('wood', [-.22, h, o(h) + .12], [.22, h, o(h) + .12], .035, .035, {bias: .15}));
  for (let h = H + .45; h < t0 + th; h += .32) L.push(beam('metal', [-.22, h, tr + .12], [.22, h, tr + .12], .025, .025));
  return L;
}

// ================================================================ a spoked wheel (plane x-y, axle along z)
export function wheel(r, {spokes = 12, missing = [], hub = .22} = {}) {
  const L = [];
  L.push(ring('wood', r - .045, .042, [0, 0, 0], [0, 0, 0], {bias: .05}, 22, 4));
  L.push(ring('metal', r - .004, .017, [0, 0, 0], [0, 0, 0], {bias: .1}, 22, 3));
  L.push(cyl('wood', .085, .085, hub, [0, 0, 0], [PI / 2, 0, 0], 8));
  L.push(cyl('metal', .095, .095, .04, [0, 0, hub / 2 - .03], [PI / 2, 0, 0], 8));
  for (let k = 0; k < spokes; k++) {
    if (missing.includes(k)) continue;
    const a = k * TAU / spokes;
    L.push(beam('wood', [Math.cos(a) * .08, Math.sin(a) * .08, 0], [Math.cos(a) * (r - .07), Math.sin(a) * (r - .07), 0], .035, .045));
  }
  return L;
}

// ================================================================ the covered wagon (front = +x); its rear south wheel
// is off, leaning on the bed, the axle propped on a crate; the tongue rests on the ground
export const WAGON = {rear: -1.0, front: 1.05, rr: .62, fr: .5, track: .68};
export function wagon() {
  const L = [], {rear, front, rr, fr, track} = WAGON, top = 1.48;
  L.push(box('wood', [3.0, .06, 1.1], [0, .95, 0], [0, 0, 0], {bias: .1}));
  for (const s of [-1, 1]) {
    L.push(box('wood', [3.0, .24, .05], [0, 1.1, s * .575], [0, 0, 0], {bias: -.05}), box('wood', [3.0, .24, .05], [0, 1.34, s * .575], [0, 0, 0], {bias: .05}));
    L.push(box('wood', [3.06, .05, .08], [0, top, s * .585], [0, 0, 0], {bias: .2}));
    for (const x of [-1.2, 0, 1.2]) L.push(box('bark', [.06, .5, .07], [x, 1.22, s * .6], [0, 0, 0]));   // the side cleats
  }
  for (const s of [-1, 1]) L.push(box('wood', [.05, .5, 1.2], [s * 1.5, 1.22, 0], [0, 0, 0], {bias: -.1}));
  // the bows and the canvas: four bays between five hoops, flaring ends gathered round a dark opening, the lining inside
  const HX = [-1.2, -.6, 0, .6, 1.2], KY = 1.62, R = .6;
  for (const x of HX) L.push({g: new THREE.TorusGeometry(R - .01, .022, 3, 14, PI), m: M4([x, top, 0], [0, PI / 2, 0], [1, KY, 1]), fam: 'bark'});   // (nearly flush: ribs, not spikes)
  const bay = (x0, x1, r0, r1, inner) => {
    const g = new THREE.CylinderGeometry(r1, r0, x1 - x0, 16, 1, true, PI, PI);
    return {g: inner ? flip(g) : g, m: M4([(x0 + x1) / 2, top, 0], [0, 0, -PI / 2], [KY, 1, 1]), fam: 'cover', ...(inner ? {fixed: 2} : {bias: inner === false ? 0 : .05})};
  };
  for (let i = 0; i < 4; i++) L.push(bay(HX[i], HX[i + 1], R - .02, R - .02), bay(HX[i], HX[i + 1], R - .045, R - .045, true));
  L.push(bay(-1.62, -1.2, .48, R - .02), bay(1.2, 1.62, R - .02, .48), bay(-1.62, -1.2, .46, R - .045, true), bay(1.2, 1.62, R - .045, .46, true));
  for (const x of [-1.62, 1.62]) L.push({g: new THREE.TorusGeometry(.47, .022, 3, 12, PI), m: M4([x, top, 0], [0, PI / 2, 0], [1, KY, 1]), fam: 'rope'});
  // the seat and the brake lever
  L.push(box('wood', [.34, .06, 1.0], [1.28, 1.6, 0], [0, 0, 0], {bias: .2}), box('wood', [.05, .3, 1.0], [1.12, 1.72, 0], [0, 0, -.2]));
  L.push(beam('metal', [1.45, .95, .62], [1.65, 1.75, .66], .035));
  // running gear: bolsters, axles, the reach, the tongue and its doubletree
  L.push(box('bark', [.14, .28, 1.1], [rear, .8, 0], [0, 0, 0]), box('bark', [.14, .22, 1.1], [front, .74, 0], [0, 0, 0]));
  L.push(beam('bark', [rear, rr, -track - .08], [rear, rr, track + .08], .09, .09), beam('bark', [front, fr, -track - .08], [front, fr, track + .08], .09, .09));
  L.push(beam('bark', [rear, rr - .02, 0], [front + .1, fr - .02, 0], .07, .07));
  L.push(beam('wood', [front + .15, fr, 0], [3.05, .06, 0], .075, .075), beam('wood', [2.98, .1, -.45], [2.98, .1, .45], .06, .06));
  // the wheels: three on, the rear south one leaning on the bed (its face to the south), the axle on a crate
  for (const [x, r, s] of [[rear, rr, -1], [front, fr, -1], [front, fr, 1]]) L.push(...at(wheel(r), M4([x, r, s * track])));
  L.push(...at(wheel(rr, {missing: [4]}), M4([-.2, rr * Math.cos(.44), .87], [-.44, .05, 0])));
  L.push(box('wood', [.46, .5, .46], [rear, .25, track - .02], [0, .25, 0], {bias: -.05}), box('wood', [.22, .08, .2], [rear, .54, track], [0, .1, 0], {bias: .2}));
  // a water barrel lashed on the south side, a bucket hanging from the rear axle
  L.push(cyl('wood', .19, .19, .5, [1.85, .25, .62], [0, 0, 0], 10, {bias: -.05}), ring('metal', .195, .015, [1.85, .11, .62], [PI / 2, 0, 0], {}, 12, 3), ring('metal', .195, .015, [1.85, .39, .62], [PI / 2, 0, 0], {}, 12, 3));
  L.push(cyl('wood', .1, .13, .22, [-1.35, .32, -.2], [0, 0, 0], 8), rod('rope', [-1.35, .43, -.2], [-1.32, .92, -.2], .01));
  return L;
}

// ================================================================ the hitching rail and its trough (long axis x)
export function hitchRail() {
  const L = [], r = ART.rng(53);
  for (const x of [-1.05, 0, 1.05]) L.push(box('wood', [.13, 1.06, .13], [x, .53, 0], [(r() - .5) * .06, (r() - .5) * .3, (r() - .5) * .06], {bias: -.05}));
  L.push(rod('wood', [-1.2, 1.0, 0], [1.2, .99, 0], .055, {bias: .1}, 7));
  for (const x of [-.55, .5]) L.push(ring('metal', .05, .011, [x, .92, .06], [0, 0, 0], {}, 8, 3));
  return L;
}
export const TROUGH = {w: 1.76, d: .5, water: .4};
export function trough() {
  const L = [], {w, d} = TROUGH;
  L.push(box('wood', [w - .08, .05, d - .08], [0, .1, 0], [0, 0, 0], {bias: .1}));
  for (const s of [-1, 1]) {
    L.push(box('wood', [w, .2, .05], [0, .19, s * (d / 2 - .025)], [0, 0, 0], {bias: -.05}), box('wood', [w, .2, .05], [0, .39, s * (d / 2 - .025)], [0, 0, 0], {bias: .05}));
    L.push(box('wood', [.05, .4, d - .1], [s * (w / 2 - .025), .29, 0], [0, 0, 0], {bias: -.1}));
    L.push(box('metal', [.04, .42, d + .02], [s * (w / 2 - .12), .29, 0], [0, 0, 0], {bias: .1}));   // iron bands
    L.push(box('bark', [.1, .1, d + .1], [s * .62, .05, 0], [0, 0, 0]));
  }
  return L;
}

// ================================================================ the wanted board (faces +z): two posts, plank board, a
// little gable roof; the painted face (posters) is the feature's textured plane at z = WANTED.face
export const WANTED = {w: 1.6, h: 1.05, y0: .92, face: .1};
export function wantedBoard() {
  const L = [], {w, h, y0} = WANTED;
  for (const s of [-1, 1]) L.push(box('wood', [.11, 2.22, .11], [s * .78, 1.11, 0], [0, 0, 0], {bias: -.05}));
  for (let i = 0; i < 4; i++) L.push(box('wood', [w, h / 4, .04], [0, y0 + h / 8 + i * h / 4, .075], [0, 0, 0], {bias: (i & 1) * .1}));
  for (const s of [-1, 1]) L.push(box('bark', [.08, h, .03], [s * .55, y0 + h / 2, .04], [0, 0, 0]));
  for (const s of [-1, 1]) L.push(box('wood', [1.9, .035, .36], [0, 2.17, s * .13], [s * .5, 0, 0], {bias: .15}));
  L.push(box('bark', [1.92, .05, .06], [0, 2.26, 0], [0, 0, 0]));
  return L;
}

// ================================================================ the signpost: a post, the name board nailed to its front,
// arrow boards west (FORT), east (MESA) and south (CANYON); their painted faces are the feature's planes (SIGN)
export const SIGN = {
  top: {y: 2.33, x: 0, z: .1, axis: 'x'},                 // centred on the post's front
  fort: {y: 2.0, x: -1, axis: 'x'}, mesa: {y: 1.7, x: 1, axis: 'x'}, canyon: {y: 1.4, z: 1, axis: 'z'},
  t: .04,
};
// a board's box + its arrow point: len m along its axis from the post (dir +-1), height h; the point's half is the diamond
export function signBoardParts(name, len, hgt, PPM) {
  const S = SIGN[name], L = [], t = SIGN.t, tip = name === 'top' ? 0 : hgt / 2;
  if (S.axis === 'x' && name === 'top') { L.push(box('wood', [len, hgt, t], [0, S.y, S.z], [0, 0, 0], {bias: .05})); return L; }
  const d = S.x || S.z, body = len - tip, c = .065 + body / 2, tipAt = .065 + body;
  const pos = v => S.axis === 'x' ? [d * v, S.y, 0] : [0, S.y, d * v], rotY = S.axis === 'x' ? 0 : PI / 2;
  L.push(box('wood', [body, hgt, t], pos(c), [0, rotY, 0], {bias: .05}));
  const k = hgt / Math.SQRT2;   // the point: a square turned 45 degrees, its centre on the board's end
  L.push(box('wood', [k, k, t], pos(tipAt), S.axis === 'x' ? [0, 0, PI / 4] : [PI / 4, PI / 2, 0], {bias: .05}));
  return L;
}
export function signpost() {
  const L = [];
  L.push(box('wood', [.13, 2.72, .13], [0, 1.36, 0], [0, .1, 0], {bias: -.05}));
  L.push({g: new THREE.ConeGeometry(.1, .14, 4), m: M4([0, 2.79, 0], [0, PI / 4 + .1, 0]), fam: 'wood', bias: .2});
  L.push(box('stone', [.3, .12, .28], [.04, .04, .02], [0, .4, 0], {bias: -.1}), box('rock', [.18, .1, .16], [-.14, .04, .12], [0, 1.1, .1]));   // stones at its foot
  return L;
}

// ================================================================ a split-rail fence along +x from 0 to len: posts about
// every 2 m, two rails sagging a little; brk: the spans with a rail down ([span, 'top' | 'low' | 'fallen'])
export function fence(len, {seed = 1, brk = [], h = 1.05} = {}) {
  const L = [], r = ART.rng(seed), n = Math.max(1, Math.round(len / 2.1)), step = len / n, posts = [];
  for (let i = 0; i <= n; i++) {
    const x = i * step + (i && i < n ? (r() - .5) * .25 : 0), ph = h + (r() - .5) * .14, lean = (r() - .5) * .08;
    posts.push([x, ph]);
    L.push(box('wood', [.12, ph, .12], [x, ph / 2, 0], [lean, (r() - .5) * .6, lean * .5], {bias: (r() - .5) * .2}));
  }
  for (let i = 0; i < n; i++) {
    const [a] = posts[i], [b] = posts[i + 1], br = brk.find(q => q[0] === i)?.[1];
    for (const [y, which] of [[.48, 'low'], [h - .16, 'top']]) {
      if (br === which) continue;
      if (br === 'fallen' && which === 'top') { L.push(rod('wood', [a + .1, y - .05, .02], [b - .3, .06, .35], .045, {bias: -.05})); continue; }
      const m = (a + b) / 2, s = .03 + r() * .03;
      L.push(rod('wood', [a, y, .07], [m, y - s, .07], .045, {bias: r() * .1}), rod('wood', [m, y - s, .07], [b, y, .07], .045, {bias: r() * .1}));
    }
  }
  return L;
}

// ================================================================ the well: a stone ring, a windlass under a gable roof,
// the bucket on its rope (the water deep inside is the feature's painted disc at WELL.water)
export const WELL = {r: .74, water: .22};
export function well() {
  const L = [], r = ART.rng(67), N = 9;
  for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) {
    const a = (i + c * .5) * TAU / N, rr = .58;
    L.push(box('stone', [.42 + r() * .04, .3, .24], [Math.cos(a) * rr, .15 + c * .3, Math.sin(a) * rr], [0, PI / 2 - a, 0], {bias: (r() - .5) * .3}));
  }
  for (let i = 0; i < N; i++) { const a = (i + .25) * TAU / N; L.push(box('stone', [.44, .08, .3], [Math.cos(a) * .6, .64, Math.sin(a) * .6], [0, PI / 2 - a, 0], {bias: .15 + (r() - .5) * .2})); }
  L.push({g: flip(new THREE.CylinderGeometry(.47, .47, .5, 14, 1, true)), m: M4([0, .44, 0]), fam: 'stone', fixed: 2});
  for (const s of [-1, 1]) L.push(box('wood', [.11, 1.95, .11], [s * .74, .98, 0], [0, 0, s * .02], {bias: -.05}));
  L.push(cyl('wood', .07, .07, 1.36, [0, 1.35, 0], [0, 0, PI / 2], 8, {bias: .05}));
  L.push(box('metal', [.04, .2, .04], [.84, 1.28, 0], [0, 0, 0]), box('metal', [.12, .035, .035], [.88, 1.18, 0], [0, 0, 0]));   // the crank
  for (const s of [-1, 1]) L.push(box('wood', [1.8, .035, .62], [0, 2.02, s * .24], [s * .62, 0, 0], {bias: .15}));
  L.push(box('bark', [1.82, .05, .06], [0, 2.2, 0], [0, 0, 0]));
  L.push(rod('rope', [0, 1.29, .06], [0, .96, .06], .012));
  L.push(cyl('wood', .1, .13, .22, [0, .84, .06], [0, 0, 0], 8), ring('metal', .125, .012, [0, .9, .06], [PI / 2, 0, 0], {}, 10, 3));
  return L;
}

// ================================================================ the outhouse (door to +z; the moon is the feature's plane)
export const OUTHOUSE = {door: .53};
export function outhouse() {
  const L = [];
  L.push(box('bark', [1.1, .08, 1.1], [0, .04, 0], [0, 0, 0]));
  L.push(box('wood', [1.04, 2.0, .05], [0, 1.04, -.5], [0, 0, 0], {bias: -.1}));
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) L.push(box('wood', [.05, 2.06, .25], [s * .5, 1.07, -.375 + i * .25], [0, 0, 0], {bias: (i & 1) * .1 - .05}));
  for (const s of [-1, 1]) L.push(box('wood', [.08, 2.2, .08], [s * .48, 1.1, .5], [0, 0, 0], {bias: -.1}));
  L.push(box('wood', [1.04, .22, .05], [0, 2.1, .5], [0, 0, 0], {bias: .05}));
  for (let i = 0; i < 4; i++) L.push(box('wood', [.2, 1.86, .04], [-.3 + i * .2, .98, OUTHOUSE.door - .02], [0, 0, 0], {bias: (i & 1) * .12}));   // the door's planks
  L.push(box('bark', [.78, .08, .03], [0, .5, OUTHOUSE.door + .01], [0, 0, 0]), box('bark', [.78, .08, .03], [0, 1.6, OUTHOUSE.door + .01], [0, 0, 0]));
  L.push(beam('bark', [-.32, .55, OUTHOUSE.door + .015], [.32, 1.55, OUTHOUSE.door + .015], .07, .025));
  L.push(box('metal', [.05, .05, .05], [.3, 1.0, OUTHOUSE.door + .03], [0, 0, 0]));
  L.push(box('wood', [1.32, .05, 1.36], [0, 2.18, .02], [-.18, 0, 0], {bias: .2}));
  return L;
}

// ================================================================ the mine: a timbered portal on the mesa's face (+z =
// out of the face), the dark adit, rails out to the ore cart, a pile of props (timbers)
export function minePortal() {
  const L = [];
  L.push(box('void', [1.36, 1.92, .02], [0, .96, .014], [0, 0, 0], {fixed: 0}));
  for (const s of [-1, 1]) L.push(box('wood', [.22, 2.14, .22], [s * .79, 1.07, .15], [0, 0, s * .025], {bias: -.1}));
  L.push(box('wood', [2.04, .25, .27], [0, 2.25, .15], [0, 0, 0], {bias: .1}));
  for (let i = 0; i < 5; i++) L.push(box('wood', [.38, .045, .3], [-.76 + i * .38, 2.42, .14], [0, 0, (i & 1) * .04], {bias: .2}));   // lagging on the cap
  for (const s of [-1, 1]) L.push(box('metal', [.035, .04, 2.7], [s * .3, .075, 1.35], [0, 0, 0], {bias: .1}));   // rails
  for (let i = 0; i < 6; i++) L.push(box('wood', [.92, .06, .14], [0, .03, .18 + i * .47], [0, (i % 3 - 1) * .04, 0], {bias: (i & 1) * .1 - .05}));
  for (let i = 0; i < 3; i++) L.push(rod('wood', [1.2, .1 + (i === 2 ? .17 : 0), .45 + i * .2 - (i === 2 ? .3 : 0)], [2.1, .1 + (i === 2 ? .17 : 0), .55 + i * .2 - (i === 2 ? .3 : 0)], .09, {bias: (i - 1) * .1}, 7));
  L.push(beam('bark', [-1.05, .02, .55], [-1.12, 1.0, .25], .04, .04), box('metal', [.32, .05, .06], [-1.12, 1.0, .25], [0, 0, .1]));   // a pick against the rock
  return L;
}
export function oreCart() {
  const L = [];
  L.push({g: new THREE.CylinderGeometry(.6, .46, .48, 4, 1).rotateY(PI / 4), m: M4([0, .5, 0], [0, 0, 0], [1, 1, 1.18]), fam: 'metal', bias: -.05});   // (squared first, then stretched)
  L.push(box('metal', [.88, .05, 1.0], [0, .74, 0], [0, 0, 0], {bias: .2}));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) L.push(cyl('metal', .12, .12, .06, [sx * .3, .12, sz * .3], [0, 0, PI / 2], 8, {bias: .1}));
  for (const sz of [-1, 1]) L.push(beam('bark', [-.34, .12, sz * .3], [.34, .12, sz * .3], .04, .04));
  const r = ART.rng(73);
  for (let i = 0; i < 5; i++) L.push({g: new THREE.IcosahedronGeometry(1, 0), m: M4([(r() - .5) * .45, .8 + r() * .06, (r() - .5) * .55], [r() * 3, r() * 3, r() * 3], [.13, .1, .12]), fam: 'rock', bias: (r() - .5) * .3});
  return L;
}

// ================================================================ bones (the true-3D pivot: once upright cards, now lying in the sand)
// a cow skull: frame x across the horns, y up, z the way the snout points; origin = under its middle (it rests there)
export function skull() {
  const L = [];
  L.push({g: new THREE.IcosahedronGeometry(1, 1), m: M4([0, .07, -.04], [0, 0, 0], [.11, .07, .1]), fam: 'bone', bias: .1});   // the cranium
  L.push({g: new THREE.CylinderGeometry(.045, .075, .24, 6), m: M4([0, .045, .13], [PI / 2 - .12, 0, 0], [1, 1, .62]), fam: 'bone'});   // the long face
  for (const s of [-1, 1]) {
    L.push(box('void', [.05, .035, .04], [s * .055, .1, .035], [-.3, s * .3, 0], {fixed: 2}));   // the eye sockets
    L.push(box('void', [.018, .02, .03], [s * .016, .07, .25], [-.2, 0, 0], {fixed: 2}));        // the nostrils
    L.push(rod('bone', [s * .08, .09, -.07], [s * .2, .11, -.08], .022), rod('bone', [s * .2, .11, -.08], [s * .26, .2, -.06], .016), rod('bone', [s * .26, .2, -.06], [s * .23, .27, -.05], .01, {fixed: 2}));   // the horns, curving up
  }
  return L;
}
// a rib cage on its back, half sunk: frame x along the spine, origin = its middle on the ground (chunky: at 30 px a metre a thin rib
// would be all outline)
export function ribs() {
  const L = [rod('bone', [-.3, .05, 0], [.3, .045, .01], .032, {bias: .1})];
  for (let i = 0; i < 4; i++) {
    const x = -.2 + i * .13, r = .15 + .04 * Math.sin((i + .5) / 4 * PI);
    L.push({g: new THREE.TorusGeometry(r, .024, 3, 7, PI * 1.1), m: M4([x, .01, .01], [0, PI / 2, -.08 + i * .04]), fam: 'bone', bias: (i & 1) * .15});   // a rib: an arc over the spine
  }
  return L;
}
// a long bone: frame x along it, the knobs at its ends; origin = its middle on the ground
export function longBone() {
  const L = [rod('bone', [-.18, .03, 0], [.18, .03, 0], .026)];
  for (const s of [-1, 1]) L.push({g: new THREE.IcosahedronGeometry(1, 0), m: M4([s * .19, .035, 0], [0, s, 0], [.045, .035, .06]), fam: 'bone', bias: .1});
  return L;
}
