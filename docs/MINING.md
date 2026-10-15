# Mining

Status: 2026-10-15, the second slice of the "Forage and dig" brief (PR 2 of 4). The forest's cave has veins of stone,
copper and iron in its walls, an old miner's camp with a rusty pick driven into the rock, and the pick digs the veins.
Rhythm blows bite harder, spent veins come back in the same spot, a Mining skill grows with digging, and the miner's cap is
the first mining gear. This file says what the game does now. The direction lives in the brief
(`/mnt/project-files/briefs/cave-and-gathering.md`) and the "Skills, gathering and items" notes doc.

## Try it

`?mode=sandbox&forest=1&seed=1337` (add `&fresh=1` for a new world), walk down into the cave (seed 1337: its mouth is about
x 35.6, y -20.6). Esc > Sandbox > Gathering > "Mining: to the miner's camp" jumps there.

- **The camp** is in the cave's first room: a rotted crate with a candle stub, a heap of chipped stone, and the old pick
  driven into the wall above it. **E** next to it (`E  take the pick`) puts the Old Pick in your bag. One per player: it is
  saved with your world, and the camp's pick is gone for you after that.
- **Veins** sit at the walls' feet: pale quartz streaks for stone, green and rust lumps for copper, dark blue-grey with rust
  for iron (deeper in the cave). The prompt over one says `E mine`.
- **E** facing a vein, or **LMB** on it (cursor over it, in reach), takes out the pick and swings. Each blow that bites throws
  sparks and grit and a ringing clink; the vein cracks in three stages as its blows run out. **Hold E** (or LMB) to keep
  swinging.
- **Rhythm:** press again just as the last swing ends (within 0.15 s, before or after) and the next blow lands 1.5 times
  as hard, with a brighter, louder ring. Mashing doesn't count: it has to be a fresh press near the swing's end.
- **Iron** is too hard for the old pick: the blow glances with a dull clang and `needs a better pick` shows. A better pick
  comes with a later slice.
- The blow that **spends** a vein pops its chunks out; they roll to your feet and go in the pouch as you walk over them
  (or get drawn in when you stand close). Stone 2-3, copper ore 2-3, iron ore 1-2, with Mining XP for each bite and more for
  the last one. A spent vein is a dark hollow with rubble at its foot.
- **Grows back** in the same spot after 3 in-game days (a day is 20 real minutes). `?regrow=0.05` makes it 20 times quicker.
- **Cave crystals** break under the pick in 3 blows and drop 2-3 Glow Shards.
- **Miner's cap** (head: Tab > gear, or Shift+Tab in the wardrobe): the lantern reaches 30% farther, and a 5% chance of one
  more chunk from a vein. Fried chanterelles (`docs/FORAGING.md`) make the pick bite 15% harder.
- The dark does no harm, surface rock can't be mined, and the night ore does nothing yet.

Dev: Esc > Sandbox > Gathering: marks on the veins (dots: gold, red while spent, grey when too hard for your pick; or
`?gathermarks=1`), every vein back (offline), the old pick back at the camp, to the miner's camp. `?mining=0` turns mining
off; `?rhythm=0` turns the rhythm bonus off (for woodcutting too).

## How it works

- **Veins are the cave's plan.** `world/caves.js` places them from the seed (its own generator, `mix(seed, 20)`) after the
  cave is carved: points on the walls' edge whose way into the open faces the camera, at least 2.2 m apart and clear of the
  cave's props. Iron only in the far half of the cave (graph distance from the entry), copper anywhere. Seed 1337 has 19
  (12 stone, 3 copper, 4 iron). A vein's id is its index there (`'v' + i`), the same on every client and the server. The
  camp is placed the same way (`mix(seed, 21)`) on a wall of the first room. Nothing else in the cave moves.
- **The pick is a tool with a job.** `sim/player/tool.js` now keeps one swing per job (`chop` from `content/woodcut.js`,
  `mine` from `content/mining.js` SWING: slower, heavier) and the rhythm timing. `view/heldtool.js` draws the pick's head
  (a curved iron bit with a back spike) on the same haft as the axe.
- **Sim vs view.** The blows left, the spent set, chunks, the yield rolls (the feature's own seeded generator) and regrowth
  are the sim; the vein meshes are rebuilt only when a vein's stage changes, and shown or hidden by the same camera rule as
  the cave's walls (a wall facing away is cut low, its veins go with it).
- **Saved** (offline): `pack.store('mining')` = `{seed, s: {i: the world hour a spent vein grows back}, took}` (a
  half-dug vein is whole again next session). Another seed's veins are dropped.

## With friends (co-op)

The server owns the veins (`server/room.mjs`, act `'mine'`). A blow sends the vein id, its power (pick, meal, skill and
rhythm; held to 0.25-3), your Mining level and your pick's tier. The server checks the vein is one of the plan's, not spent,
within 4 m of you and soft enough for the pick, takes the blow off its blows left and tells everyone (everyone's vein
cracks). The blow that empties it spends it: **every player who struck it gets their own full roll of chunks** (their level
and gear), told in one message. It grows back on the server's clock (`--regrow`); a late joiner gets the struck and spent
veins in the welcome. The camp's pick, the crystals and the chunks on the floor are each player's own.

## Knobs

| Knob | Value | Where |
|---|---|---|
| blows at power 1: stone / copper / iron | 3 / 5 / 7 | `content/mining.js` VEINS `blows` |
| chunks a striker gets | 2-3 / 2-3 / 1-2 | VEINS `n` |
| pick tier a vein asks for | 1 / 1 / 2 (the old pick is 1) | VEINS `tier`; `content/items.js` pick `tool.tier` |
| XP a blow (x 4 for the last) | 2 / 4 / 6 | VEINS `xp` |
| the swing / when the blow lands | 0.7 s / 0.3 s | `content/mining.js` SWING |
| rhythm window / its bonus | 0.15 s / x1.5 | TUNE `rhythm`, `rhythmMul` |
| regrowth | 3 in-game days | TUNE `days`; `?regrow=` / `--regrow` factor |
| chunks: picked up within / drawn in from / after | 0.55 m / 2.4 m / 0.5 s | TUNE `chunk` |
| crystals: blows / Glow Shards / XP | 3 / 2-3 / 5 | TUNE `crystal` |
| how many veins, how far apart, iron from | 14-22 / 2.2 m / halfway in | `world/caves.js` TUNE `veins` |
| Mining skill a level | pick +3% harder, +1% chance of one more chunk | `content/skills.js` `mining` |
| miner's cap | lantern x1.3, +5% one more chunk | `content/gear.js` `miner_cap` |

## Files

`content/mining.js` (data and rules, server too), `features/mining.js`, `world/caves.js` (`minePlan`: veins and camp),
`sim/player/tool.js` (a swing per job, rhythm), `view/heldtool.js` (the pick), `view/livehero.js`, `features/woodcut.js`
(marks only its own job's slot as held), `content/items.js` (pick, stone, copper ore, iron ore, Glow Shard),
`content/skills.js`, `content/gear.js` + `ui/gearicons.js` + `ui/geartip.js` (the miner's cap), `content/paints.js`
(copper, rust, ironore, quartz), `server/room.mjs`, `server/server.mjs`, `features/coop.js`, `net/client.js` (the welcome
carries each entry's fields), `core/events.js` (mine.hit, mine.spent, mine.chunk, mine.grow, mine.take), `core/flags.js`
(mining, rhythm), `core/features.js`, `audio/audio.js` (stand-ins), `ui/pause.js`.
