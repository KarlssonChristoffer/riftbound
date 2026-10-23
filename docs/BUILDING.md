# Building and the fly agaric broth

Status: 2026-10-15, the third slice of the "Forage and dig" brief (PR 3 of 4, "Cook and build"). Two new things to set
down in the world (a Crystal Lamp and a Stone Fire Ring), the campfire moved onto the same path so friends share all of
them, and the fly agaric broth: a minute and a half where the world breathes and its colours drift and the Watcher comes out
to stare. This file says what the game does now. The direction lives in the brief
(`/mnt/project-files/briefs/cave-and-gathering.md`) and the "Skills, gathering and items" notes doc.

## Try it

`?mode=sandbox&forest=1&seed=1337` (add `&fresh=1` for a new world). Esc > Sandbox > Building puts a Crystal Lamp's and a
Stone Fire Ring's makings in the pouch; Esc > Sandbox > "Trip" starts the broth's trip without cooking it.

- **Tab > Build** lists three things. Each goes down ahead of you (about a step in front, where you face), on open ground:
  not into a wall, a slope, a stream, or within its room of anything standing. A greyed one says why on hover and as a toast.
  - **Campfire**: 4 logs (as before). E by it adds a log; cook by it while it burns.
  - **Stone Fire Ring**: 6 stone, 2 logs. A wide double ring of cave stone: a log burns half as long again (120 s), it holds
    eight, its light reaches 8.5 m, and its embers glow three minutes. Cook by it like a campfire. Made for the cave.
  - **Crystal Lamp**: 3 Glow Shards, 2 copper ore, 1 log. A little cairn of stone, a copper band, three green shards on top:
    a steady cold green light (6 m) that never goes out. **E** by your own takes it back and gives its makings back.
- **Up to** 3 campfires, 3 fire rings and 8 lamps standing per player; a fourth is refused (`3 stand already`).
- **The fly agaric broth** (Tab > Cook): 1 fly agaric and 2 blueberries or lingonberries, by a burning fire. Drinking it
  doesn't replace the meal you ate (that buff stays). For 90 s:
  - the light's colours drift round the hue circle, out of step with a coloured haze (green, violet, gold ...), easing in
    and out over 4 s;
  - the view sways slowly, as if the world breathed (a few pixels, two slow rhythms);
  - you sway on your feet (spine and head), and friends see that wobble;
  - the Watcher comes out at once (day or night) and openly stares for the whole trip: it doesn't flee or vanish while you
    trip, and goes when the trip ends.
  - Everything but the wobble is private: only the one who drank it sees it. `?trip=20` makes it 20 s.

Saved (offline): every build with its fire's fuel. Fires saved by an older version (the campfire's own save) are moved
over once.

## How it works

