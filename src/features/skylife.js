// SKYLIFE: life in the sky (docs/WORLDLIFE.md "Life in the sky"). Things high up show mostly as their SHADOWS sweeping over
// the ground (the top-down camera looks at the ground) and as themselves drawn high (the oblique view puts them far up the
// screen; the chase cam and first person look up at them).
//   GEESE        V formations (7-21 birds, wings beating, the V wobbling, the leader dropping back now and then) crossing the
//                whole map high up: north in spring, south in autumn, a few flights a day, mostly morning and evening; their
//                shadows slide over the ground. Some days a low flock comes down on the lake, sits there for hours and takes
//                off when a player comes near (or when its time is up).
//   MURMURATION  some summer / autumn dusks, a cloud of starlings over the lake or the fell: hundreds of points as one folding,
//                morphing shape (no boids: a flow field over fixed body coordinates, one point batch), a few minutes, then they
//                pour down into the reeds / the trees and are gone. Sprinting or jumping under it sends a wave through it.
//   DRIFTERS     some nights (and foggy dawns): one or two enormous slow sky creatures of pale light (a bell with long
//                tendrils, or a manta-whale with two trailing threads) cross the forest high up. The ground under one gets a
//                faint glow and colour; motes drift up toward it. They never touch play. Nobody explains them.
//   SHOOTING STARS  on clear nights a streak now and then (only streaks: nothing lands; the landing star is another feature's).
// MULTIPLAYER: pure view. Every flight is a pure function of the world's seed (FOREST.seed) and the shared clock (env.t, in-game
// hours; a day's plan from hash(seed, day)), so every co-op player sees the same geese at the same moment. What each client does
// on its own: the flock on the lake takes off when ANY player it knows (him, the co-op peers) comes near; the murmuration flinches
// at his own sprint. Nothing is sent, nothing saved. The dev menu's "now" rows are local (only you see them).
// ?sky=0 off, ?sky=often everything far more often (testing). Dev menu (F10) > Nature > Sky: the "now" rows.
// OWNS: its plan cache, its view state (lake flocks' flush, the wave, the motes), the grade source 'skylife' (env.setGrade),
//   its atlases. READS: host.env (t, day, hour, part, season, seasonLock, light, sunView, spellAt, TUNE), host.mood (the sun),
//   FOREST (seed, lake, mountain), host.player, coop (online, peers), caves (down), game (mode, ui.toast).
// EMITS: sky.geese, sky.murmuration, sky.drifter (when one starts in the world: for sound later).
// BUDGET: the plan: a handful of hashes a day (cached); a frame: ~21 geese sprites + shadows, a murmuration's ~820 points
//   (sines), a drifter's ~350 lines; no allocation per frame (reused records and arrays).
import {flags} from '../core/flags.js';
import {FOREST} from '../world/layout.js';
import {hash3, clamp, smooth, clearArray, TAU} from '../core/mathx.js';
import {mulberry32, viewRandom} from '../core/rng.js';
import {seasonAt, TUNE as WXT} from '../sim/wxclock.js';

const FLAG = flags.get('sky'), ON = FLAG !== '0' && !!FOREST, OFTEN = FLAG === 'often';
const HSEC = 50;   // real s an in-game hour at the default day (sim/env.js TUNE.dayMinutes 20): the schedule's own yardstick
export const TUNE = {
  geese: {n: [7, 21], alt: [36, 46], speed: [9, 11.5], len: 380, gap: 1.6, angle: .6, period: [9, 15], flap: 3.1},
  lake: {n: [5, 11], approach: 26, stay: [2.5, 5], flush: 11, leave: 26},   // approach / leave: real s; stay: in-game h
  murm: {n: 820, arrive: 18, swirl: 60, pour: 18, alt: [12, 18]},           // real s
  drift: {alt: [27, 33], speed: [2, 2.6], len: 300, near: 40},              // near: m (the glow, the light, the motes)
  stars: {dur: .9},
};
// where a crossing passes over: the forest and the ruins south of it (world/forest.js RECT, a little in)
const BOX = {x0: -44, x1: 68, y0: -150, y1: 12};
// colours (the geese's: Canada goose, from above)
const BODY = [110, 98, 86], WING = [92, 82, 72], TIP = [56, 50, 45], NECK = [30, 27, 25], CHIN = [226, 222, 212], RUMP = [218, 212, 200], TAIL = [40, 36, 33];
const FLAP = [0, 1, 2, 1];   // the wingbeat: up, out, down, out
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const order = {after: ['coop']};   // (co-op's peers this step: who the lake's flock sees)

