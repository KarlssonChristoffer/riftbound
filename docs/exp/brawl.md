# Brawl: kick, called shots, grab and throw, lasso traversal (2026-10-08)

Four hands-on western moves for the live cowboys (the gunslinger by default; the outlaw with `?live=1`), built on what the
game already has: the launch system (`sim/player/launch.js`), the props' roll and push physics (`features/combat/props.js`),
the gunmen's knock-down (`features/foes/sim.js` fling) and ragdolls (`view/ragdoll.js`), the lasso (`docs/exp/lasso.md`).
This page is the research: what each move needs, what it reuses, where it goes. Section 6 is what was built.

The user's brief (2026-10-08), as pasted:
- **Kick / shoulder barge.** A close-range boot that throws gunmen off the mesa, into the brook or through a wall breach;
  kick a barrel so it rolls into a group and goes off. Reuses the launch code, the props' roll / push physics, the ragdolls.
- **Western called shots.** Shoot a hat off: it flies, lands, the gunman stoops for it. Shoot the gun out of a hand: he runs
  for it. A leg shot makes him stagger.
- **Grab and throw.** E picks up bottles, cans, crates or a lit barrel; throw it in an arc. (The trick-shot range already
  tosses cans.)
- **Lasso traversal.** Rope the watchtower lookout or a high oak limb and zip down; drag barrels; pull loose stones from a
  broken wall.

## 1. What the game has today (the parts these moves stand on)

