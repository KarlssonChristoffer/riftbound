# Collision: why you get stuck, and the plan to fix it

Status (2026-10-10): phases 0-1 committed (e9f4102); phases 2-3 committed (d801dd1 the module, 7cadabd move and slide with the
field walls' smooth rows from phase 5); phase 4 committed (the column test, the airborne push-out, free placements); phase 5
in progress. The rest is planned. Decisions taken: the recommendations in section 5
(pots nudged aside, broken by a roll or a sprint; brutes push softly; standing on things later). The architecture already
planned the module (ARCHITECTURE.md 2.3: `world/collide.js (blocked, raycast, arrow tests)`, principle 7: "can I walk here"
answered by one service); it was never built.

Measured by `node tools/test/collide.mjs` (sandbox, set=gunslinger):

| | before | after phase 1 | after phase 3 |
|---|---|---|---|
| census: a spot just inside a collider, stuck after 40 steps + 30 steps of trying | 97 / 97 | 0 / 97 (out in .24 m on average, 1.2 m at most) | 0 / 97 |
| drops (tower ladder .5 / 1 / 2 m, the lookout's breach, beside field walls) + thrown into a wall | 5 / 8 | 0 / 8 | 0 / 8 |
| running at a pot / brazier / dummy / pillar / tree, head on and .2 m off centre: stopped | - | 10 / 10 (24-34% of a free run) | 0 / 10 (76-94%) |
| sliding along the arena wall and a field wall at 22.5-67.5 deg, % of a perfect slide (cos angle) | 9% | 9% | 105% |
| sliding along the ground's edges (water, higher ground, the border) at 45 deg: stuck / speed kept | - | 16 / 24, 18% | 0 / 24, 90% |
| leaning on a loose crate pushes it / sprinting into a barrel tips it | - | 2.03 m / tipped | 2.03 m / tipped |

(The "run at" set changed with phase 3: the gateposts it first took all stand in a wall's end, where stopping is right; pillars
came in. Both columns after "before" are the new set, from frozen copies on one base.)

Checks for phases 2 and 3 (frozen copies of phase 1, 2 and 3 on one base):
- golden: 16 / 16 captures identical, both phases;
- simview: passes, both;
- smoke: passes, all three;
- ab.mjs: `player.step` 0.005 -> 0.006 ms a frame.

## 1. How it works today

The player moves with `moveBy` (sim/player/player.js:278): it tries the x part of the step, then the y part, and asks
`H.blocked(x, y, z, air)` for each. `blocked` (sim/player/adapter.js:39) gives back yes or no:

- off the walkable map, in the stream (unless airborne), ground more than .3 m above the feet, or a steep cell rising at all;
- any prop within `p.r + .25` (circle) or its `rect` grown by .25, **if its base is within 1 m of the feet** (`|p.z - z| < 1`),
  except a stone wall's rubble low enough to step over.

The step is zeroed on any axis that says yes. Nothing else.

## 2. Why you get stuck (from reading the code)

**A. Once you're inside something, nothing gets you out.** `blocked` tests where you would go, not where you are. If you're
already inside a collider, every spot around you is inside it too, so every step is refused and you stay there for good. Many
things put you inside without going through `blocked`:

- **Falls.** While you fall, props only count once their base is within 1 m of your feet. Higher up you pass over their
  footprint, and by the time they count you're already inside.
- **The screenshot (the watchtower).** The tower's foot ring (world/watchtower.js:51: a circle of r .45 every .5 m, .4 m inside
  the outer face) plus the body's .25 m reaches **.3 m out from the wall**. The ladder holds you .1 m out from the wall
  (ladder.js: `L.face = c.y + .05`), and Space drops you straight out at 1.2 m/s (ladder.js:34). From lower than ~1.3 m
  the ring starts counting before you're .3 m out: you land inside it and can't move. Stepping off the lookout's breach
  at a walk can do the same thing.
- The field walls (circles r .3) and every other round collider do it too, whenever you come down next to one.
- **Moves that set your position directly** and never check it: the vault's path (player.js:536-570), the lasso's swing / zip /
  rope-up (lasso.js:298, 366, 374), the rope wall (ropewall.js:104, 221, 237), the splash put-back, the ladder, teleports and
  spawns.
- **Things that move into you**: a brute walks into your circle, a crate is put down, a barrel stops rolling against you.

**B. The x-then-y split happens in the camera's frame, but walls are in the world.** `moveBy` splits the step along the view's
axes (P.x / P.y are in the view frame). With the free camera at any angle other than a multiple of 90°, a straight wall is
diagonal to those axes. Sliding along it then becomes a staircase that stops dead whenever both halves are refused, which is
why sticking changes with the camera angle.

**C. Yes / no, with no surface direction.** `blocked` never says which way the surface faces, so the mover can't slide along
it or slip round it:

- walking head-on into a pot, a post or a tree stops you dead;
- along a field wall (circles r .3 every .6 m, layout.js:708) you catch in the notch between each pair of circles;
- along an arena wall at an angle you snag at every 1 m segment where the per-axis test flips.

**D. Height is a ±1 m band, not a column.** The prop's real top (`topOfProp` exists, world.js:213) isn't used:

- falling past a .9 m wall counts it while your feet are already above it;
- a 3.9 m tower wall stops counting once your feet are 1 m above its base;
- you can never land on top of anything.

**E. Colliders are bigger than what you see.** A tree walks as r .5 against its .3 m trunk (world.js:358), so you bump into air
~.2 m before the bark. Pots (r .22) block like stone pillars, with no give.

**F. Every system has its own collision test, and they disagree.** One system can call a spot clear and drop you there while
the player's test says it's inside a wall, which leaves you stuck:

| system | where | test | heights from |
|---|---|---|---|
| player | adapter.js:39 `blocked` | ±1 m band | none |
| lasso swing / zip / rope-up | equip/lasso.js:536 `solid` | column | `topOfProp ?? TOP` |
| thrown brutes | combat/core.js:350 `FLYW.solid` | column | `HGT` (its own table) |
| gunmen | foes/sim.js:520 `colSolid`, :110 `standable` | column / ±.9 m | `topOfProp ?? 1.2 / 6` |
| prop physics | combat/props.js:62 `hitAt` | ±.9 m band | `hitH ?? topOfProp ?? 1.2` |
| bells | bells/sim.js | its own `R_BODY .3` | — |

**G. Terrain is read at one point.** `elev` / `steep` are read only at the body's centre. Your body overlaps cliff faces by its
radius, and on a steep cell any move with the slightest rise is refused ("not even in small steps", adapter.js:43). That's
what makes ramp sides and terrace edges sticky.

## 3. The plan

Each phase is one commit. Behaviour changes on purpose, so `?collide=old` keeps today's code for A/B and for the golden
comparison: `?collide=old` must still match ref4 bit for bit, and the new default gets a new reference.

### Phase 0: measure it (a stuck finder) and see it: BUILT (the tool; the overlay's tops not yet)

As built: `tools/test/collide.mjs` (~30 s; ports HTTP 8152, Chrome debug 9356). Its cases are census, drop, launch, pass and
slide; it writes `tmp/collide/last.json`. Not in it yet: the lasso landing and the brute pinning you to a wall.

- `tools/test/collide.mjs` (headless, `tools/lib/chrome.mjs`):
  - **census**: sample the walkable map every 10 cm at ground height, and count and list the spots where the body is inside
    something (all 16 directions refused). These are traps waiting for a fall or a placement to drop you in.
  - **scripted repros**, each reporting "stuck?" and "speed kept along the surface (%)":
    - drop off the tower ladder at 0.5 / 1 / 2 m;
    - walk off the lookout's breach;
    - fall next to a field wall;
    - walk head-on and at 20° into a pot, a post and a tree;
    - slide along an arena wall and a field wall at camera yaws 0 / 22 / 45 / 67°;
    - roll into a corner;
    - get launched into a wall;
    - land a lasso swing beside a wall;
    - have a brute walk into you against a wall.
  - The numbers go in each later commit's message: before / after.
- Extend the Shift+G collider overlay (dev/devtools.js:11) to show each collider's top and the body's circle, so oversized
  colliders can be seen.

### Phase 1: unstick (the quick win, small, in the adapter): BUILT

As built: `unstick(dt)` in sim/player/adapter.js (its `UN` numbers), called by core/loop.js right after `PL.step`. It walks him
out at 4 m/s, and only acts while he's on the ground and not in a move that places him itself (`UN_SKIP`: climb, vault, leap,
fall, slide, splash, rope, thrown, brawl and fist moves). `?collide=old` turns it off.

