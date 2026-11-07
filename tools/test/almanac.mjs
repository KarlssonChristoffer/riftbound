// THE ALMANAC'S RULES (docs/ALMANAC.md), in node: the chapters' data, Today's roll, and the feature (features/almanac.js) driven
// with a fake host: events counted, a chapter finished (its page, its gift, the gift not counted again), the state goals, Today's
// gifts and bonus, the party goal online, the save after a reset. No browser.
//   node tools/test/almanac.mjs
import {CHAPTERS, TODAY, rollToday, countOf, soloText, giftOf, bonusOf} from '../../src/content/almanac.js';
import {EVENTS} from '../../src/core/events.js';
import {ITEMS} from '../../src/content/items.js';
import {CHARGES, SMITH} from '../../src/content/workshop.js';
import {GEAR_BY_ID, MADE} from '../../src/content/gear.js';
import {createModifiers} from '../../src/core/modifiers.js';
import {create} from '../../src/features/almanac.js';

let fails = 0;
const ok = (c, what, more = '') => { console.log((c ? 'ok   ' : 'FAIL ') + what + (c || !more ? '' : '  ' + more)); if (!c) fails++; };

// 1. the data: every goal counts something that exists
for (const c of CHAPTERS) for (const g of c.goals) {
  ok(!!g.on || !!g.state, `${c.id}.${g.id} counts an event or a state`);
  if (g.on) ok(g.on in EVENTS, `${c.id}.${g.id}: '${g.on}' is in the catalog`);
}
for (const c of CHAPTERS) for (const id in c.gift) ok(!!ITEMS[id], `${c.id}'s gift ${id} is an item`);
for (const t of TODAY) ok(t.on in EVENTS, `Today ${t.id}: '${t.on}' is in the catalog`);
ok(ITEMS.nightglass && CHARGES.night.bar === 'nightglass' && ITEMS[CHARGES.night.ore], 'the night charge makes Nightglass of night ore');
ok(SMITH.nightglass_lantern && GEAR_BY_ID.nightglass_lantern && MADE.nightglass_lantern === 'anvil', 'the Nightglass Lantern is made at the anvil');
ok(GEAR_BY_ID.nightglass_lantern.mods.some(m => m.stat === 'light.nightglass'), 'the lantern carries the light.nightglass note');

// 2. Today's roll: the same for a world's day, three, two solo goals of different kinds, then a party goal
{
  const a = rollToday(1337, 4), b = rollToday(1337, 4), c = rollToday(1337, 5);
  ok(a.length === 3 && a.every((t, i) => t === b[i]), 'the same three for the same seed and day');
  ok(a[0].on !== a[1].on && !a[0].party && !a[1].party && a[2].party, 'two solo goals of different kinds, then a party goal', a.map(t => t.id).join(' '));
  let differ = 0; for (let d = 0; d < 20; d++) if (rollToday(1337, d).map(t => t.id).join() !== rollToday(1337, d + 1).map(t => t.id).join()) differ++;
  ok(differ >= 15, 'a new three most days', differ + '/20');
  ok(giftOf(1337, 4, 0) === giftOf(1337, 4, 0) && !!bonusOf(1337, 4), 'gifts are the seed\'s');
  ok(soloText({text: 'Between you: fell 8 trees', party: true}) === 'Fell 8 trees', 'a party goal offline reads as his own');
  const pf = TODAY.find(t => t.id === 'p_fell');
  ok(countOf(pf, {type: 'tree.fell', mine: false}, {}, true) === 1 && countOf(pf, {type: 'tree.fell', mine: false}, {}, false) === 0, 'a friend\'s fell counts only for the party');
}

