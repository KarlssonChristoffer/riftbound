// KEEPSAKES (the rules both sides run; docs/KEEPSAKES.md): the Bark Doll's secrets and its dawn walk. Pure: no DOM, no game
// state; the co-op server (server/room.mjs: the shelves, the walks) and the game offline (features/keepsakes.js) run the same.
//   underground(C, x, y)            in the cave's band (world/caves.js C.band) -> bool
//   dollTargets(o, x, y, out)       the secrets the doll knows of, as seen from (x, y) -> out [{x, y, id}] (its records reused):
//                                   o = {U (world/uncanny.js plan, or null), C (the cave's plan, or null), spring ({x, y} or null),
//                                   spent(id) -> bool (an uncanny secret spent now), opened(i) -> bool (hollow wall i open),
//                                   extra ({x, y} or null: the head's own extra, the old miner's pick when he has none)}.
//                                   A hollow wall seen from the surface is pointed at through the cave's mouth.
//   nearestOf(list, x, y)           the nearest of them -> {x, y, id} | null
//   openGround(F, C, x, y)          open ground for the doll to stand on: no lake, no stream, no trunk, not in the cave's band
//   dollWalk(o)                     a dawn's walk: o = {seed, day, key, x, y, to, ok, always} -> {x, y} | null. Drawn from
//                                   mix(seed, day, key) (everyone gets the same): DOLL.walk of the dawns, DOLL.dist m toward `to`
//                                   (stopping 2 m short), the farthest of a few points on the way that ok(x, y) takes.
// OWNS: nothing (pure).
import {DOLL} from '../content/keepsakes.js';
import {hash3} from '../core/mathx.js';

export const underground = (C, x, y) => !!C?.band && x >= C.band.x0 && x <= C.band.x1 && y >= C.band.y0 && y <= C.band.y1;

const POOL = [];
const rec = (i, x, y, id) => { const r = POOL[i] ??= {x: 0, y: 0, id: ''}; r.x = x; r.y = y; r.id = id; return r; };
export function dollTargets(o, x, y, out) {
  out.length = 0; let n = 0;
  const U = o.U, add = (p, id) => { if (p) out.push(rec(n++, p.x, p.y, id)); };
  if (U) {
    if (!o.spent?.('heron')) add(U.heron, 'heron');
    if (!o.spent?.('stones')) add(U.stones, 'stones');
    if (!o.spent?.('marks')) add(U.hollow, 'marks');
    if (o.spring && !o.spent?.('spring')) add(o.spring, 'spring');
  }
  const C = o.C, down = underground(C, x, y);
  if (C?.hollows) for (let i = 0; i < C.hollows.length; i++) {
    if (o.opened?.(i)) continue;
    if (down) add(C.hollows[i], 'hollow');
    else { add(C.mouth, 'hollow'); break; }   // (from the surface: the way in)
  }
  if (o.extra) add(o.extra, 'pick');
  return out;
}
export function nearestOf(list, x, y) {
  let best = null, bd = 1e18;
  for (const p of list) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
  return best;
}
const AT = {d: 0, hw: 0};
export function openGround(F, C, x, y) {
  if (underground(C, x, y)) return false;
  if (!F) return true;
  if (F.inLake?.(x, y, .6)) return false;
  if (F.at) { F.at(x, y, AT); if (AT.d < AT.hw + .6) return false; }
  if (F.spring && Math.hypot(x - F.spring.x, y - F.spring.y) < F.spring.r + .6) return false;
  if (C?.mouth && Math.hypot(x - C.mouth.x, y - C.mouth.y) < C.mouth.len + 2) return false;   // (not down the cave's slot)
  if (F.trees) for (const t of F.trees.values()) if (Math.abs(t[0] - x) < .8 && Math.abs(t[1] - y) < .8) return false;
  return true;
}
export function dollWalk(o) {
  if (!o.to || (!o.always && hash3(o.seed | 0, o.day | 0, o.key | 0) >= DOLL.walk)) return null;
  const dx = o.to.x - o.x, dy = o.to.y - o.y, d = Math.hypot(dx, dy); if (d < 3) return null;
  const want = DOLL.dist[0] + (DOLL.dist[1] - DOLL.dist[0]) * hash3(o.key | 0, o.day | 0, (o.seed ^ 77) | 0), go = Math.min(want, d - 2);
  for (let k = 0; k < 8; k++) {
    const s = go * (1 - k * .11), x = o.x + dx / d * s, y = o.y + dy / d * s;
    if (s >= 1 && o.ok(x, y)) return {x: +x.toFixed(2), y: +y.toFixed(2)};
  }
  return null;
}
