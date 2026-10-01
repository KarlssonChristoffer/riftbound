// The camp between runs (class pick, talents, relics, difficulty tier), the haul you carry during a run,
// the extract-or-push-on choice after each boss, and banking the haul when the run ends.
import {THREE, G, V, after, fx, parts, shockwave, add, glow, glowSprite, place, worldUI, dist2, rand, TAU} from './core.js';
import {CLASSES} from './entities.js';
import {BIOMES} from './biomes.js';
import {sfx} from './audio.js';
import * as M from './meta.js';
import * as P from './powers.js';
import * as Syn from './synergy.js';

const $ = s => document.querySelector(s);
const RCOL = {silver: 'var(--silver)', gold: 'var(--gold)', prismatic: 'var(--prismatic)'}, RHEX = {silver: 0xc9d1dc, gold: 0xffc24a, prismatic: 0xe27bff};
const cap1 = s => s[0].toUpperCase() + s.slice(1);
// legendaries show in Diablo orange whatever their rarity; the rarity still scales their numbers
const LEG = '#ff8a2a', rc = r => M.relicDef(r.id).legend ? LEG : RCOL[r.rarity], rhex = r => M.relicDef(r.id).legend ? 0xff8a2a : RHEX[r.rarity];
const rname = r => (M.relicDef(r.id).legend ? 'Legendary · ' : '') + cap1(r.rarity);
let startFn = null, sel = null, wipeArmed = false, focusKey = null;

export function initHub(start) {
  startFn = start;
  const base = G.diff; G.diff = () => base() * (G.run.tierMul || 1); // difficulty tier scales everything the biome already scales
  const hurt = G.onHeroHurt; G.onHeroHurt = amt => { hurt && hurt(amt); P.onHurt(amt); };
  $('#menu').addEventListener('click', e => { const el = e.target.closest('[data-nav]'); if (el) act(el.dataset.nav, false); });
  $('#menu').addEventListener('contextmenu', e => { const el = e.target.closest('[data-nav]'); e.preventDefault(); if (el) act(el.dataset.nav, true); });
  renderHub();
}
export function showHub() { wipeArmed = false; renderHub(); }

function act(key, alt) {
  const [k, a, b, c] = key.split(':');
  if (k === 'cls') { sel = a; M.save.last = a; M.persist(); }
  else if (k === 't') { const bi = +a, row = +b, n = M.TREES[sel][bi].rows[row][+c]; if ((alt ? M.removeRank : M.addRank)(sel, bi, row, n)) sfx(alt ? 'flip' : 'pick'); }
  else if (k === 'reset') M.resetTalents(sel);
  else if (k === 'r') { M.toggleEquip(a); sfx('flip'); }
  else if (k === 'tier') { M.save.tier = +a; M.persist(); }
  else if (k === 'wipe') { if (!wipeArmed) { wipeArmed = true; renderHub(); return; } M.resetSave(); sel = null; }
  else if (k === 'enter') { startFn(sel); return; }
  wipeArmed = false; renderHub();
}

