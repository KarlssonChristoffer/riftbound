// ROPE WALL tuning (sim/player/ropewall.js, sim/player/ladder.js; docs/exp/ropeclimb.md). Metres, seconds, m/s, degrees.
export const TUNE = {
  // the walk to the face's foot before he takes the rope (the lasso's rope-up: the anchor is up there, he is out here)
  approach: {walk: 2.2, max: 3},
  // WALL-WALK: up / down the rope with the boots on the face (up: hand over hand; down: walked down), side: along the face
  // at the fall line (slower the further out: the rope pulls back); step: m a boot step (the frames, the step event); off: how
  // far his body hangs out from the face (the lean back); onto: the first step onto the face (m over the ground)
  walk: {up: .9, down: 1.25, side: .8, step: .32, off: .62, onto: .35},
  // TENSION TRAVERSE: out to `hold` deg from the fall line he stays where he stops; past it he drifts back at `drift` m/s;
  // pushing out past `slip` deg the boots slip and he swings (SWING); out there he still moves at `floor` of his side speed
  tension: {hold: 18, slip: 35, drift: .35, floor: .25},
  // SWING (the pendulum along the face, his boots running on it): g, `damp` per s while he runs with it (A / D with the swing
  // pumps `pump` rad/s^2: the running pendulum), `brake` per s while he doesn't (the boots drag), at most `max` deg; back to the
  // wall-walk once its amplitude is under `settle` deg
  swing: {g: 9.8, damp: .35, brake: 1.1, pump: 1.6, max: 62, settle: 12},
  // RAPPEL BOUND (Space on the wall): out `out` m and down `drop` m in `t` s, the boots back on the face; under `low` m over
  // the ground Space jumps off instead (out `jump` m/s)
  bound: {t: .7, out: .55, drop: 1.05, low: 1.4, jump: 2.4},
  // FOOT LOCK (no face within `reach` m of where his boots would go: an overhang, a gap, a window): up the hanging rope in
  // inchworm cycles of `cycle` m at `up` m/s while moving (down `down` m/s)
  lock: {reach: .5, up: .6, down: 1.0, cycle: .45},
  // REST: still on a ledge under the boots (`deep` m into the face at the boots' height) for `after` s: he sits back on it
  rest: {after: .5, deep: .14},
  // TOP-OUT: the boots `reach` m under the top with W held: up and over onto it in `t` s
  top: {reach: 1.05, t: .55},
  // HAND-LINE: a face under `slope` deg is walked up upright, pulling along the rope, at `walk` m/s (down `down` m/s)
  line: {slope: 50, walk: .95, down: 1.25, side: .7},
  // the camera eases side-on (sim/player/adapter.js: deg off the face's normal), and back after
  cam: {deg: 45, inside: [30, 60]},
};
// THE LADDER (controllable: sim/player/ladder.js): up / down m/s, the slide (S + Shift) m/s, a rung every `rung` m (the frames)
export const LADDER = {up: 1.7, down: 1.9, slide: 5.2, rung: .3, mantle: .28};
