// FISHING (data; docs/FISHING.md): what bites where, how it fights, what fishing gear does. Pure data and pure functions (one
// import: core/mathx.js hash3, pure too): the browser (features/fishing.js, content/items.js, ui/geartip.js) and the co-op server (server/room.mjs: it rolls
// the catch) read this one file.
//   WATERS   world.js waterSample's kinds -> the water they are to a fish: 'lake' (the forest's lake), 'stream' (the forest
//            stream, the plateau's rill, the West Downs' brook), 'river' (the Proving Grounds' river, its pool, the lake's outflow)
//   CATCHES  every fish and find: id, name, rarity (content/gear.js RARITY's keys: common .. mythic), where (waters), when
//            (a weight per env.part: dawn, day, dusk, night; 0 = never then), rain (a weight while it rains), deep (a deep-water
//            fish: closer than DEEP m to the shore its weight is divided by 2 x deep), cm [min, max], kg (weight = kg x (cm / 10)^3), fight
//            {stam: s of reeling it takes, pull: how hard a surge strains the line, surge: surges a second, dart: how far it
//            darts across (m)}, xp, desc, icon (a fish drawn by fishIcon: body len / depth px, colours, marks) or rows (a
//            12 x 12 picture, content/items.js's way) + pal
//   STATS    the fishing stats gear gives (host.mods notes 'fish.*', set by features/gear.js from content/gear.js pieces): what
//            each does and how it reads in the gear card (statWords)
//   TUNE     the cast, the wait, the hook, the fight: features/fishing.js reads these
//   roll(rng, o) -> {id, cm, kg, wait, nibbles}   the catch for a cast (o: water, part, rain, deep, luck, find, size, lure,
//            perfect, spot, bait): the game offline and the server in co-op draw the same way
//   SPOT     fishing spots: rises and bubbles on the water (features/fishing.js finds them; a cast into one bites sooner, rarer)
//            spotAt(a, b, slot, seed, out) (the cell's spot), spotNear(x, y, slot, seed) (the server's check of a cast's word)
//   BAITS    what goes on the hook (cut from small fish at the pack panel; one a cast while you have it): prey weights
//   ANGLER   the fishing set: ANGLER.n fishing pieces worn at once give its notes (source 'fishing.set')
//   castNotes(o) -> notes   the notes a cast is rolled with besides the gear's: the skill's, the set's, the meal's (content/meals.js; the server
//            builds the same from what it knows; the client has them in host.mods)
import {hash3} from '../core/mathx.js';
export const WATERS = {1: 'river', 2: 'stream', 3: 'river', 4: 'stream', 5: 'stream', 6: 'stream', 7: 'lake', 8: 'river'};
export const WATER_NAMES = {lake: 'the lake', stream: 'the stream', river: 'the river'};
export const DEEP = 3;   // m from the shore: the lake's deep water (char, zander; the forest lake is small: its middle is ~3-5 m out)
export const RARITY_W = {common: 60, fine: 26, rare: 10, masterwork: 3.4, mythic: .6};   // the base odds by rarity (before luck)
export const RARITY_TIER = {common: 0, fine: 1, rare: 2, masterwork: 3, mythic: 4};

export const TUNE = {
  cast: {min: 2.5, max: 9, period: 1.5, perfect: .93, luck: .15, fly: .55, arc: 1.4},   // m; a charge's up-and-down (s); the
                                                                                       // perfect top; its luck; the bobber's flight (s), its arc (m)
  wait: [3.5, 10],        // s from the plop to the bite (x the lure stat)
  nibble: [0, 3],         // nibbles before the bite (the bobber dips: a press then is too early, and spooks it)
  spook: 2.5,             // s added to the wait by a press on a nibble
  hook: .8,               // s to press after the bite (+ fish.hook)
  rebite: [2, 5],         // s to the next bite after a miss (the bobber stays out)
  reel: {speed: 1, rise: .24, fall: 1.1, slack: .04, taken: .14, tell: .38, gone: 4},   // reeling: progress a second (x stats / stam),
                          // tension a second while reeling, its fall when you let go, line taken back a second when you let go
                          // (and during a surge), the surge's warning (s), s at full line out before it gets away
  surge: {len: [.45, .9]},   // a surge's length (s)
  stray: 1.6,             // m he may step from where he cast before the line comes in
  find: .08,              // the base chance a cast brings up a find instead of a fish
};

