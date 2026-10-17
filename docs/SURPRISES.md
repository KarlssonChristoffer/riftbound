# Night surprises

Small rule-benders in the persistent forest, built overnight on 2026-10-16 as things to find while playing. All of them live in
`src/features/surprises.js` (the feature) and `src/features/surprises/` (one part each), tuned in `src/content/surprises.js`.
Every one is personal for now: your own body, sky, eyes and finds. the dev menu (F10 > Nature > Night surprises) has a "Surprise: ..." row for each, so any of
them can be tried at once. `?surprises=0` turns all of them off; `?stars=now` makes the next clear night's first star fall a few
seconds in.

| surprise | how you find it | what happens |
|---|---|---|
| The rain dance | walk three laps round the standing stones on the West Downs' hill, without stopping | the stones hum each lap; on the third a bolt hits the altar and a storm rolls in. If it's already raining, the rain moves off instead. The danced weather holds 5 minutes |
| Storm-charged | get hit (or grazed) by lightning | 75 s of charge: faster running, sparks off you and your footfalls, a blue light; a jump's landing is a thunderclap; wade or jump into water and the charge goes into it: a blue ring, and 2-5 stunned fish float up into your pouch |
| The lightning rod | carry a thunderwood splinter (it drops at the foot of a struck tree) | the bolts come for you, as iron on you does. Folklore says it keeps the house safe; carried, it does the opposite |
| Falling stars | be out on a clear night | shooting stars cross the sky (in first person, look up). Every third, and the first each night, comes down near you with a flash and leaves a glowing star shard in a scorched star. Walk over it to take it. The dawn melts the ones nobody took |
| The star frenzy | carry a star shard into the lake at night | the lake drinks it and lights up from below; for 2.5 minutes every cast bites almost at once, and a little rarer |
| The looking-lake | swim out into the lake at night and float still for 6 s | a ring of moonlight closes in on you; when it meets you the world folds over into its mirror image for 80 s, and so do your controls. Float still again to come back sooner |
| It's raining fish | be out in a real storm | now and then a fish falls out of the clouds near you and flops about; walk over it before it flops off. Mostly small fry, sometimes a pike, bream or tench |
| Dizzy | spin the camera round and round (the mouse in first person, the middle-button drag from above) | the picture leans and sways, you stumble off sideways and turn slowly for 11 s |

The chain they make together: dance up a storm at the stones, keep a thunderwood splinter on you, stand out in the open, take
the bolt, then run to the lake and jump in for the fish. On a clear night after it, catch a falling star and give it to the lake.

**Multiplayer.** Each part's header says what a shared version would need. Today: the danced weather is yours to see (co-op
weather is parked), the splinter's pull works offline only (online the server aims the bolts by your gear), a server bolt that
hits you charges you all the same, and stars and shards are personal finds.

**How it's built.** Effects are modifier notes (`charged`, `stormrod`, `starfrenzy`, `dizzy`) read by their owners: the
player's speed and push, thunder's `thunder.iron`, fishing's `fish.lure` and `fish.luck`. The mirror and the dizzy lean are CSS
transforms on the game's frame (`src/view/screenwarp.js`), so there is no pixel work. The chips at the bottom left (pixel
frames, over the meal's) say what's on and for how long; while the world is mirrored they are drawn mirrored back.
