// FOES SIM: the desert's gunmen as the truth (features/foes.js is the feature). Who is alive and where, what each gun
// is doing, their bullets, the gangs coming in. Fixed 1/60 s steps (core/loop.js); every random draw from this module's
// own generator (core/rng.js, seeded at boot from the clock, never from Math.random); nothing presentation reads back
// in: with ?views=0 the fight comes out the same (tools/test/simview.mjs).
//
// A GUNMAN is an entity in the registry (host.entities: kind 'gunman', target + hunter + hp + coins), so the player's
// bullets, arrows and abilities hurt it through combat's damage path (hit numbers, hitstop, the coin burst, enemy.kill;
// combat breaks it and takes it out of the world) and everything that aims or collides sees it. This module keeps a
// RECORD per gunman (its gun, its legs, its plans) and moves the entity's body; combat owns its health.
// The fight, per gunman: it closes in (holstered, running) until it has a line on you inside its range, DRAWS, then
// round after round AIMS (the telegraph: the gun held on you for gun.aim s; in the last gun.lock s the aim freezes and
// the barrel glints: roll, or step out of the line), FIRES (bullets, the coach gun's pellets), recovers, and between
// shots strafes round you at its range (backs off inside `near`, closes past `far`, spreads out from its mates). An
// empty gun is RELOADED standing (eject, round by round, close): the window to punish. No shot at you for a while:
// the gun goes back in the holster and it comes looking. At most TUNE.ai.maxAiming hold a gun on you at once.
// HIT: a gunman who flinches (TYPES flinch: the bandit, the bruiser) freezes with his gun up for that long (no step,
// his gun's timers held: a shot he was aiming comes later, so shooting first pays); every hit's way (front / back of
// his facing) and age are kept for the view's hit_f / hit_b. His death is the view's (combat kills him).
// BULLETS: a pool of fast segments tested in sub-steps against you (a round body; not while you dodge or flicker),
// walls and solid props, 3D trees and the ground; the gang's own bodies let them by.
// GANGS (the desert sandbox only: features/foes.js decides): every so often 2-4 come in from the edge of the walkable
// ground, far from you, while there is room under the cap; the dev key and a wanted poster ask for one now.
//
// OWNS: the records (gang), the gunmen entities' bodies (x, y, z, h, r: the creator's fields), the bullet pool, the spawn
//   clock, its own nav grid (world/nav.js over the ground you can walk on).
// READS: host.player (x, y, z, state, untouchable, raw.blink), the entities (near: a step, a line, a bullet), the world
//   (elev, the stream, 3D trees, PROP_TOP), the biome's canyon (hole), the game's mode.
// EMITS (pooled payloads, read in their step only: core/events.js): foe.draw / aim / shoot / reload / holster,
//   bullet.impact, player.hit, player.hurt.
import {mulberry32} from '../../core/rng.js';
import {hypot2, hypot3, TAU} from '../../core/mathx.js';
import {createNav} from '../../world/nav.js';
import {PLAY, TRAIL, WORLD, elev, inStream, PROP_TOP} from '../../world/world.js';
import {TYPES, TUNE} from '../../content/foes.js';

const DEG = Math.PI / 180;
const wrap = a => a - TAU * Math.floor((a + Math.PI) / TAU);   // -> [-pi, pi)
const KINDS = Object.keys(TYPES);