// ---------------------------------------------------------------- the stats fishing gear gives (notes in host.mods)
//   add: added to the base (0 unless said); mul: the base multiplied. features/fishing.js reads each as mods.value(stat, base)
export const STATS = {
  'fish.luck':   {base: 0, desc: 'luck: rarer fish bite'},                         // add: shifts the rarity odds (x (1 + luck) per tier)
  'fish.lure':   {base: 1, desc: 'lure: bites come sooner'},                       // mul on the wait (.8 = 20 % sooner)
  'fish.reel':   {base: 1, desc: 'reel: the line comes in faster'},                // mul on reeling
  'fish.line':   {base: 1, desc: 'line: takes more strain before it snaps'},       // mul on the tension the line holds
  'fish.cast':   {base: 1, desc: 'cast: reaches further'},                         // mul on the cast's reach
  'fish.hook':   {base: 0, desc: 'hook: more time to strike'},                      // add s to the hook window
  'fish.double': {base: 0, desc: 'a chance of two fish at once'},                  // add: chance
  'fish.find':   {base: 0, desc: 'finds: more things that aren\'t fish'},          // add: chance
  'fish.size':   {base: 1, desc: 'bigger fish'},                                   // mul on the size drawn
  'fish.net':    {base: 0, desc: 'a landing net: the last stretch lands itself'},  // add: the share of the fight the net takes
  'fish.night':  {base: 0, desc: 'at night bites come much sooner'},                // add: share off the wait at night
  'fish.rain':   {base: 0, desc: 'luck in the rain'},                               // add: luck while it rains
};
const pct = v => Math.round(v * 100) + '%';
// a fishing note in words for the gear card (ui/geartip.js doesOf), or '' (not a fishing note)
export function statWords(n) {
  const s = n.stat, m = n.mul, a = n.add;
  if (s === 'fish.luck') return `fishing luck +${pct(a)}`;
  if (s === 'fish.lure') return `bites come ${pct(1 - m)} sooner`;
  if (s === 'fish.reel') return `reels ${pct(m - 1)} faster`;
  if (s === 'fish.line') return `the line holds ${pct(m - 1)} more strain`;
  if (s === 'fish.cast') return `casts ${pct(m - 1)} further`;
  if (s === 'fish.hook') return `+${a.toFixed(2)} s to strike`;
  if (s === 'fish.double') return `${pct(a)} chance of two fish`;
  if (s === 'fish.find') return `+${pct(a)} chance of a find`;
  if (s === 'fish.size') return `fish ${pct(m - 1)} bigger`;
  if (s === 'fish.net') return `the net lands the last ${pct(a)}`;
  if (s === 'fish.night') return `at night bites come ${pct(a)} sooner`;
  if (s === 'fish.rain') return `fishing luck +${pct(a)} in the rain`;
  return '';
}
// a set's fishing stats from its pieces' notes (the server: it has the set, not the game's host.mods): {stat: value}
export function statsOf(notes) {
  const v = {}; for (const k in STATS) v[k] = STATS[k].base;
  const mul = {}; for (const n of notes) { if (!(n.stat in STATS)) continue; if (n.add) v[n.stat] += n.add; if (n.mul !== undefined) mul[n.stat] = (mul[n.stat] ?? 1) * n.mul; }
  for (const k in mul) v[k] *= mul[k];
  return v;
}

