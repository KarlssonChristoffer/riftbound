# The forest's animals

Status: 2026-10-13, first slice + sneaking, touching, warnings and the strange. Ambient wildlife for the seeded forest (docs/FOREST.md): mostly harmless Swedish woodland animals
that live by the clock and react to people. Nothing here touches play yet.

Code: `src/world/fauna.js` (the plan: where each animal lives, a pure function of the forest's seed), `src/features/fauna.js`
(what they do), `src/features/fauna/look.js` (how they look). Assets: recipes `roe_*`, `fox_*`, `hare_*`, `squirrel_*`,
`raven_*`, `capercaillie_body` (content/recipes.js; the whole animals for the asset lab: `roe`, `fox`, `hare`, `squirrel`, `raven`,
`capercaillie`), paints `roe`, `russet`, `harefur`, `furdark`, `plumage` (content/paints.js).

## Who lives there

| animal | where (the plan) | when it is out | what it does near you |
|---|---|---|---|
| roe deer (rådjur) | 3-4 herds of 2-3 at the forest's edges in the home woods (a glade's rim beside thick wood), one in the high country; each herd has a bed in the thick of the trees near by | dawn and dusk (03:30-10, 16-23:30): grazing in the open; otherwise lying in cover | lifts its head and watches you at ~22 m, bolts at ~12 m, bounding with its white rump showing; the herd goes with it; stops a safe way off and looks back |
| red fox (räv) | 1-2, a den beside a rock outcrop, a block or the boulder field | evening and night (16:30-08:30): long trots round its range, stops to listen, yips now and then at night; by day curled up at its den | sits tight, watches, slips away at ~7.5 m |
| mountain hare (skogshare) | 5-7 on open ground with a little cover, 2 on the fell's bare top; white in winter | evening and night; by day it sits still in its form | lets you very close (~4.5 m walking, ~2.5 m while it sits), then zigzags off |
| red squirrel (ekorre) | 5-7 in the pine stands, each with a home tree and its neighbours | by day; at night it is away up its tree | forages on the floor; when you come near it races to the nearest of its trees and up the trunk, then keeps the trunk between you and itself; down again when you've gone. Sometimes runs up a tree for no reason |
| raven (korp) | one pair round the high country's rock | by day | walks and pecks on the ground; lifts off calling when you come near, circles high over its patch, lands again |
| capercaillie (tjäder) | 2-3 on the floor of the thickest pine (a black cock with a green breast and red brows, or a brown hen) | by day | walks and pecks; at ~6.5 m it bursts up with a clatter of wings and glides off low |

How close is close: the distances are for someone walking. Standing still counts as 0.3 of that, creeping (walking, Q held) 0.5,
running 1.45x, sprinting 2x. A gunshot scares everything within 38 m, a hit or something breaking within 14 m. Animals only appear
and leave (for the night, at dawn) while they are off the screen, so nothing pops in or out in front of you.

## Sneaking up, touching

The deer, fox, hares and capercaillie don't react the instant you are in range: they grow suspicious. Inside their alert distance
suspicion builds, faster the closer and the louder you are, five times slower while a deer has its head down grazing, slower while
you keep still, and it fades all the time. The tells: it stops, lifts its head and watches you (keep still and it settles again:
you're a stump); then it stands and stares; then it bolts. So: creep (Q) while its head is down, freeze when it comes up. Running at
one is no stalk: it goes at once. Get within 1.5 m of one that hasn't noticed you and E touches it (an "E  touch" prompt shows over
it): it leaps straight up and bolts, the herd with it, and a toast counts your touches this session. A startled roe barks.

## Warnings and the strange

- The uncanny forest's elk (features/uncanny.js, when it is on): at night it counts as someone very loud (1.8x), so everything gives
  it a wide berth; deer bolting and barking in the dark tell you it's about. By day they ignore it.
- The watcher (features/watcher.js): while it is up, the animals within 18 m of it stop and stare at it, all of them, until it
  goes. A herd all looking at the same dark trunk is your hint.
- At dusk and dawn a herd far off (24-46 m) now and then turns as one and stares at you, perfectly still, for a few seconds, then
  goes back to grazing as if nothing happened.
- One hare in each forest is odd. Some nights it is never where it was: once it's out of sight, it sits ahead of you on your way
  again, upright, watching you come (four times a night). Touch it and it's an ordinary hare again.

## Birds in the treetops

By day some trees have birds up in them that you never see until something startles them (`src/features/fauna/crowns.js`).
A shot (30 m), an axe in a trunk (12 m, and the chopped tree itself is likelier), a tree starting to fall (20 m), something breaking
or a bullet in a trunk (8 m), a blast (25 m): a little flock of chaffinches bursts out of the top of a crown, or a wood pigeon or
two with a clatter of wings, the crown shakes and lets a leaf go, and they beat away from the noise, climbing, and are gone. About
one tree in ten holds birds (a new draw every 20 game minutes), at most two crowns empty at one noise, and a tree that has just
emptied stays empty four minutes, so the first shot in a stretch of woods sends some up and the next ones mostly find them gone.
Recipes `finch` and `woodpigeon` (one mesh each, wings spread; in the asset lab too).

