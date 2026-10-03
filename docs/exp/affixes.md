# Elite affixes (experiment, branch `exp/affixes`)

Risk of Rain style elite affixes for the run. Elites and champions roll an **affix** that changes how they fight
**and** how they look; on later stages a regular brute may roll one too. Every threat is telegraphed and readable at
the game's pixel scale, and every one can be avoided with the dodge roll or by walking out of it.

Status: a playable prototype, **off by default**. Nothing changes unless it is turned on.

## Turning it on, trying it

- URL: `?affixes=1` (`?affixes=0` forces it off). Example: `http://localhost:8123/src/?mode=run&affixes=1`
- Menu: **Dev > Features > Elite affixes** (dev mode: the sandbox, `?dev=1`, or the key left of 1). The choice is
  remembered on this machine (`localStorage 'rb.affixes'`).
- In a run it just happens: from wave 3 of stage 1 every elite has an affix, most champions do, and from stage 2 now
  and then a regular brute ("Blazing Brute").
- **Sandbox, to try one** (feature on, dev mode):
  - Menu > **Game**: `Try: Blazing Elite` ... `Try: Vampiric Elite`, `Try: one of each` (spawns ~5 m from you)
  - Key **`.`**: the next affix's elite; **Shift + `.`** (`:` on a Nordic keyboard, `>` on a US one): its champion
  - The sandbox doesn't count hurts; while affixed enemies are about, the hurts you *would* have taken float up in red.
- The first time an affix shows up in a run (or a sandbox session) a card at the top left gives its name, in its
  colour, and what it does.

## The affixes

| affix | colour | its mark | what it does | how you beat it |
|---|---|---|---|---|
| **Blazing** | orange | a crown of fire | every landing leaves a **burning patch** (an ember for 0.3 s, then fire for 2.6-4.6 s that hurts while you stand in it; a wooden prop it touches catches fire, and lights.js
  spreads it). Dying: a ring closes for 0.8 s, then it **bursts into flame** (damage + knock) and leaves patches round where it fell | keep moving off its trail; don't finish it next to you, or roll through the burst |
| **Glacial** | ice blue | ice spikes, rime under it | its blows **chill** you (run speed x0.58 for 2.2 s on an elite). Dying: a **frost nova** fills out from it for 1.25 s, then goes off (damage, knock, a 3 s chill) | don't trade blows; walk or roll out of the nova |
| **Overloaded** | violet | a storm cloud over its head | every ~3.4 s while you're within 13 m it **calls lightning**: a strike on you and (elite) one where you're heading, (champion) one more round you. Each is a hatched violet zone with a ring closing in for 1.15 s, a leader flickers down, then the **bolt** (damage + knock). Dying: a last discharge round where it fell | step out of the zone or roll at the last moment; don't stop in your own path |
| **Splitting** | green | a blob dividing in two | dying, it **splits** (0.35 s later) into 2 / 3 / 4 **Splitlings**: quicker, smaller hops, weaker, they don't split again | AoE: explosive arrow, arrow rain, the trap |
| **Warded** | gold | a curved wall of gold light in front | a **ward** in front of it stops arrows and bullets ("blocked") until broken (60 on an elite), then grows back after 7 s. It turns after you at 32 deg/s: **you can outrun it by circling**. Falling arrows (rain), blasts and traps go round it; a **piercing shot** hits it 3x as hard and goes on through when it breaks it; revolver bullets break it in ~3 shots | flank it, blow it up, pierce it |
| **Vampiric** | crimson | a beating blood drop | every ~5 s within 5.5 m it **reaches a beam** out to you (a dotted line crawling to you for 0.8 s: the telegraph), then **latches**: a pulsing beam drains you (6 dps on an elite) and heals it 3x that. Its blows heal it 2x their damage | break the beam: a **dodge roll**, get beyond 7 m, or put **cover** between (a wall, a crate, another body) |

