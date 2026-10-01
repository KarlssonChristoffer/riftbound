// Meta progression between runs: the save file, class XP and talent trees, relics (shared across classes),
// difficulty tiers, and banking a run's haul when you extract (all of it) or die (a salvaged fraction).
import {PASSIVES} from './cards.js';

const KEY = 'riftbound.save.v1';
const fresh = () => ({v: 1, cls: {}, relics: {}, equipped: [null, null], tier: 1, maxTier: 1, last: 'pyromancer', stats: {runs: 0, extracts: 0, deaths: 0, wins: 0, bosses: 0}});
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) { const d = fresh(); return {...d, ...s, stats: {...d.stats, ...s.stats}}; } } catch (e) { /* private window or corrupt save: start over */ }
  return fresh();
}
export let save = load();
export function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* storage blocked: progress lasts this session only */ } }
export function resetSave() { save = fresh(); persist(); }

// ---------- class XP ----------
export const CLASS_MAX = 20;
export const classNeed = l => Math.round(250 * Math.pow(l, 1.2));
export const DEATH_KEEP = .25; // share of the haul's class XP you keep when you die
const cs = id => save.cls[id] || (save.cls[id] = {level: 1, xp: 0, talents: {}});
export function classInfo(id) {
  const c = cs(id), spent = Object.values(c.talents).reduce((a, b) => a + b, 0);
  return {level: c.level, xp: c.xp, need: classNeed(c.level), points: c.level - 1 - spent, spent, talents: c.talents};
}
function addClassXp(id, amt) {
  const c = cs(id); let ups = 0; if (c.level >= CLASS_MAX) return 0; c.xp += amt;
  while (c.level < CLASS_MAX && c.xp >= classNeed(c.level)) { c.xp -= classNeed(c.level); c.level++; ups++; }
  if (c.level >= CLASS_MAX) c.xp = 0;
  return ups;
}

