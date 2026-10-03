// WATERLIFE (atmos): the life on the river's fast water and on the plateau's falling water. All presentation: atmos.js calls it from its
// F.view / F.frame and hands it the pixel helpers; nothing here is read by a sim update (it reads layout.js and world.js's waterSample).
//
//   riffles   small white chevrons and flecks where the river speeds up: through the narrows (y ~ 15), round each stepping stone (a bow wave
//             in front of it, flecks along its flanks, a wake behind it; atmos.js draws the first bit of foam on its upstream side) and where
//             the outflow joins the river's east bank.
//             Stateless: each mark's place is fixed and its look is a function of the water's clock (Tw), so it laps like standing water
//   flecks    white dashes that ride the water at the pace the shader gives it (WATER_TUNE rate x waterSample's speed), on tracks: the rill
//             (2.4 m up, quicker toward the lip), the outflow (slowing into the pool), the narrows. Stateless too: a fleck's place is the
//             inverse of the track's travel-time table at (Tw + phase x cycle), so a quicker river (rain: G.setWater) never makes one jump
//   churn     foam flecks where the plateau's fall lands in the pool and on the water below the ravine's fall (ruins)
//   spray     drops thrown off both falls' lips and up from their feet (lit points: they fall in front of the sheet), and a mist that rises
//             off the foot, thicker in the cold (winter, the frost lands) and at dawn. Pooled SoA, hard cap, only at falls on screen
//   rings     rain rings and arrow splashes on the SHALLOW water (the rill, the outflow), at their own heights (weather.js rings only the
//             deep water, inStream)
//   leaves    autumn: leaves ride the rill, tip over the fall, circle in the pool, leave by the outflow and gather in the eddies on the
//             inside of the river's bends before they fade (up to LCAP at once)
//   sparks    (ember) the lava falls throw sparks, in the emit pass
// Per biome: ruins all of it; frost the frozen fall's cold mist at the pool, the flecks, the riffles at 70 %; ember the sparks and the
// flecks; rift nothing (its water doesn't flow).
//
// OWNS: its tracks, marks, particle / ring / leaf pools. READS: host.layout (stream, rill, fall, pool, outflow, in* tests), world.js
// waterSample + WATER_TUNE (the pace), host.env (season, part, sky, leafFall), host.elev, host.biome.hole (the ravine's edge). EMITS: nothing.
// BUDGET: view + draw ~ .01 ms (+ ~.02 ms for the ~60 fillRects it adds to the ground layer's flush) with both falls and the narrows on
// screen; nothing allocated per frame (tmp-harness node test: 70 KB heap over 20000 frames), every pool capped, off-screen sites skipped.
import {WATER_TUNE, waterSample} from '../../world/world.js';
import {mulberry32} from '../../core/rng.js';

