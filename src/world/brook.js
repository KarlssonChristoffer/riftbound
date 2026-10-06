// BROOK: a brook through the West Downs (the brief, 2026-10-06): from a SPRING at the foot of the north bank it runs south through
// the hollow between the two big hills, through a gap in the old field wall, under a STONE ARCH BRIDGE where it crosses the track,
// into a deep POOL in the bend east of the southern hill, over STEPPING STONES and in a second WATERFALL over the ravine's edge.
// Shallow and wadeable (not water to the sim) but for the pool, which is deep like the river (inStream: falling in = respawn).
// Plain data and pure functions of world position, built once at load (no randomness: hashes and noise of the place), read by:
//   layout.js      the bed cut into the ground (lay: a channel whose banks open wide where it cuts through the meadow's swell, the
//                  spring's hollow, the pool's basin), the pool as deep water (inStream), the bridge's deck and the stepping stones as
//                  decks (BRIDGES: elev / steep), the parapets' colliders, the field wall's gap (gapsOn), bushes moved off its banks (away)
//   world.js       waterSample's branch (sample: kinds 4 the brook, 5 its pool), the West Downs' water texture, the fall in the
//                  ravine's cliff texture and the gap in its rock (fallOff), the bridge and the stones (world/bridge3d.js)
//   biomes.js      paint: the water, its banks, the spring and the foot of the fall on the West Downs' canvas (ruins)
//   waterbed.js    depth: how deep the bed lies under it
//   features       riverside (reeds, ferns, lily pads on the pool), wildlife (fish in the pool, a frog on a pad), mist (its
//                  stretches), atmos/waterlife (the fall's spray, flecks on it), grass (clear: no blades on it or under the bridge),
//                  depth (reflections), audio (its babble, the fall, wading)
// ?brook=0 (westland.js BROOK_ON): none, the downs as before. OWNS: nothing at run time. READS: core/mathx.js, westland.js.
import {vnoise as vn, smooth, clamp} from '../core/mathx.js';
import {BROOK_ON, TRACK} from './westland.js';

// ---- its course: [x, y, half width] through the hollows (Catmull-Rom between them, resampled every DS m). Head at the spring, the
// last point past the ravine's lip (the channel runs to the edge whatever the biome's own edge is)
const CTL = [[-14.75, 1.0, .38], [-14.85, 1.85, .34], [-14.7, 3.2, .42], [-14.6, 4.7, .48], [-14.85, 6.4, .52], [-14.7, 8.1, .54],
  [-14.25, 9.8, .55], [-13.6, 11.3, .56], [-12.95, 13.2, .56], [-12.5, 15.2, .58], [-12.25, 17.3, .6], [-11.85, 18.6, .6],
  [-10.9, 19.35, .6], [-9.7, 20.0, .62], [-8.55, 20.6, .62], [-7.85, 21.75, .55], [-7.8, 23.25, .55], [-8.05, 24.5, .58],
  [-7.9, 25.9, .55], [-7.75, 27.3, .5], [-7.7, 28.6, .5]];
const DS = .1, K_S = .55, NC = .25, NW = 4;      // sample step (m); the shader's travel per metre along it (the rill's); the lookup's cells (m), the samples it tests either side
const SPRING = {x: CTL[0][0], y: CTL[0][1], r: .4};
const POOL = {x: -8.6, y: 20.7, rx: 1.45, ry: 1.05};
const WATER_H = -.18;                              // the pool's surface under its basin (world.js WATER_H: the river's, the pool's)
// the ruins' ravine edge (biomes.js cliffRuins / westRuins: the same line runs on west) -> the lip of the fall
const cliffAt = x => 30 - 2.2 + (vn(x * .3, .5, 91) - .5) * 1.3;

