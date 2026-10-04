// MATERIALS: what a prop is made of, by its kind: what a bullet meets there. One table for its readers: the impact's look
// (features/gunfx.js: chips, splinters, sparks, the hole) and whether a bullet may glance off (sim/projectiles.js: a
// ricochet off metal or stone). Stone also stands for brick and clay; walls in the desert are adobe (matOf).
// A feature's own prop kinds are registered once, at its module's load (setMaterials, like world.js propTop).
// (Moved here from features/gunfx.js MAT, unchanged, so the sim can read it too.)
export const PROP_MAT = {wall_n: 'stone', wall_s: 'stone', wall_w: 'stone', wall_e: 'stone', tower: 'stone', gatepost: 'stone', pillar: 'stone',
  pillar_broken: 'stone', rubble: 'stone', rock: 'stone', rock_big: 'stone', ruin: 'stone', well: 'stone', crystal: 'stone', pot: 'stone',
  campfire: 'stone', beacon: 'stone', crate: 'wood', barrel: 'wood', woodpile: 'wood', stall: 'wood', bench: 'wood', hitch_rail: 'wood',
  trough: 'wood', wanted_board: 'wood', signpost: 'wood', wagon: 'wood', outhouse: 'wood', rail_fence: 'wood', windmill: 'wood',
  mine_portal: 'wood', water_tower: 'wood', tree: 'wood', goods: 'wood', chest: 'wood', dummy: 'wood', merchant: 'wood',
  barrel_x: 'metal', stock_tank: 'metal', ore_cart: 'metal', brazier: 'metal', torch: 'metal'};
export function setMaterials(table) { Object.assign(PROP_MAT, table); }
// the material of prop kind `kind` in biome `biome` (an unlisted kind: stone)
export const matOf = (kind, biome) => { const m = PROP_MAT[kind] || 'stone'; return m === 'stone' && biome === 'desert' && kind.startsWith('wall') ? 'adobe' : m; };
