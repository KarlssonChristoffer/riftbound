# Gameplay experiments (2026-10-03)

Four exploratory gameplay features, each built on its own branch and merged together here on `exp/all`, so they can
be played together. Every one is **off by default**: with all four off, the game is the same as main 56ac1a9
(golden 16/16 identical, smoke and simview pass). None of this is on main.

| experiment | branch | flag | what it is | doc |
|---|---|---|---|---|
| Elite affixes | `exp/affixes` | `?affixes=1` | Risk of Rain elites. **Blazing** leaves burning ground and bursts when it dies. **Glacial** hits slow you and it dies in a frost nova. **Overloaded** calls telegraphed lightning on you. **Splitting** splits into Splitlings. **Warded** carries a front shield (flank it). **Vampiric** drains you with a beam. A reusable ground-hazard kit sits in `sim/hazards.js` + `view/hazards.js`. | [affixes.md](affixes.md) |
| Equipment | `exp/equipment` | `?equip=1` or `?equip=dynamite` | One active gadget on **F** (hold to aim, release to throw): fire flask, dynamite, bear trap, scarecrow decoy, smoke bomb, grappling hook. A gadget cache by the spawn ring each stage, and chests sometimes drop one. | [equipment.md](equipment.md) |
| Shrines | `exp/shrines` | `?shrines=1` | 2-3 shrines per stage, used with E. **Chance**: gold for a chance at an item. **Combat**: summons a pack for loot. **Blood**: health for gold. **Mountain**: a harder champion and an extra elite for 2 items. **Exchange**: an item for one of the next tier. A **Wandering Trader** sells one item. | [shrines.md](shrines.md) |
| Stage omens | `exp/omens` | `?omens=1` or `?omen=storm` | A stage may roll an omen that the world's own systems carry out. **Thunderstorm**: telegraphed strikes drawn to iron. **Gale**: shots drift and the wind helps or hinders your run. **Blood Moon**: faster, harder enemies, double gold. **Rift Fog**: enemies hidden past 5 m, close crits. **Eclipse**: light is a weapon. **Golden Hour**: a blessing. | [omens.md](omens.md) |

## Playing them

The mirror `D:/Game/src-xall/` holds this branch. Serve D:/Game (the `game` launch config, `python serve.py 8123`) and open:

- everything in a run: `http://localhost:8123/src-xall/?mode=run&affixes=1&equip=1&shrines=1&omens=1`
- the sandbox: `http://localhost:8123/src-xall/?mode=sandbox&affixes=1&equip=1&shrines=1&omens=1`. The pause menu's
  **Game** tab then has rows to try each affix ("Try: ..."), gadget ("Gadget: ... (next)", a brute pack), shrine
  ("Place: ...") and omen ("Omen: ...").
- each one also has a toggle under **Dev > Features**, remembered in localStorage (per origin, so `/src/` on the same
  port sees it too; main doesn't have these features, so nothing happens there).

Keys: **F** gadget (Shift+F cycles in the sandbox); **.** spawns the next affixed elite in the sandbox (Shift+. a
champion); E uses shrines, caches and pickups.

## How they were merged (exp/all)

The branches only added to the shared files, so the conflicts were "keep both":

- `LOAD_ORDER` keeps each branch's position: `equip` before `lights`, `affixes` before `combat`, `shrines` and `omens`
  at the end.
- Flags and events from all four are kept.
- `lights.js` got the same kind of fire API from three branches. One merged version: `F.ignite(p)` returns whether
  it caught, plus `F.fireNear` (omens) and `F.flame` (equipment).
- `combat/core.js` had `root()` twice in its API object (omens and equipment). Equipment's is kept: it returns a bool
  and is otherwise the same.
- One integration fix: the Mountain shrine's HUD icon moves under an omen's icon when both hold.

## Checks on exp/all

- All four off: golden 16/16 identical against ref4, smoke all passed, simview identical (views, 30 / 240 fps).
- All four on: `tmp/exp-all/simview_all.mjs` covers three scenarios (a storm sandbox with affix trials, shrines,
  dynamite and the flask; a Blood Moon run; a Gale keys-only run at 30 / 240 fps). Sim identical with and without
  views and at every frame rate; no console errors or warnings.
- A run capture with everything on: `tmp/exp-all/shots/fight.png`, `icons.png`.
- Each branch also passed its own tests, owncheck and perf measurements (see each doc). Per-frame cost with each one
  busy: shrines ~0.03 ms, omens 0.03-0.07 ms, equipment ~0.18 ms, affixes ~0.21 ms (six affixed elites).

## Decisions for the designer (collected from the four docs)

1. **Balance is untested by hand.** All numbers are first guesses tuned against scripted bots. Likely hot spots:
   - Blood shrine gold (~2.5 chests for 3 uses)
   - Mountain at stage 4
   - a Vampiric champion at stage 1 (every elite rolls an affix from stage 1 wave 3)
   - Arrow Rain + the storm's lure
2. **Friendly fire:** gadgets don't hurt you (dynamite only knocks you back). Should they?
3. **The desert gunmen** ignore the scarecrow and smoke, and have no affixes: their AI is separate (`features/foes/sim.js`).
4. **Sound:** affixes and omens have none of their own yet (events are in place for audio); equipment borrows recipes.
5. **Readability:** affixed enemies aren't tinted (needs a per-card colour in the renderer); the marks over their
   heads carry the identity. Rift Fog still shows nameplates and HP bars of hidden enemies.
6. **Combinations to explore:**
   - shrine-sold gadgets
   - a cursed chest that spawns affixed elites
   - omens as a risk/reward pick at the portal
   - two affixes at late stages
   - reusing the hazard kit for the omens' strikes and boss slams
