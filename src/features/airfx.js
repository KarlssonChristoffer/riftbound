// AIR FX (view): what pushes the air. The game's moving-air field (render/air.js, host.G.air: docs/exp/air.md) is pushed
// only from here: this feature reads the events (core/events.js) and the movers and SPLATS into the field: gusts, clear
// air, smoke / dust. The mist (render/mistvol.js) and the smoke / dust particles read the field; nothing in the sim does.
// VIEW ONLY: it listens and writes only its own state (the trackers below) and the field's queue; ?air=0 (no field) and
// ?views=0 leave nothing of it. Its randomness is its own view generator (core/rng.js viewRandom).
//   shots       player.shoot / foe.shoot: a jet out of the muzzle along the shot (a few splats over its first metres,
//               ~13 m/s falling off, the gas spreading out at the muzzle), a pair of counter-rotating curls either side of it
//               (a jet's vortex ring, seen from above), a thin CLEAR channel on along the shot, SMOKE at the muzzle; by
//               gun (the Navy and the coach gun stronger; the coach gun a fan of jets: its pellets); a fanned shot weaker
//   impacts     bullet.impact / bullet.ricochet / arrow.hit: a small puff where it struck, carried on along its way a little,
//               dust (SMOKE) off the ground and stone, none off a body or the water
//   blasts      combat.explode, hazard.burst (blast | fire | frost | strike | ring), omen.strike, equip.puff (the smoke
//               bomb): a strong radial push (~20 m/s), a CLEAR bubble ~1.3 r, SMOKE in the middle and a ring of dust round
//               it with random curls (the field's vorticity keeps them turning); the air rushing back is the field's
//   the player  a wake at his feet every air step (from how he really moved: runs, rolls, leaps, slides, the rope alike):
//               the air there brought up to a share of his speed, and CLEAR by speed (walking barely, a sprint parts the
//               mist); a roll / backstep a wider, stronger sweep;
//               player.jump a kick down and out, player.land a radial puff (a drop: big), player.splash spray
//   in flight   host.arrows: a thin wake along each arrow, a thin clear channel along each bullet's path since the last step
//   movers      brutes, gunmen, hunters (the 'airfx.movers' query): the ~12 nearest the view, small wakes like his
//   the rest    prop.break / land / impact / tip / kick, splashes, tumbleweeds, birds taking off, critters, a body
//               slammed down, the fire's log falling; and the lit FIRES (torches, braziers, the campfire, the beacon:
//               the 'airfx.fires' query): a steady gentle inflow (the updraft draws air in), a little SMOKE, the mist
//               burnt off round them
// Everything fades with height over the ground (TUNE.height): the mist lies low, a shot from the watchtower stirs nothing.
// THE FIELD'S RULES (render/air.js): a splat RAISES the air toward its speed, never past it, and CLEAR / SMOKE to its level
// (a max, not a sum), so a steady source (a wake, a fire) gives its TARGET (the speed, the level), not a share of dt, and
// holds the air there by splatting once per air step (G.air.steps: the field steps at a fixed 60 Hz and takes the queue at
// each step, so splatting every frame at 164 Hz would only fill its queue). Events splat at once.
// THE BUDGET: at most TUNE.max splats a frame from here (the field takes 64 a step), by priority: events first, then the
// player, shots in flight, movers, fires. A source outside the field's square (G.air.rect) isn't splatted.
// OWNS: its trackers (the movers' / the fires' state in WeakMaps made as they join its queries, the projectiles' slots),
// the splat it hands the field (one object, reused: the field copies it at once), its counters (F.stats).
// READS: events, host.player / P (where he is, his state), host.arrows, host.entities (its queries), host.elev,
// host.inStream, host.biome (groundAt, id), host.G.air (on, rect, splat).
// BUDGET: view ~.03-.06 ms (measured: tmp/airfx/probe.mjs; a few splats a frame, ~50 in the worst burst; no scans: its own two
// queries, the arrows in flight). Off (?air=0): only the trackers, ~.01 ms.
import {smooth, hypot2} from '../core/mathx.js';
import {viewRandom} from '../core/rng.js';

