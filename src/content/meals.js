// MEALS (data; docs/COOKING.md, docs/FORAGING.md, docs/FISHING.md): what is cooked at a burning campfire (the pack panel's Cook
// list) and eaten at once. Since "meals that play" (2026-10-16) a meal is a MOOD you feel within seconds, not a percentage: each
// dish's `mood` notes change a verb (the pick rings, eel eyes, glowing prints, fish come to you, heavy as a pike), each read by its
// owner; its old `notes` stay as hidden numbers under the hood. Cooking is a little game on a stick over the fire
// (features/cooking.js): pulled RAW, DONE, JUST RIGHT or BURNT, and burnt turns the same sense around (`burnt` notes). One meal at a
// time (a new one replaces it; the broth's trip stacks). ?moods=0: today's numbers, instant cooking (the old `say`, `dur`).
// Pure data: the browser (features/meals.js, features/cooking.js) and the co-op server (server/room.mjs: a cast is rolled with
// the meal's fish.* notes, a hand grab is checked against the meal's code) read this one file.
//   need     [{ids, n}]: n of ONE of ids (the one you have most of) for each entry
//   notes    the hidden numbers (host.mods notes) while it lasts, done or just right; say: them in words (?moods=0's Cook text);
//            dur: s (?moods=0); trip: drunk, not eaten (features/trip.js)
//   mood     the verb's notes (each system owns its note: docs/COOKING.md has the table); words: the Cook list's one-line hint
//   burnt    the twist's notes (the same sense, turned around; no hidden numbers); the four fishing meals share SMOKED
//   short    for "Burnt eel"; col: the food's raw colour on the stick; cook.t: s over the flames to just right; hint: the Cook
//            journal's line for a dish not found yet
// A meal's CODE (what friends are told: features/coop.js 'md'): its id, + '!' burnt, + '~' raw ('smoked_eel!').
import {COMMON_FISH} from './fishing.js';

const ANY_FISH = ['perch', 'roach', 'bleak', 'minnow', 'pike', 'trout', 'bream', 'tench', 'zander', 'grayling', 'char', 'burbot'];
// burnt fishing meals (until they get moods of their own): smoked out: a thin smoke trail follows you (features/meals.js view) and
// animals notice you at twice the distance (features/fauna.js 'fauna.loud', the one loudness note: depth-shared.md)
const SMOKED = [{stat: 'fauna.loud', mul: 2}];
// pike stew: heavy. walk x.9, start x.5, stop x.5, turn x.4 (sim/player/player.js), wind x.25 (adapter.js), the river x.3 (adapter.js
// H.water), a knock x.4 (player.js knock), louder steps (features/audio.js 'audio.steps'); burnt: light as ash
const HEAVY = [{stat: 'player.speed', mul: .9}, {stat: 'player.accel', mul: .5}, {stat: 'player.decel', mul: .5}, {stat: 'player.turn', mul: .4},
  {stat: 'player.windX', mul: .25}, {stat: 'player.windY', mul: .25}, {stat: 'player.current', mul: .3}, {stat: 'player.knock', mul: .4}, {stat: 'audio.steps', mul: 1.6}];
const ASH = [{stat: 'player.turn', mul: 1.8}, {stat: 'player.accel', mul: 1.6}, {stat: 'player.decel', mul: 1.6}, {stat: 'player.windX', mul: 2}, {stat: 'player.windY', mul: 2},
  {stat: 'player.current', mul: 2}, {stat: 'player.knock', mul: 2}, {stat: 'audio.steps', mul: 0}, {stat: 'fauna.loud', mul: .6}];