## With friends

Presentation only, like the arena's wildlife: nothing is sent and the sim never reads them. Everyone gets the same animals in
the same places from the forest's seed, and each client runs them against every player it knows of (co-op's peers too), so a
friend sprinting through a glade scatters the deer on your screen as well. Exactly where a fleeing deer ends up can differ a
little between screens. The same goes for the new bits: a touch, the stares and the odd hare are each player's own (your friend
sees the deer bolt only because you are close to it on their screen too). If animals ever matter to play (hunting, taming, a creature that follows one of you), that part moves
to the server like the uncanny forest's elk.

## Tracks in the mud

After rain the forest's soft ground takes a print of everything that walks on it: you, your friends, the roe deer's cloven
hoof in pairs, the fox's one neat line, the hare's bound (two long hind feet ahead of the small fore feet), the capercaillie's
three toes. The ground counts as wet from a wetness of .35 (`sim/env.js` `E.wet`) with no lying snow. Not every spot takes a
print: soft patches about 3 m across (a noise), and every puddle's hollow, take them; the moss and needles between them, rock,
the strand, the fell's bare top, water and the cave take none. By a puddle the print goes in deep and dark. A print lasts 8
in-game hours; heavy rain washes it out within an hour, and once the ground dries out it fades within an hour.

**The morning trails.** If the ground is wet when the day is first seen at 05:00 or later, the night's animals came home
through it: each roe herd walked 40-70 m to its bed (a line per deer, close together, merging at the bed), each fox 60-110 m to
its den, each hare 15-25 m to its form, all between 05:00 and about 09:00. The trail's prints appear as its hours pass (what was
already walked when you arrive, at once), and the animal walks its trail while it lasts: follow a fresh line and the deer is at
its end, in its bed. Near you (40 m) the animal itself walks the line and leaves its prints as it goes. The lines are a function
of the forest's seed and the day (`world/fauna.js` `trailOf`), so every friend sees the same trails; whether today is a trail
day is each client's call from its own ground's wetness until the weather is the same everywhere (the weather build).

The prints themselves are `features/prints.js`'s (the one owner of footprints and tracks, `docs/WINTER.md` "For other
features"): it walks you, your friends and the ground animals near you. `features/mud.js` adds the mud (its surfaces and the
rule that says where a step goes into it, and the rain's and the drying's wear); `features/fauna.js` stamps the morning trails.

## The Lasso

A Lasso is in your bag (a new world's start kit has one; an old save gets one, once). Hold F to spin it (the longer, the harder
it pulls), let go to throw it at what's under the cursor: an animal (a ring at its feet while you aim), a high limb to swing
from, or the ground. It's the equipment experiment's lasso with its own rope (`features/rope.js` on `features/equip/lasso.js`).
Never any harm: nothing on a rope is hurt.

- **A hare** comes: it tumbles to your feet and lies dazed for 2 s. E lifts it; you carry it for up to 8 s, walking at 0.6 of
  your speed; E puts it down (or it wriggles free) and it's off. In its moult (spring, autumn) a tuft of **Hare Fur** comes off
  in your hands, once an in-game day for each hare.
- **A fox** fights the rope and slips the loop after 1.5 s.
- **A roe deer** bolts and drags you behind it on your heels. It runs at 5.5 m/s, slowing to 1.5 over its 8-12 s (a deer's own;
  0.25 s less for each kg of gear past 4, never under 4 s). A / D swing its line up to 30 degrees, S leans back (0.8 m/s
  slower, it tires 1.5 times as fast), bushes and ferns slow it (a burst of leaves), the lake, a wide stream and rock turn it
  (a shallow stream it splashes through). Held back by a trunk or a rock, you're knocked flat (no damage) and the rope's gone.
  F or Space lets go at any time. Tired, it stands blowing, head low, for 6 s: E within 1.5 m calms it, the loop comes off,
  and for the rest of the in-game day it lets you walk past. The rest of the herd bolts when one is roped.

With friends it's a solo verb: the server gives the animal to the first who ropes it (30 s at most), the holder's client runs
it and sends where it is (the others see the deer drag you); a calm and a tuft of fur are the server's too
(`server/animals.mjs`). `?livefauna=0`: the Lasso doesn't catch animals.

## Finds

Nothing is killed for them: the forest drops them (`features/animalfinds.js`; where and when is a pure function of the seed and
the clock in `world/fauna.js` `antlersOf` / `feathersOf`, so every player has the same ones and nothing is sent).

