# Performance audit, 2026-10-02 (snapshot)

Why the frame rate isn't where it should be on the dev machine (RTX 4070, 3440x1440 at 164 Hz: 6.1 ms per frame), and
the staged plan to fix it. It was measured on commit fe9bdf4 with other sessions' uncommitted work in wind.js, game.js,
gfx.js, adapter.js and player.js. Line numbers drift, so search for the quoted code. The budgets are in `src/core/perf.js`
and the rules in `docs/ARCHITECTURE.md` 3.3; this doc says where today's frame breaks them.

**Status:** stage 1 committed (5df7f51; results in E.1). Stage 2: the flames (E.2), the water's reflections (E.3), the
cloud shadows and the lava's heat haze (E.4), the vignette (E.5), the contact shadows (E.7), the GPU layer batch (E.8),
wind's cloth atlas (E.9) and the hero's compositor in arrays (E.10) are done. The trees' sway was measured and left (E.9).
Stage 3: the world cards in instanced batches (E.6; a fix in E.8). Stage 4 (E.11): done. In a real window at 164 Hz the
game misses 0-3 vsyncs in 10 s in every scenario. The last per-frame canvas uploads (flow's marks, the stream's glints)
are on the GPU too (E.12). The heap's garbage is down a quarter (E.13: 174 -> 131 KB a frame by day, not yet the
100 KB stage 1 aimed at; what's left is listed there).

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

### E.4 Cloud shadows and the lava's heat haze in the composite (2026-10-02; the same pixels within 2 / 255)

**What it replaced.** Both were painted every frame by depth.js through the ground plane's affine, and the canvas was then
uploaded:

- the clouds as a full-view pattern fill of a tile into the PRE layer;
- the haze as 2 px row bands, masked by the lava's top-down map, into the DISTORT layer.

**What it is now.** COMP_FS maps the view pixel back through that affine (`viewTexel`) to a texel of the same top-down map
and applies the same rule: the clouds' two levels and their colour; the haze's whole-pixel row shift, the same formula.

- Both maps live in ONE R8 texture (`tTop`: the cloud levels on top, the lava mask below). It is re-uploaded only when the
  cover changes (in 1/16 steps) or the world is rebuilt.
- The cloud tile is no longer re-rasterised when the mood's colour changes; the colour and the two alphas are uniforms.

**Limits now in COMP_FS:**

- **The 16 texture units are full.** A GPU only guarantees 16 per fragment shader, and with `tTop` the composite uses all
  16 (17 failed to link). A new map must share an existing texture, or a screen layer must go first; when the layers move
  to the GPU, their samplers free up.
- **Making three.js objects after load shifts golden's seeded random.** `generateUUID` draws `Math.random`, so rain and
  sparks land elsewhere. `tTop` is therefore made once at the start and re-sized, never re-created.

**Checks:**

