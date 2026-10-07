// FLORA3D: the low plants as real 3D shapes (the true-3D pivot, 2026-10-07): bushes, ferns, tufts and reeds, grown in the browser per
// biome the way world/trees3d.js grows the trees, to fit each biome's painted card (biomes.js bush / tuft / reed / fern, desert.js
// desertBush / dryTuft). A plant is one or two SHAPES, each drawn for every plant that uses it in one instanced draw (render/flora.js):
//   mesh    leaf clumps, fronds, pads, twigs, crystals: the prop pipeline's attributes (trees3d.js Build: aPart / aFam / aBias / aFixed /
//           aFlex / aPhase), toned by the biome's ramps and outlined like the 3D trees (G-buffer type 2). aFixed: -2 leaves (the leaf
//           clusters' tone, thinned by the season, the plant's autumn colours, never covered), -1.75 plain leaves (as -2 without the
//           clusters: a fern's fronds), -2.5 needles under snow (as -2, and the biome's cover lies on what faces up: the frost bushes),
//           -1 toned + covered, -1.45 toned, never covered, >= 0 a fixed tone
//   blades  grass blades, reed stems, cattail heads, twigs: strips one or a few art px wide, drawn like render/grass.js's blades (each row
//           a whole number of px from the root, so a blade leans a pixel at a time) and lit as ground (G-buffer type 1: the composite
//           shadows, snows on, wets and season-tints them like the grass round them). Each blade is a quadratic curve root -> ctrl ->
//           tip (local metres) and a run t0..t1 of it, w px wide, coloured by the biome's blade ramps (BLADE_RAMPS) and a scheme
// Every shape is in the plant's own frame (x east, y up, z south, metres, origin = its ground point), turned and scaled per plant.
// flex: the wind's bend weight by height (features/wind.js CURVES, u = height / the plant's height): per clump (a clump moves as a
// block) or per vertex (a twig, a frond); the lean itself is the wind's spring per plant (world.js, render/flora.js).
// floraShapes(kind, biome, variant, fam, style) -> {mesh: {geo, casts} | null, blades: {geo} | null, h (m), key} | null (no 3D shape:
// the plant keeps its card). Cached per (biome, kind, variant). bladeRamps(biome, style) -> 4 ramps x 4 tones [r, g, b] 0..1.
// OWNS: the plant shapes (cached).  READS: trees3d.js's builders.
import * as THREE from 'three';
import {Build, tube, clump, lobeOf, fluted, quadF, rng, vn3, h3} from './trees3d.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), TAU = Math.PI * 2;
export const NO_COVER = -1.45, LEAF = -2, LEAF_COVERED = -2.5;   // (FERN, below: -1.75, plain leaves)
// the wind's row weights (features/wind.js CURVES, by kind and biome: FLEX's curve names), u = height / the plant's height
const CURVE = {
  tip: u => u < .2 ? 0 : ((u - .2) / .8) ** 1.25, reed: u => u < .12 ? 0 : ((u - .12) / .88) ** 1.15, bush: u => u < .22 ? 0 : ((u - .22) / .78) ** 1.1,
  twig: u => u < .38 ? 0 : (u - .38) / .62, coral: u => u ** 1.6, none: () => 0,
};
// blade flex as (u0, power) for the shader: the same curves as a start and a power
const BLADE_FLEX = {tip: [.2, 1.25], reed: [.12, 1.15], twig: [.38, 1], bush: [.22, 1.1], none: [2, 1]};
// the blade ramps per biome: 4 of the style's ramps (ramp index 0..3 of a blade's colour code)
export const BLADE_RAMPS = {ruins: ['grass', 'reed', 'cattail', 'bark'], frost: ['bark', 'straw', 'cattail', 'snow'], desert: ['grass', 'bark', 'straw', 'rock'],
  ember: ['ash', 'wall', 'lava', 'floor'], rift: ['floor', 'wall', 'crystal', 'rock']};
