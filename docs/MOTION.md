# One motion library for every character

Status: plan, 2026-10-08, not started. The goal (the user's): animations, poses and mechanics made once, on one character,
and shared by every character after it. The first new character built this way is Ranger v2 (`docs/BACKLOG.md`); the
current Ranger is deprecated and isn't part of this.

Start it after the sessions working in these files now have landed (the lasso's live throws: `western.py`'s end, livehero's
LASSO; the tower climbing rework).

## Where it stands (measured 2026-10-08)

**Authoring is already shared.** Every loadout runs the same Blender scripts: `skeleton.py` (the bones, `PROP`, `POSES`,
`ANIMS`, `pose()`), `wardrobe.py`, `western.py`. All seven loadouts use the same proportions (1.80 m, 3.6 heads); none
overrides `PROP`. A pose is a list of bone turns, so writing one in `western.py` writes it for everyone.

**The export copies it into each character.** `ragdoll_export.py` writes every pose as every bone's WORLD transform into that
character's `model.json`. `live_export.mjs` re-exports one loadout from its atlas plus that model's own `live` list.

| model | poses | clips (live-only) | model.json | of it, poses |
|---|---|---|---|---|
| `live/gunslinger` | 991 | 87 (56) | 2357 KB | 86 % |
| `live/outlaw` | 637 | 64 (39) | 1332 KB | 86 % |
| `pivot3d_chars/bandit`, `sheriff` | 398 | 30 (5) | 741 KB each | 87 % |
| `pivot3d_chars/bruiser` | 371 | 26 (5) | 752 KB | 87 % |

The gunmen also have a second copy each in `ragdoll/<type>/` (their deaths). What that costs today:
- a new clip means a Blender re-export of every character that should have it;
- each model's `live` list must be remembered: a gunmen re-export without `--clips fx_pickup,fx_hat_on,fx_stagger,fx_sting,fx_limp`
  silently loses the brawl reactions;
- a live-only character can't be exported at all (`live_export.mjs` needs an atlas folder);
- what the hands hold is a naming convention (a key named `gun_*` puts the revolver in the hand, `_gun_hold`), so the game
  guesses it back from the pose (`gunNear` in livehero.js). The floating holstered revolver came from that seam.

**The same pose is the same pose.** Compared over every pose two models share, each standard bone's local turn
(parent⁻¹ × world):

| pair | shared poses | rotations identical | where they differ |
|---|---|---|---|
| gunslinger / outlaw | 605 | 100 % | nowhere |
| bandit / sheriff | 398 | 100 % | nowhere |
| gunslinger / bandit | 321 | 98.6 % | the left arm only, up to 8.4° (`gun_fan`: the left hand on a different revolver) |
| bandit / bruiser | 367 | 53.7 % | everywhere, up to 110° (the coach gun: the gun moves re-posed for two hands) |

The root's x and y are identical in every shared pose. Its height is not: the ground snap (`skeleton.py` `_snap`) puts the
lowest vertex of every mesh on the ground, garments included (a hat brim, spurs). Gunslinger vs outlaw: 546 of 605 poses
within 1 mm, 40 within 1 cm, 14 within 5 cm, and 5 roll frames 5 to 14 cm apart.

So what really belongs to one character is small:
1. the root height in poses where a garment is the lowest point;
2. what an item does to the hands (the left hand on the revolver's hammer, the coach gun's two-handed set);
3. garment bones (the gunslinger's `Duster0-3`, `HatHold0`, `GunHold0`, `CoilHold0`);
4. the look (segments, families) and signature moves (the outlaw's emotes, the gunslinger's trick moves).

**The game half mostly exists.** `livehero.js` and `livebody.js` already turn each pose into local turns on first use, blend
them and run FK. `rigkit.js` already poses its code-built models (brutes, the merchant) from per-bone local turns. Mechanics
are gated by `host.live` (the loadout has a live model; `main.js` LIVE_LOADOUTS), and `livehero.js` motion() plays a clip only
if the model has it (`CL[clip]`), else an atlas stand-in.

## The model

- **The motion library**: exported once from Blender, for any body on the standard skeleton.
  - Every pose as each bone's turn in its own rest frame (Blender's `matrix_basis`, a quaternion) and the root's offset
    before the ground snap.
  - Every clip's timing: frames, fps, loop, play, ms, marks; for locomotion, stride, advance and contacts.
  - It lives in one folder (e.g. `concepts/sprites/out/motion/`), versioned.
- **A body** (`model.json` + `model.bin`) keeps only what is its own: segments, its rest skeleton, families, its garment and
  item bones, the clips it may NOT play (if any). It names the library version it was checked against.
- **Item sets**: a clip states what the hands hold: `free`, `revolver`, `longgun`, `lasso`, `bow`. It's data, no longer
  inferred from the key's name.
  - A move that differs by item is one name with variants: `gun_fan` (revolver), `gun_fan@longgun` (the coach gun).
  - A body move (kick, lift, vault, get up, reactions) exists once.
  - Where the item sits in each pose (in the hand, holstered, slung, hidden) is exported per item set, from today's
    `HOLD_HOOKS`.
- **Capabilities in the game**: a body says what it can do (`live`, `hands`, `gun`, `lasso`, `bow`), and a mechanic asks
  for what it needs: brawl wants `live` + `hands`, the lasso's traversal `live` + `lasso`. This replaces LIVE_LOADOUTS and
  the per-feature loadout checks.
- **One FK in the game**: rigkit's poser, used by livehero, livebody, herorag and ragdoll; one pose cache per body and pose.
  Nothing per frame that isn't there today.

## Steps

| step | what | gate |
|---|---|---|
| 0. Measure | a compare tool (`tools/anim/compare.mjs`): every pose two models share, rotations and root, the tables above as a report | the report |
| 1. One manifest, export all | every clip in one list: its item set, who gets it (every human body, revolver holders, the long gun, lasso carriers). `live_export.mjs` exports every model from it: no per-model `live` lists, no `--clips` to remember; a live-only body without an atlas | re-exported models equal today's (poses and clips); golden identical |
| 2. Export the library | `ragdoll_export.py` writes turns + root offsets once; a body's json drops its poses; the game builds a body's poses from the library and its rest skeleton at load (rigkit FK), cached | a check tool: every model's every pose equals the old baked world transforms within 1e-5; golden identical; load time and memory before / after (bench) |
| 3. Ground per body | the root height from the body's own lowest point in that pose (its segments after FK, cached per pose) instead of the baked snap | the 5-14 cm roll frames compared in captures |
| 4. Item sets | the hands' state per clip as data; `HOLD_HOOKS` become item hooks; the long gun set and the left hand on the revolver become variants; livehero's holster logic reads the hand state instead of `gunNear` | the live holster cases (in-between blends, MOVE / JUMP / GETUP); golden |
| 5. Capabilities | `host.live` becomes body capabilities; brawl, lasso traversal, live reactions and the launch ragdoll ask for them; LIVE_LOADOUTS goes (every loadout with a live body is live) | smoke, simview (the sim unchanged), owncheck |
| 6. Ranger v2 on it | the acceptance test: a new body (wardrobe garments) and a bow item set, nothing else. The kick, barge, lift and throw, vaults, climbs, get-ups and reactions work on day one | he plays every body move without a clip of his own |

Each step lands on its own and leaves the game as it was (steps 1-4 change nothing on screen; step 5 nothing in the sim).

## What stays per character

- The look: garments, palette families, the runtime cloth chains (the duster).
- The sprite atlas, while a character still has one: atlases are rendered per character by `pixel_rig.py`, and this plan
  doesn't change that path.
- Signature moves: in the library like any clip, granted to the characters that have them.

## Risks and open questions

- **Bit-exactness.** The baked world transforms are Blender's, rounded to 5-6 decimals. FK at load from rounded turns can move
  a vertex by ~1e-5 m and flip a pixel at a band edge. If golden differs in step 2: look at the differing pixels and re-save
  ref4 only with the user's OK (or keep baked world poses as a cache that the library checks).
- **Other proportions** (a child, a giant, another build): none today. Turns transfer as they are; hand targets don't
  (`LIVE_AT` points are metres at 1.8 m). If it comes: hand targets solved at runtime (livehero's lasso demo has a two-bone IK)
  and scaled by the body's arm.
- **Code-built characters** (brutes, the merchant: `view/rigkit.js`) have their own skeletons: out of scope; sharing with them
  would need a bone map.
- **Load size**: the five models' JSON is about 6 MB today and 86 % of it is poses; the library should shrink that a lot.
  This is not measured yet: measure it in step 2.

## Files

- Blender: `tools/blender/skeleton.py` (POSES, ANIMS, `pose()`, `_snap`), `wardrobe.py`, `western.py` (the gun keys,
  LIVE_AT / LIVE_GUN / LIVE_LEFT, the live sections), `ragdoll_export.py`, `live_export.mjs`.
- Game: `view/livehero.js`, `view/livebody.js`, `view/rigkit.js`, `view/herorag.js`, `view/ragdoll.js`, `features/foes/look.js`,
  `main.js` (LIVE_LOADOUTS, `host.live`), and the mechanics that gate on it (`features/brawl.js`, the lasso, live reactions).
