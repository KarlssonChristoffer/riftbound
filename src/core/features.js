// FEATURES: loading the feature modules (features/<name>.js, the contract in main.js) into the shared list.
// A missing feature file is skipped, so features can land one at a time; one that throws in create() is left out.
// FEATURES is the update order (wind first: others read it; lights before combat: it sees arrow hits first; garden before
// combat: its colliders are known). The game (game/game.js) goes in front of them all (main.js).
//   await loadFeatures(features, host)   (features: the list the engine already holds)
export const FEATURES = ['wind', 'windlines', 'weather', 'lights', 'garden', 'combat', 'atmos', 'flow', 'wildlife', 'depth', 'contact', 'audio'];

export async function loadFeatures(features, host) {
  const mods = await Promise.all(FEATURES.map(name => import(`../features/${name}.js`).then(m => ({name, m}), e => {
    if (!/Failed to fetch|Importing a module script failed|404|error loading/i.test(String(e))) console.warn('feature', name, e); return null; })));
  for (const x of mods) {
    if (!x) continue;
    try { const f = await x.m.create(host); f.name ??= x.name; features.push(f); } catch (e) { console.warn('feature', x.name, e); }
  }
  features.sort((a, b) => FEATURES.indexOf(a.name) - FEATURES.indexOf(b.name));
}
