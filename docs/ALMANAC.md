# The Almanac: the game's first loop

A field book that walks a new world from the first felled tree to the deepest thing in the cave. It ties the systems
that already exist (woodcutting, foraging, building, cooking, the cave, mining, the workshop, fishing, skills) into one
path, where each step's result is the next step's material. A 30-60 minute session should end with something you
couldn't do at the start.

## What you see

- **The card**, top left (sandbox worlds only): the chapter you're on, its goals with a tick box and a count, then
  **Today**. J folds it to a small tab. Tab opens the pack; its Almanac section shows every chapter, the hints and the
  pages torn out so far.
- **The pointer**: a small gold chevron on a ring round the player, toward the first unfinished goal that has a place
  (the cave's mouth, then the camp, the nearest vein of the right kind). The distance shows beside that goal.
- **A page**: when a chapter is done the card shows its name, "done" and a few lines that point at the next one, for
  nine seconds. Its gift lands in the bag ("+3 Chanterelles").

## The chapters

| | Goals | Gift |
|---|---|---|
| I. Smoke | fell 3 trees, pick 12 berries, build a campfire, cook and eat | 3 chanterelles |
| II. Down | go down into the cave, take the old pick, break 3 veins, carry 4 copper ore | 4 stone |
| III. Hearth | a fire ring or crystal lamp down in the cave, cook just right, land a fish, any skill at level 3 | 2 copper ore |
| IV. Bars | clay furnace, copper bar, fit a bellows, crack an iron vein with fire, iron bar | 2 logs |
| V. Iron | stone anvil, iron pick or axe, break an iron vein, break into a hollow wall | 2 glow shards |
| VI. Nightglass | dig night ore in the dark, smelt Nightglass, forge the Nightglass Lantern, carry its light to a night vein | |

**Nightglass** is the end of the path and the new thing the path leads to. Night ore (the night veins that only show
in the dark) smelts white-hot into Nightglass (`CHARGES.night`); Nightglass, an iron bar and a copper bar make the
**Nightglass Lantern** at the anvil (`SMITH.nightglass_lantern`, off hand, mythic). Its light is dark blue: it lights
the cave like a lantern but counts as *dark* to everything that hides from light (`light.nightglass` note: mining's
night veins, cave life, the co-op lantern state), so with it you can see what only shows in the dark.

## Today

After chapter I, three small goals a day: two solo goals of different kinds and one party goal ("Between you: fell 8
trees"). They come from the world's seed and day number, so everyone in a world gets the same three. Each one done
gives a small gift; all three give a bonus. A new in-game day rolls a new three. Offline the party goal reads as your
own and counts only yours.

## Co-op

No new server state. The client counts events the server already confirms (`tree.fell` now carries `mine`,
`forage.pick` / `build.add` / `smith.smelt` carry `mine`, a friend's spent vein has `n` 0), so each player has their
own almanac in their own save. The party goal counts a friend's events too, while online.

## Try it

- `?chapter=3` starts at chapter III (1-6). `?almanac=0` turns it off.
- Esc > Sandbox: rows to finish the chapter, finish Today, reset the almanac.
- `node tools/test/almanac.mjs`: the data, Today's roll and the feature with a fake host.

## Files

- `src/content/almanac.js`: the chapters, the pages, the hints, Today's pool, the roll.
- `src/features/almanac.js`: counting, saving (`pack.store('almanac')`), gifts, the pointer, the pack section.
- `src/ui/almanaccard.js`: the card and the pointer, drawn on the HD layer.
- Nightglass: `content/items.js`, `content/workshop.js`, `content/gear.js`, `render/lighting.js`, and the
  `light.nightglass` reads in `features/mining.js`, `features/cavelife.js`, `features/coop.js`.
- Events: `smith.fit`, `almanac.goal`, `almanac.chapter`, `almanac.today` (`core/events.js`).
