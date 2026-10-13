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
suspicion builds, faster the closer and the louder you are, ten times slower while a deer has its head down grazing, slower while
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

## With friends

Presentation only, like the arena's wildlife: nothing is sent and the sim never reads them. Everyone gets the same animals in
the same places from the forest's seed, and each client runs them against every player it knows of (co-op's peers too), so a
friend sprinting through a glade scatters the deer on your screen as well. Exactly where a fleeing deer ends up can differ a
little between screens. The same goes for the new bits: a touch, the stares and the odd hare are each player's own (your friend
sees the deer bolt only because you are close to it on their screen too). If animals ever matter to play (hunting, taming, a creature that follows one of you), that part moves
to the server like the uncanny forest's elk.

## Sounds

They reuse the arena wildlife's events, so the audio feature already plays them: `wildlife.wings` (a raven lifting off),
`wildlife.birds_scatter` (a capercaillie's burst), `wildlife.caw` (the ravens), `wildlife.critter_dash` (a bolt through the
undergrowth), `wildlife.howl` with kind `fox`, call `yips` (the fox at night). No deer bark or woodpecker yet.

## Switches and knobs

| what | where |
|---|---|
| on / off | `?fauna=0`; menu > Dev > Nature > Forest animals; off at Graphics > Detail: low |
| go and meet one | menu > Sandbox > Animals: go to the nearest roe deer / fox / hare / squirrel / raven / capercaillie |
| counts and homes | `FAUNA_TUNE` in `src/world/fauna.js` (herds, how many, roam radius, how far apart) |
| distances, speeds, hours | `TUNE` in `src/features/fauna.js` (alert / flee m, run / walk m/s, the hours each is out) |
| sizes and shapes | the recipes in `content/recipes.js`, the pivots in `FAUNA_RIG`; the asset lab: `?mode=sandbox&lab=roe` |
| noticing, touch, the strange | `TUNE.sus`, `TUNE.touch`, `TUNE.elk`, `TUNE.watcher`, `TUNE.odd` in `src/features/fauna.js` |
| try the strange | menu > Sandbox > Animals: the nearest herd turns and stares / the odd hare comes (at night) |
| state, for a test | `__r3d.host.feature('fauna').dbg()` (each animal's suspicion, what you can touch, the odd hare) |

## Not yet

- Small things: songbird flocks in the trees, butterflies over the glades, dragonflies by the lake, a woodpecker drumming.
- A deer's bark and a hare's thump as sounds of their own.
- Tracks in the snow, droppings, a fox's den you can find.
- Hunting (meat and hides) and a fox that comes to trust you if you leave it food: these need items and the server to own the
  animal (like the elk), so they come later.
- Ravens that follow the elk by day and circle over it.
