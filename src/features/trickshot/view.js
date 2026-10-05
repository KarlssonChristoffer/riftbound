// TRICK-SHOT RANGE, the VIEW (features/trickshot.js): how the range looks. Reads the sim (features/trickshot/sim.js) and its
// events, writes only its own state; with ?views=0 or the feature off nothing in play changes.
//   meshes   the fence + crate + the plate's frame (one static piece: the cached static sun shadow, sScene layers 1 + 2),
//            the steel plate (static until it swings: then it casts per frame), the six bottles (one static mesh of the ones
//            standing, made again when one breaks),
//            the cans (moving: per-frame shadow, layer 0): each tumbles in the air (a spin from each hit), lies down and
//            rolls about its long axis on the ground, stands upright on the crate
//   glass    a bottle breaking: shards and glints thrown along the shot, falling, skittering and lying a while
//   plate    a ring of the steel plate (trick.ding) swings it on its chains (a damped spring)
//   mark     the shooting mark: a dotted line on the ground, 5-6 m in front of the fence
//   HD       the range's panel (top right): the fence (bottles up, the clock, the best time), shots / hits / accuracy,
//            ricochets, the juggle and its best, the keys (painted into its own canvas when they change, copied each
//            frame); "x3" over a can in the air; a banner (top centre) when the fence is cleared; "Juggle x5" where a
//            juggle ends
// OWNS: its meshes (host.world.mesh; a rebuilt world disposes them: made again at the next draw), the cans' spin, the
//   plate's swing, the shard pool (typed arrays, capped; nothing allocated per frame), the HD texts' timers.
// READS: the sim (bottles, cans, plate, stats, records, clear), host (G, PPM, zoom, yaw, player, weapon), events.
// BUDGET: frame ~.02 ms (<= 13 setMatrix compares, <= 240 shard points, 30 mark points); HD ~8 texts while at the range.
import * as THREE from 'three';
import {buildModels, SHAPE} from './models.js';
import {TUNE as ST} from './sim.js';
import {viewRandom} from '../../core/rng.js';
import {rgbOf} from '../../core/color.js';
import {clamp, hypot2} from '../../core/mathx.js';

export const TUNE = {
  shards: {max: 240, n: 28, glints: 7, along: [.2, 1.7], spread: 1.4, up: [.3, 2.3], life: [2.2, 4], g: 9.8, skid: .35},
  spin: {hit: [9, 20], toss: [4, 8], settle: 14, damp: 8},   // rad/s from a hit / a toss; how fast it lies down on the ground
  swing: {kick: 5.5, k: 38, damp: 2.6},                       // the plate: rad/s per ring, spring, damping
  float: {t: .9, rise: .35, end: 1.4},                        // "x3" over a can (s, m it rises); "Juggle x5" (s)
  banner: 2.8,
};
const PAL = {amber: ['#fff0b8', '#e8b848', '#a87a24'], green: ['#d8f0b0', '#8ab06a', '#4f6f3e']};
const GLINT = rgbOf('#ffffff'), MARK = rgbOf('#e8dcc0'), MARK2 = rgbOf('#9a8c70');
const FONT = '"Segoe UI", system-ui, sans-serif';

