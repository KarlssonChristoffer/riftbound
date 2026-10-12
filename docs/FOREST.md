# The forest: a seeded place north of the Proving Grounds

Status: 2026-10-12, third slice: the high country (an upland, a fell and a canyon, below); second: the home woods' ground (landforms). First slice 2026-10-11 (`world/forest.js`). Off by default; on with a seed: `?seed=1234`, `?forest=1` (seed 1337), or
any co-op session (the server's seed: docs/MULTIPLAYER.md). `?forest=0` keeps it off. It needs walkable terrain (`?terrain=0`:
no forest).

## What it is

- **Where.** x -48..72 (the world's width: under the West Downs, the Proving Grounds and the mesa), y -160..0: 120 x 160 m (y -64..0
  until the high country), more than the rest of the world together. The world grows north to it (`WORLD.y0` = -160, and on over its
  cave's band to -242: docs/CAVES.md); the old north bank, the West Downs' north
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

## The high country: a fell and a canyon (2026-10-12)

The forest grew north to 120 x 160 m (`RECT` y -160..0; the world follows: `WORLD.y0` = -160). The home woods keep the south part
(`HOME`, y -64..0); north of it is the high country. Its own generator (`mix(seed, 4)`), so the home woods come out the same for a
seed whatever it does. Fell and canyon take opposite sides, the seed picks which.

A first try stacked four rock tiers with ramps along their faces; it read as built (brick walls in rings), the ramps left a slot
between path and face you could walk into behind the rock, and their outer shoulders showed as bare green sheets. Replaced by
ground that rises the way the land does, with rock only where a slope breaks:

- **UPLAND.** The whole high country stands 7 .. 8.5 m over the home woods, up a walkable slope (28 m, the foot wavering) that starts
  just north of them. Part of the field (`highH`).
- **FELL.** A rounded massif rising 12 .. 13 m from the upland (the top 21.6 .. 24.7 m): straight flanks you can walk up (~.5),
  longest on the stoss side, shortest on the lee side toward the home woods, a rounded top, its outline wavering, a little lumpy;
  the rolling relief is calmed on it (its slopes would add to the fell's). No trees on its top (`bare`: above .6 of its rise).
- **CRAGS.** Five to eight shelves in its flanks, mostly on the lee side: each a terrace (`F.outcrops`, kind 'crag') level with the
  slope a little above its middle, so its uphill side lies under the slope and its downhill side drops 2 .. 4 m as a rock face. Rock
  where the shelf stands .35 m or more out of the slope (bank .12); elsewhere a bank (no kerb of stone lying on the slope). A shelf is a ledge you can walk onto
  from the slope above.
- **TORS.** One to three piles of 3 .. 5 big boulders on the top (`F.tors`, rock_big props: rock terraces there read as wells).
- **CANYON.** A gorge cut into the upland: from just past its foot north, wandering, to a rounded head 9 m short of the north edge;
  3.5 .. 5.5 m across, its floor the ground at its mouth rising .6 .. 1.4 m inward. The land it cleaves rises along it (a RIDGE:
  5.5 .. 6.5 m, a 2 m flat rim, then falling away walkably over 18 m), from nothing at the mouth to full height 14 .. 54 m in, so
  its walls grow from nothing to 12 .. 14 m (15 m with the relief). No trees in the slot or within 9 m of its mouth (they hid
  the floor and the way in). A channel with no bank (`F.canyon.cut`, in `F.shapes`), drawn
  .35 m wider than walked like the mesa's cleft, so the drawn ground's steep cells lie behind the rock; world.js lays one rock run
  up its west wall, round the head and down its east wall (`F.canyon.wall`, from where the wall really rises: no loose rock at the
  mouth). cliffs3d.js stacks up to 60 layers now (was 30: ~13 m), for walls this tall. You walk in from the home woods; the rims
  are reached over the ridge's outer slopes.
- **HEIGHT YOU CAN SEE** (2026-10-12: the slopes read as one flat green). The painter (biomes.js `forestRuins`) bands the ground by
  height, the bands' edges ragged: a gorge's floor (4 m under the ground round it) in a deep, cool grass; the fell's bare top
  (`F.fellK` over .58) heath with small patches of lichen, heath and grass mixed below it; the upland's open ground (`F.uplandK`) a drier,
  paler grass. Up the fell the trees thin out and turn to stunted mountain birch with a pine now and then (`fellK` over .25).

Node check (20 seeds, `forestPlan` + `createField` and a walk over the cells that aren't steep, from the clearing): every seed's
fell top, every crag's shelf, the canyon's floor and head and both rims can be walked to; steep cells away from the rock
.10 .. .54%; 570 .. 750 trees. The point-light height map (gfx.js) covers up to `WORLD.top` (the fell + 4 m; 20 m without the
forest, as before).

## The small things on the floor (2026-10-12)

The recipes from the asset lab (`content/recipes.js`, docs/ASSETS.md) are placed by `forest.js` (`decorate`, into `F.decor`) and
drawn by `world/decor3d.js` through the world's instanced flora (`render/flora.js`). `?decor=0` turns them off.

- STUMPS: snapped or rotten (style -1) near pines, more in dense old stands, sometimes a chanterelle ring beside one. Sawn ones
  (style 2) only round the settlement's clearing.
- LOGS: fallen trees lying flat (both ends on level ground, clear of trunks), often with a rotten stump by the root end; grey and
  broken (old) in deep shade and near water, fresh near the clearing.
- FLY AGARICS in groups of 1-3 under birch and pine in half shade; CHANTERELLE rings in pine shade, often by a stump or log.
- BLUEBERRIES fill the floor under pines on the drier ground and the esker's slopes; never by the water or in the clearing. Drawn
  1.6x (`TUNE.decor.berryS`): at the recipe's size they read as specks.
- LINGONBERRIES (`content/recipes.js` lingonberry: low evergreen sprigs, red berries) on the drier, sunnier, poorer ground: open
  pine, the esker, the thin soil within 6 m of rock; they only take spots the others left, so the rest of the floor is unchanged.
- WINDTHROWS (rotvälta): a tipped spruce, its root plate on edge (~2 m) over the pit it tore out, the trunk lying away from it,
  telling a STORM (`F.storm`, one a world, its own generator): a gale from the prevailing west / south-west
  felled a lane ~50 x 14 m (placed where the ground is most open), so most windthrows (4-9) lie in that lane, fresh, every one
  fallen downwind (plate on the windward side, trunk away from it, within +-14 deg), with more snapped stumps and fresh logs
  lying the same way among them. Elsewhere only the odd old, grey one (0-1) on the thin soil near bare rock. Placed first, as
  they need the most room. Solid: `F.decorSolid` is a row of round colliders across the plate ('rootplate',
  1.5 m high: the plate sits half in the ground) and along the trunk ('windlog', .9 m), added by `layout.js` and joined like a
  field wall's stones (`collide.js`). The hole it tore out is bare: the recipe's `ground(p)` ellipses, turned and scaled with the
  tree (`F.decorEarth`), are painted as earth in the forest ground (`biomes.js` forestRuins, darker in the middle, so the hole
  shows on a slope too), and the grass tufts, ferns and other decor are kept out of them and from under the trunk (`F.decorClear`).
- Not placed: the watcher (its own creature, `features/watcher.js`) and the ant hill.

What suits a spot comes from the trees within 4 m (shade, the pines' share, the nearest pine / birch). Their own generator per
chunk (`mix(seed, 5000 + cx, 5000 + cy)`) on a 2 m lattice, and they live apart from `F.props`: the trees, the server's checks and
every item the world tracks are exactly as before. View only but for the windthrows' colliders: no entity, nothing synced (the same seed grows the same floor, and the same
colliders, on every client).

Cost: seed 1337 places ~330 things (75 stumps, 22 logs, 10 windthrows, 29 agaric groups, 23 rings, 165 blueberry patches),
~280k triangles, 22 variants (only stumps, logs and windthrows cast shadows). Grouped by 32 m cells, each group culled as a whole
(flora's `o.cull`): ~20 draws in a forest view, none outside it. Each recipe is grown in 3 variants (its params tied to
the variant: a patch of 3, 4 or 5 shrubs), turned and scaled per instance. Placed once at the world's build: no per-frame work.

## The cave (2026-10-12)

Every forest has a cave: its mouth a slot cut down into level ground in the home woods, its chambers and passages in a band of
their own north of the forest. Growth keeps off the mouth and the ground in front of it. docs/CAVES.md.

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
