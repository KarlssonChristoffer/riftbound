// Build archetypes: reward cards that feed each other. Each archetype has enablers (start it), amplifiers (scale it,
// stack forever) and one payoff that only shows up once you have committed. Bridge cards need a card from two
// archetypes and are where the absurd runs come from. Owning cards of an archetype makes more of them show up.
//   Burn: stacking burn that ticks for (stacks x damage).     Crit: crit chance, crit damage, crit triggers.
//   On-hit: chance-based procs (lightning, seeking missiles). Procs carry a proc coefficient like Risk of Rain:
//           burn ticks can never proc, and procs only trigger further procs once you own Feedback Loop.
import {G, V, C, rand, after, parts, shockwave, bolt, flashLight, dist2, dmgNum} from './core.js';
import {damage, alive, center, projectile} from './combat.js';
import {sfx} from './audio.js';

export const ARCH = {
  burn: {name: 'Burn', color: '#ff7a2f', icon: 'flame'},
  crit: {name: 'Crit', color: '#ffd84a', icon: 'target-arrow'},
  onhit: {name: 'On-hit', color: '#8fc8ff', icon: 'bolt'},
};
// set bonuses at 3 and 6 cards of an archetype (bridges count for both sides)
export const SETS = {
  burn: ['Burn stacks cap +5', 'Burning enemies pass their stacks on when they die'],
  crit: ['+20% crit damage', 'Crits take 0.2s off all skill cooldowns'],
  onhit: ['+10% proc chance', 'Procs deal +50% damage'],
};
const RMUL = {silver: 1, gold: 1.6, prismatic: 2.5};
const pc = v => Math.round(v * 100) + '%';
const card = (id, arch, role, name, icon, text, take, o = {}) => ({id, arch: [].concat(arch), role, name, icon, text, take, ...o});
export const CARDS = [
  // ---- burn ----
  card('kindle', 'burn', 'enabler', 'Kindling Touch', 'flame', r => `Your basic attacks add ${Math.round(r)} burn stack${r >= 2 ? 's' : ''} per hit`, (s, r) => { s.burnHit += Math.round(r); }),
  card('oilflask', 'burn', 'enabler', 'Oil Flask', 'flask', r => `Your skills add ${Math.round(3 * r)} burn stacks per hit`, (s, r) => { s.burnSkill += Math.round(3 * r); }),
  card('fuel', 'burn', 'amp', 'Fuel', 'gas-station', r => `Burn stacks deal +${pc(.4 * r)} damage`, (s, r) => { s.burnDmg += .4 * r; }),
  card('embers', 'burn', 'amp', 'Deep Embers', 'flame', r => `+${Math.round(4 * r)} max burn stacks, and burns last 2s longer`, (s, r) => { s.burnMax += Math.round(4 * r); s.burnDur += 2; }),
  card('accel', 'burn', 'amp', 'Accelerant', 'droplet', r => `Enemies take +${(1.5 * r).toFixed(1)}% damage from everything per burn stack`, (s, r) => { s.burnVuln += .015 * r; }),
  card('wildfire', 'burn', 'payoff', 'Wildfire', 'flame', () => 'When burn reaches max stacks it detonates: all remaining burn damage at once, and half the stacks spread to enemies nearby', s => { s.wildfire = true; }, {once: true}),
  // ---- crit ----
  card('keen', 'crit', 'enabler', 'Keen Edge', 'target', r => `+${pc(.08 * r)} crit chance`, (s, r, h) => { h.stats.crit += .08 * r; }),
  card('precision', 'crit', 'enabler', 'Precision', 'crosshair', () => 'Your first hit on every enemy is always a crit', s => { s.precision = true; }, {once: true}),
  card('brutal', 'crit', 'amp', 'Brutal Force', 'hammer', r => `+${pc(.3 * r)} crit damage`, (s, r) => { s.critDmg += .3 * r; }),
  card('vicious', 'crit', 'amp', 'Vicious', 'bandage', r => `Crits expose the target: it takes +20% damage for ${(2 * r).toFixed(1)}s`, (s, r) => { s.vicious = Math.max(s.vicious, 2 * r); }),
  card('executioner', 'crit', 'amp', 'Executioner', 'skull', r => `+${pc(.1 * r)} crit chance and +${pc(.25 * r)} crit damage against elites and bosses`, (s, r) => { s.eliteCrit += .1 * r; s.eliteCritDmg += .25 * r; }),
  card('overcrit', 'crit', 'payoff', 'Overcrit', 'stars', () => '+25% crit chance. Crit chance above 100% becomes a chance to crit again for triple damage', (s, r, h) => { s.overcrit = true; h.stats.crit += .25; }, {once: true}),
  // ---- on-hit ----
  card('quick', 'onhit', 'enabler', 'Quick Hands', 'hand-finger', r => `Your basic attack is ${pc(.15 * r)} faster`, (s, r, h) => { h.stats.aspd = (h.stats.aspd || 1) + .15 * r; }),
  card('coil', 'onhit', 'enabler', 'Static Coil', 'bolt', r => `Hits have a ${pc(.12 * r)} chance to call lightning on the target and 2 enemies nearby`, (s, r) => { s.zap += .12 * r; }),
  card('seeker', 'onhit', 'enabler', 'Seeker Rounds', 'rocket', r => `Hits have a ${pc(.08 * r)} chance to fire a seeking missile for 150% of the hit`, (s, r) => { s.missile += .08 * r; }),
  card('resonance', 'onhit', 'amp', 'Resonance', 'wave-sine', r => `Procs deal +${pc(.4 * r)} damage`, (s, r) => { s.procDmg += .4 * r; }),
  card('clover', 'onhit', 'amp', 'Four-Leaf Clover', 'clover', r => `All proc chances x${(1 + .25 * r).toFixed(2)}`, (s, r) => { s.procMul *= 1 + .25 * r; }),
  card('chain', 'onhit', 'payoff', 'Feedback Loop', 'affiliate', () => 'Procs can trigger other procs (lightning at half the odds, missiles at full), up to 5 links deep', s => { s.chain = true; }, {once: true}),
  // ---- bridges ----
  card('searing', ['burn', 'crit'], 'bridge', 'Searing Crits', 'flame', () => 'Crits add 3 burn stacks, and burn ticks can crit', s => { s.searing = true; }, {once: true}),
  card('livewire', ['crit', 'onhit'], 'bridge', 'Live Wire', 'bolt', () => 'Procs can crit, and crits double your proc chances', s => { s.livewire = true; }, {once: true}),
  card('incendiary', ['onhit', 'burn'], 'bridge', 'Incendiary Rounds', 'rocket', () => 'Procs add 2 burn stacks, and procs are 30% more likely against burning enemies', s => { s.incendiary = true; }, {once: true}),
];
const cardDef = id => CARDS.find(c => c.id === id);