- golden against a copy of the tree with the old depth.js (`src-c0/`, the same random sequence): every capture within 1 / 255
  (the canvas's alpha rounding);
- next to the lava, the haze's capture is within 2 / 255 of the old one (and 33k px differ with the haze off: it is there);
- smoke and simview pass.

**Results**, interleaved A/B:

| | `depth.frame` | `G.render` |
|---|---|---|
| Cloudy day | 0.107 -> 0.047 ms | 1.09 -> 0.88 ms (no PRE upload) |
| Ember lava | 0.086 -> 0.012 ms | 0.89 -> 0.73 ms (no DISTORT upload) |

**Light shafts and motes: measured and left on the CPU.** Up to 5 cached shaft canvases and ~45 motes go into the ADD
layer, ~0.06 ms in all. A GPU version needs a new additive post pass whose draw calls cost about as much.

### E.5 The vignette and top haze on the GPU (2026-10-02; the same screen within rounding)

**What it replaced.** atmos.js painted the arena's drawOver (a radial vignette, a linear haze over the top 30%) once into
a display-sized canvas (3440x1440, 20 MB), then blitted it into the HD overlay EVERY frame. That blit was ~3% of the
frame's JS, showing up at the context's `restore`; an ImageBitmap didn't help (D.4).

**What it is now.** `gfx.js` VG_FS works out the same two gradients per display pixel (the same stops, alphas and colours)
and lays them over everything in the WebGL canvas, last, as the overlay canvas did. atmos.js only hands over the numbers
(`G.setVignette`, from F.hd). The overlay canvas is no longer made.

**Checks:**

- golden's GL + HD captures composited, against a copy with the old atmos.js (`src-v0/`): ±1 / 255 over the vignette;
- up to 13-52 / 255 on a few hundred pixels under the semi-transparent HUD bars, which comes from the HUD canvas's
  premultiplied PNG export; the crops look identical;
- smoke passes.

**Results:**

| | Before | After |
|---|---|---|
| whole frame by day (interleaved A/B, every slice) | | -26% |
| `G.render` | 1.21 ms | 0.87 ms |
| GPU | | +0.05-0.08 ms (a full-screen pass at 3440x1440) |

### Stage 3: fewer draw calls (target: horde `G.render` 2.5 -> ~1 ms; 2-3x the enemies in budget)

Enemies and painted world cards through instanced batches (one draw per sprite sheet and pass). Shared materials with
per-object data in a data texture. Measure; then decide on a custom submit loop for the gbuffer / shadow passes.

### E.6 Stage 3 as built: world cards in instanced batches (2026-10-02; bit-exact)

**What it replaced.** Every painted world card (a bush, tuft, reed, dummy, brazier, brute ...) was a mesh with its own
material. three paid its per-draw cost (~8 µs: the uniforms flattened and uploaded, the program state, a frustum test)
once per card per pass, so 60 brutes were 120 draws. On top of that, every pass walked objects it never drew:

- the 90 hidden cards of the 16-angle prop A/B (`?props=yaw`), made at every build;
- ~200 static shadow casters in `sScene`, walked by the per-frame shadow pass though only the cached static map draws
  them.

**What it is now:**

- **The batches.** `gfx.js` `card({batch: true})` (world.js `cardOf`) returns a plain record, with no mesh. render()
  packs the visible ones per group (texture x emit texture x casts a shadow) into one interleaved instance buffer (28
  floats each). It draws each group once in the G-buffer and once in the sun's shadow.
  - BCARD_VS / BCARD_FS are CARD_VS / CARD_FS term for term.
  - A group's buffer is uploaded only when a value in it changed.
  - The plants' autumn palettes are rows in a float texture (36 texels: 4 ramp tones, then 32 path tones) instead of
    uniform arrays.
  - `?cards=0` turns the batches off (a mesh per card: the A/B).
- **The yaw cards** are made the first time that mode shows them.
- **The static casters** have their own scene, `sStatic`. A static prop that starts moving goes over to `sScene` and
  comes back once it is still. The static map and the height map render both scenes, so a layer-2 caster added to
  `sScene` from outside still casts.

**Checks:**

- golden against a capture of the code before stage 3: 16 / 16 identical;
- the same with `?props=yaw` (day, night): 12 / 12 identical;
- smoke and simview pass.

**Results.** These come from an interleaved A/B against a copy of the code before stage 3, 14 slices x 150 frames. The
machine was loaded, so the whole-frame figures are the median of the slices.

| | Before | After |
|---|---|---|
| `G.render`, day | 1.16 ms | 0.76 ms |
| `G.render`, night | 0.98 ms | 0.57 ms |
| `G.render`, horde | 2.06 ms | 0.83 ms |
| whole frame | | -25% day, -29% night, -42% horde |
| draws per frame, day | 134 | 106 |
| draws per frame, horde | 254 | 108 |
| `uniform1f` / `uniform2f` / `uniform3fv` per frame, day | 109 / 81 / 90 | 38 / 45 / 28 |
| GPU, day (timer queries, p50) | 0.63 ms | 0.63 ms |

**Not done from the plan:** shared materials with per-object data in a data texture (for the meshes), and a custom
submit loop. The horde's `G.render` is now under the ~1 ms target, so neither is needed yet. What is left in `G.render`
is mostly the canvas uploads (the hero, the view layers) and three's per-pass walk of the scenes.

### E.7 Stage 2 continued: contact shadows on the GPU (2026-10-02; the same pixels within rounding)

**What it replaced.** contact.js painted every stamp into a view-sized canvas mask each frame:

- a clear, then a `drawImage` per stamp (the player, ~20-100 world items);
- a full-view `source-in` fill for the tint;
- a blit of the mask into the GROUND layer, which then had to be uploaded even when nothing else drew there.

**What it is now:**

- contact.js still decides every stamp (where, which size, how strong) and still makes each stamp's image once, the same
  alpha bytes. It hands them to `gfx.js` (`G.aoStamp`, `G.ao`, `G.setAo`) instead of a canvas.
- gfx.js keeps the stamp images in one R8 atlas. AO_VS / AO_FS draw one instanced quad per stamp into the x-ray target's
  G channel (R is the x-ray mark; G was free, so no new texture unit in COMP_FS). Each pixel shows the stamp texel the
  canvas's nearest-neighbour `drawImage` showed there, merged source-over as the mask was.
- COMP_FS mixes the mood's shadow colour into the ground's albedo by that mask (`uAo`), where the ground layer was mixed
  in before.

**Differences.** Two small ones, neither visible in the captures:

- the contact shadows now lie under the other ground-layer marks (footprints, animal shadows) instead of over the ones
  drawn before them;
- a puddle under a contact shadow keeps its reflection (the shadow used to change the ground layer's alpha, which marks
  puddles).

**Checks:**

- golden against a copy of the tree before the change (`src-ct0/`): every capture within 1 / 255, except a few pixels
  where two stamps overlap (up to 6 / 255, the 8-bit blend rounding); the crops look identical;
- smoke and simview pass.

**Results.** These come from an interleaved A/B on a loaded machine (another session's Blender, a game client). The old
canvas path stalled erratically under that load (slices up to 70-140 ms), so its whole-frame figures are unreliable; the
new path held steady.

| | Before | After |
|---|---|---|
| `contact.frame` | 0.22-0.55 ms | 0.04-0.05 ms |
| `G.render` (day, horde) | ~2.0 ms | ~1.0 ms (no mask flushed and blitted into the ground layer) |
| GPU, day (p50) | 0.64 ms | 0.63 ms |

### E.8 Stage 2 continued: the screen layers drawn by the GPU (2026-10-02; the same pixels within 1 / 255)

**What it replaced.** Every frame the ground and add layers (night: ground and front) were 2D canvases. The features
cleared and drew into them, and each used canvas was uploaded to WebGL. That upload is a 2D-canvas -> WebGL copy that
waits on the GPU. Under load (another session's Blender, a game client) it made whole frames erratic: in an A/B against
a copy with the layers stubbed out, the canvas path's slices swung 3-15 ms where the stub held ~2 ms.

**What it is now:**

- **The targets.** Each layer is a render target at the view's size, premultiplied, in GL rows. COMP_FS reads it there
  (`lay()` no longer flips rows; the mixes are premultiplied: `alb * (1 - a) + rgb`). No texture unit was added.
- **The GPU context: `host.glayer(name)`** (`G.glayer`). It takes the canvas subset the per-frame marks use:
  - `fillStyle` (any CSS colour, read once per string), `globalAlpha`, `globalCompositeOperation` (`source-over`,
    `lighter`);
  - `fillRect`, `drawImage` (3, 5 or 9 arguments, nearest);
  - `save` / `restore`, and `setTransform` / `translate` / `scale` without rotation.

  Each op is one instanced quad (LB_VS / LB_FS), in call order. The ops are grouped in runs (a blend x one texture; fills
  join any run), and each run is one upload and one draw. An image drawn there is uploaded once; `G.touch(canvas)` after
  painting it again.
- **The canvas stays for the rest** (`host.layer`): paths, gradients, clips, rotated transforms, pixel writes. When one
  is used, its canvas is uploaded and drawn into the target where it was first drawn into in the frame, so the GPU marks
  drawn after it stay over it.
- **Moved to `glayer`:**
  - ground: wind's pole shadows, wildlife's shadows / fish / vultures, the puddles, combat's shadows and waterline,
    the props' chunk shadows, flow's and atmos's mark pixels, the lights' ash and scorched rings;
  - add: the light shafts and motes; front: flow's glow, the foreground pieces;
  - emit: combat's and wind's glowing pixels; distort: the fires' heat shimmer.
- **Still on the canvas:** flow's ground decals (an affine with rotation, clipped by the plateau), its emit cut-out and
  afterimages; atmos's ground fog (rotated tiles); the stream's sky glints (`skyBand`, pixel work). Day, night and horde
  in the Proving Grounds no longer use a canvas at all.

**A bug found on the way, also in stage 3.** three.js works out an instanced geometry's instance limit once, the first
time it is drawn (`geometry._maxInstanceCount`). It never redoes it when a batch later swaps in a bigger buffer, so the
instances past the old size were silently not drawn. The card batches (E.6) start at 32 a texture: in a horde, a facing
held 62 brutes and only 32 were drawn, in 468 of 600 frames. The sprite batches (64) had the same flaw. `regrown(geo)`
now clears the limit wherever a batch grows. Golden hadn't caught it: its run's wave has few brutes.

**Checks:**

- golden against a copy of the tree before the change (`src-lb0/`): every capture within 1 / 255 (premultiplied
  rounding);
- the horde: no batch draws fewer instances than it holds;
- smoke and simview pass.

**Results**, interleaved A/B (14 x 150 frames; the machine was quieter than in E.7):

| | Before | After |
|---|---|---|
| whole frame, day / night / horde | 2.10 / 1.82 / 2.24 ms | 1.64 / 1.51 / 1.84 ms (-22% / -17% / -18%) |
| `G.render`, day / night / horde | 0.88 / 0.69 / 0.95 ms | 0.68 / 0.60 / 0.76 ms |
| GPU, day (p50) | 0.63 ms | 0.62-0.63 ms |

### E.9 The remaining uploads: wind's cloth atlas from its arrays; the hero and the trees measured (2026-10-03)

**The trees' sway: left on the CPU.** The per-tree lean (world.js `leanTree`), wind's mesh hook and the trees' share of
the foliage springs cost ~0.03 ms a frame together. A shader sway from the gust field would save next to nothing, change
how the trees move, and still need the CPU for the arrow shudder, the birds' bob and the player's brush.

**The hero's composite: measured; cutting its uploads needs another compositor.**

- **What it costs.** Two 192 x 160 canvases (albedo, normals) are composited on the CPU and uploaded every frame:
  - ~0.19 ms to compose, 80% of it the cloak's software raster (view/cloth.js `draw`);
  - ~0.075 ms to upload.

  These are CPU-backed canvases (`willReadFrequently`), so the upload doesn't wait on the GPU and doesn't stall.
- **Why the uploads stay.** With the cloth sim, the picture changes in ~70% of idle frames and in every frame of motion,
  so "only when changed" saves little. Uploading only the drawn box costs the same as all of it: Chrome snapshots the
  whole canvas either way, and three's `copyTextureToTexture` adds ~5 state reads per call. Reading the box back to an
  array (`getImageData`) costs 0.23 ms.
- **What would help.** Composing into an array (the cloak already rasterises into one), or the cloak on the GPU (look-
  sensitive). Both would also have to keep the CPU picture that contact.js and flow's afterimages read.

**Wind's cloth atlas: from the raster's arrays (bit-exact).**

- **What it replaced.** Every changed piece box was `putImageData`'d into two 512 x 256 GPU-backed 2D canvases (albedo,
  emit). Then both whole canvases were uploaded at the raster rate (30 Hz): a GPU canvas -> WebGL copy, the stall class
  E.8 removed from the layers. A glowing piece (ember hems, rift runes) uploaded both atlases on every raster.
- **What it is now:**
  - `G.texData(img, x, y, w, h, data, rowLen)` uploads a block of RGBA bytes into part of a canvas's texture at render
    time (`texSubImage2D` from the array, straight by GL: one bind per texture, the row length set per block).
  - wind.js sends each changed slot from its raster buffer (`b.im` / `b.eim`). The canvases stay blank: they only name
    the two textures.
  - The emit rows get their own changed-pixel check, so ember night went from ~13 slot uploads a frame to ~4.
- **Checks:** golden against the code before: 16 / 16 identical; smoke and simview pass.

**Results**, interleaved A/B (14 x 150 frames). The machine was loaded (another session's work), and the old path's
slices swung 2-11 ms where the new one held 1.3-2.7:

| | Before | After |
|---|---|---|
| whole frame, day / ember night / horde | 4.06 / 3.36 / 3.43 ms | 2.12 / 1.58 / 2.28 ms |
| `G.render`, day / ember night / horde | 1.78 / 1.57 / 1.53 ms | 0.90 / 0.62 / 0.93 ms |
| `wind.frame` | 0.09-0.15 ms | 0.06 ms |

The last, quieter slices are closer together (day 1.65-2.03 against 1.50-1.66 ms). The win is mostly that a busy GPU no
longer stalls the frame.

### E.10 The hero's composite in arrays (2026-10-03; bit-exact)

**What it replaced.** Each frame view/hero.js composited the Ranger into two 192 x 160 CPU canvases:

- `drawImage` of the atlas frame (albedo, normals);
- the cloak via its own canvas (`putImageData`, then `drawImage`);
- the hair and the pixel bow as `fillRect`s.

Then both whole canvases were uploaded.

**What it is now:**

- **The composite.** hero.js `pix(w, h)` is an RGBA8 array plus the box drawn this frame. It takes:
  - `blit`: an atlas frame, or the cloak's box. view/cloth.js `draw` hands its rasterised box straight to a target that
    has `blit`, no canvases.
  - `put`: one hair pixel (packed colours, read once per frame and facing, as before).
  - the 2D calls the pixel bow makes (`fillStyle`, `globalAlpha`, `source-over`, `save` / `restore`, `fillRect`).

  Alpha 0 and 255 copy; anything between is laid over by straight-alpha source-over.
- **The atlas frames.** A pose sheet is decoded to bytes once, the first time one of its frames shows.
- **The upload.** Only this frame's box joined with last frame's goes up, through `G.texData`, which now takes a source
  offset.
- **The readers.** The two canvases are now the readers' copy (contact's foot measure, flow's afterimages and emit
  cut-out). `sprite().img` / `.nrm` fill them from the arrays, over the changed box, only when one is read.
- **One CSS colour reader.** `cssRGBA` moved from gfx.js to core/color.js; the composite's bow colours use it too.

**Checks:**

- golden against the code before: 16 / 16 identical (contact reads the canvas copy in every capture);
- a roll with afterimages captured: identical;
- smoke and simview pass.

**Results**, interleaved A/B (14 x 150 frames):

| | Before | After |
|---|---|---|
| whole frame, day / storm / horde | 2.84 / 2.48 / 2.14 ms | 1.77 / 1.68 / 1.47 ms (-37% / -32% / -31%) |
| `G.render` CPU, day / storm / horde | 1.26 / 1.07 / 0.91 ms | 0.69 / 0.62 / 0.54 ms |
| `hero.compose` (now without the uploads) | 0.15-0.20 ms | 0.14-0.17 ms |

The `G.render` drop is much bigger than the uploads' own measured cost (~0.075 ms). The canvas path cost more than its
calls show.

**An open question: the GPU timer.** Timer queries on `G.render`'s offscreen passes read 0.50 ms before (p95 0.51, very
tight) and 0.62-0.68 ms after (p95 ~0.9).

- **Ruled out, by variants in one page:** switching off the hero's uploads, then every block upload; uploading whole
  blocks; adding a CPU-canvas upload or a GPU-canvas readback each frame; delaying the work before or after the render.
  None of these moved it.
- **Where it isn't:** new gfx.js alone with the old compositor reads 0.62 on the full timer, the same as before.
- **Why it doesn't look like work:** the new code issues strictly less GPU work, and the output is bit-identical. It looks
  like how the GPU process schedules this context's commands, not more work. Under vsync this timer measures mostly
  waiting (it read 0.5 and 4.3 ms for the same build).
- **Why it doesn't matter yet:** even taken at face value it's +0.15 ms of a 6.1 ms frame, with the frame CPU-bound.

A windowed 164 Hz run on the dev machine (stage 4) is the way to settle it.

### Stage 4: browser and measuring

- `preserveDrawingBuffer` off outside captures.
- F3 and the bench show GC pauses, draw calls, uniform uploads and canvas uploads per frame.
- Save a 3440x1440 baseline on a quiet machine.
- A zoomed-out bench scenario (the worst case: more world on screen).
- A windowed, vsync'd run that counts missed frames at 164 Hz.

**Expected after stages 1-3:** day ~3.9 -> ~1.5-2 ms JS, horde ~6.2 -> ~2.5-3 ms.

### E.11 Stage 4 as built (2026-10-03)

**`preserveDrawingBuffer` off.** The renderer kept the canvas's drawing buffer between frames, which costs a copy of the
3440 x 1440 back buffer every frame.

- Every frame draws every pixel, and the captures (golden, cap tools) read the canvas in the task that drew it, so nothing
  needed it. `?preserve=1` keeps it for a capture that reads the canvas later.
- golden: 16 / 16 identical.
- Interleaved A/B: -7..-12% a frame (median slice 0.92), `G.render` -11% by day and in the horde (0.63 -> 0.56 ms, 0.71
  -> 0.62 ms). The GPU timer doesn't see the copy (it happens in the compositor).

**The frame's counts in F3 and the bench.**

- render/glstats.js wraps the WebGL context while the profiler shows them (F3 up, or `?bench=1`) and counts:
  - draw calls and uniform calls;
  - texture uploads from a canvas / image (Chrome snapshots it whole) and from an array, with their bytes;
  - buffer bytes.
- core/perf.js `counts()` rolls them per frame with the JS heap: its growth between collections (KB a frame) and the
  collections a second (drops of `performance.memory`). F3 shows two more lines.
- The bench prints a counts line under each scenario (`--enable-precise-memory-info` for exact heap numbers). After each
  measured window it also takes a 3 s trace of the GC's pauses (MinorGC / MajorGC: ms a second, how many, the longest).

**A zoomed-out bench scenario** (`zoomed-out`: the wheel's widest, half the window's scale). It's the worst case and shows
two things to do next:

- 243 draws and 711 uniform calls, about twice the day's;
- **one canvas upload a frame of ~2.2 MB**: the stream's sky glints (`skyBand`, the last per-frame canvas user, E.8)
  are on screen there and upload the whole ground-layer canvas. `G.render` is 1.11 ms there, against 0.48 by day.

**A windowed, vsync'd run: tools/perf/vsync.mjs.** A real full-screen Chrome window at the display's refresh rate (the
compositor and DWM in the loop). It records every rAF time and counts the missed vsyncs. On the dev machine (3440 x
1440, 164 Hz, 10 s a scenario):

| scenario | frames | missed | longest | JS avg / p95 |
|---|---|---|---|---|
| day | 1647 | 3 (0.18%) | 12.2 ms | 1.60 / 2.10 ms |
| walk | 1650 | 0 | 6.3 ms | 1.67 / 2.20 ms |
| night-fires | 1649 | 1 (0.06%) | 12.2 ms | 1.23 / 1.60 ms |
| storm | 1650 | 0 | 6.2 ms | 1.58 / 2.10 ms |
| horde (60) | 1650 | 0 | 6.3 ms | 1.60 / 2.10 ms |
| zoomed-out | 1650 | 0 | 6.3 ms | 2.30 / 3.10 ms |

This also answers E.10's open question: whatever the GPU timer reads, the frames make their vsync.

**The interleaved A/B, ported: tools/perf/ab.mjs.** Either side is a folder next to `src/` or `git:REV`: that
revision's `src/` is extracted beside it and removed afterwards (`--a git:HEAD~1` compares the last commit with the
working tree). `--qa` / `--qb` add a switch to one side. It prints the per-slice ratio, the systems' medians and the counts.

