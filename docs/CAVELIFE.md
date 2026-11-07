# The living dark

Status: 2026-10-15, the fourth slice of the "Forage and dig" brief (PR 4 of 4, "The living dark"). The cave gets things
living in it and things hidden in it: the lantern is yours to put out, loose rocks that aren't rocks, soot-black things
that put lanterns out and shun lamp light, veins that show only in the dark, and hollow walls with a sealed room behind.
This file says what the game does now. The direction lives in the brief (`/mnt/project-files/briefs/cave-and-gathering.md`).

## Try it

`?mode=sandbox&forest=1&seed=1337` (add `&fresh=1` for a new world), walk down into the cave. Esc > Sandbox has jumps:
"Mining: to a hollow wall", "Mining: to a night vein", "Cave life: to the soot things' roost", "Cave life: to a
rock-thing", and "Mining: open the hollow walls (offline)". `?gathermarks=1` puts dev dots over all of them.

- **The lantern key.** Down in the cave **L** puts your lantern out and lights it again (a click). Up in the woods L is the
  lantern switch as before. Out means out: a lantern your gear keeps lit goes out too.
- **Rock-things.** Some of the loose rocks by the passages' walls (6-10 a cave) aren't rocks. Stand by one a moment and it
  unrolls on many pale legs, skitters off a few metres into the dark and curls up again. While you trip on the fly agaric
  broth their legs show even when they're curled up.
- **Soot things.** 2-4 small soot-black fluttering things roost in the cave's far rooms. When one sees a lit lantern
  (within 7 m, and no farther than 16 m from home) it comes at it, the others with it; they circle your head, two pale eye
  glints, and put the lantern out (a breath and a flutter). Then they fly home and rest 12 s. The lantern lights again by
  itself after 4 s, at once if you step up to a cave crystal or into a lamp's or a burning fire's light. They never come
  within 6 m of a Crystal Lamp or a burning fire (a lamp by their roost keeps them home), and turn back if they fly into
  one's light. A lantern that is out (your L, or theirs) doesn't draw them.
- **Night veins.** 1-2 veins in the far half of the cave show only in the dark: no lit lantern, lamp or burning fire
  within 6 m. Then they glimmer like a piece of night sky; light them and they're bare rock again (the pick can't find
  them either). Tripping, you see them even by lantern light. Six blows give 1-2 Night Ore (it does nothing yet).
