// WOODCUTTING's numbers (docs/GATHERING.md; features/woodcut.js, sim/player/tool.js). Pure data.
//   swing   the tool's blow: dur (s), hit (s: the blow lands), reach (m past the trunk's skin), arc (deg: what's in front),
//           snap (deg: a trunk this far off the cursor's way is still the one swung at), dmg (a foe or a dummy in the way:
//           combat damage); move: the footwork while swinging (m/s toward / sideways / backing off what he swings at, its
//           acceleration m/s^2, how fast he turns to keep facing it deg/s): he can circle a trunk as he chops. A trunk he
//           swings at is HELD at the sweet spot (its radius + keep m: the axe's head at the bark): the keys' sideways part
//           circles it, the distance springs back (hold, 1/s); one out of reach he walks in to first (close m/s; the swing
//           waits, given up after closeT s); its blow lands within reach + assist m of the bark, any way he faces. The axe
//           comes out with the first press at a trunk and goes back stow s after the last swing
//   tree    per species (trees3d.js): hp (blows at power 1 for a tree of scale 1; x scale ^ 1.5), tier (the axe it asks for;
//           old: a tree this big or bigger asks for one tier more), logs (x scale, rounded; at least 1), xp (x the fell's XP),
//           log (the item its logs are: content/items.js; oak's stays 'log'), bark (the family its logs on the ground are drawn in)
//   regrow  in-game hours a stump stands before the tree is back (the world clock: sim/env.js, 20 real minutes a day), and
//           only out of the player's way: farther than `far` m and off the screen
//   log     a log on the ground: picked up within `pick` m, drawn in from `magnet` m after `delay` s
export const TUNE = {
  swing: {dur: .62, hit: .26, reach: .9, arc: 90, snap: 40, dmg: 14, keep: .5, assist: .45, stow: .9,
    move: {fwd: 1.5, side: 1.45, back: 1.2, acc: 14, turn: 720, hold: 5, close: 2.6, closeT: 2.5}},
  regrow: {hours: 36, far: 14},
  log: {pick: .55, magnet: 2.4, delay: .6, speed: 7},
  stump: {h: .42, r: .3},   // m: what's left standing, and its collider
  // THE TREE'S HIT (docs/SKILLS.md): at tree.land everything in the fall's path is hit once. The path: the trunk's strip (line m
  // wide, from the stump to the crown's foot) and the crown's circle (its radius x crown) round its middle. A foe or a dummy:
  // foe x the tree's scale damage (combat's) and shoved shove m aside; the player: thrown sideways (out, up m/s: host.launch;
  // the flight and launch.js's lie make the ~1.2 s on the ground; a sprite loadout skids instead) and hurt hurt x his max
  // health, at least 1 and never the last of it (?treehurt=0: not hurt); a standing tree shudders and loses one blow (never
  // felled by it); a crate or a barrel breaks
  hit: {line: .35, crown: .8, foe: 30, shove: 1.5, out: 4.2, up: 3.4, hurt: .15, h: 2.2},
  // THE FALL LINE (Woodcutting 5, docs/SKILLS.md; view only): while the next bite will fell the tree, `along` specks tremble on
  // the ground where the trunk will lie and `ring` round where the crown comes down; shake (m) how far they tremble, col theirs
  line: {along: 24, ring: 10, shake: .035, col: ['#d8c9a8', '#b8a582', '#efe2c2']},
};

export const TREES = {
  oak: {hp: 6, tier: 1, old: 1.5, logs: 3, xp: 1, log: 'log', bark: 'bark'},
  dead: {hp: 4, tier: 1, logs: 2, xp: .7, log: 'deadwood', bark: 'deadwood'},
  willow: {hp: 5, tier: 1, logs: 2, xp: .8, log: 'willow_log', bark: 'rotwood'},
  birch: {hp: 4, tier: 1, logs: 2, xp: .8, log: 'birch_log', bark: 'birch'},
  aspen: {hp: 4, tier: 1, logs: 2, xp: .8, log: 'aspen_log', bark: 'aspen'},
  rowan: {hp: 4, tier: 1, logs: 2, xp: .8, log: 'rowan_log', bark: 'heron'},
  pine: {hp: 5, tier: 1, logs: 3, xp: .9, log: 'pine_log', bark: 'rust'},   // (the seeded forest's conifers: world/forest.js)
};

// a tree of `species` at scale s -> {hp (blows at power 1), logs, tier} | null: features/woodcut.js (a tree as the axe sees it)
// and the co-op server (a fell's XP: content/skills.js fellXP) read the same numbers
export function treeStats(species, s = 1) {
  const def = TREES[species]; if (!def) return null;
  return {hp: Math.max(2, Math.round(def.hp * s ** 1.5)), logs: Math.max(1, Math.round(def.logs * s)), tier: def.tier + (def.old && s >= def.old ? 1 : 0)};
}
