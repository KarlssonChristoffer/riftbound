# Weather

Status: 2026-10-16, part 1 of the "Weather, winter and the mire" brief
(`/mnt/project-files/briefs/weather-winter-mire.md`). The weather is no longer only a show: rain soaks you, the cold gets
into you, trees and the hut keep it off, the wind pushes you on the open fell, rain puts an open fire out, and the wool
and fur pieces do what their tooltips said they would "soon". This file says what the game does now; the direction lives
in the brief.

## Try it

`?mode=sandbox&forest=1` (the persistent forest). `&weather=rain`, `&weather=storm`, `&season=winter` lock a spell to
test; F9 cycles the weather as before.

- **Wet.** Stand in the rain: water starts dripping off him, then he's soaked (about 1.5 minutes in rain, 40 s in a
  storm, 4 minutes in a drizzle). Under a pine's crown, in the hut or in the cave nothing reaches you; a birch keeps off
  half (less once its leaves fall). Wading wets the legs (half way), a swim soaks you at once. A fire dries you in 30 s
  (steam rises off him), the sun in 4 minutes, a grey sky in 10.
- **Cold.** A winter night chills you through in 3 minutes, a winter day in 7, an autumn night in 8; soaked in a wind,
  or a blizzard, faster. Cold you walk slower, can't sprint, and the tool's rhythm window narrows; frost creeps in at
  the screen's edges. A fire warms you in 20 s; a meal holds the cold off while it lasts. Breath shows in the cold.
- **Wind.** In a strong wind (windy and up) on open ground you're pushed along with it while you walk: harder going
  against it, easier with it. Trees break most of it, the fell top doubles it. Nothing pushes you while you stand.
- **Fires in the rain.** An open campfire in heavy rain for 10 s goes out with a hiss of steam. The Stone Fire Ring is
  rainproof, and nothing goes out in the cave. Soaked through, you can't light a new fire ("too wet to light a fire").
- **Gear.** Hood: soaked 70% slower. Wool cap and trousers: the cold sets in 15% slower; wool sweater 25% (and heavy
  when soaked: 5% slower); fur cloak 30%. Their tooltips say so.

Never a number or a bar: it shows on him (drips, steam, breath) and at the screen's edges (frost). F3's debug HUD has
`wet · cold · shelter · wind` for testing. Esc > Sandbox > Body: soak me, chill me, dry and warm. `?wx2=0` turns all of
this off (the weather is a show only, as before).

## How it works

- **The weather comes from the seed and the clock** (`sim/wxclock.js`, pure). Spell n lasts 2 to 6 in-game hours and is
  drawn from the biome's climate for the season it starts in, both from `hash3(seed, n, k)`. Nothing is stored or sent:
  every client and the co-op server compute the same sky from the world's seed and the shared clock. A jump of the
  clock (co-op's `setT`, Esc > time) replays the last 96 in-game hours of ground (snow cover, wet) from those spells, so
  a late joiner's ground matches. `sim/env.js` still owns the channels, the fronts that walk across the map, the
  locks (`?weather=`, omens, F9) and the ground's memory; it only asks the schedule which spell it's in. Its own
  `Math.random` draw stays where it was (golden captures don't move); the schedule's seed draw is `simRandom`.
- **The body** (`features/body.js`, rules and knobs in `content/body.js`): WET and COLD, 0..1 each, step in `update` by
  the rain where he stands (`env.skyAt`), the shelter over him, a fire near (`campfires.burningNear`), the season, the
  night, the wind, a meal (`meals.id`). Shelter is 1 in the cave or the hut, else the crowns round him (a 3.2 m
  `entities.near`, each tree's cover by species and distance, combined).
- **What they do are modifier notes** (source `body`): `player.speed` (cold, heavy wool soaked), `player.speed.sprint`
  (down to the run's speed when frozen), `tool.rhythm` (the tool's window, `sim/player/tool.js` reads it), and the wind's
  `player.windX / windY` share (the player's own push while moving, `sim/player/adapter.js`). They are set only when a
  reading crosses a tenth, so `host.mods` doesn't churn.
- **The look** is view-only: a small pool of drips and soft puffs (breath, steam), for him and every friend; the frost is a
  full-screen pass after the vignette (`render/gfx.js` `setFrost`, integer-hashed art-pixel cells, nothing on the CPU).
- **Fires** (`features/builds.js` `douse`): each burning, non-rainproof build counts its seconds in rain at or over
  `TUNE.douse.rain`; at `douse.s` its fuel goes to 0 and `fire.doused` is emitted (`features/campfires.js` hisses).

## With friends (co-op)

The weather is the same for everyone without a message: the seed and the server's clock. A body's look rides in the
player state (`st.bd`, 11 bits: `content/body.js` packBody) and in the snapshot rows, so you see a friend drip, steam
and breathe. Each player's own WET and COLD are their own (what they wear, where they stood). The server owns the fires:
it reads the same schedule (`server/room.mjs` regrowTick) and puts an open fire out after 10 s of heavy rain, for
everyone (`{k: 'world', s: 'doused'}`). The server sees the spell, not the fronts' edges or the forest's crowns: a fire
under a big pine still goes out online. Offline, it's the rain where the fire stands.


## Knobs

| Knob | Value | Where |
|---|---|---|
| spell length (in-game hours) | 2-6 | `sim/wxclock.js` TUNE `spell` |
| season length (in-game days) | 3 | `sim/wxclock.js` TUNE `seasonDays` (env's TUNE starts from it) |
| ground replay on a clock jump | 96 h in .25 h steps, over 2 h jumps | `sim/env.js` TUNE `replay`, `replayJump` |
| soaked in rain / storm / drizzle | 90 / 40 / 240 s | `content/body.js` TUNE `soak` |
| dry by a fire / sun / grey sky / cave | 30 / 240 / 600 / 900 s | `content/body.js` TUNE `dry` |
| wading wets to / over | .55 / 6 s | `content/body.js` TUNE `wade`, `wadeS` |
| cold: winter night / day / autumn night / wet+wind / blizzard | 180 / 420 / 480 / 120 / 90 s | `content/body.js` TUNE `cold` |
| warm by a fire / recover | 20 / 150 s, fire within 3.5 m | `content/body.js` TUNE `warm` |
| cold's effects at full | walk -15%, no sprint, rhythm window x.5; from cold .35 | `content/body.js` TUNE `effects` |
| wind push per level | breeze 0, windy .4, storm 1.1, gale 1.6 m/s; x.2 under trees, x1.5 on the fell top (over 14 m) | `content/body.js` TUNE `wind` |
| tree shelter | pine .85, oak .8, willow .6, rowan .55, birch / aspen .5, dead .05 | `content/body.js` SHELTER |
| fire doused | rain >= .5 for 10 s | `content/builds.js` TUNE `douse`; `rainproof` per build |
| gear | hood soak x.3; wool cap / trousers chill x.85, sweater x.75 (+heavy), fur cloak x.7 | `content/gear.js` mods |
| arrows drift in the wind | 6 m/s^2 at the gale's push (half the gale omen's) | `content/body.js` TUNE `wind.proj` |

## Not in yet

Aim sway in the wind (there is no aim sway system to feed), a shivering idle and a darker wet sprite (the sprites are
baked atlases), the server knowing which fires stand under trees.
