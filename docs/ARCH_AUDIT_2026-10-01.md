# Architecture audit, 2026-10-01 (snapshot)

The measured detail behind `docs/ARCHITECTURE.md` section 1, and the work list for migration phases 1 and 3. It is a
snapshot of commit 19c8754 plus the uncommitted work of that day; line numbers drift, so search for the quoted code.
Paths: `R/` = `concepts/render3d/`, `S/` = `concepts/sprites/`.

---

## A. Performance work list (phase 1 and 5)

Status 2026-10-01: items 1, 2, 3, 4c, 4d, 5, 6 (pooling + culling, not structure-of-arrays), 7 (flames), 10, 11, 12,
14 (swap-remove, shared options) and the `setSun` / layer / stats allocations in 15 are DONE (phase 1; results in
ARCHITECTURE.md 1.1). Left for phase 5: 4a, 4b, 4e, 7 (layers, armour mask, hair), 8, 9, 13 (the grid is phase 3).

Scene size: ~250 world items (≈185 live meshes, ≈60 painted cards). Per frame the GPU runs: sun shadow 2048² (every
frame while the sun or moon casts, ≈200 casters), height map (only when dirty), gbuffer (3x RGBA16F MRT, ≈150-170 draws),
x-ray, composite, heat (when there are heat blobs), blit at display resolution, HD fx at display resolution.
`G.stats.calls` counts only the gbuffer pass, so the HUD's "draws" is about half the real number.

Ranked by measured or estimated cost:

| # | where | problem | fix | impact |
|---|---|---|---|---|
| 1 | `S/cloth.js` `draw` | ~1 MB of new typed arrays + 2 ImageData per frame; all passes over the full 192x160 box though the cloth covers a few hundred px; `Math.hypot` and closures per pixel; orphan pass builds arrays per pixel | persistent buffers on the rig; work only inside the projected bounding box (+2 px); scalar maths; one persistent ImageData; target ≈0.15 ms | HIGH (≈1 ms + GC) |
| 2 | `S/cloth.js` `#substep` / `#collide` / `update` | ≈30k short arrays per frame (`sub`, `cross`, `[0,1,2].map`, `pos[i] = [...]`) | flat `Float32Array` pos / prev / goal; capsules precomputed per update; the wind.js `simPiece` style | HIGH (GC) |
| 3 | `R/gfx.js` `flushBatches` | lines / points / fx / sprite attributes upload the WHOLE buffer every frame (≈0.9 MB) | `clearUpdateRanges(); addUpdateRange(0, n * itemSize)`; skip and hide when n = 0; drop the second heat upload | HIGH, trivial |
| 4 | `R/gfx.js` scene | one material per mesh (full uniform upload + state change per draw); cards `frustumCulled = false` (drawn off-screen, twice); `setMatrix` always dirties the world matrix; three sorts ≈300 objects per pass; the shadow map redrawn in full every frame with an unused colour attachment | (a) instance the static kit (walls, rocks, towers, pillars: one InstancedMesh per glb state); (b) cached static shadow map + small dynamic one, depth-only; (c) card bounding spheres; (d) `setMatrix` early-out; (e) `sortObjects = false` for gbuffer / shadow | HIGH (three.js = 20-30% of CPU) |
| 5 | `R/gfx.js` height map | `hDirty` fires every frame from hit wobble (`p.x + wob / PPM`) and from burning props (world.update sets the base matrix, lights.js the slumped one: two matrices per frame) | dirty only past ≈1 texel (6 cm) / 2% scale; burning items set `manageMatrix` | MED-HIGH (spikes) |
| 6 | `R/features/firesim.js` | particles are object literals (240-1250 spawned / s per flame); per particle per frame 4 sin + cos + 2 pow + a new options object for `host.point`; 15 m box culling | structure-of-arrays per fire; axis() precomputed at 16 heights; shared option objects; view-rect culling | MED-HIGH |
| 7 | canvas uploads | torch / brazier flame canvases uploaded at 60 Hz though painted at 12 Hz (`world.js` `G.tex(hk.em, {dynamic: true})`); 2D layers (contact AO, lava haze, foreground) cleared + uploaded every frame; armour mask `getImageData` loop; hair wind `getImageData` ×2 | `canvas.version` gate in `tex()`; contact shadows as sprite quads; lava haze and vignette in shaders; metal mask from the cloth cover bitmap | MED |
| 8 | display-resolution work | HD overlay cleared at full display res × dpr every frame; atmos vignette `drawImage` full screen every frame; HUD text strokes; `preserveDrawingBuffer: true`; fx halos ≈100 px radius at DS 4 | vignette / haze into `BLIT_FS`; skip clears when nothing drawn; cache HUD strings; `preserveDrawingBuffer` only for captures; fx at half res | MED (grows with the monitor) |
| 9 | `COMP_FS` `ptBlock` | up to 128 height-map fetches per light per pixel, 32 lights | shadow only the 6-8 strongest lights; 2-texel steps + refine | MED (GPU, ember night) |
| 10 | `R/world.js` `update` | every item every frame: sprite memo lookup, light objects rebuilt with `rgbOf(hex)`, `setMatrix`, ≈8 uniform writes, `G.tex` on static emit | per-item dirty flag; light records cached per sprite | LOW-MED |
| 11 | `R/main.js` `applyMood` | `slice`, `map`, `filter`, `sort`, new light objects, `rgbOf` per light per frame | persistent records, colour cache, partial selection of the 32 nearest | LOW-MED |
| 12 | `R/main.js` aim + player getters | `hoverTarget()` projects all items 2-4x per frame while aiming; `host.player.x/.y` allocate on every read (dozens per frame) | memoise per frame; cache PX / PY after `PL.step` | LOW-MED |
| 13 | collision scans | `blockedW` = `props.some` over 250 props, several calls per step; `stepArrows` scans all props per arrow; `flamePoints()` rebuilt with no arrows | uniform 1 m grid; arrow trail ring buffer; early-outs | LOW-MED |
| 14 | `R/features/lights.js` parts | mixed-shape objects, `splice` inside the loop (O(n²)), options literal per point, ash bed rehashed every frame | swap-remove, one shape, shared options, cached offsets | MED |
| 15 | small allocations | `G.sprite` template-string key; `host.sprite` spread; `host.point` `rgbOf` on strings; `[...groups.values()].reduce`; `Object.values(layers)` ×2; `setSun` clones; contact.js 250 projections + mask clear; HD-bow arrow `map` | numeric keys, caches, scratch objects | LOW |