// THE TUNING (per source). Speeds are the m/s a splat brings the air up to (the field's: a push vx, vz at the centre,
// `radial` outward at r / 2, `swirl` round it, + counter-clockwise seen from above); r a gaussian's radius (m, ~2 sigma);
// CLEAR / SMOKE the level (0..1) it raises them to there.
export const TUNE = {
  max: 56,                         // splats a frame from here, at most
  height: {full: 2.2, zero: 6},    // m over the ground: full strength below `full`, nothing from `zero` up
  // a shot's strength by gun (content/weapons.js ids; a gunman's gun is its sound: content/foes.js gun.sound), x for a fanned
  // shot (fan the hammer: several weaker jets in a row), a hip shot, a gunman's (but the coach gun)
  gun: {peacemaker: 1, brass_navy: 1.3, coach: 1.55, other: 1, fan: .8, hip: .9, foe: .9},
  // the muzzle jet: n splats over its first len m, v at the muzzle falling to v x fall at the last, r growing r0 -> r1; the
  // gas spreading out at the muzzle (radial), the mist blown out (clear, each), the smoke (at the muzzle); the curls either
  // side (pair: m/s, at pairD m along the shot, pairOff m to each side, radius pairR; 0: none)
  jet: {n: 3, len: 3, v: 13, fall: .4, r0: .45, r1: .8, radial: 3, clear: .7, smoke: .4, pair: 3.5, pairD: 1.6, pairOff: .55, pairR: .5},
  chan: {at: [4.6, 7.4], r: .45, clear: .6, v: 2.5},    // the channel on along the shot (m along it), thin; the bullet's drag
  coach: {jets: 3, spread: .12, n: 2, len: 2.6},        // the coach gun: jets fanned +- spread rad (its pellets), each n splats over len m
  // where a bullet / an arrow struck: r, radial, the push on along its way (bullets: m/s; arrows: x its speed), CLEAR, the dust
  // (SMOKE, x the ground's dust where it's the ground) by surface (bullet.impact surf; else `other`)
  impact: {r: .55, radial: 3.5, push: 2, clear: .12, dust: {ground: .32, prop: .22, tree: .1, hit: 0, player: 0, water: 0, air: 0, other: .15}},
  rico: {r: .35, radial: 2.5, push: 3, clear: .1, smoke: .14},
  arrowHit: {r: .35, radial: 1.6, push: .05, clear: .05, smoke: .1},
  // a blast (combat.explode, hazard.burst 'blast'): the middle (radial at its r x rad's r, the CLEAR bubble r x clearR, SMOKE),
  // a ring of n dust splats at r x ringAt (radius r x ringR, pushed out ringV, SMOKE ringSmoke, a random curl +- swirl)
  blast: {radial: 20, rad: 1, clearR: 1.3, clear: 1, smoke: .15, ring: 6, ringAt: 1, ringR: .5, ringV: 6, ringSmoke: .4, swirl: 3},
  burst: {   // hazard.burst's other styles (r: the zone's), as a middle splat [radial, clear, smoke, r x] + a ring [n, v, smoke]
    fire: {radial: -3, clear: .55, smoke: .3, rk: 1, ring: 0, ringV: 0, ringSmoke: 0},       // the heat draws air in, burns the mist off
    frost: {radial: 7, clear: 0, smoke: .55, rk: 1, ring: 4, ringV: 3, ringSmoke: .3},       // a cold breath out: white
    strike: {radial: 12, clear: .9, smoke: .25, rk: .8, ring: 4, ringV: 4, ringSmoke: .25},  // lightning
    ring: {radial: 8, clear: .4, smoke: .1, rk: .6, ring: 6, ringV: 6, ringSmoke: .15},      // a ring that runs out
    blast: null,                                                                             // (TUNE.blast)
  },
  smokeBomb: {radial: 5, smoke: 1, ring: 4, ringAt: .7, ringV: 2.5, ringSmoke: .6},   // equip.puff (r: its cloud's)
  strikeR: 1.6,                                                                        // omen.strike without an r
  // THE PLAYER's wake: r, share (the air at his feet brought up to this x his speed), CLEAR by speed [from, to m/s, the most];
  // a roll / backstep: r, share, CLEAR at least; tau (s: his speed is smoothed over it: the sim may not step every frame)
  player: {r: .9, share: .45, body: .4, clear: [2, 7.5, .8], roll: {r: 1, share: .75, clear: .6}, back: {r: .8, share: .55, clear: .35}, tau: .06},
  jump: {r: .6, radial: 3, clear: .15, smoke: .12},
  // a landing: radial, r [small, big], CLEAR, SMOKE (x the ground's dust) at full (a drop: big 3); a sprint footfall / a landing
  // foot (big < 3) x step
  land: {radial: 8, r: [.5, .95], clear: .4, smoke: .35, step: .28},
  movers: {max: 12, r: .75, share: .35, body: .45, clear: [2.5, 8, .45], tau: .08, reach: 26},   // reach: m from the view's middle at most
  arrow: {r: .35, k: .06, clear: .25, max: 12},         // in flight: the push x its speed; at most max splats a step for them all
  bullet: {r: .35, v: 2.5, clear: .45, fade: .65, far: 20, step: 2.6, n: 3},   // in flight: a splat every step m of its path since the last (at most n); CLEAR x (1 - fade) by far m
  // FIRES (splatted every `every` s of air steps each): r, the inflow (radial, m/s: negative), SMOKE, CLEAR (the mist burnt off)
  fire: {every: .1, campfire: {r: 1.4, inflow: 1.2, smoke: .3, clear: .55}, brazier: {r: 1, inflow: .9, smoke: .16, clear: .4},
    torch: {r: .7, inflow: .5, smoke: .08, clear: .25}, beacon: {r: 1.2, inflow: 1, smoke: .22, clear: .45}},
  // the ground's dust (x a landing's, an impact's, a break's SMOKE) by biome; the desert by its ground (biome.groundAt)
  dust: {ruins: .45, frost: .8, ember: .7, rift: .3, desert: {sand: 1, pan: .8, stone: .35, rock: .35, water: 0}, other: .45},
  // the rest, by event: [r, radial, CLEAR, SMOKE, dusty (SMOKE x the ground's dust)]
  ev: {
    'player.splash': [.8, 4, .2, .15, 0], 'arrow.splash': [.4, 1.2, .05, .05, 0], 'prop.splash': [.9, 4, .15, .15, 0], 'wildlife.splash': [.35, 1, 0, .04, 0],
    'prop.break': [1, 4, .2, .45, 1], 'prop.land': [1, 5, .2, .35, 1], 'prop.tip': [.6, 2, .05, .12, 1], 'prop.kick': [.6, 2, .05, .1, 1],
    'combat.bowl': [.8, 3, .1, .2, 1], 'lasso.slam': [.8, 3.5, .1, .25, 1], 'foe.ground': [.8, 2.5, .05, .22, 1], 'trick.shatter': [.4, 1.5, 0, 0, 0],
    'equip.shatter': [.8, 3, .25, .2, 0], 'fire.logFall': [.6, 2.5, .1, .25, 0], 'fire.addWood': [.5, 1, 0, .15, 0],
    'wildlife.critter_dash': [.4, 1, 0, .05, 1], 'wildlife.fish_jump': [.3, .6, 0, .02, 0], 'wildlife.frog_jump': [.3, .5, 0, .02, 0],
  },
  impactK: {speed: 4, radial: .6, max: 5, r: .7, smoke: .15},   // prop.impact: radial x its speed (at most max), SMOKE by speed / speed
  tumble: {r: .6, radial: 2.5, smoke: .2},                      // tumbleweed.bounce (x its k)
  birds: {r: 1.2, radial: 1.5, per: .25, max: 4, swirl: 1, clear: .15},   // wildlife.birds_scatter: the wings' downwash (+ per bird, at most)
};
const FIRE_KINDS = {campfire: 1, brazier: 1, torch: 1, beacon: 1};
const S0 = ['shot', 'impact', 'blast', 'misc', 'player', 'proj', 'mover', 'fire', 'dropped'];

