// FLOOR3D: the forest ground's small loose things as real 3D, not pixels painted flat into the ground (Christoffer 2026-10-16, after
// trying first person: "the stones are flat, the river is just pixel art": pebbles and other ground details should add depth). The
// painters used to stamp each pebble, stream stone and twig into the ground's canvas; with a sink in their ctx (ctx.floor3d:
// biomes.js forestRuins and meadowDetail's pebble, forest.js paint) they hand it here instead and paint only its damp seat. This module
// lays them as low faceted solids in the kit's families (rock, bark), one static mesh per painted tile (world.js: culled with the
// tile), so they are toned by the biome's ramps, outlined, lit, cast a sun shadow and take the biome's moss on their tops like every
// 3D prop. From the top-down camera they read about as the painted ones did; from his eyes they stand up off the ground.
//   kinds    0 PEBBLE   a few cm: the forest floor's, the strand's and the point bars' bigger ones (icosahedron, 20 faces, a knobbly
//                       flat egg; the smaller ones stay painted, the gravel)
//            1 STONE    a stream's riffle stones (forest.js F.stones: the water's dry spots, foam round them), the banks' loose stones
//            2 BOULDER  the strand's big stones, the spring's ring (80 faces)
//            3 TWIG     a fallen twig or stick lying on the floor: rx = half its length, ry = its radius (a bent square-section rod)
//   floorSink(x0, z0, x1, z1) -> {add(x, y, rx, ry, kind), n}: keeps only what lies inside the tile (the painters paint a margin round it)
//   floorGeometry(sink, o) -> BufferGeometry | null   o = {fam(name) -> family index, ground(x, z) -> m (the drawn ground)}
// Seeded by position (hash3): the same world builds the same things, no Math.random. Frame: world metres, x east, y up, z south.
// No colliders: they're walked over; the stream stones were dry footing before (world.js forestSample) and still are.
// BUDGET: built once per world into preallocated arrays (no per-frame work); drawn as one mesh per tile in the G-buffer and in the
// cached static sun shadow.
import * as THREE from 'three';
import {hash3 as hsh} from '../core/mathx.js';

// the look per kind: detail (icosahedron), knobbliness, height / width, how deep it sits (share of its height under the ground), the
// shading normal's exaggeration (a facet a little askew takes a whole tone: painted-rock planes), a tone bias (the pebbles lighter: at
// a few px most of a pebble is its outline, so its middle wants to be light); a twig's bend (share of its length), how high its axis
// lies (radii over the ground), its tone
export const TUNE = {
  kinds: [
    {detail: 0, lump: .2, flat: [.5, .75], bury: [.25, .45], ex: 1.25, tone: .2},
    {detail: 1, lump: .22, flat: [.45, .68], bury: [.2, .35], ex: 1.6, tone: .04},
    {detail: 1, lump: .22, flat: [.45, .65], bury: [.3, .45], ex: 1.6, tone: 0},
    {bend: .22, lie: .6, tone: -.05}],
  bias: .22,      // the spread of tone bias between pieces (some lighter, some darker)
};
const TWIG_TRI = 3 * 4 * 2 + 2 * 2;   // a twig: 3 segments x 4 sides x 2 triangles + its two ends

// the stones' shapes (radius 1, unit sphere): unique corners and faces of an icosahedron, detail 0 and 1
const shapes = {};
function shape(detail) {
  if (shapes[detail]) return shapes[detail];
  const g = new THREE.IcosahedronGeometry(1, detail), P = g.attributes.position.array, key = new Map(), V = [], F = [];
  for (let i = 0; i < P.length; i += 3) {
    const k = `${P[i].toFixed(4)},${P[i + 1].toFixed(4)},${P[i + 2].toFixed(4)}`;
    let j = key.get(k); if (j === undefined) { j = V.length / 3; key.set(k, j); V.push(P[i], P[i + 1], P[i + 2]); }
    F.push(j);
  }
  g.dispose();
  return (shapes[detail] = {V: Float32Array.from(V), F: Uint16Array.from(F)});
}

