// MIRE (world, pure: docs/MIRE.md): the upland's bog, grown from the SEED as one more stage of the forest's plan
// (world/forest.js calls placeMire with its own generator, mix(seed, 51): nothing else in the forest moves). A pure function of
// the seed and the place: no Math.random, no DOM, no game state (node runs it too: the co-op server checks a dig against it).
//   PLACE   the flattest low spot on the upland's top the seed's candidates find, clear of the fell and the canyon's ridge
//           (their feet at most TUNE.high m up its edge: often the trough between the two, where their slopes meet and the water
//           drains to): a real hollow where water collects. Its ground is a terrain basin (world/terrain.js 'basin': flat at its floor, the
//           floor TUNE.sink m under the lowest ground inside, back up over a rim walkable all round)
//   OUTLINE M.k(x, y): 0 outside .. 1 well in (an ellipse's, its edge wandering: TUNE.edge)
//   POOLS   5 .. 9 dark pools (gölar), 2 .. 6 m across, never on the boardwalk; they grow with the flood (sim/mire.js) up to
//           TUNE.pools.flood of their radius again: the boardwalk goes partly under
//   SOFT    the quaking ground: a noise field over the mire, wettest round the pools; where it is over a threshold (lower in a
//           flood: more of it) you sink when you stand still (features/mire.js)
//   GRID    pools, soft ground and the outline baked once on a TUNE.grid-per-m grid (RGBA8: R the pool field, G the soft field,
//           B the outline): the ground shader draws the pools and the wet from it (render/gfx.js setMire), the sim reads the same
//           numbers bilinearly (M.poolQ, M.softQ): what you see is what sinks you
//   WALK    the old boardwalk across it, edge to edge: planks every TUNE.walk.plank m, one in TUNE.walk.rotten rotten (it breaks
//           under you: features/mire.js)
//   THINGS  dwarf pines on the firm hummocks (forest trees, small), cotton grass (tufts), cloudberry patches (forage, summer),
//           bog iron at the pools' edges (forage), the bog body in an old peat cutting
// OWNS: nothing at run time (plain data). READS: core/mathx.js.
//   const M = placeMire(seed, Q)   Q = {ground(x, y), high(x, y) (the fell's + the ridge's rise), canyonD(x, y), rect, top (y north of which the upland is level), avoid(x, y, r)}
//   M.k(x, y), M.poolQ(x, y), M.softQ(x, y), M.plankAt(x, y), M.grid {x0, y0, w, h, n (cells per m), data}
//   paintMire(M, K, S, T)          the ground's paint (biomes.js forestRuins)
import {vnoise, smooth, clamp, hash3} from '../core/mathx.js';

export const TUNE = {
  r: [13, 19], aspect: [.66, .9], tries: 160, margin: 6, high: 2, canyon: 6,   // (high: m of the fell's or the canyon ridge's rise its edge may stand on)
  edge: .22,                     // how far the outline wanders in and out (a share of the radius)
  sink: .3, rim: [7, 14],        // the floor under the lowest ground inside (m); the rim back up to the ground round it (m)
  pools: {n: [5, 9], r: [1, 3], flood: .6, walk: .5},   // (flood: their radius grows up to this share again; walk: m kept clear of the boardwalk)
  soft: {th: .55, flood: .15},   // soft where the field is over th, th - flood x the flood (sim/mire.js)
  walk: {w: 1.1, plank: .45, rotten: 1 / 6},
  grid: 4,                       // cells per m
  pines: [10, 18], pineS: [.42, .62], tufts: [55, 85], iron: [6, 10], berries: [6, 10],
  body: {len: 2.6, wid: 1.3},    // the peat cutting he lies in (m)
};

function rng(seed) { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const segT = (x, y, ax, ay, bx, by) => { const vx = bx - ax, vy = by - ay; return clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1); };

