// TROLLS (content): the numbers for the forest's trolls (features/trolls.js, docs/TROLLS.md). The sim (features/trolls/sim.js)
// and the view (features/trolls/look.js, view/troll3d.js) both read these; nothing here runs.
//   big     the BERGTROLL: a mossy hill of a troll, 2.6 m, a long nose, a pine club. Stone by day where the sun caught it, it
//           wakes at dusk (or under fog or a storm) and walks the woods till dawn. Slow, heavy, readable: every blow is wound
//           up for a long moment (a ring on the ground says where), and a missed slam sticks its club in the dirt
//   small   the PYSSLING: a knee-high troll in packs of 3-5 round a burrow. Shy by day (it peeks from behind trunks and runs),
//           bold at night: it darts in to bite, runs off giggling, throws pinecones from cover; it rides a big troll's shoulder
//           when one walks by; fire scares it off
// The units: m, s, m/s, hp; angles in degrees; hours 0..24 (sim/env.js's clock).
export const TYPES = {
  big: {
    name: 'Bergtroll', hp: 160, r: .62, hitR: .72, hitH: 2.6, coins: [8, 12], mass: 3.2,
    walk: 1.25, run: 3.1, turn: 2.2,              // m/s; rad/s
    sight: 16, lose: 26, hear: 9,                  // m: it sees you (a cone ahead of it: sightCone deg, any way within hear)
    sightCone: 130,
    poise: 45, poiseBack: 9, stagger: 1.5,         // damage it takes before it staggers (refills poiseBack /s), how long it reels
    knockTake: .35,                                // x a shove's speed (heavy: barely moves)
    attacks: {
      // reach: m from its centre to yours it starts from; at: m ahead of it the blow lands (r: its radius); arc: deg (a sweep)
      slam: {reach: 2.3, at: 1.55, r: 1.25, wind: 1.05, strike: .14, recover: 1.35, dmg: 20, knock: 13, shake: 5, weight: 3},
      sweep: {reach: 2.5, at: 0, r: 2.55, arc: 160, wind: .8, strike: .2, recover: .7, dmg: 13, knock: 17, shake: 3, weight: 2},
      boulder: {min: 6.5, max: 15, wind: 1.25, flight: 1.05, r: 1.5, recover: .9, dmg: 16, knock: 11, shake: 4, cool: 7, weight: 2},
      stomp: {reach: 1.35, at: 0, r: 1.9, wind: .55, strike: .1, recover: .8, dmg: 9, knock: 16, shake: 4, weight: 2},   // you're under its feet
    },
    roar: 1.3,                                     // s it stands and roars when it first sees you (a fight's start)
    cool: [.5, 1.2],                               // s between one blow's end and the next one's start
  },
  small: {
    name: 'Pyssling', hp: 24, r: .26, hitR: .32, hitH: .95, coins: [1, 3], mass: .5,
    walk: 1.5, run: 5.1, turn: 7,
    sight: 12, lose: 20, hear: 6, sightCone: 200,
    poise: 0, stagger: .55, knockTake: 1.6,        // any hit staggers it (and throws it)
    attacks: {
      bite: {reach: 1.05, at: .5, r: .55, wind: .38, strike: .1, recover: .25, dmg: 5, knock: 4, shake: 1, dash: 6.5},
      cone: {min: 3.5, max: 10, wind: .55, speed: 11, dmg: 3, knock: 2, cool: [1.6, 3]},
    },
    flee: [1.4, 2.4],                              // s it runs off after a bite (giggling)
    keep: [5, 8],                                  // m it keeps from you between bites, darting round you
    shy: 7,                                        // m: by day it bolts for cover when you come this near
    fire: 5.5,                                     // m: a campfire this near, it won't come (fire damage: it runs)
  },
};

export const TUNE = {
  SIM_R: 58,                 // m from the player: trolls further off wait where they are (and leave the world past DROP_R)
  ADD_R: 46,                 // m: a troll's body joins the world (an entity: hit, aimed at, collided with) within this of you
  DROP_R: 62,                // m: past this it leaves the world (healed; it comes back as it was)
  // THE SUN (sim/env.js's clock and sky): daylight = how far the sun is up (0 night .. 1 day: dawn and dusk between the hours
  // below) x how open the sky is (fog, a storm, a heavy overcast dim it). A big troll in daylight >= stoneAt turns to stone
  // (stoneTime s, slowing); at < wakeAt a stone wakes (wakeTime s: cracks, shakes itself)
  dawn: [5.2, 7], dusk: [18.6, 20.4],
  dim: {fog: .85, storm: .8, rain: .25, cloud: .3},
  stoneAt: .55, wakeAt: .35, stoneTime: 3.2, wakeTime: 2.4,
  // home: by dawn a big troll heads back to its stone's spot (it starts back when daylight passes homeAt)
  homeAt: .15,
  // the small ones' boldness: night x1, day x dayBold (they fight only when cornered or the pack is near at night)
  dayBold: .25,
  pack: [3, 5],              // small trolls a burrow
  ride: .35,                 // the chance a pack near a walking big troll sends one up onto its shoulder
  respawn: 150,              // s after a troll falls before its stone / burrow has one again (while you're past ADD_R)
  laugh: 1.1,                // s the small ones point and laugh when you're hit
  laughGap: 5,               // s before they laugh at you again
  angry: 12,                 // s a hit small one fights back even by day (cornered)
  heal: 6,                   // hp / s a troll out of a fight heals
  calm: 9,                   // s without seeing you before a troll gives up the chase and goes back to what it was doing
  projectiles: 24,           // the pool (boulders + cones)
  // a FIGHT for the game (game/game.js stakes): any troll angry with you within this many m
  stakesR: 24,
  // dev (?trolls=near, the dev menu's Trolls): what comes, how far
  near: {big: 1, small: 4, d: 11},
  // knocking on a troll stone by day (E): the third knock wakes it, grumpy, for sec s whatever the sun (then the sun takes it again)
  knock: {n: 3, sec: 30},
};

// a burrow's or a stone's place is the plan's (world/trolls.js); the colours are the view's (view/troll3d.js)
export const PALETTE = {
  hide: ['#8a9a72', '#6c7c58', '#4f5c40', '#33402c'],        // the big one: lichen green-grey
  moss: ['#9cb060', '#738a3e', '#4f6a2a', '#30441c'],
  stone: ['#a8a49a', '#86837a', '#625f58', '#3c3a36'],
  wood: ['#9a7650', '#77583a', '#563e28', '#35261a'],
  smallHide: ['#b0906a', '#8c6c4c', '#674c34', '#3e2c20'],     // the small ones: bark brown
  hair: ['#5a4a3a', '#43362a', '#2e241c', '#1c1612'],
  eye: '#ffd24a', eyeNight: '#ff9a3a',
};