function course(ctl) {
  const dense = [];
  for (let k = 0; k + 1 < ctl.length; k++) {
    const p0 = ctl[Math.max(0, k - 1)], p1 = ctl[k], p2 = ctl[k + 1], p3 = ctl[Math.min(ctl.length - 1, k + 2)];
    for (let i = 0; i < 48; i++) {
      const t = i / 48, t2 = t * t, t3 = t2 * t, cr = (a, b, c, d) => .5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      dense.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1]), p1[2] + (p2[2] - p1[2]) * t * t * (3 - 2 * t)]);
    }
  }
  dense.push(ctl.at(-1));
  const X = [dense[0][0]], Y = [dense[0][1]], H = [dense[0][2]], L = [0];
  for (let i = 1, run = 0; i < dense.length; i++) {
    const a = dense[i - 1], b = dense[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let next = L.length * DS; next <= run + l + 1e-9; next = L.length * DS) {
      const t = l > 0 ? (next - run) / l : 0;
      X.push(a[0] + (b[0] - a[0]) * t); Y.push(a[1] + (b[1] - a[1]) * t); H.push(a[2] + (b[2] - a[2]) * t); L.push(next);
    }
    run += l;
  }
  const n = X.length, C = {n, px: Float32Array.from(X), py: Float32Array.from(Y), hw: Float32Array.from(H), len: Float32Array.from(L), tx: new Float32Array(n), ty: new Float32Array(n)};
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2), dx = C.px[b] - C.px[a], dy = C.py[b] - C.py[a], d = Math.hypot(dx, dy) || 1; C.tx[i] = dx / d; C.ty[i] = dy / d; }
  // the segments near each 1 m cell (within REACH of it): a lookup tests a few of them. REACH covers the water, its banks and the pool
  const REACH = 1.9; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, C.px[i]); y0 = Math.min(y0, C.py[i]); x1 = Math.max(x1, C.px[i]); y1 = Math.max(y1, C.py[i]); }
  const gx0 = Math.floor(x0 - REACH), gy0 = Math.floor(y0 - REACH), gw = Math.ceil(x1 + REACH) - gx0, gh = Math.ceil(y1 + REACH) - gy0, cells = Array.from({length: gw * gh}, () => []);
  for (let j = 0; j + 1 < n; j++) {
    const ax = Math.min(C.px[j], C.px[j + 1]) - REACH, bx = Math.max(C.px[j], C.px[j + 1]) + REACH, ay = Math.min(C.py[j], C.py[j + 1]) - REACH, by = Math.max(C.py[j], C.py[j + 1]) + REACH;
    for (let cy = Math.max(0, Math.floor(ay) - gy0); cy <= Math.min(gh - 1, Math.floor(by) - gy0); cy++)
      for (let cx = Math.max(0, Math.floor(ax) - gx0); cx <= Math.min(gw - 1, Math.floor(bx) - gx0); cx++) cells[cy * gw + cx].push(j);
  }
  // NEAR: the nearest sample to each NC m cell's centre (-1: none within REACH), so a lookup tests only the few segments either side of it
  // (the painter and the water's bake ask ~300k points)
  const nw = Math.ceil(gw / NC), nh = Math.ceil(gh / NC), near = new Int16Array(nw * nh).fill(-1);
  for (let cy = 0; cy < nh; cy++) for (let cx = 0; cx < nw; cx++) {
    const x = gx0 + (cx + .5) * NC, y = gy0 + (cy + .5) * NC, list = cells[Math.floor(cy * NC) * gw + Math.floor(cx * NC)];
    let bd = REACH * REACH, bi = -1;
    for (const j of list) for (const k of [j, j + 1]) { const d = (X[k] - x) ** 2 + (Y[k] - y) ** 2; if (d < bd) { bd = d; bi = k; } }
    near[cy * nw + cx] = bi;
  }
  Object.assign(C, {near, nw, nh, gx0, gy0, gw, gh, box: [x0 - REACH, y0 - REACH, x1 + REACH, y1 + REACH]});
  return C;
}

export const BROOK = BROOK_ON ? build() : null;

