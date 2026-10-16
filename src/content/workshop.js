// THE WORKSHOP (data; docs/WORKSHOP.md): what a Clay Furnace and a Stone Anvil turn the cave's ore and the forest's logs into, and
// what a made thing remembers. Pure data and pure functions: the browser (features/workshop.js, ui/workshoppanel.js, ui/madetip.js)
// and the co-op server (server/workshop.mjs) read this one file. The other depth builds feed it through two small doors: an item
// that is `wood` (content/items.js) is a log a haft and a fire take, and a recipe here names its makings by item id (a cost of
// 'wood' takes any log: game/inventory.js).
//   HEAT      a furnace's heat, 0 cold .. 1 white: a burning fire rests it at `rest`; it falls back fall x (heat - rest) a second
//             (to 0 at `cold` a second with no fire); a pump adds PUMP's; a charge cooks while heat >= its `heat`; above `white` the
//             fire eats its wood twice as fast. words(h): the glow in words (the panel says it so; no bars)
//   PUMP      what a pump adds: the birch blowpipe, a fitted bellows, x rhythm on a blow in rhythm (sim/player/tool.js); one per
//             `every` s each (the pump's swing: SWING.pump); `most` the server's clamp on one pump
//   CHARGES   a load of ore: n ore -> one bar, t s at its heat (?smelt= a factor); the bar is the loader's
//   BELLOWS   its cost; a furnace with one pumps at PUMP.bellows
//   SMITH     the anvil's work: what it costs (the haft is one more log of your choice: WOODS), what it makes (an item, or a piece
//             of gear: content/gear.js, worn, never in the bag); INLAY the glow-shard inlay on a pick or an axe (its cost, its light)
//   HAND      made by hand (the pack panel's Make list): a piece of gear and its cost
//   HAMMER    blows to finish a piece (a blow in rhythm counts `rhythm`)
//   WOODS     a log as a haft: its word, what it does (swing: x the swing's time; power: x the blow; lit: s a pine haft burns once lit at
//             a fire, and its light). The four woods without a trait make plain hafts
//   SWING     the jobs without a bag item (sim/player/tool.js SWINGS): pumping the furnace, hammering on the anvil
//   FIRESET   fire-setting (content/mining.js reads it): a burning fire within r m of an iron vein for t s cracks it for hours
//             in-game hours; a cracked vein asks one tier less and gives one chunk more
//   LINES     the history lines a record shows (counts and firsts) -> recLines(rec, all)
// A RECORD (a made thing): {u, item, maker, day, haft, inlay, counts: {fell, oldoak, veins, iron}, marks: [{k, day}]}; cleanRec(o)
// checks one from a save or a hello (unknown items dropped).
import {ITEMS} from './items.js';
import {GEAR_BY_ID} from './gear.js';
import {TUNE as WOOD} from './woodcut.js';

