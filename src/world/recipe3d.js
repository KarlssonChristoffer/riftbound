// RECIPE3D: turns a recipe (content/recipes.js) into a mesh geometry in the world's style. A recipe's build(b, p, r) calls the
// builder `b` below with plain shapes; each shape is a part with a family (world.js FAMS, or a paint: content/paints.js), so the
// result is toned by the biome's ramps, outlined, seamed between parts, mossed / snowed on what faces up, lit and shadowed like
// every live prop (the prop pipeline's attributes, as kit3d.geoOf).
//   recipeGeo(name, seed, params?, biome?) -> {geo, h, r} | null   geo: one geometry, the recipe's own frame (x east, y up, z south,
//                       metres, origin = its ground point); h its height, r its footprint radius (m). Cached per (name, seed, params).
//   recipeParams(name) -> {key: value}                            the defaults of its params
//   setRecipes(table)   the recipe table (the asset lab re-imports content/recipes.js and hands the new one here; clears the cache)
// THE BUILDER b (all sizes in metres, points [x, y, z] with y up; every option object may carry bias (tone shift, + lighter),
// fixed (a set tone 0..3, unlit) and part (an id: shapes with the same id are one part, no seam between them)):
//   b.tube(fam, a, c, r0, r1, o)      a cylinder from point a (radius r0) to point c (radius r1); o.sides (7)
//   b.cone(fam, a, c, r, o)           a cone from its base at a to its point at c
//   b.ball(fam, at, r, o)             a sphere (r a number or [rx, ry, rz]); o.detail (1), o.lump (0..1: knobbly), o.flat (cut at its middle)
//   b.cap(fam, at, r, h, o)           a mushroom cap: a dome r wide, h high, on its rim at `at`; o.under: a family for the gills under it,
//                                     o.funnel (0..1: a chanterelle's dip in the middle), o.droop (the rim bends down, m)
//   b.box(fam, at, size, rot, o)      a box of size [x, y, z] centred at `at`, rot [x, y, z] degrees
//   b.disc(fam, at, r, h, o)          a flat cylinder standing on `at`
//   b.at(pos, yaw, scale, fn)         fn() builds in a frame moved to pos, turned by yaw (deg) and scaled (a number): clusters, branches
//   b.onDome(at, r, h, u, v) -> [x, y, z]   a point on a dome's surface (u round 0..1, v up 0..1): spots on a cap
//   b.skip()                          a part left out (it keeps the later parts' numbers: a picked shrub drawn without its berries)
// THE RANDOM r (seeded per recipe and seed, the same on every machine): r() 0..1, r.range(a, b), r.int(a, b), r.pick(list),
//   r.sign(), r.chance(k)
// OWNS: the geometry cache.  READS: world.js FAMS (at build time), core/rng.js, core/mathx.js.
import * as THREE from 'three';
import {FAMS} from './world.js';   // (read when a recipe is built, never at load: world.js may import this module)
import {mulberry32, nameHash} from '../core/rng.js';
import {hash3} from '../core/mathx.js';
import {RECIPES as BOOK} from '../content/recipes.js';

let RECIPES = BOOK;   // (the asset lab swaps in a freshly saved copy: setRecipes)
const cache = new Map();
export function setRecipes(table) { RECIPES = table; for (const g of cache.values()) g?.geo.dispose(); cache.clear(); }
export const recipeList = () => Object.keys(RECIPES).filter(n => RECIPES[n].lab !== false);   // (lab: false: a part another file puts together, e.g. the watcher's eye)
export const recipeOf = name => RECIPES[name] || null;
export function recipeParams(name) {
  const R = RECIPES[name], out = {};
  for (const k in R?.params || {}) out[k] = R.params[k][0];
  return out;
}

const D2R = Math.PI / 180, V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
function rngOf(seed) {
  const f = mulberry32(seed >>> 0), r = () => f();
  r.range = (a, b) => a + (b - a) * f(); r.int = (a, b) => a + Math.floor(f() * (b - a + 1)); r.pick = l => l[Math.floor(f() * l.length)];
  r.sign = () => f() < .5 ? -1 : 1; r.chance = k => f() < k;
  return r;
}

