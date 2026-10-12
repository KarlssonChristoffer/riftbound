# The forest: a seeded place north of the Proving Grounds

Status: 2026-10-12, second slice: the home woods' ground (landforms below). First slice 2026-10-11 (`world/forest.js`). Off by default; on with a seed: `?seed=1234`, `?forest=1` (seed 1337), or
any co-op session (the server's seed: docs/MULTIPLAYER.md). `?forest=0` keeps it off. It needs walkable terrain (`?terrain=0`:
no forest).

## What it is

- **Where.** x -48..72 (the world's width: under the West Downs, the Proving Grounds and the mesa), y -64..0: 120 x 64 m, more
  than the rest of the world together. The world grows north to it (`WORLD.y0` = -64); the old north bank, the West Downs' north
  bank and the highland behind the mesa give way to it; a bank of its own frames its north and west edges. You walk in from the
  strip north of the arena (its north gate), from the West Downs and from the trail.
- **Ground.** Rolling relief (value noise, up to ~3.2 m, faded flat over its southern 12 m so it meets the Proving Grounds level,
  held low along the lake's way out to the river) and up to three rounded hills (3.8 .. 5.8 m), all walkable; the landforms
  below on top. A 'field' terrain shape (world/terrain.js) carries the relief: `elev`, `steep`, the
  ground mesh, the shadows and everything standing on it follow the one height field as before.
- **Water.** A LAKE in the lowest hollow the seed's candidates find (deep: falling in is a respawn), a STREAM from a spring on the
  high ground in the north down to it, wandering downhill, and an OUTFLOW from the lake down to the Proving Grounds' river where it
  comes out of the north edge (x 40): the water runs on through the map. The streams are shallow and wadeable. Beds are cut into
  the ground (never rising downstream); the water is painted and moves like the brook's (world.js bakeWater, waterbed.js).
- **Growth**, per 16 m chunk, from the seed and the chunk's own coordinates: TREES on a jittered 3.2 m lattice, thick or thin by a
  density field (thickets and clearings), conifers (the frost biome's pines) on the higher ground and in drifts of their own, oaks,
  birches, aspens, rowans and the odd dead tree elsewhere, willows by the water; UNDERGROWTH (bushes and ferns under the crowns,
  tufts in the open, reeds where water meets bank); ROCKS (boulders on the slopes, solid; stones). Nothing in the water or on
  its banks, nothing too steep. Only existing kinds and art (trees3d.js species, flora3d.js plants, the prop kit's rocks).
- **Trees are solid** at their trunk (collision phase 5: world/collide.js walks a tree as .6 of its radius) and each has a stable
  id, `fid` (`t<cx>.<cy>.<n>`): the same tree on every machine for the same seed. Co-op fells by it.
- **Painted ground** (ruins: biomes.js forestRuins): the floor lit by its real slopes like the West Downs', grass in the clearings,
  earth and leaf litter under the crowns (a canopy map from where the trees stand), moss in drifts and on the north side of the
  trunks, roots round each trunk, twigs; the streams and the lake with banks, a damp lush band, the spring in a ring of stones.
  Other biomes have no forest painter: their own trees on the open land's stand-in ground (the lake is then invisible deep water,
  as the brook's pool is there).

## Landforms: the home woods (2026-10-12)

The starting area is modelled on Småland (never named so): ground the ice shaped and left strewn with stone, spruce, pine and
birch on it, small lakes. All from the seed, in this order (`forestPlan`):

- **ICE.** One direction the ice flowed, from the north-west give or take (`F.ice`). The esker runs along it and the outcrops face
  it, so the landforms line up the way they do in a real moraine landscape.
- **ESKER.** One long winding gravel ridge (2.2 .. 2.8 m high, 36 .. 64 m long, ~8.5 m wide, a flat 1.2 m crest kept clear of
  trees: a natural path along its top; the ends taper into the ground). Part of the 'field' shape; it keeps off the lake and its
  outflow (`F.esker`: its control points and height). Conifers favour it.
- **HILLS.** Placed after the esker and kept off its crest; each at least 2.8 x its height across, so its slopes stay walkable.
- **CLEARING.** The flattest spot of 24 on the lake's shore, away from the streams and the esker: r 7 m, only grass grows there
  (`F.clearing`, kept for the settlement by the water).
- **OUTCROPS.** 3 .. 6 bedrock humps (roches moutonnées): an ellipse stretched along the ice, a gentle slope up from the side the ice
  came from, a 1.1 .. 2.3 m rock cliff on the lee side. Rejected where the cliff wouldn't drop at least .7 m all along.
- **BLOCKS.** 3 .. 6 big lone boulders (1.1 .. 1.9 m across, 1.5 .. 2.8 m tall), rock on every side.
- **BOULDER FIELD.** In the deepest hollow of 30 candidates (r 4 .. 5.5 m): 10 .. 16 rocks lying close, no trees. Some seeds find
  no hollow for it.

Outcrops and blocks are `F.outcrops` (`{kind, x, y, r, h, ctl: [[x, y, bank], ...]}`): layout.js makes each a terrace with rock
where it drops (`mesaOutline`, the ledges' way), so world.js draws them with the cliff rock (cliffs3d.js) and collision walks them
as any terrace. The forest's own height (`F.height`, for placement) mirrors terrain.js's terrace sum (`terraceH`).

Node-only check (10 seeds, `forestPlan` + `createField`, 2026-10-12): every seed has an esker, 3 .. 6 outcrops and 3 .. 6 blocks;
max height 5.1 .. 8.5 m; steep cells off the cliffs .04 .. .86% (esker ends, outflow banks); plan 12 .. 80 ms, field bake 150 ..
680 ms. Not yet seen in the game, benched or run through golden / smoke / simview (the sprite assets aren't in the repo).

## Chunk-friendly

Everything is a pure function of the seed and the place (no Math.random, no DOM: node runs `forest.js` too, and the server checks
felling against the trees it grows itself). Growth is per chunk with the chunk's own generator; the relief and the noise fields are
functions of world position; the ground is drawn and painted in 32 m tiles (`world.js`: a canvas, a water texture and a mesh per
tile, each painted with a 1 m margin so the tiles meet without seams); per frame, a chunk off the view skips its items' work and
its meshes leave the G-buffer pass (`world.js chunksOnScreen`). Growing the forest means a bigger `RECT` (or chunks made as the
player walks: the painter and the growth already work a tile / chunk at a time); the lake and the streams are the forest's few
global features and would become per-region features then.

## Measured (2026-10-11, RTX 4070, headless, 3440 x 1440, tools/perf/ab.mjs)

- Forest off (the default): no change against HEAD (B / A .95, inside the tool's noise).
- Forest on, standing in the arena: 1.68 -> 1.79 ms a frame (+7%: world.update +.02, contact +.03, G.render +.02; draws 156 -> 168,
  the swaying trees' sun shadows near the view). Standing in the woods: 1.55 ms (the arena alone: 1.68). 314 trees and ~500 plants
  for seed 1337, 1470 props in all (620 before).
- Before the chunk skip the forest cost ~1.1 ms a frame even off screen (world.update's pass over every item and three.js walking
  ~300 more meshes per pass): the skip took that out.
- The world's build: 3.3 -> 5.9 s (the painting of 15 tiles ~1.2 s after its low-frequency fields went to a coarse grid, the water
  bakes ~.3 s, the field bake and the meshes the rest). Painting the tiles in a worker or lazily (the far ones after the first
  frame) is the next step if it matters.
- golden 16/16 identical, smoke and simview pass (forest off); forest on: no console errors, ownership check clean (`?owncheck=1`),
  every biome switch builds.

## Next

- Instance the trees (one draw per species shape): the swaying trees cast into the per-frame sun shadow one draw each, which is
  most of what the forest costs on screen.
- Grass blades in the clearings (features/grass.js has the West Downs' builder), fallen leaves on the forest floor (litter covers
  the Proving Grounds' canvas only), mist over the lake at dawn, fish and frogs, birds perching in the forest's trees.
- Paths: a trail from the arena's north gate to the lake.
- The other biomes' forest painters (frost: snow under pines; ember: ash), if the forest stays in them.
