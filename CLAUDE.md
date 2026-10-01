# Riftbound: working rules for every session

The game is the HD-2D page in `src/` (open `http://localhost:<port>/src/`; pixel sprites in a real 3D world, free
camera). Its architecture, standards and migration plan are in **`docs/ARCHITECTURE.md`**; read it before changing the
frame, the host or a feature (2.3 has the folder layout as built). The measured inventory behind it is
`docs/ARCH_AUDIT_2026-10-01.md`. `src/main.js` is only the boot: put new engine code in its layer folder, not there.

Rules that apply to every change now:

- **Measure.** Anything that runs every frame gets checked with `node tools/perf/bench.mjs` (headless Chrome on the
  GPU, compared with `tools/perf/baseline.json`) before it's committed; put the before/after in the commit message.
  In the game, F3 (or `?perf=1`) shows ms per system against the budget. Budgets: `src/core/perf.js`.
  Run the bench on a quiet machine; it warns when other work is competing for the CPU.
- **Behaviour checks.** A change that should not change what you see (a refactor, a move) passes
  `node tools/test/golden.mjs --compare tmp/golden/ref2` (bit-exact captures of a scripted tour); any engine change
  passes `node tools/test/smoke.mjs` (keys, menu, loadouts, resize, a run).
- **No per-frame allocation, no per-frame CPU pixel work** (`getImageData`, software rasterising, repainting a canvas
  and re-uploading it), **no scans over all props**. Update on change, cache by version, preallocate.
- **One owner per piece of state.** Don't write fields on another module's objects, don't overwrite another module's
  constants (use or add its API), don't add free-form flags to props. If you must touch another area's file, keep the
  change small, additive and named in the commit.
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
