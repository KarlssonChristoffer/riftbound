// BRAWLER: the desert's gunmen who box (docs/exp/fists.md): the unarmed ones (?foes=unarmed: createFoesSim's U) fight the
// player with their fists. Part of the foes sim (features/foes/sim.js creates it with its internals and calls step() for each
// gunman after his BRAWL reactions; the fists feature calls the API below when the player's blows land). SIM: every random
// draw from the foes' own generator; nothing presentation reads back in.
// THE FIGHT, per gunman (his record's g.fist, this module's):
//   approach  far off: walks in (the nav's way round walls and water)
//   circle    squared up at FOE.ring (the one with the TOKEN: the only one who attacks, Arkham style) or waiting out at
//             FOE.wait, circling (his way changes every FOE.turn s), facing you; now and then a taunt (fx_taunt)
//   wind      the telegraph (FOE.jab / FOE.hay wind s: the haymaker's long, a glint at its end), a step in to FOE.close
//   strike    the lunge (`step` m/s) to the contact at `hit`: it lands if you're in `reach` and not untouchable (a slip that
//             beats it opens your counter: fists.dodged()); your guard blocks a jab (a share of it goes through), a haymaker
//             breaks it (and knocks you back); then planted to `dur`, the token let go, his next attack FOE.gap s on
//   guard     his guard up (when you wind up close in front of him, by his type's chance) for FOE.guardT s: a frontal blow
//             that doesn't break guards is blocked (features/fists.js takes the share)
//   react     hit: REACT's stun (the head snapped, the gut), pushed back along the blow; four unanswered hits daze him
//   daze      dazed REACT.daze.stun s: no guard, no attack
//   held      in your clinch: placed in front of you each step (holdAt), his collider off (you walk with him); freed / tossed
//             (thrown by the foes' launch: sim/bodyfly.js) / shoved
// A blow with a `down` (the uppercut, the haymaker, the roundhouse) throws him (the foes' launch: lies, gets up), then he
// circles again after a breath.
// OWNS: g.fist (each record's), the token, the brawler's clocks. READS: host.player, host.PL.fists (guards / untouchable /
// slipping / dodged / blocked / hurt: the player's API), content/fists.js FOE / REACT / TUNE.
// EMITS (the foes' pooled payloads): foe.fwind (the telegraph: who, n 1 jab / 2 hay), foe.punch (who, phase: hit | block |
//   slip | miss, n), player.hit, player.hurt.
import {FOE, REACT, TUNE as FT} from '../../content/fists.js';
import {TUNE as BRAWL} from '../../content/brawl.js';
import {hypot2} from '../../core/mathx.js';