- **Shed antlers.** Each roe buck drops two in late autumn and early winter (the last 40 % of autumn, the first 40 % of winter),
  each on its own seeded hour, within 8 m of his herd's bed in the thick wood. They lie till the end of the next spring.
  About three bucks a forest: six antlers a year. `?shed=now`: this year's lie now, whatever the season.
- **The lek.** On spring mornings (03:30-07:00) each capercaillie cock (every forest has at least one) walks to his spot and
  sings, tail fanned, neck up, wings drooped: clicks coming faster, a pop, then a grinding phrase. During the grind's last
  2.5 s he hears nothing (no suspicion builds, you can walk); when it stops, freeze. He's less wary while he sings (x .7).
  Get within 3 m and he bursts up; the first to do it gets two feathers straight into the bag. One or two feathers lie
  where he sang once he's been put up or the lek's hours are over, for 3 days.
- **The moult.** In summer a cock drops a feather every second day where he spends his day.
- **Hare fur.** A caught hare in its moult (spring, autumn) leaves a tuft in your hands (The Lasso, above).

E within 1.4 m picks one up (a Shed Antler or a Capercaillie Feather, materials in the pouch). With friends the first finder
has it and it's gone for everyone (the server's `find`); a late joiner gets the picked ones in the welcome. Offline the
picked ones are saved (`pack.store('animalfinds')`).

## Sounds

They reuse the arena wildlife's events, so the audio feature already plays them: `wildlife.wings` (a raven lifting off),
`wildlife.birds_scatter` (a capercaillie's burst), `wildlife.caw` (the ravens), `wildlife.critter_dash` (a bolt through the
undergrowth), `wildlife.howl` with kind `fox`, call `yips` (the fox at night). The lek's song is `wildlife.lek` (call `click`,
`pop`, `grind`), played on stand-ins for now (a wooden knock, a plop, a soft scrape). No deer bark or woodpecker yet.

## Switches and knobs

| what | where |
|---|---|
| on / off | `?fauna=0`; menu > Dev > Nature > Forest animals; off at Graphics > Detail: low |
| go and meet one | menu > Sandbox > Animals: go to the nearest roe deer / fox / hare / squirrel / raven / capercaillie |
| counts and homes | `FAUNA_TUNE` in `src/world/fauna.js` (herds, how many, roam radius, how far apart) |
| distances, speeds, hours | `TUNE` in `src/features/fauna.js` (alert / flee m, run / walk m/s, the hours each is out) |
| sizes and shapes | the recipes in `content/recipes.js`, the pivots in `FAUNA_RIG`; the asset lab: `?mode=sandbox&lab=roe` |
| noticing, touch, the strange | `TUNE.sus`, `TUNE.touch`, `TUNE.elk`, `TUNE.watcher`, `TUNE.odd` in `src/features/fauna.js` |
| birds in the crowns | `TUNE.crown` in `src/features/fauna.js` (share of trees, reaches, how many at once, how long empty) |
| try the strange | menu > Sandbox > Animals: the nearest herd turns and stares / the odd hare comes (at night) / startle the birds in the trees round you |
| state, for a test | `__r3d.host.feature('fauna').dbg()` (each animal's suspicion, what you can touch, the odd hare, today's trails) |
| the Lasso on animals | `ROPE`, `FUR` in `src/content/animals.js` (the hare's daze / carry, the fox's slip, the roe's speeds, tiring, steer, lean, brush, stand, calm); the weights in `WEIGHT.animal` (`src/content/lasso.js`); `?livefauna=0` off; menu > Sandbox > Animals: go to the nearest hare / roe deer |
| tracks | `?tracks=0` none; `?mud=1` or menu > Sandbox > Tracks: the ground wet now; menu > Sandbox > Animals: lay this morning's trails / go to the nearest roe bed |
| finds | `SHED`, `LEK`, `FINDS` in `src/content/animals.js` (the shed window, antlers a buck, how far from the bed, how long they lie; the lek's hours, song, deaf phrase, pauses, feathers, the bonus, the moult, how wary he is); `?shed=now`; menu > Sandbox > Animals: start the lek; Finds: go to the nearest shed antler / feather, drop a pair of antlers here; the look: recipes `roe_antler`, `caper_feather` |
| mud and trails | `MUD`, `TRAIL` in `src/content/animals.js` (wetness, patch size, softness, deep, wash; trail lengths, hours, print spacing, the most prints); the mud's colour and life: `SURF.mud` in `src/content/prints.js` |

## Not yet

- Small things: songbirds you can see sitting in the trees and singing, butterflies over the glades, dragonflies by the lake, a woodpecker drumming.
- A deer's bark and a hare's thump as sounds of their own.
- Droppings, a fox's den you can find (the snow's tracks: `docs/WINTER.md`).
- No hunting, ever (living-animals.md: nothing is killed). Taming (a roe calmed three days running that follows you, a fox fed
  at its den that stops stealing from you) comes later.
- Hopping a log while a roe drags you (Space lets go instead).
- Ravens that follow the elk by day and circle over it.
