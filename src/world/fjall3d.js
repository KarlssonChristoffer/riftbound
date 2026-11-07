// FJALL3D: the fjäll's meshes (world/fjall.js is the plan; features/fjall.js streams them). Nothing here runs per frame.
//   TILES      the region outside the home box cut into tiles of at most TILE m on a lattice that meets the home box's edges
//              (x 72 eastward, x -48 westward, y 0 / -242 northward): tiles(P) -> [{x0, y0, x1, y1, i, j}]
//   GROUND     groundGeo(P, t, cell) -> one tile's ground: a cell m grid on the plan's drawn height (the water's surface where there is
//              water: the lake, the jokk, the tarns lie flat at their level over their beds) with a SKIRT hanging SKIRT m down from its
//              edges (a near tile's 1 m edge meets a far tile's 4 m one, the home ground's 0.25 m one: the skirt hides the cracks).
//              Normals from the field's slope
//   PROPS      the scatter's records (plan.scatter()) as true-3D models with the prop pipeline's attributes (trees3d.js Build: toned
//              by the biome's ramps, outlined, shadowed): the MOUNTAIN BIRCH (fjällbjörk: low, crooked, several stems, a light
//              crown of small clumps), the DWARF BIRCH and WILLOW (low mats), STONES and the BLOCK FIELD, the CAIRNS (varder),
//              the winter trail's RED CROSSES on their poles, the STUGA (a red cabin, white corners, a dark roof) and the
//              FOOTBRIDGE over the jokk. Shapes are made once per variant (SHAPES) and merged per tile: propsGeo(recs, fam)
// OWNS: nothing global (the shapes' cache). READS: the plan.
import * as THREE from 'three';
import {Build, tube, clump, rng} from './trees3d.js';

export const TILE = 32, SKIRT = 3;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- tiles
export function tiles(P) {
  const R = P.region, H = P.home, xs = new Set([R.x0, R.x1, H.x0, H.x1]), ys = new Set([R.y0, R.y1, H.y0]);
  for (let x = H.x1; x < R.x1; x += TILE) xs.add(x);
  for (let x = H.x0; x > R.x0; x -= TILE) xs.add(x);
  for (let x = H.x0; x < H.x1; x += TILE) xs.add(x);
  for (let y = R.y1; y > H.y0; y -= TILE) ys.add(y);
  for (let y = H.y0; y > R.y0; y -= TILE) ys.add(y);
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b), out = [];
  for (let j = 0; j + 1 < Y.length; j++) for (let i = 0; i + 1 < X.length; i++) {
    const t = {x0: X[i], x1: X[i + 1], y0: Y[j], y1: Y[j + 1], i, j};
    if (t.x0 >= H.x0 && t.x1 <= H.x1 && t.y0 >= H.y0) continue;   // (the home world's)
    out.push(t);
  }
  out.X = X; out.Y = Y;
  return out;
}
// the tile a point is in (binary search on the cuts) -> its i, j packed, or -1
export function tileKey(T, x, y) {
  const f = (A, v) => { let lo = 0, hi = A.length - 2; if (v < A[0] || v > A.at(-1)) return -1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (A[m] <= v) lo = m; else hi = m - 1; } return lo; };
  const i = f(T.X, x), j = f(T.Y, y); return i < 0 || j < 0 ? -1 : j * 1000 + i;
}

