// FIGHT LIFE: wildlife reacting to fights (docs/exp/wildfight.md). A part of the wildlife feature (features/wildlife.js
// creates it with its internals, K) and like it SHOW ONLY: animals never block, hurt or get hit and change nothing in
// play; it runs in wildlife's view (presentation: its own generator, core/rng.js viewRandom, never the sim's) and
// writes only wildlife's state. ?wildfight=0 starts it off; Menu > Dev (wildlife's settings) > Fight reactions.
//   the fight     a FIGHT LEVEL rises with shots, hits, hurts, kills and blasts and decays with calm (TUNE.fight), round a
//                 centre that follows them. Crossing `high` sends a FLUSH outward from it at `wave` m/s: each flock it
//                 reaches (out to `reach` m) lifts off away from the fight, staggered, so the perched birds farther out go
//                 up in waves after the near ones. While the fight is on, flocks in the air wheel out to `keep` m and stay
//                 there (they don't land inside it), crows / ravens / the hawk call, the high vultures drift over it. After
//                 the calm (the level under `low`) they come back on their own time. Today's per-shot startle
//                 (wildlife.js's noise: a gunshot 14 m) stays as it was, under this.
//   scavengers    (wildlife/scavengers.js) after a kill: vultures (desert, ember), crows (ruins), ravens (frost) come in,
//                 circle lower over the body as it stays calm, land by it, hop and tug, burst off when you come close or
//                 shoot; in the rift, motes drift to the body. By day; at night the canids take the carcass.
//   canids        (wildlife/coyotes.js) at night: a coyote pack (desert), a fox (ruins), wolves (frost) skulking at the
//                 edge of the light, their eyes catching the firelight, howls and yips (wildlife.howl), scattering at shots.
// The new sprites (fightart.js) are one more atlas per biome (albedo + emit, made at populate) drawn through host.sprite
// like wildlife's own; crows, ravens and motes use wildlife's atlas (K.put).
// OWNS: the fight level, the flush, the scavengers, the canids, the fight atlas. READS: the events (player.shoot, foe.shoot,
// combat.hit, player.hit, enemy.kill, prop.break, combat.explode), wildlife's flocks / vultures / noise (K), the desert
// gunmen's corpses (host.feature('foes').look.corpses: where a body lies), the light props (eyeshine).
// EMITS (a view's, like wildlife's: nothing in the sim listens): wildlife.howl; wildlife's wings / birds_scatter / caw (K.emit).
// BUDGET: view ~.02 ms with nothing on (the events scan), ~.05 ms with a pack and four vultures; frame: a sprite each, no
// allocation per step or frame (pools, preallocated records).
import {viewRandom} from '../../core/rng.js';
import {clamp, hypot2} from '../../core/mathx.js';
import {flags} from '../../core/flags.js';
import {frames, FPAL, EYESHINE} from './fightart.js';
import {createScavengers} from './scavengers.js';
import {createCanids} from './coyotes.js';

export const TUNE = {
  fight: {
    // what an event adds to the level (shot: yours, foeShot: a gunman's; hit: a body hit; hurt: you are hit; kill;
    // blast: an explosion, x its radius / 2.4)
    add: {shot: .35, foeShot: .3, hit: .25, hurt: .3, kill: .7, blast: 1.6},
    tau: 5,           // s: the level decays as exp(-t / tau) (halved in ~3.5 s of calm)
    max: 4,           // the level's cap (a long gunfight doesn't take minutes to calm)
    high: 1.2,        // over this the area flushes (two quick shots and a hit; a single shot doesn't)
    low: .4,          // under this the fight is over: the flocks may come back
    reach: 34,        // m round the fight the flush reaches
    wave: 11,         // m/s: how fast the flush spreads outward
    lift: [.1, .7],   // s: a flock's delay after the wave reaches it (staggered, so a wall of birds doesn't go up as one)
    far: .5,          // the chance a flock at the reach's edge lifts (1 at the fight); a flock that stays is checked again by the next wave
    keep: 24,         // m: flocks in the air keep this far from the fight while it's on; those that land inside it are put up again
    again: 5,         // s: a flock put up isn't put up again sooner
    calls: [2.5, 6],  // s between a caller's (crow, raven, hawk) calls while the fight is on
    check: .3,        // s between a flock's checks
  },
};

