// DUST (view): the desert's air made visible in sand. Only in the desert. SHOW ONLY: it reads the sim and the wind service,
// writes only its own particles (nothing collides with them, nothing reads them but the tumbleweeds' swirl).
//   drift    sand blowing along the ground in the gusts: grains skipping low over open sand (saltation), born where the wind
//            there (host.wind.at: the same gust fronts the plants and the tumbleweeds feel) is strong enough, more the stronger,
//            so they run in bands with the fronts; the fast ones are short streaks along their flight. In a strong wind a
//            finer dust lifts higher and drifts (dithered). Sand gives most, hardpan some, the paving a little (its drifts)
//   devils   now and then by day a small DUST DEVIL: a funnel of dust wound round a leaning axis in bands that turn with
//            it (the whirl reads), loose grains arcing round it, a skirt of dust spinning at its foot, a twig or two caught
//            in it; darker than the sand it stands on. It spins up, wanders across open sand with the wind
//            for 9-22 s and dies down (sooner on paving or rock; walking through it breaks it up). More on a windy or a
//            hot clear day, none at night or in rain. F.swirl(x, y, out): its whirl at a point (tumbleweed.js catches it)
//   kicked   the player's steps, landings, jumps and rolls throw a few grains on sand (hardpan: a faint puff; paving, rock:
//            nothing). (The footprints are atmos.js's; the jump / landing puffs atmos draws in the desert's DUST colours)
// The ground comes from the biome's own painter (world/desert.js B.groundAt). Grains are 1 px lit points / world lines
// (depth-tested: walls hide them), sizes follow the zoom; the art rules of atmos.js (no AA, palette tones, dither = alpha).
// FEATURE CONTRACT (main.js): create(host) -> F: view, frame, biomeChanged, toggle, swirl, puff (grains where something lands), info.
// OWNS: its grains (a structure-of-arrays pool), its devils (a fixed pool). READS: host.wind (at, level, dir), host.env (hour,
// weather, sky), host.biome (id, groundAt), host.player, host.elev, host.inStream, host.entities.near (walls for the
// devils), host.G (view, onScreen, point, line), host.zoom. EMITS: nothing.
// BUDGET: view <= 0.06 ms, frame <= 0.06 ms in a gale with a devil up (measured 2026-10-02, headless 1920x1080: view .051,
// frame .057 avg; ~.08 each with two devils and the grains near the cap); nothing in other biomes; no allocation per frame.
import {flags} from '../core/flags.js';
import {clamp, hypot2, smooth} from '../core/mathx.js';
import {rgbOf} from '../core/color.js';

const TAU = Math.PI * 2, R = Math.random, rr = (a, b) => a + R() * (b - a);
// ---------------------------------------------------------------- tunables
const TUNE = {
  cap: 520,                         // grains alive at most (all kinds)
  drift: {tries: 12, v0: .95, v1: 1.6, n: [2, 5], speed: [1.4, 2.3], up: [.3, 1.1], life: [.5, 1.4], g: 5.5, streak: 2, trail: .045,   // tries a 60th of a s; m/s of wind where it starts, + this for all; grains a burst; x the wind; m/s up; s; m/s^2; m/s: drawn as a streak above
    fine: {lv: 1.6, odds: .35, up: [.15, .45], life: [1.4, 2.8], speed: [.8, 1.1]}},   // the finer dust a strong wind lifts (wind level above lv)
  ground: {sand: 1, pan: .4, stone: .22, rock: 0, water: 0},   // how much each ground gives
  devil: {n: 240, skirt: 26, strands: 4, strand: 40, twist: 2.6, arc: .1, every: [35, 70], life: [9, 22], r: [.2, .34], H: [2, 3.2], spin: 7, rise: [.18, .32], wander: [.35, .9], wind: .4, windMax: 1.1, max: 2,
    hours: [9.5, 18], pull: 1.1, lift: 1.1, swirl: 3.4,   // the day it forms in; the swirl F.swirl gives: in m/s toward the axis, up, round it
    weather: {clear: 1, fair: .8, haze: .6, windy: 1.7, cloudy: .35, overcast: .15}},   // its odds by the weather (others: none)
  kick: {sand: 3, pan: 1, sprint: 2, land: 7, roll: 36, speed: [.4, 1.2], up: [.6, 1.5], life: [.3, .65], g: 7},   // grains a step on sand / hardpan, + a sprint plant, + a landing; a s while rolling
};
// the grains' tones (bright -> dim), parsed once: sand lighter than the ground under it (they catch the light), a twig
const SAND = ['#fff4da', '#f2e0b6', '#dcc496'].map(rgbOf), DIMS = ['#ead6aa', '#d4ba8e'].map(rgbOf), TWIG = rgbOf('#6e5842');
// a dust devil's dust: darker than the sand it stands on (a column of it reads against the ground), the near side lit
const DEVIL = ['#eedcb0', '#cfb084', '#ad8e64', '#8a6e4c'].map(rgbOf);

