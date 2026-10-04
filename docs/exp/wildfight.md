# Wildlife reacting to fights (exp/wildfight, 2026-10-04)

"Vultures circling a dying foe, coyotes at night, birds flushed by gunfire." Three behaviours on top of the wildlife
feature, all **show only** (a view: animals never block, hurt or get hit, nothing in play changes; `tools/test/simview.mjs`
proves it). On by default; `?wildfight=0` starts it off; **Menu > Dev > Fight reactions** (a setting of Wildlife: it sits
under the Wildlife toggle, in the Nature page once the Dev tab is paged by category) turns it on and off live.

## What you see

**A fight flushes the area.** A *fight level* rises with every shot (yours and the gunmen's), body hit, hurt, kill and
explosion and decays with calm (`exp(-t / 5 s)`, capped at 4). Crossing 1.2 (two quick shots and a hit; a single shot at a
dummy does not) sends a flush outward from the fight's centre at 11 m/s: every flock it reaches out to 34 m lifts off away
from the fight, each after a short random delay, so the near birds go up first and the perched ones farther out follow
in waves (the farther, the likelier one stays put; the next big bang sends another wave). While the fight is on (the level
over 0.4) flocks in the air wheel out to 24 m and keep circling there instead of landing, birds that land inside it are
put up again, crows / ravens / the desert's hawk call over it, and the high vultures (desert, ember) drift over the fight.
After the calm they land where they are and drift home on their own clock. Today's per-shot startle (wildlife.js's noise
model: a gunshot scares birds within 14 m) is unchanged under this. It works the same in the sandbox's gunmen raids and in
a run's waves (brutes hitting you count).

