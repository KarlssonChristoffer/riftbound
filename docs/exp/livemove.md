# Live movement: running and jumping on the live hero (2026-10-06)

The user's ask: redo and test the characters' running and jumping, with every movement animation on the live hero
(`view/livehero.js`, [livehero.md](livehero.md)). Before this, the live body replayed the atlas's own poses: the sim
names a frame (`P.frame`) and the live hero drew that pose. So a leap was the atlas's 4 keys switched at fixed points of
the arc, a fall and a landing one pose each, a vault over a wall the leap's keys again, a scramble `mantle.0` then
`crouch`; and every pose stood on flat ground while the game has hills, ramps, banks and stone steps.

Decided with the user: **the cowboys first** (gunslinger, outlaw; the Ranger when he has a live model), **jumps stay
contextual** (Space: roll, leap at water, vault at ledges and breaches; no free jump), **the sim's timing may change**.

## What is built

**FEET ON THE GROUND** (`livehero.js` `feet()`, knob `K.feet`). After the base pose, each foot follows the ground under
it (the middle of its ankle and ball, by the drawn facing and anchor): the body goes down by the lower foot's ground
relative to the anchor's (up by the higher if both are higher), the other leg bends to its own by two-bone IK
(`ikLeg`: hip fixed, the knee in the plane it bends in, the foot keeping its posed rotation), the swing foot as high
over its ground as the pose has it. A foot on the ground (lifted under 6 cm) also tilts with a smooth slope; across a
step's edge (the ground under the foot isn't a plane) it rests on the higher of heel and ball instead of sinking into
the riser. A foot whose ground is more than 40 cm off (over a drop, in a rock face) is left as posed. On while he is on
his feet, eased in and out over 0.1 s (landings, a roll's end).

**MOTION** (`livehero.js` `motion()`, knob `K.move`). New clips made for the live model only (`western.py`, the "live
movement" section at its end, `MOVE_LIVE`; exported with `ragdoll_export.py --clips`, no atlas render), their frames
picked from the sim's state and its progress instead of the frame the sim names:

| clip | frames | picked by |
|---|---|---|
| `mv_leap` | 9: push off (the lead knee driven up, the back leg extended), rise (both legs fold), the top (a split stride, arms out), coming down (the front leg reaching, heel first), reaching for the ground | the leap's progress `P.t / P.leap.dur` |
| `mv_fall` | 5: two loose keys (arms flailing, legs paddling) and their blend, then reaching for the ground | the first three back and forth at 8 Hz; the reach once the ground is 1.2 m under him (after the first 0.08 s) |
| `mv_land_soft` | 3: one leg takes it, the other already swinging through, into the run's down key | the landing's time (also for 0.125 s after a vault over a wall, which ends running) |
| `mv_land_hard` | 5: deep into the knees, the chest over them, coming up into the idle | a fall of more than 1.2 m: by its own time |
| `mv_vault` | 7: a tuck vault: both hands reach, plant on the stones at hip height (wrist IK in the export) as the knees tuck up, the legs swing over, reaching down | the vault's progress (`VAULT_OVER_T`, now exported from `player.js`) |
| `mv_climb` | 6: up a ledge: both hands up on the lip, the chest over (the atlas's `mantle_0`), a knee up, standing up | the scramble's progress (`VAULT_T`) |

The step a move ends on still names its atlas frame (`land`, `leap.3`...): the last of ours is held for it (that one
frame used to flash the old deep `land` squat between a landing and the run).

**The sim's landing** (`player.js` `LAND`): a drop of more than 1.2 m lands hard (0.34 s, braking to a stop: the whole
`mv_land_hard` plays); anything less lands soft (0.12 s), and with a direction held he lands running, no braking (before,
every landing braked him to ~20 % of his speed for 0.12 s and he re-accelerated). The sprite path (the Ranger) gets the
same timings with its `land` pose.

**Dev**: Shift+Alt+7 flips the new movement (feet + motion) off / on: the A/B against the old (`dev/livekeys.js`).

## The movement course (`tmp/livemove/`)

`node tmp/livemove/course.mjs [--set gunslinger|outlaw] [--path src/] [--tag name] [--only a,b] [--gif 1] [--live 0]
[--model dir] [--port 8243 --dbg 9443]`: one headless page on a virtual clock (the golden tools' shim), the player
teleported to each station (`stations.mjs`) and driven by real key events (Space, E, WASD, Shift, Q), every frame
measured from the live body's drawn bones (`live.drawn`, a read-only hook):

- **foot error**: each foot's gap to the ground (the least height of its mesh corners over the ground under each)
  against the height its pose gives it over flat ground (the drawn base pose, `live.stats.base`), for the support foot
  (the lower in the pose) and the swing foot, on idle / move frames not at a ledge's lip;
- **through**: frames with either foot more than 3 cm into the ground (not on ladders, not in water);
- **slide**: the support foot's move over the ground per frame while it stays the support (art px);
- **switch pops**: the most a hand / foot / head / hip / the gun moved on screen relative to his anchor on a frame where
  the drawn clip changed (art px).

Stations: `flat` (walk, run, sprint, skid, turns, stop), `ramp` (the mesa's gully, 1:3) and `ramp_side` (the same, the
camera turned a quarter), `stairs` (the lookout's stone steps), `bank` (found: a slope across the run), `scramble` (the
lookout's 1.15 m face), `vault` (found: a West Downs field wall), `leap` (the stream's narrows), `leapfall` (the wide part
from the edge: into the water), `drop` (off the mesa's south face, 2.4 m), `hop` (off the lookout, 1.15 m), `ladder` (the
mesa's ladder up and down), `roll`. `cmp.py <tagA> <tagB>` prints the two side by side, `reel.py <tags> [stations]`
makes GIFs (tags side by side) and strips, `sheet.mjs` + `strip.py` contact sheets of clips drawn live at several
facings (for authoring), `--model` loads a live model from a scratch dir (the shared one untouched).

## Numbers (the gunslinger; before = the live hero as it was, after = feet + motion)

| station | support foot error cm (mean / max) | swing foot error cm (mean) | frames through the ground |
|---|---|---|---|
| ramp (gully, 1:3) | 4.8 / 16.8 -> **1.9 / 12.3** | 9.1 -> 4.9 | 43 -> 16 |
| ramp side-on | 4.8 / 12.8 -> **1.8 / 8.7** | 9.0 -> 4.8 | 46 -> 18 |
| stone steps | 2.4 / 16.4 -> **1.5 / 14** | 4.8 -> 2.5 | 86 -> 57 |
| bank (slope across) | 5.4 / 20.1 -> **2.4 / 13.6** | 8.2 -> 3.5 | 144 -> 46 |
| vault (field wall) | 3.4 / 11.8 -> 2.2 / 15.5 | 6.8 -> 5.1 | 40 -> 12 |
| leap (narrows) | 1.3 / 7.8 -> 0.8 / 11 | 4.7 -> 2.9 | 10 -> 0 |
| drop (2.4 m) | 3.8 / 34.8 -> 1.1 / 3.3 | 5.8 -> 5.0 | 17 -> 1 |
| hop (1.15 m) | 1.0 / 9.3 -> 1.0 / 13.5 | 2.7 -> 2.8 | 10 -> 0 |
| flat | 0.8 / 25 (unchanged) | 2.3 | 6 (unchanged: the transitions' blends) |

1 cm is ~0.3 art px; a foot 12 cm into a slope is ~4 px. Pops at clip switches stay small (max 1.6-2.1 -> 2.7-3.3 px:
the new clips cut in more often). The leap now shows 9 frames (3 display frames each) instead of the atlas's 4 held up
to 10 frames, and he runs on out of a leap instead of crouching for 7 frames. Strips: `tmp/livemove/out/_s_leap.png`,
`_s_drop.png`, `_s_vault.png` (before over after), `_ramp_side.png`; GIFs `out/<station>_<tags>.gif`.

## Still to do (in order)

1. **The run itself.** It is still the atlas's 8 keys (only grounded now). New live keys (12 a cycle, the stride matched
   to the atlas's so the sim's phase drives it), walk / run / sprint blended by speed, a start and a stop, leaning into
   turns and acceleration (FLOW's lean, today only while aiming).
2. **Hands where they belong**: the vault's hands on the actual stones (their height varies), the scramble's on the
   lip, the ladder's hands and feet on its rungs (runtime IK, as the feet).
3. **A ground guard after the transitions' blend** (the 6 frames on flat ground with a foot 10 cm through: blending
   joint rotations swings a foot under the floor).
4. **Foot lock** (optional, to measure): the planted foot rides with the body for a held frame (slide 1.3-2 px a frame,
   up to 12 px in a skid). Pinning it costs continuous leg motion: weigh it with the shimmer meter.
5. **The outlaw live by default**, then **the Ranger's live model** (bow string and arrow as live lines, his cloak through
   the same runtime cloth as the duster): only then is every loadout's movement live.
