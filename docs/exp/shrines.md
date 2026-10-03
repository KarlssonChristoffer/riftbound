# Experiment: shrines and mini-events

Branch `exp/shrines`. An exploratory gameplay feature in the Risk of Rain / Hades mould: each run stage, two or three
shrines stand somewhere in the grounds, and each one is a small decision (gold for a chance, health for gold, a harder
fight for more loot, an item for a better one). They are real 3D props in the world's style, glow with their own colour,
and break when they are spent. Off by default; nothing changes unless it is turned on.

Code: `src/features/shrines.js` (the feature), `src/features/shrines/models.js` (the 3D models, kit3d),
`src/features/shrines/art.js` (the glyphs, the rift crystal, the trader's lantern: pixel art with an emissive layer).

## Turning it on

- URL: `?shrines=1` (and `?shrines=0` forces it off), e.g. `http://localhost:<port>/src/?mode=run&shrines=1`.
- Pause menu > Dev tab (the `` ` `` key shows it) > Features > **Shrines (experiment)**. The toggle is remembered in
  localStorage (`riftbound3d.shrines`); the URL flag overrides it.
- In the sandbox, once it's on, the pause menu's **Game** tab has a row per kind (*Place: Shrine of Chance*, ...) that puts
  one next to you, and *Clear the shrines*. In the sandbox they use the sandbox's gold, health and build.

## The shrines

Walk up to one: its prompt says the price or the deal (E). Each has its own glyph floating over it, its own light and
particles, and a spent state: the light dies, the glyph cracks in two and slumps onto the stone.

| shrine | looks like | what E does | spent |
|---|---|---|---|
| **Shrine of Chance** | a stepped plinth, a banded pillar, a bronze bowl heaped with coins; a die glyph, gold light | pay gold (10 at stage 1) for a 45% chance at an item, rolled luckier than a chest (rare and uncommon weigh +35%). A miss: a puff of smoke and the dry click of a hammer on an empty chamber. The price rises x1.5 per try (10, 20, 25) | after a win or 3 tries |
| **Shrine of Combat** | a war cairn: a red swallow-tailed banner, two spears crossed, a shield | calls a pack (5 + 2.5 x stage budget: brutes, sometimes elites) in round the shrine, now, through the wave director's own telegraphs (`run.js summon`), so they count in the wave's "left" and its end. Killing all of them spills 16 + 8 x stage coins and, half the time (always with an elite), an item | when the pack is beaten (or lost: nothing for foes you didn't kill) |
| **Shrine of Blood** | a stone altar with a basin of blood, bone horns, two candles | takes 30% of your current health (never below 1; needs 18) and spills that much gold x (1 + .35 x stage) as a coin fountain | after 3 |
| **Shrine of the Mountain** | a cairn of flat stones and a standing stone; a snowy peak glyph, cold light | a **run rule** for this stage: the champion gets x1.6 health and x1.25 damage, one more elite joins the last wave, and clearing the stage gives 2 extra items (luckier). An icon at the top left of the HUD while it holds; the champion carries the peak glyph over its head. Only until the last wave starts | when the stage is cleared |
| **Altar of Exchange** | a little gate of drums under a lintel on a stepped dais, a rift crystal floating in it, rune inlays (they glow in the Rift) | first E: the rift picks one of your common / uncommon items and a random item of the next tier, and shows both on a card. E again takes the trade; walking away puts the card away (the offer stands while you still hold the item) | after a trade |
| **Wandering Trader** | a handcart under a striped canvas roof, goods on its bed, a lantern on the front post | shows one item (rolled a little luckier) and its price on a card as you come near; E buys it. 40 / 75 / 140 gold by tier, x (1 + .4 x stage) | sold |

Where they stand: free nav cells at least 8 m from the spawn, 7 m from each other, clear of the gates, the paths, the range
lane and the rail, the movement ring (the portal opens in it), the light garden's pad and anything you interact with, with
1.25 m of clear ground round them (so they never close a passage). The arena first; a spot out on the trail is taken half
the time. Which kinds and where come from the run's own generator (one draw from it per stage seeds the feature's), so a
seeded run replays. A toast names them as the stage begins. They go when you leave through the portal, when the run
ends, and when you go back to the title.

Sounds ride on events the audio already knows: `chest.open` (a win, a payout, a trade, a purchase), `combat.coin`
(paying), `combat.loot` (the coin fountains), `combat.trap` (a challenge called, the mountain woken), `player.dryfire` (a
lost gamble). The feature's own event, `shrine.use {kind, what, n}`, is in the catalog for anyone who wants to listen (the
music could react to a challenge, the wildlife to the mountain).

## How it plugs in

- `features/shrines.js` owns its props (`kind: 'shrine_<kind>'`, a collider, `interact: 'shrine'`, `opened` while it can't
  be used), their state, its meshes (`world.mesh`, static: the cached static shadow, sScene layers 1 + 2) and sprite sheet,
  the particles (a preallocated structure of arrays), and the host.mods source `shrine.mountain`.
- Small additive hooks in other areas' files (each named in its commit):
  - `game/game.js`: `F.rewards` (seed from the run's generator, `spend` / `addGold` through the chest's gold rules,
    `rollItem` for this weapon, `giveItem` with the chest's toast, `takeItem`), and the director gets `mods: host.mods`.
  - `game/run.js`: the director reads `run.eliteLast` (extra elites in the last wave) and `run.champHp` / `run.champDmg`
    (the champion's scale) from host.mods, and `summon(type, x, y)` telegraphs a feature's enemies like the wave's own.
  - `game/stats.js`: `removeItem(id)` (a trade).
  - `features/combat/core.js`: `spill(x, y, h, n)`: coins out of something that isn't a prop.
  - `core/flags.js` (`shrines`), `core/events.js` (`shrine.use`), `core/features.js` (LOAD_ORDER + `shrines`).
- Sim / view: what the shrines are, their prices, rolls, packs and rewards are sim (`update`, `interact`; the feature's own
  generator); the glyph bob, the lights, the particles and the meshes are view (`view`, `frame`; `viewRandom`), fed by the
  `shrine.use` events. Off, `update` returns at once and nothing else runs.

## Tuning knobs

All in `TUNE` at the top of `features/shrines.js` (and `SHAPE` in `shrines/models.js` for each kind's light, glyph height and
collider):

- `count`, `third`: 2 shrines a stage, a third half the time. `weight`: how often each kind comes up (no kind twice).
- `away`: the placement margins (clear ground, spawn, apart, gates, paths, lane, ring, pad, interactables); `trail`: the
  chance a spot on the trail is kept.
- `chance`: base price 12 (x (1 + .5 x stage), rounded to 5), rise x1.5 a try, odds .45, 3 tries, luck +.35 (a chest's luck is
  .25 x stage).
- `combat`: budget 5 + 2.5 x stage (brute 1, elite 4), at most 6, spawn ring 2.6-4.6 m, coins 16 + 8 x stage, item chance .5.
- `blood`: share .3 of current health, needs 18, gold per health 1 + .35 x stage, 3 uses.
- `mountain`: champion health x1.6 / damage x1.25, +1 elite in the last wave, 2 items on clear (luck +.5).
- `exchange.reach`: 2.4 m (further, the card goes away). `trader`: prices by tier, x (1 + .4 x stage), luck +.3.

## Cost

Measured with `?perf=1` (headless, 1920 x 1080, a run at dusk, standing by a lit shrine, 6 s): `shrines.frame` .013-.024 ms,
`.view` .003-.005, `.update` .001-.005, `.lights` .002-.003, `.hd` .002-.003: about .03 ms a frame in all. Off, every hook
returns at once (0). The placement search runs once a stage, as the stage begins: ~1.1-1.5 ms. Draws: one static mesh a
shrine (its shadow in the cached static map), its sprites batched with the world's, <= 512 particles as points.

## Tests

Screenshots and GIFs from the headless sessions (not in git): `D:/Game/tmp/exp-shrines/` (shrines_lit.png,
shrines_spent.png, shrines_use.png, shrines_biomes.png, run_hud.png, shrines_chance.gif, shrines_blood.gif,
shrines_combat.gif); the probe scripts beside them (probe.mjs + s_*.js, simview_on.mjs, perf.mjs).


- Off (the default): golden 16/16 identical against ref4, smoke all passed, simview sim identical (sandbox, run, keys at
  60 / 240 / 30 fps).
- On: a scratch copy of simview with `?shrines=1` on every scenario and a `shrines` scenario (all six used in a run
  through E, a challenge called and killed, the stage cleared to the augment pick) was sim identical without views and
  at 240 / 30 fps. Scripted headless sessions in a run (two stages: the Mountain's rule, the champion x1.6 = 753 health,
  the extra elite, the items on clear, the shrines gone in travel and new ones at stage 2) and in the sandbox (every kind
  placed from the menu and used, every biome, the toggle off and on) had no console errors or warnings.

## Open questions and next steps

- **Does the Mountain pay enough?** Two items for a stronger champion and an elite is a first guess (tested headless, not
  played by hand); by stage 4 the champion's x1.6 on top of the stage scaling is a big wall. Maybe scale the reward with
  the stage, or let it stack (two mountains: x2.5).
- **Combat timing.** The challenge only answers during the waves (through the director) or after the stage is cleared
  (its own telegraphs, so it never lands in the augment pick). Is "more fight now" more fun mid-wave, or as an optional
  post-clear bonus room?
- **Chance odds.** A flat 45% with a rising price is RoR's feel; a pity counter (each miss +10%) would be kinder.
- **Exchange** can't re-roll by walking away (the offer stands), which keeps it honest. Should tier 3 items be
  exchangeable for an augment?
- **Discovery.** A toast names the stage's shrines as it begins, but nothing says where they stand. Ideas: a soft chime
  and a direction hint at the stage's start, a glow on the minimap if one comes, or the HUD listing them with their glyphs.
- **Balance overall** is untested by hand: the numbers (TUNE) are first guesses checked only for "does it work" in
  headless runs. Blood is probably strong (3 uses at 100 health pay ~66 gold, about 2.5 chests, for the risk).
- **More kinds:** a Shrine of Order (reroll every item into the same tier), a cursed chest (an item now, an elite affix
  on the next wave: pairs with exp/affixes), an equipment altar (exp/equipment), a weather shrine that calls the next
  stage's omen (exp/omens).
- The trader could become a real NPC (the garden merchant's art, with a hood) who walks between stages.
- Shrines could break: an explosion or a stray Explosive Arrow cracking an unused shrine for a smaller reward.
