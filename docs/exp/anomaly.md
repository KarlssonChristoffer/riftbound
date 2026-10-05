# Experiment: the rift anomaly (visuals only)

Branch `exp/rift`. A tear in the air standing in the Proving Grounds, as a reminder of a gameplay feature to come (one
day it bends bullets and pulls things into orbit). Today it is **presentation only**: it does not bend, pull, hurt, block
or change anything; it has no `update`, no collider, no entity and no event, and the sim comes out the same with it or
without it (tools/test/simview.mjs). It stands in the **sandbox only** (`?mode=sandbox`, every biome); runs are unchanged.

Code: `src/features/anomaly.js` (the feature: the spot, its clock, the ground decal, the light, the glow, the shimmer),
`src/features/anomaly/tear.js` (the slit: a G-buffer shader), `src/features/anomaly/specks.js` (motes, debris, glints,
spikes, cracks: one instanced draw + one line draw, their motion a closed form of the clock on the GPU),
`src/features/anomaly/place.js` (where it stands). The
flag in `src/core/flags.js`, `'anomaly'` at the end of `LOAD_ORDER` in `src/core/features.js`.

## Turning it on / off

- On by default in the sandbox. `?anomaly=0`: not there.
- Pause menu > Dev > Features > **Rift anomaly (visual)**, with two settings under it: **Space warp** (the shimmer beside
  the slit) and **HD glow** (the soft display-resolution glow). Not remembered: the URL decides at load.
- Pause menu > **Game** tab (the sandbox): **Rift anomaly: go there** puts you a couple of metres south of it, looking at it.
- (If the Dev tab's category table `DEV_GROUP` in `src/ui/pause.js` is merged in, add `anomaly: 'Effects'` there; without
  an entry it lands in *Other*.)

## The look

