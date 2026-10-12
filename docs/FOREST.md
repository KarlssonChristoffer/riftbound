# The forest: a seeded place north of the Proving Grounds

Status: 2026-10-11, first slice (`world/forest.js`). Off by default; on with a seed: `?seed=1234`, `?forest=1` (seed 1337), or
any co-op session (the server's seed: docs/MULTIPLAYER.md). `?forest=0` keeps it off. It needs walkable terrain (`?terrain=0`:
no forest).

## What it is

- **Where.** x -48..72 (the world's width: under the West Downs, the Proving Grounds and the mesa), y -64..0: 120 x 64 m, more
  than the rest of the world together. The world grows north to it (`WORLD.y0` = -64); the old north bank, the West Downs' north
  bank and the highland behind the mesa give way to it; a bank of its own frames its north and west edges. You walk in from the
  strip north of the arena (its north gate), from the West Downs and from the trail.
- **Ground.** Rolling relief (value noise, up to ~2.4 m, faded flat over its southern 12 m so it meets the Proving Grounds level)
  and two to four broad hills, all walkable. A 'field' terrain shape (world/terrain.js) carries the relief: `elev`, `steep`, the
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
