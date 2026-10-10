// COLLIDE (docs/COLLISION.md phase 2): the world's solids as one service, what a body is stopped by. The solids are the registry's
// props: a circle (p.r) or an axis-aligned box (p.rect: [x0, y0, x1, y1]), each standing from its base (p.z) to its top (heightOf:
// the world's own top, else HEIGHT by kind); and the ground, which the body's own rule tests at its middle (off the map, water, too
// high a step, a steep rise). The body is a circle; against a box its outline is the box grown by that radius with round corners
// (so a body slides round a corner instead of catching on it).
// A BODY says what stops it: who = {r (its radius), counts(p, z) (a prop stops it, its feet at height z: the cheap test, before the
// shape), through(p, z)? (a prop it overlaps but passes anyway: rubble it steps over), ground(x, y, z, air) (the ground at (x, y) is
// solid to it)}. Bodies are made once (no closures a call).
// OWNS: nothing of the world (reads the props' x / y / z / r / rect, the registry's near(), the world's tops). No allocation a call.
// BUDGET: overlap() is one near() query + the ground's rule (~1-2 us).
//   const C = createCollide(() => ents)
//   C.overlap(who, x, y, z, air) -> bool: the body at (x, y), feet at z, is inside something
//   C.touch(p, x, y, r) -> bool: the body (radius r) overlaps prop p; C.CN = {nx, ny, d}: the way out of it and how deep
//   heightOf(p) -> m: how high a prop stands over its base (one table for every system: docs/COLLISION.md phase 6)
import {topOfProp} from './world.js';

// how high each kind stands over its base (m) where the world builds it no top of its own (world.js topOfProp: walls, towers, posts,
// the watchtower's ring, the field walls); merged from the lasso's, the gadgets', combat's and the gunmen's tables
export const HEIGHT = {crate: .8, barrel: .9, barrel_x: .9, pot: .5, crystal: 1.2, dummy: 1.4, chest: .6, pillar: 2.6, pillar_broken: 1.4,
  rock: .5, rock_big: 1.1, rubble: .6, brazier: 1.1, torch: 1.7, well: .9, bench: .5, stall: 2, campfire: .15, woodpile: .4, beacon: 1.5,
  gadget_cache: .7, scarecrow: 1.5, ruin: 2, merchant: 1.6, goods: .7, tree: 6, lasso_snag: 4.3, brute: 1.5, gunman: 1.8,
  bush: 0, tuft: 0, fern: 0, reed: 0, gadget: 0};
export const heightOf = p => topOfProp(p) ?? HEIGHT[p.kind] ?? 1.2;

export function createCollide(entsOf) {
  const near = [];
  const CN = {nx: 0, ny: 0, d: 0};   // the last touch(): the way out (unit) and the depth
  // the body (radius r) at (x, y) against prop p -> true when they overlap (CN: the way out of it, how deep)
  function touch(p, x, y, r) {
    const q = p.rect;
    if (q) {
      const cx = x < q[0] ? q[0] : x > q[2] ? q[2] : x, cy = y < q[1] ? q[1] : y > q[3] ? q[3] : y, dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      if (d2 > 0) { if (d2 >= r * r) return false; const d = Math.sqrt(d2); CN.nx = dx / d; CN.ny = dy / d; CN.d = r - d; return true; }
      const l = x - q[0], e = q[2] - x, t = y - q[1], b = q[3] - y, m = Math.min(l, e, t, b);   // (inside the box: out through its nearest face)
      CN.nx = m === l ? -1 : m === e ? 1 : 0; CN.ny = m === l || m === e ? 0 : m === t ? -1 : 1; CN.d = m + r; return true;
    }
    if (!(p.r > 0)) return false;
    const R = p.r + r, dx = x - p.x, dy = y - p.y, d2 = dx * dx + dy * dy;
    if (d2 >= R * R) return false;
    const d = Math.sqrt(d2);
    if (d > 1e-9) { CN.nx = dx / d; CN.ny = dy / d; } else { CN.nx = 0; CN.ny = 1; }
    CN.d = R - d; return true;
  }
  function overlap(who, x, y, z, air) {
    if (who.ground(x, y, z, air)) return true;
    for (const p of entsOf().near(x, y, who.r, near)) if (who.counts(p, z) && touch(p, x, y, who.r) && !who.through?.(p, z)) return true;
    return false;
  }
  return {overlap, touch, CN};
}
