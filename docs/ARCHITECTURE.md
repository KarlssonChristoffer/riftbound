# Architecture: how the game is built, the rules every change follows, and the road there

Status: 2026-10-01. Written from a measured profile of the HD-2D game (`concepts/render3d/`, now `src/`) and a read-through of every
module it runs. Section 1 says where we stand, section 2 is the target, sections 3-5 are the rules (performance, code,
working in parallel), section 6 is the migration plan. The measured details behind section 1 (which module writes which
field, every event, every duplicate) are in `docs/ARCH_AUDIT_2026-10-01.md`.

**Goal:** a game that stays fast and stays changeable as it grows. Concretely:

- **Fast:** 60 fps on a mid-range laptop, 165 fps on the dev desktop, with no hitches. Every system has a time budget,
  and a regression shows up the day it is written, not three features later.
- **Changeable:** a change in one place can't break an unrelated place. "Changing the weather makes my guy blue" can
  happen only if two systems both write the same thing, or one reaches into another's insides. The rules below make
  both of those impossible by construction, so they don't depend on anyone remembering.

---

## 1. Where we stand (measured 2026-10-01, commit 19c8754)

### 1.1 Performance: the CPU does the GPU's work, every frame

`node tools/perf/bench.mjs` on the dev machine (RTX 4070, headless Chrome, 1920x1080):

| scenario | fps | frame p50 | JS per frame | GPU per frame | biggest costs (ms per frame) |
|---|---|---|---|---|---|
| day (ruins) | 225 | 4.4 ms | **4.15 ms** | 0.25 ms | renderer submit 1.39 · cloak compositing 0.94 + cloth sim 0.2 · lights/fire 0.46 · world sync 0.35 |
| night, all fires (ember) | 337 | 3.0 ms | 2.77 ms | 0.41 ms | cloak 1.11 · renderer 0.64 · fire 0.36 |
| walking | 311 | 3.1 ms | 3.04 ms | 0.47 ms | cloak 1.02 · renderer 0.86 |
| a run, first wave | 344 | 2.8 ms | 2.69 ms | 0.43 ms | cloak 1.00 · renderer 0.83 |
| day, baked cloak (A/B) | 530 | 1.9 ms | 1.75 ms | 0.30 ms | renderer 0.77 · lights 0.33 |

What this says:

- **The GPU is ~95% idle. The bottleneck is JavaScript on one CPU core.** A typical laptop core is 2-3x slower than
  this desktop's, so 4 ms here is 10-12 ms there: most of a 60 fps frame (16.7 ms) spent while *nothing is happening*.
  Add a big fight, the browser's own work and a garbage-collection pause, and frames drop.
- **The single biggest cost is the runtime cloth cloak** (made the default loadout earlier on 2026-10-01): it more than
  doubles the JS per frame (1.75 -> 4.15 ms). Its drawer is a software rasteriser that allocates ~1 MB of fresh arrays
  every frame (`concepts/sprites/cloth.js` draw), which also feeds the garbage collector.

Three patterns cause almost all of the cost. They come from porting the 2D canvas arena 1:1 into a 3D engine:

1. **Pixel work on the CPU every frame.** Cloth rasterised in JS, hair streaming via `getImageData` / `putImageData`,
   the armour mask, contact-shadow masks, the lava haze and the vignette painted into 2D canvases and re-uploaded as
   textures. A GPU does each of these in microseconds; JS takes 0.1-1 ms each.
2. **Poll everything, every frame.** `world.update` re-syncs all ~250 props (matrices, sprite lookups, light objects,
   colour strings re-parsed) whether or not anything changed. The 2048² sun shadow map re-renders ~200 static casters
   every frame. The point/line/fx batches upload their whole buffers (~0.9 MB) even when 10 particles were drawn.
3. **Allocation in hot loops.** New objects/arrays per particle, per light, per collision test, per vertex (cloth:
   ~30k short-lived arrays per frame from collisions alone). Each one is cheap; together they make GC pauses (hitches).

And one structural cost: ~185 props are separate meshes with separate materials, so three.js switches state ~400 times a
frame (gbuffer + shadow). Walls, rocks and towers repeat a handful of models and can be instanced (one draw each).
(Phase 5 tried instancing and kept a cached static shadow map instead: see below.)

**After phase 1 (2026-10-01, same machine, same scenarios; the world clock + weather landed in parallel and are included):**

