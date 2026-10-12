# Assets: recipes, paints and the asset lab

Status: 2026-10-12, first slice, plus natural stumps and the watcher. Work-in-progress notes on the wider idea: the "Painless assets: notes" doc in the project.

## The idea

The renderer makes the look, not the model. Any rough low-poly shape whose parts carry a family (wood, rock, bark, leaf ...) is
toned by the biome's ramps, outlined, seamed between parts, mossed and snowed on what faces up, lit and shadowed like every live
prop. So a new thing for the world only needs plain shapes and a family per shape. A RECIPE is that: a short function that draws
a thing from tubes, cones, balls, caps and boxes, with a few params and a seeded random, so one recipe grows endless variants.

## The pieces

- `src/content/recipes.js`: the recipes (data + small builders, no imports). Each has `about`, `likes` (where it grows: a hint
  for whoever places it), `params` (`{key: [default, min, max]}`) and `build(b, p, r, ctx)`.
- `src/content/paints.js`: colour ramps the recipes paint with, beside the world's own families. Each paint is one more family:
  `world.js` appends the names to `FAMS` (after its own, so every old index stays) and fills their row of the ramp texture. A
  paint can have a ramp per biome (`all` elsewhere).
- `src/world/recipe3d.js`: the builder (`b.tube / cone / ball / cap / box / disc / at / onDome`), the seeded random, and
  `recipeGeo(name, seed, params, biome) -> {geo, h, r}`: one geometry in the recipe's frame (x east, y up, z south, metres, origin
  its ground point), cached. Placing one in the world: `host.world.mesh(geo, matrix, {static: true})`.
- `src/dev/assetlab.js`: the asset lab, `?mode=sandbox&lab=1` (or `&lab=<recipe>`). Five seeds of a recipe in a row in front of
  you, in the game's renderer, biome, light and weather, turning. The panel: the recipe, sliders for its params, seeds, turn,
  move here. It watches `recipes.js` and `paints.js` and rebuilds within a second of a save. Keys: `[` `]` recipe, `\` seeds,
  `'` turn; N switches biome as always. Add `&forest=1&at=12,-22` to stand in the forest.

## Families: 64 now

The composite keeps a mesh pixel's family in the G-buffer's E.w as `part * 32 + family`: 5 bits, 32 families, 29 were used. A
family past 31 (the paints) is now written as `-(part * 32 + family - 32) - 1`: the sign carries the sixth bit (gfx.js MESH_FS
and the composite, render/flora.js). The first 32 families pack exactly as before, so nothing already in the world changes.

## First batch (home woods)

| Recipe | What | Params |
| --- | --- | --- |
| stump | spruce stump: snapped by the wind or rotten and hollow (style -1 picks by seed); sawn (style 2) only where people cut wood | r, h, roots, style, fungus |
| log | fallen tree, fresh or old and grey, branch stubs | len, r, stubs, old |
| fly_agaric | red caps with white warts, a young closed one | n, size |
| chanterelles | a ring of golden funnels | n, size |
| anthill | a dome of needles and twigs (not wanted in the forest) | r, h, twigs |
| blueberry | a patch of knee-high shrubs, berries | n, spread, berries |
| watcher | weird: a pale toadstool with one eye under its cap (eye 0: the body alone; the creature below rolls its own eye) | h, eye, bend |

## The watcher (features/watcher.js)

An early-game creature built from the `watcher` recipe: now and then (every 70-200 s, half that at night) it rises beside a
tree trunk 4-10 m away, in a crowded, dark spot near the edge of the view, and only watches: it turns to face you, its eye
follows you (glances, blinks), it hops and leans out round the trunk. Come within 2.8 m, or rush it, and it yanks itself
underground in a spray of dirt; left alone it sinks after 15-40 s. It is view-only and private to each player: nothing is
synced, every player has their own. `?watcher=0` turns it off, `?watcher=often` brings it every few seconds; the sandbox
menu has Summon the watcher.

## Placing

Not placed in the world yet: the forest's growth (world/forest.js) is being reworked elsewhere; it can read `likes` and call
`recipeGeo` when it adds the life layer.

## Next

- Sway: leafy recipe parts (blueberry) with the wind's bend weights, as flora3d does.
- Instancing: many copies of a recipe in one draw (render/flora.js) once the forest places hundreds.
- Importers: Blockbench (tools/blockbench/bb2glb.py) and glb packs with names -> families, shown in the lab.
- A rift warp over any recipe (stretch, twist, eyes, crystals) at build time.
