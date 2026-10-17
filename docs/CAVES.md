# Caves: going down into the dark

Status: 2026-10-12, first slice: one cave per forest, grown from the seed (`world/caves.js`). On wherever the forest is
(`?seed=N`, `?forest=1`, a co-op session).

## What it is

- **The mouth.** Somewhere in the home woods, on level ground away from the water, the clearing, the esker and the rock, a slot
  is cut down into the ground: 11 m long, 3.4 m wide, its floor falling 3.6 m, heading north give or take (you walk up the
  screen into it). Rock walls up both sides. Over its last metres the ground runs on uncut: an overhang with a rock brow under its
  edge, dark under it. Nothing grows on it or in front of it.
- **Going down.** As you walk down the slot the world above goes dark round you (`features/caves.js` F.under, eased): the sun and
  its shadows, the sky's ambient, the fog, the mist, the rain and snow fade out, and your lantern lights (wider than on the
  surface). Where the floor is 2.5 m down you are moved onto the cave (below) without a jump: the same ground at the same
  height, moving as you were, the camera with you.
- **The cave.** Chambers and passages grown out from the slot's foot like roots (10-14 nodes, a loop or two), falling a little
  as they go, rock between them. The floor is painted (earth and grit, bare rock in sheets, darker and stonier toward the walls,
  loose stones). The walls are the cliffs' 3D rock along the open's outline, 3.4 m high. Above the walls there is nothing: the
  dark. The walls between the camera and the floor (the ones facing away from it) are not drawn, so you see the floor and the
  walls the camera looks at; they still stop the lantern's light. Turn the camera and the other walls show.
- **In it.** Crystals at the feet of the walls in some chambers (breakable, they glow), loose rocks in the passages. Walk back up
  the slot and you come out in the woods.

## How it works

The ground is one height per place (`world/terrain.js`), so a cave can't lie under the woods. It lies in a BAND of its own north
of the forest (the forest's width, 64 m deep, 18 m past its north edge: out of the view from anywhere in the woods), and the slot
is in both places: in the woods (a 'cave' terrain shape that only lowers the ground) and as a COPY at the band's south edge
(`C.copy`, the mouth moved by `C.off`). Past `warp` m down the slot in the woods the player is moved by OFF onto the copy, and
back past `warp - hyst` m in the copy (`host.warp`, `adapter.js shift`: his move, the camera's ease, the draw's last place go
along). By then the woods round him are all but dark, and the copy's floor is the slot's to the cm.

- `world/caves.js`: the plan, pure (node runs it; every co-op client grows the same cave): `placeMouth`, `cavePlan` (the network,
  its distance and floor grids, its terrain shapes, its walls by marching squares, its props, `slotAt`).
- `world/forest.js`: places the mouth (`F.cave`), adds its shapes and props, keeps growth off it.
- `world/layout.js`: `CAVE`; the world (`WORLD`) reaches over the band (camera, grid, field), the forest's own edges stay;
  the band is walkable (its rock is a steep wall).
- `world/cave3d.js`: the floor (a ground patch, `biome.paintCave`: `biomes.js caveRuins`) and the walls (`cliffs3d.js`, eight
  facing bins, `update(yaw)` picks which show).
- `world/world.js`: the slot's rock and brow, the cave's build, `world.cave`.
- `features/caves.js`: the warp, F.under, the lantern (`host.mods` 'light.lantern' / 'light.lanternR'; out down there:
  'light.lanternOut'; L puts it out and lights it, the soot things snuff it: `docs/CAVELIFE.md`). Event `player.warp`.
- `render/lighting.js`: the mood toward the cave's by F.under. `features/cutaway.js`, `weather.js`, `mist.js`: off underground.

## Multiplayer

The cave is everyone's: grown from the session's seed like the forest. The warp is each player's own move (co-op sends his
position: the others see him go down the slot and on in the band). The dark is each player's own view. Its crystals are
breakable props like the arena's (not synced yet, like the rest of combat).

## Not yet

- More than one cave; caves in the other places; deeper levels (a cave under the cave: the band can hold a second copy).
- Water, drips, ambient sound (the acoustics see the walls already: the band is in the world). Things living down there
  came with `docs/CAVELIFE.md` (rock-things, soot things).
- The mouth's look from above at other yaws (the brow faces south); a ladder or a rope down a shaft as another way in.