function build() {
  const C = course(CTL), {n, px, py, hw, len} = C;
  const B = {C, n, px, py, hw, len, box: C.box, spring: SPRING, pool: POOL, ds: DS, ks: K_S, total: len[n - 1], bridgeL: -99,
    bed: new Float32Array(n), stones: [], rocks: [], parapets: [], bridge: null, decks: [], fall: null, shapes: [], laid: false};
  // at(x, y, out): out.d = m to the axis, out.a = across it (+ to the left of the flow, the east of a southward stretch), out.l = m along it
  // from the spring, out.hw = the half width there, out.i = the sample. True in the water (the pool aside: inPool)
  B.at = (x, y, out) => {
    out.d = 1e9; out.a = 0; out.l = 0; out.hw = 0; out.i = 0;
    const cx = Math.floor((x - C.gx0) / NC), cy = Math.floor((y - C.gy0) / NC); if (cx < 0 || cy < 0 || cx >= C.nw || cy >= C.nh) return false;
    const i0 = C.near[cy * C.nw + cx]; if (i0 < 0) return false;
    let bd = 1e18, bj = -1, bt = 0;
    for (let j = Math.max(0, i0 - NW), e = Math.min(n - 2, i0 + NW); j <= e; j++) {
      const ax = px[j], ay = py[j], vx = px[j + 1] - ax, vy = py[j + 1] - ay, u = ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1);
      const t = u < 0 ? 0 : u > 1 ? 1 : u, dx = x - ax - vx * t, dy = y - ay - vy * t, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bj = j; bt = t; }
    }
    if (bj < 0) return false;
    const j = bj, t = bt, vx = px[j + 1] - px[j], vy = py[j + 1] - py[j], d = Math.sqrt(bd), qx = px[j] + vx * t, qy = py[j] + vy * t;
    out.d = d; out.l = len[j] + (len[j + 1] - len[j]) * t; out.hw = hw[j] + (hw[j + 1] - hw[j]) * t; out.a = vx * (y - qy) - vy * (x - qx) < 0 ? d : -d; out.i = t < .5 ? j : j + 1;
    return out.d < out.hw;
  };
  // the deep pool (grow: m added round it: world.js lowers the ground mesh's vertices a little past its painted edge)
  B.inPool = (x, y, grow = 0) => {
    const rx = POOL.rx + grow, ry = POOL.ry + grow;
    if (x < POOL.x - rx || x > POOL.x + rx || y < POOL.y - ry || y > POOL.y + ry) return false;
    const u = (x - POOL.x) / rx, v = (y - POOL.y) / ry; return u * u + v * v < 1;
  };
  // m from (x, y) to the pool's edge (first order: + inside)
  B.poolEdge = (x, y) => { const u = (x - POOL.x) / POOL.rx, v = (y - POOL.y) / POOL.ry, r = Math.hypot(u, v), g = Math.hypot(u / POOL.rx, v / POOL.ry); return g > 1e-6 ? (1 - r) * r / g : POOL.ry; };
  // where the water runs fast and stays white: the head (down the bank's foot), where it pours into the pool, the stepping stones
  const lPool = len[nearest(C, POOL.x, POOL.y)];
  B.headL = 1.6; B.poolL = lPool; B.inletL = -99;
  B.pace = l => l < .5 ? .45 : l < B.headL ? 1.15 : Math.abs(l - lPool) < 1.4 ? .3 + .5 * smooth((Math.abs(l - lPool) - .6) / .8) : l > B.total - 2.4 ? .9 + .5 * smooth((l - B.total + 2.4) / 1.4) : .8;
  B.riffle = l => (l > .45 && l < B.headL) || (l > B.inletL - .5 && l < B.inletL + .05) || B.stones.some(s => Math.abs(l - s.l) < .35);
  return B;
}
function nearest(C, x, y) { let b = 0, bd = 1e9; for (let i = 0; i < C.n; i++) { const d = (C.px[i] - x) ** 2 + (C.py[i] - y) ** 2; if (d < bd) { bd = d; b = i; } } return b; }

