// Hero, enemies, drops and interactables.
import {THREE, G, V, TAU, rand, pick, clamp, dist2, lerpAngle, parts, fx, after, glow, add, glowSprite, ghost, shockwave, marker, flashLight, dmgNum, place, worldUI, C} from './core.js';
import {modelRig, makeDriver, driveUpdate, dplay, PROPS} from './assets.js';
import {SKILLS, ULTS, frostWave} from './skills.js';
import {SIGS, CLASS_SIGS, sigMods} from './sigs.js';
import {damage, alive, center, nearest, cc} from './combat.js';
import {CS} from './map.js';
import {sfx} from './audio.js';

export const CLASSES = {
  pyromancer: {name: 'Pyromancer', model: 'pyromancer', weapon: 'staff', elem: 'fire', elemCol: C.fire, hp: 115, skills: ['fireball', 'meteor', 'nova', 'flamewall', 'livingbomb', 'phoenix'], ults: ['infernorain', 'supernova'], color: '#ff7a2f',
    blurb: 'Dragonborn fire mage. Staff bolts at range, huge area damage.'},
  warden: {name: 'Warden', model: 'warden', weapon: 'blade', elem: 'frost', elemCol: C.ice, hp: 150, skills: ['charge', 'slam', 'moonfall', 'frostarmor', 'chains', 'shieldthrow'], ults: ['absolutezero', 'crusade'], color: '#7fd0ff',
    blurb: 'Undead knight with sword and shield. Charges in and freezes everything.'},
  ranger: {name: 'Ranger', model: 'ranger', weapon: 'bow', elem: 'storm', elemCol: C.green, hp: 120, skills: ['pierce', 'storm', 'chain', 'volley', 'snare', 'tumble'], ults: ['stormcall', 'starfall'], color: '#9aff6a',
    blurb: 'Hooded archer. Long range arrows and lightning that chains.'},
  voidblade: {name: 'Voidblade', model: 'voidblade', weapon: 'daggers', elem: 'void', elemCol: C.void, hp: 115, skills: ['blink', 'singularity', 'fan', 'shadowclone', 'deathmark', 'smoke'], ults: ['eventhorizon', 'thousandcuts'], color: '#c070ff',
    blurb: 'Panther assassin. Teleports, black holes and blade storms.'},
};
const newMod = () => ({dmg: 1, area: 1, cdr: 1, echo: 0});
export const skillDef = (h, slot) => slot < 3 ? SKILLS[h.skills[slot]] : ULTS[h.ult];
const RUN = 5.4; // hero top speed (m/s)

// ---------- movement: sub-stepped, circle-vs-grid collision so entities slide along walls and round corners ----------
export function moveEnt(ent, dx, dz, r) {
  const p = ent.g.position, M = G.map, steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (r * .7)));
  for (let s = 0; s < steps; s++) {
    const px = p.x, pz = p.z; p.x += dx / steps; p.z += dz / steps;
    for (let it = 0; it < 2; it++) {
      const [ci, cj] = M.cellOf(p.x, p.z);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj; if (M.floor(i, j)) continue;
        const qx = clamp(p.x, i * CS, i * CS + CS), qz = clamp(p.z, j * CS, j * CS + CS), ox = p.x - qx, oz = p.z - qz, d = Math.hypot(ox, oz);
        if (d < r && d > 1e-5) { p.x += ox / d * (r - d); p.z += oz / d * (r - d); }
      }
    }
    if (!M.walkable(p.x, p.z)) { p.x = px; p.z = pz; }
  }
}

