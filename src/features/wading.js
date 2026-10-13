// WADING (view): feet in the water. A step in a rain puddle or in the forest's shallow water (the lake's shelf, the streams,
// the outflow) throws up a splash and leaves a ring spreading on the surface; how big goes with how fast he moves:
//   step     a few drops at a walk, a spray at a run, more at a sprint; thrown ahead and to the sides of the stride
//   plant    a sprint's plant or a landing: a wider splash and a bigger ring
//   roll     a burst where the roll goes in, then a sheet of spray off the body all the way through (and a ring trail)
//   jump     a kick of drops where he leaves the water
// A puddle splashes less than a stream (its depth: puddles.js F.depth, how full it is), and some of its drops are mud.
// F.wet(x, y): how much water a foot meets there now (0 dry, a puddle's depth 0..1, the shallow water 1; swimming water,
// host.inStream, is the player sim's own splash): features/audio.js asks it for the splashing steps.
// VIEW ONLY: nothing here is read by the sim. Math.random for the drops (presentation).
// The drops are lit points (G.point: depth-tested, sized by the zoom), the rings points round a circle on the surface.
//
// FEATURE CONTRACT (main.js): create(host) -> F: view, frame, wet, biomeChanged, toggle, ms. ?wading=0: none.
// OWNS: its drops (a structure-of-arrays pool) and rings (a fixed pool). READS: host.player (x, y, vx, vy, state), host.elev,
// host.inStream, world.js waterSample (the forest's water), host.feature('puddles').depth, host.time, host.G (point, onScreen).
// EMITS: nothing. BUDGET: view < .02 ms, frame < .05 ms with a roll's spray up; nothing while dry; no allocation per frame.
import {flags} from '../core/flags.js';
import {clamp} from '../core/mathx.js';
import {rgbOf} from '../core/color.js';
import {waterSample} from '../world/world.js';
import {PUD_COL} from './depth/art.js';

const TAU = Math.PI * 2, R = Math.random, rr = (a, b) => a + R() * (b - a);
const TUNE = {
  cap: 420,                     // drops alive at most
  pace: [1.2, 5],               // m/s: a walk .. a sprint (the splash grows between them)
  step: {n: [7, 20], side: [.5, 1.6], ahead: [.2, 1.8], up: [1.5, 3.2], life: [.45, .8]},   // drops a step (walk .. sprint), m/s out to the sides, along the stride, up; s
  plant: 1.8,                   // x a step's drops for a sprint plant or a landing
  jump: 1.3,                    // x for a jump out of the water
  roll: {burst: 34, rate: 120, side: [1.2, 2.8], up: [1.3, 2.8], every: .1},   // drops where it goes in; a s while rolling (fanned off both sides); a ring every this many s
  ring: {r: [.32, .65], life: .65, pts: 26, roll: 1.3},   // m it spreads to (walk .. sprint), s, points round it, x for a roll's entry
  puddle: .65,                  // a full puddle's splash against the shallow water's (and the rest as its depth says)
  mud: .3,                      // share of a puddle's drops that are mud
  g: 9,                         // m/s^2
  streak: 1.6, trail: .035,     // m/s: faster drops draw as a short streak (their flight over this many s); big: share of its life a drop is 2 px
  big: .45,
};
const MUD = ['#5c4a36', '#463828'].map(rgbOf);
// the drops' tones by the time of day (the puddles' sky colours, a white glint): bright -> dim
const TONES = {}; for (const k in PUD_COL) TONES[k] = [PUD_COL[k].glint, PUD_COL[k].hi, PUD_COL[k].in].map(rgbOf);
const RINGS = 10;