export function floorSink(x0, z0, x1, z1) {
  const L = [];
  return {L, get n() { return L.length / 5; },
    add(x, y, rx, ry = rx, kind = 0) { if (x >= x0 && x < x1 && y >= z0 && y < z1) L.push(x, y, rx, ry, kind); }};
}

export function floorGeometry(S, o) {
  const L = S.L, n = L.length / 5; if (!n) return null;
  let nTri = 0; for (let i = 0; i < n; i++) { const k = L[i * 5 + 4]; nTri += k === 3 ? TWIG_TRI : shape(TUNE.kinds[k].detail).F.length / 3; }
  const pos = new Float32Array(nTri * 9), nrm = new Float32Array(nTri * 9), aPart = new Float32Array(nTri * 3), aFam = new Float32Array(nTri * 3);
  const aBias = new Float32Array(nTri * 3), aFixed = new Float32Array(nTri * 3).fill(-1), W = new Float32Array(42 * 3);
  const famRock = o.fam('rock'), famTwig = o.fam('bark');
  let t = 0, part = 0, fam = 0, bias = 0;
  // one triangle (W offsets a, b, d) facing away from (cx, cy, cz); its shading normal exaggerated ex times away from that direction
  function tri(a, b, d, cx, cy, cz, ex) {
    const ux = W[b] - W[a], uy = W[b + 1] - W[a + 1], uz = W[b + 2] - W[a + 2], vx = W[d] - W[a], vy = W[d + 1] - W[a + 1], vz = W[d + 2] - W[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (W[a] + W[b] + W[d]) / 3 - cx, my = (W[a + 1] + W[b + 1] + W[d + 1]) / 3 - cy, mz = (W[a + 2] + W[b + 2] + W[d + 2]) / 3 - cz;
    const flip = nx * mx + ny * my + nz * mz < 0;
    let l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    if (ex !== 1) {
      const ml = Math.hypot(mx, my, mz) || 1, hx = mx / ml, hy = my / ml, hz = mz / ml;
      nx = hx + (nx - hx) * ex; ny = hy + (ny - hy) * ex; nz = hz + (nz - hz) * ex; l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    }
    const p1 = flip ? d : b, p2 = flip ? b : d;
    for (let q = 0; q < 3; q++) {
      const p = q === 0 ? a : q === 1 ? p1 : p2, j = t * 3 + q;
      pos[j * 3] = W[p]; pos[j * 3 + 1] = W[p + 1]; pos[j * 3 + 2] = W[p + 2];
      nrm[j * 3] = nx; nrm[j * 3 + 1] = ny; nrm[j * 3 + 2] = nz; aPart[j] = part; aFam[j] = fam; aBias[j] = bias;
    }
    t++;
  }
  for (let i = 0; i < n; i++) {
    const x = L[i * 5], z = L[i * 5 + 1], rx = L[i * 5 + 2], rz = L[i * 5 + 3], kind = L[i * 5 + 4], K = TUNE.kinds[kind];
    const h = j => hsh(x * 97.1, z * 89.3, j);
    part = i % 63 + 1; bias = K.tone + (h(5) - .5) * TUNE.bias;
    if (kind === 3) {   // a TWIG: a rod of 4 points along its length, bent to one side, each lying on the ground there
      fam = famTwig;
      const yaw = h(2) * 6.2832, ux = Math.cos(yaw), uz = Math.sin(yaw), r = rz, bend = (h(6) - .5) * 2 * K.bend * rx;
      for (let k = 0; k < 4; k++) {
        const u = k / 3 * 2 - 1, side = bend * (1 - u * u), px = x + ux * u * rx - uz * side, pz = z + uz * u * rx + ux * side;
        const cy = o.ground(px, pz) + r * K.lie + (h(7 + k) - .5) * r * .6;
        // its square section turned 45 deg (a diamond: one corner up), across the rod's direction at this point
        const ax = -uz, az = ux;
        for (let c = 0; c < 4; c++) {
          const v = (k * 4 + c) * 3, ca = c === 0 ? 0 : c === 1 ? 1 : c === 2 ? 0 : -1, sa = c === 0 ? 1 : c === 1 ? 0 : c === 2 ? -1 : 0;
          W[v] = px + ax * ca * r; W[v + 1] = cy + sa * r; W[v + 2] = pz + az * ca * r;
        }
      }
      // its sides face away from the rod's axis (a ring's middle), its ends away from the next ring in
      const mid = (k, e) => (W[k * 12 + e] + W[k * 12 + 3 + e] + W[k * 12 + 6 + e] + W[k * 12 + 9 + e]) / 4;
      for (let k = 0; k < 3; k++) {
        const cx = (mid(k, 0) + mid(k + 1, 0)) / 2, cy = (mid(k, 1) + mid(k + 1, 1)) / 2, cz = (mid(k, 2) + mid(k + 1, 2)) / 2;
        for (let c = 0; c < 4; c++) {
          const a = (k * 4 + c) * 3, b = (k * 4 + (c + 1) % 4) * 3, a2 = a + 12, b2 = b + 12;
          tri(a, b, b2, cx, cy, cz, 1); tri(a, b2, a2, cx, cy, cz, 1);
        }
      }
      for (const [k, kn] of [[0, 1], [3, 2]]) {
        const e = k * 12, cx = mid(kn, 0), cy = mid(kn, 1), cz = mid(kn, 2);
        tri(e, e + 3, e + 6, cx, cy, cz, 1); tri(e, e + 6, e + 9, cx, cy, cz, 1);
      }
      continue;
    }
    // a STONE: the icosahedron knobbled, squashed, turned and sunk into the ground
    fam = famRock;
    const {V, F} = shape(K.detail);
    const sy = rx * (K.flat[0] + (K.flat[1] - K.flat[0]) * h(1)), yaw = (h(2) - .5) * (kind === 1 ? .6 : 6.28);   // (a stream stone keeps its dry spot's axes)
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // its foot: the lowest of the ground under its middle and its rim (on a slope it sinks into the uphill side, never floats)
    let g = o.ground(x, z); for (let k = 0; k < 4; k++) { const a = k * 1.5708 + yaw; g = Math.min(g, o.ground(x + Math.cos(a) * rx * .8, z + Math.sin(a) * rz * .8)); }
    const cy = g + sy * (1 - 2 * (K.bury[0] + (K.bury[1] - K.bury[0]) * h(3))), seed = h(4) * 1000;
    for (let v = 0; v < V.length; v += 3) {   // knobbled along each corner's own direction (shared corners move together)
      const k = 1 + (hsh(Math.round(V[v] * 9) + seed, Math.round(V[v + 1] * 9), Math.round(V[v + 2] * 9)) - .5) * 2 * K.lump;
      const lx = V[v] * k * rx, ly = V[v + 1] * k * sy, lz = V[v + 2] * k * rz;
      W[v] = x + lx * c - lz * s; W[v + 1] = cy + ly; W[v + 2] = z + lx * s + lz * c;
    }
    for (let f = 0; f < F.length; f += 3) {
      const a = F[f] * 3, b = F[f + 1] * 3, d = F[f + 2] * 3;
      if (W[a + 1] < g - .005 && W[b + 1] < g - .005 && W[d + 1] < g - .005) continue;   // (wholly under the ground)
      tri(a, b, d, x, cy, z, K.ex);
    }
  }
  if (!t) return null;
  const geo = new THREE.BufferGeometry(), A = (k, a, w) => geo.setAttribute(k, new THREE.BufferAttribute(a.subarray(0, t * 3 * w), w));
  A('position', pos, 3); A('normal', nrm, 3); A('aPart', aPart, 1); A('aFam', aFam, 1); A('aBias', aBias, 1); A('aFixed', aFixed, 1);
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  return geo;
}
