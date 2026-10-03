// THE PLAYER'S STATS in a run: base values + every item copy + every augment, turned into numbers. Health and the
// game's own numbers live here; what other systems own (the combat core's tuning and ability cooldowns, player.js's run
// speeds) gets MODIFIER notes from the source 'stats' (core/modifiers.js): each owner applies them to its own numbers.
//   dmg       arrow damage x (1 + dmg); explosions from arrows too       crit / critMul   added to combat's 15% / 2x
//   hp, hpPct max health (+ flat, then x (1 + pct))                       regen            health per second
//   speed     walk / run / sprint x (1 + speed)                           gold             coins picked up x (1 + gold)
//   leech     health per arrow that hits an enemy                         bleed            chance: 15 damage over 3 s
//   boom      Explosive Arrow radius and blast x (1 + boom)               msN              extra Multishot arrows
//   cdr       every ability's cooldown x (1 - cdr) per copy               nthBoom          every (7 - n)th bow shot explodes
//   volley    extra arrows per bow shot (50% damage)                      waveHeal         share of max health healed per wave
//   execute   extra damage to enemies under 35% health                    trapCd / trapRoot   Vault Trap cooldown x (1 - .), root + s
//   rainCd / rainN   Arrow Rain cooldown x (1 - .), extra arrows          iframe           untouchable seconds after a dodge roll
//   the revolver's (sim/player/gun.js applies them: host.mods 'weapon.*'): reload (time x (1 - .)), rof (shots x (1 + .) as
//   fast), spread (x (1 - .), the fan's too), fanSpread (the fan's x (1 - .)), last (the cylinder's last round: damage
//   x (1 + .)), quick (the first shot after a draw: x (1 + .))
// restore() drops the notes (the sandbox plays with the engine's own numbers).
import {itemById, augmentById} from './items.js';

export const BASE_HP = 100, BASE_REGEN = .4;

export function createStats(host, core) {
  const SLOTS = core.SLOTS, mods = host.mods;
  const items = new Map(), augs = new Set();
  const S = {hp: BASE_HP, maxHp: BASE_HP, regen: BASE_REGEN, dmg: 1, gold: 1, leech: 0, bleed: 0, execute: 0, volley: 0, waveHeal: 0, iframe: 0, nthBoom: 0,
    hurtT: 0, healT: 0, hpShow: BASE_HP};

  function sum(key) {
    let v = 0;
    for (const [id, n] of items) v += (itemById(id).stat[key] || 0) * n;
    for (const id of augs) v += augmentById(id).stat[key] || 0;
    return v;
  }
  function apply() {
    const max0 = S.maxHp;
    S.maxHp = Math.max(10, Math.round((BASE_HP + sum('hp')) * Math.max(.2, 1 + sum('hpPct'))));
    if (S.maxHp > max0) S.hp += S.maxHp - max0;   // more max health arrives filled
    S.hp = Math.min(S.hp, S.maxHp);
    S.regen = BASE_REGEN + sum('regen'); S.dmg = 1 + sum('dmg'); S.gold = 1 + sum('gold');
    S.leech = sum('leech'); S.bleed = Math.min(.8, sum('bleed')); S.execute = sum('execute'); S.volley = sum('volley');
    S.waveHeal = sum('waveHeal'); S.iframe = sum('iframe');
    const nb = sum('nthBoom'); S.nthBoom = nb ? Math.max(2, 7 - nb) : 0;
    const bk = 1 + sum('boom'), cdr = (1 - (itemById('hourglass').stat.cdr)) ** (items.get('hourglass') || 0);
    mods.set('stats', [
      {stat: 'combat.crit', add: sum('crit')}, {stat: 'combat.critMul', add: sum('critMul')}, {stat: 'combat.msN', add: sum('msN')},
      {stat: 'combat.boomR', mul: bk}, {stat: 'combat.boomBlast', mul: bk},
      {stat: 'combat.rainN', add: sum('rainN')}, {stat: 'combat.trapRoot', add: sum('trapRoot')},
      ...SLOTS.flatMap(k => [{stat: 'combat.cd.' + k, mul: cdr}, {stat: 'combat.cd.' + k, mul: k === 2 ? 1 - sum('rainCd') : 1},
        {stat: 'combat.cd.' + k, mul: k === 4 ? 1 - sum('trapCd') : 1}]),
      {stat: 'player.speed', mul: Math.max(.5, 1 + sum('speed'))},
      {stat: 'weapon.reload', mul: Math.max(.3, 1 - sum('reload'))}, {stat: 'weapon.gap', mul: 1 / (1 + sum('rof'))},
      {stat: 'weapon.spread', mul: Math.max(.2, 1 - sum('spread'))}, {stat: 'weapon.fanSpread', mul: Math.max(.2, 1 - sum('spread')) * Math.max(.2, 1 - sum('fanSpread'))},
      {stat: 'weapon.last', add: sum('last')}, {stat: 'weapon.quick', add: sum('quick')},
    ]);
  }

  const St = {
    S, items, augs,
    reset() { items.clear(); augs.clear(); Object.assign(S, {hp: BASE_HP, maxHp: BASE_HP, hpShow: BASE_HP, hurtT: 0, healT: 0}); apply(); },
    restore() { mods.clear('stats'); },   // the engine's own numbers (sandbox)
    addItem(it) { items.set(it.id, (items.get(it.id) || 0) + 1); apply(); },
    removeItem(id) { const n = items.get(id) || 0; if (!n) return false; if (n > 1) items.set(id, n - 1); else items.delete(id); apply(); return true; },   // (one copy: a trade)
    addAugment(a) { augs.add(a.id); apply(); },
    // the build in pick order, for the HUD: [{def, n, aug}]
    build() { return [...[...augs].map(id => ({def: augmentById(id), n: 1, aug: true})), ...[...items].map(([id, n]) => ({def: itemById(id), n}))]; },
    hurt(dmg) { const d = Math.max(1, Math.round(dmg)); S.hp = Math.max(0, S.hp - d); S.hurtT = 1; return d; },
    heal(n) { const h = Math.min(S.maxHp - S.hp, n); if (h > 0) { S.hp += h; if (h >= 1) S.healT = 1; } return h; },
    update(dt, regen = true) {
      if (regen && S.hp > 0) S.hp = Math.min(S.maxHp, S.hp + S.regen * dt);
      S.hurtT = Math.max(0, S.hurtT - dt * 2.5); S.healT = Math.max(0, S.healT - dt * 2);
      S.hpShow = S.hpShow > S.hp ? Math.max(S.hp, S.hpShow - S.maxHp * .5 * dt) : S.hp;   // the white chip that lags a hit
    },
  };
  apply();
  return St;
}