const hex01 = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
export function bladeRamps(biome, style) {
  return (BLADE_RAMPS[biome] || BLADE_RAMPS.ruins).map(k => (style[k]?.h || style.grass?.h || ['#808080', '#606060', '#404040', '#202020']).map(hex01));
}
// blade colour codes: ramp * 4 + scheme (scheme 0 a blade: dark foot, mid body, light tip; 1 a head: lit left, shaded right; 2 a blade a
// tone darker (behind, the long leaves); 3 the ramp's light tone (snow on a head))
const COL = (ramp, scheme) => ramp * 4 + scheme;

// ---------------------------------------------------------------- the blade builder
class Blades {
  constructor(H, flex) { this.H = H; this.flex = BLADE_FLEX[flex] || BLADE_FLEX.tip; this.pos = []; this.R = []; this.M = []; this.T = []; this.B = []; this.C = []; this.idx = []; this.n = 0; this.count = 0; }
  // one strip along root R -> ctrl M -> tip T, over t0..t1, w px wide, colour code col, phase ph (0..1, its own: flutter, autumn patch)
  strip(R, M, T, t0, t1, w, col, ph, rows = 4) {
    const b = this.n;
    for (let i = 0; i < rows; i++) for (const s of [-.5, .5]) {
      this.pos.push(s, i / (rows - 1), 0); this.R.push(R.x, R.y, R.z); this.M.push(M.x, M.y, M.z); this.T.push(T.x, T.y, T.z);
      this.B.push(t0, t1, w, col); this.C.push(this.flex[0], this.flex[1], this.H, ph); this.n++;
    }
    for (let i = 0; i < rows - 1; i++) { const a = b + i * 2; this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    this.count++;
  }
  geometry() {
    const g = new THREE.BufferGeometry(), A = (n, a, k) => g.setAttribute(n, new THREE.Float32BufferAttribute(a, k));
    A('position', this.pos, 3); A('aR', this.R, 3); A('aM', this.M, 3); A('aT', this.T, 3); A('aB', this.B, 4); A('aC', this.C, 4); g.setIndex(this.idx);
    g.boundingSphere = new THREE.Sphere(V(0, this.H / 2, 0), this.H + 1); return g;
  }
}
// a blade rising from root p, leaning out by `out` (m at the tip, a vector), to height h, its tip curling over by `curl` (m down)
function blade(BL, p, out, h, col, ph, {w = 1, curl = 0, t0 = 0, t1 = 1, rows = 4, bow = .55} = {}) {
  const T = V(p.x + out.x, p.y + h - curl, p.z + out.z), M = V(p.x + out.x * (1 - bow) * .5, p.y + h * .62, p.z + out.z * (1 - bow) * .5);
  BL.strip(p, M, T, t0, t1, w, col, ph, rows);
  return {R: p, M, T};
}

// ---------------------------------------------------------------- the mesh builder: clumps, lobes and twigs per plant kind
// the bush's leaf mass: clumps on a loose dome, the lower ones darker, a dark core; each clump a block on the wind (its own phase)
function leafDome(B, r, seed, {n, R, H, rad, fixed = LEAF, curve = 'bush', bias = 0, detail = 2, lumpK = 1.3, squash = .82, core = true}) {
  const C = V(0, H * .5, 0), Rv = V(R, H * .5, R), list = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + r() * .6, e = (i + .5) / n, rr = R * (.35 + .6 * Math.sqrt(1 - e) * (.7 + r() * .3)), y = H * (.3 + .55 * e) * (.85 + r() * .2);
    list.push({c: V(Math.cos(a) * rr, y, Math.sin(a) * rr), rad: rad * (.8 + r() * .4) * (1 - .25 * e)});
  }
  if (core) list.push({c: V(0, H * .38, 0), rad: Math.min(R, H) * .62, core: true});
  for (const [i, q] of list.entries()) {
    const ey = (q.c.y - C.y) / Rv.y, b = bias + (q.core ? -.22 : .26 * ey - .06 + (r() - .5) * .08);
    B.part('leaf', b, fixed, CURVE[curve](Math.min(1, q.c.y / H)), q.core ? -1 : (i * 2.39996 + seed * .7) % TAU);
    clump(B, q.c, q.rad, squash, seed * 13 + i, C, Rv, b, r, detail, lumpK);
  }
}
// a branching twig (bark / wood): from p along dir, length len, forking `depth` times; tips(p) at every end
function twig(B, r, p, dir, len, rad, depth, H, curve, fam, tips, fixed = -1) {
  const e = p.clone().addScaledVector(dir, len), mid = p.clone().lerp(e, .5).add(V((r() - .5) * len * .15, len * .05, (r() - .5) * len * .15));
  const f = CURVE[curve];
  B.flexOf = y => f(Math.min(1, Math.max(0, y) / H)); B.part(fam, 0, fixed); tube(B, [p, mid, e], [rad, rad * .8, rad * .6], 4, r(), depth === 0);
  if (depth === 0) { tips.push({p: e, d: dir}); return; }
  for (const s of [-1, 1]) {
    const ax = V().crossVectors(dir, V(r() - .5, .2, r() - .5)).normalize(), d = dir.clone().applyAxisAngle(ax, s * (.45 + r() * .3)).add(V(0, .15, 0)).normalize();
    twig(B, r, e, d, len * (.6 + r() * .1), rad * .7, depth - 1, H, curve, fam, tips, fixed);
  }
}

