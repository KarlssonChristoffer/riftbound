# Thrown by the world: blasts throw the player (2026-10-08)

The user's ask: explosions, NPCs and the environment should move the character. A barrel going off next to him should
throw him through the air into the wall, where he ragdolls. This is the first step: **explosions**.

Decided with the user:
- **Explosions first.** That means combat's explode (barrels, the bow's blast arrow, dynamite) and a Volatile enemy's burst
  (`sim/hazards.js` style `blast`). Enemy blows, heavy shots and the environment come later on the same system.
- **A real knockdown.** No control while he flies. A wall slam hurts a little. He lies about 0.6 s and Space gets him up
  sooner. After he gets up he is safe for 0.5 s.
- **Live characters only.** Only a loadout drawn live (the gunslinger, plus the outlaw with `?live=1`) is thrown. The sprite
  loadouts keep the old short skid (`PL.knock`). `?launch=0` turns the throw off for every loadout.

## How it works

**The sim** (`src/sim/player/launch.js`, hooked into `player.js`): the body is a ball at his middle, starting 0.95 m over
his feet.
- **Flying** (`launch`): gravity is 22 m/s². The walls stop the ball the way they stop him: `H.blocked` at his feet's
  level, at any height. That covers walls, props and cliff faces.
- **The slam**: hitting a wall faster than 2.6 m/s hurts him (3 to 10 hp, `player.hurt` by `slam`). He bounces off weakly
  and slides down the wall's face. `player.slam` is emitted and combat adds a beat of hitstop and grit off the wall.
- **Landing**: a hard landing bounces once, then the ball slides with friction until it rests. He is then `down`, or back
  on the bank if he landed in water, as a fall would put him.
- **Getting up**: `down` lasts 0.6 s (Space after 0.25 s), then `getup` takes 0.42 s, then 0.5 s of i-frames.

