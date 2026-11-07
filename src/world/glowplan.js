// GLOW PLAN (features/glowlife.js, docs/WORLDLIFE.md "The forest glows at night"): WHERE the forest's night lights live, a pure
// function of the forest plan (world/forest.js) and so of the world's seed: every co-op client finds the same firefly drifts, the
// same foxfire on the same dead wood, the same moonflower patches and the same elf ring. No Math.random, no DOM (node runs it).
//   glowPlan(F) -> {swarms, fox, blooms, ring}
//   swarms  firefly drifts: {x, y, r, n (fireflies at full season), kind ('shore' | 'bank' | 'glade'), dir (the wave's way), per
//           (s: how often the drift falls into step), ph}
//   fox     foxfire spots: {x, y, kind ('snag' a dead tree | 'stump' | 'log' | 'windthrow' | 'root' the foot of an old tree in the
//           thickest wood), fid (a tree's: felled, its fungus goes), k (how bright: 0..1), caps: [{dx, dy, h, v (art variant), a
//           (angle round the wood: the side it grows on)}]}
//   blooms  moonflower patches: {x, y, r, flowers: [{dx, dy, v, d (its delay: 0..1, who opens first), s (size)}]}
//   ring    the elf ring (älvdans): {x, y, r, caps: [{dx, dy, v}]} or null
// Cost: ~10 ms once (a scan of the forest at 4 m steps against a grid of the trees).
import {mulberry32} from '../core/rng.js';

const TAU = Math.PI * 2;
export const PLAN = {
  shore: {n: 7, out: [2.4, 4.6], r: 4.5, flies: [16, 24]},
  bank: {every: 15, side: 1.9, r: 3.6, flies: [10, 16]},
  glade: {step: 4, open: 6, wood: 13, most: 14, apart: 15, r: 5, flies: [12, 22]},
  fox: {stump: .55, freshLog: .35, roots: 12, rootApart: 9},
  bloom: {n: 4, apart: 20, r: [2.4, 3.4], flowers: [16, 26]},
  ring: {r: 2.3, caps: 13},
};

