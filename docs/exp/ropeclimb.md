# Rope climbing: legs on the wall, side to side, more than one technique (plan, 2026-10-08)

The user's sketch: the cowboy on the West Downs watchtower's east face, the lasso hooked over the lookout's parapet, his
feet planted on the stones and his body leaning back on the rope, and the wish to **walk side to side while he climbs**,
with **several rope techniques** instead of one.

## What it is called

- **Wall-walk** (climbers: *batmanning*): up a fixed rope hand over hand while the feet walk up the wall, the legs about
  level, the body leaning back on the rope. The sketch's pose.
- **Rappel** (abseil) is the same stance going down. Without a harness (a cowboy) it is the **body rappel**
  (*Dülfersitz*): the rope between the legs, round the hip and over the shoulder. **Rappel bounds**: push off the wall,
  drop, land the feet lower.
- **Tension traverse**: side-stepping across the face while leaning on the rope. The farther from under the anchor (the
  rope's angle θ from the fall line), the harder the rope pulls him back.
- **Running pendulum**: past the traverse's limit, running back and forth across the face to swing farther (to a window,
  round a buttress).
- **Hand-line**: on a slope, walking upright and pulling along the rope.
- **Foot lock** (S-wrap / J-hook): climbing a free-hanging rope with the legs wrapped round it, inchworm style.
- **Top-out**: over the lip at the top (a hand on the merlon, a knee through the crenel).

## What the game does now

- **Rope-up** (`sim/player/lasso.js` `ropeStep`, the brawl work, [brawl.md](brawl.md) section 5) plays by itself: he walks
  to the face's foot, rises straight up at a fixed 1.7 m/s with the ladder's `climb.N` frames, and mantles. You don't steer
  it, his feet never touch the wall, and the rope is a straight line from the anchor to his hand.
- **The ladder** (`sim/player/player.js` state `climb`, `CLIMB_T`) plays by itself too, at a fixed pace.
- To build on: the rope swing (`hang`: a pendulum in the world, WASD pumps it, F climbs the rope), the climb's camera
  assist (`sim/player/adapter.js` `pa.assist`), the live hero's two-bone IK for arms and legs (`view/livehero.js`
  `ikRight` / `ikLeg`), `feet()` (terrain IK), the adaptive mantle kinds, live clips from `western.py` exported with `--clips`.

## Decided with the user (2026-10-08)

- **Full control** on the wall: W / S up and down the rope, A / D along the face, Space pushes off (a bound), F lets go.
  What's under his feet picks the technique; there's no technique button.
- **Rope physics** for side to side: a tension traverse near the anchor's fall line, slipping into a pendulum past the
  limit, pumped further with A / D in time with the swing. To cover more ground, throw the lasso at a new anchor.
- **First pass has all of it**: wall-walk + side-step + top-out, rappel bounds + running pendulum, foot lock + hand-line,
  and the **ladder rework** (controllable, hands and feet on the rungs).
- **The camera eases to side-on** when he takes the wall: it turns until the face is seen at about 45 degrees, where the
  lean-back stance reads. It doesn't fight the player's own turning afterwards.

## The model (sim)

A new mode in a new file, `src/sim/player/ropewall.js`, driven the way `lasso.js` drives the player (it runs inside
`player.js`'s step, fixed 1/60 s steps, no random draws; while it drives, it writes P's frame / face / state / x / y / z
like the lasso does). Tuning lives in `src/content/ropewall.js`.

- **The face frame**: an origin on the face, `u` along it (horizontal), the outward normal `n`, up. The anchor A at the
  lip (ua, ha). His state: where his feet are on the face (u, h), the rope's length from A to his hands, the swing's angle
  and speed in the face's plane, the technique.
- **Where faces come from**: the watchtower plan already has them (`plan.faces`, the broken top `plan.top(p)`, the
  slits, the string course at the lookout's floor): a small `faceAt(x, y, h)` query is added there. The mesa's climb faces
  come from `layout.js`. Anywhere else, a few `W.solid` probes toward the wall each step (never a scan over props).
- **Technique by what's under his feet** (checked every step, with a little hysteresis so it doesn't flicker):

