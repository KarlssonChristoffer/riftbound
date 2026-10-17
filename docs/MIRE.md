# The mire

Status: 2026-10-16, part 4 of the "Weather, winter and the mire" brief (`/mnt/project-files/briefs/weather-winter-mire.md`).
A bog on the upland, grown from the seed: soft ground that takes you down when you stand still, dark pools, an old boardwalk
with rotten planks, cotton grass and dwarf pines, cloudberries in summer, bog iron at the pools, a bog body in an old peat
cutting, mist at dawn and dusk, water that rises in the rain, ice in winter, and at night the wisps. This file says what the
game does now.

## Try it

`?mode=sandbox&forest=1&seed=1337` and Esc > Sandbox > Mire: take me there, to the bog body, dusk now (the wisps), to the
night's find, flood it. Without the menu: walk north up onto the upland; the mire lies in the trough between the fell and the
canyon's ridge (seed 1337: about x 21, y -130). `&wisps=often` the wisps every night and all day; `&mire=0` its rules and look
off (the hollow stays). `&season=summer` for the cloudberries, `&season=winter&ice=1` frozen.

## The place

- **Where.** The flattest low spot on the upland's top the seed's candidates find, its edge at most 2 m up the fell's or the
  canyon ridge's foot: on the seeds tried that is the trough between the two, where their slopes meet. 21-28 m by 30-38 m (the
  space between the fell and the canyon is narrower than the brief's 30-40 m round). Its ground is a terrain basin: flat, 30 cm
  under the lowest ground inside, back up over a walkable rim. Seeds 1337, 1, 42, 777, 9 and 20261016 all get one.
- **What grows.** Nothing of the forest's own growth inside it; its own: 10-18 dwarf pines on the firm hummocks (forest trees:
  you can fell them), 55-85 tufts of cotton grass, 6-10 cloudberry patches, 6-10 bits of bog iron at the pools' edges.
- **The look.** Bog moss in a pale mosaic (yellow-green, rusty red, ochre), darker where it's soft, black peat round the pools,
  cotton grass heads, the grey planks of the boardwalk (the rotten ones darker and green). The pools are dark peat water in the
  ground shader (the composite mirrors in them, rain rings them); they grow in a flood and freeze grey in winter. The soft ground
  ripples round you as you walk on it. The mist rises off it as off the lake.

## Sinking

- Stand still on soft ground for 2 s and it takes you down to the waist (60 cm) over 6 s. Walking keeps you at the shins.
  At full depth you walk at half speed.
- Shallow (under 32 cm), a press of Space pulls you free. Deeper, you're held: hold Space 1 s (2.5 s in the mail shirt; half with
  a friend within 2.2 m) to pull free.
- The moose-hide boots halve how fast you sink.
- A pool takes you chest deep at its middle, at under half speed, and soaks you.
- The boardwalk holds you, except one plank in six: rotten, it breaks under you (knee deep in the mud) and stays broken for you.
- Frozen in winter: no sinking, the pools walkable.

## The water

The mire's water rises .7 an in-game hour at full rain (a storm counts double) and drains .17 an hour: empty again about 6 hours
after the rain stops. At full flood the pools are up to 60% wider and the soft ground spreads (its threshold .55 -> .4): the
boardwalk goes under where it passes close to a pool. On boot (and on a jump of the clock) the level comes from the last 12 hours
of the weather's spells (the seed's: every machine gets the same); after that from the rain as it falls.

## The wisps

From dusk (19:30) to dawn (5:30), 3-5 small cold lights hover over the pools. Walk toward them and they drift ahead, keeping 6-9 m
off. Three of them (or two, or four) lead into the soft ground and out over a pool; reach one and it's gone, back over its pool.
One has no reflection in the water: it leads 30-50 m over firm moss and stops over a spot. E there digs. Which one is true, where
it goes and what's there are the seed's and the night's: the same for everyone (`sim/mire.js`). Everyone who reaches it digs one
thing, once a night (online the server checks: act `dig`).