// ---------------------------------------------------------------- the shapes, per biome and kind (each fits its painted card)
const SHAPES = {
  // ---- the ruins (biomes.js): a leafy bush, a fern, a grass tuft, a reed clump
  'ruins:bush': (v, B, r) => { leafDome(B, r, v * 7 + 3, {n: 5 + (v % 2) * 2, R: .34 + v * .03, H: .58 + (v === 2 ? .08 : 0), rad: .19}); twigFoot(B, r, .5); return {h: .62}; },
  'ruins:fern': (v, B, r) => fernShape(B, r, v),
  'ruins:tuft': (v, B, r, BL) => { grassTuft(BL, r, v, 0, {n: 6 + (v % 2) + (v === 2 ? -1 : 1), h: [.1, .27]}); return {h: .26, noMesh: true}; },
  'ruins:reed': (v, B, r, BL) => reedClump(BL, r, v, {stem: 1, head: 2, snow: false}),
  // ---- frost: a squat snowy conifer shrub, bare twigs out of a snow mound, dry reeds with snow on the heads
  'frost:bush': (v, B, r) => { leafDome(B, r, v * 7 + 5, {n: 5 + (v % 2), R: .3 + v * .03, H: .42, rad: .2, fixed: LEAF_COVERED, squash: .7, lumpK: 1.1}); return {h: .45}; },
  'frost:tuft': (v, B, r, BL) => {
    B.part('cover', 0, -1, 0, -1); clump(B, V(0, -.02, 0), .15, .38, v * 3 + 1, V(0, 0, 0), V(.2, .1, .2), .05, r, 1, .8);
    for (let i = 0; i < 3 + (v % 2); i++) { const a = i * 2.2 + r(), p = V(Math.cos(a) * .04, .02, Math.sin(a) * .04); blade(BL, p, V(Math.cos(a) * .04, 0, Math.sin(a) * .04), .08 + r() * .08, COL(0, 0), r(), {rows: 3}); }
    return {h: .16};
  },
  'frost:reed': (v, B, r, BL) => reedClump(BL, r, v, {stem: 1, head: 2, snow: true}),
  // ---- the desert (desert.js): sagebrush, prickly pear, barrel cactus, creosote; dry grass
  'desert:bush': (v, B, r) => [sage, pear, barrel, creosote][v % 4](B, r, v),
  'desert:tuft': (v, B, r, BL) => {
    grassTuft(BL, r, v, 0, {n: 7 + (v % 2), h: [.12, .26], stiff: true});
    if (v === 2) { B.part('rock', 0, -1, 0, -1); lobeOf(B, V(.06, .04, .05), V(1, .1, .3), V(0, 1, 0), .085, .055, .07, 5, V(.06, .04, .05), V(1, 1, 1), 0, 0, r, 1, .2); return {h: .24}; }
    return {h: .24, noMesh: true};
  },
  // ---- the ember lands: a dead thorn shrub with smouldering tips; a vent in the ash
  'ember:bush': (v, B, r) => {
    const tips = [];
    for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + r() * .8, d = V(Math.cos(a) * .55, 1, Math.sin(a) * .55).normalize(); twig(B, r, V(Math.cos(a) * .02, -.02, Math.sin(a) * .02), d, .2 + r() * .08, .022, 2, .55, 'bush', 'wood', tips); }
    B.flexOf = y => CURVE.bush(Math.min(1, y / .55));
    for (const [i, t] of tips.entries()) if (h3(i, v, 3, 1) < .4) { B.part('crack', 0, h3(i, v, 4, 2) < .5 ? 0 : 1, CURVE.bush(Math.min(1, t.p.y / .55)), -1); lobeOf(B, t.p.clone().addScaledVector(t.d, .012), t.d, V(0, 1, 0), .022, .018, .018, i, t.p, V(1, 1, 1), 0, 0, r, 'oct', 0); }
    return {h: .55};
  },
  'ember:tuft': (v, B, r) => {
    B.part('cover', 0, -1, 0, -1); clump(B, V(0, -.03, 0), .2, .3, v + 2, V(0, 0, 0), V(.2, .1, .2), 0, r, 1, .6);
    const sr = rng(v * 5 + 1), sr2 = rng(v * 5 + 1);   // (the dark rim and the glow along the same line)
    B.part('rock', -.1, 3, 0, -1); slit(B, sr, .3, .075, .035);
    B.part('crack', 0, 0, 0, -1); slit(B, sr2, .26, .04, .04);
    return {h: .08};
  },
  // ---- the rift: void coral with glowing tips; a little crystal on a chip of floor
  'rift:bush': (v, B, r) => {
    for (let k = 0; k < 5; k++) {
      const a = k * 2.39996 + r(), x0 = Math.cos(a) * (.04 + r() * .08), z0 = Math.sin(a) * (.04 + r() * .08), L = .2 + r() * .3, pts = [V(x0, -.02, z0)];
      let d = V(Math.cos(a) * .25, 1, Math.sin(a) * .25).normalize();
      for (let s = 1; s <= 3; s++) { d = d.clone().add(V((r() - .5) * .5, .1, (r() - .5) * .5)).normalize(); pts.push(pts[s - 1].clone().addScaledVector(d, L / 3)); }
      B.flexOf = y => CURVE.coral(Math.min(1, Math.max(0, y) / .5)); B.part('stone', 0, NO_COVER); tube(B, pts, [.026, .022, .018, .014], 4, r(), true);
      const tp = pts[3]; B.part('rune', .1, k % 2 ? 1 : 0, CURVE.coral(Math.min(1, tp.y / .5)), -1); lobeOf(B, tp.clone().addScaledVector(d, .02), d, V(0, 1, 0), .03, .026, .026, k, tp, V(1, 1, 1), 0, .1, r, 0, .05);
    }
    return {h: .5};
  },
  'rift:tuft': (v, B, r) => {
    B.part('stone', .04, NO_COVER, 0, -1); lobeOf(B, V(0, -.005, 0), V(1, 0, .2), V(0, 1, 0), .13, .025, .1, v + 9, V(0, 0, 0), V(1, 1, 1), 0, .04, r, 1, .25);
    const h = .24 - v * .03, ax = V((r() - .5) * .3, 1, (r() - .5) * .3).normalize();
    B.part('rune', .08, NO_COVER, 0, -1); crystal(B, V(0, .01, 0), ax, h, .036, r);
    if (v !== 1) crystal(B, V(.05, .01, .03), V(.4, 1, .2).normalize(), h * .55, .022, r);
    return {h};
  },
};
// a few short dark twigs at a leafy bush's foot (they show under it, and in a crown the season thinned)
function twigFoot(B, r, H) {
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * TAU + r(), d = V(Math.cos(a) * .5, 1, Math.sin(a) * .5).normalize();
    B.flexOf = y => CURVE.bush(Math.min(1, Math.max(0, y) / H)); B.part('bark', -.05, -1); tube(B, [V(0, -.03, 0), V(0, -.03, 0).addScaledVector(d, .14), V(0, -.03, 0).addScaledVector(d, .26)], [.02, .016, .01], 4, r(), true);
  }
}
// a slit in a vent's top (the ember tufts): a flat strip, a hair over the mound
function slit(B, r, len, w, y) {
  const a = r() * TAU, d = V(Math.cos(a), 0, Math.sin(a)), s = V(-d.z, 0, d.x), up = V(0, 1, 0), p = V(0, y, 0);
  const pts = [-1, -.3, .4, 1].map(f => p.clone().addScaledVector(d, f * len / 2).addScaledVector(s, (r() - .5) * w * .8));
  for (let i = 0; i + 1 < pts.length; i++) { const a0 = pts[i], a1 = pts[i + 1]; quadF(B, a0.clone().addScaledVector(s, -w / 2), a0.clone().addScaledVector(s, w / 2), a1.clone().addScaledVector(s, w / 2), a1.clone().addScaledVector(s, -w / 2), up, 0); }
}
// a hexagonal crystal with a pointed top, standing on base along ax
function crystal(B, base, ax, h, cr, r) {
  const tg = V().crossVectors(ax, V(1, 0, 0)).normalize(), bt = V().crossVectors(ax, tg), rt = r() * TAU;
  const ringAt = (s, rad) => Array.from({length: 6}, (_, k) => { const q = rt + k / 6 * TAU; return base.clone().addScaledVector(ax, s).addScaledVector(tg, Math.cos(q) * rad).addScaledVector(bt, Math.sin(q) * rad); });
  const r0 = ringAt(0, cr), r1 = ringAt(h * .75, cr * 1.05), ap = base.clone().addScaledVector(ax, h);
  for (let k = 0; k < 6; k++) { const m = r0[k].clone().add(r0[(k + 1) % 6]).multiplyScalar(.5).sub(base); quadF(B, r0[k], r0[(k + 1) % 6], r1[(k + 1) % 6], r1[k], m, 0); }
  for (let k = 0; k < 6; k++) { const m = r1[k].clone().add(r1[(k + 1) % 6]).multiplyScalar(.5).sub(base).addScaledVector(ax, -h * .4); quadF(B, r1[k], r1[(k + 1) % 6], ap, ap.clone().lerp(r1[k], .001), m, .1); }
}
// a grass tuft: n blades from a small ring, the outer ones shorter and leaning out, the middle ones tall (the card's fan)
function grassTuft(BL, r, v, ramp, {n, h, stiff = false}) {
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + v * 1.3 + r() * .4, rr = .02 + r() * .09, p = V(Math.cos(a) * rr, 0, Math.sin(a) * rr), hh = h[0] + (h[1] - h[0]) * (1 - rr / .12) * (.75 + r() * .35);
    const out = V(Math.cos(a), 0, Math.sin(a)).multiplyScalar(hh * (stiff ? .35 : .45) * (.6 + r() * .6));   // (the blades stand across ~.25 m, as the card's, the outer ones leaning out)
    blade(BL, p, out, hh, COL(ramp, r() < .25 ? 2 : 0), r(), {curl: stiff ? 0 : hh * .12 * r(), rows: 4});
  }
}
// a reed clump (biomes.js reed): stems from a small ellipse leaning out and arching, the outer ones shorter; 0 reeds, 1 cattails with
// brown heads (and a thin spike over each), 2 a mix; the long leaves arching out of the foot. frost: dry stalks, snow on the heads
function reedClump(BL, r, v, {stem, head, snow}) {
  const n = [8, 6, 7][v % 3];
  for (let i = 0; i < n; i++) {
    const cat = v === 1 || (v === 2 && i % 2 === 1), a = i * 2.39996 + v + r() * .5, rr = .04 + r() * .14, p = V(Math.cos(a) * rr, 0, Math.sin(a) * rr * .8);
    const f = rr / .18, len = (cat ? 1.28 : 1.14) * (1 - f * .22) + (r() - .5) * .18, out = V(Math.cos(a), 0, Math.sin(a)).multiplyScalar(.04 + f * .12 + r() * .05);
    const dim = f > .7 ? 2 : 0, curl = cat ? .02 : .05 + r() * .06;
    const s = blade(BL, p, out, len, COL(stem, dim), r(), {w: 2, curl, t1: cat ? .3 : .46, rows: 3});
    BL.strip(s.R, s.M, s.T, cat ? .3 : .46, 1, 1, COL(stem, dim), r(), 4);
    if (cat) {   // the head: a brown run, 3 px wide, from .7 to .87 of the stem (the stem goes on above it: the spike)
      BL.strip(s.R, s.M, s.T, .7, .87, 3, COL(head, 1), r(), 3);
      if (snow) BL.strip(s.R, s.M, s.T, .855, .875, 3, COL(3, 3), r(), 2);
    }
  }
  for (let k = 0; k < (v === 1 ? 4 : 3); k++) {   // the long leaves arching out of the foot
    const a = k * 2.2 + v + r(), p = V(Math.cos(a) * .03, 0, Math.sin(a) * .03), L = .5 + r() * .25;
    blade(BL, p, V(Math.cos(a), 0, Math.sin(a)).multiplyScalar(L * .6), L * .55, COL(stem, 2), r(), {curl: L * .35, bow: .2, rows: 5});
  }
  return {h: 1.25, noMesh: true};
}
// a fern (biomes.js fern): 7 + v fronds round the crown, each rising and arching out and down: a RIBBON along it, widest a third of the way
// out and tapering to the tip, its edge serrated (the pinnae: the card's leaflet ticks), the two halves rolled a little apart (a lit and a
// shaded side). The leaf family (soft: the halves meet in tone), plain leaves (FERN: no clusters); the frond bends in blocks, more out at
// its tip (a part per stretch)
const FERN = -1.75;
function fernShape(B, r, v) {
  const n = 7 + v, H = .5, NS = 7, NE = 14;
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + r() * .5, d = V(Math.cos(a), 0, Math.sin(a)), s = V(-d.z, 0, d.x), L = .42 + r() * .14, el = .95 + r() * .3, ph = (i * 2.39996 + v) % TAU;
    const P = t => V(0, 0, 0).addScaledVector(d, L * t * (.7 + .3 * t)).add(V(0, L * (Math.sin(el) * t - .95 * t * t) + .03, 0)), Tn = t => P(Math.min(1, t + .03)).sub(P(Math.max(0, t - .03))).normalize();
    const W = t => .085 * Math.sin(Math.PI * Math.min(1, Math.pow(t, .62))) + .006;
    for (let k = 0; k < NS; k++) {   // stretches along the frond (each a block on the wind: the tip's moves most)
      const ta = .06 + .94 * k / NS, tb = .06 + .94 * (k + 1) / NS, fl = CURVE.bush(Math.min(1, .3 + .7 * tb)), bias = .1 + .16 * (P((ta + tb) / 2).y / H) - .12 * (1 - tb) + (r() - .5) * .06;
      B.part('leaf', bias, FERN, fl, ph);
      const m = Math.round(NE / NS);
      for (let q = 0; q < m; q++) {
        const t0 = ta + (tb - ta) * q / m, t1 = ta + (tb - ta) * (q + 1) / m, c0 = P(t0), c1 = P(t1), tg = Tn((t0 + t1) / 2), nrm = V().crossVectors(tg, s).normalize(); if (nrm.y < 0) nrm.negate();
        for (const sd of [-1, 1]) {   // a half: rachis to a serrated edge (out at t0's tooth, back in at t1)
          const e0 = c0.clone().addScaledVector(s, sd * W(t0)).add(V(0, -W(t0) * .25, 0)), e1 = c1.clone().addScaledVector(s, sd * W(t1) * .62).add(V(0, -W(t1) * .2, 0));
          const nn = nrm.clone().addScaledVector(s, sd * .35).normalize(), tip = c0.clone().lerp(c1, .5).addScaledVector(s, sd * W((t0 + t1) / 2) * 1.05).add(V(0, -W(t0) * .3, 0));
          quadF(B, c0, e0, tip, c1, nn, bias); quadF(B, c1, tip, e1, e1.clone().lerp(c1, .001), nn, bias);
        }
      }
    }
  }
  return {h: H};
}
// the desert's bushes (desert.js desertBush): 0 sagebrush (a broken twiggy clump of small silvery tufts, grey twigs at the foot), 1 prickly
// pear (flat pads, magenta-red fruit on their rims), 2 barrel cactus (a ribbed barrel, a crown of yellow flowers), 3 creosote (forking
// twigs, small dark olive clumps at their ends). Pear and barrel are rigid (features/wind.js FLEX.desert.rigid), the cactus flesh takes no sand
function sage(B, r, v) {
  const tips = [];
  for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + r(), d = V(Math.cos(a) * .6, 1, Math.sin(a) * .6).normalize(); twig(B, r, V(0, -.02, 0), d, .14 + r() * .05, .018, 1, .45, 'bush', 'bark', tips); }
  const C = V(0, .25, 0), Rv = V(.3, .2, .3);
  for (let i = 0; i < 11; i++) {
    const a = i * 2.39996 + r() * .5, e = (i + .5) / 11, rr = .3 * Math.sqrt(1 - e * .8) * (.5 + r() * .5), c = V(Math.cos(a) * rr, .14 + .28 * e + r() * .05, Math.sin(a) * rr);
    const b = .2 * (c.y - .25) / .2 + (r() - .5) * .1;
    B.part('leaf', b, LEAF, CURVE.bush(Math.min(1, c.y / .45)), (i * 2.39996) % TAU); clump(B, c, .085 + r() * .04, .8, v * 17 + i, C, Rv, b, r, 1, 1.6);
  }
  return {h: .45};
}
function pear(B, r, v) {
  // pads: a foot pad standing on the ground, the others growing off the earlier ones' rims, out and up at 25-70 deg, each turned its own way
  const pads = [], a0 = r() * TAU;
  pads.push({c: V(0, .12, 0), n: V(Math.cos(a0), 0, Math.sin(a0)), w: .15, h: .12});
  for (let i = 0; i < 5 + (v % 2); i++) {
    const p = pads[Math.floor(r() * Math.min(pads.length, 3))], side = V(-p.n.z, 0, p.n.x), sg = r() < .5 ? -1 : 1, th = (25 + r() * 45) * Math.PI / 180;
    const dir = side.clone().multiplyScalar(sg * Math.cos(th)).add(V(0, Math.sin(th), 0)), w = .1 + r() * .05, h = .085 + r() * .035;
    const rim = p.c.clone().addScaledVector(side, sg * Math.cos(th) * p.w).add(V(0, Math.sin(th) * p.h, 0));
    const a = a0 + (i + 1) * 2.39996 + (r() - .5) * .5, n = V(Math.cos(a), 0, Math.sin(a));   // (each pad faces its own way round: a cluster from every side)
    pads.push({c: rim.addScaledVector(dir, h * .7), n, w, h, up: dir});
  }
  B.part('cactus', 0, NO_COVER, 0, -1);
  for (const [i, q] of pads.entries()) {   // a pad: a flat oval, its long axis along the way it grew
    const up = q.up || V(0, 1, 0), along = up.clone().addScaledVector(q.n, -up.dot(q.n)).normalize();
    lobeOf(B, q.c, along, q.n, q.h, q.w * .85, .034, i + v * 7, q.c, V(1, 1, 1), 0, (q.c.y - .2) * .3, r, 2, .06);
    q.top = q.c.clone().addScaledVector(along, q.h * .95);
  }
  B.part('red', .1, NO_COVER, 0, -1);   // fruit on the upper rims
  for (const [i, q] of pads.entries()) if (i > 0 && h3(i, v, 7, 3) < .7) { const t = q.top.clone().addScaledVector(V(-q.n.z, 0, q.n.x), (h3(i, v, 8, 4) - .5) * q.w * .8); lobeOf(B, t, V(0, 1, 0), q.n, .026, .02, .02, i, t, V(1, 1, 1), 0, .1, r, 0, .05); }
  return {h: .5, rigid: true};
}
function barrel(B, r, v) {
  const pts = [V(0, -.04, 0), V(0, .12, 0), V(0, .26, 0), V(0, .36, 0)];
  B.part('cactus', 0, NO_COVER, 0, -1); fluted(B, pts, [.16, .2, .19, .15], 12, r() * TAU, true, .8);
  B.part('gold', .1, NO_COVER, 0, -1);
  for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + r() * .4, c = V(Math.cos(a) * .06, .47, Math.sin(a) * .06); lobeOf(B, c, V(Math.cos(a), .8, Math.sin(a)), V(0, 1, 0), .03, .025, .022, k, c, V(1, 1, 1), 0, .1, r, 0, .1); }
  return {h: .5, rigid: true};
}
function creosote(B, r, v) {
  const tips = [];
  for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + r() * .7, d = V(Math.cos(a) * .5, 1, Math.sin(a) * .5).normalize(); twig(B, r, V(0, -.02, 0), d, .17 + r() * .06, .02, 2, .55, 'bush', 'bark', tips); }
  const C = V(0, .35, 0), Rv = V(.3, .25, .3);
  for (const [i, t] of tips.entries()) { const b = -.12 + (r() - .5) * .1; B.part('leaf', b, LEAF, CURVE.bush(Math.min(1, t.p.y / .55)), (i * 2.39996) % TAU); clump(B, t.p.clone().addScaledVector(t.d, .03), .065 + r() * .02, .75, v * 23 + i, C, Rv, b, r, 1, 1.4); }
  return {h: .55};
}

