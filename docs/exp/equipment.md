# Experiment: equipment (an active gadget slot)

Risk of Rain's equipment in Riftbound: one active gadget in a slot on **F**, with its own cooldown, next to the weapon
and its abilities. It works the same for the Ranger's bow and the cowboys' revolvers. It is an experiment: **off by
default**, and nothing in the game changes while it is off (the golden captures, smoke and simview pass unchanged).

## Turning it on

- `?equip=1` turns it on (`?mode=sandbox&equip=1`, `?mode=run&equip=1`).
- `?equip=<gadget>` turns it on with that gadget in the slot (a run starts with it too): `flask`, `dynamite`,
  `beartrap`, `scarecrow`, `smoke`, `grapple`, `lasso` (a gun loadout's: [lasso.md](lasso.md)).
- Menu > Dev > Features > **Equipment** switches it any time (remembered on this machine, `localStorage`
  `riftbound.equip`); `?equip=0` forces it off.

## Controls

- **F**: hold to aim (a crawl of glowing dots shows the throw's arc, a ring where it lands, as big as what it does
  there), let go to throw at the ground under the cursor. A tap throws at once. Over an enemy the cursor aims at its feet.
  Let go mid-leap or while knocked, it goes as soon as you can (up to half a second later). Opening the menu mid-aim
  doesn't throw: the aim waits for F again. With the bow drawn, a throw doesn't cost you the arrow.
- Feedback: a '!' pops over an enemy the scarecrow takes, a '?' over one that lost you in the smoke; a gadget lying on
  the ground still cooling down draws only the ready part of its ring.
- **E**: take a gadget lying on the ground (the one you had drops at your feet: swap back any time), buy the stage's cache.
- Sandbox: menu > Game > **Gadget: ... (next)** cycles the slot, **Spawn a pack of brutes (gadget test)** gives it
  something to work on; **Shift+F** cycles it too (dev mode); Dev > Features > **Gadget** picks one.
- F is a dev key (the flames' look in `features/lights.js`): while the experiment is on it takes F, also outside dev
  mode (`F.claims` in `core/input.js`). Off, F is the flames' look as before.

## The gadgets

| gadget | cd | what it does |
|---|---|---|
| **Fire Flask** | 12 s | Shatters where it lands, or on the first body it meets: a pool of burning oil 1.9 m round for 5 s. Whoever stands in it takes 18 dps (ticks of 9) and burns on for 1.6 s after (7 dps); the splash does 10 (6 round it). Wood in it catches through the game's own fire (`lights.js`: crates and barrels char, spread, burn through; kegs cook off). In the stream it fizzles. Looks: scorched oil on the ground taking the fire's light, a glow, the game's 3D flames, flame pixels, embers, smoke, a scorch mark after. |
| **Dynamite** | 15 s | A lit bundle: it lands 3/4 of the way to the mark, bounces, rolls on to about the mark and goes off 1.5 s after the throw: combat's explosion (3.2 m, 95 damage with falloff): crates break, props are thrown, powder kegs chain, every `combat.explode` reaction (wind gust, grass, wildlife, music...). Wood the blast leaves standing may catch (35%). It bounces off props, walls and heads; in the stream it sinks and blows under water. |
| **Bear Trap** | 10 s | Thrown open, armed after 0.45 s (a faint ring shows its bite). The first enemy that steps in takes 30 (a stage-1 brute is left on 10: the hold sets up the kill) and is held 4 s (elites 2.6, the champion 1.5; combat's own root, so the HP bar turns blue and the root pegs show). Unsprung it rusts away after 30 s. |
| **Scarecrow** | 22 s | Planted where it lands for 8 s (a collider: nothing stands in it). Every enemy within 12 m goes for it instead of you and whacks it with its own damage (260 hp). |
| **Smoke Bomb** | 18 s | Pops where it lands: a thick cloud 3.3 m round for 6.5 s (soft HD puffs drawn over what is in it: you vanish in it). While you are inside (and 0.8 s after) you run 35% faster (a `host.mods` note on `player.speed`) and every enemy has lost you: they wander. An enemy inside it is lost too. |
| **Lasso** (a gun loadout's: a cowboy starts with it) | 1.4 s | Hold F: the loop spins overhead; let go: it's thrown at what's under the cursor. Rope an enemy (it can't fight; tap F: yanked off its feet, stunned; hold F: swung round you and flung), tow a barrel or a crate, pull a lit brazier over, drag a tumbleweed home, or catch a high limb and swing (over the stream, off and onto the plateau). Its own doc: [lasso.md](lasso.md). |
| **Grappling Hook** | 7 s | The hook flies straight (34 m/s) to what is under the cursor: an enemy, else a solid prop within 1.1 m of the cursor (tree, rock, pillar, crate, a wall), else the ground; it bites what it meets on the way. It then pulls you there at 17 m/s (the player's own knock, re-applied each step) and you glide in the last 2 m; an enemy at the end takes a flying kick (30). |

Damage numbers are stage 1 without items; in a run every gadget's damage is multiplied by the build's damage stat and
by (1 + 0.4 x the stage). The cooldown is the gadget's own: a dropped gadget keeps counting down on the ground, so
swapping never resets one.

## Getting gadgets

- **A run**: every stage an **equipment cache** stands by the spawn ring (a crate on a stone step, its gadget floating
  over it with a beam and a ring of its colour); E buys it: 20 gold on stage 1, +10 a stage. A chest has a 20% chance
  to drop one beside it. You start a run with none (unless `?equip=<gadget>`).
- **The sandbox**: the menu rows above; it starts with the Fire Flask.

## How it is built (files)

- `src/features/equip.js`: the feature (the toggle, F, the menu rows, the names over the cache and pickups).
- `src/features/equip/sim.js`: the truth: the slot and cooldown, the aim, the throws (sub-stepped flight, bounces,
  rolling), the pools, traps, scarecrows (entities, kind `scarecrow`), clouds, the hook, pickups (kind `gadget`), the
  run's cache (kind `gadget_cache`), the afterburn, the smoke's speed note, the lure. Its own seeded generator; fixed
  steps; nothing read back from the view.
- `src/features/equip/look.js`: the view: sprites, particles (typed arrays, capped at 900), soft puffs (160), the preview,
  the pools' ground / emit layers and flames, the clouds, scorches, lights.
- `src/features/equip/art.js`: the pixel art, painted once at first enable: 8 turns of each thrown thing, the scarecrow
  (still, leaning, flinching, fallen), the trap (open, shut), the cache (shut, open).
- `src/ui/equipslot.js`: the HD slot right of the ability bar (clear of the gun's cylinder): glyph, cooldown sweep and
  countdown, F, flashes, tooltip. Its still parts and digits are cached.
- `src/content/gadgets.js`: every number (the tuning knobs).

Small additive changes in other areas' files (each named in its commit):

- `world/nav.js`: `nav.addLure(fn)`: other systems' say over where an enemy goes (asked first in `steer`).
- `features/combat/core.js`: `core.root(p, sec)`: hold a brute where it stands.
- `features/lights.js`: `F.ignite(p)` (set a prop alight through its fire) and `F.flame(...)` (draw a flame of its look).
- `core/input.js`: `F.claims(k)`: a feature may take a dev key for play while it is on.
- `core/features.js` (load order: `equip` right before `lights`), `core/flags.js` (`equip`), `core/events.js`
  (`equip.*`), `audio/audio.js` (the events on the closest existing sound recipes).

## Tuning knobs

All in `src/content/gadgets.js`:

- `GADGETS.<id>`: `cd`, `range`, and each one's own numbers: the flask's `r`, `dur`, `tick`, `dps`, `splash`, `after`,
  `afterDps`; dynamite's `fuse`, `r`, `dmg`, `lead` (how far its first landing falls short), `bounce`, `keep`, `roll`,
  `ignite`; the trap's `arm`, `trig`, `dmg`, `root` (+ elite / boss), `life`, `hold`; the scarecrow's `dur`, `hp`, `lure`
  (m), `stop`, `reach`; the smoke's `r`, `dur`, `grow`, `fade`, `speed`, `linger`, `wander`, `every`; the hook's `speed`,
  `pull`, `max`, `stop`, `dmg`, `snap`.
- `SHOP`: the cache's `cost` and `perStage`, a chest's `chest` chance.
- `THROW`: the lob's time (`t0`, `tk`, `tMax`), gravity `g`, the hand's height, the shortest throw.
- The run's damage scaling: `dmgK()` in `features/equip/sim.js`.

## Tested

- Off (the default): golden vs `tmp/golden/ref4` 16/16 identical, smoke all passed, simview identical (views, 30 / 240
  fps).
- On: `tmp/exp-equipment/simview_eq.mjs` (a copy of simview on its own ports, three scenarios using every gadget in the
  sandbox and in a run, the equipment's state in the digest): the sim comes out the same without its views and at 30 /
  60 / 240 fps. A `?owncheck=1` session with every gadget: no foreign writes. No console errors or warnings.
- Scripted headless sessions throwing each gadget into packs of brutes, the run's cache across two stages, the gun
  loadouts, the stream, a pause mid-aim (captures and GIFs in `D:/Game/tmp/exp-equipment/`).
- Perf (`?perf=1`, headless 1920x1080, a pack of brutes with every gadget kept busy for ~10 s, ms a frame): equip.update
  .016, view .020, frame .090, lights .006, hd .049. Off: nothing runs. With fires, blasts and smoke going the frame's JS
  goes ~1.9 -> ~2.9 ms (most of it the other systems drawing what the gadgets set off: lights' flames, combat's
  particles), p95 3.9 of the 4 ms budget.

## Open design questions

- **Should gadgets hurt you?** The dynamite only knocks you back (combat's explosion without the keg's self-damage),
  the fire pool doesn't burn you. RoR's are friendly; a western one might want risk (stand in your own fire, get blown
  up by your own dynamite).
- **One slot or more?** RoR has one active equipment; a second (Q-swap) or charges (dynamite x2) would change pacing.
- **How gadgets enter the build.** Now: a cache per stage + a chest's chance. Alternatives: a merchant (the garden's
  stall), elites dropping them, an augment that gives two charges or halves the cooldown, items that scale them
  ("Powder Horn" for dynamite radius...).
- **Throw or place?** The trap and the scarecrow could be placed at your feet with a tap and thrown when held.
- **The scarecrow's pull is absolute** (every enemy within 12 m goes for it, even one next to you). A softer version
  could weigh distance to you vs to it, or let the champion ignore it.
- **The desert's gunmen** don't care about the scarecrow or the smoke yet (they have their own AI and nav in
  `features/foes/sim.js`): the next step would be a lure there too (they shoot the scarecrow, lose you in the smoke).
- **Grapple onto ledges**: the hook pulls along the ground (the player's knock); pulling up onto the plateau would need
  a player API (a leap toward a point).

## Next steps

- Sounds of their own (the forge): a glass smash with a whoomp, a fuse hiss, a jaw snap, a smoke pop, a rope zip; now
  they borrow existing recipes.
- A throw animation (a wind-up while F is held; now a held 'lunge' frame as it leaves the hand).
- Draw thrown things between sim steps (they move at 60 Hz; at 164 Hz the flight could be smoother with the registry's
  lerp).
- More gadgets: a bell (enemies stunned in a ring), a lantern of will-o'-wisps (homing lights), a powder keg on a
  cart (push it), a shield charm (a bubble that eats one hit), a magnet (pulls coins and loose props).
- Elite affixes and shrines (the other experiments) could interact: a fire flask setting a glacial elite's ice to
  steam, shrines that refill the cooldown.