Checks (frozen copies with and without the unstick):

- golden: 16 / 16 captures identical (the tour never puts him inside anything);
- simview: passes;
- smoke: passes;
- ab.mjs: `player.step` 0.004 -> 0.005 ms a frame. The frame total is within the tool's first-page bias: the settled slices are
  2.40 vs 2.35 ms.

The Shift+G overlay now draws each collider at its own height, base and top, plus his body's circle (yellow; magenta while he's
inside something).

After every player step: if the body is inside something at its feet, find the nearest free spot (rings out from where he
stands, 16 directions, 5 cm steps, up to 1.5 m; preallocated) and ease him there over a few steps. This one rule ends "stuck
forever" whatever put him there. Also keep a **last safe spot** (on the ground, free, not water, refreshed about once a
second) as the final fallback. It uses today's `blocked`, so it can land before the rest.

### Phase 2: one collision module, `world/collide.js`: BUILT (the player's part)

As built:
- `createCollide(entsOf)`: `overlap(who, x, y, z, air)`, `touch(p, x, y, r, who, z)` (CN: the way out, the depth) and `move`
  (phase 3).
- **The body**: `who = {r, counts(p, z), through(p, z), ground(x, y, z, air)}`. These are functions rather than masks, so the
  player's rubble and the ground rule fit. The player's is `PB` in sim/player/adapter.js, and his `blocked()` is `C.overlap(PB, ...)`.