// ---------------------------------------------------------------- the cache
const cache = new Map();
// kind: 'bush' | 'fern' | 'tuft' | 'reed'; fam(name) -> family index (world.js FAMS)
export function floraShapes(kind, biome, variant, fam) {
  const fn = SHAPES[`${biome}:${kind}`]; if (!fn) return null;
  const v = Math.max(0, variant | 0), key = `${biome}:${kind}:${v}`;
  let s = cache.get(key);
  if (!s) {
    const r = rng(v * 97 + kind.length * 13 + biome.length * 7), B = new Build(fam, () => 0), BL = new Blades(1, kind === 'reed' ? 'reed' : biome === 'frost' ? 'twig' : 'tip');
    const o = fn(v, B, r, BL) || {};
    BL.H = o.h || 1; for (let i = 0; i < BL.C.length; i += 4) BL.C[i + 2] = BL.H;   // (the blades' flex by the plant's height)
    const mesh = !o.noMesh && B.pos.length ? {geo: B.geometry(), casts: true} : null, blades = BL.n ? {geo: BL.geometry(), count: BL.count} : null;
    s = {key, mesh, blades, h: o.h || 1, rigid: !!o.rigid, tris: (B.pos.length / 9) | 0};
    cache.set(key, s);
  }
  return s;
}
export function clearFloraCache() { for (const s of cache.values()) { s.mesh?.geo.dispose(); s.blades?.geo.dispose(); } cache.clear(); }
