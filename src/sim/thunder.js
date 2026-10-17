// THUNDER (sim, shared rules; docs/WEATHER.md "Thunder and fire"): where natural lightning comes down and what burns after it.
// One rule file, two callers: features/thunder.js offline (the persistent forest, alone) and server/room.mjs online (it owns
// the strikes, the burning and the charred trees for everyone), the way sim/uncanny.js serves both. Pure: no DOM, no host.
//   rods     the things that draw a bolt, from the forest's plan (world/forest.js: its trees and outcrops), in a grid of
//            CELL m cells: aim(x, y, players, R, out) picks what takes a bolt aimed at (x, y) (content/thunder.js weights:
//            a tree by its height and how lone it stands, a tor's top, a player out on the fell, iron on him, the ground)
//   fires    which trees burn (fid -> {t1: s when it's out, at: s it caught}), stepped once a TUNE.fire.tick s by the caller:
//            rain burns them out faster, each may pass it to a neighbour on the same dry ground (never across water or
//            rock), at most TUNE.fire.max at once; out -> the caller's onOut(fid) (it's charred: till the next spring)
//   nextSpring(hours, seasonDays): the world hour the next spring starts (when a charred tree is whole again)
// OWNS: the rods grid, the burning set. READS: the plan (trees, outcrops, height, water tests), content/thunder.js.
// BUDGET: aim() looks at the 9 cells round a point (~20 trees); a fire tick is ~8 burning x ~6 neighbours.
//   const T = createThunder(plan); T.aim(x, y, players, R, out) -> out {kind, id, x, y, h} | null; T.tree(fid);
//   T.ignite(fid, now, R, wet) -> bool; T.tick(now, rain, wet, R, onCatch, onOut); T.burning (Map); T.charred (Set)
import {TUNE, STRIKE} from '../content/thunder.js';

const CELL = 8;
// m a tree of each species stands at scale 1 (world/trees3d.js grows them about this tall)
const TALL = {pine: 13, oak: 10, birch: 11, aspen: 10, rowan: 7, willow: 7, dead: 8};
export const treeHeight = (species, scale) => (TALL[species] ?? 9) * (scale || 1);
// the world hour the next spring starts (sim/wxclock.js seasonAt's year: 4 seasons of seasonDays in-game days, spring first)
export const nextSpring = (hours, seasonDays) => { const y = seasonDays * 24 * 4; return (Math.floor(hours / y) + 1) * y; };

