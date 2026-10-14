// TERRAIN: the walkable ground's height field (docs/TERRAIN.md). A field is made from SHAPES (plain data: layout.js owns the
// Proving Grounds' own) and baked once into a grid on the ground mesh's lattice (CELL m, aligned to whole multiples of CELL),
// read bilinearly: every per-frame caller (feet, props, particles, projectiles) pays a few multiplies, nothing is allocated.
//   hill     {type: 'hill', x, y, rx, ry, h, rot}: a smooth bump (raised cosine of the elliptic distance: level at its rim)
//   terrace  {type: 'terrace', pts: [[x, y], ...] (a polygon), h, bank, banks}: a raised flat area; its edge falls to the ground
//            round it over `bank` m (smoothstep). A bank under ~1.5 h / WALK is too steep to walk: a cliff (rock: cliffs3d.js).
//            banks (optional): one bank per point, blended along each edge (a mesa: cliffs here, a grass slope there)
//   ramp     {type: 'ramp', pts: [[x, y], ...] (a polyline), w, h0, h1, shoulder, steps}: a walkway rising evenly from h0 at its first
//            point to h1 at its last, w m wide, over whatever is there; its sides blend back to the ground over `shoulder` m.
//            steps: true = in level treads (stepsOf: ~RISER m risers; the first a riser up from h0, the last at h1)
//   swell    {type: 'swell', amp, k, seed}: low rolling ground (value noise, two octaves, 0..amp m: never below the flat ground,
//            which many effects treat as a floor), the meadows' undulation
//   channel  {type: 'channel', pts, bed: [h per point], hw: [half width per point], bank (m, or one per point)}: a stream's bed cut into whatever is
//            there: the bed's height (linear between the points) across hw m either side of the line, blending back up to the
//            ground over `bank` m. It only ever LOWERS the ground (where the bed lies above it, nothing changes)
//   basin    {type: 'basin', x, y, rx, ry, h, rim, clip, clipRim}: a pool's hollow: h inside the ellipse, blending back up over `rim` m
//            (lowers only); clip (optional): none north of y = clip (back up over clipRim m: a step at a lip over the pool)
//   field    {type: 'field', fn: (x, y) => m, reach: [x0, y0, x1, y1]}: ground given as a function (a generated relief: world/forest.js),
//            added like a hill (>= 0: the flat ground stays the floor); 0 outside its reach
//   cave     {type: 'cave', fn: (x, y) => m | NaN, reach: [x0, y0, x1, y1], mode: 'set' | 'cut'}: a cave's ground (world/caves.js), last of
//            all: 'set' IS the ground in its reach (the cave's band: its floor, its rock), 'cut' only lowers it where fn is a number (the
//            mouth's slot); NaN changes nothing
// Composition: hills + swells, times the MASK (0 = held flat: the arena, the water and its banks, the ravine's rim...), then
// terraces (the higher wins), then ramps (they cut through a terrace's edge), then channels and basins (cut into all of it), then caves.
// ?terrain=0's plateau is not in the field (layout.js elev puts its exact box on top); with terrain it is a terrace (a mesa).
//   const F = createField({bounds: {x0, y0, x1, y1}, shapes, mask: (x, y) => 0..1})
//   F.H(x, y)          the height (m); outside the grid: its nearest edge
//   F.steep(x, y)      too steep to walk here (slope > WALK, rise / run)
//   F.normal(x, y, o)  o = [nx, ny (up), nz] (world axes: x east, y up, z south), from the grid's slope
//   F.slope(x, y)      rise / run (the steepest way)
//   sampler(shapes, mask) -> (x, y) => m: the same shapes evaluated at a point without a bake (for laying out what the field
//   then holds: a stream's bed follows the ground it is cut into)
// OWNS: nothing global (each field is its own). READS: nothing (pure functions of its shapes and mask).
import {vnoise, clamp, smooth} from '../core/mathx.js';