// ---------------------------------------------------------------- the catches
const ANY = {dawn: 1, day: 1, dusk: 1, night: 1};
export const CATCHES = {
  // ---- common
  perch: {name: 'Perch', rarity: 'common', where: ['lake', 'river'], when: {dawn: 1, day: 1.4, dusk: 1, night: .3}, cm: [12, 38], kg: .012, xp: 6,
    fight: {stam: 2.2, pull: .6, surge: .25, dart: .6}, desc: 'An abborre: green with dark bars, red fins, a spiny back.',
    icon: {len: 8, depth: 5, back: '#4f6a2a', body: '#9bb04a', belly: '#e8e2a8', fin: '#d8502c', mark: '#2f3f1c', marks: 'bars', dorsal: 2}},
  roach: {name: 'Roach', rarity: 'common', where: ['lake', 'river', 'stream'], when: ANY, cm: [10, 32], kg: .011, xp: 5,
    fight: {stam: 2, pull: .5, surge: .2, dart: .5}, desc: 'A mört: silver scales, red eyes and red fins.',
    icon: {len: 8, depth: 4, back: '#5d7280', body: '#c8d2d8', belly: '#f2f4f2', fin: '#d04a3a', eye: '#c02a20', dorsal: 1}},
  bleak: {name: 'Bleak', rarity: 'common', where: ['lake', 'stream'], when: {dawn: 1, day: 1.5, dusk: 1, night: .2}, cm: [8, 18], kg: .008, xp: 4,
    fight: {stam: 1.4, pull: .35, surge: .3, dart: .9}, desc: 'A löja: a quick little silver fish that shoals at the top.',
    icon: {len: 7, depth: 3, back: '#7a8c96', body: '#dfe6ea', belly: '#ffffff', fin: '#b8c4ca', dorsal: 1}},
  minnow: {name: 'Minnow', rarity: 'common', where: ['stream'], when: {dawn: 1, day: 1.4, dusk: 1, night: .3}, cm: [5, 11], kg: .01, xp: 4,
    fight: {stam: 1.2, pull: .3, surge: .35, dart: .7}, desc: 'An elritsa: a stream\'s tiny fish, gold-flanked, in a crowd.',
    icon: {len: 6, depth: 3, back: '#4a5a32', body: '#b8a85a', belly: '#e8d07a', fin: '#8a7a42', mark: '#3a4426', marks: 'blots', dorsal: 1}},
  // ---- fine
  pike: {name: 'Pike', rarity: 'fine', where: ['lake', 'river'], when: {dawn: 1.6, day: .9, dusk: 1.6, night: .5}, cm: [40, 115], kg: .0062, xp: 16,
    fight: {stam: 5.5, pull: 1.15, surge: .5, dart: 1.4}, desc: 'A gädda: long, green, all teeth. It hangs still, then strikes.',
    icon: {len: 10, depth: 3, back: '#3a5a2a', body: '#7e9a48', belly: '#e0dca0', fin: '#a8823a', mark: '#d8d890', marks: 'spots', snout: 1, dorsal: 1, rear: true}},
  trout: {name: 'Brown Trout', rarity: 'fine', where: ['stream', 'river'], when: {dawn: 1.4, day: 1, dusk: 1.4, night: .4}, rain: 1.8, cm: [20, 62], kg: .011, xp: 14,
    fight: {stam: 3.8, pull: .85, surge: .45, dart: 1.1}, desc: 'An öring: bronze, black and red spots. Rain wakes it.',
    icon: {len: 9, depth: 4, back: '#5a4a28', body: '#b8963e', belly: '#ecdcaa', fin: '#8a6a30', mark: '#2a1e10', marks: 'spots', mark2: '#c83a2a', dorsal: 1}},
  bream: {name: 'Bream', rarity: 'fine', where: ['lake'], when: {dawn: .7, day: .6, dusk: 1.6, night: 1.6}, cm: [30, 62], kg: .016, xp: 13,
    fight: {stam: 3.6, pull: .7, surge: .25, dart: .5}, desc: 'A braxen: deep as a plate, bronze, slimy, slow and heavy.',
    icon: {len: 8, depth: 7, back: '#4a3e22', body: '#a88a46', belly: '#d8c48a', fin: '#5a4a2a', dorsal: 2}},
  tench: {name: 'Tench', rarity: 'fine', where: ['lake'], when: {dawn: 1.8, day: .7, dusk: 1.2, night: .8}, cm: [25, 55], kg: .014, xp: 13,
    fight: {stam: 3.4, pull: .8, surge: .3, dart: .6}, desc: 'A sutare: olive and gold, with tiny red eyes. Fond of the mud.',
    icon: {len: 8, depth: 5, back: '#2e3e1e', body: '#6a7a32', belly: '#b8b45a', fin: '#2e3a1e', eye: '#c02a20', dorsal: 1}},
  // ---- rare
  zander: {name: 'Zander', rarity: 'rare', where: ['lake'], when: {dawn: .8, day: .3, dusk: 1.5, night: 2}, deep: 2.2, cm: [40, 85], kg: .009, xp: 30,
    fight: {stam: 5, pull: 1.05, surge: .45, dart: 1}, desc: 'A gös: glassy eyes for the dark, a sharp back fin. Deep water.',
    icon: {len: 10, depth: 4, back: '#4a5a52', body: '#a8b8a8', belly: '#eef0e8', fin: '#6a7a6a', mark: '#3a4a42', marks: 'bars', eye: '#f2f2c8', dorsal: 2}},
  grayling: {name: 'Grayling', rarity: 'rare', where: ['stream'], when: {dawn: 1.2, day: 1.3, dusk: 1, night: .2}, cm: [25, 48], kg: .009, xp: 28,
    fight: {stam: 4, pull: .9, surge: .55, dart: 1.2}, desc: 'A harr: a great sail of a back fin, purple and red. Smells of thyme.',
    icon: {len: 9, depth: 4, back: '#4a4a62', body: '#a8a8b8', belly: '#e8e4ec', fin: '#a03a6a', mark: '#2a2a3a', marks: 'spots', dorsal: 4}},
  char: {name: 'Arctic Char', rarity: 'rare', where: ['lake'], when: ANY, deep: 3, cm: [25, 60], kg: .011, xp: 32,
    fight: {stam: 4.4, pull: 1, surge: .5, dart: 1}, desc: 'A röding: a cold-water fish with a belly like a sunset.',
    icon: {len: 9, depth: 4, back: '#3a4a5a', body: '#8aa0a8', belly: '#e8642a', fin: '#e8642a', mark: '#f0e0c0', marks: 'spots', dorsal: 1}},
  burbot: {name: 'Burbot', rarity: 'rare', where: ['lake', 'river'], when: {dawn: .3, day: 0, dusk: .6, night: 2.4}, cm: [30, 75], kg: .0055, xp: 30,
    fight: {stam: 4.2, pull: .9, surge: .35, dart: .7}, desc: 'A lake: a mottled night fish with a single whisker under its chin.',
    icon: {len: 10, depth: 3, back: '#3a3420', body: '#7a6a3a', belly: '#c8b882', fin: '#5a4e2a', mark: '#2a2414', marks: 'blots', barbel: true, dorsal: 0, rear: true, tail: 'round'}},
  // ---- masterwork
  eel: {name: 'Eel', rarity: 'masterwork', where: ['river', 'lake'], when: {dawn: .2, day: 0, dusk: .8, night: 2}, rain: 1.6, cm: [50, 110], kg: .0016, xp: 60,
    fight: {stam: 6, pull: 1.25, surge: .7, dart: 1.5}, desc: 'An ål: it came from the far sea to this water. It will not give up.',
    icon: {len: 11, depth: 2, back: '#2a2a1a', body: '#5a5232', belly: '#c8bc7a', fin: '#3a3420', dorsal: 0, rear: true, tail: 'round'}},
  salmon: {name: 'Salmon', rarity: 'masterwork', where: ['river'], when: {dawn: 1.4, day: .8, dusk: 1.4, night: .4}, rain: 2, cm: [55, 115], kg: .0105, xp: 64,
    fight: {stam: 7, pull: 1.3, surge: .55, dart: 1.6}, desc: 'A lax: silver from the sea, going up. It leaps.',
    icon: {len: 10, depth: 4, back: '#4a5a6a', body: '#c8d4dc', belly: '#ffffff', fin: '#6a7a8a', mark: '#2a3442', marks: 'spots', dorsal: 1}},
  // ---- mythic: the water's odd ones (docs/FISHING.md: weird on purpose)
  fiddlefish: {name: 'Näcken\'s Fiddle', rarity: 'mythic', where: ['stream', 'river', 'lake'], when: {dawn: .4, day: 0, dusk: .6, night: 1.6}, cm: [58, 62], kg: .002, xp: 150,
    fight: {stam: 6, pull: 1.1, surge: .8, dart: 1.8}, desc: 'A fiddle that swims. It plays itself when the water is still. Someone wants it back.',
    rows: ['............', '...........e', '..........e.', '...bbb...e..', '..bbbbb.e...', '...bsb.e....', '..bbsbbb....', '.bbbsbbbb...', '.bbbsbbbb...', '.bbbbbbbb...', '..bbbbbb....', '...bbbb.....'],
    pal: {b: '#a85a2a', s: '#2a1a10', e: '#e8d8a8'}},
  manyeye: {name: 'Thousand-eye', rarity: 'mythic', where: ['lake'], when: {dawn: 1, day: .2, dusk: 1, night: 1.2}, deep: 2, cm: [40, 90], kg: .012, xp: 160,
    fight: {stam: 5.5, pull: 1.2, surge: .65, dart: 1.4}, desc: 'A carp with too many eyes. All of them follow you.',
    icon: {len: 9, depth: 5, back: '#6a5a3a', body: '#b89a5a', belly: '#e8d8a8', fin: '#8a6a3a', mark: '#f8f8f0', marks: 'eyes', dorsal: 2}},
  // ---- finds (not fish): fight light, no size worth noting
  old_boot: {name: 'Old Boot', rarity: 'common', find: true, where: ['lake', 'river', 'stream'], when: ANY, cm: [26, 30], kg: 0, xp: 2,
    fight: {stam: 1.2, pull: .2, surge: 0, dart: .1}, desc: 'Someone walked home with one wet foot.',
    rows: ['............', '...bbbb.....', '...bdbb.....', '...bbbb.....', '...bbbb.....', '...bbbb.....', '...bbbbb....', '...bbbbbbb..', '..bbbbbbbbb.', '..dddddddddd', '............', '............'],
    pal: {b: '#6a4a2e', d: '#3a281a'}},
  driftwood: {name: 'Driftwood', rarity: 'common', find: true, where: ['lake', 'river', 'stream'], when: ANY, cm: [40, 60], kg: 0, xp: 2,
    fight: {stam: 1.4, pull: .25, surge: 0, dart: .1}, desc: 'Grey, smooth and light. It burns well once dry.',
    rows: ['............', '............', '..........g.', '.........gg.', '......ggggl.', '...gggglll..', '.gggglll....', 'gglll.......', '.l..........', '............', '............', '............'],
    pal: {g: '#a8a498', l: '#6e6a60'}},
  rusty_key: {name: 'Rusty Key', rarity: 'fine', find: true, where: ['lake', 'river'], when: ANY, cm: [8, 10], kg: 0, xp: 8,
    fight: {stam: 1, pull: .2, surge: 0, dart: .1}, desc: 'A heavy old key. It fits nothing you have seen. Yet.',
    rows: ['............', '...rrr......', '..r...r.....', '..r...r.....', '...rrrd.....', '......d.....', '......dd....', '......d.....', '......dd....', '......d.....', '............', '............'],
    pal: {r: '#b8642a', d: '#7a3e1a'}},
  note_bottle: {name: 'Bottle with a Note', rarity: 'rare', find: true, where: ['lake', 'river'], when: ANY, cm: [24, 26], kg: 0, xp: 20,
    fight: {stam: 1.6, pull: .2, surge: 0, dart: .2}, desc: 'The note inside says: "Don\'t fish at night by the still water. It looks back."',
    rows: ['............', '.....cc.....', '.....gg.....', '.....gg.....', '....gggg....', '...gwwwwg...', '...gwwwwg...', '...gwwwwg...', '...gggggg...', '...gggggg...', '....gggg....', '............'],
    pal: {c: '#8a5a2a', g: '#5a9a6a', w: '#f2ead0'}},
  silver_ring: {name: 'Silver Ring', rarity: 'masterwork', find: true, where: ['lake'], when: ANY, deep: 1.5, cm: [2, 2], kg: 0, xp: 40,
    fight: {stam: 1, pull: .2, surge: 0, dart: .1}, desc: 'A small ring, cold as the deep water. There is a name inside, worn away.',
    rows: ['............', '............', '.....b......', '....bwb.....', '...ssss.....', '..ss..ss....', '..s....s....', '..s....s....', '..ss..ss....', '...ssss.....', '............', '............'],
    pal: {s: '#d8dce4', b: '#6aa8e8', w: '#e8f4ff'}},
};
export const CATCH_IDS = Object.keys(CATCHES);
export const isFish = id => !!CATCHES[id] && !CATCHES[id].find;

