# Keepsakes

The odd things the forest's and the cave's secrets leave you. Each is a pouch material (`content/items.js`) and a charm
(`content/gear.js`, slot `charm`, two places: `SLOT_CAP`). Worn while the pouch holds one, each bends one rule of the world.
Nothing in the game says which: no stat line on its card, no toast. You find out.

Code: `content/keepsakes.js` (ids, notes, numbers), `features/keepsakes.js` (the feature), `sim/keepsakes.js` (the doll's
rules, pure), and the owners of the rules they bend (below). `?keepsakes=0` turns the rules off; the items stay.

| Keepsake | Where it comes from | What it does worn | The catch | Who applies it |
|---|---|---|---|---|
| Heron Feather | the heron's ring (uncanny) | stand still 3 s in shallow water: fish shadows rise round your feet; E jabs for a fish of that water | no bait, no spot, no finds, nothing past rare; a jab or a step scatters them for 12 s | `features/keepsakes.js`, `features/fishing.js` (come, grab), server `fish {a: 'grab'}` |
| Warm Stone | the quiet stones (uncanny) | a snuffed lantern relights in 1 s, not 4 | (weather: cold and lake ice, hooks `STONE.cold`, `STONE.melt`) | `features/caves.js` (`cave.relight`) |
| Big Tooth | a hollow wall in the cave | the soot things break off 5 m from you; rock-things flee from 6 m | the forest animals take you as 1.8x as loud | `sim/cavelife.js` (shun), `features/cavelife.js`, `features/fauna.js` (`fauna.loud`) |
| Tally Stick | a hollow wall in the cave | it counts (spoiler below); at 10 it is the Full Tally Stick | | `features/keepsakes.js` |
| Full Tally Stick | the Tally Stick, full | the soot things never hunt you; one or two may go with you a while | | `sim/cavelife.js` (kin, ESCORT) |
| Bark Doll | the marks' hollow (uncanny) | it creaks when you come within 12 m of a secret | | `features/keepsakes.js` |
| Fiddle String | the spring at dusk (uncanny) | ground animals within 20 m drift after you and trail at 5-8 m (3 at most); face one and it freezes; run and they bolt | the Watcher comes twice as often; its card lies | `features/fauna.js` (`fauna.lure`), `features/watcher.js` (`watcher.every`) |

The night elk's knock takes a keepsake you aren't wearing first, then one you are (`features/uncanny.js` KEEPS).

## The Keepsake Shelf
A build (`content/builds.js` keep_shelf: 3 logs, one per player, 5 places). E by it puts one of your keepsakes on (one you
aren't wearing first) or, with none to put, takes yours back. Anyone may put one on any shelf; only who put it there takes it
back. They stand on its plank as their own icons.

The Bark Doll on a shelf turns its head slowly (30 deg/s, a look every 2 s) toward the nearest secret: the heron's ring, the
quiet stones, the marks' hollow, the spring (each while not spent), a hollow wall not yet open (from the surface: the cave's
mouth), and, for your head only, the old miner's pick if you have none. None left: it faces you. One dawn in 4 a doll on a
shelf on the surface walks 15-30 m toward that secret, onto open ground (no lake, stream, spring, trunk or the cave's slot), at
most 5 times; E by it brings it home (anyone).

Round a shelf, each player's own view: the Warm Stone steams at dawn, the Tally Stick scratches at midnight, the Fiddle String
plays three notes at dusk.

## Co-op
The server owns the shelves and what stands on them (`server/room.mjs` shelf: acts `shelve`, `unshelve`, `fetch`; world
messages `s: 'shelf'`), the dolls' dawn walks (the same `sim/keepsakes.js`), the heron's jab roll, the spring secret, and who
the soot things shun or count as kin (from the set worn). A friend's feather shadows and string lure are drawn on your screen
from their set. Late joiners get the shelves in the welcome, like builds.

## Dev
Esc > Sandbox: "Keepsakes: give all", "+1 notch", "the shelves' dolls walk now", "to the spring". Flags: `?tally=n`,
`?dollwalk=always`, `?keepsakes=0`. The uncanny forest is off by default: `?uncanny=1`.

## Spoiler: the Tally Stick
It counts **midnights spent underground**. Each time the clock passes 00:00 while you wear it down in the cave
(`features/caves.js` F.down): a notch on its icon and a dry scratch. At 10 it becomes the Full Tally Stick, worn in its place.

## Left out (for now)
- Warm Stone's weather half (cold builds slower, melting a hole in lake ice): named hooks `STONE.cold`, `STONE.melt`.
- Round a shelf: the grey heron by the feather, animals going round the tooth, animals listening to the fiddle string.
- The Fiddle String's "hums when something hunts you" style lies are only lies; there is no hum.