## B. Coupling inventory (phase 3)

### B.1 Who reaches into whom (around the host contract)

- `game` -> `combat`: reads `combat.core`, `combat.phys.resetAll`; writes `core.steer`, `core.immune`, `core.T` (respawn
  numbers), `core.S.gold`; calls `retireYard / clearEnemies / resetYard / damage / part / interact / enemies`. The game
  layer turns itself off without combat.
- `game/stats.js` writes `core.T.{crit, critMul, msN, boomR, boomBlast, rainN, trapRoot}`, `core.AB[k].cd`, and
  `SPEED` imported from `S/player.js`; `restore()` puts them back. `game.js` keeps a second restore snapshot of `core.T`.
- `game/nav.js` imports `PLAY, TRAIL, WORLD, elev, inStream` straight from `world.js`.
- `lights` -> `combat`: `core.breakProp(p, {ash: true})` (and combat has an `o.ash` branch for lights).
- `lights`, `garden` -> `world.js`: `Object.assign(WORLD.PROP_TOP, {...})` at import time.
- Wind field readers: lights, firesim, garden, flow, wildlife, depth, atmos (`atmosGust`), windlines.
- `windlines` -> `audio`: `host.feature('audio')?.windAudio.swish(...)`.
- `S/arena/audio.js` reads combat's debug arrays `dbg.zones` / `dbg.traps` (their growth triggers sounds) and scans
  props for torches, airborne brutes and tipping props.
- `combat/props.js` damages through `core.onArrowHit` with a fake arrow `{kind: 'impact'}`.
- Player internals written from outside: `core.js` writes `host.P.face/want/twang`, calls `host.PL.dirOf`; `props.js`
  calls `host.PL.moveInput()`; `game.js` writes `P.raw.blink`, calls `host.PL.hold`; `main.js` rotates `P.rollDir, P.back,
  P.leap.*, P.want`. flow, contact, depth read `host.P` / `host.PL`.
