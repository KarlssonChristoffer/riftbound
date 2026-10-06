# The world plan: open land round the Proving Grounds

Status: 2026-10-02. The goal (the user's): more open, flat land round the existing map, in every biome, to build roads and
paths on. Not a new map and not test zones: the same world, bigger. Everything that exists keeps its coordinates (the new
land to the west and north has negative x / y), so every `?at=`, test script, brief and bench scenario stays valid.

**Decided:** the river ends at a source pond just north of today's edge, so the north land stays one piece. The size
proposed is 40 m west, 60 m north and 60 m east: 162 x 90 m (x -40..122, y -60..30), the ravine still the south edge.
That is what `?world=big` builds; the user hasn't confirmed the numbers yet.

## Steps

| step | what | state |
|---|---|---|
| 1. Bounds with an origin | layout.js `WORLD {x0 y0 x1 y1 WM HM}` and `GROUNDS` (the Proving Grounds' rect); one `walkable` / `roamable` / `navArea` instead of four copies; nav, camera, grid, the renderer's world boxes, wildlife and wind read the bounds | done, 514f36c (golden identical) |
| 2. Cost follows the camera | below; measured with `?world=big` | on branch `world/bounds` |
| 3. Grow | `?world=big` becomes the default (one intended golden re-save); the open land painted, walkable and framed; the source pond | next |
| 4. Roads | `src/world/roads.js`: kinds (dirt path, cobble road: width, edge), the gate roads as the first entries; maybe a dev road tool (click points, it prints the polyline and repaints the tiles it touches) | after 3 |

### Step 2, as built

- **Nav** (world/nav.js): the flow field reaches `FIELD_R` = 40 m of walking (spawns are 5-10 m out) and resets only the
  cells it reached; `build()` rasterises each fixed prop into the cells under its box instead of testing every cell
  against every prop.
- **Static sun shadow** (render/gfx.js): while the world + skirt is at most 100 m a side it is fitted to the world as
  before; a bigger world gets a 64 m box round the view, re-centred on an 8 m lattice, its texel grid held still in light
  space (~43 texels / m; the view shows at most ~40 x 20 m).
- **Ground in patches** (world/world.js): the Proving Grounds' patch (their painted texture; a side on the world's edge
  gets the skirt) and the open land in tiles of at most 32 m, each culled on its own: 0.25 m cells near the ravine and
  the stream, 2 m on flat land. Planar surfaces take an `origin`. The open land has a stand-in texture (the three
  commonest ground colours of the Proving Grounds' north-west corner, speckled) until step 3 paints it. The ravine's
  wall spans the world's width.
- **What features see:** `ctxO.WM HM WPX HPX` = the painted ground (`GROUNDS`, from 0, 0: `groundCanvas`);
  `ctxO.grounds` / `ctxO.bounds` = `GROUNDS` / `WORLD`. depth's framing pieces sit on the world's borders; wind's gust
  fronts still cross the Proving Grounds only.

### Step 3: what stops at the Proving Grounds today

- The ground painters (biomes.js) paint `GROUNDS` only. The open land needs its own painter per biome, written as a
  pure function of world position (scatter seeded per cell, so tiles meet without seams), run in a worker pool, far
  tiles lazily. Today's ground painting costs 0.44-0.8 s for 1891 x 915 px; painted the same way, the whole 162 x 90 m
  would cost ~3.5-6 s per biome switch.
- `walkable` / `roamable` / `navArea` still mean the arena and the trail: the open land becomes walkable, and the 33
  `outside` trees and rocks (no colliders today) get colliders or move.
- Footprints (flow.js decals), grass, fallen leaves (litter), gust fronts (wind), the water canvases (depth) and the
  ground-colour reads (atmos, wildlife) cover the Proving Grounds' canvas; the open land needs its own answer for each.
- The edges: what lies past the west, north and east borders; the rift (void beyond its platforms) and frost (a frozen
  lake on the south edge) on the open land; the stream's head (`STREAM.y0`) moves north to the pond.

## The West Downs (2026-10-06)

Built from the user's brief ("a new area west of the starting ruins: rolling hills, tall grass that dances in the wind, oak trees,
birds, beautiful light, some grass ankle high, grass that moves when walked through and in the wind"). On by default; `?west=0` is
the world as before (it starts at x 0).

- **Where:** x -48..0, y 0..30 (`WORLD.x0` = -48: the world is 120 x 30 m; `?world=big` grows from -48 too). The arena's west road
  comes out of its gate and carries on as a TRACK between the hills; a foot trail climbs to the old oak on the highest hill.
- **Data:** `src/world/westland.js` (WEST, LAND = WEST + the land painted past the world's west and north edges, HILLS, BORDERS (wavy
  banks: a straight bank painted as a ruler-straight band), TRACK / TRAIL_N, PROPS (15 oaks, the old one 1.7 x, boulders, bushes, two
  broken pillars, a forest edge past the borders), `zone()`: tall drifts in the hollows, ankle-high grass on the hilltops, the track's
  verges and under the oaks). layout.js takes its walkable / roamable / nav area, its hills and props; the strip between the downs and
  the arena's west wall became walkable (its trees and rocks are solid now, the two on the road's line are gone).
