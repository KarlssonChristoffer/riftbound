// THUNDER (data; docs/WEATHER.md "Thunder and fire"): the knobs of natural lightning and of trees that burn, and what a strike
// does to each kind of thing it hits. Pure: sim/thunder.js reads it (the browser offline, the co-op server online).
//   TUNE    the knobs
//   STRIKE  what a strike does to the thing it hits, by kind (the rod it picked): a future build (a lightning rod, something that
//           stores the charge) adds its own kind here and listens to 'thunder.strike' (core/events.js); the thunder code
//           doesn't change. Fields: burn (a tree catches: TUNE.fire), char (it's charred at once, nothing burns), wood (the
//           chance of a splinter of thunderwood at its foot), hurt (x TUNE.hurt to a player struck), down (knocked flat),
//           scorch (the ground's scorched star), weight (how much it draws a bolt: TUNE.weight's name)
export const TUNE = {
  // WHEN: while the storm is over a player (the storm channel there >= storm), a bolt about every `every` real s comes down
  // somewhere within `reach` m of him (x ?strikes=); about one in ten of those lands within 25 m of him (every 2-3 minutes). Not in the cave
  storm: .5, every: [10, 20], reach: 80,
  // WHAT IT PICKS: from the aim point, the thing within `pick` m that draws it most (weights below x its height, its
  // loneness): the tallest lone tree, a tor's top, a player out on the fell (iron on him: x iron), else the open ground
  pick: 9,
  weight: {tree: 5, tor: 3, player: 4, playerLow: .5, ground: 1.2, iron: 3},
  tall: 14,        // m: a tree's height that counts as full (a stunted fell birch draws less)
  lone: 4.5,       // m: other trees closer than this make a tree less lone (each takes a third of its weight, down to a third)
  fellH: 14,       // m over the lowland: a player that high (the fell's flanks and top) draws as 'player', below it as 'playerLow'
  // THE WARNING: a mark on the target tele s before the bolt (his hair stands up, a crackle, a blue glint on iron), then
  // the strike: a direct hit (within r m) hurts hurt and knocks him flat (sim/player/launch.js), within near m a graze
  tele: 1.5, r: 1.4, near: 3.2,
  hurt: {direct: 34, graze: 10, floor: 1},   // hp (the storm omen's strike is 14-30; out of a fight he can't fall below floor: never a death)
  throw: {direct: [5.5, 4.2], graze: [3, 0]},   // m/s out, up (a graze: the skid only)
  // FIRE: a struck tree burns burn s (rain over rain: burnOut x faster); each burning tree may pass it to one within
  // spread m: catch (in its life) dry (no rain, the ground not wet) or wet; never more than max at once, never across water
  // or rock (both trees on the same dry ground); then it's charred (it stands black, leafless, till the next spring)
  fire: {burn: [60, 120], rain: .5, burnOut: 3, spread: 4, dry: .25, wet: .05, max: 8, tick: 1},
  // a burning brand from a campfire (?firestart=1, Esc > Sandbox): s it burns in the hand, m it reaches
  brand: {life: 45, reach: 1.6},
};
export const STRIKE = {
  tree:   {burn: true, wood: .3, scorch: true, weight: 'tree'},
  tor:    {scorch: true, weight: 'tor'},
  ground: {scorch: true, weight: 'ground'},
  player: {hurt: 1, down: true, scorch: true, weight: 'player'},
};
// the thunderwood keepsake (content/items.js): 'thunderwood'
export const WOOD = 'thunderwood';
// Gear (content/gear.js mods): 'thunder.iron' (add: iron on him draws the bolt: TUNE.weight.iron; the kettle helm, the mail shirt),
// 'thunder.smoulder' (add: a strike sets it smouldering, puffs of smoke for a few s: the wool sweater). ironOf(ids, GEAR) for the server
export const SMOULDER = 3;   // s a struck wool sweater puffs
export function statWords(m) {
  if (m.stat === 'thunder.iron') return 'a lightning rod: draws the bolt in a thunderstorm';
  if (m.stat === 'thunder.smoulder') return 'catches fire fast: a strike sets it smouldering';
  return '';
}
export const ironOf = (ids, byId) => { for (const g of ids || []) for (const m of byId[g]?.mods || []) if (m.stat === 'thunder.iron' && m.add > 0) return true; return false; };