- **Shapes**: circles and boxes, with a box grown round at its corners (it was square). The column test still uses the ±1 m band:
  that's phase 4.
- **Heights**: `HEIGHT` / `heightOf(p)` is the one table, merged from the lasso's, the gadgets', combat's and the gunmen's. Only the
  Shift+G overlay reads it so far; phases 4 and 6 move the rest onto it.
- Not yet: capsules as their own shape, `nearestFree` (still the adapter's `freeSpot`), the other systems (phase 6).

The plan as written:

- **Shapes**: circle, box (the walls' rects; oriented boxes), capsule (a segment with a radius). Each has a vertical span, base
  to top, from **one height table** (merge `PROP_TOP`, combat's `HGT`, the lasso's `TOP` and the scattered `?? 1.2 / 2.5 / 6`
  defaults). The terrain (elev, steep, water) is a solid too.
- **Questions**, all allocation-free, all through `ents.near` (no scans):
  - `overlap(x, y, r, z0, z1, mask)` (yes / no: replaces `blocked`, `solid`, `colSolid`, `hitAt`);
  - `contacts(x, y, r, z0, z1, mask, out)`: each touching shape's normal and depth;
  - `move(state, dx, dy, mask)`: move and slide (phase 3);
  - `nearestFree(x, y, r, z, mask, out)`: phase 1's ring search, moved here.
- **Masks** say who collides with what (player, brute, gunman, thrown body, rolling prop, rope) instead of today's skip lists
  (`p.hunter`, `p.sparring`, `kind === 'gunman'` ...).
- **Determinism**: no Math.random, the same answers in the same order (sim code: simview must pass).

### Phase 3: move and slide for the player: BUILT

As built (world/collide.js MOVE AND SLIDE):
- **Pieces**: the move is cut into pieces of at most 0.1 m. Each piece goes straight, then is pushed out of every overlapping prop
  in turn (up to 4 rounds).
- **Ground edges**: if the ground stops it, the piece slides along the edge. The edge direction comes from 8 ground tests in a
  ring round the spot; the ground is still tested at the body's middle, so you get as close to water and cliffs as before. If
  that fails too, it tries one world axis at a time.
- **Slip**: round any lone round thing up to r .5 (pots, posts, braziers, dummies, pillars, trees; not wall pieces), going round
  its open side.
- **Velocity**: after a hit it turns the way he went, keeping its speed if he got a third of the way or more. Head-on into a wall
  he slows to a stop.
- **Rows** (from phase 5): the round pieces of a field wall, the watchtower's rings, the bridge's parapets and a lying stone are
  joined to their neighbours by the capsule between them, so there are no notches to catch in.
- **Wiring**: the adapter's `moveV` turns view-frame moves into the world frame and back. player.js `moveBy` and launch.js's
  flight use it; the flight now bounces off the wall by its real normal. `?collide=old` brings back the per-axis moves.

The plan as written:

`moveBy` turns the step into the world frame and calls `collide.move`. That fixes B, C and G:

- up to 3 passes of: move, gather the contacts, push out along their normals, and drop only the part of the velocity going into
  the surface, so the part along it carries on;
- long moves (roll, launch) are cut into pieces no longer than half the body's radius, so nothing tunnels through.
- **Slip past small things**: a near head-on hit on a small round obstacle (r ≤ .35: pots, posts, dummies) turns you round it
  toward the side your input leans to. This is the usual ARPG rule: you never stop dead on a vase.
- **Terrain as a surface**: the step-up (STEP_UP) and steep rules are checked at 8 points round the body's rim, and a cliff
  or a ramp's side gives a normal from the ground's slope. You slide along it instead of sticking.
- `moveBy` still returns the distance travelled, so the animation code (gun, fists, lasso, tool, brawl) is unchanged. P.vx /
  P.vy keep the sliding velocity instead of zeroing an axis.

### Phase 4: stop the ways in at the source (so phase 1 is rarely needed): BUILT (committed)

As built:
- **The column test**: his body counts a prop by `C.column(p, feet, feet + 1.6)`, the prop standing from its base to `heightOf`
  (a top within .05 m under his feet doesn't count), not by the ±1 m band.
  - A falling body meets the watchtower's wall all the way down.
  - A leap, a fall or a flight passes over what's under its feet.
- **Airborne push-out**: in the air (a fall, a leap, a flight) `move(..., free)` first pushes him out of whatever he came down
  into. This covers the ladder's drop (it holds him .1 m from the wall, inside the foot ring), the lookout's breach, a lasso swing
  that lets go over something, and low things he falls onto.
- **Placements**: `C.nearestFree` (the unstick's ring search, moved into the module) puts the boot's spawn (and `?at=`) and
  `teleport` on a free spot round where they ask.
- **Left to the unstick**:
  - wedged pockets where the push-out can't escape, e.g. the inside corner of a field wall with a broken pillar beside it;
  - placements that are their own moves: the vault's landing (it checks it's clear), the rope wall and the splash put-back.

Measured, phase 3 -> 4 (frozen copies on one base):
- steps he stood inside something after landing, summed over the 9 drops: 21 -> 10. Every tower drop, the lookout fall and 2 of
  the 3 field-wall falls are now 0; the 10 left are the field wall's pocket by the pillar.
- teleported onto a wall, the tower's ring, a field wall, a pillar or a tree: inside 5 / 5 -> 0 / 5 (put down .57-1.37 m away).
- everything else unchanged (census 0 / 97, run-at 0 / 10, slides 105%, edges 0 / 24, crate and barrel 2 / 2).
- golden 16 / 16 identical; simview and smoke pass; ab.mjs `player.step` 0.005 -> 0.006 ms a frame.

The plan as written:

- **Falls test the column**: your body (feet to head) against each prop's base-to-top. A wall's face stops you as you fall
  past it, and you slide down its face instead of passing into it.
- **Every placement asks the same module**: vault ends, the ladder's foot and drop, lasso landings, the rope wall, the splash
  put-back, teleports and spawns all go through `nearestFree`.
- **The ladder drop** starts from a free spot.

### Phase 5: colliders that match what you see

Done early (phase 3): the field walls', the watchtower rings', the parapets' and the lying stones' rows are smooth: joined pieces,
not new capsule props. Trees keep r .5 for now; the slip takes them head on.

- **Trees**: the trunk (.3) for walking.
- **Field walls**: one capsule per run between gaps instead of a row of circles, giving a smooth face with the doorways and
  breaches kept.
- **Watchtower**: four oriented boxes with the door and the breach left open, instead of the foot ring of circles.
- **Brook parapets and lying stones**: capsules.
- **Pots and other small loose things**: see decision 1 below.
- Check each one with the overlay and the census.

### Phase 6: everyone uses it

- Lasso, thrown brutes, gunmen, prop physics and bells move onto `collide.js` with their masks and the one height table. A
  lasso landing then can't drop you where the player's own test calls it a wall.
- Brutes and gunmen get move and slide too: they snag on the same corners.
- **Bodies push apart softly over a few steps** (player vs brutes) instead of blocking hard, so a brute can't pin you into a
  wall.

### Phase 7 (optional, later): standing on things

Prop tops as floors: crates, wall tops, rubble, stones. You land on them from a fall or a vault instead of being slid off.
`floorAt(x, y, z)` = the highest of the ground and the tops under the body. This touches ground-following, falls, shadows and
the brutes' nav, so it's only worth doing if you want it.

## 4. Checks for every phase

- `node tools/test/collide.mjs`: before / after numbers.
- `smoke.mjs`.
- `simview.mjs`: collision is sim code.
- `golden.mjs --compare`: `?collide=old` against ref4; a new reference for the new default once phase 3 lands.
- `bench.mjs` / `ab.mjs`: collision runs every step, several times. Budget: no worse than today's `blocked` calls, with no
  per-step allocation. Today's adapter wrapper allocates an array per call (`const [X, Z] = toWorld(x, y)`); the new path
  doesn't.

## 5. Decisions for you

1. **Pots, vases and small loose props.**
   - **Recommended**: walking nudges them aside (they slide or wobble out of the way through the prop physics' `shove`), and a
     roll or a sprint breaks or kicks them.
   - Or: they stay solid and you just slip round them (phase 3's rule).
   - Or: you walk straight through them.
2. **Standing on things (phase 7)**: now, later or never.
3. **Brutes vs you**: soft push (recommended) or hard block as now.