export const CELL = .25;     // m: the ground mesh's own cell (world.js S), so the field and the drawn ground agree
export const WALK = .7;      // rise per metre walkable (~35 deg); steeper is a wall to walkers and a cliff to the painter

// distance from (x, y) to segment a-b, and the fraction along it (into out: [d, t (clamped), t (unclamped)])
function segDist(x, y, ax, ay, bx, by, out) {
  const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy, u = l2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / l2 : 0, t = clamp(u, 0, 1);
  out[0] = Math.hypot(x - ax - vx * t, y - ay - vy * t); out[1] = t; out[2] = u; return out;
}
// signed distance to a polygon (negative inside); near (optional) = [edge (its first point's index), t along it] of the nearest point
function polyDist(x, y, pts, tmp, near = null) {
  let d = 1e9, inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j], [bx, by] = pts[i];
    segDist(x, y, ax, ay, bx, by, tmp);
    if (tmp[0] < d) { d = tmp[0]; if (near) { near[0] = j; near[1] = tmp[1]; } }
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside ? -d : d;
}
// the nearest point of a polyline: out = [d, index of its segment's first point, t along that segment (clamped), t unclamped]
function lineNear(x, y, P, tmp, out) {
  out[0] = 1e9;
  for (let i = 0; i + 1 < P.length; i++) {
    segDist(x, y, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], tmp);
    if (tmp[0] < out[0]) { out[0] = tmp[0]; out[1] = i; out[2] = tmp[1]; out[3] = tmp[2]; }
  }
  return out;
}
// a shape's reach (x0, y0, x1, y1): outside it the shape changes nothing (the bake skips it there)
function reachOf(s) {
  const box = (pts, m) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0 - m, y0 - m, x1 + m, y1 + m]; };
  if (s.type === 'terrace') return box(s.pts, Math.max(.02, s.bank ?? .1, ...(s.banks || [])) + .01);
  if (s.type === 'ramp') return box(s.pts, s.w / 2 + (s.shoulder ?? .6) + .01);
  if (s.type === 'channel') return box(s.pts, Math.max(...s.hw) + Math.max(...[].concat(s.bank)) + .01);
  if (s.type === 'field' || s.type === 'cave') return s.reach || null;
  if (s.type === 'basin') return [s.x - s.rx - s.rim - .01, s.y - s.ry - s.rim - .01, s.x + s.rx + s.rim + .01, s.y + s.ry + s.rim + .01];
  return null;
}

