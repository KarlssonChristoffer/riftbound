// FAUNA (view): the forest's animals (docs/FAUNA.md). Roe deer at the forest's edges, a fox from its den under the rock, mountain
// hares on the open ground and the fell, red squirrels in the pines, a pair of ravens over the high country, capercaillie on the
// floor of the old pine woods. They live by the clock (grazing at dawn and dusk, bedded by day, the fox and the hares out at
// night, the squirrels and birds gone to roost), and they react to people: they lift their heads and watch you, let you come so
// close (closer when you creep, much less when you run), then bolt: the deer bound off flashing their white rumps (the rest of the
// herd with them), the hare zigzags, the squirrel races up the nearest trunk and keeps it between you and itself, the
// capercaillie bursts up out of the heather, the ravens lift off calling and circle. A gunshot empties the woods round you.
// WHERE they live is the plan's (world/fauna.js: a pure function of the forest's seed). WHAT they do is this file's; how they look
// is look.js (their parts are recipes: content/recipes.js, posed every frame).
// MULTIPLAYER: presentation only, like the arena's wildlife: no entity, no collider, nothing the sim reads, nothing sent. Every
// player has the same animals in the same places (the seed), and each player's own client runs them reacting to EVERY player it
// knows of (co-op's peers too), so a friend sprinting through a glade scatters the deer on your screen as well. Moment to moment
// they can differ a little between screens; if animals ever matter to play (hunting, taming), they move to the server.
// FEATURE CONTRACT (main.js): create(host) -> F: view, frame, biomeChanged, toggle, menu, dbg(). ?fauna=0 starts it off.
// OWNS: its animals' state, their meshes (look.js). READS: world/layout.js FOREST (the plan), host.player, host.world.cave (keeps out of its mouth), co-op's peers
//   (host.feature('coop').net), host.env (hour, season, snow), host.elev / inStream, world.js steep, host.entities.near (what
//   stands where), host.events (gunshots, hits, breaks: they scare).
// EMITS (core/events.js; the audio feature plays them): wildlife.wings (a raven taking off), wildlife.birds_scatter (a capercaillie's burst), wildlife.caw (the ravens),
//   wildlife.critter_dash (a bolt through the undergrowth), wildlife.howl {kind: 'fox', call: 'yips'} (the fox at night).
// BUDGET: the view ~.05 ms for ~30 animals (only those within SIM_R m of the player think; the rest wait where they are); the
//   frame: a few matrices for each animal on screen. No allocation a frame.
import {flags} from '../core/flags.js';
import {clamp, TAU} from '../core/mathx.js';
import {mulberry32} from '../core/rng.js';
import {FOREST} from '../world/layout.js';
import {steep} from '../world/world.js';
import {faunaPlan} from '../world/fauna.js';
import {createFaunaLook} from './fauna/look.js';

// ---------------------------------------------------------------- tunables
// alert / flee: m from a person (walking) at which it stops to watch / bolts; rest: x those while it is bedded (it sits tight);
// run, walk: m/s; turn: rad/s; out: the hours it is about (else it rests, or, gone: it is away up a tree / at roost)
export const TUNE = {
  SIM_R: 55,              // m from the player: animals further off wait as they are
  DRAW_R: 38,             // m: drawn within this of the player (and on screen)
  noise: {still: .55, walk: 1, run: 1.45, sprint: 2, jump: 1.6},   // x the distances by how the person moves
  shot: 38, hit: 14,      // m a gunshot / a hit or a break scares everything within
  roe: {alert: 22, flee: 12.5, rest: .55, run: 7, walk: .8, turn: 4.5, away: [24, 34], out: [[3.5, 10], [16, 23.5]], s: 1.05},
  fox: {alert: 15, flee: 7.5, rest: .45, run: 6, walk: 1.5, turn: 5, away: [18, 26], out: [[16.5, 24], [0, 8.5]], s: 1},
  hare: {alert: 9, flee: 4.5, rest: .55, run: 7.5, walk: .9, turn: 9, away: [12, 18], out: [[17, 24], [0, 9.5]], s: 1.15},
  squirrel: {alert: 10, flee: 6, rest: 1, run: 4, walk: 1.3, turn: 10, out: [[5.5, 20]], s: 1, gone: true},
  raven: {alert: 17, flee: 10, rest: 1, run: 1.6, walk: .7, turn: 4, fly: 7, out: [[5.5, 21]], s: 1.1, gone: true},
  capercaillie: {alert: 11, flee: 6.5, rest: 1, run: 1.8, walk: .5, turn: 4, fly: 10, out: [[4.5, 21.5]], s: 1.1, gone: true},
};

