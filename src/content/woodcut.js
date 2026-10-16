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
