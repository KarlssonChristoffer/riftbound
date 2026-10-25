// HAPPENINGS (data; features/happenings.js, sim/happenings.js, docs/WORLDLIFE.md "Happenings"): the things that now and then
// HAPPEN in the forest, one table entry each, so another is a few lines here and a look in the feature. Pure data: the co-op
// server could read it too.
//   chance   0..1 a day that the day's conditions allow it (a seeded draw: the same on every machine for a seed and a day)
//   hours    [from, to) in-game hours of the day it starts in (to > 24: past midnight, the night after)
//   need     the condition (sim/happenings.js reads it): 'clear-night' (a clear or fair sky when it falls), 'after-rain' (a
//            rain spell in the evening and night before; never in winter), 'dusk' (not in a storm), 'rain-clears' (a rain spell
//            ending by day, a dry one after it)
//   spot     the place: 'open' (a seeded open spot in the home woods: no water, rock or trunk on it), 'clearing' (the most open of
//            the candidates), 'path' (a big boulder to the lake shore)
//   reward   the item a player takes (content/items.js), once a happening each (pack.store('happenings'))
//   reach    m: how close you must be to take it (E) or to step into it
//   toast    what the toast says when it starts ({dir}: north-east / ... of you, {m}: how far)
// The numbers are in-game hours unless named (an in-game hour is 50 real s at the default day: sim/env.js TUNE.dayMinutes).
export const HAPPENINGS = {
  star: {name: 'A great falling star', chance: .2,   // (rarer since the night surprises' own falling stars: this is the big one everyone sees, its crater lighting the trees all night)
    hours: [21, 27.2], need: 'clear-night', spot: 'open', reward: 'star_shard', reach: 1.6,
    glowTo: 6.4,      // the hour of the next morning its glow dies (dawn); the scorch stays till scorchTo the day after
    scorchTo: 20,
    fall: 1.8,        // real s: the streak's fall
    toast: ['A great star fell', '{dir} of you, {m} m. Something glows in the woods'], col: '#bcd8ff'},
  ring: {name: 'A witch\'s ring', chance: .75, hours: [5.6, 5.7], need: 'after-rain', spot: 'clearing', reach: .85,
    r: 1.75,          // m: the ring's radius (3.5 m across)
    lasts: 24,        // it stands till the next morning
    night: [20.3, 29.6],   // the hours its lights dance (in the day it starts: 29.6 = 5.6 the morning after)
    buff: {s: 120, speed: 1.2},   // Light-footed: real s, x speed
    toast: ['A häxring', 'after the rain, pale mushrooms stood up in a ring overnight, {dir} of you, {m} m. Step in at night'], col: '#d8f0b0'},
  vattar: {name: 'The vättar walk', chance: .22, hours: [18.2, 19.2], need: 'dusk', spot: 'path', reach: 4,
    n: [5, 9],        // how many little ones
    gap: 1.15,        // m between them
    v: 17,            // m an in-game hour (~.34 m/s: slow)
    walk: 20,         // real s walking alongside within reach m: the last one stops and leaves you something
    gifts: ['blueberries', 'lingonberries', 'brass_button', 'thimble', 'caper_feather', 'hare_fur', 'rusty_key', 'cloudberries', 'thimble_hilma', 'brass_button_algot', 'silver_ring'],
    toast: ['The vättar are walking', 'a line of tiny lanterns, {dir} of you, {m} m. From the big stone to the water'], col: '#ffc878'},
  rainbow: {name: 'A rainbow', chance: .7, hours: [8, 16.5], need: 'rain-clears', spot: 'open', reward: 'rainbow_scale', reach: 2.2,
    lasts: 1.8,       // how long it stands
    r: 8,             // m: the arc's radius (it stands over the trees; whole on screen when you're near its foot)
    toast: ['A rainbow', 'its foot is {dir} of you, {m} m. Run!'], col: '#f0d0ff'},
};
export const KINDS = Object.keys(HAPPENINGS);
export const MOST = 2;   // at most this many a day (often: all of them)
// the home woods' box they happen in (world/forest.js HOME, a margin in), m
export const AREA = {x0: -42, y0: -60, x1: 66, y1: -5};