// ---------------------------------------------------------------- ground
export function drawnH(P, x, y) { const h = P.H(x, y), w = P.water(x, y); return w === w && w > h ? w : h; }
export function groundGeo(P, t, cell) {
  const w = t.x1 - t.x0, d = t.y1 - t.y0, n = Math.max(1, Math.round(w / cell)), m = Math.max(1, Math.round(d / cell));
  const NV = (n + 1) * (m + 1) + 2 * (n + 1) + 2 * (m + 1), pos = new Float32Array(NV * 3), nrm = new Float32Array(NV * 3), uv = new Float32Array(NV * 2);
  const idx = [];
  let v = 0;
  const put = (x, y, h) => {
    const e = .9, gx = (P.H(x + e, y) - P.H(x - e, y)) / (2 * e), gy = (P.H(x, y + e) - P.H(x, y - e)) / (2 * e), l = Math.hypot(gx, 1, gy);
    pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = y; nrm[v * 3] = -gx / l; nrm[v * 3 + 1] = 1 / l; nrm[v * 3 + 2] = -gy / l; uv[v * 2] = x; uv[v * 2 + 1] = y; return v++;
  };
  const X = i => i === n ? t.x1 : t.x0 + i * w / n, Y = j => j === m ? t.y1 : t.y0 + j * d / m;
  const G = new Float32Array((n + 1) * (m + 1));
  for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) { const x = X(i), y = Y(j), h = drawnH(P, x, y); G[j * (n + 1) + i] = h; put(x, y, h); }
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, e = c + 1; idx.push(a, c, b, b, c, e); }
  // the skirts: each edge's vertices again, SKIRT m lower, a strip facing out
  const skirt = (list, out) => {
    const s0 = v; for (const k of list) { const x = pos[k * 3], y = pos[k * 3 + 2]; const q = put(x, y, G[k] - SKIRT); nrm.copyWithin(q * 3, k * 3, k * 3 + 3); }
    for (let q = 0; q + 1 < list.length; q++) { const a = list[q], b = list[q + 1], c = s0 + q, e = s0 + q + 1; if (out) idx.push(a, b, c, b, e, c); else idx.push(a, c, b, b, c, e); }
  };
  const row = j => Array.from({length: n + 1}, (_, i) => j * (n + 1) + i), col = i => Array.from({length: m + 1}, (_, j) => j * (n + 1) + i);
  skirt(row(0), true); skirt(row(m), false); skirt(col(0), false); skirt(col(n), true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm.subarray(0, v * 3), 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv.subarray(0, v * 2), 2));
  g.setIndex(idx); g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
// several tiles' ground in one geometry, each tile's triangles a range of the index (features/fjall.js leaves out the tiles drawn near)
export function blockGeo(P, list, cell) {
  const parts = list.map(t => groundGeo(P, t, cell)); let nv = 0; for (const g of parts) nv += g.attributes.position.count;
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), ranges = [];
  let o = 0;
  parts.forEach((g, k) => {
    pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2);
    const I = g.index.array, A = new Uint32Array(I.length); for (let q = 0; q < I.length; q++) A[q] = I[q] + o;
    ranges.push({t: list[k], idx: A}); o += g.attributes.position.count; g.dispose();
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const all = new Uint32Array(ranges.reduce((s, r) => s + r.idx.length, 0)); let q = 0; for (const r of ranges) { all.set(r.idx, q); q += r.idx.length; }
  g.setIndex(new THREE.BufferAttribute(all, 1)); g.computeBoundingSphere(); g.computeBoundingBox();
  g.userData.ranges = ranges;
  return g;
}
// the block's index with the given tiles left out (in place: the draw range shrinks)
export function blockSkip(g, skip) {
  const I = g.index.array; let q = 0;
  for (const r of g.userData.ranges) if (!skip(r.t)) { I.set(r.idx, q); q += r.idx.length; }
  g.setDrawRange(0, q); g.index.needsUpdate = true;
  return q;
}