export const order = {after: ['wildlife']};
export async function create(host) {
  const F = {name: 'fauna', label: 'Forest animals', ambient: true, on: flags.get('fauna') !== '0', ms: 0, count: 0};
  const PLAN = faunaPlan(FOREST);
  if (!PLAN) return Object.assign(F, {on: false, dbg: () => ({off: 'no forest'})});
  const elev = (x, y) => host.elev(x, y);
  const NEAR = [];
  // the cave's mouth (world/caves.js, when the forest has one): its slot and a margin round it, and the cave's band, are no animal's
  // ground (a slot walled on three sides traps anything that flees into it)
  const CAVE_KEEP = 2.5;
  function inCave(x, y) {
    const c = host.world?.cave; if (!c) return false;
    const m = c.mouth, dx = x - m.x, dy = y - m.y, s = dx * m.ux + dy * m.uy, q = -dx * m.uy + dy * m.ux;
    return (s > -CAVE_KEEP && s < m.len + CAVE_KEEP && Math.abs(q) < m.w / 2 + CAVE_KEEP) || !!c.inBand?.(x, y);
  }
  // can a ground animal stand here: not in deep water, not up a cliff, not in a trunk, a rock or a wall
  function free(x, y) {
    if (y > -1.5 || host.inStream(x, y) || steep(x, y) || inCave(x, y)) return false;
    for (const p of host.entities.near(x, y, .8, NEAR)) {
      if (p.gone || !(p.r > .05)) continue;
      if (p.rect) { if (x > p.rect[0] - .1 && x < p.rect[2] + .1 && y > p.rect[1] - .1 && y < p.rect[3] + .1) return false; }
      else if (Math.hypot(p.x - x, p.y - y) < p.r * .7 + .12) return false;
    }
    return true;
  }
  let treesOf = null, treeList = null;
  const trees = new Map();   // fid -> the tree prop (squirrels' trees; looked up again when the world is rebuilt)
  function treeOf(fid) {
    let p = trees.get(fid); if (p && !p.gone) return p;
    if (treesOf !== host.entities) { treesOf = host.entities; treeList = treesOf.query('fauna.trees', q => typeof q.fid === 'string'); }   // live; once per registry
    p = null; for (const q of treeList) if (q.fid === fid) { p = q; break; }
    trees.set(fid, p); return p;
  }

  // ---------------------------------------------------------------- the animals
  const ANIM = PLAN.animals.map(d => {
    const R = mulberry32(d.seed), S = TUNE[d.sp], G = PLAN.groups[d.group];
    return {d, sp: d.sp, S, G, R, x: d.x, y: d.y, z: 0, h: 0, hd: R() * TAU, v: 0, st: 'idle', t: R() * 4, tx: d.x, ty: d.y,
      ph: R() * 10, gait: 0, pitch: 0, turn: 0, gp: 0, gt: 0, lie: 0, lieTo: 0, fx: 0, fy: 0, out: true, gone: false,
      tree: null, ta: 0, th: 0, flap: 0, vz: 0, tail: 0, blocked: 0, alarm: -1, seen: false};
  });
  F.animals = ANIM;
  const byGroup = new Map(); for (const a of ANIM) { let l = byGroup.get(a.G); if (!l) byGroup.set(a.G, l = []); l.push(a); }
  const rr = (a, b, R) => a + (b - a) * R();
  const wrap = a => a - Math.round(a / TAU) * TAU;

  // ---------------------------------------------------------------- people: where they are and how loud (the player and co-op's peers)
  const PEOPLE = []; for (let i = 0; i < 8; i++) PEOPLE.push({x: 0, y: 0, k: 1, on: false, px: NaN, py: NaN});
  const PS = {x: 0, y: 0, z: 0, phi: 0, s: '', pose: '', w: null, ls: null};
  let nPeople = 0;
  function gatherPeople(dt) {
    const P = host.player, N = TUNE.noise, q = PEOPLE[0];
    const sp = Math.hypot(P.vx || 0, P.vy || 0), st = P.state;
    q.x = P.x; q.y = P.y; q.on = true;
    q.k = st === 'roll' || st === 'leap' || st === 'knock' ? N.jump : sp < .3 ? N.still : P.gait === 'sprint' || sp > 5.2 ? N.sprint : P.gait === 'run' || sp > 2.4 ? N.run : N.walk;
    nPeople = 1;
    const C = host.feature('coop')?.net;
    if (C && C.peers) for (const peer of C.peers.values()) {
      if (nPeople >= PEOPLE.length) break;
      const o = C.sample(peer, PS); if (!o) continue;
      const r = PEOPLE[nPeople++], v = Number.isNaN(r.px) || dt <= 0 ? 0 : Math.hypot(o.x - r.px, o.y - r.py) / dt;
      r.px = r.x = o.x; r.py = r.y = o.y; r.on = true;
      r.k = v > 30 ? N.walk : v < .3 ? N.still : v > 5.2 ? N.sprint : v > 2.4 ? N.run : N.walk;   // (v > 30: a teleport)
    }
  }
  // the nearest person, scaled by how loud: TH.d = distance / loudness (compare with the species' alert / flee), TH.x / y where
  const TH = {d: 1e9, x: 0, y: 0, raw: 1e9};
  function threat(a) {
    TH.d = 1e9; TH.raw = 1e9;
    for (let i = 0; i < nPeople; i++) {
      const q = PEOPLE[i]; if (!q.on) continue;
      const d = Math.hypot(q.x - a.x, q.y - a.y), e = d / q.k;
      if (e < TH.d) { TH.d = e; TH.x = q.x; TH.y = q.y; TH.raw = d; }
    }
    return TH;
  }
  // loud moments: a gunshot, a hit, a break scare everything within their reach for a while
  const BANGS = []; for (let i = 0; i < 6; i++) BANGS.push({x: 0, y: 0, r: 0, t: 0});
  let bangI = 0;
  function gatherBangs(evs, dt) {
    for (const B of BANGS) if (B.t > 0) B.t -= dt;
    for (const e of evs || []) {
      const r = e.type === 'player.shoot' || e.type === 'foe.shoot' ? TUNE.shot : e.type === 'arrow.hit' || e.type === 'prop.break' || e.type === 'combat.explode' || e.type === 'player.hit' ? TUNE.hit : 0;
      if (!r || e.x === undefined) continue;
      const B = BANGS[bangI++ % BANGS.length]; B.x = e.x; B.y = e.y; B.r = r; B.t = .5;
    }
  }
  function bangAt(a) { for (const B of BANGS) if (B.t > 0 && Math.hypot(B.x - a.x, B.y - a.y) < B.r) return B; return null; }

  // ---------------------------------------------------------------- sounds (rate-limited, only near the player)
  const CD = {};
  function emit(type, a, extra) {
    if (!host.events || (CD[type] || 0) > 0) return;
    const P = host.player; if (Math.hypot(P.x - a.x, P.y - a.y) > 24) return;
    CD[type] = type === 'wildlife.caw' ? 2.5 : type === 'wildlife.howl' ? 20 : .5;
    const e = {type, x: a.x, y: a.y}; if (extra) Object.assign(e, extra); host.events.push(e);
  }

  // ---------------------------------------------------------------- the clock: is it out now
  const outNow = (S, hr) => { for (const [a, b] of S.out) if (hr >= a && hr < b) return true; return false; };

  // ---------------------------------------------------------------- moving on the ground
  function steer(a, tx, ty, speed, dt) {
    const want = Math.atan2(ty - a.y, tx - a.x), dd = wrap(want - a.hd), tr = a.S.turn * dt * (a.v > 2 ? 1.6 : 1);
    a.hd = wrap(a.hd + clamp(dd, -tr, tr));
    const goal = Math.abs(dd) > 1.6 ? speed * .3 : speed;   // (it turns before it runs on)
    a.v += (goal - a.v) * Math.min(1, dt * (speed > a.v ? 5 : 3));
    const nx = a.x + Math.cos(a.hd) * a.v * dt, ny = a.y + Math.sin(a.hd) * a.v * dt;
    if (free(nx, ny) || !free(a.x, a.y)) { a.x = nx; a.y = ny; a.blocked = 0; }   // (out of a bad spot: a trunk it just came down)
    else { a.v *= .4; a.blocked += dt; a.hd = wrap(a.hd + (a.R() < .5 ? -1 : 1) * rr(.5, 1.4, a.R)); }
    return Math.hypot(tx - a.x, ty - a.y);
  }
  // somewhere free within r of (x, y), away from (ax, ay) if given (null: none found)
  const SPOT = {x: 0, y: 0};
  function spot(a, x, y, r, ax, ay, minR = 0) {
    const R = a.R, base = ax === undefined ? R() * TAU : Math.atan2(y - ay, x - ax);
    for (let k = 0; k < 10; k++) {
      const ang = ax === undefined ? R() * TAU : base + (R() - .5) * (1.1 + k * .25), d = minR + R() * (r - minR);
      const sx = x + Math.cos(ang) * d, sy = y + Math.sin(ang) * d;
      if (free(sx, sy) && free(x + (sx - x) * .33, y + (sy - y) * .33) && free(x + (sx - x) * .67, y + (sy - y) * .67)) { SPOT.x = sx; SPOT.y = sy; return SPOT; }   // (and the way there)
    }
    return null;
  }
  function bolt(a, fx, fy, dist) {   // run from (fx, fy): somewhere dist m on, away from it
    const s = spot(a, a.x, a.y, dist, fx, fy, dist * .6) || spot(a, a.x, a.y, dist * .6);
    if (!s) return false;
    a.tx = s.x; a.ty = s.y; a.st = 'flee'; a.fx = fx; a.fy = fy; a.t = 12; a.lieTo = 0; a.gp = .25; a.gt = 0;
    if (a.sp === 'hare') a.zig = .35;
    emit('wildlife.critter_dash', a);
    return true;
  }
  function alarmGroup(a) {   // the herd goes with it (each a moment later)
    for (const b of byGroup.get(a.G)) if (b !== a && b.st !== 'flee' && Math.hypot(b.x - a.x, b.y - a.y) < 18) { b.alarm = rr(.15, .6, b.R); b.fx = a.fx; b.fy = a.fy; }
  }
  // the head's goals (pitch: up +, down -; turn: toward the person)
  function lookAt(a, x, y) { a.gt = clamp(wrap(Math.atan2(y - a.y, x - a.x) - a.hd), -1.3, 1.3); a.gp = .3; }

  // ---------------------------------------------------------------- the ground animals: roe, fox, hare, capercaillie on foot
  function stepGround(a, dt, hr) {
    const S = a.S, T = threat(a), bang = bangAt(a), out = outNow(S, hr);
    a.ph += a.v * dt * (a.sp === 'hare' ? 2.2 : a.sp === 'fox' ? 2.4 : a.sp === 'capercaillie' ? 4 : 1.35);
    if (a.alarm > 0 && (a.alarm -= dt) <= 0) { a.alarm = -1; if (a.st !== 'flee') bolt(a, a.fx, a.fy, rr(...S.away, a.R) * .8); }
    const rest = a.st === 'rest', k = rest ? S.rest : 1;
    if (a.st !== 'flee') {
      if (bang || T.d < S.flee * k) {
        const fx = bang ? bang.x : T.x, fy = bang ? bang.y : T.y;
        if (a.sp === 'capercaillie') { flush(a, fx, fy); return; }
        if (bolt(a, fx, fy, a.S.away ? rr(...a.S.away, a.R) : 14)) { alarmGroup(a); return; }
      } else if (T.d < S.alert * k && a.st !== 'alert') { a.st = 'alert'; a.t = rr(2, 5, a.R); a.v = 0; lookAt(a, T.x, T.y); if (rest) a.lieTo = a.sp === 'roe' ? .35 : 1; }
    }
    switch (a.st) {
      case 'flee': {
        if (a.sp === 'hare' && (a.zig -= dt) < 0) { a.zig = rr(.25, .5, a.R); a.hd = wrap(a.hd + (a.R() < .5 ? -.8 : .8)); }
        const d = steer(a, a.tx, a.ty, S.run, dt);
        a.gp = .15; a.gt = 0;
        if (d < 1.2 || (a.t -= dt) < 0 || a.blocked > .8) {
          a.st = 'alert'; a.t = rr(3, 7, a.R); a.v = 0;
          const T2 = threat(a); lookAt(a, T2.x, T2.y);   // (stops at a safe distance and looks back)
          if (a.sp === 'hare') a.gp = .5;
        }
        break;
      }
      case 'alert': {
        a.v *= Math.max(0, 1 - dt * 6);
        if (T.d < S.alert * k * 1.1) { lookAt(a, T.x, T.y); a.t = Math.max(a.t, 1); }
        if ((a.t -= dt) < 0) { a.gp = 0; a.gt = 0; idle(a, out); }
        break;
      }
      case 'rest': {   // bedded: the deer lie in cover, the fox curls up at its den, the hare sits in its form
        a.v = 0; a.lieTo = a.sp === 'hare' ? 0 : 1; a.gp = a.sp === 'roe' ? .1 : a.sp === 'fox' ? -.6 : 0; a.gt = Math.sin(a.ph * .3 + T.raw * .01) * .3;
        a.ph += dt * .2;
        if ((a.t -= dt) < 0) { if (out) { a.lieTo = 0; idle(a, out); } else a.t = rr(8, 20, a.R); }
        break;
      }
      case 'walk': {
        const d = steer(a, a.tx, a.ty, a.walk || S.walk, dt);
        a.gp = a.sp === 'fox' ? -.05 : 0; a.gt *= .9;
        if (d < .5 || (a.t -= dt) < 0 || a.blocked > 1.2) idle(a, out);
        break;
      }
      case 'graze': {
        a.v = 0; a.gp = a.sp === 'hare' ? -.25 : -1; a.gt = Math.sin(a.ph * .7) * .25; a.ph += dt;
        if ((a.t -= dt) < 0) idle(a, out);
        break;
      }
      default: {   // idle: stands, looks round
        a.v *= Math.max(0, 1 - dt * 5); a.gp = .15;
        if ((a.t -= dt) < 0) { a.gt = (a.R() - .5) * 1.6; next(a, out); }
      }
    }
  }
  function idle(a, out) { a.st = 'idle'; a.t = rr(1, 3, a.R); a.out = out; }
  // what next, when idle: by the clock, home, cover, the den
  function next(a, out) {
    const S = a.S, G = a.G, R = a.R, far = Math.hypot(a.x - G.x, a.y - G.y);
    if (!out && a.sp !== 'capercaillie') {   // time to rest: the roe to cover, the fox to its den, the hare where it is
      const bed = a.sp === 'roe' ? G.cover : a.sp === 'fox' ? G.den : null;
      if (bed && Math.hypot(a.x - bed.x, a.y - bed.y) > 2.5) { const s = spot(a, bed.x, bed.y, 2.5); if (s) { go(a, s.x, s.y, S.walk); return; } }
      a.st = 'rest'; a.t = rr(15, 40, R); a.lieTo = 1; return;
    }
    if (far > G.r * 1.3) { const s = spot(a, G.x, G.y, G.r * .6); if (s) { go(a, s.x, s.y, S.walk * (far > G.r * 2 ? 1.6 : 1)); return; } }
    const roll = R();
    if (a.sp === 'fox' && roll < .6) {   // the fox's round: a long trot to somewhere in its range, a stop to listen, now and then a call at night
      const s = spot(a, G.x, G.y, G.r, undefined, undefined, 6); if (s) { go(a, s.x, s.y, S.walk); if (R() < .25 && (hour() > 20 || hour() < 4)) emit('wildlife.howl', a, {kind: 'fox', call: 'yips'}); return; }
    }
    if (roll < (a.sp === 'roe' ? .55 : a.sp === 'hare' ? .5 : .45)) { a.st = 'graze'; a.t = rr(3, 9, R); return; }
    // a few steps on (the herd keeps together: the roe drift toward the others)
    let cx = a.x, cy = a.y;
    if (a.sp === 'roe') { const L = byGroup.get(G); let n = 0, sx = 0, sy = 0; for (const b of L) { sx += b.x; sy += b.y; n++; } cx = cx * .5 + sx / n * .5; cy = cy * .5 + sy / n * .5; }
    const s = spot(a, cx, cy, a.sp === 'hare' ? 3 : 4); if (s) go(a, s.x, s.y, S.walk); else { a.st = 'idle'; a.t = rr(1, 3, R); }
  }
  function go(a, x, y, v) { a.st = 'walk'; a.tx = x; a.ty = y; a.walk = v; a.t = 20; }
  const hour = () => host.env?.hour ?? 12;

  // ---------------------------------------------------------------- the capercaillie: a burst up out of the floor, a long low glide
  function flush(a, fx, fy) {
    const s = spot(a, a.x, a.y, 34, fx, fy, 22) || spot(a, a.x, a.y, 20);
    if (!s) return;
    a.st = 'flush'; a.tx = s.x; a.ty = s.y; a.t = 6; a.vz = 3.2; a.hd = Math.atan2(s.y - a.y, s.x - a.x); a.v = 2;
    emit('wildlife.birds_scatter', a, {n: 5}); alarmGroup(a);
  }
  function stepFlyer(a, dt) {   // flush / fly / circle / land for the birds (h: height over the ground under it)
    const S = a.S, d = Math.hypot(a.tx - a.x, a.ty - a.y), want = Math.atan2(a.ty - a.y, a.tx - a.x);
    a.hd = wrap(a.hd + clamp(wrap(want - a.hd), -S.turn * dt * 1.4, S.turn * dt * 1.4));
    const goalV = a.st === 'land' ? clamp(d * 1.1, .5, S.fly) : S.fly;   // (coming in: slower, so it can put down where it meant to)
    a.v += (goalV - a.v) * Math.min(1, dt * 2);
    a.x += Math.cos(a.hd) * a.v * dt; a.y += Math.sin(a.hd) * a.v * dt;
    const goalH = a.st === 'flush' ? 2.6 : a.st === 'circle' ? a.ch : clamp(d * .45, 0, a.sp === 'raven' ? 9 : 3);
    a.vz += ((goalH - a.h) * 2.2 - a.vz) * Math.min(1, dt * 3); a.h = Math.max(0, a.h + a.vz * dt);
    a.flap += dt * (a.vz > .3 || a.st === 'flush' ? 16 : a.vz < -.3 ? 0 : a.sp === 'raven' ? 5 : 9);
    a.glide = a.vz < -.25 && a.st !== 'flush';
    if (a.st === 'flush' && a.h > 2.2) a.st = 'fly';
    return d;
  }

  // ---------------------------------------------------------------- the ravens
  function stepRaven(a, dt, hr) {
    const S = a.S, T = threat(a), bang = bangAt(a), G = a.G, R = a.R;
    if (a.st === 'walk' || a.st === 'idle' || a.st === 'graze' || a.st === 'alert') {
      a.ph += a.v * dt * 4;
      if (bang || T.d < S.flee) { takeoff(a, true); return; }
      if (T.d < S.alert && a.st !== 'alert') { a.st = 'alert'; a.t = rr(1.5, 4, R); lookAt(a, T.x, T.y); a.v = 0; if (R() < .4) emit('wildlife.caw', a); }
      if (a.st === 'walk') { if (steer(a, a.tx, a.ty, S.walk, dt) < .3 || a.blocked > 1) { a.st = 'graze'; a.t = rr(1, 4, R); } }
      else if ((a.t -= dt) < 0) {
        if (a.st === 'alert') { a.st = 'idle'; a.t = 1; a.gp = 0; a.gt = 0; }
        else if (R() < .12) takeoff(a, false);
        else if (R() < .5) { a.st = 'graze'; a.t = rr(1, 3, R); a.gp = -.9; }
        else { const s = spot(a, a.x, a.y, 2.5); if (s) { a.st = 'walk'; a.tx = s.x; a.ty = s.y; a.gp = 0; } else a.t = 1; }
        if (a.st === 'idle') a.gt = (R() - .5) * 1.4;
      }
      if (a.st === 'graze') { a.gp = Math.sin(a.ph + T.raw) > .3 ? -1 : -.2; a.ph += dt * 6; }
      return;
    }
    const d = stepFlyer(a, dt);
    if (a.st === 'fly' || a.st === 'flush') { if (d < 4) { a.st = 'circle'; a.t = rr(6, 16, R); a.ca = Math.atan2(a.y - G.y, a.x - G.x); a.ch = rr(9, 14, R); } }
    else if (a.st === 'circle') {   // round the territory, high, calling now and then; then down to a perch
      a.ca += dt * .35; a.tx = G.x + Math.cos(a.ca) * 14; a.ty = G.y + Math.sin(a.ca) * 11;
      if (R() < dt * .15) emit('wildlife.caw', a);
      if ((a.t -= dt) < 0 && threat(a).d > S.alert) { const p = G.perches[(R() * G.perches.length) | 0], s = spot(a, p[0], p[1], 3); if (s) { a.st = 'land'; a.tx = s.x; a.ty = s.y; } else a.t = 3; }
    } else if (a.st === 'land' && d < .8 && a.h < .25) { a.st = 'idle'; a.t = rr(1, 3, R); a.h = 0; a.v = 0; a.vz = 0; }
  }
  function takeoff(a, scared) {
    const G = a.G, R = a.R, p = scared ? null : G.perches[(R() * G.perches.length) | 0];
    a.st = 'fly'; a.tx = p ? p[0] : G.x + (R() - .5) * 20; a.ty = p ? p[1] : G.y + (R() - .5) * 20; a.vz = 2.5; a.v = 1.5; a.gp = 0; a.gt = 0;
    emit('wildlife.wings', a, {n: 2}); if (scared) emit('wildlife.caw', a);
    for (const b of byGroup.get(G)) if (b !== a && b.st !== 'fly' && b.st !== 'circle' && Math.hypot(b.x - a.x, b.y - a.y) < 14) { b.st = 'fly'; b.tx = a.tx + 2; b.ty = a.ty; b.vz = 2.5; b.v = 1.5; }
  }

  // ---------------------------------------------------------------- the squirrels: on the floor, up the trunk, round it, down again
  function stepSquirrel(a, dt) {
    const S = a.S, T = threat(a), bang = bangAt(a), R = a.R, G = a.G;
    a.tail = Math.max(0, a.tail - dt * 3);
    if (a.st === 'climb' || a.st === 'cling' || a.st === 'down') {
      const tr = a.tree; if (!tr) { a.st = 'idle'; a.h = 0; return; }
      const r = trunkR(tr);
      if (a.st === 'climb') { a.th += dt * 2.6; if (a.th >= a.top) { a.th = a.top; a.st = 'cling'; a.t = rr(8, 18, R); } }
      if (a.st === 'down') { a.th -= dt * 1.6; if (a.th <= 0) { a.th = 0; a.st = 'idle'; a.t = rr(1, 2, R); a.hd = a.ta; } }
      // keep the trunk between it and the person (round it, in little rushes)
      if (a.st !== 'down' && T.raw < 14) {
        const away = Math.atan2(tr.y - T.y, tr.x - T.x), dd = wrap(away - a.ta);
        if (Math.abs(dd) > .5) { a.ta = wrap(a.ta + clamp(dd, -dt * 3.5, dt * 3.5)); a.tail = 1; }
        a.t = Math.max(a.t, 4);
      }
      if (a.st === 'cling') { if (R() < dt * .5) a.tail = 1; if ((a.t -= dt) < 0 && T.d > S.alert) a.st = 'down'; }
      a.x = tr.x + Math.cos(a.ta) * r; a.y = tr.y + Math.sin(a.ta) * r; a.h = a.th;
      return;
    }
    a.ph += a.v * dt * 3;
    if (bang || T.d < S.flee) {   // up the nearest of its trees
      let best = null, bd = 1e9;
      for (const t of G.trees) { const p = treeOf(t[2]); if (!p) continue; const d = Math.hypot(p.x - a.x, p.y - a.y) + (Math.hypot(p.x - T.x, p.y - T.y) < 2 ? 9 : 0); if (d < bd) { bd = d; best = p; } }
      if (best) { a.st = 'dash'; a.tree = best; a.tx = best.x; a.ty = best.y; a.t = 4; a.tail = 1; emit('wildlife.critter_dash', a); }
    }
    switch (a.st) {
      case 'dash': {
        const tr = a.tree, d = steerLoose(a, tr.x, tr.y, S.run, dt);
        if (d < trunkR(tr) + .25 || (a.t -= dt) < 0) { a.st = 'climb'; a.ta = Math.atan2(a.y - tr.y, a.x - tr.x); a.th = 0; a.top = rr(2.4, 4.6, R); a.v = 0; }
        break;
      }
      case 'walk': { if (steer(a, a.tx, a.ty, S.walk, dt) < .3 || (a.t -= dt) < 0 || a.blocked > .6) { a.st = 'graze'; a.t = rr(1.5, 4, R); } break; }
      case 'graze': { a.v = 0; a.gp = -.6; if ((a.t -= dt) < 0) { a.st = 'idle'; a.t = rr(.4, 1.5, R); a.gp = .3; if (R() < .3) a.tail = 1; } break; }
      default: {
        a.v = 0;
        if ((a.t -= dt) < 0) {
          const roll = R();
          if (roll < .15) {   // up a tree for no reason at all
            const t = G.trees[(R() * G.trees.length) | 0], p = treeOf(t[2]); if (p) { a.st = 'dash'; a.tree = p; a.tx = p.x; a.ty = p.y; a.t = 5; break; }
          }
          const s = spot(a, G.x, G.y, G.r); if (s) { a.st = 'walk'; a.tx = s.x; a.ty = s.y; a.t = 8; } else a.t = 1;
        }
      }
    }
  }
  const steerLoose = (a, tx, ty, v, dt) => {   // straight at a trunk (free() would stop it short of one)
    const want = Math.atan2(ty - a.y, tx - a.x); a.hd = wrap(a.hd + clamp(wrap(want - a.hd), -a.S.turn * dt, a.S.turn * dt));
    a.v = v; a.x += Math.cos(a.hd) * v * dt; a.y += Math.sin(a.hd) * v * dt; return Math.hypot(tx - a.x, ty - a.y);
  };
  const trunkR = p => .13 * (p.scale || 1) + .04;

  // ---------------------------------------------------------------- appear / go (only out of sight: nothing pops in or out)
  const look = createFaunaLook(host, TUNE);
  function stepGone(a, hr) {
    const away = !outNow(a.S, hr) && !(a.st === 'flee' || a.st === 'fly' || a.st === 'flush' || a.st === 'climb');
    if (away === a.gone) return;
    if (look.seen(a)) return;   // (wait until it is off the screen)
    a.gone = away;
    if (!away) {   // back at home, on the ground
      const G = a.G, s = spot(a, a.sp === 'squirrel' ? G.x : G.x, G.y, Math.min(G.r, 6));
      if (s) { a.x = s.x; a.y = s.y; } a.h = 0; a.th = 0; a.vz = 0; a.v = 0; a.st = 'idle'; a.t = 1; a.tree = null;
    }
  }

  // ---------------------------------------------------------------- the view step
  let acc = 0;
  F.view = (dt, evs) => {
    const t0 = performance.now();
    dt = Math.min(.05, Math.max(0, dt || 0));
    for (const k in CD) if (CD[k] > 0) CD[k] -= dt;
    gatherPeople(dt); gatherBangs(evs, dt);
    const P = host.player, hr = hour();
    let n = 0;
    for (const a of ANIM) {
      if (Math.hypot(a.x - P.x, a.y - P.y) > TUNE.SIM_R) { a.seen = false; continue; }
      n++;
      if (a.S.gone) stepGone(a, hr);
      if (a.gone) continue;
      if (a.sp === 'raven') stepRaven(a, dt, hr);
      else if (a.sp === 'squirrel') stepSquirrel(a, dt);
      else if (a.sp === 'capercaillie' && a.st !== 'flee' && (a.st === 'flush' || a.st === 'fly' || a.st === 'land')) {
        const d = stepFlyer(a, dt); if (a.st === 'fly' && d < 6) a.st = 'land';
        if (a.st === 'land' && d < .8 && a.h < .25) { a.st = 'alert'; a.t = rr(4, 8, a.R); a.h = 0; a.v = 0; a.vz = 0; }
      } else stepGround(a, dt, hr);
      a.lie += (a.lieTo - a.lie) * Math.min(1, dt * 1.5);
      a.pitch += (a.gp - a.pitch) * Math.min(1, dt * 5); a.turn += (a.gt - a.turn) * Math.min(1, dt * 5);
      if (a.h === 0 || a.sp === 'squirrel') a.z = elev(a.x, a.y);
      else a.z += (elev(a.x, a.y) - a.z) * Math.min(1, dt * 4);
    }
    F.count = n;
    acc = performance.now() - t0;
  };
  F.frame = () => {
    if (!F.on) { look.hideAll(ANIM); return; }
    const t0 = performance.now();
    look.frame(ANIM, host.env);
    F.ms = F.ms * .95 + (acc + performance.now() - t0) * .05;
  };
  F.biomeChanged = () => { look.drop(ANIM); trees.clear(); };
  F.toggle = () => { F.on = !F.on; if (!F.on) look.hideAll(ANIM); return F.on; };
  // the sandbox's menu: go and meet one (the nearest of each kind)
  const game = () => host.feature('game');
  F.menu = () => game()?.mode !== 'sandbox' ? [] : ['roe', 'fox', 'hare', 'squirrel', 'raven', 'capercaillie'].map(sp => ({label: `Animals: go to the nearest ${sp === 'roe' ? 'roe deer' : sp}`, run: () => {
    const P = host.player; let b = null, bd = 1e9;
    for (const a of ANIM) if (a.sp === sp) { const d = Math.hypot(a.x - P.x, a.y - P.y); if (d < bd) { bd = d; b = a; } }
    if (b) { const s = spot(b, b.x, b.y + 9, 3) || {x: b.x, y: b.y + 9}; host.teleport(s.x, s.y); }
  }}));
  F.dbg = () => ({count: F.count, ms: +F.ms.toFixed(3), hour: +hour().toFixed(2), animals: ANIM.map(a => `${a.d.id} ${a.st}${a.gone ? ' (gone)' : ''} ${a.x.toFixed(1)},${a.y.toFixed(1)}${a.h ? ' h' + a.h.toFixed(1) : ''}`)});
  return F;
}
