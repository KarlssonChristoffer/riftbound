// COLLIDE (docs/COLLISION.md phase 2): the world's solids as one service, what a body is stopped by. The solids are the registry's
// props: a circle (p.r) or an axis-aligned box (p.rect: [x0, y0, x1, y1]), each standing from its base (p.z) to its top (heightOf:
// the world's own top, else HEIGHT by kind); and the ground, which the body's own rule tests at its middle (off the map, water, too
// high a step, a steep rise). The body is a circle; against a box its outline is the box grown by that radius with round corners
// (so a body slides round a corner instead of catching on it). A kind in WALK walks as a share of its p.r (phase 5: a tree's trunk, .6
// of the round footprint the other systems still use). ROWS: the round pieces of a longer solid (JOINED kinds: a field
// wall's stones, the watchtower's rings, the bridge's parapets, a lying stone's parts) are joined to their row neighbours (the
// same kind, bases within .5 m, no further apart than LINK x their radii) by the half of the capsule between them: the row is one
// smooth solid with no notches to catch in; its gaps (a doorway, the breach) stay open, and so does a neighbour the body passes
// (rubble it steps over).
// A BODY says what stops it: who = {r (its radius), counts(p, z) (a prop stops it, its feet at height z: the cheap test, before the
// shape), through(p, z)? (a prop it overlaps but passes anyway: rubble it steps over), ground(x, y, z, air) (the ground at (x, y) is
// solid to it), floor(x, y)? (the ground's height: nearestFree's drop)}. Bodies are made once (no closures a call).
// OWNS: nothing of the world (reads the props' x / y / z / r / rect, the registry's near(), the world's tops). No allocation a call.
// BUDGET: overlap() is one near() query + the ground's rule (~1-2 us).
//   const C = createCollide(() => ents)
//   C.overlap(who, x, y, z, air) -> bool: the body at (x, y), feet at z, is inside something
//   C.touch(p, x, y, r, who?, z?) -> bool: the body (radius r) overlaps prop p (who / z: which row neighbours count); C.CN = {nx, ny,
//     d}: the way out of it and how deep
//   C.move(who, x, y, z, dx, dy, air, slip, free) -> {x, y, hit, nx, ny} (one object, reused): MOVE AND SLIDE (phase 3, below)
//   C.nearestFree(who, x, y, z, max, hx?, hy?, drop?) -> bool (C.FREE = [x, y]): the nearest spot round (x, y) where the body stands
//     free on its feet at height z (rings RING m apart, DIRS ways, out to max m; of a ring's free spots the one most along (hx, hy),
//     none given: the first; EDGE m past the rim; its ground no more than drop m under z). The player's unstick and placements use it
//   C.column(p, z0, z1) -> bool: a body from z0 (its feet) to z1 (its head) is within prop p's height (its base to heightOf; a top
//     within TOP_EPS under the feet doesn't count: he stands level with it). Phase 4: a body counts props by this, not a band round
//     its feet, so a falling body meets a tall wall's face all the way down and passes over what's under its feet
//   heightOf(p) -> m: how high a prop stands over its base (one table for every system: docs/COLLISION.md phase 6)
//   walkR(p) -> m: a round prop's radius to a body (its r, a tree's trunk: WALK)
import {topOfProp} from './world.js';

// how high each kind stands over its base (m) where the world builds it no top of its own (world.js topOfProp: walls, towers, posts,
// the watchtower's ring, the field walls); merged from the lasso's, the gadgets', combat's and the gunmen's tables
export const HEIGHT = {crate: .8, barrel: .9, barrel_x: .9, pot: .5, crystal: 1.2, dummy: 1.4, chest: .6, pillar: 2.6, pillar_broken: 1.4,
  rock: .5, rock_big: 1.1, rubble: .6, brazier: 1.1, torch: 1.7, well: .9, bench: .5, stall: 2, campfire: .15, woodpile: .4, beacon: 1.5,
  gadget_cache: .7, scarecrow: 1.5, ruin: 2, merchant: 1.6, goods: .7, tree: 6, lasso_snag: 4.3, brute: 1.5, gunman: 1.8,
  bush: 0, tuft: 0, fern: 0, reed: 0, gadget: 0};
