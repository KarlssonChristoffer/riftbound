// INVENTORY: what the player carries (docs/GATHERING.md): the POUCH (materials: id -> count, no limit, no slots) and the
// BAG (a few slots of {id, n}: tools, food, gear; `stack` of them share a slot). One owner (features/pack.js holds the
// player's); the same code serves a chest or a stockpile later.
//   const inv = createInventory(ITEMS, {slots})
//   inv.add(id, n) -> how many did NOT fit (0: all in) / inv.take(id, n) -> true (all taken) | false (not enough: none taken)
//   inv.count(id) / inv.has(id, n) / inv.best(job) -> the bag's tool for a job ({id, def, slot, u}): the one prefer(job, slot)
//   picked if it's still there, else the highest tier, then the strongest | null
//   MADE things (content/workshop.js): inv.add(id, 1, u) puts it in a slot of its own {id, n: 1, u} (never stacked: u is its
//   record's uid); inv.takeU(u) takes that one; inv.slotOf(u) -> its slot | -1
//   inv.payOf(need) -> {id: n}: a recipe's need ([{ids, n}]: n of ONE of ids) paid with the kind there is most of; inv.short(cost)
//   -> true when the pouch / bag can't pay it
//   WOOD: the id 'wood' stands for any log (the items marked `wood`: content/items.js): count('wood') is all the logs, take('wood', n)
//   takes them one at a time from the kind there is most of, add('wood', n) gives Oak Logs (a cost given back)
//   inv.pouch (Map, read only) / inv.bag (the slots, read only: null | {id, n}) / inv.ver (bumps on every change: caches)
//   inv.toJSON() -> {pouch, bag} / inv.load(o) (a save: unknown ids are dropped)
// OWNS: the pouch, the bag. READS: the item table. No allocation per call but a new slot's record.
export function createInventory(ITEMS, {slots = 8} = {}) {
  const pouch = new Map(), bag = new Array(slots).fill(null), pref = {};   // (pref: job -> the bag slot chosen for it)
  let ver = 0;
  const def = id => ITEMS[id] || null;
  const material = id => def(id)?.kind === 'material';
  const WOOD = Object.keys(ITEMS).filter(id => ITEMS[id].wood);
  const most = () => { let b = WOOD[0], bn = 0; for (const id of WOOD) { const c = pouch.get(id) || 0; if (c > bn) { bn = c; b = id; } } return b; };

  function add(id, n = 1, u = '') {
    if (id === 'wood') id = 'log';
    const d = def(id); if (!d || !(n > 0)) return n > 0 ? n : 0;
    if (material(id)) { pouch.set(id, (pouch.get(id) || 0) + n); ver++; return 0; }
    if (u) { const i = bag.indexOf(null); if (i < 0) return n; bag[i] = {id, n: 1, u}; ver++; return n - 1; }   // (a made thing: a slot of its own)
    const stack = d.stack || 1; let left = n;
    for (let i = 0; i < bag.length && left > 0; i++) {   // onto the slots holding it first, then into empty ones
      const s = bag[i]; if (!s || s.id !== id || s.n >= stack || s.u) continue;
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
    if (id === 'wood') { let c = 0; for (const w of WOOD) c += pouch.get(w) || 0; return c; }
    if (material(id)) return pouch.get(id) || 0;
    let c = 0; for (const s of bag) if (s && s.id === id) c += s.n; return c;
  }
  function take(id, n = 1) {
    if (!(n > 0) || count(id) < n) return false;
    if (id === 'wood') { for (let k = 0; k < n; k++) take(most(), 1); return true; }
    if (material(id)) { const c = pouch.get(id) - n; if (c > 0) pouch.set(id, c); else pouch.delete(id); ver++; return true; }
    let left = n;
    for (let pass = 0; pass < 2 && left > 0; pass++) for (let i = bag.length - 1; i >= 0 && left > 0; i--) {   // from the last slots first (the first stays where the hand reaches), a made one last
      const s = bag[i]; if (!s || s.id !== id || !!s.u !== !!pass) continue;
      const k = Math.min(left, s.n); s.n -= k; left -= k; if (!s.n) bag[i] = null;
    }
    ver++; return true;
  }
  const BEST = {};   // (job -> the answer, reused: read it at once)
  function best(job) {   // the bag's tool for a job: the one chosen (prefer), else the highest tier, then the strongest
    let bi = -1, bd = null;
    const pi = pref[job], ps = pi >= 0 ? bag[pi] : null;
    if (ps && def(ps.id)?.tool?.job === job) { bi = pi; bd = def(ps.id); }
    else for (let i = 0; i < bag.length; i++) {
      const s = bag[i], d = s && def(s.id), t = d?.tool; if (!t || t.job !== job) continue;
      if (!bd || t.tier > bd.tool.tier || (t.tier === bd.tool.tier && t.power > bd.tool.power)) { bi = i; bd = d; }
    }
    if (bi < 0) return null;
    const o = BEST[job] ??= {id: '', def: null, slot: -1, u: ''};
    o.id = bag[bi].id; o.def = bd; o.slot = bi; o.u = bag[bi].u || ''; return o;
  }
  // the tool in this slot is the one its job swings (a click in the pack panel) -> its job | ''
  function prefer(slot) {
    const s = bag[slot], j = s && def(s.id)?.tool?.job; if (!j) return '';
    if (pref[j] !== slot) { pref[j] = slot; ver++; }
    return j;
  }
  function takeU(u) { const i = slotOf(u); if (i < 0) return false; bag[i] = null; ver++; return true; }
  function slotOf(u) { if (!u) return -1; for (let i = 0; i < bag.length; i++) if (bag[i]?.u === u) return i; return -1; }
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
    pouch, bag, add, take, count, has: (id, n = 1) => count(id) >= n, best, prefer, takeU, slotOf, payOf, short,
    get ver() { return ver; },
    toJSON: () => ({pouch: Object.fromEntries(pouch), bag: bag.map(s => s && (s.u ? {id: s.id, n: s.n, u: s.u} : {id: s.id, n: s.n})), pref: {...pref}}),
    load(o) {
      pouch.clear(); bag.fill(null); for (const k in pref) delete pref[k];
      for (const [id, n] of Object.entries(o?.pouch || {})) if (material(id) && n > 0) pouch.set(id, Math.floor(n));
      (o?.bag || []).forEach((s, i) => { if (i < bag.length && s && def(s.id) && !material(s.id) && s.n > 0) bag[i] = typeof s.u === 'string' && s.u ? {id: s.id, n: 1, u: s.u} : {id: s.id, n: Math.min(Math.floor(s.n), def(s.id).stack || 1)}; });
      for (const [j, i] of Object.entries(o?.pref || {})) if (Number.isInteger(i) && i >= 0 && i < bag.length) pref[j] = i;
      ver++;
    },
  };
}