export function placeMire(seed, Q) {
  const R = rng(seed), T = TUNE, rc = Q.rect, S = (seed >>> 8) & 0xffff;
  // ---- PLACE: candidates on the upland's top; the flattest, lowest (a hollow: lower than the ring round it) wins
  let best = null;
  for (let t = 0; t < T.tries * 2 && !(best && t >= T.tries); t++) {
    const lax = t >= T.tries ? 2 : 1;   // (none fits: a second round lets its edge up the slopes a little further)
    const r0 = T.r[0] + R() * (T.r[1] - T.r[0]), r1 = r0 * (T.aspect[0] + R() * (T.aspect[1] - T.aspect[0])), tall = R() < .5, rx = tall ? r1 : r0, ry = tall ? r0 : r1;
    const x = rc.x0 + rx + T.margin + R() * (rc.x1 - rc.x0 - 2 * (rx + T.margin)), y = rc.y0 + ry + T.margin + R() * (Q.top - ry - T.margin - (rc.y0 + ry + T.margin));
    if (!(y < Q.top - ry - 4)) continue;
    let lo = 1e9, hi = -1e9, sum = 0, ring = 0, bad = false;
    for (let k = 0; k < 24 && !bad; k++) {
      const a = k / 24 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      for (const f of [0, .5, 1]) { const h = Q.ground(x + c * rx * f, y + s * ry * f); lo = Math.min(lo, h); hi = Math.max(hi, h); sum += h; }
      const ex = x + c * rx, ey = y + s * ry;
      if (Q.high(ex, ey) > T.high * lax || Q.high(x + c * rx * .6, y + s * ry * .6) > T.high * .25 * lax || Q.canyonD(ex, ey) < T.canyon) bad = true;
      ring += Q.ground(x + c * (rx + 8), y + s * (ry + 8));
    }
    if (bad || Q.avoid(x, y, Math.max(rx, ry) + 6)) continue;
    const score = (hi - lo) + (sum / 72 - ring / 24) * .8 + R() * .05;
    if (!best || score < best.score) best = {x, y, rx, ry, lo, hi, score};
  }
  if (!best) return null;
  const M = {x: +best.x.toFixed(2), y: +best.y.toFixed(2), rx: +best.rx.toFixed(2), ry: +best.ry.toFixed(2)};
  M.h = +(best.lo - T.sink).toFixed(3);
  M.rim = +clamp((best.hi - M.h) * 4, T.rim[0], T.rim[1]).toFixed(2);
  M.shape = {type: 'basin', x: M.x, y: M.y, rx: M.rx, ry: M.ry, h: M.h, rim: M.rim};
  const ell = (x, y) => Math.hypot((x - M.x) / M.rx, (y - M.y) / M.ry);
  // ---- OUTLINE: 1 - the ellipse's distance, its edge wandering
  const kRaw = (x, y) => clamp((1 - ell(x, y) + (vnoise(x * .12, y * .12, S + 1) - .5) * 2 * T.edge) / .35, 0, 1);
  // ---- WALK: across the long way give or take, a bend in its middle; planks every T.walk.plank m
  const wa = (M.rx >= M.ry ? 0 : Math.PI / 2) + (R() - .5) * .9, wc = Math.cos(wa), ws = Math.sin(wa);
  const end = sg => { let f = .6; while (f < 1.6 && kRaw(M.x + wc * sg * M.rx * f, M.y + ws * sg * M.ry * f) > 0) f += .05; return [M.x + wc * sg * M.rx * (f + .08), M.y + ws * sg * M.ry * (f + .08)]; };
  const mo = (R() - .5) * .5 * Math.min(M.rx, M.ry), W = [end(-1), [M.x - ws * mo + wc * (R() - .5) * 3, M.y + wc * mo + ws * (R() - .5) * 3], end(1)];
  const planks = [], segs = [];
  for (let i = 0; i + 1 < W.length; i++) {
    const [ax, ay] = W[i], [bx, by] = W[i + 1], L = Math.hypot(bx - ax, by - ay), n = Math.floor(L / T.walk.plank);
    segs.push({ax, ay, bx, by, L, i0: planks.length});
    for (let j = 0; j < n; j++) { const f = (j + .5) / n; planks.push([ax + (bx - ax) * f, ay + (by - ay) * f, (bx - ax) / L, (by - ay) / L]); }
  }
  M.walk = {pts: W.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]), w: T.walk.w, n: planks.length,
    planks: planks.map(p => p.map(v => +v.toFixed(3))), rotten: planks.map((p, i) => hash3(seed, i, 61) < T.walk.rotten ? 1 : 0)};
  const walkD = (x, y) => { let d = 1e9; for (const s of segs) { const t = segT(x, y, s.ax, s.ay, s.bx, s.by); d = Math.min(d, Math.hypot(x - s.ax - (s.bx - s.ax) * t, y - s.ay - (s.by - s.ay) * t)); } return d; };
  // the plank under (x, y): its index, -1 off the walk
  M.plankAt = (x, y) => {
    for (const s of segs) {
      const t = segT(x, y, s.ax, s.ay, s.bx, s.by), d = Math.hypot(x - s.ax - (s.bx - s.ax) * t, y - s.ay - (s.by - s.ay) * t);
      if (d < T.walk.w / 2) { const n = Math.floor(s.L / T.walk.plank); return s.i0 + Math.min(n - 1, Math.floor(t * n)); }
    }
    return -1;
  };
  M.walkD = walkD;
  // ---- POOLS: inside, apart, off the walk
  const pools = [], np = T.pools.n[0] + Math.floor(R() * (T.pools.n[1] - T.pools.n[0] + 1));
  for (let t = 0; t < 200 && pools.length < np; t++) {
    const r = T.pools.r[0] + R() * (T.pools.r[1] - T.pools.r[0]), a = R() * Math.PI * 2, q = Math.sqrt(R()) * .78, x = M.x + Math.cos(a) * M.rx * q, y = M.y + Math.sin(a) * M.ry * q;
    const sq = .7 + R() * .3, rot = R() * Math.PI;
    if (kRaw(x, y) < .6 || walkD(x, y) < r * 1.05 + T.pools.walk || pools.some(p => Math.hypot(p.x - x, p.y - y) < p.r + r + 2.2)) continue;
    pools.push({x: +x.toFixed(2), y: +y.toFixed(2), r: +r.toFixed(2), sq: +sq.toFixed(2), rot: +rot.toFixed(3)});
  }
  M.pools = pools;
  // the pool field: 1 at a pool's middle, 0 at its edge (dry weather), below 0 outside (its rim wanders)
  const poolRaw = (x, y) => {
    let q = -1;
    for (const p of pools) {
      const dx = x - p.x, dy = y - p.y; if (Math.abs(dx) > p.r * 2 + 1 || Math.abs(dy) > p.r * 2 + 1) continue;
      const c = Math.cos(p.rot), s = Math.sin(p.rot), u = (dx * c + dy * s) / p.r, v = (-dx * s + dy * c) / (p.r * p.sq);
      q = Math.max(q, 1 - Math.hypot(u, v) + (vnoise(x * .9, y * .9, S + 3) - .5) * .22);
    }
    return q;
  };
  // the soft field: wettest round the pools and in the low middle, firm hummocks in drifts
  const softRaw = (x, y, k, q) => clamp(k * (.25 + .62 * vnoise(x * .16, y * .16, S + 4) + .25 * vnoise(x * .55, y * .55, S + 5)) + .35 * smooth((q + 1.1) / .9) - .12 * (1 - k), 0, 1);
  // ---- GRID: baked once (the shader's and the sim's)
  const n = T.grid, gx0 = Math.floor(M.x - M.rx * 1.35 - 2), gy0 = Math.floor(M.y - M.ry * 1.35 - 2), gw = Math.ceil((M.rx * 2.7 + 4) * n) + 1, gh = Math.ceil((M.ry * 2.7 + 4) * n) + 1;
  const data = new Uint8Array(gw * gh * 4);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = gx0 + (i + .5) / n, y = gy0 + (j + .5) / n, k = kRaw(x, y), q = k > 0 ? poolRaw(x, y) : -1, o = (j * gw + i) * 4;
    data[o] = Math.round(clamp((q + .7) / 1.7, 0, 1) * 255); data[o + 1] = k > 0 ? Math.round(softRaw(x, y, k, q) * 255) : 0; data[o + 2] = Math.round(k * 255); data[o + 3] = 255;
  }
  M.grid = {x0: gx0, y0: gy0, w: gw, h: gh, n, data};
  const samp = (x, y, ch) => {
    const fx = (x - gx0) * n - .5, fy = (y - gy0) * n - .5; if (fx < 0 || fy < 0 || fx >= gw - 1 || fy >= gh - 1) return 0;
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, o = (j * gw + i) * 4 + ch, a = data[o], b = data[o + 4], c = data[o + gw * 4], d = data[o + gw * 4 + 4];
    return ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v) / 255;
  };
  M.k = (x, y) => samp(x, y, 2);
  M.poolQ = (x, y) => samp(x, y, 0) * 1.7 - .7;   // (> -flood x TUNE.pools.flood: in a pool)
  M.softQ = (x, y) => samp(x, y, 1);
  M.box = [gx0, gy0, gx0 + gw / n, gy0 + gh / n];
  // ---- THINGS: (x, y) on firm moss, wet moss, a pool's edge
  const firm = (x, y) => kRaw(x, y) > .25 && poolRaw(x, y) < -.45 && walkD(x, y) > 1.2;
  const pick = (want, test, out, sep) => { for (let t = 0; t < want * 30 && out.length < want; t++) { const a = R() * Math.PI * 2, q = Math.sqrt(R()), x = M.x + Math.cos(a) * M.rx * q, y = M.y + Math.sin(a) * M.ry * q; if (test(x, y) && out.every(p => Math.hypot(p[0] - x, p[1] - y) > sep)) out.push([+x.toFixed(2), +y.toFixed(2), +R().toFixed(3)]); } return out; };
  const cnt = a => a[0] + Math.floor(R() * (a[1] - a[0] + 1));
  // the bog body: in an old peat cutting near the edge, off the walk and the pools
  const body = pick(1, (x, y) => { const k = kRaw(x, y); return k > .45 && k < .9 && firm(x, y) && walkD(x, y) > 4 && poolRaw(x, y) < -.8; }, [], 0)[0];
  M.body = body ? {x: body[0], y: body[1], yaw: +(body[2] * Math.PI * 2).toFixed(3)} : null;
  const clearOfBody = (x, y, m) => !M.body || Math.hypot(x - M.body.x, y - M.body.y) > T.body.len / 2 + m;
  M.pines = pick(cnt(T.pines), (x, y) => firm(x, y) && M.softQ(x, y) < .42 && clearOfBody(x, y, 2), [], 2.4).map(([x, y, r]) => [x, y, +(T.pineS[0] + r * (T.pineS[1] - T.pineS[0])).toFixed(2)]);
  M.tufts = pick(cnt(T.tufts), (x, y) => kRaw(x, y) > .1 && poolRaw(x, y) < -.15 && walkD(x, y) > .7 && clearOfBody(x, y, .5), [], .7);
  M.berries = pick(cnt(T.berries), (x, y) => firm(x, y) && M.softQ(x, y) < .5 && clearOfBody(x, y, 1) && M.pines.every(p => Math.hypot(p[0] - x, p[1] - y) > 1.2), [], 2.5);
  const iron = []; for (let t = 0, want = cnt(T.iron); t < 400 && iron.length < want; t++) {
    const p = pools[Math.floor(R() * pools.length)]; if (!p) break;
    const a = R() * Math.PI * 2, d = p.r * (1.15 + R() * .35), x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d * p.sq;
    if (poolRaw(x, y) > -.08 || poolRaw(x, y) < -.6 || walkD(x, y) < 1 || iron.some(q => Math.hypot(q[0] - x, q[1] - y) < 1.5)) continue;
    iron.push([+x.toFixed(2), +y.toFixed(2), 0]);
  }
  M.iron = iron;
  M.inside = (x, y, m = 0) => ell(x, y) < 1 + (TUNE.edge + m / Math.min(M.rx, M.ry));   // (the growth keeps out of this)
  return M;
}

