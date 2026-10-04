// TERRAIN: the walkable ground's height field (docs/TERRAIN.md). A field is made from SHAPES (plain data: layout.js owns the
// Proving Grounds' own) and baked once into a grid on the ground mesh's lattice (CELL m, aligned to whole multiples of CELL),
// read bilinearly: every per-frame caller (feet, props, particles, projectiles) pays a few multiplies, nothing is allocated.
//   hill     {type: 'hill', x, y, rx, ry, h, rot}: a smooth bump (raised cosine of the elliptic distance: level at its rim)
//   terrace  {type: 'terrace', pts: [[x, y], ...] (a polygon), h, bank}: a raised flat area; its edge falls to the ground
//            round it over `bank` m (smoothstep). A bank under ~1.5 h / WALK is too steep to walk: a cliff (rock: cliffs3d.js)
//   ramp     {type: 'ramp', pts: [[x, y], ...] (a polyline), w, h0, h1, shoulder}: a walkway rising evenly from h0 at its first
//            point to h1 at its last, w m wide, over whatever is there; its sides blend back to the ground over `shoulder` m
//   swell    {type: 'swell', amp, k, seed}: low rolling ground (value noise, two octaves, 0..amp m: never below the flat ground,
//            which many effects treat as a floor), the meadows' undulation
// Composition: hills + swells, times the MASK (0 = held flat: the arena, the water and its banks, the ravine's rim...), then
// terraces (the higher wins), then ramps (they cut through a terrace's edge). The plateau is not in the field (layout.js
// elev puts its exact box on top).
//   const F = createField({bounds: {x0, y0, x1, y1}, shapes, mask: (x, y) => 0..1})
//   F.H(x, y)          the height (m); outside the grid: its nearest edge
//   F.steep(x, y)      too steep to walk here (slope > WALK, rise / run)
//   F.normal(x, y, o)  o = [nx, ny (up), nz] (world axes: x east, y up, z south), from the grid's slope
//   F.slope(x, y)      rise / run (the steepest way)
// OWNS: nothing global (each field is its own). READS: nothing (pure functions of its shapes and mask).
import {vnoise, clamp, smooth} from '../core/mathx.js';

export const CELL = .25;     // m: the ground mesh's own cell (world.js S), so the field and the drawn ground agree
export const WALK = .7;      // rise per metre walkable (~35 deg); steeper is a wall to walkers and a cliff to the painter

// distance from (x, y) to segment a-b, and the fraction along it (into out: [d, t (clamped), t (unclamped)])
function segDist(x, y, ax, ay, bx, by, out) {
  const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy, u = l2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / l2 : 0, t = clamp(u, 0, 1);
  out[0] = Math.hypot(x - ax - vx * t, y - ay - vy * t); out[1] = t; out[2] = u; return out;
}
// signed distance to a polygon (negative inside)
function polyDist(x, y, pts, tmp) {
  let d = 1e9, inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j], [bx, by] = pts[i];
    d = Math.min(d, segDist(x, y, ax, ay, bx, by, tmp)[0]);
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside ? -d : d;
}

// the shapes' height at a point (unbaked: the bake calls this once per lattice point)
function evalShapes(shapes, mask, x, y, tmp) {
  let base = 0;
  for (const s of shapes) {
    if (s.type === 'hill') {
      const c = Math.cos(s.rot || 0), n = Math.sin(s.rot || 0), dx = x - s.x, dy = y - s.y, u = (dx * c + dy * n) / s.rx, v = (-dx * n + dy * c) / s.ry, d = u * u + v * v;
      if (d < 1) base += s.h * .5 * (1 + Math.cos(Math.PI * Math.sqrt(d)));
    } else if (s.type === 'swell') {
      const k = s.k, sd = s.seed || 0;
      base += s.amp * smooth((vnoise(x * k, y * k, sd) * .7 + vnoise(x * k * 2.3 + 7, y * k * 2.3 + 3, sd + 1) * .3 - .2) / .6);
    }
  }
  let h = base * (mask ? mask(x, y) : 1);
  for (const s of shapes) {
    if (s.type !== 'terrace') continue;
    const d = polyDist(x, y, s.pts, tmp), b = Math.max(.02, s.bank ?? .1);
    const v = d <= 0 ? s.h : d < b ? s.h * (1 - smooth(d / b)) : 0;
    if (v > h) h = v;
  }
  for (const s of shapes) {
    if (s.type !== 'ramp') continue;
    const P = s.pts, sh = s.shoulder ?? .6, hw = s.w / 2;
    let best = 1e9, along = 0, run = 0, total = 0, past = false;
    for (let i = 0; i + 1 < P.length; i++) total += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
    for (let i = 0; i + 1 < P.length; i++) {
      const L = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
      segDist(x, y, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], tmp);
      if (tmp[0] < best) { best = tmp[0]; along = run + tmp[1] * L; past = (i === 0 && tmp[2] < 0) || (i === P.length - 2 && tmp[2] > 1); }
      run += L;
    }
    if (past || best >= hw + sh) continue;   // (square ends: a ramp stops at its first and last points, it doesn't round past them)
    const hr = s.h0 + (s.h1 - s.h0) * (total > 0 ? along / total : 0);
    h = best <= hw ? hr : hr + (h - hr) * smooth((best - hw) / sh);
  }
  return h;
}