const DEG = Math.PI / 180;
export function createBrawler(host, I) {
  const {gang, byP, P, R, RR, standable, walkTo, halt, emit, emitBody, launch, hatOff, wrap, toGround, solid, elev, steer, A} = I;
  const BS = {token: null, gapT: 0, seen: -1};   // who may attack, the breath before the next one may, the player's last wind seen
  const heftOf = g => BRAWL.heft[g.type] ?? 1;
  const typeOf = g => FOE.types[g.type] || FOE.types.bandit;
  function rec(g) {
    return g.fist ??= {st: 'approach', t: 0, kind: '', react: '', stun: 0, hits: 0, hitT: 9, guardT: 0, blockT: 0, next: RR(FOE.first[0], FOE.first[1]),
      side: R() < .5 ? -1 : 1, sideT: RR(FOE.turn[0], FOE.turn[1]), tauntT: RR(3, 7), done: false, pvx: 0, pvy: 0, rt: 9, r0: g.p.r, held: false,
      bare: g.type === 'bruiser'};   // (bare: his coach gun has no holster: the view hides it while he boxes)
  }
  const fists = () => host.PL?.fists || null;
  const release = g => { if (BS.token === g) { BS.token = null; BS.gapT = RR(.25, .6); } };
  const faceTo = (g, ux, uy, dt, k = 1) => { const want = Math.atan2(ux, uy), da = wrap(want - g.face), st = A.turn * k * dt; g.face = wrap(g.face + (Math.abs(da) <= st ? da : Math.sign(da) * st)); g.aim = g.face; };
  const frontal = (g, ux, uy) => -(ux * Math.sin(g.face) + uy * Math.cos(g.face)) >= Math.cos(70 * DEG);   // (the blow's way meets his facing)
  function slide(g, dt) {   // pushed back by a blow: the push decays, what he can stand on stops it
    const f = g.fist, p = g.p; if (Math.abs(f.pvx) + Math.abs(f.pvy) < .02) return;
    const sx = f.pvx * dt, sy = f.pvy * dt;
    if (standable(p.x + sx, p.y + sy, p)) { p.x += sx; p.y += sy; toGround(p); } else { f.pvx = f.pvy = 0; }
    const d = Math.exp(-dt * 7); f.pvx *= d; f.pvy *= d;
  }

  // ---------------------------------------------------------------- the step (foes/sim.js: true while it drives him)
  function step(g, dt) {
    if (!I.unarmed() || g.down) return false;
    if ((g.rope > 0 || g.snare > 0) && g.fist?.st !== 'held') {   // (on the lasso: roped he leans away, snared he's rooted: foes/sim.js's legs())
      const f0 = g.fist; if (f0 && (f0.st === 'wind' || f0.st === 'strike')) { f0.st = 'circle'; f0.t = 0; } release(g);
      return false;
    }
    const f = rec(g), p = g.p, T = typeOf(g);
    f.t += dt; f.hitT += dt; f.rt += dt;
    if (f.guardT > 0) f.guardT -= dt;
    if (f.blockT > 0) f.blockT -= dt;
    if (BS.token && (!byP.has(BS.token.p) || BS.token.p.broken || BS.token.down || !BS.token.fist || BS.token.fist.st === 'held')) BS.token = null;
    const dx = P.x - p.x, dy = P.y - p.y, d = hypot2(dx, dy) || 1, ux = dx / d, uy = dy / d;
    g.d = d; g.tx = P.x; g.ty = P.y;
    const fi = fists(), pl = host.player;
    switch (f.st) {
      case 'held': g.vx = g.vy = 0; g.speed = 0; g.gait = ''; if ((f.heldT += dt) > .3) freed(p, 'free'); return true;   // (nobody holds him any more: free)
      case 'react': halt(g, dt); slide(g, dt); faceTo(g, ux, uy, dt, .5); if (f.t >= f.stun) { f.st = 'circle'; f.t = 0; f.next = Math.max(f.next, RR(.3, .7)); } return true;
      case 'daze': halt(g, dt); slide(g, dt); if (f.t >= f.stun) { f.st = 'circle'; f.t = 0; f.hits = 0; f.next = RR(.4, .8); } return true;
      case 'taunt': halt(g, dt); faceTo(g, ux, uy, dt); if (f.t >= 1.2) { f.st = 'circle'; f.t = 0; } return true;
      case 'guard': halt(g, dt); faceTo(g, ux, uy, dt, 1.5); if (f.guardT <= 0) { f.st = 'circle'; f.t = 0; } return true;
      case 'wind': {
        const W = FOE[f.kind];
        faceTo(g, ux, uy, dt, 1.4);
        if (d > FOE.close + .05) walkTo(g, ux, uy, Math.min(3.2, (d - FOE.close) / Math.max(.1, W.wind - f.t)), 'walk', dt); else halt(g, dt);
        faceTo(g, ux, uy, dt, 2);
        if (f.t >= W.wind) { f.st = 'strike'; f.t = 0; f.done = false; f.inReach = d <= W.reach + .25; }
        return true;
      }
      case 'strike': {
        const W = FOE[f.kind];
        if (!f.done) {
          const fx = Math.sin(g.face), fy = Math.cos(g.face), v = W.step * (1 - f.t / W.hit);
          if (d > .8) { const sx = fx * v * dt, sy = fy * v * dt; if (standable(p.x + sx, p.y + sy, p)) { p.x += sx; p.y += sy; toGround(p); } }
          if (f.t >= W.hit) { f.done = true; land(g, f, W, T, d, ux, uy, fi, pl); }
        } else halt(g, dt);
        if (f.t >= W.dur) { f.st = 'circle'; f.t = 0; f.next = RR(FOE.gap[0], FOE.gap[1]) * T.gap; release(g); }
        return true;
      }
    }
    // approach / circle: far, walk in; near, square up and circle
    f.next -= dt; f.sideT -= dt; f.tauntT -= dt;
    if (d > 4.2) {
      f.st = 'approach';
      g.wayT -= dt;
      if (g.wayT <= 0) { g.wayT = A.perceive; const w = steer(p.x, p.y); g.way = !!w; if (w) { g.wx = w.x; g.wy = w.y; } }
      const tx = g.way ? g.wx - p.x : dx, ty = g.way ? g.wy - p.y : dy, l = hypot2(tx, ty) || 1;
      walkTo(g, tx / l, ty / l, d > 7 ? g.T.speed.run : g.T.speed.walk * T.speed, d > 7 ? 'run' : 'walk', dt);
      return true;
    }
    f.st = 'circle';
    // the token: the nearest who's ready, after the breath
    if (!BS.token && (BS.gapT -= dt) <= 0) {
      let best = null, bd = 9;
      for (const o of gang) { const of = o.fist; if (!of || o.down || o.p.broken || of.st !== 'circle' || o.d > 3.2) continue; if (o.d < bd) { bd = o.d; best = o; } }
      if (best) BS.token = best;
    }
    const mineT = BS.token === g, due = mineT && f.next <= 0, want = due ? FOE.close : mineT || !BS.token ? FOE.ring : FOE.wait;   // (his turn and due: in to strike range first)
    // the guard: you wind up close in front of him (rolled once per wind)
    const fs = fi?.S;
    if (fs && (fs.ph === 'wind' || fs.ph === 'charge') && d < 2.1 && BS.seen !== fs.n) {
      BS.seen = fs.n;
      if (R() < T.guard && frontal(g, -ux, -uy)) { f.st = 'guard'; f.t = 0; f.guardT = RR(FOE.guardT[0], FOE.guardT[1]); halt(g, dt); return true; }
    }
    // the attack: his turn, in range, his next one due
    if (due && d < FOE.close + .3 && Math.abs((pl.z || 0) - (p.z || 0)) < .6 && !(pl.state === 'launch' || pl.state === 'down')) {
      f.kind = R() < T.hay ? 'hay' : 'jab'; f.st = 'wind'; f.t = 0;
      const e = emitBody('foe.fwind', p.x, p.y, p); e.n = f.kind === 'hay' ? 2 : 1; e.foe = g.type;
      return true;
    }
    if (!mineT && f.tauntT <= 0 && d > FOE.wait - .6) { f.tauntT = RR(5, 10); f.st = 'taunt'; f.t = 0; return true; }
    // circle: round you (his way flips now and then), easing toward his ring; mates spread out
    if (f.sideT <= 0) { f.sideT = RR(FOE.turn[0], FOE.turn[1]); if (R() < .5) f.side = -f.side; }
    const rad = (d - want) * .9;
    const sk = due ? .25 : .7; let mx = -uy * f.side * sk + ux * rad, my = ux * f.side * sk + uy * rad;
    for (const o of gang) { if (o === g || o.p.broken) continue; const ox = p.x - o.p.x, oy = p.y - o.p.y, od = hypot2(ox, oy); if (od < 1.4 && od > 1e-3) { const w = (1 - od / 1.4) * 1.5; mx += ox / od * w; my += oy / od * w; } }
    const ml = hypot2(mx, my);
    if (ml > .08) walkTo(g, mx / ml, my / ml, Math.min(1, ml) * FOE.circle * T.speed * (due ? 1.6 : 1), 'walk', dt); else halt(g, dt);
    faceTo(g, ux, uy, dt, 2);   // (circling: he keeps facing you, whatever way he steps)
    return true;
  }
  // his blow meets you (or doesn't)
  function land(g, f, W, T, d, ux, uy, fi, pl) {
    const p = g.p, e = emitBody('foe.punch', p.x, p.y, p); e.n = f.kind === 'hay' ? 2 : 1; e.foe = g.type;
    const facing = (ux * Math.sin(g.face) + uy * Math.cos(g.face)) > .5;
    // a slip that beat it (he was in reach as the strike went, he slipped out or under it): the counter
    if (fi?.slipping?.() && (f.inReach || d <= W.reach + .05)) { e.phase = 'slip'; fi.dodged(); return; }
    if (d > W.reach + .05 || !facing || Math.abs((pl.z || 0) - (p.z || 0)) > .6) { e.phase = 'miss'; return; }
    if (pl.untouchable || (pl.raw?.blink || 0) > 0) { e.phase = 'slip'; return; }
    const dmg = W.dmg * T.dmg;
    if (fi?.guards(p.x, p.y) && f.kind === 'jab') {   // blocked: a share goes through, he's pushed back
      e.phase = 'block'; fi.blocked(ux, uy);
      const hu = emit('player.hurt', P.x, P.y, P.z); hu.dmg = Math.max(0, Math.round(dmg * FT.guard.jab)); hu.by = p;
      return;
    }
    e.phase = 'hit';
    const h = emit('player.hit', P.x, P.y, P.z); h.vx = ux * 4; h.vy = uy * 4; h.player = true;
    const hu = emit('player.hurt', P.x, P.y, P.z); hu.dmg = Math.round(dmg); hu.by = p;
    fi?.hurt?.();
    if (W.knock) host.knock(ux * W.knock, uy * W.knock);
    host.hitstop(f.kind === 'hay' ? .08 : .045); host.shake(f.kind === 'hay' ? 3 : 1, .1);
  }

  // ---------------------------------------------------------------- the player's blows (features/fists.js)
  // punched(p, o): a blow is about to land (o = {mv, react, guard (breaks a guard), ux, uy, counter, k, clinch}) -> {blocked}
  const RES = {blocked: false};
  function punched(p, o) {
    const g = byP.get(p); RES.blocked = false; if (!g || g.down) return RES;
    const f = rec(g);
    if (f.st === 'guard' && !o.guard && !o.clinch && frontal(g, o.ux, o.uy)) { RES.blocked = true; f.blockT = .25; f.guardT = Math.max(f.guardT, .25); }
    return RES;
  }
  // react(p, kind, ux, uy, k): the blow landed (he's alive): REACT[kind] (a down: thrown)
  function react(p, kind, ux, uy, k = 0) {
    const g = byP.get(p); if (!g || g.down || p.broken) return false;
    const f = rec(g), rx = REACT[kind]; if (!rx) return false;
    if (f.st === 'wind' || f.st === 'strike' || BS.token === g) release(g);
    if (g.hat && rx.hat && R() < rx.hat) hatOff(p, ux, uy, .5);
    if (f.st === 'held') { f.react = kind; f.rt = 0; f.hits++; return true; }   // (in the clinch: his head snaps, he stays held)
    if (rx.down) {
      const hf = heftOf(g), o = 1 + .4 * k;
      f.st = 'circle'; f.t = 0; f.next = RR(.6, 1.1); f.hits = 0;
      launch(p, ux * rx.down.out * o / hf, uy * rx.down.out * o / hf, rx.down.up / Math.sqrt(hf), {hatK: 0, dmgFly: BRAWL.body.bowlDmg});
      return true;
    }
    f.hits = f.hitT < FT.chain.dazeT ? f.hits + 1 : 1; f.hitT = 0;
    if (kind === 'daze' || f.hits >= FT.chain.daze) { f.st = 'daze'; f.t = 0; f.stun = REACT.daze.stun; f.hits = 0; f.react = 'daze'; }
    else { f.st = 'react'; f.t = 0; f.stun = rx.stun; f.react = kind; }
    const push = kind === 'gut' ? 1.6 : kind === 'jab' ? .9 : 1.4;
    f.pvx = ux * push / heftOf(g); f.pvy = uy * push / heftOf(g);
    g.vx = g.vy = 0;
    return true;
  }
  // the clinch: grabbed (-> false: not now), placed each step, let go of (freed: a shove apart), thrown, shoved
  function grabbed(p) {
    const g = byP.get(p); if (!g || g.down || p.broken) return false;
    const f = rec(g); release(g);
    f.st = 'held'; f.t = 0; f.held = true; f.rt = 9; f.heldT = 0; p.r = 0;   // (his collider off while held: you walk with him)
    g.vx = g.vy = 0; g.speed = 0; g.gait = '';
    return true;
  }
  function holdAt(p, x, y, face) {
    const g = byP.get(p); if (!g || g.fist?.st !== 'held') return;
    if (!solid(x, y, (p.z || 0) + .5) && Math.abs(elev(x, y) - (p.z || 0)) < .4) { p.x = x; p.y = y; toGround(p); }
    g.face = wrap(face); g.aim = g.face; g.fist.heldT = 0;
  }
  function unhold(g) { const f = g.fist; if (!f) return; f.held = false; g.p.r = f.r0 || g.T.r; }
  function freed(p, why) {
    const g = byP.get(p); if (!g) return;
    unhold(g); const f = g.fist; if (!f || f.st !== 'held') return;
    f.st = 'react'; f.t = 0; f.stun = why === 'free' ? .3 : .45; f.react = 'jab';
    const dx = p.x - P.x, dy = p.y - P.y, d = hypot2(dx, dy) || 1; f.pvx = dx / d * 2; f.pvy = dy / d * 2;
  }
  function tossed(p, vx, vy, up) {
    const g = byP.get(p); if (!g) return false;
    unhold(g); const f = rec(g); f.st = 'circle'; f.t = 0; f.next = RR(.8, 1.3); f.hits = 0;
    const hf = heftOf(g);
    return launch(p, vx / hf, vy / hf, up / Math.sqrt(hf), {hatK: .6, dmgFly: BRAWL.body.bowlDmg});
  }
  function shoved(p, vx, vy) {
    const g = byP.get(p); if (!g) return false;
    unhold(g); const f = rec(g); f.st = 'react'; f.t = 0; f.stun = .55; f.react = 'gut';
    const hf = heftOf(g); f.pvx = vx / hf; f.pvy = vy / hf;
    return true;
  }
  const dazed = p => byP.get(p)?.fist?.st === 'daze';
  // a gunman left the fight (dead, gone): his token, his collider
  function gone(g) { if (BS.token === g) BS.token = null; if (g.fist?.held) unhold(g); }

  return {step, punched, react, grabbed, holdAt, freed, tossed, shoved, dazed, gone, BS, rec};
}
