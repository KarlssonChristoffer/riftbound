# Experiment: the live hero (pixel sprites drawn live)

Today every pose the player can show is a STATIC image: Blender renders it from 16 facings, `concepts/sprites/pixelize.py`
turns the renders into pixel art (palette ramps, outlines, interior lines, orphan clean-up) and the frames are packed
into an atlas. The cowboy gunslinger has 389 poses (345 before the lasso, which brings 44 more, its walk-spin families
`lws_` / `lrs_` among them); every new move means new renders, and combinations explode (aiming on the move is a
`gws_` / `grs_` family per twist angle and gait frame).

This experiment answers: **can the player be a live 3D character drawn with the same pixel look, with motion that
doesn't make the pixels swim?** It draws the outlaw live (his own Blender model in rigid per-bone segments, the
pixelizer's rules on the GPU), adds a "pixel-friendly motion" layer whose knobs are measured one by one, shows what
going live buys (aiming at any angle, layering, IK, physics), and measures look, shimmer and cost against the sprite.

**The gunslinger is live by default** (2026-10-04, main.js `LIVE_LOADOUTS`); the other loadouts stay sprites.
`?live=1` makes every loadout with a live model live (the outlaw too), `?live=0` none. A loadout drawn live loads its
body the first time he wears it, and the rig (render targets, passes, shaders compiled off the frame) is made then: a
Ranger who never wears the gunslinger costs nothing. The golden captures (the Ranger) are bit-identical, smoke and
simview pass, and the live path is view-only (simview as the live gunslinger passes: the sim never reads it).

## Trying it

- `?mode=sandbox&set=gunslinger` (live by default; his duster's long panel is the atlas's runtime cloth, simulated on
  his live bones: THE DUSTER below), or the pause menu's Character picker / O mid-game.
  `?mode=sandbox&set=outlaw&live=1` for the outlaw (his poncho is baked, no runtime cloth). Each loadout's live body
  loads the first time he wears it; the knobs and the demo carry over.
