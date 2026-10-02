// TREES3D: procedural trees for the 3D world, grown in the browser from a seed. A tree is ONE geometry with the prop
// pipeline's attributes (aPart / aFam / aBias / aFixed, the same ones world.js reads off the Blender kit's glb files), so
// it is toned by the biome's ramps, outlined, seamed and shadowed like every live prop, and it reads right at every yaw.
//   oak    (ruins v0 / v1) a leaning trunk with a root flare, forking into 3-4 limbs that split again; the crown is 8-13
//          lumpy CLUMPS at the branch tips, each its own part, so the seam / occlusion lines between them draw the
//          painted tree's overlapping blobs. Their normals lean toward a smooth ellipsoid round the whole crown: it shades
//          as ONE soft mass (a sun side and a shade side in the 3 tones) and the lumps only break its silhouette. Inner and
//          lower clumps are toned down (aBias: a cheap ambient occlusion), and every triangle gets a little bias jitter,
//          so the tone bands break up into leafy patches instead of clean contours
//   dead   (ruins v2) a gnarled trunk, limbs splitting 4 levels deep, a broken snag, no leaves
//   willow (ruins v3) a short thick trunk leaning east (never turned: it stands on the river's west bank), arching limbs
//          under a broad crown, and long CURTAINS of leaf clumps hanging to ~0.3 m above the ground; the lower a curtain
//          hangs, the more it sways (aFlex), each clump flutters on its own phase (a travelling ripple down a strand)
// treeModel(p, biome, fam) -> {geo, yaw, scale, top, bones, crown, species, seed} | null (no model: the prop keeps its
//   card). crown = {x, z, y0, y1, r} in the model's frame (leafy species only)
// boneHit(tree, from, to) -> where an arrow sticks in the trunk / a big limb, or null (the twigs and leaves let it through)
// The geometry carries aFlex (the wind's bend weight per vertex): gfx.js leans it (mesh {sway: true}, setLean)
//   fam(name) -> the family index (world.js FAMS). Shapes are cached per (species, seed): the world's ~40 trees share
//   SEEDS shapes per species, each turned and scaled per tree. p.seed picks a shape (the lineup does).
// Frame: x east, y up, z south, metres, origin = the ground point (as the glb props).
import * as THREE from 'three';

export const SEEDS = 8;
export const TUNE = {
  detail: 5,        // clump sphere subdivision (IcosahedronGeometry detail: 20 (d + 1)^2 triangles; 5 -> 720, edges ~3.5 px;
                    // the small fringe clumps use 3 -> 320)
  hull: .3,         // how far clump normals lean toward the crown's ellipsoid (0 = every clump shades on its own)
  lump: .42,        // big lumps on a clump's surface (fraction of its radius)
  jag: .3,          // fine serration of a clump's edge (the leafy silhouette)
  jitter: 0,        // per-triangle tone bias jitter on the leaves (the mesh shader adds a 3D noise jitter: aFixed -2)
  light: .22,       // tone bias up the crown (lit top, dark underside); vertical only, so it holds when a tree is turned
  inner: .12,       // tone bias down toward the crown's centre (clumps deep inside are in their neighbours' shade)
  lift: .08,        // tone bias on every clump (the painted crown is about a third light, a third mid, a third dark)
};

// ---------------------------------------------------------------- noise + random
function rng(seed) {   // mulberry32
  let a = (seed * 2654435761 + 1013904223) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const h3 = (x, y, z, s) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453; return v - Math.floor(v); };
