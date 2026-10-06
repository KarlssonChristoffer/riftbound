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
