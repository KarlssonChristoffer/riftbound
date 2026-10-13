// UNCANNY (the plan): the forest's second life (docs/UNCANNY.md), as a pure function of the forest's plan (world/forest.js) and
// the world clock, so every client and the co-op server agree on it to the tree with nothing sent but the clock. Where the
// odd things are, which trees and boulders walk on a given night and when, and where the elk is at any hour of the day.
// No DOM, no Math.random, no game state: node runs it too (server/room.mjs).
//   const U = uncannyPlan(F, {shift})   F = forestPlan(seed); shift: how strong the night shift is (1; 0 = none)
//   THE CLOCK (in-game hours since the start: sim/env.js E.t)
//     nightK(t) -> 0..1      0 by day, 1 at night: eased in over dusk and out over dawn (creatures change, the ring glows)
//     nightNo(t) -> n        which night: the one that began on the evening of day n (noon to noon), its own seed
//     dawning(t) -> bool     the night is ending (after midnight)
//   THE PLACES
//     U.heron   {x, y, phi, ring}         where the heron stands by day, facing the water (phi: atan2(dx, dy) of its look); at night
//                                         a ring of pale mushrooms (ring m) rises there (the two-player secret)
//     U.stones  {x, y, r, n}              the quiet stones: a ring in a glade (inside it your steps make no sound)
//     U.hollow  {x, y, wt, rock}          the pit under an old windthrow's roots (wt: its F.decor entry), else beside a boulder (rock:
//                                         its F.props index; -1), where the marks lead
//     U.marks   [{fid, i, a, h, kind}]    pale marks on trunks, only seen by lantern light at night: the tree (fid, its F.props
//                                         index), the side of the trunk (a: the way it faces), the height, the kind (hand / spiral / eye)
//     U.elk     {x, y, r, path, T}        the elk's patch (r m round x, y) and its day walk (path: [[x, y, dwell h, back], ...],
//                                         T the loop's hours); U.elkAt(t, out) -> out {x, y, phi, back, moving, s} (s: m walked, the legs)
//   THE NIGHT SHIFT
//     U.shift(n) -> [{i, kind, fid, x0, y0, x1, y1, a, b}]   the trees and boulders that walk on night n: F.props index, where
//                                         from, where to, the hour its slide starts at dusk (a) and the hour it slides home at dawn (b)
//     shiftK(m, t) -> 0..1                how far one of them has gone
//     U.posOf(i, t, out) -> out [x, y]    a prop's place at t (its own unless it walks tonight)
//     U.treeNear(x, y, r, t) -> [x, y] | null   the nearest trunk within r at t (the night elk hides behind them)
// OWNS: nothing at run time (data). READS: world/forest.js (RECT, HOME), core/mathx.js, content/recipes.js (the windthrow's pit).
import {RECT, HOME} from './forest.js';
import {hash3, smooth} from '../core/mathx.js';
import {RECIPES} from '../content/recipes.js';

export const TUNE = {
  // nightK: [the hour it starts, the hours it takes] at dusk and dawn (sim/env.js: dusk 18 .. 20.3, night, dawn 5.6 .. 7.2)
  dusk: [19, 1.2], dawn: [5.6, 1.2],
  // the walkers' slides: each starts at an hour of its own in [start, start + spread] and takes len hours (~25 s at 20 min a day)
  slide: {dusk: [18.2, 1.6], dawn: [5.5, 1.1], len: .5},
  // the night shift: the chance a tree / a boulder walks on a night, how far (m), how many ways it tries
  shift: {tree: .045, rock: .07, dist: [1.6, 3.4], ways: 8},
  heron: {water: [1.5, 2.3], trees: 2.4, ring: 1.5},
  stones: {r: 2.3, n: 7, clear: 3.6},
  marks: {n: 6, step: [5, 8.5], spread: 1.05},
  // the elk: its patch's radius, its walk (m per in-game hour: 34 is ~.7 m/s at 20 real minutes a day), the hours it grazes at a
  // stop, how many stops its loop has
  elk: {r: 26, speed: 34, graze: [.2, .45], pts: 7, ring: [11, 9, 13, 7.5, 15]},
};

