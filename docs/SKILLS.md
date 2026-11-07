# Skills

Status: 2026-10-16, the "Skills that give verbs" brief (`/mnt/project-files/briefs/skill-verbs.md`, with
`depth-shared.md`). Every skill gives a new MOVE about every fifth level instead of a bigger number; the co-op server owns
the XP; the four skills climb at the same pace; a falling tree hits what it lands on; six titles. Only the Level 5 moves are
built. This file says what the game does now; the direction lives in the brief and the "Depth and bigger projects" notes.

## Try it

`?mode=sandbox&forest=1&seed=1337&movelvl=5` (add `&fresh=1` for a new world). `movelvl=5` makes every skill count as
level 5 for its moves, so all four work at once. Or play from `?fresh=1`: about 12 minutes of chopping gives Woodcutting 5.

- **The fall line** (Woodcutting 5). Chop a tree. When the next bite will fell it, pixel specks tremble on the ground where
  the trunk will lie and in a ring where the crown will land.
- **The tree's hit** (everyone). A felled tree hits what it lands on: the trunk's strip and the crown's circle.
  - A foe or a dummy takes 30 x the tree's size in damage and is shoved 1.5 m aside.
  - You are thrown sideways and hurt by 15% of your health. That is at least 1, it never takes the last of it, and it only
    counts in a fight. `?treehurt=0` turns the hurt off.
  - A standing tree shudders and loses one blow. The fall never fells it.
  - A crate or a barrel breaks, and the animals nearby bolt.
- **The chain** (Mining 5). Three rhythm blows in a row on one vein crack it open at once. Each blow must come 0.5 to 1.4 s
  after the last, and the sparks grow and the ping rises with each one. A plain blow, another vein or a long pause starts the
  count again. You get the XP of the blows it skipped.
- **Glimmer** (Foraging 5). Hold C and keep still for a moment: a faint wave goes out from you to 12 m. Each unpicked patch
  it passes shows a few dew specks winking for 4 s. It is half as bright at night.
- **Shadows** (Fishing 5). You see a fish circling under each fishing spot, small, medium or large.
  - Drop the bobber 0.4 to 1.2 m ahead of its nose and it turns and comes for it: a quick bite with no nibbles, and the catch
    is rolled from its class (large means rare and up).
  - Drop the bobber on the fish and it bolts. The wait grows and that fish is gone for you until the spots move.
  - A friend without Fishing 5 doesn't see your shadows.
- **The toasts.** Reaching a level shows a small pixel frame at the bottom centre with the skill's name and level ("Mining 5")
  and, when the level gives a move, the move's name. No explanation: the world shows you the move.
- **The pack panel** (Tab) lists the moves you have under each skill's bar, each with one plain sentence.
- **Titles**, one worn at a time:

  | title | earned by |
  |---|---|
  | the Cave Rat | 45 minutes in the cave |
  | the Feller | 300 trees |
  | Blueberry Mouth | 300 blueberries |
  | the Owl | 25 fish between dusk and dawn |
  | the Mole | 60 veins spent |
  | the Wanderer | 25 km walked |

  - Earning one shows a toast: "They call you the Owl."
  - The panel's title row, under PACK, shows the one you wear. Click it for the next one, then none.
  - In co-op your title shows under your name.

Dev: Esc > Sandbox > Skills has these rows:
- every skill to its next move's level
- all the moves (pretend level 5)
- every skill back to level 1
- earn every title
- clear the titles and their counts

Online these rows ask the server, and a server started with `--dev` does them. `?moves=0` turns every move off (the levels
still count). `?xprate=raw` gives the tables' own XP (no pace), and `?xprate=2` doubles every grant.

## The pace

Every XP grant is multiplied by its skill's `RATE` (`content/skills.js`). The aim is that an hour of focused doing gives
about the same in every skill, 45 XP a minute: level 5 in about 12 minutes and level 10 in about an hour.
`node tools/test/xprate.mjs` estimates each skill's rate from seed 1337's forest and the actions' timings:

| skill | raw XP a minute | RATE | rated | Lv 5 | Lv 10 |
|---|---|---|---|---|---|
| Woodcutting | ~287 | 0.16 | ~46 | ~12 min | ~57 min |
| Fishing | ~44 | 1.1 | ~48 | ~12 min | ~54 min |
| Foraging | ~65 | 0.75 | ~49 | ~11 min | ~53 min |
| Mining | one sweep of the cave, ~480 | 2.75 | a sweep ~1320 | 1 sweep | 2 sweeps |

