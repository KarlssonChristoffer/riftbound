# Backlog

Work decided on but not started. Newest first. Each item says what it is, why, and what it touches.

## Playtest the aim modes (added 2026-10-12)

**Play the four aim-help modes and decide what they become.** The prototype is in (`features/aim.js`, `docs/AIM.md`): manual
(as before), soft (sticky near foes), lock (a held target), auto (he shoots the nearest foe by himself). Christoffer's
direction: the game shouldn't feel competitive; aim help could be a player setting AND part of builds (items that make it
stickier, take it away for more damage, an auto-firing gun), with full manual control always an option.

To try: Esc > Controls > Aim help, or `?aim=soft | lock | auto`, against the yard's dummies and sparring brutes or spawned brutes
and gunmen (F2). Decide after playing:
- the default for new players (soft?), and whether soft should also bend bullets a little;
- which modes or strengths become item / build properties (this feeds the item categories and rarities, started fresh from
  how the shooting feels: the gun, what you wear, trinkets);
- the bow (auto doesn't fire it yet), and how lock picks / switches targets with a crowd.

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
