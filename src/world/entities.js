// ENTITIES: the registry of what's in the world that systems act on (props, enemies, chests, the run's portal, ...).
// Who is in the world, the live lists systems query by kind, and "what's near here" (the grid, world/spatial.js).
// An entity joins with add(p) and leaves with remove(p); every query and the grid follow at once, so something that
// joins later (a spawned brute, the portal, a re-lit sconce) is seen by every system, whatever their creation order.
// ORDER: the list keeps insertion order and every query / near() answer is in that order, so iterating one visits
// entities in the order a scan of the whole list did (results don't depend on the grid's cells).
// OWNS: membership (the list: world.props is this array, kept across biome rebuilds), each entity's registry record
//   (id, grid cells, query membership: kept here, not on the entity), the queries' lists.  The entities' fields belong
//   to the systems that use them (docs/ARCHITECTURE.md, the ownership table).
// BUDGET: sync() once per sim step: a position check per entity, re-bucketing only what left its padded box.
//   const ents = createEntities(list, bounds)
//   ents.list / ver (bumps on every join / leave) / add(p) / remove(p) / has(p)
//   ents.hide(p, on = true): out of the world for now (p.gone: not drawn, hit or collided with; kept for a reset: a
//     broken-away crate, a retired yard brute, cleared scatter) or back. The one writer of p.gone
//   ents.query(name, pred, join?) -> a live array: the members for which pred(p) held when they joined (or at refresh());
//     join(p) runs for each member as it joins the query (the ones already there first, in order): the querying system
//     sets up its own state for it. Names are the owner's: 'combat.hittable', 'props.movable'
//   ents.near(x, y, r, out, q?) -> out (cleared first): entities whose extent may reach the circle (x, y, r) (q: only
//     that query's members), in list order. Candidates: do the exact test. Each caller keeps its own `out` array
//   ents.sync() (the loop, each step) / ents.moved(p) (a jump further than spatial.js PAD within a step: respawns,
//     resets, teleports) / ents.refresh(name?) (re-run a query's predicate over the list)
//   ents.lerpBegin(alpha) / lerpEnd(): DRAWING BETWEEN SIM STEPS (core/loop.js, the fixed step): sync() notes where each
//     entity was when the step began (x, y, z, h); lerpBegin puts the ones that moved alpha of the way from there to
//     where they are now, for the draw; lerpEnd puts them back. moved(p) skips that for a jump (nothing slides across).
//     Who moved is worked out once per step, by its first draw (positions change only in sim steps): the draws between
//     two steps lerp that list (reading four numbers off every entity a frame was ~8 KB of boxed numbers a frame)
import {createGrid} from './spatial.js';

