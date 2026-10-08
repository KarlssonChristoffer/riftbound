// BRAWL: the live cowboys' hands-on moves (docs/exp/brawl.md): the boot (V), the shoulder barge (V at a sprint), lifting and
// throwing things (E, LMB). Data only: metres, seconds, m/s, damage at stage 1 with no items. The player's side is
// sim/player/brawl.js, what the blows and the throws do is features/brawl.js; thrown bodies fly by sim/bodyfly.js.
export const TUNE = {
  // THE BOOT (V): a front push-kick, `dur` s, its blow at `hit` s (the live clip's own marks win: mv_kick hit / plant), planted;
  // he squares up to the cursor, or onto a target within `snap` deg of it in reach. The blow: everything within `reach` m and
  // `arc` deg in front takes `dmg` and a THROW: `out` m/s along the kick, `up` m/s up (a body: by its heft below); a prop is
  // shoved at `prop` m/s (a crate `crate`); a loose thing (a hat, a gun) at `loose` m/s, up `looseUp`. `step`: m/s forward into it
  kick: {dur: .44, hit: .17, snap: 40, reach: 1.45, arc: 100, dmg: 8, out: 6.6, up: 3.4, prop: 7.2, crate: 5.4, loose: 6, looseUp: 2.4, step: 1.6, cool: .12},
  // THE BARGE (V while sprinting faster than `min` m/s): `dur` s along his run at `speed` m/s (WASD steers it a little, `steer`
  // rad/s), the shoulder's blow from `hit` s on: whoever is within `reach` m ahead (across `width` m) is thrown along the run
  // (`out`, `up`) and he bowls on through; a prop is shoved at `prop`. A wall ends it with a bump back (`bump` m/s). He comes out
  // running at `exit` x the run's speed
  barge: {min: 5.2, dur: .38, hit: .02, speed: 7.6, steer: 1.4, reach: .95, width: .85, dmg: 10, out: 7.4, up: 2.6, prop: 8, bump: 3.5, exit: .85},
  // A THROWN BODY (sim/bodyfly.js): fall damage past `fall0` m of drop, `fallK` per m over it; a slam into a wall `slam0` +
  // `slamK` x (m/s over the slam's minimum), at most `slamMax`; it lies `stun` s where it rests (in water `wet`, then out on the
  // bank it came from; a gunman's powder is wet a while: no shot for `powder` s); whoever it flies into (within `bowl` m of
  // its path, under 1.3 m up) takes `bowlDmg` and is knocked down too
  body: {fall0: 2.2, fallK: 14, slam0: 4, slamK: 3, slamMax: 18, stun: 1.1, wet: 1.6, powder: 4, bowl: .55, bowlDmg: 8},
  // how heavy each body is to throw (x the throw's speeds is 1 / heft); a champion only staggers (`stagger` s held)
  heft: {bandit: 1, sheriff: 1.35, bruiser: 1.7, brute: 1.15, elite: 1.7, boss: 0}, stagger: .5,
  // LIFT (E at something liftable within `reach` m in front; nothing to use nearer): `lift` s to pick it up (the clip's grab mark
  // at `grab` s: it leaves the ground then); carried: he moves at `speed` x his own; held `hold` m ahead of his middle at
  // `h` m (a small thing `hSmall`); E sets it down `put` m ahead; Space drops it at his feet (and rolls)
  carry: {reach: 1.25, lift: .5, grab: .21, speed: .8, hold: .56, h: .86, hSmall: 1.18, put: .75},
  // THROW (LMB while carrying): `dur` s, it leaves the hands at `release` s (the clip's mark) from `h0` m up; its speed is
  // solved so its arc ends at the cursor's ground point (at most `range` m; at least `min`), climbing `arc` x the distance at the
  // top (a heavy thing `arcHeavy`); at most `vmax` m/s
  throw: {dur: .44, release: .19, h0: 1.45, range: 11, min: 1.5, arc: .28, arcHeavy: .2, vmax: 13},
};
// what can be lifted (prop kinds), and how heavy each is in the hands (heavy: both hands, the gun can't come out; small:
// held higher, thrown further)
export const LIFT = {crate: 'heavy', barrel: 'heavy', barrel_x: 'heavy', pot: 'small', gunman_gun: 'small', gunman_hat: 'small'};
