// MELEE feature: swords, shields and the rest (content/melee.js; the shared combat model: /mnt/project-files/briefs/combat-shared.md).
// The player's side (the moves, their timing, the guard, the jump, the smash's dive) is sim/player/melee.js (host.PL.melee);
// this feature gives it its keys, its assist and does what the blows do, through features/hits.js:
//   3        draw the weapon (the gun in the holster, the fists down); again: the next weapon. 4: the next shield. 1 / 2: put it away
//   LMB      the combo (tap); held: the weapon's heavy, charging; Shift on the run: the dash; in the air: the SMASH
//   RMB      the guard: the shield (or the blade) up. A blow that meets it raised in the last parry window is PARRIED (the
//            attacker staggers, the world slows a beat, your next hit is a riposte); else blocked (a share through); a tower
//            shield + C: crouched behind it. RMB held + LMB: the shield's bash
//   Space    a jump (where there's nothing to leap or vault)        C: a roll (the dodge, while the weapon is out)
//   R        throw the weapon (it flies, spins, sticks in what it meets); R again: it flies back to your hand (hitting what's
//            in the way); walk over it to pick it up. The Rift Blade: R again takes YOU to it. The Light Saber comes back itself
// A SWING (player.blade) meets up to the weapon's `cleave` bodies in its arc and reach (bodies first, then dummies and things;
// crates and barrels are shoved), each through hits.deal; the hitstop, the shake and the camera's kick by its weight.
// DEFEND (hits.defend: every attack on the player asks it): the guard's answer by the shield / the weapon, the attacker's way
// against his facing (the shield's cone), the parry window since it was raised; bullets only stop on a shield that takes them
// (and the saber, which sends them back on a parry).
// OWNS: the weapons he has (all of them, for now), the thrown blade, the assist's lock, the parry's slow-down clock (the
//   modifier source 'melee'), its view's trails / rings / sparks / toasts.
// READS: host.PL.melee, host.player / aim / entities (near) / live, hits, combat (core: puff, part; phys: shove).
// EMITS: melee.swing, melee.hit, melee.whiff, melee.block, melee.parry, melee.throw, melee.stick, melee.catch, melee.smash, melee.draw.
// BUDGET: sim: one near() a blow, a few for the thrown blade a step (one while it lies), the lock at 10 Hz; view: <= a few
//   hundred world pixels and lines.
import {WEAPONS, WEAPON_IDS, SHIELDS, SHIELD_IDS, MOVES, TUNE} from '../content/melee.js';
import {flags} from '../core/flags.js';
import {createSkillToasts} from '../ui/skilltoast.js';
import {hdUnit, hdText} from '../ui/hdpixel.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const ON = flags.get('melee') !== '0';
const MOVABLE = new Set(['crate', 'barrel', 'barrel_x']);
const NO = {out: 'hit', k: 1}, DEF = {out: 'hit', k: 1};
const NTR = 4, NS = 18, NFX = 220, NRING = 8;
const SPARK = ['#ffffff', '#fff4c0', '#ffd27a', '#f2a03a'], BLOCKC = ['#ffffff', '#d8f0ff', '#8ac0f0', '#5a88c0'], DUSTC = ['#d8c8a8', '#b8a888', '#968668', '#6a5e4a'];

