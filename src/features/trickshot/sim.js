// TRICK-SHOT RANGE, the SIM (features/trickshot.js): what is true at the range. Its props in the registry (the fence, the
// crate, the steel plate as colliders; the bottles and the cans as targets the arrows and bullets hit), the cans' flight
// (tossed up, popped by hits, bouncing, rolling, landing on the crate or the rail), the bottles breaking and being set up
// again, the counts (shots, hits, the juggle, ricochets), the run against the clock ("clear the fence"), and the
// records (localStorage: its own key). Deterministic: its draws come from its own generator (a fixed seed), never
// Math.random; time is the sum of its steps.
//   const S = createRangeSim(host, {onDrop}); S.build() / teardown() / update(dt, evs) (one fixed step) / want(action)
//   (a key, the menu or E: done in the next step) / onArrowHit(a, p) / arrow(a) / aimTarget() / interact(p) / prompt(p)
//   S.active, S.A (the anchor), S.bottles, S.cans, S.plate, S.stats, S.rec, S.clear, S.near()
// OWNS: its props (kinds trick_fence / trick_crate / trick_plate / trick_bottle / trick_can: x, y, h of the cans as they
//   fly, their `gone` through host.entities.hide), the scatter it hid under them, its records, the host.mods source
//   'trickshot' (proj.ricochet while the range stands).
// READS: host (player, weapon, aim, mouse, G (the aim assist's screen test), elev, entities.near, layout), PROP_TOP.
// EMITS: trick.shatter / ping / toss / clink / ding / reset / clear (core/events.js).
// BUDGET: off: nothing. On: <= 6 cans' steps (a near() query each while one moves), a handful of records.
import {PROP_TOP, propTop, walkable} from '../../world/world.js';
import {setMaterials} from '../../content/materials.js';
import {mulberry32} from '../../core/rng.js';
import {clamp, hypot2, hypot3} from '../../core/mathx.js';
import {flags} from '../../core/flags.js';
import {SHAPE} from './models.js';

// how high each stops arrows and bullets (world.js PROP_TOP, read by sim/projectiles.js); what each is made of (a
// bullet's impact: features/gunfx.js; whether one may glance off: sim/projectiles.js)
propTop({trick_fence: SHAPE.fence.top, trick_crate: SHAPE.crate.h, trick_plate: SHAPE.plate.h + .04});
setMaterials({trick_fence: 'wood', trick_crate: 'wood', trick_plate: 'metal', trick_can: 'metal', trick_bottle: 'glass'});

export const TUNE = {
  at: {x: 10.3, y: 6.9},    // the range's anchor (the fence's middle): the Proving Grounds' north-west corner, along the north
                            // wall (missed shots chip it) and north of the bow's lane, clear of its mark and dummies and of the
                            // pillar grove (the desert's fort has the same walls)
  near: 14,                 // m from the anchor: "at the range" (shots count, the HUD shows, 1 tosses)
  markR: 1.1,               // m from the mark (models.js SHAPE.mark): standing on it, the first shot starts the clock
  tossCans: 3,              // cans to toss (they come from the crate; the 3 stacked on it are knocked off)
  g: 11,                    // m/s^2 on a can (a touch over g: a snappier arc)
  // the toss: m/s up (+-var), m/s forward, the hand's height, m in front. A revolver can't shoot steeper than ~22 deg
  // (sim/player/gun.js: its slope to a target is capped at .4), so a can is shot on its way down, a few metres out
  toss: {up: 5.6, upVar: .3, fwd: 2.8, hand: 1.25, out: .35},
  // a hit's [m/s up, m/s along the shot]; x the upward speed it keeps; m/s sideways per m off its middle across the shot,
  // m/s up per m under its middle (a hit low on the can lifts it more); the cap on its speed along the ground
  pop: {bullet: [5.0, .55], arrow: [4.4, 1.6], blast: [4.2, 2.2], melee: [3.4, 2.4], keep: .3, english: 5, under: 8, max: 3},
  bounce: .32, bounceMin: 1.4, friction: .7, roll: 2.4,   // a landing: x vh back up (above bounceMin m/s), x the speed along; m/s^2 rolling
  wall: .45,                // x the speed off a wall
  aimPx: 9,                 // the aim assist: the cursor this near (art px) a can in the air aims at it, leading it
  autoReset: 2.5,           // s after the last bottle breaks before they are set up again
  stray: 12,                // s a tossed can lies on the ground before it is back in the crate
  hitstop: .03, shake: [1, .06],   // a bottle breaking (s; art px, s)
};
const STORE = 'riftbound3d.trickshot.v1';
const GLASS = ['amber', 'green'];

