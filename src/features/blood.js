// BLOOD (view): stylized pixel blood when a bullet hits a body (a gunman, a brute). Presentation only: it reads events
// and writes only its own pool; with ?views=0 or switched off nothing in play changes (tools/test/simview.mjs).
//   a hit          (combat.hit by 'bullet'): a small spray from where the shot met him, back toward the shooter
//   a through-shot (bullet.pierce): a bigger spray out of the exit along the bullet's way, and a few quick specks there
//   drops          dark red 1 px points (lit, like the impacts' bits) that arc, fall and land; where one lands it may
//                  leave a stain (features/flow.js F.stamp 'blood': the stains of one hit join one mark, which fades in
//                  ~18 s); in the stream they're simply gone
// Small and dark on purpose: it reads as a hit, not gore. Menu > Graphics > Effects > Blood (on by default, remembered;
// ?blood=0 starts it off).
// OWNS: its drop pool (typed arrays, capped; nothing allocated per frame). READS: events (combat.hit, bullet.pierce),
// host.elev / inStream, host.zoom, flow's F.stamp.
// BUDGET: view + frame ~.01 ms with 100 drops in the air (a point each).
import {flags} from '../core/flags.js';
import {rgbOf} from '../core/color.js';

export const TUNE = {
  max: 160,
  // n [lo, hi] drops, speed [lo, hi] m/s along the spray's way, up [lo, hi] m/s, spread (rad either side of the way)
  entry: {n: [4, 7], speed: [.8, 2.2], up: [.3, 1.6], spread: .9},     // a hit: back toward the shooter
  exit: {n: [10, 15], speed: [1.8, 4.2], up: [.2, 1.4], spread: .45},  // a through-shot: out along its way
  crit: 1.5,                                                           // x the drops on a crit
  mist: {n: 4, life: [.07, .15], speed: [.4, 1.4]},                    // specks at the exit wound, gone in a blink
  grav: 9.8, drag: 1.2, life: 2,                                       // m/s^2, 1/s, s (a drop that never lands)
  stain: {p: .6, big: .3},   // the chance a landing drop stains; of those, the share that splats bigger
  pal: ['#a8201a', '#7c1610', '#561008'],                              // light -> dark
};
const COL = TUNE.pal.map(rgbOf);
const R = Math.random, RR = (a, b) => a + R() * (b - a);   // presentation's randomness
const body = p => !!p && (p.kind === 'gunman' || p.kind === 'brute' || p.hunter || p.sparring);

// ORDER (core/features.js): after combat (its hits)
export const order = {after: ['combat']};
export async function create(host) {
  const M = TUNE.max, x = new Float32Array(M), y = new Float32Array(M), h = new Float32Array(M), vx = new Float32Array(M), vy = new Float32Array(M),
    vh = new Float32Array(M), t = new Float32Array(M), life = new Float32Array(M), k = new Uint8Array(M), mist = new Uint8Array(M);
  let n = 0, flow = null;
  const PT = {size: 1, alpha: 1, emit: false};
  function drop(px, py, ph, dx, dy, dh, lf, col, ms) {
    if (n >= M) return;
    const i = n++; x[i] = px; y[i] = py; h[i] = ph; vx[i] = dx; vy[i] = dy; vh[i] = dh; t[i] = 0; life[i] = lf; k[i] = col; mist[i] = ms;
  }
  // a spray from (px, py, ph) along the ground way (ux, uy) (unit)
  function spray(px, py, ph, ux, uy, S, mul) {
    const N = Math.round(RR(S.n[0], S.n[1]) * mul);
    for (let j = 0; j < N; j++) {
      const a = RR(-S.spread, S.spread), c = Math.cos(a), s = Math.sin(a), v = RR(S.speed[0], S.speed[1]);
      drop(px, py, ph, (ux * c - uy * s) * v, (uy * c + ux * s) * v, RR(S.up[0], S.up[1]), TUNE.life, (R() * 3) | 0, 0);
    }
  }
  function remove(i) {
    n--; x[i] = x[n]; y[i] = y[n]; h[i] = h[n]; vx[i] = vx[n]; vy[i] = vy[n]; vh[i] = vh[n]; t[i] = t[n]; life[i] = life[n]; k[i] = k[n]; mist[i] = mist[n];
  }
  const F = {
    name: 'blood', label: 'Blood', on: flags.get('blood') !== '0', TUNE,
    toggle() { F.on = !F.on; if (!F.on) n = 0; return F.on; },
    get count() { return n; },   // (tests)
    view(dt, evs) {
      for (const e of evs) {
        if (e.type === 'combat.hit') { if (e.by === 'bullet' && body(e.who) && (e.dx || e.dy)) spray(e.hx, e.hy, e.hh, -e.dx, -e.dy, TUNE.entry, e.crit ? TUNE.crit : 1); }
        else if (e.type === 'bullet.pierce' && body(e.who)) {
          spray(e.x, e.y, e.h, e.vx, e.vy, TUNE.exit, 1);
          const Mi = TUNE.mist;
          for (let j = 0; j < Mi.n; j++) { const v = RR(Mi.speed[0], Mi.speed[1]); drop(e.x, e.y, e.h + RR(-.05, .05), e.vx * v + RR(-.4, .4), e.vy * v + RR(-.4, .4), RR(-.2, .4), RR(Mi.life[0], Mi.life[1]), 0, 1); }
        }
      }
      if (!n) return;
      const d = Math.exp(-TUNE.drag * dt), S = TUNE.stain;
      for (let i = n - 1; i >= 0; i--) {
        t[i] += dt;
        if (t[i] >= life[i]) { remove(i); continue; }
        vx[i] *= d; vy[i] *= d; vh[i] -= TUNE.grav * dt;
        x[i] += vx[i] * dt; y[i] += vy[i] * dt; h[i] += vh[i] * dt;
        const gz = host.elev(x[i], y[i]);
        if (h[i] <= gz) {   // landed: a stain now and then (flow's marks), never on the water
          if (!mist[i] && !(gz === 0 && host.inStream(x[i], y[i])) && R() < S.p) (flow ??= host.feature('flow'))?.stamp?.('blood', x[i], y[i], vx[i], vy[i], R() < S.big ? 1 : .5);
          remove(i);
        }
      }
    },
    frame() {
      if (!n) return;
      const O = PT; O.size = host.zoom;
      for (let i = 0; i < n; i++) { O.alpha = mist[i] ? .6 : 1; host.point(x[i], y[i], h[i], COL[k[i]], O); }
      O.alpha = 1;
    },
  };
  return F;
}
