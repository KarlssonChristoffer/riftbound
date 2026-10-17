// TROLLS SIM: the forest's trolls as the truth (features/trolls.js is the feature, docs/TROLLS.md the design). Who is where,
// awake or stone, what each is doing, the rocks and pinecones in the air. Fixed 1/60 s steps (core/loop.js); every random draw
// from this module's own generator (core/rng.js simRandom), never Math.random; nothing the view does reads back in.
//
// A TROLL is a RECORD (list, below) and, while it is within TUNE.ADD_R of you and awake, an ENTITY in the registry
// (host.entities: kind 'troll', target + hunter + hp + coins, like the desert's gunmen), so arrows, bullets, fists, the boot,
// swords and everything that aims or collides sees it; combat owns its health (core.damage: hit numbers, hitstop, the coin
// burst, enemy.kill; combat breaks it and takes it out of the world). A big troll that is STONE has no troll entity: a plain
// rock collider ('trollstone') stands there instead (nothing hurts a stone).
//   big     roams round its stone at night; sees you (a cone ahead of it, sight m) or hears you (hear m, more when you run):
//           ROARS, then fights: closes in at a walk (a run when you're far), and from reach winds up a SLAM (club over its head,
//           a ring where it lands: TYPES attacks.slam.at m ahead), a SWEEP (you to its side: a wide arc) or a STOMP (you under
//           its feet); from range it rips up a BOULDER and throws it where you stand (a ring where it lands). The wind-up turns to
//           follow you for its first WIND_TRACK of the time, then locks: step out of the ring (or roll) and it misses. A missed
//           slam sticks its club in the dirt (recover: the window to punish). Damage wears down its POISE: past it, it reels
//           (stagger), and so does a parry. THE SUN: as daylight comes (sim/env.js's clock and sky) it walks home to its stone;
//           caught in daylight (>= TUNE.stoneAt) wherever it is, it FREEZES into stone there, mid-fight or not. At dusk (or under a
//           thick fog or a storm) the stone cracks and it WAKES.
//   small   lives round its burrow in a pack. By day it is shy: it peeks at you from a few trunks off and bolts for the burrow when
//           you come near (it fights back only when hit). At night (or a big troll fighting near by) it is bold: it keeps a few m
//           off, darting round you, and in turns the pack sends one in to BITE (a crouch, a dash, a nip) before it runs off
//           giggling, or throws a PINECONE from range. When you're hit they stop and LAUGH. A campfire near you, your lit lantern
//           or a fire hit keeps it off (it won't come within TYPES.small.fire m). A pack near a big troll walking by may send one up
//           onto its SHOULDER (ride): it throws cones from up there; a hit (or the big one reeling) knocks it off.
// YOU and them: their blows go out as player.hit + player.hurt (game/game.js counts them while a troll is fighting you: F.stakes);
// a guard turns a blow (the melee feature's guard(x, y, heavy, who) when there is one; else the fists' guard: a block halves
// it, a slip dodges it and opens the counter). You fall: they lose interest (player.down), and after you wake they're back
// at home (player.respawn).
// MULTIPLAYER: co-op sync for enemies was declined; each client runs its own trolls against its own player. A server would own
// exactly this module's state (the records, the shots, the clock that wakes them; the plan is already a pure function of the seed).
// OWNS: the records (list), the troll and trollstone entities' bodies (x, y, z, h, r: the creator's fields), the shots pool, its
//   own collision body per troll (world/collide.js).
// READS: host.player (x, y, z, state, untouchable, raw.blink), host.env (hour, sky), host.entities (near), host.elev / inStream,
//   world.js (roamable, steep), the plan (world/trolls.js), the game's mode, campfires (lit ones near you), host.lantern,
//   host.feature('melee').guard / host.PL.fists (a guard), combat.hit / prop.break / player.* events.
// EMITS (core/events.js): troll.wake, troll.stone, troll.roar, troll.swing {phase wind | strike}, troll.throw, troll.land,
//   troll.step, troll.giggle, player.hit, player.hurt.
import {simRandom} from '../../core/rng.js';
import {TAU, clamp} from '../../core/mathx.js';
import {roamable, steep, inStream, elev} from '../../world/world.js';
import {createCollide} from '../../world/collide.js';
import {TYPES, TUNE} from '../../content/trolls.js';

const DEG = Math.PI / 180;
const wrap = a => a - TAU * Math.floor((a + Math.PI) / TAU);   // -> [-pi, pi)
const hyp = (x, y) => Math.sqrt(x * x + y * y);
const WIND_TRACK = .6;   // the share of a wind-up it turns to follow you; then the blow is locked where it lands
const NO_HIT = new Set(['climb', 'leap', 'fall', 'splash', 'swim', 'hold', 'knock', 'launch', 'floored']);

