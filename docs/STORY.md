# The story: what has happened, and always a next thing to find

WIP, the first slice (2026-10-23, thread "Uppdrag och spelets riktning"). Christoffer's direction: you look out over the world
and get some guidance on what has happened and what to do (a film, a quest, some input), then things happen naturally (you
find things, they unlock things), and you should never get stuck: there's always something to work toward.

Everything here is a starting point to change after playing. The words live in `src/content/story.js` and the chapters'
leads in `src/content/almanac.js` (`lead`), so rewriting the story is editing text, not code.

## The premise (a placeholder story, easy to replace)

The night the sky tore over the valley, Hilma, who kept the almanac before you, went down under the hill after the sound and
didn't come back. You wake by the tear with her almanac in your bag. Her voice is the almanac's: the line under each
chapter, the notes in the margins at her places, the last words of each film. The tear is the rift anomaly that already
hangs south of the forest (`features/anomaly.js`); the story makes it the thing that happened.

## The three parts

**The films** (`BEATS` in `content/story.js`, played by `features/story.js` through the cinema camera's scripted shots,
`features/cinema.js` `play`):
- *The intro*, the first time a save enters the sandbox: the tear, the forest's edge, then you; six lines in a pixel frame at
  the bottom. Space (or a click) shows the whole line, then the next. Esc skips the film. You're held still meanwhile (the
  `player.stuck` note, source `story`).
- *The tear's film*, when chapter VII is done: the tear looks back, more tears open far off, the almanac is full.

**The leads**: every almanac chapter has a line from Hilma under its name on the card (why, in the story). Under Today the card
has a **Lead** line: the next of her places you haven't found, its hint ("a stone with a face, at the forest's edge") and its
way from you ("N, a walk"). No arrow on purpose: you go and look.

**Hilma's places** (`PLACES`): 12 spots of the forest plan (the tear, a troll stone, the cave's mouth, the quiet stones when
the uncanny forest is on, the lake, the clearing, the spring, the boulder field, the gully, the windthrow, the tors, the
mire). Walk within a few metres and it's found: her margin note shows at the bottom middle for a while and goes into the Journal's
**Discoveries** page; the Lead moves on to the next one. The order runs from the spawn outward, so the Lead always has a
next place until you've seen them all.

**Chapter VII. The Tear** (after Nightglass): find 6 of her places, then at night carry the Nightglass light to the tear
(the pointer shows the way). Its gift is 2 night ore; its film ends the almanac.

## With friends

Nothing on the server. The places come from the forest plan (the seed: the same for everyone), the found list and "intro
seen" are each player's own save (`pack.store('story')`), and a film plays only on the screen of the player it's for.

## Switches and dev rows

| What | How |
|---|---|
| no story at all | `?story=0` |
| the intro again (once a page load) / never | `?intro=1` / `?intro=0` |
| jump the almanac to chapter VII | `?chapter=7` |
| play a film, go to the Lead's place, find all, forget all | F10 > Gathering > Story |

The intro doesn't play with `?tour` or `?chapter`. With `?cinema=0` the lines play over the game's own view.

## Not yet (ideas, not decisions)

- Places that give something, or open something (a recipe, a shortcut, a new person).
- People: someone in the settlement who reacts to what you found, or Hilma's things turning up (the fox's thimble).
- More tears: the tear's film promises them; they are where the rifts (the runs) could come in.
- Voiced or drawn cards instead of text; music under the films.
