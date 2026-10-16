// BUILDS (data; docs/BUILDING.md): the things a player sets down in the persistent world from the pack panel's Build list. Pure
// data and pure rules: the browser (features/builds.js: placing, the save, the lamps; features/campfires.js: the fires) and the
// co-op server (server/room.mjs act 'build', 'stoke', 'unbuild') read this one file.
//   cost     {item: n} paid from the pouch (content/items.js; 'wood': any log, the kind there is most of: game/inventory.js)
//   most     how many of it one player may have standing (a new one is refused past it)
//   r        m: its collider; room: m kept clear round it when it goes down
//   prop     the world prop's kind (world.js propTop / materials: features/builds.js, features/campfires.js)
//   fire     a fire (features/campfires.js): start (logs it is lit with), log (s of fire a log), max (logs it holds), embers
//            (s it glows after), light (m at full fire)
//   lamp     a steady light (features/builds.js): color, radius (m), intensity; takeBack: E by your own one takes it down and
//            gives its cost back
//   cave     it can go down in the cave too (every build can stand anywhere in the persistent world; this one is made for it)
export const BUILDS = {
  campfire: {name: 'Campfire', cost: {wood: 4}, most: 3, r: .45, room: .9, prop: 'pitfire',
    desc: 'a ring of stones round a teepee of logs; E by it adds a log. Cook by a burning one.',
    fire: {start: 2, log: 80, max: 5, embers: 90, light: 6.5}},
  fire_ring: {name: 'Stone Fire Ring', cost: {stone: 6, wood: 2}, most: 3, r: .6, room: 1.1, prop: 'firering', cave: true,
    desc: 'a wide ring of cave stone round a bed of embers: a log burns half as long again, it holds eight, and it lights more. Cook by it.',
    fire: {start: 2, log: 120, max: 8, embers: 180, light: 8.5}},
  crystal_lamp: {name: 'Crystal Lamp', cost: {glow_shard: 3, copper_ore: 2, wood: 1}, most: 8, r: .28, room: .6, prop: 'crystallamp', cave: true,
    desc: 'Glow Shards set in copper on a little cairn of stone: a cold, steady light that never goes out. E by your own takes it back.',
    lamp: {color: '#b8f0a4', radius: 6, intensity: 1.5, takeBack: true}},
};
export const BUILD_IDS = Object.keys(BUILDS);
// placing: ahead of him (within E's reach from where he stands); the server's reach check; how close two builds may stand
export const TUNE = {ahead: 1.15, reach: 4, apart: .4};
// a fire's state from its fuel at a time: s of fire left (fuel at t0, burning since), the ember glow after it
//   fuelAt(f, now) -> s of fire left (>= 0); emberAt(f, now, def) -> s of glow left (0 once cold); f = {fuel, t0} (t0 in s)
export const fuelAt = (f, now) => Math.max(0, (f.fuel || 0) - Math.max(0, now - (f.t0 || 0)));
export const emberAt = (f, now, def) => { const over = Math.max(0, now - (f.t0 || 0)) - (f.fuel || 0); return f.fuel > 0 && over > 0 ? Math.max(0, def.fire.embers - over) : 0; };
// a log on a fire: its fuel now plus a log, held to max (s of fire)
export const stokeFuel = (left, def) => Math.min(def.fire.max * def.fire.log, left + def.fire.log);
