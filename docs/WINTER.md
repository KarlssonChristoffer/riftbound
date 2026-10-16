# Winter

Status: 2026-10-16, part 3 of the "Weather, winter and the mire" brief
(`/mnt/project-files/briefs/weather-winter-mire.md`), in progress. This file says what the game does now.

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

## Knobs

| Knob | Value | Where |
|---|---|---|
| prints kept | 4000 (a ring) | `content/prints.js` TUNE `max` |
| snow a print needs | snow cover .5 | `content/prints.js` TUNE `snow` |
| filled by snowfall / gone in the thaw | 1 in-game hour of full snowfall / 30 s | `content/prints.js` TUNE `fill`, `thaw` |
| deep prints | running over 4.5 m/s, a landing | `content/prints.js` TUNE `run` |
| shapes, strides | boot .45 m, hare .9, fox .32, deer .55, bird .16 | `content/prints.js` SHAPES |

## Not in yet

The frost and desert biomes' short-lived prints (`features/atmos.js` PRINT) stay where they were: moving them would change
the arena's golden captures; they can join the print system with the next golden reference. Prints are drawn for the
top-down camera (the chase and first-person cameras don't show them yet, like the frost prints).