export async function create(host) {
  const R = viewRandom('airfx');
  const T = TUNE;
  // the splat handed to the field (copied there at once): number fields only, all doubles from the start
  const SP = {x: .5, z: .5, r: .5, vx: .5, vz: .5, radial: .5, swirl: .5, clear: .5, smoke: .5, body: 0};
  // the counters (this frame's splats by source, the most in a frame, all of them; F.stats)
  const stats = {frame: 0, peak: 0, total: 0, by: {}, peakBy: {}, ms: 0};
  for (const k of S0) { stats.by[k] = 0; stats.peakBy[k] = 0; }
  let A = null, n = 0, src = 'misc', rx0 = 0, rz0 = 0, rk = 0, lastSteps = -1;   // the field this frame, splats so far, the source, its rect, its step count

  // ---- the ground under a source: its dust, how high over it a source is
  function dustAt(x, y) {
    if (host.inStream(x, y)) return 0;
    const id = host.biome.id, D = T.dust[id];
    if (typeof D === 'number') return D;
    if (D) { const g = host.biome.groundAt?.(x, y); return g && D[g] !== undefined ? D[g] : T.dust.other; }
    return T.dust.other;
  }
  const lowK = (x, y, h) => 1 - smooth((h - host.elev(x, y) - T.height.full) / (T.height.zero - T.height.full));

  // ---- one splat (z: the arena's y). k scales every amount (a source's height, its strength); nothing outside the field
  function put(x, z, r, vx, vz, radial, swirl, clear, smoke, k, body = 0) {   // (body: a moving body's radius: render/air.js parts the air round it)
    if (!(k > .01)) return false;
    if (n >= T.max) { stats.by.dropped++; return false; }
    if (rk > 0) {   // (the field's square, with the splat's radius round it)
      const u = (x - rx0) * rk, v = (z - rz0) * rk, m = r * rk;
      if (u < -m || v < -m || u > 1 + m || v > 1 + m) return false;
    }
    SP.x = x; SP.z = z; SP.r = r; SP.vx = vx * k; SP.vz = vz * k; SP.radial = radial * k; SP.swirl = swirl * k;
    SP.clear = clear * k > 1 ? 1 : clear * k; SP.smoke = smoke * k > 1 ? 1 : smoke * k; SP.body = body;
    A.splat(SP); n++; stats.by[src]++;
    return true;
  }

  // ---- shots: a jet out of the muzzle (x, y, h) along (ux, uy) (unit), strength s
  function jet(x, y, h, ux, uy, s, nJ, len, first) {
    const J = T.jet;
    for (let i = 0; i < nJ; i++) {
      const f = nJ > 1 ? i / (nJ - 1) : 0, d = len * (i + .5) / nJ, px = x + ux * d, py = y + uy * d, v = J.v * (1 - (1 - J.fall) * f);
      put(px, py, J.r0 + (J.r1 - J.r0) * f, ux * v, uy * v, first && i === 0 ? J.radial : 0, 0, J.clear, first && i === 0 ? J.smoke : 0, s * lowK(px, py, h));
    }
  }
  function shot(e, s, coach) {
    const ux = e.vx || 0, uy = e.vy || 0, l = hypot2(ux, uy); if (!(l > 0)) return;
    const x = e.x, y = e.y, h = e.h ?? (e.z || 0) + 1.2, J = T.jet, C = T.chan, ex = ux / l, ey = uy / l;
    if (coach) {   // the coach gun: its pellets' jets fanned out, the smoke once
      const K = T.coach;
      for (let j = 0; j < K.jets; j++) {
        const a = K.jets > 1 ? (j / (K.jets - 1) * 2 - 1) * K.spread : 0, c = Math.cos(a), sn = Math.sin(a);
        jet(x, y, h, ex * c - ey * sn, ey * c + ex * sn, s * (j === (K.jets >> 1) ? 1 : .8), K.n, K.len, j === (K.jets >> 1));
      }
    } else jet(x, y, h, ex, ey, s, J.n, J.len, true);
    // the curls either side (the jet's shear against the still air): on its right (+90 deg from its way in x, y: y is south)
    // clockwise seen from above, on its left counter-clockwise
    if (J.pair > 0) {
      const px = x + ex * J.pairD, py = y + ey * J.pairD, k = s * lowK(px, py, h), ox = -ey * J.pairOff, oy = ex * J.pairOff;
      put(px + ox, py + oy, J.pairR, 0, 0, 0, -J.pair, 0, 0, k);
      put(px - ox, py - oy, J.pairR, 0, 0, 0, J.pair, 0, 0, k);
    }
    for (let i = 0; i < C.at.length; i++) {   // the channel on along the shot
      const d = C.at[i] * (coach ? .6 : 1), px = x + ex * d, py = y + ey * d;
      put(px, py, C.r, ex * C.v, ey * C.v, 0, 0, C.clear, 0, Math.min(1.2, s) * lowK(px, py, h));
    }
  }

  // ---- blasts: x, y, r; the middle, the ring
  function ring(x, y, h, r, nR, at, rr, v, smoke, swirl, k) {
    const a0 = R() * 6.283;
    for (let i = 0; i < nR; i++) {
      const a = a0 + i * 6.283 / nR + (R() - .5) * .5, c = Math.cos(a), s = Math.sin(a), px = x + c * r * at, py = y + s * r * at;
      put(px, py, r * rr, c * v, s * v, 0, swirl ? (R() * 2 - 1) * swirl : 0, 0, smoke, k * lowK(px, py, h));
    }
  }
  function blast(x, y, h, r, k) {
    const B = T.blast, d = dustAt(x, y);
    put(x, y, r * B.clearR, 0, 0, B.radial, 0, B.clear, B.smoke * (.5 + .5 * d), k * lowK(x, y, h));
    ring(x, y, h, r, B.ring, B.ringAt, B.ringR, B.ringV, B.ringSmoke * (.4 + .6 * d), B.swirl, k);
  }
  function burst(e) {
    const r = e.r || 1, h = e.h ?? e.z ?? host.elev(e.x, e.y);
    if (e.style === 'blast') { blast(e.x, e.y, h, r, 1); return; }
    const B = T.burst[e.style] || T.burst.ring;
    put(e.x, e.y, r * B.rk + .3, 0, 0, B.radial, 0, B.clear, B.smoke, lowK(e.x, e.y, h));
    if (B.ring) ring(e.x, e.y, h, r, B.ring, 1, .45, B.ringV, B.ringSmoke, 1.5, 1);
  }

  // ---- impacts
  function impact(e) {
    const I = T.impact, ux = e.dx || 0, uy = e.dy || 0, du = I.dust[e.surf] ?? I.dust.other;
    const dust = e.surf === 'ground' ? du * dustAt(e.x, e.y) * 2 : du;   // (the ground's own: sand far more than grass)
    put(e.x, e.y, I.r, ux * I.push, uy * I.push, I.radial, 0, I.clear, dust, lowK(e.x, e.y, e.h ?? 0));
  }

  // ---- the player's and the movers' wakes: a BODY at (x, y) moving (vx, vy) (m/s, smoothed), of radius `body` (render/air.js's
  // body splat: the air in it goes along with it, round it the air parts: pushed out ahead, round its sides, in behind), its
  // wake (centred a little behind it, r) CLEAR to cl. (share: kept in the table for a field without bodies)
  function wake(x, y, vx, vy, sp, r, share, cl, k, body) {
    if (sp < .3) return;
    put(x - vx / sp * r * .3, y - vy / sp * r * .3, r, vx, vy, 0, 0, cl, 0, k, body);
  }
  const clearBy = (C, sp) => C[2] * smooth((sp - C[0]) / (C[1] - C[0]));
  const PW = {x: NaN, y: NaN, vx: 0, vy: 0, sp: 0};   // the player's tracker: last frame's place, smoothed velocity
  function track(o, x, y, dt, tau) {   // -> false on a jump (a teleport, a respawn: no wake from it)
    const dx = x - o.x, dy = y - o.y;
    o.x = x; o.y = y;
    if (!(dx === dx) || dx * dx + dy * dy > 9 || !(dt > 0)) { o.vx = o.vy = o.sp = 0; return false; }
    const a = 1 - Math.exp(-dt / tau);
    o.vx += (dx / dt - o.vx) * a; o.vy += (dy / dt - o.vy) * a; o.sp = hypot2(o.vx, o.vy);
    return true;
  }
  function player(dt, steady) {   // (tracked every frame; splatted once an air step)
    const pl = host.player, x = pl.x, y = pl.y;
    if (!track(PW, x, y, dt, T.player.tau) || !steady || PW.sp < .3) return;
    const st = pl.state, P = T.player, k = lowK(x, y, pl.z);
    if (st === 'roll') wake(x, y, PW.vx, PW.vy, PW.sp, P.roll.r, P.roll.share, Math.max(P.roll.clear, clearBy(P.clear, PW.sp)), k, P.body * 1.2);
    else if (st === 'backstep') wake(x, y, PW.vx, PW.vy, PW.sp, P.back.r, P.back.share, Math.max(P.back.clear, clearBy(P.clear, PW.sp)), k, P.body);
    else wake(x, y, PW.vx, PW.vy, PW.sp, P.r, P.share, clearBy(P.clear, PW.sp), k, P.body);
  }

  // ---- the movers: brutes, gunmen, hunters (a live query); each one's tracker made as it joins
  const mstate = new WeakMap();
  const movers = host.entities.query('airfx.movers', p => p.kind === 'brute' || !!p.sparring || !!p.hunter,
    p => { if (!mstate.has(p)) mstate.set(p, {x: NaN, y: NaN, vx: 0, vy: 0, sp: 0}); });
  const MN = T.movers.max, mSel = new Array(MN).fill(null), mD = new Float64Array(MN);
  function moversWake(dt, cx, cy, steady) {
    const M = T.movers;
    let m = 0;
    for (let i = 0; i < movers.length; i++) {   // every mover's tracker follows it (no spike when it comes near); the nearest kept
      const p = movers[i], o = mstate.get(p); if (!o) continue;
      if (!track(o, p.x, p.y, dt, M.tau) || !steady || p.gone || p.broken || o.sp < .3) continue;
      const d = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy); if (d > M.reach * M.reach) continue;
      if (m < MN) { mSel[m] = p; mD[m] = d; m++; continue; }
      let w = 0; for (let j = 1; j < MN; j++) if (mD[j] > mD[w]) w = j;   // (full: swap out the farthest)
      if (d < mD[w]) { mSel[w] = p; mD[w] = d; }
    }
    for (let i = 0; i < m; i++) {
      const p = mSel[i], o = mstate.get(p); mSel[i] = null;
      wake(p.x, p.y, o.vx, o.vy, o.sp, M.r, M.share, clearBy(M.clear, o.sp), lowK(p.x, p.y, (p.z || 0) + (p.h || 0)), M.body);
    }
  }

  // ---- in flight: each arrow / bullet's place at its last splat, in slots (a slot per projectile while it flies)
  const PN = 24, pA = new Array(PN).fill(null), pX = new Float64Array(PN), pY = new Float64Array(PN), pSeen = new Uint8Array(PN);
  function flying(steady) {
    pSeen.fill(0);
    let nA = 0;
    const arrows = host.arrows, AR = T.arrow, BU = T.bullet;
    for (let i = 0; i < arrows.length; i++) {
      const a = arrows[i]; if (a.stuck || a.life <= -9) continue;
      let s = -1; for (let j = 0; j < PN; j++) if (pA[j] === a) { s = j; break; }
      const bullet = a.kind === 'bullet';
      if (s < 0) {   // new: from its muzzle (a bullet: where it left the gun), else from here
        for (let j = 0; j < PN; j++) if (pA[j] === null) { s = j; break; }
        if (s < 0) continue;
        pA[s] = a; pX[s] = bullet && a.ox !== undefined ? a.ox : a.x; pY[s] = bullet && a.oy !== undefined ? a.oy : a.y;
      }
      pSeen[s] = 1;
      if (!steady) continue;
      const dx = a.x - pX[s], dy = a.y - pY[s], L = hypot2(dx, dy); pX[s] = a.x; pY[s] = a.y;
      if (!(L > .01) || nA >= AR.max) continue;   // (no sim step since the last splat: it hasn't moved)
      const ux = dx / L, uy = dy / L;
      if (bullet) {
        const m = Math.min(BU.n, Math.ceil(L / BU.step)), d0 = a.ox !== undefined ? hypot2(a.x - a.ox, a.y - a.oy) : 0;
        for (let j = 0; j < m; j++) {   // (its trail thins with the distance from the muzzle: the shot's blast cleared most)
          const f = (j + .5) / m, x = a.x - dx * f, y = a.y - dy * f, cl = BU.clear * (1 - BU.fade * smooth((d0 - L * f) / BU.far));
          if (put(x, y, BU.r, ux * BU.v, uy * BU.v, 0, 0, cl, 0, lowK(x, y, a.h))) nA++;
        }
      } else {
        const v = hypot2(a.vx, a.vy) * AR.k;
        if (put(a.x, a.y, AR.r, ux * v, uy * v, 0, 0, AR.clear, 0, lowK(a.x, a.y, a.h))) nA++;
      }
    }
    for (let j = 0; j < PN; j++) if (!pSeen[j]) pA[j] = null;
  }

  // ---- fires: lit torches, braziers, the campfire, the beacon (a live query); each splats every `every` s (of air steps)
  const fstate = new WeakMap();
  const fires = host.entities.query('airfx.fires', p => FIRE_KINDS[p.kind] === 1, p => { if (!fstate.has(p)) fstate.set(p, {t: R() * T.fire.every}); });
  function firesBlow(sdt) {   // sdt: an air step's s (called once a step)
    const E = T.fire.every;
    for (let i = 0; i < fires.length; i++) {
      const p = fires[i]; if (p.unlit || p.gone || p.broken) continue;
      const o = fstate.get(p); if (!o || (o.t += sdt) < E) continue;
      const F0 = T.fire[p.kind]; o.t = 0;
      put(p.x, p.y, F0.r, 0, 0, -F0.inflow, 0, F0.clear, F0.smoke, lowK(p.x, p.y, p.z || 0));
    }
  }

  // ---- the events
  function event(e) {
    const ty = e.type;
    switch (ty) {
      case 'player.shoot': {
        src = 'shot';
        const G = T.gun; shot(e, (G[e.gun] ?? G.other) * (e.fan ? G.fan : 1) * (e.hip ? G.hip : 1), false); return;
      }
      case 'foe.shoot': {
        src = 'shot';
        const G = T.gun, coach = e.gun === 'coach'; shot(e, coach ? G.coach : (G[e.gun] ?? G.other) * G.foe, coach); return;
      }
      case 'bullet.impact': src = 'impact'; impact(e); return;
      case 'bullet.ricochet': {
        src = 'impact'; const I = T.rico;
        put(e.x, e.y, I.r, (e.dx || 0) * I.push, (e.dy || 0) * I.push, I.radial, 0, I.clear, e.mat === 'stone' ? I.smoke : I.smoke * .3, lowK(e.x, e.y, e.h ?? 0)); return;
      }
      case 'arrow.hit': {
        if (e.kind === 'bullet') return;   // (a bullet's end is its bullet.impact)
        src = 'impact'; const I = T.arrowHit, vx = e.vx || 0, vy = e.vy || 0;
        put(e.x, e.y, I.r, vx * I.push, vy * I.push, I.radial, 0, I.clear, I.smoke, 1); return;
      }
      case 'combat.explode': src = 'blast'; blast(e.x, e.y, host.elev(e.x, e.y), e.r || 2, 1); return;
      case 'hazard.burst': src = 'blast'; burst(e); return;
      case 'omen.strike': {
        src = 'blast'; const B = T.burst.strike, r = e.r || T.strikeR, h = host.elev(e.x, e.y);
        put(e.x, e.y, r * B.rk + .3, 0, 0, B.radial, 0, B.clear, B.smoke, 1);
        ring(e.x, e.y, h, r, B.ring, 1, .45, B.ringV, B.ringSmoke, 1.5, 1); return;
      }
      case 'equip.puff': {
        src = 'blast'; const B = T.smokeBomb, r = e.r || 2.5, h = e.h ?? host.elev(e.x, e.y);
        put(e.x, e.y, r, 0, 0, B.radial, 0, 0, B.smoke, lowK(e.x, e.y, h));
        ring(e.x, e.y, h, r, B.ring, B.ringAt, .5, B.ringV, B.ringSmoke, 1, 1); return;
      }
      case 'player.jump': {
        src = 'player'; const J = T.jump;
        put(e.x, e.y, J.r, 0, 0, J.radial, 0, J.clear, J.smoke * dustAt(e.x, e.y), lowK(e.x, e.y, e.z ?? 0)); return;
      }
      case 'player.land': {
        src = 'player'; const L = T.land, k = (e.big || 0) >= 3 ? 1 : L.step;
        put(e.x, e.y, L.r[0] + (L.r[1] - L.r[0]) * k, 0, 0, L.radial * k, 0, L.clear * k, L.smoke * k * dustAt(e.x, e.y), lowK(e.x, e.y, e.z ?? 0)); return;
      }
      case 'prop.impact': {
        src = 'misc'; const I = T.impactK, s = e.speed || 0, f = Math.min(1, s / I.speed);
        put(e.x, e.y, I.r, 0, 0, Math.min(I.max, s * I.radial), 0, 0, I.smoke * f * dustAt(e.x, e.y), f); return;
      }
      case 'tumbleweed.bounce': {
        src = 'misc'; const I = T.tumble, k = e.k ?? .5;
        put(e.x, e.y, I.r, 0, 0, I.radial, 0, 0, I.smoke * dustAt(e.x, e.y), k); return;
      }
      case 'wildlife.birds_scatter': {
        src = 'misc'; const I = T.birds;
        put(e.x, e.y, I.r, 0, 0, Math.min(I.max, I.radial + I.per * (e.n || 1)), (R() * 2 - 1) * I.swirl, I.clear, 0, 1); return;
      }
    }
    const D = T.ev[ty]; if (!D) return;
    src = 'misc';
    put(e.x, e.y, D[0], 0, 0, D[1], 0, D[2], D[4] ? D[3] * dustAt(e.x, e.y) : D[3], lowK(e.x, e.y, e.h ?? e.z ?? host.elev(e.x, e.y)));
  }

  const F = {
    name: 'airfx', label: 'Air fx', on: true, TUNE, stats,
    get src() { return src; },   // (the source splatting right now: tests count by it)
    toggle() { F.on = !F.on; return F.on; },
    hud: () => `air fx: ${stats.frame} splats (peak ${stats.peak}, ${S0.map(k => k + ' ' + stats.peakBy[k]).join(' ')}) ${stats.ms.toFixed(3)} ms`,
    view(dt, evs) {
      const t0 = performance.now();
      for (let i = 0; i < S0.length; i++) stats.by[S0[i]] = 0;
      n = 0; A = host.G.air;
      const on = !!(A && A.on);
      if (on) A.step(dt);   // (the field steps on the views' time, not the wall clock: hitstop holds it, slow motion slows it)
      // steady sources splat once per air step: the field took the queue since the last one (its step count moved; a field
      // without one: every frame)
      const as = on ? A.steps : undefined, steady = on && (as === undefined || as !== lastSteps); lastSteps = as;
      if (on) {
        const rc = A.rect; if (rc && rc.z > 0) { rx0 = rc.x; rz0 = rc.y; rk = rc.z; } else rk = 0;
        for (let i = 0; i < evs.length; i++) event(evs[i]);
      }
      // (the trackers follow even with the field off: nothing jumps when it comes on)
      src = 'player'; player(dt, steady);
      if (on) { src = 'proj'; flying(steady); }
      src = 'mover'; { const pl = host.player; moversWake(dt, rk > 0 ? rx0 + .5 / rk : pl.x, rk > 0 ? rz0 + .5 / rk : pl.y, steady); }
      if (steady) { src = 'fire'; firesBlow(1 / (A.TUNE?.hz || 60)); }
      stats.frame = n; stats.total += n; if (n > stats.peak) stats.peak = n;
      for (let i = 0; i < S0.length; i++) { const k = S0[i]; if (stats.by[k] > stats.peakBy[k]) stats.peakBy[k] = stats.by[k]; }
      A = null;
      stats.ms += (performance.now() - t0 - stats.ms) * .05;
    },
  };
  return F;
}
