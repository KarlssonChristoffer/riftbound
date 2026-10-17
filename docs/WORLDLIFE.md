# Life in the world: what's new

What the night's builders added to the persistent world, one section each.

## Life in the sky (features/skylife.js)

Look up now and then, or rather look down: things high up show mostly as their shadows sliding over the ground, and as
themselves far up the screen (the chase cam and first person, F6, look up at them).

- **Geese.** V formations of 7-21 birds cross the whole map high up, wings beating, the V wobbling, the leader dropping back
  and another taking the lead now and then. North in spring, south in autumn; a few flights a day, mostly in the morning
  (about 05:30-09:00) and the evening (16:00-20:00). A stray flock in summer, rarely one in winter. Their shadows sweep
  over the ground on a sunny day.
- **Geese on the lake.** Some spring and autumn days (now and then in summer) a low flock comes down on the forest lake,
  sits there for hours bobbing and feeding, and runs over the water and takes off when anyone comes within ~11 m.
- **The murmuration.** Some summer and autumn dusks (~18:10-19:00) hundreds of starlings gather over the lake or the fell
  as one folding, morphing cloud, swirl for a minute or so, then pour down into the reeds or the trees and are gone.
  Sprint or jump under it and a wave runs through it.
- **Drifters.** Some nights (about one in three; rarely two), and on foggy dawns, something enormous and slow drifts over
  the forest: a bell of pale light trailing long glowing tendrils, or a manta-whale with two long threads. The ground under
  it glows faintly, the light turns a little blue, and small motes drift up from the ground toward it. It never does
  anything. "Something vast is passing over."
- **Shooting stars.** On clear nights a streak now and then.

Everyone in a co-op world sees the same flights at the same moment (they come from the world's seed and the shared clock).
The lake's flock takes off for whoever comes near first.

Find it quickly: dev menu (F10) > Nature > Sky: "geese now", "geese land on the lake now", "murmuration now (over you)",
"a drifter now (the bell / the manta)", "a shooting star now", "go to the lake shore", "dusk now", "night now"; the page's
read-out lists today's flights. `?sky=often`: a dozen geese flights a day, a lake flock twice a day, three murmurations
(10:30, 15:00, 18:24), four drifters (one by day at 12:30), several shooting stars an hour at night. `?sky=0`: none.

## The forest glows at night (features/glowlife.js)

The night woods used to be nearly black. Now they have light of their own. All of it shows within ~40 m of you.

- **Fireflies.** Drifts of them over the glades, the lake shore and the streams' banks, from about 20:00 to 05:00. There are
  many in late spring and summer, a few in early autumn, and none in winter, in snow or in heavy rain. Each one blinks on
  its own rhythm. Now and then a whole drift falls into step and the flashes roll through it in a wave.
  **Run through a drift** and it scatters. **Stand still** for a few seconds and fireflies slowly gather into a little cloud
  that circles you and pulses together (you become a lantern). Your co-op friends count too. Move, and the cloud breaks up.
  The brightest drifts near you, and your lantern, softly light the ground.
- **Foxfire.** Green-blue glowing fungus grows on the dead trees, the old stumps, the fallen logs and the windthrows, and
  at the foot of the oldest trees in the thickest wood. By day it is pale fungus; it glows from dusk, and **brighter after
  rain**. It is **shy**: it dims as you come close, then glows back slowly after you leave. Fell the tree and its fungus
  goes with it.
- **Moonflowers.** A few open glades have patches of pale flowers, from late spring to early autumn. By day they are
  buds. They open at dusk, glow faintly all night and close at dawn. **Walk through a patch** and glowing pollen rises
  from the flowers and drifts away.
- **Älvdans, the elf ring.** One glade in the home woods has a ring of foxfire caps. At night it breathes: a slow wave
  of light goes round the ring, and the whole ring swells and fades. **Stand in the middle** and pale motes rise from the
  caps and dance round you to the ring's rhythm.

A toast names each of these the first time you meet it in a session.
Everyone in a co-op world finds the same drifts, fungus, flowers and ring: they come from the world's seed and the
shared clock. Each game animates its own fireflies, and they react to every player it knows about.

Find it quickly: dev menu (F10) > Nature > Glowlife has these rows:
- "Make it a summer night here" (summer, 22:00; offline only)
- "Go to the nearest fireflies", "Go to the nearest foxfire", "Go to the nearest night bloom", "Go to the elf ring (älvdans)"
- "Glow all day (test)"
- an on / off switch, and a read-out of what is out now

URL switches: `?glow=always` glows all day with fireflies all year (for a look by daylight), and `?glow=0` turns it off.

## Happenings (features/happenings.js)

Now and then something *happens* in the forest. Each in-game day gets none, one or two of these, worked out from the
world's seed, the day and the weather, so in co-op your friends see the same thing at the same place and time. A toast
tells you what started and roughly where ("A star fell: north-east of you, 40 m"). What you take from one is yours: each
player takes their own, once.

- **A falling star** (a clear night, now and then). A bright streak, a flash and a thump of light where it lands in the
  woods. A small smoking crater with a pulsing star shard in it lights the trees round it, with sparks rising, until dawn.
  Walk up and press **E** to take the **Star Shard**. At dawn the glow dies; the scorch stays until the next evening.
- **A häxring (witch's ring)** (the morning after rain, not in winter). A ring of pale mushrooms, 3.5 m across, stands in a
  glade all day. At night tiny lights dance in a circle over it. Step into the middle at night: the world goes dreamy for
  a moment and you're **Light-footed** for 2 minutes (+20 % speed, motes trailing you). Once a night each.
- **The vättar walk** (dusk, rare). A line of 5 to 9 knee-high hooded little people with tiny lanterns walks slowly from a
  big boulder to the lake and into the water. They ignore you. Walk alongside them (within 4 m) for 20 seconds and the
  last one stops, turns to you and leaves you a gift on the ground (berries, a button, a feather, a thimble with someone's
  name on it). Press **E** to take it.
- **A rainbow** (by day, when a rain spell clears). A banded arc stands over the trees. Run to its foot (the column of
  coloured light): the colours pool on the ground round you and you find a **Rainbow Scale**.

**Dev menu (F10) > World > Happenings:** start each one now, near you (the ring's lights dance at once, even by day); go
to the current one (or the next one today); what's on today; forget what I took. The page also lists today's happenings.

URL switches: `?happen=star` (or `ring`, `vattar`, `rainbow`) starts that one soon, near you. `?happen=often` gives every
kind every day, whatever the weather. `?happen=0` turns happenings off.