// ---- LAY: its bed and what it builds, from the ground it is cut into (G: layout.js's sampler, the shapes before the brook's own cut).
// Called once by layout.js; fills BROOK.bed, shapes (terrain), bridge, decks (stepping stones),
// parapets (collider spots), fall. The bed: the ground less DEPTH, never rising downstream; above the pool no lower than ABOVE (it
// pours into the pool over a lip), the pool's surface WATER_H, below it falling on to the lip. The water's surface is its bed
// (the shader paints the water on the ground; the depth is the bed's look: waterbed.js)
const DEPTH = .11, ABOVE = -.12, FALLS = .004, BANK = 1.45;   // (BANK: the cut's sides, wide enough to walk down where it cuts ~.35 m through the swell)
export function lay(G) {
  const B = BROOK; if (!B || B.laid) return; B.laid = true;
  const {n, px, py, hw, len, bed} = B, g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = G(px[i], py[i]) - DEPTH;
  let i = 0;
  const inP = k => B.inPool(px[k], py[k], .05);
  for (; i < n && !inP(i); i++) bed[i] = Math.max(ABOVE, i ? Math.min(g[i], bed[i - 1]) : g[0]);
  B.inletL = len[Math.min(n - 1, i)];   // (it pours into the pool here, ~.15 m down: white water)
  for (; i < n && inP(i); i++) bed[i] = WATER_H;
  for (; i < n; i++) bed[i] = Math.min(g[i], bed[i - 1] - FALLS * DS, WATER_H - .03);
  // the cut: every third sample (the pool's own stretch left to its basin: no cut there), the spring's hollow, the pool's basin
  const keep = []; for (let k = 0; k < n; k++) if (k % 3 === 0 || k === n - 1) keep.push(k);
  B.shapes.push({type: 'channel', pts: keep.map(k => [px[k], py[k]]), bed: keep.map(k => B.inPool(px[k], py[k], .3) ? 9 : bed[k]), hw: keep.map(k => hw[k] + .06), bank: BANK},
    {type: 'basin', x: SPRING.x, y: SPRING.y, rx: SPRING.r + .08, ry: SPRING.r + .08, h: bed[0] - .07, rim: .45},
    {type: 'basin', x: POOL.x, y: POOL.y, rx: POOL.rx + .3, ry: POOL.ry + .3, h: 0, rim: .6});
  // ---- THE BRIDGE where it crosses the track: its axis along the track's straight there, centred on the brook's axis, LEN m long
  // (its ends on the track), W m wide (the parapets' outer faces). A segmental arch of SPAN m clear, RISE m, springing SPRING_UP m
  // over the water; its deck a hump (layout.js deckAt: h0 -> h1 + arch sin): the crown CROWN m over the arch ring's top
  const T = TRACK.pts; let best = null;
  for (let k = 0; k + 1 < T.length; k++) {   // where the brook's axis crosses a track segment
    const [ax, ay] = T[k], [bx, by] = T[k + 1];
    for (let j = 0; j + 1 < n; j++) {
      const q = segX(ax, ay, bx, by, px[j], py[j], px[j + 1], py[j + 1]); if (!q) continue;
      best = {k, x: q[0], y: q[1], j}; break;
    }
    if (best) break;
  }
  if (best) {
    const [ax, ay] = T[best.k], [bx, by] = T[best.k + 1], tl = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / tl, uy = (by - ay) / tl;
    const D = BRIDGE, half = D.len / 2, A = [best.x - ux * half, best.y - uy * half], Bq = [best.x + ux * half, best.y + uy * half];
    const water = bed[best.j], spring = water + D.springUp, crown = spring + D.rise + D.ring + D.fill;
    const h0 = G(A[0], A[1]) + .03, h1 = G(Bq[0], Bq[1]) + .03, arch = crown - (h0 + h1) / 2, w = D.w;
    B.bridge = {a: A, b: Bq, w, len: D.len, ux, uy, h0, h1, arch, stone: true, box: [Math.min(A[0], Bq[0]) - w, Math.min(A[1], Bq[1]) - w, Math.max(A[0], Bq[0]) + w, Math.max(A[1], Bq[1]) + w],
      c: [best.x, best.y], water, spring, ...D};
    B.bridgeL = len[best.j];
    B.decks.push(B.bridge);
    // the parapets' colliders: round, every PSTEP m along each side's centre line (layout.js adds a 'parapet' prop at each)
    const off = w / 2 - D.para.d / 2;
    for (const sd of [-1, 1]) for (let s = .2; s < D.len - .1; s += D.para.step) B.parapets.push([A[0] + ux * s - uy * off * sd, A[1] + uy * s + ux * off * sd]);
  }
  // ---- STEPPING STONES across it below the pool: flat stones (decks, so you stand on them; drawn by bridge3d.js), staggered a little
  const js = nearest(B.C, -8.05, 24.45), tx = B.C.tx[js], ty = B.C.ty[js];
  for (const [a, along, sz, k] of [[-.42, -.1, .42, 0], [.02, .12, .46, 1], [.43, -.08, .41, 2]]) {
    const x = px[js] - ty * a + tx * along, y = py[js] + tx * a + ty * along, top = bed[js] + .09 + k % 2 * .02;
    const s = {x, y, r: sz / 2, top, l: len[js] + along, seed: 301 + k, tx, ty, a: [x - tx * sz * .42, y - ty * sz * .42], b: [x + tx * sz * .42, y + ty * sz * .42]};
    B.stones.push(s);
    B.decks.push({a: s.a, b: s.b, w: sz * .95, len: sz * .84, ux: tx, uy: ty, h0: top, h1: top, arch: 0, stone: true, step: true, box: [x - sz, y - sz, x + sz, y + sz]});
  }
  // ---- ROCKS at the water's edge (half in it: its foam rings them; soft 'rock' props, layout.js): below the bridge, in the bend above the
  // pool, by the spring's outflow
  for (const [l, a, sz, k] of [[B.bridge ? len[best.j] + 2.9 : 18.5, -1.05, .3, 0], [len[nearest(B.C, -10.5, 19.6)], .95, .26, 1], [2.6, -.95, .22, 2]]) {
    const i = Math.min(n - 1, Math.max(0, Math.round(l / DS))), tx = B.C.tx[i], ty = B.C.ty[i], x = px[i] - ty * a * hw[i], y = py[i] + tx * a * hw[i];
    B.rocks.push({x, y, r: sz / 2, l: len[i], variant: k});
  }
  // ---- the fall: where its axis crosses the ruins' ravine edge
  for (let k = 1; k < n; k++) if (py[k] >= cliffAt(px[k])) { B.fall = {x: px[k], y: cliffAt(px[k]), hw: hw[k], h: bed[k - 1], l: len[k]}; break; }
  B.fallL = B.fall ? B.fall.l : B.total;
  B.dry = [...B.stones, ...B.rocks];   // (dry footing in the water: the stones and the rocks)
}
// the bridge's measures (m): its length along the track, width (the parapets' outer faces), the arch's clear span, rise, ring (the
// voussoirs' depth), the fill over the ring at its crown, the springing over the water; the parapets' height over the deck (+ a .1 m
// coping), depth, the colliders' step and radius
export const BRIDGE = {len: 6.2, w: 2.3, span: 2.3, rise: .62, ring: .27, fill: .15, springUp: .12, para: {h: .44, d: .26, step: .38, r: .19}};
function segX(ax, ay, bx, by, cx, cy, dx, dy) {   // where segment a-b crosses c-d (or null)
  const r = bx - ax, s = by - ay, p = dx - cx, q = dy - cy, den = r * q - s * p; if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * q - (cy - ay) * p) / den, u = ((cx - ax) * s - (cy - ay) * r) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [ax + r * t, ay + s * t] : null;
}

