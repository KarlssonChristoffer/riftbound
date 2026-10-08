# Live reactions: a character that notices the world (2026-10-07)

The live hero ([livehero.md](livehero.md)) draws the player from bone matrices, so his body can answer what happens
around him instead of replaying fixed frames. The user picked these from what that unlocks:

- **The world**: a hand on the hat in strong gusts, shielding the eyes in rain, shivering in snow; the head turning to
  birds, enemies and sounds; leaning into turns and starts.
- **Hits**: a flinch in the hit's direction, staggers, a death that becomes a ragdoll.
- **Idles and context moves**: weight shifts, fidgets, sitting on a rock or a low wall, drinking at the brook, leaning on
  a wall.
- **Adaptive jumps**: different jumps for different obstacles, by height and angle.

Decided with the user: **quick wins first** (the groundwork, the head's look, the lean, the flinches), then the adaptive
jumps, then the weather, the idles and the context moves, the death ragdoll last. **Sitting, drinking and leaning start
by themselves** when he stands still near a spot (view only; any input gets him up). For the jumps: **low vaults keep his
running speed**, a **landing roll** after a big drop while running, and **catching the far bank** when a leap comes up
short (not: turning an angled approach toward the obstacle's face).

Split with the live-movement session ([livemove.md](livemove.md)): it keeps `feet()` (the terrain IK), the movement course
and the run cycle; this work owns the jumps, the reactions, the idles, the hits and the lean.

## Built (step 1)

**SENSES** (`src/features/senses.js`, a view-only feature): what he notices, gathered each frame into a small pool of
stimuli (where, how interesting, how long), and the one he looks at, with hysteresis (another takes over only when
clearly more interesting, not within 0.5 s unless urgent):

| stimulus | from | interest | lasts |
|---|---|---|---|
| a gunman aiming at him | `foes.sim.gang`, act `aim` / `fire` (the glint more) | 1 / 1.2 | while he aims |
| a hit | `player.hit` (its push), `player.hurt` (its source) | 1.1 | 1.2 s |
| an explosion | `combat.explode`, `equip.blast`, `hazard.burst` blast, within 22 m | 1.05 | 1.6 s |
| a shot | `foe.shoot` within 26 m | 0.85 | 1.1 s |
| a bullet landing close | a gunman's `bullet.impact` within 2.6 m | 0.8 | 0.8 s |
| the nearest hunter | `entities.near` 12 m, 4 times a second | up to 0.55 | while near |
| birds | `wildlife.birds_scatter`, `wildlife.bird_perch` near, the nearest bird flying within 7 m | 0.5 / 0.42 / 0.3 | 1.3 s / 1.8 s / while near |

It also keeps the hits on him (`S.hit`: a count, the push's direction in the world, a strength from the push and the
damage). The live hero reads it (`app.feat('senses').S`); the feature writes only its own state.

**REACTIONS** (`view/livehero.js`, knobs `K.look`, `K.hit`, `K.mlean`; Shift+Alt+0 turns all three off / on):

- **LOOK**: the head turns to what the senses say he looks at. A spring toward the held target (faster for danger:
  aim, shot, blast, hit, a close bullet), drawn at the procedural ticks (12 Hz, stepped like the aim). The neck takes up
  to 62 deg, the chest (Spine1 + Spine2) the rest up to 90 deg; past 125 deg (behind him) he doesn't look. Pitch 12 deg
  up / 18 deg down at most (the hat's brim). The holstered revolver is the right hand's child, so a turn of the chest
  leaves it where it hangs. Not while he aims (FLOW's head lead has it), an emote plays, or he is off his feet.
- **FLINCH**: a hit bends him along its push: the chest 15 deg, the head 10 deg more, the arms flung the other way (not
  the aiming arm); up in 0.05 s, eased out by 0.34 s, stepped at 24 Hz; a knock (the sim's: a brute, a blast) x1.6 and
  longer; a hurt with no direction (a blast) hunches him forward.
- **MLEAN**: on the move with his gun away, the chest leans into his acceleration (into a turn up to 11 deg, forward
  setting off up to 8, back stopping up to 7), as FLOW's lean does while he aims.
- **The hold**: "hold until a pixel changes" compared the bones' head and tail points, but a turn of the head about its
  own length moves neither (the face and the hat do turn): with the look or a flinch on, two points off the head across
  its length are compared too (`headTurned`).

**Authoring loop** (the groundwork for the clips to come):

- `node tools/blender/live_export.mjs gunslinger [--add new_clip,...]` re-exports a live model in one command (14 s):
  the atlas's poses and clips plus every live-only clip (the model's current `live` list + `--add`), the old files kept
  in `tmp/live-export/backup/`. Re-exporting unchanged gives identical files.
- `?livereload=1`: the running game watches the live model he wears and makes his body again when it changes
  (`live.reload()`, 31 ms; `dev/livekeys.js watchLive`).

## Measured

- Look (`tmp/livereact/probe.mjs`, shots pushed as the game's own events): on target within 1 deg for 50 / -80 deg,
  clamped at 90 for 100 deg, nothing for 170; a gunshot turns the head in 10 frames (0 -> 19 -> 32 -> 48 -> 50 deg at the
  12 Hz ticks); a bird landing overhead 12 deg up, an explosion at his feet 18 deg down.
- Flinch: the neck moves 4.5-5 cm along a bullet's push, 9.8 cm for a brute's.
- In a gang fight (desert, 3 gunmen): he follows the nearest gunman, switches to the one aiming at him, glances at shots,
  flinches at hits.
- Golden: bit-identical with and without the reactions and the senses feature (both sides frozen); smoke passes; simview:
  the sim is independent of its views and the frame rate.
- Cost (A/B on frozen copies, a gang fight at 3440x1440): live.pose 0.044 -> 0.047 ms, senses.view 0.007 ms; garbage per
  frame unchanged (heap sampling: no site in the new code).

GIF: `tmp/livereact/out/reactions.gif` (shots left and right, one behind, a bird, an explosion, hits from the front, the
side, a blast, a run with a turn and a stop).

## Built (step 2): adaptive jumps

Space now picks the move the obstacle needs (`sim/player/player.js` JUMP; what the plan measured is kept on `P.vault` /
`P.leap`: `kind`, `h`, `dur`, `near`, `thick`, `exit`, `side`, `slant`, and the leap's `kind`, `z1`, `gap`):

| obstacle | kind | time | his pace after | live clip |
|---|---|---|---|---|
| a ledge up to 0.55 m | step: a foot onto it, no hands | 0.22 + 0.24 h s | all of it (he carries on onto the top) | `mv_step` |
| a ledge up to 0.9 m | knee: a hand on the lip, a knee onto it | 0.36 + 0.2 h s | 35 % | `mv_knee` / `mv_knee_r` |
| a ledge up to 1.25 m | climb: both hands, the chest over | 0.36 + 0.1 h s | stops | `mv_climb` |
| stones up to 0.62 m over his feet | hop: a speed vault, a hand on them, the legs past | at least 0.3 s, at his pace (3.2 m/s or more) | all of it | `mv_hop` / `mv_hop_r` |
| stones up to 0.98 m | tuck: the tuck vault | 0.58 s | 50 % | `mv_vault` |
| stones up to 1.25 m | over: up onto them on a knee, crouched on top, down the far side | 0.84 s + 0.25 s a m over 1 m | stops | `mv_over` |
| a leap | stride, or long from 2.8 m (a sprint over the wide part) | as before | as before | `mv_leap` / `mv_long` |
| a leap short of the far bank by up to 0.75 m | catch: hanging from its lip, pulling up and out | 0.8 s | stops | `mv_catch` |
| a drop of more than 1.2 m while running | a landing roll (a roll from his own speed, the run's after) | the roll's | the run's | the atlas's roll |

- Leaps now arc from bank to bank at their own heights (before: the start's height, then a snap down at the landing).
- The hand that plants is the one nearer the face when he meets it at more than 18 deg (`side`; walls: `H.wallSlant`
  two lines .3 m either side of his way; ledges: the ground's slope at the foot), else his left: the gun hand stays free.
- The sprites (the Ranger) get the same timings with their atlas frames.

The live hero (`view/livehero.js` ADAPTIVE JUMPS): `motion()` picks the clip by the kind (and the side), its frame by the
progress; `plants()` fits the body to the real obstacle while a vault plays (the clips are posed for a typical height): a
planted hand (the clip's marks `plant` .. `free`, `hands: 2` for both) onto the surface under it (the stones' top over the
wall, else the ground) by two-bone IK, a stepping foot (`step`) onto the top, no foot left in the ground or the stones.
The clips: `western.py` "adaptive jumps", JUMP_LIVE, exported with `live_export.mjs all --add ...`.

Fixed on the way (both showed as a revolver floating near him): the export's LIVE_AT hook pulled a holstered gun out
with a right wrist put on a point (the climb's and the vault's reaches too: `_live_gun` now keeps it in the holster; only
GunHold0 changed, in 9 poses), and the TRANSITIONS blend flew a holstered gun along with a big swing of the arm (it now
rides the blended hips: `holster()`).

Measured (`tmp/livereact/jumps.mjs`: finds an obstacle for every kind in the world, runs at it, Space; `--side 1` turns the
camera so he runs across the screen): every kind triggers where it should (step 0.54 m, knee 0.74, climb 1.15, hop 0.55,
tuck 0.98, over 1.12); the step and the hop leave at 4.6 m/s, the tuck at 2.3, the knee at 1.6; the running drop rolls on
at 3.7 m/s; a run-leap at the wide part catches the bank. The movement course (`tmp/livemove/course.mjs`): every station as
before except leapfall (now a catch) and drop (now a landing roll, which carries him into the lookout steps' side).
Golden identical (frozen before / after), smoke and simview pass, A/B: live.pose 0.016 -> 0.017 ms, heap the same.
Reel: `tmp/livereact/out/jumps.gif`.

## Built (step 3): the weather

**SENSES** also reads the weather at his spot (`S.wx`): the wind's strength (`W.strength`: 1 a breeze's full gust, ~3 a
gale's) and the way it blows, the rain and the snow where he stands (`env.skyAt`: a front passing over counts where it is),
less under cover (a tree's trunk within 1.9 m x its scale: 4 times a second), and the cold (snowing, or winter in the frost
biome).

**WEATHER** (`view/livehero.js`, knob `K.wx`, in Shift+Alt+0 with the other reactions; numbers in `WX`):

- **The hat in a gust**: over a wind strength of 1.85 the left hand goes onto the brim (two-bone IK to a point before the
  hat's band, carried by the head's own axes, so the hand follows a turned or ducked head), the head down; let go 0.7 s after
  it eases under 1.45. Standing, walking and running.
- **Leaning into the wind**: the chest up to 5 deg against the way it blows, from a strength of 1.2 to a gale.
- **Rain**: from 0.3 the hunch (shoulders up 9 deg, the chest forward, the head down 10 deg), and over 0.6, standing or
  walking, the left hand over the eyes under the brim. Not under a tree.
- **Cold**: the hunch, and standing or walking the arms hugged (each hand onto the other arm before the chest), with
  shivers while he stands: 0.45 s bursts every 2.5 to 5 s, the shoulders +-3 deg at 14 Hz (about a pixel).
- Not while he aims or plays an emote; the gun drawn (or on its way: the gun's own state) skips the hug.
- **The holster**: the idle's right hand rests on the holstered revolver, so "the gun near the hand" read it as drawn. Every
  reaction now asks the gun's state (drawn, or drawing / holstering) instead, and keeps a holstered revolver in its holster
  when the right arm or the shoulders move.

Measured (`tmp/livereact/weather.mjs`, the weather set with `env.setWeather`): a gale: the hand on the hat through the gusts
(standing 39 of 440 frames, walking 54 of 120, running all 90; the strength at his spot 0.9-2.9); rain: the hand over the eyes
standing and walking, hunched running, nothing under a tree; snow: hugging standing and walking, 27 frames of shivers in
7 s. Smoke passes. A/B in rain: live.pose 0.041 -> 0.047 ms, senses.view 0.007 ms, heap the same. Reel:
`tmp/livereact/out/weather.gif`.

## Built (step 4): idles and context moves

Standing still and calm (the sim's idle, the revolver holstered, no emote demo, nothing dangerous the senses know of: no
gunman aiming, no hit for 3 s, no danger in the look; no hat / rain / cold reaction on him), he does something of his own
(`view/livehero.js` IDLES, knob `K.idle`, in Shift+Alt+0 with the reactions):

- **A context move** after 2.5 s, if there is a place within reach: the senses' `spot()` (once, then every 3 s while
  there is none) looks for the water's edge to drink at (12 ways out to 1.15 m, dry level ground before it), a seat at hip
  height (a prop's top or a ledge .32-.78 m over his feet: field walls, broken wall pieces, the parapet, the bench, a trough,
  a fallen standing stone, the woodpile, a rock, a crate; his feet on level ground before it), or a wall at his back (walls,
  towers, gateposts, standing stones, big rocks, trees, 1.05 m and taller), in that order. The clip (`cx_drink`, `cx_sit`,
  `cx_lean`) plays by its own timing, looping; his body is drawn there: its origin eased onto the spot (the sim keeps him
  where he stopped: at most .72 m away) and turned the spot's way (once halfway: the TRANSITIONS blend turns him).
  Seated, the hips stay on the seat's top (feet()'s drop undone) and each leg reaches the ground by IK; drinking, the right
  hand goes into the water's surface at the dip. Reflections and contact shadows follow the drawn body (`sprite()`).
- **Else the weight shift** after 5 s (`id_shift`: onto one leg a while, the other), and **a fidget** every 6-12 s
  (`id_hat`, `id_gun`, `id_neck`, `id_scuff`), once each; the head's look rests during a fidget.
- **Glances**: a calm idle with nothing to look at gets a point 6 m off to one side every 4-8 s (the senses' `glance`).
- Anything else ends it at once (a move, a draw, a hit, danger, the weather; or being put somewhere else: a teleport, a
  respawn); the body eases back.

The clips: `western.py` "idles and context moves" (IDLE_LIVE), exported into the gunslinger's live model. The outlaw's
model is in the middle of the character look session's poncho-cloth work: it adds these with its next export
(`live_export.mjs outlaw --add ...`); until then the outlaw has no idles (the code skips a clip the model lacks).

Measured (`tmp/livereact/idles.mjs`: finds a seat, a wall, the water and open ground, stands him there 12 s, walks off):
sits on a field wall (the body .56 m from where the sim has him), leans on a field wall (.47 m), kneels and drinks at the
stream (.13 m), the weight shift after 4.6 s and a fidget; each ends the frame he moves. Smoke passes; simview: the sandbox
and the run identical, and keys identical at 60 / 30 / 240 fps (one run differed in the merchant's props, which other
sessions' uncommitted world changes add; it did not repeat, with or without this work's sim changes). Reel:
`tmp/livereact/out/idles.gif`.

## Next

1. **Jumps, polish**: the duster flares flat behind him in the climb's chest-over (the runtime cloth on a 48 deg lean); the
   user's own look at the reel; the ladder still draws the atlas's climb frames.
3. **Idles and context moves**: weight shifts, fidgets; sit / drink / lean found once when he settles.
4. **Hits, the rest**: stagger clips by direction for knocks; the death ragdoll (view/ragdoll.js on his live model).