function renderHub() {
  const S = M.save; sel = sel || (CLASSES[S.last] ? S.last : 'pyromancer'); S.tier = Math.min(S.tier, S.maxTier);
  $('#hubstats').innerHTML = `Runs <b>${S.stats.runs}</b> · Extractions <b>${S.stats.extracts}</b> · Deaths <b>${S.stats.deaths}</b> · Rift sealed <b>${S.stats.wins}</b>`;
  // classes
  $('#classes').innerHTML = Object.entries(CLASSES).map(([id, c]) => {
    const I = M.classInfo(id), w = I.level >= M.CLASS_MAX ? 100 : I.xp / I.need * 100;
    return `<div class="cls${id === sel ? ' sel' : ''}" data-nav="cls:${id}" style="--c:${c.color}"><h3>${c.name}</h3><p>${c.blurb}</p>
      <div class="clv">Lv ${I.level}<i><u style="width:${w}%"></u></i>${I.level >= M.CLASS_MAX ? 'max' : `${I.xp} / ${I.need}`}${I.points > 0 ? `<span class="pts">+${I.points}</span>` : ''}</div></div>`;
  }).join('');
  // talents
  const C = CLASSES[sel], I = M.classInfo(sel);
  const tree = M.TREES[sel].map((b, bi) => {
    const rows = b.rows.map((row, ri) => (ri ? `<div class="gate">${M.ROW_GATE[ri]} points in the rows above</div>` : '') + `<div class="trow">${row.map((n, ni) => {
      const s = M.nodeState(sel, bi, ri, n), cls = ['node', s.rank ? 'has' : '', s.canAdd ? 'can' : '', !s.open ? 'locked' : '', n.pas ? 'cap' : ''].join(' ');
      return `<button class="${cls}" data-nav="t:${bi}:${ri}:${ni}"><i class="ti ti-${n.icon}"></i><div><b>${n.name}</b><small>${M.nodeText(n)}</small></div><em>${s.rank}/${n.max}</em></button>`;
    }).join('')}</div>`).join('');
    return `<div class="branch"><h4><i class="ti ti-${b.icon}"></i>${b.name}<span>${M.branchSpent(sel, bi)}</span></h4>${rows}</div>`;
  }).join('');
  $('#talents').style.setProperty('--c', C.color);
  $('#talents').innerHTML = `<h2><i class="ti ti-binary-tree" style="color:${C.color}"></i>${C.name} talents<small class="pts"><b>${I.points}</b> point${I.points === 1 ? '' : 's'} to spend · 1 per class level</small>${I.spent ? '<button class="btn" data-nav="reset">Reset</button>' : ''}</h2>
    <div class="tree">${tree}</div><p class="none" style="margin-top:8px">Click to add a point, right-click to take one back. Capstones start every run with that passive.</p>`;
  // relics
  const slots = M.relicSlots(), owned = Object.entries(S.relics);
  const slotHtml = [0, 1].map(i => {
    if (i >= slots) return `<div class="rslot"><i class="ti ti-lock"></i>Seal the Rift once to unlock a second slot</div>`;
    const id = S.equipped[i], o = id && S.relics[id], d = o && M.relicDef(id);
    const col = o && rc({id, rarity: o.rarity});
    return o ? `<div class="rslot full" style="border-color:${col}"><i class="ti ti-${d.icon}" style="font-size:22px;color:${col}"></i><div><b style="color:#f3eee6">${d.name}</b><br>${d.text(M.RMUL[o.rarity])}</div></div>` : `<div class="rslot"><i class="ti ti-circle-dashed"></i>Empty slot</div>`;
  }).join('');
  const inv = owned.length ? owned.map(([id, o]) => { const d = M.relicDef(id), on = S.equipped.slice(0, slots).includes(id);
    return `<button class="relic${on ? ' on' : ''}${d.legend ? ' leg' : ''}" data-nav="r:${id}" style="--r:${rc({id, rarity: o.rarity})}"><i class="ti ti-${d.icon}"></i><div><b>${d.name}</b><small>${rname({id, rarity: o.rarity})} · ${d.text(M.RMUL[o.rarity])}</small></div></button>`; }).join('')
    : '<p class="none">No relics yet. Bosses can drop them. Extract alive to keep them. A duplicate upgrades the rarity of the one you have.</p>';
  $('#relics').innerHTML = `<h2><i class="ti ti-diamond" style="color:var(--gold)"></i>Relics<small>shared by all classes</small></h2><div class="relslots">${slotHtml}</div><div class="rinv">${inv}</div>`;
  // tiers
  const T = M.tierDef(S.tier), up = Math.round((T.mul - 1) * 100), om = M.nextOmens().map(M.omenDef);
  const omens = om.length ? `<div class="omens"><div class="gate">Omens for this run</div>${om.map(o => `<div class="omen"><i class="ti ti-${o.icon}"></i><div><b>${o.name}</b><small>${o.text}</small></div></div>`).join('')}<div class="orew">Omen bonus: <b>+${Math.round(om.length * M.OMEN_XP * 100)}%</b> class XP, <b>+${Math.round(om.length * M.OMEN_RELIC * 100)}%</b> relic chance</div></div>` : '';
  $('#tiers').innerHTML = `<h2><i class="ti ti-skull" style="color:#ff5a3a"></i>Difficulty</h2>
    <div class="tiers">${M.TIERS.map((t, i) => `<button class="tier${i + 1 === S.tier ? ' sel' : ''}" data-nav="tier:${i + 1}" ${i + 1 > S.maxTier ? 'disabled' : ''}>${i + 1}</button>`).join('')}</div>
    <div class="tinfo"><b>Tier ${S.tier} · ${T.name}</b><br>${up ? `Enemies have <b>+${up}%</b> health and damage` : 'Base enemy strength'}<br>Class XP <b>×${T.xp}</b> · boss relic chance <b>${Math.round(T.relic * 100)}%</b>, +10% per biome<br>The final boss always drops a relic${T.rar ? ' · <b>better rarity</b>' : ''}
    ${S.maxTier < M.TIERS.length ? `<br><span style="color:#8f877c">Seal the Rift on tier ${S.maxTier} to unlock tier ${S.maxTier + 1}.</span>` : ''}${S.tier === 1 && S.maxTier > 1 ? '<br><span style="color:#8f877c">Omens start at tier 2.</span>' : ''}</div>${omens}`;
  $('#enter').innerHTML = `Enter the Rift · ${C.name}`;
  $('#wipe').textContent = wipeArmed ? 'Click again to wipe all progress' : 'Reset save'; $('#wipe').classList.toggle('armed', wipeArmed);
  refocus();
}