- Renderer internals used by features: `it.live.gm` (lights raycast), `it.live.burn / setMatrix` (lights), `it.manageMatrix`
  (props), `it.card.g.uniforms.uEm` (depth), `itemOf(p).pose.crown` / `live.gm.geometry` (wind, windlines, wildlife),
  `host.G.view.T` (windlines, wind, wildlife, lights, garden).

### B.2 Fields added to prop objects, by module

Created by `S/arena/layout.js`: `rect r wob target rail light breakable hp maxHp stage explode wall interact opened
sparring home outside occluder`. Added later:

| module | fields |
|---|---|
| `R/main.js` | `wob` / `flash` decay, `x` via `rail`; lineup `seed painted lineup` |
| `combat/core.js` | `r0 h faceW squash air stage home wob flash hp broken respawnAt gone dead lit rooted opened resetAt retired lid`; enemies: `type name elite boss aura knock reach pause hopT hopD hopH coins dmg hitR hunter` |
| `combat/props.js` | `home3 vx vy push idle tip tilt vh sinkT float slide stone sink goneBroken wasBroken pushT pushing pushSnd lid z h r gone broken manage` (`manage`, `pushing` are never read) |
| `combat/draw.js` | `face hpShow` |
| `game/hud.js` | `hpBar` |
| `lights.js` | moves torch `x`; `sconce mount lightable fx model unlit opened gone interact mesh meshes n a` |
| `garden.js` | `r = 0` on every bush / rock / tuft (re-run every 2 s), `gone`, `garden` |

`S/arena/biomes.js` (shared with the arena) reads the render3d-only `sconce / unlit / model / fx` and keys its sprite
memo on them. Arrows get `trail stuck hitSet` (main), `_lt _id fire` (lights), `dmg explode dmg0 extra` (game),
`done n` (core).

### B.3 Shared mutable state

| state | owner | also written by |
|---|---|---|
| `CLOTH_PARAMS` | `S/cloth.js` | `R/main.js` every step (and the arena + demo pages) |
| `SPEED` | `S/player.js` | `game/stats.js` |
| `core.T`, `AB[k].cd`, `S.gold` | `combat/core.js` | `game/stats.js`, `game/game.js` |
| `PROP_TOP` | `R/world.js` | `lights.js`, `garden.js` at import |
| `ctxO` | `R/main.js` | `world.js` adds `WM HM WPX HPX PLAY layout`; props, flow, depth, wind, biomes read them |
| `STREAM.stones` | `S/arena/layout.js` | `combat/props.js` push / splice (changes `inStream` for player, nav, combat) |
| `world.props` | `layout.js` (kept across biome switches) | pushed by main (lineup), combat props + spawnBrute, lights, garden, game (portal); spliced by core, game |
| `host.dev / lock / timeScale / hudOff`, `keys`, `mouse.down` | `R/main.js` | `game.js` |

### B.4 Hidden ordering

1. Update order = the `FEATURES` array (wind first; lights and garden before combat).
2. Creation order is load-bearing: combat snapshots `hittables / colliders / chests / brutes / walls` at create time;
   props added later (portal, re-added sconces) are invisible to it.
3. `game` is unshifted first and mutates `a.dmg` before lights / combat read it; it claims chests in a run.
4. `onArrowHit` stops at the first truthy return: lights and game must return nothing.
5. Events reach the others one step late (`events.splice(0)` before the updates); combat special-cases this; props.js
   de-duplicates with a WeakSet.
6. During hitstop only `F.always` features update, with no events: events pile up.
7. `world.update` runs before features' `frame`; props / lights override matrices after it (`manageMatrix` lags a frame).
8. `flow.js` mirrors main's camera ease "step for step".
9. `F.on = false` skips update entirely: lights' burning freezes when key 9 turns lights off.
10. `biomeChanged` isn't awaited, but lights / garden / combat's are async.
11. `wind.cloth()` runs before wind's update: the cloth uses the previous step's wind at the player.

### B.5 Events (current)