// ---------------------------------------------------------------- the icons: a fish drawn from a few numbers (12 x 12 rows)
// Facing left: the head at x 1, the body len px long and depth px deep about row 6, the tail behind it; back / body / belly in
// three bands, the eye, a dorsal fin (dorsal px tall), marks ('bars', 'spots', 'blots', 'eyes').
// -> {rows, pal} for content/items.js (ui/packpanel.js draws it with an outline)
export function fishIcon(o) {
  const W = 12, R = Array.from({length: W}, () => Array(W).fill('.'));
  const len = o.len, dep = o.depth, cy = 6.5, x0 = 1, x1 = x0 + len - 1;
  const half = x => { const u = (x - x0 + .5) / len; return dep / 2 * Math.pow(Math.sin(Math.PI * Math.min(1, u * (o.rear ? .95 : 1.05))), o.rear ? .45 : .7); };
  let top = W, bot = 0;
  for (let x = x0; x <= x1; x++) {
    const h = Math.max(.6, half(x));
    for (let y = 0; y < W; y++) {
      const d = y + .5 - cy; if (Math.abs(d) > h + .01) continue;
      const k = (d + h) / (2 * h);
      R[y][x] = k < .34 ? 'a' : k < .7 ? 'b' : 'c';
      top = Math.min(top, y); bot = Math.max(bot, y);
    }
  }
  // the tail
  const tx = Math.min(W - 2, x1 + 1), round = o.tail === 'round';
  for (let y = 0; y < W; y++) {
    const d = Math.abs(y + .5 - cy);
    if (round) { if (d < Math.max(1, dep / 2)) R[y][tx] = 'f'; continue; }
    if (d < 1.2) R[y][tx] = 'f';
    if (d > .5 && d < Math.max(2, dep / 2 + .8) && tx + 1 < W) R[y][tx + 1] = 'f';
  }
  // the dorsal fin over the middle of the back, the belly fin under the front half
  const dm = Math.round(x0 + len * .5);
  for (let i = 0; i < (o.dorsal ?? 1); i++) for (let x = dm - 1; x <= dm + Math.min(2, i); x++) { const y = top - 1 - i; if (y >= 0 && x <= x1) R[y][x] = 'f'; }
  if (bot + 1 < W && dep >= 4) R[bot + 1][Math.round(x0 + len * .35)] = 'f';
  // marks
  const hash = (x, y) => ((x * 73856093) ^ (y * 19349663) ^ (len * 83492791)) >>> 0;
  for (let x = x0 + 2; x <= x1 - 1; x++) for (let y = top; y <= bot; y++) {
    const c = R[y][x]; if (c !== 'a' && c !== 'b') continue;
    if (o.marks === 'bars' && (x - x0) % 2 === 1 && c === 'b' || o.marks === 'bars' && (x - x0) % 2 === 1 && c === 'a' && hash(x, y) % 2) R[y][x] = 's';
    else if (o.marks === 'spots' && hash(x, y) % 5 === 0) R[y][x] = o.mark2 && hash(x, y) % 3 === 0 ? 't' : 's';
    else if (o.marks === 'blots' && hash(x, y) % 3 === 0) R[y][x] = 's';
    else if (o.marks === 'eyes' && hash(x, y) % 4 === 0) R[y][x] = 'v';
  }
  // the eye, a snout, a barbel
  const ey = Math.round(cy - .5 - Math.max(0, dep / 2 - 1.6));
  R[Math.max(top, Math.min(bot, ey))][x0 + 1] = 'e';
  if (o.snout) R[Math.round(cy - .5)][0] = 'a';
  if (o.barbel && bot + 1 < W) R[bot + 1][x0 + 1] = 'f';
  const pal = {a: o.back, b: o.body, c: o.belly, f: o.fin, s: o.mark || o.back, t: o.mark2 || o.mark || o.back, e: o.eye || '#141414', v: '#141414'};
  if (o.marks === 'eyes') pal.v = o.mark;   // (eyes: pale dots all over)
  return {rows: R.map(r => r.join('')), pal};
}
// a catch's 12 x 12 picture: {rows, pal}
const ICONS = {};
export const catchIcon = id => ICONS[id] ??= CATCHES[id].rows ? {rows: CATCHES[id].rows, pal: CATCHES[id].pal} : fishIcon(CATCHES[id].icon);

