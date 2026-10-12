# Backlog

Work decided on but not started. Newest first. Each item says what it is, why, and what it touches.

## Ranger v2 (added 2026-10-08)

**The current Ranger (v1) is deprecated and stays deprecated.** It is a sprite atlas, not a live 3D body: the loadouts
`ranger basic` and `ranger + cloth sim` (`view/hero.js` LOADOUTS, `?set=basic | sim`), built from the old Blender scripts
`tools/blender/ranger_v*.py` and `tools/blender/loadouts/ranger_basic.py` / `ranger_sim.py`. Nothing new goes into it: no new
clips, no live-only moves (brawl, the lasso's traversal, live reactions), no fixes beyond keeping it loading.

**Ranger v2** is a new build on the live pipeline, like the gunslinger and the outlaw: the standard skeleton
(`tools/blender/skeleton.py`), garments through `wardrobe.py`, exported with `tools/blender/live_export.mjs`, drawn by the live
hero (`view/livehero.js`). Being live, he gets every move a live body has (V the boot, the barge, E lift and throw) without
work of its own in `features/brawl.js`.

Ideally he is the first character built on a **shared motion library** (the plan: `docs/MOTION.md`): clips authored once on the standard skeleton and played on
any body. Each character then keeps only its body, its garments, a small proportions correction for hand targets, and what its
hands hold (bow, revolver: per-item clip sets). Today each live model bakes its own copy of every clip at export, so a new clip
means re-exporting every character.

When v2 lands:
- the default loadout: `main.js` starts on index 1 (`ranger + cloth sim`), so the game opens on the deprecated Ranger today;
- `tools/test/smoke.mjs` presses O twice from `ranger_sim` to reach the gunslinger: it moves with any change to LOADOUTS;
- retire v1's loadouts and atlases, or keep them only as a frozen reference.
