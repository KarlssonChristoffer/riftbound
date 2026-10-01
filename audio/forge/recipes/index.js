// RECIPE REGISTRY. A recipe is one ES module in this folder whose default export follows this CONTRACT:
//
// export default {
//   id: 'impact',                 // unique; files and events refer to it
//   version: 1,                   // bump when the sound changes (bake caches key on it)
//   desc: 'Arrow / object impacts: modal body + contact residue',
//   params: {                     // what the recipe understands (the lab shows these as controls)
//     material: {values: ['wood', 'clay', 'stone', 'crystal'], def: 'wood'},
//     intensity: {min: 0, max: 1, def: .8},
//   },
//   cases: {                      // named parameter sets: what the forge CLI renders and the game's events ask for
//     wood: {material: 'wood'}, stone: {material: 'stone'},
//   },
//   variants: 6,                  // seeds the runtime bakes per case (docs/AUDIO.md §2.2)
//   lufs: -20,                    // loudness the forge normalises each variant to (momentary max); default -20
//   loop: false,                  // true = seamless loop (beds, streams): no trimming or fades
//   render(params, R, sr) {       // R = seeded rng from dsp.makeRng (R(), R.range, R.jit, R.pick, R.exp, R.pow, R.fork)
//     return Float32Array | [L, R]  // DRY (no room reverb: the runtime adds space per biome), any level (forge normalises)
//   },
//   criteria: {                   // pass ranges per case (metric names from metrics.js analyze; '*' = all cases)
//     wood: {attackMs: [0, 3], t60Ms: [30, 250], centroidHz: [600, 3500]},
//   },
//   refs: {wood: ['assets/sfx/hit.wood_1.mp3']},   // optional reference takes for A/B (analysis only, never shipped)
//   notes: 'model + sources in one or two lines',
// };
//
// Rules: deterministic (all randomness from R), no Web Audio, no Math.random, pure JS so it runs in Node, the browser
// and a Worker. Keep render() under ~20 ms per variant for one-shots (it runs at load time).

// Phase 1 ids are registered up front; a missing file is skipped with a warning. 'example' stays loadable by id
// (node tools/sfx/forge.mjs example) but is kept out of the lab and 'all'.
export const RECIPES = ['impact', 'crate_break', 'bow_release', 'footstep', 'stream', 'splash'];
export async function loadRecipes(ids = RECIPES) {
  const out = {};
  for (const id of ids) {
    try { out[id] = (await import(`./${id}.js`)).default; }
    catch (e) { if (ids !== RECIPES) throw e; console.warn(`forge: recipe '${id}' not loaded (${String(e.message).split(/\r?\n/)[0]})`); }
  }
  return out;
}
