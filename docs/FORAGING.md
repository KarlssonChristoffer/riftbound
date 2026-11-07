# Foraging

Status: 2026-10-15, the first slice of the "Forage and dig" brief (PR 1 of 4). The forest floor's four plants can be picked:
blueberries, lingonberries, chanterelles and fly agarics. They grow back, a Foraging skill grows with picking, the berry
comb is the first foraging gear, and three new meals cook from what you pick. Meals have their own owner now
(`features/meals.js`, `content/meals.js`), no longer fishing's. This file says what the game does now. The direction lives
in the brief (`/mnt/project-files/briefs/cave-and-gathering.md`) and the "Skills, gathering and items" notes doc.

## Try it

`?mode=sandbox&forest=1` (add `&fresh=1` for a new world) and walk under the pines. Blueberry patches are the knee-high
shrubs with dark berries, lingonberries the low glossy sprigs with red clusters, chanterelles golden rings in the moss
(often by a stump), fly agarics the red caps under birches.

- **E** facing a patch in reach (the pixel prompt `E pick` shows over it): he crouches for half a second, the yield
  floats up (`+4 Blueberries`) and goes in the pouch, with Foraging XP. A soft pluck sound (stand-in sounds for now).
- **Hold E** near patches (one within 3 m, no tree in front of him) and walk: every patch you pass within 0.6 m is picked
  (he stops to crouch for each one). Away from the patches E waves as before.
- **LMB** on a patch in reach picks it (not with the gun drawn or a foe under the cursor).
- **Berry comb** (off hand: Tab > gear, or Shift+Tab in the wardrobe): berry patches are picked without stopping, +1 each.
- A picked berry patch keeps its green twigs, the berries gone. A picked mushroom is gone.
- **Grows back** after its days on the world clock (a day is 20 real minutes): berries 2, chanterelles 3, fly agaric 1.
  Chanterelles also come back when rain starts. `?regrow=0.05` makes it 20 times quicker to test.
- **Cook** at a burning campfire (Tab > Cook), on a stick over the flames: fried chanterelles (3 chanterelles: the ringing
  pick), blueberry soup (5 blueberries: glowing footprints), fish with lingon (1 small fish, 3 lingonberries: fish come to
  your legs), the fly agaric broth (the trip). What each one does, raw, done, just right and burnt: docs/COOKING.md.

Dev: Esc > Sandbox > Gathering: marks on the patches (green dots, red while picked; or `?gathermarks=1`), everything grows
back (offline), a handful of each plant in the pouch. `?forage=0` turns foraging off.

## How it works

- **Patches are the forest's own decor.** `world/forest.js` already places the plants (`F.decor`, seeded, the same on every
  client and the server). A patch's id is its index there (`'d' + i`); nothing new is placed and the layout doesn't move.
  `features/forage.js` builds a grid of 4 m cells over the plant entries once, so finding the patch in front of him is a
  look at 9 cells, never a scan.
- **The picked look.** `world/decor3d.js` keeps each decor entry's flora handle; `world.decor.setPicked(i, on)` swaps a berry
  shrub to its variant with `picked: 1` (the recipe makes every random draw as before and skips only the berries, so the
  twigs stay exactly the same) or hides a mushroom. Forage re-applies its picked set when the world is rebuilt.
- **Sim vs view.** The picked set, the pick under way, the yield roll and the regrowth are the sim (`update`, the feature's
  own seeded generator); the look is applied in `view` only when the set changed.
- **Saved** (offline): `pack.store('forage')` = `{seed, p: {i: the world hour it grows back}}`. Another seed's picks are dropped.

## With friends (co-op)

The server owns which patches are picked (`server/room.mjs`, act `'pick'`). A pick asks it with the patch id and your
Foraging level; it checks the patch is one of the plan's plants, unpicked and within 4 m of you, rolls the yield with your
gear's `forage.*` notes and your level (`content/forage.js`, the same rules as offline), and tells everyone. The picker's
pouch gets it; everyone sees the patch go bare. It grows back on the server's clock (`--regrow` like `?regrow=`); a late
joiner gets the picked patches in the welcome. Nothing is saved locally while online. Rain bringing chanterelles back is
offline only for now (the weather is each player's own).

## Knobs

| Knob | Value | Where |
|---|---|---|
| yield: blueberries / lingon / chanterelles / fly agaric | 3-5 / 4-7 / 2-4 / 1 | `content/forage.js` PLANTS `n` |
| regrowth (in-game days) | 2 / 2 / 3 / 1 | `content/forage.js` PLANTS `days`; `?regrow=` / `--regrow` factor |
| reach past the patch's edge (E, LMB) / held E while walking | 0.9 m / 0.6 m | `content/forage.js` TUNE `reach`, `walk` |
| the crouch / when the pick lands in it | 0.5 s / 0.22 s | TUNE `crouch`, `pluck` |
| XP a pick | 3 / 3 / 5 / 4 | PLANTS `xp` |
| Foraging skill | +2% chance of one more a level | `content/skills.js` `forage.extra` |
| berry comb | +1 on berry patches, no stop | `content/gear.js` `forage.comb` |
| the meals' moods | 180 s done (raw 90, just right 240, burnt 120) | `content/meals.js` TUNE (docs/COOKING.md) |

## Files

`content/forage.js` (data and rules, server too), `features/forage.js`, `content/meals.js` + `features/meals.js` (meals'
owner), `world/decor3d.js` (setPicked), `world/recipe3d.js` (`b.skip()`), `content/recipes.js` (the `picked` param),
`content/items.js`, `content/skills.js`, `content/gear.js` + `ui/gearicons.js` + `ui/geartip.js` (the comb),
`server/room.mjs`, `server/server.mjs`, `features/coop.js`, `net/client.js`, `sim/player/player.js` (`useE`: a held E that
picks doesn't wave), `core/events.js` (forage.pick, forage.grow), `core/flags.js` (forage, regrow, gathermarks),
`audio/audio.js` (stand-ins), `ui/pause.js` (the Gathering group).
