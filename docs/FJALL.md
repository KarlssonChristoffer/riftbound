# Fjället: the Swedish mountains north of the woods

First playable slice (2026-11-07). The ideas and the open questions live in the WIP notes `/mnt/project-files/briefs/fjallet.md`;
this file says what is built and where.

## Where it is

One world with the woods. The home world (layout.js `WORLD`: the woods, the arena, the cave's band north of them) stays as it was;
the fjäll is a region of its own round it, x -330..450, y -920..0 (m, y south), and it **owns every point of that region outside
the home box**. The way in is the woods' **north-east corner** (the gate, x 64..86, y -160..-134): walk east out of the trees
there and the valley opens north-east. Scales are first-slice scales (Christoffer: "skalorna kommer att bli annorlunda sen").

From the gate to the summit along the trail is ~1.4 km of path (~3 min at a run in a straight line from the woods to the glacier).

| place | what | `?fjallat=` |
|---|---|---|
| the gate | out of the woods' north-east corner | `gate` |
| the valley | the jokk's lower valley, meadow and mountain birch | `valley` |
| the stuga | the red cabin on the lake's south-west shore | `stuga` |
| the lake | long and narrow, the jokk runs through it | `lake` |
| the treeline | where the birch gives out (~74 m) | `treeline` |
| the bridge | the winter trail's footbridge over the jokk above the lake | `bridge` |
| the glacier | in its cirque under Storfjället; the jokk is born at its snout | `glacier` |
| the summit | Storfjällets topp, ~211 m | `summit` |
| the tarns | three small tarns on the northern kalfjäll | `tarns` |
| the block field | blockhav on the western ridge | `blockhav` |

F10 > the features' rows: "Fjället: till ..." teleports to each. The debug HUD shows the height and the nearest place.

## How it is made

- `src/world/fjall.js` **the plan**: pure functions of the seed. The massifs (domes and ridges broken by warped noise, crags
  high up), the U-valley carved along the jokk, the lake's basin, the jokk's bed, the cirque and its glacier, the tarns. The
  ground eases into the home ground over 44 m at the home box's edges. The trails are **routed** (A* on a 2 m lattice, steepness
  costing more and more, water never) through hand-placed waypoints: **leden** (gate, up the valley's west side, the stuga's
  door, the lake's west shore, the cirque's lip, the summit) and **vinterleden** (the lake's north-west shore, over the bridge,
  up to the pass). The bench is cut level across them and held under a 0.44 grade. Zones by height, slope and aspect:
  mountain birch to ~74 m, the willow belt to ~96 m, bare fell above, late snow in north-facing hollows above ~128 m.
  The scatter: mountain birch in groves, dwarf birch and willow, stones and the block field, cairns every ~30 m on the open
  trail, the winter trail's red crosses every ~20 m.
- `src/world/fjallworker.js` the heavy part off the main thread: the bake (1 m height field, the trails, the scatter: ~2 s) and
  the painting. `src/world/fjallpaint.js` the painter (pixel ground: 4-tone ramps, ordered dither, specks).
- `src/world/fjall3d.js` the meshes: ground tiles (32 m, skirts against cracks), the merged props per tile, the stuga, the bridge.
- `src/features/fjall.js` streams it: the whole region far (4 m grid, 2 px/m texture), the tiles within 64 m near (1 m grid,
  16 px/m texture painted when they come near), props within 130 m. Sun shadows through sunk casters, as the woods' tiles.

Small hooks in other files (all additive): `layout.js` (FJALL, elev / steep / onGround / walkable ask the plan out there,
viewBounds), `camera.js` (the view keeps to the region out there), `gfx.js` (the static shadow box follows the view's height out
there), `world.js` (the woods' ground tiles stop at the home box's east and west edges: the fjäll draws past them),
`core/flags.js` (`fjall`, `fjallat`), `net/protocol.js` (`fjall` is a world switch), `server/room.mjs` (heights up to 600 m).

## Multiplayer

Everything up here is grown from the seed: every client builds the same fjäll and nothing is sent. The server owns the clock, the
weather and the season as everywhere. Later, what players change up here (a cairn built, the stuga's fire, its guest book,
reindeer) goes through the server like the other shared things.

## Switches

- `?fjall=0` no fjäll (the woods' ground goes past their edges as before).
- `?fjallat=stuga` (any place above): start there.

## Known gaps (first slice)

- The trees, stones and crosses are walk-through (only the big stones and the stuga block).
- Water is painted on a flat surface (no moving water, no wading look, no fishing yet).
- Far tiles have no props: from the chase camera the birch woods show as painted ground past 130 m.
- Crossing the gate the top-down camera may jump a few metres (the home world's bounds give way to the region's).
- No weather of its own yet (wind, cold, whiteout), no reindeer, no stuga interior.