| type | emitted by | consumed by |
|---|---|---|
| step | player.js | atmos, flow, audio |
| land | player.js; props.js (`prop: true`) | atmos (doesn't check: props leave footprints), flow, wildlife, audio |
| jump | player.js | atmos, flow, wildlife, audio |
| splash | player.js; main (arrow, `small`); props.js; wildlife (`wl`) | atmos, flow, wildlife, audio |
| hit | main (prop); core (`player: true`) | game, props, wind, atmos, wildlife, audio |
| break | core | props, atmos, wildlife, audio |
| explode | core | props, wind, lights, garden, atmos, flow, wildlife, audio |
| hurt, kill | core | game |
| loot, open, coin, trap, respawn | core (respawn also props) | wildlife, audio |
| tip, kick, scrape, impact | props.js | wildlife, audio |
| birds_scatter, wings, caw, fish_jump, frog_jump, critter_dash | wildlife | audio (birds_scatter also wildlife) |
| bird_perch (a bird lands on / leaves a prop's top; added after the audit) | wildlife | wind (shakes dying leaves loose) |
| ignite, crackle, logFall, addWood | lights | none |
| talk | garden | none |
| roll | never emitted | atmos (dead branch) |

`land` and `splash` are overloaded (player vs prop vs animal) and every consumer disambiguates differently.
Call chains: arrow (`spawnArrow` -> `F.arrow` -> `stepArrows` -> `onArrowHit` chain -> `onArrowStuck` -> `world.treeHit`),
interact (`features.some(f.interact)`), prompts (`features.map(f.prompt).find`), abilities (`features.some(f.ability)`).

### B.6 Duplicates to merge (phase 2)

- Colour parsing: main.js, world.js (×2), lights, firesim, depth/art, atmos, flow, wildlife, wind, `ART.hex`.
- Hashes: main.js, wind, flow, depth/art, `ART.hsh`, world.js (a different, sin-based one), trees3d `hashXY`.
- Value noise: flow, depth/art, `ART.vn`. PRNGs: mulberry32 ×5, Park-Miller ×4. `clamp` ≈12 copies.
- World <-> view rotation: main, flow, props, core, draw, garden, atmos (+ inline in main). The view affine from four
  `host.toView` probes: atmos, flow, depth (identical). On-screen tests: wind, wildlife, windlines, depth, lights,
  garden; draw.js re-implements `G.toScreen`.
- Cursor-to-view transform: main ×2, hud, draw.js (with its own `mousemove` listener).
- Stream bed height -0.18: world.js exports it; atmos, flow, wildlife, depth, draw hard-code it.
- Prop heights: `PROP_TOP`, core `HGT`, lights `TOP`, main's inline table; `hitH ?? 1.6` repeated in 4 files.
- Circle / rect collision against all props: main ×2, props, core ×2, nav, main's collider overlay.
- Climb spot: main.js `climbSpotW` duplicates player.js `climbSpot`.
- Respawn / restock: core `restock` and props.js `resetHome`, coordinated through `wasBroken / goneBroken`.
- Atlas shelf-packing: lights vs kit3d. Tree crown bounds: wind vs windlines.

### B.7 Configuration and globals

- URL parameters: main.js (`set biome time props trees3d lineup yaw zoom snap at smooth sampling lantern debug bow
  perf`), game (`dev mode`), wind (`wind windlevel`), windlines, atmos (`weather hd`), contact, depth (`depth fg`),
  flow, wildlife, `S/arena/audio.js` (`sheet audio forge`). Each file parses `location.search` itself.
- localStorage: `riftbound3d.save.v1`; `pg.audio.muted / music / vol` (shared with the arena page).
- Globals: `window.__r3d`, `window.__audio`; window listeners in main.js and combat/draw.js.

### B.8 Shared with the 2D arena

Imported by both pages: `S/player.js` (+ `S/harmonize.js`), `S/cloth.js`, `S/arena/biomes.js`, `S/arena/layout.js`,
`S/arena/lighting.js` (tables only), `S/arena/armor.js`, `S/arena/audio.js` (+ music.js, `audio/runtime/*`).
Ported copies that can drift: combat, props3d, atmos, wind, wildlife, depth, flow.

### B.9 Bugs found in passing

- `R/features/wind.js` update: `if (Math.floor(T * 12) !== wtick) {...}` is inside a `//` comment on the `wph +=` line,
  so `wphQ` stays 0 and the crowns' ripple phase never advances. (FIXED 2026-10-01 by the trees session.)
- `F.on = false` stops lights' update, so its "hidden but still burning" branches are dead.
- Dead code: `q.manage`, `q.pushing` (props.js), garden's `LAN.lit`, atmos's `roll` branch.
