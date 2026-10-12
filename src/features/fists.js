// FISTS feature: unarmed fighting for the live cowboys (docs/exp/fists.md). The player's side (the stance, the moves, their
// timing, the slip, the clinch's hands) is sim/player/fists.js (host.PL.fists); this feature gives it its keys, its soft lock
// and does what the blows do, through the owners' APIs:
//   2 / 1     the fists (the gun in the holster) / the gun again (a live loadout; ?fists=0: off). The guard is up only while a
//             fight is on (content/fists.js TUNE.rest: a foe within `near` m, a blow taken, a hand pressed); else he walks as ever
//   V         in a string: the roundhouse; in a clinch: the knee (else brawl's push kick)
//   E         the grab, at a foe in reach (else E is the chests', the signs', the lift's); in a clinch the hip toss
//   (LMB / RMB / Space reach the player's side through player.js and core/input.js)
// A BLOW (player.punch: world coordinates) meets ONE thing: the nearest body in its arc and reach (a held foe in a clinch);
// else a dummy, a breakable thing, a movable prop. A gunman's reaction (block, head snap, gut, daze, floored) is his brawler's
// (features/foes/brawler.js), a brute's combat's (hold, launch), the damage combat's (by 'fist'). The feel: hitstop by the move's
// weight, the camera's kick (features/flow.js on fist.hit), shake on the heavies, a counter's / a knockout's slow-down (the note
// 'sim.speed' x for a moment of sim time), the hit stars and sparks (this feature's view), the sounds (audio on fist.*).
// OWNS: the clinch's held foe, the slow-down's clock, the modifier source 'fists', the combo count, its view's stars.
// READS: host.PL.fists, host.player / aim / entities (near) / live, combat (core, phys), foes (sim, its brawler).
// EMITS: fist.hit, fist.whiff, fist.grab. BUDGET: sim: one near() a blow, one a step for the lock (4 Hz); view: a few rects.
import {TUNE, MOVES, REACT} from '../content/fists.js';
import {flags} from '../core/flags.js';
import {viewRandom} from '../core/rng.js';

const DEG = Math.PI / 180, LK = TUNE.lock, CL = TUNE.clinch, CT = TUNE.counter, KO = TUNE.ko, RS = TUNE.rest;
const ON = flags.get('fists') !== '0';
const MOVABLE = new Set(['crate', 'barrel', 'barrel_x']);
// a gunman blocking: the share of a blow's damage through his guard (a quick one / anything else)
const FOE_BLOCK = {jab: .15, other: .35};
const STAR = ['#ffffff', '#fff4c0', '#ffd27a', '#f2a03a'], BLOCKC = ['#ffffff', '#d8f0ff', '#8ac0f0'];
const NFX = 24;

