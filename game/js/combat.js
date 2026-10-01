// Combat helpers shared by skills, the hero and enemies.
import {THREE, G, V, rand, clamp, dist2, parts, fx, after, glowSprite, takeLight, freeLight, flashLight, shockwave, scorch, dmgNum, bolt, C} from './core.js';
import {dplay} from './assets.js';
import {sfx} from './audio.js';

export const center = e => e.g.position.clone().add(V(0, e.cy, 0));
export const alive = e => e.dead <= 0 && e.active;
export function nearest(from, ex = [], maxD = 1e9) {
  let b = null, bd = maxD;
  for (const e of G.enemies) { if (!alive(e) || ex.includes(e)) continue; const d = dist2(e.g.position, from); if (d < bd) { bd = d; b = e; } }
  return b;
}
export function inRadius(p, r) { return G.enemies.filter(e => alive(e) && dist2(e.g.position, p) < r + e.radius); }

// Element matchups: every enemy has an element; hitting its weakness deals +50%, its own element -50%.
export const WEAK = {fire: 'frost', frost: 'fire', nature: 'fire', void: 'storm'};
export const RESIST = {fire: ['fire'], frost: ['frost'], nature: ['poison'], void: ['void']};
// base damage from a hero source -> scaled by hero stats, crits, statuses, element matchups, shields and passives
export function damage(e, base, o = {}) {
  if (!alive(e)) return 0;
  if (e.immune > 0) { ccText(e, 'Immune', '#fff2a8'); return 0; }
  const h = G.hero, S = h ? h.stats : {dmg: 1, crit: .1}, P = h ? h.pas : {};
  let amt = base * S.dmg * rand(.9, 1.1) * (h && h.buffs.some(b => b.kind === 'power') ? 1.5 : 1), tag = '';
  let crit = o.crit ?? (!o.noCrit && Math.random() < S.crit);
  if (h && !o.dot) {
    if (h.critShots > 0 && o.src === 'basic') { crit = true; h.critShots--; }
    if (h.ambush) { crit = true; amt *= 2.5; h.ambush = false; }
  }
  if (G.critMod) crit = G.critMod(e, o, crit); // build archetypes (synergy.js)
  if (crit) amt *= 1.8;
  if (e.frozen > 0 && P.shatter) amt *= 2;
  if (e.weak > 0) amt *= 1.2;
  if (e.mark > 0) amt *= 1.2;
  if (e.rooted > 0) amt *= 1.4;
  if (e.staggered > 0) amt *= 1.25;
  if (P.combustion && e.burn > 0 && !o.dot) amt *= 1.25;
  if (o.elem && e.elem) { if (WEAK[e.elem] === o.elem) { amt *= 1.5; tag = ' ▲'; } else if (RESIST[e.elem] && RESIST[e.elem].includes(o.elem)) { amt *= .5; tag = ' ▼'; } }
  if (h && !o.dot) {
    const f = V(Math.sin(e.g.rotation.y), 0, Math.cos(e.g.rotation.y)), toH = V(h.g.position.x - e.g.position.x, 0, h.g.position.z - e.g.position.z).normalize(), facing = f.dot(toH);
    if (e.shield && !(e.stun > 0) && !(e.frozen > 0) && facing > .35) { amt *= .15; tag = ' ⛨'; e.shieldHit = .25; }
    if (P.backstab && facing < -.2) { amt *= 1.5; tag = tag || ' ✦'; }
    if (P.eagleeye) amt *= 1 + Math.min(.3, Math.max(0, dist2(e.g.position, h.g.position) - 4) * .02);
    if (P.huntersmark && !e.marked) { e.marked = true; e.mark = 6; }
  }
  if (G.dmgMod) amt = G.dmgMod(e, amt, o, crit);
  amt = Math.max(1, Math.round(amt)); e.hp -= amt; e.flash = 1; e.aggro = true;
  if (e.dmark > 0) e.markDmg = (e.markDmg || 0) + amt;
  if (o.dir && o.knock) { if (e.boss) { if (o.knock >= 3) addStagger(e, o.knock * STAGGER.knock); } else if (!e.anchored && !isUnstoppable(e)) { const k = V(o.dir.x, 0, o.dir.z); if (k.lengthSq() > 0) e.vel.add(k.normalize().multiplyScalar(o.knock * (e.elite ? .5 : 1))); } }
  dmgNum(e.g.position.clone().add(V(0, e.h + .25, 0)), amt + tag, tag === ' ⛨' ? '#9aa4b0' : tag === ' ▲' ? '#ffe24a' : crit ? '#ffd84a' : (o.col || '#fff'), crit || tag === ' ▲');
  if (h) {
    if (S.lifesteal) h.heal(amt * S.lifesteal);
    if (S.burnOnHit && !o.dot) { e.burn = Math.max(e.burn, 2); e.burnT = e.burnT || .5; }
    if (S.freezeChance && !o.dot && Math.random() < S.freezeChance) cc(e, 'freeze', 1);
  }
  if (G.onHit) G.onHit(e, amt, o, crit);
  if (e.drv && e.hp > 0 && !/atk/.test(e.drv.cur) && !e.boss && !e.busy) dplay(e.drv, 'e_hit', true, 1.7);
  if (!o.dot) sfx(tag === ' ⛨' ? 'block' : crit ? 'crit' : 'hit');
  if (e.onHurt) e.onHurt(e, amt);
  if (e.hp <= 0) G.onKill && G.onKill(e);
  return amt;
}
export function explode(P, o) {
  parts.burst(V(P.x, P.y + .3, P.z), o.n || 90, {cols: o.cols, b: o.b || 5, speed: o.speed || 6, life: o.life || .7, size: o.size || .35, grav: o.grav ?? 3, drag: o.drag ?? 2, up: o.up ?? 1.5});
  shockwave(P, o.col, o.R || 2.5, .45, o.ring ?? 4); if (o.R2) after(.08, () => shockwave(P, o.col, o.R2, .6, (o.ring ?? 4) * .6));
  sfx((o.shake || 0) >= .4 ? 'bigboom' : 'boom', {}, .08);
  flashLight(V(P.x, 1.3, P.z), o.col, o.light || 80, .55, (o.R || 2.5) * 3.5); G.shake = Math.max(G.shake, o.shake || .15); if (o.scorch) scorch(P, o.scorch);
  if (o.dmg) for (const e of G.enemies) {
    if (!alive(e)) continue; const d = V(e.g.position.x - P.x, 0, e.g.position.z - P.z); const L = d.length();
    if (L < o.hitR + e.radius) { damage(e, o.dmg * (1 - Math.min(1, L / o.hitR) * .4), {dir: d, knock: (o.knock || 0) * (1 - Math.min(1, L / o.hitR) * .5), col: o.dmgCol, elem: o.elem}); o.onHit && o.onHit(e); }
  }
}
export function projectile(o) {
  const s = glowSprite(o.col, o.k || 5, o.size || .9); s.position.copy(o.from); G.scene.add(s); const L = takeLight(o.col, o.li || 30, o.ld || 7);
  const tgt = () => o.enemy && alive(o.enemy) ? center(o.enemy) : null; let last = tgt() || o.to.clone(); let travelled = 0;
  fx(6, (k, dt) => {
    last = tgt() || last; const d = last.clone().sub(s.position); const len = d.length(), step = o.speed * dt; travelled += step;
    if (len <= step + .1 || travelled > (o.range || 30)) { s.position.copy(last); return true; }
    s.position.addScaledVector(d.normalize(), step); L.position.copy(s.position); o.trail && o.trail(s.position, dt);
    if (G.map && !G.map.walkable(s.position.x, s.position.z)) return true; // hit a wall
    if (o.hitAny) for (const e of G.enemies) if (alive(e) && dist2(e.g.position, s.position) < e.radius + .3) { o.enemy = e; return true; }
  }, () => { G.scene.remove(s); s.material.dispose(); freeLight(L); o.onHit(s.position.clone(), o.enemy); });
}

