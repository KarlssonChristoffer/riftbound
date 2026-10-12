# THE AIR: mist, fog, smoke and dust that react (2026-10-07)

The user: "make the mist / fog / smoke effects react to the environment: gunshots, explosions, quick stuff ... with good
physics". The mist is a volume now (render/mistvol.js, features/mist.js: [the mist as a volume](../../src/render/mistvol.js));
smoke and dust are particles (features/gunfx/smoke.js through render/puffs.js, features/atmos.js, features/lights.js,
features/equip's smoke bomb, features/foes' gun smoke). This adds ONE shared moving-air field that everything that blows
air pushes into, and that the mist and every smoke / dust particle read. VIEW ONLY: nothing here changes the sim (the
sim never reads the air; simview must stay identical). `?air=0` turns it off (an A/B).

## The contract (everyone builds against this; change it only through the lead)

### 1. The field: `src/render/air.js` (agent A), exposed as `G.air`

A 2D stable-fluids simulation on the ground plane (top-down), world-anchored, round the view:

- grid `N x N` cells (start: N = 128, cell 0.35 m: ~45 m a side), centred on the view's target (`G.view.T.x`, `.z`),
  re-centred in WHOLE cells when the view moves (the state shifted with it: nothing slides);
- state texture RGBA half float, linear filtered, edges clamped (outside: zero):
  `R` = vx (m/s, world x east), `G` = vz (m/s, world z = arena y, south), `B` = CLEAR (0..1: how much of the mist is
  blown away here; refills over seconds), `A` = SMOKE (0..1: dust / smoke put into the air here, which the mist draws as
  density; decays);
- each frame (view dt, after the features' views, before the composite: gfx.js render): the queued splats, advection
  (semi-Lagrangian or MacCormack), vorticity confinement (curls stay alive: swirls), a pressure projection (incompressible:
  a blast pushes, the air round it flows back in), damping, CLEAR refilling and SMOKE decaying, and OBSTACLES: cells where
  something solid stands (walls, rocks, the tower, trunks: the composite's top-down height map `tH` / `uHPV`, or the
  shadow maps) hold no velocity, so air and mist don't pass through walls;
- `G.air = {on, tex, rect, splat(s), velAt(x, z, out), step(dt), TUNE}`:
  - `tex`: the current state texture (THREE texture; the consumer binds it each frame: it ping-pongs);
  - `rect`: `THREE.Vector4(x0, z0, 1 / size, 1 / size)`: a world point's uv = `(X.xz - rect.xy) * rect.zw` (live object);
  - `splat(s)`: queue one this frame; `s = {x, z, r, vx, vz, radial, swirl, clear, smoke}`: centre (world m), radius (m,
    a gaussian), a push (m/s added at the centre: vx, vz), a radial push (m/s outward at r / 2; negative: inflow), a swirl
    (m/s round it, + counter-clockwise seen from above), CLEAR to add (0..1), SMOKE to add (0..1). Copied at once (the
    caller may reuse its object). At most 64 a frame (more are merged or dropped, never an error);
  - `velAt(x, z, out)`: the air's velocity there (m/s, `out[0]` x, `out[1]` z) for CPU particles: NO GPU readback; an
    analytic estimate from the recent splats (each decaying as the sim damps it), good enough to push smoke the right way;
  - with `?air=0` (or no WebGL2 float targets) `G.air` exists with `on: false`, `splat` a no-op, `velAt` zeros.

### 2. The sources: `src/features/airfx.js` (agent B), a VIEW feature

Reads the events (core/events.js) and the movers, and splats:

| what | the air |
|---|---|
| `player.shoot`, `foe.shoot` (muzzle x, y, h, way vx, vy, gun) | a jet out of the muzzle along the way (a few splats 0..3 m, ~10-15 m/s, falling off), a thin CLEAR channel along the shot's first metres, SMOKE at the muzzle; the coach gun and the Navy stronger, a fan of shots a fan of jets |
| `bullet.impact`, `bullet.ricochet`, `arrow.hit` | a small radial puff where it struck (dust: SMOKE on stone / ground) |
| `combat.explode` (x, y, r), `hazard.burst` (style blast / fire / frost / strike) | a blast: strong radial push (~20 m/s), a CLEAR bubble ~1.3 r, a SMOKE / dust ring; the air rushing back after (the projection does that) |
| the player moving | a wake at his feet each frame: his velocity x a share, CLEAR by speed (walking barely, sprinting through mist parts it), a roll / dodge a stronger sweep, a leap a push, a landing a radial puff (`player.land`, big: stronger) |
| arrows / bullets in flight (`host.arrows`) | a thin wake along each (cheap) |
| enemies, gunmen, animals moving (`host.entities` near the view, at most ~12) | small wakes like the player's |
| `prop.break`, splashes (`*.splash`), fire (lights.js fires: steady updraft = a gentle inflow + SMOKE source) | puffs / dust / a steady source |

A tuning table at its top (per source), `?air=0` off. Owns nothing in the sim; listens only.

### 3. The particles react (agent C)

Every smoke / dust particle takes the air's velocity: each frame `v += (air - v) x k x dt` (k by how light it is: smoke
fast, dust slower, embers slow), from `G.air.velAt` (CPU). Systems: `features/gunfx/smoke.js` (gun smoke), the gunmen's
smoke (features/foes), `features/atmos.js` (dust, splashes, frost puffs), `features/lights.js` (campfire, braziers,
chimney smoke), the smoke bomb (features/equip), `render/flames.js` if it has smoke. A blast blows smoke away and the
air rushing back pulls it in; walking through a smoke cloud parts it. No allocation per frame.