function vn3(x, y, z, s = 0) {   // value noise, 0..1
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t, c = (i, j, k) => h3(xi + i, yi + j, zi + k, s);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), fx), L(c(0, 1, 0), c(1, 1, 0), fx), fy), L(L(c(0, 0, 1), c(1, 0, 1), fx), L(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const hashXY = (x, y) => { const v = Math.sin(Math.round(x * 10) * 12.9898 + Math.round(y * 10) * 78.233) * 43758.5453; return v - Math.floor(v); };

// ---------------------------------------------------------------- geometry builder: parts of triangles
// aFlex (the wind's bend weight, gfx.js SWAY): flexOf(y) per vertex (bark), or a constant per part (a leaf clump moves as
// a block: one weight at its centre, so the whole clump steps by the same whole pixels). aPhase: a leaf clump's own
// flutter phase (0..2pi: each clump dances on its own in a gust), -1 = bark (no flutter)
class Build {
  constructor(fam, flexOf) { this.F = fam; this.flexOf = flexOf; this.pos = []; this.nrm = []; this.aPart = []; this.aFam = []; this.aBias = []; this.aFixed = []; this.aFlex = []; this.aPhase = []; this.bones = []; this.np = 0; this.cur = null; }
  part(fam, bias = 0, fixed = -1, flex = null, phase = -1) { this.cur = {pi: this.np++ % 64, fam: this.F(fam), bias, fixed, flex, phase}; return this; }
  vert(p, n, bias) {
    const c = this.cur; this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z);
    this.aPart.push(c.pi); this.aFam.push(c.fam); this.aBias.push(bias ?? c.bias); this.aFixed.push(c.fixed); this.aFlex.push(c.flex ?? this.flexOf(p.y)); this.aPhase.push(c.phase);
  }
  tri(a, b, c, na, nb, nc, bias) { this.vert(a, na, bias); this.vert(b, nb, bias); this.vert(c, nc, bias); }
  geometry() {
    const g = new THREE.BufferGeometry(), A = (n, a, k) => g.setAttribute(n, new THREE.Float32BufferAttribute(a, k));
    A('position', this.pos, 3); A('normal', this.nrm, 3); A('aPart', this.aPart, 1); A('aFam', this.aFam, 1); A('aBias', this.aBias, 1); A('aFixed', this.aFixed, 1);
    A('aFlex', this.aFlex, 1); A('aPhase', this.aPhase, 1);
    g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
}

// a tapered tube along a polyline (parallel-transport frames, smooth normals); the end is closed with a short cone.
// Tubes 7 cm or thicker become BONES: capsules an arrow sticks into (twigs let it through into the crown)
function tube(B, pts, rad, sides, rot = 0, cap = true) {
  const n = pts.length, T = [], N = [], Bn = [];
  if (Math.max(rad[0], rad[n - 1]) >= .07) for (let i = 0; i < n - 1; i++) B.bones.push([pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z, rad[i], rad[i + 1]]);
  for (let i = 0; i < n; i++) T.push((i === 0 ? pts[1].clone().sub(pts[0]) : i === n - 1 ? pts[i].clone().sub(pts[i - 1]) : pts[i + 1].clone().sub(pts[i - 1])).normalize());
  const ax = Math.abs(T[0].y) < .9 ? V(0, 1, 0) : V(1, 0, 0);
  N.push(V().crossVectors(T[0], ax).normalize());
  for (let i = 1; i < n; i++) { const q = N[i - 1].clone().addScaledVector(T[i], -N[i - 1].dot(T[i])); N.push(q.lengthSq() > 1e-8 ? q.normalize() : N[i - 1].clone()); }
  for (let i = 0; i < n; i++) Bn.push(V().crossVectors(T[i], N[i]));
  const ring = (i, k) => { const a = rot + k / sides * Math.PI * 2, d = N[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(Bn[i], Math.sin(a)); return [pts[i].clone().addScaledVector(d, rad[i]), d]; };
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) {
    const [a, na] = ring(i, k), [b, nb] = ring(i, k + 1), [c, nc] = ring(i + 1, k + 1), [d, nd] = ring(i + 1, k);
    B.tri(a, b, c, na, nb, nc); B.tri(a, c, d, na, nc, nd);
  }
  if (cap) {   // a short cone: the branch ends in a rounded point, not an open pipe
    const i = n - 1, tip = pts[i].clone().addScaledVector(T[i], rad[i] * 1.2);
    for (let k = 0; k < sides; k++) { const [a, na] = ring(i, k), [b, nb] = ring(i, k + 1); B.tri(a, b, tip, na, nb, T[i]); }
  }
}
// points from a to b, bowed sideways by `bend` (a vector, at the middle) and wobbled by `wob` (m), seeded
function limbPts(a, b, segs, bend, wob, r) {
  const out = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = a.clone().lerp(b, t).addScaledVector(bend, Math.sin(t * Math.PI));
    if (i > 0 && i < segs) p.add(V((r() - .5) * wob, (r() - .5) * wob * .5, (r() - .5) * wob));
    out.push(p);
  }
  return out;
}
const taper = (n, r0, r1, k = 1) => Array.from({length: n}, (_, i) => r0 + (r1 - r0) * Math.pow(i / (n - 1), k));

// a lumpy clump of leaves: a subdivided icosahedron, displaced by noise (big lumps + a fine serration), its bottom
// tucked up; normals = the clump's own (squashed) sphere normal leaned toward the crown ellipsoid (C, R)
const ICO = {};
function clump(B, c, rad, squash, seed, C, R, bias, r, detail = TUNE.detail) {
  if (!ICO[detail]) { const g = new THREE.IcosahedronGeometry(1, detail); ICO[detail] = g.attributes.position.array; g.dispose(); }
  const P = ICO[detail], o = seed * 7.13, u = V(), p = [V(), V(), V()], n = [V(), V(), V()];
  const disp = (x, y, z) => 1 + (vn3(x * 1.7 + o, y * 1.7 + o * .7, z * 1.7 - o, 3) - .5) * TUNE.lump * 2 + (vn3(x * 6 + o, y * 6, z * 6 + o, 5) - .5) * TUNE.jag * 2;
  for (let t = 0; t < P.length; t += 9) {
    for (let j = 0; j < 3; j++) {
      u.set(P[t + j * 3], P[t + j * 3 + 1], P[t + j * 3 + 2]).normalize();
      const d = disp(u.x, u.y, u.z), y = u.y < 0 ? u.y * .62 : u.y;   // a flatter underside
      p[j].set(c.x + u.x * rad * d, c.y + y * rad * squash * d, c.z + u.z * rad * d);
      const sn = V(u.x, u.y / squash, u.z).normalize();
      const g = V((p[j].x - C.x) / (R.x * R.x), (p[j].y - C.y) / (R.y * R.y), (p[j].z - C.z) / (R.z * R.z)).normalize();
      n[j].copy(sn).multiplyScalar(1 - TUNE.hull).addScaledVector(g, TUNE.hull).normalize();
    }
    B.tri(p[0], p[1], p[2], n[0], n[1], n[2], bias + (r() - .5) * 2 * TUNE.jitter);
  }
}

// ---------------------------------------------------------------- species
function oak(seed, fam) {
  const r = rng(seed * 31 + 7);
  // the fork sits well below the crown, so the limbs show between them (the painted oak's V)
  const H = 4.2 + r() * .75, fork = 1.0 + r() * .35, la = r() * Math.PI * 2, ld = .08 + r() * .2;
  const lean = V(Math.cos(la) * ld, 0, Math.sin(la) * ld);
  // the crown: an ellipsoid over the fork, a little off toward the lean
  const R = V(1.22 + r() * .3, .98 + r() * .2, 1.22 + r() * .3);
  const C = V(lean.x * 1.6, H - R.y, lean.z * 1.6);
  // wind weights (wind.js CURVES.crown): a stiff trunk, .7 (u / c)^2.2 up to the crown's foot c, then the crown .7 .. 1
  const c = Math.min(.6, Math.max(.15, (C.y - R.y * .85) / H));
  const crown = y => { const u = Math.max(0, y) / H; return u < c ? .7 * (u / c) ** 2.2 : Math.min(1, .7 + .3 * (u - c) / (1 - c)); };
  const B = new Build(fam, crown);
  B.crown = {x: C.x, z: C.z, y0: C.y - R.y * .95, y1: H, r: Math.max(R.x, R.z) + .1};   // where arrows shake leaves loose (wind.js)
  // trunk: from below the ground to the fork, leaning, wobbling; flared at the foot
  const top = V(lean.x, fork, lean.z);
  const tp = limbPts(V(0, -.15, 0), top, 4, V((r() - .5) * .14, 0, (r() - .5) * .14), .05, r);
  const r0 = .17 + r() * .04;
  B.part('bark');
  const tr = tp.map((q, i) => i === 0 ? r0 * 1.45 : i === 1 ? r0 * 1.12 : r0 * (1 - .32 * (i - 1) / (tp.length - 2)));
  tube(B, tp, tr, 7, r(), false);
  // roots: 3-4 spurs into the ground
  const nr = 3 + (r() < .5 ? 1 : 0);
  for (let i = 0; i < nr; i++) {
    const a = i / nr * Math.PI * 2 + r() * .9, d = V(Math.cos(a), 0, Math.sin(a)), L = .38 + r() * .22;
    const pts = [V(0, .32, 0).addScaledVector(d, r0 * .4), V(0, .1, 0).addScaledVector(d, r0 + L * .35), V(0, -.06, 0).addScaledVector(d, r0 + L)];
    tube(B, pts, [r0 * .5, r0 * .38, .03], 5, r());
  }
  // limbs: 3-4 from the fork toward points inside the crown, each splitting in two; a clump at every tip
  const tips = [], nl = 3 + (r() < .45 ? 1 : 0), a0 = r() * Math.PI * 2;
  for (let j = 0; j < nl; j++) {
    const az = a0 + j / nl * Math.PI * 2 + (r() - .5) * .7, out = .55 + r() * .2;
    const end = C.clone().add(V(Math.cos(az) * R.x * out, (r() - .6) * R.y * .5, Math.sin(az) * R.z * out));
    const pts = limbPts(top.clone().add(V(0, -.1, 0)), end, 4, V(0, .1 + r() * .14, 0), .08, r);
    B.part('bark');
    tube(B, pts, taper(pts.length, r0 * .72, .055), 6, r());
    for (let s = 0; s < 2; s++) {   // the split: two twigs fanning out of the limb's end
      const dir = end.clone().sub(top).normalize(), side = V(-dir.z, 0, dir.x).multiplyScalar(s ? 1 : -1);
      const tip = end.clone().addScaledVector(dir, .3 + r() * .25).addScaledVector(side, .32 + r() * .25).add(V(0, .12 + r() * .25, 0));
      tube(B, limbPts(end, tip, 2, V(0, .05, 0), .05, r), [.055, .042, .03], 5, r());
      tips.push(tip);
    }
  }
  // clumps: one per twig tip (pushed outward), a crown top, a big dark core filling the gaps, extras on the shell
  const cl = [];
  const inside = (q, k) => { const e = V((q.x - C.x) / R.x, (q.y - C.y) / R.y, (q.z - C.z) / R.z), m = e.length(); return m > k ? C.clone().add(V(e.x / m * k * R.x, e.y / m * k * R.y, e.z / m * k * R.z)) : q; };
  for (const t of tips) cl.push({c: inside(t.clone().add(V((t.x - C.x) * .15, .1, (t.z - C.z) * .15)), .62), rad: .52 + r() * .17});
  cl.push({c: C.clone().add(V((r() - .5) * .3, R.y * .42, (r() - .5) * .3)), rad: .62 + r() * .1});
  const extra = 2 + (r() * 3 | 0);
  for (let i = 0; i < extra; i++) {
    const a = r() * Math.PI * 2, e = .2 + r() * .55;
    cl.push({c: inside(C.clone().add(V(Math.cos(a) * R.x * .6, (e - .3) * R.y, Math.sin(a) * R.z * .6)), .6), rad: .46 + r() * .17});
  }
  const fringe = 4 + (r() * 3 | 0);   // small clumps out on the shell: they break the silhouette like the painted crown's edge
  for (let i = 0; i < fringe; i++) {
    const a = (i + r() * .7) / fringe * Math.PI * 2, e = (r() - .4) * .9;
    cl.push({c: inside(C.clone().add(V(Math.cos(a) * R.x, e * R.y, Math.sin(a) * R.z)), .86), rad: .28 + r() * .12, small: true});
  }
  cl.push({c: C.clone().add(V(0, -R.y * .1, 0)), rad: Math.min(R.x, R.z) * .72, core: true});
  for (const [i, q] of cl.entries()) {
    const e = V((q.c.x - C.x) / R.x, (q.c.y - C.y) / R.y, (q.c.z - C.z) / R.z);
    const bias = TUNE.lift + (q.core ? -.2 : TUNE.light * e.y / .6 - TUNE.inner * (1 - Math.min(1, e.length() / .6)) + (r() - .5) * .08);
    B.part('leaf', bias, -2, crown(q.c.y), q.core ? -1 : (i * 2.39996 + seed * .7) % (Math.PI * 2));   // the dark core stays put: no gaps open
    clump(B, q.c, q.rad, .82, seed * 13 + i, C, R, bias, r, q.small ? 3 : TUNE.detail);
  }
  return B;
}

function dead(seed, fam) {
  const r = rng(seed * 17 + 3);
  const fork = 2.2 + r() * .6, la = r() * Math.PI * 2, ld = .12 + r() * .25;
  // wind weights (wind.js CURVES.limb) over about the tree's height: the bare limbs whip more than they lean
  const H = fork + 2, B = new Build(fam, y => { const u = Math.max(0, y) / H; return u < .1 ? 0 : Math.min(1.2, ((u - .1) / .9) ** 1.5); });
  const top = V(Math.cos(la) * ld, fork, Math.sin(la) * ld), r0 = .19 + r() * .05;
  const tp = limbPts(V(0, -.15, 0), top, 6, V((r() - .5) * .3, 0, (r() - .5) * .3), .12, r);
  B.part('bark');
  tube(B, tp, tp.map((q, i) => i === 0 ? r0 * 1.5 : r0 * (1.05 - .4 * i / (tp.length - 1))), 7, r(), false);
  for (let i = 0; i < 3; i++) {   // roots
    const a = i / 3 * Math.PI * 2 + r() * .9, d = V(Math.cos(a), 0, Math.sin(a)), L = .4 + r() * .25;
    tube(B, [V(0, .3, 0).addScaledVector(d, r0 * .4), V(0, .08, 0).addScaledVector(d, r0 + L * .35), V(0, -.06, 0).addScaledVector(d, r0 + L)], [r0 * .5, r0 * .36, .03], 5, r());
  }
  { // a snapped-off stub low on the trunk
    const a = r() * Math.PI * 2, s = tp[2].clone(), d = V(Math.cos(a), .5, Math.sin(a)).normalize();
    tube(B, [s, s.clone().addScaledVector(d, .3)], [r0 * .5, r0 * .4], 5, r());
  }
  // limbs: rotate the parent direction away by 25-45 deg about a random axis, biased up; 4 levels
  const rotAway = (dir, ang) => {
    const ax = V().crossVectors(dir, V(r() - .5, r() - .5, r() - .5)).normalize();
    return dir.clone().applyAxisAngle(ax, ang).add(V(0, .25, 0)).normalize();
  };
  const grow = (p, dir, len, rad, depth) => {
    const end = p.clone().addScaledVector(dir, len);
    const pts = limbPts(p, end, 3, V((r() - .5) * len * .25, len * .08, (r() - .5) * len * .25), len * .12, r);
    tube(B, pts, taper(pts.length, rad, Math.max(.03, rad * .62)), depth < 2 ? 6 : 5, r(), depth >= 3 || rad * .62 < .04);
    if (depth >= 3 || rad * .62 < .04) return;
    const kids = r() < .8 ? 2 : 1;
    for (let k = 0; k < kids; k++) grow(end, rotAway(end.clone().sub(pts[pts.length - 2]).normalize(), .45 + r() * .35), len * (.66 + r() * .12), rad * .62, depth + 1);
  };
  const nl = 2 + (r() < .5 ? 1 : 0), a0 = r() * Math.PI * 2;
  for (let j = 0; j < nl; j++) {
    const az = a0 + j / nl * Math.PI * 2 + (r() - .5) * .6, el = .55 + r() * .35;
    B.part('bark');
    grow(top.clone().add(V(0, -.1, 0)), V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)), .85 + r() * .35, r0 * .72, 0);
  }
  return B;
}

