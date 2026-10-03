// EQUIPMENT SIM: the truth of the equipment experiment (features/equip.js is the feature). The slot (which gadget you
// carry and its cooldown), the throw (F held: aiming, the view shows where it lands; let go: it flies to the cursor's
// ground point), every gadget out in the world and what it does, the pickups and a run's cache. Fixed 1/60 s steps
// (core/loop.js); every random draw from this module's own generator (core/rng.js, seeded from the clock, never
// Math.random); nothing read back from presentation: with ?views=0 it plays the same (tools/test/simview.mjs).
//   fire flask   bursts on the ground or the first body: a pool of burning oil (damage over time, an afterburn, wood in
//                it catches through lights.js's own fire); in the stream it fizzles
//   dynamite     bounces, rolls, blows up `fuse` s after the throw through combat's explode (crates break, props are
//                thrown, kegs chain, every 'combat.explode' reaction); wood the blast left standing may catch
//   bear trap    lands open, arms, bites the first enemy that steps in (combat's root API: held where it stands)
//   scarecrow    planted where it lands (an entity: enemies can't stand in it); every enemy near it goes for it instead of
//                you (a lure on the game's nav: world/nav.js addLure) and whacks it till it falls apart
//   smoke bomb   a cloud: you inside (and a moment after) run faster (a host.mods note) and the enemies have lost you;
//                an enemy inside is lost too: they wander (the same lure)
//   grapple      the hook flies straight to an enemy / a solid prop / the ground under the cursor, bites, and pulls you
//                there (the player's own knock, re-applied each step); an enemy at the end takes a flying kick
// THE RUN (game/game.js's mode, phase, run): every stage a cache stands by the spawn ring with a gadget you can buy (combat's
// gold); a chest now and then holds one; taking one drops the one you had at your feet (its cooldown keeps running there).
// OWNS: the slot + cooldown, the aim, the throws in the air, the pools, traps, scarecrows (entities it adds: kind
//   'scarecrow'), clouds, the hook, the pickups (kind 'gadget'), the cache (kind 'gadget_cache'), the afterburn, the
//   'equip.smoke' modifier note (player.speed), its lure on the game's nav.
// READS: host.player / aim / keys / BUSY / elev / inStream / entities (near), the world's trees (treeHit), the combat
//   core (BS, gold), the game (mode, phase, run, stats, nav, ui).
// CALLS (the owners' APIs): combat core damage / explode / root / addGold; lights ignite; host.knock / play / PL.faceShot;
//   the game HUD's float / toast.
// EMITS: equip.throw / bounce / land / shatter / puff / blast / fizzle / snap / hit / break / latch / pick (core/events.js).
// BUDGET: sim; a few things out at once, each a handful of grid queries a step (~.01-.03 ms a step measured with all six out).
import {GADGETS, GADGET_IDS, SHOP, THROW} from '../../content/gadgets.js';
import {mulberry32} from '../../core/rng.js';
import {clamp, hypot2, TAU} from '../../core/mathx.js';
import {PROP_TOP} from '../../world/world.js';

// how high a prop stops a thrown gadget (m over its base): the walls' own (world.js PROP_TOP), these, else 1
const TOP = {crate: .8, barrel: .9, barrel_x: .9, pot: .5, crystal: 1.2, dummy: 1.4, chest: .6, pillar: 2.6, pillar_broken: 1.4,
  rock: .5, rock_big: 1.1, rubble: .6, brazier: 1.1, torch: 1.7, well: .9, bench: .5, stall: 2, campfire: .15, woodpile: .4, beacon: 1.5,
  gadget_cache: .7, scarecrow: 1.5, ruin: 2, merchant: 1.6, goods: .7, bush: 0, tuft: 0, fern: 0, reed: 0};
const WATER_H = -.12;   // a gadget that sinks in the stream sits this far under the bank

