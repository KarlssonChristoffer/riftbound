// MATHX: the small maths every system uses, one copy each (docs/ARCHITECTURE.md, code standards: "One copy of every
// basic"). Search here before writing a helper. Hashes and noise are DETERMINISTIC (same inputs, same output, any
// machine): art and placement built from them never changes between runs.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);   // smoothstep on 0..1, clamped
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