export function createFoesSim(host) {
  const ents = host.entities, P = host.player, events = host.events, A = TUNE.ai, SP = TUNE.spawn;
  const R = mulberry32((Date.now() % 2147483646) + 1), RR = (a, b) => a + R() * (b - a);
  // the ground you can walk on (sim/player/adapter.js blocked: the fort's square and 3 m round it, the trail), minus the
  // canyon (the desert's hole south of its rim)
  const walkArea = (x, y) => ((x > PLAY.x0 - 2.6 && x < PLAY.x1 + 2.6 && y > PLAY.y0 - 2.6 && y < PLAY.y1 + 2.6)
    || (x > TRAIL.x0 && x < TRAIL.x1 - .3 && y > TRAIL.y0 + .3 && y < TRAIL.y1 - .3)) && !(y > WORLD.HM - 3.6 && host.biome.hole?.(x, y));
  const nav = createNav(host, {area: walkArea});
  let navOk = false, edges = null, edgeN = 0;   // the open cells near the walkable ground's outer edge (spawn spots)

  // ---------------------------------------------------------------- state
  const gang = [], byP = new Map();   // the records, in spawn order; entity -> record
  const S = {armed: false, clock: 0, down: false, want: 0, wantO: null, bounty: false, aiming: 0, playerVX: 0, playerVY: 0, px: NaN, py: NaN};
  const BM = TUNE.bullets.max, f64 = () => new Float64Array(BM);
  const B = {n: 0, x: f64(), y: f64(), h: f64(), vx: f64(), vy: f64(), vh: f64(), life: f64(), age: f64(), dmg: f64(), lx: f64(), ly: f64(), lh: f64(),
    flown: f64(), kind: new Uint8Array(BM), who: new Array(BM).fill(null)};
  const nearS = [], nearL = [];
  // events: a ring of payloads with one shape (no allocation per shot; a payload lives for its step: core/events.js)
  const POOL = 96, pool = [];
  for (let i = 0; i < POOL; i++) pool.push({type: '', x: 0, y: 0, z: 0, h: 0, vx: 0, vy: 0, dx: 0, dy: 0, x0: 0, y0: 0, h0: 0, gun: '', foe: '', who: null,
    by: null, prop: null, phase: '', surf: '', n: 0, dmg: 0, player: false, small: false});
  let pi = 0;
  function emit(type, x, y, z) {
    const e = pool[pi]; pi = (pi + 1) % POOL;
    e.type = type; e.x = x; e.y = y; e.z = z; e.h = z; e.vx = e.vy = e.dx = e.dy = 0; e.who = e.by = e.prop = null; e.phase = e.surf = e.gun = e.foe = '';
    e.n = e.dmg = 0; e.player = e.small = false;
    events.push(e); return e;
  }

  // ---------------------------------------------------------------- the ground
  function buildNav() {
    nav.build(); navOk = true;
    const {open, NX, NY, C} = nav, out = [], d = SP.edge;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i; if (!open[k]) continue;
      const x = (i + .5) * C, y = (j + .5) * C;
      if (!walkArea(x - d, y) || !walkArea(x + d, y) || !walkArea(x, y - d) || !walkArea(x, y + d)) out.push(k);
    }
    edges = Int32Array.from(out); edgeN = 0;
  }
  // a solid thing at this point, the way an arrow sticks in it (sim/projectiles.js): walls, crates, solid props up to
  // their top (world.js PROP_TOP); not the gunmen (their bullets let each other by), not a 3D tree's walking collider
  function solid(x, y, h) {
    for (const p of ents.near(x, y, 0, nearL)) {
      if (p.broken || p.gone || p.kind === 'gunman' || host.itemOf(p)?.pose) continue;
      if (!(p.rect ? x > p.rect[0] && x < p.rect[2] && y > p.rect[1] && y < p.rect[3] : p.r > .3 && hypot2(p.x - x, p.y - y) < p.r)) continue;
      if (h > (p.z || 0) && h < (p.z || 0) + (PROP_TOP[p.kind] ?? 2.5)) return true;
    }
    return false;
  }
  function clearLine(x0, y0, h0, x1, y1, h1) {
    const n = Math.max(1, Math.ceil(hypot2(x1 - x0, y1 - y0) / .4));
    for (let i = 1; i < n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, h = h0 + (h1 - h0) * t;
      if (elev(x, y) > h || solid(x, y, h)) return false;
    }
    return true;
  }
  // where a gunman may stand: an open nav cell (dry ground, no plateau, clear of the fixed props) and clear of what else
  // stands there (crates, the board, other bodies), never on you
  function standable(x, y, self) {
    if (!nav.isOpen(x, y)) return false;
    for (const p of ents.near(x, y, .6, nearS)) {
      if (p === self || p.broken || p.gone || (p.z || 0) > .9) continue;
      const m = p.kind === 'gunman' ? .1 : .28;   // (mates: a touch of overlap is fine, the separation spreads them)
      if (p.rect ? x > p.rect[0] - m && x < p.rect[2] + m && y > p.rect[1] - m && y < p.rect[3] + m : p.r > 0 && hypot2(p.x - x, p.y - y) < p.r + m) return false;
    }
    return hypot2(P.x - x, P.y - y) > .72;
  }
  // the next waypoint toward you round walls and water (the nav's flow field, lowest walking distance a short clear
  // line away), or null: straight at you. Writes into W (no allocation)
  const W = {x: 0, y: 0};
  function steer(x0, y0) {
    const d0 = nav.at(x0, y0); if (!isFinite(d0)) return null;
    let bv = d0 - .2, found = false;
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * TAU, sx = Math.sin(a), sy = Math.cos(a);
      for (let r = 1.6; r > .5; r -= .8) {
        const x = x0 + sx * r, y = y0 + sy * r, v = nav.at(x, y);
        if (v < bv && lineOpen(x0, y0, x, y)) { bv = v; W.x = x; W.y = y; found = true; }
      }
    }
    return found ? W : null;
  }
  function lineOpen(x0, y0, x1, y1) {
    const n = Math.max(1, Math.ceil(hypot2(x1 - x0, y1 - y0) / .25));
    for (let k = 1; k <= n; k++) if (!nav.isOpen(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n)) return false;
    return true;
  }

  // ---------------------------------------------------------------- gangs
  function alive(type) { let n = 0; for (const g of gang) if (!type || g.type === type) n++; return n; }
  function pickType() {
    let sum = 0; for (const k of KINDS) if (alive(k) < TYPES[k].max) sum += TYPES[k].weight;
    let r = R() * sum;
    for (const k of KINDS) { if (alive(k) >= TYPES[k].max) continue; r -= TYPES[k].weight; if (r < 0) return k; }
    return 'bandit';
  }
  // an edge cell far from you (walking and straight), or null
  const cand = new Int32Array(8192);
  function edgeSpot(out) {
    if (!edges) return null;
    const {NX, C} = nav; let n = 0;
    for (let i = 0; i < edges.length && n < cand.length; i++) {
      const k = edges[i], x = (k % NX + .5) * C, y = (Math.floor(k / NX) + .5) * C, w = nav.at(x, y);
      if (isFinite(w) && w >= SP.minWalk && hypot2(x - P.x, y - P.y) >= SP.minLine) cand[n++] = k;
    }
    if (!n) return null;
    const k = cand[Math.floor(R() * n)]; out.x = (k % NX + .5) * C; out.y = (Math.floor(k / NX) + .5) * C;
    return out;
  }
  const AT = {x: 0, y: 0};
  function spawnGang(n, o = null) {
    if (!edgeSpot(AT)) return 0;
    let made = 0;
    for (let i = 0; i < n; i++) {
      const type = o && i === 0 && o.leader ? o.leader : pickType();
      for (let k = 0; k < 16; k++) {
        const a = R() * TAU, r = i === 0 && k === 0 ? 0 : SP.apart * (1 + R() * 1.4), x = AT.x + Math.sin(a) * r, y = AT.y + Math.cos(a) * r;
        if (!standable(x, y, null)) continue;
        add(type, x, y, o && i === 0 ? o.name : null); made++; break;
      }
    }
    return made;
  }
  function add(type, x, y, name) {
    const T = TYPES[type], G = T.gun;
    const p = {kind: 'gunman', foe: type, x, y, z: elev(x, y), h: 0, r: T.r, hitR: T.hitR, hitH: T.hitH, hp: T.hp, maxHp: T.hp, target: true, hunter: true,
      coins: T.coins, foot: T.foot, elite: !!T.elite, name: name || T.name};
    const face = Math.atan2(P.x - x, P.y - y);
    const g = {p, T, type, mode: 'enter', act: 'holstered', at: 0, ammo: G.rounds, cool: 0, locked: false,
      face, aim: face, tx: P.x, ty: P.y, th: P.z + A.chest, vx: 0, vy: 0, speed: 0, gait: '', strafe: R() < .5 ? -1 : 1, strafeT: RR(A.strafe[0], A.strafe[1]),
      look: R() * A.perceive, d: hypot2(P.x - x, P.y - y), los: false, lost: 0, rph: '', rt: 0, rk: 0, rfirst: true, r0: 0,
      stuck: 0, sideT: 0, way: false, wx: 0, wy: 0, wayT: 0, flinch: 0, hitAge: 99, hitFront: true,
      rope: 0, down: null};   // rope: s left on a lasso (features/equip/lasso.js); down: knocked off his feet (fling below)
    ents.add(p); gang.push(g); byP.set(p, g);
    return g;
  }
  function removeAll() {
    for (const g of gang) { if (!g.p.broken) ents.remove(g.p); byP.delete(g.p); }
    gang.length = 0; B.n = 0; S.aiming = 0; S.bounty = false;
  }

  // ---------------------------------------------------------------- the gun
  function startAct(g, act) {
    g.act = act; g.at = 0;
    const p = g.p;
    if (act === 'draw') emit('foe.draw', p.x, p.y, p.z).foe = g.type;
    else if (act === 'holster') emit('foe.holster', p.x, p.y, p.z).foe = g.type;
    else if (act === 'aim') { g.locked = false; S.aiming++; const e = emit('foe.aim', p.x, p.y, p.z); e.foe = g.type; e.gun = g.T.gun.sound; }
    else if (act === 'reload') { g.rph = 'up'; g.rt = 0; g.rk = 0; g.rfirst = true; g.r0 = g.ammo; reloadEv(g, 'start', g.ammo); }
  }
  function reloadEv(g, phase, n) { const e = emit('foe.reload', g.p.x, g.p.y, g.p.z); e.phase = phase; e.n = n; e.foe = g.type; e.gun = g.T.gun.sound; }
  // where it aims: your chest now (while it tracks), led by your motion for a steady hand (lead), frozen at the lock
  function track(g) {
    const B0 = g.T.gun.bullet, t = hypot2(P.x - g.p.x, P.y - g.p.y) / B0.speed;
    g.tx = P.x + S.playerVX * t * B0.lead; g.ty = P.y + S.playerVY * t * B0.lead; g.th = P.z + A.chest;
  }
  function fire(g) {
    const p = g.p, G = g.T.gun, Bt = G.bullet, a0 = Math.atan2(g.tx - p.x, g.ty - p.y);
    const mx = p.x + Math.sin(a0) * A.muzzle.fwd, my = p.y + Math.cos(a0) * A.muzzle.fwd, mh = p.z + A.muzzle.h;
    const dist = Math.max(1, hypot2(g.tx - mx, g.ty - my)), vh0 = (g.th - mh) / (dist / Bt.speed);
    for (let k = 0; k < Bt.pellets; k++) {
      const a = a0 + Bt.spread * DEG * (R() - R()), vh = vh0 + Bt.speed * Bt.spread * DEG * .25 * (R() - R());
      if (B.n >= BM) break;
      const i = B.n++;
      B.x[i] = B.lx[i] = mx; B.y[i] = B.ly[i] = my; B.h[i] = B.lh[i] = mh;
      B.vx[i] = Math.sin(a) * Bt.speed; B.vy[i] = Math.cos(a) * Bt.speed; B.vh[i] = vh;
      B.life[i] = Bt.range / Bt.speed; B.age[i] = 0; B.flown[i] = 0; B.dmg[i] = Bt.dmg; B.kind[i] = KINDS.indexOf(g.type); B.who[i] = p;
    }
    g.ammo--; g.face = g.aim = a0;
    const e = emit('foe.shoot', mx, my, p.z); e.h = mh; e.vx = Math.sin(a0); e.vy = Math.cos(a0); e.foe = g.type; e.gun = G.sound; e.who = p; e.n = g.ammo;
    startAct(g, 'fire');
  }
  // the reload, phase by phase (the player's revolver's: up, eject, then fetch + load per round, close)
  function reloadStep(g, dt) {
    const Rl = g.T.gun.reload, dur = g.rph === 'up' ? Rl.up : g.rph === 'eject' ? Rl.eject : g.rph === 'close' ? Rl.close : Rl.round / 2;
    g.rt += dt;
    if (g.rt >= dur) {
      g.rt -= dur;
      if (g.rph === 'up') { g.rph = 'eject'; reloadEv(g, 'eject', g.T.gun.rounds - g.ammo); }
      else if (g.rph === 'eject') { g.rph = 'fetch'; g.rfirst = true; }
      else if (g.rph === 'fetch') { g.rph = 'load'; g.rfirst = false; }
      else if (g.rph === 'load') { g.ammo++; reloadEv(g, 'round', g.ammo); g.rph = g.ammo < g.T.gun.rounds ? 'fetch' : 'close'; }
      else { reloadEv(g, 'done', g.ammo); g.rph = ''; g.act = 'ready'; g.at = 0; g.cool = RR(A.firstAim[0], A.firstAim[1]); return; }
    }
    g.rk = Math.min(1, g.rt / (g.rph === 'up' ? Rl.up : g.rph === 'eject' ? Rl.eject : g.rph === 'close' ? Rl.close : Rl.round / 2));
  }
  function gun(g, dt) {
    // can: a shot at you from here; lost: how long it has had no business with the gun out (no line, or far beyond its
    // range): it walks in with the gun up meanwhile, and holsters after A.lose s of it
    if (g.flinch > 0) { g.flinch -= dt; return; }   // hit: his gun's timers wait (the hit clip plays)
    if (g.rope > 0) {   // on a lasso (roped below): the aim is let go, the gun goes back in the holster, no draw until he's free
      g.rope = Math.max(0, g.rope - dt); g.at += dt;
      if (g.act === 'aim') { S.aiming--; startAct(g, 'holster'); }
      else if (g.act === 'ready' || g.act === 'fire' || g.act === 'draw') startAct(g, 'holster');
      else if (g.act === 'holster' && g.at >= g.T.gun.holster) { g.act = 'holstered'; g.at = 0; }
      else if (g.act === 'reload') reloadStep(g, dt);
      return;
    }
    const T = g.T, G = T.gun, can = g.los && g.d <= T.range[1] + A.shootPast && !S.down;
    g.lost = g.los && g.d <= T.range[1] + A.drawPast + 1 && !S.down ? 0 : g.lost + dt;
    g.at += dt;
    switch (g.act) {
      case 'holstered':
        if (!S.down && g.los && g.d < T.range[1] + A.drawPast) { startAct(g, 'draw'); g.lost = 0; }
        break;
      case 'draw':
        if (g.at >= G.draw) { g.act = 'ready'; g.at = 0; g.cool = RR(A.firstAim[0], A.firstAim[1]); }
        break;
      case 'ready':
        g.cool -= dt;
        if (g.lost > A.lose || S.down) { startAct(g, g.ammo < G.rounds && !S.down ? 'reload' : 'holster'); break; }   // (loads up before it goes looking)
        if (g.cool <= 0 && can && S.aiming < A.maxAiming) startAct(g, 'aim');
        break;
      case 'aim':
        if (!g.locked) {
          if (g.lost > .3 || S.down) { g.act = 'ready'; g.at = 0; g.cool = .3; S.aiming--; break; }   // you broke the line: it waits
          track(g);
          if (g.at >= G.aim - G.lock) g.locked = true;   // the aim freezes, the barrel glints (the view)
        }
        if (g.at >= G.aim) { S.aiming--; fire(g); }
        break;
      case 'fire':
        if (g.at >= G.recover) {
          if (g.ammo <= 0) startAct(g, 'reload');
          else { g.act = 'ready'; g.at = 0; g.cool = RR(G.gap[0], G.gap[1]); }
        }
        break;
      case 'reload': reloadStep(g, dt); break;
      case 'holster':
        if (g.at >= G.holster) { g.act = 'holstered'; g.at = 0; }
        break;
    }
  }

  // ---------------------------------------------------------------- legs
  const planted = g => g.flinch > 0 || g.act === 'aim' || g.act === 'fire' || g.act === 'reload' || g.act === 'draw' || g.act === 'holster';
  function legs(g, dt, i) {
    const p = g.p, T = g.T, dx = P.x - p.x, dy = P.y - p.y, d = g.d || 1, ux = dx / d, uy = dy / d;
    let mx = 0, my = 0, speed = 0, gait = '';
    g.strafeT -= dt; g.sideT -= dt;
    if (g.rope > 0) { mx = -ux; my = -uy; speed = T.speed.walk * A.roped; gait = 'walk'; }   // roped: he leans away from you, slowly
    else if (!planted(g) && !S.down) {
      const far = g.mode === 'enter' || !g.los || d > T.range[1];
      if (far) {   // close in: the nav's way round walls and water, or straight at you
        g.wayT -= dt;
        if (g.wayT <= 0) { g.wayT = A.perceive; const w = steer(p.x, p.y); g.way = !!w; if (w) { g.wx = w.x; g.wy = w.y; } }
        const tx = g.way ? g.wx - p.x : dx, ty = g.way ? g.wy - p.y : dy, l = hypot2(tx, ty) || 1;
        mx = tx / l; my = ty / l;
        if (g.sideT > 0) { const sx = -my * g.strafe, sy = mx * g.strafe; mx = sx; my = sy; }   // stuck on something: sidestep a while
        const run = g.act === 'holstered' && d > T.range[1] + A.drawPast;
        speed = run ? T.speed.run : T.speed.walk; gait = run ? 'run' : 'walk';
        if (g.los && d <= T.range[1] - .5) g.mode = 'fight';
      } else if (d < T.range[0]) {   // too close: back off (and drift sideways)
        mx = -ux + -uy * g.strafe * .4; my = -uy + ux * g.strafe * .4; speed = T.speed.back; gait = 'back';
      } else {   // at range: strafe round you, easing toward `keep`
        if (g.strafeT <= 0) { g.strafeT = RR(A.strafe[0], A.strafe[1]); if (R() < .45) g.strafe = -g.strafe; }
        const rad = (d - T.keep) * .35;
        mx = -uy * g.strafe + ux * rad; my = ux * g.strafe + uy * rad; speed = T.speed.walk; gait = 'walk';
      }
      // spread out: mates closer than A.sep push it away
      for (let k = 0; k < gang.length; k++) {
        const o = gang[k]; if (k === i) continue;
        const ox = p.x - o.p.x, oy = p.y - o.p.y, od = hypot2(ox, oy);
        if (od < A.sep && od > 1e-3) { const w = (1 - od / A.sep) * 1.6; mx += ox / od * w; my += oy / od * w; if (!speed) { speed = T.speed.walk; gait = 'walk'; } }
      }
      const l = hypot2(mx, my); if (l > 1e-3) { mx /= l; my /= l; } else speed = 0;
    }
    // ease the velocity toward the wish, then move (sliding along what blocks)
    const k = Math.min(1, A.accel * dt / Math.max(.5, speed || 1));
    g.vx += (mx * speed - g.vx) * k; g.vy += (my * speed - g.vy) * k;
    if (!speed) { const dmp = Math.exp(-dt * 14); g.vx *= dmp; g.vy *= dmp; if (g.vx * g.vx + g.vy * g.vy < 1e-4) g.vx = g.vy = 0; }   // (still: no step test)
    const sx = g.vx * dt, sy = g.vy * dt;
    if (sx || sy) {
      if (standable(p.x + sx, p.y + sy, p)) { p.x += sx; p.y += sy; g.stuck = 0; }
      else if (sx && standable(p.x + sx, p.y, p)) { p.x += sx; g.vy *= .5; }
      else if (sy && standable(p.x, p.y + sy, p)) { p.y += sy; g.vx *= .5; }
      else { g.vx = g.vy = 0; if (++g.stuck > 20) { g.stuck = 0; g.strafe = -g.strafe; g.wayT = 0; g.sideT = .7; } }
    }
    g.speed = hypot2(g.vx, g.vy); g.gait = g.speed > .15 ? gait || 'walk' : '';
    // the body turns: to its aim while the gun is out, else the way it goes
    const out = g.act !== 'holstered' && g.act !== 'holster';
    if (out) g.aim = Math.atan2(g.tx - p.x, g.ty - p.y);
    const want = out ? g.aim : g.speed > .2 ? Math.atan2(g.vx, g.vy) : g.face, da = wrap(want - g.face), st = A.turn * dt;
    g.face = wrap(g.face + (Math.abs(da) <= st ? da : Math.sign(da) * st));
    if (!out) g.aim = g.face;
  }

  // ---------------------------------------------------------------- bullets
  let hurt = 0, hurtBy = null, hurtX = 0, hurtY = 0;
  function stepBullets(dt) {
    const sub = TUNE.bullets.sub, body = TUNE.body, pl = host.player;
    const dodge = pl.untouchable ?? (pl.state === 'roll'), open = !dodge && !((pl.raw?.blink || 0) > 0) && !S.down;
    const px = pl.x, py = pl.y, pz = pl.z;
    for (let i = B.n - 1; i >= 0; i--) {
      const x0 = B.x[i], y0 = B.y[i], h0 = B.h[i], dx = B.vx[i] * dt, dy = B.vy[i] * dt, dh = B.vh[i] * dt;
      B.lx[i] = x0; B.ly[i] = y0; B.lh[i] = h0; B.age[i] += dt; B.life[i] -= dt;
      const n = Math.max(1, Math.ceil(hypot3(dx, dy, dh) / sub));
      let qx = x0, qy = y0, qh = h0, end = '', ex = 0, ey = 0, eh = 0;
      for (let k = 1; k <= n; k++) {
        const t = k / n, x = x0 + dx * t, y = y0 + dy * t, h = h0 + dh * t;
        if (open && hypot2(px - x, py - y) < body.r && h > pz + body.h0 && h < pz + body.h1) { end = 'player'; ex = x; ey = y; eh = h; break; }
        const tree = host.world.treeHit?.(qx, qy, qh, x, y, h);
        if (tree) { end = 'tree'; ex = tree.x; ey = tree.y; eh = tree.h; break; }
        if (solid(x, y, h)) { end = 'prop'; ex = x; ey = y; eh = h; break; }
        const gz = elev(x, y);
        if (h <= gz) { end = gz === 0 && inStream(x, y) ? 'water' : 'ground'; ex = x; ey = y; eh = gz; break; }
        qx = x; qy = y; qh = h;
      }
      if (!end) { B.x[i] = x0 + dx; B.y[i] = y0 + dy; B.h[i] = h0 + dh; B.flown[i] += hypot3(dx, dy, dh); if (B.life[i] > 0) continue; end = 'air'; ex = B.x[i]; ey = B.y[i]; eh = B.h[i]; }
      // gone: what it met
      const l = hypot2(B.vx[i], B.vy[i]) || 1, e = emit('bullet.impact', ex, ey, eh);
      e.x0 = x0; e.y0 = y0; e.h0 = h0; e.surf = end; e.dx = B.vx[i] / l; e.dy = B.vy[i] / l; e.gun = TYPES[KINDS[B.kind[i]]].gun.sound; e.foe = KINDS[B.kind[i]];
      if (end === 'water') { const s = emit('arrow.splash', ex, ey, 0); s.small = true; }
      if (end === 'player') { hurt += B.dmg[i]; hurtBy = B.who[i]; hurtX = e.dx; hurtY = e.dy; }
      const j = --B.n;   // swap-remove
      if (i !== j) {
        B.x[i] = B.x[j]; B.y[i] = B.y[j]; B.h[i] = B.h[j]; B.vx[i] = B.vx[j]; B.vy[i] = B.vy[j]; B.vh[i] = B.vh[j]; B.life[i] = B.life[j]; B.age[i] = B.age[j];
        B.dmg[i] = B.dmg[j]; B.lx[i] = B.lx[j]; B.ly[i] = B.ly[j]; B.lh[i] = B.lh[j]; B.flown[i] = B.flown[j]; B.kind[i] = B.kind[j]; B.who[i] = B.who[j];
      }
      B.who[j] = null;
    }
    if (hurt > 0) {   // one hit and one hurt per step (the coach gun's pellets land together): the game counts it
      const h = emit('player.hit', px, py, pz); h.vx = hurtX * 3; h.vy = hurtY * 3; h.player = true;
      const e = emit('player.hurt', px, py, pz); e.dmg = Math.round(hurt); e.by = hurtBy;
      host.shake(2, .12);
      hurt = 0; hurtBy = null;
    }
  }

  // ---------------------------------------------------------------- the step
  function update(dt, evs, on) {
    if (!on) { if (gang.length || B.n) removeAll(); S.armed = false; S.down = false; S.want = 0; return; }
    if (!navOk) buildNav();
    if (!S.armed) { S.armed = true; S.clock = SP.first; }
    nav.update(dt);
    // your motion (for the steady hands that lead you), without allocation
    const px = P.x, py = P.y;
    if (S.px === S.px) { S.playerVX = (px - S.px) / dt; S.playerVY = (py - S.py) / dt; if (hypot2(S.playerVX, S.playerVY) > 12) S.playerVX = S.playerVY = 0; }
    S.px = px; S.py = py;
    for (const e of evs) {
      if (e.type === 'arrow.hit') {   // you hit him
        const g = byP.get(e.prop); if (!g) continue;
        // a reaction (the view's hit_f / hit_b): from the front when the shot came from within A.hitFront of his facing;
        // with his gun up (not while drawing, reloading, holstering); a gunman who flinches (T.flinch) freezes that long
        if (g.flinch <= 0 && g.hitAge >= A.hitGap && (g.act === 'ready' || g.act === 'aim' || g.act === 'fire')) {
          g.hitAge = 0; g.hitFront = -(e.vx * Math.sin(g.face) + e.vy * Math.cos(g.face)) >= Math.cos(A.hitFront * DEG) * hypot2(e.vx, e.vy);
          if (g.T.flinch > 0) g.flinch = g.T.flinch;
        }
        if (g.act === 'holstered' && !S.down) { g.mode = 'fight'; g.los = true; }   // shot from out of sight: it turns on you
      } else if (e.type === 'player.down') { S.down = true; }
      else if (e.type === 'player.respawn') { removeAll(); S.down = false; S.clock = SP.first; }
      else if (e.type === 'frontier.read' && e.name && !S.bounty) { S.want = Math.max(3, 2 + Math.floor(R() * 3)); S.wantO = {leader: 'sheriff', name: e.name}; S.bounty = true; }
    }
    // the dead (combat broke them this step and took them out of the world; enemy.kill was its): out of the fight
    for (let i = gang.length - 1; i >= 0; i--) {
      const g = gang[i]; if (!g.p.broken) continue;
      if (g.act === 'aim') S.aiming--;
      if (g.p.name !== g.T.name) S.bounty = false;   // the named one fell: the next poster may call another
      byP.delete(g.p); gang.splice(i, 1);
    }
    // gangs: the clock, a request (the dev key, a poster)
    S.clock -= dt;
    if (S.clock <= 0 && !S.down) {
      const n = SP.gang[0] + Math.floor(R() * (SP.gang[1] - SP.gang[0] + 1));
      if (gang.length + n <= SP.cap) { spawnGang(n); S.clock = RR(SP.every[0], SP.every[1]); } else S.clock = SP.retry;
    }
    if (S.want && !S.down) {
      const n = Math.min(S.want > 0 ? S.want : SP.gang[0] + Math.floor(R() * (SP.gang[1] - SP.gang[0] + 1)), SP.devCap - gang.length);
      if (n > 0) spawnGang(n, S.wantO); S.want = 0; S.wantO = null;
    }
    // each gunman: look, the gun, the legs (knocked down: only that)
    for (let i = 0; i < gang.length; i++) {
      const g = gang[i], p = g.p;
      g.hitAge += dt;
      if (g.down) { downStep(g, dt); continue; }
      g.d = hypot2(P.x - p.x, P.y - p.y);
      if ((g.look -= dt) <= 0) {
        g.look += A.perceive;
        const same = Math.abs(P.z - p.z) < 1.2 || g.d > 4;   // (on the mesa you're seen from below, not from under its lip)
        g.los = same && clearLine(p.x, p.y, p.z + A.muzzle.h, P.x, P.y, P.z + A.chest);
      }
      gun(g, dt);
      legs(g, dt, i);
    }
    stepBullets(dt);
  }

  // ---------------------------------------------------------------- the lasso (features/equip/lasso.js)
  // KNOCKED DOWN (fling): he flies to where he lands (fly), lies there (lie: o.stun s), gets up (up: A.getUp s); no gun, no
  // legs, the aim let go. o.dmg (combat's damage) as he lands; o.onLand(p) is told; he bowls over a mate he flies into
  function downStep(g, dt) {
    const D = g.down, p = g.p; D.t += dt;
    if (D.ph === 'carry') { if (D.t > .25) { D.ph = 'fly'; D.t = 0; D.x0 = D.x1 = p.x; D.y0 = D.y1 = p.y; D.dur = .3; D.H = 0; D.h0 = p.h; } }   // (let go of without a throw: he drops)
    else if (D.ph === 'fly') {
      const k = Math.min(1, D.t / D.dur);
      p.x = D.x0 + (D.x1 - D.x0) * k; p.y = D.y0 + (D.y1 - D.y0) * k; p.h = 4 * D.H * k * (1 - k) + (D.h0 || 0) * (1 - k);
      if (D.dmgFly && p.h < 1.3) for (const o of gang) {
        const q = o.p; if (o === g || q.broken || D.hit.includes(q) || hypot2(q.x - p.x, q.y - p.y) > D.bowl + q.hitR) continue;
        D.hit.push(q); host.feature('combat')?.core.damage(q, D.dmgFly, {dir: [(q.x - p.x) * 3, (q.y - p.y) * 3]}); o.flinch = Math.max(o.flinch, .45);
      }
      if (k >= 1) {
        p.h = 0; D.ph = 'lie'; D.t = 0;
        const c = host.feature('combat')?.core, l = hypot2(p.x - D.x0, p.y - D.y0) || 1;
        if (c && D.dmg) c.damage(p, D.dmg, {dir: [(p.x - D.x0) / l * 3, (p.y - D.y0) / l * 3]});
        D.onLand?.(p);
      }
    } else if (D.ph === 'lie') { if (D.t >= D.stun) { D.ph = 'up'; D.t = 0; } }
    else if (D.t >= A.getUp) { g.down = null; g.act = 'holstered'; g.at = 0; g.vx = g.vy = 0; g.lost = 0; }
    g.d = hypot2(P.x - p.x, P.y - p.y);
  }
  // roped(p, sec): on a lasso sec s more (his gun goes down: gun() above; he leans away: legs()); shift(p, dx, dy): dragged
  // along the ground by up to (dx, dy) (what he can stand on stops it) -> the distance moved; fling(p, x, y, o): yanked off
  // his feet at (x, y) (the first spot he can stand on from there back toward him): o = {dur, h, dmg, stun, dmgFly, bowl,
  // onLand} -> the record's down state, or null
  function roped(p, sec) { const g = byP.get(p); if (!g || g.down || p.broken) return false; g.rope = Math.max(g.rope, sec); return true; }
  function shift(p, dx, dy) {
    const g = byP.get(p); if (!g || g.down || p.broken) return 0;
    const d = hypot2(dx, dy); if (d < 1e-6) return 0;
    const n = Math.ceil(d / .12); let moved = 0;
    for (let i = 0; i < n; i++) { const x = p.x + dx / n, y = p.y + dy / n; if (!standable(x, y, p)) break; p.x = x; p.y = y; moved += d / n; }
    return moved;
  }
  // carry(p, x, y, h): held up off his feet at (x, y), h m up (the lasso's hammer throw): a down state that holds while it's
  // renewed every step (else he drops); fling lets go of him
  function carry(p, x, y, h) {
    const g = byP.get(p); if (!g || p.broken || (g.down && g.down.ph !== 'carry')) return false;
    if (solid(x, y, h + .3) || elev(x, y) > (p.z || 0) + .3) return false;
    if (!g.down) { if (g.act === 'aim') S.aiming--; g.act = 'holstered'; g.at = 0; g.rope = 0; g.flinch = 0; g.vx = g.vy = 0; g.speed = 0; g.gait = '';
      g.down = {ph: 'carry', t: 0, x0: p.x, y0: p.y, x1: p.x, y1: p.y, dur: .3, H: 0, h0: 0, dmg: 0, stun: .6, dmgFly: 0, bowl: .55, hit: [], onLand: null}; }
    g.down.t = 0; p.x = x; p.y = y; p.h = h; g.face = wrap(g.face + .35);
    return true;
  }
  function fling(p, x, y, o) {
    const g = byP.get(p); if (!g || (g.down && g.down.ph !== 'carry') || p.broken) return null;
    if (g.act === 'aim') S.aiming--;
    const dx = p.x - x, dy = p.y - y; let tx = p.x, ty = p.y;
    for (let k = 0; k <= 12; k++) { const cx = x + dx * k / 12, cy = y + dy * k / 12; if (standable(cx, cy, p)) { tx = cx; ty = cy; break; } }
    g.act = 'holstered'; g.at = 0; g.rope = 0; g.flinch = 0; g.vx = g.vy = 0; g.speed = 0; g.gait = '';
    g.down = {ph: 'fly', t: 0, x0: p.x, y0: p.y, x1: tx, y1: ty, dur: o.dur, H: o.h, h0: o.h0 || 0, dmg: o.dmg || 0, stun: o.stun || 1, dmgFly: o.dmgFly || 0, bowl: o.bowl ?? .55, hit: [], onLand: o.onLand || null};
    return g.down;
  }

  return {
    gang, B, S, nav, KINDS, update, removeAll, roped, shift, fling, carry, TUNE_GETUP: A.getUp,
    get alive() { return gang.length; },
    request(n = 0, o = null) { S.want = n || -1; S.wantO = o; },   // a gang now (-1: the usual size): read by the next step
    spawnAt: (type, x, y, name = null) => add(type, x, y, name),   // (tests: a gunman of a type, there, now)
    biomeChanged() { navOk = false; },
    seed(n) { R.seed(n); },
  };
}
