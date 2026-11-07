// FJÄLLET: the Swedish mountains north of the home woods (docs/FJALL.md; the ideas: /mnt/project-files/briefs/fjallet.md). One
// world with the woods: walk out of the forest's north-east corner and up the jokk's valley, through the mountain birch, past the
// treeline onto the bare fell, by the lake and its red stuga, to the glacier in its cirque under STORFJÄLLET (~3 min at a run).
// THE PLAN (this file): plain data and pure functions of the seed, so every client (and the paint worker) grows the same fjäll and
// nothing is sent. The geography is drawn by hand (the places below); the seed only moves the small things (noise, trees, stones).
//   REGION    x -330..450, y -920..0 (m; y south as everywhere): ~780 x 920 m round the home world's box (layout.js WORLD: the
//             woods, the cave's band north of them), which stays the home world's. The fjäll OWNS every point of the region outside
//             that box (owns): its ground, what you may walk on there, what the camera may show
//   GROUND    one height field over the region on a CELL m lattice (baked on its first read; bilinear like world/terrain.js): the
//             lowland, the massifs (PEAKS, RIDGES) with crags higher up, the U-VALLEY carved along the jokk, the LAKE's basin, the
//             JOKK's bed, the CIRQUE's bowl with the GLACIER's ice in it, the TRAIL's bench, the pads (the stuga). Within BLEND m of
//             the home box it eases into the home ground at the box's edge (home(x, y)), so the two meet without a step
//   ZONES     by height (the treeline TREELINE m, the willow belt, the bare fell, late snow), slope and aspect: zone(x, y) for the
//             painter and the scatter (world/fjallpaint.js, world/fjall3d.js)
//   WALK      the player may walk anywhere in it north of WALK_S (the home world's east and west sides are scenery), but for the deep
//             lake, the stuga's walls, the big boulders (the BLOCK mask) and the rock (steep, as in the woods)
//   PROPS     the scatter: mountain birch, dwarf birch and willow, boulders, the block field, cairns (varder) and the winter trail's
//             red crosses along the trail, the stuga, the bridge over the jokk: lists of plain records, made once (scatter())
//   const P = fjallPlan(seed, {home: {x0, y0, x1, y1}, homeH: (x, y) => m, grid})   (grid: a baked field to reuse: the worker's)
//   P.owns(x, y)  P.H(x, y)  P.steep(x, y)  P.walk(x, y)  P.water(x, y) -> its surface height or NaN  P.zone(x, y, out)
//   P.view(x, y, out)   the camera's bounds there (render/camera.js): the region's own, the home world's (WORLD) elsewhere
//   P.place(name) -> [x, y]   the named places (the gate, the stuga, the lake, the glacier, the summit): teleports, the tour
// OWNS: nothing global (the plan is its own). READS: nothing (pure; layout.js hands it the home ground).
import {vnoise, clamp, smooth, hash3} from '../core/mathx.js';

export const TUNE = {
  region: {x0: -330, y0: -920, x1: 450, y1: 0},
  cell: 1,           // m: the height field's lattice (the near ground mesh's too: fjall3d.js)
  blend: 44,         // m: the fjäll's ground eases into the home ground at the home box's edge over this far
  walkS: -138,       // the fjäll is walkable north of this (beside the home world it is scenery); the gate is the way in
  edge: 10,          // m: the walkable fjäll stops this far in from the region's outer edges
  gate: {x0: 64, y0: -160, x1: 86, y1: -134},   // the way out of the woods: their north-east corner (walkable both sides of x 72)
  treeline: 74,      // m: the mountain birch thins out from here (the willow belt above it, the bare fell above that)
  willow: 96,        // m: the dwarf birch and willow end here
  snow: 128,         // m: late snow (snölegor) lies above this in the north-facing hollows; more higher up
  lake: {x: 95, y: -480, rx: 34, ry: 72, level: 38.2, depth: 3.4, wob: .18},
};
const R = TUNE.region;

// ---------------------------------------------------------------- the places (drawn by hand; m)
// the JOKK from the glacier's snout to the region's east edge, with its valley floor's height at each point (the lake in between)
const JOKK = [[22, -668, 97], [45, -632, 72], [72, -598, 52], [92, -556, 41], [95, -480, 38.2], [98, -410, 37.6], [100, -385, 35.4],
  [106, -340, 31], [112, -290, 25.5], [110, -240, 20], [117, -200, 15.5], [136, -162, 11.8], [176, -122, 9.6], [240, -88, 7.4],
  [330, -58, 5.6], [460, -36, 4]];