// ---------------------------------------------------------------- the roll: what bites, when, how big
// rng: () -> [0, 1) (the caller's own seeded generator). o: {water ('lake' | 'stream' | 'river'), part (env.part), rain (bool),
// deep (m from the shore), luck, find (chances added), size (mul), lure (mul on the wait), night (share off the wait at night),
// perfect (bool: a perfect cast), spot (bool: cast on a fishing spot: SPOT), bait (a BAITS id: its prey bite more), cls (a
// SHADOW class: a cast at a shadow's nose: a fish of its rarities, no find, unless the water has none of them), quick (the
// shadow's bite: SHADOW.bite s, no nibbles)}
// -> {id, cm, kg, wait (s), nibbles: [s ...] (before wait)}
export function roll(rng, o) {
  const luck = (o.luck || 0) + (o.perfect ? TUNE.cast.luck : 0) + (o.spot ? SPOT.luck : 0), prey = o.bait ? BAITS[o.bait]?.prey : null;
  const cls = SHADOW.cls[o.cls] || null;
  const isFind = rng() < TUNE.find + (o.find || 0) && !cls;
  let total = 0; const pick = [];
  for (let pass = cls ? 0 : 1; pass < 2 && !total; pass++) for (const id of CATCH_IDS) {   // (pass 0: the shadow's class only)
    const c = CATCHES[id]; if (!!c.find !== isFind || !c.where.includes(o.water) || (!pass && !cls.rar.includes(c.rarity))) continue;
    let w = (RARITY_W[c.rarity] || 1) * Math.pow(1 + Math.max(0, luck), RARITY_TIER[c.rarity] || 0) * (c.when[o.part] ?? 1);
    if (o.rain && c.rain) w *= c.rain;
    if (prey && prey[id]) w *= prey[id];
    if (c.deep && (o.deep || 0) < DEEP) w /= c.deep * 2;   // (a deep-water fish near the shore: rarely)
    if (w > 0) { pick.push(id, w); total += w; }
  }
  let id = pick[0] || 'old_boot';
  if (total > 0) { let r = rng() * total; for (let i = 0; i < pick.length; i += 2) { r -= pick[i + 1]; if (r <= 0) { id = pick[i]; break; } } }
  const c = CATCHES[id], u = rng();
  const cm = Math.round(Math.min(c.cm[1] * 1.15, (c.cm[0] + (c.cm[1] - c.cm[0]) * u * u) * (o.size || 1)) * 10) / 10;
  const kg = Math.round(c.kg * (cm / 10) ** 3 * 100) / 100;
  const nightK = o.part === 'night' ? 1 - Math.min(.8, o.night || 0) : 1;
  const u2 = rng(), wait = o.quick ? SHADOW.bite[0] + (SHADOW.bite[1] - SHADOW.bite[0]) * u2 : (TUNE.wait[0] + (TUNE.wait[1] - TUNE.wait[0]) * u2) * (o.lure || 1) * nightK * (o.spot ? SPOT.lure : 1);
  const n = o.quick ? (rng(), 0) : Math.floor(TUNE.nibble[0] + (TUNE.nibble[1] + 1 - TUNE.nibble[0]) * rng()), nibbles = [];
  for (let i = 0; i < n; i++) nibbles.push(Math.round(wait * (.25 + .65 * rng()) * 100) / 100);
  nibbles.sort((a, b) => a - b);
  return {id, cm, kg, wait: Math.round(wait * 100) / 100, nibbles};
}

