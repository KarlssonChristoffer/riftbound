// LASSO: the equipment experiment's lasso (a gun loadout's gadget on F: features/equip/lasso.js, the player's side in
// sim/player/lasso.js, the look in features/equip/lassolook.js). Data only: metres, seconds, m/s, damage at stage 1 with no
// items (a run's damage stat and its stage scale every number marked dmg, as the other gadgets: features/equip/sim.js dmgK).
// THE TUNING KNOBS are TUNE below; POSES says which atlas poses each part plays (the art's names, and what stands in for
// them in an atlas without them: one table, so the real poses replace the stand-ins by their names alone).
export const TUNE = {
  // SPIN (F held): the loop grows to full size over `grow` s, turns `rps` times a second overhead (with the art: as the
  // hand turns), `h` m over his hand, its honda trailing the hand by `lag` rad; he walks at `walk` x his speed; a throw
  // before `min` s still goes, from a smaller loop
  spin: {grow: .3, rps: 2, r: .36, h: .45, lag: .5, tilt: .14, walk: .5, min: .08},
  // AIM: what the loop goes for (under the cursor): an enemy or a prop within `range` m, a high anchor (>= anchorMin m up)
  // within `range` m of the hand and `pick` px of the cursor on screen, else the ground (at most `range` m out)
  range: 10, pick: 18, anchorMin: 2.5,
  // THROW: the loop flies in an arc (time t0 + tk x d, at most tMax; up `arc` m at its middle per 10 m) and catches the
  // first body, movable prop or anchor its opening (`catchR` m) meets (sub-stepped every `sub` m)
  throw: {t0: .16, tk: .034, tMax: .5, arc: 1.1, catchR: .34, sub: .15},
  // MISS: it lies `lie` s, then comes back at `reel` m/s; the slot cools down `cd` s (GADGETS.lasso.cd) once it's back. A
  // tumbleweed within `weed` m of where it lands is snagged and dragged home with it (the view's: tumbleweeds are)
  miss: {lie: .18, reel: 11}, weed: 1.25,
  // HOLD (a body or a prop on the rope): the rope's length is the distance at the catch (at most `len` m); walking away
  // drags it along at up to `drag` m/s (an elite `dragElite`; a champion not at all), you haul at `haul` x your speed and
  // the rope stretches `stretch` m before it holds you back; a roped enemy can't attack; it slips after `slip` s (elites
  // `slipElite`, the champion `slipBoss`); a press of F shorter than `tapMax` s is a yank
  hold: {len: 9, haul: .45, slip: 3.4, slipElite: 2.2, slipBoss: 4.5, drag: 3.2, dragElite: 1.2, stretch: .3, tapMax: .22},
  // YANK (tap F while roped): it flies at you off its feet in `dur` s, `h` m up at the middle, lands `stop` m short of you
  // (a gunman `stopMan`: he falls flat on his back, his head toward you), takes `dmg` (+ `dmgFly` to anyone it bowls over on the way)
  // and lies stunned `stun` s (elites `stunElite`)
  yank: {dur: .42, h: 1.1, stop: 1.15, stopMan: 2.4, dmg: 18, dmgFly: 12, stun: 1.5, stunElite: .9, stunBoss: .8, bowl: .55},
  // STRENGTH (docs/exp/lasso.md "Strength"): what's on the rope weighs WEIGHT (below) against your PULL: `pull` at a quick
  // throw x `lo`, up to x `hi` as the loop spins up over `charge` s (it spins `fast` x faster then), x the modifiers'
  // 'lasso.pull'. The ratio pull / weight is its CLASS: >= `light`: light, >= `even`: even, >= `heavy`: heavy, else strong.
  //   light   it comes: dragged at hold.drag, a yank throws it at your feet (YANK), the hammer throw
  //   even    it fights: dragged at even.drag, it tugs back now and then, a yank only trips it (it falls toward you)
  //   heavy   it won't come: the loop SNARES its legs (SNARE) and you let the rope go
  //   strong  it pulls YOU: a tug of war (STRONG)
  str: {pull: 1, lo: .85, hi: 1.3, charge: 1.2, fast: .5, light: 1.15, even: .78, heavy: .42},
  // EVEN: dragged at `drag` m/s; every `tug` [lo, hi] s it tugs back `tugT` s at `tugV` m/s (the rope drags you along); a yank
  // trips it: it falls `trip` m toward you (`tripH` m up, `tripDur` s), takes `tripDmg`, lies stunned `stun` s
  even: {drag: .9, tug: [1.3, 2.1], tugT: .45, tugV: 1.6, trip: 1.1, tripH: .35, tripDur: .32, tripDmg: 8, stun: .9},
  // SNARE (heavy): the cowboy's snare clip (`clip` s; the rope snapped down onto its legs at `cinch` s), then it stands rooted
  // `dur` s (an elite `durElite`), the loop round its ankles, the rope let go; then it kicks free and the loop comes home
  snare: {clip: .55, cinch: .22, dur: 2.4, durElite: 1.8},
  // STRONG: a tug of war: it heaves, reeling you in at `reel` m/s for `heave` s, then slackens `slack` s (the window: a yank
  // then trips it, `trip` m, stunned `stun` s; one in a heave jolts you `jolt` m/s toward it and the rope is lost). Reeled in
  // to `near` m it lets go of the rope, and you're within its reach
  strong: {reel: 2.1, heave: 1.05, slack: .42, near: 1.5, jolt: 6, trip: .9, stun: .8},
  // PROPS: a barrel / crate on the rope is towed through the prop physics (combat/props.js shove) at up to `towMax` m/s; a
  // yank shoves it at the speed that rolls / slides it to `stop` m short of you (its own friction), at most `yankV` m/s
  prop: {yankV: 8, towMax: 4.5, stop: 1.3},
  // A LIT BRAZIER caught is pulled over toward you (lights.js topple: out, on its side); its coals spill `spill` m from it
  // toward you, a burning patch `r` m round for `dur` s (the fire flask's pool: it burns enemies in it, wood catches)
  brazier: {spill: 1.1, r: .85, dur: 4},
  // SWING (an anchor >= anchorMin m up): a pendulum (gravity `g`) round the anchor, from his grip (the hang poses'
  // RopeHand1; `hang` m over his feet in a pose without it); the rope's length is the distance at the
  // catch shortened by `lift` (reeled in over `reelT` s; at most the anchor's height less `clear` + the hang, so his feet
  // clear the ground under it, but never below `minLen`); his speed at the catch + `up` m/s up + `push` m/s toward the
  // anchor's foot is the start (he jumps off). WASD pumps (`pump` m/s2); feet on the ground slow him (`drag` /s); F held
  // climbs the rope (`climb` m/s: shorter, the swing quickens). Let go of F (or Space): he flies on (the player's fall).
  // It ends by itself after `max` s, a bump on a wall (`bump` x the speed back), or `rest` s on the ground
  swing: {hang: 1.95, g: 15, lift: .12, reelT: .28, clear: .35, minLen: 1.1, up: 2.2, push: 1.6, pump: 3.5, drag: 2.5, climb: 3.6, max: 6, bump: .25, rest: .3, damp: .02},
  // HAMMER (hold F `hold` s while roped): it's swung off its feet round you, `h` m up, the rope growing to `r` m and the
  // turns to `rps` a second over `spinUp` s; whoever it swings into (within `bowl` m) takes `dmg` (it half); let go (or
  // after `max` s) and it's flung out along its way at `v` m/s for `dur` s, `dmg` on landing, stunned
  hammer: {hold: .25, rps: 1.1, spinUp: .5, r: 2.1, h: .7, bowl: .6, dmg: 22, v: 9, dur: .55, max: 3},
  // TRAVERSAL (docs/exp/brawl.md). ZIP: an anchor caught more than `drop` m under his hand and `min` m away (his throw reaches
  // `range` m from up high) is a zip line: the rope's end hitched where he stands (`hitch` s), he hangs from it by his hands and
  // slides down: gravity along the line, `fric` (x g, the hands' grip) and `drag` (1/s) against it, at most `max` m/s; he drops
  // off `end` m short of the anchor (flying on), where his feet touch the ground (he runs on), or with F / Space. The hitch is
  // `over` m over his hanging grip (he hops off the edge); nothing stops him the first `clear` m (the parapet he leaves)
  zip: {drop: 1.1, min: 3, range: 16, hitch: .22, fric: .08, drag: .15, max: 13, end: .6, v0: 1.2, over: .35, clear: 2.2},
  // ROPE UP: an anchor at the lip of something to stand on (the watchtower lookout's parapet, a ledge's tree), `high` m or more
  // over his feet, a top to stand on within `reach` m of it (under it, at most `under` m), him within `near` m of the face's foot:
  // he walks to the foot (`walk` m/s), climbs the rope up the face (`climb` m/s), mantles over onto the top (`mantle` s)
  ropeup: {high: 1.8, reach: 1.6, under: 4.5, near: 4.5, walk: 2.2, climb: 1.7, mantle: .38},
  // PULL STONES: the top of a stone wall's broken stretch too high to vault (over `min` m, at most `max` m: a whole stretch is
  // never pulled) is a target; caught, a tap of F brings its top course down toward you: the stretch is `dh` m lower over `w` m
  // (world.js pullWall: never under `floor` m), the stones fall your side, hurting whoever stands within `hit` m of its foot
  pull: {min: 1.25, max: 2.35, dh: .7, w: 1.2, floor: .8, hit: 1.4, dmg: 14},
};
// the poses (the art: concepts/sprites/out/outfits/<cowboy>/; frames of a clip are `<clip>.<i>`, the rest stand alone). `fb`:
// what plays in an atlas without them (a frame list, or for the walk / run the gait's own frames)
export const POSES = {
  spin: {clip: 'lasso_spin', fb: ['reach_up']},                      // standing: the loop overhead (a loop)
  walk: {pre: 'lws_', fb: 'walk.'},                                  // walking / running with the spinning arm (the walk / run legs)
  run: {pre: 'lrs_', fb: 'run.'},
  throw: {clip: 'lasso_throw', fb: ['reach_up', 'lunge', 'lunge', 'lunge'], fps: 14, mark: 'release', at: 1},   // marks.release: the loop leaves
  take: {clip: 'lasso_take', fb: ['skid_b'], fps: 12},              // the rope goes taut: the throw's end into the hold
  haul: {pose: ['lasso_haul_0', 'lasso_haul_1'], fb: ['skid_b', 'skid_a']},   // the taut hold, leaning back (two: a step)
  yank: {clip: 'lasso_yank', fb: ['skid_a', 'skid_b', 'skid_b'], fps: 12, mark: 'pull', at: 1},   // marks.pull: it comes off its feet
  // legs forward / straight / back; grip: the marker the rope's end is pinned to (RopeHand0 | RopeHand1, or 'auto': the
  // higher of the two in each frame: the hand on the rope, whichever the art uses)
  hang: {pose: ['lasso_hang_0', 'lasso_hang_1', 'lasso_hang_2'], fb: ['climb.0', 'climb.1', 'climb.2'], grip: 'RopeHand0'},
  // onto the rope: the arm goes up, the hat slides onto his back (backward as he lets go); marks.grip: the fist closes on the
  // rope (before it he is still on his feet: the swing lifts him from there)
  hangIn: {clip: 'lasso_hang_in', fb: [], mark: 'grip', at: 0},
};
// the rope hands in the packed meta bones (each [hx, hy, tx, ty]: the HEAD point is the grip); the hand bones stand in
export const HANDS = {grip: 'RopeHand0', upper: 'RopeHand1', fb: ['RightHand', 'LeftHand']};
// the rope's look: lit / mid / shade (hemp)
export const ROPE = ['#c8a876', '#9a7c50', '#6a5234'];
// WEIGHT against your pull (TUNE.str): the yard's / a run's brute, an elite brute, a champion (boss), the desert's gunmen by
// type (an elite type not listed: x `eliteK`), a movable prop
export const WEIGHT = {brute: .65, elite: 1.7, boss: 3.4, gunman: {bandit: .7, bruiser: 1, sheriff: 1.3}, eliteK: 1.4, prop: .5,
  // the forest's animals (features/rope.js, the bag Lasso): a hare comes, a fox comes (and slips), a roe deer drags you
  animal: {hare: .3, fox: .4, roe: 2.4}};
// high things a loop drops over (their top, m): a prop of these kinds is an anchor (the 3D trees' limbs are too, and the
// lasso's own: features/equip/anchors.js)
export const ANCHOR_TOP = {gatepost: 2.85, tower: 3.9, pillar: 2.6, windmill: 4.9, water_tower: 4.1, signpost: 2.7};