// the jokk's half width (m) at each point (narrow and fast up by the glacier, wider in the lower valley) and the valley's half width
const JOKK_HW = [1.4, 1.8, 2.2, 2.6, 2.6, 2.8, 3, 3.2, 3.4, 3.4, 3.6, 3.8, 4, 4.2, 4.4, 4.6];
const VALLEY_W = [40, 52, 62, 72, 82, 82, 80, 76, 72, 66, 62, 64, 74, 86, 96, 100];
// the TRAIL (leden) from the woods' gate to the summit: up the valley on the jokk's east bank, over the bridge to the stuga, along the
// lake's west shore, up past the cirque's lip and along its western arête to the top. Cairns and crosses stand on its open stretches
// the trails are ROUTED (route(): the cheapest way on the ground, steepness costing more and more, water never) through these
// waypoints. LEDEN: the gate, up the valley's west side to the stuga's door, along the lake's west shore, up to the cirque's lip,
// on to the summit (found: the highest ground near its peak). THE WINTER TRAIL (vinterleden): from the lake's north-west shore over
// the footbridge across the jokk (just above its inflow) and up to the pass between Storfjället and the northern plateau
const WAY = {gate: [69, -146], door: [84, -406], shore: [56, -548], lip: [30, -634], summit: [-70, -770], bridgeW: [74.6, -579.4], bridgeE: [85.4, -584.6], pass: [168, -688]};
// the massifs: domes {x, y, h (m over the lowland), rx, ry, k (the profile's power: higher = steeper flanks, a broader top)}
const PEAKS = [
  {x: -70, y: -770, h: 128, rx: 250, ry: 230, k: 1.15, name: 'Storfjället'},
  {x: 300, y: -560, h: 92, rx: 210, ry: 220, k: 1.1, name: 'Östra toppen'},
  {x: 176, y: -840, h: 58, rx: 240, ry: 150, k: .8},            // the northern kalfjäll's plateau (its tarns)
  {x: -36, y: -560, h: 44, rx: 140, ry: 130, k: 1},             // Storfjället's southern shoulder
  {x: 330, y: -250, h: 44, rx: 150, ry: 130, k: 1},             // the low fells east of the lower valley
  {x: 220, y: -200, h: 26, rx: 90, ry: 80, k: 1},
  {x: -10, y: -318, h: 30, rx: 90, ry: 64, k: 1},               // the hills north of the cave's band (hide it from the valley)
  {x: 62, y: -300, h: 22, rx: 52, ry: 54, k: 1},
  {x: -160, y: -210, h: 26, rx: 120, ry: 90, k: 1},             // the west: low fells beside the woods' west
];
const RIDGES = [{a: [-262, -300], b: [-170, -640], h: 74, w: 110}, {a: [-170, -640], b: [-100, -730], h: 84, w: 90}];
// the CIRQUE (botten) on Storfjället's north-east side, the GLACIER in it, its snout where the jokk is born
const CIRQUE = {x: 6, y: -706, r: 74, floor: 104, open: [.62, .78]};   // open: the way it opens (unit vector toward the lake: south-east)
const GLACIER = {x: 4, y: -712, rx: 52, ry: 62, rot: .5};
const STUGA = {x: 76, y: -414, w: 6.2, d: 4.6, yaw: .3, pad: 6};   // the red cabin on the lake's south-west shore (w along its ridge)
const TARNS = [{x: 158, y: -806, r: 9}, {x: 212, y: -846, r: 12}, {x: 120, y: -862, r: 7}];
const PLACES = {gate: [70, -146], valley: [128, -250], bridge: [72, -576], stuga: [86, -404], lake: [62, -470], treeline: [50, -560],
  glacier: [14, -640], summit: [-60, -772], tarns: [150, -800], blockhav: [-200, -470]};

// ---------------------------------------------------------------- helpers
const segNear = (x, y, ax, ay, bx, by, o) => {
  const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy, t = l2 > 0 ? clamp(((x - ax) * vx + (y - ay) * vy) / l2, 0, 1) : 0;
  o[0] = Math.hypot(x - ax - vx * t, y - ay - vy * t); o[1] = t; return o;
};
// the nearest point of a polyline [[x, y, ...]]: o = [d, segment index, t along it]
const _s = [0, 0];
function lineNear(P, x, y, o) {
  o[0] = 1e9; o[1] = 0; o[2] = 0;
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1];
    if (Math.min(a[0], b[0]) - o[0] > x || Math.max(a[0], b[0]) + o[0] < x || Math.min(a[1], b[1]) - o[0] > y || Math.max(a[1], b[1]) + o[0] < y) continue;   // (outside the box grown by the best yet)
    segNear(x, y, a[0], a[1], b[0], b[1], _s);
    if (_s[0] < o[0]) { o[0] = _s[0]; o[1] = i; o[2] = _s[1]; }
  }
  return o;
}
const fbm = (x, y, s) => vnoise(x, y, s) * .55 + vnoise(x * 2.1 + 3.1, y * 2.1 - 1.7, s + 1) * .28 + vnoise(x * 4.3 - 5.3, y * 4.3 + 2.9, s + 2) * .17;
const ridged = (x, y, s) => { const a = 1 - Math.abs(vnoise(x, y, s) * 2 - 1), b = 1 - Math.abs(vnoise(x * 2.3 + 9, y * 2.3 - 4, s + 1) * 2 - 1); return a * a * .65 + b * b * .35; };

