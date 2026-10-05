// ANOMALY / PLACE: where the rift anomaly stands in the sandbox, found at RUNTIME (the map is being reworked: nothing here
// knows a coordinate of it). A seeded grid of candidates over the Proving Grounds (the same candidates every load), each
// tested against the world as it is built, the best one kept:
//   ground    walkable (layout.js), not steep anywhere within flatR, elev within flatTol over that disc (flat open ground)
//   water     no stream / pool / rill / outflow within wetR (host.inStream + the layout's tests)
//   room      no prop with a collider (a wall, a pillar, the stall, a crate, a frontier piece) within solidR, no prop at all
//             (a tuft, a bush, a torch) within softR: host.entities.near, the exact test here; hidden ones don't count
//   out of    not on the spawn (spawnR), the movement ring, the paths, the range lane and the rail, the light garden's pad, the
//   the way   walks from gate to gate across the arena (gateAxis), the trick-shot range (features/trickshot: its anchor and
//             its shooting mark), the grounds' edges
//   score     (lower is better) how far from `want` m off the spawn, + a penalty off the spawn's screen at yaw 0 (`view`),
//             - the room round it (the nearest collider, up to 4 m), + a small seeded tie-break
// Deterministic: the grid's jitter and the tie-break come from a fixed seed, and the test reads only the built world, so a
// biome gives the same spot every load (the desert's frontier pieces move it there). A spot is null when nothing fits.
// OWNS: nothing (a pure function). READS: host.layout (spawn, marks), host.ctxO.grounds, host.elev, host.inStream,
//   host.entities.near, the trick-shot range's anchor (its F.TUNE.at), world.js's walkable / steep / inRill / inPool / inOutflow.
// BUDGET: once per biome (the first view after a build): ~2-8 ms on the dev machine; nothing per frame.
import {walkable, steep, inRill, inPool, inOutflow, PLAY} from '../../world/world.js';
import {mulberry32} from '../../core/rng.js';
import {hypot2} from '../../core/mathx.js';

export const PLACE = {
  seed: 0x52494654,          // the grid's jitter and the tie-break
  step: .5, jitter: .2,      // m between candidates, m each way they wander off the grid
  edge: 3,                   // m from the grounds' edges
  flatR: 1.4, flatTol: .1,   // m: flat within this radius (elev within tol m), nothing steep
  wetR: 2.6,                 // m: no water this near
  solidR: 2.3, softR: 1.0,   // m: no collider / no prop at all this near
  spawnR: 6.5, ringPad: 2, pathPad: 2.2, linePad: 2.5, markPad: 2.5, padPad: 1.2,
  trick: {at: {x: 10.3, y: 6.9}, mark: 4.5, r: 7.5, markR: 5},   // (features/trickshot: TUNE.at, SHAPE.mark.y) when its F.TUNE is absent
  gateAxis: 2.2,             // m either side of the arena's gate-to-gate lines
  want: 8.5,                 // m off the spawn it likes best
  view: {w: 9, n: 3.8, s: 5.5, k: 6},   // on the spawn's screen at yaw 0: m across, north, south of it; the penalty off it
  room: .6,                  // score per m of room round it (up to 4 m)
  tie: .3,                   // the seeded tie-break's weight
};
const SOLID_KINDS = {tree: .6, rock_big: .7};   // big things without a collider (the grounds' unreachable surroundings)
const RING = 8, NEAR = [];
const segD = (x, y, ax, ay, bx, by) => {   // distance from (x, y) to the segment a-b
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return hypot2(x - ax - t * dx, y - ay - t * dy);
};

