# Fishing

Status: 2026-10-14. The first slice (2026-10-13, PR #15): a rod in the main hand, a quick cast / bite / reel minigame at the
forest lake, the streams and the river, 16 fish and 5 odd finds across the five rarities, 12 pieces of fishing gear with
fishing stats, a Fishing skill, catch records, and the catch rolled by the server in co-op. The second layer (2026-10-14):
fishing spots on the water, cut bait, meals cooked at a campfire, the angler's set and the fish journal. The ideas around it (what fishing
could connect to, builds, cooking, the weird stuff) live in the "Fishing (WIP)" notes doc, not here: this file says what the
game does now.

## Try it

`?mode=sandbox&forest=1&gear=cane_rod` (or Tab: the gear panel, main hand, the fishing rods) and walk to the lake, a stream
or the river. With the cursor on water within reach a prompt says `LMB cast`.

1. **Cast.** Hold LMB: a meter over his head runs up and back down (1.5 s a cycle). The charge is how far it goes (2.5 m to
   the rod's reach, 9 m x the rod's cast). Let go at the gold top band for a **perfect** cast: more luck on this one, more XP.
2. **Wait.** The bobber bobs. **Nibbles** dip it: striking then is too early (the fish is spooked, the wait grows by 2.5 s).
3. **Bite.** The bobber goes under with a "!": press LMB within the hook window (0.8 s + the gear's hook) to strike. Miss
   it and the fish lets go; another may come.
4. **Fight.** A gauge over his head: the fish on the line, the strain bar under it. Hold LMB to reel (the line comes in,
   the strain rises), let go to ease it (the strain falls, the fish takes a little line). When the fish **turns** (a flash
   and "it's turning!") a **thrash** follows: reeling through it strains the line hard and gains little, so let go until it
   passes. Full strain snaps the line; a fish left at the end of the line for 4 s swims off.
5. **Catch.** Reeled in (a landing net takes the last stretch), it leaps out to him: a card with its size and weight,
   NEW for a first, RECORD for a bigger one; it goes in the pouch, Fishing XP comes with it.

A press while it waits brings the line in. Walking off (1.6 m), a roll, or taking the rod off ends it.

## Fishing spots

A few spots on the water around him: rings spreading and bubbles wheeling over one place, now and then a fish breaking the
surface. The prompt says `spot!` with the cursor on one. A cast that falls within 1.8 m of a spot bites sooner (the wait
x 0.45) and rarer (+0.2 luck), and a catch from it spends it (for you). Spots move every 75 s: the water is cut in 7 m
cells, each holds a spot in a slot with 24% odds, at a hashed place at least 0.8 m from the bank (`SPOT`, `spotAt`). They
fade in and out over 4 s at the slot's ends. The slot clock is the sim's offline and the server's online, with the world's
seed, so friends see the same spots; the server checks a cast's "on a spot" against the same hash (`spotNear`).

## Bait

Tab (the pack), **Bait**: `Cut bait x4` cuts one roach, bleak or minnow into four baits. While you have bait, one goes on
the hook every cast that lands on water (the prompt shows how many are left). Cut bait makes predators bite more: pike,
zander and burbot x3, eel x2.5, trout and salmon x2, perch x1.3 (`BAITS`).

## Meals

Tab, **Cook**, standing within 2.5 m of a burning campfire (a fire with fuel, features/campfires.js `burningNear`). Since
2026-10-16 every dish is cooked on a stick over the flames and pulled raw, done, just right or burnt, and the smoked eel,
the pike stew and the fish with lingon have moods instead of numbers you see: **docs/COOKING.md**. The four below without a
mood keep their numbers (done or just right; raw: the numbers for half the time; burnt: a smoke trail, animals notice you
from twice as far). One meal at a time (a new one replaces it). The time left shows bottom left and in the journal, and is
saved. Each need is paid with the kind you have most of. The table is the old numbers (still under the moods when done):

| meal | needs | lasts | does |
|---|---|---|---|
| Fish on a stick | 2 small fish (perch, roach, bleak, minnow) | 4 min | move 6% faster, reel 10% faster |
| Angler's soup | 3 fish (any non-masterwork) | 5 min | bites 20% sooner, fishing luck +5% |
| Trout in birch bark | 1 brown trout or grayling | 5 min | more time to strike (+0.2 s), cast 15% further, move 4% faster |
| Pike stew | 1 pike + 1 small fish | 5 min | take 10% less harm, chop 15% harder, line 15% stronger |
| Smoked eel | 1 eel | 7 min | lantern reaches 30% further, night waits much shorter, luck +5% |
| Salmon on a plank | 1 salmon or arctic char | 7 min | fishing luck +12%, 6% chance of two fish, move 5% faster |

The buff is modifier notes under the source `meal` (`content/meals.js` MEALS, `features/meals.js`: since the foraging slice,
2026-10-15, the meals are their own feature, shared with the foraged ones: docs/FORAGING.md); their owners read them
(player.speed: the player, game.hurt: game/stats.js, woodcut.power: woodcut, light.lanternR: the lantern). In co-op the cast
tells the server the meal's id and it adds the same notes to the roll (`mealNotes`).

## The angler's set

Four or more fishing pieces worn at once (any slots): fishing luck +8%, a 5% chance of two fish, +0.15 s to strike (`ANGLER`,
source `fishing.set`). A toast says so when the fourth goes on. The server counts the pieces from the set you wear.

## The fish journal

Tab, **Fish**: all 21 catches in a grid. The ones you have caught show their icon, count and (on hover) your record; the
ones you haven't are dark silhouettes, and hovering one gives a hint of where and when it bites (`hintOf`: "the lake;
at night, deep water"). Under it: how many kinds you have found, the angler's set (pieces worn) and the meal eaten.

## What bites (content/fishing.js)

`roll(rng, o)` picks the catch: the rarity's base weight (common 60, fine 26, rare 10, masterwork 3.4, mythic 0.6),
pushed toward the rare ones by **luck** (each rarity tier x (1 + luck)), then each catch's own taste: the water (lake /
stream / river, from world.js `waterSample`), the part of the day (`when`), rain, and how far from the shore the bobber
lies (the deep ones, char and zander, want 3 m+), a fishing spot, and the bait on the hook. 8% of rolls (+ find) are **finds** instead of fish (an old boot,
driftwood, a rusty key, a note in a bottle, a silver ring). Size is skewed small; weight follows length cubed. The wait is
3.5 - 10 s x lure (night fishing gear cuts it at night), with 0 - 3 nibbles before the bite.