// ---------- hero ----------
export function createHero(id) {
  const cls = CLASSES[id], m = modelRig(cls.model, 1.85);
  const fl = new THREE.PointLight(0xfff0e0, 14, 11, 2); fl.position.set(0, 3.2, 1.5); m.root.add(fl);
  const h = {id, cls, g: m.root, rig: m.rig, m, drv: makeDriver(m.rig, 'idle', 'run', true), propUpd: PROPS[cls.model](m), mats: m.mats,
    hp: cls.hp, maxHp: cls.hp, path: [], vel: V(), moving: false, lift: 0, lock: 0, castT: 0, invuln: 0, guard: 0, dodgeCd: 0, faceTarget: 0, attackTarget: null, moveTo: null, fireAt: null, stick: null,
    priT: 0, cdSec: 0, cdSecMax: 1, potions: 4, potMax: 4, potCd: 0, channel: null, repathT: 0, lastHit: 99, flash: 0, dead: false,
    sig: CLASS_SIGS[id].map(s => ({id: s, elem: SIGS[s].elem, rank: 1, runes: []})), sigHits: [0, 0],
    skills: [null, null, null], ult: null, level: 1, xp: 0, cds: [0, 0, 0, 0], mods: [newMod(), newMod(), newMod(), newMod()], runSpeed: 1.15,
    stats: {dmg: 1, crit: .1, speed: 1, lifesteal: 0, burnOnHit: 0, freezeChance: 0, cdr: 1, regen: .8, armor: 0}, aug: {}, pas: {}, barrier: 0, barrierT: 0, stealth: 0, empower: 0, critShots: 0, slowT: 0, items: {}, gold: 0, kills: 0, castCount: 0, secondWind: true, buffs: []};
  h.from = () => m.hand(id === 'ranger' ? 'L_Hand' : 'R_Hand');
  h.face = p => { h.faceTarget = Math.atan2(p.x - h.g.position.x, p.z - h.g.position.z); h.g.rotation.y = h.faceTarget; };
  h.heal = a => { h.hp = Math.min(h.maxHp, h.hp + a); };
  h.tags = () => {
    const t = new Set([cls.elem]); for (const s of h.sig) { t.add(s.elem); t.add(SIGS[s.id].kind); }
    for (let s = 0; s < 4; s++) { const d = skillDef(h, s); if (d) { t.add(d.elem); d.tags.forEach(x => t.add(x)); } } return t;
  };
  return h;
}
export const sigDef = (h, i) => SIGS[h.sig[i].id];
// ---------- experience ----------
export const UNLOCK = {2: 0, 4: 1, 6: 2, 8: 3}; // level -> skill slot it unlocks (3 = ultimate)
export const SLOT_LEVEL = {0: 2, 1: 4, 2: 6, 3: 8};
export const xpNeed = lvl => Math.round(45 * Math.pow(lvl, 1.35));
export function gainXp(h, amt, at) {
  if (h.dead) return; h.xp += amt; G.onXp && G.onXp(amt);
  if (at) dmgNum(at.clone().add(V(0, .6, 0)), '+' + amt + ' xp', '#b58cff', false);
  while (h.xp >= xpNeed(h.level)) {
    h.xp -= xpNeed(h.level); h.level++;
    const bonus = Math.round(h.maxHp * .05); h.maxHp += bonus; h.heal(h.maxHp * .2);
    const p = h.g.position; shockwave(p, 0xffd84a, 3.5, .6, 3); flashLight(V(p.x, 2, p.z), 0xffd84a, 60, .8, 8);
    parts.burst(V(p.x, 1, p.z), 80, {cols: [C.gold, C.white], b: 3, speed: 4, life: 1, size: .25, up: 4, grav: -1});
    sfx('level', {}, .2); G.onLevelUp && G.onLevelUp(h, h.level);
  }
}
export function usePotion(h) {
  if (h.dead || h.potions <= 0 || h.potCd > 0 || h.hp >= h.maxHp) return false;
  h.potions--; h.potCd = 1; h.heal(h.maxHp * .4); sfx('potion');
  parts.burst(center(h), 30, {col: C.red, b: 3, speed: 3, life: .6, size: .25, up: 2}); flashLight(center(h), 0xff3a3a, 30, .4, 5);
  return true;
}
export function castSlot(h, slot, aim) {
  const def = skillDef(h, slot); if (!def || h.dead || h.cds[slot] > 0 || h.lock > 0 || h.channel) return false;
  const mod = h.mods[slot]; let cd = def.cd * mod.cdr * h.stats.cdr; if (slot === 3 && h.aug.arcane) cd *= .6;
  h.castCount++; if (h.aug.overflow && slot < 3 && h.castCount % 3 === 0) cd = .3;
  h.cds[slot] = cd; h.cdMax = h.cdMax || []; h.cdMax[slot] = cd;
  h.face(aim); h.castT = .3; h.path = []; h.attackTarget = null; sfx('cast', {elem: def.elem}, .02);
  if (def.anim) dplay(h.drv, def.anim[0], true, def.anim[1]);
  const M = {dmg: mod.dmg, area: mod.area, elem: def.elem}; def.cast(h, aim.clone(), M); G.onCast && G.onCast(h, slot, def, aim, M);
  if (h.pas.emberward) { h.barrier = Math.max(h.barrier, h.maxHp * .12); h.barrierT = 3; }
  if (h.stealth > 0) h.stealth = Math.min(h.stealth, .3);
  if (mod.echo) after(.35, () => { if (!h.dead) def.cast(h, aim.clone(), {dmg: M.dmg * .7, area: M.area}); });
  return true;
}
// primary signature spell: fires at its attack rate
function tryPrimary(h, aim) {
  if (h.priT > 0 || h.castT > 0 || h.channel) return;
  const S = sigDef(h, 0), M = sigMods(h, 0), haste = h.buffs.some(b => b.kind === 'haste') ? 1.25 : 1;
  const cru = h.buffs.find(b => b.kind === 'crusade');
  h.priT = 1 / (S.rate * M.rate * haste * (cru ? 1.3 : 1) * (h.stats.aspd || 1)); h.face(aim); dplay(h.drv, S.anim[0], true, S.anim[1] * M.rate);
  h.empowered = h.empower > 0; if (h.empowered) h.empower--;
  sfx(S.kind === 'melee' ? 'swing' : 'shoot', {elem: M.elem}, .02);
  S.fire(h, 0, aim.clone(), M); if (cru) frostWave(h, aim, cru.M);
}
// secondary signature spell: instant, channelled (hold) or charged (hold + release)
export function secondaryDown(h, aimFn) {
  if (h.dead || h.lock > 0 || h.cdSec > 0 || h.channel) return;
  const S = sigDef(h, 1), M = sigMods(h, 1), aim = aimFn(); h.face(aim); h.path = []; h.attackTarget = null; sfx('cast', {elem: M.elem}, .02);
  if (S.channel || S.charge) { h.channel = {S, M, t: 0, aimFn, st: {}}; (S.channel || S.charge).start(h, aim, M, h.channel.st); dplay(h.drv, S.anim[0], true, S.anim[1]); return; }
  h.cdSec = h.cdSecMax = S.cd * M.cdm * h.stats.cdr; dplay(h.drv, S.anim[0], true, S.anim[1]); S.press(h, 1, aim, M);
}
export function secondaryUp(h) {
  const c = h.channel; if (!c) return; h.channel = null;
  if (c.S.charge) c.S.charge.release(h, 1, c.aimFn(), Math.min(1, c.t / c.S.charge.max), c.M, c.st); else c.S.channel.end(h, c.st);
  h.cdSec = h.cdSecMax = c.S.cd * c.M.cdm * h.stats.cdr;
}
export function dodge(h, aim) {
  if (h.dead || h.dodgeCd > 0 || h.lock > 0) return; if (h.channel) secondaryUp(h);
  const A = h.g.position.clone(), dir = V(aim.x - A.x, 0, aim.z - A.z); if (dir.lengthSq() < .01) dir.set(Math.sin(h.g.rotation.y), 0, Math.cos(h.g.rotation.y)); dir.normalize();
  sfx('dash'); G.onDodge && G.onDodge(h, A);
  h.dodgeCd = 2.2 * (h.pas.phaseshift ? .6 : 1); h.invuln = .35; h.lock = .22;
  if (h.pas.kite) { h.critShots = 3; h.buffs.push({kind: 'kite', t: 2}); }
  if (h.pas.phaseshift) after(.1, () => { for (const e of G.enemies) if (alive(e) && dist2(e.g.position, A) < 2.6 + e.radius) damage(e, 25, {elem: 'void', col: '#e0b0ff'}); shockwave(A, 0xc070ff, 2.6, .35, 3); parts.burst(V(A.x, 1, A.z), 40, {cols: [C.void, C.pink], b: 4, speed: 5, life: .4, size: .25}); }); h.path = []; h.attackTarget = null; h.face(A.clone().add(dir)); h.vel.copy(dir).multiplyScalar(RUN); let gt = 0;
  fx(.22, (k, dt) => {
    moveEnt(h, dir.x * 24 * dt, dir.z * 24 * dt, .35); gt -= dt; if (gt <= 0) { gt = .05; ghost(h.g, h.cls.elemCol.getHex(), .3, .35); }
    if (h.pas.flamewalker) { const p = h.g.position; addHazard(V(p.x, 0, p.z), 1.1, 10, 'hero'); }
  });
}
export function hurtHero(amt, from, o = {}) {
  const h = G.hero; if (!h || h.dead || h.invuln > 0) return;
  const armor = h.buffs.find(b => b.kind === 'frostarmor');
  amt = amt * (1 - h.stats.armor) * (h.guard > 0 ? .3 : 1) * (h.pas.bulwark ? .8 : 1) * (armor ? .5 : 1);
  if (armor && from && alive(from) && !o.ranged) { cc(from, 'chill', 2.5); damage(from, armor.dmg, {elem: 'frost', col: '#9fe4ff'}); }
  if (h.pas.retaliation && Math.random() < .25) { const p = h.g.position; shockwave(p, 0x9fdcff, 3, .35, 3); for (const e of G.enemies) if (alive(e) && dist2(e.g.position, p) < 3 + e.radius) { damage(e, 25, {elem: 'frost', col: '#9fe4ff'}); cc(e, 'chill', 2.5); } }
  if (o.chill) h.slowT = Math.max(h.slowT, o.chill);
  if (h.barrier > 0) { const ab = Math.min(h.barrier, amt); h.barrier -= ab; amt -= ab; }
  amt = Math.round(amt); if (amt <= 0) return;
  h.hp -= amt; h.lastHit = 0; h.flash = 1; sfx('hurt', {}, .12);
  dmgNum(h.g.position.clone().add(V(0, 2.2, 0)), amt, '#ff4a3a', false); G.onHeroHurt && G.onHeroHurt(amt);
  if (h.hp <= 0) {
    if (h.aug.secondwind && h.secondWind) { h.secondWind = false; h.hp = h.maxHp * (h.secondWindPct || .4); shockwave(h.g.position, 0xffffff, 5, .6, 3); G.toast && G.toast('Second Wind!'); return; }
    h.hp = 0; h.dead = true; if (h.channel) secondaryUp(h); dplay(h.drv, 'e_die', true, 1.1); G.onHeroDeath && after(2.2, G.onHeroDeath);
  }
}
// steer toward a point: straight if nothing is in the way, otherwise along a path (re-planned now and then)
function steerTo(h, target, stopAt = 0) {
  const p = h.g.position, dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz);
  if (d <= stopAt + .05) return V();
  if (G.map.los(p, target, .3)) { h.path = []; return V(dx / d, 0, dz / d).multiplyScalar(Math.min(1, (d - stopAt) / .15)); }
  if (h.repathT <= 0 || !h.path.length) { h.path = G.map.path(p, target); h.repathT = .3; }
  return followPath(h);
}
function followPath(h) {
  const p = h.g.position;
  while (h.path.length) {
    const wp = h.path[0], dx = wp.x - p.x, dz = wp.z - p.z, d = Math.hypot(dx, dz), last = h.path.length === 1;
    if (d < (last ? .12 : .5)) { h.path.shift(); continue; }
    return V(dx / d, 0, dz / d).multiplyScalar(last ? Math.min(1, d / .15) : 1);
  }
  return V();
}
export function heroUpdate(h, dt, t) {
  for (let s = 0; s < 4; s++) h.cds[s] = Math.max(0, h.cds[s] - dt);
  h.cdSec = Math.max(0, h.cdSec - dt); h.priT -= dt; h.guard -= dt; h.potCd -= dt; h.slowT -= dt; h.stealth -= dt;
  if ((h.barrierT -= dt) <= 0) h.barrier = 0;
  h.invuln -= dt; h.dodgeCd -= dt; h.castT -= dt; h.lastHit += dt; h.repathT -= dt; h.flash = Math.max(0, h.flash - dt * 4);
  h.buffs = h.buffs.filter(b => (b.t -= dt) > 0);
  let want = V(), faceTo = null;
  if (!h.dead) {
    if (h.lastHit > 4) h.heal(h.stats.regen * dt * (h.maxHp / 100));
    if (h.attackTarget && !alive(h.attackTarget)) h.attackTarget = null;
    if (h.lock > 0) h.lock -= dt;
    else if (h.channel) { // channel / charge: slow walk, always facing the aim
      const c = h.channel, aim = c.aimFn(); c.t += dt; faceTo = aim;
      if (c.S.channel) { c.S.channel.tick(h, 1, aim, dt, c.M, c.st); if (c.t > c.S.channel.max) secondaryUp(h); }
      else c.S.charge.tick(h, 1, aim, dt, c.M, c.st, Math.min(1, c.t / c.S.charge.max));
      if (h.stick) want = h.stick.clone().multiplyScalar(.35); else if (h.moveTo) want = steerTo(h, h.moveTo).multiplyScalar(.35);
    }
    else if (h.castT > 0) { /* brief root while a skill goes off */ }
    else if (h.attackTarget) { // walk into range, then keep firing the primary spell
      const e = h.attackTarget, S = sigDef(h, 0), d = dist2(e.g.position, h.g.position) - e.radius;
      const inRange = d <= S.range && (S.kind !== 'projectile' || G.map.los(h.g.position, e.g.position, .1));
      if (inRange) { faceTo = e.g.position; tryPrimary(h, center(e)); } else want = steerTo(h, e.g.position, d > S.range ? Math.max(0, S.range - 1) : 0); // in range but blocked: walk until we can see it
    }
    else if (h.fireAt) { faceTo = h.fireAt; tryPrimary(h, h.fireAt); if (h.stick) want = h.stick.clone().multiplyScalar(.85); } // move and shoot (twin-stick)
    else if (h.stick) { want = h.stick.clone(); if (h.aimDir) faceTo = h.g.position.clone().add(h.aimDir); }
    else if (h.moveTo) want = steerTo(h, h.moveTo);
    else if (h.path.length) want = followPath(h);
    // standing in hazards
    for (const z of G.hazards) if (z.owner !== 'hero' && dist2(z.pos, h.g.position) < z.r) { z.tick = (z.tick || 0) - dt; if (z.tick <= 0) { z.tick = .5; hurtHero(z.dps * .5); } }
  }
  // accelerate / brake toward the wanted velocity (~0.1 s), then move with wall sliding
  const top = RUN * h.stats.speed * (h.buffs.some(b => b.kind === 'haste') ? 1.4 : 1) * (h.buffs.some(b => b.kind === 'kite') ? 1.2 : 1) * (h.slowT > 0 ? .6 : 1);
  if (h.lock <= 0) {
    const tv = want.multiplyScalar(top), k = 1 - Math.exp(-dt * 45);
    h.vel.lerp(tv, k); if (h.vel.lengthSq() < .01) h.vel.set(0, 0, 0);
    moveEnt(h, h.vel.x * dt, h.vel.z * dt, .35);
  }
  const sp = h.vel.length(); h.moving = sp > .5 && h.lock <= 0;
  if (faceTo) h.faceTarget = Math.atan2(faceTo.x - h.g.position.x, faceTo.z - h.g.position.z);
  else if (h.moving) h.faceTarget = Math.atan2(h.vel.x, h.vel.z);
  h.g.rotation.y = lerpAngle(h.g.rotation.y, h.faceTarget, 1 - Math.exp(-dt * 30));
  // facing and moving can differ (twin-stick): turn the legs toward the movement, or backpedal when moving away from the aim
  if (h.moving) { const w = x => ((x + Math.PI) % TAU + TAU) % TAU - Math.PI; let a = w(Math.atan2(h.vel.x, h.vel.z) - h.g.rotation.y); h.backpedal = Math.abs(a) > 1.95; if (h.backpedal) a = w(a - Math.PI); h.legYaw = Math.max(-1.1, Math.min(1.1, a)); }
  else { h.legYaw = 0; h.backpedal = false; }
  h.g.position.y = h.lift; h.runSpeed = Math.max(.5, sp / RUN * 1.15);
  if (h.drv.cur === 'run' && h.drv.acts.run) h.drv.acts.run.timeScale = h.runSpeed * (h.backpedal ? -1 : 1);
  driveUpdate(h, dt); h.propUpd(h, t, dt);
  const st = h.stealth > 0; for (const m of h.mats) { m.emissive.setRGB(h.flash * .6, h.slowT > 0 ? .08 : 0, h.slowT > 0 ? .25 : 0); m.emissiveIntensity = 1; if (m.transparent !== st) { m.transparent = st; m.needsUpdate = true; } m.opacity = st ? .3 : 1; }
  G.map.reveal(h.g.position.x, h.g.position.z, 12);
}

