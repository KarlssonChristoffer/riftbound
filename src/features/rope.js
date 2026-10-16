// ROPE (sim + view): the Lasso in the persistent world (living-animals.md slice 2, docs/FAUNA.md "The Lasso"). A tool in the bag
// (content/items.js lasso: in the start kit; an old save gets one, once): hold F to spin it, let go to throw. It is the equipment
// experiment's lasso (features/equip/lasso.js: the aim, the loop's flight, the hold, the swing from a high limb; its look
// features/equip/lassolook.js; the cowboy's hands sim/player/lasso.js) with its own state, and on the forest's animals
// (features/fauna.js) through that lasso's animal hook (eq.beast, below). Never any harm: a yank does no damage, nothing dies.
//   THE HARE   light: it tumbles to your feet and lies dazed (ROPE.hare.daze s); E lifts it, you carry it (at most carry s, you
//              walk at x walk), E puts it down (or it wriggles free): it bolts. In its moult (spring, autumn) a tuft of fur comes
//              off in your hands, once an in-game day a hare (FUR)
//   THE FOX    it comes, fights the rope and slips the loop after ROPE.fox.slip s (dropping what it carries: the den slice)
//   THE ROE    strong: it bolts and you're dragged behind it on your heels (the rope's leash: sim/player/lasso.js haul). It runs
//              v0 m/s falling to v1 over its tire time (seeded a deer; heavy gear past freeKg shortens it), A / D swing its line up
//              to ROPE.roe.steer deg, S leans back (slower, tires it faster), bushes and ferns slow it (a burst of leaves); deep
//              water and rock turn it. Stuck behind a trunk you're knocked flat (no damage) and the rope's gone. Tired, it stands
//              blowing, head low, ROPE.roe.stand s: E within calm m calms it (for the rest of the in-game day it lets you walk
//              past) and the loop comes off. F or Space lets go at any time
// CO-OP (docs/MULTIPLAYER.md): a solo verb. The server owns a claim on the animal while it's on someone's rope (act 'rope', first
//   wins; 'free' or ROPE.claim s ends it), the calm (act 'calm': the world map, until its hour) and the fur (act 'find': first
//   finder); the holder's client runs the animal and sends it in its state message (an: [id, x, y, heading, mode], coop.js), the
//   others draw it from that (fauna.hold) and let it go on from the last place on 'free'. Co-op's mail is read one step late
//   (this feature updates before coop: its E and F come before the other features' keys).
// SIM vs VIEW: the lasso, the held animal (B), the hare's daze and carry are sim (fixed steps, its own generator: simRandom('rope'));
//   where an animal is when the loop meets it is read from fauna's view (the animals are presentation: docs/FAUNA.md), as the aim
//   reads the cursor. The look (the rope, the loop), the prompts and the leaves are view.
// OWNS: its lasso (L, through createLassoSim), B (the animal on the rope / in your arms), the remote holds, its store
//   (pack.store('rope'): the Lasso given, the fur taken), the modifier source 'rope' (the hare's carry). READS: pack (the Lasso),
//   fauna (byId, ground, animals), host.PL.lasso, host.keys (A / D / S on a drag), host.yaw, host.env (season, day, t), gear's kg,
//   coop (mail, net.peers' an), equip (on: its own F then). CALLS: fauna.hold / release / calm, coop.act ('rope', 'free',
//   'calm', 'find'), PL.lasso (leash, strain, yank, haul), host.knock, host.mods.
// EMITS: animal.lift, animal.brush, animal.tired, animal.calm (core/events.js); the lasso's own lasso.* (features/equip/lasso.js).
// BUDGET: sim: the lasso's (~.02-.06 ms spinning) + a near() query a step on a drag; view: the look's (~.03 ms).
import {createLassoSim} from './equip/lasso.js';
import {createLassoLook} from './equip/lassolook.js';
import {ROPE, FUR} from '../content/animals.js';
import {WEIGHT, TUNE as LT} from '../content/lasso.js';
import {flags} from '../core/flags.js';
import {simRandom, mulberry32} from '../core/rng.js';
import {clamp, hypot2, TAU} from '../core/mathx.js';
import {hdUnit, hdPrompt} from '../ui/hdpixel.js';
import {FOREST} from '../world/layout.js';
import {steep} from '../world/world.js';