### 4. The mist reads it (the lead: render/mistvol.js, features/mist.js)

Density x (1 - CLEAR) near the ground (a blast leaves a hole that refills, a shot cuts a channel, a run leaves a wake),
the noise displaced by the velocity (it swirls and flows), SMOKE drawn as density (a blast's dust hangs and drifts).

## Rules (CLAUDE.md applies)

- View only; the sim never reads the air. No per-frame allocation, no per-frame CPU pixel work, no GPU readback.
- Headless only (tools/lib/chrome.mjs `launch()`; never a visible window). Ports: agent A 8261-8263 / 9461-9463, agent B
  8264-8266 / 9464-9466, agent C 8267-8269 / 9467-9469.
- Shared tree, other sessions edit it too: keep to your files; a hook in a shared file is small, additive, and named in
  your report. Some files are CRLF (gfx.js, player.js...): edit them with Python `open(p, newline='')` and write back the
  same endings, or the whole file flips. Check endings with Python, not `grep -c $'\r'`. Heredocs in the Bash tool mangle
  backslashes: write scripts with the Write tool.
- Do not commit. Report: files, hooks in shared files, how to see it (URL switches / keys), measurements (ms), open items.

## As built (2026-10-07)

- **The field** (`src/render/air.js`, agent A): 128 x 128 cells of 0.35 m round `view.T`, re-centred in whole cells;
  RK2 + MacCormack advection, vorticity confinement, a slightly compressible pressure (c = 10 m/s: a blast blows a ring
  out and the air rushes back; c = Infinity is the classic projection), damping, CLEAR refilling (half in ~1.2 s), SMOKE
  decaying (1/e in ~3.3 s), splats sheltered by walls, solid cells from the height map's static tops. Steps at a fixed
  60 Hz on the VIEWS' time (`G.air.step(dt)`, fed by airfx's view: hitstop, pause and a still photo hold it, slow motion
  slows it). Splats RAISE the air toward their speed (never past it; CLEAR / SMOKE a max), so a steady source gives a
  target. Strong radial splats (radial >= 4 and radial x r >= 8) are BLOWS (out 0.2 s, then the air drawn back ~1.2 s);
  `body: radius` splats are moving bodies (vx, vz their full velocity: the air in them goes along, round them it parts).
  `velAt`: a 64 x 64 CPU grid + the blows' fitted shape + puffs + bodies (no GPU readback, ~0.3 us). `?air=debug` draws it.
  GPU ~0.04 ms a step idle, 0.10 ms with 64 splats; CPU ~0.04-0.06 ms a step.
- **The sources** (`src/features/airfx.js`, agent B; LOAD_ORDER + 'airfx'): see its header and TUNE. Wakes are bodies
  (player 0.4 m, movers 0.45 m). ~1-4 splats a frame in play, ~50 in the worst burst; ~0.03-0.06 ms.
- **The particles** (agent C): `src/view/airdrift.js` (the shared coupling, `AIRK`), and gunfx/smoke.js, atmos.js,
  lights.js, equip/look.js, combat/core.js, view/hazards.js, dust.js each give their particles an air velocity `w`
  (`w += (velAt - w)(1 - e^-k dt)`, full below 2.5 m over the ground, none from 7 m). +0.03-0.06 ms a frame.
- **The mist** (lead): CLEAR thins it low down (to `airReach` m), the noise is carried `airCarry` s along the air's
  velocity, SMOKE is drawn as dust (darker, warmer than the mist, `airSmoke`).
  At night (2026-10-08, the user: the reactions were invisible, dark blue mist on dark grass) the mist catches light
  (features/mist.js `TUNE.vol.night`): a moonlit sheen and the moon's colour on its tops, so it is lighter than the ground and
  a blast's hole or a runner's wake shows; lanterns, muzzle flashes and blasts glow in it (flat rings, hue kept).

Open: tree trunks aren't obstacles (they share a mesh with the moving crowns); animals outside the entity registry push
air only through their events; the gunmen's bullets in flight leave no trail; props burning inside lights.js aren't fire
sources; the campfire's flames don't bend (its smoke does).
