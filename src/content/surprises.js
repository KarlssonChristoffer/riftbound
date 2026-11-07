// SURPRISES (data; features/surprises.js, docs/SURPRISES.md): the night shift's small rule-benders in the persistent world. Pure
// numbers, read by the parts in features/surprises/.
//   DANCE    the rain dance: laps round the standing stones (world/stonecircle.js SITE) call a storm, or clear one away
//   CHARGE   storm-charged: struck by lightning you carry it a while (faster, a clap when you land, a shock into the water)
//   ROD      a thunderwood splinter in the pouch draws the bolts to you (thunder's own 'thunder.iron' stat)
//   STARS    falling stars on clear nights; a few come down near you and leave a star shard
//   FRENZY   a star shard carried into the lake at night: every cast bites at once while the lake glows
//   LOOKING  float still in the lake at night and the world turns over into its reflection (the picture mirrored, and so the controls)
//   FISHRAIN in a storm, now and then a fish comes down out of the clouds and flops about till you grab it
//   DIZZY    spin the camera round and round and the world keeps turning without you (a tilt, a stumble)
export const DANCE = {
  band: [1.2, 7],     // m from the ring's centre: where a step counts as round the stones
  laps: 3,            // full turns (either way) that finish the dance
  lose: 4,            // s outside the band before the count is lost
  idle: 25,           // s without progress before the count is lost
  rest: 60,           // s after a dance before the stones listen again
  hold: 300,          // s the called weather holds (then the clock's own weather comes back)
  ease: 14,           // s for the storm to roll in (env.setWeather's ease)
  clearEase: 22,      // s for the sky to clear
};
export const CHARGE = {
  dur: 75,            // s it lasts
  speed: 1.3,         // x his run speeds ('player.speed')
  accel: 1.45,        // x how fast he gets going ('player.accel')
  clapShake: [4, .3], // a landing's thunderclap: shake px, s
  fish: [2, 5],       // stunned fish a discharge into the water floats up (min, max)
  rare: .12,          // the chance each one is a pike instead of the small fry
  sparkEvery: .045,   // s between sparks off him
  light: {color: '#9cc8ff', radius: 3.2, intensity: 1.1, flicker: .7},
};
export const ROD = {item: 'thunderwood', every: 1};   // s between looks into the pouch
export const STARS = {
  every: [22, 60],    // s between shooting stars on a clear night
  landEvery: 3,       // every Nth one comes down (the first of each night does)
  cloud: .55,         // the sky's cloud above which no stars show
  dist: [8, 17],      // m from him where one lands
  fall: 1.7,          // s from the streak's start to the impact
  max: 3,             // shards lying at once
  take: 1.1,          // m: walk this close and it's yours
  light: {color: '#cfe8ff', radius: 4.5, intensity: 1.5, flicker: .25},
  item: 'star_shard',
};
export const FRENZY = {dur: 150, lure: .08, luck: 1.2, light: {color: '#7fe0ff', radius: 16, intensity: 1.3, flicker: .15}};
export const LOOKING = {still: 6, speed: .35, dur: 80, flip: .7, warn: 6};   // s still; m/s that counts as still; s mirrored; s the flip takes; s of warning
export const FISHRAIN = {
  storm: .5,          // the sky's storm over which fish come down
  every: [14, 40],    // s between falls
  pair: .3,           // the chance two come down together
  dist: [3, 11],      // m from him
  fall: .9,           // s from the clouds to the ground
  life: 22,           // s it flops about before it's gone
  take: 1.1,          // m: walk this close to grab it
  max: 6,             // lying at once
  big: .15, bigOnes: ['pike', 'bream', 'tench'],   // the chance of a big one, and which
};
export const DIZZY = {free: 1.6, need: 6 * Math.PI, decay: 3, dur: 11, push: 1.7, every: .6, tilt: 4.5, turn: .45};
// free: rad/s of turning that doesn't count; need: rad of turning past that (3 extra turns); decay: rad/s the count falls when you
// stop; dur: s dizzy; push: m/s the stumble drifts him; every: s between new drift directions; tilt: deg the picture leans; turn: x
// how fast he turns while dizzy ('player.turn')