export function createTrollSim(host, plan) {
  const ents = host.entities, P = host.player, events = host.events;
  const R = simRandom('trolls'), RR = (a, b) => a + R() * (b - a);
  const C = createCollide(() => host.entities);
  const list = [], byP = new Map();
  const S = {down: false, lastHurt: 99, px: NaN, py: NaN, pv: 0, devT: 0, sun: 0, fights: 0, campfires: null, laughT: 0};
  const near = [];

  // ---------------------------------------------------------------- the shots: boulders and pinecones in the air
  const shots = [];
  for (let i = 0; i < TUNE.projectiles; i++) shots.push({on: false, kind: '', x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0, t: 0, dur: 0, tx: 0, ty: 0, spin: 0, dmg: 0, knock: 0, r: 0, who: null});
  function shoot(kind, x, y, h, tx, ty, dur, rec) {
    const s = shots.find(q => !q.on); if (!s) return null;
    const th = elev(tx, ty) + (kind === 'cone' ? 1.1 : .2);
    s.on = true; s.kind = kind; s.x = x; s.y = y; s.h = h; s.t = 0; s.dur = dur; s.tx = tx; s.ty = ty; s.who = rec;
    s.vx = (tx - x) / dur; s.vy = (ty - y) / dur; s.vh = (th - h) / dur + 9.8 * dur / 2; s.spin = RR(-9, 9);
    const A = rec.T.attacks[kind]; s.dmg = A.dmg; s.knock = A.knock; s.r = A.r || .45;
    return s;
  }

  // ---------------------------------------------------------------- records
  function makeRec(type, x, y, home, extra) {
    const T = TYPES[type];
    const r = {id: type + list.length, type, T, p: null, stoneP: null, x, y, z: elev(x, y), face: R() * TAU, st: 'idle', at: 0, dur: 0, atk: '',
      speed: 0, gait: 0, stone: 0, seed: R(), rider: null, mount: null, hitAge: 99, hitX: 0, hitY: 0, aimX: x, aimY: y, hold: false, dead: false,
      home, tx: x, ty: y, foe: false, seen: 99, roared: 0, cool: RR(...(T.cool || [.5, 1])), coneCool: 0, boulderCool: 0, poise: T.poise || 0,
      fled: 0, side: R() < .5 ? -1 : 1, sideT: RR(1, 3), detour: 0, detourSide: 1, stuck: 0, hp: T.hp, respawnT: 0, struck: false, noSun: false, noSunT: 0, angry: 0, hitType: '', jolt: false, knocks: 0, stepAt: 0, chase: null,
      body: null, ...extra};
    r.body = {r: T.r * .85, counts: (q, z) => q !== r.p && q !== r.stoneP && q.kind !== 'troll' && !q.broken && !q.gone && C.column(q, z, z + T.hitH),
      ground: (gx, gy, z) => !roamable(gx, gy) || inStream(gx, gy) || (steep(gx, gy) && elev(gx, gy) > z + .01) || elev(gx, gy) > z + .55};
    list.push(r);
    return r;
  }
  const STONE = {kind: 'trollstone', r: .75, interact: 'knock'};
  for (const s of plan?.stones || []) {
    const r = makeRec('big', s.x, s.y, {x: s.x, y: s.y, r: s.high ? 22 : 18});
    r.face = s.face; r.st = 'stone'; r.stone = 1;
  }
  for (const b of plan?.burrows || []) for (let i = 0; i < b.n; i++) {
    const a = R() * TAU, d = RR(.5, 3);
    makeRec('small', b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, {x: b.x, y: b.y, r: b.r, burrow: true});
  }

  // ---------------------------------------------------------------- the world: entities in and out
  function entityOf(r) {
    const T = r.T;
    return {kind: 'troll', troll: r.type, name: T.name, x: r.x, y: r.y, z: r.z, h: 0, r: T.r, hitR: T.hitR, hitH: T.hitH, hp: r.hp, maxHp: T.hp,
      target: true, hunter: true, coins: T.coins, elite: r.type === 'big'};
  }
  function join(r) {
    if (r.p || r.dead) return;
    r.p = entityOf(r); ents.add(r.p); byP.set(r.p, r);
  }
  function leave(r) {
    if (!r.p) return;
    if (!r.p.broken) { r.hp = r.p.hp; ents.remove(r.p); }
    byP.delete(r.p); r.p = null;
  }
  function stoneIn(r) { if (r.stoneP) return; r.stoneP = {...STONE, x: r.x, y: r.y, z: r.z}; ents.add(r.stoneP); }
  function stoneOut(r) { if (!r.stoneP) return; ents.remove(r.stoneP); r.stoneP = null; }
  function place(r) {   // (the entity follows the record)
    const p = r.p; if (!p) return;
    p.x = r.x; p.y = r.y; p.z = r.z; p.h = r.mount ? r.mount.T.hitH * .78 : 0;
  }

  // ---------------------------------------------------------------- the sun
  function daylight() {
    const E = host.env; if (!E) return 0;
    const h = E.hour, D = TUNE.dawn, K = TUNE.dusk;
    const sun = h < D[0] || h >= K[1] ? 0 : h < D[1] ? (h - D[0]) / (D[1] - D[0]) : h < K[0] ? 1 : 1 - (h - K[0]) / (K[1] - K[0]);
    const s = E.sky || {}, M = TUNE.dim;
    return sun * (1 - Math.max((s.fog || 0) * M.fog, (s.storm || 0) * M.storm, (s.rain || 0) * M.rain, (s.cloud || 0) * M.cloud));
  }

  // ---------------------------------------------------------------- moving
  function setSt(r, st, dur = 0) { r.st = st; r.at = 0; r.dur = dur; }
  function turnTo(r, a, rate, dt) { r.face = wrap(r.face + clamp(wrap(a - r.face), -rate * dt, rate * dt)); }
  // walk toward (tx, ty) at speed: turns first, slides round trunks (world/collide.js), and when stuck goes round the other way
  function go(r, tx, ty, speed, dt) {
    if (S.H?.slowOf && r.p) speed *= S.H.slowOf(r.p);   // (chilled: the hits feature's status)
    const dx = tx - r.x, dy = ty - r.y, d = hyp(dx, dy);
    if (d < .05) { r.speed = 0; return d; }
    let a = Math.atan2(dx, dy);
    if (r.detour > 0) { r.detour -= dt; a += r.detourSide * 70 * DEG; }
    turnTo(r, a, r.T.turn, dt);
    const off = Math.abs(wrap(a - r.face)), v = speed * (off > 1.2 ? .25 : off > .6 ? .6 : 1);
    r.speed += (v - r.speed) * Math.min(1, dt * 6);
    const step = Math.min(r.speed * dt, d), fx = Math.sin(r.face) * step, fy = Math.cos(r.face) * step;
    const m = C.move(r.body, r.x, r.y, r.z, fx, fy, false, true);
    const moved = hyp(m.x - r.x, m.y - r.y);
    if (step > .002 && moved < step * .3) { r.stuck += dt; if (r.stuck > .35) { r.detour = RR(.6, 1.2); r.detourSide = R() < .5 ? -1 : 1; r.stuck = 0; } }
    else r.stuck = Math.max(0, r.stuck - dt);
    r.x = m.x; r.y = m.y; r.z = elev(r.x, r.y); r.gait += moved;
    if (r.type === 'big' && moved > 0 && r.gait >= r.stepAt) { r.stepAt = r.gait + 1.4; ev('troll.step', r).big = r.speed > 2 ? 2 : 1; }
    return hyp(tx - r.x, ty - r.y);
  }
  function shove(r, vx, vy) {   // a push (m along the ground, already scaled)
    const m = C.move(r.body, r.x, r.y, r.z, vx, vy, false, true);
    r.x = m.x; r.y = m.y; r.z = elev(r.x, r.y);
  }
  // trolls don't stand in each other or in you
  function spread(r) {
    if (r.mount) return;
    for (const q of list) {
      if (q === r || q.mount || q.st === 'stone' || q.dead) continue;
      const dx = r.x - q.x, dy = r.y - q.y, d = hyp(dx, dy), m = (r.T.r + q.T.r) * .9;
      if (d < m && d > 1e-4) { const k = (m - d) * (q.type === 'big' && r.type === 'small' ? 1 : .5); shove(r, dx / d * k, dy / d * k); }
    }
    const dx = r.x - P.x, dy = r.y - P.y, d = hyp(dx, dy), m = r.T.r + .3;
    if (d < m && Math.abs(P.z - r.z) < 1.2) shove(r, (d > 1e-4 ? dx / d : Math.sin(r.face)) * (m - d), (d > 1e-4 ? dy / d : Math.cos(r.face)) * (m - d));
  }
  // a spot round (x, y) within rad that a troll could stand on (rings out; null: none)
  const SPOT = {x: 0, y: 0};
  function spot(r, x, y, rad) {
    for (let k = 0; k < 10; k++) {
      const a = R() * TAU, d = RR(rad * .3, rad), sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d;
      if (!r.body.ground(sx, sy, elev(sx, sy)) && !C.overlap(r.body, sx, sy, elev(sx, sy), false)) { SPOT.x = sx; SPOT.y = sy; return SPOT; }
    }
    return null;
  }

  // ---------------------------------------------------------------- events (ring of payloads: none allocated a step)
  const POOL = 64, pool = []; let pi = 0;
  for (let i = 0; i < POOL; i++) pool.push({type: '', x: 0, y: 0, z: 0, troll: '', who: null, rec: null, atk: '', phase: '', dx: 0, dy: 0, r: 0, big: 0, heavy: false});
  function ev(type, r) {
    const e = pool[pi]; pi = (pi + 1) % POOL;
    e.type = type; e.x = r.x; e.y = r.y; e.z = r.z; e.troll = r.type; e.who = r.p; e.rec = r; e.atk = r.atk; e.phase = ''; e.dx = Math.sin(r.face); e.dy = Math.cos(r.face);
    e.r = 0; e.big = 0; e.heavy = false;
    events.push(e); return e;
  }

  // ---------------------------------------------------------------- you
  const pd = r => hyp(P.x - r.x, P.y - r.y);
  const pAng = r => Math.atan2(P.x - r.x, P.y - r.y);
  const inCave = () => !!host.world?.cave?.inBand?.(P.x, P.y);
  let aggroOK = true;
  function notices(r, d) {
    if (!aggroOK || S.down || inCave() || Math.abs(P.z - r.z) > 3) return false;
    const T = r.T, loud = S.pv > 3.5 ? 1.6 : S.pv > 1.6 ? 1.15 : S.pv < .2 ? .75 : 1;
    if (d < T.hear * loud) return true;
    if (d > T.sight) return false;
    return Math.abs(wrap(pAng(r) - r.face)) < T.sightCone / 2 * DEG;
  }
  // the fire that keeps the small ones off: a lit campfire near you, your lantern at night
  function fireNear() {
    if (host.lantern && S.sun < .3) return true;
    const fires = host.feature('campfires')?.fires, B = host.feature('builds');
    if (fires) for (const b of fires) if (hyp(b.x - P.x, b.y - P.y) < TYPES.small.fire && (B?.fire?.(b)?.fuel ?? 1) > 0) return true;
    return false;
  }
  // a guard's say on a blow -> 'parry' | 'block' | 'dodge' | null (DEF.k: the share that gets through a block)
  const DEF = {k: 1}, ATK = {x: 0, y: 0, dmg: 0, by: null, kind: 'melee', who: null};
  function guard(r, heavy, dmg) {
    DEF.k = .45;
    const H = S.H;   // (the hits feature: briefs/combat-shared.md, the melee thread's shield and parry)
    if (H?.defend) {
      ATK.x = r.x; ATK.y = r.y; ATK.dmg = dmg; ATK.by = r.p; ATK.who = r.p; ATK.kind = heavy && r.atk === 'boulder' ? 'blast' : 'melee';
      const d = H.defend(ATK);
      if (d?.out === 'parry') return 'parry';
      if (d && d.k < 1) { DEF.k = d.k; return d.k <= 0 ? 'dodge' : 'block'; }
    }
    const fz = host.PL?.fists;
    if (fz?.untouchable?.()) { fz.dodged?.(); return 'dodge'; }
    if (fz?.guards?.(r.x, r.y)) { fz.blocked?.(Math.sin(r.face) * 2, Math.cos(r.face) * 2); return 'block'; }
    return null;
  }
  const immune = () => !!P.untouchable || (P.raw?.blink || 0) > 0 || NO_HIT.has(P.state) || S.down || !!host.feature('game')?.core?.immune?.();
  // a blow lands on you from (fx, fy): damage, the knock away from it, the shake; a guard's say first
  function hurtPlayer(r, A, fx, fy, heavy) {
    if (immune()) return false;
    const g = guard(r, heavy, A.dmg);
    if (g === 'dodge') return false;
    if (g === 'parry') { r.poise = -1; stagger(r, r.T.stagger * 1.4); return false; }
    const k = g === 'block' ? DEF.k : 1;
    let ux = P.x - fx, uy = P.y - fy; const l = hyp(ux, uy); if (l > .05) { ux /= l; uy /= l; } else { ux = Math.sin(r.face); uy = Math.cos(r.face); }
    host.knock(ux * A.knock * k, uy * A.knock * k);
    host.shake(Math.round(A.shake * k), heavy ? .22 : .12); host.hitstop(heavy ? .07 : .04);
    // (a blow on you is rare: plain payloads, the shapes every other emitter of these uses)
    events.push({type: 'player.hit', x: P.x, y: P.y, vx: ux * 5, vy: uy * 5, player: true});
    events.push({type: 'player.hurt', dmg: Math.round(A.dmg * k), by: r.p || 'troll', x: P.x, y: P.y, melee: true, blocked: g === 'block'});
    S.lastHurt = 0;
    return true;
  }

  // ---------------------------------------------------------------- the big troll
  function stagger(r, sec) {
    if (r.st === 'stone' || r.st === 'freezing' || r.dead) return;
    setSt(r, 'stagger', sec); r.atk = ''; r.cool = Math.max(r.cool, .4);
    if (r.rider) dismount(r.rider);
  }
  function chooseBig(r, d, ang) {
    const A = r.T.attacks, side = Math.abs(wrap(ang - r.face));
    if (d < A.stomp.reach && R() < .5) return 'stomp';
    if (d < A.slam.reach) return side > 40 * DEG && d < A.sweep.reach ? 'sweep' : R() < .7 ? 'slam' : 'sweep';
    if (d > A.boulder.min && d < A.boulder.max && r.boulderCool <= 0 && !r.rider?.hold) return 'boulder';
    return '';
  }
  function windUp(r, atk) {
    const A = r.T.attacks[atk];
    r.atk = atk; setSt(r, 'wind', A.wind); r.struck = false; aimAt(r, atk);
    ev('troll.swing', r).phase = 'wind';
  }
  function aimAt(r, atk) {
    const A = r.T.attacks[atk];
    if (atk === 'boulder' || atk === 'cone') { r.aimX = P.x + S.vx * .35; r.aimY = P.y + S.vy * .35; return; }
    const at = A.at || 0; r.aimX = r.x + Math.sin(r.face) * at; r.aimY = r.y + Math.cos(r.face) * at;
  }
  function strike(r) {
    const A = r.T.attacks[r.atk], heavy = r.type === 'big';
    const e = ev('troll.swing', r); e.phase = 'strike'; e.r = A.r || 0; e.heavy = heavy; e.x = r.aimX; e.y = r.aimY;
    if (r.atk === 'boulder') {
      const s = shoot('boulder', r.x + Math.sin(r.face) * .5, r.y + Math.cos(r.face) * .5, r.z + 3, r.aimX, r.aimY, A.flight, r);
      r.boulderCool = A.cool; ev('troll.throw', r);
      void s; return;
    }
    if (r.atk === 'cone') {
      const h = r.mount ? r.z + r.mount.T.hitH * .95 : r.z + .9, d = hyp(r.aimX - r.x, r.aimY - r.y);
      shoot('cone', r.x, r.y, h, r.aimX, r.aimY, Math.max(.25, d / A.speed), r); r.hold = false;
      r.coneCool = RR(...A.cool); ev('troll.throw', r);
      return;
    }
    if (Math.abs(P.z - r.z) > 1.4) return;
    const d = hyp(P.x - r.aimX, P.y - r.aimY);
    let hit = false;
    if (r.atk === 'sweep') hit = pd(r) < A.r + .3 && Math.abs(wrap(pAng(r) - r.face)) < A.arc / 2 * DEG;
    else hit = d < A.r + .25;
    if (hit) hurtPlayer(r, A, r.atk === 'slam' ? r.aimX : r.x, r.atk === 'slam' ? r.aimY : r.y, heavy);
    else if (r.atk === 'bite') r.fled = 0;
  }

  function updBig(r, dt, sun) {
    const T = r.T, A = T.attacks;
    r.at += dt; r.boulderCool -= dt; r.cool -= dt; r.seen += dt;
    if (r.p) r.poise = Math.min(T.poise, r.poise + T.poiseBack * dt);
    r.noSunT -= dt;
    const sunproof = r.noSun || r.noSunT > 0, day = !sunproof && sun >= TUNE.stoneAt;
    // the sun: stone (by day), waking (dusk), freezing (caught by the dawn)
    if (r.st === 'stone') {
      r.stone = 1; r.speed = 0;
      if (sun < TUNE.wakeAt || sunproof) { setSt(r, 'waking', sunproof ? TUNE.wakeTime * .5 : TUNE.wakeTime); ev('troll.wake', r); if (r.noSunT > 0) { r.foe = true; r.seen = 0; } }
      return;
    }
    if (r.st === 'waking') { r.stone = clamp(1 - r.at / r.dur, 0, 1); if (r.at >= r.dur) { r.stone = 0; setSt(r, 'idle', RR(1, 3)); } return; }
    if (r.st === 'freezing') {
      r.stone = clamp(r.at / r.dur, 0, 1); r.speed *= .9;
      if (r.at >= r.dur) { setSt(r, 'stone'); r.stone = 1; r.foe = false; if (r.rider) dismount(r.rider); ev('troll.stone', r); }
      return;
    }
    if (day && r.st !== 'strike') { setSt(r, 'freezing', TUNE.stoneTime); r.atk = ''; if (r.rider) dismount(r.rider); return; }
    const d = pd(r), ang = pAng(r);
    // the fight: noticed, kept while it sees you; given up after calm s
    if (r.foe) { if (notices(r, d) || d < T.lose && r.seen < 1) r.seen = 0; if (r.seen > TUNE.calm || d > T.lose || S.down || !aggroOK) r.foe = false; }
    else if (notices(r, d) && (sun < TUNE.homeAt + .3 || sunproof)) {
      r.foe = true; r.seen = 0;
      if (r.roared <= 0 && r.st !== 'wind' && r.st !== 'strike') { setSt(r, 'roar', T.roar); r.roared = 40; ev('troll.roar', r); }
    }
    r.roared -= dt;
    switch (r.st) {
      case 'roar': turnTo(r, ang, T.turn, dt); r.speed = 0; if (r.at >= r.dur) setSt(r, 'idle', .2); return;
      case 'stagger': r.speed = 0; if (r.at >= r.dur) { r.poise = T.poise; setSt(r, 'idle', .3); } return;
      case 'wind': {
        if (r.at < r.dur * WIND_TRACK) { turnTo(r, ang, T.turn * 1.2, dt); aimAt(r, r.atk); }
        r.speed = 0;
        if (r.at >= r.dur) { setSt(r, 'strike', A[r.atk].strike || .12); strike(r); }
        return;
      }
      case 'strike': if (r.at >= r.dur) setSt(r, 'recover', A[r.atk].recover); return;
      case 'recover': if (r.at >= r.dur) { r.atk = ''; r.cool = RR(...T.cool); setSt(r, 'idle', .2); } return;
    }
    if (r.foe) {
      const atk = r.cool <= 0 ? chooseBig(r, d, ang) : '';
      if (atk) { windUp(r, atk); return; }
      const want = d > 7 ? T.run : T.walk;
      if (d > A.slam.reach * .85) { go(r, P.x, P.y, want, dt); setSt2(r, want > 2 ? 'run' : 'walk'); }
      else { turnTo(r, ang, T.turn, dt); r.speed *= .8; setSt2(r, 'idle'); }
      return;
    }
    // home at dawn; else wander round home
    const H = r.home;
    if (sun > TUNE.homeAt && !sunproof) {
      if (go(r, H.x, H.y, T.walk * 1.2, dt) < 1) { r.speed = 0; setSt2(r, 'idle'); } else setSt2(r, 'walk');
      return;
    }
    if (r.st === 'walk') {
      if (go(r, r.tx, r.ty, T.walk, dt) < .8 || r.at > 25) setSt(r, 'idle', RR(2, 6));
    } else {
      r.speed *= .85;
      if (r.at >= r.dur) { const s = spot(r, H.x, H.y, H.r); if (s) { r.tx = s.x; r.ty = s.y; setSt(r, 'walk'); } else setSt(r, 'idle', 2); }
    }
  }
  function setSt2(r, st) { if (r.st !== st) setSt(r, st); }   // (a moving state: its clock starts only when it changes)

  // ---------------------------------------------------------------- the small trolls
  function dismount(r) {
    const m = r.mount; if (!m) return;
    m.rider = null; r.mount = null;
    const a = m.face + Math.PI / 2;
    r.x = m.x + Math.sin(a) * (m.T.r + .4); r.y = m.y + Math.cos(a) * (m.T.r + .4); r.z = elev(r.x, r.y);
    const s = spot(r, r.x, r.y, 1.2); if (s && C.overlap(r.body, r.x, r.y, r.z, false)) { r.x = s.x; r.y = s.y; r.z = elev(r.x, r.y); }
    setSt(r, 'stagger', r.T.stagger * 1.6); r.atk = ''; r.hold = false;
  }
  function packNear(r) { let n = 0; for (const q of list) if (q !== r && q.type === 'small' && !q.dead && q.home === r.home && hyp(q.x - r.x, q.y - r.y) < 9) n++; return n; }
  function bigFighting(r) { for (const q of list) if (q.type === 'big' && q.foe && !q.dead && q.st !== 'stone' && hyp(q.x - r.x, q.y - r.y) < 16) return true; return false; }
  function biting() { for (const q of list) if (q.type === 'small' && (q.atk === 'bite') && !q.dead) return true; return false; }
  function updSmall(r, dt, sun) {
    const T = r.T, A = T.attacks;
    r.at += dt; r.coneCool -= dt; r.cool -= dt; r.seen += dt; r.fled -= dt;
    const d = pd(r), ang = pAng(r), night = sun < .3, fire = S.fire;
    const bold = (night ? 1 : TUNE.dayBold) * (1 + packNear(r) * .25) + (bigFighting(r) ? 1 : 0);
    if (r.st === 'stagger') { r.speed = 0; if (r.at >= r.dur) setSt(r, 'idle', .2); return; }
    // riding a big troll: sat on its shoulder, throwing from there
    if (r.mount) {
      const m = r.mount; r.x = m.x; r.y = m.y; r.z = m.z; r.face = m.face;
      if (m.dead || m.st === 'stone' || m.st === 'freezing' || m.st === 'stagger') { dismount(r); return; }
      if (r.st === 'wind') { if (r.at < r.dur * WIND_TRACK) aimAt(r, 'cone'); if (r.at >= r.dur) { setSt(r, 'strike', .15); strike(r); } return; }
      if (r.st === 'strike') { if (r.at >= r.dur) setSt(r, 'ride'); return; }
      if (r.st !== 'ride' && r.st !== 'laugh') setSt(r, 'ride');
      if (r.st === 'laugh' && r.at >= r.dur) setSt(r, 'ride');
      r.hold = r.coneCool < .8;
      if (m.foe && r.coneCool <= 0 && d > 2.5 && d < A.cone.max + 2) { r.atk = 'cone'; setSt(r, 'wind', A.cone.wind); r.hold = true; aimAt(r, 'cone'); }
      return;
    }
    // the fight
    const fightAll = aggroOK && !S.down && !inCave();
    r.angry -= dt;
    if (r.foe) { if (notices(r, d) || d < T.lose * .8) r.seen = 0; if (r.seen > TUNE.calm || d > T.lose || !fightAll || (bold < 1 && r.angry <= 0)) r.foe = false; }
    else if (fightAll && notices(r, d) && bold >= 1 && !fire) { r.foe = true; r.seen = 0; ev('troll.giggle', r); }
    switch (r.st) {
      case 'wind': {
        r.speed = 0;
        if (r.at < r.dur * WIND_TRACK) { turnTo(r, ang, T.turn, dt); aimAt(r, r.atk); }
        if (r.at >= r.dur) {
          setSt(r, 'strike', r.atk === 'bite' ? A.bite.strike + .14 : .15);
          if (r.atk === 'cone') strike(r);
        }
        return;
      }
      case 'strike':
        if (r.atk === 'bite') {   // the dash: on to where you were, the nip as it gets there
          go(r, r.aimX + Math.sin(r.face) * .6, r.aimY + Math.cos(r.face) * .6, A.bite.dash, dt);
          if (!r.struck && (pd(r) < A.bite.r + T.r + .35 || r.at >= r.dur)) { r.struck = true; r.aimX = r.x + Math.sin(r.face) * A.bite.at; r.aimY = r.y + Math.cos(r.face) * A.bite.at; strike(r); }
        }
        if (r.at >= r.dur) { if (r.atk === 'bite') { r.fled = RR(...T.flee); setSt(r, 'flee', r.fled); ev('troll.giggle', r); } else setSt(r, 'idle', .2); r.atk = ''; r.hold = false; }
        return;
      case 'laugh': r.speed *= .8; if (r.at >= r.dur) setSt(r, 'idle', .3); return;
    }
    // fire keeps them off, by day you're too much for them: back off, peek
    if (r.foe && fire && d < T.fire + 2) { const a = ang + Math.PI; go(r, r.x + Math.sin(a) * 3, r.y + Math.cos(a) * 3, T.run * .7, dt); setSt2(r, 'flee'); return; }
    if (r.foe) {
      if (r.st === 'flee' && r.fled > 0) { const a = ang + Math.PI + r.side * .7; go(r, r.x + Math.sin(a) * 3, r.y + Math.cos(a) * 3, T.run, dt); return; }
      // circle at a few m; one at a time comes in to bite; cones from further off
      const keep = (T.keep[0] + T.keep[1]) / 2 + (r.seed - .5) * 2;
      if (r.cool <= 0 && d < A.bite.reach + 3.2 && !biting() && !S.down) { r.atk = 'bite'; setSt(r, 'wind', A.bite.wind); aimAt(r, 'bite'); r.cool = RR(1.2, 2.6); ev('troll.swing', r).phase = 'wind'; return; }
      if (r.coneCool <= 0 && d > A.cone.min && d < A.cone.max && R() < dt * 1.5) { r.atk = 'cone'; setSt(r, 'wind', A.cone.wind); r.hold = true; aimAt(r, 'cone'); return; }
      if (r.cool <= 0 && d >= A.bite.reach + 3.2) { go(r, P.x, P.y, T.run, dt); setSt2(r, 'run'); return; }
      r.sideT -= dt; if (r.sideT <= 0) { r.side = -r.side; r.sideT = RR(1, 2.5); }
      const a = ang + Math.PI + r.side * (d < keep ? .5 : 1.2);   // (round you, out to keep m)
      const tx = P.x + Math.sin(a) * keep, ty = P.y + Math.cos(a) * keep;
      go(r, tx, ty, T.run * .75, dt); turnTo(r, ang, T.turn * .5, dt); setSt2(r, 'run');
      return;
    }
    // not fighting: shy by day (bolt home when you come near, peek when you're a little off), wander at night
    const H = r.home;
    if (!night && aggroOK && d < T.shy && !S.down) { if (go(r, H.x, H.y, T.run, dt) < .8) { r.speed = 0; setSt2(r, 'hide'); } else setSt2(r, 'flee'); return; }
    if (r.st === 'hide') { r.speed = 0; if (r.at > 3 && d > T.shy + 2) setSt(r, 'idle', 1); return; }
    if (!night && aggroOK && d < T.shy + 7 && !S.down) { turnTo(r, ang, T.turn, dt); r.speed *= .7; setSt2(r, 'peek'); return; }
    // a big troll walking by: up onto its shoulder
    if (r.st !== 'walk' || r.at > 1) for (const q of list) {
      if (q.type !== 'big' || q.rider || q.dead || q.foe || q.st === 'stone' || q.st === 'freezing' || q.st === 'waking') continue;
      if (hyp(q.x - r.x, q.y - r.y) < 1.2) { r.mount = q; q.rider = r; setSt(r, 'ride'); return; }
      if (q.st === 'walk' && hyp(q.x - H.x, q.y - H.y) < H.r + 6 && R() < TUNE.ride * dt * .2) { r.tx = q.x; r.ty = q.y; r.chase = q; setSt(r, 'walk'); }
    }
    if (r.st === 'walk') {
      if (r.chase && !r.chase.dead && !r.chase.rider) { r.tx = r.chase.x; r.ty = r.chase.y; }
      if (go(r, r.tx, r.ty, r.chase ? T.run : T.walk, dt) < .6 || r.at > 12) { r.chase = null; setSt(r, 'idle', RR(1.5, 5)); }
    } else {
      r.speed *= .8; if (r.st !== 'idle') setSt(r, 'idle', RR(1, 3));
      if (r.at >= r.dur) { const s = spot(r, H.x, H.y, night ? H.r * 2.5 : H.r); if (s) { r.tx = s.x; r.ty = s.y; setSt(r, 'walk'); } else setSt(r, 'idle', 2); }
    }
  }

  // ---------------------------------------------------------------- hits on them (combat's), the shots
  function onHit(e) {
    const r = byP.get(e.who); if (!r || r.dead) return;
    let ux = e.dx || 0, uy = e.dy || 0; let l = hyp(ux, uy);
    if (l < 1e-4) { ux = r.x - P.x; uy = r.y - P.y; l = hyp(ux, uy) || 1; }
    ux /= l; uy /= l; r.hitX = ux; r.hitY = uy; r.hitAge = 0;
    r.foe = true; r.seen = 0; r.angry = TUNE.angry;
    const T = r.T, type = r.hitType || e.dtype || e.type2 || (e.by === 'fire' || e.by === 'burn' ? 'fire' : ''); r.hitType = '';
    if (r.type === 'small') {
      if (r.mount) { dismount(r); return; }
      const push = T.knockTake * (1 + e.dmg * .05);
      shove(r, ux * push, uy * push); stagger(r, T.stagger);
      if (type === 'fire') { r.fled = 3; r.foe = true; }
      return;
    }
    const blunt = type === 'blunt' || e.by === 'kick' || e.by === 'fist';
    r.poise -= e.dmg * (blunt ? 1.6 : e.crit ? 1.3 : 1);
    shove(r, ux * T.knockTake * .5, uy * T.knockTake * .5);
    if (r.poise <= 0 && r.st !== 'stagger') { stagger(r, T.stagger); r.poise = T.poise; }
  }
  function updShots(dt) {
    for (const s of shots) {
      if (!s.on) continue;
      s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vh -= 9.8 * dt; s.h += s.vh * dt;
      const g = elev(s.x, s.y);
      if (s.kind === 'cone') {
        if (!S.down && !immune() && hyp(P.x - s.x, P.y - s.y) < .45 && s.h > P.z + .2 && s.h < P.z + 1.9) {
          s.on = false;
          const rec = s.who;
          if (!(rec && !rec.dead && hurtFrom(rec, s))) { /* (dodged or guarded) */ }
          continue;
        }
        if (s.h <= g || s.t > s.dur + .8) { s.on = false; const e = ev('troll.land', s.who); e.x = s.x; e.y = s.y; e.z = g; e.atk = 'cone'; }
        continue;
      }
      if (s.t >= s.dur || s.h <= g) {   // a boulder comes down: the ring's blow
        s.on = false; const e = ev('troll.land', s.who); e.x = s.x; e.y = s.y; e.z = g; e.atk = 'boulder'; e.r = s.r;
        if (hyp(P.x - s.x, P.y - s.y) < s.r + .3 && Math.abs(P.z - g) < 1.5 && s.who) hurtFrom(s.who, s);
      }
    }
  }
  const SA = {dmg: 0, knock: 0, shake: 0};
  function hurtFrom(rec, s) { SA.dmg = s.dmg; SA.knock = s.knock; SA.shake = s.kind === 'boulder' ? 4 : 1; return hurtPlayer(rec, SA, s.x - s.vx * .05, s.y - s.vy * .05, s.kind === 'boulder'); }

  // ---------------------------------------------------------------- dev: some near you now
  const PROBE = {r: .5, counts: (q, z) => q.kind !== 'troll' && !q.broken && !q.gone && C.column(q, z, z + 1), ground: () => false};
  function spawnNear(kind = 'pack', n = 0) {
    const N = TUNE.near, made = [];
    const add = (type, d) => {
      for (let k = 0; k < 16; k++) {
        const a = R() * TAU, x = P.x + Math.sin(a) * d, y = P.y + Math.cos(a) * d, z = elev(x, y);
        PROBE.r = TYPES[type].r * .85;
        if (!roamable(x, y) || inStream(x, y) || steep(x, y) || C.overlap(PROBE, x, y, z, false)) continue;
        const r = makeRec(type, x, y, {x, y, r: 10}, {noSun: true, dev: true});
        r.face = Math.atan2(P.x - x, P.y - y); made.push(r); return r;
      }
      return null;
    };
    if (kind === 'big' || kind === 'pack') for (let i = 0; i < (n || (kind === 'big' ? 1 : N.big)); i++) add('big', N.d + i * 2);
    if (kind === 'small' || kind === 'pack') for (let i = 0; i < (n || N.small); i++) add('small', N.d * .7 + i);
    return made.length;
  }

  // ---------------------------------------------------------------- the step
  const SIM2 = TUNE.SIM_R * TUNE.SIM_R;
  function clear() {   // (off): every troll out of the world, the shots gone, the dev ones forgotten
    for (const r of list) { leave(r); stoneOut(r); if (r.mount) { r.mount.rider = null; r.mount = null; } }
    for (const s of shots) s.on = false;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].dev) list.splice(i, 1);
  }
  return {
    list, shots, S, spawnNear, daylight,
    recOf: p => byP.get(p),
    get alive() { let n = 0; for (const r of list) if (!r.dead && r.st !== 'stone') n++; return n; },
    get fighting() { let n = 0; for (const r of list) if (r.foe && !r.dead && r.st !== 'stone' && pd(r) < TUNE.stakesR) n++; return n; },
    shove(p, vx, vy, stun = 0) {   // (other systems: a sword's push, a parry's stun) m/s along the ground
      const r = byP.get(p); if (!r || r.dead) return false;
      const k = r.T.knockTake * .12; shove(r, vx * k, vy * k); if (stun > 0 && (r.type === 'small' || r.poise <= 0)) stagger(r, stun); return true;   // (a big one reels only past its poise: stagger() for a parry)
    },
    // E on a troll stone (features/trolls.js interact): a knock. The third wakes it, grumpy, for TUNE.knock.sec s whatever the sun
    knock(p) {
      const r = list.find(q => q.stoneP === p); if (!r || r.st !== 'stone') return 0;
      r.knocks++; const e = ev('troll.grumble', r); e.big = r.knocks;
      if (r.knocks >= TUNE.knock.n) { r.knocks = 0; r.noSunT = TUNE.knock.sec; r.face = pAng(r); }
      return r.knocks || TUNE.knock.n;
    },
    // the hits feature's take() (features/trolls.js): this hit's type, read by the combat.hit that its damage makes
    typeOf(p, type, extra) { const r = byP.get(p); if (r) r.hitType = extra?.fire ? 'fire' : type || ''; },
    stagger(p, sec) { const r = byP.get(p); if (!r) return false; stagger(r, sec); return true; },
    clear,
    update(dt, evs, on, aggro) {
      if (!on) { for (const r of list) if (r.p || r.stoneP) { clear(); break; } return; }
      aggroOK = aggro;
      // you: how fast you go (noise), where
      if (S.px === S.px) { const vx = (P.x - S.px) / dt, vy = (P.y - S.py) / dt; S.vx = vx; S.vy = vy; S.pv = S.pv * .8 + hyp(vx, vy) * .2; } else { S.vx = S.vy = 0; }
      S.px = P.x; S.py = P.y; S.lastHurt += dt; S.laughT -= dt;
      S.H = host.feature('hits'); const sun = S.sun = daylight(); S.fire = fireNear();
      for (const e of evs) {
        if (e.type === 'combat.hit' && e.who?.kind === 'troll') onHit(e);
        else if (e.type === 'player.hurt' && !e.world && S.laughT <= 0) {
          // they laugh at you (the small ones near that aren't busy; not again for a while)
          S.laughT = TUNE.laughGap;
          for (const r of list) if (r.type === 'small' && !r.dead && !r.mount && (r.st === 'run' || r.st === 'idle' || r.st === 'peek') && pd(r) < 12) { setSt(r, 'laugh', TUNE.laugh); ev('troll.giggle', r); }
        }
        else if (e.type === 'player.down') { S.down = true; for (const r of list) r.foe = false; }
        else if (e.type === 'player.respawn') {
          S.down = false;
          for (const r of list) { if (r.dev && !r.dead) { leave(r); r.dead = true; r.respawnT = 1e9; } r.foe = false; if (r.mount) dismount(r); if (!r.dead && r.st !== 'stone') { r.x = r.home.x; r.y = r.home.y; r.z = elev(r.x, r.y); if (r.p) { place(r); ents.moved(r.p); } } }
        }
      }
      // the dead: combat broke them (enemy.kill was its); back after a while at home
      for (const r of list) {
        if (r.p && S.H?.stunned?.(r.p) && !r.dead && r.st !== 'stone') { r.speed = 0; r.jolt = true; } else r.jolt = false;
      if (r.p?.broken) {
          r.dead = true; r.respawnT = TUNE.respawn; byP.delete(r.p); r.p = null; r.foe = false; r.atk = ''; r.st = 'dead';
          if (r.rider) dismount(r.rider);
          if (r.mount) { r.mount.rider = null; r.mount = null; }
        }
        if (r.dead) {
          if (r.dev) continue;
          r.respawnT -= dt;
          if (r.respawnT <= 0 && pd(r) > TUNE.ADD_R && hyp(P.x - r.home.x, P.y - r.home.y) > TUNE.ADD_R) {
            r.dead = false; r.hp = r.T.hp; r.x = r.home.x; r.y = r.home.y; r.z = elev(r.x, r.y); r.poise = r.T.poise || 0;
            if (r.type === 'big' && sun >= TUNE.stoneAt) { r.st = 'stone'; r.stone = 1; } else { setSt(r, 'idle', 1); r.stone = 0; }
          }
          continue;
        }
      }
      const px = P.x, py = P.y;
      for (const r of list) {
        if (r.dead) continue;
        const dx = r.x - px, dy = r.y - py, d2 = dx * dx + dy * dy;
        // in the world near you; out of it (healed) far off
        if (r.st === 'stone') { leave(r); if (d2 < TUNE.ADD_R * TUNE.ADD_R) stoneIn(r); else stoneOut(r); }
        else { stoneOut(r); if (d2 < TUNE.ADD_R * TUNE.ADD_R) join(r); else if (d2 > TUNE.DROP_R * TUNE.DROP_R) { leave(r); r.hp = r.T.hp; } }
        if (d2 > SIM2 && !r.foe) continue;   // (far off: it waits where it is)
        r.hitAge += dt;
        if (r.p && !r.foe && r.p.hp < r.p.maxHp) r.p.hp = Math.min(r.p.maxHp, r.p.hp + TUNE.heal * dt);
        if (r.jolt) { /* (jolted: it stands) */ } else if (r.type === 'big') updBig(r, dt, sun); else updSmall(r, dt, sun);
        if (r.st !== 'stone') spread(r);
        place(r);
      }
      updShots(dt);
    },
  };
}