| scenario | fps | JS per frame | was | what changed most |
|---|---|---|---|---|
| day (ruins) | 448 | **2.04 ms** | 4.15 | cloak 0.94 -> 0.19 (char group); gbuffer draws 89 -> 41 (off-screen cards culled) |
| night, all fires | 824 | 1.08 ms | 2.77 | cloak; fires off screen not drawn; particles pooled |
| walking | 745 | 1.22 ms | 3.04 | |
| a run, first wave | 492 | 1.87 ms | 2.69 | |
| day, baked cloak | 578 | 1.60 ms | 1.75 | |

Every scenario is inside its budget. A clean A/B (the same tree with only the old renderer + cloth swapped back in, two
rounds) gave day 3.0-3.4 -> 2.05 ms and night 2.1-2.6 -> 0.94-1.1 ms. What was done:
- `cloth.js`: no allocation in update / draw (in-place particles, flat links and capsules, persistent pixel buffers, work
  only inside the cloth's box). Proven bit-identical to the old version over 900 scripted frames (pixels, normals,
  positions, coverage): `tmp/clothtest/test.html`. 4.4 -> 0.8 ms in that test.
- `gfx.js`: batches upload only the range written; cards are frustum-culled (a pooled per-card geometry with a bounding
  sphere synced from its uniforms; checked at 240 camera setups: 0 on-screen cards culled, 85% of card draws skipped);
  `setMatrix` returns early on an unchanged matrix and the height map re-renders only for moves > 5 cm; `tex()` uploads a
  canvas with a `version` only when it changed (the 12 fps flames); `G.onScreen()` (allocation-free culling test);
  `matrixAutoUpdate` off for every object positioned in its shader; no allocation in `setSun`.
- `world.update`: light records cached per sprite, emit textures set on change. `main.js`: light pool with reused
  records, cached `player.x / y`, `hoverTarget` once per step / draw. `firesim.js`: pooled particles, one shared options
  object, flames off screen simulate but don't draw. `lights.js`: swap-remove instead of `splice`, shared options.
- `depth.js`: the light shafts and cloud shadows were re-rasterised EVERY frame once the world clock moved the sun a
  little each frame (their cache keys held the exact sun angle). Keys are quantised (2 deg / 1 deg, cloud strength in
  0.02 steps). Lesson: anything continuous (the clock, the weather) must be quantised before it becomes a cache key.

What's left is mostly structural and belongs to phase 5: three.js's per-draw overhead (~40 gbuffer + ~150 shadow
draws), the 2D canvases composited and uploaded every frame (hero 192x160 x2, ground / distort layers, cloud tiles),
and the fire particles on the CPU (~0.15 ms with fires on screen).

