// CLOUD FIELD: the sky's ONE cloud density over the ground, shared by the sim (sim/env.js: where a breaking deck still
// covers the ground, so the rain stops in its gaps first) and the renderer (render/clouds.js: the same function in GLSL, the
// cloud shadows and the deck on the ground). Pure math, no state: the caller says where the field has drifted to.
//   density(x, y, o) -> the density at the ground point (x, y) (m, the world's ground axes); o: the field's drift (6 numbers,
//                       sim/env.js env.aloft.o; what each is: below)
//   coverQ(f)        -> the density above which the share f (0..1) of the ground lies (the field's quantiles, sampled once:
//                       a cover is a threshold, any cover, no steps); QUANT: the table for the GPU (at f = qf(i / 10): the
//                       points crowd toward both ends, where a deck's first gaps open and the last of it goes)
//   wrapDrift(o)     -> wraps o in place where the field repeats (PERIOD; 0: that pair never wraps)
//   fieldUniforms(o, U) -> (FIELD_V2) the GPU's view of o: each noise's offset in its own lattice, wrapped there (U.uCfA..uCfD)
//   FIELD_GLSL       -> float cfDensity(vec2 g, vec4 oAB, vec2 oW): the same field; FIELD_V2 also vec4 cfField(vec2 g): the
//                       density, its slope (per m, the ground axes) and the thin patches' noise (render/clouds.js: the soft edge)
//   FIELD_V2         -> the smooth field (default); ?cloudfield=0 the old one (sim/env.js drifts each its own way)
// Both hash with core/mathx.js's hash3 cut to 24 bits on a periodic lattice (256 cells), so the GPU's uint version gives the
// same numbers.
//
// THE SMOOTH FIELD (FIELD_V2; the user, 2026-10-09/10: the old shapes were "random lavalamp shapes going in the same
// direction all the time", then a lumpy cumulus try was "bumpy: I never see cloud shadows like that in real life"). Cloud
// shadows as they lie on a hillside: BIG separate clouds (40-150 m: the view, ~54 x 28 m of ground, sees one edge at a time;
// long spells of sun and of shade), their edges gently irregular, nothing lumpy. Value noise with a quintic fade (no creases
// in its slope: render/clouds.js measures the soft edge in metres from it), four octaves of 80 / 40 / 20 / 10 m (the last
// weak), each turned its own way (no edges along the lattice), read through a light 128 m warp (+-8 m), stretched 1.3x along
// the prevailing wind aloft (TUNE.trans.dir). Mocked up at the user's spot first (tmp/clouds/mock) and chosen: the soft edge.
// THE MOTION. All of it drifts as one (o[0..1], with the wind aloft): a cloud keeps its shape while it crosses; the warp
// under it drifts slowly against it (o[2], sim/env.js TUNE.trans.evo m/s), so the shapes change over minutes.
//   o (V2): [drift x, y (m), the warp's drift (m), 0, 0, 0]   (the drift never wraps: fieldUniforms wraps each noise's own
//           offset in its lattice, which a rotated octave needs, so it never shows; the sim keeps o in doubles)
//   o (V1): [layer A x, y, layer B x, y, the warp x, y] (m)
// BUDGET: V2 7 noises (~28 hashes) a point, with the slope (the value noise's own derivative, no extra look-ups); V1 ~32.
// OWNS: nothing (constants, the quantile table made once). READS: ?cloudfield (core/flags.js).
import {flags} from './flags.js';
export const FIELD_V2 = flags.get('cloudfield') !== '0';