export const heightOf = p => topOfProp(p) ?? HEIGHT[p.kind] ?? 1.2;
// MOVE AND SLIDE (phase 3). The way is cut into pieces of at most SUB m (nothing tunnels: the smallest solid, a pot, stands .47 m
// round its middle to a body), each gone straight and pushed out of whatever it then overlaps (each in turn, up to PASSES rounds: a
// corner, two round things side by side; a field wall's row of round stones pushes out square to the row, not into its notches). The push keeps the part of the move along the surface: a slide, at any angle and
// whatever the camera's yaw. Kept out by the ground (or wedged, or pushed further than the piece's length): the piece's part along
// the edge (the ground's way out: away from the solid tests of a ring G_R m round the spot), then one world axis at a time, the
// larger first. SLIP: a lone round thing (r <= ROUND: a pot, a post, a pillar, a tree; not a piece of a longer solid: JOINED kinds, a
// crate wall; not a thing he leans on to push, tip or kick: PUSHED, features/combat/props.js MOVABLE) met nearly
// head on (the slide kept under half the piece) is gone round at SLIP x the piece, on its open side (a body tested at each flank,
// beside it across the way: a gatepost at a wall's end is gone round on the gate's side); both open: the side the body is already off
// its middle (dead on: the piece's right); neither: no slip. A body that starts inside something moves only as far as a push out takes it within the piece's
// length (+ LIM m); deeper, it stays (the player's unstick walks him out: sim/player/adapter.js). free (phase 4: a body in the air,
// which came down into something low from above, or was put in it): it's pushed out of what it overlaps first, however deep
const EPS = 1e-4, SUB = .1, PASSES = 4, LIM = .02, G_R = .12, ROUND = .5, SLIP = .8, TOP_EPS = .05;
const JOINED = new Set(['fieldwall', 'towerwall', 'parapet', 'menhir_part', 'rootplate', 'windlog']), LINK = 1.25, PUSHED = new Set(['crate', 'barrel', 'barrel_x']);
const WALK = {tree: .6};
const radOf = p => p.r * (WALK[p.kind] ?? 1);   // (a round prop's radius to a body)
export const walkR = radOf;   // (the Shift+G overlay draws what a body walks against)
const DIR8 = Array.from({length: 8}, (_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
const RING = .05, DIRS = 16, EDGE = .02, DIR16 = Array.from({length: DIRS}, (_, i) => [Math.sin(i * 2 * Math.PI / DIRS), Math.cos(i * 2 * Math.PI / DIRS)]);

export function createCollide(entsOf) {
  const near = [], nearL = [];
  const CN = {nx: 0, ny: 0, d: 0};   // the last touch(): the way out (unit) and the depth
  // a row piece's neighbours (ROWS above): found once, at its first touch (the rows never move; one gone or broken is skipped)
  const links = new WeakMap();
  function linksOf(p) {
    let L = links.get(p); if (L) return L;
    L = [];
    for (const q of entsOf().near(p.x, p.y, 2 * p.r * LINK, nearL)) {
      if (q !== p && q.kind === p.kind && !q.rect && q.r > 0 && Math.abs((q.z || 0) - (p.z || 0)) < .5 && Math.hypot(q.x - p.x, q.y - p.y) <= (p.r + q.r) * LINK) L.push(q);
    }
    links.set(p, L); return L;
  }
  // the body (radius r) at (x, y) against prop p -> true when they overlap (CN: the way out of it, how deep)
  function touch(p, x, y, r, who = null, z = 0) {
    const q = p.rect;
    if (q) {
      const cx = x < q[0] ? q[0] : x > q[2] ? q[2] : x, cy = y < q[1] ? q[1] : y > q[3] ? q[3] : y, dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      if (d2 > 0) { if (d2 >= r * r) return false; const d = Math.sqrt(d2); CN.nx = dx / d; CN.ny = dy / d; CN.d = r - d; return true; }
      const l = x - q[0], e = q[2] - x, t = y - q[1], b = q[3] - y, m = Math.min(l, e, t, b);   // (inside the box: out through its nearest face)
      CN.nx = m === l ? -1 : m === e ? 1 : 0; CN.ny = m === l || m === e ? 0 : m === t ? -1 : 1; CN.d = m + r; return true;
    }
    if (!(p.r > 0)) return false;
    const R = radOf(p) + r;
    let ox = p.x, oy = p.y, dx = x - ox, dy = y - oy, d2 = dx * dx + dy * dy;
    if (JOINED.has(p.kind)) for (const q of linksOf(p)) {   // (a row: the half capsule toward each neighbour that still stands for this body)
      if (q.gone || q.broken || (who && (!who.counts(q, z) || who.through?.(q, z)))) continue;
      const mx = (q.x - p.x) / 2, my = (q.y - p.y) / 2, t0 = ((x - p.x) * mx + (y - p.y) * my) / (mx * mx + my * my), t = t0 < 0 ? 0 : t0 > 1 ? 1 : t0;
      const sx = p.x + mx * t, sy = p.y + my * t, ex = x - sx, ey = y - sy, e2 = ex * ex + ey * ey;
      if (e2 < d2) { d2 = e2; ox = sx; oy = sy; dx = ex; dy = ey; }
    }
    if (d2 >= R * R) return false;
    const d = Math.sqrt(d2);
    if (d > 1e-9) { CN.nx = dx / d; CN.ny = dy / d; } else { CN.nx = 0; CN.ny = 1; }
    CN.d = R - d; return true;
  }
  function overlap(who, x, y, z, air) {
    if (who.ground(x, y, z, air)) return true;
    for (const p of entsOf().near(x, y, who.r, near)) if (who.counts(p, z) && touch(p, x, y, who.r, who, z) && !who.through?.(p, z)) return true;
    return false;
  }
  // ---- move and slide (MOVE AND SLIDE above)
  // the body at (x, y) pushed out of the props it overlaps -> RS: where it ends (x, y), free of them (ok), the sum of the ways it was
  // pushed (nx, ny), the last lone round thing that pushed it (sm) and that push's way (snx, sny)
  const RS = {x: 0, y: 0, ok: false, nx: 0, ny: 0, sm: null, snx: 0, sny: 0};
  function resolve(who, x, y, z) {
    RS.nx = RS.ny = 0; RS.sm = null;
    for (let k = 0; k <= PASSES; k++) {
      let any = false;
      for (const p of entsOf().near(x, y, who.r + .1, near)) {
        if (!who.counts(p, z) || !touch(p, x, y, who.r, who, z) || who.through?.(p, z)) continue;
        if (k === PASSES) { RS.x = x; RS.y = y; RS.ok = false; return RS; }   // (still in something after every round: wedged)
        any = true; x += CN.nx * (CN.d + EPS); y += CN.ny * (CN.d + EPS); RS.nx += CN.nx; RS.ny += CN.ny;
        if (!p.rect && radOf(p) <= ROUND && !p.wall && !JOINED.has(p.kind) && !PUSHED.has(p.kind)) { RS.sm = p; RS.snx = CN.nx; RS.sny = CN.ny; }
      }
      if (!any) break;
    }
    RS.x = x; RS.y = y; RS.ok = true; return RS;
  }
  // the ground's way out at (x, y): away from the solid tests of a ring round it (none solid: back along the piece) -> GN (unit)
  const GN = [0, 0];
  function groundOut(who, x, y, z, air, px, py) {
    let sx = 0, sy = 0;
    for (const d of DIR8) if (who.ground(x + d[0] * G_R, y + d[1] * G_R, z, air)) { sx -= d[0]; sy -= d[1]; }
    let l = Math.hypot(sx, sy); if (l < 1e-9) { sx = -px; sy = -py; l = Math.hypot(sx, sy) || 1; }
    GN[0] = sx / l; GN[1] = sy / l; return GN;
  }
  const MV = {x: 0, y: 0, hit: false, nx: 0, ny: 0};
  let cx = 0, cy = 0, hx = 0, hy = 0;   // (the body as it goes; the sum of the ways it was stopped)
  const hit = (nx, ny) => { hx += nx; hy += ny; MV.hit = true; };
  // the body to (tx, ty), pushed out of props, the ground free there, no further than lim from where it is -> true: it's there
  function tryTo(who, z, air, tx, ty, lim) {
    const r = resolve(who, tx, ty, z);
    if (!r.ok || who.ground(r.x, r.y, z, air)) return false;
    const ex = r.x - cx, ey = r.y - cy; if (ex * ex + ey * ey > lim * lim) return false;
    if (r.nx || r.ny) hit(r.nx, r.ny);
    cx = r.x; cy = r.y; return true;
  }
  // one piece (px, py) of length l -> false: it stopped
  function piece(who, z, air, px, py, l, lim, slip) {
    const r = resolve(who, cx + px, cy + py, z);
    if (r.ok && !who.ground(r.x, r.y, z, air)) {
      const ex = r.x - cx, ey = r.y - cy, e2 = ex * ex + ey * ey;
      if (e2 <= lim * lim) {
        if (slip && r.sm && e2 < l * l * .25) {   // SLIP round a lone small thing met nearly head on
          const q = r.sm, snx = r.snx, sny = r.sny; let tx = -sny, ty = snx, a = tx * px + ty * py;
          if (Math.abs(a) < 1e-9 * l) a = tx * -py + ty * px;   // (dead on: to the piece's right)
          if (a < 0) { tx = -tx; ty = -ty; }
          const f = radOf(q) + who.r + .05, open = s => !overlap(who, q.x + tx * s * f, q.y + ty * s * f, z, air);   // (its flank on side s)
          const side = open(1) ? 1 : open(-1) ? -1 : 0;
          if (side && tryTo(who, z, air, cx + tx * side * l * SLIP, cy + ty * side * l * SLIP, lim)) { hit(snx, sny); return true; }
          resolve(who, cx + px, cy + py, z);   // (RS back to the straight piece's)
        }
        if (RS.nx || RS.ny) hit(RS.nx, RS.ny);
        cx = RS.x; cy = RS.y; return true;
      }
    }
    // kept out by the ground, wedged, or pushed too far: the piece's part along the edge, then one world axis at a time
    let gx, gy;
    if (r.ok) { const g = groundOut(who, cx + px, cy + py, z, air, px, py); gx = g[0]; gy = g[1]; }
    else { const l2 = Math.hypot(r.nx, r.ny) || 1; gx = r.nx / l2; gy = r.ny / l2; }
    const vn = px * gx + py * gy;
    if (vn < 0) { const qx = px - gx * vn, qy = py - gy * vn; if (qx * qx + qy * qy > 1e-12 && tryTo(who, z, air, cx + qx, cy + qy, lim)) { hit(gx, gy); return true; } }
    const ax = Math.abs(px) >= Math.abs(py);
    if (tryTo(who, z, air, cx + (ax ? px : 0), cy + (ax ? 0 : py), lim) || tryTo(who, z, air, cx + (ax ? 0 : px), cy + (ax ? py : 0), lim)) { hit(gx, gy); return true; }
    hit(gx, gy); return false;
  }
  function move(who, x, y, z, dx, dy, air, slip, free = false) {
    cx = x; cy = y; hx = hy = 0; MV.hit = false;
    if (free) { const r = resolve(who, x, y, z); if (r.ok && (r.x !== x || r.y !== y) && !who.ground(r.x, r.y, z, air)) { hit(r.nx, r.ny); cx = r.x; cy = r.y; } }
    const L = Math.hypot(dx, dy);
    if (L > 1e-12) {
      const n = Math.ceil(L / SUB), px = dx / n, py = dy / n, l = L / n;
      for (let k = 0; k < n; k++) if (!piece(who, z, air, px, py, l, l + LIM, slip)) break;
    }
    const h = Math.hypot(hx, hy);
    MV.x = cx; MV.y = cy; MV.nx = h > 1e-9 ? hx / h : 0; MV.ny = h > 1e-9 ? hy / h : 0;
    return MV;
  }
  const column = (p, z0, z1) => { const b = p.z || 0; return z0 < b + heightOf(p) - TOP_EPS && z1 > b; };
  const FREE = [0, 0];
  function nearestFree(who, x, y, z, max, hx = NaN, hy = NaN, drop = Infinity) {   // (hx NaN: every score NaN, the first free one)
    for (let r = RING; r <= max + 1e-9; r += RING) {
      let best = -1, bs = 0;
      for (let i = 0; i < DIRS; i++) {
        const u = DIR16[i], qx = x + u[0] * r, qy = y + u[1] * r;
        if (overlap(who, qx, qy, z, false) || (who.floor && who.floor(qx, qy) < z - drop)) continue;
        const s = u[0] * hx + u[1] * hy; if (best < 0 || s > bs) { best = i; bs = s; }
      }
      if (best >= 0) { const u = DIR16[best], e = r + EDGE; FREE[0] = x + u[0] * e; FREE[1] = y + u[1] * e; return true; }
    }
    return false;
  }
  return {overlap, touch, CN, move, column, nearestFree, FREE};
}
