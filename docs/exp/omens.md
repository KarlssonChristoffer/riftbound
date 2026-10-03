# Experiment: stage omens

Branch `exp/omens`. An exploratory gameplay feature: the living world's systems (weather, wind, the clock, light, fog)
turned into a run stage's rules. Off by default; nothing changes unless you switch it on.

## What it is

As a run's stage arrives it may roll an **omen** (the chance rises with the stage: 30%, 45%, 60%, 75%). The arrive banner
names it under the stage's title with its one-line rule, and a HUD icon (top left) keeps it on screen: its name and rule
beside it, the full rules in a tooltip when you hover it. The omen changes the stage **through the world's own systems**,
so you see and hear it: the weather is locked for the stage and rolls in over ~3 s (rain, storm clouds, fog, the gale's
wind: trees, grass, cloth, leaves, the wind and rain audio all follow by themselves), the clock can be held (a blood moon's
night, the golden hour), the light gets a colour grade over the mood. It passes when the stage is cleared ("Thunderstorm
passes"): the rules go at once, the weather is given back and the light eases out.

| omen | from stage | the world | the rule |
|---|---|---|---|
| **Thunderstorm** (Thundersnow in the frost lands) | 1 | storm (blizzard), a cold grade | Every 3.4-5 s a ring marks where you stand, closes in for 1.25 s, then a bolt falls: 55 damage (+45% a stage) to every enemy and prop in it, a 1.1 s stun, wood set alight (a powder keg cooks off), and 14 (+4 a stage) to you with a knock, unless you roll through it. **Iron draws the bolt**: within 4.5 m of the mark, the nearest arrow stuck in the ground or enemy you hit in the last 2.5 s takes it instead; a tree, tower, pillar, brazier or torch within 3 m does too. From stage 3 a bolt may bring a second down on an enemy. |
| **Gale** | 1 | wind 3 (the strongest), a dusty grade, dust streaks | Arrows are pushed downwind at 12 m/s² (+10% a stage: ~0.4 m of drift at 6 m, ~0.7 m at 8 m, ~1.5 m at 12 m), bullets at 10x that (a bullet is so fast it still drifts less: ~0.3 m at 10 m). Moving with the wind is 25% faster, against it 25% slower (rolls and knocks too). The HUD icon is an arrow along the wind as the camera sees it. |
| **Blood Moon** | 2 | night, clear, a red grade, red eyes, embers | Enemies wait and hop 25% faster, hit 35% harder, and drop double coins. |
| **Rift Fog** | 2 | fog, a violet grade, fog banks | Enemies farther than 5.5 m (-0.4 a stage, min 4) are lost in the fog: only their eyes show. Hits on an enemy within 4 m get +35% crit chance. |
| **Eclipse** | 3 | clear, a near-black grade | Your lantern is lit (15% wider). An enemy in light takes 60% more damage: within 4.2 m of you, 2.6 m of a fire (torch, brazier, campfire, the beacon, something burning, a fire arrow), or 3 m of a blast for 1.4 s. Lit enemies show a gold ring at their feet; in the dark, only pale eyes. |
| **Golden Hour** (a blessing) | 1 | 18:27, fair, a warm grade, gold motes | Enemies drop 50% more coins; you regenerate 2 health a second. |

## How to turn it on

- `?omens=1` (with `?mode=run` to skip the title): omens roll in runs. `?omens=0` forces it off.
- The pause menu: **Dev > Features > Stage omens** toggles it and remembers it (`localStorage 'rb.omens'`).
- `?omen=storm|gale|bloodmoon|riftfog|eclipse|golden`: that omen on every stage of a run, and in the sandbox from the
  start (implies on).
- **Sandbox**: with omens on, the pause menu's **Game** tab has a row per omen (`Omen: Thunderstorm` ...) to force it on and off. The
  sandbox plays them as stage 2 (`TUNE.sandboxStage`). In the sandbox your health only counts in the desert's gunfights,
  so lightning knocks you but doesn't hurt.

Controls: none new (no key). Everything is played with the bow / revolver, rolls and movement you already have.

## How it works (files)

- `src/content/omens.js`: the table (name, glyph, colour, rule, tooltip, weather, hour, grade, weight, first stage) and
  `TUNE` (every number below).
- `src/features/omens.js`: the feature: the roll as a stage arrives, applying and giving back the world (weather lock,
  clock hold, grade), the `host.mods` notes, combat's hit mod, the banner note, the HUD, the sandbox rows, the toggle.
- `src/features/omens/storm.js` (lightning), `gale.js`, `fog.js`, `moons.js` (Blood Moon, Eclipse, Golden Hour),
  `kit.js` (rings, eyes), `hud.js` (the icon + tooltip).
- Small additive hooks in other systems (each named in its commit):
  - `sim/env.js`: `setWeather(w, ease)`, a `gale` weather state (no climate draws it), `setGrade(src, g)` /
    `clearGrade(src)` (a colour grade over `mood()`).
  - `features/combat/core.js`: `T.enemyDmg / enemyPace / enemyCoins` (host.mods `combat.*`), `hitMod(fn, on)` (another
    system's say on a hit's damage / crit), `root(b, sec)`.
  - `sim/projectiles.js` (+ `main.js` passes `mods`): `proj.windX / windY / windBullet` push what flies.
  - `sim/player/adapter.js` + `player.js` `moveBy`: `player.windX / windY` (faster with the wind, slower against it).
  - `render/lighting.js`: `light.lantern` / `light.lanternR`.
  - `world/world.js`: `veil(p, on)` (a view hides a prop; the sim is untouched).
  - `features/lights.js`: `ignite(p)`, `fireNear(x, y, r)`.
  - `features/weather.js`: `flash(k)` (the scene's lightning flash, one writer).
  - `ui/hud.js`: `note(title, sub, col)` (a line under the current banner).
  - `core/flags.js` (`omens`, `omen`), `core/events.js` (`omen.begin`, `omen.end`, `omen.strike`),
    `core/features.js` (`omens` appended to `LOAD_ORDER`).
- Sim vs view: the roll, the strikes, the regen and the rules are `update` (its own generator, seeded from the clock like
  the game's); bolts, rings, fog banks, eyes, motes, streaks, the grade's easing and the veils are presentation.

## Tuning knobs (`TUNE` in `src/content/omens.js`)

- `chance[stage]`, each omen's `weight` and `from` (first stage): how often, which.
- `ease`: how fast the weather and the light roll in (and out: twice that for the weather).
- `storm`: `first`, `every`, `everyK` (cadence), `tele` (warning s), `r` (bolt radius), `rod` (iron's reach), `wild`,
  `dmg` / `dmgK`, `root`, `hurt` / `hurtK`, `knock`, `lead` (s an enemy you hit draws it). Prop rods and their heights:
  `ROD` in `omens/storm.js` (reach 3 m).
- `gale`: `arrow` / `arrowK` (m/s² on arrows), `bullet` (a bullet's share x), `run` (+-).
- `bloodmoon`: `dmg`, `pace`, `coins`. `riftfog`: `see` / `seeK` / `seeMin`, `close`, `crit`.
- `eclipse`: `lit`, `lantern`, `lanternR`, `fire`, `boom`, `boomT`. `golden`: `coins`, `regen`.
- The looks: each omen's `world.grade` (amb / sun / lift / fill multipliers, sunK, shadow, glow, fog added) in the table.

## Open design questions

- **Is the storm too strong or too weak?** Standing still you take a bolt every ~4 s (14 at stage 1). Iron makes it
  a tool; luring is strong with Arrow Rain (14 stuck arrows) and trees (a 3 m safe-ish spot). Should prop rods exist at
  all, or only your iron? Should strikes also seek elites?
- **Weather's own cosmetic bolts** still fall during the Thunderstorm (no ring, no damage). They add mood, but a new
  player may wonder whether they were hit. Suppress the near ones while the omen is up?
- **Blood Moon** has no counterplay beyond "more gold"; maybe enemies flee the light of fire, or the moon's light makes
  shadows that hide you.
- **Rift Fog** hides an enemy's card but not its elite nameplate or a hurt one's HP bar; it also still lets the aim assist
  find a hidden enemy (aim at the eyes). Keep, or hide those too?
- **Eclipse** in an already-night stage is only a little darker; it could swap to a "moonless" variant there.
- The **clock**: a held hour stays after the stage is cleared (the next stage sets its own); only a run's end or a
  sandbox toggle puts the old hour back.
- **Positive omens**: only Golden Hour so far. A Harvest Moon (chests cheaper, items luckier) or an Aurora (abilities
  recharge faster under its light) would round it out.
- Omens as **run modifiers** you choose (a risk / reward pick at the portal, like Hades' Pact) rather than a roll.

## Next steps

- Sounds of their own: a crackle that rises with the storm's ring, a wind howl swell when the Gale arrives, a low drone
  under the Blood Moon (the forge recipes).
- Enemies that react to the world too: brutes avoiding the lit ring of a mark, fleeing fire in an Eclipse.
- Combine omens at later stages (a storm in the fog), or make the final stage always carry one.
- A real sky moon for the Blood Moon (the frontier's moon card) and a corona for the Eclipse.
