# Experiment: the lasso (a cowboy's gadget on F)

A lasso for the gun loadouts (`?set=gunslinger`, `?set=outlaw`), as a gadget of the equipment experiment
([equipment.md](equipment.md)): hold F to spin the loop overhead, let go to throw it at what's under the cursor. Rope an
enemy and yank it off its feet, tow a barrel, drag a tumbleweed home, or catch a high limb and swing over the stream like
Indiana Jones. It is part of the equipment experiment: **off by default**, and nothing changes while it is off (golden,
smoke and simview pass unchanged).

## Turning it on

- `?equip=1` with a gun loadout: a cowboy starts the sandbox and every run with the lasso in the slot.
  `http://localhost:<port>/src/?mode=sandbox&set=gunslinger&equip=1`. Switching to a cowboy mid-game (the loadout key)
  hands him the lasso if the slot is empty or holds the Ranger's default flask; switching back gives the flask back.
- `?equip=lasso`: the lasso in the slot whatever the experiment's other settings.
- It is gun-only (`GADGETS.lasso.gun`): a bow loadout can't carry it (the slot cycling and the caches skip it).
- Sandbox menu > Game > **Lasso: preview poses** cycles every lasso pose in place (its name over him), so the art can be
  checked from every yaw; WASD stops it.

## Controls

