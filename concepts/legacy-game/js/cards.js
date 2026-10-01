// Reward rolls: build three cards for the hero, weighted toward their tags, and apply the chosen one.
import {G, pick, rand} from './core.js';
import {SKILLS, ULTS} from './skills.js';
import {skillDef} from './entities.js';
import {SIGS, RUNES} from './sigs.js';
import {ELEM} from './combat.js';

const RARITY = {silver: 1, gold: 1.6, prismatic: 2.5};

export const ITEMS = [
  {id: 'whetstone', name: 'Whetstone', tags: ['melee'], text: r => `+${Math.round(12 * r)}% damage`, apply: (h, r) => { h.stats.dmg += .12 * r; }},
  {id: 'boots', name: 'Windstep Boots', tags: ['dash'], text: r => `+${Math.round(10 * r)}% move speed`, apply: (h, r) => { h.stats.speed += .1 * r; }},
  {id: 'heart', name: 'Ogre Heart', tags: [], text: r => `+${Math.round(25 * r)} max HP`, apply: (h, r) => { h.maxHp += 25 * r; h.hp += 25 * r; }},
  {id: 'fang', name: 'Vampire Fang', tags: ['melee'], text: r => `${(3 * r).toFixed(1)}% life steal`, apply: (h, r) => { h.stats.lifesteal += .03 * r; }},
  {id: 'lens', name: 'Hunter\'s Lens', tags: ['projectile'], text: r => `+${Math.round(8 * r)}% crit chance`, apply: (h, r) => { h.stats.crit += .08 * r; }},
  {id: 'ember', name: 'Ember Charm', tags: ['fire'], text: () => 'Your hits set enemies on fire', apply: h => { h.stats.burnOnHit = 1; }, once: true},
  {id: 'hourglass', name: 'Cracked Hourglass', tags: ['area'], text: r => `-${Math.round(8 * r)}% all cooldowns`, apply: (h, r) => { h.stats.cdr *= 1 - .08 * r; }},
  {id: 'frostshard', name: 'Frost Shard', tags: ['frost'], text: r => `${Math.round(8 * r)}% chance on hit to freeze`, apply: (h, r) => { h.stats.freezeChance += .08 * r; }},
  {id: 'plate', name: 'Bulwark Plate', tags: ['melee'], text: r => `-${Math.round(8 * r)}% damage taken`, apply: (h, r) => { h.stats.armor = Math.min(.6, h.stats.armor + .08 * r); }},
  {id: 'spring', name: 'Troll Blood', tags: [], text: r => `+${Math.round(100 * r)}% health regen`, apply: (h, r) => { h.stats.regen += .8 * r; }},
];
export const AUGS = [
  {id: 'overflow', name: 'Overflow', tags: ['area'], text: 'Every third skill you cast comes back almost instantly'},
  {id: 'glass', name: 'Glass Cannon', tags: [], text: '+50% damage, but -30% max HP', apply: h => { h.stats.dmg += .5; h.maxHp = Math.round(h.maxHp * .7); h.hp = Math.min(h.hp, h.maxHp); }},
  {id: 'secondwind', name: 'Second Wind', tags: [], text: 'The first time you would die in a biome, heal 40% instead'},
  {id: 'arcane', name: 'Arcane Echo', tags: [], text: 'Your ultimate recharges 40% faster'},
];
// Class passives: each class has its own five, several of them combos with its skills.
export const PASSIVES = {
  pyromancer: [
    {id: 'combustion', name: 'Combustion', icon: 'flame', text: 'Burning enemies take 25% more damage from everything you do.'},
    {id: 'pyroclasm', name: 'Pyroclasm', icon: 'bomb', text: 'Enemies that die while burning explode, burning everything nearby.'},
    {id: 'heatsink', name: 'Heat Sink', icon: 'temperature', text: 'Every hit of your basic spell shaves 0.15s off all skill cooldowns.'},
    {id: 'emberward', name: 'Ember Ward', icon: 'shield', text: 'Casting a skill wraps you in a barrier worth 12% of your max health for 3 seconds.'},
    {id: 'chainreaction', name: 'Chain Reaction', icon: 'affiliate', text: 'Combo: when Living Bomb explodes it plants a new bomb on a nearby enemy (up to 3 times).'},
    {id: 'flamewalker', name: 'Flamewalker', icon: 'shoe', text: 'Evading leaves a trail of fire that burns enemies.'},
  ],
  warden: [
    {id: 'shatter', name: 'Shatter', icon: 'snowflake', text: 'Frozen enemies take double damage.'},
    {id: 'bulwark', name: 'Bulwark', icon: 'shield-check', text: 'You take 20% less damage from everything.'},
    {id: 'retaliation', name: 'Retaliation', icon: 'arrow-back', text: 'When you are hit, 25% chance to release a frost nova that chills nearby enemies.'},
    {id: 'permafrost', name: 'Permafrost', icon: 'ice-cream', text: 'Frost freezes after 3 hits instead of 4, and freezes last 50% longer.'},
    {id: 'crusader', name: 'Crusader', icon: 'shield-half', text: 'Each hit of your basic spell grants a barrier of 2% max health (up to 20%).'},
  ],
  ranger: [
    {id: 'huntersmark', name: "Hunter's Mark", icon: 'target', text: 'The first time you hit an enemy it is marked for 6 seconds and takes 20% more damage.'},
    {id: 'static', name: 'Static Charge', icon: 'bolt', text: 'Your basic spell often arcs lightning to a second enemy.'},
    {id: 'kite', name: 'Kite', icon: 'wind', text: 'After evading you move 20% faster for 2 seconds and your next 3 basic shots crit.'},
    {id: 'eagleeye', name: 'Eagle Eye', icon: 'eye', text: 'You deal up to 30% more damage the farther away the target is.'},
    {id: 'quiver', name: 'Swift Quiver', icon: 'clock-bolt', text: 'All skill cooldowns are 15% shorter.', apply: h => { h.stats.cdr *= .85; }},
  ],
  voidblade: [
    {id: 'backstab', name: 'Backstab', icon: 'sword', text: 'Hits from behind deal 50% more damage. Blink Strike always lands behind.'},
    {id: 'momentum', name: 'Momentum', icon: 'bolt', text: 'Every kill takes 0.5s off all skill cooldowns.'},
    {id: 'voidhunger', name: 'Void Hunger', icon: 'droplet', text: 'Every kill heals you for 4% of your max health.'},
    {id: 'twinfangs', name: 'Twin Fangs', icon: 'slice', text: 'Combo: the third hit of Void Slash deals double damage.'},
    {id: 'phaseshift', name: 'Phase Shift', icon: 'ghost', text: 'Evade recharges 40% faster and leaves a void explosion where you started.'},
  ],
};
const MUTS = [
  {id: 'echo', name: 'Echo', minR: 'gold', text: s => `${s} casts a second time for 70% damage`, apply: m => { m.echo = 1; }},
  {id: 'amp', name: 'Amplify', text: (s, r) => `${s} deals +${Math.round(40 * r)}% damage`, apply: (m, r) => { m.dmg += .4 * r; }},
  {id: 'wide', name: 'Wide', text: (s, r) => `${s} has +${Math.round(35 * r)}% area and bounce range`, apply: (m, r) => { m.area += .35 * r; }},
  {id: 'quick', name: 'Quickened', text: (s, r) => `${s} cooldown -${Math.round(25 * r)}%`, apply: (m, r) => { m.cdr *= 1 - Math.min(.6, .25 * r); }},
];