| under his feet | technique | first numbers (tunable) |
|---|---|---|
| a slope under ~50 degrees | hand-line | walk at his walk pace x .6, rope arms |
| a wall, ~50-105 degrees | wall-walk | up .9 m/s, down 1.2 m/s, side .8 m/s at θ = 0 |
| nothing within .6 m (an overhang, a gap, the rope hangs clear) | foot lock | .6 m/s, .45 m a cycle |
| a sill / slit / string course >= .12 m deep | rest | sits back on the rope |
| his hands within .5 m of the lip | top-out | mantle kind by the lip (merlon / crenel / flat) |

- **Side to side**: the side speed falls as θ grows. Past ~35 degrees his feet slip, and he swings back in the face's
  plane (θ'' = -g / L sin θ, the swing's integrator). A / D held with the swing pumps it (the running pendulum), up to ~60
  degrees. Releasing at the top of a swing near a sill or slit grabs it.
- **Rappel bounds**: Space pushes off (out ~1.6 m/s), he drops ~1.2 m in ~.7 s while the rope pays out, and his feet land
  on the face. Near the ground (under ~1.5 m) Space jumps off instead.
- **Entry**: the lasso's rope-up hands off to `ropewall` once the rope catches (he walks to the foot as now, then the
  player has control). A swing whose feet reach a wall plants them and goes into the wall-walk. F on a free-hanging swing
  (today's "climb the rope") becomes the foot lock.
- **The camera**: at the catch, an assist like the ladder's (`pa.assist`) eases the yaw to the nearer of the two angles
  with the face at ~45 degrees, only when it's outside 30-60 degrees, and back to where it was when he's off the wall.
  The keys follow the screen: A / D move along `u` by its on-screen direction.
- **The ladder**: Space at the foot or the top starts the climb as now. Then W / S climb and descend at a pace and stop
  when you let go, Space steps off at either end, S + Shift slides down the rails. The sim keeps the rung phase (its
  height in rungs) for the view.
- **Off switches**: `?ropewall=0` brings back the old rope-up, `?ladder=old` the old ladder (both declared in
  `core/flags.js`).

## The view (live hero)

- **The clips** (a new "rope wall" section at the END of `tools/blender/western.py`, after the lasso session's "lasso
  live"): `mv_rw_stand` (the sketch's lean-back), `mv_rw_up` (hand over hand + a step, 4 keys), `mv_rw_side` (a shuffle
  step, mirrored), `mv_rw_bound`, `mv_rw_run` (the pendulum run), `mv_rw_rest`, `mv_rope_lock` (inchworm),
  `mv_rw_top`, `mv_ladder` (rung climb, 4 keys) and `mv_ladder_slide`. The hand-line is the walk's legs layered with
  rope arms.
- **Driven by distance**: each cycle's phase comes from how far he moved, so feet don't skate. Stepped time, as
  everywhere on the live hero.
- **Feet planted**: each foot stays where it touched the face until its step mark, then moves to the next spot (leg IK
  onto the face plane). The hands grip points on the rope line and slide only at their grab marks (arm IK). On the
  ladder, hands and feet go onto the rungs.
- **The body**: pitched by the rope's angle (the lean back), rolled by θ when he traverses.
- **The rope**: drawn from the anchor, bent over the lip, to his hands, then a tail hanging from the lower hand to the
  ground with a few view-only verlet points, so it swings when he side-steps. `lassolook.js` draws today's straight
  rope; it gets a one-line hook to skip its own while the wall's rope is drawn (asked of its owner, not edited by us).
- **Without the clips** (sprite atlases, a model missing one) each state shows an atlas stand-in (`climb.N`,
  `lasso_hang_N`, `mantle.0`, `crouch`), so code and art land separately.

## Steps (with the user's approval at each gate)

0. **Before starting**: the brawl work (rope-up, the swing additions) is uncommitted; commit it first so this is a clean
   diff on top. Tell the lasso session before touching its files (see Owners).
1. **Pose sheet (gate 1)**: the 8 rope poses + 2 ladder poses on the gunslinger in Blender, one sheet PNG.
2. **Sim with stand-ins**: `ropewall.js` + tune; the wall-walk, side-step, slip / pendulum, bounds, top-out; then the
   hand-line and the foot lock; the camera ease; the controllable ladder. A headless probe course (below).
3. **Live clips (gate 2)**: the western.py section, export with `--clips`, a strip PNG + an H.264 MP4 for review.
4. **Live glue (gate 3)**: the livehero ROPEWALL section (clips by technique and distance, plants, hand IK, pitch / roll,
   the rope's drape and tail, the ladder's rung IK). An in-game reel (MP4 + strip).
5. **Extras**: slits as holds from a pendulum, round a corner, sounds (boot scuffs on stone, rope creak, grit when the
   feet slip), the Ranger (no lasso: the ladder only).

## The probe course and checks

- **Stations** (headless, the session's own ports, `tools/lib/chrome.mjs` `launch()`): the tower's east face (the sketch),
  a traverse to the slip and back, a pumped pendulum, bounds down to the ground, the top-out onto the lookout, a mesa face,
  a slope (hand-line), a free hang (a rope from a limb: the foot lock), the ladder up / stop / down / slide.
- **Meters**: foot slide on the face while planted (cm), hand-on-rope error (cm), frames with a foot through the wall,
  pose pops (px), shimmer (changed / flicker px per frame), cost (`ropewall` step, the view's IK + rope).
- **Checks**: simview (the wall climb's sim the same without its views), smoke, golden (should be identical: the tour
  neither climbs nor uses the lasso), `ab.mjs` on the per-frame view code, `?owncheck=1` (new P
  fields in `OWNERS`).

## Owners and touch points

- **New**: `src/sim/player/ropewall.js`, `src/content/ropewall.js`, a rope-drape / tail view file, the western.py
  section, the livehero ROPEWALL section.
- **The lasso session's files** (ask first): `sim/player/lasso.js` (the hand-off from `ropeup` / `ropeStep`),
  `features/equip/lasso.js` (`ledge()` returning the face), `features/equip/lassolook.js` (the skip hook),
  `content/lasso.js`.
- **Shared, small and additive**: `sim/player/player.js` (the ladder; CRLF: edit with Python, `newline=''`),
  `sim/player/adapter.js` (the camera assist), `world/watchtower.js` (`faceAt`), `world/layout.js` (mesa faces),
  `core/flags.js`, `core/events.js` (`rope.step`, `rope.slip`, `rope.bound`, `rope.top`), `audio/audio.js`,
  `dev/owncheck.js`.
- **Live re-exports**: the lasso and character-look sessions export too; say before and after each one.

## Progress

- 2026-10-08: the brawl work this builds on is committed (main db84e10..a2f6aa1, with its prerequisites).
- Gate 1, the pose sheet: `tmp/ropeclimb/rope_poses_gate1.jpg`, 11 poses on the gunslinger (smooth renders, side-on and
  the game's 3/4). Made by a scratch Blender script on frozen copies of the sources (western.py untouched): the poses
  are bone specs in western's conventions with LIVE_AT wrists on the rope, so they move into a "rope wall" section of
  western.py as they are once approved. Weakest stills: the pendulum run (reads only in motion) and the sill rest (stands
  more than it sits back). Approved by the user 2026-10-08.
- Gate 2, the sim with stand-ins (2026-10-08, uncommitted): `src/sim/player/ropewall.js` (+ `src/content/ropewall.js`), the
  ladder `src/sim/player/ladder.js`; hooks: player.js (H.ropewall, the step, the climb state -> the ladder), adapter.js (the
  camera's 'ease' phase), flags `ropewall` / `ladder`, events `rope.step / slip / bound / top`; the lasso session added the
  hand-off in its files (sim/player/lasso.js ropeup -> PL.ropewall.start, letGo / wallDone; features/equip/lasso.js lets Space
  through). Stand-in frames: the lasso's hang poses, climb, run, leap, mantle, crouch, walk.
  - Try it: `?mode=sandbox&set=gunslinger&equip=lasso&at=-32,10.6` (east of the West Downs watchtower): hold F, put the cursor
    on the lookout's low parapet over the east face, let go. On the face: W / S, A / D along it, Space bounds, F lets go. The
    tower's ladder (or the mesa's): E, then W / S, S + Shift slides, Space drops.
  - Probe `tmp/ropeclimb/probe.mjs` (ports 8283 / 9483; scenarios wall, down, ladder, swing, free, line, lasso, cost): all
    pass: up 0.9 m/s, the traverse holds to 18 deg and drifts back past it, slips at 35 deg into the swing (pumped to its 62 deg
    cap, settles in ~2.5 s), the bound drops 1.05 m, the top-out lands on the deck (z 6.24), S at the foot steps off, F drops
    him; the foot lock (a stand-in overhang) climbs ~0.5 m/s; the hand-line walks a 40 deg mesa bank onto its top; the real
    lasso throw hands off and tops out; the ladder goes up, stops, over the top, down, slides; the camera eases side-on and
    back. Reel `tmp/ropeclimb/ropewall_gate2.mp4` + `ropewall_gate2_strip.png`.
  - Checks: golden A/B (frozen mirrors without / with): 16/16 identical; smoke passes; simview passes; owncheck clean; PL.step
    3-8 us a step on the face vs 3.5 standing (nothing per frame otherwise).
  - Not yet: slits as holds (the tower's slits aren't in the world's queries).
- Gates 3 + 4 together (2026-10-09, uncommitted; the user: the stand-ins looked wrong, an upright ladder frame hovering out
  from the face):
  - The live clips: western.py "the rope wall" (RW_LIVE: rw_stand, rw_up, rw_side / _r, rw_bound, rw_run, rw_rest,
    rope_lock, rw_top, hand_line, ladder_up, ladder_slide), generated from the approved pose sheet by
    `tmp/ropeclimb/tools/ropeposes.py --emit` (keys rwk_*, mirrored halves for the cycles, the wrists on the rope by
    LIVE_AT; its pose() wrapper re-holsters the revolver in the in-betweens). The sheet's hand targets had a sign slip
    (k clamped to 1e-3: the wrist aimed ~1000 m up the rope); fixed: the upper hand now grips the rope at the face.
    Exported and installed for the gunslinger and the outlaw (CLOTH_BAKED=1): additions only, every old pose and
    model.bin identical (backups tmp/ropeclimb/backup_models).
  - The live glue: view/livehero.js ROPEWALL: the clip by the technique and the distance moved (S.mv / S.dir / S.rest
    from the sim, PL.ladder's height), squared to the face (rwFace), the balls of the boots put on the face at the sim's
    point (rwPlace: the keys are posed in the wall's frame, the body is moved, not bent).
  - The rope: the lasso session made lassolook end the rope at the drawn upper hand (it took the sim's atlas marker:
    ~0.6 m off the live body); features/ropetail.js (new, view only) draws the rest: the upper hand to the brake hand, the
    tail hanging to the ground a hand out from the stones (swaying with his moves along the face) and its loose end on
    the grass. A verlet tail was tried first: a short rope pinned to a hand dragged up a wall flails, so the shape is
    worked out each frame instead.
  - Reel `tmp/ropeclimb/ropewall_live.mp4` + `ropewall_live_strip.png` (2x zoom). Checks: golden A/B 16/16, smoke, simview
    (before the tail; smoke and simview again with it).

## Decided after the plan (2026-10-08)

- **The camera goes back** to where it was when the climb ends (as the ladder's assist does).
- **Anchors are a thing in the world** (the user left the details to me). A structure lists its anchor points (where a
  loop can catch: merlons, a parapet's lip, a post, a limb), each with the top to stand on behind it. On the tower: the
  stretches of its broken top that stand at most 1.6 m over the lookout (the south half of the east face, the south
  face beside the breach), so the rope always leads to somewhere you can stand. The tall north and west walls take no
  loop: they're for the **rope with a hook** (a later gadget), which can catch on any lip and needs no anchor.
- **Slits and windows keep both options open**: each one says whether it is a hold (rest there, swing on), a way in, or
  neither (too narrow, or blocked). Today's tower slits are holds; its inside stays sealed until a way in is wanted.
