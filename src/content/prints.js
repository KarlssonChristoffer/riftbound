// PRINTS (data; docs/WINTER.md "Tracks"): the footprints and tracks features/prints.js keeps and draws. Pure.
//   SHAPES  what a print looks like and how it walks: dots (art px [along, across] from the print's middle, along = its way of
//           travel on screen; none: the boot's stride mark, 3 x 1 px turned with the stride), stride (m between prints when
//           walk() stamps it), side (m each foot is off the line: 0 = one neat line, the fox), pair (left / right alternate)
//   SURF    what it's printed in, and how it goes: a print's WEAR runs 0 (fresh) .. 1 (gone). Each surface has one wear
//           clock that only ever grows (features/prints.js F.wear); a print remembers the clock when it was stamped, so
//           nothing ticks per print. Fields: col (its colour; none: the snow's shade by its wear, SNOW_SHADE), life (s of
//           real time to wear out), hours (in-game hours to wear out), emit (it glows too), fade (draw it fading over the
//           last part of its wear, else in the shade's steps)
//   TRACK   which shape each of features/fauna.js's ground animals leaves (the birds in the trees and the air leave none)
// Another feature's prints: add a surface here (or F.surface(name, def) from its own content), stamp it by name, wear it
// with F.wear(name, k) when its own rule says (rain washing a muddy track out). See features/prints.js for the calls.
export const SHAPES = {
  boot:  {stride: .45, side: .09, pair: true},
  hare:  {stride: .9,  side: 0,   dots: [[2, -1], [2, 1], [0, 0], [-1, 0]]},   // two long hind feet ahead, the small fore feet one behind the other
  fox:   {stride: .32, side: 0,   dots: [[0, 0], [1, 0]]},                     // one neat line, each print in the last
  deer:  {stride: .55, side: .1,  pair: true, dots: [[0, 0], [1, 0]]},         // the cloven hoof: two halves along its way
  bird:  {stride: .16, side: .04, pair: true, dots: [[1, -1], [1, 1], [0, 0], [-1, 0]]},   // three toes forward, one back
};
export const SURF = {
  snow: {},                                    // wear: TUNE.fill in-game hours of full snowfall, or TUNE.thaw s once the snow under it goes
  mud:  {col: '#4a3a28', hours: 8, fade: .25},  // (a living animal's muddy track: the animals' rules wear it faster in heavy rain)
  glow: {col: '#c070ff', life: 40, emit: true, fade: .5},   // (a meal's glowing prints: stamp(..., {col}) for another colour)
};
export const TRACK = {roe: 'deer', fox: 'fox', hare: 'hare', capercaillie: 'bird'};
export const TUNE = {
  max: 4000,          // prints kept (a ring: the oldest goes first)
  snow: .5,           // env.snowCover a snow print needs where it's stamped (and to keep: under it the thaw wears them)
  fill: 1,            // in-game hours of full snowfall that fill a print back in (a light fall takes longer)
  thaw: 30,           // s a snow print takes to go once the snow under it is melting away
  run: 4.5,           // m/s: faster than this, the print goes in deep (the darkest shade); walking, one shade lighter
  draw: 3000,         // prints drawn a frame at most (the newest first)
};
// a snow print's tone by its wear (deep -> faint): [wear under, colour]
export const SNOW_SHADE = [[.2, '#8798b4'], [.55, '#a3b2ca'], [1, '#c2cddf']];
