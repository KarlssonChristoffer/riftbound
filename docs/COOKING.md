# Cooking: meals that change how you play

Status: 2026-10-16, slices 0-2 of the brief "Mat som ändrar hur du spelar" (`/mnt/project-files/briefs/meals-that-play.md`).
This file says what the game does now. Ideas for later live in the brief and the notes doc, not here.

## The stick

Tab, **Cook**, standing within 2.5 m of a burning campfire or Stone Fire Ring. Click a dish. The ingredients are paid, the
panel closes, he crouches facing the fire and holds the food over the flames on a stick.

- The food's colour goes raw, warm, golden, brown, black. The sizzle climbs in pitch.
- When it's **just right**, fat drips and the fire flares up for a moment.
- **E, LMB or Space** pulls it out and he eats it.
- Walking off, getting hit, or the fire going out pulls it out at once, however far it got.
- Left on 5 s past its time, it **falls into the fire**: gone, the ingredients lost.

Each dish has its own cook time (`cook.t` in `content/meals.js`):

| dishes | cook time |
|---|---|
| fly agaric broth | 2.2 s |
| blueberry soup, angler's soup | 2.6 s |
| fried chanterelles | 3.0 s |
| fish on a stick, trout in birch bark, fish with lingon | 3.4 s |
| smoked eel, pike stew, salmon on a plank | 4.2 s |

| pulled | when (t = the cook time) | what you get |
|---|---|---|
| raw | before t - 0.4 s | the mood for 90 s, none of the dish's hidden numbers |
| done | t +/- 0.4 s | the mood for 180 s and the hidden numbers |
| just right | t +/- 0.12 s | done, and 60 s longer (240 s) |
| burnt | after t + 0.4 s | the burnt twist for 120 s, no hidden numbers |

The broth's trip lasts 45 s raw and 90 s done or just right; burnt, it's the still (60 s).

## The moods