**The bench at 3440 x 1440** (2026-10-03, 3 runs a scenario, the median run; the machine was 22% busy with other apps,
so the baseline was NOT saved: run `node tools/perf/bench.mjs --save` on a quiet machine). Every scenario is within
budget:

| scenario | JS avg | frame p95 | GPU p95 | draws | uploads a frame | heap / frame | GC |
|---|---|---|---|---|---|---|---|
| day | 1.27 ms | 2.1 ms | 1.46 ms | 117 | 3.3 array (69 KB) | +133 KB | 1.6 ms/s |
| night-fires | 0.81 | 1.4 | 0.74 | 59 | 3.2 array | +141 KB | 2.0 ms/s |
| walk | 1.05 | 1.6 | 1.06 | 91 | 1 canvas + 3.2 array (843 KB) | +143 KB | 2.1 ms/s |
| run | 1.34 | 2.0 | 1.55 | 145 | 1 canvas + 3.1 array (842 KB) | +164 KB | 2.6 ms/s |
| storm | 1.11 | 1.6 | 1.29 | 116 | 3.3 array | +188 KB | 1.7 ms/s |
| snow | 1.03 | 1.5 | 1.40 | 114 | 3.3 array | +227 KB | 3.3 ms/s |
| horde (60) | 1.11 | 1.6 | 1.42 | 116 | 3.2 array | +155 KB | 2.4 ms/s |
| zoomed-out | 1.68 | 2.4 | 2.27 | 242 | 1 canvas + 3.4 array (2218 KB) | +182 KB | 1.5 ms/s |