// ruins v3, the willow (features/riverside.js stands one or two on the river's west bank): a short thick trunk leaning EAST
// (toward the water: treeModel never turns it), forking low into arching limbs under a broad crown, and ~26 curtains (a
// strand = a chain of tall narrow clumps, one part per strand so only its silhouette and the gaps between strands draw
// lines) hanging from the crown's underside, the longest to ~0.3 m above the ground. aFlex per clump: the crown's, then up to
// ~1.8x that at a strand's foot (a pendulum), so a gust swings the curtains more than the crown
function willow(seed, fam) {
  const r = rng(seed * 23 + 11);
  const lean = V(.7 + r() * .3, 0, (r() - .5) * .35), fork = 1.4 + r() * .2;
  const R = V(1.7 + r() * .25, .85 + r() * .12, 1.6 + r() * .2), C = V(lean.x * 1.5 + .2, 2.75 + r() * .15, lean.z * 1.2), H = C.y + R.y;
  const c = Math.min(.6, Math.max(.15, fork / H));
  const crown = y => { const u = Math.max(0, y) / H; return u < c ? .7 * (u / c) ** 2.2 : Math.min(1, .7 + .3 * (u - c) / (1 - c)); };
  const B = new Build(fam, crown);
  B.crown = {x: C.x, z: C.z, y0: C.y - R.y * .8, y1: H, r: Math.max(R.x, R.z)};
  // trunk (thick, flared) + roots
  const top = V(lean.x, fork, lean.z), tp = limbPts(V(0, -.15, 0), top, 4, V((r() - .5) * .12, 0, (r() - .5) * .12), .05, r), r0 = .2 + r() * .04;
  B.part('bark');
  tube(B, tp, tp.map((q, i) => i === 0 ? r0 * 1.5 : i === 1 ? r0 * 1.15 : r0 * (1 - .3 * (i - 1) / (tp.length - 2))), 8, r(), false);
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + r() * .9, d = V(Math.cos(a), 0, Math.sin(a)), L = .4 + r() * .25;
    tube(B, [V(0, .34, 0).addScaledVector(d, r0 * .4), V(0, .1, 0).addScaledVector(d, r0 + L * .35), V(0, -.06, 0).addScaledVector(d, r0 + L)], [r0 * .5, r0 * .38, .03], 5, r());
  }
  // limbs: four arching up and out under the crown, each ending in a dome clump
  const tips = [], a0 = r() * Math.PI * 2;
  for (let j = 0; j < 4; j++) {
    const az = a0 + j / 4 * Math.PI * 2 + (r() - .5) * .6, out = .5 + r() * .15;
    const end = C.clone().add(V(Math.cos(az) * R.x * out, -R.y * (.1 + r() * .3), Math.sin(az) * R.z * out));
    const pts = limbPts(top.clone().add(V(0, -.1, 0)), end, 4, V(0, .3 + r() * .2, 0), .08, r);
    B.part('bark');
    tube(B, pts, taper(pts.length, r0 * .62, .07), 6, r());
    tips.push(end);
  }
  // the dome: clumps at the limb tips and over them, a few on the shell, a dark core. The hull (C, R) leans their normals
  const cl = [], inside = (q, k) => { const e = V((q.x - C.x) / R.x, (q.y - C.y) / R.y, (q.z - C.z) / R.z), m = e.length(); return m > k ? C.clone().add(V(e.x / m * k * R.x, e.y / m * k * R.y, e.z / m * k * R.z)) : q; };
  for (const t of tips) cl.push({c: inside(t.clone().add(V((t.x - C.x) * .2, .45, (t.z - C.z) * .2)), .7), rad: .62 + r() * .15});
  for (let i = 0; i < 5; i++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * .55; cl.push({c: C.clone().add(V(Math.cos(a) * R.x * d, R.y * (.3 + r() * .5), Math.sin(a) * R.z * d)), rad: .5 + r() * .2}); }
  for (let i = 0; i < 6; i++) { const a = (i + r() * .7) / 6 * Math.PI * 2; cl.push({c: inside(C.clone().add(V(Math.cos(a) * R.x, (r() - .55) * R.y * .6, Math.sin(a) * R.z)), .88), rad: .4 + r() * .12, small: true}); }
  cl.push({c: C.clone().add(V(0, -R.y * .15, 0)), rad: Math.min(R.x, R.z) * .66, core: true});
  for (const [i, q] of cl.entries()) {
    const e = V((q.c.x - C.x) / R.x, (q.c.y - C.y) / R.y, (q.c.z - C.z) / R.z);
    const bias = TUNE.lift + (q.core ? -.2 : TUNE.light * e.y / .6 - TUNE.inner * (1 - Math.min(1, e.length() / .6)) + (r() - .5) * .08);
    B.part('leaf', bias, -2, crown(q.c.y), q.core ? -1 : (i * 2.39996 + seed * .7) % (Math.PI * 2));
    clump(B, q.c, q.rad, .74, seed * 13 + i, C, R, bias, r, q.small ? 3 : TUNE.detail - 1);
  }
  // the curtains: anchors under the dome (the middle ones short of the trunk), a chain of clumps down to the ground
  const NS = 36;
  for (let i = 0; i < NS; i++) {
    const a = (i + r() * .8) / NS * Math.PI * 2, rho = .5 + r() * .55, ca = Math.cos(a), sa = Math.sin(a);
    const x0 = C.x + ca * R.x * Math.min(rho, 1.02), z0 = C.z + sa * R.z * Math.min(rho, 1.02), ya = C.y - R.y * .42 * Math.sqrt(Math.max(0, 1 - rho * rho)) + .1;
    const yEnd = r() < .4 ? .3 + r() * .2 : .5 + r() * 1.1, n = Math.max(3, Math.ceil((ya - yEnd) / .26)), ph = r() * Math.PI * 2, pi = (i + 8) % 64;
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1), y = ya - k * (ya - yEnd) / (n - 1), sw = Math.sin(k * .8 + a * 3) * .05, out = f ** 1.6 * .3;
      const pos = V(x0 + ca * out + sa * sw, y, z0 + sa * out - ca * sw), e = V((pos.x - C.x) / R.x, (pos.y - C.y) / R.y, (pos.z - C.z) / R.z);
      const bias = TUNE.lift + .08 + Math.max(-.12, Math.min(.12, e.y * .1)) - TUNE.inner * (1 - Math.min(1, e.length() / 1.1)) + (r() - .5) * .08;
      B.cur = {pi, fam: B.F('leaf'), bias, fixed: -2, flex: crown(ya) * (1 + .85 * (1 - y / ya)), phase: (ph + k * .5) % (Math.PI * 2)};
      clump(B, pos, .125 - f * .04, 3.3, seed * 29 + i * 7 + k, C, R, bias, r, 1);
    }
  }
  return B;
}