One meal at a time (a new one replaces it; the broth's trip stacks on top). Every mood is modifier notes under the source
`meal`; the system that owns each note applies it. You never see a percentage: the Cook list says what it does in words.

| dish | mood | burnt |
|---|---|---|
| Fried chanterelles | **The ringing pick.** Every pick blow rings, and each unspent vein within 14 m answers from where it is, 40 ms a metre later, quieter further off: stone a dull tok, copper a ting, iron a bell, a night vein a two-note chord, a hollow wall a hollow knock. A little grit sifts where it answers. | The answers come from the point mirrored through you: to find the copper, walk away from the ting. |
| Smoked eel | **Eel eyes.** In the dark you see: a cold green-grey wash on the ground out to about 11 m, the colours a little colder. A lit lantern or a burning fire within 5 m (yours or a friend's) fades it out in 1.5 s; it comes back 3 s after. The night veins still show. | Eel eyes, and your eyes shine: two green dots friends see. The cave's soot things go for you as if your lantern burned. |
| Blueberry soup | **Blue fingers.** Every step leaves a purple print that glows in the dark and fades over 60 s. Friends see them. | The prints point backwards. |
| Fish with lingon | **Fish come to you.** Stand still in shallow water for 2 s: 3-6 fish slide in from 8-12 m over 4 s and circle your shins. When one turns past your feet it flashes silver for 250 ms: **E** grabs it (common and fine fish only). A miss scatters them for 5 s. With a rod, a cast within 4 m of you counts as a fishing spot. | The fish flee you, and gather round a friend standing in water within 15 m, who can grab them. |
| Pike stew | **Heavy as a pike.** You walk a little slower, start and stop slowly, turn in an arc instead of snapping round; the wind and the river push you much less, a knock moves you less; heavy footfalls and dust. | **Light as ash.** You turn and start fast, the wind and the river take you, knocks throw you, your steps are silent and animals notice you later. |
| Fly agaric broth | The trip, as before. | **The still.** The colours drain toward grey, nothing sways, every animal within 40 m stops and stares at you, no Watcher. |
| Fish on a stick, Angler's soup, Trout in birch bark, Salmon on a plank | Their old numbers (no mood of their own yet). | **Smoked out:** a thin smoke trail follows you and animals notice you from twice as far. |

## Knobs

| knob | value | where |
|---|---|---|
| moods on / off (off: the old % notes, cooked at once) | on | `?moods=0` |
| the stick on / off (off: every dish is "done" at once) | on | `?cook=0` |
| mood lengths: raw / done / just right / burnt | 90 / 180 / 240 / 120 s | `content/meals.js` TUNE; `?moodlen=` multiplies them |
| the done window's half-width | 400 ms | `content/meals.js` TUNE.win; `?cookwin=` (ms) |
| the just-right window's half-width, the drop | 120 ms, +5 s | `content/meals.js` TUNE.right, TUNE.drop |
| the stick: fire reach, the food's colours, the sizzle | 2.5 m | `features/cooking.js` STICK |
| the fire's flare | 0.7 s, flame x1.6, light x1.5 | `features/campfires.js` FLARE |
| the ringing pick: reach, delay | 14 m, 40 ms a metre | `content/mining.js` RING |
| eel sight: darkness, reach, colour, fade | dark > .55, 11 m, out 1.5 s, back 3 s | `render/lighting.js` EEL |
| blue fingers: colour, life | #b070ff, 60 s | `features/meals.js` LOOK.glow |
| lingon: still time, fish, distances, flash, scatter | 2 s, 3-6, 8-12 m, 250 ms, 5 s | `content/fishing.js` COME |
| the fish shadows under the water | 8 within 25 m | `content/fishing.js` SHADOW |
| pike / ash numbers | walk x.9, start/stop x.5, turn x.4, wind x.25, river x.3, knock x.4 / turn x1.8, start/stop x1.6, wind x2, river x2, knock x2, noticed x.6 | `content/meals.js` HEAVY, ASH |
| how fast a heavy turn swings round | 600 deg/s x the turn note | `sim/player/player.js` HEAVY_TURN |
| the still: grey, the stare reach | 40 m | `features/trip.js` STILL, `features/fauna.js` TUNE.still |

## Dev

Esc > Sandbox:
- **Mood (dev)**: pick a dish, eat it raw, done, just right or burnt right now (no fire needed), or wear it off.
- **Cooking (dev)**: the stick's timing bar (raw, done, just right, burnt, and where it is now), pick a dish and put it on the
  stick for free by a burning fire.
- **Trip**: drink the broth.

## Co-op

- Your meal's code goes out with your state (`md`, e.g. `pike_stew!` burnt, `smoked_eel~` raw) and in every snapshot, so
  friends see your mood: glowing prints, eye shine, smoke trail, a few fish at your legs.
- A burnt eel's shining eyes go to the server as `lt: 2`: the soot things take it for a lantern; night veins don't.
- A hand grab asks the server (`fish` `grab`), which checks the meal codes (your lingon, or a friend's burnt one within
  15 m) and that you're standing where you say, then rolls the fish and tells everyone.
- The stick is your own; nobody else sees it.

## Code

- `src/content/meals.js`: the dishes (need, notes, mood, burnt, cook.t, words), TUNE, notesOf / durOf / nameOf / codeOf /
  parseCode / loudOf.
- `src/features/meals.js`: the Cook list, eating a meal at a quality, the chip, what shows of a mood (dust, smoke, eye
  shine, the glowing prints).
- `src/features/cooking.js`: the stick.
- Each mood's owner: `features/mining.js` (mine.ring), `render/lighting.js` (light.nightEye), `features/fishing.js`
  (fish.come; the shadows), `sim/player/player.js` + `adapter.js` (player.turn, player.knock, player.current),
  `features/fauna.js` (fauna.loud), `features/trip.js` (the still), `features/prints.js` (the prints, the weather build's).

Not yet (later slices): recipes you find yourself and the Cook journal, the shared pot, moods for the four other fishing
meals.
