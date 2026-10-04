# Photo mode (2026-10-04, branch `exp/photomode`)

Free camera, frozen time, the world's time of day / season / weather / wind on sliders, a tilt-shift and a few colour
grades on the GPU, and a PNG export at 1x or 2x. Off until you open it: with photo mode closed the game is the same as
main b65b9c5 (golden 16/16 identical, smoke and simview pass, no extra pass in the frame).

## Using it

- **Open:** F4, or the pause menu's Game tab, "Photo mode" (in the sandbox and in a run; not on the title or while the
  game holds the input). **Leave:** Esc, F4, or the panel's Esc button: you are back exactly where you were (camera,
  yaw, zoom, the world, the player's state).
- **Camera:** WASD move (Shift faster), Z / X or Q / E turn (the game's free yaw), the wheel or + / - zoom (the game's
  pixel-perfect levels), drag the world with the left button to move it, with the right or middle button to turn,
  R back to the player (position, yaw and zoom as you came in). The view stays inside the world.
- **Panel** (right side, the menu's look and its wooden UI sounds; H or Tab hides it for a clean view): arrows walk it
  (up / down a row, left / right its value), Enter / Space press; the mouse clicks rows, ‹ › and drags the sliders.
  - World: **Living world** (on: nature goes on as behind the pause menu: wind, wildlife, rain, fire, the cloak; off:
    everything still, the shaders' clocks too), **Time of day**, **Season** (the ruins: the point of the year, early /
    mid / late), **Weather** (as is, clear, fair, cloudy, overcast, fog, windy, rain, storm, snow, blizzard, haze),
    **Wind** (as is, calm, breeze, brisk, gale), **As it is now**.
  - Look: **Tilt-shift** (on / off), **Focus** (where the sharp band is), **Focus width**, **Blur**, **Vignette**,
    **Colour** (natural, warm, cool, vivid, faded, mono). Moving Focus / Focus width shows the band's edges for a moment.
  - Scene: **Player** shown / hidden, **Pose** (the live gunslinger only: his emotes, played while he stands still),
    **HUD** shown / hidden (on screen only: the photo never has it).
  - Photo: **Size** 1x (the screen's size) or 2x, **Take photo** (P, or Enter with no row picked).
- **The photo:** the WebGL image alone (no HUD, prompts, panel or dev overlays) with the look on it, downloaded as
  `riftbound_YYYYMMDD_HHMMSS.png`. 1x is the screen as you see it; 2x renders the frame again at twice the size: the
  pixel art blown up by whole pixels (pixel-crisp, checked: the art's 2x2 blocks are uniform), the soft HD layers
  (glow, smoke, heat shimmer, the atmosphere's vignette and haze) and the tilt-shift's blur drawn at the full 2x size.
  The look, the living-world switch and the size are remembered on this machine (localStorage `rb.photo`).
- **Flag:** `?photo=1` opens straight into photo mode (tests).

Try it on the user's server: `http://localhost:8123/src-xpho/?mode=sandbox` then F4 (the mirror of this worktree).

## How it keeps to the rules

- **The world's numbers stay theirs.** Time / season / weather / wind go through the clock's own new API,
  `env.preview({hour, year, weather, wind} | null)` (sim/env.js): every reading (hour, part, season, year, leafK, autumn,
  sky, windLevel, weather, snowCover, wet) shows the preview, so mood(), leafRamp() and every view follow on their own;
  the truth (the clock, the spell, its generator, the ground's memory) is never touched, and `preview(null)` puts every
  reading back as it was, the change counters too. `save()` writes the truth while a preview is on.
- **The sim stands still** the way the pause menu holds it (the loop hands photo mode the frame's step; living world
  runs the pause menu's ambient views). The camera turns with `cv.setYaw` as in play, which turns the player's
  view-frame state; `pa.hold()` / `pa.release()` (sim/player/adapter.js) put that state back bit for bit after the turn
  back (floating-point turns there and back aren't exact). The camera's free target is its own (render/camera.js
  `freeOn / freeMove / freeReset / freeOff`): the follow's eased target and the cursor's frame (cam) aren't touched,
  and `freeOff` puts the renderer's view back at once (a sim step before the next draw reads the screen for the aim).
- **Proof** (`D:/Game/tmp/xpho/t_exact.mjs`): four scenarios (the yard with a spreading fire, a run's waves, photo mode
  opened mid-roll, the live gunslinger with a pose) each run twice in a deterministic page, straight through and with a
  photo session in the middle (preview another hour, autumn, a storm and a gale, then snow in a still world; turn,
  move, zoom, push the camera at the world's edge, hide the player, a pose, 1x + 2x captures, a PNG; Esc). The sim
  digest (the player's whole state, every prop, arrows, enemies, the run, the clock's truth with its change counters,
  yaw, zoom, the cursor's frame) at full precision is identical every 30 sim frames after the session and at the end,
  and identical to its state before the session the moment photo mode closes. (Keys held when you open photo mode are
  let go, as the pause menu does.)
- **GPU only, nothing per frame on the CPU:** the post pass is render/photofx.js: two separable 17-tap blur passes at
  the art resolution (the radius grows away from the focus band) and one full-size pass (the sharp frame texel for
  texel, the blur bilinear, the grade, the vignette, a dither against banding). The export reads the pixels once, at
  the click.
- **Closed, nothing runs:** photofx makes its targets and materials on first open (three.js draws Math.random for
  every object's id: made at boot they'd shift the seeded captures) and frees them on leaving; gfx.js's hook is null.

## Numbers (3440x1440, RTX 4070, headless Chrome)

- Closed: perf A/B (`tools/perf/ab.mjs --a src-xpho0/ --b src-xpho/`, three runs on a busy machine): B vs A -8.6%,
  +10.8%, -1.8% (an A/A control of the same folder: -5.9%): no measurable change; draws, uniforms, uploads and heap per
  frame identical. What runs per frame while closed is a few `photo.open` / `post !== null` / `free` checks.
- Open: the post pass costs 0.074 ms GPU (p95 0.078) and 0.04 ms CPU; G.render GPU p50 0.99 ms closed, 1.09 ms open.
- The sliders: a still frame ~2.1 ms CPU; dragging the time of day ~3.9 ms per frame (the static sun shadow and the
  light shafts re-render as the sun moves), the season ~2.5 ms, a new weather every frame ~4.3 ms (one 20 ms frame).
  Fine for a photo mode: no debounce needed (a change is applied once a frame at most).

## Files

New: `src/ui/photo.js` (the mode: panel, input, camera driving, world preview, export), `src/render/photofx.js` (the
post pass), this doc.

Touched (small, additive; with photo mode closed each takes its old path):

| file | change |
|---|---|
| `src/render/gfx.js` (shared, CRLF kept) | the POST hook: `setPost(p)`; while set the frame's last passes draw into `p.target` instead of the canvas (`setRenderTarget(post && post.target)` in two places), then `p.run(renderer)`; `p.still` holds `U.time`, the water's clock and the heat ripple's clock. 20 lines of diff |
| `src/sim/env.js` | `env.preview()` + `previewing` (above); `syncClock` reads the preview's hour / year when one is on; `save()` writes the truth |
| `src/sim/player/adapter.js` | `hold()` / `release()`: the player's view-frame state noted and put back exactly |
| `src/render/camera.js` | FREE mode (`freeOn / freeMove / freeReset / freeAt / freeOff`), `snapTarget` takes the target to place; `zoomTo(goal, now)` |
| `src/core/loop.js` | photo mode's step while open; the draw's clock held in a still world (`photo.time`), the features' frame dt 0 then; no reticle; the player left out when hidden; `redraw()` (the export) |
| `src/core/input.js` | keys to photo mode while open (Escape too), F4 opens it; the game's cursor and LMB rest while it's open |
| `src/main.js` | creates it (`E.photo`, `E.loop`), `?photo=1`, `host.playerHidden`, `__r3d.photo` |
| `src/ui/pause.js` (peers have uncommitted edits) | the Game tab's "Photo mode" row; F4 in Controls > Keys |
| `src/core/flags.js` (a peer adds `cliffs`) | `photo` declared |
| `src/features/contact.js`, `src/render/lighting.js` | leave out the player's contact shadow / lantern while `host.playerHidden` |

No change to `src/ui/menu.js`, `src/index.html`, `src/world/*`, grass or wind: the panel reuses the menu's CSS classes
and brings its own small style.

## Known gaps

- Things drawn on the HD overlay canvas (`#hd`) are not in the photo: the HUD on purpose, but also the "soft" gun-smoke
  look (`?smoke=soft`, not the default) and the dev HD bow (J). The default smoke, fire glow and the atmosphere's
  vignette are WebGL and are in.
- A pose (the live hero's emote) keeps playing in a still world (his compose runs on its own clock); emotes with a shot
  fire it (flash and sound) as in the dev demo.
- Opening photo mode lets go of held keys, and a mouse button released while it's open isn't seen by the game (the
  pause menu does the same); the game's cursor stays where it was.
- No pitch: the oblique projection's angles are the art's (the sprites are drawn for them), so the camera moves, turns
  and zooms but doesn't tilt.
- The 1x export and the screen can differ by 1/255 in a handful of pixels next to fires (the soft particles' blending
  from one render to the next); by day they are identical.