// ---------- during a run ----------
export function runStart(h) {
  const tier = Math.min(M.save.tier, M.save.maxTier), T = M.tierDef(tier);
  Object.assign(G.run, {tier, tierMul: T.mul, omens: M.nextOmens(), haul: {xp: 0, relics: [], bosses: 0, tier}});
  Syn.init(h); Syn.resetHud(); M.applyLoadout(h); P.omenHero(h); h.hp = h.maxHp; lastHaul = ''; clearLoot();
}
const omenBonus = () => G.run.omens.length;
G.onXp = amt => { if (G.run && G.run.haul) G.run.haul.xp += amt * .25 * M.tierDef(G.run.tier).xp * (1 + omenBonus() * M.OMEN_XP); };
export function onKill(e) {
  P.onKill(e); Syn.onKill(e);
  const H = G.run.haul, bonus = omenBonus() * M.OMEN_RELIC; let chance = 0;
  if (e.tier === 'boss') { H.bosses++; chance = M.bossRelicChance(G.run.tier, G.run.biome, bonus); }
  else if (e.tier === 'mini') chance = M.miniRelicChance(G.run.tier, bonus);
  if (Math.random() >= chance) return;
  const r = M.rollRelic(G.run.tier), p = e.g.position.clone();
  after(e.boss ? 1.2 : .8, () => dropLoot(r, p));
}