// ---- the old field (?cloudfield=0): two layers of value noise drifting at different velocities (env.aloft: A with the wind
// aloft, B a little slower and turned) through a slow domain warp (a third, slower noise that bends the coordinates)
// cells (m) and weights of the octaves: layer A (big shapes), layer B (the detail that moves against them), the warp
export const FIELD = {
  a: [[8, .42, 1], [4, .18, 2]], b: [[5, .2, 3], [2, .13, 4], [1, .07, 5]],   // [cell m, weight, seed]
  w: [14, 11, 12],   // the warp: cell m, the seeds of its x and y
  warp: 2.2,         // m: how far the warp bends the coordinates (either way)
};
// ---- the smooth field (FIELD_V2: the header)
export const SMOOTH = {
  dir: [.94, .34], stretch: 1.3,                         // the frame it is stretched in: the prevailing wind aloft, x 1.3 along it
  oct: [[80, .55, 0, 1], [40, .27, 1.1, 2], [20, .13, 2.3, 3], [10, .05, 3.7, 4]],   // [cell m, weight, turn rad, seed]
  warp: [128, 8, 7, 8],                                  // the warp: cell m, m either way, the seeds of its x and y
  thin: [24, 9],                                         // the thin patches' noise: cell m, seed (render/clouds.js)
};
// the periods: o wraps at them ([o 0-1, o 2-3, o 4-5]; 0: never). V1: 256 cells of each layer's octaves (8 x 256 = 2 x 4 x
// 256, ...); V2: only the warp's drift wraps (256 of its cells)
export const PERIOD = FIELD_V2 ? [0, 256 * SMOOTH.warp[0], 0] : [2048, 2560, 3584];
const N = FIELD, S = SMOOTH, DL = Math.hypot(S.dir[0], S.dir[1]), DX = S.dir[0] / DL, DY = S.dir[1] / DL, ST = S.stretch;
const ROT = S.oct.map(o => [Math.cos(o[2]), Math.sin(o[2])]);

