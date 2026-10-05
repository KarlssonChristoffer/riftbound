# Experiment: bells and ricochet plates

Branch `exp/bells`. Shootable toys scattered round the Proving Grounds' sandbox: steel plates on posts that a bullet always
glances off, and brass bells on little gallows that ring and swing. Not a course: no levels, no stars, no score panel;
things to shoot at while you walk about, a few of them set up so one shot can chain. On by default in the sandbox (every
biome); never in a run or on the title.

Code: `src/features/bells.js` (the feature), `src/features/bells/sim.js` (what is true: placement, props, rings, chains),
`src/features/bells/view.js` (meshes, the swing and clapper, sparks, the floating text), `src/features/bells/models.js`
(the 3D models, kit3d), the deflectors in `src/sim/projectiles.js`, the bell's sound in `audio/forge/recipes/bell.js`.

## Turning it on and off

- On by default in the sandbox: `http://localhost:8123/src-xbel/?mode=sandbox&set=gunslinger`.
- An experiment: OFF by default. `?bells=1` turns it on, `?bells=0` forces it off (core/flags.js).
- Pause menu > Game > **Put up the bells and plates** (then **go to a nest** / **Take down the bells and plates**), or
  Dev > **Bells and ricochet plates (experiment)**: on is remembered (`riftbound3d.bells`); the URL overrides it.
- Pause menu > **Game** tab (the sandbox): *Bells and plates: go to a nest (3)* takes you to a nest's standing spot (the next
  one each time).

## What is there