export const HEAT = {rest: .45, white: .9, fall: .35, cold: .12};
export const PUMP = {pipe: .05, bellows: .10, rhythm: 1.5, every: .6, most: .16};
export const CHARGES = {
  copper: {ore: 'copper_ore', n: 2, bar: 'copper_bar', t: 15, heat: .45, name: 'copper'},
  iron:   {ore: 'iron_ore',   n: 3, bar: 'iron_bar',   t: 20, heat: .86, name: 'iron'},   // (.86: one blowpipe alone, even every pump in rhythm, tops out ~.85)
};
export const BELLOWS = {cost: {copper_bar: 2, wood: 1}};
export const SMITH = {
  iron_pick:   {name: 'Iron Pick',       cost: {iron_bar: 1}, haft: true, item: 'iron_pick'},
  iron_axe:    {name: 'Iron Axe',        cost: {iron_bar: 1}, haft: true, item: 'iron_axe'},
  kettle_helm: {name: 'Kettle helm',     cost: {iron_bar: 2}, gear: 'kettle_helm'},
  iron_boots:  {name: 'Iron-shod boots', cost: {iron_bar: 1, wood: 1}, gear: 'iron_boots'},
};
export const INLAY = {cost: {glow_shard: 2, copper_bar: 1}, color: '#b8f0a4', radius: 3.5, intensity: 1.6, full: .3, fade: 2.5};
export const HAND = {
  bark_shoes: {name: 'Birch-bark shoes', cost: {birch_log: 2}, gear: 'bark_shoes'},
  bark_pack:  {name: 'Birch-bark pack',  cost: {birch_log: 3}, gear: 'bark_pack'},
  torch:      {name: 'Torch',            cost: {pine_log: 1}, gear: 'torch'},
};
export const HAMMER = {counts: 6, rhythm: 2};
export const WOODS = {
  birch_log:  {name: 'birch', trait: 'swings quick', swing: .85},
  log:        {name: 'oak', trait: 'lands heavy', power: 1.3, swing: 1.15},
  pine_log:   {name: 'pine', trait: 'resin: light it at a fire', lit: 180, light: {color: '#ffb060', radius: 4, intensity: 1.2}, hold: 1},
  aspen_log:  {name: 'aspen'}, willow_log: {name: 'willow'}, rowan_log: {name: 'rowan'}, deadwood: {name: 'deadwood'},
};
// the jobs without a bag item: their swings, in content/woodcut.js swing's fields (a short pump, a hammer's blow)
export const SWING = {
  pump:  {...WOOD.swing, dur: PUMP.every, hit: .28, keep: .55, reach: 1.1},
  smith: {...WOOD.swing, dur: .6, hit: .3, keep: .5, reach: 1},
};
export const FIRESET = {r: 2.5, t: 45, hours: 6};
// the ranges a pump and a make reach (m from the furnace / anvil: the server checks them too)
export const REACH = {use: 2.6, server: 4};
export const BUILD = {furnace: 'furnace', anvil: 'anvil'};   // (their content/builds.js kinds)

// ---------------------------------------------------------------- the rules
// a furnace's heat a step on: dt s, burning (its fuel > 0)
export function heatStep(h, dt, burning) {
  if (burning) return h > HEAT.rest ? HEAT.rest + (h - HEAT.rest) * Math.exp(-HEAT.fall * dt) : Math.min(HEAT.rest, h + (HEAT.rest - h) * (1 - Math.exp(-1.2 * dt)));
  return Math.max(0, h - HEAT.cold * dt);
}
// one pump: what it adds (bellows fitted, a blow in rhythm), held to 1
export const pumpAdd = (bellows, rhythm) => (bellows ? PUMP.bellows : PUMP.pipe) * (rhythm ? PUMP.rhythm : 1);
// the glow in words (the panel; the mouth's colour is the view's)
export function words(h, ore) {
  const c = ore && CHARGES[ore];
  if (h < .08) return 'cold';
  if (h < .3) return 'warm, dull red';
  if (h < HEAT.rest - .02) return 'dull red';
  const iron = c?.ore === 'iron_ore';
  if (h < .62) return iron ? 'red: the iron sits hard in it' : c ? 'red: the copper runs' : 'red';
  if (h < .78) return iron ? 'orange: the iron is soft and red, not yet' : 'bright orange';
  if (h < CHARGES.iron.heat) return iron ? 'yellow: the iron is nearly giving' : 'yellow';
  if (h < HEAT.white) return iron ? 'yellow-white: the iron gives' : 'yellow-white';
  return 'white: it roars';
}
// what a recipe of the anvil costs with its haft and inlay: {id: n} (the haft's log one more)
export function smithCost(r, haft, inlay) {
  const R = SMITH[r]; if (!R) return null;
  const c = {...R.cost};
  if (R.haft && haft) c[haft] = (c[haft] || 0) + 1;
  if (R.haft && inlay) for (const k in INLAY.cost) c[k] = (c[k] || 0) + INLAY.cost[k];
  return c;
}
export const haftOK = (r, haft) => !SMITH[r]?.haft || !!WOODS[haft];