const SPECIES = {oak, dead, willow};
function speciesOf(p, biome) {
  if (biome === 'ruins') return (p.variant | 0) === 2 ? 'dead' : (p.variant | 0) === 3 ? 'willow' : 'oak';
  return null;   // ember spires, frost pines, rift shards: still the painted cards
}
const FIXED_YAW = {willow: 1};   // never turned: its lean is toward the water (east)
const cache = new Map();
export function treeShape(species, seed, fam) {
  const key = `${species}:${seed}:` + Object.values(TUNE).join(':');
  let s = cache.get(key);
  if (!s) { const B = SPECIES[species](seed, fam), geo = B.geometry(); s = {geo, top: geo.boundingBox.max.y, bones: B.bones, crown: B.crown || null, species, seed}; cache.set(key, s); }
  return s;
}
// an arrow's step (arena coords: x east, y south, h up) against a tree's bones. tr = {x, y, z, pose (treeModel)}.
// -> null, or where it sticks {x, y, h}: the tip a little into the bark. Sub-stepped: an arrow covers ~0.4 m a frame
export function boneHit(tr, x0, y0, h0, x1, y1, h1) {
  const {yaw, scale, bones} = tr.pose, c = Math.cos(yaw), s = Math.sin(yaw);
  const loc = (x, y, h) => { const wx = x - tr.x, wz = y - tr.y; return [(wx * c - wz * s) / scale, (h - tr.z) / scale, (wx * s + wz * c) / scale]; };
  const A = loc(x0, y0, h0), Z = loc(x1, y1, h1);
  for (let k = 1; k <= 4; k++) {
    const f = k / 4, qx = A[0] + (Z[0] - A[0]) * f, qy = A[1] + (Z[1] - A[1]) * f, qz = A[2] + (Z[2] - A[2]) * f;
    for (const b of bones) {
      const dx = b[3] - b[0], dy = b[4] - b[1], dz = b[5] - b[2], L2 = dx * dx + dy * dy + dz * dz;
      const t = L2 > 0 ? Math.min(1, Math.max(0, ((qx - b[0]) * dx + (qy - b[1]) * dy + (qz - b[2]) * dz) / L2)) : 0;
      const cx = b[0] + dx * t, cy = b[1] + dy * t, cz = b[2] + dz * t, r = b[6] + (b[7] - b[6]) * t;
      const ex = qx - cx, ey = qy - cy, ez = qz - cz, d = Math.hypot(ex, ey, ez);
      if (d >= r + .03) continue;
      const m = d > 1e-6 ? r * .8 / d : 0, lx = cx + ex * m, ly = cy + ey * m, lz = cz + ez * m;
      return {x: tr.x + (lx * c + lz * s) * scale, y: tr.y + (-lx * s + lz * c) * scale, h: tr.z + ly * scale};
    }
  }
  return null;
}
export function treeModel(p, biome, fam) {
  const species = speciesOf(p, biome); if (!species) return null;
  const h = hashXY(p.x, p.y), seed = p.seed ?? ((h * 9973 | 0) % SEEDS);
  const s = treeShape(species, seed, fam), scale = p.lineup ? 1 : .9 + hashXY(p.y, p.x) * .2;
  return {...s, yaw: p.lineup || FIXED_YAW[species] ? 0 : h * Math.PI * 2, scale, top: s.top * scale};
}
export function clearTreeCache() { for (const s of cache.values()) s.geo.dispose(); cache.clear(); }
