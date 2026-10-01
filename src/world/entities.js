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
//   ents.query(name, pred, join?) -> a live array: the members for which pred(p) held when they joined (or at refresh());
//     join(p) runs for each member as it joins the query (the ones already there first, in order): the querying system
//     sets up its own state for it. Names are the owner's: 'combat.hittable', 'props.movable'
//   ents.near(x, y, r, out, q?) -> out: entities whose extent may reach the circle (x, y, r) (q: only that query's
//     members), in list order. Candidates: do the exact test
//   ents.sync() (the loop, each step) / ents.refresh(name?) (re-run a query's predicate over the list)
import {createGrid} from './spatial.js';

export function createEntities(list, {x0, y0, x1, y1, cell = 2}) {
  const grid = createGrid({x0, y0, x1, y1, cell});
  const recs = new Map();   // entity -> {p, id, mask, stamp, grid cells}
  const queries = [];       // {name, pred, join, list, bit}
  let nextId = 1, ver = 0;
  const recOf = p => recs.get(p);
  function join(p) {
    const rec = {p, id: nextId++, mask: 0, stamp: 0, c0: 0, c1: 0, r0: 0, r1: 0, bx0: 0, by0: 0, bx1: 0, by1: 0};
    recs.set(p, rec); grid.insert(rec);
    for (const q of queries) if (q.pred(p)) { rec.mask |= q.bit; q.list.push(p); q.join?.(p); }
  }
  for (const p of list) join(p);
  function add(p) {
    if (recs.has(p)) return p;
    list.push(p); join(p); ver++;
    return p;
  }
  function remove(p) {
    const rec = recs.get(p); if (!rec) return false;
    const i = list.indexOf(p); if (i >= 0) list.splice(i, 1);
    for (const q of queries) if (rec.mask & q.bit) { const k = q.list.indexOf(p); if (k >= 0) q.list.splice(k, 1); }
    grid.remove(rec); recs.delete(p); ver++;
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
    for (let i = 0; i < scratch.length; i++) if (!bit || scratch[i].mask & bit) out.push(scratch[i].p);
    return out;
  }
  function sync() {
    for (const rec of recs.values()) if (!grid.fits(rec)) { grid.remove(rec); grid.insert(rec); }
  }
  return {list, add, remove, has: p => recs.has(p), query, refresh, near, sync, get ver() { return ver; }, get size() { return recs.size; }, grid, _rec: recOf};
}