// ---------- talents ----------
// Each class has three branches (offense, tempo, survival). Row 2 opens at 3 points in the rows above, the capstone at 5.
// Capstones start the run with one of the class's passives, so leveling a class widens what a run can open with.
export const ROW_GATE = [0, 3, 5];
const pct = v => Math.round(v * 100) + '%';
const STAT = {
  dmg: {per: .04, text: v => `+${pct(v)} damage`, apply: (h, v) => { h.stats.dmg += v; }},
  crit: {per: .03, text: v => `+${pct(v)} crit chance`, apply: (h, v) => { h.stats.crit += v; }},
  speed: {per: .04, text: v => `+${pct(v)} move speed`, apply: (h, v) => { h.stats.speed += v; }},
  cdr: {per: .04, text: v => `-${pct(v)} cooldowns`, apply: (h, v) => { h.stats.cdr *= 1 - v; }},
  hp: {per: .08, text: v => `+${pct(v)} max health`, apply: (h, v) => { h.maxHp = Math.round(h.maxHp * (1 + v)); }},
  armor: {per: .04, text: v => `-${pct(v)} damage taken`, apply: (h, v) => { h.stats.armor = Math.min(.6, h.stats.armor + v); }},
  steal: {per: .015, text: v => `+${(v * 100).toFixed(1)}% life steal`, apply: (h, v) => { h.stats.lifesteal += v; }},
  freeze: {per: .04, text: v => `+${pct(v)} chance on hit to freeze`, apply: (h, v) => { h.stats.freezeChance += v; }},
  potion: {per: 1, text: v => `+${v} health potion${v > 1 ? 's' : ''}`, apply: (h, v) => { h.potions += v; h.potMax += v; }},
  sig: {per: 1, text: v => `+${v} starting rank on your basic spell`, apply: (h, v) => { h.sig[0].rank = Math.min(5, h.sig[0].rank + v); }},
};
const st = (stat, name, icon, max) => ({id: name.toLowerCase().replace(/[^a-z]/g, ''), stat, name, icon, max});
const cap = pas => ({id: 'cap_' + pas, pas, max: 1});
const br = (name, icon, r0, r1a, r1b, capstone) => ({name, icon, rows: [[r0], [r1a, r1b], [capstone]]});
export const TREES = {
  pyromancer: [
    br('Inferno', 'flame', st('dmg', 'Kindling', 'flame', 3), st('crit', 'Searing Focus', 'eye', 2), st('steal', 'Cauterize', 'droplet', 2), cap('combustion')),
    br('Cinder', 'wind', st('speed', 'Cinder Stride', 'shoe', 3), st('cdr', 'Quickburn', 'clock-bolt', 2), st('sig', 'Ignition', 'sparkles', 2), cap('heatsink')),
    br('Phoenix', 'feather', st('hp', 'Hearthblood', 'heart', 3), st('potion', 'Ashen Flask', 'bottle', 2), st('armor', 'Scorched Hide', 'shield', 2), cap('emberward')),
  ],
  warden: [
    br('Glacier', 'snowflake', st('dmg', 'Frostforged', 'sword', 3), st('freeze', 'Bitter Cold', 'snowflake', 2), st('crit', 'Rimeblade', 'eye', 2), cap('shatter')),
    br('Vanguard', 'shield-half', st('speed', 'Relentless', 'shoe', 3), st('cdr', 'Battle Rhythm', 'clock-bolt', 2), st('sig', 'Honed Edge', 'sparkles', 2), cap('crusader')),
    br('Bastion', 'shield-check', st('hp', 'Grave Vigor', 'heart', 3), st('armor', 'Tempered Plate', 'shield', 2), st('potion', 'Deep Pockets', 'bottle', 2), cap('bulwark')),
  ],
  ranger: [
    br('Marksman', 'target', st('dmg', 'Steady Aim', 'target', 3), st('crit', 'Keen Eye', 'eye', 2), st('sig', 'Fletcher', 'sparkles', 2), cap('eagleeye')),
    br('Stormcaller', 'bolt', st('cdr', 'Charged Quiver', 'clock-bolt', 3), st('dmg', 'Thunderhead', 'bolt', 2), st('speed', 'Tailwind', 'wind', 2), cap('static')),
    br('Pathfinder', 'trees', st('speed', 'Light Step', 'shoe', 3), st('hp', 'Trail Rations', 'heart', 2), st('potion', 'Herbalist', 'bottle', 2), cap('kite')),
  ],
  voidblade: [
    br('Assassin', 'sword', st('dmg', 'Sharpened Edge', 'sword', 3), st('crit', 'Opportunist', 'eye', 2), st('sig', 'Twin Edges', 'sparkles', 2), cap('backstab')),
    br('Shadow', 'ghost', st('speed', 'Shadowstep', 'shoe', 3), st('cdr', 'Flow', 'clock-bolt', 2), st('armor', 'Umbral Veil', 'shield', 2), cap('phaseshift')),
    br('Hunger', 'droplet', st('hp', 'Void-touched', 'heart', 3), st('steal', 'Siphon', 'droplet', 2), st('potion', 'Dark Tonic', 'bottle', 2), cap('voidhunger')),
  ],
};
// fill in capstone names/text from the class passives so the tree and the card pool never disagree
for (const id in TREES) for (const b of TREES[id]) { const c = b.rows[2][0], p = PASSIVES[id].find(x => x.id === c.pas); Object.assign(c, {name: p.name, icon: p.icon, text: () => 'Start every run with this passive. ' + p.text}); }
export const nodeText = n => n.pas ? n.text() : STAT[n.stat].text(STAT[n.stat].per) + (n.max > 1 ? ' per point' : '');
// a row opens once the rows above it in the same branch hold enough points
const above = (t, b, row) => b.rows.slice(0, row).flat().reduce((a, x) => a + (t[x.id] || 0), 0);
export const branchSpent = (cls, bi) => above(classInfo(cls).talents, TREES[cls][bi], 3);
export function nodeState(cls, bi, row, n) {
  const I = classInfo(cls), r = I.talents[n.id] || 0, open = above(I.talents, TREES[cls][bi], row) >= ROW_GATE[row];
  return {rank: r, open, canAdd: open && r < n.max && I.points > 0};
}
export function addRank(cls, bi, row, n) { if (!nodeState(cls, bi, row, n).canAdd) return false; const t = cs(cls).talents; t[n.id] = (t[n.id] || 0) + 1; persist(); return true; }
// removing a point must not strand a lower row below its gate
export function removeRank(cls, bi, row, n) {
  const t = cs(cls).talents, b = TREES[cls][bi]; if (!t[n.id]) return false;
  t[n.id]--;
  if (!b.rows.every((rw, rr) => rw.every(x => !t[x.id] || above(t, b, rr) >= ROW_GATE[rr]))) { t[n.id]++; return false; }
  if (!t[n.id]) delete t[n.id]; persist(); return true;
}
export function resetTalents(cls) { cs(cls).talents = {}; persist(); }