// ---------------------------------------------------------------- fishing spots, bait, the angler's set
// SPOTS: the water is cut in cells of `cell` m; in each slot of `slot` s a cell holds a spot with chance `p`, at a hashed
// place in it (it must be water `edge` m from the bank). Casting within `r` m of one: the wait x lure, + luck. One catch
// from a spot spends it (for you). The slot clock is the world's (co-op: the server's), so friends see the same spots.
export const SPOT = {cell: 7, slot: 75, p: .24, r: 1.8, edge: .8, lure: .45, luck: .2, fade: 4};
// the spot cell (a, b) holds in slot `slot` of world `seed` -> writes {x, y} (world m) to out and returns true, or false: none.
// The hash only (the client also asks the water: SPOT.edge from the bank); the server checks a cast's word with it.
export function spotAt(a, b, slot, seed, out) {
  if (hash3(a, b, (slot ^ seed) | 0) >= SPOT.p) return false;
  out.x = (a + .15 + .7 * hash3(b, a, slot + 7)) * SPOT.cell; out.y = (b + .15 + .7 * hash3(a + 31, b, slot + 13)) * SPOT.cell;
  return true;
}
// is there a spot within SPOT.r (+ slack) of (x, y) in this slot or the one before (the server's check of a cast's word)
const SQ = {x: 0, y: 0};
export function spotNear(x, y, slot, seed, slack = .5) {
  const a0 = Math.floor(x / SPOT.cell), b0 = Math.floor(y / SPOT.cell), r = SPOT.r + slack;
  for (let s = slot - 1; s <= slot; s++) for (let a = a0 - 1; a <= a0 + 1; a++) for (let b = b0 - 1; b <= b0 + 1; b++)
    if (spotAt(a, b, s, seed, SQ) && Math.hypot(SQ.x - x, SQ.y - y) <= r) return true;
  return false;
}

