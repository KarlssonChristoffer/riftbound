// LASSO: the equipment experiment's lasso (a gun loadout's gadget on F: features/equip/lasso.js, the player's side in
// sim/player/lasso.js, the look in features/equip/lassolook.js). Data only: metres, seconds, m/s, damage at stage 1 with no
// items (a run's damage stat and its stage scale every number marked dmg, as the other gadgets: features/equip/sim.js dmgK).
// THE TUNING KNOBS are TUNE below; POSES says which atlas poses each part plays (the art's names, and what stands in for
// them in an atlas without them: one table, so the real poses replace the stand-ins by their names alone).
export const TUNE = {
  // SPIN (F held): the loop grows to full size over `grow` s, turns `rps` times a second overhead; he walks at `walk` x
  // his speed (a host.mods note on player.speed); a throw before `min` s still goes, from a smaller loop
  spin: {grow: .3, rps: 2, r: .36, h: .42, tilt: .2, walk: .5, min: .08},
  // AIM: what the loop goes for (under the cursor): an enemy or a prop within `range` m, a high anchor (>= anchorMin m up)
  // within `range` m of the hand and `pick` px of the cursor on screen, else the ground (at most `range` m out)
  range: 10, pick: 18, anchorMin: 2.5,
  // THROW: the loop flies in an arc (time t0 + tk x d, at most tMax; up `arc` m at its middle per 10 m) and catches the
  // first body, movable prop or anchor its opening (`catchR` m) meets (sub-stepped every `sub` m)
  throw: {t0: .16, tk: .034, tMax: .5, arc: 1.1, catchR: .34, sub: .15},
  // MISS: it lies `lie` s, then comes back at `reel` m/s; the slot cools down `cd` s (GADGETS.lasso.cd) once it's back
  miss: {lie: .18, reel: 11},
  // HOLD (a body or a prop on the rope): the rope's length is the distance at the catch (at most `len` m); walking away
  // drags it along at up to `drag` m/s (an elite `dragElite`; a champion not at all), you haul at `haul` x your speed and
  // the rope stretches `stretch` m before it holds you back; a roped enemy can't attack; it slips after `slip` s (elites
  // `slipElite`, the champion `slipBoss`); a press of F shorter than `tapMax` s is a yank
  hold: {len: 9, haul: .45, slip: 3.4, slipElite: 2.2, slipBoss: 4.5, drag: 3.2, dragElite: 1.2, stretch: .3, tapMax: .22},
  // YANK (tap F while roped): it flies at you off its feet in `dur` s, `h` m up at the middle, lands `stop` m short of you,
  // takes `dmg` (+ `dmgFly` to anyone it bowls over on the way) and lies stunned `stun` s (elites `stunElite`)
  yank: {dur: .42, h: 1.1, stop: 1.15, dmg: 18, dmgFly: 12, stun: 1.5, stunElite: .9, stunBoss: .8, bowl: .55},
  // CHAMPION: a tug of war: it heaves you toward it at `pull` m/s for `heave` s, then slackens `slack` s (the window: a
  // yank then lands; one outside it jolts you `jolt` m/s toward it instead)
  boss: {pull: 2.1, heave: 1.05, slack: .42, jolt: 6},
  // PROPS: a barrel / crate on the rope is towed through the prop physics (combat/props.js shove) at the pull's speed; a
  // yank shoves it at `yankV` m/s
  prop: {yankV: 6.5, towMax: 4.5},
  // SWING (an anchor >= anchorMin m up): a pendulum (gravity `g`) round the anchor; the rope's length is the distance at the
  // catch shortened by `lift` (reeled in over `reelT` s; at most the anchor's height less `clear` + the hang, so his feet
  // clear the ground under it, but never below `minLen`); his speed at the catch + `up` m/s up is the start. WASD pumps
  // (`pump` m/s2). Tap F or Space to let go: he flies on (the player's fall). It ends by itself after `max` s, a bump on
  // a wall (`bump` x the speed back), or `rest` s on the ground
  swing: {g: 15, lift: .12, reelT: .28, clear: .35, minLen: 1.1, up: 2.2, pump: 3.5, max: 6, bump: .25, rest: .3, hang: 2.05, damp: .02},
  // HAMMER (hold F while roped, a stretch): it swings round you at `rps` turns a second; let go flings it out `v` m/s,
  // `dmg` to it and to whoever it hits
  hammer: {rps: 1.1, r: 2.2, v: 9, dmg: 22, hold: .25},
};
// the poses (the art: concepts/sprites/out/outfits/<cowboy>/; frames of a clip are `<clip>.<i>`, the rest stand alone). `fb`:
// what plays in an atlas without them (a frame list, or for the walk / run the gait's own frames)
export const POSES = {
  spin: {clip: 'lasso_spin', fb: ['reach_up']},                      // standing: the loop overhead (a loop)
  walk: {pre: 'lws_', fb: 'walk.'},                                  // walking / running with the spinning arm (the walk / run legs)
  run: {pre: 'lrs_', fb: 'run.'},
  throw: {clip: 'lasso_throw', fb: ['reach_up', 'lunge', 'lunge', 'lunge'], fps: 14, release: 1},   // its marks.release: the loop leaves
  haul: {pose: ['lasso_haul_0', 'lasso_haul_1'], fb: ['skid_b', 'skid_a']},   // the taut hold, leaning back (two: a step)
  yank: {clip: 'lasso_yank', fb: ['skid_a', 'skid_b', 'skid_b'], fps: 12},
  hang: {pose: ['lasso_hang_0', 'lasso_hang_1', 'lasso_hang_2'], fb: ['climb.0', 'climb.1', 'climb.2']},   // legs forward / straight / back
};
// the rope hands in the packed meta bones (each [hx, hy, tx, ty]: the HEAD point is the grip); the hand bones stand in
export const HANDS = {grip: 'RopeHand0', upper: 'RopeHand1', fb: ['RightHand', 'LeftHand']};
// the rope's look: lit / mid / shade (hemp)
export const ROPE = ['#c8a876', '#9a7c50', '#6a5234'];
// high things a loop drops over (their top, m): a prop of these kinds is an anchor (the 3D trees' limbs are too, and the
// lasso's own: features/equip/anchors.js)
export const ANCHOR_TOP = {gatepost: 2.85, tower: 3.9, pillar: 2.6, windmill: 4.9, water_tower: 4.1, signpost: 2.7};