**Findings for later:**

- **Two canvases still go up every frame in some views**, both on the ground layer's canvas path (E.8):
  - flow's ground decals (footprints and marks: an affine with rotation, clipped by the plateau), whenever there are
    marks in view (walk, run);
  - the stream's sky glints (`skyBand`, pixel work), whenever the stream is in view (zoomed out).

  Each costs a whole-canvas upload (0.8-2.2 MB). On the GPU, both would leave a normal frame with no canvas upload at all.
- The heap still grows ~130-230 KB a frame between collections (stage 1 aimed at under 100 KB). GC takes ~1.5-3.3 ms a
  second, longest ~2.7 ms.

### E.12 flow's marks and the stream's glints on the GPU (2026-10-03; bit-exact)

**What it replaced.** They were the last users of the ground layer's canvas (E.11), and either one made the whole canvas
go up every frame:

- **flow's marks:** drawn with `drawImage` of each level's canvas, through the ground plane's affine (with rotation) and
  clipped by the plateau's hull (`clip('evenodd')`);
- **the glints:** written per pixel into a view-sized ImageData, masked by the water mask (a pattern fill through the
  ground matrix, then `destination-in`), then blitted. The canvas was used, and uploaded, whenever the stream was in view,
  even with no glint drawn.

**What it is now:**

