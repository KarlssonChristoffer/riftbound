// INVENTORY: what the player carries (docs/GATHERING.md): the POUCH (materials: id -> count, no limit, no slots) and the
// BAG (a few slots of {id, n}: tools, food, gear; `stack` of them share a slot). One owner (features/pack.js holds the
// player's); the same code serves a chest or a stockpile later.
//   const inv = createInventory(ITEMS, {slots})
//   inv.add(id, n) -> how many did NOT fit (0: all in) / inv.take(id, n) -> true (all taken) | false (not enough: none taken)
//   inv.count(id) / inv.has(id, n) / inv.best(job) -> the bag's best tool for a job ({id, def, slot}) | null
//   inv.payOf(need) -> {id: n}: a recipe's need ([{ids, n}]: n of ONE of ids) paid with the kind there is most of; inv.short(cost)
//   -> true when the pouch / bag can't pay it
//   inv.pouch (Map, read only) / inv.bag (the slots, read only: null | {id, n}) / inv.ver (bumps on every change: caches)
//   inv.toJSON() -> {pouch, bag} / inv.load(o) (a save: unknown ids are dropped)
// OWNS: the pouch, the bag. READS: the item table. No allocation per call but a new slot's record.
export function createInventory(ITEMS, {slots = 8} = {}) {
  const pouch = new Map(), bag = new Array(slots).fill(null);
  let ver = 0;
  const def = id => ITEMS[id] || null;
  const material = id => def(id)?.kind === 'material';

  function add(id, n = 1) {
    const d = def(id); if (!d || !(n > 0)) return n > 0 ? n : 0;
    if (material(id)) { pouch.set(id, (pouch.get(id) || 0) + n); ver++; return 0; }
    const stack = d.stack || 1; let left = n;
    for (let i = 0; i < bag.length && left > 0; i++) {   // onto the slots holding it first, then into empty ones
      const s = bag[i]; if (!s || s.id !== id || s.n >= stack) continue;
      const k = Math.min(left, stack - s.n); s.n += k; left -= k;
    }
    for (let i = 0; i < bag.length && left > 0; i++) {
      if (bag[i]) continue;
      const k = Math.min(left, stack); bag[i] = {id, n: k}; left -= k;
    }
    if (left !== n) ver++;
    return left;
  }
  function count(id) {
    if (material(id)) return pouch.get(id) || 0;
    let c = 0; for (const s of bag) if (s && s.id === id) c += s.n; return c;
  }
  function take(id, n = 1) {
    if (!(n > 0) || count(id) < n) return false;
    if (material(id)) { const c = pouch.get(id) - n; if (c > 0) pouch.set(id, c); else pouch.delete(id); ver++; return true; }
    let left = n;
    for (let i = bag.length - 1; i >= 0 && left > 0; i--) {   // from the last slots first (the first stays where the hand reaches)
      const s = bag[i]; if (!s || s.id !== id) continue;
      const k = Math.min(left, s.n); s.n -= k; left -= k; if (!s.n) bag[i] = null;
    }
    ver++; return true;
  }
  function best(job) {   // the bag's best tool for a job: the highest tier, then the strongest
    let b = null;
    for (let i = 0; i < bag.length; i++) {
      const s = bag[i], d = s && def(s.id), t = d?.tool; if (!t || t.job !== job) continue;
      if (!b || t.tier > b.def.tool.tier || (t.tier === b.def.tool.tier && t.power > b.def.tool.power)) b = {id: s.id, def: d, slot: i};
    }
    return b;
  }
  function payOf(need) {
    const o = {};
    for (const q of need) {
      let b = q.ids[0], bn = -1;
      for (const id of q.ids) { const c = count(id) - (o[id] || 0); if (c > bn) { bn = c; b = id; } }
      o[b] = (o[b] || 0) + q.n;
    }
    return o;
  }
  const short = o => { for (const k in o) if (count(k) < o[k]) return true; return false; };
  return {
    pouch, bag, add, take, count, has: (id, n = 1) => count(id) >= n, best, payOf, short,
    get ver() { return ver; },
    toJSON: () => ({pouch: Object.fromEntries(pouch), bag: bag.map(s => s && {id: s.id, n: s.n})}),
    load(o) {
      pouch.clear(); bag.fill(null);
      for (const [id, n] of Object.entries(o?.pouch || {})) if (material(id) && n > 0) pouch.set(id, Math.floor(n));
      (o?.bag || []).forEach((s, i) => { if (i < bag.length && s && def(s.id) && !material(s.id) && s.n > 0) bag[i] = {id: s.id, n: Math.min(Math.floor(s.n), def(s.id).stack || 1)}; });
      ver++;
    },
  };
}
