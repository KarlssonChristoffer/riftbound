// OMENS: the stage omens (data only; features/omens.js runs them, features/omens/*.js are their rules and looks). As a run's
// stage arrives it may roll one (TUNE.chance, rising with the stage): the arrive banner names it with its rule, a HUD icon
// keeps it on screen (hover: the tooltip), and it turns the living world's own systems into the stage's rules, so you see
// and hear it: the weather (sim/env.js, locked for the stage and eased in), the wind (features/wind.js follows the
// weather), the light (an env grade over the mood, the lantern), the fog. It passes when the stage is cleared.
//   id, name, glyph, col     the banner's and the HUD icon's look        good    a blessing (the HUD frames it gold)
//   weight, from             the roll: relative weight, the first stage (0-based) it can come on
//   rule                     the banner's one line                       tip     the tooltip: what it does, exactly
//   world                    weather: the WEATHER state locked for the stage (frost: the frost lands' own); hour: the
//                            clock held there (h); grade: env.setGrade (the mood's colour, eased in over TUNE.ease s)
// Numbers that scale with the stage: n + nK x stage (the sandbox plays TUNE.sandboxStage).
export const OMENS = [
  {id: 'storm', name: 'Thunderstorm', frostName: 'Thundersnow', glyph: 'ϟ', col: '#a8d4ff', weight: 1.2, from: 0,
    rule: 'Lightning stalks you. Iron draws the bolt: stuck arrows, lead, tall things.',
    tip: ['A ring closes on where you stand, then the bolt falls: it burns you and every enemy inside it and sets wood alight.',
      'Within 4.5 m of the mark, iron takes the bolt instead: an arrow stuck in the ground, an enemy you just shot (lead),',
      'a tree, tower or brazier. Plant arrows by them and stay near: let the storm do the work. A roll dodges it.'],
    world: {weather: 'storm', frost: 'blizzard', grade: {amb: [.86, .9, 1.05], sunK: .8, fog: [.02, .03, .06, .05]}}},
  {id: 'gale', name: 'Gale', glyph: '≋', col: '#d8ecc8', weight: 1, from: 0,
    rule: 'A gale: your shots drift downwind. Run with the wind, not against it.',
    tip: ['Arrows and bullets are carried downwind as they fly: aim upwind of what you want to hit (the arrow shows the way).',
      'Moving with the wind is 25% faster, against it 25% slower; a roll or a knock is carried too.'],
    world: {weather: 'gale', grade: {fog: [.05, .045, .025, .04], sunK: .9}}},
  {id: 'bloodmoon', name: 'Blood Moon', glyph: '●', col: '#ff5a48', weight: 1, from: 1,
    rule: 'They are faster and hit harder, and every one drops double gold.',
    tip: ['Night under a red moon: enemies wait and hop 25% faster and hit 35% harder.', 'Everything they drop is doubled: coins fly.'],
    world: {weather: 'clear', hour: 23.2, grade: {amb: [1.55, .4, .42], sun: [1.6, .42, .36], sunK: 1.3, lift: [1.8, .5, .45], fill: [1.4, .6, .6],
      fog: [.14, 0, .02, .07], glow: 1.4}}},
  {id: 'riftfog', name: 'Rift Fog', glyph: '◌', col: '#c8a4ff', weight: 1, from: 1,
    rule: 'Past a few metres only their eyes show. Hits up close crit far more often.',
    tip: ['A violet fog from the Rift: enemies farther than ~5 m (less each stage) are lost in it, but for their glowing eyes.',
      'Your hits on an enemy within 4 m: +35% critical chance. Let them come.'],
    world: {weather: 'fog', grade: {amb: [.8, .74, .95], sun: [.85, .8, 1], sunK: .45, shadow: .4, fog: [.13, .05, .22, .24], glow: 1.3}}},
  {id: 'eclipse', name: 'Eclipse', glyph: '◐', col: '#f0dca0', weight: .9, from: 2,
    rule: 'The sun goes out. Your lantern is lit: what stands in light takes 60% more.',
    tip: ['Near darkness; only lights show the world. Your lantern burns, a little wider than usual.',
      'An enemy in light (your lantern, a torch, a brazier, a fire arrow, something burning, a blast) takes 60% more damage.',
      'Fire arrows and burning crates light the field: use them.'],
    world: {weather: 'clear', grade: {amb: [.12, .13, .19], sun: [.5, .55, .8], sunK: .12, shadow: .1, lift: [.25, .25, .35], fill: [.7, .7, .9],
      fog: [0, .01, .03, .06], glow: 1.8}}},
  {id: 'golden', name: 'Golden Hour', glyph: '☀', col: '#ffd27a', good: true, weight: .7, from: 0,
    rule: 'A blessing: enemies drop 50% more gold, and your wounds close fast.',
    tip: ['The low gold light of evening, held for the stage.', 'Enemies drop 50% more coins; you regenerate 2 health a second.'],
    world: {weather: 'fair', hour: 18.45, grade: {amb: [1.1, .97, .74], sun: [1.15, .92, .6], sunK: 1.25, fog: [.12, .07, .01, .05], glow: 1.3}}},
];
export const omenById = id => OMENS.find(o => o.id === id) || null;

export const TUNE = {
  chance: [.3, .45, .6, .75],   // the roll's chance of an omen by stage (0-based; the last for any later stage)
  ease: 3,                      // s: the weather and the light roll in over about this long (and back out)
  sandboxStage: 1,              // the stage a forced omen plays as in the sandbox (its numbers scale with it)
  storm: {
    first: 2.2, every: [3.4, 5], everyK: .08,   // s to the first bolt once the waves start; s between bolts (x (1 - everyK x stage))
    tele: 1.25, r: 1.7, rod: 4.5,               // the ring's warning (s), what a bolt hurts (m), how far iron draws it (m)
    wild: .45,                                  // from the 3rd stage: the chance a bolt brings a second one down on an enemy
    dmg: 55, dmgK: .45, root: 1.1,              // to enemies (and props) at stage 1 (+45% a stage), s they stand stunned
    hurt: 14, hurtK: 4, knock: 9,               // to you (+4 a stage), m/s you are thrown
    lead: 2.5,                                  // s an enemy you shot (a bullet, an arrow) draws the bolt
  },
  gale: {arrow: 12, arrowK: .1, bullet: 10, run: .25},   // m/s^2 on arrows (+10% a stage), a bullet's share x, the run's +-
  bloodmoon: {dmg: 1.35, pace: .75, coins: 2},
  riftfog: {see: 5.5, seeK: -.4, seeMin: 4, close: 4, crit: .35},   // m seen (-.4 a stage, min), m that count as close, + crit
  eclipse: {lit: 1.6, lantern: 4.2, lanternR: 1.15, fire: 2.6, boom: 3.2, boomT: 1.4},   // x damage in light; m of light (yours,
                                                                                         // a fire's); a blast's m and s
  golden: {coins: 1.5, regen: 2},
};