| rarity | fish |
|---|---|
| common | perch, roach, bleak, minnow |
| fine | pike, brown trout, bream, tench |
| rare | zander, grayling, arctic char, burbot |
| masterwork | eel, salmon |
| mythic | Näcken's Fiddle, Thousand-eye |

Each fish fights its own way (`fight`: stamina, pull, how often it thrashes, how wide it darts): a minnow comes in on one
pull, a pike thrashes often and pulls hard, an eel is long and slippery. All numbers are in `TUNE` and `CATCHES`.

## Fishing stats and gear

Fishing stats are modifiers (`host.mods`, stats `fish.*`, docs/ARCHITECTURE.md): the gear's notes and the Fishing skill's
(+0.01 luck and +2% reel speed a level) add up; the fishing feature reads them.

| stat | base | what it does |
|---|---|---|
| fish.luck | 0 | rarer catches (each rarity tier x (1 + luck)) |
| fish.lure | 1 | the wait for a bite (x; lower is faster) |
| fish.reel | 1 | reeling speed |
| fish.line | 1 | line strength: strain builds slower |
| fish.cast | 1 | reach of a full cast |
| fish.hook | 0 | s added to the hook window |
| fish.double | 0 | chance of two fish at once |
| fish.find | 0 | chance of a find instead of a fish |
| fish.size | 1 | bigger fish |
| fish.net | 0 | the last stretch the landing net takes |
| fish.night | 0 | shorter waits at night |
| fish.rain | 0 | luck while it rains |

The 12 pieces (content/gear.js, kind `fishing`): rods (main hand: the willow switch, the split-cane rod, the pike rod, the
ash fly rod, Näcken's bow), the fly-tier's hat and the sou'wester (head), the angler's vest (body), waders (legs), felt-soled
boots (feet), angler's mitts (hands) and a landing net (off hand). Each has an icon and a hover card saying what it does
for fishing (ui/geartip.js). A rod rides on his back like the other long things and is in his hands (pixel lines) while
fishing.

## Co-op (docs/MULTIPLAYER.md)

- **The server owns the roll.** A cast that lands on water asks (`fish` `cast`: where, which water, how deep, rain, a
  perfect cast, his Fishing level); server/room.mjs rolls it with the same `roll` from the set he wears (it has it) and its
  own clock, and answers him alone (`bite`: what, how big, when). A cast far from where he stands gets no answer. With no
  answer in 2.5 s (an older server) the client rolls it itself.
- **The fight is the client's.** A landed catch is told to the server (`land`), which tells everyone (`caught`): the others
  get a toast "Anna caught a Pike, 54 cm".
- **Spots, bait, meals and the set** go into the server's roll too: the cast says `spot`, `bait` and `meal`; the server
  checks the spot against its own clock and the hash, and counts the set from what you wear.
- **A hand grab** (the lingon's fish: docs/COOKING.md) asks the server (`grab`); it checks the meal codes and rolls a common
  or fine fish (`roll`'s `hand`).
- **Fish shadows** (`SHADOW`, `shadowAt`): the fish you can see under the water are the same for everyone (the seed and
  the clock); other features ask `features/fishing.js` `shadowsNear`.
- Not yet: others seeing your line, bobber and fish; the server checking the pouch (bait and meals are the client's word,
  like the Fishing level).

## Code

- `src/content/fishing.js`: the waters, `TUNE`, the stats, the catches (with their pixel icons), `roll`, `SPOT` / `spotAt` /
  `spotNear`, `BAITS`, `ANGLER`, `castNotes`, `hintOf`. Pure data, read by the client and the server. The meals:
  `src/content/meals.js` and `src/features/meals.js` (the Cook list, the buff, its chip).
- `src/features/fishing.js`: the feature. Sim: the phases, the roll, the fight, the catch (pack, XP, records in
  `pack.store('fishing')`). View: rings and spray, the bobber, the fish under the water, the rod and line, the leap. HD:
  the prompt, the meter, "!", the fight gauge, the catch card. It claims LMB through `F.lmb` (core/input.js) while it can
  cast or is fishing. Also the spots (found when he crosses a cell or the slot turns), the Bait recipes and the
  journal (pack.recipe, pack.section) and the set's notes.
- Small additive hooks elsewhere: `pack.section` and recipe groups (features/pack.js, ui/packpanel.js), `burningNear`
  (features/campfires.js), the bait item (content/items.js), the sizzle (audio/audio.js `fishCook`).
- `src/content/gear.js` (the 12 pieces), `src/ui/gearicons.js` (their icons), `src/ui/geartip.js` (fishing words),
  `src/content/items.js` (each catch is a pouch item), `src/content/skills.js` (the Fishing skill).
- `server/room.mjs` (the roll), `src/net/client.js` / `src/features/coop.js` (the messages), `src/net/protocol.js`.
- `src/audio/audio.js`: the cast, plop, nibble, bite, reel clicks, drag, snap, splashes and the catch jingle (brighter the
  rarer).
- `?fishing=0` turns it off.