- **Hollow walls.** 1-2 spots on a chamber's wall where rubble stops a short neck into a sealed room. Tells: near one, your
  lantern's flame leans toward it, and every few seconds dust trickles down it. A pick blow there knocks hollow, low and
  boomy. Six blows and it caves in: the room behind it is open (for everyone, for good), and on its floor lie 3 copper ore,
  3 Glow Shards and a keepsake (a notched tally stick, or a tooth too big for any animal you've seen).

## How it works

- **The plan** (`world/caves.js` `darkPlan`, after the veins, each part from a generator of its own so nothing placed before
  moves): night veins and hollow walls are more veins in `C.veins` (kinds `night`, `hollow`, after the old ones, so their
  indices stay); `C.hollows` the sealed rooms (their mouth, the room's middle and radius), carved into the cave's grid before
  anything reads it, deep in rock all round; `C.soot` the roosts (in rooms past 60% of the cave's depth); `C.critters` the
  rock-things' spots (by the passages' walls, among the loose rocks); `C.depth` each room's share of the cave's depth.
- **The lantern** (`features/caves.js`): down there its state is the feature's own (lit, off by L, snuffed with a relight
  time). Lit, the notes are the old ones (`light.lantern` +1, `light.lanternR` x2); out, `light.lanternOut` +1, which
  `render/lighting.js` reads as out whatever else lights it. `caves.snuff()` puts it out (the soot things).
- **The soot things' rules** (`sim/cavelife.js`, pure): each roosts, seeks the nearest lit lantern it sees, circles, snuffs
  (an event), goes back, rests. Offline `features/cavelife.js` runs them with its own seeded generator; online the server
  runs one flock for everyone (as it runs the night elk), the lamps and burning fires from its builds.
- **The rock-things** are a view: each player's own, from the view's generator, in the seeded spots.
- **Night veins** (`features/mining.js`): each step the dark round each one is checked (his lantern, a friend's lit lantern
  from their last snapshot, the builds that shine: `builds.shining` / `shineNear`); hidden, its mesh is off and the pick's
  searches skip it. Its specks are the `paleglow` family lit with `mesh.setGlow`, twinkling.
- **Hollow walls** (`features/mining.js`): the plug is the vein's mesh (rubble stacked into the neck, cracking in stages; a
  rubble heap once open), a collider stops the neck, and a block of the dark fills the room up over the walls' tops (the
  camera looks down over the chamber's wall into it). Opening it spends the vein for good, takes the collider and the dark
  away, and spawns the cache as chunks on the room's floor. The tells are `features/cavelife.js`'s view: `F.lean`
  (`render/lighting.js` moves the lantern's light toward it, flickering) and the dust.

## With friends (co-op)

- Each player's state says whether their lantern burns in the cave (`lt`); the server's snapshots carry it on to everyone
  (a row's 11th field) and the soot things' places (`sn`: x, y, h, mode each). The soot things go for whichever of you is
  lit; a snuff is an event to everyone (`{k: 'ev', a: 'snuff', id}`), and only its target's lantern goes out.
- A friend's lit lantern near a night vein hides it for you too (turn your lights off together).
- A hollow wall is a vein to the server: blows from anyone, and the last one opens it for everyone for good (it never comes
  back). Everyone online when it opens gets their own cache on the room's floor; a late joiner finds it open and empty.
- The rock-things are each player's own (roughly the same for everyone: their spots are the seed's).

## Knobs

| Knob | Value | Where |
|---|---|---|
| soot things per cave (in the last part of it) | 2-4 (their roosts) | `world/caves.js` TUNE `dark.soot`, `sootFrom`; `?snuffers=` / `--snuffers` |
| soot: sees a lantern / leash / speed / circles / rests | 7 m / 16 m / 3.2 m/s / 1.8 s / 12 s | `content/cavelife.js` SOOT |
| soot: keeps away from a lamp or burning fire | 6 m | SOOT `lamp` |
| lantern relight after a snuff | 4 s (at once within 1.2 m of a crystal, or 4 m of a lamp or burning fire) | `content/cavelife.js` LANTERN |
| rock-things per cave / wake within / trot / speed / rest | 6-10 / 2 m (0.6 s) / 3-6 m / 2.4 m/s / 6 s | TUNE `dark.critters`; `content/cavelife.js` CRITTER |
| night veins / hollow walls per cave | 1-2 / 1-2 | `world/caves.js` TUNE `dark` |
| how dark it must be for a night vein to show | no lit lantern, lamp or fire within 6 m | `content/mining.js` TUNE `night.dark` |
| night vein / hollow wall blows | 6 / 6 | `content/mining.js` VEINS |
| a hollow room's cache | 3 copper ore, 3 Glow Shards, a keepsake | TUNE `cache`, `keep` |
| the lantern's lean / the dust | up to 0.22 m within 5 m / every 2.5-5.5 s within 7 m | `features/cavelife.js` LEAN, DUST |

Flags: `?cavelife=0` (no rock-things or soot things), `?snuffers=n`. Server: `--snuffers n`.

## Defaults this slice picked

- The dark does no harm (the soot things only put your lantern out), night ore does nothing yet, season is ignored (the
  brief's defaults).
- Online, the cache is each present player's own; a late joiner gets none.
- The lantern relights by itself after 4 s (the brief named the 4 s; it didn't say whether you relight it yourself).
- The rock-things aren't 3D twins of the painted loose rocks: they're 3D lumps of the same rock colours.
- Friends' lanterns aren't drawn as lights on your screen yet (they still count for the soot things and the night veins).

## Files

`content/cavelife.js`, `sim/cavelife.js`, `features/cavelife.js` (new); `world/caves.js` (`darkPlan`), `features/caves.js`
(the lantern), `features/mining.js` (night veins, hollow walls), `content/mining.js`, `content/items.js` (night ore,
tally stick, big tooth), `features/builds.js` (`shining`, `shineNear`), `render/lighting.js` (`light.lanternOut`, the lean),
`features/coop.js` (`lt`, `litNear`), `net/client.js` (`lt`, the soot rings), `server/room.mjs`, `server/server.mjs`,
`audio/audio.js` (the hollow knock, the lantern's sounds, a skitter, a cave-in), `core/events.js`, `core/flags.js`,
`core/features.js`.