// ---- the water to the world (world.js waterSample, when (x, y) is not the Proving Grounds' water): fills out as waterSample does,
// kind 4 the brook, 5 its pool. a: m across (+ to the left of the flow), s: K_S x m from the spring (the pattern's travel), speed:
// its pace, hold: the spring's rings, the riffles, the stones' foam and the lip stay as painted. False (out untouched) off it, on a
// stepping stone (dry footing) and past the ravine's edge
const _o = {d: 0, a: 0, l: 0, hw: 0, i: 0};
export function sample(x, y, out) {
  const B = BROOK; if (!B || !B.laid || x < B.box[0] || x > B.box[2] || y < B.box[1] || y > B.box[3]) return false;
  const P = B.inPool(x, y), w = B.at(x, y, _o);
  if (!P && !w) return false;
  if (B.fall && _o.l >= B.fallL - .02 && y >= cliffAt(x)) return false;
  for (const s of B.dry) if (Math.hypot(x - s.x, y - s.y) < s.r) return false;
  out.kind = P ? 5 : 4; out.a = _o.a;
  out.hw = P ? Math.max(.6, POOL.ry) : _o.hw;
  out.edge = P ? B.poolEdge(x, y) : _o.hw - _o.d;
  out.s = _o.l * K_S; out.speed = B.pace(_o.l);
  let hold = Math.hypot(x - SPRING.x, y - SPRING.y) < SPRING.r || B.riffle(_o.l) || (B.fall && B.fallL - _o.l < .14) ? 1 : 0;
  for (const s of B.dry) if (Math.hypot(x - s.x, (y - s.y) * 1.2) < s.r + .16) hold = 1;
  out.hold = hold;
  return true;
}
// how deep the bed lies under it, 0 (the waterline) .. 1 (waterbed.js): shallow and clear along its length, the spring a dark well,
// the pool a bowl
export function depth(o, x, y) {
  let d;
  if (o.kind === 5) d = .1 + .85 * smooth(o.edge / .6) + (vn(x * 3, y * 3, 35) - .5) * .1;
  else {
    d = .05 + .2 * smooth(o.edge / Math.max(.08, o.hw)) + (vn(x * 3, y * 3, 34) - .5) * .08;
    const rs = Math.hypot(x - SPRING.x, y - SPRING.y) / SPRING.r;
    if (rs < 1) d = Math.max(d, .2 + .6 * smooth((1 - rs) / .7));
  }
  return clamp(d, 0, 1);
}