- **One path for placed things.** `content/builds.js` is the data (cost, how many, collider and room, the prop, a fire's
  numbers or a lamp's light) and the fire's arithmetic (`fuelAt`, `emberAt`, `stokeFuel`), read by the browser and the
  server alike. `features/builds.js` owns the list: placing, the save, the co-op mail, the meshes, the lamps' lights, and
  the Build recipes in the pack panel. `features/campfires.js` is now only what a fire does: flames (through lights.js
  `F.flame`), its light, E to add a log, `burningNear` for cooking. It reads the list through `builds.list` / `builds.fire(b)`
  and refreshes its own list of fires when `builds.ver` changes.
- **A fire's fuel is a number and a time.** A build holds `fuel` (s of fire) at `t0` (s); what's left now is
  `fuel - (now - t0)`, and the embers glow for `embers` s after it runs out. A log sets `fuel` to what's left plus a log
  (held to `max` logs) and `t0` to now. Nothing ticks per fire per step. The clock is the sim's own offline and the server's
  online (`C.serverNow()`), so a log one player adds burns the same for everyone.
- **The trip is a view.** `features/trip.js` keeps the time left in the sim (it counts down with the steps and emits
  `trip.start` / `trip.end`); its strength `k`, the colour grade and the sway are its view. The colours are a grade over
  the world's mood (`sim/env.js` `setGrade('trip', G)`, the same hook the blood moon uses): the ambient, lift, sun and fill
  gains and a haze, written in place each frame into one object (no allocation), so the drift happens in the lighting
  uniforms on the GPU. The sway is the feature's `camera()` offset. The wobble is `view/livehero.js` reading `trip.k` and
  bending the drawn body's bones; peers are drawn from those bones, so friends see it without any message.
- **The Watcher is told, not written.** `features/watcher.js` has `stare(s)`: it comes out at once and holds still,
  without fleeing, for that long. The trip calls it once per trip from its view.
- **Meals:** `content/meals.js` `fly_broth` has `trip: true`; `features/meals.js` starts the trip for it instead of
  swapping the meal.

## With friends (co-op)

The server keeps the builds (`server/room.mjs`, acts `'build'`, `'stoke'`, `'unbuild'`, and a fire's shared pot: `'pot'`,
`'spoon'`, docs/COOKING.md):

- **build** `{id: kind, x, y}`: within 4 m of the player, at least 0.4 m from every other build, no more of the kind
  standing for that player than its `most`. It gets an id (`'b' + n`) and is told to everyone with its fuel and the
  server's time. The builder's pouch pays when it hears its build stands (the pouch is the client's, as everywhere).
- **stoke** `{id}`: anyone may add a log to any fire that isn't full; everyone's fire takes it, the stoker's pouch pays.
- **unbuild** `{id}`: only your own lamp; it's gone for everyone and your makings come back.
- **pot** `{id: the fire, dish, q}` / **spoon** `{id}`: a shared pot on a burning fire with none, four spoons, one a player
  (docs/COOKING.md).
- Builds stay for the room's life; a late joiner gets them all in the welcome.
- The trip sends nothing: it is private. Friends see the wobble because they see your body.

## Knobs

| Knob | Value | Where |
|---|---|---|
| costs: campfire / fire ring / lamp | 4 logs / 6 stone + 2 logs / 3 shards + 2 copper ore + 1 log | `content/builds.js` BUILDS `cost` |
| how many may stand per player | 3 / 3 / 8 | BUILDS `most` |
| collider / room kept clear | 0.45 + 0.9 / 0.6 + 1.1 / 0.28 + 0.6 m | BUILDS `r`, `room` |
| a log burns / logs it holds / lit with | 80 s, 5, 2 (campfire); 120 s, 8, 2 (ring) | BUILDS `fire.log`, `max`, `start` |
| embers glow / light at full fire | 90 s, 6.5 m (campfire); 180 s, 8.5 m (ring) | BUILDS `fire.embers`, `light` |
| lamp light | 6 m, #b8f0a4, 1.5 | BUILDS `crystal_lamp.lamp` |
| placed ahead / server reach / builds at least apart | 1.15 m / 4 m / 0.4 m | `content/builds.js` TUNE |
| trip length | 90 s (`?trip=` s) | `content/meals.js` `fly_broth.dur` |
| trip ease in and out / hue cycle | 4 s / 0.07 Hz (about 14 s round) | `features/trip.js` TUNE `ease`, `hueHz` |
| how far the colours go / the haze | ±60% ambient, ±50% sun / 0.16 tint at 0.12 | TUNE `amt`, `sunAmt`, `haze`, `hazeA` |
| the world's breathing | 2.5 / 3.5 px at 0.17 / 0.11 Hz | TUNE `breathe`, `breatheHz` |
| the wobble | spine roll 6°, pitch 3°, neck 7° | `view/livehero.js` `wobble()` |

Flags: `?builds=0` turns the build path off (and the campfires with it), `?campfires=0` as before, `?trip=` seconds.

## Defaults this slice picked

- The Stone Fire Ring's numbers are this slice's own (the brief named it without numbers): a better campfire for the cave.
- The trip's "sounds a little lower" is left out: sound work is parked.
- The trip's "private sightings" (night veins glowing in lantern light, the rock-things' legs) came with the living dark
  (`docs/CAVELIFE.md`): they read the trip's `tripping`.
- Season is ignored, the dark does no harm, night ore does nothing yet (the brief's defaults, unchanged).
