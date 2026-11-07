# Winter

Status: 2026-10-16, part 3 of the "Weather, winter and the mire" brief
(`/mnt/project-files/briefs/weather-winter-mire.md`). Lying snow you wade in, tracks, snowballs, the lake ice (it freezes from
the shore out, sings, has thin spots you go through), holes cut with a pick or an axe, jigging through them, the winter's
fish, and something under the ice. This file says what the game does now.

## Try it

`?mode=sandbox&forest=1&season=winter&weather=snow` (the snow builds over the in-game hours; `&ice=1` the lake frozen now).
Esc > Sandbox has Winter (a snowball at me, one in my hand), Ice (take me to the lake, the nearest thin spot, a hole here, the
thing under the ice now) and Tracks (clear all).

## Snow

- **Depth.** The lying snow is `snowCover x 45 cm` deep. At full depth you walk 25% slower and sink a little into it (the sprite
  goes down by 7 art px). The moose-hide boots take all of it away (their tooltip: "snow and soft ground don't slow you").
  Nothing in the cave, the hut or on water.
- **Snowballs.** Hold E on lying snow, standing, with empty hands: half a second and you hold a snowball. LMB throws it at the
  cursor (a lob, 18 m at most). It bursts on the ground or a tree. A hit on a friend staggers them a little, leaves a white splat
  on them for 10 s, and one time in five knocks their hat off (it lands; they walk over it to put it back on). Gentle: never any
  damage. Online the thrower's client decides the hit and the server passes it on (`snow` message).

## Tracks

Everything that walks on the forest's snow leaves prints: you (your steps, deeper when you run or land), every friend
(from their snapshots), and the hares, the fox, the roe deer and the capercaillie on the ground. A hare's print is two
long hind feet ahead of the small fore feet, the fox's one neat line, the deer's a cloven hoof, a bird's three toes and
one back. They need lying snow (snow cover over a half), never on water or in the cave. Fresh snowfall fills them back
in (an in-game hour of full snowfall, a light fall slower); with no snowfall they stay till the snow under them melts
(then they go in 30 s). At most 4000 at once; the oldest go first. `?tracks=0` none. Esc > Sandbox: "Tracks: clear all".

Each client keeps its own (the brief's call: a late joiner doesn't see old tracks).

### For other features: the print system

`features/prints.js` is the one owner of footprints and tracks (`/mnt/project-files/briefs/depth-shared.md`). Another
feature that wants prints (a meal's glowing prints, a living animal's muddy track) uses its calls, never a copy:

- `prints.stamp(x, y, z, dx, dy, shape, surf, o)`: one print. `shape`: a `content/prints.js` SHAPES name (boot, hare, fox,
  deer, bird; add one there). `surf`: what it's printed in (snow, mud, glow; add one in SURF or at load with
  `prints.surface(name, {col, life | hours, emit, fade})`). `o.col` a colour of its own, `o.deep`, `o.key`.
- `prints.walk(key, x, y, z, shape, surf?)` every frame for a walker: one print per stride, left / right. Without `surf`,
  the surface under it (`prints.surfaceAt`); `prints.rule(fn)` adds a rule tried first (mud on wet ground).
- `prints.wear(surf, k)`: wear that surface's prints by k (1 = gone): rain washing mud out. Each surface has one wear clock
  (nothing ticks per print).
- `prints.near(x, y, r, out)` -> indices; `prints.X / Y / DX / DY / SH / SU / KEY`, `prints.wearOf(i)`: "is there a track
  here" (it walks the ring: not every frame over a big r).

The prints are drawn in the ground layer (`G.glayer('ground')`, GPU quads), before the light: the shade replaces the
ground's colour, so the light and the shadows fall on them as on the snow round them.

## The lake ice

- **When.** The ice is the clock's: it starts in winter, thickens through it (walkable at 35 cm, about 43% into winter: the
  second winter night at 3-day seasons), tops out at 50 cm, and melts over the first third of spring. Everything is a share of
  a season, so it keeps its place in the year when the seasons get longer. Every client and the server compute it, no message.
  It freezes from the shore out (the shelf first, the deep last), black at first, greyer as it thickens, with cracks, frozen
  bubbles, and the snow lying on it.
- **Where it holds you** there is no water for the game: no swimming, no wading, no fishing, no rain rings.
- **Thin spots**: where the stream comes in, where the outflow leaves and over the deepest water the ice is 60% as thick
  (grey and wet). Under 35 cm it cracks under you (white cracks spread from your boots); after 1.5 s on it you go through.
  You're held in the hole, soaked: hold Space 1 s to climb out (2.5 s in the mail shirt; half with a friend within 2 m).
  Climbing out chills you. The hole stays open till it freezes over (a third of a season).
