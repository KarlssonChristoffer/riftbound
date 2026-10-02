# Performance audit, 2026-10-02 (snapshot)

Why the frame rate isn't where it should be on the dev machine (RTX 4070, 3440x1440 at 164 Hz: 6.1 ms per frame), and
the staged plan to fix it. It was measured on commit fe9bdf4 with other sessions' uncommitted work in wind.js, game.js,
gfx.js, adapter.js and player.js. Line numbers drift, so search for the quoted code. The budgets are in `src/core/perf.js`
and the rules in `docs/ARCHITECTURE.md` 3.3; this doc says where today's frame breaks them.

**Status:** stage 1 committed (5df7f51; results in E.1). Stage 2: the flames (E.2) and the water's reflections (E.3) are
done; clouds / shafts / haze are next. Stages 3-4 not started.

**Correction (same day):** the horde's 6.15 ms in C.1 was inflated by the machine's load. On a less loaded machine
(load ~20%) the same code measured 2.7-3.1 ms (E.1). The shares in C.2 hold, but horde is not as far over budget as C.1
suggests. Whole-frame numbers swing up to 2x with the machine's load; use the interleaved A/B (F) to compare code.

---

## A. Verdict

The game is **CPU-bound on the main thread**. The GPU uses ~1 ms of the 6.1 ms frame.

By day the JS (~3-3.9 ms) fits the 4 ms budget on average, but the slow frames don't. Those are GC pauses of up to ~2 ms
and busy moments, and on a 164 Hz screen they show as stutter. With 60 enemies the JS is ~6.2 ms and the game cannot
hold 164 Hz at all.

Three patterns cause almost all of it:

1. **Pixels are painted on the CPU.** Water reflections, contact shadows, light shafts, clouds, fog and the Ranger are
   painted into 2D canvases with JS, then re-uploaded as textures every frame. The fire's ~1000 particles are simulated
   and pushed one by one in JS.
2. **Everything is visited every frame**, changed or not. `world.update` visits every item, and three.js recomputes
   every object's world matrix in every pass.
3. **One draw call and one material per thing.** The main scene holds 417 objects with 416 distinct materials, and the
   shadow scene 343. An enemy costs a card plus a shadow draw, so the cost grows with exactly what "more life" adds.

---

## B. How a frame is made today

`core/loop.js` `frame()`:

1. **Camera** turn (keys, drag, snap).
2. **Sim:** fixed 1/60 s steps (`simStep`: env, the player, arrows, every feature's `update`). This costs < 0.1 ms per
   frame.
3. **Views** once per frame:
   - `hero.stepCloth`: the cloak sim, 120 Hz substeps;
   - every feature's `view`: particles, springs, animals, wind.
4. **Draw** (`render()`):
   - `hero.compose`: sprite + cloth raster + hair + bow into two 192x160 canvases, uploaded;
   - `world.update`: every item's matrix, uniforms and card hooks;
   - `proj.draw`;
   - every feature's `frame`: `host.sprite / point / line` batches, and 2D painting into `G.layer()` screen layers
     (688x288 canvases, uploaded on any frame they're used);
   - `lighting.apply`;
   - `G.render()`, described below;
   - the **HD overlay**: a 3440x1440 2D canvas, cleared every frame, plus each feature's `hd` inside `save/restore`,
     the HD bow, the prompt and F3.
5. **`G.render()`** (`render/gfx.js`):
   - batch uploads;
   - card bounds;
   - canvas uploads;
   - the litter sim;
   - shadow passes: static 4096² on change, per-frame 2048² for movers;
   - the height map, on change;
   - the **gbuffer** (3 RGBA16F targets + depth, at the art resolution 688x288);
   - the x-ray;
   - the composite (lighting; into `outRT` when the HD path is on);
   - heat;
   - the **blit** to the 3440x1440 canvas;
   - HD fx particles at display resolution.

   The canvas has `preserveDrawingBuffer: true`.

The art resolution is the window divided by the display scale: 3440x1440 / 5 = 688x288. The GPU work is small; the
JavaScript that drives it is not.

---

## C. Measurements

Headless Chrome on the RTX 4070 (ANGLE D3D11, no vsync) at 3440x1440. The machine was BUSY (load 42%: a game client,
browsers and chat apps), so absolute times are inflated, roughly 1.2-1.4x by the calibration. The shares hold.

### C.1 bench (`node tools/perf/bench.mjs --no-fail`)

| scenario | fps | p50 | p95 | JS avg | view | render | GPU p95 | gbuffer draws |
|---|---|---|---|---|---|---|---|---|
| day | 245 | 4.1 | 5.3 | **3.87** | 1.89! | 1.41! | 1.01 | 64 |
| night-fires | 471 | 2.0 | 3.3 | 1.98 | 0.95 | 0.67 | 0.60 | 62 |
| walk | 421 | 2.3 | 3.3 | 2.23 | 1.23 | 0.66 | 0.82 | 92 |
| run | 334 | 3.0 | 3.7 | 2.85 | 1.35 | 1.02 | 0.98 | 92 |
| storm | 254 | 3.9 | 5.3 | 3.71 | 1.87! | 1.35! | 1.03 | 64 |
| snow | 269 | 3.6 | 4.9 | 3.48 | 1.75! | 1.23 | 1.13 | 64 |
| **horde (60)** | 153 | 6.4 | **8.4!** | **6.15!** | 2.87 | 2.49 | 1.16 | 124 |

### C.2 CPU profile, day (V8 sampling profiler, 6 s)

The main thread was ~94% inside `frame()`. Shares of all JS:

| share | what |
|---|---|
| **~33%** | `G.render`. Of that: `WebGLRenderer.render` 27%, `renderBufferDirect` (per-draw setup) 14%, `multiplyMatrices` inside `updateMatrixWorld` **4.4%**, `projectObject` 1.9%, `initTexture` / `texSubImage2D` (canvas uploads) 4.5%, `syncCards` 1.6% |
| ~12% | `lights.frame` -> `drawFlames` -> `firesim.draw` (9.8%) + `firesim.step` (2.4%), by day |
| ~8% | `world.update` (biomes.sprite, stateOf, placeOf + setMatrix, card hooks) |
| ~7% | `depth.frame`: `drawWater` 5.1% (mirror, `rippleCopy` row copies), shafts, clouds |
| ~7% | the Ranger: `hero.compose` 4.3% (cloth.draw 3.4%), `hero.stepCloth` 2.5% |
| ~5% | wind: `view` 2.0% (stepDecor / simPiece, stepFoliage), `frame` 1.6% (rasterItem) |
| ~3% | `contact.frame`: a scan of all items + a full-view mask |
| ~3% | `restore` on the HD overlay (`core/loop.js` render: `hq.save(); f.hd(hq, sc); hq.restore()` per feature) |
| ~1.6% | the profiler's own wrappers (`perf.js` `w`, `now`) |
| 0.4% | GC on the main thread (sampled); the pauses are in C.4 |

The horde (60 enemies) looks the same, except `G.render` grows to ~40% and `renderBufferDirect` to 19%.

### C.3 Per frame, counted (day)

- **GL calls:**
  - ~133 draw calls (119 drawArrays + 12 instanced + 2);
  - ~420 uniform uploads;
  - ~100 bindTexture;
  - 31 useProgram;
  - 122 bindVertexArray.
- **Canvas uploads:** 3 view-sized canvases (688x288, ~790 KB each) + the hero's 2 canvases (192x160) every frame.
- **2D canvas work:** ~53 drawImage, ~48 fillRect, ~30 setTransform, ~12 clearRect, 11 save / restore, ~3 putImageData.
  About 122 of these calls land on 688x288 canvases and 16 on the 3440x1440 HD overlay.
- **Scene size:**
  - gScene: 417 objects (326 visible), **416 distinct materials**;
  - sScene: 343 objects (253 visible);
  - 303 props, 283 world items;
  - 20 shader programs, 121 geometries, 57 textures.

### C.4 Trace (Chrome tracing, 5 s, day)

- **Main thread:** busy 99.5% (uncapped). Per frame: the rAF callback 3.6 ms p50, 5.0 ms p95, 6.6 ms max. The
  browser's own lifecycle (commit, paint) adds ~0.2 ms per frame.
- **GPU process main thread:** busy 71.6%, ~2.6 ms per frame:
  - 2D canvas raster (`RasterCHROMIUM`, ~10 per frame): ~1.1 ms;
  - WebGL command decode: ~0.9 ms;
  - present: ~0.15 ms.

  Every 2D canvas that is drawn into costs work here too.
- **GC:**
  - ~89 minor GCs per second (scavenge, max 2.07 ms);
  - **~6 major GCs per second** (finalisation, max 2.15 ms).

  A 2 ms pause is a third of a 164 Hz frame.
- **Audio bake workers:** two `audio/runtime/bake.worker.js` workers take ~1.5-2 s of CPU each in the first ~10 s after
  load. This is startup only, not steady state.

### C.5 Allocation (V8 sampling heap profiler, 5 s)

**~360-400 KB of garbage per frame** (day 363, horde 397), ~60 MB/s at 164 Hz. ARCHITECTURE.md rule 3.3.2 says zero in
steady state.

| KB / frame | site |
|---|---|
| 43 | `view/cloth.js` `#substep` |
| 33 | `Math.hypot` (the builtin allocates a FixedDoubleArray of its arguments per call; ~2000 calls per frame, mostly the cloth) |
| 22 | `features/firesim.js` `draw` (doubles boxed across `host.point` -> `G.point` calls, `wind.at` objects) |
| 20 | `features/wind.js` `simPiece` (stepDecor) |
| 16-19 | `world/world.js` `update` (stateOf strings, option literals, matrices) |
| 15 | `view/cloth.js` `tri` (draw) |
| 12 + 7.5 | `features/lights.js` `stepParts`, `drawParts` / `trail` |
| 9 + 8 | `features/depth.js` `drawWater`, `off` (rippleCopy: `inv()` per row) |
| 8.5 + 6 | `features/contact.js` `stamp`, `frame` (`host.toView` arrays, string keys) |
| 8 + 4 | `world/entities.js` `lerpBegin`, `sync` |
| 6.5 + 4 + 3.5 | `render/gfx.js` `sprite` (string key, option literal), `syncCards`, `upload` |
| ~3-6 each | wildlife `drawGround`, wind `drawItem`, garden `spr`, three's uniform setters (horde) |

---

## D. Findings by area

### D.1 The renderer (`render/gfx.js` + three.js)

1. **Every object's world matrix is recomputed in every pass.** A `THREE.Scene` keeps `matrixAutoUpdate = true`, so
   `updateMatrix()` flags the scene and `force` propagates to all ~760 children on every `renderer.render` (gbuffer,
   shadow, x-ray, ...). The objects themselves already have `matrixAutoUpdate = false`. This costs ~4.4% of JS.
   Fix: scenes `matrixAutoUpdate = false`, and the objects flag `matrixWorldNeedsUpdate` when their matrix is set.
2. **Per-draw cost.** A card has ~30 uniforms in its own `RawShaderMaterial`. three.js uploads changed ones per draw and
   frustum-tests all ~580 visible objects per pass. That is ~8-10 µs per draw. Fixes:
   - stage 3: painted world cards and enemies through the instanced sprite batches;
   - shared materials with per-object data in a texture or instance attributes;
   - if still needed, a thin custom submit loop for the gbuffer and shadow passes.
3. **`sprite()`** builds a template-string key per call and `tex(img, {dynamic})` makes an options literal. `host.sprite`
   (main.js) spreads its argument. All three allocate on every call.
4. **`preserveDrawingBuffer: true`** on a 3440x1440 canvas: a full-buffer copy instead of a swap, every frame. GPU-side.
   Keep it only for captures (a flag).
5. **Screen layers:** every 688x288 layer used in a frame is cleared, painted by JS, snapshotted and uploaded (~790 KB
   each). Some features ask for `layer('ground')` even when they draw nothing: wind.js frame, wildlife.js frame.

### D.2 CPU pixel work (stage 2 candidates)

| where | what | GPU replacement |
|---|---|---|
| `features/firesim.js` draw / step | ~1000 particles: per particle `axis()` (4 sin), cos / sin / pow, `host.point` | stateless GPU particles. Each particle's path is closed-form in (birth time, seed): z = z0 + vz·t + ½·buoy·t², th = th0 + sw·t; the axis dance is uniforms. CPU work becomes a birth counter per fire |
| `features/depth.js` drawWater | mirror sprites into scratch canvases, `rippleCopy` (a drawImage per row band), masks with composite ops, per-pixel `skyBand` + putImageData | screen-space mirror in the composite, on water pixels (gbuffer read at the mirrored row), ripple / tint / glint as shader maths |
| `features/depth.js` drawClouds, shafts, haze | pattern fills into `pre` / `add` / `distort` every frame | composite shader (world position from depth: `uInvPV` already exists) |
| `features/contact.js` | a scan of all items, `host.toView` per item, a full-view mask | casters as a uniform array / data texture, ellipses evaluated in the composite |
| `features/atmos.js` hd | a full 3440x1440 canvas blit every frame (vignette / haze); fog tiles into `add` | the blit or composite shader |
| `features/combat/draw.js` | ability bar cache at full HD size, blitted full-screen; `waterline()` per pixel per frame | a cache sized to the bar; waterline cached per prop |
| `view/hero.js` + `view/cloth.js` | compose 2 canvases + a JS cloth raster every frame, uploaded | later: the cloth as a GPU mesh (look-sensitive); sooner: compose / upload only on change |
| `features/wind.js` | software raster of hanging cloth at 30 Hz; whole-atlas re-upload of both atlases | GPU mesh, or sub-rect uploads and an emit upload only when emit pixels changed |
| trees (`world.update` leanTree + wind's per-tree springs) | per tree per frame on the CPU | sway in the shader from the gust field (`W.gpu`, as grass does) |
| all of the above | `host.layer()` 2D drawing | a GPU layer batch: instanced quads into a render target (`G.px` / textured quads), same typed-array pattern as `G.point` |

### D.3 Visiting everything (stage 1)

- `world.update` (`world/world.js`), per item per frame:
  - `biome.sprite`;
  - `stateOf` (builds strings for rocks, walls, chests);
  - `placeOf` + `setMatrix` (16-float compare);
  - uniforms;
  - visibility;
  - card hooks.

  `world/stage.js` `cardHook` / `meshHook` run `features.find(f => f.name === 'wind')` per card or tree per frame.
- `core/loop.js` writes `it.hover` on every item every frame.
- `contact.frame` scans all items (rule 3.3.5).
- wind's gust `field()` is evaluated 3x per nearby foliage prop per step (stepFoliage, stepFeel, windlines), and again
  per tree per frame and per particle.

### D.4 The HD overlay (stage 1)

- A 3440x1440 2D canvas is cleared every frame, with `save / restore` around every feature's `hd`. `restore` alone was
  ~3% of JS.
- atmos and combat blit full-size canvases into it every frame.
- `ui/hud.js` text: a font string plus stroke and fill per call.
- `ui/prompt.js`: `features.map` plus `measureText` every frame.

---

## E. The plan

Each stage ends in a bench run, on a QUIET machine, before and after. A change that must not change what you see
passes golden against a reference captured right before it (`tmp/golden/perf_s1_before` for stage 1; ref4 is stale
since the river / grass merge).

### Stage 1: quick wins, no visible change (target -0.5..0.8 ms per frame, garbage < 100 KB per frame)

1. Scenes `matrixAutoUpdate = false` (gfx.js, render/grass.js, render/litter.js); objects flag their world matrix.
2. Garbage:
   - an allocation-free, bit-identical `hypot3` (V8's algorithm) for the cloth;
   - per-particle storage that doesn't box doubles;
   - shared option objects (lights, wind, garden, firesim's `wind.at` scratch);
   - `sprite()` keyed without strings and `tex()` without a literal;
   - `host.sprite` without a spread;
   - `stateOf` without strings;
   - depth / contact scratch outputs;
   - entities lerp / sync without allocation.
3. `world.update`: an early-out per item whose inputs are unchanged and that isn't wind-driven. Cache the wind feature
   in stage.js. `it.hover` only for the hovered item.
4. HD overlay:
   - clear only what was drawn;
   - no `save / restore` per feature unless the feature needs it;
   - atmos / combat full-size blits cut to their content.
5. Ranger: compose and upload only when the inputs changed (sprite frame, face, bow, hair tick, cloth pixels changed).

Checks: golden (`perf_s1_before`), smoke, simview (feature views touched), `?owncheck=1`, bench A/B against the
`src-perf0/` copy of the code before stage 1, and a heap sample (KB per frame).

### E.1 Stage 1 as built (2026-10-02)

Results:

- **Main-thread time per frame:** -19% by day and -17% with 60 enemies. This is the median per-slice ratio B/A of an
  interleaved A/B (`tmp/perf-tools/ab.mjs`): 16 slices x 150 frames, before and after alternating in one Chrome, so
  machine load hits both alike. By day that was 3.89 -> 2.95 ms; with 60 enemies 4.58 -> 3.80 ms (a loaded machine).
- **Per system (bench, noisy):**
  - `world.update` 0.25 -> 0.15 ms;
  - `G.render` -6%;
  - three.js's matrix recomputation 4.6% -> 0.8% of the profile.
- **Garbage:** day 586 -> 241 KB per frame (-59%), 60 enemies 651 -> 313 KB per frame (-52%). Same machine, back to back.
  Minor GCs on the main thread: 16 -> 6 in 6 s.
- **Checks:**
  - golden: 16 of 16 captures identical against `tmp/golden/perf_s1_before`, a reference captured from the tree just
    before stage 1;
  - smoke passes;
  - simview passes;
  - `?owncheck=1`: 0 violations and 0 added fields, in sandbox and in a run.

What changed:

- **`render/gfx.js`:**
  - the scenes' `matrixAutoUpdate = false`; new meshes flag `matrixWorldNeedsUpdate`;
  - `mesh().ver`, a counter that bumps on every matrix change;
  - sprite groups keyed by a number, not a string;
  - shared `tex()` option objects;
  - `toScreenInto(x, y, z, out)`;
  - `hypot2` in `syncCards`.
- **`core/mathx.js`:** `hypot2` / `hypot3`. These are `Math.hypot` bit for bit (V8's algorithm, checked on 4M+ random
  and edge inputs) without its per-call array, and 5-9x faster. Used in the cloth (`#substep`, `#collide`, `draw`), wind
  (`field`, `simPiece`, `normals`, foliage, feel, particles), lights `trail` and `world.leanTree`.
- **`world/world.js` `update`:**
  - a live mesh's state and matrix are rebuilt only when their inputs changed (position, wobble, stage, lid,
    `manageMatrix`, or `mesh.ver`, which catches a burning prop's slump set by lights.js);
  - visibility and flash are set only on change;
  - every item starts with all its fields, so the loop's loads stay monomorphic.
- **`world/stage.js`:** the wind feature is looked up once, not per card or tree per frame.
- **`core/loop.js`:** the hover pulse is written to the aimed item only, not to every item every frame.
- **`main.js`:** `host.sprite` reuses one object instead of spreading its argument.
- **`view/cloth.js`:** a plain copy loop instead of 2 `subarray` views per row.
- **`features/contact.js`:** numeric stamp keys, footprints cached per sprite, `toScreenInto` instead of
  `host.toView`, a scratch round footprint.
- **`features/depth.js`:** `proj2` / `inv2` into scratch arrays in the ripple, the shafts, the puddles and the mirror.
- **`features/lights.js`, `firesim.js`, `garden.js`, `depth.js`:** `wind.at(x, y, scratch)`, a shared `{emit: true}`.
  `firesim` calls `G.point` directly.

Not done in stage 1, with the reason:

- **The vignette blit (D.4, ~3% of JS):** an ImageBitmap instead of the canvas made no difference; the cost is Chrome
  compositing a full-screen image into the HD canvas. Moved to stage 2: draw it in the blit shader.
- **The Ranger composing only on change:** the cloak moves nearly every frame (wind flutter at 120 Hz), so it would
  rarely skip. Stage 2 (the cloth on the GPU) is the real fix.
- **The rest of the garbage (~240 KB per frame):**
  - firesim and lights particles: doubles boxed across calls, particle literals. Stage 2 (GPU particles).
  - `world.update`'s per-prop loads: props have many shapes. Stage 3 (render data off the props).
  - three.js's uniform setters and render-list sort.

### Stage 2: pixel work to the GPU (target -1 ms by day, and the GPU process relieved)

D.2's table, one effect at a time, each with side-by-side captures for the user's approval: flames, water, clouds /
shafts / haze, contact shadows, vignette / fog, the GPU layer batch, trees' sway from `W.gpu`.

### E.2 The flames on the GPU (2026-10-02, approved by the user from side-by-side captures)

**The design.** `render/flames.js` is new; `features/firesim.js` keeps only the births and each fire's state.

- The CPU only births a particle, with the same random draws as before. It writes the particle once into a slot.
- The shaders compute every live particle's position, temperature, tone, size, dither and HD glow each frame from its
  age. The maths is firesim's old per-particle draw, term for term; the motion is closed-form (rise, swirl, dance, the
  wind's lean).
- Per-fire data is one row of a float texture.
- firesim still ages each particle as two numbers, so the cap and the slots' release happen at the same steps as before.

**Two lessons from ANGLE's D3D11 backend (the first version cost +1.7 ms of GPU):**

1. Instanced `POINTS` are a slow path. The pixel flame is now drawn as squares on the pixel lattice, which cover what a
   point sprite covered.
2. A vertex shader over 32k mostly empty slots cost ~0.6 ms of GPU per pass. The slots are now a packed pool (a min-heap
   of free slots, so a birth takes the lowest) and the draws cover only the slots in use.

**One gotcha for seeded captures (golden):** three.js draws `Math.random` for every new object's id (`generateUUID`).
Creating three objects therefore shifts the random sequence of everything after them (rain and snow came out different).
To compare the old and new paths, both had to create the same objects.

**Results.** Interleaved A/B on a loaded machine, CPU flames vs GPU flames:

| | Before | After |
|---|---|---|
| `lights.frame` | 0.47-0.69 ms | 0.07-0.08 ms |
| `lights.view` | 0.18-0.30 ms | ~0.07 ms |
| `G.render` (fewer CPU points to upload) | — | lower |
| GPU | — | +0.08 ms |

Whole frame: about -20% by day, -35% at an ember night, -10% with 60 enemies.

**Checks:**

- the captures differ only inside the flames (a handful of single pixels: the closed-form motion vs the old Euler steps);
- with the CPU path removed, golden is identical to the approved GPU captures (`tmp/golden/flames_gpu`);
- smoke and simview pass.

### E.3 The water's reflections on the GPU (2026-10-02, the user chose this look from side-by-side captures)

**What it replaced.** depth.js mirrored the props near the water as their painted sprites, flipped about their contact
row, in 2D canvases every frame. It then copied rows shifted by the ripple, masked them, tinted them and laid the result
on the GROUND layer, and the flames' emit images went into the EMIT layer. That was ~5% of the frame's JS plus a canvas
upload.

**What it is now.** The composite shader does it (`gfx.js` COMP_FS `reflAt`):

- **The geometry.** In the oblique orthographic view, a point h above the water's plane mirrors exactly 2·h·S view px
  straight below itself on screen (S: px per metre of height). For each water pixel, the shader searches up its column
  for the first pixel whose height over the water crosses k / 2S.
- **The look** is the 2D version's: rows shifted whole pixels by the ripple (the same formula), the water's tint (0.38),
  laid over the water's albedo at 0.6 before the light, and emission (flames) mirrored at glowDim.
- **What reflects:** props, 3D trees, cards and the character. Not the ground, cliff faces, the batched sprites (obj 9:
  lily pads lying on the water, reeds, wildlife) or particles.
- **Puddles** are still painted by depth.js, now at alpha 254 in the GROUND layer. COMP_FS reads that alpha as "a puddle
  here" and mirrors what stands over it.
- **The sky glint** stays in depth.js, with its water mask filled only over the glint's box.

**The difference the user accepted.** All the 3D things reflect, in their real shapes: walls, pillars, the trees' crowns,
not painted stand-ins near the water. A thing above the screen's top edge can't reflect, because it isn't in the
G-buffer.

**Results**, interleaved A/B standing by the river:

| | Before | After |
|---|---|---|
| `depth.frame` | 0.34 ms | 0.08 ms |
| `G.render` (one canvas upload fewer) | 1.64 ms | 1.06 ms |
| GPU | — | +0.03 ms |

Smoke passes. Captures without water are identical (ember night 2/2).

### Stage 3: fewer draw calls (target: horde `G.render` 2.5 -> ~1 ms; 2-3x the enemies in budget)

Enemies and painted world cards through instanced batches (one draw per sprite sheet and pass). Shared materials with
per-object data in a data texture. Measure; then decide on a custom submit loop for the gbuffer / shadow passes.

### Stage 4: browser and measuring

- `preserveDrawingBuffer` off outside captures.
- F3 and the bench show GC pauses, draw calls, uniform uploads and canvas uploads per frame.
- Save a 3440x1440 baseline on a quiet machine.
- A zoomed-out bench scenario (the worst case: more world on screen).
- A windowed, vsync'd run that counts missed frames at 164 Hz.

**Expected after stages 1-3:** day ~3.9 -> ~1.5-2 ms JS, horde ~6.2 -> ~2.5-3 ms.

---

## F. How it was measured (reproducible)

Scripts in `tmp/perf-tools/` (git-ignored; output goes to `tmp/perf-tools/out/`), all modelled on
`tools/perf/bench.mjs`. Their ports are HTTP 8143 / 8145 and Chrome debug 9372 / 9373 (the test tools' ports are 9342 /
9351 / 9352 / 9354). `--path src-perf0` points any of them at the copy of `src/` from before stage 1 (`D:/Game/src-perf0/`,
excluded in `.git/info/exclude`).

- **`ab.mjs`: the interleaved A/B.** Use it to compare code on a loaded machine. Two pages run in one Chrome with rAF
  off, each stepped by hand (`__r3d.step`) in alternating slices. It reports ms per frame and the per-slice ratio.
- **`own.mjs`:** a short drive with `?owncheck=1`, then prints the ownership report.

- **CPU profile:** `Profiler.start` with a 100 µs sampling interval for 6 s. The analysis gives self time by function
  and file, the nearest game-code caller of native / three.js time, and inclusive time.
- **Trace:** `Tracing.start` with the v8 / gc / devtools.timeline / gpu / viz / cc categories, 5 s. The analysis gives
  busy time per thread, events by name, GC counts and pauses, and rAF durations.
- **Counts:** WebGL2 and `CanvasRenderingContext2D` methods wrapped in the page, divided by frames (`G.render` calls).
- **Heap:** `HeapProfiler.startSampling` (4 KB interval, including objects collected by minor and major GC), divided by
  frames (fps x seconds).

Worth porting into `tools/perf/` (stage 4).