// ---- for others
// in the deep pool (layout.js inStream; world.js lowers the ground there by WATER_H: grow)
export const inBrookPool = (x, y, grow = 0) => !!BROOK && BROOK.inPool(x, y, grow);
// within m of its water (the pool too)
export function wet(x, y, m = 0) {
  const B = BROOK; if (!B || x < B.box[0] - m || x > B.box[2] + m || y < B.box[1] - m || y > B.box[3] + m) return false;
  if (B.inPool(x, y, m)) return true;
  B.at(x, y, _o); return _o.d < _o.hw + m;
}
// (x, y) moved off its banks to m from its edge (a bush on its line), or null when it lies clear
export function away(x, y, m) {
  const B = BROOK; if (!B) return null;
  if (B.inPool(x, y, m)) { const a = Math.atan2((y - POOL.y) / POOL.ry, (x - POOL.x) / POOL.rx); return [POOL.x + Math.cos(a) * (POOL.rx + m + .05), POOL.y + Math.sin(a) * (POOL.ry + m + .05)]; }
  B.at(x, y, _o); if (_o.d >= _o.hw + m) return null;
  const i = _o.i, nx = -B.C.ty[i], ny = B.C.tx[i], sd = (x - B.px[i]) * nx + (y - B.py[i]) * ny >= 0 ? 1 : -1, r = _o.hw + m + .05;
  return [B.px[i] + nx * r * sd, B.py[i] + ny * r * sd];
}
// no grass here: its water and a hand of bank, the bridge's footprint, the stones
export function clear(x, y) {
  const B = BROOK; if (!B || x < B.box[0] || x > B.box[2] || y < B.box[1] || y > B.box[3]) return false;
  if (wet(x, y, .04)) return true;
  const D = B.bridge; if (!D) return false;
  const u = (x - D.a[0]) * D.ux + (y - D.a[1]) * D.uy, v = (x - D.a[0]) * -D.uy + (y - D.a[1]) * D.ux;
  return u > -.15 && u < D.len + .15 && Math.abs(v) < D.w / 2 + .12;
}
// a field wall's gap where it crosses (westland.js OLD_WALL_LEGS: a leg {a, b, ext}) -> [[s0, s1]] (m from a), none elsewhere
export function gapsOn(L) {
  const B = BROOK; if (!B) return [];
  const [ax, ay] = L.a, [bx, by] = L.b, l = Math.hypot(bx - ax, by - ay), out = [];
  for (let j = 0; j + 1 < B.n; j += 2) {
    const k = Math.min(B.n - 1, j + 2), q = segX(ax, ay, bx, by, B.px[j], B.py[j], B.px[k], B.py[k]); if (!q) continue;
    const s = Math.hypot(q[0] - ax, q[1] - ay), half = B.hw[j] + .45; out.push([s - half, s + half]); break;
  }
  return out;
}
// m off the fall's sheet at the ravine's edge (x, the ground just before the edge zs): < 0 inside it (world.js: the cliff texture's
// fall columns, the gap in the ravine's rock). 1 where it doesn't fall
export function fallOff(x, zs) {
  const B = BROOK; if (!B || !B.fall || Math.abs(x - B.fall.x) > 2 || Math.abs(zs - B.fall.y) > 2) return 1;
  B.at(x, zs, _o); return _o.l > B.fallL - 2 ? _o.d - _o.hw : 1;
}

