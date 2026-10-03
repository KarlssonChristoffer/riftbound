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
  // CHAMPION: a tug of war: it heaves you toward it at `pull` m/s for `heave` s, then slackens `slack` s (the window: a
  // yank then lands; one outside it jolts you `jolt` m/s toward it instead)
  boss: {pull: 2.1, heave: 1.05, slack: .42, jolt: 6},
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
// high things a loop drops over (their top, m): a prop of these kinds is an anchor (the 3D trees' limbs are too, and the
// lasso's own: features/equip/anchors.js)
export const ANCHOR_TOP = {gatepost: 2.85, tower: 3.9, pillar: 2.6, windmill: 4.9, water_tower: 4.1, signpost: 2.7};