// the shapes' height at a point (unbaked: the bake calls this once per lattice point)
const _near = [0, 0], _ln = [0, 0, 0, 0];
const outside = (s, x, y) => { const r = s._reach; return r !== null && r !== undefined && (x < r[0] || y < r[1] || x > r[2] || y > r[3]); };
function evalShapes(shapes, mask, x, y, tmp) {
  let base = 0;
  for (const s of shapes) {
    if (s.type === 'hill') {
      const c = Math.cos(s.rot || 0), n = Math.sin(s.rot || 0), dx = x - s.x, dy = y - s.y, u = (dx * c + dy * n) / s.rx, v = (-dx * n + dy * c) / s.ry, d = u * u + v * v;
      if (d < 1) base += s.h * .5 * (1 + Math.cos(Math.PI * Math.sqrt(d)));
    } else if (s.type === 'field') {
      if (!outside(s, x, y)) base += s.fn(x, y);
    } else if (s.type === 'swell') {
      const k = s.k, sd = s.seed || 0;
      base += s.amp * smooth((vnoise(x * k, y * k, sd) * .7 + vnoise(x * k * 2.3 + 7, y * k * 2.3 + 3, sd + 1) * .3 - .2) / .6);
    }
  }
  let h = base * (mask ? mask(x, y) : 1);
  for (const s of shapes) {
    if (s.type !== 'terrace' || outside(s, x, y)) continue;
    const d = polyDist(x, y, s.pts, tmp, s.banks ? _near : null);
    let b = s.bank ?? .1;
    if (s.banks) { const B = s.banks, j = _near[0]; b = B[j] + (B[(j + 1) % B.length] - B[j]) * _near[1]; }
    b = Math.max(.02, b);
    const v = d <= 0 ? s.h : d < b ? s.h * (1 - smooth(d / b)) : 0;
    if (v > h) h = v;
  }
  for (const s of shapes) {
    if (s.type !== 'ramp' || outside(s, x, y)) continue;
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
    const f = total > 0 ? along / total : 0, hr = s.h0 + (s.h1 - s.h0) * (s.steps ? Math.min(s.steps, Math.floor(f * s.steps + 1e-9) + 1) / s.steps : f);   // (steps: level treads, each a riser above the last)
    h = best <= hw ? hr : hr + (h - hr) * smooth((best - hw) / sh);
  }
  for (const s of shapes) {   // the cuts: a stream's bed, a pool's hollow (they only lower)
    if ((s.type !== 'channel' && s.type !== 'basin') || outside(s, x, y)) continue;
    let bed, k;   // k: 0 in the cut, 1 at the rim's outer edge
    if (s.type === 'channel') {
      lineNear(x, y, s.pts, tmp, _ln); const i = _ln[1], t = _ln[2], w = s.hw[i] + (s.hw[i + 1] - s.hw[i]) * t;
      bed = s.bed[i] + (s.bed[i + 1] - s.bed[i]) * t; k = Math.max(0, _ln[0] - w) / (typeof s.bank === 'number' ? s.bank : s.bank[i] + (s.bank[i + 1] - s.bank[i]) * t);
    } else {
      const u = (x - s.x) / s.rx, v = (y - s.y) / s.ry, r = Math.hypot(u, v);
      bed = s.h; k = r <= 1 ? 0 : (r - 1) * r / Math.hypot(u / s.rx, v / s.ry) / s.rim;   // (metres past the rim, first order)
      if (s.clip !== undefined && y < s.clip) k = Math.max(k, (s.clip - y) / s.clipRim);   // clip: no hollow north of it (a lip over the pool)
    }
    if (h <= bed || k >= 1) continue;
    h = bed + (h - bed) * smooth(k);
  }
  for (const s of shapes) {   // the caves: their band's ground as it is, their mouths' cuts
    if (s.type !== 'cave' || outside(s, x, y)) continue;
    const v = s.fn(x, y); if (v !== v) continue;
    if (s.mode === 'set' || v < h) h = v;
  }
  return h;
}

// a stepped ramp's treads: risers of about RISER m (under a lattice cell's WALK rise, .175 m: not steep, walked up in stride)
export const RISER = .165, stepsOf = (h0, h1) => Math.max(1, Math.round(Math.abs(h1 - h0) / RISER));
// the shapes ready to evaluate: copies (the caller's stay as given) with their reach, a ramp end given as null set to the ground
// there (the field without the ramps)
function resolve(shapes, mask) {
  const tmp0 = [0, 0], own = shapes.map(s => ({...s, _reach: reachOf(s)})), noRamps = own.filter(s => s.type !== 'ramp');
  for (const s of own) if (s.type === 'ramp') {
    if (s.h0 == null) s.h0 = evalShapes(noRamps, mask, s.pts[0][0], s.pts[0][1], tmp0);
    if (s.h1 == null) s.h1 = evalShapes(noRamps, mask, s.pts.at(-1)[0], s.pts.at(-1)[1], tmp0);
    if (s.steps === true) s.steps = stepsOf(s.h0, s.h1);
  }
  return own;
}
// the shapes' height at any point, unbaked (a layout working out where a stream's bed lies in the ground it cuts): (x, y) -> m
export function sampler(shapes, mask = null) {
  const own = resolve(shapes, mask), tmp = [0, 0];
  return (x, y) => evalShapes(own, mask, x, y, tmp);
}

export function createField({bounds, shapes = [], mask = null, cell = CELL}) {
  shapes = resolve(shapes, mask);
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