// ---------- damage types ----------
export const ELEM = {
  fire: {name: 'Fire', col: 0xff7a2a, pc: C.fire, css: '#ff9a4a', desc: 'sets enemies on fire'},
  frost: {name: 'Frost', col: 0x9fdcff, pc: C.ice, css: '#9fe4ff', desc: 'slows enemies, and every 4th hit freezes them'},
  storm: {name: 'Storm', col: 0xa8c8ff, pc: C.bolt, css: '#bfe0ff', desc: 'can arc to another enemy (30% chance)'},
  void: {name: 'Void', col: 0xc070ff, pc: C.void, css: '#e0b0ff', desc: 'weakens enemies so they take 20% more damage'},
  poison: {name: 'Poison', col: 0x7dff5a, pc: C.green, css: '#a8ff7a', desc: 'stacks poison that deals damage over time'},
  physical: {name: 'Physical', col: 0xe8e2d0, pc: C.white, css: '#ffffff', desc: 'hits 20% harder'},
};
export function applyElem(e, elem, base) {
  if (!alive(e)) return;
  if (elem === 'fire') { e.burn = Math.max(e.burn, 2.5); e.burnT = e.burnT || .5; }
  else if (elem === 'frost') { cc(e, 'chill', 2); e.chillN = (e.chillN || 0) + 1; const pf = G.hero && G.hero.pas.permafrost; if (e.chillN >= (pf ? 3 : 4)) { e.chillN = 0; cc(e, 'freeze', pf ? 1.8 : 1.2); } }
  else if (elem === 'storm') { if (Math.random() < .3) { const n = nearest(center(e), [e], 6); if (n) { bolt(center(e), center(n), .25); damage(n, base * .5, {col: '#bfe0ff'}); } } }
  else if (elem === 'void') e.weak = 3;
  else if (elem === 'poison') { e.poison = e.poison || {stacks: 0, t: 0, tick: .5}; e.poison.stacks = Math.min(10, e.poison.stacks + 1); e.poison.t = 4; }
}

