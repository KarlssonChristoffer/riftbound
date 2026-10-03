// MOODS: the lighting tables per biome and time of day (data only). Forked from the 2D arena's lighting.js on
// 2026-10-01 (migration phase 2): the game owns its copy; sim/env.js blends them over the day, main.js turns them into
// the composite's uniforms. Values are the arena's, unchanged.

// ---------------- moods ----------------
// amb    flat light on the ground / multiply colour (1 = the art exactly as authored)
// sun    az: compass degrees the light comes FROM (0 N, 90 E, 180 S, 270 W), el: elevation degrees,
//        c: colour, k: how strongly its direction shapes the player (relative), rim: rim light when it is behind.
//        Day / dusk suns come from the WNW-NW (upper left on screen, like the art's highlights): shadows fall to the
//        lower right, the cliff's south face is in shade and the plateau throws its shadow onto the yard.
// shadow a: ground shadow opacity from the sun (0 = none), c: shadow colour, ao: contact-shadow opacity (default AO_A)
// fog    [r, g, b, a] added haze, stronger toward the top (far) of the view
// lift   extra flat light on the surface around the player (dark scenes)
// fill   extra flat light on the CHARACTER only (not the ground): keeps him readable at night without an aura
// glow   halo strength around strong lights, emit = emitter strength (computed from amb when omitted)
export const MOODS = {
  ruins: {
    day:   {amb: [1.00, .985, .95], sun: {az: 305, el: 50, c: [1, .95, .84], k: .34, rim: .15},
            shadow: {a: .46, c: [.10, .12, .20]}, fog: [0, 0, 0, 0], lift: [0, 0, 0], glow: .25},
    dusk:  {amb: [.86, .68, .58], sun: {az: 292, el: 14, c: [1, .6, .36], k: .55, rim: .3},
            shadow: {a: .48, c: [.16, .08, .20]}, fog: [.16, .07, .06, .10], lift: [.04, .03, .03], fill: [.03, .02, .02], glow: .6},
    night: {amb: [.21, .23, .33], sun: {az: 330, el: 36, c: [.55, .66, .95], k: .4, rim: .85},
            shadow: {a: 0, c: [.02, .03, .08], ao: .62}, fog: [.03, .04, .08, .10], lift: [.06, .07, .10], fill: [.15, .16, .21], glow: 1},
  },
  ember: {   // red-orange ambient under an ash sky
    day:   {amb: [1.00, .93, .86], sun: {az: 300, el: 44, c: [1, .8, .6], k: .32, rim: .15},
            shadow: {a: .38, c: [.18, .06, .06]}, fog: [.10, .04, .02, .08], lift: [0, 0, 0], glow: .35},
    dusk:  {amb: [.86, .55, .42], sun: {az: 288, el: 12, c: [1, .46, .22], k: .55, rim: .3},
            shadow: {a: .44, c: [.20, .04, .06]}, fog: [.22, .07, .03, .12], lift: [.05, .03, .02], fill: [.03, .02, .01], glow: .7},
    night: {amb: [.32, .17, .15], sun: {az: 20, el: 30, c: [.95, .42, .24], k: .38, rim: .8},
            shadow: {a: 0, c: [.08, .01, .02], ao: .62}, fog: [.10, .03, .02, .12], lift: [.08, .06, .05], fill: [.15, .12, .11], glow: 1},
  },
  frost: {   // cold blue
    day:   {amb: [.95, .98, 1.00], sun: {az: 310, el: 32, c: [.96, .98, 1], k: .34, rim: .15},
            shadow: {a: .36, c: [.12, .20, .40]}, fog: [.06, .08, .12, .10], lift: [0, 0, 0], glow: .25},
    dusk:  {amb: [.74, .70, .86], sun: {az: 295, el: 10, c: [1, .7, .62], k: .5, rim: .3},
            shadow: {a: .40, c: [.12, .12, .34]}, fog: [.10, .08, .16, .12], lift: [.03, .03, .04], fill: [.02, .02, .03], glow: .6},
    night: {amb: [.18, .25, .41], sun: {az: 335, el: 42, c: [.62, .78, 1], k: .42, rim: .85},
            shadow: {a: 0, c: [.02, .04, .12], ao: .62}, fog: [.04, .06, .12, .12], lift: [.05, .07, .10], fill: [.13, .16, .22], glow: 1},
  },
  rift: {    // violet
    day:   {amb: [.94, .90, 1.00], sun: {az: 305, el: 46, c: [.95, .86, 1], k: .34, rim: .2},
            shadow: {a: .40, c: [.12, .05, .22]}, fog: [.06, .02, .10, .08], lift: [0, 0, 0], glow: .35},
    dusk:  {amb: [.68, .52, .84], sun: {az: 290, el: 13, c: [.95, .5, .9], k: .55, rim: .3},
            shadow: {a: .44, c: [.12, .03, .22]}, fog: [.14, .05, .18, .12], lift: [.04, .03, .05], fill: [.03, .02, .03], glow: .7},
    night: {amb: [.21, .14, .33], sun: {az: 340, el: 34, c: [.72, .5, 1], k: .42, rim: .9},
            shadow: {a: 0, c: [.05, .01, .10], ao: .62}, fog: [.07, .03, .12, .12], lift: [.07, .06, .10], fill: [.17, .14, .22], glow: 1},
  },
};
MOODS.desert = {   // world/desert.js: a hard white sun high up, an orange dusk, a cold blue night
  day:   {amb: [1.00, .97, .90], sun: {az: 300, el: 60, c: [1, .95, .82], k: .36, rim: .15},
          shadow: {a: .54, c: [.22, .12, .10]}, fog: [.08, .05, .02, .06], lift: [0, 0, 0], glow: .25},
  dusk:  {amb: [.94, .60, .45], sun: {az: 288, el: 11, c: [1, .52, .26], k: .58, rim: .35},
          shadow: {a: .50, c: [.22, .06, .12]}, fog: [.24, .09, .04, .12], lift: [.05, .03, .02], fill: [.03, .02, .01], glow: .7},
  night: {amb: [.20, .24, .38], sun: {az: 330, el: 40, c: [.60, .70, 1], k: .4, rim: .85},
          shadow: {a: 0, c: [.02, .03, .09], ao: .62}, fog: [.03, .04, .09, .08], lift: [.06, .07, .10], fill: [.15, .16, .22], glow: 1},
};
export const TIMES = ['day', 'dusk', 'night'];

// the character in dark scenes: the readability fill (fillK, capped at fillCap of the light there) and how far its albedo
// is graded toward the biome's art colour, per time of day
export const CHAR = {fillK: 1, fillCap: .25, gradeK: {day: .12, dusk: .25, night: .4}};   // live-tunable: L.CHAR
