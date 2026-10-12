# Fists: unarmed fighting for the live cowboys (2026-10-08)

The user: "make unarmed a thing. So, punches basically. Come up with an intuitive way the fighting can be done. It should
not determine / mix with how armed melee feels later on. Punches, combos, grab, grapple, left/right hand, animations,
different punch styles, headbutt, kick. It has to feel and look smooth. Good feedback is essential."

Decided with the user (my proposal, the user picked each recommendation):
- **2 = fists, 1 = gun** (weapon slots: armed melee later becomes its own slot with its own moveset).
- **Defense: the slip + a passive guard.** Space with the fists up is a quick bob / weave (i-frames); slipping a punch at
  the last moment opens a counter (bonus damage, a flash, a slow-down). Standing in the stance blocks frontal jabs.
- **The gunmen box back in the first build** (the unarmed ones: `?foes=unarmed`): they square up, circle, telegraph a
  jab or a haymaker, guard sometimes, get dazed and floored. Brutes and dummies only react.

## 1. The controls (a live loadout: the gunslinger; the outlaw with `?live=1`)

| input | in the stance | in a clinch |
|---|---|---|
| **2** / **1** | the fists (the gun goes in the holster) / the gun again | |
| **LMB** | the LEFT hand: press = the fist cocks back, release = it goes | a short left to the face |
| **RMB** | the RIGHT hand: the same | a short right |
| hold LMB / RMB past 0.2 s | a heavy: left = the body blow (breaks a guard, doubles him over), right = the haymaker (floors him); it charges till released | |
| **LMB + RMB** together | the headbutt (dazes) | the headbutt |
| **V** | in a string: the roundhouse finisher; else the push kick (brawl's) | the knee |
| **E** | the clinch, on a foe in reach | the hip toss at the cursor |
| **Space** | the slip (the way you hold; nothing: back); sprinting: the roll | shove him off |
| **Shift** | runs (the guard drops while he runs) | |

**At rest and in a fight** (2026-10-10, the user: the fists shouldn't be up all the time): with the fists selected
and no fight on he stands and walks as ever (his idle, walk and run; Space his own jump / roll). The guard comes up by
itself when a fight starts: a hand pressed (the punch goes at once), the switch (2), a blow taken (`player.hurt`), or a
living foe (a gunman, a brute; not a dummy) within `TUNE.rest.near` m; it goes down after `TUNE.rest.calm` s of none.

**The string**: alternate hands to flow: **jab, cross, hook, uppercut**: the uppercut is a finisher (he's thrown up and
floored, his hat flies). The same hand twice: the left doubles the jab, the right after a cross is a right hook (then the
left uppercut finishes). Any move's chain window takes the next press (its recovery is cut); a press made early waits
(`input.buffer`). Four unanswered hits on one body within 1.6 s daze him.

The tables are in `src/content/fists.js` (MOVES, STRING, HEAVY, CLINCH, REACT, FOE): every timing there is the truth; the
art is timed by it.

## 2. The parts

| part | file | what it does |
|---|---|---|
| the player's side | `src/sim/player/fists.js` (in player.js's step, like brawl.js) | the stance (P.state `guard`: footwork, facing the lock), the moves (`fist`: wind, charge, throw, the chain), the slip (`slip`), the clinch (`clinch`); emits `player.punch`, `player.grab`, `player.toss`, `player.slip` |
| what a blow does | `src/features/fists.js` | keys 1 / 2, the soft lock, lands the blows through the owners' APIs (combat's damage, the foes' brawler, combat's hold / launch for brutes), hitstop, the counter / knockout slow-down (the `sim.speed` note), the clinch's hold and toss; its view: the hit stars, the block sparks, the combo count |
| the gunmen who box back | `src/features/foes/brawler.js` (foes/sim.js calls it) | the unarmed gunmen's fist fight: square up, circle, one attacks at a time (the token), telegraphed jab / haymaker, guard, reactions (REACT), dazed, held in a clinch; their poses in foes/look.js |
| the live hero | `src/view/livehero.js` `fistsMotion()` | the fs_* clips by the sim's move, its phase and its time (the hit frame shown at the sim's contact) |
| sounds | `src/audio/audio.js`, `audio/runtime/events.js` | punch (face smack / body thud by weight), block, whiff, slip, the gunmen's grunts of effort |