// ---------- crowd control (modelled on Diablo IV) ----------
// Hard CC (freeze, stun, root) stops an enemy; soft CC (chill, knockback) slows or shoves it.
// Normal mobs: hard CC builds "CC heat"; past the cap they shrug it off and are Unstoppable for a moment, so nothing can be perma-frozen.
// Elites and minibosses: hard CC lasts shorter, the cap is lower and the Unstoppable window longer.
// Bosses: immune to all CC. Every CC fills their stagger bar instead; a full bar staggers them (helpless and taking +25% damage),
// then the next bar is bigger. Some attacks (charges, leaps) are Unstoppable while they happen, so CC can't cancel them.
const HARD = {freeze: 'frozen', stun: 'stun', root: 'rooted'};
const STAGGER = {freeze: 13, stun: 12, root: 8, chill: 2.5, knock: .8}; // stagger per second of CC (knock: per unit of force)
const CCT = {normal: {f: 1, cap: 4.5, un: 2.5}, elite: {f: .6, cap: 2.2, un: 4}, mini: {f: .5, cap: 1.6, un: 5}};
export const isUnstoppable = e => e.boss || e.unstop > 0 || e.unstopAct;
function ccText(e, txt, col) { if (G.time - (e.ccTextT || -9) < 1.2) return; e.ccTextT = G.time; dmgNum(e.g.position.clone().add(V(0, e.h + .6, 0)), txt, col, false); }
export function cc(e, kind, dur) {
  if (!alive(e) || !(dur > 0)) return false;
  if (e.boss) { addStagger(e, (STAGGER[kind] || 6) * dur); return false; }
  if (e.unstop > 0 || e.unstopAct) { ccText(e, 'Unstoppable', '#ffc86a'); return false; }
  const T = CCT[e.tier] || CCT.normal;
  if (kind === 'chill') { e.chill = Math.max(e.chill || 0, dur * (e.elite ? .6 : 1)); return true; }
  const key = HARD[kind]; if (!key) return false;
  const d = dur * T.f; e[key] = Math.max(e[key] || 0, d);
  e.ccHeat = (e.ccHeat || 0) + d;
  if (e.ccHeat >= T.cap) { e.ccHeat = 0; e.unstop = d + T.un; after(d, () => { if (alive(e)) { ccText(e, 'Unstoppable', '#ffc86a'); sfx('unstop'); } }); }
  return true;
}
export function addStagger(e, amt) {
  if (!e.boss || e.staggered > 0 || e.unstopAct === 'phase') return;
  e.stag = (e.stag || 0) + amt; e.stagIdle = 0;
  if (e.stag < e.stagMax) return;
  e.stag = 0; e.stagMax = Math.round(e.stagMax * 1.4); e.staggered = 4.5; e.stun = 4.5; e.busy = false; e.st.mode = 'walk';
  const c = center(e); shockwave(e.g.position, 0xffd24a, 5, .6, 5); flashLight(c, 0xffd24a, 150, .6, 12); G.shake = Math.max(G.shake, .45);
  parts.burst(c, 120, {cols: [C.gold, C.white], b: 5, speed: 7, life: .8, size: .3, up: 2}); sfx('stagger'); G.toast && G.toast(`${e.name} is staggered!`);
}
// per-frame CC bookkeeping, called from enemyUpdate
export function ccUpdate(e, dt) {
  const held = e.frozen > 0 || e.stun > 0;
  if (!held) e.ccHeat = Math.max(0, (e.ccHeat || 0) - dt * .35);
  if (e.unstop > 0) e.unstop -= dt;
  if (e.boss) {
    if (e.staggered > 0) e.staggered -= dt;
    e.stagIdle = (e.stagIdle || 0) + dt; if (e.stagIdle > 6) e.stag = Math.max(0, e.stag - dt * 6);
  }
}