| input | what it does |
|---|---|
| **hold F** | spin the loop overhead (walk at half speed with the spinning arm); the aim marks what you'd catch: an enemy (a dashed ring at its feet, a marker over it), a barrel / crate (a ring), a high anchor (a ring round the point and a dotted drop to the ground), else where it lands. Red: out of reach (10 m) |
| **let go of F** | throw (the throw clip; the loop leaves the hand at its `release` mark and flies in an arc, following a moving target) |
| **tap F** while holding something | **yank** (at the yank clip's `pull` mark it comes off its feet) |
| **hold F** while holding a body | the **hammer throw**: it's swung off its feet round you (bowling over whoever it meets), let go of F to fling it out along its way |
| **hold F** on a swing | climb the rope (shorter: the swing quickens) |
| **let go of F** / **Space** on a swing | let go: you fly on with the swing's speed (the player's fall and landing) |
| **WASD** on a swing | pump (push the swing along the way you hold) |
| **walk away** while holding | drag it (the rope stretches 0.3 m, then a target that can't follow holds you back) |
| **LMB** while spinning / holding | drop the rope and draw (the gun takes the press: the gunslinger's hip shot). Chosen over a one-handed shot: both hands are on the rope in the haul poses, and "rope him, yank him down, drop the rope, shoot him while he's stunned" is a good rhythm |
| **roll** (Space) while holding | the rope slips |

## What it catches

- **Brutes** (combat's): roped, it can't hop, so it can't strike. Walking away drags it (up to 3.2 m/s). A yank throws it
  at you: it tumbles over its facings through the air, bowls over anyone in the way (12 each), lands 1.15 m short of you,
  takes 18 and lies stunned 1.5 s (stars over it). The rope slips after 3.4 s.
- **Gunmen** (the desert's): roped, the aim is let go and the gun goes back in the holster; he leans away from you,
  slowly. A yank knocks him off his feet: he flies (`fall`), lands on his back 2.4 m short of you (die_b from his knees,
  placed as a corpse is), lies stunned, gets up (the same frames backward) and draws again.
- Heavier bodies don't come so easily: see **Strength** below (an elite brute or a sheriff is snared, a bruiser trips, a
  champion pulls you in).
- **Barrels and crates**: towed through the prop physics (an upright barrel tips over and rolls after you, a crate
  slides); a yank shoves it at the speed its own friction brings it to your feet. A powder keg yanked into something can
  go off.
- **A lit brazier** (the light garden): pulled over toward you at once: it goes out and lies on its side (lights.js
  `topple`), its coals spill burning on the ground (the fire flask's pool: it burns enemies in it, wood catches). It's
  stood up again, lit, 40 s later once you're away.
- **Tumbleweeds** (the desert): a loop that lands by one snags it and it comes bouncing home as the loop is reeled in,
  then the wind takes it again. (Tumbleweeds are a view, so this is the lasso's view's doing: the sim's loop just missed.)
- **Anchors** (at least 2.5 m up, within 10 m of the hand): you swing.

## Strength

What's on the rope weighs something against your pull, and the ratio sets how the catch goes. Your **pull** is 1 x the
spin's **charge**: a quick throw pulls at 0.85, a loop spun up for 1.2 s at 1.3 (the loop turns half again as fast and
grows a little meanwhile), x the modifiers' `lasso.pull` notes (`host.mods`: an item or a run rule can make you stronger).
The **weights** (content/lasso.js `WEIGHT`): a brute 0.65, a bandit 0.7, a bruiser 1, a sheriff 1.3, an elite brute 1.7,
a champion 3.4, barrels and crates 0.5. The class is fixed at the catch (pull / weight):

| class | pull / weight | held | a yank (tap F) |
|---|---|---|---|
| **light** | >= 1.15 | it comes: dragged at 3.2 m/s; the hammer throw | thrown at your feet (above) |
| **even** | 0.78 .. 1.15 | it fights: dragged at 0.9 m/s, it tugs back every 1.3-2.1 s (0.45 s at 1.6 m/s: the rope drags you along), slips after 2.2 s | it only **trips**: falls 1.1 m toward you, takes 8, lies 0.9 s |
| **heavy** | 0.42 .. 0.78 | **snared** at once: you snap the rope down onto its legs, it stands rooted 2.4 s (an elite 1.8 s), the loop round its ankles, the rope let go; then it kicks free and the loop comes home | - |
| **strong** | < 0.42 | **it pulls you in**: a tug of war: it heaves, reeling you in at 2.1 m/s for 1.05 s, then slackens 0.42 s; reeled in to 1.5 m it lets go of the rope and you're in its reach. Roll or LMB to let go | in its slack: it trips (0.9 m, 0.8 s); in a heave: you're jerked off your feet toward it and the rope is lost |

So with no items: brutes and bandits always come; a bruiser trips on a quick throw and comes on a spun-up one; a sheriff is
snared on a quick throw and trips on a spun-up one; an elite brute is always snared; a champion always pulls you in.
A snared gunman can't take a step but his gun still works. Nothing snares in the air (a kicked or flung body): it's held
as an even one instead.

**Seeing it:** while the loop spins the aim's mark says what the throw would do: gold = yank, amber = trip, blue = snare
(a second ring at its ankles), red = it pulls you (a dotted line crawling in toward it), and over the target an HD word:
`yank` / `trip` / `snare` / `pulls you`. Spin longer and the word can change. Held, the first few times: a hint for the
even (`it fights back · tap F: trip it`) and the strong (`it pulls you in! · tap F in its slack: trip · roll: let go`).
Dragged in, his heels skid (steps, dust, footprints); the rope creaks faster while it pulls on you.

## Live (the live hero's rope work)

The live cowboys (the gunslinger by default, the outlaw with `?live=1`) do the rope work with clips made for the live
model (tools/blender/western.py, section "lasso live": `LASSO_LIVE`, ls_*), picked by the lasso's state in
view/livehero.js (LASSO): the standing spin (ls_spin: its frame by the loop's turn), the throw (ls_throw; ls_throw_up at a
high anchor, more than 22 deg up from the hand), the catch (ls_take; a strong one's ls_jerk), the hold (ls_hold), the
strain while it pulls on you (ls_strain; ls_dragged while it drags you), walking with it (ls_haul_walk, backward when you
back away), the yank (ls_yank), the snare (ls_snare). The throw, the yank and the snare are **warped** onto the sim's own
timing: the clip's mark (release / pull / cinch) lands on the step the sim acts at, so nothing in the sim changed for them
(a sprite cowboy still plays the atlas poses). Spinning (standing or walking), the right wrist is IK'd onto the spin circle
(fitted from the model's ls_spin keys: beside the head, under the brim's edge: no arm reaches over a sombrero) at the
loop's turn, and the loop rides over the hat with a spoke down to the drawn fist
(features/equip/lassolook.js reads `host.playerRopeHand`: the live hero's drawn RopeHand0 / 1 and the circle), so the rope
leaves the hand you see in every phase. While the rope is in his hands the live hero's idles, head look and weather moves
stay off.

## The anchors

- **The 3D trees' limbs** (the Proving Grounds' oaks, the dead trees, willows): any bone of the tree 2.5 m up or more.
- **Tall props' tops** (`ANCHOR_TOP` in content/lasso.js): gateposts, the corner towers, pillars, the windmill's deck, the
  water tower, the signpost. Low anchors make small swings, or a tether you run round on the ground.
- **The lasso's own snags** (features/equip/anchors.js), there only while the lasso is in play, in the Proving Grounds (dark
  oak) and Red Mesa (bleached cottonwood), with a frayed old rope hanging off each limb as a hint:
  - on the plateau / mesa by its west edge, its limb out over the ledge and the stream / creek: swing off the top over the
    water to the far bank, or from the far bank up onto the top (hold F to climb as you swing in);
  - on the west bank of the stream's south stretch, its limb out over the water (the trunk stands north of the run-up):
    run out from the bank and swing over to the east bank.

## How it works (files)

- `content/lasso.js`: every number (`TUNE`), the poses (`POSES`: the art's names, the clips' marks, the stand-ins), the rope
  hands' markers (`HANDS`), the rope's palette, the tall props that are anchors (`ANCHOR_TOP`). `GADGETS.lasso` in
  content/gadgets.js: its name, colour, cooldown (1.4 s once the loop is home), range.
- `sim/player/lasso.js`: **the cowboy's side**, in the gun.js pattern (created by player.js through `H.lasso`, stepped before
  the gun; idle it returns at once). Spin (walking at half speed, the lws_ / lrs_ legs), throw (planted; `lasso.loose` at the
  release mark; his speed is kept for a swing), haul (the rope as a leash), yank (`lasso.pull` at its mark), the swing: a
  pendulum in the **world** (gravity 15, the rope only pulls, reeled in to clear the ground, WASD pumps, F climbs with the
  angular momentum kept, the ground slides him, walls and cliff faces bump him off, the water drops him in), the grab
  (`lasso_hang_in` forward until its `grip` mark: still on his feet) and the drop (it backward over his fall). Each hang
  frame places the sprite so the grip marker (`POSES.hang.grip`) sits on the rope's end. The camera can turn at any time:
  the swing lives in the world and writes P (the view frame) every step.
- `features/equip/lasso.js`: **the loop's truth**: the aim, the flight (sub-stepped catch tests), holding, the yank, the
  champion's rhythm, the swing's catch, the reel home. A test handle `pin(x, y, h)` aims at a world point (frame-rate checks).
- `features/equip/lassolook.js`: **the view**: the spin loop on the art's own hand circle (per clip and facing the circle
  RopeHand0 draws on screen gives the loop's centre and turning way; the hand is a 3D point on it, the loop a ring 0.45 m
  over the fist, its honda trailing the hand), the wind-up, the flying loop and the rope paying out (a 16-point verlet
  chain), the cinch, the aim marks, the stars, the tumbleweed's snag. All world lines (`host.line`): depth-tested, right from
  any yaw and zoom, 1 px, the hemp's lay in three tones.
- `features/equip/anchors.js`: the snags (kit3d meshes in the cached static shadow, trunk colliders, limb segments).

Small, additive changes in other areas' files (each named in its commit):

- `sim/player/player.js` (CRLF kept): `'rope'` in BUSY, `H.lasso` created with the gun's internals and stepped before the
  gun. `sim/player/adapter.js`: passes `createLasso` and the camera's yaw. `sim/player/gun.js`: `stow()`.
- `features/combat/core.js`: `hold(p, sec)`, `shift(p, dx, dy)`, `fling(p, x, y, o)` (a tumbling hop that lands without
  striking, bowls over, stuns; `o.h0`: thrown from up in the air), `carry(p, x, y, h)` (held up off its feet: the hammer
  throw); event `combat.bowl`.
- `features/foes/sim.js` + `foes/look.js` + `content/foes.js`: `roped`, `shift`, `fling` (knocked down, lying, getting up),
  `carry`, and how the view shows a knocked-down or carried gunman; `ai.roped`, `ai.getUp`.
- `features/lights.js` (CRLF kept): `topple(p, dx, dy)` (a brazier pulled over: out, on its side; its mesh tips over in the
  view, the coal card veiled; stood up again later).
- `render/camera.js`: while the player is on a rope (and the fall after it) the world-edge clamp gives way by his height
  over where he last stood, so a swing near the world's edge stays in view (grounded, the clamp is as it was).
- `features/tumbleweed.js`: `snag / tow / unsnag` (a weed rolls after a tow point instead of the wind).
- `audio/audio.js`: the lasso's events on existing recipes (below). `core/events.js`: `lasso.*`, `combat.bowl`.
- `features/equip.js`, `equip/sim.js`, `equip/look.js`, `ui/equipslot.js`: F goes to the lasso while it's in the slot or busy,
  Space lets go of a swing, the preview row, the hints (the first three holds and swings of a session), the slot's glyph (a
  coil and a thrown loop), the loadout switch.

## Tuning knobs (content/lasso.js TUNE)

- `spin`: `grow` (s to full size), `rps`, `r` (the loop's radius), `h` (over the fist), `lag` (the honda behind the hand),
  `tilt`, `walk` (x his speed while spinning), `min`.
- `range`, `pick` (px from the cursor for an anchor), `anchorMin` (m up).
- `throw`: `t0`, `tk`, `tMax` (the flight's time), `arc`, `catchR` (the loop's opening), `sub`.
- `miss`: `lie`, `reel`; `weed` (how near a tumbleweed is snagged).
- `hold`: `len`, `haul`, `slip` / `slipElite` / `slipBoss`, `drag` / `dragElite`, `stretch`, `tapMax`.
- `yank`: `dur`, `h`, `stop` / `stopMan`, `dmg`, `dmgFly`, `stun` / `stunElite` / `stunBoss`, `bowl`.
- `str`: `pull`, `lo` / `hi` (x the pull at a quick / a spun-up throw), `charge` (s to spin up), `fast` (the loop's
  turns at full charge), `light` / `even` / `heavy` (the classes' lower bounds of pull / weight). `WEIGHT` (export): the bodies.
- `even`: `drag`, `tug` [lo, hi] s between tugs, `tugT`, `tugV`, `trip`, `tripH`, `tripDur`, `tripDmg`, `stun`.
- `snare`: `clip`, `cinch` (the cowboy's snare clip), `dur`, `durElite`.
- `strong`: `reel`, `heave`, `slack`, `near`, `jolt`, `trip`, `stun`.
- `prop`: `yankV`, `towMax`, `stop`.
- `swing`: `hang`, `g`, `lift`, `reelT`, `clear`, `minLen`, `up`, `push`, `pump`, `drag`, `climb`, `max`, `bump`, `rest`, `damp`.
- `brazier`: `spill`, `r`, `dur` (the coals).
- `hammer`: `hold` (the press that starts it), `rps`, `spinUp`, `r`, `h`, `bowl`, `dmg`, `v`, `dur`, `max`.

## Sounds

No forge recipes of its own yet: the events go to the closest existing ones (audio/audio.js): a turn of the loop
(`lasso.swish`, the view's, once a revolution; the hammer throw's turns too) and the throw on the cloth swish (`jump`,
quiet), the cinch a thump in what it caught (straw for a body, wood for a barrel), a brazier an iron clunk and drop, an
anchor a wood thunk (`stuck`), the yank a heave, a yanked body's landing the gunmen's fall thud (`foeFall`), a slip a
rustle, a bump or a bowl a body hit, and a short creak (the bow's draw creak) now and then while the rope strains
(`lasso.creak`, the view's). Candidates for the forge: a rope whoosh per turn, a whistling throw, a hemp cinch, a creak
of its own, a dusty body thud.

## Tested

- Off (the default): golden 16/16 identical (vs ref4 on exp/all; on integrate vs a fresh save of it,
  `tmp/exp-lasso/golden_int`), smoke all passed, simview identical (views, 30 / 240 fps).
- On: `tmp/exp-lasso/simview_lasso.mjs` (a copy of simview with the lasso's scenarios, its own `--dbg` port: the Proving
  Grounds with brutes roped, dragged and yanked, a barrel towed and yanked, a swing over the stream, a miss, the hammer
  throw into a mate, a lit brazier pulled over; Red Mesa with gunmen roped and yanked and a swing off the mesa over the
  creek; the aim pinned in world space): identical without views and at 30 / 240 fps. `?owncheck=1` sessions in both
  biomes (holds, yanks, swings, the hammer on brutes and gunmen, the brazier): no foreign writes, no added fields. No
  console errors or warnings.
- Scripted captures and GIFs in `D:/Game/tmp/exp-lasso/` (b/*.js and g/*.js are the probe bodies): spin_walk_two_yaws,
  brute_rope_yank, gunman_rope_yank, barrel_tow, tumbleweed_drag, swing_stream_gunslinger / _outlaw, swing_creek_desert,
  hammer_throw, brazier_topple.
- Perf (`?perf=1`, headless 1920x1080, one sim step a frame, ms a frame; a quiet machine / a busy one): equip.update
  .005-.04, view .003-.02, frame .003-.07 (the most: the brazier's coals, the equipment's fire pool), hd .02-.05 (the slot,
  a hint); player.step +.01-.02 spinning or swinging (vs the lasso off). Off: nothing runs but an early return in
  player.step and the anchors' check.

## Open questions

- **The hammer throw** works on brutes and gunmen (not a champion, not props). It's strong in a crowd; it may want a
  cost (a longer cooldown after it, or the rope slipping sooner).
- **LMB** drops the rope and draws (see Controls). A one-handed quick shot while hauling would want haul + gun poses.
- **Balance**: the yank's 18 + a free stunned target is strong; the cooldown is short (1.4 s). A champion's tug of war is
  tuned by feel against scripted bots only.
- **The camera** near the world's edges: the clamp gives way by the body's height while he's on a rope; a swing that ends
  higher than ~3 m over where he left could still touch the edge of the view.
- **The gunmen's nav** is built when the desert is entered; a snag's trunk added later isn't in it (they may walk through
  its base).
- **Swinging onto the plateau** needs a climb as you swing in (the plain pendulum bumps into the cliff face): fun once
  learned, but nothing teaches it yet.