export const order = {before: ['fists', 'brawl', 'gun', 'woodcut']};   // (its keys ahead of theirs: 1 / 2 put the weapon away first, R throws before the gun reloads)
export async function create(host) {
  let combat = null, hitsF = null;
  const core = () => (combat ??= host.feature('combat'))?.core || null;
  const phys = () => (combat ??= host.feature('combat'))?.phys || null;
  const hits = () => hitsF ??= host.feature('hits');
  const M = () => ON ? host.PL.melee : null;
  const NEAR = [], HIT = [], HITD = [];
  const owned = new Set(WEAPON_IDS);   // (every weapon for now: the playtest's armoury)
  const S = {lockT: 0, lockP: null, slowT: 0, slowOn: false, hits: 0, whiffs: 0, parries: 0, blocks: 0, combo: 0, comboT: 9, saber: 0, sound: 0};
  const toasts = createSkillToasts();
  const W = id => WEAPONS[id] || WEAPONS.sword;
  // a weapon's numbers with the attachments' notes (host.mods: 'melee.dmg', 'melee.reach')
  let dmgK = 1, dmgA = 0, reachK = 1;
  if (host.mods) { const f = () => { dmgK = host.mods.value('melee.dmg', 1); dmgA = host.mods.value('melee.dmgAdd', 0); reachK = host.mods.value('melee.reach', 1); }; host.mods.watch(f); f(); }

  // ---------------------------------------------------------------- what's what
  const rOf = p => p.r ?? .3;
  // which way it faces (world unit, FW): a brute's faceW, a gunman's record's angle; false: it doesn't say
  const FW = [0, 1];
  function faceOf(q) {
    if (Array.isArray(q.faceW)) { const l = Math.hypot(q.faceW[0], q.faceW[1]) || 1; FW[0] = q.faceW[0] / l; FW[1] = q.faceW[1] / l; return true; }
    const g = host.feature('foes')?.sim?.recOf?.(q);
    if (g && typeof g.face === 'number') { FW[0] = Math.sin(g.face); FW[1] = Math.cos(g.face); return true; }
    return false;
  }
  const kindOf = p => hits()?.kindOf(p) || '';
  // the assist: the body nearest the cursor's way within TUNE.assist's range and cone
  function findLock() {
    const P = host.player, a = host.aim(), A = TUNE.assist;
    let dx = a.x - P.x, dy = a.y - P.y, d = Math.hypot(dx, dy);
    if (d < .1) { const f = P.faceAngle; dx = Math.sin(f); dy = Math.cos(f); d = 1; }
    dx /= d; dy /= d;
    const cs = Math.cos(A.cone * DEG); let best = null, bs = 1e9;
    for (const p of host.entities.near(P.x, P.y, A.range + .8, NEAR)) {
      if (kindOf(p) !== 'body' || Math.abs((p.z || 0) - P.z) > 1.2) continue;
      const ex = p.x - P.x, ey = p.y - P.y, l = Math.hypot(ex, ey); if (l < .05 || l - rOf(p) > A.range) continue;
      const cosA = (ex * dx + ey * dy) / l; if (cosA < cs && a.target !== p) continue;
      const sc = l * (1.6 - cosA) - (a.target === p ? 2 : 0);
      if (sc < bs) { bs = sc; best = p; }
    }
    return best;
  }

  // ---------------------------------------------------------------- the swing (player.blade)
  function land(e) {
    const m = MOVES[e.mv]; if (!m) return;
    const mel = M(), w = W(e.wid || mel?.weapon), sh = e.sid ? SHIELDS[e.sid] : null, P = host.player;
    // the swing as it lands its blow, whatever it meets (the attachments' caster crystal looses a bolt on it: features/mods)
    host.events.push({type: 'melee.swing', x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, mv: e.mv, weapon: e.mv === 'bash' ? e.sid : e.wid || '', n: e.n || 0, k: e.k || 0});
    const bash = e.mv === 'bash';
    const reach = (bash ? 1.1 : (w.reach || 1.4) * reachK) * (m.reach || 1), arcD = bash ? 80 : Math.min(360, (w.arc || 120) * (m.arc || 1)), c0 = Math.cos(arcD / 2 * DEG);
    let n = 0;
    HIT.length = 0; HITD.length = 0;
    for (const q of host.entities.near(e.x, e.y, reach + 1.2, NEAR)) {
      if (q.gone || q.broken || q.held || Math.abs((q.z || 0) - e.z) > 1.4) continue;
      const k = kindOf(q), mov = !k && MOVABLE.has(q.kind) && !q.wall && !q.sink && !q.float;
      if (!k && !mov) continue;
      const dx = q.x - e.x, dy = q.y - e.y, d = Math.hypot(dx, dy) || 1e-6;
      if (d - rOf(q) * .8 > reach) continue;
      if (arcD < 359 && (dx * e.vx + dy * e.vy) / d < (d < .6 ? c0 - .4 : c0)) continue;
      HIT.push(q); HITD.push(d - (k === 'body' ? 1 : 0));
    }
    // the nearest first (bodies before things), up to cleave
    for (let i = 1; i < HIT.length; i++) for (let j = i; j > 0 && HITD[j] < HITD[j - 1]; j--) { [HIT[j], HIT[j - 1]] = [HIT[j - 1], HIT[j]]; [HITD[j], HITD[j - 1]] = [HITD[j - 1], HITD[j]]; }
    const cleave = bash ? 3 : w.cleave || 1, kk = e.k || 0;
    let power = 0, ko = false, bodies = 0;
    for (let i = 0; i < HIT.length && n < cleave; i++) {
      const q = HIT[i], k = kindOf(q);
      const dx = q.x - e.x, dy = q.y - e.y, d = Math.hypot(dx, dy) || 1;
      let ux = e.vx * .6 + dx / d * .4, uy = e.vy * .6 + dy / d * .4; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      if (!k) { const v = (2.5 + (m.knock || 1)) * (w.knock || 1) * (1 + kk); phys()?.shove(q, ux * v, uy * v); n++; continue; }
      const hx = q.x - ux * Math.min(.2, rOf(q) * .6), hy = q.y - uy * Math.min(.2, rOf(q) * .6), hh = (q.z || 0) + (e.mv === 'rise' ? .8 : e.mv === 'overhead' || e.mv === 'cleave' ? 1.5 : 1.15);
      let dmg = bash ? (sh?.bash || 3) : e.unarmed ? 3 : (w.dmg * dmgK + dmgA) * (m.dmg || 1) * (1 + kk * 1.2);
      // from behind (the knife): the target's back to him
      let crit = false;
      if (w.backstab && !bash && k === 'body') {
        if (faceOf(q) && (FW[0] * ux + FW[1] * uy) > .3) { dmg *= w.backstab; crit = true; }
      }
      if (e.riposte) { dmg *= w.riposte || TUNE.parry.mul; crit = true; }
      let extra = null;
      if (w.extra && !bash && !e.unarmed) { extra = {}; for (const t in w.extra) extra[t] = Math.round(w.extra[t] * dmgK * (m.dmg || 1) * (1 + kk)); }
      const knock = bash ? (sh?.knock || 4) * (1 + kk) : (m.knock || 1) * (w.knock || 1) * (1 + kk * 1.5), lift = bash ? 0 : ((m.lift || 0) + (w.lift || 0)) * (1 + kk * .5);
      const r = hits()?.deal(q, {by: bash ? 'bash' : 'melee', from: 'player', weapon: bash ? e.sid : e.unarmed ? '' : (e.wid || ''), dmg: Math.max(1, Math.round(dmg)), type: bash || e.unarmed ? 'blunt' : w.type,
        extra, x: hx, y: hy, h: hh, ux, uy, knock, lift, stun: (m.stun || .2) * (1 + kk), crit, quiet: true, power: Math.min(1, .25 + kk * .5 + (m.dmg || 1) * .2),
        guard: !!w.pierceGuard || bash});
      if (!r) continue;
      n++; if (k === 'body') bodies++;
      if (r.ko) ko = true;
      power = Math.max(power, Math.min(1, (m.dmg || 1) * .35 + kk * .5 + (crit ? .3 : 0) + (r.ko ? .3 : 0)));
      host.events.push({type: 'melee.hit', x: hx, y: hy, h: hh, who: q, kind: r.blocked ? 'block' : k, mv: e.mv, weapon: e.wid || '', power, ko: r.ko, crit, dx: ux, dy: uy, kick: 1 + power * 3});
      sparks(hx, hy, hh, ux, uy, r.blocked ? 'block' : k === 'body' ? 'body' : 'thing', w, power);
    }
    if (!n) { S.whiffs++; host.events.push({type: 'melee.whiff', x: e.x + e.vx * reach * .7, y: e.y + e.vy * reach * .7, h: P.z + 1.1, mv: e.mv, weapon: e.wid || '', power: kk}); return; }
    S.hits += n;
    if (bodies) { S.combo = (S.comboT < 1.4 ? S.combo : 0) + bodies; S.comboT = 0; }
    const hs = TUNE.hitstop[0] + (TUNE.hitstop[1] - TUNE.hitstop[0]) * power;
    host.hitstop(Math.min(.14, hs + (ko ? .03 : 0)));
    if (power > .45 || ko) host.shake(Math.round(TUNE.shake[0] + (TUNE.shake[1] - TUNE.shake[0]) * power), .12);
    if (e.riposte && bodies) slow(.4, .12);   // (sim s: at x .4 about .3 s of the real clock)
  }
  function slow(k, sec) { S.slowT = Math.max(S.slowT, sec); if (!S.slowOn || k < S.slowK) { S.slowK = k; host.mods?.set('melee', [{stat: 'sim.speed', mul: k}]); S.slowOn = true; } }

  // ---------------------------------------------------------------- the smash (player.smash)
  function smash(e) {
    const w = W(e.wid), SM = TUNE.smash, bonus = Math.max(0, e.fall - SM.minH) * SM.perM;
    const R = SM.r * (w.smash || 1) * (1 + bonus * .5), dmg = w.dmg * dmgK * SM.dmg * (w.smash || 1) * (1 + bonus);
    let n = 0;
    for (const q of host.entities.near(e.x, e.y, R + 1, NEAR)) {
      if (q.gone || q.broken || q.held || Math.abs((q.z || 0) - e.z) > 1.5) continue;
      const k = kindOf(q), dx = q.x - e.x, dy = q.y - e.y, d = Math.hypot(dx, dy) || .01;
      if (d - rOf(q) > R) continue;
      const ux = dx / d, uy = dy / d, near = 1 - Math.min(1, d / R) * .5;
      if (!k) { if (MOVABLE.has(q.kind) && !q.wall) phys()?.shove(q, ux * 7 * near, uy * 7 * near); continue; }
      let extra = null; if (w.extra) { extra = {}; for (const t in w.extra) extra[t] = Math.round(w.extra[t] * 1.5 * near); }
      hits()?.deal(q, {by: 'smash', from: 'player', weapon: e.wid, dmg: Math.max(1, Math.round(dmg * near)), type: w.type === 'pierce' ? 'blunt' : w.type, extra,
        x: q.x, y: q.y, h: (q.z || 0) + .4, ux, uy, knock: 3.5 * near * (w.knock || 1), lift: (SM.lift + (w.lift || 0)) * near, stun: SM.stun, quiet: true, power: 1, guard: true});
      n++;
    }
    host.hitstop(.1); host.shake(Math.min(7, 4 + Math.round(bonus * 2) + (w.hands === 2 ? 1 : 0)), .3);
    host.events.push({type: 'melee.smash', x: e.x, y: e.y, z: e.z, r: R, n, weapon: e.wid});
    const c = core(); if (c) c.puff(e.x, e.y, e.z, 22, R * .55);
    rings(e.x, e.y, e.z, R, w);
  }

  // ---------------------------------------------------------------- defend (hits.defend): the guard's answer
  function defend(atk) {
    const mel = M(); if (!mel || !mel.guarding()) return NO;
    const P = host.player, f = P.faceAngle, fx = Math.sin(f), fy = Math.cos(f);
    const dx = atk.x - P.x, dy = atk.y - P.y, d = Math.hypot(dx, dy) || 1;
    const sh = mel.shieldOf(), w = mel.weaponOf(), cone = sh ? sh.cone : 90;
    if ((dx * fx + dy * fy) / d < Math.cos(cone / 2 * DEG)) return NO;   // (from the side or behind: it lands)
    const bullet = atk.kind === 'bullet', deflect = !sh && !!w.guard?.deflect && mel.held;
    if (bullet && !(sh?.bullets) && !deflect) return NO;
    if (!sh && !mel.held) return NO;   // (no shield and the blade away: nothing to block with)
    const win = sh ? sh.parry : w.guard?.parry || .15, ux = -dx / d, uy = -dy / d;
    const hx = P.x + fx * .45, hy = P.y + fy * .45, hh = P.z + (bullet ? 1.25 : 1.1);
    if (atk.kind !== 'blast' && mel.parryOpen(win)) {
      mel.parried(); S.parries++;
      slow(TUNE.parry.slowK, TUNE.parry.slowT); host.hitstop(.09); host.shake(3, .14);
      // the attacker staggers: its handler's stun (a brute held, a gunman dazed); a bullet on the saber goes back to its gunman
      const who = atk.who && typeof atk.who === 'object' ? atk.who : null;
      if (who) {
        if (bullet && deflect) hits()?.deal(who, {by: 'reflect', from: 'player', weapon: 'saber', dmg: Math.max(4, Math.round((atk.dmg || 8) * 2)), type: 'pierce', ux: -ux, uy: -uy, knock: 2, stun: .6, quiet: true, power: .8, guard: true});
        else if (!bullet) hits()?.stun(who, 1.3);
        if (bullet && deflect) zap(hx, hy, hh, who.x, who.y, (who.z || 0) + 1.3, w.light || '#bfe0ff');
      }
      host.events.push({type: 'melee.parry', x: hx, y: hy, h: hh, who, bullet});
      sparks(hx, hy, hh, -ux, -uy, 'parry', w, 1);
      DEF.out = 'parry'; DEF.k = 0; return DEF;
    }
    const share = sh?.hide && mel.S.hide ? 1 : bullet && (sh?.bullets || deflect) ? 1 : sh ? sh.block : w.guard?.block || .4;
    const k = atk.kind === 'blast' ? 1 - share * .5 : 1 - share;
    mel.blocked(ux, uy, atk.kind === 'blast' ? 2 : 1); S.blocks++;
    host.hitstop(.04); host.shake(2, .08);
    host.events.push({type: 'melee.block', x: hx, y: hy, h: hh, by: atk.who || null, bullet, k});
    sparks(hx, hy, hh, -ux, -uy, 'block', w, .6);
    DEF.out = 'block'; DEF.k = k; return DEF;
  }

  // ---------------------------------------------------------------- the thrown blade
  const TB = {on: false, wid: '', st: '', x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0, ang: 0, spin: 0, t: 0, flown: 0, who: null, ox: 0, oy: 0, oh: 0,
    hitSet: new Set(), pierced: 0, bounces: 0, sx: 0, sy: 0, tilt: 0, back: false};
  function throwOut(e) {
    const w = W(e.wid), T = w.throw || {v: 16, spin: 14, dmg: 1.5}, P = host.player;
    Object.assign(TB, {on: true, wid: e.wid, st: 'fly', x: P.x + e.vx * .4, y: P.y + e.vy * .4, h: P.z + TUNE.throw.h, vx: e.vx * T.v, vy: e.vy * T.v, vh: .6,
      ang: 0, spin: T.spin, t: 0, flown: 0, who: null, pierced: 0, bounces: 0, back: false});
    TB.hitSet.clear();
    host.events.push({type: 'melee.throw', x: TB.x, y: TB.y, h: TB.h, weapon: e.wid});
  }
  const solidAt = (x, y, h) => {
    for (const p of host.entities.near(x, y, .4, NEAR)) {
      if (p.broken || p.gone || kindOf(p) || p === TB.who) continue;
      if (p.rect) { if (x > p.rect[0] && x < p.rect[2] && y > p.rect[1] && y < p.rect[3] && h < (p.z || 0) + 3) return p; continue; }
      if (!(p.r > .15) || Math.hypot(p.x - x, p.y - y) > p.r) continue;
      const top = p.kind === 'tree' ? 8 : (p.z || 0) + 2.2; if (h > (p.z || 0) - .1 && h < top) return p;
    }
    return null;
  };
  function tbHit(q, ux, uy) {
    const w = W(TB.wid), T = w.throw || {dmg: 1.5};
    let extra = null; if (w.extra) { extra = {}; for (const t in w.extra) extra[t] = Math.round(w.extra[t] * (T.dmg || 1.5)); }
    const r = hits()?.deal(q, {by: 'thrown', from: 'player', weapon: TB.wid, dmg: Math.max(1, Math.round(w.dmg * dmgK * (T.dmg || 1.5))), type: w.type === 'blunt' ? 'blunt' : 'pierce', extra,
      x: TB.x, y: TB.y, h: TB.h, ux, uy, knock: 3 * (w.knock || 1), lift: w.lift || 0, stun: .5, quiet: true, power: .8, guard: true});
    host.hitstop(.06); host.shake(2, .1);
    host.events.push({type: 'melee.hit', x: TB.x, y: TB.y, h: TB.h, who: q, kind: 'body', mv: 'throw', weapon: TB.wid, power: .8, ko: !!r?.ko, crit: false, dx: ux, dy: uy, kick: 2});
    sparks(TB.x, TB.y, TB.h, ux, uy, 'body', w, .8);
    return r;
  }
  function stick(st, who) {
    TB.st = st; TB.who = who; TB.t = 0; TB.vx = TB.vy = TB.vh = 0;
    const l = Math.hypot(TB.sx, TB.sy) || 1; TB.tilt = Math.atan2(TB.sy / l, TB.sx / l);
    if (who) { TB.ox = TB.x - who.x; TB.oy = TB.y - who.y; TB.oh = TB.h - (who.z || 0); }
    host.events.push({type: 'melee.stick', x: TB.x, y: TB.y, h: TB.h, into: who ? (kindOf(who) ? 'body' : who.kind || 'thing') : st === 'ground' ? 'ground' : 'wall', weapon: TB.wid});
  }
  function caught() {
    const mel = M(); TB.on = false; TB.st = ''; TB.who = null;
    mel?.catch();
    host.events.push({type: 'melee.catch', x: host.player.x, y: host.player.y, h: host.player.z + 1.2, weapon: TB.wid});
  }
  function recall() {
    if (!TB.on || TB.st === 'back') return false;
    const w = W(TB.wid);
    if (w.throw?.blink && TB.st !== 'fly') {   // the Rift Blade: you go where it is
      const P = host.player, dx = TB.x - P.x, dy = TB.y - P.y, d = Math.hypot(dx, dy) || 1;
      const x = TB.x - dx / d * .5, y = TB.y - dy / d * .5;
      if (!host.blocked(x, y, host.elev(x, y))) {
        host.events.push({type: 'melee.blink', x: P.x, y: P.y, x1: x, y1: y});
        blinkFx(P.x, P.y, P.z, x, y, host.elev(x, y));
        host.teleport(x, y); caught(); return true;
      }
    }
    TB.st = 'back'; TB.who = null; TB.t = 0; TB.hitSet.clear(); TB.back = true;
    host.events.push({type: 'melee.recall', x: TB.x, y: TB.y, weapon: TB.wid});
    return true;
  }
  function stepBlade(dt) {
    if (!TB.on) return;
    const w = W(TB.wid), T = w.throw || {}, P = host.player;
    TB.t += dt;
    if (TB.st === 'fly' || TB.st === 'back') TB.ang += TB.spin * dt;
    if (TB.st === 'fly') {
      const n = Math.max(1, Math.ceil(Math.hypot(TB.vx, TB.vy) * dt / .15));
      TB.vh -= TUNE.throw.drop * (TB.flown > TUNE.throw.range ? 4 : 1) * dt;
      for (let i = 0; i < n; i++) {
        const sx = TB.vx * dt / n, sy = TB.vy * dt / n, sh = TB.vh * dt / n;
        TB.x += sx; TB.y += sy; TB.h += sh; TB.flown += Math.hypot(sx, sy); TB.sx = TB.vx; TB.sy = TB.vy;
        // a body?
        let hitQ = null;
        for (const q of host.entities.near(TB.x, TB.y, .9, NEAR)) {
          if (TB.hitSet.has(q) || kindOf(q) === '' || Math.abs((q.z || 0) + 1 - TB.h) > 1.3) continue;
          if (Math.hypot(q.x - TB.x, q.y - TB.y) > rOf(q) + .25) continue;
          hitQ = q; break;
        }
        if (hitQ) {
          TB.hitSet.add(hitQ);
          const l = Math.hypot(TB.vx, TB.vy) || 1, ux = TB.vx / l, uy = TB.vy / l;
          const r = tbHit(hitQ, ux, uy);
          if (T.bounce && TB.bounces < T.bounce) { TB.bounces++; bounce(hitQ.x, hitQ.y); continue; }
          if (T.pierce && TB.pierced < T.pierce) { TB.pierced++; continue; }
          if (T.back) { recall(); return; }
          if (T.stick && !r?.ko && kindOf(hitQ) === 'body') { stick('lodged', hitQ); return; }
          TB.vx *= -.15; TB.vy *= -.15; TB.vh = 2; TB.spin *= .5;   // (it falls off what it killed / didn't stick in)
          continue;
        }
        const wall = solidAt(TB.x, TB.y, TB.h);
        if (wall) {
          if (T.bounce && TB.bounces < T.bounce) { TB.bounces++; bounce(wall.x, wall.y); continue; }
          if (T.back) { recall(); return; }
          TB.x -= sx; TB.y -= sy;
          if (T.stick) { stick('stuck', wall); return; }
          TB.vx *= -.2; TB.vy *= -.2; TB.vh = 1.5;
          continue;
        }
        const g = host.elev(TB.x, TB.y);
        if (TB.h <= g + .05) {
          TB.h = g + .05;
          if (T.back) { recall(); return; }
          if (T.stick && TB.flown < TUNE.throw.range * 1.4) { stick('ground', null); TB.h = g + .25; return; }
          stick('ground', null); TB.h = g + .04; TB.tilt = TB.ang; return;
        }
      }
      if (T.back && TB.flown > TUNE.throw.range * .8) recall();
      return;
    }
    if (TB.st === 'lodged') {
      const q = TB.who;
      if (!q || q.gone || q.broken || !kindOf(q) || TB.t > TUNE.throw.lodge) {   // it fell out (dead, gone, or worked loose)
        TB.st = 'fly'; TB.who = null; TB.vx = TB.vy = 0; TB.vh = 1.5; TB.spin = 6; TB.flown = TUNE.throw.range * 2; TB.hitSet.clear(); if (q) TB.hitSet.add(q);
        return;
      }
      TB.x = q.x + TB.ox; TB.y = q.y + TB.oy; TB.h = (q.z || 0) + TB.oh;
    }
    if (TB.st === 'back') {
      const hx = P.x, hy = P.y, hh = P.z + 1.1, dx = hx - TB.x, dy = hy - TB.y, dh = hh - TB.h, d = Math.hypot(dx, dy, dh);
      if (d < .6) { caught(); return; }
      const v = TUNE.throw.back * Math.min(1, .35 + TB.t * 2.5), st = Math.min(d, v * dt);
      TB.x += dx / d * st; TB.y += dy / d * st; TB.h += dh / d * st; TB.sx = dx; TB.sy = dy;
      for (const q of host.entities.near(TB.x, TB.y, .9, NEAR)) {
        if (TB.hitSet.has(q) || kindOf(q) !== 'body' || Math.hypot(q.x - TB.x, q.y - TB.y) > rOf(q) + .3) continue;
        TB.hitSet.add(q); tbHit(q, dx / d, dy / d);
      }
      return;
    }
    // lying or stuck: walk over it and it's his
    if (Math.hypot(P.x - TB.x, P.y - TB.y) < TUNE.throw.pick && Math.abs(P.z - TB.h) < 2) caught();
  }
  function bounce(cx, cy) {
    const l = Math.hypot(TB.vx, TB.vy) || 1, nx = TB.x - cx, ny = TB.y - cy, nl = Math.hypot(nx, ny) || 1;
    const ux = nx / nl, uy = ny / nl, dot = (TB.vx * ux + TB.vy * uy);
    TB.vx -= 2 * dot * ux; TB.vy -= 2 * dot * uy;
    const k = Math.hypot(TB.vx, TB.vy) || 1; TB.vx = TB.vx / k * l * .85; TB.vy = TB.vy / k * l * .85; TB.vh = Math.max(TB.vh, 2.2);
    TB.flown = Math.min(TB.flown, TUNE.throw.range * .6);
    host.events.push({type: 'melee.bounce', x: TB.x, y: TB.y, h: TB.h, weapon: TB.wid});
  }

  // ---------------------------------------------------------------- the view's records (presentation: Math.random)
  const VR = (a, b) => a + Math.random() * (b - a);
  const FX = Array.from({length: NFX}, () => ({on: false, x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0, t: 0, life: .3, c: '#fff', g: 0, drag: 3, emit: true}));
  let fxI = 0;
  function px(x, y, h, vx, vy, vh, life, c, g = 6, drag = 3, emit = true) { const q = FX[fxI]; fxI = (fxI + 1) % NFX; q.on = true; q.x = x; q.y = y; q.h = h; q.vx = vx; q.vy = vy; q.vh = vh; q.t = 0; q.life = life; q.c = c; q.g = g; q.drag = drag; q.emit = emit; }
  const PEND = [];   // (sim -> view: the bursts the sim's moments asked for; the view spends them)
  function sparks(x, y, h, ux, uy, kind, w, power) { if (PEND.length < 24) PEND.push({k: 'spark', x, y, h, ux, uy, kind, w, power}); }
  function rings(x, y, z, r, w) { if (PEND.length < 24) PEND.push({k: 'ring', x, y, h: z, r, w}); }
  function zap(x, y, h, x1, y1, h1, c) { if (PEND.length < 24) PEND.push({k: 'zap', x, y, h, x1, y1, h1, c}); }
  function blinkFx(x, y, h, x1, y1, h1) { if (PEND.length < 24) PEND.push({k: 'blink', x, y, h, x1, y1, h1}); }
  const RINGS = Array.from({length: NRING}, () => ({on: false, x: 0, y: 0, h: 0, r: 0, t: 0, c: '#fff', cracks: 0, seed: 0}));
  let ri = 0;
  const ZAPS = Array.from({length: 4}, () => ({on: false, t: 0, x: 0, y: 0, h: 0, x1: 0, y1: 0, h1: 0, c: '#fff'}));
  let zi = 0;
  // the swing's streak: the blade's sweep round him (sweep deg off his facing, start -> end) over the swing's time, at its reach
  const TR = Array.from({length: NTR}, () => ({on: false, t: 0, dur: .1, a0: 0, a1: 0, f: 0, r: 1, h0: 1, h1: 1, c: '#fff', w: 1, glow: false}));
  let tri = 0;
  function trail(e) {
    const m = MOVES[e.mv], mel = M(); if (!m || e.mv === 'throw' || e.mv === 'bash') return;
    const w = W(e.wid), T = TR[tri]; tri = (tri + 1) % NTR;
    const pace = mel?.pace || 1, hitT = m.hit / pace;
    T.on = true; T.t = 0; T.dur = hitT + .05; T.f = Math.atan2(e.vx, e.vy);
    T.a0 = m.sweep[0] * DEG; T.a1 = m.sweep[1] * DEG; T.r = Math.max(.6, (w.len || .9) + .45) * (m.reach || 1);
    T.h0 = e.mv === 'rise' ? .5 : e.mv === 'overhead' || e.mv === 'cleave' ? 2.1 : e.mv === 'thrust' || e.mv === 'jab' || e.mv === 'lunge' || e.mv === 'dash' ? 1.15 : 1.25;
    T.h1 = e.mv === 'rise' ? 1.9 : e.mv === 'overhead' || e.mv === 'cleave' ? .35 : T.h0 - .1;
    T.c = mel?.weapon === 'saber' ? sabCol() : w.trail || '#fff'; T.glow = !!w.light; T.w = w.hands === 2 ? 2 : 1;
    T.thrust = m.sweep[0] === m.sweep[1];
  }
  const sabCol = () => { const L = WEAPONS.saber.colors; return L[S.saber % L.length]; };

  const F = {
    name: 'melee', label: 'Melee', on: ON, S, TB, owned, toasts,
    weapon: () => { const m = M(); return m?.on ? m.weapon : ''; },
    shield: () => { const m = M(); return m?.on ? m.shield : ''; },
    owned: () => [...owned],
    give(id) { if (WEAPONS[id]) owned.add(id); },
    equip(id, sid) { const m = M(); if (!m) return false; m.equip(WEAPONS[id] ? id : undefined, sid); if (!m.on) draw(); return true; },
    WEAPONS, SHIELDS,
    recall,

    update(dt, evs) {
      const mel = M();
      if (!mel) return;
      if (!F._def) { F._def = true; hits()?.setDefender(defend); }
      if (mel.on) {
        S.lockT -= dt;
        if (S.lockT <= 0 || (S.lockP && (S.lockP.broken || S.lockP.gone))) { S.lockT = .1; S.lockP = findLock(); }
        if (S.lockP) mel.lock(S.lockP.x, S.lockP.y, rOf(S.lockP)); else mel.unlock();
      }
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.type === 'player.blade') land(e);
        else if (e.type === 'player.smash') smash(e);
        else if (e.type === 'player.bladethrow') throwOut(e);
        else if (e.type === 'player.hurt') mel.hurt();
      }
      stepBlade(dt);
      if (TB.on && !mel.on) { /* (put away while thrown: it stays where it is until he comes for it) */ }
      S.comboT += dt;
      if (S.slowT > 0 && (S.slowT -= dt) <= 0 && S.slowOn) { host.mods?.clear('melee'); S.slowOn = false; }
    },
    onKey(k) {
      const mel = M(); if (!mel) return false;
      if (k === '3') { if (!mel.on) draw(); else next(1); return true; }
      if (k === '1' || k === '2') { if (mel.on) sheath(); return false; }
      if (!mel.on) return false;
      if (k === '4') { nextShield(); return true; }
      if (k === 'r') { if (mel.held) return mel.throwOut(); return recall(); }
      if (k === 'c') { if (mel.mode === '' && !mel.S.rmb && host.P.state !== 'roll') { host.PL.startRoll(); return true; } return false; }
      return false;
    },
    claims: k => !!M() && (k === '3' || (M().on && (k === '4' || k === 'r' || k === 'c'))),

    view(dt) {
      const G = host.G;
      // the sim's bursts
      while (PEND.length) {
        const b = PEND.pop();
        if (b.k === 'spark') {
          const C = b.kind === 'block' || b.kind === 'parry' ? BLOCKC : b.w?.light ? [b.w.light, b.w.trail || '#fff', '#ffffff', b.w.light] : SPARK;
          const n = b.kind === 'parry' ? 26 : b.kind === 'block' ? 10 : 5 + Math.round(b.power * 10);
          for (let i = 0; i < n; i++) px(b.x, b.y, b.h + VR(-.1, .1), b.ux * VR(.5, 3.5) + VR(-1.5, 1.5), b.uy * VR(.5, 3.5) + VR(-1.5, 1.5), VR(-.5, 3), VR(.12, b.kind === 'parry' ? .5 : .3), C[i % C.length], 7, 3);
          if (b.kind === 'parry') { const r = RINGS[ri]; ri = (ri + 1) % NRING; Object.assign(r, {on: true, x: b.x, y: b.y, h: b.h, r: 1.2, t: 0, c: '#ffffff', cracks: 0, flat: false}); }
        } else if (b.k === 'ring') {
          const r = RINGS[ri]; ri = (ri + 1) % NRING; Object.assign(r, {on: true, x: b.x, y: b.y, h: b.h + .05, r: b.r, t: 0, c: b.w?.light || '#f2ead2', cracks: 7 + Math.round(b.r * 2), seed: Math.random() * TAU, flat: true});
          for (let i = 0; i < 40; i++) { const a = Math.random() * TAU, s = VR(2, 6) * b.r / 2.4; px(b.x + Math.sin(a) * .3, b.y + Math.cos(a) * .3, b.h + .1, Math.sin(a) * s, Math.cos(a) * s, VR(1, 4), VR(.3, .7), b.w?.light && i % 2 ? b.w.light : DUSTC[i % 4], 9, 2.5, !!b.w?.light && i % 2 === 0); }
        } else if (b.k === 'zap') { const z = ZAPS[zi]; zi = (zi + 1) % ZAPS.length; Object.assign(z, {on: true, t: 0, x: b.x, y: b.y, h: b.h, x1: b.x1, y1: b.y1, h1: b.h1, c: b.c}); }
        else if (b.k === 'blink') {
          for (let i = 0; i < 30; i++) { const u = i / 30; px(b.x + (b.x1 - b.x) * u, b.y + (b.y1 - b.y) * u, b.h + 1 + (b.h1 - b.h) * u + VR(-.3, .3), VR(-.5, .5), VR(-.5, .5), VR(-.5, .8), VR(.3, .7), WEAPONS.rift.look.steel[i % 3], -.5, 1); }
        }
      }
      // the swing streaks (the fan of the blade's sweep so far, the old part fading)
      const P = host.player;
      for (const T of TR) {
        if (!T.on) continue;
        T.t += dt; const life = T.dur + TUNE.trail; if (T.t > life) { T.on = false; continue; }
        const head = Math.min(1, T.t / T.dur), tail = Math.max(0, (T.t - TUNE.trail) / T.dur), N = 9;
        if (T.thrust) {   // a thrust: a straight streak out along the facing
          const fx = Math.sin(T.f), fy = Math.cos(T.f), a = P.z + T.h0, r0 = .4 + tail * T.r * .5, r1 = .4 + head * T.r;
          host.line(P.x + fx * r0, P.y + fy * r0, a, P.x + fx * r1, P.y + fy * r1, a, T.c, T.glow);
          host.line(P.x + fx * r0, P.y + fy * r0, a + .05, P.x + fx * r1 * .9, P.y + fy * r1 * .9, a + .05, '#ffffff', T.glow);
          continue;
        }
        let lx = 0, ly = 0, lh = 0, ix = 0, iy = 0, ih = 0;
        for (let i = 0; i <= N; i++) {
          const u = tail + (head - tail) * i / N, a = T.f + T.a0 + (T.a1 - T.a0) * u, h = P.z + T.h0 + (T.h1 - T.h0) * u, sx = Math.sin(a), sy = Math.cos(a);
          const x = P.x + sx * T.r, y = P.y + sy * T.r, xi = P.x + sx * T.r * .62, yi = P.y + sy * T.r * .62;
          if (i) {
            const c = i > N * .6 ? '#ffffff' : T.c;
            host.line(lx, ly, lh, x, y, h, c, T.glow);
            host.line(ix, iy, ih, xi, yi, h, T.c, T.glow);
            if (T.w > 1) host.line((lx + ix) / 2, (ly + iy) / 2, lh, (x + xi) / 2, (y + yi) / 2, h, T.c, T.glow);
          }
          lx = x; ly = y; lh = h; ix = xi; iy = yi; ih = h;
        }
      }
      // the rings (a smash's shockwave and its cracks; a parry's flash)
      for (const r of RINGS) {
        if (!r.on) continue;
        r.t += dt; const life = r.flat ? .45 : .2; if (r.t > life) { r.on = false; continue; }
        const u = r.t / life, rr = r.r * (r.flat ? .3 + .7 * Math.sqrt(u) : .3 + u), n = 28;
        for (let i = 0; i < n; i++) {
          const a0 = i / n * TAU, a1 = (i + 1) / n * TAU;
          if (r.flat) {
            const h0 = host.elev(r.x + Math.sin(a0) * rr, r.y + Math.cos(a0) * rr) + .06, h1 = host.elev(r.x + Math.sin(a1) * rr, r.y + Math.cos(a1) * rr) + .06;
            host.line(r.x + Math.sin(a0) * rr, r.y + Math.cos(a0) * rr, h0, r.x + Math.sin(a1) * rr, r.y + Math.cos(a1) * rr, h1, u < .5 ? r.c : DUSTC[1], u < .5);
          } else host.line(r.x + Math.sin(a0) * rr, r.y + Math.cos(a0) * rr * .5, r.h + Math.cos(a0) * rr * .5, r.x + Math.sin(a1) * rr, r.y + Math.cos(a1) * rr * .5, r.h + Math.cos(a1) * rr * .5, r.c, true);
        }
        if (r.cracks && u < .9) for (let i = 0; i < r.cracks; i++) {   // the cracks: jagged lines out from the middle
          let a = r.seed + i * TAU / r.cracks, x = r.x, y = r.y; const L = r.r * (.5 + .5 * ((i * 7919) % 13) / 13) * Math.min(1, u * 4);
          for (let j = 0; j < 4; j++) {
            a += (((i * 31 + j * 17) % 7) - 3) * .12;
            const nx = x + Math.sin(a) * L / 4, ny = y + Math.cos(a) * L / 4;
            host.line(x, y, host.elev(x, y) + .04, nx, ny, host.elev(nx, ny) + .04, '#2a2018', false); x = nx; y = ny;
          }
        }
      }
      for (const z of ZAPS) {
        if (!z.on) continue;
        z.t += dt; if (z.t > .14) { z.on = false; continue; }
        host.line(z.x, z.y, z.h, z.x1, z.y1, z.h1, z.c, true); host.line(z.x, z.y, z.h + .03, z.x1, z.y1, z.h1 + .03, '#ffffff', true);
      }
      // the thrown blade: a spinning line with its guard, glowing if it glows; lying / stuck: still
      if (TB.on) drawBlade();
      // sprite path (no live body to hold it): the blade as a line from his hand
      const mel = M();
      if (mel?.on && mel.held && !host.live) drawHeldLine(mel);
      // the light weapons' embers off the blade
      if (mel?.on && mel.held) {
        const w = mel.weaponOf();
        if (w.look?.flame && Math.random() < dt * 30) { const b = host.playerBlade?.(); const x = b ? b.tx : P.x, y = b ? b.ty : P.y, h = b ? b.th : P.z + 1.2; px(x + VR(-.1, .1), y + VR(-.1, .1), h, VR(-.3, .3), VR(-.3, .3), VR(.6, 1.6), VR(.2, .45), ['#fff4c0', '#ffc060', '#ff7a2a'][Math.floor(Math.random() * 3)], -1.5, 1); }
      }
      for (const q of FX) {
        if (!q.on) continue;
        q.t += dt; if (q.t >= q.life) { q.on = false; continue; }
        const d = Math.exp(-q.drag * dt); q.vx *= d; q.vy *= d; q.vh -= q.g * dt;
        q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt;
        const O = q.emit ? EM : LIT; host.point(q.x, q.y, q.h, q.c, O);
      }
      toasts.update(dt);
      void G;
    },
    lights() {
      LT.length = 0;
      const mel = M(), P = host.player;
      if (mel?.on && mel.held) {
        const w = mel.weaponOf();
        if (w.light) { const b = host.playerBlade?.(); L0.x = b ? b.tx : P.x; L0.y = b ? b.ty : P.y; L0.h = b ? b.th : P.z + 1.2; L0.color = mel.weapon === 'saber' ? sabCol() : w.light; L0.intensity = w.look?.flame ? 1.1 : .8; L0.flicker = w.look?.flame ? .5 : .1; LT.push(L0); }
      }
      if (TB.on && W(TB.wid).light) { L1.x = TB.x; L1.y = TB.y; L1.h = TB.h; L1.color = TB.wid === 'saber' ? sabCol() : W(TB.wid).light; LT.push(L1); }
      return LT;
    },
    hd(q) {
      if (host.hudOff) return;
      const mel = M(); if (!mel) return;
      const u = hdUnit();
      if (toasts.length) toasts.draw(q, q.canvas.width, q.canvas.height, u);
      if (!mel.on || host.lock) return;
      // the weapon in hand, bottom left: its name, the shield's; R's state when it's away; a combo count
      const W2 = q.canvas.width, H2 = q.canvas.height, w = mel.weaponOf(), sh = mel.shieldOf();
      const x = 16 * u, y = H2 - 18 * u;
      hdText(q, (mel.held ? w.name : w.name + ' (thrown: R calls it back)') + (sh ? '  +  ' + sh.name : w.hands === 2 ? '  (two hands)' : ''), x, y, u, mel.held ? '#f2d27a' : '#e2644d');
      hdText(q, '3 weapon  4 shield  LMB swing / hold  RMB guard  Space jump  R throw  C roll', x, y + 11 * u, Math.max(1, u - 1), '#a89a80');
      if (S.combo >= 3 && S.comboT < 1.4) hdText(q, S.combo + ' hits', W2 / 2, H2 * .3, u, S.combo >= 6 ? '#ffd27a' : '#f2ead2', 'center');
    },
    hud: () => { const m = M(); return m ? `melee ${m.on ? m.weapon + (m.shield ? '+' + m.shield : '') + ' ' + (m.mode || 'out') + (m.S.mv ? ' ' + m.S.mv + ' ' + m.S.ph : '') : 'away'} hits ${S.hits} whiffs ${S.whiffs} parries ${S.parries} blocks ${S.blocks}${TB.on ? ' blade ' + TB.st : ''}` : ''; },
    biomeChanged() { S.lockP = null; if (TB.on) caught(); },
    // the dev menu's page (dev/devmenu.js, F10 > Combat): pick the weapon and the shield, call up a brute to practise on
    dev: {group: 'Combat', rows: () => [
      {label: 'Weapon', options: WEAPON_IDS, get: () => M()?.S.wid || '', set: v => F.equip(v)},
      {label: 'Shield', options: SHIELD_IDS, get: () => M()?.S.sid || '', set: v => F.equip(undefined, v)},
      {label: 'Call up a brute to fight', run: () => practice(1)},
      {label: 'Call up three brutes', run: () => practice(3)},
      {label: 'Counts', text: () => `hits ${S.hits}  whiffs ${S.whiffs}  parries ${S.parries}  blocks ${S.blocks}`},
    ]},
  };
  // brutes to practise on (the dev menu): a few metres ahead, hunting him (combat core's spawnBrute)
  function practice(n) {
    const c = core(), P = host.player; if (!c?.spawnBrute) return;
    for (let i = 0; i < n; i++) {
      const a = P.faceAngle + (i - (n - 1) / 2) * .6, x = P.x + Math.sin(a) * 5, y = P.y + Math.cos(a) * 5;
      if (!host.blocked(x, y, host.elev(x, y))) c.spawnBrute({x, y, hp: 60, name: 'practice'});
    }
  }
  const LT = [], L0 = {x: 0, y: 0, h: 0, color: '#fff', radius: 2.6, intensity: .8, flicker: .1, id: 7300}, L1 = {x: 0, y: 0, h: 0, color: '#fff', radius: 2, intensity: .7, flicker: .1, id: 7301};
  const EM = {size: 1, emit: true}, LIT = {size: 1, emit: false};
  function draw() {
    const mel = M(); if (!mel) return;
    mel.select(true);
    if (mel.weapon === 'saber') S.saber++;
    announce();
    host.events.push({type: 'melee.draw', x: host.player.x, y: host.player.y, weapon: mel.weapon});
  }
  function sheath() { M()?.select(false); }
  function announce() {
    const mel = M(), w = mel.weaponOf(), sh = mel.shieldOf();
    toasts.push(w.name + (sh ? '  +  ' + sh.name : ''), w.note || '', mel.weapon === 'saber' ? sabCol() : w.trail || '#f4efe4', 2.6);
  }
  function next(dir) {
    const mel = M(); if (!mel.held) { toasts.push('Your weapon is out there', 'R calls it back', '#e2644d', 1.8); return; }
    const L = WEAPON_IDS.filter(id => owned.has(id)), i = L.indexOf(mel.weapon);
    mel.equip(L[(i + dir + L.length) % L.length]);
    if (mel.weapon === 'saber') S.saber++;
    announce();
    host.events.push({type: 'melee.draw', x: host.player.x, y: host.player.y, weapon: mel.weapon});
  }
  function nextShield() {
    const mel = M(), i = SHIELD_IDS.indexOf(mel.S.sid);
    mel.equip(undefined, SHIELD_IDS[(i + 1) % SHIELD_IDS.length]);
    const sh = SHIELDS[mel.S.sid];
    toasts.push(sh ? sh.name : 'No shield', mel.weaponOf().hands === 2 ? 'on your back while you hold the ' + mel.weaponOf().name : sh?.hide ? 'RMB + C: hide behind it' : sh ? 'RMB: block, raise it just in time: parry' : 'RMB: guard with the blade', '#f4efe4', 2.2);
  }
  // the blade in flight / lying: a line along its length, turned by its spin (in the plane of its flight), its guard across
  function drawBlade() {
    const w = W(TB.wid), L = Math.max(.35, w.len || .9), c = TB.wid === 'saber' ? sabCol() : w.look?.steel?.[1] || '#c8d0dc', glow = !!w.light;
    const l = Math.hypot(TB.sx, TB.sy) || 1, ux = TB.sx / l, uy = TB.sy / l;
    let ax, ay, ah;
    if (TB.st === 'fly' || TB.st === 'back') { const a = TB.ang; ax = ux * Math.cos(a); ay = uy * Math.cos(a); ah = Math.sin(a); }
    else if (TB.st === 'ground' && !W(TB.wid).throw?.stick) { ax = Math.cos(TB.tilt); ay = Math.sin(TB.tilt); ah = 0; }
    else { ax = -ux * .75; ay = -uy * .75; ah = .55; }   // (stuck: the hilt sticking out back toward where it came from, up a little)
    const gx = TB.x + ax * L * .2, gy = TB.y + ay * L * .2, gh = TB.h + ah * L * .2;   // (the guard: a fifth of the way back)
    const tx = TB.x - ax * L * .8, ty = TB.y - ay * L * .8, th = TB.h - ah * L * .8;   // (the point: forward, into what it's in)
    const hx = TB.x + ax * L * .45, hy = TB.y + ay * L * .45, hh = TB.h + ah * L * .45;
    host.line(gx, gy, gh, tx, ty, th, c, glow);
    host.line(gx, gy, gh, hx, hy, hh, w.look?.hilt?.[1] || '#6e4622', false);
    const cx = -ay, cy = ax, g = .1;
    host.line(gx + cx * g, gy + cy * g, gh, gx - cx * g, gy - cy * g, gh, w.look?.hilt?.[0] || '#c89a3a', false);
    if (TB.st === 'fly' || TB.st === 'back') {   // a faint blur of the spin
      const a = TB.ang - .7, bx = ux * Math.cos(a), by = uy * Math.cos(a), bh = Math.sin(a);
      host.line(TB.x, TB.y, TB.h, TB.x - bx * L * .7, TB.y - by * L * .7, TB.h - bh * L * .7, glow ? c : '#8a94a4', glow);
    } else if (Math.floor(performance.now() / 400) % 2 === 0) host.point(hx, hy, hh + .08, '#fff4c0', EM);   // (lying: it glints now and then)
  }
  // the sprite path's blade: from his hand (a stand-in point by his facing) along the swing's way, or hanging at his side
  function drawHeldLine(mel) {
    const P = host.player, w = mel.weaponOf(), f = P.faceAngle, fx = Math.sin(f), fy = Math.cos(f), L = w.len || .9;
    const hx = P.x + fx * .25 - fy * .2, hy = P.y + fy * .25 + fx * .2, hh = P.z + 1;
    let ax = fx * .3, ay = fy * .3, ah = -.95;
    const T = TR[(tri + NTR - 1) % NTR];
    if (T.on && T.t < T.dur + .05) { const u = Math.min(1, T.t / T.dur), a = T.f + T.a0 + (T.a1 - T.a0) * u; ax = Math.sin(a); ay = Math.cos(a); ah = (T.h1 - T.h0) * .6; }
    else if (mel.mode === 'mguard') { ax = fx * .3; ay = fy * .3; ah = .9; }
    const l = Math.hypot(ax, ay, ah) || 1; ax /= l; ay /= l; ah /= l;
    host.line(hx, hy, hh, hx + ax * L, hy + ay * L, hh + ah * L, mel.weapon === 'saber' ? sabCol() : w.look?.steel?.[1] || '#c8d0dc', !!w.light);
  }
  // the swing's streak starts with its swing (player.bladecue: the sim's moment)
  const viewEv = F.view;
  F.view = function (dt, evs) {
    if (evs) for (let i = 0; i < evs.length; i++) { const e = evs[i]; if (e.type === 'player.bladecue' && e.phase === 'swing') trail(e); }
    viewEv(dt);
  };
  return F;
}
