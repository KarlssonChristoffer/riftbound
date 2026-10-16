# The workshop

Status: 2026-10-16, the "Verkstaden" brief (`/mnt/project-files/briefs/workshop.md`), all five slices, built on PR #21. A Clay
Furnace and a Stone Anvil turn the cave's ore and the forest's logs into tools and clothes, and every made thing remembers who
made it and what it has done since. This file says what the game does now; the direction lives in the brief and in the
"Depth and bigger projects" notes doc.

## Try it

`?mode=sandbox&forest=1&seed=1337` (add `&fresh=1` for a new world, `&smelt=0.1` for quick charges). Esc > Sandbox > Workshop:
"makings" puts a furnace's, an anvil's, a bellows' and a tool's makings in the pouch; there are also a test Iron Axe (birch
haft), a test Iron Pick (pine haft, shard inlay), "the nearest furnace at white heat" and "crack the nearest iron vein".

1. **Logs per species.** Each tree drops its own log (Oak, Birch, Pine, Aspen, Willow, Rowan logs, Deadwood). A cost of
   "logs" (`wood`) takes any of them, the kind you have most of first; fires burn any.
2. **Clay Furnace** (Tab > Build: 12 stone, 2 logs). E feeds it a log. Tab by it opens the workshop panel on the right:
   - **Load copper** (2 copper ore) or **load iron** (3 iron ore). A charge cooks while the furnace is hot enough, then a bar
     slides out onto the stone. The bar is the loader's: walk over it to take it.
   - **Heat** is said in words and shown as the mouth's colour (cold, dull red, red, orange, yellow, yellow-white, white).
     A burning fire alone rests it at red, enough for copper (15 s). Iron needs yellow-white (20 s).
   - **LMB on it pumps** the birch blowpipe; a pump in rhythm counts 1.5x. One blowpipe alone tops out at about .85, just
     short of iron: it takes a friend pumping too, or a **bellows** (2 copper bars, 1 log).
   - Above white heat it eats its wood twice as fast.
3. **Stone Anvil** (Tab > Build: 8 stone, 1 oak log). Tab by it: pick what to make, the haft (one of the logs you carry, each
   with what it does), the glow-shard inlay. "Lay it on the anvil", then **LMB hammers**. 6 counts finish it; a blow in
   rhythm counts two.

| Off the anvil | Costs |
|---|---|
| Iron Pick, Iron Axe | 1 iron bar + 1 haft log (+ inlay: 2 glow shards, 1 copper bar) |
| Kettle helm | 2 iron bars |
| Iron-shod boots | 1 iron bar, 1 log |

4. **Hafts.** Birch swings quick (x.85 swing time). Oak lands heavy (x1.3 power, x1.15 swing time). Pine is resin: hold E a
   second by a burning fire and it burns as a small torch for 3 minutes (a light, and a lantern to the cave). Rain outside
   the cave puts it out, and so do the soot things. Aspen, willow, rowan and deadwood make plain hafts. The tool in your hand
   is drawn in its haft's wood.
5. **Inlay.** Glow shards set in the head: each blow lights the rock pale green for a moment.
6. **Fire-setting** (the first iron). Iron veins are too hard for the old pick ("too hard: fire would crack this"). A
   campfire, fire ring or furnace burning within 2.5 m of one for 45 s cracks it for 6 in-game hours: its seams glow, the old
   pick can take it, and it gives one chunk more.
7. **Things that remember.** Hover a made tool's bag slot: "Forged by Ann on day 4, of cave iron and home-woods birch.",
   then what it has done (trees felled, old oaks, veins, iron veins, its firsts). Shift shows every line.
8. **Clothes get a source.** The gear panel shows what you own: the fishing, foraging and mining pieces (always yours), and
   the clothes you made. The Kettle helm and the Iron-shod boots come off the anvil. Birch-bark shoes (2 birch logs), the
   Birch-bark pack (3 birch logs) and the Torch (1 pine log) are made by hand: **Tab > Make**. One of each is enough; made
   clothes take no bag slot. `?allgear=1` shows every piece; the dev wardrobe (Shift+Tab) still wears anything.

## Knobs and where they live