// ---------- relics ----------
// Shared by every class. You own at most one of each; finding a duplicate upgrades its rarity instead.
export const RAR = ['silver', 'gold', 'prismatic'], RMUL = {silver: 1, gold: 1.6, prismatic: 2.5};
export const RELICS = [
  {id: 'idol', name: 'Emberheart Idol', icon: 'flame', text: r => `+${Math.round(8 * r)}% damage`, apply: (h, r) => { h.stats.dmg += .08 * r; }},
  {id: 'lens', name: 'Stormglass Lens', icon: 'eye', text: r => `+${Math.round(5 * r)}% crit chance`, apply: (h, r) => { h.stats.crit += .05 * r; }},
  {id: 'sandals', name: "Wayfarer's Sandals", icon: 'shoe', text: r => `+${Math.round(6 * r)}% move speed`, apply: (h, r) => { h.stats.speed += .06 * r; }},
  {id: 'hourglass', name: 'Hourglass Shard', icon: 'hourglass', text: r => `-${Math.round(6 * r)}% cooldowns`, apply: (h, r) => { h.stats.cdr *= 1 - .06 * r; }},
  {id: 'totem', name: 'Troll Totem', icon: 'heart', text: r => `+${Math.round(20 * r)} max health`, apply: (h, r) => { h.maxHp += Math.round(20 * r); }},
  {id: 'bandolier', name: 'Vial Bandolier', icon: 'bottle', text: r => `+${Math.floor(r)} health potion${r >= 2 ? 's' : ''}`, apply: (h, r) => { h.potions += Math.floor(r); h.potMax += Math.floor(r); }},
  {id: 'bloodstone', name: 'Bloodstone', icon: 'droplet', text: r => `+${(2 * r).toFixed(1)}% life steal`, apply: (h, r) => { h.stats.lifesteal += .02 * r; }},
  {id: 'sigil', name: 'Warding Sigil', icon: 'shield', text: r => `-${Math.round(6 * r)}% damage taken`, apply: (h, r) => { h.stats.armor = Math.min(.6, h.stats.armor + .06 * r); }},
  {id: 'coin', name: "Gambler's Coin", icon: 'coin', text: r => `Start with ${Math.round(40 * r)} gold for rerolls`, apply: (h, r) => { h.gold += Math.round(40 * r); }},
  {id: 'feather', name: 'Phoenix Feather', icon: 'feather', text: r => `Second Wind: the first lethal hit each biome heals you to ${Math.round(40 * r)}%`, apply: (h, r) => { h.aug.secondwind = true; h.secondWindPct = Math.min(1, .4 * r); }},
  {id: 'crown', name: 'Glass Crown', icon: 'crown', text: r => `Glass Cannon: +${Math.round(50 * r)}% damage, -30% max health`, apply: (h, r) => { h.aug.glass = true; h.stats.dmg += .5 * r; h.maxHp = Math.round(h.maxHp * .7); }},
  {id: 'echo', name: 'Echo Stone', icon: 'repeat', text: () => 'Arcane Echo: your ultimate recharges 40% faster', apply: h => { h.aug.arcane = true; }},
  // legendaries change how a run plays rather than adding stats; their effects live in powers.js
  ...[
    {id: 'stormsigil', name: "Stormcaller's Sigil", icon: 'bolt', text: r => `Every 4th skill you cast calls lightning onto ${r >= 2.5 ? 4 : 3} nearby enemies for ${Math.round(45 * r)} damage`},
    {id: 'greaves', name: 'Thunderstep Greaves', icon: 'shoe', text: r => `Evading releases a shockwave that deals ${Math.round(35 * r)} damage and hurls enemies back`},
    {id: 'carrion', name: 'Carrion Bloom', icon: 'plant', text: r => `Kills have a ${Math.round(15 * r)}% chance to burst, dealing ${Math.round(40 * r)} damage around the corpse. Bursts can chain.`},
    {id: 'tyrant', name: "Tyrant's Crown", icon: 'crown', text: r => `Killing an elite takes ${Math.round(Math.min(1, .35 * r) * 100)}% off your ultimate's cooldown`},
    {id: 'winter', name: 'Heart of Winter', icon: 'snowflake', text: r => `When you are hit, ${Math.round(Math.min(.6, .25 * r) * 100)}% chance to freeze every enemy near you (once per 4s)`},
    {id: 'tome', name: 'Tome of Echoes', icon: 'book', text: r => `Skills have a ${Math.round(15 * r)}% chance to cast twice`},
    {id: 'trophy', name: 'Trophy Belt', icon: 'medal', text: r => `Every elite you kill this run gives +${(2 * r).toFixed(1)}% damage, with no cap`},
  ].map(x => ({...x, legend: true, apply: (h, r) => { h.legend[x.id] = r; }})),
];
export const relicDef = id => RELICS.find(r => r.id === id);
export const relicSlots = () => 1 + (save.stats.wins > 0 ? 1 : 0);
export function toggleEquip(id) {
  const eq = save.equipped, n = relicSlots(), at = eq.indexOf(id);
  if (at >= 0) eq[at] = null;
  else { let k = eq.slice(0, n).indexOf(null); if (k < 0) k = n - 1; eq[k] = id; }
  persist();
}

