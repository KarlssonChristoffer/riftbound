// CAVE LIFE (data; docs/CAVELIFE.md): the numbers of the cave's living dark. Pure data, no imports: the browser
// (features/cavelife.js, features/caves.js, features/mining.js) and the co-op server (server/room.mjs: the soot things) read it.
//   SOOT      the soot things (sim/cavelife.js): they roost in the cave's far rooms (world/caves.js C.soot) and go for a LIT lantern
//             seen within `see` m (of them; never farther than `leash` m from their roost), flying at `seek` m/s; at a lantern they
//             circle the head `circle` s and put it out, then go back and rest `cool` s. They never come within `lamp` m of a
//             Crystal Lamp or a burning fire, and leave one they find themselves in. `h`: m over the floor they fly at; `ring`:
//             m round the head they circle; `roost`: m over the floor they hang at home
//   LANTERN   the lantern in the cave (features/caves.js): `relight` s after a snuff it lights again by itself (at once by a cave
//             crystal within `crystal` m, or in a lamp's or a burning fire's light); L puts it out and lights it again
//   CRITTER   the rock-things (features/cavelife.js, view only): loose rocks that unroll on pale legs when he comes within `wake` m,
//             trot `trot` m away (min, max) at `speed` m/s and curl up again; they rest `rest` s before they can be woken again
export const SOOT = {see: 7, leash: 16, seek: 3.2, circle: 1.8, cool: 12, lamp: 6, h: 1.7, ring: .55, roost: 2.4, back: 2.2};
export const LANTERN = {relight: 4, crystal: 1.2};
export const CRITTER = {wake: 2, trot: [3, 6], speed: 2.4, rest: 6};
