// THE ALMANAC (data; docs/ALMANAC.md): the first loop. Six chapters that walk the persistent world's systems in the order they
// need each other (the forest -> the cave -> fire down there -> the furnace -> iron -> the dark itself), and "Today": three small
// things a world's day, rolled from its seed and its day number (the same for every player in that world). Pure data and pure
// rules (features/almanac.js counts them; nothing on the server: every count is of something the server already decided).
//   CHAPTERS  [{id, name, goals: [GOAL], page (torn out when it's done: a hint, never an explanation), gift: {item: n}}]
//   GOAL      {id, text, n (how many), on: the event type it counts (core/events.js), ok(e, C)?: this event counts,
//             amt(e)?: how much it counts (1), state(C)?: a count read from the world (looked at every second instead of an event;
//             it latches: once met it stays met), hint (the line the pack panel shows under it), where?: what the pointer points at
//             (features/almanac.js WHERE: 'cave' the cave's mouth, 'camp' the miner's camp, 'vein' / 'copper' / 'iron' / 'night'
//             the nearest unspent vein of that kind, 'hollow' nothing: it's a secret)}
//   C         the feature's context: {cave(x, y) (in the cave), level(skill), levels (the highest), count(id), part ('day' |
//             'dusk' | 'night' | 'dawn'), nightLit() (his Nightglass light is on beside a night vein that shows)}
//   TODAY     the pool Today's three are rolled from ({id, text, n, on, ok?, amt?, party?: online it is the party's: everyone's
//             counts (the solo text without "Between you: ")}), gifts a goal (GIFTS) and for all three (BONUS)
//   rollToday(seed, day, online) -> [3 TODAY entries] (deterministic; the third is a party goal online)
import {isFish} from './fishing.js';

const berry = k => k === 'blueberry' || k === 'lingonberry';
export const OLD_OAK = 1.5;   // (content/woodcut.js TREES.oak.old: no forest of today grows one, so no goal asks for one yet)

