// MIRE (data; docs/MIRE.md): the knobs of the upland's bog. Pure: the browser (features/mire.js), the rules both sides run
// (sim/mire.js) and the co-op server (server/room.mjs: the digs) read this one file. Its ground, pools, boardwalk and things are
// the forest plan's (world/mire.js TUNE).
//   FLOOD   the water: it rises rise / in-game hour at full rain (a storm: x storm) and drains drain / hour (empty again ~6 h
//           after the rain stops); the pools grow up to world/mire.js TUNE.pools.flood of their radius again, the soft ground
//           spreads (its threshold falls by TUNE.soft.flood): the boardwalk goes partly under. Over the last back in-game hours
//   FROZEN  winter: frozen once the lake's ice (sim/ice.js thickAt) is over ice cm: pools walkable, no sinking, the quake gone
//   SINK    standing on soft ground: after wait s it takes you down to deep m (to the waist) over time s; walking only to walk m
//           (the shins), and you come up again at up m/s; at full depth walking is slow x slower. A press of jump frees you while
//           you're under free m; deeper, you're held (stuck) until you hold jump hold s (the mail shirt: mail s; a friend within
//           friendR m: x friend). The moose-hide boots' 'soft.slow' note: x their mul on the sink's speed (0 -> half: boots)
//   POOL    in a pool you go down to its depth (chest m at its middle), walk x wade, soaked (wet +soak a s)
//   PLANK   a rotten plank breaks under you (one in six: world/mire.js): you drop to knee m in the mud and it stays broken (yours)
//   WISPS   from dusk (hour from) to dawn (to): n [min, max] cold lights over the pools, one TRUE a night; they drift ahead of you to
//           keep ahead [min, max] m off, at speed m/s; the false ones lead into the soft ground and the pools, the true one along
//           its path (walk [min, max] m long) to the night's FIND and stops over it. The true one has no reflection in the water.
//           ?wisps=often: every night, all the time
//   DIG     E at the find (within reach m) digs (dig s): everyone who reaches it gets one, once a night (the server's: act 'dig');
//           FINDS: what the bog gives, one kind a night by the seed (content/items.js)
export const TUNE = {
  flood: {rise: .7, storm: 1.4, drain: .17, back: 12, step: .25},
  frozen: {ice: .15},
  sink: {wait: 2, deep: .6, time: 6, walk: .14, up: .5, slower: .5, free: .32, hold: 1, mail: 2.5, friend: .5, friendR: 2.2, boots: .5},
  pool: {chest: 1.15, edge: .35, wade: .45, soak: 2},
  plank: {knee: .35},
  wisps: {from: 19.5, to: 5.5, n: [3, 5], keep: [6, 9], speed: 2.2, walk: [30, 50], h: 1.1, bob: .18, reach: 1.6, dig: 1.2},
};
export const FINDS = ['bog_butter', 'bronze_ring', 'bent_sword', 'amber_beads'];
// the find of night n (the seed's): the same on every machine
export const findOf = (seed, n) => FINDS[((Math.imul(seed | 0, 2654435761) ^ Math.imul(n | 0, 40503)) >>> 0) % FINDS.length];
