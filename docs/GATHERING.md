# Gathering, the bag and skills: the plan

Started 2026-10-09. The Proving Grounds becomes a world you live in: you cut wood, mine, gather, and what you get stays.
This file is the plan and its decisions; each step lands as its own commit.

## The decisions (the user's, 2026-10-09)

- **A persistent world.** What you gather, the skills you raise and the things you build are kept for good (a save of
  its own, not the run records). Runs come later as trips out of it; run perks and run gold stay run-only.
- **Skills by doing, gear gates.** A skill levels as you use it (woodcutting by chopping) and gives modest bonuses
  (notes in `host.mods`). What opens harder things (an old oak, iron ore) is a better tool, not a level.
- **A material pouch and a small bag.** Raw materials (logs, stone, ore, fibre) go into the pouch, which has no limit.
  Tools, gear and food take the bag's few slots.
- **First: woodcutting end to end.** An axe, oaks that fall, logs, the pouch, Woodcutting XP, and a campfire built from
  logs. Every link is made once, small; mining then reuses all of it.

## The spine (what everything else hangs on)

| piece | where | what it is |
|---|---|---|
| the things | `content/items.js` | one table of everything you can carry: id, name, kind (`material` / `tool` / `food` / `gear`), stack size, glyph, colour, and for a tool its job and tier |
| containers | `game/inventory.js` | the pouch (id -> count, no limit) and the bag (N slots of {id, n}); `add` routes by kind and returns what didn't fit, plus `take`, `count`, `has`; one owner, `inv.change` events, a version for the UI's caches |
| skills | `content/skills.js`, `game/skills.js` | one XP curve, a level from XP, and each skill's level as notes in `host.mods` (`woodcut.power`, ...) read by the system that owns the number; `skill.xp` and `skill.level` events |
| the save | `game/save.js` | a second key, `riftbound3d.world.v1`: the pouch, the bag, the skills, the felled trees (with when they grow back, in `env.t`) and what was built; written on change (debounced) and on `pagehide` |

The run's perks keep their file (`game/items.js`); "item" in new code means a thing you carry. A later small commit can
rename the perks (`game/perks.js`) so the word means one thing.

## The woodcutting slice

1. **The spine** (no visuals): the item table, the pouch and the bag, skills, the world save, the events. A Tab panel
   (bag, pouch, skills), a toast for pickups and level-ups.
2. **The axe in hand.** Key 3 takes out the bag's tool (1 the gun, 2 the fists). LMB swings it: `sim/player/tool.js`
   (state `chop`, the blow at its hit time: `player.chop`), `features/woodcut.js` (what the blow meets). The axe is a
   runtime mesh on the right hand (`rig.attach`, like the duster). Until its own clip exists the swing borrows a
   stand-in clip, time-warped so its contact frame lands on the sim's blow (the fists' way).
3. **Chop and fell.** Each oak has a chop count by size (an old oak needs a better axe). A hit: chips, the crown shakes,
   leaves come down, XP. The last hit fells it: the tree's own model tips about the cut, slowly first, then faster,
   lands, bounces, sheds a burst of leaves and dust. Then it breaks into logs on the ground, which the pouch picks up as
   you walk over them, and a stump is left. The stump grows back into the tree after some in-game days, when you're not
   watching.
4. **A campfire from logs.** From the panel (5 logs): placed in front of you; it burns logs (E adds one from the pouch),
   gives light and warmth, and goes out to embers.