- **Shift+7** flips sprite <-> live at runtime (the A/B), **Shift+8** steps through the motion knobs' presets
  (Shift+Alt+8 turns the procedural layers off / on), **Shift+9** the demos (none, `lasso`, `swing`, then the live
  model's own emotes `cheer`, `wave`, `shrug`, `squat`: stand still to see one). A note in the top-left corner says
  what is on. (`dev/livekeys.js`)
- `?livek=<preset>` starts with a preset (`exact`, `smooth`, `step`, `face16`, `hyst`, `hold`, `snap`, `smear`, `all`
  (default), `allsmear`, `free32`); `?livedemo=lasso | swing | cheer | wave | shrug | squat` with a demo.
- Draw the revolver (LMB) and walk with it up: the gun follows the cursor at any angle. R reloads on the move: the
  upper body plays the standing reload's 13 frames over the walk / run legs.
- Something to shoot and rope without being shot: `?mode=sandbox&biome=desert&set=outlaw&live=1&foes=unarmed` (the
  desert's gunmen two at a time, never drawing; the next pair 3 s after the last of them is down: features/foes.js).

Mirror for testing: `D:/Game/src-xlive/` (`http://localhost:8210/src-xlive/`). Captures, GIFs and the measuring scripts
are in `D:/Game/tmp/exp-livehero/`.

## How it is built

**The export.** `tools/blender/ragdoll_export.py` (the western session's ragdoll exporter) got `--atlas DIR`: every pose
of that atlas, posed by the model's own `pose()` exactly as `pixel_rig.py` renders it, as each bone's world matrix,
plus the atlas's clip timing (fps, `play`, `ms`, `marks`, stride / advances). The outlaw: 22 segments, 24 bones, 321
poses, 7356 triangle corners; 147 KB of mesh + 611 KB of JSON, exported in **5 seconds** (the atlas it replaces: 27 MB
of PNG in 8 sheets of 1536 x 8160 px, ~50 MB each once decoded, and a Blender render of every pose at 16 facings). The
gunslinger exports the same way (`out/live/gunslinger`, 345 poses); his duster's long panel is runtime cloth and is
not in the mesh (only the rigid shoulder cape is): the live hero runs it on his bones (THE DUSTER).

```
D:\Blender\blender.exe -b --factory-startup --python tools/blender/ragdoll_export.py -- \
  --model tools/blender/loadouts/outlaw.py --out D:/Game/concepts/sprites/out/live/outlaw \
  --atlas D:/Game/concepts/sprites/out/outfits/outlaw --clips cheer,wave,shrug,squat     (run from the repo root)
```

**The draw.** `view/livehero.js` builds the pose for the frame the sprite path picked this step (`P.frame` at
`P.face`; the sim is untouched) and hands each segment's matrix to `render/rigmesh.js`: pass A rasterises part /
family / the pixelizer's tone / normal / depth, pass B applies `pixelize.py`'s rules per pixel (interior lines, orphan
clean-up, exterior outline) into the G-buffer, now as **character pixels** (type 4: the player's grade, fill and
sun-shadow point), pass S casts the true 3D body's sun shadow, and a new pass X marks where walls hide him (the
player's x-ray outline). The upright body is squashed toward its anchor as the 20 deg sprite camera saw it. The loop
calls `live.compose` instead of `hero.compose` while it is on (hero.js is untouched; its card is hidden);
`host.playerSprite` hands the readers (contact shadows, afterimages, reflections) the atlas frame.

**Facing.** The sim's `P.face` is relative to the camera and steps when the camera turns (`adapter.turnFrame`). The
adapter now exposes the remainder (`pa.faceRest`), so the live hero knows his facing in the world without the camera's
16-step rounding: `(P.face + faceRest) x 22.5 deg + yaw`. The `face` knob then snaps that relative to the camera (as
the sprites) or leaves it free.

## The pixel-friendly motion knobs

| knob | what it does | why |
|---|---|---|
| `step` | the pose is the sim's frame, held as the sprites hold it (the clip's fps, its `play` / `ms` holds); procedural layers sample at 12 Hz. Off ("smooth"): every bone slerped toward the clip's next frame by the clip's own phase (distance for locomotion, time for the rest), a clip change cross-faded over 80 ms, the facing eased at 1200 deg/s | sub-frame motion moves every outline pixel every frame |
| `face` | the body's yaw in 16 (or 32) steps relative to the camera; 0 = free (his world facing, unchanged by the camera) | a free facing re-rasterises the whole body while the camera turns |
| `hyst` | procedural rotations (the aim twist, the lasso hand's orbit, the swing) move only when their target moved more than N deg (7), else hold | a target that drifts a degree a frame makes 1-px flicker |
| `hold` | the drawn pose stays until the new one would move some bone tip >= 1 screen px | an adaptive frame rate: no redraw for sub-pixel change |
| `snap` | the body's anchor lands on a whole pixel (rigmesh `uSnap`, as the sprite cards); the tone bands are fixed to the camera always | a sub-pixel position shifts every edge every frame |
| `smear` | a segment whose tip jumped > 3 px since the last drawn frame is stretched back along its move for that frame | a smear frame on fast swings (the flip of a shot, the draw) |

Presets: `exact` = step + face16 + snap, no procedural layers: **the sprite path's frames, drawn live**. `all` = step,
face16, hyst 7, hold, snap, with the procedural layers. `smooth` = every knob off.

## Procedural animation (the payoff)

- **Aim at any angle, standing or moving.** The sim still picks the legs and a twist family name; the live hero draws
  the twist-0 pose of that gait frame (`gws_0_<i>`, or `gun_aim` standing) and turns the spine (Spine / Spine1 /
  Spine2, .4 / .3 / .3, as `western.py`'s `_TWIST`) until the drawn barrel points at the cursor **on screen**. The
  solve is in screen space because the body is squashed as the 20 deg sprite camera saw it: a barrel aimed at the
  cursor's world point is not aimed at the cursor on screen (the first version did that: 21 deg off). It is re-solved
  when the legs re-plant or turn, so a stale twist never shows on new legs. Measured aim error on screen (barrel vs
  muzzle -> cursor, walking with the cursor circling): **sprite families 9.4 deg mean (max 32), live 0.2 deg smooth /
  3.5 deg with every knob on** (the 7 deg hysteresis and the 12 Hz sampling are the 3 deg).
- **Layering.** A reload on the move (`gwr_` / `grr_` in the atlas: 3 phases per gait frame) is drawn as the walk /
  run legs + the standing reload's upper body (13 frames, by the gun's phase and progress: `gun.js reloadFrame`),
  Spine and up moved onto the legs' spine base, the run's 6 deg lean added. Any upper-body clip can go over any legs.
- **Two-bone IK on a moving point** (`lasso`): the right wrist on a point circling overhead 1.4 times a second (an
  analytic two-bone solve, the elbow bending in the plane it bends in now), the rope's loop drawn round it as world
  pixel lines, while he walks. This is the lasso's use: the 44 lasso poses (`lasso_spin`, `lws_` / `lrs_` walk-spin
  families...) become one IK target + layering.
- **Hanging from a point, a pendulum** (`swing`): the `reach_up` pose hung from a rope 1.25 m above the hands, the
  whole body turning about the rope's top, the legs trailing the swing. There is no sprite equivalent.

GIFs: `tmp/exp-livehero/aim_sweep.gif` (sprite | live all knobs | live smooth, the cursor marked), `lasso.gif`,
`swing.gif` (all knobs | smooth), `camera.gif` (the camera turned a full circle round him: sprite | live smooth | live
all), `ab_exact.gif` (the first milestone: sprite | live, the same frames).

## New animations made live (no atlas render)

The outlaw's first animations that exist **only** for the live model (2026-10-03), made the way the atlas's are
written (bone rotations in `tools/blender/western.py`, the "outlaw's emotes" section at its end) but never rendered:
the export poses every frame through the model's own `pose()` and writes the bone matrices (`ragdoll_export.py
--clips`, 10 s for the whole model with its 369 atlas poses + these 32 frames).

| clip | what he does | frames | the game's timing |
|---|---|---|---|
| `cheer` | draws, throws both arms up in a wide V (the revolver to the sky, the hat pushed back) with two hops, twirls the gun and holsters it | 16 | play / ms: ~2.2 s |
| `wave` | the left arm up and out, the forearm swung side to side, a head tilt | 5 | ~1.2 s |
| `shrug` | shoulders up, forearms out, the head tilted one way, then the other | 5 | ~1.1 s |
| `squat` | down onto his heels, the forearms over the knees, then resting: a slow breath and nod (`marks.loop`) | 6 | 0.2 s down, then a 2.6 s loop |

In the game they are demos (`view/livehero.js` `emote()`): Shift+9 picks one, and it plays while he stands still
(the sim's idle, the gun holstered), by the clip's own `play` / `ms`, from the start each time he stops; walking or
drawing cancels it at once. After the last step a clip loops from `marks.loop` (a step of `play`) or he stands 1.6 s
and it plays again. A frame its marks name `shot*` fires a muzzle flash (render/flashes.js, at the drawn muzzle along the
barrel) and his gun's sound as its step begins (the gunslinger's live gun moves, another session's: quickdraw,
behind_back, sky_shot, ...). View only: the sim still says idle (the sprite path shows him idle), no events.

Making one: add keys to `POSES` (start from `POSES['idle_in']`, the ready idle, so the clip leaves and returns to
idle.0), a `_clip(keys, tween, fps, play=, ms=, marks=)` to `ANIMS`, its name to `OUTLAW_EMOTES`; export with
`--clips`; Shift+9. What the keys can use is the gun clips' kit: a key named `gun_*` holds the revolver (`FOLLOW`: its
barrel along the forearm), `REACH` puts a wrist on a point, `LASSO_HAT` tips the hat back, `_air` lifts him (a hop).
Rules learnt making these: the sombrero's brim is 1 m across and drawn from above, so an arm raised steeper than ~40 deg
over the horizontal reads as hands on the brim (and hides behind it seen from the back): raise arms wide, not high;
a few degrees of head roll tip that brim a lot. Contact sheets and GIFs: `tmp/live-emotes/` (`sheet.mjs` draws every
frame of a clip live at 4 facings through the lineup, `sheet.py` builds the sheets and the GIFs at the game's timing).

The lasso's coil: the outlaw's model has a coil (`CoilHold0`) that shows in his left hand only in the lasso's keys; in
every other pose it is scaled to nothing. The export carried no scale, so the coil was folded into the left hand and
showed in every pose; it is now its own piece, and `model.json` `hide` lists the poses that collapse it (the live hero
draws a hidden piece with a zero matrix). A `_clip`'s in-between lost that scale in `western.py` too (a blend of the
keys' bones); its `pose()` now packs the coil away again after the blend outside the lasso's clips.

## Gunplay that flows: FLOW and the COMBAT STYLE (2026-10-03)

The user asked for more variation in combat: many draws, more angles to shoot from, the body moving fluidly while
roughly on target. On the live hero (`view/livehero.js`, knob `K.flow`, on in every preset but `exact`; **Shift+Alt+9**
turns it off / on):

- **FLOW** (procedural, any model with a gun). The aim is a WORLD angle on a spring (w 26 rad/s, damping .55: ~10 %
  overshoot, settled in ~.2 s): the head leads (the chest's lag x .85, up to 40 deg), the chest follows, and the gun arm
  trails a fast swing (up to 12 deg). Re-planted legs don't jolt it, since the world angle is what springs. The chest leans
  into his acceleration (up to 7 deg sideways / forward), and the free arm pumps with the stride on the move. Every shot
  kicks differently (`RECOIL`: the wrist's flip, the shoulder's rock, the whole chest; x .85-1.15, the Navy x 1.25, a fan
  x .5), the standing shot included (the stance + a kick instead of `gun_fire`'s frames). Alone this is subtle at ~45 px:
  a pixel or two.
- **COMBAT STYLE** (models with the `cb_*` clips: `western.py` `COMBAT_LIVE`, exported with `--clips`). Each time the
  gun comes out he picks a STANCE by the target's distance (`COMBAT.w`: up close the hip; mid the aim, a deep crouch, the
  duelist's side-on, a knee; far the duel and the knee most) and a DRAW into it (`cb_dr_*`: straight, a sweep out wide,
  a spin out of the holster, up by the cheek, dropping to the knee, into the crouch), laid over the sim's draw by its
  progress. The gunslinger's hip shot comes from the hip stance. On the move his upper body takes the hip or the aim over
  the gait's legs, and stopping brings a standing stance back after .3 s. From the 2nd shot after a pick, a shot changes
  the stance with p .22. A reload in a low stance keeps its legs (the reload's hands over them). Every change cross-fades
  (.15 s). The spine twist aims whichever stance it is.
- The **drawn muzzle** goes to the shot's flash and smoke (`live.muzzle()` -> `host.playerMuzzle` -> `features/gunfx.js`).
  The sim's muzzle is its atlas frame's, inches off a stance's gun. The bullet itself still leaves from the sim's muzzle.

View only: the sim is unchanged (simview with `?live=1` passes). Reels: `tmp/live-emotes/combat_outlaw.gif`,
`combat_gunslinger.gif` (`combatreel.mjs`: scripted fights in the real game; `gunflow.mjs`: flow off | on).
**Transitions (the jumps between animations).** Measured with `tmp/live-emotes/popmeter.mjs`: a scripted fight full of
transitions, every drawn frame's largest body-part move on screen, each sorted by what changed: his facing stepped, what
is drawn switched (clip, stance, layer, angle family), the next frame of the same clip (authored), or the same pose (the
procedural layers). The pops had three causes, and the fixes:
- A switch or a facing step drew the new pose at once: the arms and gun jumped 20-50 px. Now (`K.blend`, with FLOW;
  `TB`) the drawn body blends from what was on screen, in his frame turned by the facing (so a 22.5 deg facing step
  turns smoothly), as a local blend + FK (joints stay together). It runs 0.12 s at least, longer for a bigger change
  (the hands / gun / head / feet at <= 300 px / s, the barrel's heading at <= 720 deg / s), at most 0.28 s. With it,
  the base pose's own cross-fade before the aim is off, so the aim is solved on the clean pose.
- The aim spring sprang across a switch: another base pose needs another spine twist for the same aim, so its target
  jumped and the arm swung away and back. The spring now restarts on a switch and on a facing step over 60 deg; the
  blend carries the visual.
- The spine-twist solve hopped. At a switch it hit its 110 deg limit, and side-on (the barrel into the screen) it gave
  -5 / -23 / +3 / +15 deg with the cursor still. `aimTwist` now does a coarse scan of the range when the last answer is
  12+ deg off, prefers answers near the last one, and moves only for a clear gain (3 deg).
Gunslinger, the same fight: facing steps' jumps median 10.7 -> 1.6 px (max 51 -> 7.9), switches' max 33 -> 3.6 (none
over 6 px); outlaw: 43 -> 13.5 and 36 -> 4.7. What still moves fast is motion, not a pop: a blend chasing a fast cursor
swing, the kicks, the reload's hands on the run. The sprite path (no `?live=1`) is frames: it can't blend.
Reel: `tmp/live-emotes/transitions_outlaw.gif` (before | after).

**New shooting angles (gameplay, sprite and live).** On the move the stances can also aim with three upper bodies the
torso twists (-90..+45) can't reach: the gun back over the right shoulder (`ob`), back past the left side under the arm
(`ub`), across the chest to his left (`cx`). Each is laid over every walk / run frame (`gws_<fam>_<i>` / `grs_<fam>_<i>`,
`western.py` `ANGLE_FAMS`) and rendered into the gunslinger's and the outlaw's atlases (`pixel_rig.py --append --poses`,
then pixelize and pack_atlas: ~5 min a character). `sim/player/gun.js` `movingAim` scores them with the twists (`TWX`, their
barrels' real angles in `TWX_DEG`; `TUNE.angles`). Running (not walking, Q) with the target behind him, he keeps running
his way and shoots back instead of turning to back up. Those shots are `rear`: the cone round the shoulder's aim, no kick,
`spread.rear` (Peacemaker 4.2 deg, Navy 6). `cx` shots are ordinary `move` shots. The live hero draws an angle frame as
it is (no twist-0 base), trimmed by at most 30 deg of spine twist. Checked headless (`tmp/live-emotes/angleplay.mjs`):
running with the target behind, every shot after the first flies back at it; a target beside him gets `cx`; walking
still backs up. The sim comes out the same with the live hero on. Reel: `tmp/live-emotes/angles_gunslinger.gif`.

## THE DUSTER (the runtime cloth, live)

The gunslinger's long duster panel was the one thing his live body lacked: in the sprite path it is runtime cloth
(`view/cloth.js` `ClothRig`: a 9 x 7 Verlet grid on Spine2, 2 pinned rows, the body's capsules to collide with, drawn on
the CPU into the sprite). Live, the same cloth runs on the live bones (plan step 2):

- `view/livehero.js` THE RUNTIME CLOTH: a `ClothRig` of its own on the atlas's cloth definitions (`hero.rig.idx`, the
  poses .json), fed every frame from the DRAWN pose (after the transitions' blend). Spine2's matrix comes from the live
  bone, and the capsules come from the live bones: each capsule's ends are stored once as offsets in its bone's frame,
  taken from the atlas's `idle.0` capsules against the live model's `idle.0` bones. The facing is continuous (the
  ClothRig takes a fractional facing step), and his motion goes in as hero.js's `clothPos` does (the view frame without
  the camera's turns). Snaps (a reversal, a pose switch) turn the cloth with the bone, as on the sprite path.
- `render/rigmesh.js` `attach(model, corners, families)`: a dynamic mesh drawn with the model's first body. Its corners
  are in the hips' segment frame, with a flat normal per facet, the `oilskin` family and the cloth's bias, and a part
  of its own. It goes through passes A, B, S and X like the body's triangles: the body's bands, interior lines and
  outline, real depth against the legs, the sun shadow and the x-ray. 9 x 7 grid = 288 corners a frame, rewritten in
  place (no allocation).
- The sprite path's own cloth sim rests while he is live (`loop.js` passes `sim = false` to `hero.stepCloth`, which still
  sets the wind). Flipping back to the sprite (Shift+7) restarts its cloth.

Cost (headless, playing: running in circles and shooting; `tmp/live-emotes/clothperf.mjs`): `cloth.sim` .22-.24 ms a
frame live, against .20-.21 ms for the sprite's sim; the live hero's char group comes to .29-.30 ms (budget .4). The
sprite path spends .52 ms there because of its CPU raster.
Checked: `tmp/live-emotes/angleplay.mjs` (the coat trails his run and flares on turns, like the sprite's) and
`tmp/live-emotes/clothtoggle.mjs` (live, then sprite, then live again, then outlaw, then gunslinger again: no errors,
and the coat comes and goes with the loadout). Reel: `tmp/live-emotes/duster_live.gif`.

## Movement on the live hero (2026-10-06)

The live body no longer just replays the atlas's leap / fall / land poses: its feet stand on the ground under them (slopes,
steps, banks: leg IK, knob `feet`) and the jumps are clips made for the live model only (`mv_leap`, `mv_fall`, `mv_land_soft`,
`mv_land_hard`, `mv_vault`, `mv_climb`: knob `move`), picked from the sim's state and progress; the sim's landing lasts by the
drop and runs on. Shift+Alt+7 flips the new movement off / on. The movement course that measures it (feet against the
ground, slide, pops, a station for each move) and the numbers: [livemove.md](livemove.md).

## Measurements

### The shimmer meter

`tmp/exp-livehero/s6_shimmer.mjs`. For scripted sequences, every displayed frame (60 a second), the character's pixels
in a 120 x 112 box round his anchor are read: the G-buffer's type-4 pixels (the sprite card or the live body, nothing
else) and their final colours. Per frame it counts the pixels that **changed** (his image vs the frame before; a pixel
he left or reached counts; colours within 2/255 count as the same: the composite's rounding) and the **flicker**
pixels (changed, and back to what they were within 2 frames). Every variant is drawn off **the same sim step**
(`live.snapshot / restore`: each knob set keeps its own history), so the motion is identical and only the drawing
differs. Sequences (the desert sandbox, noon, wind and particles off): `walk` (3 s), `run` (2.5 s), `turn` (in place
through all 16 facings, a step every 0.1 s), `camera` (the camera turned 360 deg round him, 90 deg/s), `aimwalk`
(walking with the gun up, the cursor circling him), `swing` (the pendulum demo: no sprite equivalent).

Values: **px changed / flicker px a frame** (his box holds ~950 of his pixels). Zoom 2 gives the same numbers to within
a pixel (at rest both zooms draw the same art pixels): `tmp/exp-livehero/shimmer_f1.json` (zoom 1), `shimmer_f2.json`
(zoom 2), with every frame's counts.

**One knob at a time on smooth motion** (every knob off, then one on):

| sequence | sprite | live exact | live smooth | + step | + face16 | + hyst | + hold | + snap | + smear |
|---|---|---|---|---|---|---|---|---|---|
| walk | 186 / 0.3 | 185 / 0.8 | 448 / 107.1 | 421 / 137.8 | 448 / 107.1 | 448 / 107.1 | 444 / 107.9 | 380 / 60.3 | 450 / 107.9 |
| run | 272 / 19.9 | 272 / 20.5 | 546 / 143.8 | 503 / 161.1 | 546 / 143.8 | 546 / 143.8 | 546 / 143.8 | 467 / 81.2 | 559 / 148.6 |
| turn | 111 / 3.5 | 116 / 3.6 | 139 / 10.0 | 116 / 3.3 | 124 / 6.0 | 139 / 10.0 | 132 / 8.0 | 138 / 10.3 | 139 / 10.0 |
| camera | 85 / 3.1 | 88 / 3.6 | 385 / 188.7 | 391 / 189.1 | 399 / 189.9 | 385 / 188.7 | 390 / 191.1 | 113 / 5.0 | 385 / 188.7 |
| aimwalk | 235 / 8.2 | 228 / 8.6 | 462 / 121.6 | 421 / 114.6 | 462 / 121.8 | 466 / 122.5 | 454 / 120.0 | 376 / 58.3 | 466 / 123.3 |
| swing | n/a | 68 / 1.3 | 136 / 9.2 | 86 / 1.6 | 136 / 9.2 | 66 / 2.4 | 104 / 5.5 | 135 / 9.4 | 144 / 12.4 |
| aim error (deg, aimwalk) | 9.4 | 13.3 | 0.2 | 2.3 | 0.2 | 2.9 | 0.5 | 0.2 | 0.2 |

**All of them, and each one left out** (`free32`: smooth time, 32 facings, the rest on):

| sequence | sprite | all knobs | all - step | all - face | all - hyst | all - hold | all - snap | all + smear | free32 |
|---|---|---|---|---|---|---|---|---|---|
| walk | 186 / 0.3 | 185 / 0.8 | 346 / 44.5 | 185 / 0.8 | 185 / 0.8 | 185 / 0.8 | 421 / 137.8 | 283 / 28.3 | 346 / 44.5 |
| run | 272 / 19.9 | 272 / 20.5 | 467 / 81.2 | 272 / 20.5 | 272 / 20.5 | 272 / 20.5 | 503 / 161.1 | 378 / 54.7 | 467 / 81.2 |
| turn | 111 / 3.5 | 110 / 2.3 | 113 / 3.6 | 110 / 2.3 | 110 / 2.3 | 116 / 3.6 | 109 / 2.2 | 110 / 2.3 | 113 / 3.6 |
| camera | 85 / 3.1 | 79 / 3.0 | 80 / 2.3 | 114 / 7.2 | 79 / 3.0 | 88 / 3.6 | 402 / 191.1 | 79 / 3.0 | 98 / 5.5 |
| aimwalk | 235 / 8.2 | 220 / 6.5 | 356 / 52.2 | 220 / 6.5 | 223 / 7.0 | 220 / 6.5 | 418 / 113.6 | 322 / 37.0 | 355 / 50.8 |
| swing | n/a | 49 / 1.7 | 92 / 7.9 | 49 / 1.7 | 74 / 1.7 | 51 / 1.6 | 50 / 1.6 | 77 / 9.5 | 92 / 7.9 |
| aim error (deg, aimwalk) | 9.4 | 3.5 | 3.2 | 3.5 | 3.2 | 3.5 | 3.5 | 3.5 | 3.0 |

(The aim error of `exact` (13.3) vs the sprite (9.4) for the same frames is the two ways of reading the barrel: the
sprite's from its rendered bones, the live one's from the drawn geometry; compare the live columns among themselves.)

Read it like this:
- **`exact` = the sprite** (walk 185 / 0.8 vs 186 / 0.3; turn, camera the same). Drawing the atlas's own poses live
  costs no stability. (The first run showed 960-px flips: the live body's own 3D shadow fell on the composite's single
  "is he in shade" test point, `gfx.js` `uPlayer + sunDir * .5`; the live hero tests 1.6 m out now: `G.setPlayer`'s
  new `sun` argument.)
- **Smooth interpolation is the shimmer.** Slerping between the key poses changes ~2.4x as many pixels every frame and
  flickers 100-190 px a frame (walk 448 / 107, camera 385 / 189): edges crawl through sub-pixel positions. "Less
  smooth" is right.
- **The knobs that matter**, from leaving each out of `all`: `snap` (without it everything swims: walk 421 / 138,
  camera 402 / 191), `step` (walk 346 / 45, run 467 / 81, aimwalk 356 / 52), `face` for camera turns (114 / 7 vs
  79 / 3). `hyst` matters for procedural motion (the swing: 74 changed px a frame without it, 49 with), `hold` for the
  turns (116 / 3.6 vs 110 / 2.3); both do little once time is stepped. A single knob on smooth motion barely helps
  (only `snap` does): the sources stack.
- **Procedural aim is steadier and more accurate than the image families** (aimwalk: 220 / 6.5 at 3.5 deg error vs the
  sprite's 235 / 8.2 at 9.4 deg).
- **Smear** frames add change on purpose (walk 283 / 28 with smear vs 185 / 0.8): a style choice for the fast swings,
  not a stabiliser.

### Look parity

`tmp/exp-livehero/s10_look.mjs` + `lookstats.py` (dev/livelook.js, after dev/raglook.js): 12 poses x 16 facings, the
sprite alone, then the live body alone, at the same spot, sun shadows off; per figure the silhouette IoU, the colour
difference where both are, the share of identical colours and the share of the live colours that are in the sprite's
own palette. Sheet: `tmp/exp-livehero/parity_sheet.png` (sprite over live, 8 facings, 7 poses by day, 2 at night).

| view | IoU (min..max over the 12 poses) | area sprite / live px | only sprite / only live px | mean colour diff (0-255) | identical colours | live colours in the sprite's palette |
|---|---|---|---|---|---|---|
| day, zoom 1 | **0.91** (0.90..0.92) | 985 / 977 | 51 / 42 | 14.7 | 0.49 | 0.91 |
| night, zoom 1 | 0.84 (0.83..0.85) | 920 / 913 | 84 / 77 | 5.0 | 0.40 | 0.78 |
| day, zoom 2 | 0.89 (0.84..0.92) | 1018 / 1042 | 50 / 74 | 14.5 | 0.57 | 0.97 |
| night, zoom 2 | 0.84 (0.83..0.85) | 894 / 884 | 83 / 73 | 4.3 | 0.59 | 0.97 |

Per pose by day (zoom 1): idle 0.92, walk 0.92, run 0.92, roll 0.91, leap 0.91, turn 0.91, gun_aim 0.91, twist m45
0.91, draw 0.91, reload 0.91, gws_p22 0.90, grs_m67 0.91: no pose or facing is an outlier (0.85..0.95 by facing). At
rest both zooms draw the same art pixels; the zoom-2 rows differ only in where the lineup stands (2 figures a pass, on
the player's row; 4 poses there caught a neighbour's edge in their box: the 0.84 minimum).

The bandit's ragdoll look test (the western session) had IoU ~0.90 and 86-90% palette colours: the hero matches it.
The silhouettes agree to a pixel or two (the hat brim's lower edge, a hand); half the shared pixels have exactly the
sprite's colour and the rest are mostly a neighbouring band of the same ramp (a band boundary or an interior line a
pixel off). At night the figure is dark on dark and the mask threshold loses pixels on both (IoU 0.84).

### Performance

3440 x 1440 (the target), headless Chrome on the RTX 4070, the real clock, `?perf=1` (`tmp/exp-livehero/s11_perf.mjs`,
`s14_gpu.mjs`); the machine was busy (other sessions), so sprite and live were alternated and repeated.

| per frame | sprite, standing | live, standing | sprite, walking | live, walking |
|---|---|---|---|---|
| char group: the hero's CPU composite (`hero.compose`) / the live pose (`live.pose`) | .094 / .100 ms | **.019 / .022 ms** | .102 / .095 ms | **.018 / .025 ms** |
| `live.rig` (pass A's submission, JS) | - | .067 / .066 ms | - | .076 / .072 ms |
| GPU: `G.render` p50 (p95) | 3.11 (4.30) / 3.28 (4.46) | 3.18 (4.44) / 3.12 (4.65) | 3.03 (4.40) / 3.10 (4.60) | 3.48 (4.49) / 3.50 (4.91) |
| GPU: the live hero's own pass A (before `G.render`) p50 (p95) | - | .05 (.09) | - | .05-.13 (.09-.14) |

Two runs each (a / b). Alternating sprite and live every 5 s in one page (`s14_gpu.mjs`), `G.render` on the GPU was
3.22 / 3.26 ms (sprite) vs 3.21 / 3.26 ms (live): passes B, S and X are within the noise (B and X are drawn over the
body's screen box only, a rigmesh change made here: before, they covered the whole view). The frame's JS totals swung
by 1.5 ms between identical runs on the busy machine, so only the per-system numbers are given. Memory: the model is
0.74 MB on disk (147 KB mesh, 611 KB pose JSON), against the outlaw atlas's 27 MB of PNG (~50 MB a sheet decoded, poses
cut lazily); rigmesh's own targets take 20 bytes a view pixel (6 MB at 3440 x 1440). With `?live` absent nothing of this
runs (the default path changed by one property check a frame and one uniform).

### Tests

With `?live` absent (`src-xlive/`): golden `--compare tmp/golden/ref4` 16/16 identical, smoke passes, simview passes
(sandbox, run, keys at 60 / 240 / 30 fps). With `?live=1`: simview on the outlaw's scenarios (`gun`, `foes`,
`foeskeys` at 60 / 240 / 30 fps; `tmp/exp-livehero/simview_live.mjs`) identical with and without views; no console
warnings or errors through the meters' sessions (every preset, both demos, the aim, the reload, the camera turning).
`tmp/exp-livehero/tests.txt` has the log.

## What the sprite path has that the live path lacks

| | sprite path | live | |
|---|---|---|---|
| runtime cloth (the Ranger's cloak, the gunslinger's duster) | `view/cloth.js`: a 3D Verlet grid pinned to a bone per pose, drawn on the CPU into the sprite | **the duster: done** (THE DUSTER) | the same ClothRig on the live bones, drawn through rigmesh; the Ranger has no live model |
| hair streaming in strong wind | `hero.hairWind` repaints edge pixels | missing | cheap to add as a GPU vertex sway of the hair parts or the same pixel trick on pass B |
| shiny armour (the Ranger) | metal mask -> composite glints | missing | a per-family metal flag into the G-buffer's E.w (pass B writes 0 today) |
| HD bow / pixel bow (the Ranger) | `PL.drawPixelBow` from the render's overlays | missing | the bow string becomes a live line between two bones |
| normals / depth layers | the atlas's normal sheet; a depth sheet for the cloth's occlusion | **true normals and per-pixel depth** | better: hands go behind crates, the x-ray works per pixel |
| afterimages, reflections, contact shadow | read the composite canvas | the atlas frame for the same pose | close; afterimages of procedural poses would show the base pose |
| poses the model lacks | atlas | falls back to `idle.0` | re-export (10 s) once `western.py` has them (the lasso's: done 2026-10-03) |
| sinking in water | the sprite is cropped | the body is lowered: the ground's depth hides it | |
| blink (i-frames) | card hidden | body not drawn | same |

Done in this experiment because they were cheap: the character pixel type, the x-ray, the sun-shadow test, contact
shadows / afterimages via the atlas frame, the procedural layers.

## A full switch to live characters: the steps

1. **The cowboys' gun play live** (the gunslinger by default since 2026-10-04, the outlaw with `?live=1`): a player
   setting next; re-export when a
   loadout changes (5 s, a build step instead of a render). Drop the `gws_` / `grs_` / `gwr_` / `grr_` families and the
   standing twists from new loadouts: the live hero needs only the twist-0 gait frames and the standing aim.
2. **The runtime cloth, live.** The duster is already a 3D Verlet grid in metres (`view/cloth.js`): its pinned rows
   ride on Spine2's matrix per pose and its capsules come from `meta.sim`. Live, the pins ride on the live Spine2
   matrix (every frame, not per pose), the capsules on the live bones, and the grid's triangles go through rigmesh as a
   dynamic segment (its family `oilskin`, written into the vertex buffer each step) so pass B outlines it and the
   depth buffer sorts it against the legs for free (no depth sheet). The CPU rasteriser in cloth.js goes away.
3. **The lasso as a live move**: the spin = the IK hand (this experiment's demo) + layering over any legs; the throw,
   yank and take as short upper-body clips; the rope a live polyline. No walk-spin families.
4. **Hair, armour, the bow** (the Ranger): the three small passes above.
5. **Enemies.** The bandit already has a live model (its ragdoll). A gunman live is one more instance in the same
   draw (rigmesh draws every body of a model in one draw per pass); his look picks a pose name as today. Measure a
   horde (60 gunmen) before switching: CPU per body ~25 bones of FK, GPU pass A is per vertex (7k corners each).
6. **Retire the atlas renders** for live characters; keep `pixel_rig.py` + `pixelize.py` as the look's reference
   (the parity test), and the atlas for things that stay sprites.

### Risks

- **Cloth**: step 2 is done for the duster (THE DUSTER); the Ranger's cloak waits for a live Ranger.
- **Hair**: small; but any secondary motion now has to be authored as code, not baked.
- **Lighting normals**: the live normals are the mesh's own (the same mesh the atlas's normal pass rendered), so the
  composite lights both alike; the tone bands are computed per pixel at run time, and a band boundary moves a pixel
  where the atlas had baked it (the 50% identical colours).
- **The depth layer**: the live body has real depth, so he can now intersect walls and props he stands against
  (the card had one depth and a bias). Keep the player's collision radius >= his widest pose, or bias pass B a little.
- **Outlines at zoom 2**: at rest every zoom draws the same art pixels (the meter and the parity agree at zoom 1 and
  2). While the zoom eases between levels the sprite card is scaled (its pixels stretch) but the live body is
  re-rasterised at the in-between scale (thinner outlines, more detail) for those few frames. A true close-up zoom
  would need rigmesh's pass A at art resolution (VW / zoom) and an upscale.
- **Rigid joints vs skinning**: every part is bound 100% to one bone, in the atlas too (`wardrobe.py`), so parity is
  natural; but procedural rotations past the authored range open the joints (a 90 deg spine twist splits the poncho
  from the trousers at the waist). Either keep procedural rotations inside the authored range (the sim's twist search
  does: -90..+45 moving, +-45 standing) or move to linear-blend skinning for the torso (rigmesh's segments would
  become a skinned mesh with 2 weights a vertex: the vertex shader already fetches per-segment matrices).
- **Stepped time vs responsiveness**: the knobs hold poses for up to a clip step (~80 ms) or a 12 Hz tick; the sim is
  unaffected (the shot leaves when the sim says), only the drawing waits, like the sprites today.

## Recommendation

**Go live for the player, in steps, keeping the pixel-friendly knobs on (`all`).** The evidence:

- Drawn live with the knobs, the outlaw is as stable as his sprite (walk 185 / 0.8 vs 186 / 0.3 px changed / flicker a
  frame; camera turns 79 / 3 vs 85 / 3) and looks the same (silhouette IoU 0.91, 91-97% of his colours in the
  sprite's palette).
- What only live can do is measurably better: the aim is 2.7x as accurate on screen (3.5 vs 9.4 deg) **and**
  steadier (220 / 6.5 vs 235 / 8.2), a reload has 13 frames on the move instead of 3, the lasso and a swing need no new
  renders.
- It is cheaper on the CPU (the hero's composite .10 ms -> .02 ms a frame) and costs ~.05 ms of GPU for its own pass;
  the model is 0.7 MB against a 27 MB atlas, and a new pose is a 5 s export, not a render.
- The motion must stay "less smooth": interpolating between key poses is exactly what makes pixels swim (2.4x the
  changes, 100+ flicker px a frame). Stepped time, whole-pixel anchors and camera-relative facings are the ones that
  matter; hysteresis and hold-until-change for procedural motion.

The duster cloth (step 2) is in, and the gunslinger is live by default (2026-10-04); the outlaw can follow. Keep the atlas
pipeline as the look's reference and for everything that stays a sprite.

### Open questions

- Smear frames: a style call (they add change on purpose). Worth a look in the GIFs.
- The hysteresis in yaw degrees (7) is up to ~10 deg on screen near the vertical (the foreshortened directions); a
  hysteresis in screen angle would be more even.
- 32 facings (`free32`) with smooth time: not worth it in the numbers (346 / 45 on the walk).
- Enemies live at horde scale: not measured here.

## Files

- `src/view/livehero.js` (new): the live hero: poses, the knobs, the procedural layers, the demos, the meters' hooks;
  a body per loadout (`createLiveBody`, MODELS) on one rig behind `createLiveHero`.
- `src/dev/livekeys.js` (new): Shift+7 / 8 / 9. `src/dev/livelook.js` (new): the look-parity lineup.
- `src/render/rigmesh.js` (small, additive): the per-body pixel `type`, the optional x-ray pass, B and X over the
  bodies' screen box.
- `src/render/gfx.js` (small, additive): `G.extra(mesh, 'xray')`; `G.setPlayer(x, h, z, sun = .5)`.
- `src/sim/player/adapter.js` (additive): the read-only `faceRest`.
- `src/core/loop.js`, `src/main.js`, `src/core/flags.js` (`live`, `livek`, `livedemo`), `src/dev/devkeys.js`: the switch.
- `tools/blender/ragdoll_export.py` (additive): `--atlas`; `--clips` (clips only the live model has), the coil as its own
  piece and `hide` (pieces a pose collapses).
- `tools/blender/western.py` (additive, at its end): the outlaw's emotes (`OUTLAW_EMOTES`) and the coil packed away
  after a `_clip` blend.
- `D:/Game/tmp/exp-livehero/`: `probe.mjs` (captures, ports 8210 / 9410), `s6_shimmer.mjs` (the meter) +
  `mktables.py`, `s10_look.mjs` + `lookstats.py` + `mkparity.py` (parity), `s11_perf.mjs` / `s14_gpu.mjs` (perf),
  `s2_ab.mjs` + `seq.mjs` + `mkab.py` (the GIFs), `simview_live.mjs` + `runtests.sh` (the tests).
