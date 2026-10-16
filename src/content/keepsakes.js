// KEEPSAKES (data; docs/KEEPSAKES.md): the odd things the forest's and the cave's secrets leave you, and the one rule each
// bends while you wear it in a charm slot (content/gear.js slot 'charm', SLOT_CAP 2). Pure data and pure functions (one import:
// content/fishing.js roll, pure too): the browser
// (features/keepsakes.js, features/cavelife.js, features/caves.js, features/fauna.js, features/fishing.js, features/watcher.js)
// and the co-op server (server/room.mjs: the soot things read who wears the tooth or the full tally; the heron's jab is rolled
// there) read this one file. What a keepsake does is never written in the game's text (no stat line, no toast): you find out.
//   KEEPSAKE_IDS   every keepsake (each is a pouch material in content/items.js and a charm in content/gear.js, same id); the
//                  night elk knocks one of these loose first (features/uncanny.js)
//   NOTES          the modifier notes (host.mods, source 'keepsakes') a worn keepsake sets; their owners apply them:
//                  fauna.loud (x a person's loudness to the animals: features/fauna.js), fauna.lure (the animals drift after you),
//                  cave.shun (the soot things keep off, the rock-things wake early: sim/cavelife.js, features/cavelife.js),
//                  cave.kin (the soot things count you as one of theirs), cave.relight (x the lantern's relight after a snuff:
//                  features/caves.js), watcher.every (x the watcher's wait between visits: features/watcher.js)
//   HERON          the Heron Feather: stand still in shallow water and fish shadows rise round your feet; E jabs for one
//                  heronRoll(rng, {water, part, lvl}) -> a catch {id, cm, kg} | null (a miss): the game offline, the server online
//   STONE          the Warm Stone: the lantern relights at once after a snuff (cold and ice: the weather brief's hooks)
//   TOOTH          the Big Tooth: the soot things break off, the rock-things flee early, the forest animals take you as loud
//   TALLY          the Tally Stick: its notches (the rule: docs/KEEPSAKES.md, under its spoiler heading)
//   DOLL           the Bark Doll: on a Keepsake Shelf its head turns toward the nearest secret; some dawns it walks there
//   FIDDLE         the Fiddle String: what its card says changes; what it does is the lure
//   SHELF          the Keepsake Shelf's places and what happens round it
// The numbers are in metres, seconds, m/s; degrees only where marked (turned at use).
import {roll, RARITY_TIER} from './fishing.js';

export const KEEPSAKE_IDS = ['heron_feather', 'warm_stone', 'bark_doll', 'tally_stick', 'full_tally_stick', 'big_tooth', 'fiddle_string'];
export const isKeepsake = id => KEEPSAKE_IDS.includes(id);

export const NOTES = {
  heron_feather: [],   // (its rule is features/keepsakes.js's own: stillness in the shallows)
  warm_stone: [{stat: 'cave.relight', mul: .25}],
  bark_doll: [],       // (worn: it creaks near a secret; on a shelf: its head)
  tally_stick: [],     // (it counts)
  full_tally_stick: [{stat: 'cave.kin', add: 1}],
  big_tooth: [{stat: 'fauna.loud', mul: 1.8}, {stat: 'cave.shun', add: 1}],
  fiddle_string: [{stat: 'fauna.lure', add: 1}, {stat: 'watcher.every', mul: .5}],
};

export const HERON = {
  still: 3, speed: .2,         // s standing (slower than speed m/s) in the shallows before they come
  n: [3, 5], ring: [.6, 1.4],  // how many shadows, the ring they circle in (m from your feet)
  rise: 4,                     // s they take to rise from the drop-off to your feet
  odds: .55, perLevel: .01, max: .75,   // a jab's chance of a fish: base, + a Fishing level, at most
  back: 12,                    // s after a scatter (a jab, hit or miss, or a step) before they come again
  reach: 1.6,                  // m: a shadow this near your feet is within a jab
  rarest: 'rare',              // a jab never comes up with anything rarer (no bait, no spot, no finds)
  xp: .5,                      // x a cast's Fishing XP for a heron's catch
  stream: .25,                 // m: the stream counts as shallows where it is no wider than its usual (not its deep pools)
};
// the heron's jab: a fish of that water (as a cast rolls it: no bait, no spot, no finds, nothing rarer than HERON.rarest) or nothing
export function heronRoll(rng, o) {
  const hit = Math.min(HERON.max, HERON.odds + HERON.perLevel * Math.max(0, (o.lvl || 1) - 1));
  if (rng() >= hit) return null;
  const r = roll(rng, {water: o.water, part: o.part || 'day', noFind: true, most: RARITY_TIER[HERON.rarest]});
  return {id: r.id, cm: r.cm, kg: r.kg};
}
export const STONE = {
  relight: .25,                // x the lantern's relight after a snuff (content/cavelife.js LANTERN.relight: 4 s -> 1 s)
  glow: 1,                     // s the wick glows red before it catches
  cold: .4,                    // (weather, not built yet: x how fast the cold builds while worn) hook: STONE.cold
  melt: 6,                     // (weather, not built yet: s laid on lake ice to melt a fishing hole) hook: STONE.melt
};
export const TOOTH = {
  shun: 5,                     // m: the soot things break off this far from the wearer
  wake: 6, trot: [8, 12],      // m: the rock-things wake this far off and trot this far (min, max)
  loud: 1.8,                   // x as loud to the forest animals (the night elk's number: features/fauna.js TUNE.elk)
};
export const TALLY = {
  full: 10,                    // notches to the Full Tally Stick
  escort: [1, 2], escortT: 90, // soot things that stay over the full one's wearer; s at most
  over: 1.2,                   // m over the head they flutter at
  leash: 30,                   // m from their roost: past this (out of the cave) the escort goes home
  cut: '#f0dcb0',              // a fresh notch on the icon: a pale cut through the bark's dark edge (row r, column 11 - r: features/keepsakes.js)
};
export const DOLL = {
  every: 2, rate: 30,          // s between two looks for the nearest secret; deg/s its head turns
  creak: 12,                   // m: worn, it creaks when you come this near a secret
  walk: .25, dist: [15, 30],   // the chance a dawn it walks (from its shelf, the surface only), and how far toward the secret
  most: 5,                     // walks before it waits to be fetched
  fetch: 1.4,                  // m: E this near a walked doll puts it back on its shelf
};
export const FIDDLE = {
  lure: 20, follow: [5, 8], most: 3,   // m an animal (not bolting) drifts after you from; the distance it trails at; how many
  turn: .8,                    // rad: you facing an animal this nearly freezes it, staring
  watcher: .5,                 // x the watcher's wait (it comes twice as often)
};
export const SHELF = {
  places: 5,                   // keepsakes one shelf holds
  heron: [1 / 3, 8, 12, 6],    // the feather on a shelf: the chance a dawn a grey heron stands by it, m off (min, max), gone within m
  listen: [1, 2, 10],          // the fiddle string on a shelf: animals that come at dusk (min, max), m off they stand
};