- **On the ice** your starts and stops slip (x.35; the snow on it gives the grip back).
- **Holes**: LMB on the ice with a pick (3 blows) or an axe (4) in the bag cuts a hole. Online the server keeps the holes
  (act `hole`; world `i` + n, gone when frozen over); offline they're saved.
- **The jig**: with the rod, a press near a hole drops the line straight down it. The wait only runs while you jig: lift the
  rod (LMB) every .55 to 1.9 s. Faster spooks the fish. Strike the bite as usual.
- **Winter fish** through the ice: perch x1.3, burbot x2 at night, char x1.5, pike x1.2, bream and tench x.3
  (`content/fishing.js` WINTER; the server rolls the same).
- **Singing**: on a cold clear night the ice sings now and then (an `ice.sing` event: no sound yet, the game has none for it).
- **Something under the ice**: one visit in three to the ice, something long and dark slides up beneath you, follows when you
  walk and stops when you stop. It keeps to the deep and goes after a while. Your own, nobody else sees it.

## Knobs

| Knob | Value | Where |
|---|---|---|
| prints kept | 4000 (a ring) | `content/prints.js` TUNE `max` |
| snow a print needs | snow cover .5 | `content/prints.js` TUNE `snow` |
| filled by snowfall / gone in the thaw | 1 in-game hour of full snowfall / 30 s | `content/prints.js` TUNE `fill`, `thaw` |
| deep prints | running over 4.5 m/s, a landing | `content/prints.js` TUNE `run` |
| shapes, strides | boot .45 m, hare .9, fox .32, deer .55, bird .16 | `content/prints.js` SHAPES |
| snow depth, slowdown, sink | snowCover x .45 m; walk -25%, 7 px at full; moose boots none | `content/winter.js` TUNE `snow`; gear `soft.slow` |
| snowball | .5 s to make, 13 m/s, 18 m; push 2.4 m/s, splat 10 s, hat off 20% | `content/winter.js` TUNE `ball` |
| ice growth | 0 -> walkable .35 m at 43% of winter, max .5 m, thaws in 1/3 of spring | `content/ice.js` TUNE `grow`, `walk`, `max`, `thaw`; `?ice=1` |
| thin ice, the tell | x.6 within 2.6 m of the inflow, outflow, deepest; cracks under .35 m, through after 1.5 s; open water under .15 m | `content/ice.js` TUNE `thin`, `thinR`, `walk`, `crack`, `tell` |
| climbing out | hold Space 1 s (mail shirt 2.5 s), a friend near x.5; chill +.35 | `content/ice.js` TUNE `climb` |
| holes | pick 3 / axe 4 blows, r .5 m (going through .8 m), frozen over in 1/3 of a season, at most 8 | `content/ice.js` TUNE `hole` |
| slip on the ice | starts and stops x.35 | `content/ice.js` TUNE `slip` |
| jig | a lift every .55-1.9 s keeps it working 1.4 s; too soon +1.2 s | `content/fishing.js` JIG |
| winter fish | perch 1.3, burbot 2 at night, char 1.5, pike 1.2, bream / tench .3 | `content/fishing.js` WINTER |
| the thing under the ice | 1 visit in 3 (30 s off the ice between visits), 35-60 s | `features/ice.js` THING |

## How it works

- `features/winter.js`: the depth -> modifier notes (source `winter`: `player.speed`, and `player.sink`, a new stat
  `sim/player/player.js` reads: what he stands in sinks him; the mire uses it too); the snowballs' flight in fixed steps.
- `features/ice.js` + `sim/ice.js` (pure, the server's too): the thickness from the year (`env.year`), the thin spots from the
  forest plan, the holes. It sets `world/layout.js` `ICE.solid`, read by `inStream` (no deep water where it holds) and
  `world.js` `waterSample` (no water: wading, fishing, a body's wet). The bakes read the painted water (`waterRaw`). Going
  through: a hole opens under him; the `player.stuck` note (new in `sim/player/player.js`: no walking, no roll, no swim drift)
  holds him till he climbs out. The look: `render/gfx.js` `wIce` in the water shader (`G.setIce` on a change; integer hashes).

## Not in yet

The frost and desert biomes' short-lived prints (`features/atmos.js` PRINT) stay where they were: moving them would change
the arena's golden captures; they can join the print system with the next golden reference. Prints are drawn for the
top-down camera (the chase and first-person cameras don't show them yet, like the frost prints). No sounds for the
cracks, the singing, a snowball (the game has no sound pass for them; the events are there). A friend's lasso doesn't pull you
out of the ice yet (a friend standing near halves the climb). The hat knocked off lies only on your screen. Fish under the
ice aren't drawn through it (the thing under the ice is).