| part | what it is | how |
|---|---|---|
| **the tear** | a vertical slit ~2.2 m tall, ~0.35 m at its widest, hovering 14 cm off the ground: a lens of near-black violet (two tones of a slow nebula drifting up, a dark inner rim, star specks drifting down and twinkling), closing at both ends into glowing cracks. Its torn edge: angular teeth (each side its own) that writhe a pixel at a time, a hot white-pink rim that crackles, and licks of light (pink, magenta, a violet tail) rising along it like flames, 1..~8 px long. A slow pulse (3.4 s): a pixel wider, longer licks, a brighter rim, a stronger light. The centre line sways a pixel or two (a torn S) | one camera-facing quad in the G-buffer (`gfx.js extra`, like the flames), painted texel by texel by its fragment shader: whole texels, palette tones only (the rift biome's crystal ramp, gemGlow, runeDim), its glow as emission (glows at night, a dark hole by day). Stepped 10 times a second, so it moves like pixel animation. No CPU pixel work at all |
| **motes** | 26 violet specks spiralling in, faster and brighter as they near it, a short streak behind the close ones, a 2 px flash where they wink out at the slit, then a new life | emissive pixel particles on the GPU (`specks.js`: each one's path a closed form of the clock, its numbers a hash of its life's count) |
| **debris** | pebbles (a lit top), flakes turning over (the biome's leaves, ash, snow, sage; the ruins' leaves turn in autumn), dust, and in ember and rift a glowing fleck (an ember, a crystal chip), orbiting slowly 0.7-1.4 m out, 0.1-1 m up, bobbing on tilted rings, a 1-2 px shadow (the floor's darkest tone) under the pebbles and flakes | lit pixel particles on the GPU (`specks.js`): the rift's own light colours them at night |
| **the ground** | a scorched centre, a ring of crystal in three violet tones, a faint stain round it (ragged edges, hard tones), five glowing cracks running out from under it (a light runs out along each with the pulse), crystal spikes (2-3 px) and glints on the ring | the decal is painted ONCE at load (a world circle is the same ellipse at every yaw) and laid in the ground layer before the light, so the rift's light makes it glow; cracks, glints and spikes are emissive lines / pixels in the world (`specks.js`: they turn with the camera) |
| **its light** | violet (`#c773ff`), 4.6 m, at 1.3 m, breathing with the pulse: walls, pillars, the player and the floor round it go violet at night | a feature light (`F.lights`, render/lighting.js picks it like any other) |
| **HD glow** | a soft violet haze along the slit | `G.fx` blobs (display resolution, depth-faded) |
| **space warp** | the air beside the slit shimmers: rows of pixels pulled one pixel toward it in waves running up | the distort layer (`host.glayer('distort')`, whole-pixel row shifts: the lights' heat haze uses it) |

Motion runs on the feature's own clock in `F.view`, which is `ambient`: it goes on behind the pause menu and in photo
mode's *Living world*; a still photo freezes it (the shaders' clock too). Everything that moves is a closed form of that
clock on the GPU, so a frame costs the CPU a few uniforms (heap sampling: ~0.3 KB of garbage a frame, from the engine's
layer ops; the first version, with its particles stepped and drawn from JS through `host.point`, made ~6 KB a frame). No
`Math.random` anywhere. It draws only when it is on screen (its light is always offered).

## Where it stands

Found at runtime (`place.js`), because the map is being reworked: a seeded grid of candidates every 0.5 m over the
Proving Grounds, each tested against the world as built: walkable (layout.js), flat (nothing steep and elev within 10 cm
over a 1.4 m disc), no water within 2.6 m (stream, pool, rill, outflow), no collider within 2.3 m and no prop at all within
1 m (`host.entities.near`), off the spawn (6.5 m), the movement ring, the paths, the range lane and the rail, the light
garden's pad, the walks from gate to gate, the trick-shot range (its anchor and mark) and the grounds' edges. Of those, the
one ~8.5 m from the spawn, on the spawn's screen, with the most room round it wins (a seeded tie-break). Found again after
every world build (the first view after a biome switch), so a biome always gives the same spot.

Today that is **(14.5, 20.5)**: the arena's south-west quarter, between the pillar grove and the low south wall, ~7 m
south-west of the spawn (bottom left of the screen when you start). The same in all five biomes; on the reworked map in
D:/Game/src (the mesa, the world 10 m wider) it lands 15 cm away, (14.6, 20.4).

## Notes for the gameplay version

What the user liked in earlier tests, and how it maps onto a model:

- **A soft pull that fades with distance: ~52 deg of bend at 1.5 m, ~16 deg at 5 m.** Those two points fit a total bend
  `theta(b) ~ 78 deg x 1 m / b` for a shot passing at closest distance `b` (52 x 1.5 = 78, 16 x 5 = 80): the 1 / b law
  of gravitational lensing. A path curvature toward the rift of `k(r) = C / r^2` (rad per metre of path) gives exactly
  `theta = 2 C / b`, so **C ~ 0.68 rad m**, independent of the shot's speed (a curvature, not a force: a slow arrow and a
  fast bullet bend alike). Soften the core (`r^2 + 0.3^2`) and fade it out past ~8 m (smoothstep) so it never reaches
  across the map; something that passes within ~0.25 m of the slit goes *in*.
- **Cans settle into orbit rings.** A loose prop within ~2.5 m gets a pull toward the nearest ring (the debris already
  orbits at 0.7-1.4 m: e.g. rings at 0.9, 1.3, 1.8 m), its radial speed damped, a tangential speed that slows with the
  radius, a slow bob; a shot knocks it out of its ring and it falls back in.
- It moves to the sim then: the field in `F.update` (deterministic: the spot already is), read by sim/projectiles.js
  through an API (say `host.feature('anomaly').bend(x, y, h, out)`) or a modifier note, never by writing projectiles'
  numbers; the motes / debris / tear stay in the view. Events for the gameplay version (`anomaly.swallow`, ...) go in
  core/events.js first.
- The look already says where it pulls: the motes spiral in, the debris rings, the shimmer bends the air beside it.

## Checks (2026-10-05)

On the mirror `D:/Game/src-xrif/` against a clean baseline `src-xrif0/` (main ddb9f02). The shared test ports were blocked
(a golden run of this branch wedged when the machine ran out of virtual memory and Chrome lost its GPU context; another
session held the lock for over an hour), so the tools ran as copies on this branch's own ports (`tmp/xrif/*9453.mjs`: the
same code, Chrome on 9453).

- **golden** (16 captures): state digests identical in all 16 (the sim is untouched). The 2 run captures and the 6
  sandbox captures at the yard (crate, debug views, zoom) are pixel-identical; the 8 sandbox captures with the rift or its
  light in view differ in the WebGL image only, exactly over the tear and its light's pool (`tmp/xrif/golden_diffs.png`).
  With the default flipped off: **16 / 16 identical**.
- **smoke**: all 22 checks pass (its climb step as committed at ddb9f02: D:/Game's working copy of smoke.mjs reads the
  reworked map's `CLIMBS`, which the baseline fails the same way). A first run during the memory shortage failed two
  steps on lost-context shader errors; the re-run passed.
- **simview**: the sim is identical without views and at 30 / 60 / 240 fps (sandbox, run, keys).
- **perf A/B** (`ab.mjs --a src-xrif0/ --b src-xrif/ --q "mode=sandbox&time=night"`, 3440 x 1440, the rift in view from
  the spawn): 1.303 -> 1.317 ms a frame (+1.0%, the median of the slices, in the noise), draws 69.6 -> 74.6, heap 71.0 ->
  71.7 KB a frame.