export function createEntities(list, {x0, y0, x1, y1, cell = 2}) {
  const grid = createGrid({x0, y0, x1, y1, cell});
  const recs = new Map();   // entity -> {p, id, mask, stamp, grid cells}
  const queries = [];       // {name, pred, join, list, bit}
  let nextId = 1, ver = 0;
  const recOf = p => recs.get(p);
  function join(p) {
    const rec = {p, id: nextId++, mask: 0, stamp: 0, c0: 0, c1: 0, r0: 0, r1: 0, bx0: 0, by0: 0, bx1: 0, by1: 0,
      lx: p.x, ly: p.y, lz: p.z, lh: p.h, cx: 0, cy: 0, cz: 0, ch: 0};   // l*: at the step's start; c*: the true values while drawn
    recs.set(p, rec); grid.insert(rec);
    for (const q of queries) if (q.pred(p)) { rec.mask |= q.bit; q.list.push(p); q.join?.(p); }
  }
  for (const p of list) join(p);
  function add(p) {
    if (recs.has(p)) return p;
    list.push(p); join(p); ver++; dropMovers();
    return p;
  }
  function remove(p) {
    const rec = recs.get(p); if (!rec) return false;
    const i = list.indexOf(p); if (i >= 0) list.splice(i, 1);
    for (const q of queries) if (rec.mask & q.bit) { const k = q.list.indexOf(p); if (k >= 0) q.list.splice(k, 1); }
    grid.remove(rec); recs.delete(p); ver++; dropMovers();
    return true;
  }
  function query(name, pred, join = null) {
    if (queries.some(q => q.name === name)) throw new Error(`entities: query '${name}' exists (one owner per query)`);
    if (queries.length >= 30) throw new Error('entities: too many queries');
    const q = {name, pred, join, list: [], bit: 1 << queries.length};
    queries.push(q);
    for (const p of list) if (pred(p)) { recs.get(p).mask |= q.bit; q.list.push(p); }
    if (join) for (const p of q.list) join(p);
    return q.list;
  }
  function refresh(name) {
    for (const q of queries) {
      if (name && q.name !== name) continue;
      q.list.length = 0;
      for (const p of list) { const rec = recs.get(p); if (q.pred(p)) { rec.mask |= q.bit; q.list.push(p); } else rec.mask &= ~q.bit; }
    }
  }
  const scratch = [];
  function near(x, y, r, out, ql) {
    const bit = ql ? queries.find(q => q.list === ql)?.bit || 0 : 0;
    scratch.length = 0; grid.query(x - r, y - r, x + r, y + r, scratch);
    // list order = ids ascending (insertion sort: a handful of candidates)
    for (let i = 1; i < scratch.length; i++) { const a = scratch[i]; let j = i - 1; while (j >= 0 && scratch[j].id > a.id) { scratch[j + 1] = scratch[j]; j--; } scratch[j + 1] = a; }
    out.length = 0;
    for (let i = 0; i < scratch.length; i++) if (!bit || scratch[i].mask & bit) out.push(scratch[i].p);
    return out;
  }
  function hide(p, on = true) { p.gone = !!on; }
  const snap = rec => { const p = rec.p; rec.lx = p.x; rec.ly = p.y; rec.lz = p.z; rec.lh = p.h; };
  function moved(p) { const rec = recs.get(p); if (!rec) return; if (!grid.fits(rec)) { grid.remove(rec); grid.insert(rec); } snap(rec); dropMovers(); }
  let stepNo = 0;
  function sync() {
    stepNo++;
    for (const rec of recs.values()) { if (!grid.fits(rec)) { grid.remove(rec); grid.insert(rec); } snap(rec); }
  }
  // the records that moved in the last step (movStep: the step they are for; -1: work them out again) and the ones lerped
  // this draw (kept arrays, filled by index: no garbage a frame)
  const movers = [], lerped = [], mix = (a, b, k) => typeof a === 'number' && typeof b === 'number' ? a + (b - a) * k : b;
  let nMov = 0, movStep = -1, nLerp = 0;
  function dropMovers() { movStep = -1; movers.fill(null, 0, nMov); nMov = 0; }
  function lerpBegin(k) {
    if (k >= 1) return;
    if (movStep !== stepNo) {   // the first draw since the step: who moved in it
      movStep = stepNo; nMov = 0;
      for (const rec of recs.values()) { const p = rec.p; if (p.x !== rec.lx || p.y !== rec.ly || p.z !== rec.lz || p.h !== rec.lh) movers[nMov++] = rec; }
    }
    for (let i = 0; i < nMov; i++) {
      const rec = movers[i], p = rec.p, x = p.x, y = p.y, z = p.z, h = p.h;
      if (x === rec.lx && y === rec.ly && z === rec.lz && h === rec.lh) continue;
      rec.cx = x; rec.cy = y; rec.cz = z; rec.ch = h; lerped[nLerp++] = rec;
      if (x !== rec.lx) p.x = mix(rec.lx, x, k);
      if (y !== rec.ly) p.y = mix(rec.ly, y, k);
      if (z !== rec.lz) p.z = mix(rec.lz, z, k);
      if (h !== rec.lh) p.h = mix(rec.lh, h, k);
    }
  }
  function lerpEnd() {
    for (let i = 0; i < nLerp; i++) { const rec = lerped[i], p = rec.p; if (p.x !== rec.cx) p.x = rec.cx; if (p.y !== rec.cy) p.y = rec.cy; if (p.z !== rec.cz) p.z = rec.cz; if (p.h !== rec.ch) p.h = rec.ch; lerped[i] = null; }
    nLerp = 0;
  }
  return {list, add, remove, has: p => recs.has(p), hide, query, refresh, near, sync, moved, lerpBegin, lerpEnd, get ver() { return ver; }, get size() { return recs.size; }, grid, _rec: recOf};
}