| part | file | what it gives us |
|---|---|---|
| the player thrown | `sim/player/launch.js` | a body as a ball at his middle: gravity, walls stop it (`H.blocked` at the feet's level), a SLAM into a wall over 2.6 m/s hurts, bounce + friction on the ground, down, get up. Only the player. |
| the player's ragdoll | `view/herorag.js`, `view/ragdoll.js` | `drive / shove / frames`: a ragdoll pinned to a sim ball (the live hero only) |
| enemies off their feet | `combat/core.js` fling, `foes/sim.js` fling | a scripted arc (a lerp to a spot it can stand on), a tumble, bowling over whoever it meets, a stun. **No physics**: it can't go off a ledge, into water or through a gap |
| melee | `sim/player/gun.js` whip -> `player.melee` -> `features/gun.js` land() | the pattern for a blow: the sim emits the blow at the clip's `hit` mark, a feature finds what's in its arc (`entities.near`) and calls the owners' APIs |
| props physics | `combat/props.js` | barrels tip and roll (rolling without slipping), crates slide, `shove(q, vx, vy)`, impacts damage both (`strike`), a powder keg (`barrel_x`) explodes on an impact > 2.1 m/s, air time (`q.h`, `q.vh`: gravity, a hard landing strikes it) |
| fire | `features/lights.js` | wood props catch (`ignite`), burn, spread within 1.4 m; a burning prop's flame follows the prop |
| bullets | `sim/projectiles.js` | sub-stepped segments against each target's cylinder (`hitR`, `hitH`); the hit chain `onArrowHit(a, p)` gets the bullet at the hit point (`a.x, a.y, a.h`) |
| aiming | `sim/player/adapter.js` hoverFind | the cursor over a body aims at the HEIGHT it points at on it (head, chest, legs; 8-95 % of `hitH`). Called shots need nothing new to aim |
| gunmen | `foes/sim.js`, `foes/look.js`, `content/foes.js` | records per gunman (gun state machine, legs, flinch, rope, down); live 3D bodies (`view/livebody.js`, one rig slot each); the model's segments include `HatHold0` (the hat) and `GunHold0` (the gun) as separate pieces |
| the lasso | `features/equip/lasso.js`, `sim/player/lasso.js` | aim, throw, catch bodies / props / anchors (tree limbs >= 2.5 m, tall props' tops, its own snags), tow, yank, hammer throw, a pendulum swing in the world (writes P every step), climb the rope (F held) |
| live clips | `tools/blender/western.py` + `live_export.mjs` | a new clip for the live models in minutes: POSES specs + `LIVE_AT` hand targets + `_clip`; the view picks frames by the sim's state (`livehero.js` motion()) |

## 2. Kick and shoulder barge

**Controls.** `V` is the boot for a live cowboy (the pistol whip stays on the empty click with a foe in reach, as it was).
Sprinting (Shift, at speed) `V` is the shoulder barge. `?kick=0`: V is the whip again.

**The player's side** (`sim/player/brawl.js`, a part of the player like gun.js / lasso.js / launch.js, in BUSY):
- `kick`: squares up to the cursor (a soft snap onto the nearest target in its arc), a small step in; the blow at the clip's
  `hit` mark (0.17 s), planted until 0.44 s. `player.kick` carries the blow: {x, y, z, vx, vy (unit), reach, arc, power, barge}.
- `barge`: out of a sprint, 0.36 s along the run, the shoulder's blow at its mark and again every step it meets someone new
  (it bowls through a line of them), ending in the run at a lower speed. A wall ends it with a bump (the player's knock).

**Landing it** (`features/brawl.js`, as features/gun.js lands the whip): what's in the arc within reach, through each owner's API.
- **A gunman or a brute is THROWN** (new: a ballistic body, `sim/bodyfly.js`, shared by both owners): out 6.5 m/s, up 3.4 m/s
  for a bandit; heavier ones less (`TUNE.mass`: the bruiser x .6, the sheriff x .75, an elite brute x .6, a champion: a stagger
  only). The ball flies with gravity: a wall stops it (a SLAM: damage by speed, he slides down the face), it goes over a breach
  when its middle clears the stones (a wall's own top: `topOfProp`), off a ledge it keeps falling (fall damage past 2.5 m), into
  water it splashes (stunned in the water, then out on the bank it came from, his powder wet: no shot for a while). Whoever it
  flies into is bowled over (combat's bowl). Then he lies (stunned) and gets up (the knock-down's existing view: `fall`, `die_b`
  backward). The kick itself: 8 damage.
- **Props**: an upright barrel tips and rolls off at 7 m/s, a lying one is kicked on (props.js `shove`); a crate slides
  (~2 m); a powder keg kicked into anything hard goes off (props.js's own impact rule). Crates and kegs that hit bodies hurt
  them (props.js `strike`).
- **Loose things** (a shot-off hat, a dropped gun, a thrown can): kicked away.

**Why a new flight instead of fling:** fling picks a landing spot it can stand on first, then lerps there. A kick is about
WHERE physics takes him (the mesa's edge, the creek, a breach), so the flight must be integrated step by step against the
world. launch.js is the player's (it moves P in his view frame through H.blocked); bodyfly.js is the same model in the world
frame for any body, with its owner's test of what's solid.

## 3. Called shots

**Aiming needs nothing new**: the cursor over a gunman already aims at the height it points at (adapter hoverFind). What's
new is reading WHERE a bullet met him (`onArrowHit` gets the bullet at the hit point) and the gunman's reaction (his owner,
`foes/sim.js`, through a small module `foes/calls.js`).

| zone (height of the hit over his feet, the bandit's) | effect |
|---|---|
| **the hat**: over the head's top (1.68 m) to the crown (his hitH grows by the hat while he wears it) | the hat flies off along the shot (a sim object: flies, lands, slides), no damage; the bullet goes on. He flinches, then (no gun on you yet) walks to the hat, **stoops** for it and puts it back on; the sheriff takes it calmly but takes it |
| **the gun**: within .13 m of his gun hand while the gun is out (the hand from the sim's aim: .38 m ahead of him, 1.2 m up, a hair to his right) | the gun flies out of his hand (a sim object); 2 damage; he **shakes his hand**, then **runs** for the gun, stoops, picks it up and draws again. You can kick it away, or pick it up yourself (grab: it's yours to throw) |
| **the legs**: under .72 m | x .7 damage, he **staggers** (no shot for .6 s, his aim starts over) and **limps** for 4 s (walks at x .55, runs at x .6) |

The loose hat and gun are drawn as their own pieces of his live model (one rig slot each: the segment `HatHold0` /
`GunHold0` alone, turned and placed by the sim's flight + a view spin), and hidden on his body while they're off
(`view/livebody.js`: a per-body drop mask, additive). The atlas fallback (`?livefoes=0`) keeps the sprite as it is.

## 4. Grab and throw

**Controls.** `E` near something liftable (nothing else to use nearer: a chest, a sign) lifts it. While carrying: `LMB`
throws it at the cursor in an arc, `E` sets it down, `Space` drops it and rolls; he walks and runs slower (x .8, a modifier
note on `player.speed`); a crate or a barrel blocks the gun (both hands on it).

**What lifts:** crates (not the walls' crates), barrels (upright or lying), powder kegs, pots, a dropped gunman's gun, a
shot-off hat; a burning barrel stays alight in your hands (lights.js burns it where it is) and spreads its fire where it lands.

**How:** the prop stays the prop physics' (`combat/props.js`), which gets two small APIs: `carry(q, x, y, h)` (held: no physics,
placed at the hands each step) and `toss(q, vx, vy, vh)` (in the air: its existing gravity, ground and impact code takes it:
a hard landing strikes it, a powder keg goes off, hits on bodies hurt them). The throw's speed is solved for the cursor's spot
(an arc to land there, at most 11 m). The player's side is states in `sim/player/brawl.js` (`lift`, carrying as a flag on
locomotion, `throw`), the live hero's frames by those states (`livehero.js` motion(): additive cases).

## 5. Lasso traversal (the lasso: `?equip=1` or `?equip=lasso` with a cowboy)

- **Drag barrels**: already there (catch a barrel or a crate, walk away: it's towed; tap F: it's yanked to your feet).
- **Zip down** (new): stand high (the watchtower's lookout, the mesa's top, a ledge) and rope an anchor lower down and at least
  3 m away (an oak's limb, a snag, a post): the rope goes taut from your hands to it and you **slide down it** hanging by the
  hands (gravity along the line, friction), dropping off near its end (or F / Space to let go). Its range from up high is 16 m.
- **Rope up** (new): rope the lip of something you can stand on (the watchtower lookout's parapet, the mesa's rim snags): you
  **climb the rope** up its face, hand over hand, and mantle over onto the top.
- **Pull stones** (new): rope the top of a broken stretch of stone wall too high to vault and yank: its top course comes down
  toward you (stones tumble, whoever stands under them is hurt) and the breach is now low enough to vault through
  (`walls3d.js` profile `pulls`, the run rebuilt once, `world.pullWall`).

## 5b. The art (live-only clips, `tools/blender/western.py` section "brawl")

The cowboys (gunslinger, outlaw): `mv_kick` (front push-kick, marks hit / plant), `mv_barge` (shoulder charge, hit),
`mv_lift` (stoop and lift, grab), `mv_carry` (the hold), `mv_carry_walk` / `mv_carry_run` (the gait's legs with the carry's
arms), `mv_throw` (a two-handed heave, release), `mv_zip` (hanging from a line by both hands).
The gunmen (bandit, sheriff, bruiser): `fx_pickup` (stoop and pick up with the right hand, grab), `fx_hat_on` (the hat back
on, on), `fx_stagger` (the leg shot, back), `fx_sting` (the hand stung, back), `fx_limp` (a limping walk).
Each move works without its clip (an atlas stand-in: `lunge`, `crouch`, `reach_up`, `hit_f`), so code and art land apart.

## 6. Built (2026-10-08, uncommitted)

All four are on by default for a live loadout: the gunslinger, or the outlaw with `?live=1`. The Ranger (a sprite) is unchanged.
The lasso traversal needs the lasso in the gadget slot: `?equip=lasso` or `?equip=1`.

### How to try it

| what | where | keys |
|---|---|---|
| kick, barge, throw a gunman | `?mode=sandbox&set=gunslinger&biome=desert&foes=unarmed` (gunmen who never draw) | V next to one; V while sprinting (Shift) into a line of them |
| kick a barrel into a keg | `?mode=sandbox&set=gunslinger` (the barrels on the mesa east of the yard) | V |
| lift and throw | anywhere with crates and barrels | E to lift, LMB to throw at the cursor, E to set it down, Space to drop it and roll |
| called shots | `?mode=sandbox&set=gunslinger&biome=desert` | draw (LMB), put the cursor on his hat (the crown over his head), his gun hand or his legs; a label says HAT / GUN / LEG |
| zip line | `?mode=sandbox&set=gunslinger&equip=lasso`, climb the West Downs watchtower's ladder | hold F, aim at an oak limb below, let go |
| rope up | the same, at the tower's east foot | hold F, aim at the lookout's low parapet, let go: he climbs |
| pull stones | a broken stretch of the arena's walls too high to vault (1.25-2.35 m) | throw the loop at its top, then tap F |

### What each does (as built)

- **The boot** (`sim/player/brawl.js`, `features/brawl.js`): 0.44 s, its blow at 0.17 s (`mv_kick`'s hit mark). It meets ONE
  thing, the nearest in a 100° arc within 1.45 m, snapped from the cursor's ground point. A bandit flies about 3 m, then
  slides to about 5 m in all (the sheriff ×0.74, the bruiser ×0.59). He has a 55% chance to lose his hat, and a 35% chance to
  lose his gun if it was out. A barrel rolls at 7.2 m/s, a crate slides at 5.4 m/s, a powder keg goes off when it hits
  something hard. Brutes fly too; a champion only staggers (0.5 s).
- **The barge**: 0.38 s at 7.6 m/s out of a sprint (over 5.2 m/s). Its blow goes out every step from 0.02 s, and each body is
  hit once. It throws them along his run, and a thrown body knocks down whoever it flies into. A wall stops him after three
  blocked steps, with a bump back.
- **Thrown bodies** (`sim/bodyfly.js`, used by `foes/sim.js` launch and `combat/core.js` launch):
  - a ball at mid-body under gravity of 22, stopped by what's solid from its underside up, so it passes over a low breach;
  - a wall slam does 4 + 3 per m/s over 2.6 m/s, at most 18;
  - falling more than 2.2 m does 14 per metre over that;
  - water: it lies 1.6 s, then climbs out on its own side, and a gunman's powder is wet for 4 s (no shot);
  - the desert's canyon: gone.

  A kicked gunman is drawn as a **ragdoll pinned to the sim's body** (`foes/look.js` THROWN). His hat stays on his head and his
  gun in his hand unless the sim knocked them loose. He gets up with the knock-down's frames. If a slam kills him, that ragdoll
  becomes his corpse.
- **Lift and throw**:
  - `combat/props.js` gained `carry`, `toss` and `put`. While held, the prop has no collider and no physics. It is placed at
    his hands each step, 0.56 m ahead, its base 0.56 m up; a barrel lies across his arms.
  - He moves at ×0.8, through a `brawl` modifier note on `player.speed`.
  - The throw is solved to land at the cursor (at most 11 m), arcing 0.2 × the distance (heavy) or 0.28 ×. In the air the prop
    keeps its height over the ground under it, feels no friction and flies past him for 0.35 s. On landing, the props' own code
    handles hard landings, impacts on bodies, a keg going off and a burning barrel's fire.
  - No x-ray outline of him through the load while he carries it (`rigmesh.noXray`).
- **Called shots** (`features/calls.js` reads where the shot's line passed him; `foes/sim.js` reacts):
  - **The hat zone** is over 1.64 m (the crown). His hitH grows by 0.13 m while he wears it, and the aim snaps onto the hat
    when the cursor is on it. The hat flies 2.8 m/s along the shot and 3.4 m/s up, and the shot goes on. He looks for it
    (0.3 s), walks to it, stoops (`fx_pickup`) and puts it back on (`fx_hat_on`). The sheriff does it 1.5× faster.
  - **The gun** must be within 0.15 m of his gun hand while it's out; the aim snaps onto it within 4 px. It costs him 2 hp.
    He shakes his hand (`fx_sting`, 0.43 s), runs for it, stoops and draws again. If he can't get it back, he backs off and
    pulls a spare after 7 s.
  - **The legs** (under 0.72 m) take ×0.7 damage. He staggers (`fx_stagger`, 0.57 s), then limps at ×0.55 for 4 s (`fx_limp`).
  - **Loose hats and guns** are sim objects (`foes/sim.js` loose: a pool of 12). They fly, bounce, and sink in water. They
    can be kicked, lifted and thrown; a thrown gun hurts a gunman (8 hp). They're drawn as the model's own piece in a rig slot
    (`view/loosepiece.js`) and hidden on his body (`view/livebody.js` `drop`). A corpse never gets back a hat or gun he'd already
    lost (`view/ragdoll.js` `drop`).
- **Lasso traversal** (`features/equip/lasso.js`, `sim/player/lasso.js`):
  - **Zip line**: an anchor more than 1.1 m under his hand and over 3 m away; from up high it reaches 16 m. He hitches the rope
    overhead (0.22 s) and slides down under gravity, with 0.08 g of friction and drag, at most 13 m/s. His feet skim the floor he
    leaves and hop its parapet. He lets go 0.6 m from the anchor, where his feet touch ground (he runs on), or on F / Space.
    Measured: the lookout to an oak limb is 15 m in about 3 s.
  - **Rope up**: a top to stand on within 1.6 m of the anchor and at least 1.8 m over him, with him within 4.5 m of its face's
    foot. He walks to the foot, climbs at 1.7 m/s and mantles over. The watchtower lookout's low parapet (≤ 1.6 m over its deck)
    is a new anchor. Measured: 4.5 m up the hill face onto the deck.
  - **Pull stones**: tap F with the loop on a broken top. The stretch drops 0.7 m (never under 0.8 m), over 1.2 m wide, and its
    stones fall on your side, doing 14 to whoever is within 1.4 m. `world.pullWall` rebuilds the run (`walls3d.js` `pulls`)
    with every random draw as before, so the rest of the wall stays stone for stone the same, and the tops follow
    (`topOfProp`, `vaultTop`). Measured: 1.48 → 0.8 m, now vaultable.
- **Sounds** come from the existing recipes (`audio/audio.js`):
  - a boot on a body is a body hit; on a prop, the prop kick;
  - a lift or a throw is the cloth swish;
  - a slam or a hard landing is the gunmen's fall thud;
  - a shot-off gun pings like the steel plate;
  - pulled stones are a stone drop plus a heavy stone hit.
- **Art**: 13 live-only clips (western.py section "brawl", by a subagent; backups in `tmp/brawl/backup`). The gunmen's models
  in `concepts/sprites/out/pivot3d_chars/<type>/` now carry a `live` list: a re-export must pass `--clips
  fx_pickup,fx_hat_on,fx_stagger,fx_sting,fx_limp`.

### Checked

- **golden**: the same tree with and without these changes (frozen mirrors `src-bw0` and `src-bw1`): all 16 captures identical.
- **smoke**: all checks pass.
- **simview**: pass. The first `run` hit the 60 s load timeout at 88% CPU; the re-run was identical.
- **gunmen simview** (`tmp/western/foes/simview_foes.mjs --only foes,foeskeys`): identical on both mirrors.
- **brawl's own sim traces** with views on and off are identical: the kick (direct input), the called shots, and lift and throw.
- **owncheck**: no foreign writes, no unlisted fields. The new prop fields `held`, `r0h`, `wasUp` and `tossT` are combat's in
  `OWNERS`.
- **Perf A/B** (`ab.mjs`, desert, gunslinger, a busy machine):
  - brawl.update 0.001 ms, brawl.hd 0.006 ms;
  - calls.hd 0.031 ms, now only while his gun is out;
  - the whole frame is within noise (slices ×0.52 to ×1.22).
- **Probes** in the session scratchpad (`brawl/probe.mjs`): cases kick_gunman, kick_barrel, kick_brute, barge, lift_throw,
  calls, vis, strip, fxstrip, zip, ropeup, pull.

### Open

- **V is now the boot.** The pistol whip stays on the empty click with a foe in reach; `?kick=0` gives V back to the whip.
- **Get-up pop**: going from the thrown ragdoll to the get-up frames pops when he came to rest in an odd pose (against a stone).
  A short cross-fade, or the live hero's get-up clips on the gunmen, would hide it.
- **Bottles and cans** exist only at the trick-shot range (its own props). Lifting covers crates, barrels, kegs and a
  gunman's dropped hat or gun.
- **Gunmen never stand on the mesa** (their nav keeps off the plateau), so "off the mesa" is the brutes' and the player's.
  Gunmen do go into the creek, over breaches and into walls.
- **Pulled walls stay pulled** until the biome is rebuilt (no restock), as a breach should.
- **Outlaw poncho**: in the carry and the throw his forearms come through the rigid poncho.
- **The bruiser's coach gun** isn't re-posed in the `fx_*` clips.
