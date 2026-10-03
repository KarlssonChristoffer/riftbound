# Experiment: the gunslinger's live gun moves

New gun animations for the gunslinger made with the live-hero method (docs/exp/livehero.md): written as bone rotations
in `tools/blender/western.py` (section "the gunslinger's live gun moves", at its end), exported as bone matrices with
`ragdoll_export.py --clips` (about 10 s, no atlas render, no pixelize) and drawn live by `view/livehero.js`. The sprite
atlas doesn't have them.

## The moves

Each is a routine from the ready idle back into the holster (the live demo player plays a clip only while he stands
still with the gun holstered). Marks name the frames a game would hook: `draw` (the hand closes on the grip),
`shot` / `shot2` / `shot3` (a round leaves), `hit` (the whip lands).

| clip | what he does | time |
|---|---|---|
| `quickdraw` | a hover over the grip, the draw, a shot from the hip at once, two shots fanned with the left palm, the twirl home | 1.6 s |
| `behind_back` | the gun hand swung behind the back, the muzzle out past the left hip, two shots to his LEFT, looking over his shoulder | 1.8 s |
| `over_shoulder` | the gun by the right ear, the barrel back over the shoulder, a glance back, a shot BEHIND him | 1.9 s |
| `under_arm` | the gun hand across the front, the barrel back under the left elbow (the left fist at the lapel), a no-look shot behind | 1.8 s |
| `duelist` | the formal duel: side-on, feet in line, the gun raised muzzle-up by the cheek, lowered at arm's length, the free hand on the small of the back, a shot, the salute | 3.0 s |
| `kneel` | down on the right knee, square, two-handed (the left hand under the gun hand), two shots, up | 2.3 s |
| `road_agent` | the road agent's spin: the gun offered butt-first off the trigger finger (the left palm up: easy now), rolled over into the hand, a shot | 2.4 s |
| `toss` | the revolver flipped up end over end (the head following it), caught, a shot | 1.7 s |
| `border_shift` | tossed across into the left hand, the stance turned the other way, a left-handed shot, tossed back | 1.9 s |
| `pistol_whip` | the gun raised high over the right shoulder, brought down across at a man's head height in a lunge, the follow-through low left | 1.6 s |
| `sky_shot` | a warning shot: the gun to the sky, the left fist on the hip, two shots | 2.1 s |
| `point_blank` | a step in, leaning over a foe on the ground, a shot down | 2.1 s |
| `turn_shot` | a target behind him: a spin on the spot over the right shoulder, drawing on the turn, a shot at the end of it, the twirl turning back | 1.8 s |

## In combat: the turn shot and the pistol whip

Two of the moves are wired into the gunslinger's gun play (2026-10-03). They have **combat versions rendered into his
sprite atlas** (`gun_turnshot`, `gun_whip`, in `outfits/gunslinger` with `pixel_rig.py --append`), because the sim picks
atlas frames and takes the muzzle from their bones. The live view draws the same frames (its model is exported from the
atlas). The showcase routines (`turn_shot`, `pistol_whip`) stay live demos.

- **Turn shot**: LMB with the gun holstered, standing still, the cursor more than `TUNE.turnBehind` (115 deg) round
  from his facing. He faces away from the target and the clip's frames, turned round by a `_post` on the hips, spin him
  onto it over the right shoulder, drawing on the turn. The shot leaves at the clip's `shot` mark, from that frame's
  muzzle, with the draw's bonus (`weapon.quick`) and the hip's spread. Then his facing turns round (the last frame is
  `gun_aim` at the opposite facing) and the ready gun takes over. It plays at the draw's speed (`draw` 1.6): the shot
  ~170 ms after the click. A target in front, or moving, still gets the ordinary quick draw.
- **Pistol whip**: **V**, or LMB on an empty cylinder with a foe in reach (`features/gun.js` cue `near`: a brute or a
  hunter within 1.7 m). He squares up to the cursor and winds up. At the clip's `hit` mark (~180 ms) the blow lunges him
  forward and emits `player.melee`. `features/gun.js` lands it on everything hittable within `melee.reach` (1.5 m) and
  `arc` (80 deg) in front, through combat's `damage()` (combat owns hp; `combat.hit` with `by: 'melee'`; crits as
  usual). Damage: `content/weapons.js` `melee` (Peacemaker 22, Brass Navy 28; a note on `weapon.melee` scales it). From
  the holster, V draws first. V is a dev key (the banded A/B): while the whip is to hand the gun feature claims it.
- Only an atlas that has the clips gets them (`has('gun_turnshot.0')` / `has('gun_whip.0')`): the gunslinger. The outlaw
  keeps his old behaviour.