export function fjallPlan(seed, {home, homeH = null, edges = null} = {}) {
  const S = (seed * 7919 + 4111) & 0xffff, T = TUNE, L = T.lake, CELL = T.cell;
  const HB = home;   // the home box (layout.js WORLD): not the fjäll's
  const owns = (x, y) => x >= R.x0 && x <= R.x1 && y >= R.y0 && y < R.y1 && (x > HB.x1 || x < HB.x0 || y < HB.y0);
  const homeD = (x, y) => { const dx = Math.max(HB.x0 - x, 0, x - HB.x1), dy = Math.max(HB.y0 - y, 0); return Math.hypot(dx, dy); };
  // the home ground along the home box's edges (north, east, west), sampled every ES m: the same numbers in the worker as here
  const ES = .5;
  const E = edges || (() => {
    const n = new Float32Array(Math.round((HB.x1 - HB.x0) / ES) + 1), e = new Float32Array(Math.round(-HB.y0 / ES) + 1), w = new Float32Array(e.length);
    for (let i = 0; i < n.length; i++) n[i] = homeH(HB.x0 + i * ES, HB.y0);
    for (let i = 0; i < e.length; i++) { e[i] = homeH(HB.x1, HB.y0 + i * ES); w[i] = homeH(HB.x0, HB.y0 + i * ES); }
    return {n, e, w};
  })();
  const at = (A, f) => { f = clamp(f, 0, A.length - 1.001); const i = f | 0, u = f - i; return A[i] + (A[i + 1] - A[i]) * u; };
  function homeEdge(x, y) {   // the home ground at the nearest point of the home box's edge
    const cx = clamp(x, HB.x0, HB.x1), cy = clamp(y, HB.y0, HB.y1);
    if (cy <= HB.y0 + 1e-6) return at(E.n, (cx - HB.x0) / ES);
    return at(cx >= HB.x1 - 1e-6 ? E.e : E.w, (cy - HB.y0) / ES);
  }

  // ---- the shapes' heights
  const tmp = [0, 0, 0];
  const jokkAt = (x, y, o) => { lineNear(JOKK, x, y, tmp); const i = tmp[1], t = tmp[2], a = JOKK[i], b = JOKK[i + 1];
    o.d = tmp[0]; o.i = i; o.t = t; o.floor = a[2] + (b[2] - a[2]) * t; o.hw = JOKK_HW[i] + (JOKK_HW[i + 1] - JOKK_HW[i]) * t; o.vw = VALLEY_W[i] + (VALLEY_W[i + 1] - VALLEY_W[i]) * t; return o; };
  const J = {d: 0, i: 0, t: 0, floor: 0, hw: 0, vw: 0};
  const lakeR = (x, y) => { const u = (x - L.x) / L.rx, v = (y - L.y) / L.ry; return Math.hypot(u, v) * (1 + (vnoise(Math.atan2(v, u) * 2.2 + 9, 3.3, S + 40) - .5) * L.wob); };
  // the mountains over the ground's base: the domes and ridges as an envelope, broken up by noise (a warped fbm: no two flanks alike),
  // crags where it is high
  // the ground's BASE: the jokk's floor, spread over the land as a smooth weighted mean of its points (the nearer, the more), so the land
  // rises with the valley toward the glacier without a seam where two stretches of the jokk are equally near
  const JS = []; for (let i = 0; i + 1 < JOKK.length; i++) { const a = JOKK[i], b = JOKK[i + 1], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8); for (let k = 0; k < n; k++) { const t = k / n; JS.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, VALLEY_W[i] + (VALLEY_W[i + 1] - VALLEY_W[i]) * t]); } }
  // the valley's floor and half width near the jokk, smoothly (a sharp weighted mean: the nearest stretch, without a seam between two)
  const VF = [0, 0];
  function floorAt(x, y) { let sw = 0, sh = 0, sv = 0; for (const p of JS) { const dx = x - p[0], dy = y - p[1]; if (dx > 260 || dx < -260 || dy > 260 || dy < -260) continue; const q = dx * dx + dy * dy + 100, w = 1 / (q * q); sw += w; sh += w * p[2]; sv += w * p[3]; } VF[0] = sw > 0 ? sh / sw : 0; VF[1] = sw > 0 ? sv / sw : 60; return VF; }
  function baseAt(x, y) { let sw = 0, sh = 0; for (const p of JS) { const d2 = (x - p[0]) ** 2 + (y - p[1]) ** 2, w = 1 / (d2 + 900); sw += w; sh += w * p[2]; } return sh / sw + 2.5; }
  function reliefAt(x, y) {
    let m = 0;
    for (const p of PEAKS) {
      const u = (x - p.x) / p.rx, v = (y - p.y) / p.ry, d2 = u * u + v * v; if (d2 >= 1) continue;
      const v1 = p.h * Math.pow(.5 + .5 * Math.cos(Math.PI * Math.sqrt(d2)), p.k);
      m = m > v1 ? m + v1 * .3 : v1 + m * .3;   // (a soft union: two domes make a saddle, not a crease)
    }
    for (const r of RIDGES) {
      segNear(x, y, r.a[0], r.a[1], r.b[0], r.b[1], tmp); const d = tmp[0] / r.w; if (d >= 1) continue;
      const v1 = r.h * Math.pow(.5 + .5 * Math.cos(Math.PI * d), 1.2) * (.85 + .15 * Math.sin(tmp[1] * Math.PI));
      m = m > v1 ? m + v1 * .3 : v1 + m * .3;
    }
    const wx = x + (vnoise(x / 90, y / 90, S + 3) - .5) * 60, wy = y + (vnoise(x / 90 + 7, y / 90 - 3, S + 4) - .5) * 60;   // (the warp)
    const n = fbm(wx / 120, wy / 120, S + 1), north = smooth((-200 - y) / 420);
    m = m * (.62 + .8 * n) + (6 + 26 * north) * fbm(wx / 60, wy / 60, S + 2);
    m += baseAt(x, y);   // (the ground's base: the valley floor's height spread smoothly over the land round it)
    const hk = smooth((m - 40) / 110);
    if (hk > 0) m += (ridged(wx / 50, wy / 50, S + 5) - .4) * 22 * hk;
    return m;
  }
  // the broad relief on a RGC m lattice (worked out once: it is most of the cost), read bilinearly; the fine crags per point on top
  const RGC = 4, RNX = Math.ceil((R.x1 - R.x0) / RGC) + 3, RNY = Math.ceil((R.y1 - R.y0) / RGC) + 3;
  let RG = null;
  function relief(x, y) {
    if (!RG) { RG = new Float32Array(RNX * RNY); for (let j = 0; j < RNY; j++) for (let i = 0; i < RNX; i++) RG[j * RNX + i] = reliefAt(R.x0 + (i - 1) * RGC, R.y0 + (j - 1) * RGC); }
    let fx = (x - R.x0) / RGC + 1, fy = (y - R.y0) / RGC + 1; fx = clamp(fx, 0, RNX - 1.001); fy = clamp(fy, 0, RNY - 1.001);
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * RNX + i, a = RG[k], b = RG[k + 1], c = RG[k + RNX], d = RG[k + RNX + 1];
    const m = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v, hk = smooth((m - 50) / 110);
    return hk > 0 ? m + (ridged(x / 14, y / 14, S + 7) - .45) * 3.5 * hk : m;
  }
  function raw(x, y) {
    jokkAt(x, y, J);
    let h = relief(x, y);   // (the base and the mountains: relief's lattice)
    // the CIRQUE: a bowl bitten into Storfjället's flank, opening toward the lake; the glacier fills its floor
    const cx = x - CIRQUE.x, cy = y - CIRQUE.y, cd = Math.hypot(cx, cy) / CIRQUE.r;
    if (cd < 1.3) {
      const along = (cx * CIRQUE.open[0] + cy * CIRQUE.open[1]) / CIRQUE.r;   // toward its mouth: the bowl runs out that way
      const bowl = CIRQUE.floor + 4 * Math.max(0, -along) + 55 * Math.pow(Math.max(0, cd - .4) / .9, 2) - Math.max(0, along) * 10;
      const k = smooth((1.3 - cd) / .5);
      if (bowl < h) h = h + (bowl - h) * k;
    }
    // the U-VALLEY along the jokk: the ground falls to the floor within its half width, its walls steepening
    if (J.d < 190) floorAt(x, y);
    if (J.d < VF[1] * 1.8 && J.d < 190) {
      const vw = VF[1], u = J.d / vw, fl = VF[0] + .9 + 16 * u * u;
      const k = smooth((J.d - vw * .5) / (vw * 1.3));
      if (h > fl) h = fl + (h - fl) * k;
    }
    // the LAKE's basin
    const lr = lakeR(x, y);
    if (lr < 1.4) {
      const bed = L.level - L.depth * smooth((1 - lr) / .6) - .35;
      if (lr < 1) h = Math.min(h, bed);
      else { const k = smooth((lr - 1) / .4); h = bed + .55 + (h - bed - .55) * k; }
    }
    // the JOKK's bed: cut into the valley floor, its banks blending back up
    if (J.d < J.hw + 3.4 && lr > .98) {
      const bed = VF[0] - .8, k = smooth((J.d - J.hw) / 3.4);
      if (h > bed) h = bed + (h - bed) * k;
    }
    for (const t of TARNS) { const d = Math.hypot(x - t.x, y - t.y) / t.r; if (d < 1.6) { const lv = tarnLevel(t), bed = lv - 1.2 * smooth((1 - d) / .5) - .3; h = d < 1 ? Math.min(h, bed) : Math.min(h, bed + (h - bed) * smooth((d - 1) / .6)); } }
    return h;
  }
  const tarnH = new Map();
  function tarnLevel(t) { let v = tarnH.get(t); if (v === undefined) { let lo = 1e9; for (let a = 0; a < 6.28; a += .4) { const x = t.x + Math.cos(a) * t.r * 1.1, y = t.y + Math.sin(a) * t.r * 1.1; jokkAt(x, y, J); lo = Math.min(lo, relief(x, y)); } tarnH.set(t, v = lo - .25); } return v; }

  // ---- THE TRAIL: routed on the raw ground (A* on a RC m lattice: a step costs its length times how steep it is, water and the deep
  // lake never), simplified and smoothed, then the bench is held level across it
  const RC = 2;
  function route(a, b, pad = 90) {
    const x0 = Math.min(a[0], b[0]) - pad, y0 = Math.min(a[1], b[1]) - pad, nx = Math.ceil((Math.max(a[0], b[0]) + pad - x0) / RC) + 1, ny = Math.ceil((Math.max(a[1], b[1]) + pad - y0) / RC) + 1;
    const N = nx * ny, Hs = new Float32Array(N), wet = new Uint8Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * RC, y = y0 + j * RC, k = j * nx + i, gate = x > T.gate.x0 && y > T.gate.y0 && y < T.gate.y1 && x < T.gate.x1 + 8;
      const dh = homeD(x, y); Hs[k] = eased(x, y);   // (the ground as it will be: eased into the home ground)
      wet[k] = (lakeR(x, y) < 1.12 || stugaIn(x, y, 1.2) || (jokkAt(x, y, J).d < J.hw + 1.5 && J.floor < 99) || y > T.walkS - 2 && !gate || (!owns(x, y) || dh < 9) && !gate) ? 1 : 0;
    }
    const id = (x, y) => clamp(Math.round((y - y0) / RC), 0, ny - 1) * nx + clamp(Math.round((x - x0) / RC), 0, nx - 1);
    const s0 = id(a[0], a[1]), s1 = id(b[0], b[1]); wet[s0] = wet[s1] = 0;
    const g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    // a binary heap of [f, k]
    const hk = [], hf = [];
    const push = (k, f) => { hk.push(k); hf.push(f); let i = hk.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= hf[i]) break; [hk[p], hk[i]] = [hk[i], hk[p]]; [hf[p], hf[i]] = [hf[i], hf[p]]; i = p; } };
    const pop = () => { const k = hk[0], lk = hk.pop(), lf = hf.pop(); if (hk.length) { hk[0] = lk; hf[0] = lf; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hk.length && hf[l] < hf[m]) m = l; if (r < hk.length && hf[r] < hf[m]) m = r; if (m === i) break; [hk[m], hk[i]] = [hk[i], hk[m]]; [hf[m], hf[i]] = [hf[i], hf[m]]; i = m; } } return k; };
    const bx = b[0], by = b[1];
    g[s0] = 0; push(s0, 0);
    const DI = [1, -1, 0, 0, 1, 1, -1, -1, 2, 2, -2, -2, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 2, -2, 2, -2];   // (16 ways: the knight's moves too, so a traverse can hold a gentle angle)
    while (hk.length) {
      const k = pop(); if (done[k]) continue; done[k] = 1; if (k === s1) break;
      const i = k % nx, j = (k / nx) | 0;
      for (let q = 0; q < 16; q++) {
        const ii = i + DI[q], jj = j + DJ[q]; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const kk = jj * nx + ii; if (done[kk] || wet[kk]) continue;
        const L2 = Math.hypot(DI[q], DJ[q]) * RC, gr = Math.abs(Hs[kk] - Hs[k]) / L2;
        const c = L2 * (1 + 8 * gr * gr + (gr > .4 ? 120 * (gr - .4) : 0)), ng = g[k] + c;
        if (ng < g[kk]) { g[kk] = ng; from[kk] = k; push(kk, ng + Math.hypot(x0 + ii * RC - bx, y0 + jj * RC - by)); }
      }
    }
    const pts = []; for (let k = s1; k >= 0; k = from[k]) { pts.push([x0 + (k % nx) * RC, y0 + ((k / nx) | 0) * RC]); if (k === s0) break; }
    pts.reverse(); pts[0] = a.slice(0, 2); pts[pts.length - 1] = b.slice(0, 2);
    return pts;
  }
  // a path's corners rounded (Chaikin), then points every ~3 m
  function smoothPath(P, n = 3) {
    for (let r = 0; r < n; r++) { const Q = [P[0]]; for (let i = 0; i + 1 < P.length; i++) { const a = P[i], b = P[i + 1]; Q.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]); } Q.push(P.at(-1)); P = Q; }
    const out = [P[0]]; let acc = 0;
    for (let i = 1; i < P.length; i++) { acc += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); if (acc >= 3 || i === P.length - 1) { out.push(P[i]); acc = 0; } }
    return out;
  }
  // TR: the trails' points; NXT: each point's next along its trail (-1 at an end); LINES: each trail's point indices; BR: the bridge's
  // segment (its two ends) and its deck's height
  let TR = null, NXT = null, LINES = null, trailH = null, BR = null;
  function makeTrail() {
    if (TR) return;
    // the summit: the highest ground near the peak's middle
    let best = -1e9, top = WAY.summit;
    for (let y = WAY.summit[1] - 60; y <= WAY.summit[1] + 60; y += 4) for (let x = WAY.summit[0] - 60; x <= WAY.summit[0] + 60; x += 4) { const h = raw(x, y); if (h > best) { best = h; top = [x, y]; } }
    PLACES.summit = top.slice();
    const join = (legs, bridge = -1) => { const out = []; let bi = -1; legs.forEach((P, k) => { const Q = k === bridge ? P : smoothPath(P, 3); if (k === bridge) bi = out.length - 1; for (let i = out.length ? 1 : 0; i < Q.length; i++) out.push(Q[i]); }); return {pts: out, bi}; };
    const main = join([route(WAY.gate, WAY.door, 60), route(WAY.door, WAY.shore, 70), route(WAY.shore, WAY.lip, 90), route(WAY.lip, top, 150)]);
    const wint = join([route(WAY.shore, WAY.bridgeW, 40), [WAY.bridgeW, WAY.bridgeE], route(WAY.bridgeE, WAY.pass, 110)], 1);
    TR = []; LINES = [];
    for (const L1 of [main, wint]) { const idx = []; for (const p of L1.pts) { idx.push(TR.length); TR.push(p); } LINES.push(idx); if (L1.bi >= 0) BR = {a: idx[L1.bi], b: idx[L1.bi + 1]}; }
    NXT = new Int32Array(TR.length).fill(-1); for (const idx of LINES) for (let k = 0; k + 1 < idx.length; k++) NXT[idx[k]] = idx[k + 1];
    trailH = TR.map(p => eased(p[0], p[1]));
    const isBr = (i, j) => (i === BR.a && j === BR.b) || (i === BR.b && j === BR.a);
    for (const idx of LINES) {
      for (let r = 0; r < 3; r++) for (let k = 1; k + 1 < idx.length; k++) { const i = idx[k]; if (i !== BR.a && i !== BR.b) trailH[i] = trailH[i] * .5 + (trailH[idx[k - 1]] + trailH[idx[k + 1]]) * .25; }
      // the bench's grade held under GRADE (cut into a crag, built up over a dip: a forward and a backward pass)
      const GRADE = .44;
      for (let pass = 0; pass < 2; pass++) for (let q = 1; q < idx.length; q++) {
        const k = pass ? idx.length - 1 - q : q, i = idx[k], j = idx[pass ? k + 1 : k - 1];
        if (isBr(i, j)) continue;
        const ds = Math.hypot(TR[i][0] - TR[j][0], TR[i][1] - TR[j][1]);
        trailH[i] = clamp(trailH[i], trailH[j] - GRADE * ds, trailH[j] + GRADE * ds);
      }
    }
    BR.deck = Math.max(trailH[BR.a], trailH[BR.b]) + .06;
    STUGA.h = raw(STUGA.x, STUGA.y) + .1;
  }
  // the trail's nearest segment (its first point) and how far along it, on the field's lattice near it (once, segment by segment)
  let TD = null, TI = null, TT = null;
  function trailField() {
    if (TD) return;
    TD = new Float32Array(NX * NY).fill(99); TI = new Int32Array(NX * NY); TT = new Float32Array(NX * NY);
    for (let s = 0; s < TR.length; s++) {
      if (NXT[s] < 0) continue;
      const a = TR[s], b = TR[NXT[s]], m = 3.8;
      for (let j = Math.max(0, Math.floor((Math.min(a[1], b[1]) - m - Y0) * inv)); j <= Math.min(NY - 1, Math.ceil((Math.max(a[1], b[1]) + m - Y0) * inv)); j++)
        for (let i = Math.max(0, Math.floor((Math.min(a[0], b[0]) - m - X0) * inv)); i <= Math.min(NX - 1, Math.ceil((Math.max(a[0], b[0]) + m - X0) * inv)); i++) {
          segNear(X0 + i * CELL, Y0 + j * CELL, a[0], a[1], b[0], b[1], _s); const k = j * NX + i;
          if (_s[0] < TD[k]) { TD[k] = _s[0]; TI[k] = s; TT[k] = _s[1]; }
        }
    }
  }
  const latK = (x, y) => { const i = Math.round((x - X0) * inv), j = Math.round((y - Y0) * inv); return i >= 0 && j >= 0 && i < NX && j < NY ? j * NX + i : -1; };
  function finish(x, y, h) {
    const lk = latK(x, y);
    if (lk >= 0 && TD[lk] < 3.6) {
      tmp[0] = TD[lk]; const i = TI[lk], t = TT[lk];
      if (i === BR.a) { if (tmp[0] < 1.6) h = Math.max(h, BR.deck); }   // (the footbridge's deck over the jokk: its own mesh, fjall3d.js)
      else { const n = NXT[i], bh = trailH[i] + (trailH[n] - trailH[i]) * t, k = smooth((tmp[0] - 1.8) / 1.9); h = bh + (h - bh) * k; }
    }
    const sd = Math.hypot(x - STUGA.x, y - STUGA.y);
    if (sd < STUGA.pad + 4) { const k = smooth((sd - STUGA.pad) / 4); h = STUGA.h + (h - STUGA.h) * k; }
    return h;
  }
  // the ground eased into the home ground near the home box (before the trail's bench: the trail keeps its grade there too)
  function eased(x, y) { const r = raw(x, y), dh = homeD(x, y); if (dh >= T.blend) return r; const e = homeEdge(x, y); return e + (r - e) * smooth(dh / T.blend); }
  function full(x, y) {
    if (!owns(x, y) && homeD(x, y) === 0) return homeEdge(x, y);
    return finish(x, y, eased(x, y));
  }

  // ---- the bake (the worker's: world/fjallworker.js; adopt() takes it here). Before it arrives H is the home edge's ground (what the
  // world was past its edge before the fjäll) and nothing in the fjäll is walkable
  const X0 = R.x0, Y0 = R.y0, NX = Math.round((R.x1 - R.x0) / CELL) + 1, NY = Math.round((R.y1 - R.y0) / CELL) + 1;
  let D = null, ST = null, BLK = null, SC = null;
  function bake() {
    if (D) return;
    makeTrail(); trailField();
    D = new Float32Array(NX * NY);
    for (let j = 0; j < NY; j++) { const y = Y0 + j * CELL; for (let i = 0; i < NX; i++) D[j * NX + i] = full(X0 + i * CELL, y); }
    ST = new Uint8Array(NX * NY); const lim = .7 * CELL;
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const k = j * NX + i, v = D[k];
      if (Math.abs(D[k - 1] - v) > lim || Math.abs(D[k + 1] - v) > lim || Math.abs(D[k - NX] - v) > lim || Math.abs(D[k + NX] - v) > lim) ST[k] = 1;
    }
  }
  const inv = 1 / CELL;
  function H(x, y) {
    if (!D) return homeEdge(x, y);
    let fx = (x - X0) * inv, fy = (y - Y0) * inv;
    fx = fx < 0 ? 0 : fx > NX - 1.001 ? NX - 1.001 : fx; fy = fy < 0 ? 0 : fy > NY - 1.001 ? NY - 1.001 : fy;
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * NX + i;
    const a = D[k], b = D[k + 1], c = D[k + NX], d = D[k + NX + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function steep(x, y) {
    if (!ST) return false;
    const i = Math.round((x - X0) * inv), j = Math.round((y - Y0) * inv);
    return i >= 0 && j >= 0 && i < NX && j < NY && ST[j * NX + i] === 1;
  }
  const slope = (x, y) => { const e = .7; return Math.hypot(H(x + e, y) - H(x - e, y), H(x, y + e) - H(x, y - e)) / (2 * e); };

  // ---- water: the lake's level, the jokk's surface along its bed, the tarns'
  function water(x, y) {
    if (lakeR(x, y) < 1) return L.level;
    jokkAt(x, y, J);
    if (J.d < J.hw && J.floor < 98) return J.floor - .32;
    for (const t of TARNS) if (Math.hypot(x - t.x, y - t.y) < t.r) return tarnLevel(t);
    return NaN;
  }
  const deepLake = (x, y) => lakeR(x, y) < .93;

  // ---- the zones (the painter's, the scatter's): out = {h, sl, north (0..1: faces north), tree / willow (0..1: how much the
  // mountain birch / the dwarf birch and willow want this spot), snow, glacier, rock (0..1), trail (m to it), water (its level or NaN)}
  function zone(x, y, o) {
    const h = H(x, y), e = 1.5, gx = (H(x + e, y) - H(x - e, y)) / (2 * e), gy = (H(x, y + e) - H(x, y - e)) / (2 * e), sl = Math.hypot(gx, gy);
    o.h = h; o.sl = sl; o.north = sl > .05 ? clamp(gy / sl * .5 + .5, 0, 1) : .5;   // (the ground rises toward the south: it faces north)
    const j = (fbm(x / 22, y / 22, S + 20) - .5) * 22;
    o.tree = clamp((T.treeline + j - h) / 16, 0, 1) * clamp((.62 - sl) / .3, 0, 1);
    o.willow = clamp((T.willow + j - h) / 14, 0, 1) * (1 - o.tree);
    o.snow = clamp((h - T.snow - j * 1.5 - (1 - o.north) * 60) / 22, 0, 1) * clamp((.75 - sl) / .3, 0, 1);
    const gu = ((x - GLACIER.x) * Math.cos(GLACIER.rot) + (y - GLACIER.y) * Math.sin(GLACIER.rot)) / GLACIER.rx, gv = (-(x - GLACIER.x) * Math.sin(GLACIER.rot) + (y - GLACIER.y) * Math.cos(GLACIER.rot)) / GLACIER.ry;
    o.glacier = clamp((1 - Math.hypot(gu, gv) * (1 + (vnoise(x / 9, y / 9, S + 30) - .5) * .3)) / .12, 0, 1);
    o.rock = clamp((sl - .55) / .25, 0, 1);
    const lk = TD ? latK(x, y) : -1; o.trail = lk >= 0 ? TD[lk] : 99;
    o.water = water(x, y);
    return o;
  }

  // ---- walking
  const G0 = T.gate;
  const inGate = (x, y) => x > G0.x0 && x < G0.x1 && y > G0.y0 && y < G0.y1;
  const stugaIn = (x, y, m = 0) => { const c = Math.cos(STUGA.yaw), s = Math.sin(STUGA.yaw), dx = x - STUGA.x, dy = y - STUGA.y, u = dx * c + dy * s, v = -dx * s + dy * c; return Math.abs(u) < STUGA.w / 2 + m && Math.abs(v) < STUGA.d / 2 + m; };
  const BC = .5, BNX = Math.ceil((R.x1 - R.x0) / BC), BNY = Math.ceil((R.y1 - R.y0) / BC);
  const blocked = (x, y) => { if (!BLK) return false; const i = ((x - R.x0) / BC) | 0, j = ((y - R.y0) / BC) | 0; return i >= 0 && j >= 0 && i < BNX && j < BNY && BLK[j * BNX + i] === 1; };
  function walk(x, y) {
    if (inGate(x, y)) return !!D || x < HB.x1 - .9;   // (out past the woods only once the fjäll's ground is there)
    if (!D || !owns(x, y)) return false;
    if (y > T.walkS || x < R.x0 + T.edge || x > R.x1 - T.edge || y < R.y0 + T.edge) return false;
    if (homeD(x, y) < 6 && !inGate(x, y)) return false;   // (a strip along the home box: its band's rock, the woods' edge, is the home world's)
    if (deepLake(x, y) || stugaIn(x, y, .15) || blocked(x, y)) return false;
    return true;
  }
  function block(x, y, r) {
    BLK ??= new Uint8Array(BNX * BNY);
    for (let j = Math.floor((y - r - R.y0) / BC); j <= Math.ceil((y + r - R.y0) / BC); j++) for (let i = Math.floor((x - r - R.x0) / BC); i <= Math.ceil((x + r - R.x0) / BC); i++) {
      if (i < 0 || j < 0 || i >= BNX || j >= BNY) continue;
      if (Math.hypot(R.x0 + (i + .5) * BC - x, R.y0 + (j + .5) * BC - y) < r) BLK[j * BNX + i] = 1;
    }
  }

  // ---- the scatter (the worker's, once): records for fjall3d.js. Deterministic: hashes of the seed and a lattice
  function scatter() {
    if (SC) return SC;
    bake();
    const Z = {}, trees = [], shrubs = [], stones = [], cairns = [], crosses = [];
    const hz = (i, j, k) => hash3(i, j, S * 31 + k);
    const TC = 3.4;
    for (let j = Math.floor(R.y0 / TC); j < Math.ceil(R.y1 / TC); j++) for (let i = Math.floor(R.x0 / TC); i < Math.ceil(R.x1 / TC); i++) {
      const x = (i + .15 + hz(i, j, 1) * .7) * TC, y = (j + .15 + hz(i, j, 2) * .7) * TC;
      if (!owns(x, y) || homeD(x, y) < 2) continue;
      zone(x, y, Z);
      if (Z.water === Z.water || Z.trail < 2.4 || Z.glacier > 0 || lakeR(x, y) < 1.08 || Math.hypot(x - STUGA.x, y - STUGA.y) < STUGA.pad + 1.5) continue;
      const grove = fbm(x / 34, y / 34, S + 50), r = hz(i, j, 3);
      if (Z.tree > 0 && r < Z.tree * (grove > .52 ? .5 : .1)) trees.push({x, y, s: .72 + hz(i, j, 4) * .5 * Z.tree + .12, yaw: hz(i, j, 5) * 6.283, v: (hz(i, j, 6) * 8) | 0});
      else if ((Z.willow > .1 || (Z.tree > 0 && grove > .45)) && r > .8 - Z.willow * .22) shrubs.push({x, y, s: .5 + hz(i, j, 7) * .6, yaw: hz(i, j, 8) * 6.283, v: (hz(i, j, 9) * 4) | 0, k: Z.tree > 0 ? 1 : 0});
    }
    const SCL = 5;
    for (let j = Math.floor(R.y0 / SCL); j < Math.ceil(R.y1 / SCL); j++) for (let i = Math.floor(R.x0 / SCL); i < Math.ceil(R.x1 / SCL); i++) {
      const x = (i + hz(i, j, 11)) * SCL, y = (j + hz(i, j, 12)) * SCL;
      if (!owns(x, y) || homeD(x, y) < 4) continue;
      zone(x, y, Z); if (Z.water === Z.water || Z.trail < 2.8 || lakeR(x, y) < 1.05 || Math.hypot(x - STUGA.x, y - STUGA.y) < STUGA.pad + 2) continue;
      segNear(x, y, RIDGES[0].a[0], RIDGES[0].a[1], RIDGES[0].b[0], RIDGES[0].b[1], tmp);
      const field = Z.h > 70 && tmp[0] < 50 && fbm(x / 26, y / 26, S + 60) > .44;   // the BLOCKHAV on the western ridge's crest
      const want = field ? .95 : Z.glacier > 0 ? .02 : (1 - Z.tree * .8) * (.05 + Z.rock * .3);
      const n = field ? 3 : 1;
      for (let q = 0; q < n; q++) {
        if (hz(i, j, 13 + q * 7) > want) continue;
        const sx = q ? x + (hz(i, j, 20 + q) - .5) * SCL : x, sy = q ? y + (hz(i, j, 24 + q) - .5) * SCL : y;
        const big = hz(i, j, 14 + q) < (field ? .3 : .12), r = big ? 1.1 + hz(i, j, 15 + q) * 1.3 : .3 + hz(i, j, 16 + q) * .55;
        stones.push({x: sx, y: sy, r, yaw: hz(i, j, 17 + q) * 6.283, v: (hz(i, j, 18 + q) * 6) | 0, field});
        if (r > .7) block(sx, sy, r * .8);
      }
    }
    // along the trail: cairns every ~30 m once out of the birch, the winter trail's red crosses every ~20 m on the open fell
    LINES.forEach((idx, li) => {
      let run = 0, nextC = 10, nextX = 4;
      for (let q = 0; q + 1 < idx.length; q++) {
        const i = idx[q], a = TR[i], b = TR[idx[q + 1]], L2 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        if (i === BR.a) { run += L2; continue; }
        for (let s = 0; s < L2; s += 1) {
          const t = s / L2, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, nx = -(b[1] - a[1]) / L2, ny = (b[0] - a[0]) / L2;
          const h = H(x, y), k = i * 64 + (s | 0) + li * 99991;
          if (li === 0 && run >= nextC && h > T.treeline - 4) { const side = hz(k, 1, 41) < .5 ? -1 : 1, cx = x + nx * 2.3 * side, cy = y + ny * 2.3 * side; cairns.push({x: cx, y: cy, s: .85 + hz(k, 1, 42) * .4, v: (hz(k, 1, 43) * 4) | 0}); block(cx, cy, .5); nextC = run + 28 + hz(k, 1, 44) * 8; }
          if (run >= nextX && h > T.treeline - 14) { const side = (crosses.length & 1) ? -1 : 1, cx = x + nx * 1.6 * side, cy = y + ny * 1.6 * side; crosses.push({x: cx, y: cy, yaw: Math.atan2(b[1] - a[1], b[0] - a[0]), lean: (hz(k, 1, 45) - .5) * .14}); block(cx, cy, .16); nextX = run + (li ? 16 : 22) + hz(k, 1, 46) * 5; }
          run += 1;
        }
      }
    });
    return (SC = {trees, shrubs, stones, cairns, crosses});
  }
  // everything the worker made, in one message (transferable buffers), and taking it here
  function pack() { scatter(); return {D, ST, BLK, TR, NXT, LINES, trailH, BR, SC, summit: PLACES.summit, stugaH: STUGA.h}; }
  function adopt(o) { D = o.D; ST = o.ST; BLK = o.BLK; TR = o.TR; NXT = o.NXT; LINES = o.LINES; trailH = o.trailH; BR = o.BR; SC = o.SC; PLACES.summit = o.summit; STUGA.h = o.stugaH; }

  // ---- the camera's bounds (render/camera.js): in the fjäll its region; in the home world the home world's own
  const VB = {x0: R.x0, y0: R.y0, x1: R.x1, y1: R.y1, WM: R.x1 - R.x0, HM: R.y1 - R.y0, past: 0};
  const view = (x, y, homeB) => owns(x, y) && (y < T.walkS + 30 || homeD(x, y) > 30) ? VB : homeB;

  return {seed, TUNE: T, region: R, home: HB, edges: E, owns, H, steep, slope, walk, water, zone, scatter, view, blocked, raw,
    homeD, bake, pack, adopt, route, get ready() { return !!D; }, grid: () => ({data: D, nx: NX, ny: NY, x0: X0, y0: Y0, cell: CELL}),
    inGate, lakeR, deepLake, jokkAt: (x, y) => ({...jokkAt(x, y, J)}), jokkEdge: (x, y) => { jokkAt(x, y, J); return J.floor < 98 ? J.d - J.hw : 99; }, stugaIn, place: n => PLACES[n] ? PLACES[n].slice() : null, PLACES,
    JOKK, JOKK_HW, get TRAIL() { return TR; }, get LINES() { return LINES; }, get NEXT() { return NXT; }, get BRIDGE() { return BR; }, STUGA, LAKE: L, GLACIER, CIRQUE, TARNS, PEAKS, get trailH() { return trailH; }};
}