// plan: the forest's (world/forest.js forestPlan: props, outcrops, height, inLake, at, fellK)
export function createThunder(plan) {
  const trees = new Map(), grid = new Map(), rocks = [], AT = {};
  const water = (x, y) => !!(plan.inLake?.(x, y) || plan.at?.(x, y, AT));   // (the lake, the stream, the outflow)
  const key = (i, j) => i * 4096 + j;
  for (const p of plan.props || []) {
    if (p[0] !== 'tree' || !p[3]?.fid) continue;
    const o = p[3], t = {id: o.fid, x: p[1], y: p[2], g: plan.height(p[1], p[2]), h: treeHeight(o.species, o.scale), species: o.species, lone: 1};
    trees.set(t.id, t);
    const k = key(Math.floor(t.x / CELL), Math.floor(t.y / CELL)); let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(t);
  }
  const near = [];
  function around(x, y, r, out) {   // the trees within r m (r <= CELL)
    out.length = 0; const i0 = Math.floor(x / CELL), j0 = Math.floor(y / CELL);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const c = grid.get(key(i, j)); if (!c) continue;
      for (const t of c) if (Math.hypot(t.x - x, t.y - y) < r) out.push(t);
    }
    return out;
  }
  for (const t of trees.values()) {   // how lone it stands: each close neighbour takes a third, down to a third
    let n = 0; for (const q of around(t.x, t.y, TUNE.lone, near)) if (q !== t) n++;
    t.lone = Math.max(1 / 3, 1 - n / 3);
  }
  for (const o of plan.outcrops || []) rocks.push({id: 'r' + rocks.length, x: o.x, y: o.y, h: plan.height(o.x, o.y), w: o.kind === 'tor' || o.kind === 'crag' ? 1 : .5});
  const W = TUNE.weight;

  // ---- AIM: what takes a bolt aimed at (x, y). players: [{id, x, y, z, iron, safe}] (safe: in the cave, the hut: never picked)
  function aim(x, y, players, R, out) {
    let tot = 0;
    const g0 = plan.height(x, y);
    // a weighted pick in one pass (reservoir): each candidate's weight by its kind, its height over the aim point's ground
    const take = (w, kind, id, px, py, h) => { if (!(w > 0)) return; tot += w; if (R() * tot < w) { out.kind = kind; out.id = id; out.x = px; out.y = py; out.h = h; } };
    out.kind = ''; out.id = '';
    take(W.ground, 'ground', '', x, y, g0);
    for (const t of around(x, y, TUNE.pick, near)) {
      if (burning.has(t.id) || charred.has(t.id)) continue;   // (a burning or charred tree: struck already)
      take(W.tree * Math.min(1.4, t.h / TUNE.tall) ** 2 * t.lone, 'tree', t.id, t.x, t.y, t.g + t.h);
    }
    for (const r of rocks) if (Math.hypot(r.x - x, r.y - y) < TUNE.pick) take(W.tor * r.w, 'tor', r.id, r.x, r.y, r.h + .5);
    for (const p of players) {
      if (p.safe || Math.hypot(p.x - x, p.y - y) >= TUNE.pick) continue;
      const high = (plan.fellK?.(p.x, p.y) ?? 0) > .35;
      take((high ? W.player : W.playerLow) * (p.iron ? W.iron : 1), 'player', p.id, p.x, p.y, p.z + 1.8);
    }
    return out.kind ? out : null;
  }

  // ---- FIRES
  const burning = new Map(), charred = new Set(), F = TUNE.fire;
  const sameGround = (a, b) => {   // never across water or rock: no water between them, no step of ground (a rock face) between
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    return !water(mx, my) && Math.abs(a.g - b.g) < 1.6 && Math.abs(plan.height(mx, my) - (a.g + b.g) / 2) < 1.2;
  };
  // a tree catches (a strike, a brand, a neighbour): false when it can't (gone, burning, charred, the cap)
  function ignite(fid, now, R) {
    const t = trees.get(fid); if (!t || burning.has(fid) || charred.has(fid) || burning.size >= F.max) return false;
    burning.set(fid, {t1: now + F.burn[0] + R() * (F.burn[1] - F.burn[0]), at: now, last: now});
    return true;
  }
  // one tick (TUNE.fire.tick s): rain (0..1 over the fires) and wet (the ground: 0..1) as the caller knows them
  function tick(now, rain, wet, R, onCatch, onOut) {
    for (const [fid, b] of burning) {
      const dt = now - b.last; b.last = now;
      if (rain >= F.rain) b.t1 -= dt * (F.burnOut - 1);   // (the rain burns it out faster)
      if (now >= b.t1) { burning.delete(fid); charred.add(fid); onOut(fid); continue; }
      // the spread: over its life about `catch` to each neighbour (a chance a tick)
      const life = (F.burn[0] + F.burn[1]) / 2, c = rain >= F.rain || wet > .2 ? F.wet : F.dry, p = 1 - (1 - c) ** (dt / life);
      const t = trees.get(fid);
      for (const q of around(t.x, t.y, F.spread, near)) {
        if (q === t || burning.has(q.id) || charred.has(q.id) || burning.size >= F.max) continue;
        if (R() < p && sameGround(t, q) && ignite(q.id, now, R)) onCatch(q.id, fid);
      }
    }
  }
  return {
    aim, ignite, tick, burning, charred, trees, around: (x, y, r, out = []) => around(x, y, Math.min(r, CELL), out),
    tree: fid => trees.get(fid) || null,
    STRIKE,
  };
}