export function init(h) {
  h.sy = {taken: {}, burnHit: 0, burnSkill: 0, burnDmg: 0, burnMax: 10, burnDur: 4, burnVuln: 0, wildfire: false,
    precision: false, critDmg: 0, vicious: 0, eliteCrit: 0, eliteCritDmg: 0, overcrit: false,
    zap: 0, missile: 0, procDmg: 0, procMul: 1, chain: false, searing: false, livewire: false, incendiary: false};
}
// cards owned per archetype; the older items and passives that already fit an archetype count toward it
export function counts(h) {
  const n = {burn: 0, crit: 0, onhit: 0}, s = h.sy; if (!s) return n;
  for (const id in s.taken) for (const a of cardDef(id).arch) n[a] += s.taken[id];
  n.burn += (h.items.ember || 0) + (h.pas.combustion ? 1 : 0) + (h.pas.pyroclasm ? 1 : 0);
  n.crit += (h.items.lens || 0);
  return n;
}
const setLv = (h, a) => { const c = counts(h)[a]; return c >= 6 ? 2 : c >= 3 ? 1 : 0; };

// ---------- offering cards (called from cards.js) ----------
G.synCards = h => {
  if (!h.sy) return []; const n = counts(h), tags = h.tags(), out = [];
  const flavor = {burn: tags.has('fire') ? 1.5 : 1, crit: tags.has('melee') || tags.has('void') ? 1.3 : 1, onhit: tags.has('projectile') || tags.has('storm') ? 1.3 : 1};
  for (const c of CARDS) {
    if (c.once && h.sy.taken[c.id]) continue;
    const a = c.arch[0], A = ARCH[a]; let w, minR;
    if (c.role === 'payoff') { if (n[a] < 3) continue; w = 3; minR = 'prismatic'; }
    else if (c.role === 'bridge') { if (!c.arch.every(x => n[x] >= 1)) continue; w = 2.2; minR = 'gold'; }
    else w = (c.role === 'enabler' ? 1.5 : n[a] ? 1.2 : .4) * (1 + .7 * n[a]) * flavor[a]; // momentum: the more you own, the more you see
    const label = c.role === 'bridge' ? c.arch.map(x => ARCH[x].name).join(' + ') : `${A.name} ${c.role === 'amp' ? 'amplifier' : c.role}`;
    out.push({type: 'synergy', syn: c, w, minR, icon: c.icon, color: c.role === 'bridge' ? '#ffffff' : A.color, name: c.name, label, get text() { return c.text(RMUL[this.rarity] || 1); }});
  }
  return out;
};
export function take(h, c, R) {
  const before = {}; for (const a in ARCH) before[a] = setLv(h, a);
  h.sy.taken[c.id] = (h.sy.taken[c.id] || 0) + 1; c.take(h.sy, R, h);
  for (const a in ARCH) { const lv = setLv(h, a); if (lv > before[a]) { G.toast && G.toast(`${ARCH[a].name} set (${lv === 1 ? 3 : 6}): ${SETS[a][lv - 1]}`); } }
}