export function createField({bounds, shapes = [], mask = null, cell = CELL}) {
  // a ramp end given as null starts / ends at the ground there (the field without the ramps)
  const tmp0 = [0, 0], noRamps = shapes.filter(s => s.type !== 'ramp');
  shapes = shapes.map(s => s.type !== 'ramp' || (s.h0 != null && s.h1 != null) ? s : {...s,
    h0: s.h0 ?? evalShapes(noRamps, mask, s.pts[0][0], s.pts[0][1], tmp0), h1: s.h1 ?? evalShapes(noRamps, mask, s.pts.at(-1)[0], s.pts.at(-1)[1], tmp0)});
  // the lattice: whole multiples of cell covering the bounds
  const x0 = Math.floor(bounds.x0 / cell) * cell, y0 = Math.floor(bounds.y0 / cell) * cell;
  const nx = Math.ceil((bounds.x1 - x0) / cell) + 1, ny = Math.ceil((bounds.y1 - y0) / cell) + 1;
  const D = new Float32Array(nx * ny), S = new Uint8Array(nx * ny), tmp = [0, 0];
  let maxH = 0, minH = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = evalShapes(shapes, mask, x0 + i * cell, y0 + j * cell, tmp); D[j * nx + i] = v;
    if (v > maxH) maxH = v; if (v < minH) minH = v;
  }
  // steep: a lattice point any of whose four edges rises faster than WALK
  const lim = WALK * cell;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, v = D[k];
    if ((i > 0 && Math.abs(D[k - 1] - v) > lim) || (i < nx - 1 && Math.abs(D[k + 1] - v) > lim) ||
        (j > 0 && Math.abs(D[k - nx] - v) > lim) || (j < ny - 1 && Math.abs(D[k + nx] - v) > lim)) S[k] = 1;
  }
  const inv = 1 / cell;
  function H(x, y) {
    let fx = (x - x0) * inv, fy = (y - y0) * inv;
    fx = fx < 0 ? 0 : fx > nx - 1.001 ? nx - 1.001 : fx; fy = fy < 0 ? 0 : fy > ny - 1.001 ? ny - 1.001 : fy;
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * nx + i;
    const a = D[k], b = D[k + 1], c = D[k + nx], d = D[k + nx + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function steep(x, y) {
    const i = Math.round((x - x0) * inv), j = Math.round((y - y0) * inv);
    return i >= 0 && j >= 0 && i < nx && j < ny && S[j * nx + i] === 1;
  }
  const E = cell * .5;
  function slope(x, y) { const gx = (H(x + E, y) - H(x - E, y)) / (2 * E), gy = (H(x, y + E) - H(x, y - E)) / (2 * E); return Math.hypot(gx, gy); }
  function normal(x, y, o) {
    const gx = (H(x + E, y) - H(x - E, y)) / (2 * E), gz = (H(x, y + E) - H(x, y - E)) / (2 * E), l = Math.hypot(gx, 1, gz);
    o[0] = -gx / l; o[1] = 1 / l; o[2] = -gz / l; return o;
  }
  return {H, steep, slope, normal, cell, x0, y0, nx, ny, data: D, steepMask: S, get maxH() { return maxH; }, get minH() { return minH; }, flat: maxH === 0 && minH === 0};
}
