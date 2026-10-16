// SKILLS: what the player gets better at by doing it (docs/GATHERING.md: skills by doing, gear gates; docs/SKILLS.md: the moves).
// Pure data and pure functions: the browser (features/pack.js, game/skills.js) and the co-op server (server/room.mjs,
// server/players.mjs: it owns XP online) read this one file.
//   name, col    the label and its colour (the panel, the level-up toast)
//   per          the notes a level gives (game/skills.js sets them in host.mods under the source 'skills'): each
//                {stat, mul} is 1 + mul x (level - 1), each {stat, add} add x (level - 1); the system that owns the stat
//                reads it (woodcut.power: features/woodcut.js, a blow's chop). They stay in the background: the MOVES are the reward
// XP: CURVE.k x (level - 1) ^ CURVE.p to reach a level (level 2 at 40, 5 at ~560, 10 at ~2600); MAX the last level.
// Modest on purpose: a level is a few per cent; a better tool is what opens harder wood.
import {treeStats, TREES} from './woodcut.js';

export const CURVE = {k: 40, p: 1.9, max: 50};

export const SKILLS = {
  woodcutting: {name: 'Woodcutting', col: '#b8d080', per: [{stat: 'woodcut.power', mul: .03}, {stat: 'woodcut.extra', add: .01}]},
  // fishing (features/fishing.js; a catch's XP is its own: content/fishing.js CATCHES xp): a little luck and a steadier reel a level
  fishing: {name: 'Fishing', col: '#7ec8e3', per: [{stat: 'fish.luck', add: .01}, {stat: 'fish.reel', mul: .02}]},
  // foraging (features/forage.js; a pick's XP is its plant's: content/forage.js PLANTS xp): a chance of one more a level
  foraging: {name: 'Foraging', col: '#c8a0e0', per: [{stat: 'forage.extra', add: .02}]},
  // mining (features/mining.js; a blow's XP is its vein's: content/mining.js VEINS xp): a harder blow and a chance of one more chunk
  mining: {name: 'Mining', col: '#d8a868', per: [{stat: 'mine.power', mul: .03}, {stat: 'mine.extra', add: .01}]},
};

// how much XP an action gives (the systems that give it read these; every grant is then x RATE)
export const XP = {
  chop: 4,         // a blow that bites into a tree
  fell: 18,        // a tree down (x its size: content/woodcut.js)
  gather: 1,       // a log picked up
};

// THE PACE (docs/SKILLS.md): every grant is multiplied by its skill's RATE, so that an hour of focused doing gives about the same
// XP in every skill (TARGET XP a minute: Woodcutting 5 in ~12 minutes, 10 in ~an hour). The raw rates are far apart (a tree
// felled every ~9 s is ~290 XP a minute, a catch every ~13 s ~44); tools/test/xprate.mjs estimates them from the forest's plan,
// the tables and the swings' timings. ?xprate=k (offline) / --xprate k (server): a factor on all of them; 'raw': RATE ignored (every grant as
// the tables say: the golden tour's numbers)
export const TARGET = 45;
// (measured 2026-10-16 with tools/test/xprate.mjs on seed 1337: raw ~287 / ~44 / ~65 XP a minute; mining is limited by its veins,
// a sweep of the cave ~480 raw once an hour, so its RATE makes one sweep Mining 5 and two Mining 10)
export const RATE = {woodcutting: .16, fishing: 1.1, foraging: .75, mining: 2.75};
export const rateOf = (id, k = 1) => k === 'raw' ? 1 : (RATE[id] ?? 1) * (k > 0 ? k : 1);
// co-op: the level a first join may bring from the browser's own save (server/players.mjs: an honest player keeps his
// progress, a doctored save gains little); --importcap on the server
export const IMPORT_CAP = 10;

// the XP a level begins at / the level an amount of XP is
export const needXP = L => Math.round(CURVE.k * Math.pow(L - 1, CURVE.p));
export function levelOf(x) { let L = 1; while (L < CURVE.max && x >= needXP(L + 1)) L++; return L; }

// a felled tree's XP, all at once (the co-op server grants it to the feller: it never sees the bites): its blows at power 1
// x XP.chop, the fell's own (x its size), its logs. Offline the same XP comes bite by bite (features/woodcut.js)
export function fellXP(species, s = 1) {
  const st = treeStats(species, s); if (!st) return 0;
  return st.hp * XP.chop + Math.round(XP.fell * TREES[species].xp * s) + st.logs * XP.gather;
}
