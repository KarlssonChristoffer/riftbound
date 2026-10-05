# Walkable terrain: hills, terraces and ramps

Status: 2026-10-04, built and on by default; the plateau is terrain too (step 6). The goal (the user's): ground you walk up and down without a climb: rolling hills in the meadows
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
| 6. The plateau as terrain | the plateau's box becomes a MESA in the field: a natural outline, cliffs (rock) on most sides, a walkable gully down its south-west corner where the creek comes down in cascades into the pool, ladders on its south and east faces, the world 10 m wider | done (2026-10-04); ?terrain=0 keeps the box |
| 7. Moving through it, more of it | scramble up low ledges (Space), slide down steep grass, lying barrels roll downhill; natural low rock (the yard's lookout, shelves on the slopes), a slot cut into the mesa with a chamber, a footbridge over the creek, stone steps (stepped ramps) | done (2026-10-05) |

### Step 6: the plateau as terrain (the user's ask: no box with dead-straight walls; follow the water up a hill)

- `layout.js` MESA: the outline as control points [x, y, bank, firm] (a bank under .6 m is a cliff), wandering a little between
  them (`mesaOutline`: pieces under .9 m standing off the line by up to .16 m; firm edges stay straight: the desert's mine,
  the ladders). Its north side lies under the HIGHLAND (a terrace beyond the trail's edge: the ground rises on into higher
  land). `MESA.cliffs` = the stretches of cliff (one edge more into the banks either side, where the rock sinks into the
  slope), `MESA.ground` = the outline drawn in .4 m at the cliffs: the ground mesh's steep cells (a .25 m lattice) then lie
  behind the rock's face, under its cap, not in front of it. `mesaAt(x, y)`: on its level top.
- `terrain.js`: a terrace may have a bank per point (`banks`); `channel` (a bed cut along a polyline, its height per point)
  and `basin` (a pool's hollow, clipped under a lip) only lower the ground; `sampler()` evaluates the shapes unbaked; every
  shape has a reach (the bake skips it outside: the bigger world bakes faster than the old one).
- The gully: a ramp from the top down the south-west corner (w 2.8, shoulders 2.2 m: a .33 slope) between wide banks; the
  CREEK (the rill's path, `path()`: any direction) runs west across the top and down the gully's west half. Its bed is
  worked out from the ground before the cut: level on the top, then reaches falling .07 m per m to a LIP every 1.15 m, each a
  ~.3 m drop (CASCADES), the last (.55 m) into the pool. `FALL` is that last one; `RILL.pace / foam / riffle` say where the
  water runs fast and stays white.
- Drawn: the mesa's cliffs are cliffs3d runs along `MESA.cliffs` (top: the ground inside the face; foot: the lowest ground
  round it), a low rock rim along the pool's lip, a fall sheet per cascade (`fallFace` for any sheet: the biome's water,
  lava or ice). The ground texture mirrors past its edges (a camera turned to face the east edge over the border's raised
  banks saw the last texel column smeared). The painters: the creek's foam at each cascade; the mesa's top by each biome's
  plateau top painter (sand and rock in the desert, snow, ash, tiles; the ruins' meadow is its own).
- CLIMBS (`layout.js`): ladders on any face {x, y, nx, ny, w, h0, h1, reach, yaw}; player.js climbs in the camera's frame at
  the yaw that faces the wall (the adapter eases the camera there and back: `climbAssist`, `stepAssist`).
- Things that stood on the old box moved: the beacon (onto the south lip, east of the ladder), the crystal (off the gully's
  head), the lasso's snag (onto the west cliff); the cache's crate wall got an east side (the world is wider). Birds perch
  along the cliffs' lips, eyes peer out of their south faces.

### Step 7: moving through it, more of it (the user's picks: traversal and more terrain)

- SCRAMBLE (player.js VAULT): Space at a ledge more than a step and at most 1.25 m up, within .8 m, level where he lands and
  clear: up and onto it in .46 s (Space: a leap over water first, then this, then the roll). The prompt says "Space  climb up".
  Higher: a ladder.
- SLIDE (player.js SLIDE): on a bank too steep to stand on (slope over .8, still steep half a metre on down it: not a small step
  like a cascade's; over 2.6 is a cliff: a drop) he slides down its fall line, a little steering, until it eases under .45.
  The adapter gives the slope in the camera's frame (`grad`, no allocation).
- ROLLING (combat/props.js): a LYING barrel on a slope rolls down it (slopeG; only steeper than ~1 in 3 beats its rolling
  friction); upright ones and crates stay. Two barrels (one explosive) stand at the gully's head.
- LEDGES (layout.js): the mesa's machinery for low rock: the yard's lookout (natural outline, its steps' stretch straight) and
  shelves on the slopes whose uphill sides open into the slope (rock only where they drop). Each a terrace with `cliffs`
  and `drawn`.
- The walked ground and the DRAWN ground are two things now (`terrainField` / `groundDrawn`): the field's tops run to the
  rock's face (you stop at it, you step off at the visible edge), the drawn ground falls away behind it (the mesh's steep cells
  under the rock's cap). A shape's `drawn` holds its drawn values (an outline drawn in, a cut drawn wider); the drawn bake
  re-works only the lattice points near those edges (69 ms).
- CLEFTS (layout.js): a slot cut into the mesa's south face at ground level (a channel at 0, walls of rock facing in:
  `cleftWall`), opening into a round chamber with a chest. The mesa's own rock stops at its mouth (`inCleft`).
- BRIDGES (layout.js): a footbridge across the creek between its third and fourth cascades; `elev` takes its deck where it
  lies above the ground, `steep` is false on it (walkers and the nav cross it); planks, stringers, posts and rails in
  cliffs3d.js.
- Stepped ramps (terrain.js `steps`): level treads, risers of ~.165 m (under a lattice cell's WALK rise: not steep, walked up
  in stride), stone slabs on them (cliffs3d.js stairs): the lookout's steps.
- Left for later: a rolling boulder (needs its own model and roll), hollows below the ground (rain, dust and fog treat 0 as the
  floor).

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