export const order = {after: ['puddles']};
export async function create(host) {
  const F = {name: 'wading', label: 'Splashing through water', ambient: true, on: flags.get('wading') !== '0', ms: 0};
  const G = host.G;
  // ---- the drops: structure of arrays (no objects per drop)
  const N = TUNE.cap, X = new Float32Array(N), Y = new Float32Array(N), H = new Float32Array(N), VX = new Float32Array(N), VY = new Float32Array(N), VH = new Float32Array(N),
    T0 = new Float32Array(N), LF = new Float32Array(N), FL = new Float32Array(N), TN = new Uint8Array(N);   // FL: the surface it falls back to; TN: 0-2 water tones, 3-4 mud
  let n = 0;
  function add(x, y, h, vx, vy, vh, life, floor, tn) {
    if (n >= N) return;
    const i = n++; X[i] = x; Y[i] = y; H[i] = h; VX[i] = vx; VY[i] = vy; VH[i] = vh; T0[i] = 0; LF[i] = life; FL[i] = floor; TN[i] = tn;
  }
  function kill(i) { const j = --n; if (i === j) return; X[i] = X[j]; Y[i] = Y[j]; H[i] = H[j]; VX[i] = VX[j]; VY[i] = VY[j]; VH[i] = VH[j]; T0[i] = T0[j]; LF[i] = LF[j]; FL[i] = FL[j]; TN[i] = TN[j]; }
  // ---- the rings: a fixed pool
  const RG = []; for (let i = 0; i < RINGS; i++) RG.push({on: false, x: 0, y: 0, z: 0, t: 0, life: 1, r: .4});
  function ring(x, y, z, r, life) {
    let o = RG[0]; for (const q of RG) { if (!q.on) { o = q; break; } if (q.t / q.life > o.t / o.life) o = q; }   // (a free one, else the oldest)
    o.on = true; o.x = x; o.y = y; o.z = z; o.t = 0; o.life = life; o.r = r;
  }

  // ---- what a foot meets: a puddle's depth, the shallow water (1), or nothing
  const WS = {kind: 0, a: 0, hw: 0, edge: 0, s: 0, speed: 0, hold: 0};
  let PUD = null;
  F.wet = (x, y) => {
    if (!F.on) return 0;
    if (waterSample(x, y, WS).kind >= 6 && WS.kind <= 8) return host.inStream(x, y) ? 0 : 1;   // (the forest's water; swimming is the sim's splash)
    PUD = PUD || host.feature?.('puddles') || null;
    return PUD?.depth ? PUD.depth(x, y) : 0;
  };

  // the player, read once a view step (host.player's getters turn his view frame into the world's on every read)
  const PL = {ok: false, x: 0, y: 0, vx: 0, vy: 0, state: ''};
  function readPlayer() { const p = host.player; PL.ok = !!p; if (!p) return; PL.x = p.x; PL.y = p.y; PL.vx = p.vx || 0; PL.vy = p.vy || 0; PL.state = p.state; }
  // a splash at a foot: m x a step's drops (k: 0 walk .. 1 sprint), w: the water there (a puddle's depth .. 1)
  function splash(x, y, w, k, m, ringK) {
    const S = TUNE.step, puddle = w < 1, s = puddle ? TUNE.puddle * (.5 + .5 * w) : 1, z = host.elev(x, y);
    const sp = Math.hypot(PL.vx, PL.vy), ux = sp > .2 ? PL.vx / sp : 0, uy = sp > .2 ? PL.vy / sp : 0;
    const cnt = Math.round((S.n[0] + (S.n[1] - S.n[0]) * k) * m * s), side = S.side[0] + (S.side[1] - S.side[0]) * k, ahead = S.ahead[0] + (S.ahead[1] - S.ahead[0]) * k;
    for (let i = 0; i < cnt; i++) {
      const a = R() * TAU, out = side * rr(.3, 1), fw = ahead * rr(-.2, 1), tn = puddle && R() < TUNE.mud ? 3 + (R() * 2 | 0) : R() * 3 | 0;
      add(x + rr(-.06, .06), y + rr(-.04, .04), z + .02, Math.cos(a) * out + ux * fw, Math.sin(a) * out * .8 + uy * fw, rr(S.up[0], S.up[1]) * (.6 + .4 * k) * Math.min(1.3, Math.sqrt(m)) * (.7 + .3 * s), rr(S.life[0], S.life[1]), z, tn);
    }
    const Rg = TUNE.ring; ring(x, y, z + .01, (Rg.r[0] + (Rg.r[1] - Rg.r[0]) * k) * ringK * (.6 + .4 * s), Rg.life * Math.sqrt(ringK));
  }
  const paceK = v => clamp((v - TUNE.pace[0]) / (TUNE.pace[1] - TUNE.pace[0]), 0, 1);
  let lastState = '', rollAcc = 0, ringT = 0, T = 0, live = 0;
  function onEvents(evs, dt) {
    if (evs) for (let i = 0; i < evs.length; i++) {
      const e = evs[i], t = e.type;
      if (t !== 'player.step' && t !== 'player.land' && t !== 'player.jump') continue;
      const w = F.wet(e.x, e.y); if (w <= .02) continue;
      const k = paceK(e.pace ?? Math.hypot(PL.vx, PL.vy));
      if (t === 'player.step') splash(e.x, e.y, w, k, e.big ? 1.3 : 1, 1);
      else if (t === 'player.land') splash(e.x, e.y, w, Math.max(k, .8), TUNE.plant * (e.big >= 3 ? 1.4 : 1), 1.4);
      else splash(e.x, e.y, w, k, TUNE.jump, 1);
    }
    // the roll (no event: the player's state): a burst where it goes in, then spray off the body while it's in the water
    if (!PL.ok) return;
    if (PL.state === 'roll') {
      const w = F.wet(PL.x, PL.y), Rl = TUNE.roll;
      if (w > .02) {
        const s = w < 1 ? TUNE.puddle * (.5 + .5 * w) : 1, z = host.elev(PL.x, PL.y), sp = Math.hypot(PL.vx, PL.vy), ux = sp > .2 ? PL.vx / sp : 0, uy = sp > .2 ? PL.vy / sp : 0;
        if (lastState !== 'roll') { splash(PL.x, PL.y, w, 1, Rl.burst / TUNE.step.n[1], TUNE.ring.roll); ringT = Rl.every; }
        for (rollAcc += dt * Rl.rate * s; rollAcc >= 1; rollAcc--) {   // a sheet off each side, swept back a little
          const sd = R() < .5 ? -1 : 1, out = rr(Rl.side[0], Rl.side[1]), back = rr(-.2, .5) * sp, tn = w < 1 && R() < TUNE.mud ? 3 + (R() * 2 | 0) : R() * 3 | 0;
          add(PL.x + rr(-.12, .12), PL.y + rr(-.08, .08), z + .05, -uy * sd * out - ux * back + ux * sp * .4, ux * sd * out * .8 - uy * back + uy * sp * .4, rr(Rl.up[0], Rl.up[1]) * (.7 + .3 * s), rr(.3, .55), z, tn);
        }
        if ((ringT -= dt) <= 0) { ringT = Rl.every; ring(PL.x, PL.y, z + .01, TUNE.ring.r[1] * .8, TUNE.ring.life * .8); }
      } else rollAcc = 0;
    } else rollAcc = 0;
    lastState = PL.state;
  }
  F.view = (dt, evs) => {
    if (!F.on) return;
    const t0 = performance.now(); T += dt;
    readPlayer(); onEvents(evs, dt);
    const g = TUNE.g;
    for (let i = n - 1; i >= 0; i--) {
      T0[i] += dt; if (T0[i] > LF[i]) { kill(i); continue; }
      VH[i] -= g * dt; const d = Math.exp(-dt * 1.2); VX[i] *= d; VY[i] *= d;
      X[i] += VX[i] * dt; Y[i] += VY[i] * dt; H[i] += VH[i] * dt;
      if (H[i] <= FL[i] && VH[i] < 0) kill(i);   // (back into the water: a puddle's or the stream's)
    }
    live = 0; for (const o of RG) if (o.on) { if ((o.t += dt) >= o.life) o.on = false; else live++; }
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };

  // ---- the draw: drops as lit points, rings as points round a circle on the surface
  const PO = {size: 1, alpha: 1}, PR = {size: 1, alpha: 1};
  F.frame = () => {
    if (!F.on || (!n && !live)) return;
    const z = host.zoom || 1, tone = TONES[host.time] || TONES.day; PO.size = z; PR.size = z;
    const tr = TUNE.trail, st2 = TUNE.streak * TUNE.streak;
    for (let i = 0; i < n; i++) {   // fresh drops 2 px, then 1; fast ones a short streak along their flight
      const tn = TN[i], c = tn >= 3 ? MUD[tn - 3] : tone[tn], vx = VX[i], vy = VY[i], vh = VH[i];
      if (vx * vx + vy * vy + vh * vh > st2) G.line(X[i], H[i], Y[i], X[i] - vx * tr, H[i] - vh * tr, Y[i] - vy * tr, c, false);
      PO.size = T0[i] < LF[i] * TUNE.big ? 2 * z : z; G.point(X[i], H[i], Y[i], c, PO);
    }
    const P = TUNE.ring.pts;
    for (const o of RG) {
      if (!o.on || !G.onScreen(o.x, o.z, o.y, 40)) continue;
      const u = o.t / o.life, r = o.r * (1 - (1 - u) * (1 - u)) + .05;   // (fast out, then slowing)
      PR.alpha = .9 * (1 - u); PR.size = u < .3 ? 2 * z : z; const c = tone[u < .35 ? 0 : 1];
      for (let k = 0; k < P; k++) { const a = k / P * TAU; G.point(o.x + Math.cos(a) * r, o.z, o.y + Math.sin(a) * r * .9, c, PR); }
      if (u > .2) { const r2 = r * .55, P2 = P >> 1; PR.size = z; PR.alpha = .7 * (1 - u); for (let k = 0; k < P2; k++) { const a = (k + .5) / P2 * TAU; G.point(o.x + Math.cos(a) * r2, o.z, o.y + Math.sin(a) * r2 * .9, tone[1], PR); } }   // (a second, inner ring behind it)
    }
  };
  function clear() { n = 0; live = 0; for (const o of RG) o.on = false; rollAcc = 0; }
  F.biomeChanged = () => { clear(); PUD = null; };
  F.toggle = () => { F.on = !F.on; if (!F.on) clear(); return F.on; };
  F.info = () => ({on: F.on, drops: n, rings: RG.filter(o => o.on).length});
  F.TUNE = TUNE;
  return F;
}