export const order = {before: ['brawl', 'gun', 'combat']};
export async function create(host) {
  let combat = null, foes = null;
  const core = () => (combat ??= host.feature('combat'))?.core || null;
  const phys = () => (combat ??= host.feature('combat'))?.phys || null;
  const fsim = () => (foes ??= host.feature('foes'))?.sim || null;
  const brawler = () => fsim()?.brawler || null;
  const B = () => ON && host.live ? host.PL.fists : null;
  const NEAR = [], VR = viewRandom('fists'), R2 = (a, b) => a + VR() * (b - a);
  const S = {held: null, holdT: 0, holdMax: 0, slowT: 0, slowOn: false, combo: 0, comboT: 9, lockT: 0, lockP: null, hits: 0, whiffs: 0, last: ''};
  // the stars (the view's): a ring of preallocated records
  const FX = Array.from({length: NFX}, () => ({on: false, t: 0, life: .16, x: 0, y: 0, h: 0, k: 0, kind: 0, dx: 0, dy: 0}));
  let fxI = 0;
  function star(x, y, h, k, kind, dx, dy) { const f = FX[fxI]; fxI = (fxI + 1) % NFX; f.on = true; f.t = 0; f.life = kind === 1 ? .14 : .12 + .08 * k; f.x = x; f.y = y; f.h = h; f.k = k; f.kind = kind; f.dx = dx; f.dy = dy; }

  // ---------------------------------------------------------------- what's what
  const isBody = p => !!p && (p.kind === 'gunman' || !!core()?.BS.has(p)) && !p.broken && !p.gone && !p.retired;
  const isDummy = p => !!p && p.target && !(p.hp > 0) && !p.hunter && p.kind !== 'gunman';
  const isThing = p => !!p && (p.hp > 0 || p.target) && (p.breakable || p.target) && !p.hunter && p.kind !== 'gunman' && !p.wall && !p.rect;
  const movable = q => !!q && MOVABLE.has(q.kind) && !q.wall && !q.broken && !q.gone && !q.sink && !q.float && !q.held;
  const rOf = p => p.r ?? .3;
  const downed = p => { const g = fsim()?.recOf(p); return !!(g && g.down); };
  // the soft lock: the body (or a dummy) nearest the cursor's way within LK.cone deg and LK.range m (the one under the cursor first)
  function findLock() {
    const P = host.player, a = host.aim(), c = Math.cos(host.yaw), s = Math.sin(host.yaw);
    let ax = a.x, ay = a.y;
    if (!a.target) { const g = host.PL.cursorGround(); ax = g.x * c + g.y * s; ay = -g.x * s + g.y * c; }
    let dx = ax - P.x, dy = ay - P.y, d = Math.hypot(dx, dy);
    if (d < .1) { const f = P.faceAngle; dx = Math.sin(f); dy = Math.cos(f); d = 1; }
    dx /= d; dy /= d;
    const cs = Math.cos(LK.cone * DEG); let best = null, bs = 1e9, cur = 1e9;
    for (const p of host.entities.near(P.x, P.y, LK.range + .6, NEAR)) {
      if (!(isBody(p) || isDummy(p)) || downed(p) || Math.abs((p.z || 0) - P.z) > 1) continue;
      const ex = p.x - P.x, ey = p.y - P.y, l = Math.hypot(ex, ey); if (l < .05 || l - rOf(p) > LK.range) continue;
      const cosA = (ex * dx + ey * dy) / l, under = a.target === p;
      if (!under && cosA < cs) continue;
      const sc = l * (1.6 - cosA) - (under ? 2 : 0) - (isBody(p) ? .3 : 0);
      if (p === S.lockP) cur = sc;
      if (sc < bs) { bs = sc; best = p; }
    }
    // the one he's on stays unless another is clearly the better (no flipping between two close foes)
    return cur < 1e9 && best !== S.lockP && bs > cur - .45 ? S.lockP : best;
  }
  // a fight on: a living body (a gunman, a brute) within TUNE.rest.near m keeps his guard up (a dummy doesn't)
  function threat() {
    const P = host.player;
    for (const p of host.entities.near(P.x, P.y, RS.near, NEAR))
      if (isBody(p) && !downed(p) && Math.abs((p.z || 0) - P.z) < 2 && Math.hypot(p.x - P.x, p.y - P.y) <= RS.near) return true;
    return false;
  }

  // ---------------------------------------------------------------- the blow (player.punch)
  function land(e) {
    const m = MOVES[e.mv]; if (!m) return;
    const P = host.player, cr = core();
    let p = null, kind = '';
    if (e.clinch && S.held && !S.held.broken) { p = S.held; kind = 'body'; }
    else {
      const c0 = Math.cos(m.arc / 2 * DEG); let bd = 1e9;
      for (const q of host.entities.near(e.x, e.y, m.reach + 1, NEAR)) {
        if (q.broken || q.gone || q.held || Math.abs((q.z || 0) - e.z) > 1) continue;
        const k = isBody(q) ? (downed(q) ? '' : 'body') : isDummy(q) ? 'dummy' : movable(q) ? 'prop' : isThing(q) ? 'thing' : '';
        if (!k) continue;
        const dx = q.x - e.x, dy = q.y - e.y, d = Math.hypot(dx, dy) || 1e-6, reach = m.reach + Math.max(0, rOf(q) - .3) + (k === 'body' ? 0 : .15);
        if (d > reach || (dx * e.vx + dy * e.vy) / d < (d < .7 ? c0 - .3 : c0)) continue;
        const sc = d - (k === 'body' ? .4 : 0);
        if (sc < bd) { bd = sc; p = q; kind = k; }
      }
    }
    const H = m.at === 'body' ? 1.1 : 1.46, kk = e.k || 0, power = Math.min(1, ((m.kick || 1) + kk * 1.5) / 4);
    if (!p) {   // a swing at the air
      host.events.push({type: 'fist.whiff', x: e.x + e.vx * .8, y: e.y + e.vy * .8, h: P.z + H, mv: e.mv, power, hand: e.hand});
      S.whiffs++; return;
    }
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
    let ux = e.vx * .8 + dx / d * .2, uy = e.vy * .8 + dy / d * .2; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const hx = p.x - ux * Math.min(.18, rOf(p) * .6), hy = p.y - uy * Math.min(.18, rOf(p) * .6), hh = (p.z || 0) + H * (p.kind === 'gunman' ? 1 : .8);
    let dmg = (m.dmg || 0) + (m.dmgK || 0) * kk; if (e.counter) dmg *= CT.mul;
    let hs = (m.hs || .04) + (m.hsK || 0) * kk + (e.counter ? CT.hs : 0), blocked = false, ko = false, out = 'body';
    const rx = REACT[m.react];
    if (kind === 'body' && p.kind === 'gunman') {
      const r = brawler()?.punched(p, {mv: e.mv, react: m.react, guard: !!m.guard || !!e.counter, ux, uy, counter: !!e.counter, k: kk, clinch: !!e.clinch});
      blocked = !!r?.blocked;
      if (blocked) { dmg *= m.react === 'jab' ? FOE_BLOCK.jab : FOE_BLOCK.other; hs *= .6; out = 'block'; }
      ko = !!cr?.damage(p, Math.max(blocked ? 0 : 1, Math.round(dmg)), {quiet: true, by: 'fist', canCrit: false, dir: [ux * 3, uy * 3], ux, uy, hx, hy, hh});
      if (!ko && !blocked) brawler()?.react(p, m.react, ux, uy, kk);   // (alive: his reaction; a down throws him: the brawler's launch)
    } else if (kind === 'body') {   // a brute (combat's): held, or thrown by a finisher
      ko = !!cr?.damage(p, Math.round(dmg), {quiet: true, by: 'fist', canCrit: false, dir: [ux * 3, uy * 3], ux, uy, hx, hy, hh});
      if (!ko && rx) {
        const heft = p.boss ? 0 : p.elite ? 1.7 : 1.15;
        if (rx.down && heft) cr.launch(p, ux * rx.down.out / heft, uy * rx.down.out / heft, rx.down.up / Math.sqrt(heft));
        else cr.hold(p, rx.stun * (heft ? 1 : .5));
      }
    } else if (kind === 'prop') {
      const v = (m.push || 1) * 1.6 + kk * 2; phys()?.shove(p, ux * v, uy * v); out = 'prop'; hs *= .5;
    } else {   // a dummy (straw: it rocks on combat.hit), a pot, a crate that breaks
      ko = !!cr?.damage(p, Math.round(dmg), {quiet: true, by: 'fist', canCrit: false, dir: [ux * 3, uy * 3], ux, uy, hx, hy, hh});
      out = kind === 'dummy' ? 'straw' : 'thing';
    }
    if (ko && kind === 'body') { hs += KO.hs; slow(KO.slowK, KO.slow); }
    else if (e.counter && !blocked) slow(CT.slowK, CT.slow);
    host.hitstop(Math.min(.16, hs));
    if ((m.kick || 0) >= 3 || ko) host.shake(ko ? 3 : 2, .12);
    if (!blocked && out === 'body') { S.combo = (S.comboT < 1.2 ? S.combo : 0) + 1; S.comboT = 0; }
    host.events.push({type: 'fist.hit', x: hx, y: hy, h: hh, who: p, kind: out, mv: e.mv, hand: e.hand, power, counter: !!e.counter, ko, dx: ux, dy: uy,
      kick: (m.kick || 1) * (blocked ? .5 : 1) + (ko ? 1 : 0) + kk});
    // the view's star and sparks (presentation: its own random)
    star(hx, hy, hh, blocked ? .4 : power, blocked ? 1 : 0, ux, uy);
    const c = cr; if (c) {
      const n = blocked ? 4 : 3 + Math.round(power * 6);
      for (let i = 0; i < n; i++) c.part(hx, hy, hh + R2(-.08, .08), ux * R2(.5, 2.4) + R2(-1, 1), uy * R2(.5, 2.4) + R2(-1, 1), R2(-.2, 1.6), R2(.12, .26), blocked ? c.SPARK : c.GOLD, {emit: true, drag: 5});
      if (out === 'body' && m.at === 'body') c.puff(hx, hy, (p.z || 0) + .9, 5, .25);
    }
    S.hits++; S.last = e.mv;
  }
  function slow(k, sec) { S.slowT = Math.max(S.slowT, sec); if (!S.slowOn || k < S.slowK) { S.slowK = k; host.mods?.set('fists', [{stat: 'sim.speed', mul: k}]); S.slowOn = true; } }

  // ---------------------------------------------------------------- the clinch
  function grab(e) {
    const b = B(); if (!b) return;
    const m = MOVES.grab, c0 = Math.cos(m.arc / 2 * DEG); let p = null, bd = 1e9;
    for (const q of host.entities.near(e.x, e.y, m.reach + 1, NEAR)) {
      if (!isBody(q) || q.kind !== 'gunman' || downed(q) || Math.abs((q.z || 0) - e.z) > .8) continue;
      const dx = q.x - e.x, dy = q.y - e.y, d = Math.hypot(dx, dy) || 1e-6;
      if (d > m.reach || (dx * e.vx + dy * e.vy) / d < c0) continue;
      if (d < bd) { bd = d; p = q; }
    }
    const ok = !!(p && brawler()?.grabbed(p));
    b.clinched(ok);
    if (ok) { S.held = p; S.holdT = 0; S.holdMax = brawler().dazed(p) ? CL.holdDazed : CL.hold; }
    host.events.push({type: 'fist.grab', x: e.x + e.vx * .5, y: e.y + e.vy * .5, who: p, ok});
  }
  // a gunman in reach in front of him (the grab's target, E's prompt)
  function grabbable() {
    const P = host.player, f = P.faceAngle, fx = Math.sin(f), fy = Math.cos(f), m = MOVES.grab;
    for (const q of host.entities.near(P.x, P.y, m.reach + .8, NEAR)) {
      if (!isBody(q) || q.kind !== 'gunman' || downed(q)) continue;
      const dx = q.x - P.x, dy = q.y - P.y, d = Math.hypot(dx, dy);
      if (d < m.reach + .45 && (dx * fx + dy * fy) / (d || 1) > .3) return q;
    }
    return null;
  }
  function letGo(why) {
    const p = S.held; S.held = null;
    if (p && !p.broken) brawler()?.freed(p, why);
    if (host.PL.fists?.S.clinch) host.PL.fists.letGo(why);
  }
  function holdStep(dt) {
    const p = S.held, b = B(); if (!p) return;
    const pending = !!b && b.S.mv === 'grab' && b.S.grabbed > 0;   // (caught: the clinch begins as the grab ends)
    if (!b || (!b.S.clinch && !pending) || p.broken || downed(p)) { letGo('gone'); return; }
    S.holdT += dt;
    if (S.holdT >= S.holdMax) { letGo('free'); return; }
    const P = host.player, f = P.faceAngle;
    brawler()?.holdAt(p, P.x + Math.sin(f) * CL.d, P.y + Math.cos(f) * CL.d, f + Math.PI);
  }

  const F = {
    name: 'fists', label: 'Fists', S, on: ON,
    update(dt, evs) {
      const b = B();
      if (!b) { if (host.PL.fists?.on) { if (S.held) letGo('off'); host.PL.fists.select(false); } }
      else {
        // the soft lock (4 times a second, and at once when the move ends); in a clinch the held foe
        S.lockT -= dt;
        if (S.held) b.lock(S.held.x, S.held.y, rOf(S.held));
        else if (b.on) {
          if (S.lockT <= 0 || (S.lockP && (S.lockP.broken || downed(S.lockP)))) { S.lockT = .25; S.lockP = findLock(); if (threat()) b.alert(); }
          if (S.lockP) b.lock(S.lockP.x, S.lockP.y, rOf(S.lockP)); else b.unlock();
        }
        for (let i = 0; i < evs.length; i++) {
          const e = evs[i];
          if (e.type === 'player.punch') land(e);
          else if (e.type === 'player.grab') grab(e);
          else if (e.type === 'player.toss') { const p = S.held; S.held = null; if (p && !p.broken) brawler()?.tossed(p, e.vx * CL.out, e.vy * CL.out, CL.up); }
          else if (e.type === 'player.shove') { const p = S.held; S.held = null; if (p && !p.broken) brawler()?.shoved(p, e.vx * CL.shove, e.vy * CL.shove); }
          else if (e.type === 'player.hurt') b.alert();   // (a blow taken: the guard up)
        }
        holdStep(dt);
      }
      S.comboT += dt;
      if (S.slowT > 0 && (S.slowT -= dt) <= 0 && S.slowOn) { host.mods?.clear('fists'); S.slowOn = false; }
    },
    onKey(k) {
      const b = B(); if (!b) return false;
      if (k === '2') { b.select(true); return true; }
      if (k === '1') { if (b.on) { if (S.held) letGo('off'); b.select(false); return true; } return false; }
      if (!b.on) return false;
      if (k === 'v') return b.kick();
      if (k === 'e') {
        if (b.S.clinch) return b.toss();
        if (host.PL.nearInteract?.()) return false;   // (a chest, a sign: E is theirs)
        return grabbable() ? b.grab() : false;
      }
      return false;
    },
    claims: k => (k === '1' || k === '2') && !!B(),
    // the view: the stars (a flash, a ring, sparks out along the blow), the block's cold spark, the combo count
    view(dt) {
      let q = null;
      const G = host.G, SC = F._sc || (F._sc = new Float32Array(3));
      for (const f of FX) {
        if (!f.on) continue;
        f.t += dt; if (f.t >= f.life) { f.on = false; continue; }
        G.toScreenInto(f.x, f.h, f.y, SC); if (SC[0] < -1e4) continue;
        q ??= host.glayer('add');
        const u = f.t / f.life, x = Math.round(SC[0]), y = Math.round(SC[1]), C = f.kind === 1 ? BLOCKC : STAR;
        const r = Math.round((2 + f.k * 4) * (u < .35 ? 1 : 1.4)), a = 1 - u * u;
        q.globalAlpha = a;
        if (u < .35) {   // the flash: a four-point star
          q.fillStyle = C[2]; q.fillRect(x - r, y, 2 * r + 1, 1); q.fillRect(x, y - r, 1, 2 * r + 1);
          q.fillStyle = C[1]; q.fillRect(x - 1, y - 1, 3, 3);
          q.fillStyle = C[0]; q.fillRect(x, y, 1, 1);
        } else {   // the ring: a hollow diamond opening out, and two streaks along the blow
          q.fillStyle = C[Math.min(C.length - 1, 2)];
          for (let i = -r; i <= r; i++) { const j = r - Math.abs(i); q.fillRect(x + i, y - j, 1, 1); if (j) q.fillRect(x + i, y + j, 1, 1); }
          if (f.k > .45) { const sx = f.dx * 6, sy = f.dy * 4; q.fillStyle = C[1]; q.fillRect(Math.round(x + sx), Math.round(y + sy), 2, 1); q.fillRect(Math.round(x + sx * 1.6), Math.round(y + sy * 1.6), 1, 1); }
        }
      }
      if (q) q.globalAlpha = 1;
    },
    hd(q, sc) {   // the combo count beside him (2 and up), fading out; the clinch's keys / the grab's prompt
      const b = B(); if (!b || !b.on || host.lock) return;
      const P = host.player, dpr = devicePixelRatio || 1;
      if (S.combo >= 2 && S.comboT < 1.4) {
        const s = host.G.toScreen(P.x, P.z + 2.15, P.y), a = Math.min(1, (1.4 - S.comboT) * 2.5);
        q.save(); host.G.hdShift?.(q, sc); q.globalAlpha = a;
        q.font = `bold ${Math.round((12 + Math.min(6, S.combo)) * dpr)}px ui-monospace, Consolas, monospace`; q.textAlign = 'center';
        q.fillStyle = 'rgba(14,16,15,.75)'; q.fillText(`${S.combo} hits`, s[0] * sc + dpr, s[1] * sc + dpr);
        q.fillStyle = S.combo >= 4 ? '#ffd27a' : '#f2ead2'; q.fillText(`${S.combo} hits`, s[0] * sc, s[1] * sc);
        q.restore();
      }
      const text = b.S.clinch ? 'LMB / RMB  punch  ·  V  knee  ·  E  toss  ·  Space  shove' : !b.S.mv && grabbable() ? 'E  grab' : '';
      if (!text || host.PL.nearInteract?.()) return;
      const s = host.G.toScreen(P.x, P.z - .35, P.y);
      q.save(); host.G.hdShift?.(q, sc);
      q.font = `${Math.round(11 * dpr)}px ui-monospace, Consolas, monospace`; q.textAlign = 'center';
      const w = q.measureText(text).width + 12 * dpr;
      q.fillStyle = 'rgba(14,16,15,.8)'; q.fillRect(s[0] * sc - w / 2, s[1] * sc - 2 * dpr, w, 18 * dpr);
      q.fillStyle = '#f2d27a'; q.fillText(text, s[0] * sc, s[1] * sc + 11 * dpr);
      q.restore();
    },
    hud: () => { const b = B(); return b ? `fists ${b.on ? (b.mode || (b.up ? 'up' : 'rest')) + (b.S.mv ? ' ' + b.S.mv + ' ' + b.S.ph : '') : 'down'} hits ${S.hits} whiffs ${S.whiffs}${S.held ? ' clinch' : ''}` : ''; },
    biomeChanged() { if (S.held) letGo('biome'); S.lockP = null; },
  };
  return F;
}