// ---------- damage hooks (called from combat.js damage()) ----------
G.critMod = (e, o, crit) => {
  const s = G.hero && G.hero.sy; if (!s || o.dot) return crit; // (Searing Crits lets burn ticks roll crit by not passing noCrit)
  if (s.precision && !e.precHit) { e.precHit = true; return true; }
  if (!crit && e.elite && s.eliteCrit && Math.random() < s.eliteCrit) return true;
  return crit;
};
G.dmgMod = (e, amt, o, crit) => {
  const h = G.hero, s = h && h.sy; if (!s) return amt;
  if (crit) {
    let cd = 1.8 + s.critDmg + (setLv(h, 'crit') >= 1 ? .2 : 0) + (e.elite ? s.eliteCritDmg : 0); amt *= cd / 1.8;
    if (s.overcrit && h.stats.crit > 1 && Math.random() < h.stats.crit - 1) { amt *= 3; o.overcrit = true; }
  }
  if (e.bst > 0 && s.burnVuln) amt *= 1 + e.bst * s.burnVuln;
  if (e.exposed > G.time) amt *= 1.2;
  return amt;
};
G.onHit = (e, amt, o, crit) => {
  const h = G.hero, s = h && h.sy; if (!s || o.dot) return;
  if (o.overcrit) dmgNum(e.g.position.clone().add(V(0, e.h + .9, 0)), 'OVERCRIT', '#ff4a2a', true);
  // burn stacks
  let st = o.src ? s.burnHit : o.proc === undefined ? s.burnSkill : 0;
  if (crit && s.searing) st += 3; if (o.proc !== undefined && s.incendiary) st += 2;
  if (st) addBurn(e, st);
  if (crit) {
    if (s.vicious) e.exposed = G.time + s.vicious;
    if (setLv(h, 'crit') >= 2) for (let k = 0; k < 4; k++) h.cds[k] = Math.max(0, h.cds[k] - .2);
  }
  // procs: a proc's own coefficient scales its odds of triggering more (0 without Chain Reaction)
  const coef = o.proc ?? 1, depth = o.depth || 0; if (!coef || depth >= 5) return;
  const mul = coef * s.procMul * (s.livewire && crit ? 2 : 1) * (s.incendiary && e.bst > 0 ? 1.3 : 1), flat = setLv(h, 'onhit') >= 1 ? .1 : 0;
  const pd = (1 + s.procDmg) * (setLv(h, 'onhit') >= 2 ? 1.5 : 1);
  if (s.zap && Math.random() < (s.zap + flat) * mul) zap(e, amt * .6 * pd, depth, s);
  if (s.missile && Math.random() < (s.missile + flat) * mul) missile(e, amt * 1.5 * pd, depth, s);
};
function zap(e, dmg, depth, s) {
  const c = center(e), hits = [e, ...G.enemies.filter(x => x !== e && alive(x) && dist2(x.g.position, e.g.position) < 6).slice(0, 2)];
  for (const x of hits) {
    const p = center(x); bolt(V(p.x + .5, 8, p.z - .3), p, .22); parts.burst(p, 18, {col: C.bolt, b: 4, speed: 5, life: .3, size: .18});
    damage(x, dmg, {proc: s.chain ? .5 : 0, depth: depth + 1, noCrit: !s.livewire, col: '#bfe0ff', elem: 'storm'});
  }
  flashLight(c, 0xbfe0ff, 40, .25, 6); sfx('shoot', {elem: 'storm'}, .03);
}
function missile(e, dmg, depth, s) {
  const h = G.hero; if (!h) return;
  projectile({from: center(h).add(V(0, .6, 0)), to: center(e), enemy: alive(e) ? e : null, speed: 15, size: .55, col: 0x8fc8ff, k: 4, li: 16, range: 24, hitAny: true,
    trail: p => parts.emit(p.x, p.y, p.z, rand(-.3, .3), rand(0, .5), rand(-.3, .3), C.bolt, 3, .3, .15, 0, 2),
    onHit: (P, tgt) => { parts.burst(P, 30, {cols: [C.bolt, C.white], b: 4, speed: 5, life: .35, size: .2}); shockwave(P, 0x8fc8ff, 1.2, .3, 3);
      if (tgt && alive(tgt)) damage(tgt, dmg, {proc: s.chain ? 1 : 0, depth: depth + 1, noCrit: !s.livewire, col: '#cfe4ff', elem: 'physical'}); }});
}