export function createFightLife(K) {
  const host = K.host, ctx = K.ctx, R = viewRandom('wildlife.fight'), rr = (a, b) => a + R() * (b - a);
  const FL = {on: flags.get('wildfight') !== '0', level: 0, TUNE};
  const F = TUNE.fight;

  // ---------------------------------------------------------------- the fight level
  const fight = {level: 0, x: 0, y: 0, on: false, calm: 99, wave: -1, waveX: 0, waveY: 0, waveId: 0, shotT: 99, shotX: 0, shotY: 0};
  function add(k, x, y) {
    if (!(x === x)) return;
    const L = fight.level, w = k / (L + k);
    fight.x += (x - fight.x) * w; fight.y += (y - fight.y) * w;
    fight.level = Math.min(F.max, L + k); fight.calm = 0;
    if (L < F.high && fight.level >= F.high) wave();
  }
  function wave() { fight.on = true; fight.wave = 0; fight.waveX = fight.x; fight.waveY = fight.y; fight.waveId++; }
  const body = p => !!p && (p.hunter || p.sparring || p.kind === 'gunman' || p.kind === 'brute');
  function events(evs) {
    const A = F.add;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      switch (e.type) {
        case 'player.shoot': add(A.shot, e.x, e.y); shot(e.x, e.y); break;
        case 'foe.shoot': add(A.foeShot, e.x, e.y); shot(e.x, e.y); break;
        case 'combat.hit': if (!e.quiet && body(e.who)) add(A.hit, e.x, e.y); break;
        case 'player.hit': add(A.hurt, e.x, e.y); break;
        case 'enemy.kill': add(A.kill, e.x, e.y); scav.kill(e.x, e.y, e.who); break;
        case 'prop.break': if ((e.kind === 'brute' || e.who?.sparring) && !e.who?.hunter) { add(A.kill, e.x, e.y); scav.kill(e.x, e.y, e.who); } break;   // (a yard brute; a hunter's is enemy.kill)
        case 'combat.explode': { const k = A.blast * clamp((e.r || 2.4) / 2.4, .5, 2); add(k, e.x, e.y); shot(e.x, e.y); if (fight.level >= F.high && fight.wave < 0) wave(); break; }
      }
    }
  }
  // the last loud bang (the scavengers and the canids bolt from it): where and how long ago
  function shot(x, y) { fight.shotT = 0; fight.shotX = x; fight.shotY = y; }

  // ---------------------------------------------------------------- the flush (wildlife's flocks)
  let FS = new Map();   // per flock: {wave (the last wave that reached it), lift (s to its lift, -1 none), put (s since put up), chk, calls}
  const fs = f => { let s = FS.get(f); if (!s) FS.set(f, s = {wave: -1, lift: -1, put: 99, chk: R() * F.check, calls: rr(F.calls[0], F.calls[1])}); return s; };
  function flush(f, s) {
    const night = K.time === 'night';
    K.takeOff(f, true, f.sp.solo ? 'perch' : night ? 'roost' : 'home2', fight.x, fight.y);
    s.put = 0;
  }
  function stepFlocks(dt) {
    const fl = K.flocks, on = fight.on, wr = fight.wave;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i], s = fs(f), b0 = f.birds[0]; if (!b0) continue;
      s.put += dt;
      if (s.lift >= 0) { if ((s.lift -= dt) < 0) { s.lift = -1; if (f.mode !== 'air') flush(f, s); } continue; }
      if (!on) continue;
      // (a flock's place: its first bird; cheaper than its centroid and as good at these distances)
      const dx = b0.x - fight.x, dy = b0.y - fight.y, d = hypot2(dx, dy);
      // the wave reaches it: lift (staggered), the farther the less sure
      if (wr >= 0 && s.wave !== fight.waveId) {
        const dw = hypot2(b0.x - fight.waveX, b0.y - fight.waveY);
        if (dw <= wr) {
          s.wave = fight.waveId;
          if (dw < F.reach && f.mode !== 'air' && R() < 1 - (1 - F.far) * clamp(dw / F.reach, 0, 1)) s.lift = rr(F.lift[0], F.lift[1]);
          continue;
        }
      }
      if ((s.chk -= dt) > 0) continue; s.chk = F.check;
      // a caller calls over the fight
      if (f.sp.caw && d < F.reach && (s.calls -= F.check) <= 0) {
        s.calls = rr(F.calls[0], F.calls[1]);
        if (K.emit('caw', b0.x, b0.y) && b0.st !== 'fly') b0.caw = .45;
      }
      if (f.mode === 'air') {   // wheel out: the circle's centre goes out to `keep`, and they don't land while it's on
        const cx = f.cx - fight.x, cy = f.cy - fight.y, dc = hypot2(cx, cy) || 1;
        if (dc < F.keep) {
          const k = Math.min(F.keep, dc + 7 * F.check) / dc, wb = ctx.bounds;
          f.cx = clamp(fight.x + cx * k, wb.x0 + 2, wb.x1 - 2); f.cy = clamp(fight.y + cy * k, wb.y0 + 2, wb.y1 - 2);
        }
        if (d < F.keep + 6) f.t = Math.max(f.t, .5);
      } else if (d < F.keep * .8 && s.put > F.again && (f.mode === 'land' || f.mode === 'feed' || f.mode === 'perch')) flush(f, s);
    }
  }
  // the high vultures (wildlife's: ember, desert) drift over the fight / the freshest kill while it lasts, and home after
  let VH = new WeakMap();
  function stepVultures() {
    const vs = K.vultures; if (!vs.length) return;
    const site = scav.freshest(), tx = site ? site.x : fight.x, ty = site ? site.y : fight.y, go = !!site || fight.on;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i]; let h = VH.get(v); if (!h) VH.set(v, h = {x: v.hx, y: v.hy});
      if (go && i < 2) { v.hx = tx + (i ? 3 : -3); v.hy = ty - 2; } else { v.hx = h.x; v.hy = h.y; }
    }
  }
  function restoreVultures() { for (const v of K.vultures) { const h = VH.get(v); if (h) { v.hx = h.x; v.hy = h.y; } } }

  // ---------------------------------------------------------------- the atlas (fightart.js: albedo + emit), per biome
  // SPR2[species][frame] = {sx, sy, w, h, ax, ay}; a canid's look frame also as look_g1 / look_g2 (its eyes lit)
  let ATL = null, ATE = null, SPR2 = {}, atlasBiome = null;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
  function buildAtlas(biome) {
    atlasBiome = biome; SPR2 = {}; ATL = ATE = null;
    const P = FPAL[biome]; if (!P) return;
    const defs = [];
    for (const [sp, f, rows, ax, ay] of frames(biome)) {
      const w = Math.max(...rows.map(r => r.length)), h = rows.length;
      defs.push({sp, f, rows, w, h, ax, ay, glow: 0});
      if (f === 'look' && EYESHINE[sp]) for (const g of [1, 2]) defs.push({sp, f: 'look_g' + g, rows, w, h, ax, ay, glow: g});
    }
    let x = 1, y = 1, rowH = 0; const W = 256;
    for (const d of defs) { if (x + d.w + 1 > W) { x = 1; y += rowH + 1; rowH = 0; } d.sx = x; d.sy = y; x += d.w + 1; rowH = Math.max(rowH, d.h); }
    ATL = mk(W, y + rowH + 1); ATE = mk(W, y + rowH + 1);
    const q = ATL.getContext('2d'), eq = ATE.getContext('2d');
    for (const d of defs) {
      const pal = P[d.sp];
      for (let yy = 0; yy < d.h; yy++) for (let xx = 0; xx < d.rows[yy].length; xx++) {
        const ch = d.rows[yy][xx]; if (ch === '.') continue;
        const col = ch >= '0' && ch <= '3' ? pal.r[+ch] : pal[ch]; if (!col) continue;
        q.fillStyle = col; q.fillRect(d.sx + xx, d.sy + yy, 1, 1);
        if (ch === 'e' && d.glow) { eq.fillStyle = EYESHINE[d.sp][d.glow - 1]; eq.fillRect(d.sx + xx, d.sy + yy, 1, 1); }
      }
      (SPR2[d.sp] ||= {})[d.f] = {sx: d.sx, sy: d.sy, w: d.w, h: d.h, ax: d.ax, ay: d.ay};
    }
  }
  // one frame of the fight atlas as a camera-facing sprite (mirrored facing screen-left), at x, y, h (one kept object)
  const S0 = {img: null, em: null, sx: 0, sy: 0, sw: 0, sh: 0, px: 0, py: 0, flip: false, x: 0, y: 0, h: 0, alpha: 1};
  function put2(s, x, y, h, face, alpha = 1) {
    if (!s || !ATL) return;
    const fl = face < 0, o = S0;
    o.img = ATL; o.em = ATE; o.sx = s.sx; o.sy = s.sy; o.sw = s.w; o.sh = s.h; o.px = fl ? s.w - 1 - s.ax : s.ax; o.py = s.ay; o.flip = fl;
    o.x = x; o.y = y; o.h = h; o.alpha = alpha; host.sprite(o);
  }

  // ---------------------------------------------------------------- the parts
  // what they share: K (wildlife's), the fight's state, the generator, the atlas
  const C = {K, host, ctx, R, rr, fight, TUNE, put2, get SPR2() { return SPR2; }, get on() { return FL.on && K.on; }};
  const scav = createScavengers(C); C.scav = () => scav;
  const canids = createCanids(C);

  // ---------------------------------------------------------------- wildlife's hooks
  FL.populate = () => {   // (wildlife.js populate: a new biome / world)
    FS = new Map(); VH = new WeakMap();
    fight.level = 0; fight.on = false; fight.wave = -1; fight.calm = 99; fight.shotT = 99;
    if (atlasBiome !== K.biome) buildAtlas(K.biome);
    scav.reset(); canids.reset();
  };
  FL.applyTime = () => { if (FL.on) canids.applyTime(); };   // (wildlife.js applyTime: day / dusk / night, rain)
  // the step (wildlife.js view, after its noise is gathered, before its flocks step)
  FL.view = (dt, evs) => {
    if (!FL.on) return;
    fight.shotT += dt; fight.calm += dt;
    events(evs);
    fight.level *= Math.exp(-dt / F.tau);
    if (fight.on && fight.level < F.low) fight.on = false;
    if (fight.wave >= 0) { fight.wave += F.wave * dt; if (fight.wave > F.reach + 2) fight.wave = -1; }
    FL.level = fight.level;
    stepFlocks(dt);
    scav.step(dt);
    canids.step(dt);
    stepVultures();
  };
  FL.ground = g => { if (FL.on) { scav.ground(g); canids.ground(g); } };   // (drawGround, before its last flush: wildlife's tints)
  FL.sprites = () => { if (FL.on) { scav.sprites(); canids.sprites(); } };   // (drawSprites, last)
  FL.setOn = v => {
    if (FL.on === !!v) return;
    FL.on = !!v;
    if (!FL.on) { restoreVultures(); scav.reset(); canids.reset(); fight.level = 0; fight.on = false; fight.wave = -1; for (const s of FS.values()) s.lift = -1; }
    else canids.applyTime();
  };
  FL.dbg = () => ({on: FL.on, level: +fight.level.toFixed(2), fightOn: fight.on, at: [+fight.x.toFixed(1), +fight.y.toFixed(1)], wave: +fight.wave.toFixed(1),
    calm: +fight.calm.toFixed(1), scav: scav.dbg(), canids: canids.dbg()});
  FL.sheet = (z = 6) => {   // the fight atlas (albedo over emit), zoomed, for review
    if (!ATL) return null;
    const c = mk(ATL.width * z, ATL.height * z * 2 + z), q = c.getContext('2d'); q.imageSmoothingEnabled = false;
    q.fillStyle = '#6a6d62'; q.fillRect(0, 0, c.width, c.height);
    q.drawImage(ATL, 0, 0, ATL.width * z, ATL.height * z); q.drawImage(ATE, 0, ATL.height * z + z, ATE.width * z, ATE.height * z);
    return c;
  };
  FL.fight = fight; FL.scav = scav; FL.canids = canids;
  return FL;
}