**After phase 5 (2026-10-01).** Measured per render pass (`G.stats.pass`, the same page with `?sshadow=0` as the
"before", alternated; whole-frame numbers swung +-50% with other sessions busy, the passes didn't):

| pass (day, ruins) | before | after |
|---|---|---|
| sun shadow | 0.65-0.86 ms, 188 draws | **0.40-0.44 ms, 56 draws** |
| gbuffer | 0.43-0.55 ms, 41 draws | 0.43-0.47 ms, 41 draws |
| whole `G.render` | 1.39-1.81 ms | **1.13-1.22 ms** (-18 to -30%; at night, no sun shadow: unchanged) |

- **Static sun shadow** (the change that stayed): world props (`mesh(..., {static: true})`) and the terrain cast into a
  cached world-wide 4096^2 map (sScene layer 2), re-rendered only when one of them appears, goes or changes model, starts
  or stops moving, or the sun turns > 0.15 deg (the clock turns it ~0.2 deg/s: about once a second at most). A prop that
  moves (a hit wobble, a push, burning) casts into the per-frame map until it has been still 45 frames, then moves back
  at the next static re-render (no gap, no ghost beyond a few frames). The per-frame map round the view (layer 0) holds
  only what moves. `sunShadow()` tests both. Shadows are identical except single pixels along some edges (the two
  maps' texel grids differ).
- **Instancing was built, measured and dropped.** Every copy of a model in one draw (per-copy matrix / object id /
  flash / moss seed / burn as instance attributes) was pixel-identical and cut the SHADOW draws, but the static map
  already removes those; in the gbuffer a group can't be culled copy by copy, so it drew 61 groups where per-mesh
  culling draws ~41 meshes: a net loss at night (no sun shadow to win back). A 12 m cell split made it worse (67).
  Instancing pays when many copies of a model are ON SCREEN at once (grass, a forest), not for props spread round a map.
- **Cloth collisions:** a bounding-sphere early-out before the exact capsule test (bit-identical: proven by the same
  900-frame test). The cloth sim runs 120 Hz substeps, so at 60 fps it costs more per frame than at 400: 1.4 -> 0.7 ms
  per frame on the throttled CPU.
- **Visibility:** `G.stats.pass` (CPU ms + draws per pass, uploads separated), `bench --throttle 3` (laptop-class CPU;
  the target is p95 <= 16.7 ms), `bench --q inst=0` (A/B a switch in the same page), `bench --runs 3` (median run).
- At 3x CPU throttle the scenes run ~66-100 fps averages with p95 around 12-17 ms: the 60 fps laptop target holds on
  average; the busiest moments (a run's waves) touch it.

Evaluated and NOT done, with the reason (each is a candidate when its numbers say so):
- **Cloth as a GPU mesh:** after phase 1 the cloak costs ~0.1 ms to draw; porting its pixel-language rasteriser (bands,
  fold lines, outline, per-pixel occlusion against the body's depth sheet) to shaders would risk the approved look for
  little time.
- **Fire particles on the GPU:** ~0.15 ms with fires on screen; the hybrid flame look was chosen by hand and its
  particle model has state (swirl, tongues, buoyancy). Revisit if fires multiply.
- **Contact AO / haze / vignette / cloud shadows in shaders:** the per-frame uploads (`pass.upload`) are ~0.15 ms in
  total including the hero's two canvases; the cloud tiles are the weather session's active code.
- **`preserveDrawingBuffer` off:** a GPU-side cost only (the GPU is ~90% idle) and other sessions' capture scripts read
  the canvas after the frame.
- **Biggest remaining CPU costs** (3x throttle, a run): `G.render` ~4 ms (per-draw overhead of ~41 gbuffer + ~56 shadow
  draws: the 23+ painted cards each have their own material), `world.update` ~1 ms, `lights.frame` ~1 ms, `depth.frame`
  ~0.8 ms. Next steps there: world cards drawn through the sprite batches (one draw per image), a per-item dirty flag in
  `world.update` (phase 3's entities make that natural).

### 1.2 Structure: good bones, growing tangles

**What's already right and stays:** the deferred renderer at 480x270 with the HD blit; immediate-mode batches
writing into typed arrays; one host object features plug into; packed atlases; data-driven moods and biomes; the
decision log in memory and docs. This is a sound base. Nothing below is a rewrite.

**Where it's tangling** (each with a real example; the full inventory is in the audit doc):

| risk | example in today's code | what it can break |
|---|---|---|
| **Shared "bag of flags" objects.** A prop is one object that 8 modules add fields to (~60 fields, e.g. `wob flash broken gone lit unlit fx model sconce stage manageMatrix`). | `lit` means "a brand is thrown at it" in combat and "candle state" in lights. | Two features silently fight over a field. |
| **Modules overwrite each other's values.** | `game/stats.js` rewrites `SPEED` inside `player.js` and combat's `core.T`; `game.js` keeps a *second*, separate restore snapshot of `core.T`. `garden.js` sets `r = 0` on every bush in the world, every 2 s. | An augment's speed survives a run; the garden quietly changed enemy navigation and arrow hits. |
| **Hidden order dependencies.** | Combat snapshots its prop lists when it's created, so props added later (the run's portal, re-added sconces) are invisible to combat. Turning lights off (key 9) freezes burning props mid-burn. Events reach other features one step late. | Bugs that depend on load order, not on the code you're reading. |
| **Duplicated basics.** | ~10 colour parsers, ~7 hash functions, 9 RNGs, ~12 `clamp`s, 8 copies of the world<->view rotation, 7 "is it on screen" tests, 7 "what's at this spot" scans over all props. | Fix one copy, the other six keep the bug. |
| **The 2D arena and the game share files.** | `player.js`, `cloth.js`, `biomes.js`, `layout.js`, `audio.js` serve both pages; `biomes.js` already has render3d-only branches. | Every game change risks the arena and vice versa. |
| **One host file does everything.** | `main.js` (773 lines): input, camera, player adapter, arrows, hero compositing, hair wind, lighting, pause menu, HUD, debug keys. | Every session edits the same file. |
| **Config everywhere.** | ~33 URL parameters parsed separately in 10 files; three.js loads from a CDN at runtime. | No single list of switches; the game needs the internet. |

Two real bugs found during the audit: in `features/wind.js` update, the `wtick` statement sits inside a `//` comment
(the `wph +=` line), so the 3D tree crowns' light ripple never moves; and `F.on = false` stops `update`, so lights.js's "keep burning while hidden" branch
is dead.

---

## 2. The target architecture

### 2.1 Layers: who may know about whom

A game is a stack of layers. Each layer may use the ones below it and must never import the ones above it. This one
rule is what keeps "the weather" from ever touching "the guy's colour": the weather lives in a layer that doesn't know
characters exist, and the only path from weather to pixels is the one documented input to lighting.

```
 ui        HUD, menus, title / pick / over screens, prompts             reads game + sim state, sends commands
 game      the rules: run, waves, items, augments, modifiers, save      talks to sim through its APIs
 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
 sim       the TRUTH, fixed timestep: player, projectiles, combat,      never imports view / render / audio
           fire & burning, prop physics, environment (time, weather,
           wind field)
 view      PRESENTATION, read-only on sim: hero compositor (sprite +    reads sim, writes only render + its own state
 audio     cloth + bow), foliage sway, leaves, wildlife, atmosphere,
           fire particles, contact shadows, depth, sound
 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
 world     the space: terrain, entities + components, spatial grid,     no rendering
           collision, raycasts, navigation
 render    the renderer: gbuffer, composite, batches, camera,           knows how to draw, not what things are
           projection, lighting uniforms, atlases
 core      loop + phases, clock, events, input actions, flags,          knows nothing about the game
           settings, profiler, rng / math / colour utils, assets
 content   pure data: biomes, moods, layouts, item / enemy tables,      imports nothing
           tuning numbers
 dev       debug views, A/B toggles, lineups, collider overlay          may import anything; nothing imports dev
```

The split that matters most is **sim vs view**. Sim is what is *true* (where the crate is, how much fuel the fire has,
how hard the wind blows at x, y). View is how it *looks and sounds* (sparks, swaying leaves, birds, cloth). View reads
sim and may never write it; if a bird scatters, that's view's business, and sim never waits on it. Consequences:
cosmetic features can be switched off, thinned out on a laptop (quality tiers) or rewritten without touching gameplay,
and gameplay can be tested without drawing anything.

### 2.2 The eight rules

1. **Every piece of state has exactly one owner.** Only the owner writes it. Everyone else reads it, calls the owner's
   API, or sends it an event. (Fire wants a crate to break -> it calls `combat.breakProp(e, {ash: true})`; it does not
   set `broken`.)
2. **Entities have components, and each component has one owning system.** A crate is an entity with
   `body` (world: position, collider), `health` + `breakable` (combat), `burnable` (fire), `phys` (prop physics),
   `interact`, `light`, `render` (view). No free-form flags on the entity itself. Systems find entities by component
   (`world.with('burnable')`), so an entity spawned later is seen by everyone automatically.
   *As built (phase 3):* entities are the props' own objects in the registry `host.entities` (world/entities.js); a
   component is the set of fields one system owns (the table: `OWNERS` in dev/owncheck.js); systems find entities with
   live queries, `host.entities.query('lights.flame', p => ...)`, which follow every join / leave.
3. **Game effects are modifiers, never overwrites.** Items and augments add `{stat: 'moveSpeed', mul: 1.1, from:
   'boots'}` to a modifier list; the player reads `stats.get('moveSpeed')`. Nothing writes another module's constants,
   so nothing needs restoring.
4. **The simulation runs on a fixed timestep** (60 steps/s, rendering interpolates). Physics, fire spread and AI then
   behave the same at 40 fps and at 240 fps, slow motion is exact, and a seeded run can be replayed for a test.
5. **The frame has named phases, and systems declare theirs**: `input -> sim (fixed steps) -> view -> render -> ui`.
   Order inside a phase is declared (`after: ['env']`), not implied by an array's order.
   *As built (phase 3):* each feature exports `order = {after, before}`; core/features.js sorts by it. The phases
   themselves come with the fixed step and the sim / view split (phase 4).
6. **Events go through one bus with a catalog.** `events.emit('prop.break', {...})`; every type is listed in
   `core/events.js` with its payload, emitter and listeners. Names are namespaced (`player.land` vs `prop.land`, no
   overloaded types). Events emitted during a phase are delivered at the end of that phase, deterministically.
   *As built (phase 3):* an event is `{type: 'prop.break', ...}` pushed on the one queue (`host.events`); the catalog
   and today's delivery timing (same step / next step) are in core/events.js, and dev mode warns on an unlisted type.
7. **Shared questions are services.** "Wind at x, y", "what's within 2 m", "can I walk here", "time of day" are answered
   by one service each (`env.windAt`, `world.near`, `world.blocked`, `env.time`), never re-derived in a feature.
   *As built (phase 3):* "what's near" is `host.entities.near(x, y, r, out)` (a 2 m grid, answers in list order).
8. **The game owns its code.** The 2D arena (`concepts/`) is frozen as a reference; the game gets its own copies of the
   files it shares today. Dev-only code lives in `dev/` and loads only in dev mode.

### 2.3 Folder layout (after the migration)

```
src/                     the game (moved from concepts/render3d on 2026-10-01)
  index.html, main.js    boot only (~100 lines): load content, create services, register systems, start the loop
  core/                  loop.js (phases + fixed step), events.js (bus + catalog), input.js (actions + bindings),
                         flags.js (every URL flag and setting, documented), perf.js, rng.js, mathx.js, color.js, assets.js
  render/                gfx.js, shaders/, camera.js (oblique projection, yaw, zoom, pixel snap, shake),
                         viewxf.js (world <-> view, the on-screen test), lighting.js (moods -> uniforms, light choice), atlas.js
  world/                 world.js (build), terrain.js, entities.js (registry + component queries), spatial.js (grid),
                         collide.js (blocked, raycast, arrow tests), nav.js, trees3d.js, kit3d.js
  sim/                   player/ (player.js + the camera-frame adapter), projectiles.js, combat/, fire.js, props.js (physics),
                         env/ (time, weather, wind field)
  view/                  hero.js (sprite + cloth + bow), cloth.js, props.js (entities -> meshes / cards), foliage.js, leaves.js,
                         wildlife.js, atmos.js, flow.js, depth/, contact.js, firefx.js, windlines.js
  audio/                 runtime audio, wind audio
  game/                  game.js, run.js, enemies.js, items.js, modifiers.js, save.js
  ui/                    hud.js, screens.js, menu.js, prompts.js
  dev/                   debug views, renderer A/B, lineups, colliders, capture hooks
  content/               biomes (data), moods, layouts, items, enemies, tuning
  vendor/                three.module.js (pinned, no CDN)
concepts/                experiments + the frozen 2D arena
tools/                   offline pipelines (Blender, pixelizer, atlas packer) + tools/perf/bench.mjs
docs/                    this file, the audit, AUDIO.md
```

**As built after phases 2 and 3 (2026-10-01).** Phase 4 adds what's missing (the fixed step; the features split into
sim / view and moved out of `features/`; modifiers).

```
src/
  index.html, main.js    the boot (191 lines): the loadout, camera, renderer, stage, clock, hero, player, arrows; the
                         `host` features get (contract in main.js's header); the features; the engine context E; the loop
  core/                  loop.js (step + draw + frame, hitstop), input.js (keys + mouse, the camera drag),
                         features.js (loading + the declared order), events.js (the catalog), flags.js, perf.js,
                         mathx.js, rng.js, color.js
  render/                gfx.js (the renderer), camera.js (size, zoom, yaw, follow, shake, sampling), viewxf.js,
                         lighting.js (mood + lights -> the composite), options.js (opt + applying it), atlas.js
  world/                 world.js (build + props), stage.js (biome, rebuilds, prop mode, trees, the registry),
                         entities.js (the registry: join / leave / hide, live queries, near), spatial.js (the grid),
                         biomes.js, layout.js, trees3d.js, kit3d.js, nav.js
  sim/                   env.js (clock, seasons, weather), projectiles.js (arrows, pops, dust),
                         player/ (player.js, harmonize.js, adapter.js: the camera-frame bridge, climbing, the cursor)
  view/                  hero.js (the Ranger's card: atlas, cloak, hair, armour, HD bow), cloth.js, armor.js
  features/              the features as before (wind, weather, lights, garden, combat/, atmos, flow, wildlife, depth/, ...)
  game/                  game.js, run.js, enemies.js, items.js, stats.js, save.js
  ui/                    pause.js (paused, the menu's items), menu.js, hud.js, screens.js, prompt.js
  audio/                 audio.js, music.js
  content/               moods.js (MOODS, TIMES, CHAR)
  dev/                   devtools.js (colliders, debug HUD, tree lineup), devkeys.js (dev keys, renderer A/B),
                         owncheck.js (the ownership table + ?owncheck=1)
  vendor/three/          three.js 0.170.0
```

Two contexts, on purpose: **`host`** is the features' API (stable, documented in main.js); **`E`** is the engine's own
context for core/input, ui/pause and core/loop (what the boot made, by name). Both are filled by the boot only;
modules read them and call the owners' APIs (`input.takeYaw()`, `loop.hitstop(s)`, `hero.moveCloth(dx, dy)`), they
never write each other's state. `dev/` reaches the engine only as `E.dev`, handed in by the boot.

**As built after phase 3 (2026-10-01).** What a system uses to keep to the rules:

| question | the one place | notes |
|---|---|---|
| who is in the world | `host.entities` (world/entities.js): `add(p)`, `remove(p)`, `hide(p, on)` (the one writer of `p.gone`) | `host.props` is its list; `host.propsVersion` bumps on every join / leave |
| all the things of a kind | `host.entities.query('owner.what', pred, join?)`: a live list in insertion order | `join(p)` sets the querying system's own state for a newcomer; one owner per query name |
| what's near x, y | `host.entities.near(x, y, r, out, q?)`: candidates from a 2 m grid, in list order | do the exact test; `moved(p)` after a jump of more than 1 m within a step |
| who may write a field | `OWNERS` in dev/owncheck.js; `?owncheck=1` records every other writer with its file:line | creators fill an entity in before it joins; a system keeps its private per-entity state in its own fields (listed) or a WeakMap |
| which events exist | `EVENTS` in core/events.js | add the type there with its emitter; dev mode warns otherwise |
| the features' order | each feature's `export const order = {after, before}` (core/features.js sorts) | a cycle throws |
| module state of another system | the owner's API: `world.propTop`, `setClothWind`, `STREAM.addStone / removeStone`, `PL.faceShot / flicker / regrid` | |

### 2.4 A system, concretely

The existing feature contract is already close; the change is that a system says which layer and phase it lives in,
what it owns and what it reads, and gets services instead of reaching into other features:

```js
// sim/fire.js: ignition, burning, spread, burn-out.
// OWNS: the `burnable` component. READS: env.windAt, world.near. EMITS: fire.ignite, fire.burnout.
export default {
  name: 'fire', layer: 'sim', after: ['env'],
  init({world, env, events, combat}) { ... },
  step(dt) { ... },            // fixed dt, sim only: no drawing, no sound
};
// view/firefx.js: the flames, sparks, smoke and heat ripple of whatever sim/fire says is burning.
export default {
  name: 'firefx', layer: 'view', quality: {low: 0.3, high: 1},   // particle density per quality tier
  init({world, render, env}) { ... },
  frame(f) { ... },            // per rendered frame: reads sim, pushes render work
};
```

---

## 3. Performance standards

### 3.1 Budgets

Milliseconds of main-thread CPU per frame on the dev machine. They add up to 4 ms, which is ~10 ms on a mid laptop.

| group | what's in it | budget |
|---|---|---|
| sim | player, projectiles, every system's fixed step | 1.0 ms |
| char | the hero: sprite + cloth + bow compositing | 0.5 ms |
| view | world sync, cosmetic systems, lights choice | 1.0 ms |
| render | `G.render`: scene submission + uploads | 1.2 ms |
| ui | HUD, overlays | 0.3 ms |
| **frame (JS total)** | | **4.0 ms**, and p95 frame time <= 6.5 ms (165 Hz = 6.06) |
| GPU | `G.render` GPU time at 1440p | 3 ms |

The numbers live in `src/core/perf.js` (`BUDGET`). Change them only on purpose, in a commit that says why.

### 3.2 The tools

- **F3 in the game** (or `?perf=1`): the frame profiler. Frame-time graph, each group against its budget, the most
  expensive systems. Every feature hook is timed automatically.
- **`node tools/perf/bench.mjs`**: five scenarios in headless Chrome on the real GPU, compared with
  `tools/perf/baseline.json`. It fails when a scenario is over budget or a system got 25% (and 0.1 ms) slower. It
  checks that the machine is quiet first: parallel sessions baking or capturing make every number 2-4x worse.
  `--only night`, `--save` (new baseline after an intended change).
- **`node tools/test/golden.mjs --compare tmp/golden/ref4`**: a scripted tour (seeded `Math.random`, a virtual clock,
  no rAF) captured bit-exact: 16 PNGs + state digests by day, night, storm, snow and in a run. A refactor must leave
  every capture identical; a run that differs once and not again (seen right after a bench) is re-run before
  believing it. `--save <dir>` captures a new reference after an intended visual change.
- **`node tools/test/smoke.mjs`**: keys, the menu, loadouts, biome switches, pause / resume, climbing at an angle, the
  camera, resizes, zoom, the title, 600 frames of a run, with no console errors.

### 3.3 The rules

1. **Measure before and after.** Any change that touches the frame runs the bench; the commit message carries the
   before/after of the systems it touched. A new system starts with a budget line in its header.
2. **Nothing allocates per frame in steady state.** No object/array literals, spreads, `.map/.filter/.slice`, closures
   or `new Vector3` inside update/frame loops. Preallocate, pool, use typed arrays (structure-of-arrays for particles),
   reuse scratch objects.
3. **Update on change, not every frame.** Static things are built once. Moving things mark themselves dirty. Caches
   are keyed by a version (`canvas.version++` when repainted, uploaded only when the version changed).
4. **No per-frame pixel work on the CPU.** No `getImageData` / `putImageData` / software rasterising / 2D-canvas
   painting + re-upload in the frame loop. Do it in a shader, bake it at load, or cache it and redraw on change.
5. **Spatial questions go through the grid.** Never scan all props/entities per call; `host.entities.near(x, y, r,
   out)` answers from the uniform grid (the player's collision and interaction, arrows, the prop physics, brute spots,
   fire spread use it), and a per-frame pass over one kind uses a live query (`host.entities.query`).
6. **Everything visible is capped and culled.** Every particle system has a hard cap, uses the one on-screen test, and
   simulates off-screen sources at reduced rate. Quality tiers (low / medium / high) scale density, cloth, HD fx and
   shadow sizes.
7. **Draw calls scale with kinds, not counts.** Static casters are drawn into a cached shadow map; batches upload
   only the range written this frame; instancing where many copies of a model are on screen at once (measure: for
   props spread round a map it lost to per-mesh culling). Shadow casters: something that never moves
   goes on sScene layers 1 + 2 (height map + static map) and marks the static map dirty when it changes; something
   that moves stays on layer 0 (the per-frame map).
8. **No dev cost in the shipped frame.** `preserveDrawingBuffer`, debug views, captures and test hooks are opt-in.

---

## 4. Code standards

- **File header** (every module): one paragraph saying what it is, then `OWNS:`, `READS:`, `EMITS:`, `BUDGET:`. If the
  OWNS line needs "and also", it's two modules.
- **Units and axes:** metres, seconds, radians internally (degrees only in data tables, converted at load). Gameplay
  coordinates are the arena's: x east, y south (ground), h up. The renderer's X east / Y up / Z south and the camera's
  view frame exist only inside `render/` and the player adapter; conversions live in `render/viewxf.js`, nowhere else.
- **One copy of every basic:** `core/mathx.js` (clamp, lerp, smoothstep, hash, value noise), `core/rng.js` (seeded,
  one algorithm), `core/color.js` (parse once, cached). Search before writing a helper.
- **Tuning is data.** Each system's numbers sit in one `TUNE` object at the top of the file (or in `content/`), never as
  magic numbers inside functions.
- **Flags in one place.** URL parameters and settings are declared in `core/flags.js` with a default and a one-line
  description; systems read `flags.get('wind')`. No `new URLSearchParams(location.search)` anywhere else.
- **Dev code is quarantined.** Debug keys, A/B renderer toggles, lineups, capture hooks: `dev/`, loaded only in dev
  mode, never imported by game code.
- **Errors are loud in dev.** A system that fails to load or throws is shown on screen in dev mode, not just a
  `console.warn` (a `-(x) ** 2` SyntaxError once silently removed a whole feature).
- **Dependencies are vendored** (`src/vendor/`), pinned, no CDN.
- **Line endings LF**, UTF-8 (Windows Python: `open(p, 'w', newline='')`).
- **Syntax-check modules as modules:** `node --check file.js` did NOT catch a duplicate `const` at module level in
  this repo; copy to a `.mjs` first (`cp x.js tmp/chk.mjs && node --check tmp/chk.mjs`).

---

## 5. Working in parallel (several Claude sessions)

Most tangles start as two sessions editing the same file for different reasons.

- **Ownership:** each system file belongs to one area. To change another area's behaviour, use its API or events; if
  the API is missing, add it to that file in a small, separate, clearly described change (and say so in the commit).
- **Contracts change in one place, on purpose:** the system contract, the events catalog, component schemas and
  services are documented here and in `core/`. A change to any of them updates the docs in the same commit.
- **Commit small and often**, one feature per commit, after the bench. Uncommitted work in a shared file is invisible
  to the others and gets trampled.
- **Restructuring phases (section 6) freeze the files they move.** While one runs, other sessions work on content,
  art, audio and tools, not on the files being moved.

---

## 6. The migration plan

No rewrite. Each phase leaves the game playable, ends in a commit and a bench run, and can be stopped after.

| phase | what | exit check |
|---|---|---|
| **0. Measure** (done 2026-10-01) | F3 profiler, `tools/perf/bench.mjs` + baseline, this doc, the audit | the numbers in 1.1 |
| **1. Performance, no restructure** (done 2026-10-01: day 4.15 -> 2.04 ms, see 1.1) | cloth: persistent buffers, bounding box, flat arrays; batches upload only written ranges; card frustum culling; `setMatrix` early-out + height-map dirty threshold; flame canvases upload on version; firesim pooling + on-screen culling; cached lights / colours in `applyMood` and `world.update`; cached player position; quantised shaft / cloud keys. Moved on: `preserveDrawingBuffer` (GPU-only cost; captures rely on it) and lights' `F.on` freeze (a sim / view split, phase 4) | day JS <= 2.5 ms, every scenario in budget: met |
| **2. Move and split** (done 2026-10-01, commits 6fcee2c .. eed7783; the layout as built is in 2.3) | `concepts/render3d` -> `src/`; `main.js` 773 -> 191 lines (the boot) split into core / render / sim / view / world / ui / dev modules; the shared arena files forked into `src/`; one `mathx` / `rng` / `color` / `viewxf`; `flags.js`; three.js vendored; old `game/` -> `concepts/legacy-game`. New checks: `tools/test/golden.mjs` (bit-exact captures), `tools/test/smoke.mjs` | behaviour identical: met (16 golden captures identical after every step, smoke passes); bench unchanged: met (day JS 1.55 ms) |
| **3. Entities, grid, events** (done 2026-10-01, commits 936195e .. 1a71971; how to use them: 2.3, "as built after phase 3") | the entity registry with live queries (combat's create-time snapshots gone); a uniform grid for collision / interaction / arrows / prop physics / brute spots / fire spread, live kind queries for the per-frame passes (run JS 1.56 -> 1.25 ms); namespaced events with the catalog (and the jump event's view-frame bug it exposed); the ownership table + `?owncheck=1`, and the cross-system writes it found fixed at their owners (torch mounting, soft plants, `gone`, hit feedback + rails, the cloak's wind, stepping stones, the player's facing / flicker); declared feature order. Left for phase 4 on purpose: stats.js / game.js tuning overwrites (modifiers), renderer uniform setters, ctxO's world fields, views that read sim state mid-step (wind's cloth strips), wind's own foliage index and wildlife's solids list onto the grid, the hover / contact passes over all items, `combat.enemies` allocating per read | no module writes another's entity fields: met (`?owncheck=1` over a sandbox session and a run: 0 violations, 0 added fields); golden identical but one intended 8 x 4 px change (ref3, see 3.4a) |
| **4. Fixed step, sim / view split, modifiers** | fixed 60 Hz sim + interpolation; each mixed feature split (wind -> `env` wind field + foliage / leaves / audio views; lights -> `sim/fire` + `view/firefx`; ...); `stats.js` -> modifiers | sim runs headless in a test; quality tier "low" works |
| **5. GPU-side visuals** (done 2026-10-01, see 1.1: shadow draws 188 -> 56, render -18 to -30% by day) | cached static shadow map + per-frame one for what moves (instancing built, measured, dropped); cloth collision early-out; per-pass stats, `--throttle`. Evaluated and deferred with reasons (1.1): cloth / fire on the GPU, layers in shaders, `preserveDrawingBuffer` | shadow draws ~halved: met (-70%); laptop-class target (CPU throttled 3x) holds 60 fps on average, the busiest moments touch it |

Phases 1 and 5 make it fast; 2-4 make it changeable. Phase 1 can start right away and needs no freeze. Phases 2-3 are
the ones to do soon, while the game is ~12k lines: they get more expensive with every feature added on the old shape.
