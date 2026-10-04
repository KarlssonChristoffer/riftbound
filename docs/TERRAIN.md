# Walkable terrain: hills, terraces and ramps

Status: 2026-10-04, built and on by default. The goal (the user's): ground you walk up and down without a climb: rolling hills in the meadows
AND terraces joined by ramps (the steep steps between levels drawn as the 3D rock of `world/cliffs3d.js`), built into the
Proving Grounds as they are (the walled arena stays flat). Everything that stands, walks, flies or is drawn on the ground
follows one height field.

The measured starting point (an inventory of every height reader, 2026-10-04): the world is flat at 0 except the plateau
(`layout.js` PLATEAUS, 2.4 m, reached only by the climb), the lowered stream bed (WATER_H) and the ravine (DROP). About 60
files read a ground height; most already go through `elev(x, y)` per point and only need it to mean more. The hard ones are
listed under each step.

## The model

- **One height field**, `world/terrain.js`: `H(x, y)` in metres, the walkable ground (the plateau included), baked once
  per world into a grid (1/8 m cells over the world + skirt) and read bilinearly: cheap enough for every per-frame caller,
  no allocation. `layout.js elev()` becomes it; nothing else defines a ground height.
- **Shapes** (plain data, like the layout): `hill` (a smooth bump: centre, radii, height), `terrace` (a raised flat area: a
  polygon and its height; its edge a bank (a slope of a given width) or a cliff), `ramp` (a polyline and width joining two
  heights: cuts through a terrace's cliff), `swell` (low rolling noise over the meadows, masked). FLAT ZONES hold the
  ground at 0: the arena and its walls, the stream and pool with their banks, the ravine's rim, the gates' aprons, the
  frontier / shrine pads.
- **Walkable** = not steeper than WALK_SLOPE (~35 deg). Steeper cells are `steep(x, y)`: a wall to walkers (the player,
  brutes, gunmen, animals), a cliff to the painter and the rock builder. Step-up limit .3 m stays for small ledges.
- **Water** keeps its own surface: the stream, pool and rill sit in flat zones at their bed height; one `waterSurface(x, y)`
  replaces the dozen copies of WATER_H and the `elev === 0 && inStream` tests.
- **Flag**: on by default since step 5; `?terrain=0` is the flat world before it (an A/B: `elev()` is then the plateau's box alone).

## Steps

| step | what | state |
|---|---|---|
| 1. The ground has height | terrain.js + elev, the ground mesh, the player (ground follow, slopes, falls), the cursor pick, props / trees / cards placed on it, a test hill + terrace + ramp on the east trail | done (2026-10-04) |
| 2. Everything on it | brutes, gunmen, pushed / rolled props, debris, coins, projectiles (sub-stepped vs ridges), nav (walkable by slope, edges by height), wildlife walkers, hazards and telegraph rings per point, the exact `elev === z` tests -> tolerances, absolute `z: 0` spawns -> H | done, but arrows still test the ground at their step's end only |
| 3. Drawn right | ground decals + footprints (flow.js keys layers by exact height: a world-space decal layer instead), puddles / fog / cloud shadows (screen <-> ground through one plane today), the painter shading the REAL slopes (the painted swells were fake relief), terrain shadows (the ground isn't a caster today), cards sinking into up-slopes, lying bodies' plane | done: decals, slope painting, shadows, rings; left as they are (small on gentle hills): cloud shadows and the ground fog through the h 0 plane, lying ragdolls' flat plane |
| 4. The Proving Grounds shaped | hills and swells in the meadows, a terrace with a ramp on the east trail, a ramp up the plateau (beside the ladder), rock faces on terrace cliffs (cliffs3d runs with a top that follows the ground), the big world's open land | first pass done (2026-10-04): layout.js TERRAIN; the open land is still to come |
| 5. On by default | golden re-save (intended), bench, docs | done (2026-10-04) |

### As built (steps 1-3)

- `world/terrain.js`: createField (hill, terrace, ramp, swell; the swell is 0..amp, never below the flat ground, which many
  effects treat as a floor), baked on the .25 m lattice, bilinear `H`, `steep` (rise / run over WALK .7), `normal`, `slope`.
- `layout.js`: TERRAIN_ON, TERRAIN (the shapes), the mask (arena + 3.2 m, the stream + 1.1 m, the pool, the outflow, the
  climb, the ravine's rim, PADS: things built at 0 by their features: the campfire, the desert's frontier pieces),
  `elev`, `steep`, `onGround` (not a plateau's top, not a cliff: "elev === 0" in the flat world), `sameLevel`.
- The player: `groundFollow` in moveBy (STEP_UP .3, SNAP .16: a bigger drop is a fall), `pickGround` for the cursor; the
  adapter blocks walking up `steep` ground.
- Brutes (`sameGround`, z through hops / landings / shoves), gunmen (`toGround`), rolled props, debris, wildlife walkers
  (solid: a step or a cliff), dust devils, hazards' linger test, gadgets (a slope is ground to land on and roll on), nav
  (open where not steep, cells joined within .45 m), spawn tests (`onGround`), surface materials (the plateau is rock,
  hills aren't).
- Drawing: the painter shades the real slopes (`ctx.ground`), a shadow-only copy of the ground sunk .15 m casts hills'
  shadows (static map + the point lights' height map), flow's ground decals are read by the ground's shader at each
  fragment's world position (`G.setGroundDecals`, `{decals: true}` surfaces), rings follow the ground per point.

### The shapes (step 4, layout.js TERRAIN)

- The meadows' swell (.28 m), held flat by the mask round the arena, the water, the climb, the ravine's rim and the PADS.
- Grass banks rising along the north (1.4 m over 3.2 m), west (1.2) and east (1.3) borders: not walkable, they frame the
  grounds (terraces outside the world with wide banks; they follow WORLD, so the big world gets them at its own edges).
- The plateau's ramp: up its south face beside the ladder (52.2 -> 56.1 at y 11.72, 0 -> 2.4 m, 1.6 m wide), then a level
  landing (56.1 -> 57.7) whose north half lies under the plateau's box, so the whole landing opens onto the top. Rock
  walls on its open side.
- The yard's lookout terrace (56.6-60.6 x 14.6-20.2, 1.15 m), rock all round, steps up from the west (53 -> 56.9 at y 16).
  One pot moves off the foot of the steps when terrain is on.
- Hills where the sparring brutes live (47.8, 23.6 and 52.8, 24.6) and a knoll between the paths (49.6, 15.4); low mounds
  on the west border round the old foundations.
- Ramps end square (a ramp doesn't round past its first and last points: two ramps meet without a step).
- Rock (`rock: true`): world.js runs cliffs3d along a terrace's edges and a ramp's sides; a run's top may be a function
  (the wall's blocks are clipped under the ramp), its foot is the ground just outside (elev, the plateau's box too), so the
  rock is only where there is a drop. Steep ground above 0 keeps the ground's own texture (SURF_FS uCliffTop): a hole
  there showed the void.

### Step 1 in detail (the plan)

- `world/terrain.js` (new; OWNS the field): shapes -> baked grid; `H`, `normal`, `steep`, `ver`; `pickGround(sx, sy)`
  (the screen -> ground ray against the field: the fixed-point read that dev/cheats.js does, with bisection on steep ground).
- `layout.js elev` -> terrain (the plateau's rect stays exact on top of it); `buildLayout` already sets every prop's
  `p.z = elev(x, y)`.
- `world.js` ground mesh: `hAt` adds H; the open land's coarse tiles go fine where the ground isn't flat.
- `sim/player/player.js` + `adapter.js`: GROUND FOLLOW (walking: up to the step, down to SNAP, else a fall); `steep` blocks
  walking up; `cursorAim` / `cursorGround` through `pickGround`. The climb stays the plateau's.
- `render/camera.js`: the target's height eased a little slower than x / z (no bob on bumps).
- The test terrain on the east trail, checked with the headless tour, smoke, simview and an A/B (`ab.mjs --qb terrain=1`).