// ---------------------------------------------------------------- the builder
function makeBuilder(seed) {
  const parts = [], stack = [new THREE.Matrix4()];
  let partN = 0;
  const top = () => stack[stack.length - 1];
  const fam = name => { const i = FAMS.indexOf(name); if (i < 0) console.warn('recipe: no family', name); return Math.max(0, i); };
  // add a geometry (its own frame) with matrix m in the current frame
  function add(f, g, m, o = {}) {
    const geo = g.index ? g.toNonIndexed() : g; if (geo !== g) g.dispose();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(top(), m));
    if (o.flat !== false) { geo.deleteAttribute('normal'); geo.computeVertexNormals(); }   // faceted: each face its own normal (the kit's flat look)
    parts.push({geo, fam: fam(f), part: o.part ?? partN++, bias: o.bias || 0, fixed: o.fixed ?? -1});
  }
  // knobble a geometry's vertices along their direction from the centre (seeded value noise; shared corners move together)
  function lumpy(g, k, s) {
    const P = g.attributes.position, v = V();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i); const n = (hash3(Math.round(v.x * 50) + s, Math.round(v.y * 50), Math.round(v.z * 50)) - .5) * 2;
      v.multiplyScalar(1 + n * k); P.setXYZ(i, v.x, v.y, v.z);
    }
    return g;
  }
  const along = (a, c) => {   // the matrix taking a unit y-axis cylinder (centred) onto a -> c
    const A = V(...a), C = V(...c), d = C.clone().sub(A), len = d.length() || 1e-4;
    return {m: new THREE.Matrix4().compose(A.add(C).multiplyScalar(.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), V(1, 1, 1)), len};
  };
  const b = {
    tube(f, a, c, r0, r1 = r0, o = {}) { const {m, len} = along(a, c); add(f, new THREE.CylinderGeometry(r1, r0, len, o.sides || 7, 1, !!o.open), m, o); },
    cone(f, a, c, r, o = {}) { const {m, len} = along(a, c); add(f, new THREE.ConeGeometry(r, len, o.sides || 7), m, o); },
    ball(f, at, r, o = {}) {
      const R = Array.isArray(r) ? r : [r, r, r];
      let g = new THREE.IcosahedronGeometry(1, o.detail ?? 1); if (o.lump) g = lumpy(g.index ? g : g, o.lump, seed + partN * 7);
      add(f, g, new THREE.Matrix4().compose(V(...at), new THREE.Quaternion(), V(...R)), o);
    },
    cap(f, at, r, h, o = {}) {
      // a lathe: the profile from the rim (r, 0 or -droop) up over the dome to the middle (0, h); a funnel dips it
      const pts = [], n = 6, fu = o.funnel || 0, dr = o.droop || 0;
      for (let i = 0; i <= n; i++) {
        const t = i / n, a = t * Math.PI / 2, x = r * Math.cos(a), y = h * Math.sin(a) - dr * (1 - Math.sin(a)) ** 2 - fu * h * 1.6 * Math.sin(a) ** 6;
        pts.push(new THREE.Vector2(Math.max(x, .0005), y));
      }
      add(f, new THREE.LatheGeometry(pts, o.sides || 10), new THREE.Matrix4().makeTranslation(...at), o);
      if (o.under) add(o.under, new THREE.CircleGeometry(r * .98, o.sides || 10).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(at[0], at[1] - dr + .002, at[2]), {bias: -.15});
    },
    box(f, at, size, rot = [0, 0, 0], o = {}) {
      add(f, new THREE.BoxGeometry(...size), new THREE.Matrix4().compose(V(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R)), V(1, 1, 1)), o);
    },
    disc(f, at, r, h, o = {}) { add(f, new THREE.CylinderGeometry(r, r, h, o.sides || 9), new THREE.Matrix4().makeTranslation(at[0], at[1] + h / 2, at[2]), o); },
    at(pos, yaw = 0, scale = 1, fn) {
      stack.push(new THREE.Matrix4().multiplyMatrices(top(), new THREE.Matrix4().compose(V(...pos), new THREE.Quaternion().setFromAxisAngle(UP, yaw * D2R), V(scale, scale, scale))));
      try { fn(); } finally { stack.pop(); }
    },
    onDome(at, r, h, u, v) { const a = u * Math.PI * 2, e = v * Math.PI / 2; return [at[0] + r * Math.cos(e) * Math.cos(a), at[1] + h * Math.sin(e), at[2] + r * Math.cos(e) * Math.sin(a)]; },
    skip() { partN++; },   // a part left out (a picked shrub's berries: content/recipes.js picked): the parts after it keep their numbers and lumps
  };
  return {b, parts};
}

// the parts -> one geometry with the prop pipeline's attributes (aPart / aFam / aBias / aFixed; kit3d.geoOf)
function merge(parts) {
  let n = 0; for (const q of parts) n += q.geo.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), aPart = new Float32Array(n), aFam = new Float32Array(n), aBias = new Float32Array(n), aFixed = new Float32Array(n);
  let o = 0;
  for (const q of parts) {
    const P = q.geo.attributes.position, N = q.geo.attributes.normal, c = P.count;
    pos.set(P.array, o * 3); nrm.set(N.array, o * 3);
    aPart.fill(q.part % 64, o, o + c); aFam.fill(q.fam, o, o + c); aBias.fill(q.bias, o, o + c); aFixed.fill(q.fixed, o, o + c);
    o += c; q.geo.dispose();
  }
  const g = new THREE.BufferGeometry(), A = (k, a, s) => g.setAttribute(k, new THREE.BufferAttribute(a, s));
  A('position', pos, 3); A('normal', nrm, 3); A('aPart', aPart, 1); A('aFam', aFam, 1); A('aBias', aBias, 1); A('aFixed', aFixed, 1);
  g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}

export function recipeGeo(name, seed = 0, params = null, biome = 'ruins') {
  const R = RECIPES[name]; if (!R) return null;
  const p = {...recipeParams(name), ...(params || {})}, key = name + '|' + seed + '|' + biome + '|' + JSON.stringify(p);
  if (cache.has(key)) return cache.get(key);
  const {b, parts} = makeBuilder(nameHash(name) ^ seed);
  let out = null;
  try {
    R.build(b, p, rngOf(nameHash(name) * 31 + seed * 7919), {biome, seed});
    if (parts.length) {
      const geo = merge(parts), bb = geo.boundingBox;
      out = {geo, h: bb.max.y, r: Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z)};
    }
  } catch (e) { console.warn('recipe', name, e); for (const q of parts) q.geo.dispose(); }
  cache.set(key, out);
  return out;
}