- **Ground:** `biomes.js westRuins` paints LAND on a canvas of its own (the meadow lit by the hills' real slopes, the track in the
  trail style, the ravine's edge); `world.js` lays it on a patch of its own (planar, LAND's origin); the band past the world's edge
  mirrors whichever patch it lies beside. Other biomes have no painter yet: their downs are the open land's stand-in.
- **Grass:** `features/grass.js buildWest` (its own generator: the Proving Grounds' blades are unchanged): tall tufts (.42-.82 m, the
  lush ramp, 4-7 blades) sway in slow waves rolling downwind (render/grass.js), ankle-high ones (.05-.12 m), the meadow's own; the
  blades are drawn in 12 m chunks the view culls; the trample map covers the world's bounds.
- **Life and light:** wind fronts cross the downs too; two more flocks (sparrows by the track, pigeons under the old oak's hill), two
  crows in the oaks, more rabbits and butterflies; the mist rises in the downs' hollows at dawn and dusk (two stretches over them,
  features/mist.js; gfx.js MIST_N 16); fireflies rise out of the meadow at night (atmos.js: all 36 over the downs, 12 elsewhere).
- **Measured:** 207k blades (all grass) built in ~230 ms; standing in the downs GPU p95 2.06 ms (arena 2.39); main-thread A/B
  west=0 vs on: B / A .99 (world.update +.016 ms: the extra props). Smoke + simview pass; golden differs (the bigger world: a re-save).
- **Open:** the other biomes' downs painter; footprints (flow.js decals) and fallen leaves (litter) cover the Proving Grounds' canvas
  only; the arena's grass rebuilt with the world (~230 ms per biome switch).