`throwOf(k)` turns how close he stood (k = 1 at the blast's heart, 0 at its edge) into a throw: out 4.5 to 9.5 m/s and
up 3.2 to 6.2 m/s. Below k = 0.3 (a graze) he gets the old skid. The callers turn "out" along the blast's direction and
call `host.launch`, which returns false when this loadout can't be thrown. A skid knock that arrives while he's thrown is
ignored.

**The view** (`src/view/herorag.js`, called from `livehero.js` compose before the cloth):
- **Start**: the pose last drawn goes into a ragdoll from `view/ragdoll.js`. The ragdoll lives in his rig but never draws
  itself.
- **Flight**: the ragdoll's pelvis is driven to the sim's ball (`R.drive`). It flies the sim's path while the limbs trail.
  At the start every point gets the throw's speed, and the legs get a bit more, so he goes over backwards.
- **Impact**: when the ball stops at a wall, the limbs carry on into it and the ragdoll's own wall collision stops them.
- **Down**: the pull goes soft and the body settles as it fell.
- **Getting up**: the drawn pose blends from the ragdoll's last pose to the animation over the sim's GETUP.
- **Drawing**: the rig's pitch follows how far down he is: upright at the sprite camera's 20°, lying at the world's angle,
  as the gunmen's corpses are drawn.
- **Hitstop**: during the blast's hitstop the pose last drawn is held, and the ragdoll starts when the sim moves him.
- **Clipping**: the hat stays on. The ragdoll's head therefore gets the brim's radius (0.2 m) against walls and the
  ground, and the lying body is drawn 3.5 cm up. Without both, parts sunk in the wall or ground showed the x-ray outline.

**Additions to `view/ragdoll.js`** (all additive):
- `drive(slot, x, h, z, k)`: pulls the pelvis block toward a target in every constraint pass. The target is eased over
  the step's substeps.
- `shove(slot, vx, vh, vz, legs)`: adds a velocity to every body point.
- `frames(slot, out)` and `boneFrame(bone)`: read the driving frames back.
- spawn takes two new options: `muscles` (scales how strongly the start pose is held) and `headR` (the head's radius).

**Events** (`core/events.js`): `player.launch`, `player.slam`, `player.floored`, `player.getup`. `player.hurt` gained the
`slam` cause. Audio plays the gunmen's body-fall thud on a slam and when he lands for good.

## Getting up (2026-10-08, the user: "more natural, using his hands; holding W should run him out of it smoothly")

**Two clips made for the live model only** (`tools/blender/western.py`, section "getting up", `GETUP_LIVE`; installed
with `node tools/blender/live_export.mjs all --add mv_getup_b,mv_getup_f`). Each has 6 keys and 11 frames.
- `mv_getup_b`, from his back: he lifts his head (that also keeps the hat off the ground), sits up on both hands planted
  behind him, turns over his right hip onto his left knee with his right hand on the ground, kneels with his hand on the
  knee, pushes up and stands.
- `mv_getup_f`, from his front: head up, a cobra push-up (the hips stay down), onto hands and knees, the right foot forward
  as the hands come off the ground, pushes up and stands.
- **Authoring lessons:**
  - Pose specs rotate about world axes. On a lying body (Hips X ±90) the arm helper's "lower" swings the arms into the
    ground and props him up, so the lying keys use the rest A-pose arms, which lie flat, with a small Z sweep.
  - A bend on a turned body has to be split into world X and Y parts.
  - `LIVE_AT` hand targets are in the frame before the ground snap. Aim them at where the snap will put the ground,
    measured from the exported pose.
  - A kneeling back foot needs its instep down (foot X +60), or its toes prop the knee up.

**The sim** (`launch.js`): lying 0.5 s, and Space or a held direction gets him up after 0.2 s. Getting up takes 0.8 s. A
held direction turns him toward it as he rises. From `RUN_AT` (55% of the way up, on a knee) he runs out of it in that
direction at 0.8× run speed, with the 0.5 s safe window. On a fresh throw the sim turns him to face the blast. Thrown off
it, he mostly lands with his feet toward it, so the get-up seldom needs a big turn, and he comes up facing the threat.

**The view** (`herorag.js`):
- **Which clip**: the get-up clip is picked by which way his front faces as he lies: the sky gives `_b`, the ground `_f`.
- **Heading**: the clip is turned so its first frame lies the way his body lies (the head's direction). It is played by
  the sim's progress, stepped at its frames like the other `mv_*` clips (smooth with the step knob off).
- **Blending**: it blends in from the ragdoll's last pose over the first 16% of the way up. From 25% to 95% he turns from
  how he lay to his facing.
- **Leaving it**, standing or running out, blends into the animation over 0.22 s. The blend happens in the world, so his
  facing can step during it.
- **Fallback**: a model without the clips falls back to the plain blend.

## Measured

All measured headless, with the gunslinger, in the sandbox:
- **North wall**: from 1.4 m south of the arena's north wall, a blast 1.6 m south of him threw him into the wall at
  5.9 m/s (7 damage). He slid down it, lay there and got up about 1.6 s after the blast.
- **Open ground**: a blast 1.5 m east threw him about 5 m. He tumbled head over heels, landed on his back and got up.
- **Cost**: idle (every frame) it is one copy of his pose, about 0.04 µs. While he's thrown, the ragdoll step plus the
  pose is about 0.03 ms a frame. Nothing is allocated per frame.
- **Tests**: smoke passes. Simview passes. One run flagged the merchant stall's props after the biome switch, the re-run
  was identical, and that code is not touched here.
- **Reel**: `tmp/launch_ragdoll.gif`.

## Open

- More sources on the same throw: champion and elite slams, the bruiser, heavy gunshots, rolling barrels, falls.
- Landing face down with his head away from the blast still turns him up to 180° while he rises. The duster's runtime
  cloth then swings out wide.
- The duster's runtime cloth on a tumbling body can flare flat. That is the same open item as the climb's chest-over.
- The sprite loadouts: the user chose to leave them on the skid for now.