The veins limit mining: the cave holds 19 the old pick can dig, and they come back an hour later. So mining's pace is
"a sweep makes Mining 5, two make Mining 10". These are estimates; a playtest decides whether it feels right.

## Co-op: the server owns the XP

- **Who you are.** Your browser makes a random player key once (localStorage `rb.player.key`) and sends it with your XP when
  you join (`hello {key, xp}`). The server keeps a record per key (`server/players.mjs`).
- **The first join** takes your XP from your own save, with each skill capped at level 10 (`--importcap`). After that the
  server never reads your local XP again. It grants XP itself on what it already sees:
  - a fell: the whole tree's XP, to the feller
  - a pick: the plant's XP
  - a blow on a vein: its XP to whoever struck it, and the spent vein's x4 to every striker
  - a landed fish: doubled the first time, x1.2 for a perfect cast
  - a broken crystal: once per crystal
- **Your levels.** Your client takes them from the server and keeps a copy in your save, so offline play goes on from
  there. The levels the server rolls with (a pick's yield, a vein's chunks, a cast) are always its own, never the
  client's word.
- **Moves that change the sim are checked against the server's record:** the chain (your level, and the gaps between
  your blows, counted by the server) and a cast at a shadow's nose (your level, and the shadow's place computed from the
  seed and the server's clock). The fall line, the glimmer and the shadows themselves are each player's own view.
- **The falling tree.** The server adds the fall's way to its 'fell' message, so the tree falls the same way on every
  screen. Each client tests only its own player, foes and props against it, so a friend is knocked over on his own
  screen and nobody's health crosses the wire.
- **Titles.** The server counts and grants them: the cave's seconds and the metres walked come from the moves it
  accepts. Your worn title goes to the others.
- **Restarts.** The records live in memory. A server restarted without `--data` takes your save's XP again (capped).
  `--data <dir>` keeps them in `<dir>/players.json` across restarts. It is opt-in: without it nothing is written to disk.
- **A test server.** `--movelvl N` makes everyone count as at least level N for the moves. `--xprate k` sets the pace, or
  `raw`. `--dev` makes the Sandbox's Skills rows work.

## The knobs

| knob | value | where |
|---|---|---|
| the pace | 45 XP a minute; RATE .16 / 1.1 / .75 / 2.75 | `content/skills.js` TARGET, RATE; `?xprate`, `--xprate` |
| the move levels | 5, 10, 15, 20, 30 (only 5 built) | `content/skills.js` MOVES |
| the first join's cap | level 10 | `content/skills.js` IMPORT_CAP, `--importcap` |
| the tree's hit | 30 x size damage, 1.5 m shove, thrown 4.2 m/s out and 3.4 up, 15% hurt; trunk 0.35 m wide, crown x 0.8 | `content/woodcut.js` TUNE.hit |
| the fall line | 24 specks along, 10 round the crown | `content/woodcut.js` TUNE.line |
| the chain | 3 blows, each 0.5 to 1.4 s after the last | `content/mining.js` TUNE.chain |
| glimmer | 1.2 s still, 12 m, 6 m/s, 3 to 5 specks, 4 s, 3 s between, half at night | `content/forage.js` TUNE.glimmer |
| shadows | 60 / 30 / 10% small / medium / large, .25 / .5 / .9 m; nose 1.2 m in 70 deg; spook .4 m; bite .8 to 2 s | `content/fishing.js` SHADOW |
| titles | as the table above | `content/skills.js` TITLES |

## Not built yet

- The moves for levels 10 to 30. They are listed in `content/skills.js` MOVES as `soon` and are never shown or toasted.
- The "found by doing" combos and more titles.
- The lasso as a bag tool (the Lasso the leaper move needs it) belongs to the living-animals brief.

## Where it lives

- `content/skills.js`: the skills, the curve, RATE, MOVES, TITLES, fellXP, hasMove, titlesEarned, inCave.
- `features/pack.js`: the levels, the moves (`pack.move(id)`), the toasts (`ui/skilltoast.js`), the titles offline, and the
  server's word online.
- `ui/packpanel.js`: the move lines and the title row.
- `server/players.mjs`: the records. `server/room.mjs`: the grants, the checks and the titles.
- The moves themselves are in their own features:
  - `features/woodcut.js`: the fall line and the hit
  - `features/mining.js`: the chain
  - `features/forage.js`: glimmer
  - `features/fishing.js`: the shadows. Other features get them from `fishing.shadowsNear(x, y, r, out)`.
- Tests:
  - `node tools/test/room.mjs` drives the room with fake connections and covers the records, the grants, the chain, the
    shadows and the titles.
  - `node tools/test/xprate.mjs` checks the pace.
