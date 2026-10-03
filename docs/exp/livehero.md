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

It is **off by default**: with `?live` absent nothing runs (the golden captures are bit-identical, smoke and simview
pass), and the live path is view-only (simview with `?live=1` passes: the sim never reads it).

## Trying it

- `?mode=sandbox&set=outlaw&live=1` (the outlaw is the loadout with a live model: his poncho is baked, no runtime cloth).
- **Shift+7** flips sprite <-> live at runtime (the A/B), **Shift+8** steps through the motion knobs' presets
  (Shift+Alt+8 turns the procedural layers off / on), **Shift+9** the demos (none, `lasso`, `swing`). A note in the
  top-left corner says what is on. (`dev/livekeys.js`)
- `?livek=<preset>` starts with a preset (`exact`, `smooth`, `step`, `face16`, `hyst`, `hold`, `snap`, `smear`, `all`
  (default), `allsmear`, `free32`); `?livedemo=lasso | swing` with a demo.
- Draw the revolver (LMB) and walk with it up: the gun follows the cursor at any angle. R reloads on the move: the
  upper body plays the standing reload's 13 frames over the walk / run legs.

Mirror for testing: `D:/Game/src-xlive/` (`http://localhost:8210/src-xlive/`). Captures, GIFs and the measuring scripts
are in `D:/Game/tmp/exp-livehero/`.

## How it is built

**The export.** `tools/blender/ragdoll_export.py` (the western session's ragdoll exporter) got `--atlas DIR`: every pose
of that atlas, posed by the model's own `pose()` exactly as `pixel_rig.py` renders it, as each bone's world matrix,
plus the atlas's clip timing (fps, `play`, `ms`, `marks`, stride / advances). The outlaw: 22 segments, 24 bones, 321
poses, 7356 triangle corners; 147 KB of mesh + 611 KB of JSON, exported in **5 seconds** (the atlas it replaces: 27 MB
of PNG in 8 sheets of 1536 x 8160 px, ~50 MB each once decoded, and a Blender render of every pose at 16 facings). The
gunslinger exports the same way (`out/live/gunslinger`, 345 poses), but his duster's long panel is runtime cloth and is
not in the mesh: only the rigid shoulder cape is (see the plan).

```
D:\Blender\blender.exe -b --factory-startup --python tools/blender/ragdoll_export.py -- \
  --model tools/blender/loadouts/outlaw.py --out D:/Game/concepts/sprites/out/live/outlaw \
  --atlas D:/Game/concepts/sprites/out/outfits/outlaw          (run from the repo root)
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
| runtime cloth (the Ranger's cloak, the gunslinger's duster) | `view/cloth.js`: a 3D Verlet grid pinned to a bone per pose, drawn on the CPU into the sprite | **missing** | the outlaw has none; see the plan |
| hair streaming in strong wind | `hero.hairWind` repaints edge pixels | missing | cheap to add as a GPU vertex sway of the hair parts or the same pixel trick on pass B |
| shiny armour (the Ranger) | metal mask -> composite glints | missing | a per-family metal flag into the G-buffer's E.w (pass B writes 0 today) |
| HD bow / pixel bow (the Ranger) | `PL.drawPixelBow` from the render's overlays | missing | the bow string becomes a live line between two bones |
| normals / depth layers | the atlas's normal sheet; a depth sheet for the cloth's occlusion | **true normals and per-pixel depth** | better: hands go behind crates, the x-ray works per pixel |
| afterimages, reflections, contact shadow | read the composite canvas | the atlas frame for the same pose | close; afterimages of procedural poses would show the base pose |
| poses the model lacks (lasso: added to the atlas after this export) | atlas | falls back to `idle.0` | re-export (5 s) once `western.py` has them |
| sinking in water | the sprite is cropped | the body is lowered: the ground's depth hides it | |
| blink (i-frames) | card hidden | body not drawn | same |

Done in this experiment because they were cheap: the character pixel type, the x-ray, the sun-shadow test, contact
shadows / afterimages via the atlas frame, the procedural layers.

## A full switch to live characters: the steps

1. **The cowboys' gun play live** (the outlaw today, the gunslinger next): make `?live=1` a setting; re-export when a
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

- **Cloth**: the biggest piece of work (step 2); until then the gunslinger's duster is a rigid cape.
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

Do the duster cloth (step 2) before making live the default for the gunslinger; the outlaw can go first. Keep the atlas
pipeline as the look's reference and for everything that stays a sprite.

### Open questions

- Smear frames: a style call (they add change on purpose). Worth a look in the GIFs.
- The hysteresis in yaw degrees (7) is up to ~10 deg on screen near the vertical (the foreshortened directions); a
  hysteresis in screen angle would be more even.
- 32 facings (`free32`) with smooth time: not worth it in the numbers (346 / 45 on the walk).
- Enemies live at horde scale: not measured here.

## Files

- `src/view/livehero.js` (new): the live hero: poses, the knobs, the procedural layers, the demos, the meters' hooks.
- `src/dev/livekeys.js` (new): Shift+7 / 8 / 9. `src/dev/livelook.js` (new): the look-parity lineup.
- `src/render/rigmesh.js` (small, additive): the per-body pixel `type`, the optional x-ray pass, B and X over the
  bodies' screen box.
- `src/render/gfx.js` (small, additive): `G.extra(mesh, 'xray')`; `G.setPlayer(x, h, z, sun = .5)`.
- `src/sim/player/adapter.js` (additive): the read-only `faceRest`.
- `src/core/loop.js`, `src/main.js`, `src/core/flags.js` (`live`, `livek`, `livedemo`), `src/dev/devkeys.js`: the switch.
- `tools/blender/ragdoll_export.py` (additive): `--atlas`.
- `D:/Game/tmp/exp-livehero/`: `probe.mjs` (captures, ports 8210 / 9410), `s6_shimmer.mjs` (the meter) +
  `mktables.py`, `s10_look.mjs` + `lookstats.py` + `mkparity.py` (parity), `s11_perf.mjs` / `s14_gpu.mjs` (perf),
  `s2_ab.mjs` + `seq.mjs` + `mkab.py` (the GIFs), `simview_live.mjs` + `runtests.sh` (the tests).