// 3. the feature, with a fake host
function fakeHost() {
  const stores = {}, given = [];
  const inv = {};
  const pack = {
    store: n => stores[n] ??= {}, dirty() {}, open: false,
    give(id, n) { inv[id] = (inv[id] || 0) + n; given.push([id, n]); H.events.push({type: 'pack.add', id, n}); return 0; },
    count: id => inv[id] || 0, level: () => 1, section(s) { pack.sec = s; }, inv, given, stores,
  };
  const coop = {online: false};
  const feats = {pack, game: {mode: 'sandbox'}, coop};
  const H = {
    events: [], mods: createModifiers(), player: {x: 0, y: 0, z: 0}, env: {day: 2, part: 'day'}, world: {cave: null}, uiSound() {},
    feature: n => feats[n] || null, hudOff: false, lock: false, G: {cine: false},
  };
  return {H, pack, coop};
}
const step = (F, H, evs = []) => { F.update(1 / 60, evs); const out = H.events.splice(0); return out; };
{
  const {H, pack, coop} = fakeHost();
  const F = await create(H);
  step(F, H);
  ok(F.chapter === 0, 'a new world starts at chapter I');
  ok(!!pack.sec && pack.sec.id === 'almanac', 'its section is in the pack panel');
  // chapter I
  const fell = {type: 'tree.fell', species: 'pine'};
  step(F, H, [fell, fell]);
  step(F, H, [{type: 'forage.pick', mine: true, kind: 'blueberry', n: 5}, {type: 'forage.pick', mine: true, kind: 'chanterelles', n: 3}, {type: 'forage.pick', mine: false, kind: 'lingonberry', n: 0}]);
  const s = F.state();
  ok(s.g['smoke.fell'] === 2 && s.g['smoke.berries'] === 5, 'fells and berries counted (not mushrooms, not a friend\'s pick)', JSON.stringify(s.g));
  step(F, H, [fell, {type: 'forage.pick', mine: true, kind: 'lingonberry', n: 9}, {type: 'build.add', mine: true, kind: 'campfire'}]);
  ok(F.chapter === 0, 'not done before the meal');
  const ev = step(F, H, [{type: 'meal.cook', id: 'blueberry_soup', q: 'done'}]);
  ok(F.chapter === 1, 'chapter I done: on to II');
  ok(ev.some(e => e.type === 'almanac.chapter' && e.ch === 'smoke'), 'almanac.chapter emitted');
  ok(pack.inv.chanterelles === 3, 'its gift given', JSON.stringify(pack.inv));
  ok(s.pages.includes('smoke'), 'its page torn out');
  // the gift's pack.add must not count for a Today 'carry home' goal; Today is on now
  ok(F.today.length === 3, 'Today is on after chapter I', F.today.map(t => t.id).join(' '));
  // chapter II: state goals (the pick in the bag, copper carried) latch
  pack.inv.pick = 1; pack.inv.copper_ore = 4;
  for (let i = 0; i < 40; i++) step(F, H);
  ok(s.g['down.pick'] === 1 && s.g['down.copper'] === 4, 'state goals read from the pouch', JSON.stringify(s.g));
  pack.inv.copper_ore = 0; for (let i = 0; i < 40; i++) step(F, H);
  ok(s.g['down.copper'] === 4, 'a met state goal stays met');
  step(F, H, [{type: 'player.warp', down: true}, {type: 'mine.spent', kind: 'stone', n: 2}, {type: 'mine.spent', kind: 'stone', n: 0}]);
  ok(s.g['down.veins'] === 1, 'a friend\'s spent vein (n 0) is not his');
  step(F, H, [{type: 'mine.spent', kind: 'stone', n: 3}, {type: 'mine.spent', kind: 'copper', n: 2}]);
  ok(F.chapter === 2, 'chapter II done', JSON.stringify(s.g));
  // Today: finish its goals by their own events; each gives a gift, all three the bonus
  const T = F.today, given0 = pack.given.length;
  const evFor = t => ({
    'forage.pick': {type: 'forage.pick', mine: true, kind: t.id === 'blue' ? 'blueberry' : t.id === 'lingon' ? 'lingonberry' : 'chanterelles', n: t.n},
    'tree.fell': {type: 'tree.fell', mine: true, species: t.id === 'birch' ? 'birch' : 'pine'},
    'fish.catch': {type: 'fish.catch', id: 'perch', n: 1}, 'meal.cook': {type: 'meal.cook', q: 'right'}, 'mine.spent': {type: 'mine.spent', kind: 'stone', n: 2},
    'pack.add': {type: 'pack.add', id: t.id === 'stone' ? 'stone' : 'glow_shard', n: t.n}, 'smith.smelt': {type: 'smith.smelt', mine: true, bar: 'copper_bar'},
  })[t.on];
  H.env.part = 'night';
  for (let k = 0; k < 3; k++) for (let i = 0; i < T[k].n + 2; i++) step(F, H, [evFor(T[k])]);
  ok(s.tg.every(Boolean), 'Today\'s three done', T.map((t, i) => t.id + ' ' + s.t[i] + '/' + t.n).join(', '));
  ok(pack.given.length - given0 >= 4 && s.tb, 'a gift each and the bonus', JSON.stringify(pack.given.slice(given0)));
  // a new day: a new three, counts back to 0
  H.env.day = 3; step(F, H);
  ok(s.day === 3 && s.t.every(n => n === 0) && !s.tb, 'a new day: Today again from 0');
  // online: the party goal counts a friend's
  coop.online = true;
  const pi = 2, P = F.today[pi], friend = {'tree.fell': {type: 'tree.fell', mine: false}, 'forage.pick': {type: 'forage.pick', mine: false, n: 0}, 'mine.spent': {type: 'mine.spent', n: 0}, 'fish.catch': {type: 'fish.catch', id: 'perch'}}[P.on];
  step(F, H, [friend]);
  ok(s.t[pi] === 1, `online the party goal (${P.id}) counts a friend's`, String(s.t[pi]));
  // the card's model and the section render without a browser
  ok(F.html().includes('III. Hearth'), 'the section shows the current chapter');
  // a fresh world (pack.reset empties the stores): back to chapter I
  for (const k in pack.stores.almanac) delete pack.stores.almanac[k];
  step(F, H);
  ok(F.chapter === 0, 'a reset world starts at chapter I again');
}
// 4. the last chapter's state goal: his Nightglass light by a night vein that shows
{
  const {H, pack} = fakeHost();
  const F = await create(H);
  step(F, H);
  F.state().ch = 5;
  const vein = {kind: 'night', x: 1, y: 0};
  H.world.cave = {veins: [vein], band: {x0: -10, x1: 10, y0: -10, y1: 10}, inside: () => -1};
  const feats = {caves: {lit: true}, mining: {isSpent: () => false, shown: () => true}};
  const f0 = H.feature; H.feature = n => feats[n] || f0(n);
  for (let i = 0; i < 40; i++) step(F, H);
  ok(!F.state().g['night.see'], 'not without the Nightglass Lantern');
  H.mods.set('gear', [{stat: 'light.nightglass', add: 1}]);
  for (let i = 0; i < 40; i++) step(F, H);
  ok(F.state().g['night.see'] === 1, 'its light by a night vein that shows: met');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