const TAU = Math.PI * 2, CAP = 132, RCAP = 24, LCAP = 12, POOL_LEAVES = 6;   // (leaves in all: at most POOL_LEAVES of them circle in the pool)
const FOAM = ['#f4fcfe', '#cfe6ec', '#9cc0cc'];
const BIO = {
  ruins: {fleck: FOAM, foam: FOAM, drop: ['#f6fdff', '#cfe6ee', '#92b8c8'], mist: ['#e8f1f6', '#c4d6e0', '#98aebe'], ring: ['#d8ecf2', '#9cc0cc', '#6a8e9c'], falls: 'water', riffle: 1, mistK: 1,
    leaf: [['#d0a44a', '#a47a34', '#6c5024'], ['#b8643a', '#8a4428', '#5a2c1c'], ['#c89442', '#9a6a2e', '#68461e']]},
  frost: {fleck: ['#f6faff', '#d6e4f4', '#a2b6d2'], foam: ['#f4f8ff', '#d6e4f4', '#a2b6d2'], drop: ['#ffffff', '#d4e2f2', '#98acc8'], mist: ['#e4ecf8', '#bccae0', '#98a8c4'],
    ring: ['#e8f0fa', '#b4c4dc', '#8494b2'], falls: 'ice', riffle: .7, mistK: 1.6},
  ember: {fleck: ['#ffd070', '#f08a30', '#a8401a'], emit: true, ring: ['#ffc860', '#e07028', '#8a2c12'], falls: 'lava', riffle: 0, spark: ['#ffd27e', '#f28a36', '#b8481c', '#5e200e']},
};
const TUNE = {
  fleck: {rill: 8, out: 4, narrows: 8},     // flecks per track
  rain: {rill: 7, out: 4, size: [.18, .3]},  // rings a second at full rain (on screen), and their reach (m)
  spray: {foot: [5, 9], lip: [4, 7], mist: [9, 13]},   // per second at normal flow: [plateau fall, ravine fall]
  ravine: 27.95,                            // the ruins' stream tips over the ravine edge here (world.js cliffZ; depth.js WA.yEnd 27.85) if biome.hole can't say
};
// chevrons / flecks as flat [i, j, ...] art px: i across the flow, j along it (downstream +)
const CH3 = [-1, 0, 1, 0, 0, 1], CH5 = [-2, 0, 2, 0, -1, 1, 1, 1, 0, 2], BAR = [-1, 0, 0, 0, 1, 0], DOT = [0, 0], DASH = [0, 0, 0, 1];
const BOW3 = [0, 0, -1, 1, 1, 1], BOW5 = [0, 0, -1, 1, 1, 1, -2, 2, 2, 2];   // a bow wave: the chevron pointing UPSTREAM
const ART = [CH3, CH5, BAR, DOT];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function createWaterLife(host, A) {
  const {V, lp, pp, BG, BE, SX, SY, inView, glowAt} = A;
  const W = {}, R = mulberry32(5), rr = (a, b) => a + R() * (b - a), PPM = host.PPM, PPMY = host.PPMY;
  let biome = '', cfg = null, L = null, S = null, ok = false, Tw = 0, mps = 0, wk = 1;
  const O = {kind: 0, a: 0, hw: 0, edge: 0, s: 0, speed: 1, hold: 0}, O2 = {kind: 0, a: 0, hw: 0, edge: 0, s: 0, speed: 1, hold: 0};
  const WH = () => host.world?.waterH ?? -.18;
  const emitMode = () => !!cfg.emit;

  // ------------------------------------------------------------------ tracks: a polyline the water runs along, with its travel-time table
  // v[i] m/s there (the shader's pace: rate / PPM x speed / (ds / dl)); tt[i] seconds from the start at speed 1; Tc = tt[last]
  // The track ends where the water changes kind (the rill's last sample is on the lip's line, which waterSample counts as the pool; the outflow's last
  // ones lie inside the river's band): there is no travel along it past that point
  function track(pts, hw, h, dsMin = .25) {
    waterSample(pts[0][0], pts[0][1], O); const k0 = O.kind; let n = 1;
    while (n < pts.length) { waterSample(pts[n][0], pts[n][1], O); if (O.kind !== k0) break; n++; }
    const t = {n, px: new Float32Array(n), py: new Float32Array(n), tx: new Float32Array(n), ty: new Float32Array(n), hw: new Float32Array(n), tt: new Float32Array(n), v: new Float32Array(n), Tc: 0, len: 0, h};
    const s = new Float32Array(n), sp = new Float32Array(n), ln = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      t.px[i] = pts[i][0]; t.py[i] = pts[i][1]; t.hw[i] = hw[i];
      waterSample(pts[i][0], pts[i][1], O); s[i] = O.s; sp[i] = O.kind ? O.speed : 1;
      if (i) ln[i] = ln[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), dx = t.px[b] - t.px[a], dy = t.py[b] - t.py[a], d = Math.hypot(dx, dy) || 1;
      t.tx[i] = dx / d; t.ty[i] = dy / d;
      const dl = ln[b] - ln[a] || 1, ds = Math.abs(s[b] - s[a]) / dl;   // the shader's travel per metre along the track
      t.v[i] = mps * sp[i] / Math.max(dsMin, ds);
    }
    for (let i = 1; i < n; i++) t.tt[i] = t.tt[i - 1] + (ln[i] - ln[i - 1]) / Math.max(.02, (t.v[i] + t.v[i - 1]) / 2);
    t.Tc = t.tt[n - 1]; t.len = ln[n - 1];
    return t;
  }
  const _p = {x: 0, y: 0, tx: 0, ty: 0, hw: 0, v: 0};
  // the point `tau` seconds along a track (clamped), a fraction a (-1..1) of its half width to the left of the flow
  function at(t, tau, a) {
    let lo = 0, hi = t.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t.tt[m] <= tau) lo = m; else hi = m; }
    const f = clamp((tau - t.tt[lo]) / ((t.tt[hi] - t.tt[lo]) || 1), 0, 1);
    const x = t.px[lo] + (t.px[hi] - t.px[lo]) * f, y = t.py[lo] + (t.py[hi] - t.py[lo]) * f, hw = t.hw[lo] + (t.hw[hi] - t.hw[lo]) * f, tx = t.tx[lo], ty = t.ty[lo];
    _p.x = x - ty * a * hw; _p.y = y + tx * a * hw; _p.tx = tx; _p.ty = ty; _p.hw = hw; _p.v = t.v[lo]; return _p;
  }
  let rillT = null, outT = null, narT = null, riverV = null;
  const RY0 = -1, RDY = .25;
  // m/s the river runs at (speed 1) down its centreline at y (the shader's pace, every streak and leaf on the river follows it)
  const paceAt = y => { if (!riverV) return 0; const f = clamp((y - RY0) / RDY, 0, riverV.length - 1.001), i = f | 0; return riverV[i] + (riverV[i + 1] - riverV[i]) * (f - i); };
  W.pace = paceAt;

  // ------------------------------------------------------------------ marks: the riffles (fixed places on the water)
  let mn = 0, mx = null, my = null, mph = null, mk = null, mrate = null;
  function addMark(x, y, kind, rate) { if (mn >= 64) return; mx[mn] = x; my[mn] = y; mph[mn] = R(); mk[mn] = kind; mrate[mn] = rate; mn++; }
  function buildMarks() {
    mn = 0; mx = new Float32Array(64); my = new Float32Array(64); mph = new Float32Array(64); mk = new Uint8Array(64); mrate = new Float32Array(64);
    if (!cfg.riffle) return;
    const ny = S.narrows.y;   // the narrows: the channel is 1.4 m wide and the water at its quickest; chevrons all along it
    for (let k = 0, n = Math.round(8 * cfg.riffle); k < n; k++) { const y = ny + (k / Math.max(1, n - 1) - .5) * 3 + rr(-.2, .2), u = (k % 2 ? 1 : -1) * rr(.12, .36); addMark(S.cx(y) + u * S.w(y), y, k % 3 === 0 ? 1 : 0, rr(.9, 1.5)); }
    // the outflow's mouth: it meets the river's east bank; a V of chevrons fans downstream from where the two waters mix
    const ex = L.outflow.pts[L.outflow.pts.length - 1];
    for (let k = 0; k < 5; k++) { const y = ex[1] + .1 + k * .27 + rr(-.05, .05), x = ex[0] - .2 - k * .17 + rr(-.1, .1); if (host.inStream(x, y)) addMark(x, y, k % 3 === 0 ? 1 : 0, rr(.8, 1.3)); }
    for (let k = 0; k < 4; k++) { const y = ex[1] - .5 + k * .36, x = S.cx(y) + S.w(y) / 2 - rr(.08, .3); if (host.inStream(x, y)) addMark(x, y, 2, rr(.9, 1.4)); }
  }
  // flecks on the tracks
  const flecks = [];
  function buildFlecks() {
    flecks.length = 0;
    const add = (t, n) => { for (let i = 0; i < n; i++) flecks.push({t, ph: (i + R() * .7) / n, a: rr(-.7, .7), kind: R() < .3 ? 1 : 0, sp: rr(.92, 1.08)}); };
    add(rillT, TUNE.fleck.rill); add(outT, TUNE.fleck.out); if (cfg.riffle) add(narT, TUNE.fleck.narrows);
  }

  // ------------------------------------------------------------------ falls (where the water drops: foot spray, mist, churn, lip drops)
  const falls = [];
  function ravineY() {
    const hole = host.biome?.hole, HM = host.ctxO?.HM;
    if (!hole || !HM) return TUNE.ravine;
    try {   // world.js cliffZ at the stream: the same rule (the biome's own edge, read on both banks)
      const near = (x, y) => Math.abs(x - S.cx(y)) - S.w(y) / 2 < .7, raw = x => { for (let y = HM - 7; y < HM + .5; y += .05) if (hole(x, y) && !near(x, y)) return y + .3; return Infinity; };
      const ys = HM - 2.4, hw = S.w(ys) / 2 + .7, sc = S.cx(ys); let a = raw(sc - hw - .4), b = raw(sc + hw + .4);
      if (!isFinite(a)) a = b; if (!isFinite(b)) b = a; if (!isFinite(a)) return TUNE.ravine;
      return (a + b) / 2;
    } catch { return TUNE.ravine; }
  }
  function buildFalls() {
    falls.length = 0;
    if (!cfg.falls) return;
    const f = L.fall;
    falls.push({id: 0, x: f.x, y: f.foot.y - .06, hw: f.hw * .9, h0: WH(), lipY: f.y + .03, lipH: f.h - .05, acc0: 0, acc1: 0, acc2: 0, on: false});
    if (biome === 'ruins' || biome === 'ember') {
      const y = ravineY(), hw = S.w(y) / 2 - .12;
      falls.push({id: 1, x: S.cx(y), y: y + .05, hw, h0: -3.44, lipY: y - .03, lipH: WH(), acc0: 0, acc1: 0, acc2: 0, on: false});
    }
  }
  W.falls = () => falls;
  // a fall is on screen when its foot, its lip or the middle of the sheet is
  const faceOn = f => { const m = 36 * V.z; return inView(SX(f.x, f.y, f.h0), SY(f.x, f.y, f.h0), m) || inView(SX(f.x, f.y, f.lipH), SY(f.x, f.y, f.lipH), m) || inView(SX(f.x, f.y, (f.h0 + f.lipH) / 2), SY(f.x, f.y, (f.h0 + f.lipH) / 2), m); };

  // ------------------------------------------------------------------ particles (SoA): 0 drop, 1 mist, 2 spark
  const px = new Float32Array(CAP), py = new Float32Array(CAP), ph = new Float32Array(CAP), vx = new Float32Array(CAP), vy = new Float32Array(CAP), vh = new Float32Array(CAP);
  const pt = new Float32Array(CAP), pl = new Float32Array(CAP), pf = new Float32Array(CAP), pk = new Uint8Array(CAP);   // pf: the height a drop ends at
  let pn = 0;
  function spawn(k, x, y, h, a, b, c, life, floor) {
    if (pn >= CAP) return;
    px[pn] = x; py[pn] = y; ph[pn] = h; vx[pn] = a; vy[pn] = b; vh[pn] = c; pt[pn] = 0; pl[pn] = life; pf[pn] = floor; pk[pn] = k; pn++;
  }
  const rm = i => { pn--; px[i] = px[pn]; py[i] = py[pn]; ph[i] = ph[pn]; vx[i] = vx[pn]; vy[i] = vy[pn]; vh[i] = vh[pn]; pt[i] = pt[pn]; pl[i] = pl[pn]; pf[i] = pf[pn]; pk[i] = pk[pn]; };
  // rings on the shallow water: surf 1 = the rill, 2 = the outflow
  const rx = new Float32Array(RCAP), ry = new Float32Array(RCAP), rh = new Float32Array(RCAP), rt = new Float32Array(RCAP), rs = new Float32Array(RCAP), rf = new Uint8Array(RCAP);
  const rlim = new Float32Array(RCAP * 16);   // per ring: how far from its centre the water goes in 16 directions (found when it spawns: drawing then needs no water test per pixel)
  let rn = 0;
  const RLIFE = .7, rainAcc = [0, 0];
  const onSurf = (s, x, y) => s === 1 ? L.inRill(x, y) : L.inOutflow(x, y);
  function ring(x, y, surf, size) {
    if (rn >= RCAP) return;
    rx[rn] = x; ry[rn] = y; rh[rn] = host.elev(x, y) + .01; rt[rn] = 0; rs[rn] = size; rf[rn] = surf;
    for (let k = 0; k < 16; k++) {   // (the ring's y is squashed .8 like the river's rings)
      const c = Math.cos(k * TAU / 16), sn = Math.sin(k * TAU / 16) * .8; let r = 0;
      while (r < size + .1 && onSurf(surf, x + c * (r + .05), y + sn * (r + .05))) r += .05;
      rlim[rn * 16 + k] = r;
    }
    rn++;
  }
  // an arrow stuck in shallow water (atmos' onArrowStuck, called in the sim step: it only fills these pools, which nothing in the sim reads)
  W.arrowStuck = a => {
    if (!ok) return;
    const s = L.inRill(a.x, a.y) ? 1 : L.inOutflow(a.x, a.y) ? 2 : 0, g = host.elev(a.x, a.y); if (!s || a.h > g + .35) return;
    ring(a.x, a.y, s, .55);
    for (let i = 0; i < 5; i++) { const ang = R() * TAU, sp = rr(.2, .7); spawn(0, a.x, a.y, g + .03, Math.cos(ang) * sp, Math.sin(ang) * sp * .7, rr(1.2, 2.2), rr(.35, .55), g); }
  };

  // ------------------------------------------------------------------ leaves (autumn): rill -> fall -> pool -> outflow -> river eddies
  // st: 0 on the rill (tau = seconds along the track) 1 falling 2 circling in the pool 3 on the outflow 4 in the river (y, across u) -1 free
  const lq = [];
  for (let i = 0; i < LCAP; i++) lq.push({st: -1, t: 0, tau: 0, a: 0, x: 0, y: 0, h: 0, ang: 0, w: 1, u: 0, life: 0, pal: 0, ph: 0});
  let leafAcc = 0, leafN = 0;
  // the side of the river a bend is inside: the centreline curves toward it (cx'' < 0: west, -1)
  const insideOf = y => S.cx(y + .5) + S.cx(y - .5) - 2 * S.cx(y) < 0 ? -1 : 1;
  function leafSpawn(q) { q.st = 0; q.t = 0; q.tau = rr(.4, .85) * rillT.Tc; q.a = rr(-.55, .55); q.pal = R() * 3 | 0; q.ph = R() * TAU; q.w = R() < .5 ? -1 : 1; q.life = rr(16, 30); }
  function stepLeaf(q, dt) {
    q.t += dt;
    switch (q.st) {
      case 0: {   // on the rill, at its pace
        const p = at(rillT, q.tau, q.a); q.tau += dt * wk; q.x = p.x; q.y = p.y; q.h = host.elev(p.x, p.y) + .01;
        if (q.tau >= rillT.Tc - .02) { q.st = 1; q.t = 0; q.x = L.fall.x + q.a * L.fall.hw * .8; q.y = L.fall.y + .04; q.h = L.fall.h; }
        break;
      }
      case 1:   // over the lip and down in front of the sheet, a little blown out
        q.y += dt * .5; q.h -= dt * (1.6 + q.t * 7);
        if (q.h <= WH()) {
          if (W.poolLeaves() >= POOL_LEAVES) { q.st = -1; break; }   // the pool is full: this one sinks
          q.h = WH(); q.st = 2; q.t = 0; q.ang = Math.atan2((q.y - L.pool.y) / L.pool.ry, (q.x - L.pool.x) / L.pool.rx); q.life = rr(14, 30);
        }
        break;
      case 2: {   // circling in the pool: slow, a margin off the bank; it leaves by the outflow's mouth, on the pool's west side, once it has stayed its time
        q.ang += q.w * dt * wk * (.32 + .1 * Math.sin(q.ph + q.t * .4));
        const k = .72 + .1 * Math.sin(q.ph * 2 + q.t * .3);
        q.x = L.pool.x + Math.cos(q.ang) * (L.pool.rx - .22) * k; q.y = L.pool.y + Math.sin(q.ang) * (L.pool.ry - .18) * k; q.h = WH();
        if (q.y < L.pool.clip + .12) q.y = L.pool.clip + .12;
        if (q.t > q.life && Math.cos(q.ang) < -.7) { q.st = 3; q.t = 0; q.tau = 0; q.a = rr(-.3, .3); }
        break;
      }
      case 3: {   // out along the outflow, at its pace
        const p = at(outT, q.tau, q.a); q.tau += dt * wk; q.x = p.x; q.y = p.y; q.h = host.elev(p.x, p.y) + .01;
        if (q.tau >= outT.Tc - .05) { q.st = 4; q.t = 0; q.life = rr(12, 24); q.u = clamp((q.x - S.cx(q.y)) / S.w(q.y), -.45, .45); q.x = S.cx(q.y) + q.u * S.w(q.y); }
        break;
      }
      case 4: {   // in the river: south at its pace, slowing and drifting to the inside bank of its bend, to wait there until it fades
        q.u += (insideOf(q.y) * .39 - q.u) * (1 - Math.exp(-dt * .5));
        q.y += paceAt(q.y) * (1 - .88 * Math.min(1, Math.abs(q.u) / .36)) * dt * wk; q.x = S.cx(q.y) + q.u * S.w(q.y); q.h = WH();
        if (q.t > q.life || q.y > 29) q.st = -1;
        break;
      }
    }
  }
  W.poolLeaves = () => { let n = 0; for (const q of lq) if (q.st === 2) n++; return n; };
  function stepLeaves(dt, E) {
    const k = biome === 'ruins' && E && E.tinted ? clamp((E.leafFall || 0) * 1.6 + (E.season === 'autumn' ? .2 : 0), 0, 1) : 0, want = Math.round(k * LCAP);
    leafN = 0; leafAcc = Math.min(2, leafAcc + dt * (.06 + .3 * k) * (.6 + .8 * R()));
    for (const q of lq) {
      if (q.st < 0) { if (leafAcc >= 1 && leafN < want) { leafAcc -= 1; leafSpawn(q); } else continue; }
      stepLeaf(q, dt); if (q.st >= 0) leafN++;
    }
  }

  // ------------------------------------------------------------------ build / per-biome state
  function sync() {
    ok = false; biome = host.biome.id; cfg = BIO[biome] || null; L = host.layout; S = L?.stream;
    mps = (WATER_TUNE[biome]?.rate || 0) / PPM;
    pn = 0; rn = 0; for (const q of lq) q.st = -1;
    if (!cfg || !S || !L.rill || !L.fall || !mps) { falls.length = 0; mn = 0; flecks.length = 0; riverV = rillT = outT = narT = null; return; }
    rillT = track(L.rill.pts, L.rill.hw, 0); outT = track(L.outflow.pts, L.outflow.hw, 0, .6);   // (its mouth: the pattern there moves with the river's travel, not along the channel: the pace is floored)
      // (h 0: the surface is read from host.elev)
    const ny = S.narrows.y, np = [], nh = []; for (let y = ny - 2.3; y <= ny + 2.3; y += .1) { np.push([S.cx(y), y]); nh.push(S.w(y) / 2); }
    narT = track(np, nh, WH());
    const ng = Math.round((31 - RY0) / RDY) + 2; riverV = new Float32Array(ng);
    for (let i = 0; i < ng; i++) {   // m/s at speed 1 down the centreline: the shader's rate over its travel per metre (ds / dy)
      const y = RY0 + i * RDY; waterSample(S.cx(y - .05), y - .05, O); const s0 = O.s; waterSample(S.cx(y + .05), y + .05, O2);
      riverV[i] = mps / Math.max(.2, Math.abs(O2.s - s0) / .1);
    }
    buildMarks(); buildFlecks(); buildFalls();
    ok = true;
  }
  W.sync = sync;

  // ------------------------------------------------------------------ the step (presentation: after every sim step)
  function mistK() {
    const E = host.env; let k = cfg.mistK || 1;
    if (E) { if (E.season === 'winter' && biome !== 'frost') k += .7; else if (E.season === 'autumn') k += .25; if (E.part === 'dawn') k += .8; else if (E.part === 'dusk') k += .15; k += .4 * (E.sky?.fog || 0); }
    return k;
  }
  const rainSeen = (x, y, h) => inView(SX(x, y, h), SY(x, y, h), 8 * V.z);
  W.view = function (dt, waterK) {
    if (!ok) return;
    wk = waterK; Tw += dt * wk;
    for (let i = pn - 1; i >= 0; i--) {   // the pools age
      const t = pt[i] += dt; if (t >= pl[i]) { rm(i); continue; }
      const k = pk[i];
      if (k === 0) {   // a drop
        vh[i] -= 9 * dt; const d = Math.exp(-dt * .8); vx[i] *= d; vy[i] *= d; px[i] += vx[i] * dt; py[i] += vy[i] * dt; ph[i] += vh[i] * dt;
        if (ph[i] <= pf[i] && vh[i] < 0) rm(i);
      } else {   // mist rises, spreads and thins and the wind takes it; a spark rises and sways
        vh[i] *= Math.exp(-dt * (k === 1 ? .7 : .5)); vx[i] += (A.wind() * (k === 1 ? .35 : .4) - vx[i]) * Math.min(1, dt * 1.2);
        ph[i] += vh[i] * dt; px[i] += (vx[i] + (k === 2 ? Math.sin(t * 3 + i) * .05 : 0)) * dt; py[i] += vy[i] * dt;
      }
    }
    for (let i = rn - 1; i >= 0; i--) if ((rt[i] += dt) >= RLIFE) { rn--; rx[i] = rx[rn]; ry[i] = ry[rn]; rh[i] = rh[rn]; rt[i] = rt[rn]; rs[i] = rs[rn]; rf[i] = rf[rn]; for (let k = 0; k < 16; k++) rlim[i * 16 + k] = rlim[rn * 16 + k]; }
    const m0 = mistK(), E = host.env, water = cfg.falls === 'water', lava = cfg.falls === 'lava', ice = cfg.falls === 'ice';
    for (const f of falls) {   // the falls on screen emit
      f.on = faceOn(f); if (!f.on) continue;
      const b = f.id;
      if (water) {
        f.acc0 += dt * TUNE.spray.foot[b] * wk; f.acc1 += dt * TUNE.spray.lip[b] * wk;
        for (; f.acc0 >= 1; f.acc0--) {   // thrown up where the sheet lands, out over the pool
          const u = rr(-1, 1), a = Math.atan2(rr(.1, 1), u * .8 + rr(-.2, .2)), s = rr(.5, 1.3);
          spawn(0, f.x + u * f.hw, f.y + rr(0, .22), f.h0 + .04, Math.cos(a) * s * .5, Math.abs(Math.sin(a)) * s * .7, rr(1.3, 2.7), rr(.45, .8), f.h0);
        }
        for (; f.acc1 >= 1; f.acc1--) spawn(0, f.x + rr(-1, 1) * f.hw, f.lipY, f.lipH, rr(-.15, .15), rr(.25, .8), rr(-.1, .5), 1.2, f.h0);   // off the lip
      }
      if (water || ice) {
        f.acc2 += dt * TUNE.spray.mist[b] * m0 * (ice ? .5 : 1);
        for (; f.acc2 >= 1; f.acc2--) spawn(1, f.x + rr(-1, 1) * (f.hw + .12), f.y + rr(.04, .45), f.h0 + rr(.03, .35), rr(-.08, .08), rr(0, .14), rr(.3, .62), rr(1.8, 3), 99);
      } else if (lava) {
        f.acc2 += dt * (b ? 5 : 3);
        for (; f.acc2 >= 1; f.acc2--) spawn(2, f.x + rr(-1, 1) * f.hw, f.y + rr(0, .2), f.h0 + rr(.05, .3), rr(-.1, .1), rr(0, .1), rr(.3, .8), rr(.9, 1.7), 99);
      }
    }
    const rain = E ? clamp(E.sky.rain, 0, 1) : 0;   // rain rings on the shallow water, where it is on screen
    if (rain > .04 && A.weatherOn()) {
      rainAcc[0] += dt * TUNE.rain.rill * rain; rainAcc[1] += dt * TUNE.rain.out * rain;
      for (; rainAcc[0] >= 1; rainAcc[0]--) { const p = at(rillT, R() * rillT.Tc, rr(-.9, .9)); if (rainSeen(p.x, p.y, host.elev(p.x, p.y))) ring(p.x, p.y, 1, rr(...TUNE.rain.size)); }
      for (; rainAcc[1] >= 1; rainAcc[1]--) { const p = at(outT, R() * outT.Tc, rr(-.9, .9)); if (rainSeen(p.x, p.y, 0)) ring(p.x, p.y, 2, rr(...TUNE.rain.size)); }
    } else rainAcc[0] = rainAcc[1] = 0;
    stepLeaves(dt, E);
  };

  // ------------------------------------------------------------------ drawing
  // the screen's flow axes (world +y downstream, +x across) as unit vectors: art px (i across, j along) -> screen offsets
  let ux = 0, uy = 1, nx = 1, ny = 0;
  function axes() { const ul = Math.hypot(V.yx, V.yy) || 1, nl = Math.hypot(V.xx, V.xy) || 1; ux = V.yx / ul; uy = V.yy / ul; nx = V.xx / nl; ny = V.xy / nl; }
  const offX = (i, j) => Math.round(nx * i + ux * j), offY = (i, j) => Math.round(ny * i + uy * j);
  let bk = null, em = false;
  const ga = (x, y, h) => { if (em) glowAt(x, y, h); };
  function art(c, X, Y, a, di, dj) { for (let k = 0; k < a.length; k += 2) lp(bk, c, X, Y, offX(a[k] + di, a[k + 1] + dj), offY(a[k] + di, a[k + 1] + dj)); }
  const lap = (pal, ph) => pal[ph < .22 ? 2 : ph < .5 ? 0 : 1];   // a mark's tone as it laps: dim, bright, mid
  function dash(c, X, Y, dx, dy, len) {   // along the screen direction (dx, dy): one rect when it runs along an axis, else a pixel at a time
    const l = Math.hypot(dx, dy) || 1, sx = dx / l, sy = dy / l, ax = Math.abs(sx), ay = Math.abs(sy);
    if (ay < .38) lp(bk, c, X, Y, sx < 0 ? 1 - len : 0, 0, len, 1);
    else if (ax < .38) lp(bk, c, X, Y, 0, sy < 0 ? 1 - len : 0, 1, len);
    else for (let k = 0; k < len; k++) lp(bk, c, X, Y, sx < 0 ? -k : k, sy < 0 ? -k : k);
  }

  // the water's marks on the ground layer ('ground'), or in the emit pass for a glowing biome ('emit')
  W.draw = function (pass) {
    if (!ok) return;
    em = emitMode();
    if ((pass === 'emit') !== em) return;
    bk = em ? BE : BG; axes();
    const h = WH();
    for (let i = 0; i < mn; i++) {   // riffles
      const X = Math.floor(SX(mx[i], my[i], h)), Y = Math.floor(SY(mx[i], my[i], h)); if (!inView(X, Y, 8 * V.z)) continue;
      const p = (Tw * mrate[i] + mph[i]) % 1; if (p > .68) continue;
      art(lap(cfg.foam, p), X, Y, ART[mk[i]], 0, p > .4 ? 1 : 0);
    }
    const pal = cfg.fleck;   // flecks on the tracks
    for (let i = 0; i < flecks.length; i++) {
      const f = flecks[i], t = f.t, tau = (Tw * f.sp + f.ph * t.Tc) % t.Tc, k = tau / t.Tc; if (k < .04 || k > .96) continue;
      const p = at(t, tau, f.a), hh = t.h === 0 ? host.elev(p.x, p.y) + .005 : t.h, X = Math.floor(SX(p.x, p.y, hh)), Y = Math.floor(SY(p.x, p.y, hh)); if (!inView(X, Y, 6 * V.z)) continue;
      const fast = clamp(p.v / (mps * 1.6 + 1e-6), 0, 1);
      ga(p.x, p.y, hh); dash(pal[fast > .55 ? 0 : fast > .3 ? 1 : 2], X, Y, p.tx * V.xx + p.ty * V.yx, p.tx * V.xy + p.ty * V.yy, f.kind ? 3 : 2);
    }
    if (cfg.falls === 'water') churn();
    if (cfg.riffle) stones();
    rings();
    leaves();
    if (em) sparks();
  };
  function churn() {   // foam flecks where a fall lands: they open outward over the pool / the water below the ravine
    const pal = cfg.foam;
    for (const f of falls) {
      if (!f.on) continue;
      for (let k = 0; k < 10; k++) {
        const p = (Tw * 1.15 + k * .6180339) % 1, u = ((k * .381966) % 1) * 2 - 1, x = f.x + u * f.hw * (.9 + p * .5), y = f.y + .06 + p * (.35 + .2 * Math.abs(u)) * (f.id ? 1.4 : 1);
        if (!f.id && !L.inPool(x, y)) continue;
        const X = Math.floor(SX(x, y, f.h0)), Y = Math.floor(SY(x, y, f.h0)); if (!inView(X, Y, 4 * V.z)) continue;
        lp(bk, p < .35 ? pal[0] : p < .7 ? pal[1] : pal[2], X, Y, 0, 0, p < .5 ? 2 : 1, 1);
      }
      if (!f.id) for (let k = 0; k < 2; k++) {   // and slow ripples opening out over the pool (its half south of the foot), in dim foam
        const p = (Tw * .45 + k / 2) % 1, rad = .12 + p, n = Math.max(6, Math.ceil(Math.PI * rad * PPM / 3.2)), c = p < .45 ? pal[1] : pal[2];
        for (let j = 0; j < n; j++) {
          const a = (.12 + j / (n - 1) * .76) * Math.PI, x = f.x + Math.cos(a) * rad * 1.15, y = f.y + .1 + Math.sin(a) * rad * .8;
          if (L.inPool(x, y)) lp(bk, c, Math.floor(SX(x, y, f.h0)), Math.floor(SY(x, y, f.h0)), 0, 0, 2, 1);
        }
      }
    }
  }
  function stones() {   // the water round a stepping stone: a bow wave piling up in front of it, flecks along its flanks, a wake behind (atmos.js draws the foam's first bit)
    const h = WH(), pal = cfg.foam, f = (Tw * 3.3) % 1;
    for (let i = 0; i < S.stones.length; i++) {
      const st = S.stones[i], X = Math.floor(SX(st.x, st.y, h)), Y = Math.floor(SY(st.x, st.y, h)); if (!inView(X, Y, 16 * V.z)) continue;
      const r = Math.round(st.r * PPM), d = Math.round(st.r / 1.3 * PPMY), q = (Tw * .9 + i * .37) % 1, b = (Tw * 1.7 + i * .5) % 1;
      art(b < .5 ? pal[0] : pal[1], X, Y, BOW5, 0, -d - 5 + (b < .5 ? 0 : 1));   // (the stone's upstream edge is d px up: the existing foam sits there)
      art(pal[0], X, Y, BOW3, -r + 3 + Math.round(b * 2), -d - 2); art(pal[0], X, Y, BOW3, r - 3 - Math.round(b * 2), -d - 2);
      art(pal[0], X, Y, f < .5 ? DOT : DASH, -r - 2, d - 3 + (f < .5 ? 0 : 1));
      art(pal[0], X, Y, f < .5 ? DASH : DOT, r + 2, d - 3 + (f < .5 ? 1 : 0));
      art(q < .5 ? pal[0] : pal[1], X, Y, CH5, 0, d + 1 + Math.round(q * 6));   // a chevron slipping away downstream, fading
      art(pal[2], X, Y, DOT, -3, d + 3 + Math.round(((q + .5) % 1) * 6));
      art(pal[2], X, Y, DOT, 3, d + 4 + Math.round(((q + .25) % 1) * 6));
    }
  }
  function rings() {
    const pal = cfg.ring;
    for (let i = 0; i < rn; i++) {
      const k = rt[i] / RLIFE, e = 1 - (1 - k) * (1 - k), rad = .08 + rs[i] * e, n = Math.min(16, Math.max(8, Math.round(TAU * rad * PPM / 2.4))), c = pal[Math.min(2, k * 3 | 0)];   // (a dotted ring: 8-16 points)
      if (!inView(SX(rx[i], ry[i], rh[i]), SY(rx[i], ry[i], rh[i]), (rad * PPM + 6) * V.z)) continue;
      ga(rx[i], ry[i], rh[i]);
      for (let j = 0; j < n; j++) {
        const a = j / n * TAU, kf = j / n * 16, k0 = kf | 0, f = kf - k0, lim = rlim[i * 16 + k0] * (1 - f) + rlim[i * 16 + ((k0 + 1) & 15)] * f;
        if (rad > lim + .03) continue;   // (on the bank, not on the water)
        const wx = rx[i] + Math.cos(a) * rad, wy = ry[i] + Math.sin(a) * rad * .8;
        lp(bk, c, Math.floor(SX(wx, wy, rh[i])), Math.floor(SY(wx, wy, rh[i])));
      }
    }
  }
  function leaves() {
    if (!leafN) return;
    for (const q of lq) {
      if (q.st < 0 || q.st === 1) continue;
      const X = Math.floor(SX(q.x, q.y, q.h)), Y = Math.floor(SY(q.x, q.y, q.h)); if (!inView(X, Y, 3 * V.z)) continue;
      const P = BIO.ruins.leaf[q.pal], old = q.st === 4 ? q.t / q.life : q.st === 2 ? q.t / (q.life * 1.6) : 0, c = P[old > .85 ? 2 : old > .5 ? 1 : 0], f = ((Tw * 1.4 + q.ph) | 0) & 1;
      lp(bk, c, X, Y, 0, 0, f ? 2 : 1, 1); if (!f) lp(bk, P[1], X, Y, 0, 1);
    }
  }
  function sparks() {
    const pal = cfg.spark;
    for (let i = 0; i < pn; i++) {
      if (pk[i] !== 2) continue;
      const X = Math.floor(SX(px[i], py[i], ph[i])), Y = Math.floor(SY(px[i], py[i], ph[i])); if (!inView(X, Y, 3 * V.z)) continue;
      glowAt(px[i], py[i], ph[i]); lp(BE, pal[Math.min(3, pt[i] / pl[i] * 4 | 0)], X, Y);
    }
  }
  W.drawFront = function () {   // lit points: drops, mist, a leaf falling over the lip
    if (!ok) return;
    const dp = cfg.drop, mp = cfg.mist;
    for (let i = 0; i < pn; i++) {
      const k = pk[i]; if (k === 2) continue;
      if (!inView(SX(px[i], py[i], ph[i]), SY(px[i], py[i], ph[i]), 4 * V.z)) continue;
      const a = pt[i] / pl[i];
      if (k === 0) pp(px[i], py[i], ph[i], dp[a < .55 ? 0 : a < .85 ? 1 : 2]);
      else {   // mist: dim as it forms and as it goes, a mid tone between; two pixels wide at first, then one
        const io = Math.min(a / .22, (1 - a) / .35);
        pp(px[i], py[i], ph[i], mp[io >= 1 ? 1 : 2]); if (a < .5 && io >= .6) pp(px[i], py[i], ph[i], mp[2], 1, 0);
      }
    }
    for (const q of lq) if (q.st === 1) { const P = BIO.ruins.leaf[q.pal]; pp(q.x, q.y, q.h, P[0]); pp(q.x, q.y, q.h, P[1], 1, 0); }
  };
  W.counts = () => ({spray: pn, rings: rn, leaves: leafN, flecks: flecks.length, marks: mn});
  W.dbg = {get pn() { return pn; }, lq, falls, flecks, get tracks() { return {rillT, outT, narT}; }, at, paceAt, get Tw() { return Tw; }};
  return W;
}