export function createEquipSim(host) {
  const ents = host.entities, P = host.player, events = host.events;
  const R = mulberry32(((Date.now() % 2147483646) + 1) ^ 0x51ed1e), RR = (a, b) => a + R() * (b - a);
  let combat = null, game = null, lights = null, lureOff = null;
  const core = () => (combat ??= host.feature('combat'))?.core || null;
  const gameF = () => game ??= host.feature('game');
  const lightsF = () => lights ??= host.feature('lights');

  // ---------------------------------------------------------------- state
  const S = {
    on: false, slot: null,          // slot: {id, cd} the gadget you carry and the seconds left on its cooldown
    aiming: false, aimT: 0, queued: 0, deny: 0, ready: 0, cast: 0, simT: 0, fUp: false,   // fUp: F's keyup came (the feature's listener)
    inSmoke: false, smokeT: 0, speedOn: false,
    mode: '', run: null, stage: -1, cacheDue: false, start: null,   // start: the gadget a run / the sandbox begins with (the flag)
    aim: {x: 0, y: 0, z: 0, d: 0, who: null, prop: null, ax: 0, ay: 0, ah: 0, stop: 0, ground: true},   // where a throw would land (filled while aiming)
  };
  const air = [];      // thrown, in the air / bouncing / rolling: {id, x, y, h, vx, vy, vh, t, fuse, rest, spin, ...}
  const pools = [];    // fire: {x, y, z, r, t, dur, tick, lit: [props set alight]}
  const traps = [];    // {x, y, z, t, state: set | armed | shut | spent, who, hold, gone}
  const crows = [];    // scarecrows: {p (the entity), x, y, z, t, dur, hp, hp0, dead, hitT, sway}
  const clouds = [];   // smoke: {x, y, z, r, t, dur}
  const drops = [];    // pickups on the ground: {p (the entity), id, cd, t}
  let cache = null;    // this stage's: {p, id, cost, spent, t}
  let hook = null;     // {phase: fly | pull | back, x, y, h, ax, ay, ah, who, prop, t, stop, flown, lx, ly, stall}
  const burning = new Map();   // an enemy alight after the fire: -> {t (s left), tick}
  const wander = new Map();    // an enemy that has lost you: -> {x, y, until}
  const airWas = new Map();    // an enemy near a scarecrow: was it in the air last step (a hop that lands next to it whacks it)
  const lured = new Map();     // an enemy the lure has: -> {why: 'crow' | 'lost', t (when it began: S.simT)} (the view's marks)
  const nearA = [], nearB = [], nearC = [], WAY = {x: 0, y: 0, stop: 0};

  // ---------------------------------------------------------------- helpers
  const water = (x, y, g) => g === 0 && host.inStream(x, y);
  const creature = p => !!(p.hunter || p.sparring) && !p.broken && !p.gone && !p.retired;
  function dmgK() {   // a run's damage stat and its stage scale every gadget's damage (the sandbox: 1)
    const g = gameF(); if (g?.mode !== 'run' || !g.run) return 1;
    return (g.stats?.S.dmg ?? 1) * (1 + .4 * g.run.stage);
  }
  // the first body (an enemy, a sparring brute, a gunman) within rad m of (x, y) at height h
  function creatureAt(x, y, h, rad) {
    for (const p of ents.near(x, y, rad + .6, nearB)) {
      if (!creature(p)) continue;
      const rel = h - (p.z || 0) - (p.h || 0);
      if (rel < -.1 || rel > (p.hitH ?? 1.6)) continue;
      if (hypot2(p.x - x, p.y - y) < (p.hitR ?? .45) + rad) return p;
    }
    return null;
  }
  // a solid prop (round collider or a wall's rect) at (x, y, h) within rad; trees by their trunk (world.treeHit) along the
  // segment from (x0, y0, h0)
  function solidAt(x0, y0, h0, x, y, h, rad, skip) {
    let tree = false;
    for (const p of ents.near(x, y, rad + .8, nearA)) {
      if (p === skip || p.broken || p.gone || p.outside || creature(p) || p.kind === 'gadget') continue;
      if (p.kind === 'tree') { tree = true; continue; }
      if (!(p.rect || p.r > .2)) continue;
      const z0 = p.z || 0, top = z0 + (PROP_TOP[p.kind] ?? TOP[p.kind] ?? 1);
      if (h < z0 - .05 || h > top) continue;
      if (p.rect ? x > p.rect[0] - rad && x < p.rect[2] + rad && y > p.rect[1] - rad && y < p.rect[3] + rad : hypot2(p.x - x, p.y - y) < p.r + rad) return p;
    }
    if (tree) { const q = host.world.treeHit?.(x0, y0, h0, x, y, h); if (q) return q.prop; }
    return null;
  }
  // bounce a flying / rolling thing (o: x, y, vx, vy) off a prop: the normal from its centre, or a rect's nearest face
  function reflect(o, p, k) {
    let nx, ny;
    if (p.rect) {
      const R4 = p.rect, dl = o.x - R4[0], dr = R4[2] - o.x, dt = o.y - R4[1], db = R4[3] - o.y, m = Math.min(dl, dr, dt, db);
      nx = m === dl ? -1 : m === dr ? 1 : 0; ny = nx ? 0 : m === dt ? -1 : 1;
    } else { const d = hypot2(o.x - p.x, o.y - p.y) || 1; nx = (o.x - p.x) / d; ny = (o.y - p.y) / d; }
    const vn = o.vx * nx + o.vy * ny;
    if (vn < 0) { o.vx -= (1 + k) * vn * nx; o.vy -= (1 + k) * vn * ny; }
    o.vx *= .8; o.vy *= .8;
    return -vn;
  }
  // face the throw and play a short throw pose (the player's own: a held frame; skipped mid-dodge, and while a shot is being
  // drawn: a throw doesn't cost you the arrow on the string)
  function pose(dx, dy) {
    if (P.state === 'draw') return;
    const a = host.yaw, c = Math.cos(a), s = Math.sin(a), l = hypot2(dx, dy) || 1;
    host.PL.faceShot?.((dx * c - dy * s) / l, (dx * s + dy * c) / l);
    if (!host.BUSY.has(P.state)) host.play('lunge', .2);
  }
  function hurt(p, dmg, quiet, dir) { const c = core(); if (c && !p.broken) c.damage(p, dmg, quiet ? QUIET : {canCrit: true, dir}); }
  const QUIET = {quiet: true};

  // ---------------------------------------------------------------- aiming: where it would land
  function target(G, A) {
    const a = host.aim();
    // the ground under the cursor: host.aim reads the cursor as a point at chest height (the bow's aim) unless it is over a
    // target; the ground there is that much further up the screen (along the camera's view, away from it)
    let gx = a.x, gy = a.y;
    if (!a.target) { const k = (a.h - host.elev(a.x, a.y)) * host.PPMH / host.PPMY; gx -= Math.sin(host.yaw) * k; gy -= Math.cos(host.yaw) * k; }
    let dx = gx - P.x, dy = gy - P.y, d = hypot2(dx, dy);
    if (d < .05) { const f = P.faceAngle; dx = Math.sin(f); dy = Math.cos(f); d = 1; } else { dx /= d; dy /= d; }
    d = clamp(d, THROW.minD, G.range);
    A.x = P.x + dx * d; A.y = P.y + dy * d; A.d = d; A.z = host.elev(A.x, A.y);
    A.who = null; A.prop = null; A.ground = true; A.ax = A.x; A.ay = A.y; A.ah = A.z + .05; A.stop = G.stop ?? 0;
    if (G !== GADGETS.grapple) return A;
    // the hook: an enemy under the cursor, else the nearest solid within `snap` m of the aim point (its centre), else the ground
    const t = a.target;
    if (t && creature(t) && hypot2(t.x - P.x, t.y - P.y) < G.range + .5) {
      A.who = t; A.ground = false; A.ax = t.x; A.ay = t.y; A.ah = (t.z || 0) + (t.h || 0) + .9; A.stop = (t.hitR ?? .45) + G.stop; return A;
    }
    let best = null, bd = G.snap;
    for (const p of ents.near(gx, gy, G.snap + 1, nearA)) {
      if (p.broken || p.gone || p.outside || creature(p) || p.kind === 'gadget' || p.kind === 'scarecrow' || !(p.rect || p.r > .2)) continue;
      if ((PROP_TOP[p.kind] ?? TOP[p.kind] ?? 1) < .3) continue;
      const e = p.rect ? hypot2(clamp(gx, p.rect[0], p.rect[2]) - gx, clamp(gy, p.rect[1], p.rect[3]) - gy) : Math.max(0, hypot2(p.x - gx, p.y - gy) - p.r);
      if (e < bd) { bd = e; best = p; }
    }
    if (best) {
      const px = best.rect ? clamp(gx, best.rect[0], best.rect[2]) : best.x, py = best.rect ? clamp(gy, best.rect[1], best.rect[3]) : best.y;
      if (hypot2(px - P.x, py - P.y) < G.range + 1) {
        A.prop = best; A.ground = false; A.ax = px; A.ay = py; A.ah = (best.z || 0) + Math.min(1.2, (PROP_TOP[best.kind] ?? TOP[best.kind] ?? 1) * .7);
        A.stop = (best.rect ? 0 : best.r) + G.stop + .25; A.x = px; A.y = py; A.d = hypot2(px - P.x, py - P.y);
      }
    }
    return A;
  }

  // ---------------------------------------------------------------- the throw
  function press() {
    if (!S.on || host.lock) return;
    const sl = S.slot;
    if (!sl || sl.cd > 0 || hook) { S.deny = .3; return; }
    S.aiming = true; S.aimT = 0; S.fUp = false;
  }
  function release() {
    const sl = S.slot, G = GADGETS[sl.id], A = target(G, S.aim);
    pose(A.x - P.x, A.y - P.y);
    if (sl.id === 'grapple') launchHook(G, A); else launch(sl.id, G, A);
    sl.cd = G.cd; S.cast = .9; S.aiming = false; S.queued = 0;
  }
  function launch(id, G, A) {
    const ux = (A.x - P.x) / (A.d || 1), uy = (A.y - P.y) / (A.d || 1);
    const o = {id, x: P.x + ux * .3, y: P.y + uy * .3, h: P.z + THROW.hand, vx: 0, vy: 0, vh: 0, t: 0, fuse: G.fuse || 0,
      rest: false, settled: false, spin: (R() < .5 ? -1 : 1) * RR(8, 13), bounces: 0, done: false, wet: false, last: null, stuck: 0, lx: 0, ly: 0, lh: 0};
    // a bouncer's first landing falls short of the mark (G.lead of the way), so it bounces and rolls on to about there
    const k = G.lead ?? 1, tx = P.x + (A.x - P.x) * k, ty = P.y + (A.y - P.y) * k, tz = k < 1 ? host.elev(tx, ty) : A.z;
    const t = clamp(THROW.t0 + A.d * k * THROW.tk, THROW.t0, THROW.tMax);
    o.vx = (tx - o.x) / t; o.vy = (ty - o.y) / t; o.vh = (tz + .05 - o.h) / t + .5 * THROW.g * t;
    o.lx = o.x; o.ly = o.y; o.lh = o.h;
    air.push(o);
    events.push({type: 'equip.throw', x: o.x, y: o.y, h: o.h, gadget: id});
  }

  // ---------------------------------------------------------------- in the air
  function stepAir(o, dt) {
    o.t += dt; o.lx = o.x; o.ly = o.y; o.lh = o.h;
    if (o.fuse) { o.fuse -= dt; if (o.fuse <= 0) { blow(o); return; } }
    if (o.rest) { roll(o, dt); return; }
    if (o.t > 4) { fall(o, -1e9); if (!o.done && !o.rest) o.done = true; return; }   // (a safety: nothing stays up for long)
    const sp = Math.abs(o.vx) + Math.abs(o.vy) + Math.abs(o.vh), n = Math.max(1, Math.ceil(sp * dt / .18)), ds = dt / n;
    for (let i = 0; i < n && !o.done && !o.rest; i++) sub(o, ds);
  }
  function sub(o, ds) {
    const nx = o.x + o.vx * ds, ny = o.y + o.vy * ds, nh = o.h + o.vh * ds;
    o.vh -= THROW.g * ds;
    // a body in the way: the flask and the smoke bomb burst on it, the rest glance off (a knock on the head) and fall on
    const who = creatureAt(nx, ny, nh, .1);
    if (who && o.last !== who) {   // (once per body: then it falls on past it)
      if (o.id === 'flask' || o.id === 'smoke') { o.x = nx; o.y = ny; o.h = nh; burst(o, who); return; }
      o.last = who; const v = reflect(o, who, .3); hurt(who, 3, true); events.push({type: 'equip.bounce', x: o.x, y: o.y, gadget: o.id, speed: v});
      fall(o, nh); return;
    }
    // a prop, a wall, a trunk, a cliff's face (higher ground it hasn't cleared): the flask and the smoke bomb burst on it, the
    // rest bounce off and fall on (a thing that keeps meeting the same solid without getting out of it goes through)
    const g0 = host.elev(o.x, o.y), g1 = host.elev(nx, ny);
    const p = o.stuck > 4 ? null : solidAt(o.x, o.y, o.h, nx, ny, nh, .08, null);
    if (p || (g1 > nh && g1 > g0)) {
      if (o.id === 'flask' || o.id === 'smoke') { burst(o, null); return; }
      o.stuck++;
      const v = p ? reflect(o, p, .45) : cliff(o);
      if (v > 1.2) events.push({type: 'equip.bounce', x: o.x, y: o.y, gadget: o.id, speed: v});
      fall(o, nh); return;
    }
    o.stuck = 0;
    if (nh <= g1) {   // the ground
      o.x = nx; o.y = ny; o.h = g1;
      if (water(nx, ny, g1)) { wet(o); return; }
      land(o, -o.vh);
      return;
    }
    o.x = nx; o.y = ny; o.h = nh;
  }
  // blocked sideways, it still falls where it is
  function fall(o, nh) {
    const g = host.elev(o.x, o.y);
    if (nh > g) { o.h = nh; return; }
    o.h = g;
    if (water(o.x, o.y, g)) wet(o); else land(o, -o.vh);
  }
  function cliff(o) {   // ran into higher ground: back off it, the way it came
    const v = hypot2(o.vx, o.vy); o.vx *= -.45; o.vy *= -.45; return v;
  }
  // it reaches the ground with downward speed v
  function land(o, v) {
    const G = GADGETS[o.id];
    if (o.id === 'flask' || o.id === 'smoke') { burst(o, null); return; }
    if (o.id === 'dynamite') {
      if (v > 2.4) { o.vh = v * G.bounce; o.vx *= G.keep; o.vy *= G.keep; o.bounces++; events.push({type: 'equip.bounce', x: o.x, y: o.y, gadget: o.id, speed: v}); return; }
      o.rest = true; o.vh = 0; return;   // rolling
    }
    if (o.id === 'beartrap') {
      if (v > 3 && !o.bounces) { o.vh = v * .22; o.vx *= .35; o.vy *= .35; o.bounces++; events.push({type: 'equip.bounce', x: o.x, y: o.y, gadget: o.id, speed: v}); return; }
      o.done = true; setTrap(o.x, o.y, o.h); return;
    }
    if (o.id === 'scarecrow') { o.done = true; plant(o.x, o.y, o.h); }
  }
  // on the ground, rolling (dynamite): friction, props, bodies, ledges, the stream
  function roll(o, dt) {
    const G = GADGETS[o.id], sp = hypot2(o.vx, o.vy);
    if (sp < .05) { o.vx = o.vy = 0; if (!o.settled) { o.settled = true; events.push({type: 'equip.land', x: o.x, y: o.y, gadget: o.id}); } return; }
    const k = Math.max(0, sp - G.roll * dt) / sp; o.vx *= k; o.vy *= k;
    const nx = o.x + o.vx * dt, ny = o.y + o.vy * dt, g1 = host.elev(nx, ny);
    const p = solidAt(o.x, o.y, o.h + .1, nx, ny, o.h + .1, .08, null) || creatureAt(nx, ny, o.h + .1, .08);
    if (p) { const v = reflect(o, p, .4); if (v > 1) events.push({type: 'equip.bounce', x: o.x, y: o.y, gadget: o.id, speed: v}); return; }
    if (g1 > o.h + .05) { cliff(o); return; }
    o.x = nx; o.y = ny;
    if (g1 < o.h - .05) { o.rest = false; o.settled = false; o.vh = 0; return; }   // off a ledge: falling again
    if (water(nx, ny, g1)) wet(o);
  }
  // into the stream: the flask fizzles out, the trap sinks, dynamite sinks and blows under water, the rest work there
  function wet(o) {
    o.wet = true; o.h = WATER_H;
    if (o.id === 'smoke') { burst(o, null); return; }
    if (o.id === 'scarecrow') { o.done = true; plant(o.x, o.y, 0); return; }
    if (o.id === 'dynamite') { o.rest = true; o.settled = true; o.vx = o.vy = 0; events.push({type: 'equip.fizzle', x: o.x, y: o.y, gadget: o.id, sunk: true}); return; }
    o.done = true; events.push({type: 'equip.fizzle', x: o.x, y: o.y, gadget: o.id, sunk: o.id !== 'flask'});
  }
  // the flask breaks (a pool of fire), the smoke bomb pops (a cloud); `who`: the body it broke on
  function burst(o, who) {
    o.done = true;
    const G = GADGETS[o.id], x = who ? who.x : o.x, y = who ? who.y : o.y, z = host.elev(x, y);
    if (o.id === 'smoke') {
      clouds.push({x, y, z: Math.max(0, z), r: G.r, t: 0, dur: G.dur});
      events.push({type: 'equip.puff', x, y, z, h: o.h, r: G.r});
      return;
    }
    if (water(x, y, z)) { events.push({type: 'equip.fizzle', x, y, gadget: o.id, sunk: false}); return; }
    pools.push({x, y, z, r: G.r, t: 0, dur: G.dur, tick: 0, lit: []});
    events.push({type: 'equip.shatter', x, y, z, h: Math.max(z + .1, o.h)});
    // the splash: whoever it broke on and everyone close by
    const k = dmgK();
    if (who) hurt(who, G.splash * k, false, null);
    for (const p of ents.near(x, y, G.r * .6 + .5, nearC)) if (p !== who && creature(p) && Math.abs((p.z || 0) - z) < .8 && hypot2(p.x - x, p.y - y) < G.r * .6 + (p.hitR ?? .3)) hurt(p, G.splash * .6 * k, true);
  }
  // dynamite: combat's explosion where it is
  function blow(o) {
    o.done = true;
    const G = GADGETS.dynamite, c = core(); if (!c) return;
    const g = host.elev(o.x, o.y), z = o.h - g < 1.2 ? g : o.h - .3;
    events.push({type: 'equip.blast', x: o.x, y: o.y, z, wet: o.wet});
    c.explode(o.x, o.y, z, G.r, G.dmg * dmgK(), false);
    const L = lightsF();
    if (L?.ignite && !o.wet) for (const p of ents.near(o.x, o.y, G.r * .55, nearA)) if (!p.broken && !p.gone && !creature(p) && hypot2(p.x - o.x, p.y - o.y) < G.r * .55 && R() < G.ignite) L.ignite(p);
  }

  // ---------------------------------------------------------------- what lies on the ground
  function stepPools(dt) {
    const k = dmgK(), L = lightsF();
    for (let i = pools.length - 1; i >= 0; i--) {
      const q = pools[i], G = GADGETS.flask; q.t += dt;
      if (q.t >= q.dur) { pools.splice(i, 1); continue; }
      q.tick -= dt; if (q.tick > 0) continue;
      q.tick = G.tick;
      const r = q.r * (q.t > q.dur - 1 ? Math.max(.3, q.dur - q.t) : 1);   // (the last second it shrinks)
      for (const p of ents.near(q.x, q.y, r + .6, nearC)) {
        if (p.broken || p.gone) continue;
        const d = hypot2(p.x - q.x, p.y - q.y);
        if (creature(p)) {
          if (d > r + (p.hitR ?? .3) * .6 || Math.abs((p.z || 0) - q.z) > .6 || (p.h || 0) > 1.1) continue;
          hurt(p, G.dps * G.tick * k, true);
          const b = burning.get(p); if (b) b.t = G.after; else burning.set(p, {t: G.after, tick: .5});
        } else if (L?.ignite && d < r + (p.r || 0) && q.lit.indexOf(p) < 0) { q.lit.push(p); L.ignite(p); }
      }
    }
    // the afterburn: enemies that came out of the fire burn on a little
    for (const [p, b] of burning) {
      if (p.broken || p.gone || p.dead) { burning.delete(p); continue; }
      b.t -= dt; b.tick -= dt;
      if (b.tick <= 0) { b.tick = .5; hurt(p, GADGETS.flask.afterDps * .5 * k, true); }
      if (b.t <= 0) burning.delete(p);
    }
  }
  function setTrap(x, y, z) { traps.push({x, y, z, t: 0, state: 'set', who: null, hold: 0, gone: 0}); events.push({type: 'equip.land', x, y, gadget: 'beartrap'}); }
  function stepTraps(dt) {
    const G = GADGETS.beartrap, c = core();
    for (let i = traps.length - 1; i >= 0; i--) {
      const q = traps[i]; q.t += dt;
      if (q.state === 'set' && q.t >= G.arm) q.state = 'armed';
      if (q.state === 'armed') {
        if (q.t > G.life) { q.state = 'spent'; events.push({type: 'equip.break', x: q.x, y: q.y, gadget: 'beartrap'}); continue; }
        for (const p of ents.near(q.x, q.y, G.trig + .6, nearC)) {
          if (!creature(p) || (p.h || 0) > .35 || Math.abs((p.z || 0) - q.z) > .5) continue;
          if (hypot2(p.x - q.x, p.y - q.y) > G.trig + (p.hitR ?? .3) * .5) continue;
          // snap: a hard bite, and it holds (combat's root: a brute; a gunman just takes the bite)
          const root = p.boss ? G.rootBoss : p.elite ? G.rootElite : G.root;
          hurt(p, G.dmg * dmgK(), false, null);
          const held = !p.broken && c?.root ? c.root(p, root) : false;
          q.state = 'shut'; q.who = p; q.hold = (held ? root : 0) + G.hold; q.x = p.x; q.y = p.y;
          events.push({type: 'equip.snap', x: q.x, y: q.y, who: p});
          break;
        }
      } else if (q.state === 'shut') {
        q.hold -= dt;
        if (q.hold <= 0 || (q.who && q.who.gone && !q.who.broken)) { q.state = 'spent'; q.who = null; }
      } else if (q.state === 'spent' && (q.gone += dt) > 1.2) traps.splice(i, 1);
    }
  }
  function plant(x, y, z) {
    const G = GADGETS.scarecrow;
    const p = {kind: 'scarecrow', x, y, z: Math.max(0, z), h: 0, r: .28};
    ents.add(p);
    crows.push({p, x, y, z: p.z, t: 0, dur: G.dur, hp: G.hp, hp0: G.hp, dead: false, deadT: 0, hitT: -9});
    events.push({type: 'equip.land', x, y, gadget: 'scarecrow'});
  }
  function stepCrows(dt) {
    const G = GADGETS.scarecrow, BS = core()?.BS;
    for (let i = crows.length - 1; i >= 0; i--) {
      const c = crows[i]; c.t += dt;
      if (c.dead) { if ((c.deadT += dt) > 1.2) crows.splice(i, 1); continue; }
      // a hop that lands next to it whacks it (the enemy's own damage)
      for (const p of ents.near(c.x, c.y, G.reach + .8, nearC)) {
        if (!creature(p) || !BS?.has(p)) continue;
        const was = airWas.get(p); airWas.set(p, !!p.air);
        if (was && !p.air && hypot2(p.x - c.x, p.y - c.y) < G.reach + (p.hitR ?? .3)) {
          c.hp -= (p.dmg ?? 10) * (p.boss ? 2 : 1); c.hitT = c.t;
          events.push({type: 'equip.hit', x: c.x, y: c.y, gadget: 'scarecrow', who: p});
        }
      }
      if (c.hp <= 0 || c.t >= c.dur) {
        c.dead = true; c.deadT = 0; ents.remove(c.p);
        events.push({type: 'equip.break', x: c.x, y: c.y, gadget: 'scarecrow'});
      }
    }
    if (!crows.length && airWas.size) airWas.clear();
  }
  const cloudR = c => { const G = GADGETS.smoke; return c.r * (c.t < G.grow ? .45 + .55 * c.t / G.grow : c.t > c.dur - G.fade ? 1 - .35 * (c.t - (c.dur - G.fade)) / G.fade : 1); };
  function inCloud(x, y, z) {
    for (let i = 0; i < clouds.length; i++) { const c = clouds[i]; if (Math.abs(z - c.z) < 1.6 && hypot2(x - c.x, y - c.y) < cloudR(c)) return true; }
    return false;
  }
  function stepClouds(dt) {
    const G = GADGETS.smoke;
    for (let i = clouds.length - 1; i >= 0; i--) if ((clouds[i].t += dt) >= clouds[i].dur) clouds.splice(i, 1);
    S.inSmoke = clouds.length > 0 && inCloud(P.x, P.y, P.z);
    S.smokeT = S.inSmoke ? G.linger : Math.max(0, S.smokeT - dt);
    const fast = S.smokeT > 0;
    if (fast !== S.speedOn) { S.speedOn = fast; if (fast) host.mods.set('equip.smoke', [{stat: 'player.speed', mul: G.speed}]); else host.mods.clear('equip.smoke'); }
    if (!clouds.length && wander.size) wander.clear();
    if (lured.size && !clouds.length && !crows.length) lured.clear();
    for (const [b] of lured) if (b.broken || b.gone) lured.delete(b);
  }
  // THE LURE (world/nav.js addLure: asked before the game's own steering, for each enemy as it picks its next hop): an
  // enemy that has lost you in the smoke wanders; one near a scarecrow goes for it
  function lure(b) {
    if (!S.on) return null;
    if (clouds.length && (S.smokeT > 0 || inCloud(b.x, b.y, b.z || 0))) {
      const G = GADGETS.smoke;
      let w = wander.get(b); if (!w) wander.set(b, w = {x: b.x, y: b.y, until: -1});
      if (S.simT >= w.until || hypot2(w.x - b.x, w.y - b.y) < .5) {
        const a = R() * TAU, d = RR(G.wander[0], G.wander[1]);
        w.x = b.x + Math.sin(a) * d; w.y = b.y + Math.cos(a) * d; w.until = S.simT + RR(G.every[0], G.every[1]);
      }
      mark(b, 'lost');
      WAY.x = w.x; WAY.y = w.y; WAY.stop = 0; return WAY;
    }
    let best = null, bd = GADGETS.scarecrow.lure;
    for (let i = 0; i < crows.length; i++) { const c = crows[i]; if (c.dead) continue; const d = hypot2(c.x - b.x, c.y - b.y); if (d < bd) { bd = d; best = c; } }
    if (!best) { if (lured.size) lured.delete(b); return null; }
    mark(b, 'crow');
    WAY.x = best.x; WAY.y = best.y; WAY.stop = GADGETS.scarecrow.stop; return WAY;
  }
  function mark(b, why) { const m = lured.get(b); if (!m) lured.set(b, {why, t: S.simT}); else if (m.why !== why) { m.why = why; m.t = S.simT; } }

  // ---------------------------------------------------------------- the grappling hook
  function launchHook(G, A) {
    const ux = (A.ax - P.x) / (hypot2(A.ax - P.x, A.ay - P.y) || 1), uy = (A.ay - P.y) / (hypot2(A.ax - P.x, A.ay - P.y) || 1);
    hook = {phase: 'fly', x: P.x + ux * .3, y: P.y + uy * .3, h: P.z + 1.2, ax: A.ax, ay: A.ay, ah: A.ah, who: A.who, prop: A.prop,
      ground: A.ground, t: 0, stop: A.stop, flown: 0, lx: 0, ly: 0, lh: 0, stall: 0, px: P.x, py: P.y};
    hook.lx = hook.x; hook.ly = hook.y; hook.lh = hook.h;
    events.push({type: 'equip.throw', x: hook.x, y: hook.y, h: hook.h, gadget: 'grapple'});
  }
  function latch(H, who, prop) {
    H.phase = 'pull'; H.t = 0; H.stall = 0; H.px = P.x; H.py = P.y;
    if (who) { H.who = who; H.prop = null; H.stop = (who.hitR ?? .45) + GADGETS.grapple.stop; }
    else if (prop) { H.prop = prop; H.who = null; H.ax = H.x; H.ay = H.y; H.ah = H.h; H.stop = GADGETS.grapple.stop + .2; }
    else { H.ax = H.x; H.ay = H.y; H.stop = .35; }
    events.push({type: 'equip.latch', x: H.x, y: H.y, h: H.h, who: H.who, prop: H.prop});
    pose(H.x - P.x, H.y - P.y);
  }
  function stepHook(dt) {
    const H = hook, G = GADGETS.grapple; H.t += dt; H.lx = H.x; H.ly = H.y; H.lh = H.h;
    if (host.lock || P.state === 'climb' || P.state === 'splash') { H.phase = 'back'; }
    if (H.phase === 'fly') {
      if (H.who && !H.who.broken) { H.ax = H.who.x; H.ay = H.who.y; H.ah = (H.who.z || 0) + (H.who.h || 0) + .9; }
      const dx = H.ax - H.x, dy = H.ay - H.y, dh = H.ah - H.h, d = Math.sqrt(dx * dx + dy * dy + dh * dh), step = G.speed * dt;
      const n = Math.max(1, Math.ceil(Math.min(step, d) / .2));
      for (let i = 1; i <= n; i++) {
        const k = Math.min(step, d) * i / n / (d || 1), x = H.x + dx * k, y = H.y + dy * k, h = H.h + dh * k;
        const who = creatureAt(x, y, h, .1);
        if (who) { H.x = x; H.y = y; H.h = h; latch(H, who, null); return; }
        const p = solidAt(H.lx, H.ly, H.lh, x, y, h, .06, null);
        if (p) { H.x = x; H.y = y; H.h = h; latch(H, null, p); return; }
        if (h <= host.elev(x, y) + .02) { H.x = x; H.y = y; H.h = host.elev(x, y) + .02; if (water(x, y, host.elev(x, y))) { H.phase = 'back'; events.push({type: 'equip.fizzle', x, y, gadget: 'grapple', sunk: false}); return; } latch(H, null, null); return; }
      }
      H.flown += Math.min(step, d);
      H.x += dx * Math.min(1, step / (d || 1)); H.y += dy * Math.min(1, step / (d || 1)); H.h += dh * Math.min(1, step / (d || 1));
      if (d <= step) { H.x = H.ax; H.y = H.ay; H.h = H.ah; if (H.who) latch(H, H.who, null); else if (H.prop) latch(H, null, H.prop); else latch(H, null, null); return; }
      if (H.flown > G.range + 1.5) H.phase = 'back';
      return;
    }
    if (H.phase === 'pull') {
      const who = H.who && !H.who.broken ? H.who : null;
      if (H.who && !who) { H.who = null; H.stop = .4; }   // it died on the line: you fly on to where it stood
      const tx = who ? who.x : H.ax, ty = who ? who.y : H.ay;
      if (who) { H.x = who.x; H.y = who.y; H.h = (who.z || 0) + (who.h || 0) + .9; }
      const dx = tx - P.x, dy = ty - P.y, d = hypot2(dx, dy), left = d - H.stop;
      const moved = hypot2(P.x - H.px, P.y - H.py); H.px = P.x; H.py = P.y;
      H.stall = H.t > .1 && moved < G.pull * dt * .2 ? H.stall + 1 : 0;
      // the last stretch: a knock that dies away exactly there (the player's knock: v e^-7t for .28 s covers ~v / 8.1)
      const arrive = left <= G.pull / 8.1;
      if (arrive || H.t > G.max || H.stall > 3) {
        if (arrive && left > .02) host.knock(dx / (d || 1) * left * 8.1, dy / (d || 1) * left * 8.1);
        H.phase = arrive ? 'glide' : 'back'; H.t = 0; return;
      }
      host.knock(dx / d * G.pull, dy / d * G.pull);
      return;
    }
    if (H.phase === 'glide') {   // gliding in on the last knock; an enemy at the end takes the kick as you reach it
      const who = H.who && !H.who.broken ? H.who : null;
      if (who) { H.x = who.x; H.y = who.y; H.h = (who.z || 0) + (who.h || 0) + .9; }
      if (who) {
        const d = hypot2(who.x - P.x, who.y - P.y);
        if (d > H.stop + .3 && H.t <= .3) return;
        if (d < H.stop + 1) { hurt(who, G.dmg * dmgK(), false, [(who.x - P.x) / (d || 1) * 3, (who.y - P.y) / (d || 1) * 3]); host.shake(3, .16); }
      } else if (H.t <= .25) return;   // (the ground or a prop: the rope stays taut while you glide in)
      H.phase = 'back'; H.t = 0;
      return;
    }
    // back: the hook comes home to the hand
    const hx = P.x, hy = P.y, hh = P.z + 1.2, dx = hx - H.x, dy = hy - H.y, dh = hh - H.h, d = Math.sqrt(dx * dx + dy * dy + dh * dh), step = 40 * dt;
    if (d <= step + .2) { hook = null; return; }
    H.x += dx / d * step; H.y += dy / d * step; H.h += dh / d * step;
  }

  // ---------------------------------------------------------------- pickups, the cache, swapping
  function drop(id, cd, x, y) {
    const p = {kind: 'gadget', gadget: id, x, y, z: host.elev(x, y), h: 0, r: 0, interact: 'take'};
    ents.add(p);
    drops.push({p, id, cd, t: 0});
  }
  function spot(x, y, from) {   // a free spot about .8 m off (x, y), away from `from` (else round it)
    const a0 = from ? Math.atan2(x - from.x, y - from.y) : 0;
    for (let k = 0; k < 8; k++) {
      const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * .7, sx = x + Math.sin(a) * .8, sy = y + Math.cos(a) * .8;
      if (!host.blocked(sx, sy, host.elev(sx, sy)) && !water(sx, sy, host.elev(sx, sy))) { SP.x = sx; SP.y = sy; return SP; }
    }
    SP.x = x; SP.y = y; return SP;
  }
  const SP = {x: 0, y: 0};
  function take(id, cd, from, bought) {
    const old = S.slot;
    S.slot = {id, cd};
    if (old) { const s = spot(P.x, P.y, from); drop(old.id, old.cd, s.x, s.y); }
    S.aiming = false; S.ready = .3;
    events.push({type: 'equip.pick', x: P.x, y: P.y, gadget: id, bought: !!bought});
    const G = GADGETS[id]; gameF()?.ui?.toast?.(G.name, G.desc + ' · F', G.col);
  }
  const otherThan = id => { let n = 0; for (let k = 0; k < 6; k++) { const c = GADGET_IDS[(R() * GADGET_IDS.length) | 0]; if (c !== id || ++n > 4) return c; } return GADGET_IDS[0]; };
  const cost = stage => Math.round((SHOP.cost + SHOP.perStage * stage) / 5) * 5;
  function placeCache(stage) {
    const L = host.layout, ring = L.ring || L.spawn, c = core();
    const chests = c?.chests || [];
    for (let k = 0; k < 16; k++) {
      const a = 2.1 + k * .77, d = 2.7 + (k % 3) * .5, x = ring.x + Math.sin(a) * d, y = ring.y + Math.cos(a) * d;
      if (host.blocked(x, y, 0) || host.elev(x, y) !== 0 || host.inStream(x, y)) continue;
      if (hypot2(x - ring.x, y - (ring.y - 2.2)) < 1.6 || hypot2(x - P.x, y - P.y) < 1.4) continue;   // (the portal's spot, you)
      let near = false; for (const q of chests) if (hypot2(q.x - x, q.y - y) < 2) near = true;
      if (near) continue;
      const id = otherThan(S.slot?.id), p = {kind: 'gadget_cache', gadget: id, x, y, z: 0, h: 0, r: .38, interact: 'buy'};
      ents.add(p);
      cache = {p, id, cost: cost(stage), price: cost(stage) + ' gold', spent: false, t: 0};
      return;
    }
  }
  function buy() {
    const c = core(), g = gameF(); if (!cache || cache.spent || !c) return;
    if (c.gold < cache.cost) { g?.ui?.float?.(cache.p.x, cache.p.y, 1.3, `need ${cache.cost} gold`, '#e0604a'); S.deny = .3; return; }
    c.addGold(-cache.cost);
    take(cache.id, 0, cache.p, true);
    // the cache stands on, open and empty (a new entity: no interact, so no prompt)
    const old = cache.p, p = {kind: 'gadget_cache', gadget: '', x: old.x, y: old.y, z: old.z, h: 0, r: .38};
    ents.remove(old); ents.add(p); cache.p = p; cache.spent = true; cache.t = 0;
  }
  function stepDrops(dt) {
    for (let i = 0; i < drops.length; i++) { const d = drops[i]; d.t += dt; if (d.cd > 0) d.cd = Math.max(0, d.cd - dt); }
    if (cache) cache.t += dt;
  }

  // ---------------------------------------------------------------- the game's state: runs, stages, the sandbox
  function watchGame(evs) {
    const g = gameF(); if (!g) return;
    if (g.mode !== S.mode) {
      const was = S.mode; S.mode = g.mode;
      if (was) clearWorld();
      if (g.mode === 'sandbox' && !S.slot) S.slot = {id: S.start || GADGET_IDS[0], cd: 0};
    }
    if (g.mode !== 'run' || !g.run) return;
    const run = g.run;
    if (run !== S.run) { S.run = run; S.stage = -1; S.slot = S.start ? {id: S.start, cd: 0} : null; clearWorld(); }
    if (run.stage !== S.stage) { S.stage = run.stage; clearWorld(); S.cacheDue = true; }
    if (S.cacheDue && g.phase !== 'travel') { S.cacheDue = false; placeCache(run.stage); }
    // a chest now and then holds a gadget: it lands beside it
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i]; if (e.type !== 'chest.open' || R() >= SHOP.chest) continue;
      const s = spot(e.x, e.y, null); drop(otherThan(S.slot?.id), 0, s.x, s.y);
    }
  }
  function clearWorld() {
    air.length = 0; pools.length = 0; traps.length = 0; clouds.length = 0;
    for (const c of crows) if (!c.dead) ents.remove(c.p);
    crows.length = 0;
    for (const d of drops) ents.remove(d.p);
    drops.length = 0;
    if (cache) { ents.remove(cache.p); cache = null; }
    hook = null; burning.clear(); wander.clear(); airWas.clear(); lured.clear();
    S.aiming = false; S.queued = 0; S.inSmoke = false; S.smokeT = 0;
    if (S.speedOn) { S.speedOn = false; host.mods.clear('equip.smoke'); }
  }

  // ---------------------------------------------------------------- the step
  function update(dt, evs) {
    if (!S.on) return;
    S.simT += dt;
    const g = gameF();
    if (!lureOff && g?.nav?.addLure) lureOff = g.nav.addLure(lure);
    watchGame(evs);
    const sl = S.slot;
    if (sl && sl.cd > 0) { sl.cd -= dt; if (sl.cd <= 0) { sl.cd = 0; S.ready = .3; } }
    S.deny = Math.max(0, S.deny - dt); S.ready = Math.max(0, S.ready - dt); S.cast = Math.max(0, S.cast - dt);
    // F held: aiming (the view shows where it lands); let go (its keyup: the menu clearing the held keys isn't a throw):
    // thrown. Mid-leap / climbing / knocked it waits (up to .5 s)
    if (S.aiming) {
      if (host.lock || !sl || sl.cd > 0) S.aiming = false;
      else {
        S.aimT += dt; target(GADGETS[sl.id], S.aim);
        if (S.fUp) { if (host.BUSY.has(P.state) && P.state !== 'hold') { S.queued += dt; if (S.queued > .5) S.aiming = false; } else release(); }
      }
    }
    for (let i = air.length - 1; i >= 0; i--) { stepAir(air[i], dt); if (air[i].done) air.splice(i, 1); }
    if (hook) stepHook(dt);
    stepPools(dt); stepTraps(dt); stepCrows(dt); stepClouds(dt); stepDrops(dt);
  }

  return {
    S, air, pools, traps, crows, clouds, drops, burning, lured, get hook() { return hook; }, get cache() { return cache; },
    cloudR, inCloud, update, press, clearWorld,
    // on / off (the feature's switch): off clears everything it put in the world and its lure and note
    setOn(on) {
      if (S.on === on) return;
      S.on = on;
      if (!on) { clearWorld(); if (lureOff) { lureOff(); lureOff = null; } S.mode = ''; S.run = null; S.stage = -1; }
    },
    give(id) { if (!GADGETS[id]) { S.slot = null; return; } const cd = S.slot?.id === id ? S.slot.cd : 0; S.slot = {id, cd}; S.aiming = false; S.ready = .3; },
    interact(p) {
      if (!S.on) return false;
      if (cache && p === cache.p && !cache.spent) { buy(); return true; }
      for (let i = 0; i < drops.length; i++) if (drops[i].p === p) { const d = drops[i]; ents.remove(p); drops.splice(i, 1); take(d.id, d.cd, d.p, false); return true; }
      return false;
    },
    prompt(p) {
      if (!S.on) return null;
      if (cache && p === cache.p && !cache.spent) { const G = GADGETS[cache.id], ok = (core()?.gold ?? 0) >= cache.cost; return {text: `E  ${G.name} · ${cache.cost} gold`, color: ok ? G.col : '#e0604a'}; }
      for (const d of drops) if (d.p === p) { const G = GADGETS[d.id]; return {text: `E  take the ${G.name}` + (S.slot ? ` (drop the ${GADGETS[S.slot.id].name})` : ''), color: G.col}; }
      return null;
    },
    // test handles: a pack of hunting brutes round (x, y) (the sandbox's menu row), the aim
    spawnPack(n, x, y) {
      const c = core(); if (!c) return 0;
      let k = 0;
      for (let i = 0; i < 40 && k < n; i++) {
        const a = i * 2.4, d = .8 + (i % 4) * .7, bx = x + Math.sin(a) * d, by = y + Math.cos(a) * d;
        if (host.blocked(bx, by, 0) || host.elev(bx, by) !== 0 || host.inStream(bx, by)) continue;
        c.spawnBrute({x: bx, y: by, hp: 40, dmg: 10, coins: [1, 2], type: 'brute', name: 'Brute', wait: .8 + k * .1}); k++;
      }
      return k;
    },
  };
}
