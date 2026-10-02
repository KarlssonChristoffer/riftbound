// ITEMS and AUGMENTS: data only (game/stats.js turns them into numbers, game/game.js hands them out).
//   items     Risk of Rain style: found in chests (bought with gold), random by tier, and they STACK: every `stat` adds
//             once per copy
//   augments  LoL Arena style: when a stage is cleared you pick one of three; each once per run, bigger and stranger
// stat keys (all additive; game/stats.js documents what each does):
//   dmg crit critMul hp hpPct regen speed gold leech bleed boom msN cdr nthBoom volley waveHeal execute trapCd trapRoot
//   rainCd rainN iframe   (the revolver's: reload rof spread fanSpread last quick)
// `only`: 'bow' | 'gun': offered only to that weapon's loadouts (content/weapons.js kind; untagged = both). The bow's pool
// is exactly what it was, so its rolls come out as before.
export const TIER = {
  1: {name: 'Common', col: '#d8d0c0', weight: 70},
  2: {name: 'Uncommon', col: '#7ad07a', weight: 25},
  3: {name: 'Rare', col: '#e8604a', weight: 5},
};

export const ITEMS = [
  {id: 'broadheads', name: 'Broadheads', tier: 1, glyph: '▲', desc: '+12% arrow damage', stat: {dmg: .12}, only: 'bow'},
  {id: 'feather', name: 'Hawk Feather', tier: 1, glyph: '✦', desc: '+8% critical chance', stat: {crit: .08}},
  {id: 'boots', name: 'Trail Boots', tier: 1, glyph: '»', desc: '+8% move speed', stat: {speed: .08}},
  {id: 'ration', name: 'Hearty Ration', tier: 1, glyph: '♥', desc: '+20 max health', stat: {hp: 20}},
  {id: 'poultice', name: 'Moss Poultice', tier: 1, glyph: '+', desc: '+0.8 health per second', stat: {regen: .8}},
  {id: 'purse', name: 'Coin Purse', tier: 1, glyph: '$', desc: '+20% gold', stat: {gold: .2}},
  {id: 'leech', name: 'Leech Fletching', tier: 2, glyph: '◆', desc: 'heal 1 health per arrow that hits an enemy', stat: {leech: 1}},
  {id: 'barbs', name: 'Barbed Heads', tier: 2, glyph: '✕', desc: '20% chance to bleed: 15 damage over 3 s', stat: {bleed: .2}},
  {id: 'powder', name: 'Powder Horn', tier: 2, glyph: '✸', desc: 'Explosive Arrow: +25% radius and blast', stat: {boom: .25}, only: 'bow'},
  {id: 'quiver', name: 'Spare Quiver', tier: 2, glyph: '≡', desc: 'Multishot: +2 arrows', stat: {msN: 2}, only: 'bow'},
  {id: 'hourglass', name: 'Hourglass Charm', tier: 3, glyph: '⧖', desc: 'abilities recharge 15% faster', stat: {cdr: .15}, only: 'bow'},
  {id: 'thunder', name: 'Thunder Fletch', tier: 3, glyph: 'ϟ', desc: 'every 6th bow shot explodes (one sooner per extra copy)', stat: {nthBoom: 1}, only: 'bow'},
  // the revolver's (sim/player/gun.js reads them as host.mods notes: game/stats.js)
  {id: 'hollow', name: 'Hollow Points', tier: 1, glyph: '●', desc: '+12% bullet damage', stat: {dmg: .12}, only: 'gun'},
  {id: 'loader', name: 'Speed Loader', tier: 1, glyph: '⟳', desc: 'reload 20% faster', stat: {reload: .2}, only: 'gun'},
  {id: 'trigger', name: 'Hair Trigger', tier: 2, glyph: '⌁', desc: 'shoot and fan 20% faster', stat: {rof: .2}, only: 'gun'},
  {id: 'sights', name: 'Silver Sights', tier: 2, glyph: '⊹', desc: '30% less spread', stat: {spread: .3}, only: 'gun'},
  {id: 'gambler', name: "Gambler's Last Round", tier: 3, glyph: '♠', desc: 'the last round in the cylinder deals triple damage', stat: {last: 2}, only: 'gun'},
];

export const AUGMENTS = [
  {id: 'deadeye', name: 'Deadeye', glyph: '◎', desc: 'critical hits deal 3x damage instead of 2x', stat: {critMul: 1}},
  {id: 'volley', name: 'Volley', glyph: '⋔', desc: 'every bow shot looses 2 extra arrows at 50% damage', stat: {volley: 2}, only: 'bow'},
  {id: 'secondwind', name: 'Second Wind', glyph: '↺', desc: 'heal 30% of your health when a wave is cleared', stat: {waveHeal: .3}},
  {id: 'scavenger', name: 'Scavenger', glyph: '$', desc: 'double gold from everything', stat: {gold: 1}},
  {id: 'juggernaut', name: 'Juggernaut', glyph: '■', desc: '+50% max health, 10% slower', stat: {hpPct: .5, speed: -.1}},
  {id: 'executioner', name: 'Executioner', glyph: '†', desc: '+60% damage to enemies under 35% health', stat: {execute: .6}},
  {id: 'trapper', name: 'Trapper', glyph: '⊓', desc: 'Vault Trap: half the cooldown, roots 2 s longer', stat: {trapCd: .5, trapRoot: 2}, only: 'bow'},
  {id: 'glass', name: 'Glass Cannon', glyph: '◇', desc: '+40% damage, 30% less max health', stat: {dmg: .4, hpPct: -.3}},
  {id: 'storm', name: 'Storm of Arrows', glyph: '☂', desc: 'Arrow Rain: 40% shorter cooldown, +10 arrows', stat: {rainCd: .4, rainN: 10}, only: 'bow'},
  {id: 'nimble', name: 'Nimble', glyph: '∿', desc: 'untouchable 0.4 s after a dodge roll, 10% faster', stat: {iframe: .4, speed: .1}},
  {id: 'quickdraw', name: 'Quick Draw', glyph: '↯', desc: 'the first shot after a draw deals double damage', stat: {quick: 1}, only: 'gun'},
  {id: 'fanfire', name: 'Fan Fire', glyph: '✶', desc: 'fanning the hammer spreads 40% less', stat: {fanSpread: .4}, only: 'gun'},
];

export const itemById = id => ITEMS.find(i => i.id === id);
export const augmentById = id => AUGMENTS.find(a => a.id === id);

const fits = (it, kind) => !it.only || it.only === kind;
// a random item: a tier by weight (luck shifts weight toward the rarer tiers), then any item of that tier (for this weapon:
// kind 'bow' | 'gun')
export function rollItem(rng, luck = 0, kind = 'bow') {
  const w = [1, 2, 3].map(t => TIER[t].weight * (t > 1 ? 1 + luck : 1)), sum = w.reduce((a, b) => a + b, 0);
  let r = rng() * sum, tier = 1;
  for (let t = 0; t < 3; t++) { r -= w[t]; if (r <= 0) { tier = t + 1; break; } }
  const pool = ITEMS.filter(i => i.tier === tier && fits(i, kind));
  return pool[Math.floor(rng() * pool.length)];
}

// n augments you don't have yet, all different (for this weapon)
export function rollAugments(rng, owned, n = 3, kind = 'bow') {
  const pool = AUGMENTS.filter(a => !owned.has(a.id) && fits(a, kind)), out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}