- **The GPU context** (G.glayer) takes any affine (`setTransform` / `transform` / `rotate` ...: an op is a corner and two
  axes now, 16 floats). Two calls beyond the canvas:
  - `clipOutside(polygons)`: up to 4 polygons; a pixel shows where an even number of them cover it, tested in LB_FS. That
    is the canvas's rect + hulls + `clip('evenodd')`.
  - `fillRectRGB` (numbers, not a colour string, for a fill a pixel).
- **Data images.** `G.dataImage(w, h, data)` is a texture filled from its owner's array. drawImage takes it like a canvas,
  and `G.texData` uploads a changed rect.
- **flow.js.** A mark level is a data image over its own array; `paintRect` sends the rect it repainted. The marks are
  drawn with the affine and the plateau's hulls as the clip.
- **depth.js.** The glints keep their dashes. Each pixel is kept only where the water mask's texel under its centre (the
  mask's alpha, read once a build) is set, then drawn as fills of the wet runs, later dashes over earlier ones as before.
  The two view-sized canvases and the ImageData are gone.
- **A profiler fix.** `perf.reset()` now also clears the running sums. Steps taken without frameStart / frameEnd (a tool's
  settling) used to land in the first frame after a reset (a 47k-draw "frame").

**Checks:**

- golden against the code before: 16 / 16 identical (two captures show the glints);
- a capture with 14 marks (154 mark pixels on screen), the camera turned 0.5 rad and the plateau clip active: identical;
- smoke and simview pass.