- **Old walls (2026-10-06, the stone wall remodel's phase 4):** dry-stone field walls either side of the track and two old buildings'
  foundations (the hall round the broken pillar on the old oak's hill, a barn by the track in the west, flagstone floors painted in
  them), built by `world/walls3d.js` from `westland.js` FIELD_WALLS / FOUNDATIONS; a 'fieldwall' segment every .6 m (round collider):
  vaulted anywhere (Space), stepped over where broken to rubble, birds perch on them. `?walls=old`: none.

### The standing stones (2026-10-06)

A stone circle on the south-west hill (x -35..-23, y 16..27), `world/stonecircle.js`; on by default, `?stones=0`: the hill and its
oak as before.

- **The hill:** the old dome (h 1.4) put a ring on its slopes, so with the stones it is the circle's own: a broad raised cosine whose
  top is levelled into a floor at 1.1 m (a terrace a little under the cosine's crown, which still rises .2 m under the altar); the
  ravine's rim holds the ground flat south of y ~25, so the floor is an ellipse (3.6 x 2.8 m, its outline wandering) and the ring
  too (3 x 2.6 m). Walkable all round (no steep cells), the ground outside x -35..-23 / y 16..27 moves at most 3 cm. The oak that
  stood on the top is at (-24, 17) now, east of the ring.
- **The stones:** the TRILITHON on the dusk axis (bearing 295: the sun's at ~18:50-19:25, sim/env.js sunAz under the dusk mood),
  two flat-topped uprights 1.02 m apart with a lintel across them; six more uprights round the ring (2-3.1 m, one snapped with its
  top at its foot), a stump with its top lying by it, one fallen outward on the far side of the axis and broken in two (the beams'
  way out stays open), a recumbent ALTAR on the crown, its length on the axis. Each stone is lofted from a rounded-box section
  through 8 rings (tapering more from one side, a little bellied, leaning, every corner in or out its own way: facets the art light
  tones as planes, their shading normals exaggerated as cliffs3d.js's), chipped, with a domed, slanted, snapped or flat top; pale
  lichen spots (its own family and part, a tone lighter: no seams), moss creeping up the north faces and round the feet, moss lying
  on the lintel and the altar (walls3d.js mason), the cover on what faces up; small chips round the broken ones.
- **The light:** at golden hour the sun shines through the trilithon onto the altar and render/godrays.js sees a slot between solid
  things: a shaft from the opening to the altar, more between the ring's stones (strongest looking into the sun, yaw ~65); long
  shadows (1.7 x their height, the renderer's cap) across the floor. A faint cool light over the altar (a world ground light, always
  on: lost in daylight, a glow on the floor at night).
- **Play:** a 'menhir' prop per stone (round collider; arrows stop at its own top: world.js TOPS; crows and ravens perch on them,
  pigeons and buntings now and then: wildlife.js PERCH; bullets chip them as stone), a lying stone a row of colliders (its middle the
  mesh, the rest 'menhir_part'); the trilithon's opening is a way in. The grass grows to their feet, none inside a stone, the
  ring's floor cropped to ankle-high turf (features/grass.js asks `stoneSward`).
- **Measured:** 10 meshes (static: their shadows in the cached map), 2,639 triangles, 16 props (10 'menhir', 6 'menhir_part'),
  built in ~3 ms; standing in the ring the frame's draws 144 -> 152 (perf report, `?stones=0` vs on). Smoke + simview pass, owncheck
  clean; golden, bench and A/B not run on the branch (measured after merging).
- **The watchtower (2026-10-06):** a ruined square tower on the western hill's summit (-36, 7.5), turned 20 deg off the camera's axis
  (two faces read at yaw 0): `world/watchtower.js`, built by walls3d.js's mason (exported for it) from `westland.js` TOWER (5.2 m a side,
  a .78 m shell). Level courses from under its lowest foot (buried uphill), a plinth and a string course at the lookout's floor, the corners
  interlocking; its back (north, west) faces stand ~4 m over the lookout, the north-west corner with a parapet fragment (coping, merlons,
  a crenel), the east face stepping down, the front a broken parapet. A doorway at the foot of the south face (jambs, a lintel, a step)
  choked with the fallen stair; slit windows in both storeys; pockets where face stones fell out, darker damp feet, rain streaks, moss up
  from the grass and down from the tops, ivy on three faces; flagstones on the lookout; 60-odd stones fallen round its foot, most under
  the broken faces. **The lookout** is 4 m over the summit (F): a deck over its whole footprint (layout.js BRIDGES, `own`: drawn by the
  tower, not as a bridge), so elev is F there and from below the tower is solid; a **ladder** up the south face into a breach in the
  parapet (CLIMBS, `hill`: the slope in front of it isn't flattened by terrainMask; the camera eases 20 deg to face it); 76 'towerwall'
  colliders: a ring round its foot at the ground's height (the body stays off the faces; arrows stick up to the wall's top: colTop) and one
  on the lookout where its walls stand (none in the breach: he climbs down there, or walks off it and drops). Climbs taller than the
  mesa's 2.4 m take proportionally longer (player.js), a climb down ends on the real ground under the ladder. Birds perch on its tops
  (wildlife.js PERCH 'watchtower'; crows / ravens like it best, one of the downs' crows starts on it); a **watch fire** on the lookout
  (features/lights.js: a brazier, unlit; E or a fire arrow lights it). The summit's oak grows down its west slope. 8.8k triangles, one
  mesh (static shadow), built in ~7-12 ms; `?tower=0`: none (the oak on the summit again).
### The brook (2026-10-06)

A brook through the West Downs' east corridor (x -16..-7), on by default with walkable terrain; `?brook=0`: the downs as before.

- **Course:** `world/brook.js` (data + pure functions; layout.js lays it): a SPRING welling up in a ring of mossy stones at the foot
  of the north bank (-14.75, 1), south through the saddle between the two big hills (1.2 m east of the hall's foundation), through a
  gap it broke in the east field wall, under a STONE ARCH BRIDGE where it crosses the track (the track's stretch there straightened:
  (-9.2, 17.35) -> (-15.2, 17.2)), into a deep POOL in the bend east of the southern hill (-8.6, 20.7), over three STEPPING STONES
  and over the ravine's edge at x -7.7 in a second WATERFALL. Two oaks stepped aside (to (-16, 23.7) and (-14, 26.2)) so the bridge
  and the pool show from the south; bushes on its banks step back (`away`).
- **Ground:** its bed is a terrain `channel` (banks 1.45 m wide: walkable down where it cuts ~.35 m through the meadow's swell), the
  spring's hollow and the pool's `basin`; the bed never rises downstream (.5 m at the spring, -.03 m most of the way, the pool's
  surface -.18, -.24 at the lip). Its surface is its bed (painted water on the drawn ground, like the creek).
- **Play:** shallow and wadeable (not water to the sim: a splash under each step), the pool deep (`inStream`: blocked, falling in is
  a respawn; world.js lowers the ground there by WATER_H like the plateau's pool). The bridge's deck and the stepping stones are
  layout.js BRIDGES (`stone: true`: elev / steep walk them, cliffs3d.js draws no planks on them); the parapets are 'parapet' props
  (round colliders every .38 m, nothing drawn; PROP_TOP .56); nothing walks under the arch (a deck covers it).
- **Water:** the West Downs' canvas gets the brook in the river's four tones (`brook.paint`, from biomes.js westRuins) and a water
  texture of its own (world.js bakeWater with the canvas's origin, over the brook's box only), with its own bed (waterbed.js with an
  origin and the brook's `depth`; gfx.js surface `bed`: per-surface bed uniforms): waterSample's kinds 4 (the brook) and 5 (its pool).
  The fall: the ravine's cliff texture streams in its columns (FALL_ALPHA, its colour from the West Downs' canvas), the 3D ravine
  rock is gapped there, the foot is painted on the ravine's floor. Reflections (depth.js) when it is in view.
- **Bridge:** `world/bridge3d.js` with the mason of walls3d.js (now exported): a segmental arch (2.3 m span, .62 m rise) of 15
  voussoirs with a proud keystone, springers down to the springing line, spandrels and abutments in courses cut round the ring (in
  strips over its back), paving on the hump, parapets laid to its slope with a coping (one stone gone) and end blocks, moss and grass on
  the copings; 6.2 x 2.3 m, the deck's crown 1.13 m (.85 over the track's ends). The stepping stones are flat rocks in the same mesh.
- **Life:** reeds and cattails in groups along its banks, ferns by the spring, beside the bridge and at the lip, five lily pads on the
  pool (one in flower: riverside.js, its own generator); two fish in the pool and a frog on a pad (wildlife.js: a pool fish takes its
  pool); four mist stretches at its water's height (mist.js; gfx.js MIST_N 16 -> 20); flecks riding three stretches of it and the
  fall's spray, mist and churn (atmos/waterlife.js); its babble from its nearest point and its fall as the waterfall's loop (audio.js).
  The grass keeps off it and the bridge (grass.js `clear`).
- **Measured** (ruins, loaded machine): build +~130 ms per world (painting ~35-45 ms, the water bake ~70 ms, the bridge 6-9 ms, its
  bed ~12 ms at load); the bridge is one static mesh (5k triangles, one draw, in the cached sun shadow); +1 water texture (the West
  Downs' canvas size, 8 MB) and its bed (~1 MB); per frame ~40 distance tests in audio, one more fall in waterlife. Smoke + simview pass.
- **Open:** the other biomes' downs have no painter yet: there the brook is a dry gully under its bridge, and its pool is deep water
  you can't see; the camera can't look under the arch; no rain rings or fallen leaves on it (waterlife's rings and leaves are the
  plateau's).