// ORDER (core/features.js): this step's wind (gust fronts) first
export const order = {after: ['wind']};
export async function create(host) {
  const F = {name: 'dust', label: 'Blowing sand, dust devils', ambient: true, on: flags.get('dust') !== '0', ms: 0};
  const G = host.G, ctx = host.ctxO, PPM = host.PPM;
  // ---- the grains: structure of arrays (no objects per grain)
  const N = TUNE.cap, X = new Float32Array(N), Y = new Float32Array(N), H = new Float32Array(N), VX = new Float32Array(N), VY = new Float32Array(N), VH = new Float32Array(N),
    T0 = new Float32Array(N), LF = new Float32Array(N), FL = new Float32Array(N), K = new Uint8Array(N), TN = new Uint8Array(N);   // FL: the ground under it; K: 0 drift, 1 fine, 2 kicked, 3 puff
  let n = 0;
  function add(k, x, y, h, vx, vy, vh, life, floor) {
    if (n >= N) return -1;
    const i = n++; K[i] = k; X[i] = x; Y[i] = y; H[i] = h; VX[i] = vx; VY[i] = vy; VH[i] = vh; T0[i] = 0; LF[i] = life; FL[i] = floor; TN[i] = R() * 3 | 0; return i;
  }
  function kill(i) {   // swap-remove
    const j = --n; if (i === j) return;
    X[i] = X[j]; Y[i] = Y[j]; H[i] = H[j]; VX[i] = VX[j]; VY[i] = VY[j]; VH[i] = VH[j]; T0[i] = T0[j]; LF[i] = LF[j]; FL[i] = FL[j]; K[i] = K[j]; TN[i] = TN[j];
  }
  // ---- the devils: a fixed pool, each with its particles (a: angle round the axis, u: height 0..1, rk: radius factor, sp: spin factor)
  const D = TUNE.devil, devils = [];
  for (let i = 0; i < D.max; i++) devils.push({on: false, x: 0, y: 0, gz: 0, ang: 0, sp: 0, age: 0, life: 1, r: .3, H: 3, k: 0, ph: 0, lx: 0, ly: 0, om: 0, rot: 0, kd: new Uint8Array(D.n), b: new Float32Array(D.n),
    a: new Float32Array(D.n), u: new Float32Array(D.n), rk: new Float32Array(D.n), s: new Float32Array(D.n), tn: new Uint8Array(D.n)});
  F.devils = devils;
  let biomeOn = false, T = 0, devilIn = 20, lastState = '', rollAcc = 0, groundAt = null, live = 0;
  // the player, read once a view step (host.player's getters turn his view frame into the world's on every read)
  const PL = {ok: false, x: 0, y: 0, vx: 0, vy: 0, state: ''};
  function readPlayer() { const p = host.player; PL.ok = !!p; if (!p) return; PL.x = p.x; PL.y = p.y; PL.vx = p.vx || 0; PL.vy = p.vy || 0; PL.state = p.state; }
  const WA = {x: 0, y: 0, g: 0}, NEAR = [], PO = {size: 1, alpha: 1}, PD = {size: 1, alpha: .55};
  const gnd = (x, y) => groundAt ? TUNE.ground[groundAt(x, y)] ?? 0 : 0;

  // the view (as tumbleweed.js / wildlife.js): centre and half sizes in VIEW-frame metres, its axes on the ground
  let RX = 1, RY = 0, FX = 0, FY = 1;
  const VB = {cx: 0, cy: 0, hw: 8, hh: 5};
  function viewSync() {
    const a = host.yaw, ZM = host.zoom || 1; RX = Math.cos(a); RY = -Math.sin(a); FX = Math.sin(a); FY = Math.cos(a);
    const T3 = G.view.T, vx = T3.x * RX + T3.z * RY, vy = T3.x * FX + T3.z * FY;
    VB.cx = vx; VB.cy = vy - T3.y * ctx.PPMH / ctx.PPMY; VB.hw = host.VW / 2 / (PPM * ZM); VB.hh = host.VH / 2 / (ctx.PPMY * ZM);
  }

  // ================================================================ drift: grains born where the gust is
  function drift(dt, lv) {
    const w = host.wind, Dr = TUNE.drift, f = Dr.tries * dt * 60, tries = Math.floor(f) + (R() < f % 1 ? 1 : 0);   // (a fraction left over: by chance)
    for (let t = 0; t < tries && n < N - 8; t++) {
      // a spot in the view, a little more upwind of it (the grains run in)
      const vx = VB.cx + (R() * 2 - 1) * (VB.hw + 1), vy = VB.cy + (R() * 2 - 1) * (VB.hh + 1);
      const x = vx * RX + vy * FX, y = vx * RY + vy * FY;
      if (x < 0 || y < 0 || x > ctx.WM || y > ctx.HM - 2.5) continue;
      w.at(x, y, WA);
      const s = hypot2(WA.x, WA.y); if (s < Dr.v0) continue;
      const odds = clamp((s - Dr.v0) / Dr.v1, 0, 1); if (R() > odds) continue;
      const gk = gnd(x, y); if (gk <= 0 || R() > gk) continue;
      const z = host.elev(x, y), ux = WA.x / s, uy = WA.y / s, m = Dr.n[0] + (R() * (Dr.n[1] - Dr.n[0] + 1) | 0) * (s > 2.2 ? 2 : 1);
      for (let k = 0; k < m; k++) {   // a little burst: a ribbon of grains along the wind
        const off = rr(-.25, .25), along = rr(-.3, .3), sp = s * rr(Dr.speed[0], Dr.speed[1]);
        add(0, x + ux * along - uy * off, y + uy * along + ux * off, z + .01, ux * sp + rr(-.15, .15), uy * sp + rr(-.15, .15), rr(Dr.up[0], Dr.up[1]), rr(Dr.life[0], Dr.life[1]), z);
      }
      if (lv > Dr.fine.lv && R() < Dr.fine.odds * Math.min(1, lv - Dr.fine.lv + .4)) {
        const sp = s * rr(Dr.fine.speed[0], Dr.fine.speed[1]);
        add(1, x, y, z + rr(.05, .3), ux * sp, uy * sp, rr(Dr.fine.up[0], Dr.fine.up[1]), rr(Dr.fine.life[0], Dr.fine.life[1]), z);
      }
    }
  }
  // ================================================================ kicked: steps, landings, jumps, rolls
  function kick(x, y, m, big) {
    const gr = groundAt ? groundAt(x, y) : 'stone', P = PL, Kk = TUNE.kick;
    const per = gr === 'sand' ? Kk.sand : gr === 'pan' ? Kk.pan : 0; if (!per && !(big && gr === 'pan')) return;
    const z = host.elev(x, y), sp = hypot2(P.vx, P.vy), dx = sp > .2 ? -P.vx / sp : 0, dy = sp > .2 ? -P.vy / sp : 0;   // thrown back from the stride
    const cnt = Math.round(per * m);
    for (let i = 0; i < cnt; i++) {
      const a = R() * TAU, s = rr(Kk.speed[0], Kk.speed[1]) * (big ? 1.6 : 1), back = big ? 0 : .8;
      if (gr === 'pan') add(3, x + rr(-.1, .1), y + rr(-.06, .06), z + .03, Math.cos(a) * s * .4 + dx * .3, Math.sin(a) * s * .3 + dy * .3, rr(.1, .35), rr(.4, .8), z);
      else add(2, x + rr(-.08, .08), y + rr(-.05, .05), z + .03, Math.cos(a) * s * (1 - back * .6) + dx * s * back, Math.sin(a) * s * .8 * (1 - back * .6) + dy * s * back, rr(Kk.up[0], Kk.up[1]) * (big ? 1.2 : 1), rr(Kk.life[0], Kk.life[1]), z);
    }
  }
  function onEvents(evs, dt) {
    if (evs) for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === 'player.step') kick(e.x, e.y, e.big ? 1.4 : 1, false);
      else if (e.type === 'player.land') kick(e.x, e.y, e.big >= 3 ? TUNE.kick.land / TUNE.kick.sand : e.big === 2 ? 1 + TUNE.kick.sprint / TUNE.kick.sand : 1.6, e.big >= 3);
      else if (e.type === 'player.jump') kick(e.x, e.y, 1.3, false);
    }
    // the roll (no event: the player's state): grains thrown up round the body while it rolls on sand
    const P = PL; if (!P.ok) return;
    if (P.state === 'roll') {
      rollAcc += dt * TUNE.kick.roll;
      if (lastState !== 'roll') rollAcc += 3;
      for (; rollAcc >= 1; rollAcc--) kick(P.x + rr(-.15, .15), P.y + rr(-.1, .1), 1 / TUNE.kick.sand, false);
    } else rollAcc = 0;
    lastState = P.state;
  }
  // ================================================================ grains: hop along, bounce, settle
  function grains(dt, lv) {
    const g = TUNE.drift.g, gk = TUNE.kick.g;
    for (let i = n - 1; i >= 0; i--) {
      T0[i] += dt; if (T0[i] > LF[i]) { kill(i); continue; }
      const k = K[i];
      if (k === 1 || k === 3) {   // fine dust / a puff: drag toward the wind, a slow rise, no fall to speak of
        if (k === 1) { host.wind.at(X[i], Y[i], WA); VX[i] += (WA.x * 1.6 - VX[i]) * Math.min(1, dt * 1.2); VY[i] += (WA.y * 1.6 - VY[i]) * Math.min(1, dt * 1.2); }
        else { VX[i] *= Math.max(0, 1 - dt * 3); VY[i] *= Math.max(0, 1 - dt * 3); }
        VH[i] *= Math.max(0, 1 - dt * 1.5);
        X[i] += VX[i] * dt; Y[i] += VY[i] * dt; H[i] += VH[i] * dt; continue;
      }
      VH[i] -= (k === 2 ? gk : g) * dt;
      X[i] += VX[i] * dt; Y[i] += VY[i] * dt; H[i] += VH[i] * dt;
      if (H[i] <= FL[i]) {   // down: a drift grain skips on (its flight is most of its life), a kicked one settles
        if (k === 0 && T0[i] < LF[i] * .75 && VH[i] < -.3) { H[i] = FL[i]; VH[i] = -VH[i] * rr(.45, .7); VX[i] *= .82; VY[i] *= .82; }
        else { kill(i); continue; }
      }
      if (host.inStream(X[i], Y[i])) kill(i);
    }
  }
  // ================================================================ devils
  function devilSpot() {   // open sand / hardpan in (or just upwind of) the view, clear of the player
    const w = host.wind, P = PL.ok ? PL : null;
    for (let t = 0; t < 8; t++) {
      const vx = VB.cx + (R() * 2 - 1) * (VB.hw - .5) - (w ? (w.dir[0] * RX + w.dir[1] * RY) * 2 : 0), vy = VB.cy + (R() * 2 - 1) * (VB.hh - .3);
      const x = vx * RX + vy * FX, y = vx * RY + vy * FY;
      if (x < 1 || y < 1 || x > ctx.WM - 1 || y > ctx.HM - 3.5) continue;
      const gr = groundAt(x, y); if (gr !== 'sand' && gr !== 'pan') continue;
      if (P && hypot2(P.x - x, P.y - y) < 3) continue;
      if (host.elev(x, y) > .05 || wallNear(x, y, 1.2)) continue;
      SPOT[0] = x; SPOT[1] = y; return SPOT;
    }
    return null;
  }
  const SPOT = [0, 0];
  function wallNear(x, y, r) {
    for (const p of host.entities.near(x, y, r, NEAR)) {
      if (p.gone || p.broken) continue;
      if (p.rect ? x > p.rect[0] - r && x < p.rect[2] + r && y > p.rect[1] - r && y < p.rect[3] + r : p.r > .25 && hypot2(p.x - x, p.y - y) < p.r + r) return true;
    }
    return false;
  }
  function spawnDevil() {
    let d = null; for (const o of devils) if (!o.on) { d = o; break; } if (!d) return;
    const s = devilSpot(); if (!s) return;
    d.on = true; d.x = s[0]; d.y = s[1]; d.gz = host.elev(d.x, d.y); d.age = 0; d.life = rr(D.life[0], D.life[1]); d.r = rr(D.r[0], D.r[1]); d.H = rr(D.H[0], D.H[1]);
    d.ang = R() * TAU; d.sp = rr(D.wander[0], D.wander[1]); d.ph = R() * TAU; d.k = 0; d.lx = 0; d.ly = 0; d.rot = R() * TAU;
    // kd: 1 the skirt (low, wide), 2 a twig caught in it, 3 the strands (grains wound round the column in bands that turn with
    // it: the whirl reads), 0 loose grains
    const S0 = D.skirt + 2, S1 = S0 + D.strands * D.strand;
    for (let i = 0; i < D.n; i++) {
      d.a[i] = R() * TAU; d.s[i] = rr(.8, 1.2); d.tn[i] = R() * 3 | 0;
      if (i < D.skirt) { d.kd[i] = 1; d.u[i] = rr(0, .04); d.rk[i] = rr(1.5, 2.4); }
      else if (i < S0) { d.kd[i] = 2; d.u[i] = rr(.2, .6); d.rk[i] = rr(.7, 1); }
      else if (i < S1) { d.kd[i] = 3; const k = i - S0; d.u[i] = (k % D.strand) / D.strand + rr(0, .02); d.b[i] = ((k / D.strand) | 0) * TAU / D.strands + rr(-.12, .12); d.rk[i] = rr(.85, 1.1); }
      else { d.kd[i] = 0; d.u[i] = R(); d.rk[i] = rr(.5, 1.25); }
    }
  }
  function stepDevil(d, dt) {
    d.age += dt;
    const w = host.wind; w.at(d.x, d.y, WA);
    d.ang += (R() - .5) * 2.2 * dt + Math.sin(T * .37 + d.ph) * .4 * dt;
    if (d.x < 2 || d.y < 2 || d.x > ctx.WM - 2 || d.y > ctx.HM - 4) d.ang = Math.atan2(ctx.HM / 2 - d.y, ctx.WM / 2 - d.x);   // (the map's edge: back in)
    const ws = hypot2(WA.x, WA.y), wk = ws > 1e-3 ? Math.min(D.wind * ws, D.windMax) / ws : 0;   // (carried by the wind, at most windMax m/s)
    let vx = WA.x * wk + Math.cos(d.ang) * d.sp, vy = WA.y * wk + Math.sin(d.ang) * d.sp;
    const nx = d.x + vx * dt, ny = d.y + vy * dt;
    if (wallNear(nx, ny, d.r) || host.inStream(nx, ny) || host.elev(nx, ny) > d.gz + .3) { d.ang += Math.PI * (.6 + R() * .5); d.age += dt * 4; vx = vy = 0; }   // (turned away, and it weakens)
    else { d.x = nx; d.y = ny; }
    const gr = groundAt(d.x, d.y); if (gr !== 'sand' && gr !== 'pan') d.age += dt * 2.5;   // off the sand it starves
    if (PL.ok && hypot2(PL.x - d.x, PL.y - d.y) < d.r * 1.6) d.age += dt * 2;   // walked through: breaking up
    d.k = smooth(d.age / 2.6) * smooth((d.life - d.age) / 3.5);
    d.lx = WA.x * .22; d.ly = WA.y * .22;   // the axis leans downwind (m per unit of height share x H)
    if (d.age >= d.life) { d.on = false; return; }
    if (!G.onScreen(d.x, d.gz + d.H * .5, d.y, 80)) return;   // off-screen: the whirl's particles wait
    const om = d.om = D.spin * (.45 + .55 * d.k);
    d.rot += om * dt;
    for (let i = 0; i < D.n; i++) {
      const kd = d.kd[i];
      if (kd === 1) { d.a[i] += om * 1.25 * d.s[i] * dt; continue; }
      if (kd === 3) {   // a strand: rising along its band, the band turning with the column
        d.u[i] += .22 * dt; if (d.u[i] > 1) d.u[i] -= 1;
        d.a[i] = d.b[i] + d.rot - d.u[i] * D.twist; continue;
      }
      const u = d.u[i];
      d.a[i] += om * d.s[i] * (1.2 - .45 * u) * dt;
      if (kd === 2) { d.u[i] = .4 + .3 * Math.sin(T * (.9 + d.s[i]) + i); continue; }
      d.u[i] += rr(D.rise[0], D.rise[1]) * dt;
      if (d.u[i] > 1) { d.u[i] -= 1; d.a[i] = R() * TAU; }
    }
  }
  // its whirl at (x, y): velocity (m/s) round it and toward it, and a lift (m/s): for the tumbleweeds
  F.swirl = (x, y, out) => {
    let got = false; out.x = out.y = out.up = 0;
    if (!biomeOn || !F.on) return null;
    for (const d of devils) {
      if (!d.on || d.k < .15) continue;
      const dx = x - d.x, dy = y - d.y, dd = hypot2(dx, dy), reach = d.r * 3.2; if (dd >= reach || dd < 1e-4) continue;
      const f = d.k * (1 - dd / reach), ux = dx / dd, uy = dy / dd;
      out.x += (-uy * D.swirl - ux * D.pull) * f; out.y += (ux * D.swirl - uy * D.pull) * f; out.up += D.lift * f; got = true;
    }
    return got ? out : null;
  };

  // ================================================================ the view step
  F.view = (dt, evs) => {
    const t0 = performance.now();
    dt = Math.min(.05, Math.max(0, dt || 0)); T += dt;
    biomeOn = host.biome?.id === 'desert';
    const w = host.wind;
    if (!F.on || !biomeOn || !w || w.on === false) { if (n || live) clear(); F.ms = F.ms * .95 + (performance.now() - t0) * .05; return; }
    groundAt = host.biome.groundAt || null;
    viewSync(); readPlayer();
    const lv = w.level ?? 1;
    if (groundAt) { drift(dt, lv); onEvents(evs, dt); }
    grains(dt, lv);
    // devils: by day, by the weather, more in the heat of the afternoon and in a stiff wind
    const E = host.env, hr = E?.hour ?? 12, wk = D.weather[E?.weather] ?? 0, rain = E?.sky?.rain ?? 0;
    const day = hr > D.hours[0] && hr < D.hours[1] ? .55 + .45 * Math.sin(Math.PI * (hr - D.hours[0]) / (D.hours[1] - D.hours[0])) : 0;
    const odds = groundAt && rain < .1 ? day * wk : 0;
    if (odds > 0) { devilIn -= dt * odds; if (devilIn <= 0) { spawnDevil(); devilIn = rr(D.every[0], D.every[1]); } }
    live = 0; for (const d of devils) if (d.on) { stepDevil(d, dt); if (d.on) live++; }
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  function clear() { n = 0; live = 0; for (const d of devils) d.on = false; }

  // ================================================================ the draw: lit points / short world lines
  F.frame = () => {
    if (!F.on || !biomeOn) return;
    const z = host.zoom || 1; PO.size = z; PD.size = z;
    for (let i = 0; i < n; i++) {
      const k = K[i], x = X[i], y = Y[i], h = H[i];
      if (k === 0) {
        const sp = hypot2(VX[i], VY[i]), c = SAND[TN[i]];
        if (sp > TUNE.drift.streak) { const k = TUNE.drift.trail; G.line(x, h, y, x - VX[i] * k, h - VH[i] * k, y - VY[i] * k, c, false); }   // a short streak: its flight over the last ~1/20 s
        else G.point(x, h, y, c, PO);
      } else if (k === 2) G.point(x, h, y, SAND[TN[i]], PO);
      else { PD.alpha = (k === 1 ? .55 : .5) * (1 - T0[i] / LF[i] * .6); PD.size = z * (k === 1 ? 1 : 2); G.point(x, h, y, DIMS[TN[i] & 1], PD); }
    }
    PD.size = z;
    for (const d of devils) {
      if (!d.on || d.k < .03 || !G.onScreen(d.x, d.gz + d.H * .5, d.y, 60)) continue;
      const kk = d.k, Hh = d.H * Math.sqrt(kk), sway = Math.sin(T * 1.3 + d.ph) * .12;
      for (let i = 0; i < D.n; i++) {
        const u = d.u[i], kd = d.kd[i], skirt = kd === 1; if (skirt && kk < .3) continue;
        const hu = skirt ? u : Math.pow(u, 1.35);   // (more of it low: a dense foot, thinning upward)
        const rad = d.r * (skirt ? d.rk[i] : (.8 + 1.8 * Math.pow(u, 1.3)) * d.rk[i]) * (.6 + .4 * kk), a = d.a[i], ca = Math.cos(a), sa = Math.sin(a);
        const lean = hu * Hh, ox = d.x + (d.lx + sway * RX) * lean, oy = d.y + (d.ly + sway * RY) * lean, x = ox + ca * rad, y = oy + sa * rad, h = d.gz + (skirt ? u + .02 : hu * Hh);
        if (kd === 2) { PO.size = z; G.point(x, h, y, TWIG, PO); continue; }
        const near = ca * FX + sa * FY;   // toward the camera: the near side catches more light, the far side is in the column's shade
        const c = DEVIL[near > .45 ? 0 : near > -.1 ? 1 : near > -.6 ? 2 : 3];
        if (skirt) { PD.alpha = .75 * Math.min(1, kk * 1.4); G.point(x, h, y, DEVIL[1 + (d.tn[i] & 1)], PD); continue; }
        // the whirl: the strands as grains (a short arc now and then), loose grains as arcs of their path round the axis
        const al = (u > .6 ? 1.15 - u * .8 : 1) * Math.min(1, kk * 1.4);
        if (kd === 0 ? i & 1 : i % 3 === 0) {
          const a2 = a - d.om * (kd === 3 ? 1 : d.s[i] * (1.2 - .45 * u)) * D.arc, x2 = ox + Math.cos(a2) * rad, y2 = oy + Math.sin(a2) * rad;
          if (al >= 1 || ((i >> 1) & 3) < al * 4) G.line(x, h, y, x2, h, y2, c, false);
        } else if (al >= 1) G.point(x, h, y, c, PO);
        else { PD.alpha = al; G.point(x, h, y, c, PD); }
      }
    }
  };
  // a few grains thrown up where something lands on sand (tumbleweed.js: a hard bounce); hardpan: a faint puff
  F.puff = (x, y, k = 1) => {
    if (!F.on || !biomeOn || !groundAt) return;
    const gr = groundAt(x, y); if (gr !== 'sand' && gr !== 'pan') return;
    const z = host.elev(x, y), cnt = Math.round((gr === 'sand' ? 3 : 1) * k);
    for (let i = 0; i < cnt; i++) {
      const a = R() * TAU, s = rr(.3, .9);
      if (gr === 'pan') add(3, x, y, z + .03, Math.cos(a) * s * .4, Math.sin(a) * s * .3, rr(.1, .3), rr(.4, .7), z);
      else add(2, x + rr(-.1, .1), y + rr(-.06, .06), z + .03, Math.cos(a) * s, Math.sin(a) * s * .8, rr(.5, 1.2), rr(.3, .55), z);
    }
  };
  F.biomeChanged = () => { clear(); devilIn = 20; };
  F.toggle = () => { F.on = !F.on; if (!F.on) clear(); return F.on; };
  // tests / tuning: a devil now, in the view
  F.devilNow = () => { const c = devilIn; spawnDevil(); devilIn = c; return devils.filter(d => d.on).length; };
  F.info = () => ({on: F.on, desert: biomeOn, grains: n, devils: devils.filter(d => d.on).map(d => ({x: +d.x.toFixed(2), y: +d.y.toFixed(2), k: +d.k.toFixed(2), age: +d.age.toFixed(1), life: +d.life.toFixed(1)})), devilIn: +devilIn.toFixed(1)});
  F.TUNE = TUNE;
  return F;
}