// ---------- tiers ----------
// Beating the final boss on a tier unlocks the next. Enemies get tougher; XP, relic odds and rarity all improve.
export const TIERS = [
  {name: 'Normal', mul: 1, xp: 1, relic: .3, rar: 0},
  {name: 'Hard', mul: 1.35, xp: 1.3, relic: .4, rar: .1},
  {name: 'Nightmare', mul: 1.8, xp: 1.7, relic: .5, rar: .2},
  {name: 'Torment I', mul: 2.4, xp: 2.2, relic: .6, rar: .3},
  {name: 'Torment II', mul: 3.2, xp: 3, relic: .7, rar: .45},
];
export const tierDef = t => TIERS[t - 1];
export function bossRelicChance(tier, biome, bonus = 0) { return biome >= 3 ? 1 : Math.min(1, tierDef(tier).relic + biome * .1 + bonus); }
export const miniRelicChance = (tier, bonus = 0) => .06 + .03 * (tier - 1) + bonus / 3;
export function rollRelic(tier) {
  const R = tierDef(tier).rar, x = Math.random();
  const rarity = x < .03 + R * .3 ? 'prismatic' : x < .2 + R ? 'gold' : 'silver';
  const w = r => r.legend ? .2 + R : 1; let y = Math.random() * RELICS.reduce((a, r) => a + w(r), 0), pickd = RELICS[0];
  for (const r of RELICS) { y -= w(r); if (y <= 0) { pickd = r; break; } }
  return {id: pickd.id, rarity};
}

