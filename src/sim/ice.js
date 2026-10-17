// ICE (sim, pure): the forest lake's ice as a function of the clock (no state: every client and the co-op server compute the same
// thickness from the world's clock), its thin spots from the forest plan, and the holes in it. docs/WINTER.md "The lake ice".
//   thickYear(yr) / thickAt(hours, seasonDays) -> m   the ice on the open lake at that point of the year
//   const L = createLake(plan)   L.thin [[x, y, r]] (inflow, outflow, deepest), L.inLake(x, y)
//   L.localAt(x, y, thick) -> m  the ice at (x, y): thinner near the thin spots
//   L.holes: Map id -> {x, y, r, at (the hour it's frozen over)}; L.inHole(x, y) -> the hole | null; L.open(id, x, y, r, at); L.close(id)
// OWNS: nothing outside its own L. READS: the plan (inLake, lakeEdge, lake, stream, outflow).
import {TUNE} from '../content/ice.js';

// the ice at a point of the year (yr: seasons since the clock's start, sim/env.js E.year: a locked season sits in its middle)
export function thickYear(yr) {
  const T = TUNE, k = ((yr % 4) + 4) % 4, s = Math.floor(k), u = k - s;
  if (s === 3) return Math.min(T.max, T.grow * u);
  if (s === 0) return Math.max(0, Math.min(T.max, T.grow) * (1 - u / T.thaw));
  return 0;
}
export const thickAt = (hours, seasonDays) => thickYear(hours / (seasonDays * 24));
// the next hour a hole made at `hours` is frozen over again
export const refreezeAt = (hours, seasonDays) => hours + TUNE.hole.refreeze * seasonDays * 24;

export function createLake(plan) {
  const L = {thin: [], holes: new Map(), inLake: (x, y) => !!plan?.inLake?.(x, y)};
  if (!plan?.lake) return L;
  const lk = plan.lake, S = plan.stream, O = plan.outflow;
  if (S) for (let i = S.n - 1; i > 0; i--) if (!plan.inLake(S.px[i], S.py[i])) { const j = Math.min(S.n - 1, i + 1); L.thin.push([S.px[j], S.py[j], TUNE.thinR]); break; }
  if (O) for (let i = 0; i < O.n - 1; i++) if (!plan.inLake(O.px[i], O.py[i])) { const j = Math.max(0, i - 1); L.thin.push([O.px[j], O.py[j], TUNE.thinR]); break; }
  { let bx = lk.x, by = lk.y, bd = -1e9;   // the deepest: the farthest from the shore (a coarse grid)
    for (let y = lk.y - lk.ry; y <= lk.y + lk.ry; y += .5) for (let x = lk.x - lk.rx; x <= lk.x + lk.rx; x += .5) if (plan.inLake(x, y)) { const d = plan.lakeEdge(x, y); if (d > bd) { bd = d; bx = x; by = y; } }
    L.thin.push([bx, by, TUNE.thinR]); }
  L.localAt = (x, y, thick) => {
    let k = 1;
    for (const t of L.thin) { const d = Math.hypot(x - t[0], y - t[1]); if (d < t[2]) k = Math.min(k, TUNE.thin + (1 - TUNE.thin) * d / t[2]); }
    return thick * k;
  };
  L.inHole = (x, y) => { for (const h of L.holes.values()) if (Math.abs(x - h.x) < h.r && Math.abs(y - h.y) < h.r && Math.hypot(x - h.x, y - h.y) < h.r) return h; return null; };
  L.open = (id, x, y, r, at) => {
    L.holes.set(id, {id, x, y, r, at});
    if (L.holes.size > TUNE.hole.max) { let o = null; for (const h of L.holes.values()) if (!o || h.at < o.at) o = h; L.holes.delete(o.id); }
  };
  L.close = id => L.holes.delete(id);
  return L;
}