| What | Value | Where |
|---|---|---|
| furnace, anvil: cost, how many, collider | 12 stone + 2 logs, 2 each; 8 stone + 1 oak log | `src/content/builds.js` furnace, anvil |
| furnace fire: logs to light, s a log, most logs | 2, 60 s, 6 | `content/builds.js` furnace.fire |
| heat: fire's rest, white, fall back, cooling | .45, .9, .35/s, .12/s | `src/content/workshop.js` HEAT |
| a pump: blowpipe, bellows, rhythm, how often | +.05, +.10, x1.5, .6 s | `content/workshop.js` PUMP |
| charges: ore, s, heat needed | copper 2 -> 1 bar, 15 s, .45; iron 3 -> 1 bar, 20 s, .86 | `content/workshop.js` CHARGES |
| bellows | 2 copper bars, 1 log | `content/workshop.js` BELLOWS |
| anvil recipes; by hand | see the tables above | `content/workshop.js` SMITH, HAND |
| inlay: cost, light | 2 glow shards + 1 copper bar; 3.5 m, .3 s full, 2.5 s fade | `content/workshop.js` INLAY |
| hammer counts | 6, rhythm 2 | `content/workshop.js` HAMMER |
| hafts: swing, power, pine burn | birch .85; oak 1.3 / 1.15; pine 180 s, E held 1 s | `content/workshop.js` WOODS |
| fire-setting: range, time, how long | 2.5 m, 45 s, 6 h | `content/workshop.js` FIRESET |
| reach: panel / pump, server check | 2.6 m, 4 m | `content/workshop.js` REACH |
| Iron Pick, Iron Axe: tier, power | 2, 1.25 | `src/content/items.js` |
| free kinds; made pieces | fishing, foraging, mining; 5 | `src/content/gear.js` FREE_KINDS, MADE |
| a record's history lines, how many shown | counts + firsts, 2 (Shift: all) | `content/workshop.js` LINES |
| URL | `?workshop=0`, `?heat=2`, `?smelt=0.1`, `?allgear=1` | `src/core/flags.js` |
| server | `--heat`, `--smelt`, `--wardrobe` | `server/server.mjs` |

## The material and recipe interface (for the other builds)

- **A log** is an item with `wood: true` (`content/items.js`). A haft or a fire takes it; a cost of `wood` takes any. Give
  it a line in `content/workshop.js` WOODS to make it a haft with a trait (`swing`, `power`, `lit`).
- **A charge** (ore -> bar) is a line in CHARGES: `{ore, n, bar, t, heat, name}`. The panel lists every line. Bog iron would
  be `{ore: 'bog_iron', n: 4, bar: 'iron_bar', ...}`.
- **An anvil recipe** is a line in SMITH: `{name, cost: {item: n}, haft?: true, item?: a made item, gear?: a gear id}`. A
  hand recipe is a line in HAND: `{name, cost, gear}`. The anvil panel and Tab > Make list them; the server reads the same
  lines.
- **A made item** (a tool that carries a record) has `made: true` in `content/items.js`.
- **A gear piece that must be made** goes in `content/gear.js` MADE (`'anvil'` or `'hand'`). Anything not free and not
  made stays dev-only.

## Co-op

The server is the authority (`server/workshop.mjs`, called from `server/room.mjs`):

- **Records** are kept per player by a browser key (`localStorage rb.key`, sent in the hello with the save's copy of the
  records, clothes first, at most 64). `make` mints a record and answers `{k: 'made', rec}`; the client pays its pouch when
  it hears it. The welcome gives every record back.
- `fell` and `mine` carry the tool's uid; the server counts them into its record and sends `{k: 'rec', u, counts, marks}`
  at most every 2 s.
- **Furnaces** ride on their build's world entry (heat, charge, bellows, bars); `load`, `pump`, `fit`, `take` are acts;
  changes come as `{k: 'smith', id, s: heat | loaded | fit | pumped | smelted | taken}`. A bar is the loader's.
- **Fire-setting** is a world entry `'k' + vein` (`{s: 'cracked', at}`), closed by the regrow tick (`s: 'grown'`).
- **Wear** keeps only owned pieces (the free kinds and the player's records), unless the server runs with `--wardrobe`.

## Defaults picked (brief section 9)

- Fire-setting is the way to the first iron (the old pick takes a cracked vein).
- No Smithing skill: the workshop emits `smith.smelt` and `smith.make` for the skill-verbs build to hook.
- A bar is the loader's, even when friends pumped.
- Which tool a job uses: the bag's slot order; click a tool in the bag to prefer it.
- Tools never wear out. The start axe and the old pick have no record.
- The maker's name offline is the co-op name, else "Forged by your hand".
- The furnace is roofed (rain doesn't cool it); a lit pine haft goes out in rain outside the cave.
- Unowned clothes in an old save are dropped quietly on load. Made clothes take no bag slot.
- The pump is the chop swing's pose (no new animation); E by a furnace feeds it a log, E held a second by a fire lights a
  pine haft.

## Left for the other briefs (stubs only)

- Charwood and lightning-struck wood (weather brief): plain WOODS lines can be added.
- Bog iron (weather brief): one CHARGES line.
- A charm slot (keepsakes brief): pieces in a slot outside today's eight are never hidden by the owned filter.
- A Smithing skill (skill-verbs brief): the events above.
- Leather bellows and fur, hide and feather clothes (living-animals brief): BELLOWS, MADE.

## Not checked yet

The browser checks (golden, smoke, simview) and the perf bench need the game to boot, which the cloud can't do (the
character sprites aren't in git). The rules are checked with node tests of the client features and the server room.