## 3. The art (western.py section "fists"; exported with ragdoll_export.py --clips)

Conventions for every clip:
- He stands as in the brawl section's kit (he faces -Y, +X is his left, 1.8 m tall); the revolver stays in its holster
  (keys not named gun_*); the hat stays on.
- **Read from the game camera** (orthographic, ~55 deg down, 30 px a metre): a fist in front of the face sits under the hat's
  brim from above. The guard holds the fists at the chin's height but FORWARD of the brim's edge (~.35 m ahead of the
  chest), punches extend well clear of it; big shoulder turns and weight shifts read, small wrist moves don't.
- **The contact** (`hit` mark): the fist where the target's face (or body) is when the target's middle stands at the move's
  `dist` (content/fists.js) from his middle: a man's face is ~.12 m in front of his middle, at 1.55 m; his belly at 1.1 m.
- **Timing**: the view time-warps each clip so its `hit` frame shows exactly at the sim's contact and its last frame at the
  move's end; give `ms` per frame anyway (previews). Frame 0 of a quick move is its WIND (anticipation: shown, held, while
  the button is held); the throw starts at frame 1. The last frame of every punch returns to the guard (`fs_guard.0`) so
  strings flow.
- A heavy (fs_body, fs_hay) has marks `loop` (a 2-frame tremble held while charging: frames loop and loop+1), `throw` (the
  first frame after the release) and `hit`.

### The cowboy (FISTS_LIVE; the gunslinger's model, the outlaw's later)