export function createRangeSim(host, {onDrop = null} = {}) {
  const P = host.player, ents = host.entities, events = host.events, A = TUNE.at, NEAR = [], SC = [0, 0, 0];
  const R = mulberry32(0x7c15a3e9);   // the sim's draws (a fixed seed: the sim replays)
  const bottles = [], cans = [], hidden = [], solids = [];
  const stats = {shots: 0, hits: 0, ricochets: 0, dings: 0, juggle: 0};
  const clear = {st: 'ready', t: 0, shots: 0, doneT: 0, last: 0, best: false};   // ready | run | done | off
  const rec = {bestJuggle: 0, bestClear: 0, clears: 0};
  const scored = new WeakSet();   // projectiles that already counted as a hit
  const want = {toss: 0, reset: false};
  let active = false, fence = null, crate = null, plate = null, recLoaded = false, assist = true;
  const emit = (type, x, y, o) => { const e = {type, x, y}; if (o) Object.assign(e, o); events.push(e); return e; };

  function loadRec() {
    if (recLoaded) return; recLoaded = true;
    try { Object.assign(rec, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { /* storage blocked: records for this page only */ }
  }
  function saveRec() { try { localStorage.setItem(STORE, JSON.stringify(rec)); } catch { /* storage blocked */ } }

  // ================================================================ build / tear down
  const prop = p => { ents.add(p); solids.push(p); return p; };
  function build() {
    if (active) return;
    active = true; loadRec();
    const F = SHAPE.fence, C = SHAPE.crate, Pl = SHAPE.plate;
    clearUnder(A.x, A.y, F.half + .3, .5); clearUnder(A.x + C.x, A.y + C.y, .7, .7); clearUnder(A.x + Pl.x, A.y + Pl.y, .55, .4);
    fence = prop({kind: 'trick_fence', x: A.x, y: A.y, z: 0, rect: [A.x - F.half, A.y - .06, A.x + F.half, A.y + .1], interact: 'trick'});
    const cx = A.x + C.x, cy = A.y + C.y;
    crate = prop({kind: 'trick_crate', x: cx, y: cy, z: 0, rect: [cx - C.w / 2, cy - C.d / 2, cx + C.w / 2, cy + C.d / 2], interact: 'trick'});
    // the plate: a target (the cursor aims at it, the hit chain rings it) and a solid band (what grazes its edge glances off
    // or rings it too); z its foot (bullets pass under it, between the posts)
    const px = A.x + Pl.x, py = A.y + Pl.y, z0 = Pl.pivot - Pl.drop - Pl.h - .02;
    plate = {p: prop({kind: 'trick_plate', x: px, y: py, z: z0, h: 0, target: true, hitR: Pl.w / 2 + .02, hitH: Pl.h + .04,
      rect: [px - Pl.w / 2 - .02, py - .04, px + Pl.w / 2 + .02, py + .04]}), x: px, y: py, h: Pl.pivot - Pl.drop - Pl.h / 2};
    for (let i = 0; i < SHAPE.bottles.length; i++) {
      const p = {kind: 'trick_bottle', x: A.x + SHAPE.bottles[i], y: A.y + .045, z: 0, h: F.top, r: 0, target: true, hitR: .14, hitH: SHAPE.bottle.h + .02};
      ents.add(p); bottles.push({p, glass: GLASS[i % 2], up: true});
    }
    for (let i = 0; i < SHAPE.stack.length + TUNE.tossCans; i++) {
      const p = {kind: 'trick_can', x: cx, y: cy, z: 0, h: C.h, r: 0, target: true, hitR: .22, hitH: .25};
      const c = {p, i, stack: i < SHAPE.stack.length, st: 'home', x: cx, y: cy, c: C.h, vx: 0, vy: 0, vh: 0, jug: 0, upright: true, restT: 0, hx: cx, hy: cy, hc: C.h};
      if (c.stack) { const [dx, dy, row] = SHAPE.stack[i]; c.hx = cx + dx; c.hy = cy + dy; c.hc = C.h + SHAPE.can.h * (row + .5); }
      ents.add(p); cans.push(c); home(c);
    }
    host.mods.set('trickshot', flags.get('rico') === '0' ? [] : [{stat: 'proj.ricochet', add: 1}]);
    clear.st = 'ready'; clear.t = 0; clear.shots = 0; clear.doneT = 0;
  }
  function teardown() {
    if (!active) return;
    active = false;
    for (const p of solids) ents.remove(p);
    for (const b of bottles) ents.remove(b.p);
    for (const c of cans) ents.remove(c.p);
    for (const q of hidden) ents.hide(q, false);
    solids.length = bottles.length = cans.length = hidden.length = 0; fence = crate = plate = null;
    host.mods.clear('trickshot');
    want.toss = 0; want.reset = false;
    onDrop?.();
  }
  // the soft scatter (tufts, bushes, small rocks) under a piece goes while the range stands (put back on teardown)
  function clearUnder(x, y, rx, ry) {
    for (const q of ents.near(x, y, Math.max(rx, ry) + .3, NEAR)) {
      if (q.gone || q.r > 0 || q.rect || !(q.kind === 'tuft' || q.kind === 'bush' || q.kind === 'rock')) continue;
      if (Math.abs(q.x - x) > rx || Math.abs(q.y - y) > ry) continue;
      ents.hide(q); hidden.push(q);
    }
  }

  // ================================================================ the cans
  // a can's state: home (in / on the crate: a stack can on its spot, a toss can hidden in the crate) | air | ground
  // (rolling on whatever holds it up) | rest. c: the height of its middle; the prop's h is its hit band's foot (c - .05)
  const CR = SHAPE.can.r, CH = SHAPE.can.h / 2;
  function place(c) { const p = c.p; p.x = c.x; p.y = c.y; p.h = c.c - .05; }
  function home(c) {
    c.st = 'home'; c.vx = c.vy = c.vh = 0; c.jug = 0; c.upright = true; c.restT = 0;
    c.x = c.hx; c.y = c.hy; c.c = c.hc; place(c);
    ents.hide(c.p, !c.stack); ents.moved(c.p);
  }
  function toss() {
    let c = null;
    for (const k of cans) if (!k.stack && k.st === 'home') { c = k; break; }
    if (!c) for (const k of cans) if (!k.stack && k.st !== 'air' && (!c || k.restT > c.restT)) c = k;   // (all out: the one lying longest)
    if (!c) return;
    const t = host.aim(); let ux = t.x - P.x, uy = t.y - P.y; const l = hypot2(ux, uy);
    if (l > .05) { ux /= l; uy /= l; } else { const f = P.faceAngle; ux = Math.sin(f); uy = Math.cos(f); }
    const T0 = TUNE.toss;
    c.x = P.x + ux * T0.out; c.y = P.y + uy * T0.out; c.c = P.z + T0.hand;
    c.vx = ux * T0.fwd; c.vy = uy * T0.fwd; c.vh = T0.up + (R() * 2 - 1) * T0.upVar;
    c.st = 'air'; c.jug = 0; c.upright = false; c.restT = 0; place(c);
    ents.hide(c.p, false); ents.moved(c.p);
    emit('trick.toss', c.x, c.y, {h: c.c, who: c.p});
  }
  // a hit: pop it up and away along the shot (ux, uy: unit; off: m off its middle across the shot), by what
  function popCan(c, ux, uy, off, by, a) {
    const air = c.st === 'air', K = TUNE.pop, [up, push] = K[by] || K.bullet, under = a ? clamp(c.c - a.h, -.15, .15) * K.under : 0;
    c.vh = Math.max(c.vh, 0) * K.keep + up + under;
    c.vx += ux * push - uy * off * K.english; c.vy += uy * push + ux * off * K.english;
    const s = hypot2(c.vx, c.vy); if (s > K.max) { c.vx *= K.max / s; c.vy *= K.max / s; }
    if (c.st !== 'air') c.c += .02;   // (off what holds it)
    c.st = 'air'; c.upright = false; c.restT = 0; c.jug = air ? c.jug + 1 : 0;
    if (c.jug > stats.juggle) stats.juggle = c.jug;
    score(a);
    emit('trick.ping', c.x, c.y, {h: c.c, dx: ux, dy: uy, by, who: c.p, air, n: c.jug});
  }
  // the top of what holds a can up at (x, y) when its foot was at `foot`: the ground, or a prop's top it came down on
  function supportAt(x, y, foot) {
    let top = host.elev(x, y);
    for (const p of ents.near(x, y, CR, NEAR)) {
      if (p.gone || p.broken || !(p.rect || p.r > 0) || p.hunter || p.sparring || p.kind === 'tree') continue;
      const t = (p.z || 0) + (PROP_TOP[p.kind] ?? 1);
      if (t > top && t <= foot + .03 && inside(p, x, y, -.02)) top = t;
    }
    return top;
  }
  const inside = (p, x, y, m) => p.rect ? x > p.rect[0] - m && x < p.rect[2] + m && y > p.rect[1] - m && y < p.rect[3] + m : hypot2(p.x - x, p.y - y) < p.r + m;
  // a solid's side in the way from (px, py) to (x, y) at foot height f: off it (the speed across its face back, x wall)
  function walls(c, px, py, foot) {
    for (const p of ents.near(c.x, c.y, CR, NEAR)) {
      if (p.gone || p.broken || !(p.rect || p.r > 0) || p.hunter || p.sparring || p.kind === 'tree') continue;
      if (foot >= (p.z || 0) + (PROP_TOP[p.kind] ?? 1) - .01 || c.c + CH < (p.z || 0)) continue;   // over it / under it
      if (!inside(p, c.x, c.y, CR) || inside(p, px, py, CR)) continue;
      if (p.rect) {
        const R = p.rect, inX = px > R[0] - CR && px < R[2] + CR;   // it was beside it along x: the face crossed is a y face
        if (inX) c.vy = -c.vy * TUNE.wall; else c.vx = -c.vx * TUNE.wall;
      } else {
        const nx = c.x - p.x, ny = c.y - p.y, l = hypot2(nx, ny) || 1, d = (c.vx * nx + c.vy * ny) / l;
        if (d < 0) { c.vx -= (1 + TUNE.wall) * d * nx / l; c.vy -= (1 + TUNE.wall) * d * ny / l; }
      }
      c.x = px; c.y = py;
      emit('trick.clink', c.x, c.y, {k: clamp(hypot2(c.vx, c.vy) / 4, .2, 1), who: c.p, n: 0, best: false});
      return;
    }
  }
  function land(c, k) {   // a juggle ends where it first comes down
    let n = 0, best = false;
    if (c.jug > 0) { n = c.jug; if (n > rec.bestJuggle) { rec.bestJuggle = n; best = true; saveRec(); } c.jug = 0; }
    emit('trick.clink', c.x, c.y, {k, who: c.p, n, best});
  }
  function stepCan(c, dt) {
    if (c.st === 'home') return;
    if (c.st === 'rest') { c.restT += dt; if (!c.stack && c.restT > TUNE.stray) home(c); return; }
    const px = c.x, py = c.y, foot0 = c.c - (c.upright ? CH : CR);
    if (c.st === 'air') {
      c.vh -= TUNE.g * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.c += c.vh * dt;
      walls(c, px, py, c.c - CR);
      const top = supportAt(c.x, c.y, foot0);
      if (c.c - CR <= top) {
        c.c = top + CR;
        if (c.vh < -TUNE.bounceMin) { land(c, clamp(-c.vh / 7, .15, 1)); c.vh = -c.vh * TUNE.bounce; c.vx *= TUNE.friction; c.vy *= TUNE.friction; }
        else { if (c.vh < -.3 || c.jug) land(c, clamp(-c.vh / 7, .1, .5)); c.vh = 0; c.st = 'ground'; }
      }
    } else {   // ground: rolling on its side, slowing; off an edge it falls again
      const s = hypot2(c.vx, c.vy), d = TUNE.roll * dt;
      if (s <= d) { c.vx = c.vy = 0; c.st = 'rest'; c.restT = 0; }
      else { c.vx *= 1 - d / s; c.vy *= 1 - d / s; c.x += c.vx * dt; c.y += c.vy * dt; walls(c, px, py, foot0); }
      const top = supportAt(c.x, c.y, foot0 + .01);
      if (top < foot0 - .05) { c.st = 'air'; c.vh = 0; } else c.c = top + CR;
    }
    if (c.st !== 'air' && !walkable(c.x, c.y)) { home(c); return; }   // down over the walls, off the map: back in the crate
    place(c);
  }

  // ================================================================ the bottles
  function shatter(b, by, ux, uy, a) {
    if (!b.up) return;
    b.up = false; ents.hide(b.p);
    score(a);
    const p = b.p;
    emit('trick.shatter', p.x, p.y, {h: p.h + SHAPE.bottle.h * .45, dx: ux, dy: uy, by, who: p, glass: b.glass});
    if (by === 'bullet' || by === 'arrow') { host.hitstop(TUNE.hitstop); host.shake(TUNE.shake[0], TUNE.shake[1]); }
    if (clear.st === 'run' && allDown()) {
      clear.st = 'done'; clear.doneT = 0; clear.last = clear.t; rec.clears++;
      clear.best = !rec.bestClear || clear.t < rec.bestClear; if (clear.best) rec.bestClear = +clear.t.toFixed(3);
      saveRec();
      emit('trick.clear', fence.x, fence.y, {t: clear.t, shots: clear.shots, best: clear.best});
    }
  }
  function reset() {
    for (const b of bottles) if (!b.up) { b.up = true; ents.hide(b.p, false); }
    for (const c of cans) if (c.stack) home(c);
    clear.st = 'ready'; clear.t = 0; clear.shots = 0; clear.doneT = 0;
    emit('trick.reset', fence.x, fence.y);
  }
  // a projectile's hit (once per projectile)
  function score(a) { if (!a || scored.has(a)) return; scored.add(a); stats.hits++; }
  const bottleOf = p => { for (let i = 0; i < bottles.length; i++) if (bottles[i].p === p) return bottles[i]; return null; };
  const canOf = p => { for (let i = 0; i < cans.length; i++) if (cans[i].p === p) return cans[i]; return null; };
  const atRange = () => hypot2(P.x - A.x, P.y - A.y) < TUNE.near;
  const onMark = () => hypot2(P.x - A.x - SHAPE.mark.x, P.y - A.y - SHAPE.mark.y) < TUNE.markR;
  function upCount() { let n = 0; for (let i = 0; i < bottles.length; i++) if (bottles[i].up) n++; return n; }
  const allDown = () => bottles.length > 0 && upCount() === 0;

  // ================================================================ the step
  function update(dt, evs) {
    if (want.reset) { want.reset = false; reset(); }
    for (; want.toss > 0; want.toss--) toss();
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === 'combat.hit' && e.who) {   // a blast, the pistol whip (combat's damage on anything hittable)
        if (plate && e.who === plate.p) { ding(e.x, e.y, e.h, .6, null, false); continue; }
        const b = bottleOf(e.who), c = b ? null : canOf(e.who);
        if (!b && !c) continue;
        let ux = e.dx || 0, uy = e.dy || 0;
        if (!ux && !uy) { ux = e.who.x - P.x; uy = e.who.y - P.y; const l = hypot2(ux, uy) || 1; ux /= l; uy /= l; }
        const by = e.by === 'melee' ? 'melee' : 'blast';
        if (b) shatter(b, by, ux, uy, null); else popCan(c, ux, uy, 0, by, null);
      } else if (e.type === 'bullet.ricochet') {
        stats.ricochets++;
        if (plate && e.who === plate.p) ding(e.x, e.y, e.h, .7, null, true);
      } else if (e.type === 'bullet.impact' && e.surf === 'prop' && plate && Math.abs(e.x - plate.x) < SHAPE.plate.w / 2 + .1 && Math.abs(e.y - plate.y) < .2) {
        ding(e.x, e.y, e.h, 1, null, true);   // (its edge: the solid band, not the hit chain)
      }
    }
    for (const c of cans) stepCan(c, dt);
    if (clear.st === 'run') { clear.t += dt; if (!atRange()) clear.st = 'off'; }
    if (allDown()) { clear.doneT += dt; if (clear.doneT > TUNE.autoReset) reset(); }
  }
  // edge: the bullet met its solid band (bullet.impact / bullet.ricochet: their own sounds carry it), not the hit chain
  function ding(x, y, h, k, a, edge) { stats.dings++; if (a) score(a); else stats.hits++; emit('trick.ding', x, y, {h, k, who: plate.p, edge}); }

  // ================================================================ hooks (the feature hands them on while the range stands)
  // the hit chain (sim/projectiles.js, before combat): a bottle breaks and lets the shot on (glass: 'pass'); a can is
  // popped (a bullet stops in it, an arrow flies on through)
  function onArrowHit(a, p) {
    if (plate && p === plate.p) { ding(a.x, a.y, a.h, 1, a, false); return 'stop'; }   // (rung: the bullet stops on the steel)
    const b = bottleOf(p);
    if (b) { const l = hypot2(a.vx, a.vy) || 1; shatter(b, a.kind === 'bullet' ? 'bullet' : 'arrow', a.vx / l, a.vy / l, a); return 'pass'; }
    const c = canOf(p);
    if (!c) return undefined;
    const l = hypot2(a.vx, a.vy) || 1, ux = a.vx / l, uy = a.vy / l, off = (p.x - a.x) * -uy + (p.y - a.y) * ux;   // + = its middle is to the shot's left
    popCan(c, ux, uy, clamp(off, -.2, .2), a.kind === 'bullet' ? 'bullet' : 'arrow', a);
    return a.kind === 'bullet' ? 'stop' : 'pierce';
  }
  // every shot as it is fired (sim/projectiles.js spawn): at the range it counts, and the first after a reset starts the clock
  function arrow(a) {
    if (a.extra || a.ab === 'rain' || !atRange()) return;
    stats.shots++;
    if (clear.st === 'ready' && upCount() === bottles.length && onMark()) { clear.st = 'run'; clear.t = 0; clear.shots = 0; }
    if (clear.st === 'run') clear.shots++;
  }
  // the aim assist (a gun only: the lead is a bullet's): the cursor near a can in the air aims at where it will be when the
  // bullet gets there (it is hit-tested against the can as each sim step leaves it)
  const AT = {x: 0, y: 0, h: 0, target: null};
  function aimTarget() {
    const w = host.weapon; if (!assist || !w || w.kind !== 'gun') return null;
    const G = host.G, z = host.zoom || 1, mx = host.VW / 2 + (host.mouse.x - host.VW / 2) * z, my = host.VH / 2 + (host.mouse.y - host.VH / 2) * z;
    let best = null, bd = TUNE.aimPx * z;
    for (const c of cans) {
      if (c.st !== 'air' || c.p.gone) continue;
      G.toScreenInto(c.x, c.c, c.y, SC);
      const d = hypot2(SC[0] - mx, SC[1] - my); if (d < bd) { bd = d; best = c; }
    }
    if (!best) return null;
    const c = best, step = w.speed / 60;   // (a bullet's metres a step; it meets the can after the steps it takes to get there)
    let x = c.x, y = c.y, h = c.c;
    for (let k = 0; k < 2; k++) {
      const n = Math.floor(hypot3(x - P.x, y - P.y, h - P.z - 1.2) / step), t = n / 60;
      x = c.x + c.vx * t; y = c.y + c.vy * t; h = c.c + c.vh * t - TUNE.g * t * (t + 1 / 60) / 2;
    }
    AT.x = x; AT.y = y; AT.h = h; AT.target = c.p;
    return AT;
  }
  function interact(p) {
    if (p === crate) { want.toss++; return true; }
    if (p === fence) { want.reset = true; return true; }
    return false;
  }
  const PR_TOSS = {text: 'E  toss a can', color: '#f2d27a'}, PR_RESET = {text: 'E  set the bottles up', color: '#f2d27a'};
  function prompt(p) { return p === crate ? PR_TOSS : p === fence ? PR_RESET : null; }

  return {
    build, teardown, update, onArrowHit, arrow, aimTarget, interact, prompt,
    want(k) { if (k === 'toss') want.toss = Math.min(3, want.toss + 1); else if (k === 'reset') want.reset = true; },
    near: atRange, onMark, A, bottles, cans, stats, rec, clear,
    get plate() { return plate; }, get active() { return active; },
    get assist() { return assist; }, set assist(v) { assist = !!v; },   // the aim assist on the cans (the Dev tab's setting)
    up: upCount,
  };
}
