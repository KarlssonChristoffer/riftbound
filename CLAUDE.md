# Riftbound: working rules for every session

The game is the HD-2D page in `src/` (open `http://localhost:<port>/src/`) (pixel sprites in a real 3D world, free camera). Its architecture,
standards and migration plan are in **`docs/ARCHITECTURE.md`**; read it before changing the frame, the host or a
feature. The measured inventory behind it is `docs/ARCH_AUDIT_2026-10-01.md`.

Rules that apply to every change now:

- **Measure.** Anything that runs every frame gets checked with `node tools/perf/bench.mjs` (headless Chrome on the
  GPU, compared with `tools/perf/baseline.json`) before it's committed; put the before/after in the commit message.
  In the game, F3 (or `?perf=1`) shows ms per system against the budget. Budgets: `src/core/perf.js`.
  Run the bench on a quiet machine; it warns when other work is competing for the CPU.
- **No per-frame allocation, no per-frame CPU pixel work** (`getImageData`, software rasterising, repainting a canvas
  and re-uploading it), **no scans over all props**. Update on change, cache by version, preallocate.
- **One owner per piece of state.** Don't write fields on another module's objects, don't overwrite another module's
  constants (use or add its API), don't add free-form flags to props. If you must touch another area's file, keep the
  change small, additive and named in the commit.
- **Look before you write a helper**: colour parsing, hashing, rng, clamp, world <-> view conversion and on-screen tests
  already exist (phase 2 merges them into `core/` and `render/viewxf.js`).
- **Dev-only things stay dev-only**: debug keys, A/B toggles, capture hooks.
- **Commit small, one feature per commit**, only when the user asks. LF line endings (Python on Windows:
  `open(p, 'w', newline='')`).
- Files the game still shares with the 2D arena (`player.js`, `cloth.js`, `biomes.js`, `layout.js`, `audio.js`, ...;
  audit B.8) must keep working on both pages: additive, arena-safe changes only, until migration phase 2 gives the
  game its own copies.
- Syntax-check ES modules as `.mjs` copies (`node --check` on a `.js` file missed a duplicate `const` here).
- Shadow casters that never move go on sScene layers 1 + 2 (cached static map); moving ones stay on layer 0.