// SHADOWS (Fishing 5, docs/SKILLS.md; one drawing for every brief: features/fishing.js draws them, other features ask it,
// shadowsNear): each live spot has one fish circling under it, all from the spot's hash, so every client and the server see the
// same one at the same clock. cls: its class (w: the share of spots, len: m long, rar: the rarities a cast at its nose
// rolls from); orbit: m round the spot (under SPOT.edge: it stays over the water), speed: m/s along it; a bobber landing within
// `nose` m of its head and `cone` deg of its heading draws it (a quick bite: `bite` s, no nibbles); within `spook` m of its
// body it bolts (the wait + TUNE.spook) and is gone for you till the slot turns
export const SHADOW = {
  cls: {small: {w: 60, len: .25, rar: ['common']}, medium: {w: 30, len: .5, rar: ['fine']}, large: {w: 10, len: .9, rar: ['rare', 'masterwork', 'mythic']}},
  orbit: [.35, .7], speed: [.22, .45], nose: 1.2, cone: 70, spook: .4, bite: [.8, 2],
};
const SH_CLS = Object.keys(SHADOW.cls), SH_W = SH_CLS.reduce((s, k) => s + SHADOW.cls[k].w, 0);
// the shadow under spot cell (a, b) in slot `slot` of world `seed` at clock t (s: the slot clock's) -> writes {x, y (its middle),
// hx, hy (unit: its heading), cls, len, sx, sy (the spot)} to out and returns true, or false: no spot there. Pure (the server's too)
export function shadowAt(a, b, slot, seed, t, out) {
  if (!spotAt(a, b, slot, seed, out)) return false;
  out.sx = out.x; out.sy = out.y;
  const h = k => hash3(a * 3 + k, b * 5 - k, (slot * 7 + seed + k) | 0);
  let u = h(1) * SH_W, cls = SH_CLS[0]; for (const k of SH_CLS) { u -= SHADOW.cls[k].w; if (u <= 0) { cls = k; break; } }
  const r = SHADOW.orbit[0] + (SHADOW.orbit[1] - SHADOW.orbit[0]) * h(2), v = SHADOW.speed[0] + (SHADOW.speed[1] - SHADOW.speed[0]) * h(3);
  const dir = h(4) < .5 ? -1 : 1, th = h(5) * Math.PI * 2 + dir * v / r * t;
  out.x = out.sx + Math.cos(th) * r; out.y = out.sy + Math.sin(th) * r;
  out.hx = -Math.sin(th) * dir; out.hy = Math.cos(th) * dir; out.cls = cls; out.len = SHADOW.cls[cls].len;
  return true;
}
// a bobber at (x, y) and the shadow `s` (shadowAt's out) -> 'nose' (just ahead of it: it bites) | 'spook' (on it: it bolts) | ''
export function shadowCast(s, x, y, slack = 0) {
  const nx = s.x + s.hx * s.len / 2, ny = s.y + s.hy * s.len / 2, dx = x - nx, dy = y - ny, d = Math.hypot(dx, dy);
  if (Math.hypot(x - s.x, y - s.y) <= SHADOW.spook + s.len / 2) return 'spook';
  if (d <= SHADOW.nose + slack && (dx * s.hx + dy * s.hy) / (d || 1) >= Math.cos(SHADOW.cone / 2 * Math.PI / 180)) return 'nose';
  return '';
}
// the server's check of a cast at (x, y): the shadows of the spots round it (this slot and the one before) at each of the clock
// times ts (s: a little latency's worth back) -> the first verdict that isn't '' ('nose' | 'spook'), with its class in out.cls
const SHQ = {x: 0, y: 0, sx: 0, sy: 0, hx: 0, hy: 0, cls: '', len: 0};
export function shadowVerdict(x, y, slot, seed, ts, out = SHQ) {
  const a0 = Math.floor(x / SPOT.cell), b0 = Math.floor(y / SPOT.cell);
  for (const t of ts) for (let s = slot - 1; s <= slot; s++) for (let a = a0 - 1; a <= a0 + 1; a++) for (let b = b0 - 1; b <= b0 + 1; b++) {
    if (!shadowAt(a, b, s, seed, t, out)) continue;
    const v = shadowCast(out, x, y, .25); if (v) return v;
  }
  return '';
}