// ---------- omens ----------
// From tier 2, each run rolls rule changes shown in camp before you enter. Every omen adds +15% class XP and +5% relic chance.
export const OMENS = [
  {id: 'frenzied', name: 'Frenzied', icon: 'run', text: 'Enemies move 20% faster.', enemy: e => { e.speed *= 1.2; }},
  {id: 'brutal', name: 'Brutal', icon: 'sword', text: 'Enemies deal 30% more damage.', enemy: e => { e.dmg *= 1.3; }},
  {id: 'fortified', name: 'Fortified', icon: 'shield', text: 'Elites and bosses have 40% more health.', enemy: e => { if (e.elite) { e.max = Math.round(e.max * 1.4); e.hp = Math.round(e.hp * 1.4); } }},
  {id: 'volatile', name: 'Volatile', icon: 'bomb', text: 'Enemies burst a second after they die. Stay off the corpses.'},
  {id: 'drained', name: 'Drained', icon: 'bottle', text: 'You start with 2 fewer potions and no health regeneration.', hero: h => { h.potions = Math.max(1, h.potions - 2); h.potMax = Math.max(1, h.potMax - 2); h.stats.regen = 0; }},
];
export const OMEN_COUNT = [0, 1, 1, 2, 3], OMEN_XP = .15, OMEN_RELIC = .05;
export const omenDef = id => OMENS.find(o => o.id === id);
// the omens for the next run on the selected tier, rolled once and kept until that run is played
export function nextOmens() {
  const n = OMEN_COUNT[save.tier - 1];
  if (!save.omens || save.omens.tier !== save.tier || save.omens.ids.length !== n) {
    save.omens = {tier: save.tier, ids: [...OMENS].sort(() => Math.random() - .5).slice(0, n).map(o => o.id)}; persist();
  }
  return save.omens.ids;
}

// ---------- run start / end ----------
export function applyLoadout(h) {
  const I = classInfo(h.id);
  for (const b of TREES[h.id]) for (const n of b.rows.flat()) {
    const r = I.talents[n.id] || 0; if (!r) continue;
    if (n.pas) { h.pas[n.pas] = true; const p = PASSIVES[h.id].find(x => x.id === n.pas); p.apply && p.apply(h); }
    else STAT[n.stat].apply(h, STAT[n.stat].per * r);
  }
  h.relics = []; h.legend = {};
  for (const id of save.equipped.slice(0, relicSlots())) { const o = id && save.relics[id]; if (!o) continue; relicDef(id).apply(h, RMUL[o.rarity]); h.relics.push({id, rarity: o.rarity}); }
  h.hp = h.maxHp;
}
// Bank a haul. Extracting or winning keeps everything; dying keeps DEATH_KEEP of the XP and no relics.
export function bank(cls, haul, outcome) {
  const keep = outcome === 'death' ? DEATH_KEEP : 1, xp = Math.round(haul.xp * keep), before = classInfo(cls).level;
  const ups = addClassXp(cls, xp), got = [];
  if (outcome !== 'death') for (const r of haul.relics) {
    const have = save.relics[r.id];
    if (!have) { save.relics[r.id] = {rarity: r.rarity}; got.push({...r, how: 'new'}); }
    else { const up = Math.max(RAR.indexOf(have.rarity) + 1, RAR.indexOf(r.rarity)); if (up <= 2) { have.rarity = RAR[up]; got.push({id: r.id, rarity: have.rarity, how: 'upgraded'}); } else { addClassXp(cls, 150); got.push({...r, how: 'salvaged'}); } }
  }
  const S = save.stats; S.runs++; S.bosses += haul.bosses || 0;
  if (outcome === 'death') S.deaths++; else if (outcome === 'extract') S.extracts++;
  let unlocked = null;
  if (outcome === 'win') { S.wins++; if (haul.tier === save.maxTier && save.maxTier < TIERS.length) { save.maxTier++; unlocked = save.maxTier; } }
  save.last = cls; save.omens = null; persist();
  return {xp, lost: haul.xp - xp, lostRelics: outcome === 'death' ? haul.relics : [], got, ups, level: before + ups, unlocked};
}