export const MEALS = {
  fish_stick: {name: 'Fish on a stick', short: 'fish on a stick', need: [{ids: COMMON_FISH, n: 2}], dur: 240,
    notes: [{stat: 'player.speed', mul: 1.06}, {stat: 'fish.reel', mul: 1.1}], say: 'move 6% faster, reel 10% faster',
    words: 'a little quicker on your feet and on the reel', burnt: SMOKED, col: '#c8b8a0', cook: {t: 3.4}, hint: 'two small fish on a green stick'},
  fish_soup: {name: 'Angler\'s soup', short: 'angler\'s soup', need: [{ids: ANY_FISH, n: 3}], dur: 300,
    notes: [{stat: 'fish.lure', mul: .8}, {stat: 'fish.luck', add: .05}], say: 'bites 20% sooner, fishing luck +5%',
    words: 'the fish bite sooner, and better ones', burnt: SMOKED, col: '#d8d0b0', cook: {t: 2.6}, hint: 'three fish of any kind, in a pot'},
  trout_bark: {name: 'Trout in birch bark', short: 'trout', need: [{ids: ['trout', 'grayling'], n: 1}], dur: 300,
    notes: [{stat: 'fish.hook', add: .2}, {stat: 'fish.cast', mul: 1.15}, {stat: 'player.speed', mul: 1.04}], say: 'more time to strike, cast 15% further, move 4% faster',
    words: 'more time to strike, a longer cast', burnt: SMOKED, col: '#e0d0b8', cook: {t: 3.4}, hint: 'a stream fish wrapped in white bark'},
  pike_stew: {name: 'Pike stew', short: 'pike stew', need: [{ids: ['pike'], n: 1}, {ids: COMMON_FISH, n: 1}], dur: 300,
    notes: [{stat: 'game.hurt', mul: .9}, {stat: 'woodcut.power', mul: 1.15}, {stat: 'fish.line', mul: 1.15}], say: 'take 10% less harm, chop 15% harder, a stronger line',
    mood: HEAVY, words: 'heavy and slow as a pike, hard to push about', burnt: ASH, col: '#b8b090', cook: {t: 4.2}, hint: 'the lake\'s long hunter and a little fish, stewed'},
  smoked_eel: {name: 'Smoked eel', short: 'eel', need: [{ids: ['eel'], n: 1}], dur: 420,
    notes: [{stat: 'light.lanternR', mul: 1.3}, {stat: 'fish.night', add: .3}, {stat: 'fish.luck', add: .05}], say: 'your lantern reaches 30% further, night bites much sooner, luck +5%',
    mood: [{stat: 'light.nightEye', add: 1}], words: 'eyes for the dark, like an eel\'s',
    burnt: [{stat: 'light.nightEye', add: 1}], col: '#8a8478', cook: {t: 4.2}, hint: 'the night swimmer, smoked'},   // (burnt: his eyes shine too: features/meals.js F.eyes)
  salmon_plank: {name: 'Salmon on a plank', short: 'salmon', need: [{ids: ['salmon', 'char'], n: 1}], dur: 420,
    notes: [{stat: 'fish.luck', add: .12}, {stat: 'fish.double', add: .06}, {stat: 'player.speed', mul: 1.05}], say: 'fishing luck +12%, a 6% chance of two fish, move 5% faster',
    words: 'a lucky hand with the rod', burnt: SMOKED, col: '#f09878', cook: {t: 4.2}, hint: 'a pink-fleshed fish on a split plank'},
  // the forest floor's (features/forage.js, docs/FORAGING.md). mine.power: the pick's (features/mining.js, docs/MINING.md)
  fried_chanterelles: {name: 'Fried chanterelles', short: 'chanterelles', need: [{ids: ['chanterelles'], n: 3}], dur: 360,
    notes: [{stat: 'mine.power', mul: 1.15}, {stat: 'woodcut.power', mul: 1.1}], say: 'mine 15% harder, chop 10% harder',
    mood: [{stat: 'mine.ring', add: 1}], words: 'the pick rings, and the rock answers',
    burnt: [{stat: 'mine.ring', add: -1}], col: '#f0c040', cook: {t: 3.0}, hint: 'something golden from under the spruces, fried'},
  blueberry_soup: {name: 'Blueberry soup', short: 'blueberry soup', need: [{ids: ['blueberries'], n: 5}], dur: 360,
    notes: [{stat: 'player.speed', mul: 1.08}], say: 'move 8% faster',
    mood: [{stat: 'prints.glow', add: 1}], words: 'blue fingers, blue feet',
    burnt: [{stat: 'prints.glow', add: -1}], col: '#5a4aa8', cook: {t: 2.6}, hint: 'a handful of the forest floor\'s berries, warm'},
  fish_lingon: {name: 'Fish with lingon', short: 'fish with lingon', need: [{ids: COMMON_FISH, n: 1}, {ids: ['lingonberries'], n: 3}], dur: 360,
    notes: [{stat: 'fish.luck', add: .08}, {stat: 'fish.lure', mul: .85}], say: 'fishing luck +8%, bites 15% sooner',
    mood: [{stat: 'fish.come', add: 1}], words: 'stand still in the shallows and the fish come',
    burnt: [{stat: 'fish.come', add: -1}], col: '#d8c0a0', cook: {t: 3.4}, hint: 'a small fish with red berries'},
  // the fly agaric's (features/trip.js, docs/BUILDING.md): not a buff but a TRIP (trip: true): drunk, it doesn't replace the meal
  // eaten; for dur s the world's colours drift and it sways, the watcher comes out and stares (only he sees it; friends see him sway).
  // Burnt: the world holds its breath (TUNE.still s: trip.start(s, {still: true}))
  fly_broth: {name: 'Fly agaric broth', short: 'broth', need: [{ids: ['fly_agaric'], n: 1}, {ids: ['blueberries', 'lingonberries'], n: 2}], dur: 90, trip: true,
    notes: [], say: 'the world breathes for a while. Don\'t. (Or do.)', words: 'the world breathes for a while. Don\'t. (Or do.)',
    burnt: [], col: '#c84030', cook: {t: 2.2}, hint: 'the red one with white spots. Really?'},
};
// MOODS and THE STICK (features/meals.js, features/cooking.js): how long each quality lasts (s; ?moodlen= a factor), the windows
// round a dish's cook.t (s: done +/- win, just right +/- right; ?cookwin= ms sets win), when it drops into the fire, the broth's
//   dur      raw: the mood for half the time, no hidden numbers; done: the mood + the hidden numbers; right: done + 60 s; burnt
//   still    the burnt broth's held breath (s); trip: the broth's trip by quality (raw: half)
export const TUNE = {dur: {raw: 90, done: 180, right: 240, burnt: 120}, win: .4, right: .12, drop: 5, still: 60, trip: {raw: 45, done: 90, right: 90}};
export const QUALITIES = ['raw', 'done', 'right', 'burnt'];
// FOUND RECIPES (features/meals.js; docs/COOKING.md): the dishes known in a new world (the rest are found by trying, or by eating
// from a friend's pot). THE TRY STICK: up to `kinds` kinds of food, `items` in all, on a stick for `t` s; what covers a dish's need
// with nothing over is that dish (learned); anything else is something odd: `hic` s of hiccups, one every `every` s (and one of each
// kind tried is used up). `col`: the odd food's colour on the stick
export const KNOWN = ['fish_stick'];
export const TRY = {kinds: 3, items: 6, t: 3, hic: 30, every: [1.4, 3.2], col: '#a89870'};
// every kind of food that goes into some dish (the Try stick's choice), in the order the dishes name them
export const FOODS = [...new Set(Object.values(MEALS).flatMap(M => M.need.flatMap(q => q.ids)))];
// the dish what's on a Try stick ({id: n}) makes: each part of its need n of ONE kind, nothing left over; '' none (something odd).
// Small (3 kinds, <= 2 parts): called on a click, not per step
export function matchOf(picks) {
  const left = {}; let all = 0;
  for (const k in picks) if (picks[k] > 0) { left[k] = picks[k]; all += picks[k]; }
  for (const id in MEALS) { let n = 0; for (const q of MEALS[id].need) n += q.n; if (n === all && fits(MEALS[id].need, 0, left)) return id; }
  return '';
}
function fits(need, i, left) {
  if (i === need.length) { for (const k in left) if (left[k]) return false; return true; }
  const q = need[i];
  for (const k in left) if (left[k] >= q.n && q.ids.includes(k)) { left[k] -= q.n; const ok = fits(need, i + 1, left); left[k] += q.n; if (ok) return true; }
  return false;
}
const SUFFIX = {raw: '~', done: '', right: '', burnt: '!'};

