// TROLLS (plan): where the forest's trolls live, grown from the forest's own plan (world/forest.js) and its seed, like the animals
// (world/fauna.js). Pure: no Math.random, no DOM, no game state, so every player (and a server, one day) gets the same stones and
// burrows in the same places. What the trolls DO is features/trolls/sim.js's.
//   const T = trollPlan(F)   T.stones: [{id, x, y, face, seed}]   T.burrows: [{id, x, y, r, n, seed}]
// THE STONES: a big troll's day spot, where the sun caught it once: in the open beside an outcrop or a big boulder, or alone in a
//   glade, away from the settlement's clearing, the water, the cliffs and each other; most in the home woods (the south half), one
//   up in the high country. By day the troll IS the stone there (features/trolls/sim.js); at dusk it wakes.
// THE BURROWS: the small trolls' holes under a big tree's roots in thick wood (the trees' 4 m cells, as fauna's), each with a pack.
// OWNS: nothing at run time (plain data, cached per forest). READS: world/forest.js (RECT, HOME), core/mathx.js.
import {hash3} from '../core/mathx.js';
import {RECT, HOME} from './forest.js';
import {TUNE} from '../content/trolls.js';

export const TROLL_PLAN = {stones: [3, 4], high: 1, apart: 34, burrows: 3, burrowApart: 26, keepClear: 26, keepSouth: -14};

const rngOf = seed => { let s = seed | 0; return () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const mix = (seed, a, b = 0) => (hash3(seed | 0, a, b) * 4294967296) | 0;
const plans = new WeakMap();

export function trollPlan(F) {
  if (!F) return null;
  let P = plans.get(F); if (P) return P;
  const T = TROLL_PLAN, R = rngOf(mix(F.seed, 9101)), rr = (a, b) => a + R() * (b - a), ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const C = 4, cells = new Map(), key = (i, j) => i * 4096 + j;
  for (const p of F.props) if (p[0] === 'tree') {
    const k = key(Math.floor(p[1] / C), Math.floor(p[2] / C)); let c = cells.get(k); if (!c) cells.set(k, c = {n: 0, list: []});
    c.n++; c.list.push(p);
  }
  const around = (x, y, r) => {
    let n = 0; const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((y - r) / C), j1 = Math.floor((y + r) / C);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const c = cells.get(key(i, j)); if (c) for (const p of c.list) if (Math.hypot(p[1] - x, p[2] - y) < r) n++; }
    return n;
  };
  const slope = (x, y) => Math.hypot(F.height(x + .5, y) - F.height(x - .5, y), F.height(x, y + .5) - F.height(x, y - .5));
  const o = {};
  const wet = (x, y, m) => { if (F.inLake(x, y, m)) return true; F.at(x, y, o); return o.d < o.hw + m; };
  const rock = (x, y, m) => F.outcrops.some(q => Math.hypot(q.x - x, q.y - y) < q.r + m);
  const settle = (x, y, m) => F.clearing && Math.hypot(F.clearing.x - x, F.clearing.y - y) < F.clearing.r + m;
  const canyon = (x, y) => F.canyon && F.canyon.pts.some(([cx, cy]) => Math.hypot(cx - x, cy - y) < 7);
  const cave = (x, y) => F.cave?.mouth && Math.hypot(F.cave.mouth.x - x, F.cave.mouth.y - y) < 12;
  const ok = (x, y, m = 1) => x > RECT.x0 + 5 && x < RECT.x1 - 5 && y > RECT.y0 + 5 && y < T.keepSouth && !wet(x, y, 2) && !rock(x, y, m) && slope(x, y) < .4
    && !canyon(x, y) && !cave(x, y) && !settle(x, y, T.keepClear) && around(x, y, 1.2) === 0;
  function best(tries, box, score) {
    let bs = -1e9, bx = 0, by = 0;
    for (let t = 0; t < tries; t++) {
      const x = rr(box.x0, box.x1), y = rr(box.y0, box.y1); if (!ok(x, y)) continue;
      const s = score(x, y); if (s > bs) { bs = s; bx = x; by = y; }
    }
    return bs > -1e8 ? {x: +bx.toFixed(2), y: +by.toFixed(2)} : null;
  }
  const far = (list, x, y, d) => list.every(q => Math.hypot(q.x - x, q.y - y) > d);
  const HIGH = {x0: RECT.x0, y0: RECT.y0, x1: RECT.x1, y1: HOME.y0};
  const stones = [], burrows = [];
  // STONES: beside a rock (an outcrop's or the boulders' edge: the old troll that became part of it), else a glade's middle
  const rocks = F.outcrops.filter(q => q.kind !== 'crag').map(q => ({x: q.x, y: q.y, r: q.r}));
  if (F.boulders) rocks.push(F.boulders);
  const nStone = ri(...T.stones);
  for (let i = 0; i < nStone + T.high; i++) {
    const box = i < nStone ? HOME : HIGH;
    const s = best(90, box, (x, y) => {
      if (!far(stones, x, y, T.apart)) return -1e9;
      let k = 0; for (const q of rocks) { const d = Math.hypot(q.x - x, q.y - y) - q.r; if (d > 1 && d < 6) k = Math.max(k, 3 - d * .4); }
      const glade = around(x, y, 5);
      return k + (glade <= 2 ? 1.2 : 0) - glade * .3 + R();
    });
    if (!s) continue;
    stones.push({id: 'stone' + stones.length, x: s.x, y: s.y, face: rr(0, Math.PI * 2), seed: mix(F.seed, 9200, stones.length), high: i >= nStone});
  }
  // BURROWS: thick wood (many trunks within 6 m), away from the stones a little and each other
  for (let i = 0; i < T.burrows; i++) {
    const s = best(70, HOME, (x, y) => {
      if (!far(burrows, x, y, T.burrowApart) || !far(stones, x, y, 9)) return -1e9;
      return Math.min(around(x, y, 6), 14) * .4 + R();
    });
    if (!s) continue;
    burrows.push({id: 'burrow' + burrows.length, x: s.x, y: s.y, r: 7, n: ri(...TUNE.pack), seed: mix(F.seed, 9300, burrows.length)});
  }
  P = {stones, burrows};
  plans.set(F, P);
  return P;
}