// ---------- hazards (burning ground etc.) ----------
export function addHazard(pos, r, dps, owner, dur = 3, col = C.fire) {
  const z = {pos, r, dps, owner, t: dur, col}; G.hazards.push(z); return z;
}
export function updateHazards(dt) {
  for (const z of G.hazards) {
    z.t -= dt; if (Math.random() < .6) { const a = rand(0, TAU), r = Math.sqrt(Math.random()) * z.r; parts.emit(z.pos.x + Math.cos(a) * r, .1, z.pos.z + Math.sin(a) * r, 0, rand(.8, 2), 0, z.col, 3, .5, .25, -.5, 1); }
    if (z.owner === 'hero') { z.tick = (z.tick || 0) - dt; if (z.tick <= 0) { z.tick = .4; for (const e of G.enemies) if (alive(e) && dist2(e.g.position, z.pos) < z.r + e.radius) damage(e, z.dps * .4, {noCrit: true, dot: true, col: '#ffa048'}); } }
  }
  G.hazards = G.hazards.filter(z => z.t > 0);
}

// ---------- drops ----------
const coinGeo = new THREE.CylinderGeometry(.14, .14, .04, 10); coinGeo.userData.keep = true;
export function dropGold(pos, amount) {
  const n = Math.min(8, 2 + Math.floor(amount / 6));
  for (let k = 0; k < n; k++) {
    const m = add(G.scene, coinGeo, glow(0xffc84a, 2.2), pos.x, .8, pos.z, {rx: Math.PI / 2});
    G.drops.push({kind: 'gold', mesh: m, v: V(rand(-2.5, 2.5), rand(3, 5), rand(-2.5, 2.5)), amount: Math.round(amount / n), age: 0});
  }
}
export function dropGlobe(pos) {
  const s = glowSprite(0xff2a2a, 3, .7); s.position.set(pos.x, .6, pos.z); G.scene.add(s);
  G.drops.push({kind: 'globe', mesh: s, v: V(rand(-2, 2), rand(3, 4), rand(-2, 2)), age: 0});
}
export function updateDrops(dt, t) {
  const h = G.hero; if (!h) return;
  for (const d of G.drops) {
    d.age += dt; const p = d.mesh.position, hp = h.g.position;
    if (d.v) { p.addScaledVector(d.v, dt); d.v.y -= 12 * dt; if (p.y < .3) { p.y = .3; d.v = null; } }
    else p.y = .3 + Math.sin(t * 4 + d.age) * .08;
    if (d.kind === 'gold') d.mesh.rotation.z += dt * 5;
    const dd = dist2(p, hp);
    if (!h.dead && d.age > .5 && dd < (d.kind === 'gold' ? 4 : 1.4)) {
      p.lerp(V(hp.x, 1, hp.z), Math.min(1, dt * 10));
      if (dd < .6) {
        d.taken = true; G.scene.remove(d.mesh);
        if (d.kind === 'gold') { h.gold += d.amount; sfx('coin', {}, .05); } else { sfx('globe'); if (h.potions < h.potMax) h.potions++; else h.heal(h.maxHp * .2); parts.burst(center(h), 24, {col: C.red, b: 3, speed: 3, life: .5, size: .25, up: 2}); }
      }
    }
  }
  G.drops = G.drops.filter(d => !d.taken);
}