**Results**, interleaved A/B:

| | Before | After |
|---|---|---|
| zoomed out: frame | | -21% (median slice 0.81) |
| zoomed out: canvas uploads / upload KB a frame | 1 / 2220 KB | 0 / 72 KB |
| zoomed out: `depth.frame` | 0.143 ms | 0.029 ms |
| walking: frame | | -7% (median slice 0.93) |
| walking: canvas uploads / upload KB a frame | 1 / 844 KB | 0 / 70 KB |
| walking: `depth.frame` | 0.121 ms | 0.035 ms |

**The GPU timer, again.** Zoomed out, the offscreen passes read 0.90 ms before and 1.26-1.83 ms after. In that view no
glint is drawn (0 spans a frame), and switching the glints off changes nothing; there are no marks either. So nothing new
reaches the GPU: removing a per-frame canvas upload raises this timer, as in E.10.

The windowed 164 Hz run settles it for the player, alternating the two versions:

- walking: 0 missed in three of the four runs (10 missed in the fourth);
- zoomed out: one clean run and one with a 150-200 ms hitch for EACH version, from something they share (the zoom-out's
  first frames, or the machine).

### E.13 The heap's garbage (2026-10-03; bit-exact)

**Where it came from.** Measured with V8's sampling heap profiler after 45-60 s of play (the first seconds run in V8's
middle tier, which boxes far more: ~290 KB a frame at 5 s against ~170 at 60 s). Most of it was not visible in the code:

- **A number read through a site that sees many object shapes** (megamorphic) comes back as a new heap number (16 bytes)
  when the field holds doubles. Measured: 20 shapes, 16 bytes a read; 4 shapes or fewer, nothing. Lights' particles had a
  dozen literal shapes; the props have dozens.
- **A field that ever held `undefined` (or anything not a number)** stores its numbers boxed: a new heap number on every
  write (main.js's sprite options, the registry's step records).
- **`arr.length = 0` frees the array's store**: the next push allocates a new one. three's `clearUpdateRanges` does it
  after every upload.
- **A call that isn't inlined boxes its number arguments and its result.** The cloth's substep was one long function, so
  TurboFan's inlining budget ran out before the `hypot3` calls.
- `Array.prototype.sort` makes a work array per call and boxes every comparison's result.
- `Math.hypot`, spreads, `map` / `flatMap` / `forEach` with closures, object literals and `o = {}` defaults per call.
- `Math.random()` returns a new heap number on every call, optimized or not (this V8: 16 bytes a call).

**What changed** (none of it changes a pixel or the sim):

- **main.js `host.sprite`:** the kept options object's number fields always hold numbers (the defaults G.sprite applies
  are worked out in the wrapper). `feat()` (host.wind, host.feature) loops instead of `find` with a closure.
- **gfx.js:**
  - one update range per buffer, kept on it and cleared by pop (`setRange`; the same in flames.js);
  - packCards keeps each card's group (the key is recomputed only when its textures change or a group was disposed);
  - sprite() finds its group through two small-integer keys instead of a numeric key past the Smi range;
  - the layer batch's run meshes stay in their scene and are shown / hidden, not added and cleared each frame.
- **lighting.js:** explicit `.set()` calls instead of spreads and `map`; halos project into a kept array; the candidate
  lights are ordered by a stable insertion sort (the same order Array.sort gave).
- **lights.js:** every particle comes from one factory (`part()`, one shape); F.lights fills kept records (lighting.js
  copies them at once); fires.draw's options are one kept object.
- **view/cloth.js:** the substep is split in three (`#integrate`, `#relax`, `#limit`), so the hypot3 calls inline;
  `mul3` uses loops; two `Math.hypot(...v)` became hypot3 (bit for bit).
- **world/entities.js:** who moved is worked out once per sim step, by its first draw (positions change only in
  steps); the draws between two steps lerp that list instead of reading four numbers off every entity. The lerp lists
  are kept arrays. add / remove / moved drop the list.
- **Smaller:**
  - depth.js: the footprints into kept objects, the shafts' colour strings cached;
  - hero.js: one kept sprite object;
  - contact.js: the player's foot cache keyed by frame, then facing (no key string);
  - wind.js / atmos.js / garden.js: kept sprite options; garden's lights and lantern position kept;
  - wildlife.js: the ground layer projects into a kept array;
  - firesim.js: no `{}` default; loop.js: no array destructuring a frame.

**Checks:**