| piece | what it does |
|---|---|
| **plates** | dark steel plates (.54 x .48 m, a bright worn edge, a scuffed middle) on wooden posts, their middles at chest height (1.25 m: the height a shot flies at). A bullet or an arrow that hits one **always** glances off it as a mirror (angle in = angle out, no scatter), with sparks, a streak, a scar, a ping and the ricochet's whine. A free plate faces south (the default camera) give or take 70 deg and leans up to 7 deg; a nest's plates stand straight |
| **bells** | brass bells (7 sizes: the low notes are bigger) hanging from a gallows' arm, each tuned to a note of a C major pentatonic scale (G4 A4 C5 D5 E5 G5 A5). A bullet or an arrow rings one and glances off its curved face (mirrored about the normal where it struck), so one shot can ring several. An explosion's shock (within 1.7 x its radius), the pistol whip and a tossed can (the trick-shot range's) ring them too. A rung bell swings along the blow (a damped pendulum) and its clapper, lagging inside, strikes it again a time or two (softer, darker) |
| **nests** | stands placed together on purpose. From the **worn crescent** on the ground 5-7.5 m south of a nest's first plate (south: the shot goes up the screen and the plate shows you its face), a shot at the plate glances into a bell (**bank**), off a second plate into a bell (**zigzag**), or into a bell and on to its neighbour hanging beside it (**double**: a bell's curve doubles any error, so it takes a careful shot: in the probes, standing on the crescent with the gunslinger drawn, every shot rang the plate and nearly every one the first bell, and 1-3 in 8 rang both) |
| **chains** | one shot off two or more plates / bells: a floating line where it ended, e.g. "2 bells, one bullet", "Bank shot", "3 ricochets", "3 bells, one blast", and the session's best (glances in one shot; not stored) |
| **aim** | the cursor over a plate or a bell aims at it (adapter's hover chain): a plate's middle, or the point on a bell under the cursor (where you strike it sets where the shot glances to). A shot at open ground would slope down under a plate |

Ten plates and eight bells are placed when they fit (they do on today's map in every biome). Nests: zigzag, double and
bank in the ruins, ember and frost; double and bank in the rift and the desert (the frontier's buildings take room; a
zigzag needs the most). Placing them takes ~2 ms in the ruins, ~14 ms in the desert (once, as the sandbox or a biome
comes up). Schematic maps of where they landed: `tmp/xbel/layout_<biome>.png`.

## Where: placed at runtime

Nothing assumes today's map (it is being reworked: the plateau becoming a mesa, the world growing east). The layout is
found when the sandbox stands, from the biome's name as a seed (mulberry32 of `bells:<biome>`: the same layout every load
of a biome) and placed again on a biome change. A stand's spot must be:

- walkable (`world.js walkable`), dry (`inStream`, the layout's `inRill` / `inOutflow`), not a slope's face (`steep`),
  level: the ground within .12 m on a ring round it;
- clear of solid props by 1.05 m (soft scatter .45 m: `host.entities.near`, never a scan), of the layout's marks (the ring,
  the bow's lane and rail, the light garden's pad, the paths, the mark), the spawn (3.8 m), the trick-shot range's box
  (its anchor `trickshot/sim.js TUNE.at`), the climbs, the terrain's ramps (`layout.js TERRAIN`), 3.2 m from other stands
  and 1.1 m from a nest's shot lines;
- a nest's lines (the standing spot to the plate, plate to plate / bell, bell to bell) clear of solids and higher ground;
  its bells hung at the plate's height (their ground within .3 m).

A stand that would come up under the player waits until he steps off its spot.

## The deflectors (sim/projectiles.js)

Independent of the trick-shot range's ricochets (no `proj.ricochet` note). A feature registers a prop's shape with
`setDeflector(p, shape)` (null takes it out): a plate (`{kind: 'plate', x, y, h, normal, face axes, hw, hh}`) or a bell
(`{kind: 'bell', x, y, h, r}`: a sphere, .8 x the bell's radius: its waist). With none registered nothing changes (one
`Map.size` test a sub-step).

- Bullets: each 0.3 m sub-step's segment is tested against the deflectors among `near()`'s candidates exactly, before the
  hit chain and the solids. Arrows: each step's segment.
- At the hit: mirrored about the normal there (a plate's face it came in on; the sphere's normal), 2 cm off the face, the
  rest of the step lost (as a ricochet). Bullet: x .92 speed and x .9 damage (`penK`) off a plate, x .86 / .85 off a bell;
  arrow x .6 speed. At most `DEFLECT.max` = 6 a shot; the 7th stops it.
- Events: a bullet's glance is `bullet.ricochet` with `defl: 'plate' | 'bell'` and `shot` (the bullet), so gunfx's sparks,
  streak and scar and the whine come for free; an arrow's is the new `arrow.deflect`. No random draw: deterministic.

## Sound

- A bell: the forge's new recipe `bell` (`audio/forge/recipes/bell.js`, 7 cases g4..a5, 2 variants each, ~0.7-1 s,
  ~2.5 MB baked): a tuned handbell's partials (1, 2, 2.4, 3, 4.2, 5.4, 6.8; shimmer twins on the lowest three), t60 .62-.8 s
  falling 1.5x per partial, a short half-sine strike and a faint dull tick, -9 dB above 3.5 kHz: short and warm. Measured
  over 36 seeds a case (criteria in the recipe): centroid at the note, energy above 4 kHz -43 to -88 dB. No pitch jitter
  (tuned). The clapper's tolls: the same note 9-13 dB under, low-passed at 2.6 kHz. Baked at priority 6 (after the rest).
  Until it bakes (or with `?forge=0`) audio.js plays a small synth fallback of the same notes. NOTE for the mirror
  `D:/Game/src-xbel/`: the recipe lives in `audio/` (outside `src/`), which the page loads from `D:/Game/audio/`; until
  the branch is merged (or `bell.js` is copied there) the bake fails quietly and the bells ring on the synth fallback.
  The probes served the worktree's `audio/` (tmp's server) and heard the baked bells: banks baked, `bellsRing` posted, no
  fallback.
- A plate: the trick-shot plate's ding (the bullet recipe's metal, 2 semitones down). A glance: the ricochet bank's whine
  (5 dB softer off a bell). An arrow's glance: the arrow's ricochet stick.

## Events (core/events.js)

`bells.ring {x, y, h, k, note, who, by, dx, dy}`, `bells.ping {x, y, h, k, who, by}`, `bells.chain {x, y, h, bells,
plates, n, by, best, rec}` (the sim's), `bells.toll {x, y, h, k, note, who}` (the view's: nothing in the sim listens),
`arrow.deflect` (projectiles); `bullet.ricochet` gained `defl` and `shot`.

## Tunables

