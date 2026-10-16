// ANIMALS FOR REAL (docs/FAUNA.md "For real", the brief living-animals.md): the numbers of the forest animals' play. Pure data
// read by the game (features/mud.js, features/fauna.js, features/rope.js, features/animalfinds.js, features/foxden.js) and the
// co-op server (server/room.mjs, sim/foxden.js). Hours are IN-GAME hours (sim/env.js: a 20-minute day, so an hour is 50 real s);
// distances m, speeds m/s, times s unless they say hours.
// The animals are never hurt: nothing here is a kill. A yank does no damage; what you find, the forest dropped.
import {isFish} from './fishing.js';

// ---------------------------------------------------------------- TRACKS (features/mud.js on features/prints.js; the morning trails: world/fauna.js trailOf)
export const MUD = {
  wet: .35,          // the ground's wetness (sim/env.js E.wet) from which it takes prints (a mud print lasts content/prints.js SURF.mud's hours)
  wash: .6, washH: 1,   // heavy rain (sky.rain over this) washes a print out within washH hours
  dry: .2, dryH: 1,     // the ground drying under this fades a print within dryH hours
  patch: 3.2,        // m: the scale of the soft patches (between them moss and needles take no print)
  soft: .42,         // a spot takes prints where its softness (the patch noise, the puddle hollows) passes this
  deep: .25, deepCol: '#2e2418',   // a puddle's readiness (features/puddles.js F.ready) past this: a deep, dark print (this colour)
};
// the morning trails: after a wet night (wet >= MUD.wet at TRAIL.at) each herd's walk to its bed, each fox's round to its den,
// each hare's loop to its form, laid over TRAIL.from..TRAIL.to (a pure function of the plan and the day: shared by everyone)
export const TRAIL = {
  at: 5, from: 5, to: 9,
  roe: {len: [40, 70], step: .55, side: .07, gap: [.7, 1.4], end: 9},     // m long, m a print, m left / right of the line, m apart for each deer of the herd
  fox: {len: [60, 110], step: .34, side: .015, end: 8.4},
  hare: {len: [15, 25], step: 1.25, side: .07, end: 9.4},                 // (a hare's bound: one print of its four feet a step)
  max: 2000,         // prints the morning's trails may lay in all (more: wider apart; the rest of prints.js's ring is the live prints')
  near: 40,          // m (a box): this near you the animal itself walks its line (prints.js stamps its feet), the trail stamps none
};
// ---------------------------------------------------------------- THE LASSO ON ANIMALS (features/rope.js, content/lasso.js WEIGHT)
export const ROPE = {
  claim: 30,         // s a roped animal is held for its holder (the server's claim lapses after it)
  hare: {daze: 2, carry: 8, walk: .6, bolt: 1.2},   // dazed s at your feet, carried at most s at x walk speed, then it bolts (s of a head start)
  fox: {slip: 1.5},  // s on the rope before it slips the loop (dropping what it carries at once)
  roe: {
    v0: 5.5, v1: 1.5,               // m/s at the catch, falling to this, then it stops
    tire: [8, 12], kg: .25, freeKg: 4, min: 4,   // s it runs (seeded per deer), -kg s a kg of gear past freeKg, never under min
    lean: .8, leanTire: 1.5,        // S (lean back): -m/s, x how fast it tires
    steer: 30,                      // deg A / D swing its line
    brush: .85,                     // x speed through bushes and ferns (a burst of leaves)
    stand: 6, calm: 1.5,            // s it stands blowing, head low; m: E within this calms it (for the rest of the in-game day)
    snag: .9, knock: 5,             // m past the rope's give you're held back (a trunk, a rock): knocked flat at this m/s, the rope lost
  },
  peer: 20,          // Hz a held animal's place goes out in the holder's state message (an: [id, x, y, heading, mode])
};
// hare fur: a caught hare in its moult (spring, autumn) leaves a tuft, once an in-game day a hare
export const FUR = {seasons: ['spring', 'autumn'], perDay: 1};

// ---------------------------------------------------------------- FINDS WITHOUT KILLING (features/animalfinds.js)
export const SHED = {
  window: [['autumn', .6, 1], ['winter', 0, .4]],   // the last 40 % of autumn and the first 40 % of winter (shares of the season)
  per: 2, r: 8,       // antlers a buck drops (on seeded days in the window), m from its herd's bed
  last: ['spring', 1],   // they lie until the end of next spring
};
export const LEK = {
  season: 'spring', hours: [3.5, 7],   // the display mornings
  song: [6, 9], deaf: 2.5, pause: [4, 8],   // s a song, its last s he hears nothing (suspicion doesn't build), s between songs
  feathers: [1, 2], close: 3, bonus: 2,     // feathers after a display morning; m: the first to get this close gets bonus more
  moult: 2,           // summer: a feather every this many days where a cock spends his day
};

// ---------------------------------------------------------------- THE THIEVING FOX AND ITS DEN (sim/foxden.js, features/foxden.js)
export const THEFT = {
  food: id => isFish(id) || id === 'blueberries' || id === 'lingonberries',   // what a fox takes (a fish, not a find; berries)
  hours: [22, 4],    // one try an item a night at a seeded hour between these
  fire: 4,           // m: not this near a burning fire (embers are fine)
  watch: 8, retry: .5, tries: 3,   // a moving player this near puts it off: again retry hours later, at most tries
  run: 4,            // m/s on its way home (a seeded wiggly path to the den)
  often: 1,          // ?thief=often: within this many hours of putting it down
};
export const GROUND = {most: 6, reach: 2.2};   // items each player may have put down at once; m to put one down / take one up
export const DEN = {
  holds: 12, own: [2, 3], refill: 2, unclaimed: 4,   // its finds at the start, +1 every refill in-game days up to unclaimed
  named: .1,         // the share of refills that are a named thing
  reach: 1.5,        // s kneeling, reaching in
  mouth: 1.6,        // m from the den spot to its mouth (under the rock)
};
// what a den holds of its own (ids: content/items.js; a named thing gets a name scratched on it)
export const DEN_FINDS = ['old_boot', 'brass_button', 'lost_mitten', 'thimble', 'rusty_key', 'silver_ring'];
export const NAMED = {ids: ['thimble', 'silver_ring', 'brass_button'], names: ['Märta', 'Elof', 'Signe', 'Algot', 'Hilma', 'Gösta', 'Tyra', 'Edvin']};