Every affixed enemy also gets: a mark over its head (emissive: it reads at night too), its name prefixed ("Overloaded Elite Brute"), the aura ring, light and nameplate in
its colour (the game's own, which take `aura`), its HP bar and the champion's boss bar in its colour (`bar`), and 1.5x
the coins (a regular brute with an affix: 1.7x health, 1.2x damage, 3-6 coins).

**Fairness, measured** (scripted bots in the sandbox, `tmp/exp-affixes/bodies/fair.js`): standing still, a bolt does 12,
a nova 8 + a chill, a fire patch 8 dps; rolling at the last moment or walking out at once takes **0** from strikes and
novas; a roll cuts a drain from 30 to 6. In a run the game's hurt flicker (0.9 s of i-frames after any hit) also
spaces out the damage of patches and drains. Hazard damage scales with the stage like everything else (x1.25 a stage).

## How it's built

```
content/affixes.js          the numbers: CHANCE / WEIGHT by stage, BRUTE_UP, ELITE_COINS, every affix's tuning
features/affixes.js         the feature: toggle, menu rows, the . key, HUD line (F.sim, F.look, F.CHANCE: test handles)
features/affixes/sim.js     the truth: the roll, each affix's behaviour, deaths, the ward, the beam (own seeded rng)
features/affixes/look.js    the view: marks over the heads, ward wall, beam, death bursts, chill, nameplates, floats
sim/hazards.js              the hazard kit's truth: telegraphed ground zones (reusable, below)
view/hazards.js             the hazard kit's look: telegraphs, hatched danger zones, burning-patch decals, bolts, novas
```

Hooks into other areas' files (each small and additive):

- `game/enemies.js`: `onSpawn(fn)` **decorators**: `fn(o, type, sc)` edits a spawn's options before the enemy joins the
  world. The roll writes `affix`, `bar`, `name`, `aura` (and numbers) there, so they are the creator's fields, not
  flags added later (`?owncheck=1` stays clean). A bearer joins the live query `affixes.bearer`, whose join callback
  makes its fight state (a WeakMap in the sim).
- `features/combat/core.js`: `heal(p, n)` (Vampiric).
- `features/combat/draw.js`, `ui/hud.js`: the HP bar and the boss bar use `b.bar` when an enemy has one.
- `features/lights.js`: `F.ignite(p)` (Blazing's patches light wooden props; a sim call).
- `core/features.js`: `'affixes'` in `LOAD_ORDER` just before `'combat'` (with `order = {before: ['combat']}`): its
  `onArrowHit` sees a shot first, which is how the ward stops it. Nobody else's place changes.
- `core/flags.js`: `affixes`. `core/events.js`: `hazard.burst`; `sim/hazards.js` added to `player.hit` / `player.hurt`.

Rules kept: sim decisions on the feature's own `mulberry32` (seeded from `simSeed()` once, at boot when it starts on,
so it doesn't shift Math.random's sequence while off); views write only their own state; nothing allocated per frame
in steady state (pooled records, payloads, particles, light records); the slow is a `host.mods` note; the player is
hurt through `player.hurt` events with every immunity respected.

### The hazard kit (reusable)

A zone on the ground that warns, then goes off and/or lingers. Any feature can own one (one kit per owner).

```js
import {createHazards} from '../sim/hazards.js';
import {createHazardLook} from '../view/hazards.js';
const H = createHazards(host, {name: 'mine', cap: 64});    // sim: in F.update -> H.update(dt)
const look = createHazardLook(host, H, {name: 'mine'});      // view: F.view -> look.view(dt, evs); F.frame -> look.frame(t)
                                                             //       F.lights -> look.lights(push)
H.add({x, y, z?, r,            // where (z: the ground's height by default), radius (m)
  warn,                        // s of telegraph before it goes off
  dmg?, knock?, slow?: {mul, dur},   // what going off does to the player inside (+ his body radius)
  last?, dps?, tick?,          // lingering: s it stays, damage per s while he stands in it, tick (s)
  by?, style?, col?, data?});  // who it hurts in the name of; look: 'strike' | 'frost' | 'blast' | 'fire' | 'ring'
H.hurt(dmg, by)                // the owner's own damage through the same immunity rules (a beam)
H.slow(mul, dur)               // a slow (one 'player.speed' note per kit; the strongest wins; it ends by itself)
H.canHit()   H.clear()   H.list / H.n   H.slowK   H.onBurst = h => {}
```

- The player is hit only when the game allows: never while `core.immune()` (roll, Nimble window, hurt flicker, travel,
  run over), `P.untouchable` (dodging, the sandbox too) or `P.blink`; a lingering zone only with his feet on the
  ground (not in a leap, a fall, a climb); one linger tick at a time however many overlap.
- Events: `player.hurt {dmg, by, src}`, `player.hit` for a blow, `hazard.burst {x, y, z, r, style, col, by, data, src}`.
- The look draws ground things into the renderer's screen layers (`G.glayer('ground')`: lit like the ground, under
  anything standing on it; `'emit'`: glow): the telegraph's hatched danger zone; burning patches from one atlas canvas
  (painted once per size and flicker frame), a draw per layer however many burn.

