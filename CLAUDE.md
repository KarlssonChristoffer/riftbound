# Riftbound: working rules for every session

The game is the HD-2D page in `src/` (open `http://localhost:<port>/src/`; pixel sprites in a real 3D world, free
camera). Its architecture, standards and migration plan are in **`docs/ARCHITECTURE.md`**; read it before changing the
frame, the host or a feature (2.3 has the folder layout as built). The measured inventory behind it is
`docs/ARCH_AUDIT_2026-10-01.md`. `src/main.js` is only the boot: put new engine code in its layer folder, not there.

Rules that apply to every change now:

- **Measure.** Anything that runs every frame gets checked with `node tools/perf/bench.mjs` (headless Chrome on the
  GPU, compared with `tools/perf/baseline.json`) before it's committed; put the before/after in the commit message.
  In the game, F3 (or `?perf=1`) shows ms per system against the budget. Budgets: `src/core/perf.js`.
  Run the bench on a quiet machine; it warns when other work is competing for the CPU. On a busy machine compare with
  `node tools/perf/ab.mjs --a git:HEAD` (both versions stepped in one Chrome, alternating: load hits both alike).
  `node tools/perf/vsync.mjs` counts missed frames at the display's refresh rate, but it opens a real full-screen window
  on the user's monitor: run it ONLY when the user asks for it at that moment.
- **Behaviour checks.** A change that should not change what you see (a refactor, a move) passes
  `node tools/test/golden.mjs --compare tmp/golden/ref4` (bit-exact captures of a scripted tour); any engine change
  passes `node tools/test/smoke.mjs` (keys, menu, loadouts, resize, a run); anything touching a feature's update / view
  or randomness passes `node tools/test/simview.mjs` (the sim comes out the same without its views).
- **Sim vs view.** `F.update` is the truth (always runs; its random draws come from the feature's own seeded generator,
  `core/rng.js`); `F.view` is presentation (after every update, may use Math.random, writes only its own state).
  The sim runs in fixed 1/60 s steps (`core/loop.js`); never assume one update per frame or a frame-sized dt.
- **Game effects are modifiers** (`host.mods`, `core/modifiers.js`): an item / augment / run rule sets notes on a stat;
  the stat's owner applies them. Never write another system's number and restore it later.
- **No per-frame allocation, no per-frame CPU pixel work** (`getImageData`, software rasterising, repainting a canvas
  and re-uploading it), **no scans over all props**. Update on change, cache by version, preallocate.
- **One owner per piece of state.** Don't write fields on another module's objects, don't overwrite another module's
  constants (use or add its API), don't add free-form flags to props. If you must touch another area's file, keep the
  change small, additive and named in the commit. Entity fields: the table is `OWNERS` in `src/dev/owncheck.js`; after
  touching them, run a session with `?owncheck=1` and `window.__r3d.owncheck()` (it lists every foreign write).
- **The world's things go through the registry** (`host.entities`): `add` / `remove` / `hide` (never push into or
  splice `host.props`, never set `gone`), live `query(name, pred)` for "all the X", `near(x, y, r, out)` for "what's
  here" (no scans over all props). New event types go in `src/core/events.js` first; a feature states its update
  order with `export const order = {after, before}`.
- **Look before you write a helper**: colour parsing, hashing, rng, clamp, world <-> view conversion and on-screen tests
  already exist (`core/mathx.js`, `core/rng.js`, `core/color.js`, `render/viewxf.js`, `G.onScreen`).
- **URL switches are declared in `core/flags.js`** (`flags.get('name')` warns on an undeclared one).
- **Dev-only things stay dev-only**: debug keys, A/B toggles, capture hooks live in `dev/`; only the boot imports it.
- **Commit small, one feature per commit**, only when the user asks. LF line endings for new files; keep an existing
  file's endings (some old ones are CRLF; Git Bash `sed -i` turns CRLF into LF, so edit those with Python:
  `open(p, 'w', newline='')`).
- The game owns its copies of the arena's files (`src/sim/player/player.js`, `src/view/cloth.js`, `src/world/biomes.js`,
  ...). The 2D arena (`concepts/`) and the first 2D game (`concepts/legacy-game/`) are frozen references.
- Syntax-check ES modules as `.mjs` copies (`node --check` on a `.js` file missed a duplicate `const` here).
- Shadow casters that never move go on sScene layers 1 + 2 (cached static map); moving ones stay on layer 0.
- **Never open a visible browser window** for tests, captures, probes or measurements (no `--window`, `--kiosk` or
  windowed runs, no foreground tabs): the user works on that machine and a window that pops up full screen takes over
  their monitor. Everything automated runs headless, in the background. A visible window only when the user asks for
  one at that moment (e.g. to watch a demo).
- **Headless Chrome** (a tool or a scratch script): start it with `launch(tag, args)` from `tools/lib/chrome.mjs` (from a
  scratchpad: `import {launch} from 'file:///D:/Game/tools/lib/chrome.mjs'`) and call its `kill()` on exit. Its profile
  goes in `%TEMP%\riftbound-chrome\` with flags that keep it ~12 MB, and every launch sweeps the dead ones. Never pass
  your own `--user-data-dir` in %TEMP%: a killed run leaves ~57 MB behind (C: lost 17 GB in half a day that way).