What's there, and what happens after, is in the PR's hand-over.

## The bog body

In an old peat cutting near the mire's edge, off the boardwalk: a man lying on his side in a brown wool hood with a long tail
and a cloak, two wooden stakes driven in beside him (Bockstensmannen, Bocksten mire, Halland). Painted into the ground. He does
nothing; no text.

## Knobs

| Knob | Value | Where |
|---|---|---|
| place, size | the flattest low upland spot, edge <= 2 m up the fell / ridge; r 13-19 m, aspect .66-.9 | `world/mire.js` TUNE `r`, `aspect`, `high` |
| basin | floor .3 m under the lowest ground inside; rim 7-14 m | `world/mire.js` TUNE `sink`, `rim` |
| pools | 5-9, r 1-3 m, +60% in a flood, .5 m off the boardwalk | `world/mire.js` TUNE `pools` |
| soft ground | threshold .55, -.15 in a flood | `world/mire.js` TUNE `soft` |
| boardwalk | 1.1 m wide, a plank every .45 m, 1 in 6 rotten | `world/mire.js` TUNE `walk` |
| growth | pines 10-18 (scale .42-.62), tufts 55-85, cloudberries 6-10, bog iron 6-10 | `world/mire.js` TUNE |
| flood | rise .7/h at full rain (storm x2), drain .17/h, looks back 12 h | `content/mire.js` TUNE `flood` |
| frozen | while the lake's ice is over 15 cm (winter) | `content/mire.js` TUNE `frozen` |
| sinking | after 2 s, to .6 m over 6 s, walking .14 m, up .5 m/s, half speed at full; free by a press under .32 m, else hold 1 s (mail 2.5, friend x.5); boots x.5 | `content/mire.js` TUNE `sink` |
| pools (him) | chest 1.15 m at the middle, x.45 speed, soaked in 2 s | `content/mire.js` TUNE `pool` |
| wisps | 19:30-5:30, 3-5, keep 6-9 m ahead at 2.2 m/s, the true walk 30-50 m, E within 1.6 m, 1.2 s to dig | `content/mire.js` TUNE `wisps`; `?wisps=often` |
| cloudberries | summer only, 2-4 a pick, back in 2 days | `content/forage.js` PLANTS |
| bog iron | 1-2 a pick, back in 3 days, Mining XP | `content/forage.js` PLANTS |

## How it works

- `world/mire.js`: the plan (a stage of `world/forest.js` with its own generator, so nothing else in the forest moves; only the
  growth keeps out of it) and the ground's paint (`world/biomes.js` forestRuins calls `paintMire`). Its pools, soft ground and
  outline are baked once into a small RGBA grid (4 cells a metre): the ground shader draws from it (`render/gfx.js` setMire /
  setMireLook) and the sim reads the same numbers, so what you see is what sinks you.
- `sim/mire.js` + `content/mire.js`: the rules both sides run: the flood from the spells, frozen, the night's wisps and find.
- `features/mire.js`: you on it (the notes `player.sink`, `player.speed`, `player.stuck`, source `mire`), the planks, the wisps'
  drift, the dig. The pools soak you through `body.soak` (new in `features/body.js`).
- The cloudberries and the bog iron are forage patches (`features/forage.js`), appended at the end of the forest's decor so the
  other patches keep their ids. New in forage: a plant's `season` (out of it the patch looks picked and can't be picked; the
  server checks it too) and `skill` (bog iron gives Mining XP).

## Not in yet

Bog iron is picked by hand (E) rather than with the pick; smelting it waits for the forge. The boardwalk is painted into the
ground, not raised. Broken planks are your own (a friend sees them whole). A friend's lasso doesn't pull you out (a friend near
halves the hold). No sounds (the events are there). The cranes, peat cutting and the turf hut are for later.