function rollRarity(min) {
  const r = Math.random(); let v = r < .05 ? 'prismatic' : r < .3 ? 'gold' : 'silver';
  const order = ['silver', 'gold', 'prismatic']; if (order.indexOf(v) < order.indexOf(min)) v = min; return v;
}
function candidates(h) {
  const out = [], tags = h.tags(), has = x => x.some(t => tags.has(t));
  // new skills: anything not already equipped, replacing a random slot
  const open = [0, 1, 2].filter(s => h.skills[s]); // only swap skills you have already unlocked
  if (open.length) for (const id of h.cls.skills) if (!h.skills.includes(id)) {
    const d = SKILLS[id], slot = open[Math.floor(Math.random() * open.length)], old = skillDef(h, slot);
    out.push({type: 'skill', w: has([d.elem, ...d.tags]) ? 3 : 1, icon: d.icon, color: d.color, name: d.name, text: `Replaces {k${slot}} (${old.name}). ${d.desc}`, slot, skill: id});
  }
  if (h.ult) for (const id of h.cls.ults) if (h.ult !== id) { const d = ULTS[id]; out.push({type: 'ultimate', w: (h.ult ? .4 : 1.6) * (has([d.elem]) ? 2 : 1), icon: d.icon, color: d.color, name: d.name, text: (h.ult ? `Replaces ${ULTS[h.ult].name}. ` : 'Fills your ultimate slot {k3}. ') + d.desc, ult: id}); }
  for (let s = 0; s < 4; s++) { const d = skillDef(h, s); if (!d) continue; for (const m of MUTS) if (!(m.id === 'echo' && h.mods[s].echo)) out.push({type: 'mutation', w: .9, icon: d.icon, color: d.color, name: `${d.name}: ${m.name}`, mut: m, slot: s, base: d.name, minR: m.minR}); }
  // imbues: upgrade the two class-locked signature spells (damage type, rank, runes)
  for (let i = 0; i < 2; i++) {
    const s = h.sig[i], S = SIGS[s.id];
    for (const el in ELEM) if (el !== s.elem) out.push({type: 'imbue', w: has([el]) ? 1.2 : .55, icon: S.icon, color: ELEM[el].css, name: `${S.name}: ${ELEM[el].name}`, text: `${S.name} now deals ${ELEM[el].name.toLowerCase()} damage, which ${ELEM[el].desc}.`, imb: {i, kind: 'elem', elem: el}});
    if (s.rank < 5) out.push({type: 'imbue', w: 1.5, icon: S.icon, color: ELEM[s.elem].css, name: `${S.name} Rank ${s.rank + 1}`, text: `${S.name} deals +20% damage (rank ${s.rank + 1} of 5).`, imb: {i, kind: 'rank'}});
    for (const id in RUNES) {
      const R = RUNES[id]; if (!R.kinds.includes(S.kind) || s.runes.includes(id)) continue;
      out.push({type: 'imbue', w: 1.3, icon: 'hexagon', color: '#ffd84a', name: `${R.name} rune`, text: `${S.name} ${R.text(S.kind)}. ` + (s.runes.length >= 3 ? `Replaces your ${RUNES[s.runes[0]].name} rune.` : `Socket ${s.runes.length + 1} of 3.`), imb: {i, kind: 'rune', rune: id}});
    }
  }
  for (const p of PASSIVES[h.id]) if (!h.pas[p.id]) out.push({type: 'passive', w: 2.6, icon: p.icon, color: h.cls.color, name: p.name, text: p.text, pas: p});
  for (const a of AUGS) if (!h.aug[a.id]) out.push({type: 'augment', w: has(a.tags) ? 2.5 : 1, icon: 'sparkles', color: '#ffd84a', name: a.name, text: a.text, aug: a});
  for (const it of ITEMS) if (!(it.once && h.items[it.id])) out.push({type: 'item', w: has(it.tags) ? 2.5 : 1.2, icon: 'diamond', color: '#e8e2d0', name: it.name, item: it});
  if (G.synCards) out.push(...G.synCards(h)); // build archetype cards (synergy.js)
  return out;
}
// level-up: unlock a skill slot by picking one of three of your class's skills (or one of its two ultimates)
export function rollUnlock(h, slot) {
  const own = h.cls.skills, cards = [];
  if (slot === 3) {
    for (const id of h.cls.ults) { const d = ULTS[id]; cards.push({type: 'unlock', rarity: 'gold', icon: d.icon, color: d.color, name: d.name, text: `Your ultimate, on {k3}. ${d.desc}`, slot, skill: id}); }
    return cards;
  }
  const free = id => !h.skills.includes(id);
  const ids = own.filter(free).sort(() => Math.random() - .5).slice(0, 3);
  for (const id of ids) { const d = SKILLS[id]; cards.push({type: 'unlock', rarity: 'silver', icon: d.icon, color: d.color, name: d.name, text: `New skill on {k${slot}}. ${d.desc}`, slot, skill: id}); }
  return cards;
}
// level-up without a new slot: a skill point (upgrades only)
export function rollPoint(h) { return rollCards(h, 'silver', 3, c => ['imbue', 'mutation', 'item', 'augment', 'passive', 'synergy'].includes(c.type)); }
export function rollCards(h, minRarity = 'silver', n = 3, filter = null) {
  const pool = candidates(h).filter(c => !filter || filter(c)), picked = [];
  while (picked.length < n && pool.length) {
    const total = pool.reduce((a, c) => a + c.w, 0); let r = Math.random() * total, k = 0;
    for (; k < pool.length; k++) { r -= pool[k].w; if (r <= 0) break; }
    const c = pool.splice(Math.min(k, pool.length - 1), 1)[0];
    if (picked.some(p => p.type === c.type && !['mutation', 'item', 'imbue', 'passive', 'synergy'].includes(p.type)) && pool.length > n) continue;
    if (c.imb && picked.some(p => p.imb && p.imb.i === c.imb.i && p.imb.kind === c.imb.kind)) continue;
    c.rarity = rollRarity(c.minR || minRarity); const R = RARITY[c.rarity];
    if (c.mut) c.text = c.mut.text(c.base, R);
    if (c.item) c.text = c.item.text(R) + (h.items[c.item.id] ? ` (you have ${h.items[c.item.id]})` : '');
    picked.push(c);
  }
  return picked;
}
export function applyCard(h, c) {
  const R = RARITY[c.rarity];
  if (c.type === 'unlock') { if (c.slot === 3) h.ult = c.skill; else h.skills[c.slot] = c.skill; h.cds[c.slot] = 0; }
  else if (c.type === 'skill') { h.skills[c.slot] = c.skill; h.mods[c.slot] = {dmg: 1, area: 1, cdr: 1, echo: 0}; h.cds[c.slot] = 0; }
  else if (c.type === 'ultimate') { h.ult = c.ult; h.cds[3] = 0; h.mods[3] = {dmg: 1, area: 1, cdr: 1, echo: 0}; }
  else if (c.type === 'mutation') c.mut.apply(h.mods[c.slot], R);
  else if (c.type === 'imbue') {
    const s = h.sig[c.imb.i];
    if (c.imb.kind === 'elem') s.elem = c.imb.elem;
    else if (c.imb.kind === 'rank') s.rank = Math.min(5, s.rank + 1);
    else { if (s.runes.length >= 3) s.runes.shift(); s.runes.push(c.imb.rune); }
  }
  else if (c.type === 'passive') { h.pas[c.pas.id] = true; c.pas.apply && c.pas.apply(h); }
  else if (c.type === 'augment') { h.aug[c.aug.id] = true; c.aug.apply && c.aug.apply(h); }
  else if (c.type === 'synergy') G.takeSyn(h, c.syn, R);
  else if (c.type === 'item') { h.items[c.item.id] = (h.items[c.item.id] || 0) + 1; c.item.apply(h, R); }
}
