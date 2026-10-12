// FEATURES: loading the feature modules (features/<name>.js, the contract in main.js) into the shared list, in order.
// A missing feature file is skipped, so features can land one at a time; one that throws in create() is left out.
// THE ORDER: each module declares its own constraints, `export const order = {after: [...], before: [...]}` (the
// features whose work this step it reads / that must see something first), with the reason in a line above it.
// The list is sorted by those (a topological sort); LOAD_ORDER only breaks ties between features that don't depend on
// each other. The order is the update order AND every hook chain's (onArrowHit, interact, ability, onKey, prompt, the
// frame and HD passes). A cycle throws. The game (game/game.js) goes in front of them all (main.js).
//   await loadFeatures(features, host)   (features: the list the engine already holds)
export const LOAD_ORDER = ['wind', 'windlines', 'litter', 'weather', 'mist', 'equip', 'campfires', 'lights', 'garden', 'riverside', 'grass', 'woodcut', 'fists', 'brawl', 'calls', 'gun', 'affixes', 'trickshot', 'bells', 'combat', 'brutes3d', 'atmos', 'flow', 'wildlife', 'depth', 'cutaway', 'contact', 'gunfx', 'blood', 'audio', 'dust', 'tumbleweed', 'frontier', 'foes', 'battlemusic', 'shrines', 'omens', 'anomaly', 'watcher', 'cinema', 'chasecam', 'senses', 'airfx', 'ropetail', 'pack', 'coop'];

export async function loadFeatures(features, host) {
  const mods = await Promise.all(LOAD_ORDER.map(name => import(`../features/${name}.js`).then(m => ({name, m}), e => {
    if (!/Failed to fetch|Importing a module script failed|404|error loading/i.test(String(e))) console.warn('feature', name, e); return null; })));
  const orders = new Map();
  for (const x of mods) {
    if (!x) continue;
    try { const f = await x.m.create(host); f.name ??= x.name; features.push(f); orders.set(f, x.m.order || {}); } catch (e) { console.warn('feature', x.name, e); }
  }
  const sorted = sortByOrder(features, f => orders.get(f));
  features.length = 0; features.push(...sorted);
}

// Kahn's sort: of the features whose 'after's are all placed, the earliest in LOAD_ORDER goes next. A constraint
// naming a feature that isn't loaded is ignored (it isn't there to wait for).
export function sortByOrder(list, orderOf) {
  const rank = f => { const i = LOAD_ORDER.indexOf(f.name); return i < 0 ? LOAD_ORDER.length : i; };
  const byName = new Map(list.map(f => [f.name, f])), need = new Map(list.map(f => [f, new Set()]));
  for (const f of list) {
    const o = orderOf(f) || {};
    for (const n of o.after || []) if (byName.has(n)) need.get(f).add(byName.get(n));
    for (const n of o.before || []) if (byName.has(n)) need.get(byName.get(n)).add(f);
  }
  const out = [], left = [...list].sort((a, b) => rank(a) - rank(b));
  while (left.length) {
    const i = left.findIndex(f => [...need.get(f)].every(g => out.includes(g)));
    if (i < 0) throw new Error('features: an order cycle among ' + left.map(f => f.name).join(', '));
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}