Files: `sim/player/gun.js` (acts `turn` / `whip`, `melee()`, `setCues(calm, duel, near)`), `features/gun.js` (V, the
`near` cue, the blow landed), `content/weapons.js` (`melee`), `core/events.js` (`player.melee`; `combat.hit` by
`melee`), `tools/blender/western.py` (the two clips).
Checked: headless in the desert sandbox, sprite and live alike (`tmp/live-guns/combat.mjs`). The turn shot hits a brute
5 m behind him (60 -> 45 hp) and leaves him facing it with the gun up. V and the empty click land the whip (60 -> 38).
Golden 16/16 identical vs ref4, smoke passes, simview passes, and the desert gun / foes simview passes (views vs none,
30 / 60 / 240 fps). GIFs: `tmp/live-guns/combat_turn.gif`, `combat_whip.gif`.
Found while testing: a draw from the holster with an EMPTY cylinder fired the gunslinger's hip shot (the ammo went to
-1). Fixed by the western session on branch `western` (startDraw's hip shot needs a round). The turn shot starts only
with a round in and checks again at its shot.

Re-rendering the two clips (from the repo root; then the live model's export below):
```
D:\Blender\blender.exe -b --factory-startup --python tools/blender/pixel_rig.py -- --model tools/blender/loadouts/gunslinger.py \
  --out concepts/sprites/out/outfits/gunslinger --w 96 --h 80 --pivot 48,78 --dirs 16 --upp 0.0327883818891779 \
  --clips gun_turnshot,gun_whip --append 1
python concepts/sprites/pixelize.py concepts/sprites/out/outfits/gunslinger body      (new frames only)
python tools/pack_atlas.py concepts/sprites/out/outfits/gunslinger
```

## Trying them

`?mode=sandbox&biome=desert&set=gunslinger&live=1`, stand still, **Shift+9** cycles the live demos (after `lasso`,
`swing`) through these. Caveat: the live gunslinger has **no duster skirt** in the game yet (it is runtime cloth on the
sprite path, not in the live mesh: docs/exp/livehero.md, plan step 2), only the shoulder cape. On every `shot*` mark the
demo player fires a muzzle flash at the drawn muzzle along the barrel and the revolver's sound (view only: no event, no
bullet; `view/livehero.js`); a `hit*` mark (the pistol whip) plays the body-hit sound.

## The kit (western.py)

- `LIVE_AT[key] = [(side, bone | None, (x, y, z))]`: that wrist onto a point by two-bone IK after the spec (the spec's
  elbow decides the bend), the point carried by a bone (a rest-space point: the hips, the chest) or in his frame (he faces
  -Y, +X is his left, metres for a 1.8 m figure, before the ground snap: hips at .76).
- `LIVE_GUN[key] = {...}`: the revolver held another way than along the forearm: `dir` (the barrel's direction in his
  frame), `up` (its top), `spin` (deg about the trigger finger), `follow` (keep the forearm's pitch), `hand: 'Left'`,
  `air: (x, y, z)` (free in the air: the toss).
- `LIVE_LEFT[key] = (F, U, S)`: the left wrist on the gun as LIVE_GUN holds it (LEFT_TO_GUN's offsets from the hammer).
- `_routine(steps)`: a clip as `(key, ms[, mark])` steps and `('~', f, ms[, mark])` in-betweens (blends of the finished
  keys, `_clip`'s). `_turned(key, deg)`: a whole pose turned about the hips (`_post`), for the spin.
- One HOLD hook (`_live_gun`, appended last by a `build()` wrapper) applies the three tables; keys outside them are left
  as before. Checked: the outlaw's 401 poses (its emotes included) and the gunslinger's 345 earlier-exported poses
  come out bit-identical.

Export (from the repo root):
```
D:\Blender\blender.exe -b --factory-startup --python tools/blender/ragdoll_export.py -- \
  --model tools/blender/loadouts/gunslinger.py --out D:/Game/concepts/sprites/out/live/gunslinger \
  --atlas D:/Game/concepts/sprites/out/outfits/gunslinger --clips quickdraw,behind_back,over_shoulder,under_arm,duelist,kneel,road_agent,toss,border_shift,pistol_whip,sky_shot,point_blank,turn_shot
```

Review tools in `D:/Game/tmp/live-guns/` (headless, ports 8236 / 9436): `export_coat.py` (a PREVIEW model with the
baked duster split into two rigid pieces, so the sheets show his coat), `sheet.mjs` + `sheet.py` / `keys.py` / `reel.py`
(frames drawn live through the lineup at chosen facings, sheets, GIFs at the game's timing, a muzzle-flash marker on shot
frames), `probe.py` (barrel heading / pitch, muzzle and wrist positions per frame), `ingame.mjs` (the real page playing a
move through the demo player). `reel.gif`: all thirteen at once.

## The existing gun animations, drawn live

- `gun_aim` / `gun_fire`: arm locked straight at shoulder height, the stance bladed 25 deg, the barrel levelled
  with the forearm; the kick flips the muzzle up 26 deg and settles over three frames. Reads well from every side.
- `gun_draw`: grab, the gun out muzzle-down, levelled at the hip, then up to the full aim over three in-betweens. Fine.
- `gun_hipfire` ("the hip shot leaning back"): the gun is at chest height (muzzle at 1.17 m), not at the hip, and
  side-on the backward lean over bent knees with the left arm flung back reads as a stumble. Worth redoing (it is an
  atlas pose: a change means a re-render of the gunslinger's atlas).
- The live moves above that fire from the hip (quickdraw) and the fan put the gun at the belt, about 0.9-1.0 m.

## Next

- The duster on live bones (the live-hero plan's step 2) before the gunslinger is shown live by default.
- Gameplay: the sim (`sim/player/gun.js`) picks atlas frames and aims by the atlas's bones; to use these moves it needs
  their timing and marks from the live model (the bullet leaves at `shot`, from the live muzzle). Candidates: the
  quickdraw as the first shot of a draw, turn_shot / over_shoulder / under_arm for a target behind him, pistol_whip as
  a melee, point_blank on a downed foe, kneel as a steady aimed stance.