// ---------- burn stacks ----------
const TICK = .5, PER = 2.5; // damage per stack per tick, before Fuel
const maxStacks = s => s.burnMax + (setLv(G.hero, 'burn') >= 1 ? 5 : 0);
export function addBurn(e, n) {
  const s = G.hero && G.hero.sy; if (!s || !alive(e)) return;
  const cap = maxStacks(s); e.bst = Math.min(cap, (e.bst || 0) + n); e.bstT = s.burnDur; e.bstTick = e.bstTick || TICK;
  e.burn = Math.max(e.burn, .6); e.burnT = e.burnT || .5; // counts as burning for Combustion, Pyroclasm and the fire visuals
  if (s.wildfire && e.bst >= cap) detonate(e, s);
}
function detonate(e, s) {
  const left = e.bst * PER * (1 + s.burnDmg) * Math.ceil(e.bstT / TICK), spread = Math.floor(e.bst / 2), P = e.g.position.clone(); e.bst = 0;
  shockwave(P, 0xff6a20, 3.5, .45, 5); flashLight(V(P.x, 1.2, P.z), 0xff7a2a, 90, .4, 9); sfx('boom', {}, .06);
  parts.burst(V(P.x, 1, P.z), 90, {cols: [C.fire, C.gold, C.ember], b: 5, speed: 7, life: .6, size: .32, up: 2});
  dmgNum(P.clone().add(V(0, e.h + 1, 0)), 'WILDFIRE', '#ff8a2a', true);
  damage(e, left, {dot: true, noCrit: true, col: '#ff7a2a'});
  after(.12, () => { for (const x of G.enemies) if (x !== e && alive(x) && dist2(x.g.position, P) < 4 + x.radius) addBurn(x, spread); });
}
export function update(dt) {
  const s = G.hero && G.hero.sy; if (!s) return;
  for (const e of G.enemies) {
    if (!(e.bst > 0) || !alive(e)) continue;
    e.bstT -= dt; e.bstTick -= dt;
    if (Math.random() < e.bst * .04) { const c = center(e); parts.emit(c.x + rand(-.35, .35), c.y + rand(-.3, .5), c.z + rand(-.35, .35), 0, rand(1, 2.4), 0, C.fire, 5, .5, .25, -.6, 1); }
    if (e.bstTick <= 0) { e.bstTick = TICK; e.burn = Math.max(e.burn, .6); damage(e, e.bst * PER * (1 + s.burnDmg), {dot: true, burnTick: true, noCrit: !s.searing, col: '#ff9a3c'}); }
    if (e.bstT <= 0) e.bst = 0;
  }
}
// Burn 6: a burning enemy's stacks jump to the nearest enemy when it dies
export function onKill(e) {
  const h = G.hero; if (!h || !h.sy || !(e.bst > 0) || setLv(h, 'burn') < 2) return;
  let best = null, bd = 6; for (const x of G.enemies) { if (x === e || !alive(x)) continue; const d = dist2(x.g.position, e.g.position); if (d < bd) { bd = d; best = x; } }
  if (best) { const n = e.bst; e.bst = 0; bolt(center(e), center(best), .2, 0xff8a2a); addBurn(best, n); }
}

// ---------- HUD: archetype counters and set progress ----------
let last = '';
export function hud(el) {
  const h = G.hero, n = counts(h), rows = Object.keys(ARCH).filter(a => n[a] > 0).map(a => {
    const A = ARCH[a], lv = setLv(h, a), next = lv === 0 ? 3 : 6;
    return `<div class="syr" style="--c:${A.color}"><i class="ti ti-${A.icon}"></i>${A.name}<span>${[1, 2, 3, 4, 5, 6].map(k => `<u class="${k <= n[a] ? 'on' : ''}${k === 3 || k === 6 ? ' gate' : ''}"></u>`).join('')}</span>${lv < 2 ? `<em>${n[a]}/${next}</em>` : '<em>max</em>'}</div>`;
  });
  const s = rows.join(''); if (s !== last) { el.innerHTML = s; el.classList.toggle('hidden', !s); last = s; }
}
export const chips = h => h.sy ? Object.entries(h.sy.taken).map(([id, k]) => { const c = cardDef(id); return `<span class="chip" style="border-color:${c.role === 'bridge' ? '#fff' : ARCH[c.arch[0]].color}">${c.name}${k > 1 ? ' ×' + k : ''}</span>`; }).join('') : '';
export function resetHud() { last = ''; }