export function glowPlan(F) {
  if (!F) return null;
  const R = mulberry32((F.seed ^ 0x6c0f1a7e) >>> 0), rr = (a, b) => a + R() * (b - a), ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const RC = F.rect, O = {d: 1e9, hw: 0, a: 0, l: 0, i: 0, k: 0};
  // ---- the trees on a grid (for "how open is it here")
  const CELL = 8, gx0 = RC.x0 - 8, gy0 = RC.y0 - 8, GW = Math.ceil((RC.x1 - RC.x0 + 16) / CELL), GH = Math.ceil((RC.y1 - RC.y0 + 16) / CELL), grid = [];
  for (let i = 0; i < GW * GH; i++) grid.push([]);
  const trees = [];
  for (const p of F.props) if (p[0] === 'tree') {
    const t = {x: p[1], y: p[2], sp: p[3]?.species || '', fid: p[3]?.fid || null, s: p[3]?.scale || 1};
    trees.push(t);
    const i = Math.floor((t.x - gx0) / CELL), j = Math.floor((t.y - gy0) / CELL); if (i >= 0 && j >= 0 && i < GW && j < GH) grid[j * GW + i].push(t);
  }
  const count = (x, y, r) => {
    let n = 0; const i0 = Math.floor((x - r - gx0) / CELL), i1 = Math.floor((x + r - gx0) / CELL), j0 = Math.floor((y - r - gy0) / CELL), j1 = Math.floor((y + r - gy0) / CELL);
    for (let j = Math.max(0, j0); j <= Math.min(GH - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(GW - 1, i1); i++) for (const t of grid[j * GW + i]) if ((t.x - x) ** 2 + (t.y - y) ** 2 < r * r) n++;
    return n;
  };
  // ---- where nothing may go: water, its banks' edge, rock, the mire, steep ground, the hut's clearing, the cave's mouth
  const waterD = (x, y) => { F.at(x, y, O); return Math.min(O.d - O.hw, -F.lakeEdge(x, y)); };
  const steep = (x, y) => Math.abs(F.height(x + 1, y) - F.height(x - 1, y)) + Math.abs(F.height(x, y + 1) - F.height(x, y - 1)) > .9;
  const rock = (x, y, m) => F.outcrops.some(o => Math.hypot(o.x - x, o.y - y) < o.r * 1.3 + m) || (F.boulders && Math.hypot(F.boulders.x - x, F.boulders.y - y) < F.boulders.r + m);
  const mire = (x, y) => !!F.mire && F.mire.k(x, y) > .02;
  const cave = (x, y) => !!F.cave && Math.hypot(F.cave.mouth.x - x, F.cave.mouth.y - y) < 9;
  const inRect = (x, y, m) => x > RC.x0 + m && x < RC.x1 - m && y > RC.y0 + m && y < RC.y1 - m;
  const land = (x, y, wm = 1) => inRect(x, y, 3) && waterD(x, y) > wm && !steep(x, y) && !rock(x, y, 1) && !mire(x, y) && !cave(x, y);
  const clearD = (x, y) => F.clearing ? Math.hypot(F.clearing.x - x, F.clearing.y - y) - F.clearing.r : 1e9;

  // ---- FIREFLIES: the lake's shore, the streams' banks, the glades
  const swarms = [];
  const swarm = (x, y, kind, r, fl) => swarms.push({x: +x.toFixed(2), y: +y.toFixed(2), r, kind, n: ri(fl[0], fl[1]), dir: rr(0, TAU), per: rr(40, 90), ph: rr(0, TAU)});
  const farFrom = (x, y, d) => swarms.every(s => Math.hypot(s.x - x, s.y - y) > d);
  if (F.lake) {
    const L = F.lake, S = PLAN.shore, a0 = R() * TAU;
    for (let i = 0; i < S.n; i++) {
      const a = a0 + i / S.n * TAU + rr(-.25, .25), o = rr(S.out[0], S.out[1]), x = L.x + Math.cos(a) * (L.rx + o), y = L.y + Math.sin(a) * (L.ry + o);
      if (land(x, y, .6)) swarm(x, y, 'shore', S.r, S.flies);
    }
  }
  for (const C of [F.stream, F.outflow]) {
    if (!C) continue;
    const B = PLAN.bank; let run = B.every * R(), side = R() < .5 ? -1 : 1;
    for (let k = 1; k < C.n; k++) {
      run += Math.hypot(C.px[k] - C.px[k - 1], C.py[k] - C.py[k - 1]); if (run < B.every) continue;
      const dx = C.px[k] - C.px[k - 1], dy = C.py[k] - C.py[k - 1], l = Math.hypot(dx, dy) || 1, o = C.hw[k] + B.side + R() * 1.2;
      const x = C.px[k] - dy / l * o * side, y = C.py[k] + dx / l * o * side;
      if (land(x, y, .6) && farFrom(x, y, 9)) { swarm(x, y, 'bank', B.r, B.flies); run = 0; side = -side; }
    }
  }
  // the glades: open ground (no tree within `open` m, or one) in a wood (enough trees within `wood` m)
  const G = PLAN.glade, glades = [];
  for (let y = RC.y0 + 6; y < RC.y1 - 6; y += G.step) for (let x = RC.x0 + 6; x < RC.x1 - 6; x += G.step) {
    const jx = x + rr(-1.2, 1.2), jy = y + rr(-1.2, 1.2), o = count(jx, jy, G.open); if (o > 1) continue;
    const w = count(jx, jy, G.wood); if (w < 6 || !land(jx, jy, 2.5) || clearD(jx, jy) < 3) continue;
    glades.push({x: jx, y: jy, score: o * 3 - Math.min(w, 16) * .25 + R() * 2});
  }
  glades.sort((a, b) => a.score - b.score);
  let ng = 0;
  for (const g of glades) { if (ng >= G.most) break; if (!farFrom(g.x, g.y, G.apart)) continue; swarm(g.x, g.y, 'glade', G.r, G.flies); g.used = true; ng++; }

  // ---- FOXFIRE: on the dead wood (dead trees, the woods' own stumps, logs, windthrows) and at the foot of the oldest trees in the thickest wood
  const fox = [], FX = PLAN.fox;
  for (const t of trees) if (t.sp === 'dead') {   // a snag: shelves up its trunk, in two runs on two sides
    const caps = [], a0 = rr(0, TAU), n = ri(4, 6);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i % 2 ? Math.PI + rr(-.7, .7) : rr(-.5, .5)), h = rr(.25, 1.8) * t.s, rad = (.21 * (1.05 - .4 * h / 2.4) + .07) * t.s;
      caps.push({dx: Math.cos(a) * rad, dy: Math.sin(a) * rad, h, v: h < .5 ? 2 : R() < .5 ? 0 : 1, a});
    }
    fox.push({x: t.x, y: t.y, kind: 'snag', fid: t.fid, k: rr(.8, 1), caps});
  }
  for (const d of F.decor) {
    const [name, x, y, o] = d, s = o?.s || 1, yaw = o?.yaw || 0, ux = Math.cos(yaw), uy = Math.sin(yaw);
    if (name === 'stump') {
      if ((o?.params?.style ?? -1) === 2 || R() > FX.stump) continue;
      const caps = [], n = ri(2, 4), a0 = rr(0, TAU), rad = (.32 * 1.08 + .05) * s;
      for (let i = 0; i < n; i++) { const a = a0 + rr(-.9, .9) + (i === 3 ? Math.PI : 0); caps.push({dx: Math.cos(a) * rad, dy: Math.sin(a) * rad, h: rr(.04, .3) * s, v: R() < .6 ? 2 : 3, a}); }
      fox.push({x, y, kind: 'stump', fid: null, k: rr(.6, .9), caps});
    } else if (name === 'log') {
      const old = (o?.params?.old ?? 0) >= .5; if (!old && R() > FX.freshLog) continue;
      const caps = [], n = ri(3, 6), len = 2.4 * s, r = .22 * s;
      for (let i = 0; i < n; i++) {
        const t = rr(-.42, .42) * len, side = R() < .5 ? -1 : 1, a = Math.atan2(ux * side, -uy * side);
        caps.push({dx: ux * t - uy * side * (r + .04), dy: uy * t + ux * side * (r + .04), h: r * rr(.5, 1.4), v: R() < .5 ? 2 : R() < .5 ? 0 : 3, a});
      }
      fox.push({x, y, kind: 'log', fid: null, k: old ? rr(.85, 1) : rr(.5, .7), caps});
    } else if (name === 'windthrow') {   // along the lying trunk (+x of its frame) and low on the torn root plate
      const caps = [], n = ri(3, 5), R0 = 1.1 * s, r = .24 * s;
      for (let i = 0; i < n; i++) {
        if (i === 0) { caps.push({dx: -ux * (R0 * .3 + .05), dy: -uy * (R0 * .3 + .05), h: rr(.2, .6) * s, v: 2, a: yaw + Math.PI}); continue; }
        const t = rr(.9, 3.2) * s, side = R() < .5 ? -1 : 1;
        caps.push({dx: ux * t - uy * side * (r + .04), dy: uy * t + ux * side * (r + .04), h: r * rr(.6, 1.5), v: R() < .5 ? 0 : 2, a: Math.atan2(ux * side, -uy * side)});
      }
      fox.push({x, y, kind: 'windthrow', fid: null, k: rr(.7, .95), caps});
    }
  }
  // the thickest wood: the densest stands' oldest trees glow faintly at the foot
  const dense = trees.filter(t => t.sp !== 'dead' && t.sp !== 'willow' && inRect(t.x, t.y, 3) && !mire(t.x, t.y)).map(t => ({t, n: count(t.x, t.y, 4.5) + R() * .5})).sort((a, b) => b.n - a.n), roots = [];
  for (const {t} of dense) {
    if (roots.length >= FX.roots) break;
    if (roots.some(q => Math.hypot(q.x - t.x, q.y - t.y) < FX.rootApart)) continue;
    const caps = [], n = ri(2, 3), a0 = rr(0, TAU), rad = .3 * t.s + .12;
    for (let i = 0; i < n; i++) { const a = a0 + rr(-.8, .8); caps.push({dx: Math.cos(a) * rad, dy: Math.sin(a) * rad, h: rr(0, .12), v: R() < .7 ? 2 : 3, a}); }
    const f = {x: t.x, y: t.y, kind: 'root', fid: t.fid, k: rr(.45, .7), caps}; roots.push(f); fox.push(f);
  }

  // ---- NIGHT BLOOM: moonflowers in a few of the most open glades (the home woods first)
  const B = PLAN.bloom, blooms = [];
  const openG = glades.filter(g => count(g.x, g.y, 4.5) === 0 && clearD(g.x, g.y) > 4).sort((a, b) => (a.y < -64) - (b.y < -64) || a.score - b.score);
  for (const g of openG) {
    if (blooms.length >= B.n) break;
    if (blooms.some(b => Math.hypot(b.x - g.x, b.y - g.y) < B.apart)) continue;
    const r = rr(B.r[0], B.r[1]), n = ri(B.flowers[0], B.flowers[1]), flowers = [], clumps = [];
    for (let c = ri(2, 4); c > 0; c--) { const a = rr(0, TAU), q = Math.sqrt(R()) * r * .6; clumps.push([Math.cos(a) * q, Math.sin(a) * q]); }
    for (let i = 0; i < n; i++) {
      const [cx, cy] = clumps[i % clumps.length], a = rr(0, TAU), q = Math.sqrt(R()) * r * .55;
      flowers.push({dx: cx + Math.cos(a) * q, dy: cy + Math.sin(a) * q, v: ri(0, 2), d: R(), s: rr(.8, 1.15)});
    }
    blooms.push({x: +g.x.toFixed(2), y: +g.y.toFixed(2), r, flowers}); g.bloom = true;
  }

  // ---- THE ELF RING (älvdans): one open glade in the home woods, away from the blooms; a ring of foxfire caps that breathes
  let ring = null;
  for (const g of openG) {
    if (g.bloom || g.y < -64 || blooms.some(b => Math.hypot(b.x - g.x, b.y - g.y) < 12) || count(g.x, g.y, 3.5) > 0) continue;
    const Q = PLAN.ring, caps = [];
    for (let i = 0; i < Q.caps; i++) { const a = i / Q.caps * TAU + rr(-.08, .08), q = Q.r * rr(.92, 1.08); caps.push({dx: Math.cos(a) * q, dy: Math.sin(a) * q, v: R() < .5 ? 2 : 3}); }
    ring = {x: +g.x.toFixed(2), y: +g.y.toFixed(2), r: Q.r, caps};
    break;
  }
  return {swarms, fox, blooms, ring};
}
