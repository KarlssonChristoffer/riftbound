# Experiment: the trick-shot range

Branch `exp/trickshot`. A place in the sandbox to play with the guns and tune how they feel: bottles on a fence rail, tin
cans to knock off a crate or toss up and keep in the air with shots, a steel plate that rings and swings, ricochets off
stone and iron, a score panel with a run against the clock, and a dev panel of live gun-feel sliders. Off by default;
with it off nothing changes anywhere (golden 16/16 identical, smoke and simview pass).

Code: `src/features/trickshot.js` (the feature), `src/features/trickshot/sim.js` (what is true: props, cans' flight,
bottles, counts, the clock, records), `src/features/trickshot/view.js` (meshes, glass, spin, the plate's swing, the HUD),
`src/features/trickshot/models.js` (the 3D models, kit3d), `src/content/materials.js` (what each prop kind is made of),
ricochets in `src/sim/projectiles.js`, the gun-feel panel in `src/dev/gunfeel.js`.

## Turning it on

- URL: `?trick=1` (`?trick=0` forces it off), e.g. `http://localhost:8123/src-xtrk/?mode=sandbox&trick=1&set=gunslinger`.
- Pause menu > **Game** tab (the sandbox): *Open the trick-shot range*; once open: *go to the mark*, *set it up again*,
  *Close the trick-shot range*.
- Pause menu > Dev > Features > **Trick-shot range (experiment)** (with the setting *Aim assist (cans)* under it). The on /
  off is remembered (`riftbound3d.trickshot`); the URL overrides it.
- It stands in the **sandbox only** (every biome: the desert's fort has the same walls). A run, the title: it is not there.

## Where and what

The Proving Grounds' north-west corner, along the north wall and north of the bow's lane (~12 m from the spawn; *go to the
mark* takes you there). A dotted line on the ground 4.5 m south of the fence is the **mark**.

| piece | what it does |
|---|---|
| **bottles** | six on the fence rail, amber and green. A bullet or an arrow breaks one (glass flies along the shot and lies a while; the shot flies on through: projectiles' new `'pass'`), so does a blast or the pistol whip. A small hit-stop and shake. They are set up again 2.5 s after the last one breaks, with **E at the fence**, or from the menu |
| **cans** | three stacked on a crate (shoot them off) and three to toss: **1** (a gun loadout, at the range) or **E at the crate** throws one up in front of you, toward the cursor. A hit kicks it up and a little away along the shot; a hit off its middle pushes it sideways, a hit low on it lifts it more. The **juggle** counts a can's airborne hits in a row ("x3" over it, "Juggle x5" where it lands). Cans bounce, roll, land on the crate or the rail and bounce off walls; a tossed can goes back in the crate after lying 12 s. A bullet stops in a can, an arrow flies on |
| **aim assist** | with a gun, the cursor within 9 art px of a can in the air aims where the can will be when the bullet gets there (the sim steps the bullet in 2.7 m steps). The revolver can't shoot steeper than ~22 deg (gun.js caps a shot's slope at .4), so a can is shot on its way down, a few metres out: toss it sideways or away, not straight up |
| **steel plate** | hangs from a frame west of the fence: the cursor aims at it like a dummy; a hit rings it (a deeper clank) and swings it on its chains |
| **ricochets** | while the range stands (in the whole sandbox), a bullet meeting a metal or stone solid at a shallow angle glances off: walls, towers, pillars, braziers, the plate's edge. Sparks thrown on along its new way, a streak into the face, a scar, a whine. See *Ricochets* below |
| **score** | the panel (top right, while you're within ~18 m): the fence (bottles up, the clock), shots / hits / accuracy, ricochets, the juggle and its best, the fence's best time. **The clock:** stand on the mark with every bottle up; your first shot starts it, the last bottle stops it ("Fence cleared 3.42 s", a banner, the loot chime); walking off the range drops it. Bests are remembered on this machine (`riftbound3d.trickshot.v1`: best juggle, best clear, clears) |

Works with the gunslinger (drawn live), the outlaw and the Ranger (arrows break bottles, knock and juggle cans; no aim
assist: the lead is a bullet's).

## Keys

| key | |
|---|---|
| **1** | toss a can (a gun loadout, at the range: a gun has no abilities on 1-4) |
| **E** | at the crate: toss a can; at the fence: set the bottles up (and restack the cans) |
| **F8** | the gun-feel panel (dev mode) |

## Ricochets

`sim/projectiles.js` (RICO): off unless the modifiers' note `proj.ricochet` > 0. The range sets it (`host.mods` source
`trickshot`) while it stands; `?rico=1` turns them on everywhere, `?rico=0` never (not even at the range). With none, a
bullet stops as before (the run is unchanged).

- What: a solid whose kind is `metal` or `stone` in `content/materials.js` (a desert wall is adobe: it stops the bullet).
- When: the angle between its way and the face is under `RICO.metal` 24 deg / `RICO.stone` 14 deg; the chance falls from 1
  (flat on) to 0 there (1 - (angle / limit)^2), drawn from projectiles' own generator (a fixed seed: the sim replays).
- How: its way along the face is kept, `keep` .3 of its way into the face is turned back out, a random turn of up to
  `scatter` 3 deg; x `speed` .7 its speed, x `dmg` .55 its damage share (`penK`: combat multiplies its hits by it); at most
  `max` 2 a bullet. The face: a box's side (the one its path crossed last) or top, a round solid's side (where its path meets
  the circle). It goes on from the point it struck (its tracer starts again there).
- `bullet.ricochet {x, y, h, x0, y0, h0, dx, dy, dh, mat, gun, n, who}`: gunfx draws the streak into the face, sparks along
  the new way (chips off stone) and a scar; audio plays the bullet recipe's ricochet whine over the hit.

## Gun feel (dev/gunfeel.js, F8)

A dev panel (dev mode only, like the cheat panel; left side) of live sliders, each a **modifier note** under the source
`gunfeel` (a x on the owner's own number; the owner applies it; nothing is overwritten). Double-click a slider: x1; *Reset
all*: no notes. Remembered on this machine (`rb.gunfeel`).

| slider | note | read by |
|---|---|---|
| Spread | `weapon.spread` | sim/player/gun.js (existing) |
| Fan spread | `weapon.fanSpread` | sim/player/gun.js (existing) |
| Shot gap | `weapon.gap` | sim/player/gun.js (existing) |
| Recoil push | `weapon.kick` | sim/player/gun.js (new: x the weapon's `kick`) |
| Camera kick | `flow.gunKick` | features/flow.js (new: x the shot's and a body hit's kick) |
| Hit-stop | `combat.hsShot`, `hsShotCrit`, `hsShotKill` | features/combat/core.js (new: added to `MOD_T`) |
| Hit shake | `combat.shakeShot` | features/combat/core.js (new: added to `MOD_T`) |
| Muzzle flash | `gunfx.flash` | features/gunfx.js (new: x the flash's size and light) |

## Sounds

On banks the forge already bakes (no recipe of its own: none to bake, none in the shared output), added to the director by
`src/audio/audio.js` (`TRICK_EVENTS`, like the waterfall; `audio/runtime/events.js` is not written), short and damped as the
user likes them: a bottle = the ice recipe's *shatter* (snap, fragments) over a bullet stone chip pitched up; a can hit =
the bullet recipe's metal clank pitched up thin; a can's bounce a small one; the plate = the metal clank a little deeper; a
ricochet = the bullet recipe's whine over the hit; a toss = the cloth swish; set up = a wooden knock; cleared = the loot
chime. Each has a legacy-synth fallback while the forge bakes. A bottle or can hit through `arrow.hit` no longer plays the
generic wooden hit.

## Tuning knobs

`TUNE` in `features/trickshot/sim.js`: `at` (the anchor), `near` (the range's radius), `markR`, `tossCans`, `g`, `toss`
(up, forward, hand height), `pop` (per cause: up, along; keep, english, under, max), `bounce` / `friction` / `roll` /
`wall`, `aimPx` (the assist), `autoReset`, `stray`, `hitstop`, `shake`. `SHAPE` in `models.js` (sizes, positions).
`TUNE` in `view.js` (shards, spin, the plate's swing, the floats, the banner). `RICO` in `sim/projectiles.js`.

## How it plugs in (files touched)

New: `features/trickshot.js`, `features/trickshot/{sim,view,models}.js`, `content/materials.js`, `dev/gunfeel.js`, this doc.

Small additive changes in other areas' files:

- `sim/projectiles.js`: ricochets (RICO, `solidAt` returns the solid, `ricochet()`, `bullet.ricochet`), a hit chain's
  `'pass'` (glass: on unchanged), reads `?rico`.
- `features/gunfx.js`: its material table moved to `content/materials.js` (unchanged; `matOf`), the ricochet's look,
  reads `gunfx.flash`.
- `audio/audio.js`: `TRICK_EVENTS` merged into the director's events, the trick events' and `bullet.ricochet`'s cases,
  fallbacks, `trick_plate` in `PROP_MAT`, `arrow.hit` on a bottle / can skipped.
- `sim/player/gun.js` (`weapon.kick`), `features/flow.js` (`flow.gunKick`), `features/combat/core.js` (`MOD_T` + 4).
- `main.js`: the boot adds `dev/gunfeel.js` after the cheat panel (2 lines).
- `core/flags.js` (`trick`, `rico`), `core/events.js` (`bullet.ricochet`, `trick.*`), `core/features.js` (LOAD_ORDER:
  `trickshot` before `combat`, so the order of the others is unchanged).
- Not touched: world/*, kit3d.js (used, not changed), grass, gfx.js. `ui/pause.js` isn't either: the range's toggle lands
  in Dev > Features; with the peer's DEV_GROUP (uncommitted on main) add `trickshot: 'Experiments'` and `gunfeel: 'Other'`.

Rules kept: the range's props go through `host.entities` (add / remove / hide; the scatter under them hidden and put back);
sim decisions on the feature's own generator (a fixed seed), never Math.random; the view writes only its own state; the fence,
crate, plate frame and bottles are static casters (sScene layers 1 + 2: `world.mesh {static}`), the cans move (layer 0);
`?owncheck=1`: 0 violations, 0 added fields over a session (bottles, plate, toss, juggle, stack, a blast, off / on, a biome
switch).

## Checks (2026-10-04, mirror `src-xtrk/` against `src-xtrk0/` = b65b9c5)

- golden: 16/16 identical (flag off).
- smoke: all passed.
- simview: identical (views, 30 / 240 fps); a scratch copy with `?trick=1` on every scenario plus a `trick` scenario
  (bottles from the mark, the plate, a toss juggled 5 times on the assist, the stack, ricochets, E at the crate):
  identical with and without views (`tmp/xtrk/simview_trick.mjs`).
- owncheck (`?owncheck=1`, a session at the range): 0 violations, 0 added fields.
- perf (`tools/perf/ab.mjs`, 3440 x 1440, a busy machine; B = this branch): standing on the mark with the range on,
  four runs gave B vs A +8.4 / +11.3 / -4.1 % and +5.0 % (the switch alone, same code): within the machine's noise; what
  is constant is +9 draws (147 vs 138) and G.render +0.03-0.06 ms; heap per frame level (70.8 vs 73.2 KB) after the HUD
  panel became a cached canvas (it was .07 ms a frame drawn as text) and the bottles one mesh. Flag off at the spawn: +2.0 %
  (noise), the same draws, uniforms and heap.
- Shots: `D:/Game/tmp/xtrk/shots/` (range_1..8 stills, trickshot.gif).