// -> {x, y, g (the ground's height there), score, clear (m to the nearest collider)} | null
export function findSpot(host, o = PLACE) {
  const L = host.layout || {}, Gr = host.ctxO?.grounds || {x0: 0, y0: 0, x1: 62, y1: 30};
  const sp = L.spawn || {x: (PLAY.x0 + PLAY.x1) / 2, y: (PLAY.y0 + PLAY.y1) / 2}, marks = L.marks || [];
  const tr = host.feature?.('trickshot')?.TUNE?.at || o.trick.at, tmY = tr.y + o.trick.mark;
  const gx = (PLAY.x0 + PLAY.x1) / 2, gy = (PLAY.y0 + PLAY.y1) / 2;
  const elev = host.elev, wet = (x, y) => host.inStream(x, y) || inRill(x, y) || inPool(x, y) || inOutflow(x, y);
  const R = mulberry32(o.seed);
  let best = null;
  for (let cy = Gr.y0 + o.edge; cy <= Gr.y1 - o.edge + 1e-6; cy += o.step) for (let cx = Gr.x0 + o.edge; cx <= Gr.x1 - o.edge + 1e-6; cx += o.step) {
    // (three draws per cell, before any test: the candidates and their tie-breaks are the same whatever is rejected)
    const x = cx + (R() * 2 - 1) * o.jitter, y = cy + (R() * 2 - 1) * o.jitter, tie = R();
    if (!walkable(x, y)) continue;
    const ds = hypot2(x - sp.x, y - sp.y); if (ds < o.spawnR) continue;
    if (hypot2(x - tr.x, y - tr.y) < o.trick.r || hypot2(x - tr.x, y - tmY) < o.trick.markR) continue;
    if (x > PLAY.x0 - 3 && x < PLAY.x1 + 3 && y > PLAY.y0 - 3 && y < PLAY.y1 + 3 && (Math.abs(x - gx) < o.gateAxis || Math.abs(y - gy) < o.gateAxis)) continue;
    let ok = true;
    for (const m of marks) {
      if (m.type === 'ring') ok = hypot2(x - m.x, y - m.y) > m.r + o.ringPad;
      else if (m.type === 'pad') ok = hypot2(x - m.x, y - m.y) > m.r + o.padPad;
      else if (m.type === 'mark') ok = hypot2(x - m.x, y - m.y) > o.markPad;
      else if (m.type === 'lane' || m.type === 'rail') ok = segD(x, y, m.x0, m.y, m.x1, m.y) > o.linePad;
      else if (m.type === 'path' && m.pts) for (let i = 1; ok && i < m.pts.length; i++) ok = segD(x, y, m.pts[i - 1][0], m.pts[i - 1][1], m.pts[i][0], m.pts[i][1]) > (m.w || 1.5) / 2 + o.pathPad;
      if (!ok) break;
    }
    if (!ok) continue;
    // the ground: flat and walkable over the disc, no water near
    const g = elev(x, y);
    if (steep(x, y) || wet(x, y)) continue;
    for (let k = 0; ok && k < RING; k++) {
      const a = k / RING * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const fx = x + c * o.flatR, fy = y + s * o.flatR;
      ok = !steep(fx, fy) && Math.abs(elev(fx, fy) - g) <= o.flatTol && !steep(x + c * o.flatR * .5, y + s * o.flatR * .5)
        && !wet(x + c * o.wetR * .5, y + s * o.wetR * .5) && !wet(x + c * o.wetR, y + s * o.wetR);
    }
    if (!ok) continue;
    // room: no collider within solidR, nothing at all within softR; the nearest collider (up to 4 m) is its room
    let clear = 4;
    for (const p of host.entities.near(x, y, 4.5, NEAR)) {
      if (p.gone) continue;
      const dc = hypot2(p.x - x, p.y - y);
      if (dc < o.softR) { ok = false; break; }
      let d = Infinity;
      if (p.rect) { const r = p.rect, ex = Math.max(r[0] - x, 0, x - r[2]), ey = Math.max(r[1] - y, 0, y - r[3]); d = hypot2(ex, ey); }
      else if (p.r > 0) d = dc - p.r;
      else if (SOLID_KINDS[p.kind]) d = dc - SOLID_KINDS[p.kind];
      if (d < o.solidR) { ok = false; break; }
      if (d < clear) clear = d;
    }
    if (!ok) continue;
    const dx = x - sp.x, dy = y - sp.y, off = Math.abs(dx) > o.view.w || dy < -o.view.n || dy > o.view.s;
    const score = Math.abs(ds - o.want) + (off ? o.view.k : 0) - o.room * clear + o.tie * tie;
    if (!best || score < best.score) best = {x, y, g, score, clear};
  }
  return best;
}