// mathx.js hash3 (the arena's integer hash), its top 24 bits: exactly what a float holds, so render/clouds.js matches it
function h3(a, b, c) {
  let n = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16; return (n >>> 8) / 16777216;
}
// value noise on the periodic lattice (256 cells), bilinear through a fade: smoothstep (vn, V1) or quintic (vq, V2: its slope
// has no creases)
function vn(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = xi & 255, x1 = (xi + 1) & 255, y0 = yi & 255, y1 = (yi + 1) & 255;
  const a = h3(x0, y0, s), b = h3(x1, y0, s), c = h3(x0, y1, s), d = h3(x1, y1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function vq(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
  fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10); fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const x0 = xi & 255, x1 = (xi + 1) & 255, y0 = yi & 255, y1 = (yi + 1) & 255;
  const a = h3(x0, y0, s), b = h3(x1, y0, s), c = h3(x0, y1, s), d = h3(x1, y1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function densityV2(x, y, o) {
  const X = x - o[0], Y = y - o[1], W = S.warp, e = o[2];
  let a = (X * DX + Y * DY) / ST, b = -X * DY + Y * DX;   // (the wind's frame, stretched along it)
  const wx = (vq((a + e) / W[0], b / W[0], W[2]) - .5) * 2 * W[1], wy = (vq(a / W[0], (b - e) / W[0], W[3]) - .5) * 2 * W[1];
  a += wx; b += wy;
  let d = 0;
  for (let k = 0; k < S.oct.length; k++) { const O = S.oct[k], co = ROT[k][0], si = ROT[k][1]; d += O[1] * vq((a * co - b * si) / O[0], (a * si + b * co) / O[0], O[3]); }
  return d;
}
function densityV1(x, y, o) {
  const W = N.w, wx = (x - o[4]) / W[0], wy = (y - o[5]) / W[0];
  const qx = x + (vn(wx, wy, W[1]) - .5) * 2 * N.warp, qy = y + (vn(wx, wy, W[2]) - .5) * 2 * N.warp;
  const ax = qx - o[0], ay = qy - o[1], bx = qx - o[2], by = qy - o[3];
  let d = 0;
  for (let i = 0; i < N.a.length; i++) { const L = N.a[i]; d += L[1] * vn(ax / L[0], ay / L[0], L[2]); }
  for (let i = 0; i < N.b.length; i++) { const L = N.b[i]; d += L[1] * vn(bx / L[0], by / L[0], L[2]); }
  return d;
}
export const density = FIELD_V2 ? densityV2 : densityV1;
export function wrapDrift(o) {
  for (let i = 0; i < 6; i++) { const P = PERIOD[i >> 1]; if (P) o[i] -= Math.floor(o[i] / P) * P; }
  return o;
}
// (V2) each noise's offset in its own lattice coordinates, wrapped at 256 cells there: the GPU adds its point's own (small)
// coordinates, so the drift never loses float precision and a turned octave never jumps (o's wrap would, at a turned lattice)
const w256 = v => v - Math.floor(v / 256) * 256;
export function fieldUniforms(o, U) {
  const aO = (o[0] * DX + o[1] * DY) / ST, bO = -o[0] * DY + o[1] * DX, e = o[2], W = S.warp[0], T = S.thin[0], u = [];
  for (let k = 0; k < S.oct.length; k++) { const c = S.oct[k][0], co = ROT[k][0], si = ROT[k][1]; u.push(w256((aO * co - bO * si) / c), w256((aO * si + bO * co) / c)); }
  const A = U.uCfA, B = U.uCfB, Cc = U.uCfC, D = U.uCfD;
  A[0] = w256((aO - e) / W); A[1] = w256(bO / W); A[2] = w256(aO / W); A[3] = w256((bO + e) / W);
  B[0] = u[0]; B[1] = u[1]; B[2] = u[2]; B[3] = u[3]; Cc[0] = u[4]; Cc[1] = u[5]; Cc[2] = u[6]; Cc[3] = u[7];
  D[0] = w256(aO / T); D[1] = w256(bO / T); D[2] = 0; D[3] = 0;
  return U;
}
// the quantiles: the field sampled once on a grid over a wide stretch (an odd step: no lattice alignment; V2 ~60 x 60 of its
// biggest cells), sorted (~10-20 ms at load). QUANT[i]: the density above which qf(i / 10) of the ground lies, qf(x) = (1 -
// cos(pi x)) / 2 (the ends a little past the extremes: cover 0 is nothing, 1 is all); coverQ interpolates it at x = acos(1 -
// 2 f) / pi
const qf = x => (1 - Math.cos(Math.PI * x)) / 2;
export const QUANT = new Float64Array(11);
{
  const n = FIELD_V2 ? 128 : 140, step = (FIELD_V2 ? 5000 : 3100) / n, v = new Float64Array(n * n), o = new Float64Array(6);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = density((i + .37) * step, (j + .61) * step * 1.13, o);
  v.sort();
  for (let k = 1; k < 10; k++) QUANT[k] = v[Math.floor((1 - qf(k / 10)) * (v.length - 1))];
  QUANT[0] = v[v.length - 1] + .01; QUANT[10] = v[0] - .01;
}
export function coverQ(f) {
  const x = Math.acos(1 - 2 * (f <= 0 ? 0 : f >= 1 ? 1 : f)) / Math.PI * 10, i = Math.min(9, Math.floor(x));
  return QUANT[i] + (QUANT[i + 1] - QUANT[i]) * (x - i);
}
const f = v => (Number.isInteger(v) ? v.toFixed(1) : String(+v.toFixed(7)));
const oct = (L, p, o) => `${f(L[1])} * cfV((${p} - ${o}) / ${f(L[0])}, ${L[2]})`;
const GLSL_V1 = `
float cfV(vec2 p, int s) {
  vec2 f = floor(p), t = p - f; t = t * t * (3. - 2. * t); ivec2 i = ivec2(f);
  float a = cfH(i, s), b = cfH(i + ivec2(1, 0), s), c = cfH(i + ivec2(0, 1), s), d = cfH(i + ivec2(1, 1), s);
  return a + (b - a) * t.x + (c - a) * t.y + (a - b - c + d) * t.x * t.y;
}
float cfDensity(vec2 g, vec4 oAB, vec2 oW) {
  vec2 w = (g - oW) / ${f(N.w[0])}, q = g + (vec2(cfV(w, ${N.w[1]}), cfV(w, ${N.w[2]})) - .5) * ${f(2 * N.warp)};
  return ${N.a.map(L => oct(L, 'q', 'oAB.xy')).join(' + ')}
    + ${N.b.map(L => oct(L, 'q', 'oAB.zw')).join(' + ')};
}`;
// V2: the octaves' offsets: uCfB.xy, uCfB.zw, uCfC.xy, uCfC.zw (fieldUniforms)
const UO = ['uCfB.xy', 'uCfB.zw', 'uCfC.xy', 'uCfC.zw'], W2 = S.warp;
const GLSL_V2 = `
uniform vec4 uCfA, uCfB, uCfC, uCfD;   // (core/cloudfield.js fieldUniforms) the warp's offsets; the octaves'; the thin patches'
vec3 cfVd(vec2 p, int s) {   // value noise (quintic fade) and its slope
  vec2 f = floor(p), t = p - f; ivec2 i = ivec2(f);
  vec2 u = t * t * t * (t * (t * 6. - 15.) + 10.), du = 30. * t * t * (t * (t - 2.) + 1.);
  float a = cfH(i, s), b = cfH(i + ivec2(1, 0), s), c = cfH(i + ivec2(0, 1), s), d = cfH(i + ivec2(1, 1), s), k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * vec2(b - a + k * u.y, c - a + k * u.x));
}
// the density at the ground point g (m), its slope (per m: x, y the ground axes) and the thin patches' noise (0..1)
vec4 cfField(vec2 g) {
  vec2 pA = vec2(dot(g, vec2(${f(DX / ST)}, ${f(DY / ST)})), dot(g, vec2(${f(-DY)}, ${f(DX)})));   // (the wind's frame, stretched)
  vec3 n1 = cfVd(pA / ${f(W2[0])} - uCfA.xy, ${W2[2]}), n2 = cfVd(pA / ${f(W2[0])} - uCfA.zw, ${W2[3]});
  vec2 p = pA + (vec2(n1.x, n2.x) - .5) * ${f(2 * W2[1])}, jx = n1.yz * ${f(2 * W2[1] / W2[0])}, jy = n2.yz * ${f(2 * W2[1] / W2[0])}, r = vec2(0.);
  float d = 0.; vec3 n;
  ${S.oct.map((O, k) => { const co = f(ROT[k][0]), si = f(ROT[k][1]);
    return `n = cfVd(vec2(p.x * ${co} - p.y * ${si}, p.x * ${si} + p.y * ${co}) / ${f(O[0])} - ${UO[k]}, ${O[3]}); d += ${f(O[1])} * n.x; r += ${f(O[1] / O[0])} * vec2(${co} * n.y + ${si} * n.z, ${f(-ROT[k][1])} * n.y + ${co} * n.z);`; }).join('\n  ')}
  vec2 gp = vec2((1. + jx.x) * r.x + jy.x * r.y, jx.y * r.x + (1. + jy.y) * r.y);   // (the slope back through the warp)
  return vec4(d, ${f(DX / ST)} * gp.x - ${f(DY)} * gp.y, ${f(DY / ST)} * gp.x + ${f(DX)} * gp.y, cfVd(p / ${f(S.thin[0])} - uCfD.xy, ${S.thin[1]}).x);
}
float cfDensity(vec2 g, vec4 oAB, vec2 oW) { return cfField(g).x; }`;
export const FIELD_GLSL = `
// the cloud field (core/cloudfield.js, the same numbers): an integer hash (mathx.js hash3, top 24 bits), value noise on a
// periodic lattice (256 cells)${FIELD_V2 ? ': the smooth field (four turned octaves through a light warp, its slope with it)' : ', two drifting layers through a slow warp'}
float cfH(ivec2 i, int s) {
  uint n = uint(i.x & 255) * 374761393u + uint(i.y & 255) * 668265263u + uint(s) * 1442695041u;
  n = (n ^ (n >> 13u)) * 1274126177u; n ^= n >> 16u; return float(n >> 8u) * (1. / 16777216.);
}${FIELD_V2 ? GLSL_V2 : GLSL_V1}`;
