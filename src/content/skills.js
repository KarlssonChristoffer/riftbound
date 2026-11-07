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

// THE MOVES (docs/SKILLS.md): every few levels a skill gives a MOVE, something you see and do differently, instead of a bigger
// number. {lvl, id, name (the toast's and the panel's), line (the panel's one plain sentence), soon (not built yet: never shown,
// never toasted)}. The features ask pack.move(id) (features/pack.js: ?movelvl=N pretends every skill is at least N, ?moves=0
// none); the co-op server checks the moves that change the sim against its own record (hasMove)
export const MOVES = {
  woodcutting: [
    {lvl: 5, id: 'fall_line', name: 'The fall line', line: 'When the next bite will fell it, the ground trembles where it will land.'},
    {lvl: 10, id: 'steer_fall', name: 'Steer the fall', line: 'The felling blow turns the fall toward where you point.', soon: true},
    {lvl: 15, id: 'domino', name: 'Domino', line: 'A tree that lands on one you have bitten half through takes it down too.', soon: true},
    {lvl: 20, id: 'bridge', name: 'Bridge', line: 'A pine felled across the stream stays whole: walk it.', soon: true},
    {lvl: 30, id: 'crown_shake', name: 'Crown shake', line: 'A crown shakes out cones, an old nest, now and then something kept.', soon: true},
  ],
  mining: [
    {lvl: 5, id: 'chain', name: 'The chain', line: 'Three rhythm blows in a row on one vein crack it open at once.'},
    {lvl: 10, id: 'rings', name: 'Rings in the rock', line: 'Each blow rings through the floor; a hollow wall rings back.', soon: true},
    {lvl: 15, id: 'spark_light', name: 'Spark light', line: 'A chain lights the dark round you for a moment.', soon: true},
    {lvl: 20, id: 'run_seam', name: 'Run the seam', line: 'A chain cracks a vein of the same kind beside it too.', soon: true},
    {lvl: 30, id: 'deep_ear', name: 'Deep ear', line: 'The rings reach far, and the roosts answer.', soon: true},
  ],
  foraging: [
    {lvl: 5, id: 'glimmer', name: 'Glimmer', line: 'Crouch and keep still: what is left to pick catches the light.'},
    {lvl: 10, id: 'odd_ones', name: 'The odd ones', line: 'You know the look-alikes when you see them.', soon: true},
    {lvl: 15, id: 'nose', name: 'The nose', line: 'You turn your head toward chanterelles before you see them.', soon: true},
    {lvl: 20, id: 'true_colours', name: 'True colours', line: 'On the fly agaric, what is really there holds still.', soon: true},
    {lvl: 30, id: 'tend', name: 'Tend', line: 'Hold E on a picked patch and it grows back in half the time.', soon: true},
  ],
  fishing: [
    {lvl: 5, id: 'shadows', name: 'Shadows', line: 'You see the fish under a spot. Drop the bobber just ahead of its nose.'},
    {lvl: 10, id: 'read_surge', name: 'Read the surge', line: 'You see a fish turn before it thrashes.', soon: true},
    {lvl: 15, id: 'leaper', name: 'Lasso the leaper', line: 'A big fish in the air can be roped.', soon: true},
    {lvl: 20, id: 'next_rise', name: 'The next rise', line: 'You see where the spots will rise next.', soon: true},
    {lvl: 30, id: 'deep_shadows', name: 'Deep shadows', line: 'At dawn and dusk the deep fish show mid-lake.', soon: true},
  ],
};
// TITLES (docs/SKILLS.md): earned by doing a thing a lot, one worn at a time (the newest, unless he picks another in the pack
// panel; none hides it), shown under a co-op player's name. {name, n: the counter (what's counted, below), at: how much}.
// The counters: cave (s in the cave: its plan's open floor), trees (felled), berries (blueberries picked, each one), night_fish
// (fish landed between dusk and dawn), veins (spent: each who struck it), walked (m). Online the server counts and grants them
// (server/room.mjs: on the acts it sees, the accepted moves); offline features/pack.js does from the events.
export const TITLES = {
  cave_rat: {name: 'the Cave Rat', n: 'cave', at: 45 * 60},
  feller: {name: 'the Feller', n: 'trees', at: 300},
  blueberry_mouth: {name: 'Blueberry Mouth', n: 'berries', at: 300},
  owl: {name: 'the Owl', n: 'night_fish', at: 25},
  mole: {name: 'the Mole', n: 'veins', at: 60},
  wanderer: {name: 'the Wanderer', n: 'walked', at: 25000},
};
// the titles counter `n` now earns that `had` (ids) doesn't hold -> [id] (pure: the server's and the pack's)
export function titlesEarned(name, total, had) { const out = []; for (const id in TITLES) { const T = TITLES[id]; if (T.n === name && total >= T.at && !had.includes(id)) out.push(id); } return out; }
// is (x, y) in the cave (world/caves.js plan C: its band, its open floor)? (the Cave Rat's clock)
export const inCave = (C, x, y) => !!C && x >= C.band.x0 && x <= C.band.x1 && y >= C.band.y0 && y <= C.band.y1 && C.inside(x, y) < 0;

// id -> {skill, lvl, id, name, line, soon}
export const MOVE_BY_ID = {};
for (const sk in MOVES) for (const m of MOVES[sk]) MOVE_BY_ID[m.id] = {...m, skill: sk};
// does someone at these levels ({skill: level}) have move `id` (a built one)? (pure: the client's pack.move, the server's checks)
export function hasMove(levels, id) { const m = MOVE_BY_ID[id]; return !!m && !m.soon && (levels[m.skill] || 0) >= m.lvl; }
// the built moves a skill gives at level L: just reached (the toast's: the one whose lvl is L) / all had / the next one's level
export const moveAt = (skill, L) => (MOVES[skill] || []).find(m => !m.soon && m.lvl === L) || null;
export const movesHad = (skill, L) => (MOVES[skill] || []).filter(m => !m.soon && m.lvl <= L);
export const nextMoveLvl = (skill, L) => (MOVES[skill] || []).find(m => !m.soon && m.lvl > L)?.lvl || 0;
