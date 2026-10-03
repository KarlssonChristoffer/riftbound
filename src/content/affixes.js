// AFFIXES (data): Risk of Rain style elite affixes. In a run an elite or a champion rolls one (a regular brute may too, on
// later stages); the affix changes how it fights AND how it looks: its colour on the aura ring, the light, the name
// ("Blazing Elite Brute"), the HP bar. features/affixes.js plays them (the behaviours: features/affixes/sim.js; the look:
// features/affixes/look.js; the telegraphed ground zones: sim/hazards.js + view/hazards.js).
// Pure data: imports nothing. Numbers are at stage 1; hazard damage x the stage's damage scale (game/enemies.js scaleOf).
//
// ROLLS: CHANCE[type][stage] is the chance an enemy of that type rolls an affix on that run stage (0-based: the run's
// STAGES), WEIGHT[affix][stage] how likely each affix is among the ones that may roll there (0: not yet).
export const CHANCE = {
  brute:    [0, .05, .12, .2],
  elite:    [1, 1, 1, 1],
  champion: [.6, .85, 1, 1],
};
export const WEIGHT = {
  blazing:  [3, 3, 3, 3],
  glacial:  [3, 3, 3, 3],
  splitting: [2, 3, 3, 3],
  overloaded: [1, 3, 3, 3],
  warded:   [1, 2, 3, 3],
  vampiric: [0, 2, 3, 3],
};
// what an affix does to a REGULAR brute that rolls one (an elite or a champion keeps its numbers: it is already one)
export const BRUTE_UP = {hp: 1.7, dmg: 1.2, coins: [3, 6]};
// an elite or a champion with an affix drops this many times its coins
export const ELITE_COINS = 1.5;

// THE AFFIXES: name (the prefix), col (aura ring, light, nameplate), bar (its HP bar), desc (what it does: the docs and
// the trial rows), by tier (brute / elite / champion: scaled numbers), plus each one's own tuning
export const AFFIXES = {
  blazing: {name: 'Blazing', col: '#ff6a24', bar: '#ff7a2a', desc: 'leaves burning ground where it lands; bursts into flame when it dies',
    // a burning patch where it lands: r (m), warn (s: the ember before it catches), last (s), dps while you stand in it
    patch: {r: [.5, .62, .85], warn: .3, last: [2.6, 3.6, 4.6], dps: 8, tick: .5, gap: .7, near: 16},
    // the death burst: a ring that closes, then fire (dmg, knock), and patches left round it
    burst: {r: [1.6, 2.2, 3], warn: .8, dmg: [8, 14, 20], knock: 9, patches: [2, 4, 6]},
    ignite: .9},   // wooden props (crates, barrels, dummies) within this of a new patch catch fire (features/lights.js)
  glacial: {name: 'Glacial', col: '#9fe6ff', bar: '#7ccfff', desc: 'its blows chill you (slower); a frost nova when it dies',
    chill: {mul: [.7, .58, .5], dur: [1.6, 2.2, 2.8]},   // a hit's chill: your run speed x mul for dur s
    nova: {r: [2, 2.8, 3.6], warn: 1.25, dmg: [4, 8, 12], mul: .5, dur: 3, knock: 5}},
  overloaded: {name: 'Overloaded', col: '#b48cff', bar: '#a97cff', desc: 'calls lightning on you: rings close in, then the bolt',
    // every `every` s (+- jitter) while you're within `range`: `n` strikes, the first on you, one where you're heading,
    // the rest round you; each a ring closing in for `warn` s, then the bolt (dmg, knock) on whoever stands in r
    strike: {every: [5, 3.4, 2.6], jitter: .6, range: 13, n: [1, 2, 3], r: .95, warn: 1.15, dmg: [8, 12, 16], knock: 8, lead: .8, leadMax: 3.5, spread: [1.4, 2.4]},
    death: {n: [0, 3, 5], r: 1, warn: 1.25, dmg: [8, 10, 14], ring: 1.6}},   // a last discharge round where it fell
  splitting: {name: 'Splitting', col: '#7ae05a', bar: '#6ad04a', desc: 'splits into smaller, faster brutes when it dies',
    // n children, each with hp = the parent's max x hp (at least min), dmg x dmg, quicker hops; they don't split again
    split: {n: [2, 3, 4], hp: [.45, .3, .22], min: 16, dmg: .6, delay: .35, spread: .6},
    child: {name: 'Splitling', hopT: .34, hopD: 1.4, hopH: .55, pause: .2, knock: 8, r: .3, coins: [0, 1]}},
  warded: {name: 'Warded', col: '#ffc44a', bar: '#f0b43a', desc: 'a ward in front stops your shots until broken: flank it, blow it up',
    // the ward's health, the arc it covers (deg either side of where it points), how fast it turns after you (deg/s: you can
    // outrun it by circling), how long it takes to grow back once broken; a piercing shot hits it x pierce
    ward: {hp: [24, 60, 150], half: 62, turn: [40, 32, 26], regrow: 7, pierce: 3}},
  vampiric: {name: 'Vampiric', col: '#ff3a5a', bar: '#e0284a', desc: 'drains you with a beam (break it: get away, behind cover or roll); heals from its hits',
    // the beam: every `every` s, within `range`, it reaches for you for `reach` s (the telegraph), then drains `dps` while
    // latched (up to `dur` s); out past `snap` m, cover between (a wall, a crate, a body) or a dodge roll snaps it. It heals
    // x heal of what it drains, x melee of its hits
    beam: {every: [6.5, 5, 4], range: 5.5, reach: .8, dur: 2.5, dps: [4, 6, 8], tick: .5, snap: 7, heal: 3},
    melee: 2},
  // a splitting enemy's children: no behaviour, only the look (green, and their name)
  splitling: {name: 'Splitling', col: '#9af07a', bar: '#7ae05a', desc: 'what a Splitting enemy breaks into', child: true},
};
// the order the trial rows / the dev key cycle through (the children are not on it)
export const AFFIX_IDS = ['blazing', 'glacial', 'overloaded', 'splitting', 'warded', 'vampiric'];
export const TIER = {brute: 0, elite: 1, champion: 2};