// ---------------------------------------------------------------- records
export const COUNTS = ['fell', 'oldoak', 'veins', 'iron'];
export const LINES = {
  counts: {fell: n => `Felled ${n} tree${n === 1 ? '' : 's'}`, oldoak: n => `Felled ${n} old oak${n === 1 ? '' : 's'}`,
    veins: n => `Broke ${n} vein${n === 1 ? '' : 's'}`, iron: n => `Broke ${n} iron vein${n === 1 ? '' : 's'}`},
  marks: {oldoak: d => `Felled its first old oak on day ${d}`, iron: d => `Broke its first iron vein on day ${d}`},
  show: 2,   // lines under the maker's (Shift: all)
};
export const MAX_RECS = 64;
// a record from a save or a hello: checked, its fields held to their kinds; null when its item is unknown
export function cleanRec(o) {
  if (!o || typeof o !== 'object' || typeof o.u !== 'string' || o.u.length > 24) return null;
  const item = String(o.item || ''); if (!ITEMS[item]?.made && !GEAR_BY_ID[item]) return null;
  const counts = {}; for (const k of COUNTS) counts[k] = Math.max(0, Math.floor(+o.counts?.[k] || 0));
  const marks = (Array.isArray(o.marks) ? o.marks : []).slice(0, 8).filter(m => m && LINES.marks[m.k]).map(m => ({k: m.k, day: Math.max(1, Math.floor(+m.day || 1))}));
  return {u: o.u, item, maker: String(o.maker || '').slice(0, 24), day: Math.max(1, Math.floor(+o.day || 1)), haft: WOODS[o.haft] ? o.haft : '', inlay: !!o.inlay,
    hand: !!o.hand, counts, marks};
}
// a new record
export const mintRec = (u, item, maker, day, haft = '', inlay = false, hand = false) =>
  ({u, item, maker, day, haft: WOODS[haft] ? haft : '', inlay: !!inlay, hand: !!hand, counts: {fell: 0, oldoak: 0, veins: 0, iron: 0}, marks: []});
// a count on a record (fell, oldoak, veins, iron) and its first-time mark -> true when it changed
export function countOn(rec, k, day) {
  if (!rec || !COUNTS.includes(k)) return false;
  rec.counts[k] = (rec.counts[k] || 0) + 1;
  if (rec.counts[k] === 1 && LINES.marks[k] && !rec.marks.some(m => m.k === k)) rec.marks.push({k, day});
  return true;
}
// the maker's line: "Forged by Ann on day 4, of cave iron and home-woods birch."
export function makerLine(rec) {
  const who = rec.maker ? `by ${rec.maker}` : 'by your hand';
  if (rec.hand) { const c = Object.keys(HAND[rec.item]?.cost || {}).map(k => k === 'pine_log' ? 'pine' : k === 'birch_log' ? 'birch bark' : ITEMS[k]?.name.toLowerCase() || k); return `Made ${who} on day ${rec.day}${c.length ? ', of ' + c.join(' and ') : ''}.`; }
  const of = ['cave iron'];
  if (rec.haft) of.push(`home-woods ${WOODS[rec.haft].name}`);
  if (rec.inlay) of.push('glow shards');
  return `Forged ${who} on day ${rec.day}, of ${of.length > 1 ? of.slice(0, -1).join(', ') + ' and ' + of[of.length - 1] : of[0]}.`;
}
// its history: the counts (biggest first), then its firsts; all = every line, else LINES.show
export function recLines(rec, all = false) {
  const L = [];
  for (const k of COUNTS) if (rec.counts?.[k] > 0) L.push([rec.counts[k], LINES.counts[k](rec.counts[k])]);
  L.sort((a, b) => b[0] - a[0]);
  const out = L.map(x => x[1]);
  for (const m of rec.marks || []) out.push(LINES.marks[m.k](m.day));
  return all ? out : out.slice(0, LINES.show);
}
// "birch haft, shard inlay"
export const recWhat = rec => [rec.haft ? `${WOODS[rec.haft].name} haft` : '', rec.inlay ? 'shard inlay' : ''].filter(Boolean).join(', ');
