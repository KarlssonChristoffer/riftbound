// MATHX: the small maths every system uses, one copy each (docs/ARCHITECTURE.md, code standards: "One copy of every
// basic"). Search here before writing a helper. Hashes and noise are DETERMINISTIC (same inputs, same output, any
// machine): art and placement built from them never changes between runs.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);   // smoothstep on 0..1, clamped
// Math.hypot(a, b) / (a, b, c), BIT FOR BIT (V8's own algorithm: the largest magnitude m, then a compensated sum of
// (x / m)^2, sqrt x m), without its cost: the builtin allocates an array per call (~48 bytes; ~700 calls a frame in the
// cloth and the wind were ~35 KB of garbage per frame) and boxes its arguments. These inline: no garbage, 5-9x faster.
// Zero, Infinity and NaN fall through to Math.hypot itself. Use them in per-frame / per-pixel loops
export const hypot2 = (a, b) => {
  const x = Math.abs(a), y = Math.abs(b), m = Math.max(x, y);
  if (!(m > 0 && m < Infinity)) return Math.hypot(a, b);
  const p = x / m, q = y / m;
  return Math.sqrt(p * p + q * q) * m;
};
export const hypot3 = (a, b, c) => {
  const x = Math.abs(a), y = Math.abs(b), z = Math.abs(c), m = Math.max(x, y, z);
  if (!(m > 0 && m < Infinity)) return Math.hypot(a, b, c);
  const p = x / m, q = y / m, r = z / m;
  let s = p * p, u = q * q, t = s + u;
  const k = (t - s) - u; s = t; u = r * r - k; t = s + u;
  return Math.sqrt(t) * m;
};
// empty an array that is filled again (every frame, every query): `a.length = 0` frees its store, so refilling it allocates
// a new one in doubling steps (~4 KB for 150 items); popping keeps the store
export const clearArray = a => { while (a.length > 0) a.pop(); return a; };
// integer hash of up to 3 ints -> 0..1 (the arena's, biomes.js: walls, decor, moss, foliage all agree)
export const hash3 = (a, b = 0, c = 0) => {
  let n = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16; return (n >>> 0) / 4294967296;
};
// value noise on the integer lattice (smoothstepped bilinear of hash3), 0..1: blobby clusters, never per-pixel dither
export const vnoise = (x, y, s = 0) => {
  const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash3(xi, yi, s), b = hash3(xi + 1, yi, s), c = hash3(xi, yi + 1, s), d = hash3(xi + 1, yi + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};