export function createRangeView(host, S) {
  const V = viewRandom('trickshot'), VR = (a, b) => a + V() * (b - a);
  const COLS = [], BASE = {}; for (const k of Object.keys(PAL)) { BASE[k] = COLS.length; for (const c of PAL[k]) COLS.push(rgbOf(c)); }
  // ---- meshes
  let M = null;   // {yard, plate, bottles (one mesh: the ones standing), cans: []} | null
  const cVis = [], Q = [], W = [];   // the cans' shown state; their spin (quaternion, rad/s)
  // THE BOTTLES are one mesh of the ones standing (one draw, not six): made again when one breaks or they are set up (a few
  // hundred vertices, a one-off); each bottle's vertex arrays, placed on the rail, are kept from the first make
  const ATTR = [['position', 3], ['normal', 3], ['aPart', 1], ['aFam', 1], ['aBias', 1], ['aFixed', 1]];
  let BV = null, bMask = -1, bGeo = null;
  function bottleArrays(G) {
    BV = S.bottles.map(b => {
      const g = G.bottle[b.glass], dx = b.p.x - S.A.x, dh = b.p.h, dz = b.p.y - S.A.y, out = {};
      for (const [n] of ATTR) out[n] = g.attributes[n].array.slice();
      const P = out.position; for (let i = 0; i < P.length; i += 3) { P[i] += dx; P[i + 1] += dh; P[i + 2] += dz; }
      return out;
    });
  }
  function bottleGeo(mask) {
    const geo = new THREE.BufferGeometry();
    for (const [n, k] of ATTR) {
      let len = 0; for (let i = 0; i < BV.length; i++) if (mask & 1 << i) len += BV[i][n].length;
      const a = new Float32Array(Math.max(k, len)); let o = 0;
      for (let i = 0; i < BV.length; i++) if (mask & 1 << i) { a.set(BV[i][n], o); o += BV[i][n].length; }
      geo.setAttribute(n, new THREE.BufferAttribute(a, k));
    }
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return geo;
  }
  function syncBottles() {
    let m = 0; for (let i = 0; i < S.bottles.length; i++) if (!S.bottles[i].p.gone) m |= 1 << i;
    if (m === bMask) return;
    bMask = m;
    if (m) { const g = bottleGeo(m); M.bottles.setGeometry(g); bGeo?.dispose(); bGeo = g; }
    M.bottles.setVisible(m !== 0);
  }
  for (let i = 0; i < 8; i++) { Q.push(new THREE.Quaternion()); W.push(new THREE.Vector3()); }
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(),
    _a = new THREE.Vector3(), _b = new THREE.Vector3(), _I = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  const PS = new Float64Array(3).fill(NaN); PS[0] = PS[1] = 0;   // the plate's swing: angle, rate, the angle shown (a typed array: no boxed doubles a frame)
  function make() {
    const G = buildModels(), A = S.A, Pl = SHAPE.plate;
    M = {bottles: null, cans: []};
    M.yard = host.world.mesh(G.yard, _m.makeTranslation(A.x, 0, A.y), {occlude: true, static: true});
    M.plate = host.world.mesh(G.plate, _m.makeTranslation(A.x + Pl.x, Pl.pivot, A.y + Pl.y), {static: true});
    PS[2] = 0;
    if (!BV) bottleArrays(G);
    bMask = -1; bGeo?.dispose(); bGeo = bottleGeo((1 << S.bottles.length) - 1);
    M.bottles = host.world.mesh(bGeo, _m.makeTranslation(A.x, 0, A.y), {static: true});
    for (let i = 0; i < S.cans.length; i++) { M.cans.push(host.world.mesh(G.can, _m.makeTranslation(S.cans[i].x, S.cans[i].c, S.cans[i].y), {})); cVis[i] = true; Q[i].identity(); W[i].set(0, 0, 0); }
  }
  function drop() {
    if (M) { M.yard.dispose(); M.plate.dispose(); M.bottles.dispose(); for (const m of M.cans) m.dispose(); }
    M = null; nS = 0; floats.length = 0; banner.t = 9; bGeo?.dispose(); bGeo = null; bMask = -1;
  }

  // ---- glass: shards (structure of arrays)
  const NS = TUNE.shards.max, sx = new Float32Array(NS), sy = new Float32Array(NS), sh = new Float32Array(NS), svx = new Float32Array(NS),
    svy = new Float32Array(NS), svh = new Float32Array(NS), st = new Float32Array(NS), sl = new Float32Array(NS), sc = new Uint8Array(NS), sg = new Uint8Array(NS);
  let nS = 0;
  function shard(x, y, h, vx, vy, vh, life, col, glint) {
    if (nS >= NS) return;
    const i = nS++; sx[i] = x; sy[i] = y; sh[i] = h; svx[i] = vx; svy[i] = vy; svh[i] = vh; st[i] = 0; sl[i] = life; sc[i] = col; sg[i] = glint;
  }
  function shatter(e) {
    const T = TUNE.shards, b0 = BASE[e.glass] ?? 0, ux = e.dx || 0, uy = e.dy || 0;
    for (let i = 0; i < T.n + T.glints; i++) {
      const g = i >= T.n ? 1 : 0, a = V() * Math.PI * 2, r = VR(.2, 1) * T.spread, on = VR(T.along[0], T.along[1]);
      shard(e.x + VR(-.03, .03), e.y + VR(-.03, .03), e.h + VR(-.1, .12), ux * on + Math.cos(a) * r, uy * on + Math.sin(a) * r * .8, VR(T.up[0], T.up[1]),
        g ? VR(.08, .2) : VR(T.life[0], T.life[1]), b0 + (i % 3), g);
    }
  }
  function stepShards(dt) {
    const T = TUNE.shards;
    for (let i = nS - 1; i >= 0; i--) {
      st[i] += dt;
      if (st[i] >= sl[i]) { nS--; sx[i] = sx[nS]; sy[i] = sy[nS]; sh[i] = sh[nS]; svx[i] = svx[nS]; svy[i] = svy[nS]; svh[i] = svh[nS]; st[i] = st[nS]; sl[i] = sl[nS]; sc[i] = sc[nS]; sg[i] = sg[nS]; continue; }
      if (svh[i] === 0 && svx[i] === 0 && svy[i] === 0) continue;   // lying
      svh[i] -= T.g * dt; sx[i] += svx[i] * dt; sy[i] += svy[i] * dt; sh[i] += svh[i] * dt;
      const gz = host.elev(sx[i], sy[i]);
      if (sh[i] <= gz) {   // a skitter, then it lies
        sh[i] = gz;
        if (svh[i] < -1.5) { svh[i] = -svh[i] * .22; svx[i] *= T.skid; svy[i] *= T.skid; } else svh[i] = svx[i] = svy[i] = 0;
      }
    }
  }

  // ---- HD texts: "x3" over a can (who, n, t), "Juggle x5" where one ended (x, y, h, n, best, t), the clear banner
  const floats = [];   // {kind: 0 over a can | 1 at a spot, who, x, y, h, n, best, t}: reused records
  const pool = [];
  function float(kind, who, x, y, h, n, best) {
    for (const f of floats) if (kind === 0 && f.kind === 0 && f.who === who) { f.n = n; f.t = 0; return; }
    const f = pool.pop() || {kind: 0, who: null, x: 0, y: 0, h: 0, n: 0, best: false, t: 0};
    f.kind = kind; f.who = who; f.x = x; f.y = y; f.h = h; f.n = n; f.best = best; f.t = 0; floats.push(f);
    if (floats.length > 8) pool.push(floats.shift());
  }
  const banner = {t: 9, time: 0, best: false, shots: 0, prev: 0};

  // ---- the step
  const canIndex = p => { for (let i = 0; i < S.cans.length; i++) if (S.cans[i].p === p) return i; return -1; };
  function spin(i, lo, hi, horiz) {
    const a = V() * Math.PI * 2, z = horiz ? 0 : VR(-.6, .6), r = Math.sqrt(1 - z * z), w = VR(lo, hi);
    W[i].set(Math.cos(a) * r * w, z * w, Math.sin(a) * r * w);
  }
  function view(dt, evs) {
    for (let k = 0; k < evs.length; k++) {
      const e = evs[k];
      switch (e.type) {
        case 'trick.shatter': shatter(e); break;
        case 'trick.ping': { const i = canIndex(e.who); if (i >= 0) spin(i, TUNE.spin.hit[0], TUNE.spin.hit[1], false); if (e.air && e.n > 0) float(0, e.who, 0, 0, 0, e.n, false); break; }
        case 'trick.toss': { const i = canIndex(e.who); if (i >= 0) { Q[i].identity(); spin(i, TUNE.spin.toss[0], TUNE.spin.toss[1], true); } break; }
        case 'trick.clink': if (e.n >= 2) float(1, null, e.x, e.y, .5, e.n, e.best); break;
        case 'trick.ding': PS[1] += TUNE.swing.kick * (e.k || 1) * (host.player.y > (S.plate?.y ?? 0) ? 1 : -1); break;
        case 'trick.clear': banner.t = 0; banner.time = e.t; banner.best = e.best; banner.shots = e.shots; break;
      }
    }
    // the cans' spin: tumbling in the air; on the ground it lies down on its side and rolls about its long axis
    const Sp = TUNE.spin;
    for (let i = 0; i < S.cans.length; i++) {
      const c = S.cans[i], w = W[i];
      if (c.st === 'home') { Q[i].identity(); w.set(0, 0, 0); continue; }
      if (c.st === 'air') {
        const l = w.length(); if (l > 1e-4) { _q.setFromAxisAngle(_a.copy(w).multiplyScalar(1 / l), l * dt); Q[i].premultiply(_q); }
        continue;
      }
      _a.copy(UP).applyQuaternion(Q[i]); _b.set(_a.x, 0, _a.z);   // its long axis, and that axis laid flat
      if (_b.lengthSq() < 1e-6) _b.set(1, 0, 0); _b.normalize();
      _q.setFromUnitVectors(_a, _b); _q2.copy(_I).slerp(_q, Math.min(1, dt * Sp.settle)); Q[i].premultiply(_q2);
      if (c.st === 'ground') {   // rolling: about its axis, by its speed across it
        const rate = ((c.vy) * _b.x - (c.vx) * _b.z) / SHAPE.can.r;   // ((up x v) . axis) / r, three's axes (x, up, z = south)
        _q.setFromAxisAngle(_b, rate * dt); Q[i].premultiply(_q);
      }
      w.multiplyScalar(Math.exp(-dt * Sp.damp));
    }
    // the plate swings back
    const Sw = TUNE.swing; PS[1] += (-Sw.k * PS[0] - Sw.damp * PS[1]) * dt; PS[0] += PS[1] * dt;
    if (Math.abs(PS[0]) < 1e-4 && Math.abs(PS[1]) < 1e-3) { PS[0] = 0; PS[1] = 0; }
    stepShards(dt);
    for (let i = floats.length - 1; i >= 0; i--) { const f = floats[i]; f.t += dt; if (f.t > (f.kind ? TUNE.float.end : TUNE.float.t)) pool.push(floats.splice(i, 1)[0]); }
    if (banner.t < 9) banner.t += dt;
  }

  // ---- the draw (entities lerped between sim steps: the cans' props are where they are drawn)
  const PT = [], ptOf = (emit, alpha) => PT[(emit ? 4 : 0) + Math.min(3, Math.round((1 - alpha) * 4))] ;
  for (let e = 0; e < 2; e++) for (let a = 0; a < 4; a++) PT.push({size: 1, emit: !!e, alpha: 1 - a * .2});
  function frame() {
    if (!S.active) { if (M) drop(); return; }
    if (!M) make();
    syncBottles();
    for (let i = 0; i < S.cans.length; i++) {
      const p = S.cans[i].p, v = !p.gone;
      if (cVis[i] !== v) { cVis[i] = v; M.cans[i].setVisible(v); }
      if (!v) continue;
      M.cans[i].setMatrix(_m.compose(_p.set(p.x, p.h + .05, p.y), Q[i], _s));
    }
    if (PS[0] !== PS[2] && S.plate) {
      PS[2] = PS[0];
      const Pl = SHAPE.plate;
      M.plate.setMatrix(_m.makeRotationX(PS[0]).setPosition(S.A.x + Pl.x, Pl.pivot, S.A.y + Pl.y));
    }
    const z = host.zoom || 1;
    for (let i = 0; i < nS; i++) {
      const o = ptOf(sg[i] === 1, st[i] / sl[i] > .7 ? .55 : 1); o.size = z;
      host.point(sx[i], sy[i], sh[i] + .005, sg[i] ? GLINT : COLS[sc[i]], o);
    }
    // the mark: a dotted line across the way to the fence, two ticks at its ends
    const mk = SHAPE.mark, mx = S.A.x + mk.x, my = S.A.y + mk.y;
    if (host.G.onScreen(mx, 0, my, 40)) {
      const o = ptOf(false, .8); o.size = z;
      for (let k = 0; k <= 14; k++) { if (k % 3 === 2) continue; host.point(mx - mk.w / 2 + mk.w * k / 14, my, .02, MARK, o); }
      for (let k = 1; k <= 3; k++) { host.point(mx - mk.w / 2, my - k * .04, .02, MARK2, o); host.point(mx + mk.w / 2, my - k * .04, .02, MARK2, o); }
    }
  }

  // ---- HD: the panel, the floats, the banner
  const SC = [0, 0, 0];
  function text(q, s, x, y, size, col, align = 'center', w = 700) {
    q.font = `${w} ${Math.round(size)}px ${FONT}`; q.textAlign = align; q.textBaseline = 'alphabetic';
    q.lineJoin = 'round'; q.lineWidth = Math.max(2, size * .22); q.strokeStyle = 'rgba(10,8,12,.9)'; q.strokeText(s, x, y); q.fillStyle = col; q.fillText(s, x, y);
  }
  // the panel's lines, rebuilt only when what they say changes (a key of the numbers): true when they did
  let L1 = '', L2 = '', L3 = '', L4 = '', clockCol = '#f4efe4';
  const SIG = new Float64Array(10).fill(NaN), CLS = ['ready', 'run', 'done', 'off'];
  const sec = t => t.toFixed(2) + ' s';
  function lines() {
    const st = S.stats, cl = S.clear, rec = S.rec, gun = host.weapon?.kind === 'gun';
    let jug = 0; for (const c of S.cans) if (c.st === 'air' && c.jug > jug) jug = c.jug;
    const v0 = S.up(), v1 = CLS.indexOf(cl.st), v2 = Math.floor(cl.t * 20), v3 = rec.bestClear, v4 = st.shots, v5 = st.hits, v6 = st.ricochets, v7 = jug, v8 = rec.bestJuggle, v9 = gun ? 1 : 0;
    if (SIG[0] === v0 && SIG[1] === v1 && SIG[2] === v2 && SIG[3] === v3 && SIG[4] === v4 && SIG[5] === v5 && SIG[6] === v6 && SIG[7] === v7 && SIG[8] === v8 && SIG[9] === v9) return false;
    SIG[0] = v0; SIG[1] = v1; SIG[2] = v2; SIG[3] = v3; SIG[4] = v4; SIG[5] = v5; SIG[6] = v6; SIG[7] = v7; SIG[8] = v8; SIG[9] = v9;
    const up = S.up(), n = S.bottles.length;
    const clock = cl.st === 'run' ? sec(cl.t) : cl.st === 'done' ? sec(cl.last) : up < n ? 'E at the fence: set up' : 'shoot from the mark';
    clockCol = cl.st === 'run' ? '#f2d27a' : cl.st === 'done' ? '#9af07a' : '#b8b0a4';
    L1 = `Fence ${up}/${n}  ·  ${clock}`;
    L2 = `Shots ${st.shots}  ·  hits ${st.hits}` + (st.shots ? ` (${Math.round(100 * Math.min(1, st.hits / st.shots))}%)` : '') + (st.ricochets ? `  ·  ricochets ${st.ricochets}` : '');
    L3 = `Juggle ×${jug}  ·  best ×${rec.bestJuggle}` + (rec.bestClear ? `  ·  fence best ${sec(rec.bestClear)}` : '');
    L4 = gun ? '1 toss a can  ·  E at the crate / the fence' : 'E at the crate: a can  ·  E at the fence: reset';
    return true;
  }
  // the panel itself is painted into its own canvas when its lines or the scale change, and copied onto the overlay each
  // frame (its texts, stroked, cost ~.07 ms a frame at 3440 x 1440 drawn every frame)
  const PC = typeof document !== 'undefined' ? document.createElement('canvas') : null, pq = PC?.getContext('2d');
  let pcU = 0, pcW = 0, pcH = 0;
  function paintPanel(u) {
    const w = Math.round(330 * u), lh = 18 * u, h = Math.round(lh * 4.4 + 16 * u), x = w / 2;
    if (PC.width !== w || PC.height !== h) { PC.width = w; PC.height = h; } else pq.clearRect(0, 0, w, h);
    pcU = u; pcW = w; pcH = h;
    pq.fillStyle = 'rgba(16,14,20,.82)'; pq.fillRect(0, 0, w, h);
    pq.strokeStyle = 'rgba(242,210,122,.55)'; pq.lineWidth = 1; pq.strokeRect(.5, .5, w - 1, h - 1);
    let y = 15 * u;
    text(pq, 'TRICK-SHOT RANGE', x, y, 10 * u, '#f2d27a', 'center', 800); y += lh;
    text(pq, L1, x, y, 13 * u, clockCol); y += lh;
    text(pq, L2, x, y, 12 * u, '#f4efe4', 'center', 600); y += lh;
    text(pq, L3, x, y, 12 * u, '#f4efe4', 'center', 600); y += lh * .95;
    text(pq, L4, x, y, 10 * u, '#9a937f', 'center', 500);
  }
  function hd(q, sc) {
    if (!S.active) return;
    const P = host.player, d = hypot2(P.x - S.A.x, P.y - S.A.y), u = clamp(sc / 2.6, .7, 2.8);
    // over the cans: the juggle so far (slid with the pixel image: G.hdShift, the sub-pixel camera; the panel stays put)
    q.save(); host.G.hdShift?.(q, sc);
    for (const f of floats) {
      const k = f.t / (f.kind ? TUNE.float.end : TUNE.float.t), a = k > .7 ? 1 - (k - .7) / .3 : 1;
      if (f.kind === 0) { const p = f.who; if (!p || p.gone) continue; host.G.toScreenInto(p.x, p.h + .45 + k * TUNE.float.rise, p.y, SC); }
      else host.G.toScreenInto(f.x, f.h + k * .6, f.y, SC);
      q.globalAlpha = a;
      if (f.kind === 0) text(q, '×' + f.n, SC[0] * sc, SC[1] * sc, (13 + Math.min(8, f.n)) * u, f.n >= 5 ? '#ffb040' : '#f2d27a');
      else text(q, `Juggle ×${f.n}` + (f.best ? '  best!' : ''), SC[0] * sc, SC[1] * sc, 14 * u, f.best ? '#9af07a' : '#f2d27a');
      q.globalAlpha = 1;
    }
    q.restore();
    if (d > ST.near + 4 && banner.t >= TUNE.banner) return;
    // the panel, top right
    if (lines() || u !== pcU) paintPanel(u);
    const w = pcW; let x = q.canvas.width - w / 2 - Math.round(14 * u); const y0 = Math.round(14 * u);
    q.drawImage(PC, x - w / 2, y0);
    // the clear banner, top centre
    if (banner.t < TUNE.banner) {
      const k = banner.t / TUNE.banner, a = k < .1 ? k / .1 : k > .75 ? (1 - k) / .25 : 1, by = Math.round(q.canvas.height * .16);
      x = q.canvas.width / 2;
      q.globalAlpha = a;
      text(q, `Fence cleared  ${sec(banner.time)}`, x, by, 22 * u, '#f2d27a', 'center', 800);
      text(q, (banner.best ? 'new best!  ·  ' : '') + `${banner.shots} shot${banner.shots === 1 ? '' : 's'}`, x, by + 20 * u, 13 * u, banner.best ? '#9af07a' : '#e8e2d2', 'center', 600);
      q.globalAlpha = 1;
    }
  }

  return {view, frame, hd, drop, biomeChanged() { M = null; PS[2] = NaN; bGeo?.dispose(); bGeo = null; bMask = -1; for (let i = 0; i < cVis.length; i++) cVis[i] = true; },
    get busy() { return nS > 0 || floats.length > 0; }, get meshes() { return M; }, get shards() { return nS; }};
}