export const COMMON_FISH = ['perch', 'roach', 'bleak', 'minnow'];
// BAITS: id -> {name, from (catches it is cut from), n (baits per fish), prey (weight x by catch), desc}
export const BAITS = {
  cut_bait: {name: 'Cut bait', from: ['roach', 'bleak', 'minnow'], n: 4,
    prey: {pike: 3, zander: 3, burbot: 3, eel: 2.5, trout: 2, salmon: 2, perch: 1.3},
    desc: 'Strips of small fish. Predators can\'t resist it: pike, zander, burbot, eel.',
    icon: ['............', '............', '..aa........', '.abba.......', '.abbbaa.....', '..abbbbaa...', '...aabbbbaa.', '.....aabbbba', '.......aabba', '.........aa.', '............', '............'],
    pal: {a: '#5a3a3a', b: '#d89a8a'}},
};
// the angler's set: ANGLER.n or more fishing pieces worn (any slots) -> its notes
export const ANGLER = {n: 4, name: 'Angler\'s set', notes: [{stat: 'fish.luck', add: .08}, {stat: 'fish.double', add: .05}, {stat: 'fish.hook', add: .15}],
  say: 'fishing luck +8%, a 5% chance of two fish, more time to strike'};
// the notes a cast is rolled with besides the gear's own (the server: it knows the set and the level; the meal is the client's word:
// its notes, content/meals.js mealNotes)
export function castNotes({lvl = 1, pieces = 0, meal = [], per = []}) {
  const out = [];
  for (const q of per) out.push(q.mul !== undefined ? {stat: q.stat, mul: 1 + q.mul * (lvl - 1)} : {stat: q.stat, add: (q.add || 0) * (lvl - 1)});
  if (pieces >= ANGLER.n) out.push(...ANGLER.notes);
  out.push(...meal);
  return out;
}
// where and when a catch bites, in a few words (the journal's hint for one not caught yet)
export function hintOf(id) {
  const c = CATCHES[id]; if (!c) return '';
  const w = c.where.map(x => x === 'lake' ? 'the lake' : x === 'river' ? 'rivers' : 'streams').join(', ');
  const top = Object.entries(c.when).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const when = top.length === 4 && top[3][1] >= top[0][1] * .8 ? 'any time' : ({dawn: 'at dawn', day: 'by day', dusk: 'at dusk', night: 'at night'})[top[0][0]];
  return `${w}; ${when}${c.rain > 1 ? ', in the rain' : ''}${c.deep ? ', deep water' : ''}`;
}