// ---------------------------------------------------------------- the clock
const H = t => ((((t - 12) % 24) + 24) % 24) + 12;   // the hour within its night's span: 12 .. 36 (24 .. 36 the next morning)
export const nightNo = t => Math.floor((t - 12) / 24);
export const dawning = t => H(t) >= 24;
export function nightK(t) {
  const h = H(t);
  return Math.min(smooth((h - TUNE.dusk[0]) / TUNE.dusk[1]), 1 - smooth((h - 24 - TUNE.dawn[0]) / TUNE.dawn[1]));
}
export function shiftK(m, t) {
  const h = H(t), L = TUNE.slide.len;
  return Math.min(smooth((h - m.a) / L), 1 - smooth((h - 24 - m.b) / L));
}

// the seeded generator (mulberry32, as core/rng.js and world/forest.js) and a seed mixer: node needs nothing else
function rng(seed) { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const mix = (seed, a, b = 0) => (hash3(seed | 0, a, b) * 4294967296) | 0;
const TAU = Math.PI * 2;

export function uncannyPlan(F, o = {}) {
  const U = {seed: F.seed, F, strength: o.shift ?? 1, heron: null, stones: null, hollow: null, marks: [], elk: null};
  const P = F.props, L = F.lake, CL = F.clearing, T = TUNE;
  // ---- what stands where (the forest's own places, before any night): a 4 m grid of [kind, x, y, index]
  // kinds: 0 a tree, 1 a boulder (rock_big), 2 a small solid (a rock with a collider, a windthrow's colliders), 3 a thing on the
  // floor (decor: stumps, logs, berries, mushrooms)
  const G = 4, cells = new Map(), key = (i, j) => (i + 2048) * 4096 + (j + 2048);
  const put = (k, x, y, i) => { const c = key(Math.floor(x / G), Math.floor(y / G)); let a = cells.get(c); if (!a) cells.set(c, a = []); a.push([k, x, y, i]); };
  const trees = [], rocks = [], fidOf = new Map();
  P.forEach((p, i) => {
    if (p[0] === 'tree') { put(0, p[1], p[2], i); trees.push(i); fidOf.set(p[3].fid, i); }
    else if (p[0] === 'rock_big') { put(1, p[1], p[2], i); rocks.push(i); }
    else if (p[0] === 'rock' && p[3].r > 0) put(2, p[1], p[2], i);
  });
  for (const d of F.decorSolid || []) put(2, d[1], d[2], -1);
  for (const d of F.decor || []) put(3, d[1], d[2], -1);
  U.fidIndex = fidOf;
  // the nearest of a kind (mask: 1 trees, 2 boulders, 4 small solids, 8 the floor's things) within r (capped there), skipping index `not`
  const nearest = (x, y, mask, r = 8, not = -1) => {
    let d2 = r * r; const n = Math.ceil(r / G), ci = Math.floor(x / G), cj = Math.floor(y / G);
    for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) {
      const a = cells.get(key(i, j)); if (!a) continue;
      for (const q of a) { if (!(mask & 1 << q[0]) || q[3] === not && not >= 0) continue; const dx = q[1] - x, dy = q[2] - y, e = dx * dx + dy * dy; if (e < d2) d2 = e; }
    }
    return Math.sqrt(d2);
  };
  const count = (x, y, r0, r1) => { let n = 0; const m = Math.ceil(r1 / G), ci = Math.floor(x / G), cj = Math.floor(y / G);
    for (let j = cj - m; j <= cj + m; j++) for (let i = ci - m; i <= ci + m; i++) for (const q of cells.get(key(i, j)) || []) { if (q[0]) continue; const d = Math.hypot(q[1] - x, q[2] - y); if (d >= r0 && d < r1) n++; }
    return n; };
  const W = {d: 0, a: 0, l: 0, hw: 0, i: 0, k: 0};
  const waterD = (x, y) => { F.at(x, y, W); return Math.min(W.d - W.hw, -F.lakeEdge(x, y)); };
  const streamD = (x, y) => { F.at(x, y, W); return W.d - W.hw; };
  const clearD = (x, y) => Math.hypot(x - CL.x, y - CL.y) - CL.r;
  const slope = (x, y) => { const e = .5; return Math.hypot(F.height(x + e, y) - F.height(x - e, y), F.height(x, y + e) - F.height(x, y - e)) / (2 * e); };
  const flat = (x, y, r) => { let lo = 1e9, hi = -1e9; for (let k = 0; k < 9; k++) { const a = k * TAU / 8, q = k ? r : 0, h = F.height(x + Math.cos(a) * q, y + Math.sin(a) * q); lo = Math.min(lo, h); hi = Math.max(hi, h); } return hi - lo; };
  const rocky = (x, y, m) => F.outcrops.some(q => Math.hypot(q.x - x, q.y - y) < q.r + m) || (F.boulders && Math.hypot(F.boulders.x - x, F.boulders.y - y) < F.boulders.r + m);
  const inHome = (x, y, m) => x > HOME.x0 + m && x < HOME.x1 - m && y > HOME.y0 + m && y < HOME.y1 - 4 - m;
  const R = rng(mix(F.seed, 8800));

  // ---- THE HERON: on the lake's shore, its water a couple of metres off, on flat open ground away from the settlement and the
  // streams' mouths; it looks out over the water
  {
    let best = null;
    for (let pass = 0; pass < 3 && !best; pass++) for (let k = 0; k < 64; k++) {   // (each pass a little less fussy: every seed gets its heron)
      const a = k / 64 * TAU + R() * .05, w = T.heron.water[0] + R() * (T.heron.water[1] - T.heron.water[0]), q = 1 - pass * .25;
      let x = 0, y = 0, ok = false;
      for (let s = 1; s < 2.5; s += .02) { x = L.x + Math.cos(a) * L.rx * s; y = L.y + Math.sin(a) * L.ry * s; if (-F.lakeEdge(x, y) >= w) { ok = true; break; } }
      if (!ok || !inHome(x, y, 4) || streamD(x, y) < 3 * q || clearD(x, y) < 6 * q || rocky(x, y, 2 * q)) continue;
      const nt = nearest(x, y, 1, 6); if (nt < T.heron.trees * q || nearest(x, y, 2 | 4, 4) < 2 * q || nearest(x, y, 8, 3) < 1.8 * q || flat(x, y, T.heron.ring + .3) > .3 / q) continue;
      const score = Math.min(nt, 5) + R() * .6 + (clearD(x, y) > 15 ? 1 : 0);
      if (!best || score > best.score) best = {x, y, score};
    }
    if (best) U.heron = {x: +best.x.toFixed(2), y: +best.y.toFixed(2), phi: +Math.atan2(L.x - best.x, L.y - best.y).toFixed(3), ring: T.heron.ring};
  }
  const H0 = U.heron;
  // ---- THE QUIET STONES: a glade in the woods (open in the middle, trees all round), flat, dry, away from the settlement
  {
    let best = null;
    for (let pass = 0; pass < 4 && !best; pass++) for (let t = 0; t < 120; t++) {
      const x = HOME.x0 + 10 + R() * (HOME.x1 - HOME.x0 - 20), y = HOME.y0 + 8 + R() * (HOME.y1 - HOME.y0 - 20), q = 1 - pass * .15;
      if (waterD(x, y) < 5 * q || clearD(x, y) < 16 * q || (H0 && Math.hypot(H0.x - x, H0.y - y) < 22 * q) || rocky(x, y, 3 * q)) continue;
      if (nearest(x, y, 1, 6) < T.stones.clear * q || nearest(x, y, 2 | 4, 5) < 3 * q || nearest(x, y, 8, 4) < (T.stones.r + .6) * q || flat(x, y, T.stones.r + .5) > .35 / q) continue;
      const score = count(x, y, T.stones.clear, 9) + R() * 2;
      if (!best || score > best.score) best = {x, y, score};
    }
    if (best) U.stones = {x: +best.x.toFixed(2), y: +best.y.toFixed(2), r: T.stones.r, n: T.stones.n};
  }
  const S0 = U.stones;
  // ---- THE HOLLOW and THE MARKS: the pit an old windthrow tore out of the ground (a lone, grey one if the seed has one), and a
  // trail of pale marks on trunks leading to it from the woods
  {
    const WT = RECIPES.windthrow, R0 = WT.params.R[0];
    const far = (x, y) => clearD(x, y) > 10 && (!H0 || Math.hypot(H0.x - x, H0.y - y) > 15) && (!S0 || Math.hypot(S0.x - x, S0.y - y) > 15);
    const all = (F.decor || []).filter(d => d[0] === 'windthrow' && far(d[1], d[2]));
    const old = all.filter(d => d[3].params?.old >= .5).concat(all.filter(d => !(d[3].params?.old >= .5)));
    // the places it may be: under a windthrow's roots (its pit, before the root plate: the recipe's frame, -x), else beside a boulder
    const holes = old.map(d => { const c = Math.cos(d[3].yaw), s = Math.sin(d[3].yaw), sc = d[3].s; return {x: d[1] - c * R0 * .62 * sc, y: d[2] - s * R0 * .62 * sc, dir: Math.atan2(-s, -c), wt: d}; });
    for (const i of rocks) { const p = P[i], a = R() * TAU; if (far(p[1], p[2]) && waterD(p[1], p[2]) > 3) holes.push({x: p[1] + Math.cos(a) * 1.1, y: p[2] + Math.sin(a) * 1.1, dir: a, wt: null, rock: i}); }
    for (const hole of holes) {
      const px = hole.x, py = hole.y;
      // the trail, walked out from the pit: each mark a trunk a few metres on, roughly the same way, never one used twice
      let dir = hole.dir + (R() - .5) * 1.2, cx = px, cy = py; const marks = [], used = new Set();
      for (let m = 0; m < T.marks.n; m++) {
        let bt = -1, bs = 1e9;
        const ci = Math.floor(cx / G), cj = Math.floor(cy / G);
        for (let j = cj - 3; j <= cj + 3; j++) for (let i = ci - 3; i <= ci + 3; i++) for (const q of cells.get(key(i, j)) || []) {
          if (q[0] || used.has(q[3])) continue;
          const dx = q[1] - cx, dy = q[2] - cy, dd = Math.hypot(dx, dy); if (dd < T.marks.step[0] || dd > T.marks.step[1]) continue;
          let da = Math.atan2(dy, dx) - dir; da -= Math.round(da / TAU) * TAU; if (Math.abs(da) > T.marks.spread) continue;
          if (waterD(q[1], q[2]) < 2) continue;
          const sc2 = Math.abs(da) * 2 + Math.abs(dd - 6.5) * .3; if (sc2 < bs) { bs = sc2; bt = q[3]; }
        }
        if (bt < 0) break;
        const p = P[bt], from = Math.atan2(cy - p[2], cx - p[1]);   // (the mark faces the way back to the pit: you see it coming from further out)
        used.add(bt); marks.push({fid: p[3].fid, i: bt, a: +from.toFixed(3), h: +(1 + R() * .45).toFixed(2), kind: ['hand', 'spiral', 'eye'][m % 3]});
        dir = Math.atan2(p[2] - cy, p[1] - cx) + (R() - .5) * .6; cx = p[1]; cy = p[2];
      }
      if (marks.length >= 4) { U.hollow = {x: +px.toFixed(2), y: +py.toFixed(2), wt: hole.wt, rock: hole.rock ?? -1}; U.marks = marks.reverse(); break; }   // (the far end first: where the trail starts)
    }
  }
  const markTrees = new Set(U.marks.map(m => m.i));
  // ---- THE ELK: a patch of mixed woods (neither thicket nor open) away from the settlement and the water, and a way through it it
  // walks by day, out and back, from stop to stop (it grazes a while at each); every third leg it walks BACKWARDS (its legs don't know)
  {
    const E = T.elk;
    const okAt = (x, y) => nearest(x, y, 1, 3) > 1.4 && nearest(x, y, 2 | 4, 3) > 1.6 && nearest(x, y, 8, 2) > 1.1 && waterD(x, y) > 2 && slope(x, y) < .35 && !rocky(x, y, 1.2) && inHome(x, y, 3);
    const clear = (ax, ay, bx, by) => { const n = Math.ceil(Math.hypot(bx - ax, by - ay) / .5); for (let k = 1; k < n; k++) { const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n;
      if (nearest(x, y, 1, 2) < .95 || nearest(x, y, 2 | 4, 2) < 1.2 || waterD(x, y) < 1.2 || slope(x, y) > .42 || rocky(x, y, .8)) return false; } return true; };
    let best = null;
    for (let t = 0; t < 160 && !(best && t >= 60); t++) {   // (60 tries, more if none has worked yet)
      const x = HOME.x0 + 16 + R() * (HOME.x1 - HOME.x0 - 32), y = HOME.y0 + 14 + R() * (HOME.y1 - HOME.y0 - 30);
      if (clearD(x, y) < 26 || waterD(x, y) < 10 || (H0 && Math.hypot(H0.x - x, H0.y - y) < 18)) continue;
      const nt = count(x, y, 0, 13);
      if (nt < 6 || nt > 50) continue;
      // open spots round the middle, then a chain through them: from the one nearest the middle, each time to the nearest spot 4 .. 12 m
      // on whose way there is clear of everything (keeping roughly on), up to pts stops. It walks the chain out and back
      const spots = [];
      for (let k = 0; k < 48; k++) { const a = R() * TAU, r = 3 + Math.sqrt(R()) * 14, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (okAt(px, py)) spots.push([px, py]); }
      if (spots.length < 4) continue;
      spots.sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y));
      const chain = [spots[0]], used = new Set([0]); let dir = null;
      while (chain.length < E.pts) {
        const c = chain.at(-1); let bi = -1, bs = 1e9;
        for (let i = 0; i < spots.length; i++) {
          if (used.has(i)) continue; const d = Math.hypot(spots[i][0] - c[0], spots[i][1] - c[1]); if (d < 4 || d > 12) continue;
          const turn = dir === null ? 0 : 1 - ((spots[i][0] - c[0]) * dir[0] + (spots[i][1] - c[1]) * dir[1]) / d, sc = Math.abs(d - 7) + turn * 4;
          if (sc < bs && clear(c[0], c[1], spots[i][0], spots[i][1])) { bs = sc; bi = i; }
        }
        if (bi < 0) break;
        const n = spots[bi], d = Math.hypot(n[0] - c[0], n[1] - c[1]); dir = [(n[0] - c[0]) / d, (n[1] - c[1]) / d]; used.add(bi); chain.push(n);
      }
      if (chain.length < 3) continue;
      const path = chain.concat(chain.slice(1, -1).reverse());   // (out and back: the legs back are the same clear ways)
      let len = 0; for (let i = 0; i < path.length; i++) { const a = path[i], b = path[(i + 1) % path.length]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); }
      const score = chain.length * 3 + len * .03 - Math.abs(nt - 22) * .2 + R();
      if (!best || score > best.score) best = {x, y, path, score};
    }
    if (best) {
      const path = best.path.map(([px, py], i) => [+px.toFixed(2), +py.toFixed(2), +(E.graze[0] + R() * (E.graze[1] - E.graze[0])).toFixed(3), i % 3 === 1 ? 1 : 0]);
      // the loop's legs: [start hour within the loop, its walking hours, its dwell], laid end to end
      const legs = []; let t0 = 0;
      for (let i = 0; i < path.length; i++) { const a = path[i], b = path[(i + 1) % path.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); legs.push({t0, walk: l / E.speed, len: l, dwell: a[2], s0: 0}); t0 += a[2] + l / E.speed; }
      let s = 0; for (const g of legs) { g.s0 = s; s += g.len; }
      U.elk = {x: +best.x.toFixed(2), y: +best.y.toFixed(2), r: E.r, path, legs, T: t0, len: s};
    }
  }
  // where the elk is at t (in-game hours): grazing at a stop (facing on along its way), or walking a leg (backwards on every third)
  U.elkAt = (t, out) => {
    const E = U.elk; if (!E) return null;
    const u = ((t % E.T) + E.T) % E.T, n = E.path.length;
    let i = 0; while (i < n - 1 && u >= E.legs[i + 1].t0) i++;
    const g = E.legs[i], a = E.path[i], b = E.path[(i + 1) % n], back = a[3] === 1, dx = b[0] - a[0], dy = b[1] - a[1], into = u - g.t0;
    let f = 0; if (into > g.dwell) f = Math.min(1, (into - g.dwell) / g.walk);
    out.x = a[0] + dx * f; out.y = a[1] + dy * f; out.moving = into > g.dwell && f < 1; out.back = back;
    out.phi = Math.atan2(dx, dy) + (back ? Math.PI : 0); out.s = g.s0 + g.len * f;
    return out;
  };

  // ---- THE NIGHT SHIFT: on each night, a few trees and boulders walk a couple of metres (each its own hour to go at dusk and to come
  // back at dawn), toward the most open way they have: into the gaps, onto the paths. Never into the water, up a bank, onto the odd
  // places above or the settlement, nor onto anything else
  const keepOff = (x, y) => (H0 && Math.hypot(H0.x - x, H0.y - y) < H0.ring + 2) || (S0 && Math.hypot(S0.x - x, S0.y - y) < S0.r + 2) ||
    (U.hollow && Math.hypot(U.hollow.x - x, U.hollow.y - y) < 2.5) || clearD(x, y) < 2.5;
  const nights = new Map();
  U.shift = n => {
    let list = nights.get(n); if (list) return list;
    list = [];
    const R2 = rng(mix(F.seed, 9000 + n)), Sh = T.shift, k = U.strength, taken = [];
    if (k > 0) for (const [pool, chance, kind] of [[trees, Sh.tree, 'tree'], [rocks, Sh.rock, 'rock']]) for (const i of pool) {
      const roll = R2(), a0 = R2() * TAU, dk = R2(), sa = R2(), sb = R2();
      if (roll >= chance * k || markTrees.has(i)) continue;
      const p = P[i], x0 = p[1], y0 = p[2]; if (keepOff(x0, y0)) continue;
      const d = (Sh.dist[0] + dk * (Sh.dist[1] - Sh.dist[0])) * (k > 1 ? 1 + (k - 1) * .3 : 1), h0 = F.height(x0, y0);
      let best = null;
      for (let j = 0; j < Sh.ways; j++) {
        const a = a0 + j * TAU / Sh.ways, x = x0 + Math.cos(a) * d, y = y0 + Math.sin(a) * d;
        if (x < RECT.x0 + 3 || x > RECT.x1 - 3 || y < RECT.y0 + 3 || y > RECT.y1 - 5 || keepOff(x, y) || waterD(x, y) < 1.6 || slope(x, y) > .4 || Math.abs(F.height(x, y) - h0) > .7) continue;
        if (rocky(x, y, 1.2) || nearest(x, y, 2 | 4, 3) < 1.4 || nearest(x, y, 8, 2) < 1 || taken.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 1.8)) continue;
        const open = nearest(x, y, 1 | 2, 4, i); if (open < 1.6) continue;
        if (!best || open > best.open) best = {x, y, open};
      }
      if (!best) continue;
      taken.push([best.x, best.y]);
      list.push({i, kind, fid: p[3].fid || null, x0, y0, x1: +best.x.toFixed(2), y1: +best.y.toFixed(2),
        a: +(T.slide.dusk[0] + sa * T.slide.dusk[1]).toFixed(3), b: +(T.slide.dawn[0] + sb * T.slide.dawn[1]).toFixed(3)});
    }
    list.trees = new Set(); for (const m of list) if (m.kind === 'tree') list.trees.add(m.i);   // (treeNear: the walkers aren't where the grid has them)
    nights.set(n, list); if (nights.size > 4) nights.delete(nights.keys().next().value);
    return list;
  };
  U.setStrength = k => { if (k !== U.strength) { U.strength = k; nights.clear(); } };
  // a prop's place at t: its own, or along its slide tonight
  U.posOf = (i, t, out) => {
    out[0] = P[i][1]; out[1] = P[i][2];
    for (const m of U.shift(nightNo(t))) if (m.i === i) { const k = shiftK(m, t); out[0] = m.x0 + (m.x1 - m.x0) * k; out[1] = m.y0 + (m.y1 - m.y0) * k; break; }
    return out;
  };
  const NT = [0, 0];
  U.treeNear = (x, y, r, t) => {
    let bd = r, bx = 0, by = 0, hit = false; const list = U.shift(nightNo(t)), moved = list.trees;
    for (const m of list) {
      if (m.kind !== 'tree') continue;
      const k = shiftK(m, t), mx = m.x0 + (m.x1 - m.x0) * k, my = m.y0 + (m.y1 - m.y0) * k, d = Math.hypot(mx - x, my - y);
      if (d < bd) { bd = d; bx = mx; by = my; hit = true; }
    }
    const n = Math.ceil(r / G), ci = Math.floor(x / G), cj = Math.floor(y / G);
    for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) for (const q of cells.get(key(i, j)) || []) {
      if (q[0] || moved.has(q[3])) continue; const d = Math.hypot(q[1] - x, q[2] - y); if (d < bd) { bd = d; bx = q[1]; by = q[2]; hit = true; }
    }
    if (!hit) return null;
    NT[0] = bx; NT[1] = by; return NT;
  };
  return U;
}