export async function create(host) {
  const F = {name: 'skylife', label: 'Sky', on: ON, ambient: true};
  if (!ON) return Object.assign(F, {dbg: () => ({off: FOREST ? '?sky=0' : 'no forest'})});
  const G = host.G, env = host.env, P = host.player, L = FOREST.lake, MT = FOREST.mountain;
  const SEED = (FOREST.seed ^ 0x5c1f3) >>> 0;
  const game = () => host.feature('game'), coop = () => host.feature('coop'), caves = () => host.feature('caves');
  const active = () => F.on && host.biome?.id === 'ruins' && game()?.mode === 'sandbox' && !!host.layout?.forest && !caves()?.down;
  const surf = L.bed - .18;   // the lake's surface (world/forest.js WATER_H)
  const VR = viewRandom('skylife');

  // ================================================================ THE PLAN: a day's flights from (seed, day), cached
  const plans = new Map();
  let planSeason = -1;
  const seasonOf = d => env.seasonLock || seasonAt(d * 24 + 12, env.TUNE?.seasonDays ?? WXT.seasonDays);
  let uid = 1;
  function geese(R, d, hour, ang, low) {
    const T = TUNE.geese, n = T.n[0] + Math.floor(R() * (T.n[1] - T.n[0] + 1)), v = T.speed[0] + R() * (T.speed[1] - T.speed[0]);
    const px = BOX.x0 + R() * (BOX.x1 - BOX.x0), py = BOX.y0 + R() * (BOX.y1 - BOX.y0), ux = Math.cos(ang), uy = Math.sin(ang);
    return {id: uid++, kind: 'geese', t0: d * 24 + hour, t1: d * 24 + hour + T.len / v / HSEC, ax: px - ux * T.len / 2, ay: py - uy * T.len / 2,
      ux, uy, len: T.len, n, alt: T.alt[0] + R() * (T.alt[1] - T.alt[0]), seed: R() * 4294967296 >>> 0, period: T.period[0] + R() * (T.period[1] - T.period[0]), low};
  }
  function lake(R, d, hour) {
    const T = TUNE.lake, n = T.n[0] + Math.floor(R() * (T.n[1] - T.n[0] + 1)), a = R() * TAU, stay = T.stay[0] + R() * (T.stay[1] - T.stay[0]);
    const tl = d * 24 + hour + T.approach / HSEC;
    return {id: uid++, kind: 'lake', t0: d * 24 + hour, tl, tu: tl + stay, t1: tl + stay + T.leave / HSEC, ux: Math.cos(a), uy: Math.sin(a), n,
      x: L.x + (R() - .5) * L.rx * .5, y: L.y + (R() - .5) * L.ry * .5, seed: R() * 4294967296 >>> 0};
  }
  function murm(R, d, hour) {
    const T = TUNE.murm, onLake = R() < .6, a = R() * TAU, b = R() * TAU;
    let cx, cy, ch, rx, ry;
    if (onLake) { cx = L.x; cy = L.y - 2; ch = surf + T.alt[0] + R() * (T.alt[1] - T.alt[0]); rx = L.x + Math.cos(a) * (L.rx + .4); ry = L.y + Math.sin(a) * (L.ry + .4); }
    else { cx = MT.x + Math.cos(b) * MT.r * .3; cy = MT.y + Math.sin(b) * MT.r * .3; ch = host.elev(cx, cy) + T.alt[0] + R() * (T.alt[1] - T.alt[0]); rx = MT.x + Math.cos(a) * MT.r * .95; ry = MT.y + Math.sin(a) * MT.r * .95; }
    const dur = (T.arrive + T.swirl + T.pour + 6) / HSEC;
    return {id: uid++, kind: 'murm', t0: d * 24 + hour, t1: d * 24 + hour + dur, cx, cy, ch, rx, ry, rh: host.elev(rx, ry) + .7, ix: Math.cos(b + 2), iy: Math.sin(b + 2), where: onLake ? 'the lake' : 'the fell'};
  }
  function drifter(R, d, hour) {
    const T = TUNE.drift, a = R() * TAU, v = T.speed[0] + R() * (T.speed[1] - T.speed[0]), ux = Math.cos(a), uy = Math.sin(a);
    const px = -30 + R() * 80, py = -140 + R() * 130;   // over the forest
    const jelly = R() < .6;
    return {id: uid++, kind: 'drift', t0: d * 24 + hour, t1: d * 24 + hour + T.len / v / HSEC, ax: px - ux * T.len / 2, ay: py - uy * T.len / 2, ux, uy, len: T.len,
      alt: T.alt[0] + R() * (T.alt[1] - T.alt[0]), type: jelly ? 'jelly' : 'manta', size: jelly ? 4.6 + R() * 1.6 : 7 + R() * 2.5, hue: R(), seed: R() * 4294967296 >>> 0};
  }
  const north = R => -Math.PI / 2 + (R() - .5) * .7, south = R => Math.PI / 2 + (R() - .5) * .7;
  function makePlan(d) {
    const out = [], s = seasonOf(d), R = mulberry32((SEED ^ Math.imul(d + 7919, 2654435761)) >>> 0);
    // geese: spring north, autumn south, mostly morning (5.6-9) and evening (16-20); a stray flock in summer, rarely winter
    let ng = s === 'spring' || s === 'autumn' ? 2 + Math.floor(R() * 3) : s === 'summer' ? (R() < .35 ? 1 : 0) : (R() < .15 ? 1 : 0);
    if (OFTEN) ng = 12;
    for (let k = 0; k < ng; k++) {
      const hour = OFTEN ? 5 + k * 1.3 + R() * .8 : R() < .6 ? 5.6 + R() * 3.4 : 16.2 + R() * 3.8;
      const ang = s === 'spring' ? north(R) : s === 'autumn' || s === 'winter' ? south(R) : R() * TAU;
      out.push(geese(R, d, hour, ang, false));
    }
    // a flock comes down on the lake (a migration stop: spring and autumn; now and then in summer)
    const pl = s === 'spring' || s === 'autumn' ? .45 : s === 'summer' ? .2 : 0;
    if (OFTEN) { out.push(lake(R, d, 7)); out.push(lake(R, d, 14.5)); } else if (R() < pl) out.push(lake(R, d, R() < .6 ? 7 + R() * 3 : 15.5 + R() * 2.5));
    // the murmuration: some summer / autumn dusks
    const pm = s === 'summer' ? .45 : s === 'autumn' ? .55 : 0;
    if (OFTEN) { out.push(murm(R, d, 18.4)); out.push(murm(R, d, 10.5)); out.push(murm(R, d, 15)); } else if (R() < pm) out.push(murm(R, d, 18.15 + R() * .9));
    // drifters: some nights (one, rarely two), and foggy dawns
    if (OFTEN) { for (const h of [21.5, 23.5, 25.8, 12.5]) out.push(drifter(R, d, h)); }
    else {
      const r1 = R(), r2 = R(), h1 = 21.3 + R() * 4.5, h2 = 21.5 + R() * 4.5, rf = R(), hf = 5 + R() * 1.2;
      if (r1 < .33) out.push(drifter(R, d, h1));
      if (r1 < .33 && r2 < .25) out.push(drifter(R, d, h2));
      const fog = env.spellAt?.(d * 24 + 6)?.w;
      if ((fog === 'fog' || fog === 'haze') && rf < .6) out.push(drifter(R, d, hf));
    }
    return out;
  }
  function planOf(d) {
    let p = plans.get(d); if (p) return p;
    p = makePlan(d); plans.set(d, p);
    if (plans.size > 5) for (const k of plans.keys()) if (Math.abs(k - d) > 2) plans.delete(k);
    return p;
  }

  // the forced ones (the dev menu's "now": local, only you see them)
  const forced = [];
  function nowGeese() {
    const R = mulberry32(VR() * 4294967296 >>> 0), s = env.season, ang = s === 'autumn' || s === 'winter' ? south(R) : s === 'spring' ? north(R) : R() * TAU;
    const e = geese(R, 0, 0, ang, false), lead = 55, dur = e.t1 - e.t0;   // its leader 55 m short of being over you
    e.ax = P.x - e.ux * lead; e.ay = P.y - e.uy * lead; e.t0 = env.t; e.t1 = env.t + dur;
    forced.push(e);
  }
  function nowLake() { const R = mulberry32(VR() * 4294967296 >>> 0), e = lake(R, 0, 0), dt = e.t1 - e.t0; e.tl = env.t + (e.tl - e.t0); e.tu = env.t + (e.tu - e.t0); e.t0 = env.t; e.t1 = e.t0 + dt; forced.push(e); }
  // the way up the screen on the ground (the camera's yaw): a thing h m up shows ~1.15 h m that way from its ground point
  const upX = () => -Math.sin(host.yaw ?? 0), upY = () => -Math.cos(host.yaw ?? 0);
  function nowMurm(near) {
    const R = mulberry32(VR() * 4294967296 >>> 0), e = murm(R, 0, 0), dt = e.t1 - e.t0; e.t0 = env.t; e.t1 = env.t + dt;
    if (near) {   // just toward the camera from you (so the top-down view has it on screen), down into the trees round you
      e.cx = P.x - upX() * 8; e.cy = P.y - upY() * 8; e.ch = host.elev(P.x, P.y) + 13; const a = VR() * TAU; e.rx = P.x + Math.cos(a) * 14; e.ry = P.y + Math.sin(a) * 14; e.rh = host.elev(e.rx, e.ry) + .7; e.where = 'you';
    }
    forced.push(e);
  }
  function nowDrifter(type) {
    const R = mulberry32(VR() * 4294967296 >>> 0), e = drifter(R, 0, 0), dt = e.t1 - e.t0;
    if (type) { e.type = type; e.size = type === 'jelly' ? 5.4 : 8; }
    // up the screen, its ground point 52 m short of you: its body crosses the top-down view first (~5 s), then it is over you
    // (its glow on the ground, the tendrils) at ~20 s
    const a = Math.atan2(upY(), upX()) + (VR() - .5) * .5; e.ux = Math.cos(a); e.uy = Math.sin(a);
    e.ax = P.x - e.ux * 52; e.ay = P.y - e.uy * 52; e.t0 = env.t; e.t1 = env.t + dt;
    forced.push(e);
  }
  const STARF = [];
  function nowStar() { STARF.push({t0: env.t, r1: VR(), r2: VR(), r3: VR()}); }

  // ================================================================ WHAT IS UP NOW (every view step)
  const live = [], seen = new Set(), told = new Set();
  function gather() {
    clearArray(live);
    const t = env.t, d = Math.floor(t / 24);
    if (env.ver?.season !== planSeason) { planSeason = env.ver?.season; plans.clear(); }
    for (let dd = d - 1; dd <= d + 1; dd++) { const p = planOf(dd); for (let i = 0; i < p.length; i++) { const e = p[i]; if (t >= e.t0 && t <= e.t1) live.push(e); } }
    for (let i = forced.length - 1; i >= 0; i--) { const e = forced[i]; if (t > e.t1 + .01 || t < e.t0 - 1) forced.splice(i, 1); else live.push(e); }
    for (let i = 0; i < live.length; i++) {
      const e = live[i]; if (seen.has(e)) continue;
      seen.add(e);
      host.events.push({type: e.kind === 'drift' ? 'sky.drifter' : e.kind === 'murm' ? 'sky.murmuration' : 'sky.geese', x: e.cx ?? e.x ?? e.ax, y: e.cy ?? e.y ?? e.ay, kind: e.kind});
    }
    if (seen.size > 64) for (const e of seen) if (!live.includes(e)) seen.delete(e);
  }

  // ================================================================ THE ART (painted once)
  const GC = 16, DIRS = 16;
  function gooseAt(f, s, fr) {   // a goose from above, f forward / s right (px), fr 0 wings up, 1 out, 2 down
    const a = Math.abs(s);
    if (f >= 5.4 && f <= 7.2 && a <= 1.05) return f < 6.1 && a > .4 ? CHIN : NECK;
    if (f >= 2.8 && f < 5.4 && a <= .72) return NECK;
    if ((f / 3.7) ** 2 + (s / 1.5) ** 2 <= 1) return f < -2.9 ? TAIL : f < -2.1 ? RUMP : BODY;
    const span = fr === 0 ? 4.4 : fr === 1 ? 7.3 : 5.9, sweep = fr === 2 ? .14 : fr === 0 ? -.3 : -.08;
    if (a >= 1 && a <= span) { const lead = 1.3 + sweep * (a - 1) - .06 * (a - 1), chord = 2.5 - .24 * (a - 1); if (f <= lead && f >= lead - chord) return a > span - 2.2 ? TIP : WING; }
    return null;
  }
  // GEESE: 16 headings (0 = up the screen, clockwise) x 3 wing frames; the rows below: the same in black (their shadows)
  const ATL = document.createElement('canvas'); ATL.width = GC * DIRS; ATL.height = GC * 6;
  {
    const q = ATL.getContext('2d'), im = q.createImageData(ATL.width, ATL.height), D = im.data, W = ATL.width;
    const put = (x, y, c, a) => { const i = (y * W + x) * 4; D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = a; };
    for (let fr = 0; fr < 3; fr++) for (let k = 0; k < DIRS; k++) {
      const psi = k / DIRS * TAU, sn = Math.sin(psi), cs = Math.cos(psi);
      for (let py = 0; py < GC; py++) for (let px = 0; px < GC; px++) {
        const dx = px + .5 - GC / 2, dy = py + .5 - GC / 2, c = gooseAt(dx * sn - dy * cs, dx * cs + dy * sn, fr);
        if (!c) continue;
        put(k * GC + px, fr * GC + py, c, 255); put(k * GC + px, (fr + 3) * GC + py, NECK, 255);
      }
    }
    q.putImageData(im, 0, 0);
  }
  // A GOOSE ON THE WATER (side view, facing left; flip for right): 0 sitting, 1 head down (feeding)
  const SW = 16, SH = 10, SIDE = document.createElement('canvas'); SIDE.width = SW * 2; SIDE.height = SH;
  {
    const q = SIDE.getContext('2d'), im = q.createImageData(SW * 2, SH), D = im.data;
    const put = (x, y, c) => { if (x < 0 || y < 0 || x >= SW * 2 || y >= SH) return; const i = (y * SW * 2 + x) * 4; D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255; };
    for (let fr = 0; fr < 2; fr++) {
      const o = fr * SW;
      for (let y = 4; y < SH; y++) for (let x = 3; x < 16; x++) { const u = (x + .5 - 9.5) / 5.6, v = (y + .5 - 7.6) / 2.3; if (u * u + v * v <= 1) put(o + x, y, y >= 8 ? NECK : x >= 13 ? (y >= 7 ? RUMP : TAIL) : y <= 5 ? WING : BODY); }
      if (fr === 0) { for (let y = 1; y < 7; y++) put(o + 4, y, NECK); for (let y = 0; y < 3; y++) { put(o + 2, y + 1, NECK); put(o + 3, y, NECK); } put(o + 3, 1, CHIN); put(o + 3, 2, CHIN); put(o + 1, 2, NECK); }
      else { for (let x = 1; x < 5; x++) put(o + x, 6, NECK); put(o + 0, 7, NECK); put(o + 1, 7, NECK); put(o + 2, 5, CHIN); }
    }
    q.putImageData(im, 0, 0);
  }
  // DRIFTERS: a bell (4 pulse frames) and a manta (4 wing frames, nose up), pale light with alpha; the glow under them
  const JW = 144, JH = 96, MW = 192, MH = 120, ZD = 2;   // (painted at 2x: finer pixels at their size)
  const BELL = [], MANTA = [];
  const lightCol = (k, hue) => [Math.round(150 + 70 * k * hue), Math.round(212 - 40 * k), 255];
  function paintJelly(sq) {
    const c = document.createElement('canvas'); c.width = JW; c.height = JH;
    const q = c.getContext('2d'), im = q.createImageData(JW, JH), D = im.data;
    const rw = 34 * (1 - .13 * sq), hb = 24 * (1 + .1 * sq), rim = 6 + hb;
    const lobes = [[-9, .45], [-3, .58], [3, .58], [9, .45]];
    for (let y = 0; y < JH; y++) for (let x = 0; x < JW; x++) {
      const u = (x + .5 - JW / 2) / ZD, yy = (y + .5) / ZD; let I = 0, e = 1;
      if (yy <= rim) {
        e = (u / rw) ** 2 + ((rim - yy) / hb) ** 2; if (e > 1) continue;
        I = .14 + .62 * e ** 5 + .1 * (1 - e);
        for (const [lx, ly] of lobes) { const dd = Math.hypot(u - lx * (1 - .1 * sq), yy - (rim - hb * ly)); if (Math.abs(dd - 2.8) < .9) I += .42; }
        if (Math.abs(u) < 1 && yy > rim - hb * .8) I += .12;   // (the stalk of light down its middle)
      } else {
        const k = yy - rim; if (Math.abs(u) > rw * .93 || k > 3.2 + 1.8 * Math.sin(u * .75 + sq * 3)) continue;
        I = .34 - k * .04; e = .8;
      }
      I += (BAYER[(y & 3) * 4 + (x & 3)] / 16 - .5) * .14;
      if (I < .1) continue;
      const a = Math.min(1, Math.round(I * 5) / 5), col = lightCol(Math.min(1, e), .9), i = (y * JW + x) * 4;
      D[i] = col[0]; D[i + 1] = col[1]; D[i + 2] = col[2]; D[i + 3] = Math.round(a * 255);
    }
    q.putImageData(im, 0, 0); return c;
  }
  function paintManta(fl) {
    const c = document.createElement('canvas'); c.width = MW; c.height = MH;
    const q = c.getContext('2d'), im = q.createImageData(MW, MH), D = im.data, sp = 46 * (1 - .2 * fl), tipV = 4 + 6 * fl;
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const u = (x + .5 - MW / 2) / ZD, v = (y + .5 - MH / 2) / ZD + 4, a = Math.abs(u);
      let I = 0, e = 0;
      if (v > -22 && v < 18) {
        // the wing's edge at this row: widest at tipV, swept back toward it
        const k = v < tipV ? (v + 22) / (tipV + 22) : 1 - (v - tipV) / (18 - tipV), hw = sp * Math.pow(Math.max(0, Math.sin(k * Math.PI / 2)), v < tipV ? .7 : 1.6);
        const bodyW = 7 * (1 - Math.abs(v) / 26);
        const w = Math.max(hw, bodyW); if (a > w) { /* outside */ } else {
          e = a / Math.max(1, w); I = .12 + .55 * e ** 6 + (a < bodyW ? .2 : 0) + .1 * Math.max(0, Math.sin(a * .55 - v * .25));
          if (a < 1.2) I += .2;
        }
      }
      if (v >= -27 && v <= -20 && a >= 3 && a <= 7) { I = Math.max(I, .45); e = 1; }   // (the head's two horns)
      I += (BAYER[(y & 3) * 4 + (x & 3)] / 16 - .5) * .14;
      if (I < .1) continue;
      const al = Math.min(1, Math.round(I * 5) / 5), col = lightCol(Math.min(1, e), .5), i = (y * MW + x) * 4;
      D[i] = col[0]; D[i + 1] = col[1]; D[i + 2] = col[2]; D[i + 3] = Math.round(al * 255);
    }
    q.putImageData(im, 0, 0); return c;
  }
  for (let f = 0; f < 4; f++) { BELL.push(paintJelly([0, .5, 1, .5][f])); MANTA.push(paintManta([0, .5, 1, .5][f])); }
  const POOL = document.createElement('canvas'); POOL.width = POOL.height = 48;
  {
    const q = POOL.getContext('2d'), im = q.createImageData(48, 48), D = im.data;
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      const r = Math.hypot(x + .5 - 24, y + .5 - 24) / 24; if (r >= 1) continue;
      const I = (1 - r * r) ** 2 + (BAYER[(y & 3) * 4 + (x & 3)] / 16 - .5) * .3; if (I < .12) continue;
      const a = Math.min(1, Math.round(I * 4) / 4), i = (y * 48 + x) * 4; D[i] = 110; D[i + 1] = 190; D[i + 2] = 235; D[i + 3] = Math.round(a * 255);
    }
    q.putImageData(im, 0, 0);
  }
  const SHADE = document.createElement('canvas'); SHADE.width = SHADE.height = 32;   // a drifter's soft shadow by day
  {
    const q = SHADE.getContext('2d'), im = q.createImageData(32, 32), D = im.data;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const r = Math.hypot(x + .5 - 16, y + .5 - 16) / 16; if (r >= 1) continue;
      if ((1 - r) * 1.6 + (BAYER[(y & 3) * 4 + (x & 3)] / 16 - .5) < .5) continue;
      const i = (y * 32 + x) * 4; D[i] = 20; D[i + 1] = 26; D[i + 2] = 34; D[i + 3] = 255;
    }
    q.putImageData(im, 0, 0);
  }

  // ================================================================ DRAWING HELPERS (reused, no allocation)
  const O3 = [0, 0, 0], O4 = [0, 0, 0], O5 = [0, 0, 0];
  const SP = {img: null, sx: 0, sy: 0, sw: 0, sh: 0, x: 0, y: 0, h: 0, px: 0, py: 0, flip: false, type: 3, alpha: 1};
  // a world heading (x east, y south) -> the atlas column (its angle on the screen, 0 up, clockwise)
  function dirCell(ux, uy) {
    const a = host.viewYaw ?? host.yaw ?? 0, RX = Math.cos(a), RY = -Math.sin(a), FX = Math.sin(a), FY = Math.cos(a);
    const sx = ux * RX + uy * RY, sy = ux * FX + uy * FY, psi = Math.atan2(sx, -sy);
    return ((Math.round(psi / TAU * DIRS) % DIRS) + DIRS) % DIRS;
  }
  const screenAng = (ux, uy) => { const a = host.viewYaw ?? host.yaw ?? 0, sx = ux * Math.cos(a) - uy * Math.sin(a), sy = ux * Math.sin(a) + uy * Math.cos(a); return Math.atan2(sx, -sy); };
  // the sun's shadow offset per metre of height (x, y) and how strong shadows are now
  const SUN = {ox: 0, oy: 0, k: 0};
  function sunNow() {
    const m = host.mood, s = m?.sun; if (!s) { SUN.k = 0; return; }
    const az = s.az * Math.PI / 180, el = Math.max(.42, Math.tan(Math.max(5, s.el) * Math.PI / 180)), fx = Math.sin(az), fy = -Math.cos(az);
    SUN.ox = -fx / el; SUN.oy = -fy / el;
    const day = env.part === 'day' ? 1 : env.part === 'night' ? .3 : .6;
    SUN.k = day * (env.sunView ?? 1);
  }
  const inView = (X, Y, m) => X > -m && Y > -m && X < host.VW + m && Y < host.VH + m;

  // ================================================================ GEESE
  const GEO = new Map();   // flight -> its V (who flies where, between two leader changes)
  const SHD = [0, 0, 0, 0, 0, 0, 0];   // (tests: the leader's shadow last drawn: view px, ground, bird)
  function vOf(e, c) {   // the V after c leader changes: [lead, armL..., armR...] -> per bird (back, side) in units
    const R = mulberry32(e.seed), Lr = [], Rr = []; let lead = 0;
    for (let b = 1; b < e.n; b++) (R() < .5 + (Lr.length < Rr.length ? .22 : -.22) ? Lr : Rr).push(b);
    for (let k = 0; k < c; k++) {
      const old = lead, from = (k & 1 ? Lr : Rr).length ? (k & 1 ? Lr : Rr) : (k & 1 ? Rr : Lr);
      if (!from.length) break;
      lead = from.shift(); (Lr.length <= Rr.length ? Lr : Rr).push(old);
    }
    const out = new Float32Array(e.n * 2);
    out[lead * 2] = 0; out[lead * 2 + 1] = 0;
    Lr.forEach((b, i) => { out[b * 2] = i + 1; out[b * 2 + 1] = -(i + 1); });
    Rr.forEach((b, i) => { out[b * 2] = i + 1; out[b * 2 + 1] = i + 1; });
    return out;
  }
  function geeseState(e, s) {
    const c = Math.floor(s / e.period);
    let st = GEO.get(e);
    if (!st || st.c !== c) { st = {c, A: vOf(e, c), B: vOf(e, c + 1)}; GEO.set(e, st); }
    return st;
  }
  function drawGeese(e, t, T) {
    const s = (t - e.t0) * HSEC, k = (t - e.t0) / (e.t1 - e.t0), dist = k * e.len;
    const lx = e.ax + e.ux * dist, ly = e.ay + e.uy * dist;
    // far from everything he could see: skip (the body shows ~1.2 h north of its ground point on screen, the shadow off by the sun)
    if (Math.abs(lx - P.x) > 140 || Math.abs(ly - P.y) > 140) return;
    const st = geeseState(e, s), ph = (s / e.period) % 1, m = smooth((ph - .72) / .28);
    const th = TUNE.geese.angle + .07 * Math.sin(s * .21 + e.seed), gap = TUNE.geese.gap, cb = Math.cos(th) * gap, cs = Math.sin(th) * gap;
    const px = -e.uy, py = e.ux, cell = dirCell(e.ux, e.uy), g = host.glayer('ground'), elev0 = host.elev(lx, ly);
    const sh = SUN.k > .03, ppm = sh ? G.pxPerM(lx, elev0, ly) / host.PPM : 0;
    for (let b = 0; b < e.n; b++) {
      const r0 = st.A[b * 2], s0 = st.A[b * 2 + 1], r1 = st.B[b * 2], s1 = st.B[b * 2 + 1];
      const rk = r0 + (r1 - r0) * m, sk = s0 + (s1 - s0) * m;
      const back = rk * cb + .3 * Math.sin(s * .5 + b * 2.1), side = sk * cs + .35 * Math.sin(s * .7 + b * 1.3) + (s1 !== s0 && Math.sign(s1) !== Math.sign(s0) ? Math.sin(m * Math.PI) * 1.2 : 0);
      const x = lx - e.ux * back + px * side, y = ly - e.uy * back + py * side, h = e.alt + .4 * Math.sin(s * .4 + b) - rk * .08;
      const glide = Math.sin(s * .3 + b * 1.7) > .86, fl = glide ? 1 : FLAP[Math.floor((T * TUNE.geese.flap + b * .37) * 4) & 3];
      SP.img = ATL; SP.sx = cell * GC; SP.sy = fl * GC; SP.sw = GC; SP.sh = GC; SP.x = x; SP.y = y; SP.h = h; SP.px = GC / 2; SP.py = GC / 2; SP.flip = false;
      host.sprite(SP);
      if (sh) {
        const ha = h - elev0, gx = x + SUN.ox * ha, gy = y + SUN.oy * ha;
        G.toScreenInto(gx, host.elev(gx, gy), gy, O3);
        if (rk === 0) { SHD[0] = O3[0]; SHD[1] = O3[1]; SHD[2] = gx; SHD[3] = gy; SHD[4] = x; SHD[5] = y; SHD[6] = h; }
        if (inView(O3[0], O3[1], 30)) {   // a soft penumbra, then the core
          const w = GC * ppm * 1.6, w2 = GC * ppm * 1.1;
          g.globalAlpha = .26 * SUN.k; g.drawImage(ATL, cell * GC, (fl + 3) * GC, GC, GC, Math.round(O3[0] - w / 2), Math.round(O3[1] - w / 2), w, w);
          g.globalAlpha = .5 * SUN.k; g.drawImage(ATL, cell * GC, (fl + 3) * GC, GC, GC, Math.round(O3[0] - w2 / 2), Math.round(O3[1] - w2 / 2), w2, w2);
        }
      }
    }
    if (sh) g.globalAlpha = 1;
  }

  // ================================================================ THE FLOCK ON THE LAKE
  const LR = mulberry32(1);   // (re-seeded per flock per frame: its birds' places, no new generator a frame)
  const LST = new Map();   // flight -> {up: in-game h it took off (scared or its time), dx, dy}
  const near = {d: 1e9, x: 0, y: 0};
  function nearestPlayer(x, y) {   // him and the co-op peers he knows
    near.d = Math.hypot(P.x - x, P.y - y); near.x = P.x; near.y = P.y;
    const C = coop(); if (C?.online && C.peers) for (const q of C.peers.values()) {
      if (!q.n || !q.X) continue; const i = (q.head - 1 + q.X.length) % q.X.length, d = Math.hypot(q.X[i] - x, q.Y[i] - y);
      if (d < near.d) { near.d = d; near.x = q.X[i]; near.y = q.Y[i]; }
    }
    return near;
  }
  function drawLake(e, t, T) {
    let st = LST.get(e); if (!st) { st = {up: e.tu, dx: e.ux, dy: e.uy}; LST.set(e, st); }
    if (t >= e.tl && t < st.up) {   // sitting: does anyone come near?
      const n = nearestPlayer(e.x, e.y);
      if (n.d < TUNE.lake.flush) { st.up = t; const d = Math.max(.1, n.d); st.dx = (e.x - n.x) / d; st.dy = (e.y - n.y) / d; }
    }
    if (t > st.up + TUNE.lake.leave / HSEC) return;
    if (Math.abs(e.x - P.x) > 120 || Math.abs(e.y - P.y) > 120) return;
    const R = LR; R.seed(e.seed); const cellIn = dirCell(e.ux, e.uy), cellOut = dirCell(st.dx, st.dy), g = host.glayer('ground');
    const a0 = host.viewYaw ?? host.yaw ?? 0;
    for (let b = 0; b < e.n; b++) {
      const ra = R() * TAU, rr = Math.sqrt(R()) * 2.6, ox = Math.cos(ra) * rr * 1.3, oy = Math.sin(ra) * rr, ph = R() * TAU, dl = R();
      const hx = e.x + ox, hy = e.y + oy;
      let x, y, h, fl = -1, side = 0, cell = cellIn;
      if (t < e.tl) {   // coming in: down out of the sky along its way, wings set at the last
        const k = (t - e.t0) / (e.tl - e.t0), q = 1 - (1 - k) * (1 - k), rank = b === 0 ? 0 : Math.ceil(b / 2), sd = b & 1 ? -1 : 1;
        const sx = hx - e.ux * 110 - e.ux * rank * 1.4 * (1 - k) - e.uy * sd * rank * 1.1 * (1 - k), sy = hy - e.uy * 110 - e.uy * rank * 1.4 * (1 - k) + e.ux * sd * rank * 1.1 * (1 - k);
        x = sx + (hx - sx) * q; y = sy + (hy - sy) * q; h = surf + 24 * Math.pow(1 - k, 1.6) + .05;
        fl = k > .82 ? 1 : FLAP[Math.floor((T * 3 + b * .37) * 4) & 3];
        if (k > .97) side = 1;
      } else if (t < st.up) side = 1;
      else {   // off: running over the water, then up and away
        const tau = Math.max(0, (t - st.up) * HSEC - dl * 1.4);
        const run = 2.2 * tau + 1.4 * tau * tau;
        x = hx + st.dx * run; y = hy + st.dy * run; h = surf + .05 + Math.pow(Math.max(0, tau - .5), 1.6) * 1.1;
        fl = FLAP[Math.floor((T * 4.5 + b * .37) * 4) & 3]; cell = cellOut;
        if (tau <= 0) side = 1;
      }
      if (side) {   // on the water: bobbing, drifting a little, now and then a head under
        const s = (t - e.tl) * HSEC, wx = Math.cos(s * .05 + ph) * .7, wy = Math.sin(s * .041 + ph) * .5;
        x = hx + wx; y = hy + wy; h = surf - .02 + Math.sin(T * 1.6 + ph) * .025;
        const vx = -Math.sin(s * .05 + ph), vy = Math.cos(s * .041 + ph) * .8, scr = vx * Math.cos(a0) - vy * Math.sin(a0);
        const feed = hash3(e.seed, Math.floor(s / 4 + ph), b) < .22 ? 1 : 0;
        SP.img = SIDE; SP.sx = feed * SW; SP.sy = 0; SP.sw = SW; SP.sh = SH; SP.x = x; SP.y = y; SP.h = h; SP.px = SW / 2; SP.py = SH - 2; SP.flip = scr > 0;
        host.sprite(SP); SP.flip = false;
        continue;
      }
      SP.img = ATL; SP.sx = cell * GC; SP.sy = fl * GC; SP.sw = GC; SP.sh = GC; SP.x = x; SP.y = y; SP.h = h; SP.px = GC / 2; SP.py = GC / 2;
      host.sprite(SP);
      if (SUN.k > .03) {   // its shadow (on the water, the ground)
        const ha = h - surf, gx = x + SUN.ox * ha, gy = y + SUN.oy * ha, gh = Math.max(surf, host.elev(gx, gy));
        G.toScreenInto(gx, gh, gy, O3);
        if (inView(O3[0], O3[1], 20)) { const w = GC * G.pxPerM(gx, gh, gy) / host.PPM; g.globalAlpha = .42 * SUN.k; g.drawImage(ATL, cell * GC, (fl + 3) * GC, GC, GC, Math.round(O3[0] - w / 2), Math.round(O3[1] - w / 2), w, w); g.globalAlpha = 1; }
      }
    }
  }

  // ================================================================ THE MURMURATION
  const MN = TUNE.murm.n, MU = new Float32Array(MN * 3), MH1 = new Float32Array(MN), MH2 = new Float32Array(MN);
  {
    const R = mulberry32(0x57a1);
    for (let i = 0; i < MN; i++) {
      let a, b, c; do { a = R() * 2 - 1; b = R() * 2 - 1; c = R() * 2 - 1; } while (a * a + b * b + c * c > 1);
      const k = .5 + .5 * Math.sqrt(a * a + b * b + c * c); a *= k; b *= k; c *= k;   // (a denser core: the flock reads as one dark mass, thinning at its edges)
      MU[i * 3] = a; MU[i * 3 + 1] = b; MU[i * 3 + 2] = c; MH1[i] = R(); MH2[i] = (a + 1) / 2 * .7 + R() * .3;
    }
  }
  // A STARLING: a 5 x 3 px bird seen from below / above, 3 wing frames (up 'v', level, down) x 2 tones (near-black, a dusky
  // brown for the ones further in); each bird beats its wings on its own phase, now and then a short glide (frame 1), so the
  // cloud flickers like a real flock instead of reading as loose specks (he asked "what are those black particles")
  const BW = 5, BH = 3, BIRD = document.createElement('canvas'); BIRD.width = BW * 3; BIRD.height = BH * 2;
  {
    const FR = [['x...x', '.x.x.', '..x..'], ['.....', 'xxxxx', '..x..'], ['.....', '.xxx.', 'x.x.x']], TONE = ['#14111a', '#2a2420'];
    const q = BIRD.getContext('2d');
    for (let t = 0; t < 2; t++) { q.fillStyle = TONE[t]; for (let f = 0; f < 3; f++) for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) if (FR[f][y][x] === 'x') q.fillRect(f * BW + x, t * BH + y, 1, 1); }
  }
  const BFLAP = [0, 1, 2, 1], BS = {img: BIRD, sx: 0, sy: 0, sw: BW, sh: BH, x: 0, y: 0, h: 0, px: 2.5, py: 1.5, flip: false, type: 3, alpha: 1};
  const WAVE = {t: -99, x: 0, y: 0, h: 0, e: null};
  let MC = null;   // the murmuration in the sky now (its centre this frame: for the flinch)
  const MCEN = {x: 0, y: 0, h: 0, e: null};
  function drawMurm(e, t, T) {
    const M = TUNE.murm, s = (t - e.t0) * HSEC, dep = M.arrive + M.swirl;
    const cx = e.cx + 7 * Math.sin(s * .11) + 4 * Math.sin(s * .23 + 1), cy = e.cy + 5 * Math.cos(s * .09) + 3 * Math.sin(s * .19 + 2), ch = e.ch + 2.5 * Math.sin(s * .13);
    MCEN.x = cx; MCEN.y = cy; MCEN.h = ch; MCEN.e = e; MC = MCEN;
    if (Math.abs(cx - P.x) > 150 || Math.abs(cy - P.y) > 150) return;
    const th = s * .18 + .9 * Math.sin(s * .05), ct = Math.cos(th), sn = Math.sin(th);
    const sx = 6 + 3.2 * Math.sin(s * .21), sy = 4 + 2.2 * Math.sin(s * .17 + 1), sz = 2 + 1.3 * Math.sin(s * .27 + 2);
    const tw = T - WAVE.t, wOn = WAVE.e === e && tw < 4, wr = tw * 15, wa = 2.8 * Math.exp(-tw * .9);
    const sp = (s / 9) % 1 < .5;   // (now and then the cloud thins into a ribbon: the scales above do it; sp only varies the size)
    for (let i = 0; i < MN; i++) {
      const a = MU[i * 3], b = MU[i * 3 + 1], c = MU[i * 3 + 2];
      const ta = M.arrive * .8 * MH1[i];
      if (s < ta) continue;
      const xa = a * sx + 2.6 * Math.sin(c * 2.2 + s * .62) + 1.2 * Math.sin(b * 3.1 - s * .4) + .18 * Math.sin(T * 3 + i);
      const ya = b * sy + 1.9 * Math.sin(a * 1.7 + s * .47);
      let z = c * sz + 1.7 * Math.sin(b * 2.4 + s * .52) + 1.2 * Math.sin(a * 1.3 - s * .35) + .15 * Math.sin(T * 2.6 + i * 1.7);
      let x = cx + xa * ct - ya * sn, y = cy + xa * sn + ya * ct; let h = ch + z;
      if (wOn) {   // the flinch: a ring running out from over the sprinter
        const dx = x - WAVE.x, dy = y - WAVE.y, dh = h - WAVE.h, d = Math.sqrt(dx * dx + dy * dy + dh * dh) + .01, q = wa * Math.exp(-(((d - wr) / 2.2) ** 2));
        x += dx / d * q; y += dy / d * q; h += dh / d * q - q * .4;
      }
      if (s < ta + 6) {   // arriving: in from afar in loose strings
        const m = smooth((s - ta) / 6), fx = cx + e.ix * (60 + 30 * MH2[i]) + b * 6, fy = cy + e.iy * (60 + 30 * MH2[i]) + a * 6, fh = ch + 4 + c * 3;
        x = fx + (x - fx) * m; y = fy + (y - fy) * m; h = fh + (h - fh) * m;
      }
      const td = dep + M.pour * .7 * MH2[i];
      if (s > td) {   // pouring down into the roost, the first ones first: a funnel
        const m = (s - td) / 3.5; if (m >= 1) continue;
        const q = m * m, rx = e.rx + a * 2.5, ry = e.ry + b * 2.5, rh = e.rh + Math.max(0, c) * 1.2;
        x += (rx - x) * q; y += (ry - y) * q; h += (rh - h) * q;
      }
      const fl = MH1[i] > .93 && Math.sin(T * .9 + i) > .3 ? 1 : BFLAP[Math.floor(T * 11 + i * .37) & 3];   // (wingbeats, a few gliding)
      BS.sx = fl * BW; BS.sy = (i & 7) && !(sp && i % 11 === 0) ? 0 : BH; BS.x = x; BS.y = y; BS.h = h; host.sprite(BS);
    }
  }
  function flinch(x, y) {
    if (!MC || T0 - WAVE.t < 2.6) return;
    const d = Math.hypot(MC.x - x, MC.y - y); if (d > 16) return;
    WAVE.t = T0; WAVE.x = x; WAVE.y = y; WAVE.h = MC.h - 3; WAVE.e = MC.e;
  }

  // ================================================================ DRIFTERS
  const COL = [0, 0, 0];
  const MOTES = 56, mX = new Float32Array(MOTES), mY = new Float32Array(MOTES), mH = new Float32Array(MOTES), mL = new Float32Array(MOTES), mP = new Float32Array(MOTES);
  const MCOL = [.62, .86, 1], MPT = {size: 1, alpha: .85, emit: true};
  const GRADE = {amb: [.9, 1.0, 1.16], sun: [.8, 1.0, 1.25], fill: [.88, 1.02, 1.2], k: 0};
  let gradeOn = false, gK = 0, nearK = 0, motesAcc = 0;
  const DL = {x: 0, y: 0, h: 0, k: 0};   // the light under the nearest drifter (F.lights)
  const LREC = {x: 0, y: 0, h: 0, color: '#8fd8ff', radius: 13, intensity: 0, flicker: 0, id: 9951}, LOUT = [];
  function drawDrifter(e, t, T) {
    const s = (t - e.t0) * HSEC, k = (t - e.t0) / (e.t1 - e.t0), dist = k * e.len;
    const x = e.ax + e.ux * dist, y = e.ay + e.uy * dist, ground = host.elev(x, y), h = e.alt + Math.max(0, ground) * .5 + 1.2 * Math.sin(s * .07);
    const vis = smooth(k / .04) * smooth((1 - k) / .04), dayK = env.part === 'night' ? 1 : env.part === 'day' ? .45 : .7;
    if (Math.hypot(x - P.x, y - P.y) > 170) return;
    const pulse = s * .55 + e.hue * 6, pf = Math.floor(((pulse / TAU) % 1) * 4) & 3, breath = .5 + .5 * Math.sin(pulse);
    const jelly = e.type === 'jelly', R = e.size;
    // the glow on the ground under it (the emit layer: it shows at night), by day a soft shadow
    G.toScreenInto(x, ground, y, O3); G.toScreenInto(x + R * 1.7, ground, y, O4); G.toScreenInto(x, ground, y + R * 1.7, O5);
    if (inView(O3[0], O3[1], 400)) {
      const ax = O4[0] - O3[0], ay = O4[1] - O3[1], bx = O5[0] - O3[0], by = O5[1] - O3[1];
      const q = host.glayer('emit'); q.save(); q.globalAlpha = clamp(.22 * vis * (.7 + .3 * breath) * (env.part === 'day' ? .3 : 1), 0, 1); q.setTransform(ax, ay, bx, by, O3[0], O3[1]); q.drawImage(POOL, -1, -1, 2, 2); q.restore();
    }
    if (SUN.k > .05) {   // by day: its huge soft shadow, cast by the sun
      const ha = h - ground, gx = x + SUN.ox * ha, gy = y + SUN.oy * ha, gh = host.elev(gx, gy);
      G.toScreenInto(gx, gh, gy, O3); G.toScreenInto(gx + R * 1.5, gh, gy, O4); G.toScreenInto(gx, gh, gy + R * 1.5, O5);
      if (inView(O3[0], O3[1], 400)) { const g = host.glayer('ground'); g.save(); g.globalAlpha = .18 * SUN.k * vis; g.setTransform(O4[0] - O3[0], O4[1] - O3[1], O5[0] - O3[0], O5[1] - O3[1], O3[0], O3[1]); g.drawImage(SHADE, -1, -1, 2, 2); g.restore(); }
    }
    // the body: light, in the add layer (its pixels a little chunky: it is that big)
    G.toScreenInto(x, h, y, O3);
    const ppm = G.pxPerM(x, h, y);
    if (ppm > 0 && inView(O3[0], O3[1], R * 2.5 * ppm)) {
      const q = host.glayer('add'); q.save(); q.globalAlpha = clamp(.5 * vis * dayK * (.8 + .2 * breath), 0, 1);
      if (jelly) { const img = BELL[pf], w = 2 * R * ppm * JW / (JW - 4 * ZD), hh = w * JH / JW; q.drawImage(img, Math.round(O3[0] - w / 2), Math.round(O3[1] - hh * (6 + 24) * ZD / JH), w, hh); }
      else { const img = MANTA[Math.floor(((s * .18 + e.hue) % 1) * 4) & 3], w = 2 * R * ppm, hh = w * MH / MW; q.translate(O3[0], O3[1]); q.rotate(screenAng(e.ux, e.uy)); q.drawImage(img, -w / 2, -hh / 2, w, hh); }
      q.restore();
    }
    // the tendrils / the trailing threads: lines of light in the world
    const px = -e.uy, py = e.ux;
    if (jelly) {
      const K = 10, J = 26, seg = .95;
      for (let kk = 0; kk < K; kk++) {
        const an = kk / K * TAU + .3, r0 = R * .82;
        let x0 = x + Math.cos(an) * r0, y0 = y + Math.sin(an) * r0, h0 = h - .4;
        for (let j = 1; j <= J; j++) {
          const sw = Math.sin(s * .8 - j * .33 + kk * 1.7) * .055 * j, curl = Math.cos(s * .6 - j * .27 + kk) * .03 * j;
          const x1 = x + Math.cos(an) * r0 * (1 - j / J * .5) - e.ux * j * seg * .5 + px * sw + e.ux * curl, y1 = y + Math.sin(an) * r0 * (1 - j / J * .5) - e.uy * j * seg * .5 + py * sw + e.uy * curl, h1 = h - .4 - j * seg * .78;
          const b = vis * ((1 - j / (J + 2)) * .55 + .45 * Math.max(0, Math.sin(s * 2.2 - j * .45 + kk))) * (env.part === 'day' ? .6 : 1);
          COL[0] = .42 * b; COL[1] = .68 * b; COL[2] = .95 * b;
          host.line(x0, y0, h0, x1, y1, h1, COL, true);
          x0 = x1; y0 = y1; h0 = h1;
        }
      }
      for (let kk = 0; kk < 4; kk++) {   // the oral arms: shorter, curling, brighter
        const an = kk / 4 * TAU + s * .05;
        let x0 = x, y0 = y, h0 = h - 1;
        for (let j = 1; j <= 12; j++) {
          const r = .5 + .12 * j + .4 * Math.sin(s * .5 + j * .5 + kk), aa = an + j * .22;
          const x1 = x + Math.cos(aa) * r - e.ux * j * .35, y1 = y + Math.sin(aa) * r - e.uy * j * .35, h1 = h - 1 - j * .6;
          const b = vis * (.9 - j * .04);
          COL[0] = .62 * b; COL[1] = .58 * b; COL[2] = .95 * b;
          host.line(x0, y0, h0, x1, y1, h1, COL, true); host.line(x0 + .12, y0, h0, x1 + .12, y1, h1, COL, true);
          x0 = x1; y0 = y1; h0 = h1;
        }
      }
    } else {
      for (let kk = -1; kk <= 1; kk += 2) {   // two threads from the tail, long, slow waves along them
        let x0 = x - e.ux * R * .35 + px * kk * .4, y0 = y - e.uy * R * .35 + py * kk * .4, h0 = h;
        for (let j = 1; j <= 34; j++) {
          const sw = Math.sin(s * .5 - j * .22 + kk) * .07 * j;
          const x1 = x0 - e.ux * .95 + px * (sw - Math.sin(s * .5 - (j - 1) * .22 + kk) * .07 * (j - 1)), y1 = y0 - e.uy * .95 + py * (sw - Math.sin(s * .5 - (j - 1) * .22 + kk) * .07 * (j - 1)), h1 = h0 - .28;
          const b = vis * ((1 - j / 36) * .6 + .4 * Math.max(0, Math.sin(s * 1.6 - j * .4)));
          COL[0] = .5 * b; COL[1] = .74 * b; COL[2] = .98 * b;
          host.line(x0, y0, h0, x1, y1, h1, COL, true);
          x0 = x1; y0 = y1; h0 = h1;
        }
      }
    }
  }
  function motes(dt) {
    const on = nearK > .15;
    if (on) { motesAcc += dt * 9 * nearK; }
    for (let i = 0; i < MOTES; i++) {
      if (mL[i] > 0) {
        mL[i] -= dt; const tx = DL.x - mX[i], ty = DL.y - mY[i], d = Math.hypot(tx, ty) + 1;
        mX[i] += (tx / d * .5 + Math.sin(T0 * 1.3 + mP[i]) * .25) * dt; mY[i] += (ty / d * .5 + Math.cos(T0 * 1.1 + mP[i]) * .25) * dt; mH[i] += (.9 + .4 * Math.sin(T0 + mP[i])) * dt;
      } else if (on && motesAcc >= 1) {
        motesAcc -= 1; const a = VR() * TAU, r = Math.sqrt(VR()) * 11;
        mX[i] = P.x + Math.cos(a) * r; mY[i] = P.y + Math.sin(a) * r - 2; mH[i] = host.elev(mX[i], mY[i]) + .1; mL[i] = 4 + VR() * 4; mP[i] = VR() * TAU;
      }
    }
    if (motesAcc > 3) motesAcc = 3;
  }
  function drawMotes() {
    for (let i = 0; i < MOTES; i++) if (mL[i] > 0) { MPT.alpha = clamp(mL[i] / 2, 0, 1) * .9; G.point(mX[i], mH[i], mY[i], MCOL, MPT); }
  }

  // ================================================================ SHOOTING STARS (the hour's from the seed; placed where you look)
  const STAR = {t0: 0, r1: 0, r2: 0, r3: 0};
  function starsNow(t, cb) {
    const night = env.part === 'night', clear = (env.light?.cloud ?? 0) < .45 && (env.light?.fog ?? 0) < .4;
    const H = Math.floor(t), dur = TUNE.stars.dur / HSEC;
    if (night && clear && !host.feature('surprises')?.on) {   // (the night surprises' falling stars fill the sky when they're on: no second set of streaks)
      const n = OFTEN ? 7 : (hash3(SEED, H, 71) < .5 ? 1 : 0) + (hash3(SEED, H, 72) < .18 ? 1 : 0);
      for (let i = 0; i < n; i++) { const t0 = H + hash3(SEED, H, 80 + i) * (1 - dur); if (t >= t0 && t <= t0 + dur) { STAR.t0 = t0; STAR.r1 = hash3(SEED, H, 90 + i); STAR.r2 = hash3(SEED, H, 100 + i); STAR.r3 = hash3(SEED, H, 110 + i); cb(STAR, dur); } }
    }
    for (let i = STARF.length - 1; i >= 0; i--) { const f = STARF[i]; if (t > f.t0 + dur || t < f.t0 - 1) STARF.splice(i, 1); else cb(f, dur); }
  }
  function drawStar(S, dur) {
    const u = (env.t - S.t0) / dur; if (u < 0 || u > 1) return;
    const T3 = G.view.T, ang = S.r3 * TAU, len = 22, ux = Math.cos(ang), uy = Math.sin(ang) * .6;
    let x0, y0, h0;
    if (G.cine) { const c = G.cine, fx = c.look.x - c.pos.x, fz = c.look.z - c.pos.z, fl = Math.hypot(fx, fz) || 1; x0 = c.pos.x + fx / fl * 70 + (S.r1 - .5) * 70; y0 = c.pos.z + fz / fl * 70 + (S.r2 - .5) * 40; h0 = c.pos.y + 38 + S.r2 * 25; }
    else { h0 = 34 + S.r2 * 6; x0 = T3.x + (S.r1 - .5) * 20 - ux * len / 2; y0 = T3.z + (S.r2 - .5) * 6 + h0 * host.PPMH / host.PPMY - uy * len / 2; }
    const q = host.glayer('add'); q.save(); q.globalCompositeOperation = 'lighter';
    const head = u * len, tail = Math.max(0, head - 9 * Math.min(1, u * 3) * (1 - u * .5)), fade = u > .8 ? (1 - u) / .2 : 1;
    for (let j = 0; j <= 14; j++) {
      const w = tail + (head - tail) * j / 14, x = x0 + ux * w, y = y0 + uy * w, h = h0 - w * .25;
      G.toScreenInto(x, h, y, O3); if (!inView(O3[0], O3[1], 4)) continue;
      const b = (j / 14) ** 1.5 * fade; q.globalAlpha = clamp(b, 0, 1);
      q.fillStyle = j > 12 ? '#ffffff' : '#bcd8ff';
      const z = j > 12 ? 2 : 1; q.fillRect(Math.round(O3[0]), Math.round(O3[1]), z, z);
    }
    q.restore();
  }

  // ================================================================ THE CONTRACT
  let T0 = 0;   // the view's own clock (s): wings, bobbing, the wave
  Object.assign(F, {
    dev: {group: 'Nature', rows: () => [{label: 'Today in the sky', text: () => today()}]},
    toggle() { F.on = !F.on; return F.on; },
    // (the schedule in the sim step: what is up is the clock's, and the sky.* events go out the same with or without views)
    update() { if (active()) gather(); else clearArray(live); },
    view(dt, evs) {
      T0 += dt;
      MC = null; nearK = 0;
      if (!active()) return;
      // (the murmuration's centre and the drifters' nearness come from the last frame's draw; the flinch: his sprint, his jump)
      const sp = Math.hypot(P.vx || 0, P.vy || 0);
      if (MCEN.e && live.includes(MCEN.e)) { MC = MCEN; if (sp > 5.2) flinch(P.x, P.y); if (evs) for (let i = 0; i < evs.length; i++) if (evs[i].type === 'player.jump') flinch(P.x, P.y); }
      for (let i = 0; i < live.length; i++) {   // the drifters: the nearest one's light, grade and motes; the word when one comes near
        const e = live[i]; if (e.kind !== 'drift') continue;
        const k = (env.t - e.t0) / (e.t1 - e.t0), x = e.ax + e.ux * k * e.len, y = e.ay + e.uy * k * e.len, d = Math.hypot(x - P.x, y - P.y);
        const nk = clamp(1 - d / TUNE.drift.near, 0, 1) * smooth(k / .04) * smooth((1 - k) / .04);
        if (nk > nearK) { nearK = nk; DL.x = x; DL.y = y; DL.h = host.elev(x, y) + 5; DL.k = nk; }
        if (!told.has(e) && d < 70 && k > .03) { told.add(e); game()?.ui?.toast?.('Something vast is passing over', '', '#b8dcf4'); }
      }
      if (told.size > 16) for (const e of told) if (!live.includes(e)) told.delete(e);
      motes(Math.min(.1, dt));
      gK += (nearK * .85 - gK) * Math.min(1, dt * .8);
      if (gK > .01 && !gradeOn) { env.setGrade?.('skylife', GRADE); gradeOn = true; }
      else if (gK <= .01 && gradeOn) { env.clearGrade?.('skylife'); gradeOn = false; }
      GRADE.k = gK;
    },
    frame() {
      if (!active()) return;
      const t = env.t;
      sunNow();
      for (let i = 0; i < live.length; i++) {
        const e = live[i];
        if (e.kind === 'geese') drawGeese(e, t, T0);
        else if (e.kind === 'lake') drawLake(e, t, T0);
        else if (e.kind === 'murm') drawMurm(e, t, T0);
        else if (e.kind === 'drift') drawDrifter(e, t, T0);
      }
      drawMotes();
      starsNow(t, drawStar);
      if (GEO.size > 8) for (const e of GEO.keys()) if (!live.includes(e)) GEO.delete(e);
      if (LST.size > 8) for (const e of LST.keys()) if (!live.includes(e)) LST.delete(e);
    },
    lights() {
      clearArray(LOUT);
      if (!active() || DL.k < .05 || nearK < .05) return LOUT;
      LREC.x = DL.x; LREC.y = DL.y; LREC.h = DL.h; LREC.intensity = .55 * nearK * (env.part === 'day' ? .3 : 1); LOUT.push(LREC);
      return LOUT;
    },
    biomeChanged() { plans.clear(); },
    dispose() { if (gradeOn) env.clearGrade?.('skylife'); },
    menu() {
      return [
        {label: 'Sky: geese now (a V over you)', run: () => nowGeese()},
        {label: 'Sky: geese land on the lake now', run: () => nowLake()},
        {label: 'Sky: murmuration now (over you)', run: () => nowMurm(true)},
        {label: 'Sky: murmuration now (over the lake or the fell)', run: () => nowMurm(false)},
        {label: 'Sky: a drifter now (the bell)', run: () => nowDrifter('jelly')},
        {label: 'Sky: a drifter now (the manta)', run: () => nowDrifter('manta')},
        {label: 'Sky: a shooting star now', run: () => nowStar()},
        {label: 'Sky: go to the lake shore', run: () => host.teleport(L.x, L.y + L.ry + 4)},
        {label: 'Sky: dusk now (murmurations come at dusk)', run: () => env.setHour?.(18.6)},
        {label: 'Sky: night now (drifters, shooting stars)', run: () => env.setHour?.(22.5)},
      ];
    },
    dbg: () => ({active: active(), t: +env.t.toFixed(3), live: live.map(e => `${e.kind} ${((env.t - e.t0) / (e.t1 - e.t0)).toFixed(2)}`), forced: forced.length, nearK: +nearK.toFixed(2), grade: +gK.toFixed(2), today: today()}),
    plan: d => planOf(d ?? env.day),
    _: {live, forced, SUN, SHD, art: () => ({ATL, SIDE, BELL, MANTA, POOL})},
    // (tests: age the newest "now" event by sec real seconds, as if it had started that long ago)
    age(sec) { const e = forced[forced.length - 1] || STARF[STARF.length - 1]; if (!e) return; const d = sec / HSEC; for (const k of ['t0', 't1', 'tl', 'tu']) if (e[k] !== undefined) e[k] -= d; },
  });
  function today() {
    const p = planOf(env.day), fmt = h => { const x = ((h % 24) + 24) % 24, hh = Math.floor(x), mm = Math.floor((x - hh) * 60); return `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`; };
    return p.length ? p.map(e => `${e.kind === 'murm' ? 'starlings' : e.kind === 'drift' ? 'drifter' : e.kind === 'lake' ? 'geese on the lake' : 'geese'} ${fmt(e.t0 - env.day * 24)}`).join(' · ') : 'nothing today';
  }
  // the playtest tour's stops (features/tour.js gathers F.tour() into its "New tonight" part)
  F.tour = () => [
    {id: 'sky-geese', title: 'Geese over the lake', where: 'The lake shore on an autumn morning', world: {hour: 8, season: 'autumn', weather: 'fair'},
      setup: T => { T.row('skylife', 'Sky: go to the lake shore'); T.row('skylife', 'Sky: geese now'); },
      tasks: [{text: 'A V of geese crosses: watch the leader drop back. Their shadows slide over the ground'},
        {text: 'F10 > Nature > Sky > "geese land on the lake now": wait for them, then walk to the water\'s edge to flush them'},
        {text: 'F6 to first person and look up at the next flight'}]},
    {id: 'sky-dusk', title: 'Starlings and drifters', where: 'Over the lake at dusk, then night', world: {hour: 18.4, season: 'summer', weather: 'clear'},
      setup: T => { T.row('skylife', 'Sky: go to the lake shore'); T.row('skylife', 'Sky: murmuration now (over you)'); },
      tasks: [{text: 'The murmuration folds over you: sprint or jump under it and a wave runs through it'},
        {text: 'F10 > Sky > "night now", then "a drifter now (the bell)": something vast passes over, the light turns faintly blue'},
        {text: 'Try "a drifter now (the manta)" too'}]},
  ];
  return F;
}