// ---- PAINT (biomes.js forestRuins, after the floor and before the water): the mire's ground on a forest tile. Mosses in a pale
// mosaic (bog moss yellow-green, rusty red, ochre), darker and wetter where it is soft, peat round the pools, cotton grass's
// white heads, the boardwalk's grey planks (a rotten one dark and green), the bog body in his cutting. The pools' water itself
// is the ground shader's (render/gfx.js setMire): it grows and shrinks and freezes; under it here, dark peat
let PAL = null;
export function paintMire(M, K, S, T) {
  const {G, PPM, X0, Y0, WPX, HPX} = K, {hsh, vn, hex, ramp} = T;
  PAL ??= {
    sph: ramp('#b4b862', '#97a04e', '#7a8640', '#57622f'),   // bog moss (sphagnum): pale yellow-green
    rust: ramp('#b07848', '#94603a', '#76492e', '#523220'),  // its red-brown kind
    ochre: ramp('#b8a064', '#9c864e', '#7e6a3c', '#57492a'),
    peat: ramp('#4a3a2c', '#3a2c22', '#2a2019', '#1c1510'),
    plank: ramp('#a8a094', '#8a8276', '#6a6358', '#46413a'),
    rot: ramp('#6e7058', '#565a46', '#414535', '#2c2f24'),
    wool: ramp('#8a6a44', '#6e5234', '#553e28', '#3a2a1c'),  // his hood and cloak (brown wool)
    skin: ramp('#7a5034', '#603c26', '#482c1c', '#301c12'),  // leathery, tanned by the peat
    stake: ramp('#8a7050', '#6c563c', '#504029', '#342818'),
  };
  const [bx0, by0, bx1, by1] = M.box;
  const xa = Math.max(0, Math.floor((bx0 - X0) * PPM)), xb = Math.min(WPX - 1, Math.ceil((bx1 - X0) * PPM));
  const ya = Math.max(0, Math.floor((by0 - Y0) * PPM)), yb = Math.min(HPX - 1, Math.ceil((by1 - Y0) * PPM));
  if (xa > xb || ya > yb) return;
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
    const mx = X0 + (x + .5) / PPM, my = Y0 + (y + .5) / PPM, k = M.k(mx, my); if (k <= 0) continue;
    if (k < .35 && hsh(x, y, 140) > k / .35) continue;   // (the edge: ragged into the upland's grass)
    const q = M.poolQ(mx, my), s = M.softQ(mx, my), n1 = vn(mx * .7, my * .7, 141), n2 = vn(mx * 2.3, my * 2.3, 142), h = hsh(x, y, 143);
    if (q > -.05) { G.p(x, y, PAL.peat, q > .3 ? 3 : 2); continue; }   // under the pools (the shader's water lies over it)
    if (q > -.25) { G.p(x, y, PAL.peat, h < .5 ? 1 : 2); continue; }   // the black peat lip round a pool
    const wet = s > TUNE.soft.th ? 1 : 0, t = Math.min(3, (wet ? 2 : 0) + (n2 > .62 ? 0 : 1) - (n2 < .3 ? 1 : 0) + (h < .08 ? 1 : 0));
    const mat = n1 > .66 ? PAL.rust : n1 < .3 ? PAL.ochre : (wet && n2 < .45 ? S.damp : PAL.sph);
    G.p(x, y, mat, Math.max(0, t));
    if (!wet && h > .985) { G.c(x, y, hex('#f4f2ea')); if (hsh(x, y, 144) < .6) G.c(x, y - 1, hex('#e6e4da')); }   // cotton grass's white heads
    else if (wet && h > .996) G.c(x, y, hex('#d8e0e4'));   // a glint of water in the moss
  }
  // the boardwalk: two grey planks side by side, across the walk, a dark gap between each, the shadow under its south edge
  const W = M.walk, hw = W.w / 2, pl = TUNE.walk.plank;
  for (let i = 0; i < W.n; i++) {
    const [cx, cy, dx, dy] = W.planks[i], rot = W.rotten[i], R0 = rot ? PAL.rot : PAL.plank, nx = -dy, ny = dx;
    if (cx + 1 < X0 || cy + 1 < Y0 || cx - 1 > X0 + WPX / PPM || cy - 1 > Y0 + HPX / PPM) continue;
    const r = Math.ceil((hw + .2) * PPM);
    for (let py = Math.floor((cy - Y0) * PPM) - r; py <= Math.floor((cy - Y0) * PPM) + r; py++) for (let px = Math.floor((cx - X0) * PPM) - r; px <= Math.floor((cx - X0) * PPM) + r; px++) {
      if (px < 0 || py < 0 || px >= WPX || py >= HPX) continue;
      const mx = X0 + (px + .5) / PPM - cx, my = Y0 + (py + .5) / PPM - cy, u = mx * dx + my * dy, v = mx * nx + my * ny;   // (u along the walk, v across)
      if (Math.abs(u) > pl / 2 || Math.abs(v) > hw + .06) continue;
      if (Math.abs(u) > pl / 2 - .05) { G.p(px, py, PAL.peat, 3); continue; }   // the gap between planks
      if (Math.abs(v) > hw) { if (my > 0) G.p(px, py, PAL.peat, 3); continue; }   // its shadow on the moss
      const grain = vn((u + i * 3.1) * 9, v * 1.4, 145), e = Math.abs(u) > pl / 2 - .1 ? 1 : 0;
      G.p(px, py, R0, Math.min(3, (grain > .6 ? 0 : 1) + e + (rot && hsh(px, py, 146) < .25 ? 1 : 0)));
    }
  }
  // the bog body: an old peat cutting (a dark trench), him lying in it on his side, his hood with its long tail, his cloak over him,
  // two wooden stakes driven in beside him (Bockstensmannen, Halland: docs/MIRE.md)
  const B = M.body; if (!B) return;
  const c = Math.cos(B.yaw), sn = Math.sin(B.yaw), L = TUNE.body.len, Wd = TUNE.body.wid, R = Math.ceil(L * .7 * PPM);
  const bx = Math.floor((B.x - X0) * PPM), by = Math.floor((B.y - Y0) * PPM);
  for (let py = by - R; py <= by + R; py++) for (let px = bx - R; px <= bx + R; px++) {
    if (px < 0 || py < 0 || px >= WPX || py >= HPX) continue;
    const mx = X0 + (px + .5) / PPM - B.x, my = Y0 + (py + .5) / PPM - B.y, u = mx * c + my * sn, v = -mx * sn + my * c;   // (u along him: + his head)
    if (Math.abs(u) > L / 2 || Math.abs(v) > Wd / 2) continue;
    const edge = Math.min(L / 2 - Math.abs(u), Wd / 2 - Math.abs(v));
    let set = false;
    if (edge < .1) { G.p(px, py, PAL.peat, edge < .05 ? 0 : 1); continue; }   // the cutting's cut edge, lit
    // him: head at u .75, the body down to u -.8
    const hd = Math.hypot(u - .78, v * 1.1);
    if (hd < .16) { G.p(px, py, PAL.skin, hd < .07 ? 1 : 2); set = true; }                       // the face, half in the hood
    else if (hd < .25 && u > .7) { G.p(px, py, PAL.wool, 1); set = true; }                       // the hood round it
    else if (Math.abs(v - .05 - (u - .55) * .25) < .045 && u > .1 && u < .62) { G.p(px, py, PAL.wool, 2); set = true; }   // the hood's long tail (liripipe) down his back
    else if (u > -.82 && u < .62 && Math.abs(v) < .26 - Math.max(0, -u - .4) * .25) { G.p(px, py, PAL.wool, Math.abs(v) > .18 ? 3 : (vn(u * 12, v * 12, 147) > .55 ? 1 : 2)); set = true; }   // the cloak over him
    else if (u <= -.82 && u > -1.02 && Math.abs(Math.abs(v) - .09) < .05) { G.p(px, py, PAL.skin, 3); set = true; }   // his feet
    if (!set) G.p(px, py, PAL.peat, 3 - (hsh(px, py, 148) < .2 ? 1 : 0));   // the cutting's wet floor
  }
  // the stakes: two short posts beside him (a lit top, a shadow to the south)
  for (const [su, sv] of [[.35, .42], [-.4, -.42]]) {
    const sx = B.x + su * c - sv * sn, sy = B.y + su * sn + sv * c, px = Math.floor((sx - X0) * PPM), py = Math.floor((sy - Y0) * PPM);
    for (let j = -3; j <= 2; j++) for (let i = -1; i <= 1; i++) G.p(px + i, py + j, PAL.stake, j < -1 ? 0 : i < 0 ? 1 : 2);
    G.p(px, py + 3, PAL.peat, 3); G.p(px + 1, py + 3, PAL.peat, 3);
  }
}