## Tuning knobs (content/affixes.js)

- `CHANCE[type][stage]`: brute `[0, .05, .12, .2]`, elite `[1, 1, 1, 1]`, champion `[.6, .85, 1, 1]`.
- `WEIGHT[affix][stage]`: which affixes appear when (Vampiric from stage 2, Overloaded and Warded rarer on stage 1).
- `BRUTE_UP` (a regular brute with an affix), `ELITE_COINS`.
- Per affix, by tier `[brute, elite, champion]`: Blazing `patch` (r, warn, last, dps, tick, gap, near), `burst`;
  Glacial `chill`, `nova`; Overloaded `strike` (every, jitter, range, n, r, warn, dmg, knock, lead, leadMax, spread),
  `death`; Splitting `split`, `child`; Warded `ward` (hp, half arc, turn deg/s, regrow, pierce); Vampiric `beam`
  (every, range, reach, dur, dps, tick, snap, heal), `melee`.

## Tests and numbers

- Feature off: `golden --compare tmp/golden/ref4` 16/16 identical, `smoke` passes, `simview` passes.
- Feature on: `tmp/exp-affixes/simview_aff.mjs` (simview's method on port 8201 / debug 9401): the sandbox with all six
  fighting is identical with `?views=0` and at 240 fps; a keyboard-only session identical at 30 and 240 fps; a stage-3
  run with the director's own rolls identical with `?views=0`. Sandbox and run sessions: no console errors.
- Perf (headless 1920x1080, real time, six affixed elites fighting round you, 165 fps): `affixes.frame` .12-.13,
  `hd` .05-.06, `view` .01-.02, `update` .007, `lights` .006 ms a frame (~.21 ms together; whole-frame JS 2.8 ms vs
  2.67 with six plain elites and the feature off); off: an early return (.001).
- Scratch tools: `tmp/exp-affixes/probe.mjs` (scripted sessions + captures), `bodies/*.js` (lineup, one affix at a
  time, fairness bots, GIF sequences, perf), `gif.py`, `sheet.py`.

## Open questions and next steps

- **Sound**: nothing yet. `hazard.burst` (style) is there for the audio feature: a fire whoomp, a frost crack, the
  thunder of a bolt; the beam's hum while latched; the ward's clang on "blocked".
- **A tint on the bearer**: RoR tints the elite itself. The brute is the biome's painted card; a tint (or an outline in
  the affix colour) needs a small renderer hook (a per-card colour) or the sprite pipeline. The marks over the heads
  carry the identity for now.
- **Splitlings are full-size**: the card is the biome's brute; a smaller variant needs a painter variant (biomes.js)
  or the new enemy art. They hop quicker and lower and carry the green mark.
- **The ward vs the bow's kit**: blasts / rain / trap go round it by design (flank it or blow it up). Bleed and leech
  still trigger on a blocked arrow (`arrow.hit` is sent before the hit chain): fine or not?
- **Balance**: elites on stage 1 wave 3 now always have an affix. Should stage 1 have plain elites (CHANCE elite
  `[.5, 1, 1, 1]`)? Champion affixes make the stage-end fights much harder (a Vampiric Champion heals a lot).
- **Two affixes** on later stages (RoR's "double elites"), and affix-specific loot (an item from a Blazing elite...).
- **More affixes** that fit the kit: Haste (a speed aura on its mates), Mending (heals others), Gravity (pulls you
  in), Volatile (explodes on contact), Frost trails for Glacial.
- **Enemies other than brutes**: the desert's gunmen (features/foes) could roll affixes through a similar decorator.
- The hazard kit could serve other features: the omens experiment's lightning, a boss's slam rings, traps.