5. **The art gate** (the user's look): the axe's model, a proper two-handed chop clip for both cowboys
   (`western.py`), the sounds (forge recipes: the chop, the creak, the fall's thud).

Then: mining (a pickaxe, rock and veins in the mesa, gold panning in the brook), the panel as a real inventory,
crafting at a bench.

## As built (2026-10-09): steps 1-4

| file | what |
|---|---|
| `content/items.js` | the item table (`log`, `axe`), the 12 x 12 pixel icons (fills only: the panel adds the outline), `START_KIT` (an axe) |
| `content/skills.js` | `CURVE` (40 x (L - 1)^1.9, max 50), `SKILLS.woodcutting` (+3 % chop power, +1 % extra-log chance a level), `XP` per action |
| `content/woodcut.js` | the swing's times and reach, the trees by species (blows, tier, logs, XP), regrowth, logs, the stump |
| `game/inventory.js`, `game/skills.js` | the pouch + bag; XP, levels, the `skills` notes in `host.mods` |
| `game/save.js` | `loadWorld` / `saveWorld` / `clearWorld`: the key `riftbound3d.world.v1` |
| `features/pack.js`, `ui/packpanel.js` | the player's pack, skills and save; `store(name)` for a system's saved part; recipes; the Tab panel (DOM) |
| `sim/player/tool.js` | the tool in hand: state `chop` (busy), `player.chop` at the blow; the feature aims it as it starts (`aimBy`) |
| `features/woodcut.js` | key 3, the blow (a bite, a glance, a foe or dummy in the way), felling, stumps, logs, regrowth, the falls (view) |
| `view/heldtool.js` | the axe as a runtime mesh on the right hand (`rig.attach`): a carry hold, a swing hold |
| `features/campfires.js` | Build > Campfire (4 logs), E adds a log, embers, saved; flames through lights.js `F.flame` (placed and saved through `features/builds.js` since the cook-and-build slice: `docs/BUILDING.md`) |

Hooks in other areas' files, all small and additive: `player.js` / `adapter.js` (the tool module, like brawl's),
`livehero.js` (the held tool, `toolMotion`, `toolHide`), `wind.js` (`flexOf` skips hidden props, `tree.chop` shakes a
crown, `leafBurst`), `world.js` (`mesh` takes `sway` + `autumn`), `audio.js` (stand-in sounds for the new events),
`events.js`, `flags.js` (`pack`, `woodcut`, `campfires`, `fresh`), `features.js` (load order: woodcut before fists,
campfires before lights, so nothing else moves in the sorted order), `pause.js` / `keyhelp.js` (the keys).

**Controls** (a live cowboy in the sandbox, ruins biome): LMB on a tree, or E held facing one, chops it (hold: keeps
chopping), Tab opens the pack, E by your campfire adds a log.

**No equip key** (2026-10-09, the user: tools "should be needed in inventory", "approach tree and start holding/clicking
the tree"):
- An axe in the bag is the requirement. Without one, the prompt over a tree says "needs an axe", and LMB falls through to
  the gun.
- LMB on a trunk chops it: the cursor on the trunk, within the lock's 3.5 m. A foe under the cursor or a drawn gun keeps
  LMB the gun's.
- Holding E facing a tree chops it too; a chest, a sign or a campfire keeps E theirs.
- The axe comes out with the press (the gun holstered) and goes back `TUNE.swing.stow` (.9 s) after the last swing. LMB
  elsewhere while it's idle puts it away at once.

**Chopping on the move** (2026-10-09, after the user's first try: "he moves forward when swinging"):
- There is no lunge any more.
- While a swing plays, WASD steps him any way at the footwork speeds (`TUNE.swing.move`), and he keeps facing what he
  swings at.
- The trunk is picked on the cursor's line the way the gun aims (player.js `cursorGround`): the trunk under the cursor,
  else the tree right in front of him, else the cursor's way.
- It stays locked while LMB is held, until it falls or he is 3.5 m off. A held LMB chains the swings with no idle step
  between.
- **Assist** (after "it can get hard to actually hit the tree"):
  - A locked trunk is circled at the sweet spot (its radius + `keep` .5 m): the keys' sideways part goes round it and
    the distance springs back, so W and S don't take him out of reach.
  - A trunk clicked out of reach (up to the lock's 3.5 m) he walks in to first, with the axe at the ready, and the swing
    starts there.
  - The blow lands on the locked trunk anywhere within reach + `assist` (.45 m) of the bark.
  - The LMB prompt shows over the tree a press would go for.
- On the move the swing is his upper body over stepping legs (livehero's `upper` layer): the fists' footwork clips
  (`fs_step_*`) on the gunslinger, the walk on a model without them. `?fresh=1` starts a new world; the
Sandbox menu has "New world".

**Checked:** golden identical against a frozen copy without this work, smoke, simview, `?owncheck=1` clean, the
feature order unchanged, our allocation ~0 KB a frame. Probes: `tmp/gather/probe.mjs` with `s_pack`, `s_chop`,
`s_persist`, `s_camp`, `s_axe` (HTTP 8241, debug 9441).

## The art pass (step 5, 2026-10-09)

- **The chop clip** `tl_chop` (`tools/blender/western.py`, the tools section at the end; both live models, exported with
  `live_export.mjs ... --add tl_chop`, the outlaw with `CLOTH_BAKED=1` so it stays byte-identical to its installed build).
  Ready, wind-up over the left shoulder, the downswing, the bite (mark `hit`), the wrench out, ready. Every frame is a key,
  so no in-between can slide the hands off the haft. The keys put the right fist on a point, turn the hand so the game's
  haft (heldtool's swing hold, `TL_CANT` 42) runs the way the key says, and close the left fist on the haft 30 cm up.
  `tmp/gather/sheet_axe.py` draws a contact sheet of the clip from the exported model with the axe over it, and reports
  how far the left fist is off the haft (0 cm in every frame).
- **The axe** (`view/heldtool.js`): a paler ash haft and a bigger head. The carry hold hangs from the fist by the throat,
  down in his frame and leaning a little forward, whatever the wrist does. It is placed again only when the hand turns
  more than about 2 degrees. The swing hold is fixed in the hand. Placing either is a basis change written straight into
  the attached buffers, with no allocation.
- **A falling tree keeps its colours** (`render/gfx.js`): a swaying mesh can pin the frame its leaf clusters take their
  autumn stage from (`mesh.setSprayFrame`: the clusters' places and their sun-facing). The felled copy pins the frame it
  stood in, so its crown no longer changes colour as it turns. Every other mesh is unchanged.
- The stand-in swing (`gun_whip` / `ls_snare` with the revolver and coil hidden) stays in `livehero.js` as the fallback for
  a model without `tl_chop`.
- **Sounds:** a forge recipe, `audio/forge/recipes/woodcut.js`, with nine cases: chop, chop_deep (the last bites), glance,
  crack (the hinge splitting), crash (the trunk's thud and the crown's leaves and twigs), logs, pickup, swing, campfire.
  - Each case passes its criteria on 66 seeds.
  - The runtime events (`audio/runtime/events.js`, WOODCUTTING section) are chop, treeCrack, treeCrash, treeLogs,
    logPick, axeSwing and campLog. Each has an `alt` that plays the old stand-in while the bank bakes.
  - `src/audio/audio.js` maps the game's events to them and keeps fallbacks (`?forge=0`).
  - A log on any campfire (`fire.addWood`, the hand-made camp's too) now has a sound.
  - The reel and single cases are in `tmp/woodsfx/wav/`.
  - Tuned by metrics and spectrograms only, so the user's ear is still to come.

**Gaps (later):**
- Logs lying on the ground aren't saved. Leaving the world puts them in the pouch, but a reload loses them.
- The nav grid isn't rebuilt when a tree falls or grows back. The leaf carpet stays under a felled tree.
- A tree comes back all at once when you're 14 m away; there's no sapling stage.
- The old oak (scale 1.5 and up) needs a tier-2 axe, which doesn't exist yet.
- The campfire is simpler than the hand-made camp in lights.js: no logs falling in, and it can't light arrows.

## Rules this keeps

- **Sim vs view.** Chop counts, felling, regrowth, the pouch and XP are sim (seeded rng). The fall, the chips and the
  leaves are view.
- **One owner per thing.** `woodcut` owns its trees' chop state in its own maps. The tree props are only hidden and
  shown through the registry. Stumps and logs are the feature's own props.
- **No per-frame scans.** Trees come from a live query; the swing makes one `near()` call.
- **Off switch:** `?woodcut=0`.