export const CHAPTERS = [
  {id: 'smoke', name: 'I. Smoke', goals: [
    {id: 'fell', text: 'Fell 3 trees', n: 3, on: 'tree.fell', ok: e => e.mine !== false, hint: 'LMB on a trunk, or hold E facing one. The axe is in your bag.'},
    {id: 'berries', text: 'Pick 12 berries', n: 12, on: 'forage.pick', ok: e => e.mine && berry(e.kind), amt: e => e.n || 1, hint: 'E by a blueberry or lingonberry patch under the pines. Hold E and walk.'},
    {id: 'fire', text: 'Build a campfire', n: 1, on: 'build.add', ok: e => e.mine && e.kind === 'campfire', hint: 'Tab > Build > Campfire (4 logs).'},
    {id: 'eat', text: 'Cook something and eat it', n: 1, on: 'meal.cook', hint: 'By a burning fire: Tab > Cook journal, five blueberries on the Try stick, pull it out when it\'s golden.'},
  ], page: 'Where the pines thin out to the east, a slot runs down under the hill. Somebody left a pick down there, by a candle stub.',
    gift: {chanterelles: 3}},
  {id: 'down', name: 'II. Down', goals: [
    {id: 'down', text: 'Go down into the cave', n: 1, on: 'player.warp', ok: e => !!e.down, state: C => C.cave() ? 1 : 0, where: 'cave', hint: 'The slot in the hillside. Your lantern lights by itself down there.'},
    {id: 'pick', text: 'Take the old pick', n: 1, on: 'mine.take', state: C => C.count('pick') + C.count('iron_pick') > 0 ? 1 : 0, where: 'camp', hint: 'In the first room: a rotted crate, a candle stub, the pick driven into the wall. E.'},
    {id: 'veins', text: 'Break 3 veins', n: 3, on: 'mine.spent', ok: e => e.n > 0, where: 'vein', hint: 'Pale streaks at the walls\' feet. E or LMB; press again just as a swing ends and it bites harder.'},
    {id: 'copper', text: 'Carry 4 copper ore', n: 4, state: C => C.count('copper_ore'), where: 'copper', hint: 'Green and rust lumps in the walls.'},
  ], page: 'Fish bite where the water rings. A rod goes in your main hand (Tab, the gear panel). Something just right comes off the stick the moment the fat drips.',
    gift: {stone: 4}},
  {id: 'hearth', name: 'III. Hearth', goals: [
    {id: 'light', text: 'Set a fire ring or a lamp down in the cave', n: 1, on: 'build.add', ok: (e, C) => e.mine && (e.kind === 'fire_ring' || e.kind === 'crystal_lamp') && C.cave(e.x, e.y), hint: 'Tab > Build: a Stone Fire Ring (6 stone, 2 logs) or a Crystal Lamp (3 glow shards, 2 copper ore, 1 log).'},
    {id: 'right', text: 'Cook something just right', n: 1, on: 'meal.cook', ok: e => e.q === 'right', hint: 'Pull it out of the fire the moment the fat drips and the fire flares.'},
    {id: 'fish', text: 'Land a fish', n: 1, on: 'fish.catch', ok: e => isFish(e.id), hint: 'A rod in your main hand, LMB on water: let go at the top of the meter, strike at the bite.'},
    {id: 'skill', text: 'Reach level 3 in any skill', n: 3, state: C => C.levels(), hint: 'Every skill grows by doing it.'},
  ], page: 'Iron sits too hard for an old pick. But rock that has had a fire burning beside it a while cracks along its seams.',
    gift: {copper_ore: 2}},
  {id: 'bars', name: 'IV. Bars', goals: [
    {id: 'furnace', text: 'Build a clay furnace', n: 1, on: 'build.add', ok: e => e.mine && e.kind === 'furnace', hint: 'Tab > Build > Clay Furnace (12 stone, 2 logs). E feeds it a log.'},
    {id: 'copper', text: 'Smelt a copper bar', n: 1, on: 'smith.smelt', ok: e => e.mine && e.bar === 'copper_bar', hint: 'Tab by the burning furnace: Load copper (2 ore). A fire alone gets it to red; that\'s enough.'},
    {id: 'bellows', text: 'Fit a bellows to a furnace', n: 1, on: 'smith.fit', ok: e => e.mine, hint: 'Tab by the furnace: Fit a bellows (2 copper bars, 1 log).'},
    {id: 'crack', text: 'Crack an iron vein with fire', n: 1, on: 'vein.crack', ok: e => e.on, where: 'iron', hint: 'A campfire or fire ring burning within a couple of steps of an iron vein, for a while.'},
    {id: 'iron', text: 'Smelt an iron bar', n: 1, on: 'smith.smelt', ok: e => e.mine && e.bar === 'iron_bar', hint: 'Load iron (3 ore) and pump (LMB on the furnace, in rhythm) until it burns yellow-white. A friend pumping helps.'},
  ], page: 'An anvil is eight stones and an oak log. Birch hafts swing quick; oak lands heavy; pine can be lit.',
    gift: {log: 2}},
  {id: 'iron', name: 'V. Iron', goals: [
    {id: 'anvil', text: 'Set down a stone anvil', n: 1, on: 'build.add', ok: e => e.mine && e.kind === 'anvil', hint: 'Tab > Build > Stone Anvil (8 stone, 1 oak log).'},
    {id: 'tool', text: 'Forge an iron pick or an iron axe', n: 1, on: 'smith.make', ok: e => e.item === 'iron_pick' || e.item === 'iron_axe', hint: 'Tab by the anvil: pick it, a haft, lay it on, LMB hammers. A blow in rhythm counts two.'},
    {id: 'vein', text: 'Break an iron vein', n: 1, on: 'mine.spent', ok: e => e.n > 0 && e.kind === 'iron', where: 'iron', hint: 'The dark blue-grey ones, deep in the cave.'},
    {id: 'hollow', text: 'Break into a hollow wall', n: 1, on: 'mine.open', hint: 'Somewhere down there your lantern\'s flame leans toward the rock, and dust trickles down it.'},
  ], page: 'Some rock shows only in the dark: put your light out (L) deep in the cave and wait. What you dig there melts only white-hot.',
    gift: {glow_shard: 2}},
  {id: 'night', name: 'VI. Nightglass', goals: [
    {id: 'ore', text: 'Dig night ore in the dark', n: 1, on: 'mine.spent', ok: e => e.n > 0 && e.kind === 'night', where: 'night', hint: 'Lantern out (L), far in the cave: it glimmers like a piece of the night sky.'},
    {id: 'glass', text: 'Smelt Nightglass', n: 1, on: 'smith.smelt', ok: e => e.mine && e.bar === 'nightglass', hint: 'Load night ore and pump it white: the bellows, every pump in rhythm, or a friend.'},
    {id: 'lantern', text: 'Forge the Nightglass Lantern', n: 1, on: 'smith.make', ok: e => e.item === 'nightglass_lantern', hint: 'At the anvil: Nightglass, an iron bar, a copper bar. Wear it in your off hand.'},
    {id: 'see', text: 'Carry its light to a night vein', n: 1, state: C => C.nightLit() ? 1 : 0, where: 'night', hint: 'Its light is dark: what hides in the dark stays shown in it.'},
  ], page: 'You carry the night now. The soot things can\'t see it, and the dark keeps its secrets shown for you.',
    gift: {}},
];
export const CHAPTER_IDS = CHAPTERS.map(c => c.id);