// ---------- loot on the ground: a relic pops out of the boss, sits under a light beam in its colour, and you walk over it ----------
let loot = [];
const gemGeo = new THREE.OctahedronGeometry(.34), beamGeo = new THREE.CylinderGeometry(.14, .14, 18, 12, 1, true);
function dropLoot(r, from) {
  const col = rhex(r), d = M.relicDef(r.id), g = new THREE.Group(); G.scene.add(g);
  let to = null; for (let k = 0; k < 10 && !to; k++) { const a = rand(0, TAU), q = V(from.x + Math.cos(a) * 2.2, 0, from.z + Math.sin(a) * 2.2); if (G.map.walkable(q.x, q.z)) to = q; }
  to = to || from.clone(); g.position.copy(from);
  const beam = add(g, beamGeo, glow(col, 2.2, {add: true, ds: true}), 0, 9, 0); beam.material.opacity = 0;
  const gem = add(g, gemGeo, glow(col, 5), 0, 2, 0), s = glowSprite(col, 3, 2.6); g.add(s);
  const el = document.createElement('div'); el.className = 'lootlbl'; el.style.color = rc(r); el.innerHTML = `${d.name}<small>${rname(r)}</small>`; worldUI.appendChild(el);
  const L = {r, g, gem, s, beam, el, ready: false}; loot.push(L);
  sfx('land', {rarity: d.legend ? 'prismatic' : r.rarity}); parts.burst(V(from.x, 1.5, from.z), 60, {col, b: 4, speed: 5, life: .8, size: .3, up: 4});
  fx(.7, k => { g.position.lerpVectors(from, to, k); gem.position.y = .9 + Math.sin(k * Math.PI) * 2.4; }, () => {
    L.ready = true; shockwave(to, col, 2.5, .5, 4); fx(.5, k => { beam.material.opacity = .45 * k; });
  });
  G.toast(d.legend ? `Legendary! ${d.name}` : `A relic dropped: ${d.name}`);
}
function pickUp(L, quiet) {
  G.run.haul.relics.push(L.r); L.g.parent && L.g.parent.remove(L.g); L.el.remove();
  if (!quiet) { const p = L.g.position, col = rhex(L.r); parts.burst(V(p.x, 1, p.z), 80, {col, b: 4, speed: 4, life: .8, size: .28, up: 5, grav: -1}); shockwave(p, col, 3, .5, 4); sfx('pick'); G.toast(`Picked up ${M.relicDef(L.r.id).name}`); }
}
function clearLoot() { for (const L of loot) { L.g.parent && L.g.parent.remove(L.g); L.el.remove(); } loot = []; }
// relics you walked past are picked up on the way out, so leaving through the portal never loses loot
function sweepLoot() { const n = loot.length; for (const L of loot) pickUp(L, true); loot = []; return n; }
export function update(dt, t) {
  P.omenEnemies(); Syn.update(dt); Syn.hud($('#syn'));
  const h = G.hero; if (!h) return;
  for (const L of loot) {
    L.gem.rotation.y += dt * 2; if (L.ready) L.gem.position.y = .9 + Math.sin(t * 3) * .12; L.s.position.y = L.gem.position.y;
    place(L.el, L.g.position.clone().setY(2));
    if (L.ready && !h.dead && dist2(L.g.position, h.g.position) < 1.4) { pickUp(L); L.done = true; }
  }
  loot = loot.filter(L => !L.done);
}
let lastHaul = '';
export function hudHaul() {
  const H = G.run.haul, s = `<i class="ti ti-backpack"></i> ${Math.round(H.xp)} class xp${H.relics.map(r => `<span class="rl" style="background:${rc(r)}"></span>`).join('')}<br><span class="tr">Tier ${G.run.tier}${G.run.omens.length ? ' · ' + G.run.omens.map(id => M.omenDef(id).name).join(', ') : ''} · unbanked</span>`;
  if (s !== lastHaul) { $('#haul').innerHTML = s; lastHaul = s; }
}
export const synChips = h => Syn.chips(h);
G.takeSyn = (h, c, R) => Syn.take(h, c, R);
export const relicChips = h => (h.relics || []).map(r => `<span class="chip" style="border-color:${rc(r)}">${M.relicDef(r.id).name}</span>`).join('');
const relicRow = (r, lost) => { const d = M.relicDef(r.id); return `<div class="hl${lost ? ' lost' : ''}" style="--r:${rc(r)}"><i class="ti ti-${d.icon}"></i>${d.name}<em>${rname(r)}</em></div>`; };
const haulRows = H => `<div class="hl"><i class="ti ti-sparkles"></i>${Math.round(H.xp)} ${CLASSES[G.run.cls].name} XP</div>` + H.relics.map(r => relicRow(r)).join('');