// the notes a dish gives at a quality (moods: false: ?moods=0, the old numbers) -> a fresh array (set once, on eating)
export function notesOf(id, q = 'done', moods = true) {
  const M = MEALS[id]; if (!M) return [];
  if (!moods) return M.notes.slice();
  if (q === 'burnt') return (M.burnt || []).slice();
  if (q === 'raw') return (M.mood || M.notes).slice();   // (a dish with no mood yet: its numbers, for the shorter time)
  return [...M.notes, ...(M.mood || [])];
}
// how long a quality lasts (s): the broth's trip has its own (burnt: TUNE.still)
export function durOf(id, q = 'done', moods = true, k = 1) {
  const M = MEALS[id]; if (!M) return 0;
  if (!moods) return M.dur;
  if (M.trip) return q === 'burnt' ? TUNE.still * k : (TUNE.trip[q] ?? M.dur) * k;
  return TUNE.dur[q] * k;
}
// the name the chip and the float show: "Burnt eel", "Underdone blueberry soup"
export function nameOf(id, q = 'done') {
  const M = MEALS[id]; if (!M) return '';
  return q === 'burnt' ? 'Burnt ' + M.short : q === 'raw' ? 'Underdone ' + M.short : M.name;
}
export const codeOf = (id, q = 'done') => MEALS[id] ? id + SUFFIX[q] : '';
// a code back into {id, q} (the server's and the peers' word; junk -> id '')
const PARSED = {id: '', q: 'done'};
export function parseCode(code, out = PARSED) {
  out.id = ''; out.q = 'done';
  if (typeof code !== 'string' || !code) return out;
  const last = code[code.length - 1], q = last === '!' ? 'burnt' : last === '~' ? 'raw' : 'done', id = q === 'done' ? code : code.slice(0, -1);
  if (MEALS[id]) { out.id = id; out.q = q; }
  return out;
}
// a meal's notes from its code (none for an unknown id: the server takes the client's word for which meal it ate)
export const mealNotes = code => { const c = parseCode(code, {id: '', q: 'done'}); return c.id ? notesOf(c.id, c.q) : []; };
// how loud animals take someone who ate this (features/fauna.js: a peer's 'fauna.loud' from their code; 1: as anyone). Kept per
// code (a handful of codes ever: asked every step, no allocation after the first)
const LOUD = new Map(), SMOKE = new Map();
export function loudOf(code) {
  let k = LOUD.get(code); if (k !== undefined) return k;
  const c = parseCode(code, {id: '', q: 'done'}); k = 1;
  if (c.id) for (const n of notesOf(c.id, c.q)) if (n.stat === 'fauna.loud' && n.mul !== undefined) k *= n.mul;
  if (LOUD.size < 256) LOUD.set(code, k);
  return k;
}
// is the code a burnt fishing meal (smoked out: the smoke trail, features/meals.js)
export function smokedOf(code) {
  let k = SMOKE.get(code); if (k !== undefined) return k;
  const c = parseCode(code, {id: '', q: 'done'}); k = c.q === 'burnt' && MEALS[c.id]?.burnt === SMOKED;
  if (SMOKE.size < 256) SMOKE.set(code, k);
  return k;
}
