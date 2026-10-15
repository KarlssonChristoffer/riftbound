// MEALS (data; docs/FORAGING.md, docs/FISHING.md): what is cooked at a burning campfire (the pack panel's Cook list) and eaten at
// once: a buff for `dur` s, its notes in host.mods (source 'meal': features/meals.js). One meal at a time (a new one replaces it).
// Pure data: the browser (features/meals.js) and the co-op server (server/room.mjs: a cast is rolled with the meal's fish.* notes)
// read this one file.
//   need     [{ids, n}]: n of ONE of ids (the one you have most of) for each entry
//   notes    host.mods notes while it lasts; say: what it does, in words; dur: s
import {COMMON_FISH} from './fishing.js';

const ANY_FISH = ['perch', 'roach', 'bleak', 'minnow', 'pike', 'trout', 'bream', 'tench', 'zander', 'grayling', 'char', 'burbot'];
export const MEALS = {
  fish_stick: {name: 'Fish on a stick', need: [{ids: COMMON_FISH, n: 2}], dur: 240,
    notes: [{stat: 'player.speed', mul: 1.06}, {stat: 'fish.reel', mul: 1.1}], say: 'move 6% faster, reel 10% faster'},
  fish_soup: {name: 'Angler\'s soup', need: [{ids: ANY_FISH, n: 3}], dur: 300,
    notes: [{stat: 'fish.lure', mul: .8}, {stat: 'fish.luck', add: .05}], say: 'bites 20% sooner, fishing luck +5%'},
  trout_bark: {name: 'Trout in birch bark', need: [{ids: ['trout', 'grayling'], n: 1}], dur: 300,
    notes: [{stat: 'fish.hook', add: .2}, {stat: 'fish.cast', mul: 1.15}, {stat: 'player.speed', mul: 1.04}], say: 'more time to strike, cast 15% further, move 4% faster'},
  pike_stew: {name: 'Pike stew', need: [{ids: ['pike'], n: 1}, {ids: COMMON_FISH, n: 1}], dur: 300,
    notes: [{stat: 'game.hurt', mul: .9}, {stat: 'woodcut.power', mul: 1.15}, {stat: 'fish.line', mul: 1.15}], say: 'take 10% less harm, chop 15% harder, a stronger line'},
  smoked_eel: {name: 'Smoked eel', need: [{ids: ['eel'], n: 1}], dur: 420,
    notes: [{stat: 'light.lanternR', mul: 1.3}, {stat: 'fish.night', add: .3}, {stat: 'fish.luck', add: .05}], say: 'your lantern reaches 30% further, night bites much sooner, luck +5%'},
  salmon_plank: {name: 'Salmon on a plank', need: [{ids: ['salmon', 'char'], n: 1}], dur: 420,
    notes: [{stat: 'fish.luck', add: .12}, {stat: 'fish.double', add: .06}, {stat: 'player.speed', mul: 1.05}], say: 'fishing luck +12%, a 6% chance of two fish, move 5% faster'},
  // the forest floor's (features/forage.js, docs/FORAGING.md). mine.power: the pick's (features/mining.js: the next slice)
  fried_chanterelles: {name: 'Fried chanterelles', need: [{ids: ['chanterelles'], n: 3}], dur: 360,
    notes: [{stat: 'mine.power', mul: 1.15}, {stat: 'woodcut.power', mul: 1.1}], say: 'mine 15% harder, chop 10% harder'},
  blueberry_soup: {name: 'Blueberry soup', need: [{ids: ['blueberries'], n: 5}], dur: 360,
    notes: [{stat: 'player.speed', mul: 1.08}], say: 'move 8% faster'},
  fish_lingon: {name: 'Fish with lingon', need: [{ids: COMMON_FISH, n: 1}, {ids: ['lingonberries'], n: 3}], dur: 360,
    notes: [{stat: 'fish.luck', add: .08}, {stat: 'fish.lure', mul: .85}], say: 'fishing luck +8%, bites 15% sooner'},
};
// a meal's notes (none for an unknown id: the server takes the client's word for which meal it ate)
export const mealNotes = id => MEALS[id]?.notes || [];