// ---- PAINT (biomes.js westRuins, after the ravine's edge): the brook on the West Downs' canvas. K: the painter's kit (G the pixels, PPM,
// X0 / Y0 the canvas's world origin, WPX / HPX); S the ruins' style; T = {hsh, vn, hex, boulder}. The water in the river's four tones
// exactly (world.js bakeWater moves only texels painted in them): a dark shadow line under the west / north bank, a lit edge on the
// other, a deeper middle, light riffles where it runs fast; earth banks with a damp, lush band beyond them (dampBanks' look); the spring
// welling up in a ring of mossy stones; the pool's bowl; slabs of rock under the stepping stones (dry: their foam rings); foam on
// the lip and, past the edge, the water landing on the ravine's floor
export function paint(K, S, T) {
  const B = BROOK; if (!B || !B.laid) return;
  const {G, PPM, X0, Y0, WPX, HPX} = K, {hsh, vn: n2, hex} = T, W = S.water, o = {d: 0, a: 0, l: 0, hw: 0, i: 0};
  const FL = [hex('#f1ecde'), hex('#f0d968'), hex('#c8a6e8'), hex('#f2b9c9')];
  const xa = Math.max(0, Math.floor((B.box[0] - X0) * PPM)), xb = Math.min(WPX - 1, Math.ceil((B.box[2] - X0) * PPM));
  const ya = Math.max(0, Math.floor((B.box[1] - Y0) * PPM)), yb = Math.min(HPX - 1, Math.ceil((B.box[3] - Y0) * PPM));
  for (let x = xa; x <= xb; x++) for (let y = ya, mx = X0 + (x + .5) / PPM, lip = cliffAt(mx); y <= yb; y++) {
    const my = Y0 + (y + .5) / PPM;
    if (!B.at(mx, my, o) && o.d > o.hw + 1.1 && my < lip && !B.inPool(mx, my, 1.1)) continue;   // (far off it: most of its box)
    if (my >= lip) {   // past the edge: the fall lands on the ravine's floor (groundRuins' foot of the river's fall, smaller)
      if (!B.fall || Math.abs(mx - B.fall.x) > B.fall.hw + .1) continue;
      const r2 = Math.round((my - lip) * PPM), off = Math.abs(mx - B.fall.x) - B.fall.hw;
      if (r2 < 34) G.p(x, y, W, off > -.08 ? 2 : hsh(x, 17) < .3 ? 0 : 1);
      else if (r2 < 40) G.p(x, y, W, hsh(x, y) < .5 ? 0 : 1);
      else if (r2 < 46 && hsh(x, y, 3) < .2) G.c(x, y, W.c[2]);
      continue;
    }
    const inP = B.inPool(mx, my, .5);
    let e = o.d - o.hw, side = o.a < 0 ? -1 : 1, depthC = Math.abs(o.a) < o.hw * .45;
    if (inP) {   // the pool: its own edge where it is the nearer bank
      const ep = -B.poolEdge(mx, my);
      if (ep < e) { e = ep; const u = (mx - POOL.x) / POOL.rx, v = (my - POOL.y) / POOL.ry; side = u + v < 0 ? -1 : 1; depthC = Math.hypot(u, v) < .55; }
    }
    e += (n2(x / 4, y / 3, 73) - .5) * .05;
    if (e >= 1.05) continue;
    if (e >= 0) {   // the banks: an earth lip, then damp grass, then the lusher band (clover, small flowers)
      if (e < .05) G.p(x, y, S.earth, 3);
      else if (e < .14) G.p(x, y, S.earth, side < 0 ? 2 : 1);
      else if (e < .26) { if (hsh(x, y, 4) < .5) G.p(x, y, S.damp, 1); }
      else if (e < .5 + n2(x / 9, y / 7, 62) * .5) {
        const m0 = G.mat(x, y); if (m0 !== S.grass.id && m0 !== S.earth.id) continue;
        if (e < .38 && hsh(x, y, 63) < .45) continue;
        G.p(x, y, S.damp, Math.min(2, Math.max(0, G.tone(x, y))));
        if (hsh(x, y, 65) < .013) { G.p(x, y, S.lush, 0); G.p(x + 1, y, S.lush, 1); G.p(x, y + 1, S.lush, 2); }
        else if (hsh(x, y, 66) < .0035) G.c(x, y, FL[hsh(x, y, 67) * 4 | 0]);
      }
      continue;
    }
    const d = -e, rs = Math.hypot(mx - SPRING.x, my - SPRING.y);
    let t;
    if (rs < SPRING.r + .03) t = rs < .07 || (rs > .14 && rs < .18 && hsh(x, y, 8) < .85) || (rs > .27 && rs < .31 && hsh(x, y, 9) < .6) ? 0 : side < 0 && d < .1 ? 3 : side > 0 && d < .04 ? 0 : rs < .2 ? 2 : 1;
    else {
      const cell = Math.floor(o.l * PPM / 8), ph = o.l * PPM / 8 - cell, riff = !B.inPool(mx, my) && B.riffle(o.l) && hsh(cell, 3) < .55 && ph < .07 + hsh(cell, 4) * .12 && Math.abs(o.a + (hsh(cell, 6) - .5) * o.hw) < o.hw * (.15 + hsh(cell, 5) * .45) && hsh(x, y, 10) < .9;
      t = riff ? 0 : side < 0 && d < .09 ? 3 : side > 0 && d < .04 ? 0 : depthC ? 2 : 1;
      if (B.fall && lip - my < .12 && hsh(x, y, 13) < .8) t = 0;   // the foam on the lip (held as painted)
    }
    G.p(x, y, W, t);
  }
  // the stepping stones: a slab of rock under each (dry: the water's foam rings it), a stone's darker rim
  for (const s of B.dry) {
    const r = s.r * PPM;
    for (let y = Math.floor((s.y - Y0) * PPM - r - 1); y <= Math.ceil((s.y - Y0) * PPM + r + 1); y++) for (let x = Math.floor((s.x - X0) * PPM - r - 1); x <= Math.ceil((s.x - X0) * PPM + r + 1); x++) {
      const dx = x + .5 - (s.x - X0) * PPM, dy = y + .5 - (s.y - Y0) * PPM, q = Math.hypot(dx, dy * 1.05) / r; if (q >= 1 || x < 0 || y < 0 || x >= WPX || y >= HPX) continue;
      G.p(x, y, S.rock, q > .8 ? 3 : dx + dy < -r * .3 ? 1 : 2);
    }
  }
  // the spring: a ring of mossy stones round where it wells up, open to the south (its outflow)
  for (const [a, r, sz, v] of [[-2.6, .5, .9, 1], [-2.0, .47, 1, 2], [-1.35, .48, .85, 3], [-.7, .5, 1, 4], [-.1, .52, .8, 5], [.55, .5, .95, 6], [3.3, .5, .8, 7]])
    T.boulder(K, SPRING.x + Math.cos(a) * r - X0, SPRING.y + Math.sin(a) * r * .9 - Y0, 4.5 * sz + 1.5, 3 * sz + 1, S.rock, v * 17, S.moss);
}
