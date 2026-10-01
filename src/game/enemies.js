// ENEMIES: the table, scaling, spawning. They live in the combat core as hunting brutes (core.spawnBrute): the same
// hop-at-you AI, knockback, damage, debris and coins as the yard's sparring pair, without the home / leash / respawn.
// All three types are the biome's painted brute for now; the elite and the champion read by their aura ring + light
// and their bars (game/hud.js). New enemy art comes through the sprite pipeline, then gets its own row here.
//   hp, dmg     at stage 1 (scaled by scaleOf)          cost   the director's budget units
//   coins       [min, max] coins dropped                 aura   ring + light colour (elites, bosses)
//   knock, reach, pause (s between hops), hopT (s in the air), hopD (m per hop), hopH (m high): the core's brute tuning
export const ENEMIES = {
  brute: {name: 'Brute', hp: 40, dmg: 10, coins: [1, 3], cost: 1},
  elite: {name: 'Elite Brute', hp: 150, dmg: 16, coins: [5, 8], cost: 4, elite: true, aura: '#ff5a3a', knock: 14, pause: .26, hopT: .42},
  champion: {name: 'Champion', hp: 420, dmg: 24, coins: [24, 32], cost: 10, boss: true, aura: '#ffb040', knock: 18, reach: 1.25,
    pause: .5, hopD: 2.4, hopH: 1.15, hopT: .62},
};

// later stages and later waves hit harder and take more
export const scaleOf = (stage, wave) => ({hp: (1 + .5 * stage) * (1 + .06 * wave), dmg: 1 + .25 * stage});

export function spawnEnemy(core, type, x, y, sc) {
  const E = ENEMIES[type];
  return core.spawnBrute({x, y, type, name: E.name, hp: Math.round(E.hp * sc.hp), dmg: Math.round(E.dmg * sc.dmg), coins: E.coins,
    elite: !!E.elite, boss: !!E.boss, aura: E.aura, knock: E.knock, reach: E.reach, pause: E.pause, hopT: E.hopT, hopD: E.hopD, hopH: E.hopH,
    hitR: E.boss ? .55 : undefined});
}