// after a boss (not the last): bank everything now, or risk the haul for a deeper biome
export function offerExtract(next, push, extract) {
  const swept = sweepLoot();
  if (window.__hub.autoPush) return push(); // test bots always go deeper
  const H = G.run.haul, B = BIOMES[next], ch = Math.round(M.bossRelicChance(G.run.tier, next, omenBonus() * M.OMEN_RELIC) * 100);
  if (swept) G.toast(`Picked up ${swept} relic${swept > 1 ? 's' : ''} on the way out`);
  G.paused = true;
  $('#exhaul').innerHTML = haulRows(H);
  $('#exgo').innerHTML = `<i class="ti ti-home"></i> Extract<small>Bank everything and return to camp</small>`;
  $('#expush').innerHTML = `<i class="ti ti-door-enter"></i> Push on to ${B.name}<small>Tougher enemies · more XP · ${ch}% relic chance</small>`;
  $('#exrisk').textContent = `If you die further in, you lose ${H.relics.length ? `${H.relics.length === 1 ? 'the relic' : 'all ' + H.relics.length + ' relics'} and ` : ''}${Math.round((1 - M.DEATH_KEEP) * 100)}% of the XP.`;
  const close = () => { $('#extract').classList.add('hidden'); G.paused = false; };
  $('#exgo').onclick = () => { close(); extract(); };
  $('#expush').onclick = () => { close(); push(); };
  $('#extract').classList.remove('hidden'); focusKey = null; refocus();
}
// bank the haul and describe what happened, for the end screen
export function bankRun(outcome) {
  if (outcome === 'death') clearLoot(); else sweepLoot();
  const H = G.run.haul, r = M.bank(G.run.cls, H, outcome), C = CLASSES[G.run.cls];
  let out = `<div class="bankbox" style="margin-top:14px">`;
  if (outcome === 'death') out += `<div class="hl"><i class="ti ti-sparkles"></i>${r.xp} XP salvaged<em>${Math.round(M.DEATH_KEEP * 100)}% kept</em></div><div class="hl lost"><i class="ti ti-sparkles"></i>${r.lost} XP</div>` + r.lostRelics.map(x => relicRow(x, true)).join('');
  else out += `<div class="hl"><i class="ti ti-sparkles"></i>${r.xp} ${C.name} XP banked</div>` + r.got.map(g => { const d = M.relicDef(g.id); return `<div class="hl" style="--r:${rc(g)}"><i class="ti ti-${d.icon}"></i>${d.name}<em>${g.how === 'new' ? 'new · ' + rname(g) : g.how === 'upgraded' ? 'upgraded to ' + g.rarity : 'duplicate · +150 XP'}</em></div>`; }).join('');
  if (r.ups) out += `<div class="hl" style="--r:#ffd84a"><i class="ti ti-arrow-big-up-lines"></i>${C.name} reached level ${r.level}<em>+${r.ups} talent point${r.ups > 1 ? 's' : ''}</em></div>`;
  if (r.unlocked) out += `<div class="hl" style="--r:#ff5a3a"><i class="ti ti-skull"></i>Tier ${r.unlocked} (${M.tierDef(r.unlocked).name}) unlocked</div>`;
  if (outcome === 'win' && M.save.stats.wins === 1) out += `<div class="hl" style="--r:var(--gold)"><i class="ti ti-diamond"></i>Second relic slot unlocked</div>`;
  return out + '</div>';
}

// ---------- controller: spatial navigation over [data-nav] elements of whichever overlay is open ----------
function refocus() { if (G.inputMode !== 'pad') return; const el = focusKey && document.querySelector(`[data-nav="${focusKey}"]`); document.querySelectorAll('[data-nav].focus').forEach(e => e.classList.remove('focus')); if (el) el.classList.add('focus'); }
export function clearFocus() { document.querySelectorAll('[data-nav].focus').forEach(e => e.classList.remove('focus')); }
export function padNav(navDir, a, x) {
  const root = ['#extract', '#over', '#menu'].map(s => $(s)).find(e => !e.classList.contains('hidden')); if (!root) return;
  const els = [...root.querySelectorAll('[data-nav]')].filter(e => !e.disabled && e.offsetParent); if (!els.length) return;
  let cur = els.find(e => e.dataset.nav === focusKey) || els.find(e => e.dataset.nav === 'enter') || els[0];
  const n = navDir();
  if (n) {
    const r = cur.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2; let best = null, bs = 1e9;
    for (const e of els) {
      if (e === cur) continue; const q = e.getBoundingClientRect(), dx = q.x + q.width / 2 - cx, dy = q.y + q.height / 2 - cy;
      const along = n.x ? dx * n.x : dy * n.y, perp = n.x ? Math.abs(dy) : Math.abs(dx); if (along <= 4) continue;
      const sc = along + perp * 2.5; if (sc < bs) { bs = sc; best = e; }
    }
    if (best) cur = best;
  }
  focusKey = cur.dataset.nav; refocus(); if (n) cur.scrollIntoView({block: 'nearest'});
  if (a) cur.click(); else if (x) cur.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true}));
}
// debug / bot handles: __hub.start('ranger') or __hub.start(2) starts a run from the hub; autoPush skips the extraction prompt
window.__meta = M;
window.__hub = {start: c => startFn(typeof c === 'number' ? Object.keys(CLASSES)[c] : c), autoPush: false, get loot() { return loot; }};