// ---------------------------------------------------------------- shapes (model space: x east, y up, z south; origin = the ground point)
const box = (B, c, s, yaw = 0, tilt = 0) => {   // an axis box (centre, size), turned by yaw about y (and tilt about its own z)
  const Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, tilt, 'YXZ'));
  const P = (x, y, z) => V(x * s.x / 2, y * s.y / 2, z * s.z / 2).applyQuaternion(Q).add(c);
  const F = [[V(1, 0, 0), [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]], [V(-1, 0, 0), [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [V(0, 1, 0), [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]], [V(0, -1, 0), [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [V(0, 0, 1), [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]], [V(0, 0, -1), [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]]];
  for (const [n0, q] of F) quad(B, ...q.map(p => P(...p)), n0.clone().applyQuaternion(Q));
};
// a quad a b c d with outward normal n (its winding fixed to face n)
function quad(B, a, b, c, d, n) {
  const f = V().subVectors(b, a).cross(V().subVectors(c, a));
  if (f.dot(n) < 0) { B.tri(a, c, b, n, n, n); B.tri(a, d, c, n, n, n); } else { B.tri(a, b, c, n, n, n); B.tri(a, c, d, n, n, n); }
}
function tri(B, a, b, c, n) { const f = V().subVectors(b, a).cross(V().subVectors(c, a)); if (f.dot(n) < 0) B.tri(a, c, b, n, n, n); else B.tri(a, b, c, n, n, n); }
// a lumpy stone: an icosahedron, its corners pushed in and out, flattened (r: its radius; it sits sunk a little)
const ICO = new THREE.IcosahedronGeometry(1, 1).attributes.position.array;
function stone(B, c, r, flat, seed) {
  const R = rng(seed), k = [R(), R(), R()], p = [V(), V(), V()], n = [V(), V(), V()];
  const lump = u => 1 + Math.sin(u.x * 3.1 + k[0] * 9) * .14 + Math.sin(u.y * 2.7 + k[1] * 9) * .12 + Math.sin(u.z * 3.4 + k[2] * 9) * .14;
  for (let t = 0; t < ICO.length; t += 9) {
    for (let j = 0; j < 3; j++) { const u = V(ICO[t + j * 3], ICO[t + j * 3 + 1], ICO[t + j * 3 + 2]).normalize(), l = lump(u); p[j].set(c.x + u.x * r * l, c.y + Math.max(u.y, -.5) * r * flat * l, c.z + u.z * r * l); n[j].copy(u); }
    const f = V().subVectors(p[1], p[0]).cross(V().subVectors(p[2], p[0])).normalize();
    for (const q of n) q.lerp(f, .6).normalize();
    B.tri(p[0], p[1], p[2], n[0], n[1], n[2]);
  }
}
const ptAt = (pts, s) => { const f = s * (pts.length - 1), i = Math.min(pts.length - 2, f | 0), u = f - i; return pts[i].clone().lerp(pts[i + 1], u); };

// the mountain birch: 1-3 crooked stems from one foot, leaning out, a light crown of small clumps on their upper halves
function fjallbjork(seed, fam) {
  const r = rng(seed * 61 + 7), B = new Build(fam, () => 0), TAU = Math.PI * 2;
  const ns = 1 + ((seed % 3 + 3) % 3), a0 = r() * TAU, tops = [];
  for (let s = 0; s < ns; s++) {
    const a = a0 + s * TAU / ns + (r() - .5), lean = (ns > 1 ? .35 : .15) + r() * .35, H = (2.6 + r() * 1.5) * (s ? .82 : 1), pts = [];
    for (let i = 0; i < 5; i++) { const t = i / 4, bend = Math.pow(t, 1.3) * lean * H * .45; pts.push(V(Math.cos(a) * (bend + .06 * s) + (i && i < 4 ? (r() - .5) * .22 : 0), t * H, Math.sin(a) * (bend + .06 * s) + (i && i < 4 ? (r() - .5) * .22 : 0))); }
    B.part('birch'); tube(B, pts, [.1, .085, .07, .05, .03], 5, r());
    tops.push(pts);
  }
  let cx = 0, cy = 0, cz = 0, n = 0; for (const p of tops) { const q = ptAt(p, .78); cx += q.x; cy += q.y; cz += q.z; n++; }
  const CC = V(cx / n, cy / n, cz / n), CR = V(1.3, 1.2, 1.3);
  let k = 0;
  for (const p of tops) {
    const nc = 2 + (r() < .6 ? 1 : 0);
    for (let q = 0; q < nc; q++) {
      const pos = ptAt(p, .55 + .45 * (q + r() * .5) / nc).add(V((r() - .5) * .5, .15 + r() * .2, (r() - .5) * .5)), rad = .42 + r() * .28;
      const bias = -.02 + .25 * Math.max(-1, Math.min(1, (pos.y - CC.y) / CR.y)) + (r() - .5) * .1;
      B.part('leaf', bias, -2); clump(B, pos, rad, .8, seed * 17 + k++, CC, CR, bias, r, 1, 1.1);
    }
  }
  return B.geometry();
}
// the dwarf birch / the willow: a low mat of 2-4 squashed clumps (k 1: in the birch wood, darker; 0: the willow belt, grey-green)
function shrub(seed, fam, willow) {
  const r = rng(seed * 29 + 3), B = new Build(fam, () => 0), n = 2 + (seed % 3), CC = V(0, .3, 0), CR = V(.9, .4, .9);
  for (let q = 0; q < n; q++) {
    const pos = V((r() - .5) * .9, .18 + r() * .15, (r() - .5) * .9), rad = .32 + r() * .22, bias = willow ? .12 + (r() - .5) * .1 : -.12 + (r() - .5) * .1;
    B.part(willow && q % 2 ? 'lichen' : 'leaf', bias, -2); clump(B, pos, rad, .55, seed * 13 + q, CC, CR, bias, r, 1, 1.3);
  }
  return B.geometry();
}
function stoneShape(seed, fam, lich) { const B = new Build(fam, () => 0); B.part(lich ? 'lichen' : 'rock', 0); stone(B, V(0, .25, 0), 1, .62, seed); return B.geometry(); }
// a cairn (varde): flat stones stacked, smaller up
function cairn(seed, fam) {
  const r = rng(seed * 7 + 1), B = new Build(fam, () => 0); let y = 0;
  const R = [.62, .52, .44, .36, .27, .18];
  R.forEach((rad, i) => { B.part(i % 2 ? 'stone' : 'rock', (r() - .5) * .1); stone(B, V((r() - .5) * .08, y + rad * .38, (r() - .5) * .08), rad, .62, seed * 11 + i); y += rad * .62; });
  return B.geometry();
}
// a red cross on its pole (the winter trail's mark): a grey pole, a red X high on it
function crossShape(fam) {
  const B = new Build(fam, () => 0);
  B.part('wood', -.1); tube(B, [V(0, -.3, 0), V(0, 1.2, 0), V(0, 2.25, 0)], [.045, .042, .038], 5, 0);
  B.part('red', .05); box(B, V(0, 1.95, .05), V(.08, .9, .04), 0, .72); box(B, V(0, 1.95, .05), V(.08, .9, .04), 0, -.72);
  return B.geometry();
}
// the STUGA: a small red cabin (falu red), white corner boards and window frames, a dark roof, a stone foot, a chimney
export function stugaGeo(S, fam) {
  const B = new Build(fam, () => 0), w = S.w, d = S.d, wh = 2.25, rh = 1.6, y0 = .25;
  B.part('stone', -.05); box(B, V(0, y0 / 2 - .1, 0), V(w + .3, y0 + .2, d + .3));
  B.part('red', 0); box(B, V(0, y0 + wh / 2, 0), V(w, wh, d));
  // the gables (red), the roof (dark) over the ridge along x
  B.part('red', .05); for (const sx of [-1, 1]) tri(B, V(sx * w / 2, y0 + wh, -d / 2), V(sx * w / 2, y0 + wh, d / 2), V(sx * w / 2, y0 + wh + rh, 0), V(sx, 0, 0));
  B.part('char', 0);
  for (const sz of [-1, 1]) { const n = V(0, d / 2 + .35, sz * rh).normalize(); n.z = sz * Math.abs(n.z); const o = V(0, .06, sz * .02);
    quad(B, V(-w / 2 - .3, y0 + wh - .22, sz * (d / 2 + .35)).add(o), V(w / 2 + .3, y0 + wh - .22, sz * (d / 2 + .35)).add(o), V(w / 2 + .3, y0 + wh + rh + .05, 0).add(o), V(-w / 2 - .3, y0 + wh + rh + .05, 0).add(o), V(0, 1, sz * .9).normalize()); }
  B.part('mushwhite', .1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(B, V(sx * (w / 2 + .01), y0 + wh / 2, sz * (d / 2 + .01)), V(.16, wh, .16));
  for (const sx of [-1, 1]) box(B, V(sx * (w / 2 + .02), y0 + wh * .62, 0), V(.06, .78, .9));        // the gable ends' windows (frames)
  box(B, V(-w * .2, y0 + wh * .62, d / 2 + .02), V(.95, .78, .06));                                     // the front's window (frame)
  B.part('char', -.2);
  for (const sx of [-1, 1]) box(B, V(sx * (w / 2 + .05), y0 + wh * .62, 0), V(.04, .6, .72));
  box(B, V(-w * .2, y0 + wh * .62, d / 2 + .05), V(.77, .6, .04));
  B.part('wood', -.15); box(B, V(w * .22, y0 + .95, d / 2 + .03), V(.85, 1.9, .06));                     // the door
  B.part('mushwhite', .1); box(B, V(w * .22, y0 + 1.95, d / 2 + .05), V(1.05, .1, .08));
  B.part('stone', 0); box(B, V(w * .28, y0 + wh + rh * .7, -d * .12), V(.5, 1.5, .5));                     // the chimney
  B.part('wood', -.05); box(B, V(w * .22, .12, d / 2 + .55), V(1.1, .14, .8));                           // the step
  return B.geometry();
}
// the FOOTBRIDGE: planks from a to b at the deck's height, posts and a rail on both sides
export function bridgeGeo(a, b, deck, ga, gb, fam) {
  const B = new Build(fam, () => 0), dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) + 2.2, yaw = -Math.atan2(dz, dx), c = V((a[0] + b[0]) / 2, deck, (a[1] + b[1]) / 2);
  const ux = dx / Math.hypot(dx, dz), uz = dz / Math.hypot(dx, dz);
  B.part('wood', 0); box(B, c.clone().add(V(0, -.08, 0)), V(L, .14, 1.3), yaw);
  B.part('wood', -.2); for (const s of [-.5, .5]) box(B, c.clone().add(V(-uz * s, -.25, ux * s)), V(L, .2, .16), yaw);   // (the stringers)
  B.part('wood', .05);
  for (const s of [-.6, .6]) {
    for (let q = 0; q <= 4; q++) { const f = -L / 2 + .2 + (L - .4) * q / 4, p = c.clone().add(V(ux * f - uz * s, 0, uz * f + ux * s)), g = q === 0 ? ga : q === 4 ? gb : deck - 1.4;
      box(B, V(p.x, (Math.min(g, deck) + deck + 1) / 2 - .2, p.z), V(.12, deck + 1.2 - Math.min(g, deck), .12)); }
    box(B, c.clone().add(V(-uz * s, .95, ux * s)), V(L - .3, .09, .09), yaw);
  }
  return B.geometry();
}
const SHAPES = new Map();
export function shapes(fam) {
  let S = SHAPES.get(fam); if (S) return S;
  S = {tree: Array.from({length: 8}, (_, i) => fjallbjork(i + 1, fam)), shrub: Array.from({length: 4}, (_, i) => shrub(i + 1, fam, false)), willow: Array.from({length: 4}, (_, i) => shrub(i + 11, fam, true)),
    stone: Array.from({length: 6}, (_, i) => stoneShape(i + 1, fam, i === 5)), cairn: Array.from({length: 4}, (_, i) => cairn(i + 1, fam)), cross: [crossShape(fam)]};
  SHAPES.set(fam, S); return S;
}
// one tile's props in one geometry: recs [{g (a shape), x, y, h (ground), yaw, s (scale), sy (a y scale)}]
const ATTR = [['position', 3], ['normal', 3], ['aPart', 1], ['aFam', 1], ['aBias', 1], ['aFixed', 1]];
export function mergeProps(recs) {
  let nv = 0; for (const r of recs) nv += r.g.attributes.position.count;
  if (!nv) return null;
  const A = {}; for (const [k, n] of ATTR) A[k] = new Float32Array(nv * n);
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), q = new THREE.Quaternion(), sc = V(), p = V(), up = V(0, 1, 0);
  let o = 0, inst = 0;
  for (const r of recs) {
    const g = r.g, c = g.attributes.position.count;
    m.compose(p.set(r.x, r.h, r.y), q.setFromAxisAngle(up, r.yaw), sc.set(r.s, r.s * (r.sy ?? 1), r.s)); nm.getNormalMatrix(m);
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < c; i++) {
      const k = (o + i) * 3;
      p.fromBufferAttribute(P, i).applyMatrix4(m); A.position[k] = p.x; A.position[k + 1] = p.y; A.position[k + 2] = p.z;
      p.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); A.normal[k] = p.x; A.normal[k + 1] = p.y; A.normal[k + 2] = p.z;
    }
    const pa = g.attributes.aPart.array, off = (inst * 7) % 64;
    for (let i = 0; i < c; i++) A.aPart[o + i] = (pa[i] + off) % 64;
    A.aFam.set(g.attributes.aFam.array, o); A.aBias.set(g.attributes.aBias.array, o); A.aFixed.set(g.attributes.aFixed.array, o);
    o += c; inst++;
  }
  const geo = new THREE.BufferGeometry(); for (const [k, n] of ATTR) geo.setAttribute(k, new THREE.BufferAttribute(A[k], n));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  return geo;
}