// ---------------------------------------------------------------- Today
// party: online the count is everyone's (a friend's fell, a friend's pick: the events every client sees)
export const TODAY = [
  {id: 'blue', text: 'Pick 15 blueberries', n: 15, on: 'forage.pick', ok: e => e.mine && e.kind === 'blueberry', amt: e => e.n || 1},
  {id: 'lingon', text: 'Pick 15 lingonberries', n: 15, on: 'forage.pick', ok: e => e.mine && e.kind === 'lingonberry', amt: e => e.n || 1},
  {id: 'shrooms', text: 'Pick 4 chanterelles', n: 4, on: 'forage.pick', ok: e => e.mine && e.kind === 'chanterelles', amt: e => e.n || 1},
  {id: 'birch', text: 'Fell 2 birches', n: 2, on: 'tree.fell', ok: e => e.mine !== false && e.species === 'birch'},
  {id: 'pine', text: 'Fell 3 pines', n: 3, on: 'tree.fell', ok: e => e.mine !== false && e.species === 'pine'},
  {id: 'fish', text: 'Land 2 fish', n: 2, on: 'fish.catch', ok: e => isFish(e.id), amt: e => e.n || 1},
  {id: 'dusk', text: 'Land a fish after dark', n: 1, on: 'fish.catch', ok: (e, C) => isFish(e.id) && C.part !== 'day'},
  {id: 'right', text: 'Cook something just right', n: 1, on: 'meal.cook', ok: e => e.q === 'right'},
  {id: 'veins', text: 'Break 4 veins', n: 4, on: 'mine.spent', ok: e => e.n > 0},
  {id: 'stone', text: 'Carry home 8 stone', n: 8, on: 'pack.add', ok: e => e.id === 'stone', amt: e => e.n || 1},
  {id: 'bar', text: 'Smelt a bar', n: 1, on: 'smith.smelt', ok: e => e.mine},
  {id: 'shards', text: 'Carry home 3 glow shards', n: 3, on: 'pack.add', ok: e => e.id === 'glow_shard', amt: e => e.n || 1},
  // party goals (the third of Today's three; offline the same without "Between you")
  {id: 'p_fell', text: 'Between you: fell 8 trees', n: 8, on: 'tree.fell', party: true},
  {id: 'p_pick', text: 'Between you: forage 10 patches', n: 10, on: 'forage.pick', party: true},
  {id: 'p_veins', text: 'Between you: break 6 veins', n: 6, on: 'mine.spent', party: true},
  {id: 'p_fish', text: 'Between you: land 4 fish', n: 4, on: 'fish.catch', ok: e => isFish(e.id), party: true},
];
export const TODAY_BY_ID = Object.fromEntries(TODAY.map(t => [t.id, t]));
// a goal of Today done: one of these (rolled); all three: BONUS's (by the day)
export const GIFTS = [{stone: 4}, {copper_ore: 2}, {glow_shard: 1}, {chanterelles: 2}, {pine_log: 2}, {iron_ore: 1}, {birch_log: 2}, {blueberries: 5}];
export const BONUS = [{night_ore: 1}, {iron_ore: 3}, {glow_shard: 3}, {copper_bar: 1}];
export const TODAY_FROM = 1;   // Today shows once this many chapters are done

// a small hash of the world's seed, its day and a slot (the same on every client)
function h32(seed, day, k) {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((day | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(k + 1, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}
// Today's three for a world's day: two solo goals (different kinds), then a party goal
export function rollToday(seed, day) {
  const solo = TODAY.filter(t => !t.party), party = TODAY.filter(t => t.party), out = [];
  const kind = t => t.on;
  for (let k = 0; out.length < 2 && k < 40; k++) {
    const t = solo[h32(seed, day, k) % solo.length];
    if (!out.includes(t) && !out.some(o => kind(o) === kind(t))) out.push(t);
  }
  out.push(party[h32(seed, day, 99) % party.length]);
  return out;
}
export const giftOf = (seed, day, i) => GIFTS[h32(seed, day, 200 + i) % GIFTS.length];
export const bonusOf = (seed, day) => BONUS[h32(seed, day, 300) % BONUS.length];
// a party goal offline: its text without "Between you: " (it counts only his own)
export const soloText = t => t.party ? t.text.replace(/^Between you: (\w)/, (_, c) => c.toUpperCase()) : t.text;
// does event e count for goal g, and by how much? (mine: the party's counts take friends' events too)
export function countOf(g, e, C, party = false) {
  if (g.on !== e.type) return 0;
  if (g.party && !party && e.mine === false) return 0;
  if (g.party && !party && (e.type === 'forage.pick' || e.type === 'mine.spent') && !e.mine && !(e.n > 0)) return 0;   // (offline every event is his)
  if (g.ok && !g.ok(e, C)) return 0;
  return g.amt ? Math.max(0, g.amt(e) | 0) : 1;
}