const LIVE = flags.get('livefauna') !== '0';
const HIT = {hare: {r: .25, h: .4}, fox: {r: .3, h: .5}, roe: {r: .45, h: 1.1}};   // m: the body the loop meets (radius, height)
const BRUSH = new Set(['bush', 'fern']);
const DEG = Math.PI / 180;
const wrap = a => a - Math.round(a / TAU) * TAU;

// ORDER (core/features.js): after the equipment (its F first while it's on), before co-op (its mail is read a step late)
export const order = {after: ['equip'], before: ['coop']};

export async function create(host) {
  const P = host.player, events = host.events;
  const game = () => host.feature('game');
  const pack = () => host.feature('pack');
  const fauna = () => { const f = host.feature('fauna'); return f?.on && f.hold ? f : null; };
  const coop = () => { const c = host.feature('coop'); return c?.online ? c : null; };
  const lz = () => host.PL?.lasso || null;
  const world = () => host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const active = () => world() && !host.feature('equip')?.on && !!lz() && !!pack()?.has('lasso');
  const clockT = () => host.env?.t ?? 0;

  // ---------------------------------------------------------------- the animal on the rope (or in your arms): one at a time
  //   mode: '' (none) | fly (the hare tumbling to your feet) | rope (on the rope: the fox fighting it, the roe running) |
  //   tired (the roe standing, blowing) | daze (the hare at your feet) | carry (the hare in your arms)
  const B = {on: false, a: null, id: '', sp: '', x: 0, y: 0, z: 0, h: 0, hd: 0, v: 0, hitR: .3, hitH: .5, cls: 'light', gone: false,
    mode: '', t: 0, x0: 0, y0: 0, tx: 0, ty: 0, len: 0, base: 0, off: 0, tire: 10, tT: 0, brushT: 0};
  function fill(a) {   // B as the loop's target: that animal, where it is now (fauna's view)
    const H = HIT[a.sp];
    B.a = a; B.id = a.d.id; B.sp = a.sp; B.x = a.x; B.y = a.y; B.z = a.z; B.h = 0; B.hd = a.hd; B.v = a.v; B.hitR = H.r; B.hitH = H.h; B.gone = false;
    const r = LT.str.pull / WEIGHT.animal[a.sp]; B.cls = r >= LT.str.even ? 'light' : 'strong';   // (content/lasso.js WEIGHT: the roe pulls you)
    return B;
  }
  const catchable = a => !!fauna()?.ground(a) && !!HIT[a.sp];

  // ---------------------------------------------------------------- the lasso's animal hook (features/equip/lasso.js eq.beast)
  const BEAST = {
    // spinning: an animal near the cursor's ground point, in reach -> A (kind 'animal'); false: none there
    aim(c, A) {
      if (B.on) return false;
      const Fa = fauna(); if (!Fa) return false;
      let gx = c.x, gy = c.y;
      if (!c.target) { const k = (c.h - host.elev(c.x, c.y)) * host.PPMH / host.PPMY; gx -= Math.sin(host.yaw) * k; gy -= Math.cos(host.yaw) * k; }   // (the cursor at chest height: the ground is that much up the screen)
      let best = null, bd = 1.3;
      for (const a of Fa.animals) {
        if (!catchable(a)) continue;
        const d = hypot2(a.x - gx, a.y - gy) - HIT[a.sp].r; if (d < bd) { bd = d; best = a; }
      }
      if (!best) return false;
      fill(best);
      A.kind = 'animal'; A.who = B; A.x = B.x; A.y = B.y; A.h = B.z + B.hitH * .55; A.d = hypot2(B.x - P.x, B.y - P.y);
      A.ok = A.d <= LT.range + B.hitR; A.cls = B.cls;
      return A.ok;
    },
    // in flight: the target where it is now (gone: held by someone else, or up a tree)
    track(b) { const a = b.a; if (!a || !catchable(a)) { b.gone = true; return; } b.x = a.x; b.y = a.y; b.z = a.z; b.hd = a.hd; },
    // the loop's opening at (x, y, h) meets an animal -> B, or null
    at(x, y, h, R) {
      if (B.on) return null;
      const Fa = fauna(); if (!Fa) return null;
      for (const a of Fa.animals) {
        if (Math.abs(a.x - x) > 1.5 || Math.abs(a.y - y) > 1.5 || !catchable(a)) continue;
        const H = HIT[a.sp], rel = h - a.z;
        if (rel > -.1 && rel < H.h + .15 && hypot2(a.x - x, a.y - y) < H.r + R) return fill(a);
      }
      return null;
    },
    caught(b) {
      const Fa = fauna(); if (!Fa || !Fa.hold(B.id, B)) { B.on = false; B.mode = ''; return; }
      B.on = true; B.t = 0; B.v = 0; B.len = clamp(hypot2(B.x - P.x, B.y - P.y), 1.2, LT.hold.len);
      coop()?.act('rope', B.id);
      if (B.sp === 'hare') {   // it comes: tumbling in to your feet (the yank clip plays)
        const dx = P.x - B.x, dy = P.y - B.y, d = hypot2(dx, dy) || 1, st = .85;
        B.mode = 'fly'; B.x0 = B.x; B.y0 = B.y; B.tx = P.x - dx / d * st; B.ty = P.y - dy / d * st;
        lz()?.yank(B.x, B.y); fur();
      } else if (B.sp === 'fox') { B.mode = 'rope'; B.hd = Math.atan2(B.y - P.y, B.x - P.x); }
      else {   // the roe: off, away from you, and you behind it
        const T = ROPE.roe, kg = host.feature('gear')?.S?.stats?.kg ?? 0, r = mulberry32((B.a.d.seed ^ 0x70e5) >>> 0)();
        B.mode = 'rope'; B.base = B.hd = Math.atan2(B.y - P.y, B.x - P.x); B.off = 0; B.tT = 0; B.v = T.v0; B.brushT = 0;
        B.tire = Math.max(T.min, T.tire[0] + (T.tire[1] - T.tire[0]) * r - T.kg * Math.max(0, kg - T.freeKg));
      }
    },
    // held (phase 'hold'): a step of it -> '' (on), 'back' (the loop comes off: home), or why it slipped
    hold(dt, press, up, L) {
      if (!B.on) return 'slip';
      if (press || letGo) { letGo = false; return 'drop'; }   // (F or Space: you let go; it goes on)
      const Z = lz(); if (!Z) return 'slip';
      let why = '';
      if (B.sp === 'hare') why = hareFly(dt, Z);
      else if (Z.mode !== 'haul') return 'drop';
      else if (B.sp === 'fox') why = foxStep(dt, Z);
      else why = roeStep(dt, Z);
      L.loop.x = B.x; L.loop.y = B.y; L.loop.h = B.z + B.h + B.hitH * .5; L.taut = B.mode === 'rope';
      return why;
    },
    // the lasso let go of what it held (a roll, a knock, a let-go, the loop home): what's still on the rope goes on its way
    lost() {
      if (!B.on) return;
      if (B.mode === 'rope' || B.mode === 'fly') free('bolt');
      else if (B.mode === 'tired') free('walk');
    },
  };
  let letGo = false, wantE = false, calmNow = false;

  // the hare: it tumbles in (an arc, ROPE yank's time) and lands at your feet, dazed; the loop comes home
  function hareFly(dt, Z) {
    if (B.mode !== 'fly') return 'back';
    B.t += dt; const k = Math.min(1, B.t / LT.yank.dur);
    B.x = B.x0 + (B.tx - B.x0) * k; B.y = B.y0 + (B.ty - B.y0) * k; B.z = host.elev(B.x, B.y); B.h = .7 * 4 * k * (1 - k); B.hd += dt * 9;
    if (k < 1) return '';
    B.mode = 'daze'; B.t = 0; B.h = 0; B.v = 0;
    if (Z.mode === 'haul') Z.haul(false);
    return 'back';
  }
  // the fox: it fights the rope, pulling away, and slips the loop
  function foxStep(dt, Z) {
    B.t += dt;
    const ax = Math.cos(B.hd), ay = Math.sin(B.hd), d = hypot2(B.x - P.x, B.y - P.y), v = d < B.len + LT.hold.stretch ? 2.2 : 0;
    B.hd = wrap(B.hd + Math.sin(B.t * 11) * dt * 3); B.v = v;
    const nx = B.x + ax * v * dt, ny = B.y + ay * v * dt; if (roeFree(nx, ny)) { B.x = nx; B.y = ny; B.z = host.elev(nx, ny); }
    Z.strain(true); Z.leash(B.x, B.y, B.len + LT.hold.stretch);
    if (B.t >= ROPE.fox.slip) { free('bolt'); return 'slip'; }
    return '';
  }
  // the roe: the drag (see the header)
  const NB = [];
  function roeStep(dt, Z) {
    const T = ROPE.roe;
    if (B.mode === 'tired') {
      B.t += dt; B.v = 0; Z.strain(false); Z.leash(B.x, B.y, B.len + LT.hold.stretch);
      if (calmNow) { calmNow = false; calm(); return 'back'; }
      if (B.t >= T.stand) { free('walk'); return 'slip'; }
      return '';
    }
    const keys = host.keys, lean = keys.has('s');
    B.tT += dt * (lean ? T.leanTire : 1);
    const f = clamp(B.tT / B.tire, 0, 1);
    if (f >= 1) { B.mode = 'tired'; B.t = 0; B.v = 0; events.push({type: 'animal.tired', x: B.x, y: B.y, id: B.id}); return ''; }
    // A / D: its line swings toward that side of the screen, at most T.steer deg off the line it bolted on
    const sx = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    if (sx) {
      const c = Math.cos(host.yaw), s = Math.sin(host.yaw), tx = c * sx, ty = -s * sx, cr = Math.cos(B.hd) * ty - Math.sin(B.hd) * tx;   // (the screen's right in the world: (cos yaw, -sin yaw))
      B.off = clamp(B.off + Math.sign(cr) * 1.6 * dt, -T.steer * DEG, T.steer * DEG);
    }
    let v = T.v0 + (T.v1 - T.v0) * f - (lean ? T.lean : 0);
    // through the undergrowth: slower, a burst of leaves
    let br = false; for (const p of host.entities.near(B.x, B.y, .8, NB)) if (BRUSH.has(p.kind) && !p.gone && hypot2(p.x - B.x, p.y - B.y) < (p.r || .4) + .3) { br = true; break; }
    if (br) { v *= T.brush; if ((B.brushT -= dt) <= 0) { B.brushT = .25; events.push({type: 'animal.brush', x: B.x, y: B.y, id: B.id}); } }
    B.v = Math.max(.5, v);
    // its way: the line (plus the steer); deep water, rock, a trunk ahead turn it (its own draw which way)
    let want = B.base + B.off, nx = B.x + Math.cos(want) * B.v * dt, ny = B.y + Math.sin(want) * B.v * dt;
    if (!roeFree(nx + Math.cos(want) * .6, ny + Math.sin(want) * .6)) {
      const side = R() < .5 ? -1 : 1;
      for (let k = 1; k <= 6; k++) { const a = want + side * k * .35; if (roeFree(B.x + Math.cos(a) * .9, B.y + Math.sin(a) * .9)) { B.base = wrap(a - B.off); want = a; break; } }
      nx = B.x + Math.cos(want) * B.v * dt; ny = B.y + Math.sin(want) * B.v * dt;
    }
    B.hd = wrap(B.hd + clamp(wrap(want - B.hd), -6 * dt, 6 * dt));
    if (roeFree(nx, ny)) { B.x = nx; B.y = ny; B.z = host.elev(nx, ny); } else B.v *= .5;
    // you, behind it: the leash brings you (sliding round what's in the way); held back past the rope's give: knocked flat
    Z.strain(true); Z.leash(B.x, B.y, B.len + LT.hold.stretch);
    const d = hypot2(B.x - P.x, B.y - P.y);
    if (d > B.len + LT.hold.stretch + T.snag) {
      const ux = (B.x - P.x) / d, uy = (B.y - P.y) / d; free('bolt'); host.knock(ux * T.knock, uy * T.knock); return 'slip';
    }
    return '';
  }
  // ground a dragged roe runs on: the forest, off the lake and the wide streams (a shallow one it splashes through), not up a cliff,
  // not into a trunk or a rock
  const FO = {};
  function roeFree(x, y) {
    if (y > -1.5 || steep(x, y)) return false;
    if (FOREST) { if (FOREST.inLake?.(x, y, .3)) return false; FOREST.at?.(x, y, FO); if (FO.d !== undefined && FO.d < FO.hw - .2 && FO.hw > 1.6) return false; }
    for (const p of host.entities.near(x, y, .9, NB)) {
      if (p.gone || BRUSH.has(p.kind) || p.kind === 'tuft' || p.kind === 'reed' || !(p.r > .1 || p.rect)) continue;
      if (p.rect) { if (x > p.rect[0] && x < p.rect[2] && y > p.rect[1] && y < p.rect[3]) return false; }
      else if (hypot2(p.x - x, p.y - y) < p.r * .8 + .15) return false;
    }
    return true;
  }
  // the hare at your feet / in your arms (after the lasso let go of it)
  function stepHare(dt) {
    const Hh = ROPE.hare;
    B.t += dt;
    if (B.mode === 'daze') {
      if (wantE && hypot2(B.x - P.x, B.y - P.y) < 1.8) { B.mode = 'carry'; B.t = 0; host.mods.set('rope', [{stat: 'player.speed', mul: Hh.walk}]); events.push({type: 'animal.lift', x: B.x, y: B.y, id: B.id}); }
      else if (B.t >= Hh.daze) free('bolt');
    } else if (B.mode === 'carry') {
      const f = P.faceAngle; B.x = P.x + Math.sin(f) * .28; B.y = P.y + Math.cos(f) * .28; B.z = P.z; B.h = .95; B.hd = Math.atan2(Math.cos(f), Math.sin(f)); B.v = 0;
      if ((wantE && B.t > .2) || B.t >= Hh.carry) { B.h = 0; B.z = host.elev(B.x, B.y); free('bolt'); }
    }
    wantE = false;
  }
  // done with it: fauna lets it go on (bolt | walk | calm), the server's claim freed
  function free(how) {
    if (!B.on) return;
    const was = B.mode; B.on = false; B.mode = '';
    if (was === 'carry') host.mods.clear('rope');
    fauna()?.release(B.id, how, B.x, B.y);
    coop()?.act('free', B.id, {x: +B.x.toFixed(2), y: +B.y.toFixed(2), how});
  }
  // E by the tired roe: calm for the rest of the in-game day (the server's, online: the calm comes back to us in its mail)
  function calm() {
    const until = (Math.floor(clockT() / 24) + 1) * 24;
    if (coop()) coop().act('calm', B.id, {at: until}); else fauna()?.calm(B.id, until);
    events.push({type: 'animal.calm', x: B.x, y: B.y, id: B.id});
    free('calm');
  }
  // a tuft of hare fur: a hare in its moult, once an in-game day each (offline: the store; online: the server's 'find')
  function fur() {
    const E = host.env; if (!E || !FUR.seasons.includes(E.season)) return;
    const day = E.day, id = `fur:${B.id}:${day}`, c = coop();
    if (c) { c.act('find', id); return; }
    const st = store(); st.fur ??= {}; if (st.fur[B.id] === day) return;
    st.fur[B.id] = day; pack()?.dirty(); pack()?.give('hare_fur', FUR.perDay, {x: B.x, y: B.y, h: .8});
  }
  const store = () => pack()?.store('rope') || {};

  // ---------------------------------------------------------------- the lasso itself (its own slot: cooldown, the throw's state)
  const S = {slot: {id: 'lasso', cd: 0}, aiming: false, aimT: 0, cast: 0, deny: 0, fUp: false};
  const R = simRandom('rope');
  const lasso = createLassoSim(host, {S, R, dmgK: () => 0, creature: () => false, anchors: () => null, can: () => true, beast: LIVE ? BEAST : null});
  const look = createLassoLook(host, lasso);
  addEventListener('keyup', e => { if (e.key.toLowerCase() === 'f' && active()) S.fUp = true; });
  let heldSlot = -1, given = false;

  // ---------------------------------------------------------------- co-op: the others' holds, the server's word
  const REM = new Map();   // id -> {by, H: the place fauna draws it at (from their an)}
  const MODES = ['rope', 'fly', 'tired', 'daze', 'carry'];
  function mail(m) {
    const me = coop()?.net?.id;
    if (m.k === 'ev' && m.a === 'rope' && typeof m.id === 'string') {
      if (m.by === me) return;
      let r = REM.get(m.id); if (!r) REM.set(m.id, r = {by: m.by, nx: NaN, ny: NaN, at: 0, v: 0, H: {x: 0, y: 0, z: 0, h: 0, hd: 0, v: 0, mode: 'rope'}});
      r.by = m.by; const a = fauna()?.byId(m.id); if (a) { r.H.x = r.nx = a.x; r.H.y = r.ny = a.y; r.H.z = a.z; r.H.hd = a.hd; }
      if (B.on && B.id === m.id && m.by !== me) { B.on = false; B.mode = ''; lasso.clear(); }   // (theirs first: the server says)
      fauna()?.hold(m.id, r.H);
    } else if (m.k === 'ev' && m.a === 'free' && typeof m.id === 'string') {
      const r = REM.get(m.id); if (!r || m.by === me) return;
      REM.delete(m.id); fauna()?.release(m.id, typeof m.how === 'string' ? m.how : 'bolt', +m.x, +m.y);
    } else if (m.k === 'deny' && m.a === 'rope' && B.on && B.id === m.id) { lasso.clear(); if (B.on) free('bolt'); }
    else if (m.k === 'world' && typeof m.id === 'string' && m.by === me) {
      if (m.s === 'calm' && m.id.startsWith('calm:')) fauna()?.calm(m.id.split(':')[1], +m.at || 0);
      else if (m.s === 'found' && m.id.startsWith('fur:') && !m.late) pack()?.give('hare_fur', FUR.perDay, {x: P.x, y: P.y, h: 1.2});
    }
  }
  const AN = ['', 0, 0, 0, ''];
  // the leaves a dragged roe bursts through a bush with (view: Math.random, its own few)
  const NL = 40, LX = new Float32Array(NL), LY = new Float32Array(NL), LH = new Float32Array(NL), LVX = new Float32Array(NL), LVY = new Float32Array(NL), LVH = new Float32Array(NL), LT2 = new Float32Array(NL);
  const LEAF = ['#5f7f3a', '#7a9a48', '#8a6a3a'], LP = {size: 1, alpha: 1};
  let li = 0;
  function leaves(dt, evs) {
    if (evs) for (const e of evs) if (e.type === 'animal.brush') for (let k = 0; k < 6; k++) {
      const i = li++ % NL, a = Math.random() * TAU, v = .8 + Math.random() * 1.6;
      LX[i] = e.x; LY[i] = e.y; LH[i] = host.elev(e.x, e.y) + .3 + Math.random() * .5; LVX[i] = Math.cos(a) * v; LVY[i] = Math.sin(a) * v; LVH[i] = 1 + Math.random() * 1.5; LT2[i] = .7 + Math.random() * .5;
    }
    for (let i = 0; i < NL; i++) if (LT2[i] > 0) { LT2[i] -= dt; LX[i] += LVX[i] * dt; LY[i] += LVY[i] * dt; LVH[i] -= 4 * dt; LH[i] = Math.max(host.elev(LX[i], LY[i]) + .02, LH[i] + LVH[i] * dt); LVX[i] *= .96; LVY[i] *= .96; }
  }
  function drawLeaves() { LP.size = host.zoom || 1; for (let i = 0; i < NL; i++) if (LT2[i] > 0) host.point(LX[i], LY[i], LH[i], LEAF[i % 3], LP); }

  const F = {
    name: 'rope', label: 'Lasso (the bag\'s)', on: true, lasso, look, B,
    get busy() { return lasso.busy || B.on; },
    claims: k => k === 'f' && active(),
    // co-op's state message: the animal on your rope [id, x, y, heading, mode] (none: undefined)
    an() { if (!B.on) return undefined; AN[0] = B.id; AN[1] = +B.x.toFixed(2); AN[2] = +B.y.toFixed(2); AN[3] = +B.hd.toFixed(2); AN[4] = B.mode; return AN; },
    update(dt, evs) {
      const c = coop(); if (c?.mail) for (let k = 0; k < c.mail.length; k++) mail(c.mail[k]);
      if (!given && pack()?.on && world()) {   // an old save: the Lasso, once (a new world's start kit has it)
        given = true; const st = store();
        if (!st.lasso) { st.lasso = 1; if (!pack().has('lasso')) pack().give('lasso', 1); pack().dirty(); }
      }
      if (!active()) { if (lasso.busy) lasso.clear(); if (B.on) free('bolt'); wantE = letGo = calmNow = false; return; }
      S.slot.cd = Math.max(0, S.slot.cd - dt); S.deny = Math.max(0, S.deny - dt); S.cast = Math.max(0, S.cast - dt);
      lasso.update(dt, evs);
      if (B.on && (B.mode === 'daze' || B.mode === 'carry')) stepHare(dt);
      else if (B.on && !lasso.busy) free('bolt');   // (the lasso let go and nothing was told: a safety)
      wantE = false;
      const sl = lasso.busy ? pack()?.best('rope')?.slot ?? -1 : -1;
      if (sl !== heldSlot) { heldSlot = sl; pack()?.held(sl); }   // (the pack panel marks the Lasso in hand)
    },
    view(dt, evs) {
      leaves(dt, evs);
      if (REM.size) {   // a friend's animal on their rope: where their state message has it
        const C = coop()?.net;
        for (const [id, r] of REM) {
          const q = C?.peers.get(r.by); if (!q) { REM.delete(id); fauna()?.release(id, 'bolt'); continue; }
          const an = q.an; if (!an || an[0] !== id) continue;
          const H = r.H, nx = +an[1], ny = +an[2]; if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
          if (nx !== r.nx || ny !== r.ny) { const now = performance.now(); r.v = Math.min(9, hypot2(nx - r.nx, ny - r.ny) / Math.max(.03, (now - r.at) / 1000)); r.at = now; r.nx = nx; r.ny = ny; }
          const k = Math.min(1, dt * 14); H.x += (nx - H.x) * k; H.y += (ny - H.y) * k; H.v = r.v; H.hd = +an[3] || 0;   // (eased: their state comes 20 times a second)
          H.mode = MODES.includes(an[4]) ? an[4] : 'rope'; H.h = H.mode === 'carry' ? .95 : 0; H.z = host.elev(nx, ny);
        }
      }
      if (!active() && !lasso.busy) return;
      look.view(dt);
    },
    frame() { if (lasso.busy) look.frame(); drawLeaves(); },
    onKey(k, e) {
      if (!active() || host.lock) return false;
      if (k === 'f') { if (e?.shiftKey) return false; lasso.press(); return true; }
      if (k === ' ') {
        if (lasso.L.phase === 'hold' && lasso.L.kind === 'animal') { letGo = true; return true; }
        return lasso.space();
      }
      if (k === 'e' && B.on) {
        const d = hypot2(B.x - P.x, B.y - P.y);
        if (B.mode === 'daze' && d < 1.8) { wantE = true; return true; }
        if (B.mode === 'carry') { wantE = true; return true; }
        if (B.mode === 'tired' && d < ROPE.roe.calm + B.hitR) { calmNow = true; return true; }
      }
      return false;
    },
    hd(q, sc) {   // the prompts (the pixel look: ui/hdpixel.js): E lift / E put it down / E calm
      if (!B.on || host.hudOff || host.playerHidden || pack()?.open || host.lock) return;
      const d = hypot2(B.x - P.x, B.y - P.y);
      const txt = B.mode === 'daze' && d < 1.8 ? 'E lift' : B.mode === 'carry' ? 'E put it down' : B.mode === 'tired' && d < ROPE.roe.calm + B.hitR ? 'E calm' : '';
      if (!txt) return;
      const s = host.G.toScreen(B.x, B.z + B.h + B.hitH + .45, B.y);
      q.save(); host.G.hdShift?.(q, sc); q.imageSmoothingEnabled = false;
      hdPrompt(q, txt, s[0] * sc, s[1] * sc, hdUnit(), '#f2d27a');
      q.restore();
    },
    menu() {
      if (!world()) return [];
      return [{label: `Lasso: one in the bag (${pack()?.count('lasso') || 0})`, run: () => { if (!pack()?.has('lasso')) pack()?.give('lasso', 1); }},
        ...(LIVE ? [{label: 'Animals: go to the nearest hare', run: () => near('hare')}, {label: 'Animals: go to the nearest roe deer (to rope it)', run: () => near('roe')}] : [])];
    },
    biomeChanged() { lasso.clear(); if (B.on) { B.on = false; B.mode = ''; host.mods.clear('rope'); } REM.clear(); },
    hud: () => lasso.busy || B.on ? `lasso ${lasso.L.phase || '-'}${B.on ? ` · ${B.id} ${B.mode}${B.sp === 'roe' && B.mode === 'rope' ? ` ${B.v.toFixed(1)} m/s tire ${(B.tT / B.tire * 100) | 0}%` : ''}` : ''}` : '',
    dbg: () => ({active: active(), phase: lasso.L.phase, kind: lasso.L.kind, aim: lasso.L.aim.kind, B: B.on ? {id: B.id, mode: B.mode, x: +B.x.toFixed(2), y: +B.y.toFixed(2), v: +B.v.toFixed(2), t: +B.t.toFixed(2), tire: +B.tire.toFixed(2), tT: +B.tT.toFixed(2)} : null, remote: [...REM.keys()]}),
  };
  // (dev) next to the nearest of a kind, a few metres off
  function near(sp) {
    const Fa = fauna(); if (!Fa) return;
    let b = null, bd = 1e9; for (const a of Fa.animals) if (a.sp === sp && !a.gone) { const d = hypot2(a.x - P.x, a.y - P.y); if (d < bd) { bd = d; b = a; } }
    if (b) host.teleport(b.x, b.y + 6);
  }
  return F;
}