- golden: 16 / 16 identical against the code before;
- golden's tour runs a frame per step, so the draws between steps (the lerp) were checked apart: 10 captures at 144 Hz
  frames (24 brutes walking, the player walking, a run's wave), each frame different from the last, all identical
  against the code before;
- smoke and simview pass.

**Results** (garbage per frame at a fixed 164 Hz step, after 45 s of play; the A/B's frame times):

| | Before | After |
|---|---|---|
| day: garbage a frame (sampled, fixed 164 Hz step) | 174 KB | 131 KB (-25%) |
| horde (60): garbage a frame | 206 KB | 157 KB (-24%) |
| day / horde: heap growth a frame (perf.counts, in the A/B) | 186 / 212 KB | 136 / 164 KB |
| day: frame (interleaved A/B, median) | 2.78 ms | 2.55 ms (-8.4%; median slice 0.93) |
| horde: frame | 2.69 ms | 2.57 ms (-4.5%; median slice 0.93) |

By site (day): lights' particle step 14 KB -> 0 and their draw 8.2 -> 3.3 KB; the cloth's substep 14.7 -> 6.4 KB;
the registry's lerp 8.4 -> 2.7 KB; lighting's sort and the features' light records 3.6 -> 1 KB. `G.render` -7% by day
(-2% in the horde), `lights.frame` -16..-23%, `cloth.sim` -5..-11%. Draws and uploads are unchanged.

**How it was measured.** `tmp/perf-tools/sample_jf.mjs`: the page loads and plays for 45 s (warm), then 1500 frames are
stepped by hand at 1/164 s each (`__r3d.step(1, 1 / 164)`) under the sampling heap profiler (1 KB interval, collected
objects included). A fixed step makes the per-frame figure independent of the machine's load; uncapped runs swung
90-160 KB a frame for the same code with the frame rate (the machine was ~45% busy).

**What's left** (131 KB a frame by day), in order of size:

- **The props' numbers, read by the scans of all items (~27 KB):** world.update (~14 KB a frame), entities.sync (~8 KB,
  once a step) and contact (~5 KB). Megamorphic reads of double fields, one heap number each. Fixes: props made by one
  factory whose number fields start as non-numbers (reads free, only moving props pay on writes), or the registry
  owning positions in arrays.
- **three.js's uniform setters and render list (~22 KB):** each changed uniform's numbers are boxed into the WebGL
  call. Fewer per-object uniforms (more instancing) is the way down.
- **wildlife's ground layer and sprites (~9 KB).**
- **wind's cloth raster (`tri`, ~8 KB):** the pattern callback per pixel takes two numbers, boxed because the
  callbacks differ per piece.
- **The cloth's `#relax` (~6 KB):** not found (no zero-length links, the arrays hold doubles).
- **`Math.random` in the views (~3.5 KB):** a seeded JS generator would make none, but it changes every random draw
  (golden would differ; the look is the same in kind).
- atmos (~3 KB), wind's foliage step (~3 KB), lights' particle draw (~3 KB).

---

## F. How it was measured (reproducible)

The checked-in tools are in `tools/perf/` (E.11): `bench.mjs` (the budget, the counts, the GC), `ab.mjs` (the
interleaved A/B) and `vsync.mjs` (the windowed 164 Hz run). The rest are scratch scripts in `tmp/perf-tools/`
(git-ignored; output goes to `tmp/perf-tools/out/`), all modelled on `tools/perf/bench.mjs`. Their ports are HTTP 8143 / 8145 and Chrome debug 9372 / 9373 (the test tools' ports are 9342 /
9351 / 9352 / 9354). `--path src-perf0` points any of them at the copy of `src/` from before stage 1 (`D:/Game/src-perf0/`,
excluded in `.git/info/exclude`).

- **`ab.mjs`: the interleaved A/B (now `tools/perf/ab.mjs`).** Use it to compare code on a loaded machine. Two pages
  run in one Chrome with rAF off, each stepped by hand (`__r3d.step`) in alternating slices. It reports ms per frame and
  the per-slice ratio.
- **`own.mjs`:** a short drive with `?owncheck=1`, then prints the ownership report.

- **CPU profile:** `Profiler.start` with a 100 µs sampling interval for 6 s. The analysis gives self time by function
  and file, the nearest game-code caller of native / three.js time, and inclusive time.
- **Trace:** `Tracing.start` with the v8 / gc / devtools.timeline / gpu / viz / cc categories, 5 s. The analysis gives
  busy time per thread, events by name, GC counts and pauses, and rAF durations.
- **Counts:** WebGL2 and `CanvasRenderingContext2D` methods wrapped in the page, divided by frames (`G.render` calls).
- **Heap:** `HeapProfiler.startSampling` (4 KB interval, including objects collected by minor and major GC), divided by
  frames (fps x seconds).

`ab.mjs` was ported to `tools/perf/` (stage 4); the profiles, traces and heap sampling stay scratch scripts.