**Scavengers at a kill.** Every kill (a gunman, a run's brute, a yard brute) makes a *kill site*; one 4 m from another adds
to it. 2-5 s later the carrion birds start coming into view one by one from off the screen and circle the site: high (9 m)
while it's loud, lower and tighter (down to 4 m) as it stays calm. Once there has been no bang near for a few seconds and
you are 9 m or more from the body they come down round it, hop in, tug at it (a vulture mantles at a neighbour that comes
too close), step back, look about. Come within ~5 m, fire, roll past, and they burst off, climb, circle high again and come
back down when it's calm. A site draws them for 75 s; then they lift off and leave. Up to 3 sites, 4-5 birds.
- desert, ember: turkey vultures (new art: a hunched 14 px bird with a bare red head, a 33 px span circling low, two-tone
  wings; their soaring shadow on the ground is wildlife's vulture shadow); by day and dusk (vultures roost at night).
- ruins: crows, frost: ravens (wildlife's own sprites: a murder of them, quicker, lower, cawing).
- rift: a swarm of wildlife's motes drifts to the body and swirls over it, scattering from you.
- The bodies fade fast (a gunman lies ~10 s, `content/foes.js` TUNE.corpse; a run's brute is gone at once), so a kill site
  shows a small **remains** heap (13 x 4 px: hide, ribs, a little red) that fades in as the corpse fades out and goes with the
  site. A desert gunman's corpse is followed while it lies (its ragdoll is thrown), so the birds gather round where it
  actually lies. A yard brute's broken body stays as it is: no remains there.

**Canids at night.** The desert gets a coyote pack (3-4), the ruins a red fox, the frost grey wolves (2-3); ember and the
rift none. 4-14 s after dark they come in one by one from off the screen and skulk at the **edge of the view** (a ring at
78-95 % of the view's half size round its middle, so they keep to the edge of what you see at any zoom and yaw, at least
7 m from you): trot to a spot, stand and watch you (the head turned to you: the eyeshine, two emissive pixels, bright near
a fire or within 8 m of you, dim otherwise), sit, sniff, trot on, the pack spreading along the ring and drifting round you.
Every 22-55 s one sits and howls and the others answer with yips (`wildlife.howl`). Walk at one and it trots off along the
ring; get within 4 m and it bolts. A shot within 30 m scatters the pack at a gallop off the screen; they come back from the
other side 10-22 s later if it's quiet. A kill at night draws them once it has been calm 8 s and you are 10 m off: one or
two tug at the body, the others stand off watching. At dawn they run off. Their trots and runs keep to clear ground (no
walking through walls, props or water).

## How to see it

On the user's server, the mirror `src-xwfx/` (this branch; re-sync with `rm -rf D:/Game/src-xwfx && cp -r
D:/wt/exp-wildfight/src D:/Game/src-xwfx`):
- coyotes: `http://localhost:8123/src-xwfx/?mode=sandbox&biome=desert&time=night&daymin=0` (stand still a few seconds;
  fire to scatter them). Fox: `biome=ruins`, wolves: `biome=frost`.
- vultures: `http://localhost:8123/src-xwfx/?mode=sandbox&biome=desert&time=day&daymin=0&set=gunslinger`: wait for a gang
  (or the cheat panel, F2 in dev mode: spawn a bandit, kill all), then walk ~10 m away from a body and wait.
- the flush: the same, by day in the ruins with the gunslinger: fire a few shots and watch the flocks go up in waves.
- off: add `&wildfight=0`.

## Tunables

All in one `TUNE` per module (live: `__r3d.host.feature('wildlife').fight.TUNE`, `.fight.scav` / `.fight.canids` modules'):
- `features/wildlife/fightlife.js` TUNE.fight: `add` (per event), `tau`, `max`, `high`, `low`, `reach`, `wave`, `lift`,
  `far`, `keep`, `again`, `calls`, `check`.
- `features/wildlife/scavengers.js` TUNE: `life`, `sites`, `merge`, `arrive`, `every`, `from`, `remains`, and per species
  (`vulture`, `crow`, `raven`) speed, `h` [high, low], `R` [high, low], `descend`, `circle`, `calm`, `clear`, `flee`,
  `shot`, `ring`, `max`, `per`, `sens`; `mote`.
- `features/wildlife/coyotes.js` TUNE: `edge`, `near`, `apart`, `keep`, `bolt`, `shot`, `away`, `arrive`, `trot`, `run`,
  `rest`, `chorus`, `clear`, `calm`, `glow`; the packs per biome (PACK).
- `features/wildlife/fightart.js`: the sprites (silhouettes as run lists, toned by one rule) and the palettes per biome.

Debug: `__r3d.host.feature('wildlife').fight.dbg()` (the level, the sites and birds, the pack), `.fight.sheet(6)` (the
new atlas, zoomed).

## Sound

`wildlife.howl` {x, y, kind: coyote | fox | wolf, call: howl | yips | bark} (core/events.js). A new forge recipe,
`audio/forge/recipes/canid.js` (coyote_howl, coyote_yips, wolf_howl, fox_bark): an additive harmonic voice whose partials
are weighted by smooth formant humps (no resonant filters, so nothing rings or sounds hollow), vibrato and jitter, a breath
layer low-passed under 2.4 kHz, a rasp for the fox, the creature recipe's warm tilt. All four cases pass their criteria
(centroid 530-1140 Hz, energy above 4 kHz -34 to -59 dB). `audio/runtime/events.js` maps the event (`howl`, combat's
screen rule: heard a little past the edge of the view); `src/audio/audio.js` fires it and has a synth fallback (the old
desertCalls coyote, placed). Listen: `node tools/sfx/forge.mjs canid --out <dir>` (renders WAVs + spectrograms). The
flush and the scavengers reuse wildlife's wings / birds_scatter / caw.

## Files

New (this feature's own): `src/features/wildlife/fightlife.js`, `scavengers.js`, `coyotes.js`, `fightart.js`,
`audio/forge/recipes/canid.js`, this doc.

Changed (small, additive), with their owners:
- `src/features/wildlife.js` (the wind + wildlife session's, idle): the import, K (the internals the new modules read) and
  four calls (populate, applyTime, view after the noise, frame: the ground layer and the sprites), `F.settings` (the Dev
  toggle), `F.fight`; the header says so. 25 lines.
- `src/core/flags.js`: `wildfight`. `src/core/events.js`: `wildlife.howl`.
- `audio/forge/recipes/index.js` (+ 'canid'), `audio/runtime/events.js` (+ `howl`), `src/audio/audio.js` (the event's
  case + the synth fallback): the audio session's files.
- Not changed: ui/pause.js (the toggle is wildlife's `settings`, so it lands under Wildlife: Dev > Features here, the
  Nature page with the peer's DEV_GROUP), foes/*, combat/*, world/*.

## Checks (2026-10-04, D:/Game's tools on the mirror `src-xwfx/`, the baseline `src-xwfx0/` = b65b9c5)

- `node tools/test/smoke.mjs --path src-xwfx/`: all checks pass.
- `node tools/test/simview.mjs --path src-xwfx/`: the sim is identical without views and at 30 / 240 fps (sandbox, run, keys).
- `node tools/test/golden.mjs`: `--save` on the baseline, `--compare` on this branch: **16/16 identical**, with the feature
  on (the tour never crosses the fight level's threshold: one arrow at a dummy and a crate don't make a fight; its night is
  ember, which has no canids; nothing is killed) and with its default flipped off. The new sprites live in their own atlas,
  so wildlife's atlas and its UVs are untouched; the new code draws from its own generator (viewRandom), never wildlife's
  or Math.random, so nothing else's randomness shifts.
- Perf, `node tools/perf/ab.mjs --a src-xwfx0/ --b src-xwfx/` (3440x1440, a busy machine: whole-frame medians within noise):
  night in the desert with the pack about: wildlife view + frame 0.040 -> 0.052 ms, draws 61.5 -> 62.7, heap 49.8 -> 52.8
  KB/frame; a gunfight (a gang of 4 shooting, 2 killed, the vultures up): wildlife 0.047 -> 0.048 ms, draws 106.8 -> 113.8.
  (The two pages' fights differ: their sims are seeded apart. In ONE page with the reactions toggled on / off the uploads
  are equal and the heap within ~2 KB/frame.) Wildlife's own F.ms, real clock, 1920x1080: night 0.035 -> 0.062 ms (a pack of
  3-4), fight 0.055 -> 0.064 ms.
- The forge: `node tools/sfx/forge.mjs canid` passes all four cases' criteria.