| clip | frames (what each shows) | marks |
|---|---|---|
| fs_guard | 4, loop: the boxer's stance, left foot forward, fists up at the chin forward of the brim, chin down, a small bounce on the balls of the feet | loop 0 |
| fs_step_f / fs_step_b / fs_step_l / fs_step_r | 4 each, loop: the guard shuffling forward / back / to his left / to his right (lead foot then trail foot, never crossing), one cycle = .9 m | loop 0 |
| fs_block | 3: the hit absorbed on the forearms (pushed back half a step, chin tucked), hold, back to guard | |
| fs_jab | 5: wind (the left fist pulls back a little, the weight on the front foot), extend, contact (the left arm straight, the shoulder up to the chin), retract, guard | hit 2 |
| fs_jab2 | 4: a quicker jab from the retracted jab (no wind back): wind, contact, retract, guard | hit 1 |
| fs_cross | 5: wind (the right hip back), the hips and shoulders turning in, contact (the right arm straight, the right heel up, the left fist home at the chin), retract, guard | hit 2 |
| fs_hook_l | 5: wind (the weight onto the left leg, the left elbow out), the arc (the left arm bent 90 deg, the hips and shoulders turning hard right, the left foot pivoting), contact (the fist across in front of the target's cheek), follow-through, guard | hit 2 |
| fs_hook_r | 5: the mirror of fs_hook_l | hit 2 |
| fs_upper_r | 6: dip (the knees bend, the right shoulder drops), drive up, contact (the right fist rising under the chin, the body rising onto the toes), the follow-through up, settle, guard | hit 2 |
| fs_upper_l | 6: the mirror | hit 2 |
| fs_body | 8: dip to the left (the left shoulder down), loaded (the left fist low and back), hold a, hold b (the tremble), drive (the hips snap), contact (a left hook to the target's right side at belt height), recover, guard | loop 2, throw 4, hit 5 |
| fs_hay | 9: load a (the hips turning away), load b (the right fist cocked behind the right ear, the left arm out for balance), hold a, hold b, the swing (a wide overhand arc), contact, the follow-through (overextended, the body turned past), recover, guard | loop 2, throw 4, hit 5 |
| fs_head | 5: wind (the head and chest pulled back, both hands reaching for his shoulders), drive, contact (the forehead forward ~.3 m, the hat brim tilted), recoil, guard | hit 2 |
| fs_round | 6: wind (the weight onto the left foot, the arms up), the chamber (the right knee up and across), contact (the right shin across at his ribs, ~1.1 m, the body leaning away), the follow-through, the foot down, guard | hit 2 |
| fs_grab | 4: wind, the reach (both hands forward to a collar at 1.35 m, ~.45 m ahead), the grip (both fists closed on it), into the clinch | hit 2 |
| fs_clinch | 2, loop: both fists on his collar at ~.4 m ahead, the elbows down, a slight lean in; a breath | loop 0 |
| fs_cl_l / fs_cl_r | 4 each: from the clinch, the hand lets go, a short uppercut to the held man's face (~.38 m ahead, 1.5 m), back onto the collar | hit 1 |
| fs_knee | 5: from the clinch, pulling him down with both hands, the right knee driven up into his belly (~.35 m ahead, 1.0 m), down, the clinch | hit 2 |
| fs_cl_head | 5: from the clinch, the head back, the forehead into his face, recoil, the clinch | hit 2 |
| fs_toss | 6: from the clinch, the hips turned in under his (a quarter turn to the right), loading him on the right hip, the throw over (both arms sweeping across to the right: the release), the follow-through, recover, guard | hit 3 |
| fs_shove | 4: from the clinch, both palms driving forward at his chest, extended, recover, guard | hit 1 |
| fs_slip_l / fs_slip_r | 4 each: from the guard, a dip and weave to his left / right (the head off the line ~.35 m, the knees bent, the guard kept), the lowest point, coming up, guard | |
| fs_slip_b | 4: a lean back and a step back (the head pulled back out of reach), guard | |

### The gunmen (FISTS_FOES; bandit, bruiser, sheriff in out/pivot3d_chars, unarmed: the revolver holstered; the bruiser's coach gun is hidden by the game)

| clip | frames | marks |
|---|---|---|
| fx_guard | 4, loop: a brawler's guard (fists up, shoulders hunched, rougher than the cowboy's), bouncing | loop 0 |
| fx_gstep | 4, loop: the guard shuffling forward (one cycle .8 m; the game plays it backwards when he backs off) | loop 0 |
| fx_jab | 6: the telegraph (a pull back, the shoulder drops: readable), held, extend, contact (~.85 m, 1.55 m), retract, guard | wind 0, hit 3 |
| fx_hay | 7: the big telegraph (the right fist wound back behind his head, the body turned away), held, the swing, contact, the follow-through (overextended), recover, guard | wind 0, hit 3 |
| fx_block | 3: the forearms take it (pushed back), hold, guard | |
| fx_gbreak | 3: the guard knocked open (the arms flung wide, a stumble back), recover, guard | |
| fx_hit_jab | 3: the head snapped back (the chin up, the hat brim tipping up), held, back to guard | |
| fx_hit_l / fx_hit_r | 3 each: the head and shoulders turned hard to his left / right (struck on the other cheek), a stagger step, back | |
| fx_hit_gut | 4: folded over the belly (both arms in, the knees bent, the head down), held, straightening, guard | |
| fx_daze | 6, loop: dazed: the arms low, the head lolling, swaying, a stumble step | loop 0 |
| fx_held | 2, loop: clinched: grabbed by the collar, his hands on the player's forearms, leaning back | loop 0 |
| fx_taunt | 6: "come on": the right hand beckons twice, back to the guard (between attacks, sometimes) | |

## 4. Built (2026-10-08, uncommitted)

The logic, its hooks and the gunmen's fight are in; the art (fs_* / fx_* clips) and the punch sounds come from three
agents (sections 3 and 5). Until a model has the clips, the live hero shows the sim's atlas stand-ins and the gunmen their
idle / hit clips.

- **The player's side** (`src/sim/player/fists.js`, created by the adapter as `H.fists`, run first in player.js's step):
  the stance `guard` (footwork at TUNE.stance's speeds, facing the soft lock or the cursor; Shift runs him with the guard
  dropped; off a ledge player.js has him), the moves (`fist`: wind / charge / throw, the string, the chain window, the step
  in to the move's `dist`), the slip (`slip`: i-frames, the counter window), the clinch (`clinch`). A ring of 6 queued
  presses (no allocation): the headbutt is the other hand pressed within 0.09 s of the first while it winds.
- **player.js hooks** (CRLF, edited with Python): the import and `...FISTS` in BUSY, `fists.step` before brawl's,
  `fists?.space()` first in onSpace, `fists?.press('L')` / `release('L')` in press / release, new `pressR` / `releaseR`,
  `fists?.untouchable()` in untouchable. **adapter.js**: `fists: createFists`. **core/input.js**: RMB down goes to
  `PL.pressR()` first (then the abilities), RMB up to `PL.releaseR()`, a blur lets go of both hands.
- **The feature** (`src/features/fists.js`, before brawl / gun / combat): keys 2 / 1, V (roundhouse in a string, knee in a
  clinch; else brawl's push kick), E (grab a gunman in reach in front; toss in a clinch); the soft lock 4 times a second;
  `land()` on player.punch: one body (a gunman: his brawler's block test, then combat's damage by 'fist' with `quiet`, then
  his reaction; a brute: combat's damage, then hold / launch by REACT), else a dummy, a breakable thing, a movable prop;
  hitstop by the move (+ the charge, + a counter / knockout), shake on the heavies, the slow-down (`sim.speed` x .35 for .08 s
  of sim time on a counter, x .3 for .1 s on a knockout); the clinch: the held gunman placed in front of him each step, freed
  after TUNE.clinch.hold s (dazed: holdDazed). Its view: the hit stars (a four-point flash, then a ring opening out and two
  streaks along a heavy blow; a cold blue spark on a block) on the 'add' layer, gold / blue sparks through combat's particles,
  a dust puff on a body blow; its HD pass: the combo count ("4 hits", gold from 4) and the prompts (E grab; the clinch's keys).
- **The gunmen who box** (`src/features/foes/brawler.js`, called from foes/sim.js after `hands()`; `sim.brawler` is the API):
  approach (the nav's way), circle at FOE.ring or wait at FOE.wait, one attacker at a time (the token), the attacker steps in
  to FOE.close before winding up; jab / haymaker with their telegraphs; your guard blocks the jab (10 % through), the
  haymaker breaks it (and knocks you back); a slip that beats a punch opens your counter; his guard (by type) blocks your
  quick punches from the front; reactions, the daze (4 unanswered hits), floored by a down (the foes' launch: bodyfly, lie,
  get up), held in the clinch (his collider off while held), freed / tossed / shoved. A gunman on the lasso (roped / snared)
  is the foes sim's again. Poses: `src/features/foes/brawlerlook.js` (foes/look.js asks it first; the haymaker's telegraph
  star over his head; the bruiser's coach gun hidden while he boxes: the drop mask).
- **The live hero** (`view/livehero.js` FISTS section, `fistsMotion()` before brawlMotion): the clips by the sim's move /
  phase / time, the throw time-warped so the clip's `hit` frame shows at the sim's contact; the TRANSITIONS blend between
  fs_ clips at most 0.06 s (a string flows); the runtime smear on through a move's wind, charge and snap (`?fsmear=0` off).
- **The camera**: features/flow.js kicks the view along the blow on `fist.hit` (0.8 px x the move's kick).
- **Help**: the H panel (dev/keyhelp.js) has a Fists section; the menu's Controls > Keys has the four rows.
- **Events** (core/events.js): player.punch / grab / toss / shove / fist, fist.hit / whiff / grab, foe.fwind / punch.
  **Flags**: `?fists=0`, `?fsmear=0`.

### Checked (before the art)

- headless runs through `__r3d` (the browser pane, hidden): the string L R L R lands jab, cross, hook, uppercut (32 damage,
  the uppercut throws him), a charged haymaker, the headbutt dazes, the clinch's L / R / knee land on the held man and E tosses
  him (bodyfly), the guard blocks a jab (1 damage) and not a haymaker (12), a slip under his jab opens the counter and the next
  cross lands as a counter with the slow-down.
- golden: frozen mirrors with and without these changes (`src-fx0` / `src-fx1`): all 16 captures identical.
- smoke: all checks pass. simview: pass. A fists simview (a copy with a fist-fight scenario: the string, a haymaker, a
  clinch, slips, the brawlers boxing back for 7 s; the gunmen's records and the fists' state in the digest): sim identical
  with and without views.

## 5. The art and the sounds (installed 2026-10-08)

- **The cowboy** (western.py section "fists (the cowboy)", FISTS_LIVE, 28 clips; its own hook `_fs_hold`: feet planted by the
  ball, knuckles on points with the elbow's bend chosen, `_root` weight shifts, the revolver re-holstered): exported with the
  installed model's live list, installed into `concepts/sprites/out/live/gunslinger` (a pure superset: model.bin identical,
  every old pose and clip identical; backup `tmp/fists/backup_models/gunslinger`). Orthodox stance (left foot forward,
  bladed 32 deg): the right-hand clips are authored, not mirrored. Every punch ends on fs_guard.0, the clinch moves on
  fs_clinch.0. Measured: the face's contact at 1.46 m (these heads: eyes 1.51, chin 1.30), the knuckles at dist - .12 ahead;
  the footwork's feet move .3 m a half cycle (FOOT .6 m a cycle in sim/player/fists.js); the hip toss sweeps over to his
  RIGHT (the sim turns him 45 deg left of the cursor's way first, so the man lands where it points). The clinch holds the
  foe .6 m off (the hats). Review: `tmp/fists/cowboy/` (sheets, in-game lineups, tools).
- **The gunmen** (western.py section "fists (the gunmen)", FISTS_FOES, 13 clips on bandit, bruiser, sheriff): installed as
  MERGED models (the installed model.bin and poses + only the new frames: a full re-export would also bring the uncommitted
  character look pass to the gunmen; that's the look session's call). Backups `tmp/fists/backup_models/<type>`. fx_gstep's
  stride .44 m a cycle (brawlerlook STEP). The jab and haymaker frames match FOE's timing. Review: `tmp/fists/foes/review/`.
- **Sounds** (`audio/forge/recipes/punch.js`, 15 cases: jab, cross, hook, upper, heavy, body, block, head, kick, whiff,
  swing, slip, windup, ready, grab; events punch, punchBlock, whiff, fistCue, fistGrab, foeWind, foePunch in
  audio/runtime/events.js; the cases in src/audio/audio.js): layered skin slap + damped knock + low thump (+ a crack on the
  hard ones), nothing rings past ~100 ms. WAVs: `tmp/fists/sounds/` (fight_demo.wav: a 15 s fight).
- **The in-game reel**: `node tmp/fists/reel.mjs` (headless, ports 8341/9541) + `python tmp/fists/reel.py fight` ->
  `tmp/fists/fight_reel.mp4`.
- **Polish after the reel**: the soft lock keeps its target unless another scores clearly better (no flipping between two
  close foes). `?owncheck=1` over a fight: no foreign writes, no unlisted fields.

### Open

- The feel needs a hand on the mouse: the timings (MOVES), the step-in, the hitstop and the brawlers' pace are all in
  content/fists.js.
- The gunmen's hit flash (combat's, held full white for its first frames) reads strong on fast strings.
- The outlaw (`?live=1`) has no fs_* clips yet (his model is the look session's mid-way): the sim's stand-ins.
- Armed gunmen never brawl (only the unarmed ones); a disarmed gunman could.
- Perf bench not run yet (the per-step cost is a lock query 4 times a second and a few multiplies per brawler).