- `features/bells/sim.js TUNE`: counts (`plates` 10, `bells` 8), `notes`, `tilt` / `face` of free plates, `flat`, the
  clearances (`gap`: props, gateposts, the spawn, marks, the ring, the lane, paths, ramps, posts), the trick-shot range's
  box (`range`), the nests (`kinds`, `shoot` 5-7.5 m, `south` +-60 deg, `leg` 2.4-3.6 m, `muzzle`, `pair`, `past`,
  `open` 70-135 deg, `glance` .5 x r, `glance2` .76 x r for a double), `tries`, how hard each thing rings (`k`), `blastR`.
- `features/bells/models.js SHAPE`: the plate's size and height, the bells' radii (by note), strap, arm, height.
- `features/bells/view.js TUNE`: the swing (`kick`, `damp`, `max`), the clapper (`len`, `lim`, `e`, `min`, `gap`), sparks,
  floats, the nests' marks.
- `sim/projectiles.js DEFLECT`: speed / damage kept per glance, the arrow's, `max`.

## Files touched

New: `src/features/bells.js`, `src/features/bells/{sim,view,models}.js`, `audio/forge/recipes/bell.js`, this doc.
Shared, small and additive:

- `src/sim/projectiles.js`: the deflector table (`DEFLECT`, `setDeflector`), the exact segment test before the hit chain
  in a bullet's sub-step and an arrow's step, the glance (header updated).
- `src/core/events.js`: `arrow.deflect`, `bells.*`; `bullet.ricochet`'s line.
- `src/core/flags.js`: `bells`. `src/core/features.js`: `'bells'` in `LOAD_ORDER` (after the trick-shot range).
- `src/core/rng.js`: `nameHash` exported (the layout's seed from the biome's name).
- `src/audio/audio.js`: `BELL_EVENTS` for the director (like `TRICK_EVENTS`), their synth fallbacks, the event cases;
  `bullet.ricochet` with `defl` plays the whine alone; `bells_bell` in its material table.
- `audio/forge/recipes/index.js`: `'bell'` in `RECIPES` (the forge CLI / lab).

## Checks (2026-10-05, the mirror `D:/Game/src-xbel/` against `src-xbel0/` = ddb9f02)

Run from D:/Game on copies of the tools moved to this session's own ports (HTTP 8246, Chrome 9451; `tmp/xbel/tools/`):
the shared test lock was held for over an hour by a stuck run in another session, and the machine was short of memory.
The smoke copy keeps the committed climb step (D:/Game's working copy of smoke.mjs already expects the plateau rework's
`CLIMBS`, which ddb9f02 doesn't have).

- `smoke`: all checks passed.
- `simview`: identical (sandbox, run, keys at 60 / 240 / 30 fps): the deflections, rings and chains are sim and deterministic.
- `golden` vs the clean baseline: the 2 run captures identical; the 14 sandbox captures differ, as they must: their state
  digests differ only by the 26 new props (10 plates, 8 gallows posts, 8 bells: every other prop, the player, arrows and
  hits identical), and their pixels by 0-1.1% where the stands and their shadows stand (`tmp/xbel/golden_diff_*.png`;
  `day/zoom2` has none in view: pixel-identical). With the feature's default flipped off (a scratch edit of the mirror,
  = `?bells=0`): **16/16 identical**.
- `tools/perf/ab.mjs --a src-xbel0/ --b src-xbel/ --q mode=sandbox` (3440 x 1440, 14 alternating slices, a busy machine):
  2.11 -> 2.06 ms a frame median (-2%: noise), draws 118.4 -> 120.4, `G.render` .743 -> .757 ms, heap 77.4 -> 77.4
  KB/frame. (A first run with every bell casting into the per-frame shadow map: +9 draws, +.1 ms in `G.render`; the bells
  are static casters now while they hang still.)
- `?owncheck=1` session (shots, a blast, a biome switch): no foreign write to the bells' props, no added fields.
- Probes (`tmp/xbel/probe.mjs`, bodies `tmp/xbel/b_*.js`): a nest's plate then bell then bell from the crescent
  (`tmp/xbel/chain.gif`, frost), layouts in all five biomes, the forge's bell banks baked and posted in the page.
