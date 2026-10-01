// ARROW_FLY: an arrow (or several) in flight, heard by a fixed listener. docs/AUDIO.md §2.3 "Arrow whoosh / flyby".
// One moving-source model serves all cases. The arrow follows a straight path P(t) = P0 + dir·s(t) past a listener at
// the origin (s(t) may start with a power stroke); from the path we get, per sample:
//   r(t)       distance: level ∝ (r_ref/r) · (d⊥/r)^k, the aeolian dipole radiates sideways, hardly along the flight line
//   D(t)       Doppler factor 1/(1 - v_r/c), v_r = radial approach speed: ×1.17 on approach, ×0.87 on recession at 50 m/s
//   f(t)       aeolian tone f = 0.2·v/d (Strouhal) for the shaft diameter d, times D(t), with a slow random wander
// Sound = tone (a narrow band-pass of noise + a wobbling sine: vortex shedding is not a clean oscillator), pink
// turbulence with the fletching edge-tone hump (band moves with D, darkens with distance), a low "swish" body, all under
// a fletching flutter AM (20-60 Hz) and a slower spin AM. Cases: flyby (passes the listener), whistle (a high arrow in
// the arrow-rain falls past, tonal, pitch dropping through the Doppler pass), volley (5-9 arrows loosed away, staggered).
import {add, filter, sweep, white, pink, saturate, peak, scale} from '../dsp.js';

const C = 343, PI = Math.PI;
const lerp = (a, b, u) => a + (b - a) * u;
const unitRms = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; const g = 1 / Math.sqrt(s / b.length + 1e-20); for (let i = 0; i < b.length; i++) b[i] *= g; return b; };

// slow random wander, unit-ish amplitude, correlation time ~ tau: smoothed noise sampled per sample
function wander(n, sr, R, tau) {
  const b = new Float32Array(n), k = 1 - Math.exp(-1 / (tau * sr)), g = Math.sqrt(2 / k) * .6; let y = 0;
  for (let i = 0; i < n; i++) { y += (R() * 2 - 1 - y) * k; b[i] = y * g * .5; }
  return b;
}

// one arrow added into `out` at sample `at`.
// o: P0 [x,y,z] (m, listener at 0), dir [x,y,z] unit, v (m/s), stroke (s, power stroke; 0 = already at speed), d (shaft m),
//    dur (s), level, tone {q, mix, sine}, turb (level), body (level), flutter [Hz lo, hi], depth, hp, fall (fade-out s)
// warm game-mix tone stage: gentle high shelf and a steep (24 dB/oct) low-pass
function warm(b, sr, {shelf = -9, fs = 4500, lp = 7000} = {}) { filter(b, 'highshelf', fs, .7071, sr, shelf); filter(b, 'lowpass', lp, .7071, sr); filter(b, 'lowpass', lp, .7071, sr); return b; }
function arrow(out, sr, R, at, o) {
  const n = Math.min(out.length - at, Math.round(o.dur * sr)); if (n <= 0) return;
  const stroke = o.stroke || 0;
  const sAt = t => stroke > 0 && t < stroke ? .5 * o.v * t * t / stroke : (stroke > 0 ? .5 * o.v * stroke : 0) + o.v * (t - (stroke > 0 ? stroke : 0));
  const vAt = t => stroke > 0 && t < stroke ? o.v * t / stroke : o.v;
  const amp = new Float32Array(n), dop = new Float32Array(n), fT = new Float32Array(n), dist = new Float32Array(n);
  const [dx, dy, dz] = o.dir, k = o.dirK ?? 1.3, rRef = o.rRef ?? 2;
  for (let i = 0; i < n; i++) {
    const t = i / sr, s = sAt(t), v = vAt(t);
    const px = o.P0[0] + dx * s, py = o.P0[1] + dy * s, pz = o.P0[2] + dz * s;
    const r = Math.max(.25, Math.hypot(px, py, pz)), vr = -(px * dx + py * dy + pz * dz) / r * v;   // approach speed
    const along = (px * dx + py * dy + pz * dz) / r, sinT = Math.sqrt(Math.max(0, 1 - along * along));   // dipole: ⟂ to the flight line
    const D = 1 / (1 - Math.max(-.3, Math.min(.3, vr / C)));
    dist[i] = r; dop[i] = D;
    amp[i] = Math.pow(v / o.v, 3) * (rRef / r) * Math.pow(.15 + .85 * sinT, k);
    fT[i] = Math.max(120, .2 * v / o.d) * D;                    // the Strouhal tone as heard
  }
  const wf = wander(n, sr, R, .04), wa = wander(n, sr, R, .012);
  // tone: narrow band-pass of noise (random amplitude, like real vortex shedding) + a sine with a wandering frequency
  const T = o.tone, f0 = o.toneWander ?? .015;
  const tn = unitRms(sweep(white(n, R), 'bandpass', t => fT[Math.min(n - 1, Math.round(t * sr))] * (1 + f0 * wf[Math.min(n - 1, Math.round(t * sr))]), T.q, sr, {every: 24}));
  const sn = new Float32Array(n); let ph = R() * 2 * PI;
  for (let i = 0; i < n; i++) { ph += 2 * PI * fT[i] * (1 + f0 * wf[i]) / sr; sn[i] = Math.sin(ph) * Math.max(0, 1 + .55 * wa[i]) + (T.h2 || 0) * Math.sin(2 * ph + 1); }
  unitRms(sn);
  // turbulence: pink, high-passed, fletching edge-tone hump, low-pass that closes with distance (air absorption)
  const hpF = o.hp * R.jit(.2);
  const tb = filter(filter(pink(n, R), 'highpass', hpF, .6, sr), 'peak', R.range(1800, 2800), .8, sr, R.range(2, 4));
  unitRms(sweep(tb, 'lowpass', t => { const i = Math.min(n - 1, Math.round(t * sr)); return Math.max(1500, Math.min(3800, 5200 / (1 + dist[i] / 9))) * Math.min(1.1, .85 + .15 * dop[i]); }, .7, sr, {every: 48}));
  filter(tb, 'lowpass', 4200, .7071, sr);   // a second pole pair: steeper
  // swish body: the arrow's wake, a low-mid band riding the Doppler
  const bf = o.bodyF * R.jit(.2);
  const bd = unitRms(sweep(pink(n, R), 'bandpass', t => bf * dop[Math.min(n - 1, Math.round(t * sr))], .9, sr, {every: 48}));
  // flutter (fletching vanes) + spin (the arrow rotates, ~10-20 rev/s)
  let pf = R(), ps = R(); const ff = R.range(o.flutter[0], o.flutter[1]), fs = R.range(9, 20), drift = R.range(-.3, .3), dep = o.depth * R.range(.7, 1.2);
  const fall = o.fall ?? .06, nFall = Math.round(fall * sr), nIn = Math.round((o.fadeIn ?? .004) * sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr; pf += ff * (1 + drift * t) / sr; ps += fs / sr;
    const am = (1 - dep * (.5 + .5 * Math.sin(2 * PI * pf))) * (1 - .12 * (.5 + .5 * Math.sin(2 * PI * ps)));
    let e = i < nIn ? .5 - .5 * Math.cos(PI * i / nIn) : 1; if (i > n - nFall) e *= .5 + .5 * Math.cos(PI * (i - (n - nFall)) / nFall);
    const mix = T.mix * ((1 - T.sine) * tn[i] + T.sine * sn[i]) + o.turb * tb[i] + o.body * bd[i];
    out[at + i] += o.level * amp[i] * e * am * mix;
  }
}

function render(p, R, sr) {
  const kind = p.kind, out = new Float32Array(Math.round((kind === 'whistle' ? 1.15 : kind === 'volley' ? .85 : .75) * sr));
  if (kind === 'flyby') {
    // passes the listener: closest approach d0 2-4.5 m, 30-55 m/s, 0.22 s in; side picks the sign only (mono)
    const v = R.range(30, 55), d0 = R.range(1.6, 3.2), tc = R.range(.14, .2), len = .5;
    arrow(out, sr, R, 0, {
      P0: [-v * tc, d0, R.range(-.3, .3)], dir: [1, 0, 0], v, d: R.range(.0095, .013), dur: len, level: 1, dirK: R.range(1.2, 1.6),
      tone: {q: R.range(4, 7), mix: R.range(.7, 1), sine: R.range(.2, .4), h2: .08}, turb: R.range(.5, .7), body: R.range(.7, 1), bodyF: R.range(500, 1000),
      flutter: [20, 60], depth: R.range(.2, .4), hp: R.range(500, 900), fall: .1, fadeIn: .02,
    });
  } else if (kind === 'whistle') {
    // a high arrow coming down in the arrow rain: steep, fast, a whistling shaft, passes 3-6 m off; Doppler turns the
    // held high pitch into a falling one through the pass; ends as the arrow is gone (the landing is another sound)
    const v = R.range(42, 60), len = R.range(.95, 1.05), tc = R.range(.62, .74), d0 = R.range(4, 8), el = R.range(.9, 1.15);   // el: dive angle (rad) from horizontal
    const dir = [Math.cos(el) * .8, -Math.sin(el), Math.cos(el) * .6];
    // start position so that the closest approach is d0 at t = tc
    const P0 = [dir[0] * -v * tc, dir[1] * -v * tc, dir[2] * -v * tc];
    // offset the pass sideways (perpendicular to the dive in the horizontal plane)
    const off = [dir[2], 0, -dir[0]], ol = Math.hypot(off[0], off[2]); P0[0] += off[0] / ol * d0 * R.sign(); P0[2] += off[2] / ol * d0;
    P0[1] += 1.5;   // ear height: the arrow passes ~ground-level close to the listener
    arrow(out, sr, R, 0, {
      P0, dir, v, d: R.range(.0058, .0078), dur: len, level: 1, dirK: 1, rRef: 3, toneWander: .03,
      tone: {q: R.range(8, 14), mix: R.range(1.2, 1.6), sine: R.range(.15, .3), h2: .06}, turb: R.range(.3, .5), body: R.range(.4, .65), bodyF: R.range(600, 1100),
      flutter: [20, 45], depth: R.range(.1, .25), hp: R.range(700, 1100), fall: .25, fadeIn: .12,
    });
  } else {   // volley: 5-9 arrows loosed together and whooshing away, staggered by the archers' timing
    const m = R.int(5, 9);
    for (let k = 0; k < m; k++) {
      const Rk = R.fork(k + 1), t0 = k === 0 ? 0 : Rk.range(0, .075), at = Math.round(t0 * sr);
      const az = Rk.range(-.35, .35), el = Rk.range(.05, .3), v = Rk.range(34, 52);
      const dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
      arrow(out, sr, Rk, at, {
        P0: [Rk.range(.5, 1.6), Rk.range(-.2, .3), Rk.range(-1.8, 1.8)], dir, v, stroke: Rk.range(.012, .02), d: Rk.range(.0095, .013), dur: Rk.range(.42, .6), level: Rk.range(.7, 1.1) / Math.sqrt(m) * 1.6,
        dirK: 1, rRef: 3, tone: {q: Rk.range(4, 7), mix: Rk.range(.6, 1), sine: Rk.range(.15, .3), h2: .06}, turb: Rk.range(.5, .7), body: Rk.range(.7, 1), bodyF: Rk.range(450, 900),
        flutter: [20, 60], depth: Rk.range(.2, .4), hp: Rk.range(500, 900), fall: .14, fadeIn: .01,
      });
    }
  }
  filter(out, 'highpass', 90, .7, sr); warm(out, sr, {shelf: -10, fs: 3500, lp: 5200});
  return saturate(out, 1.1);
}

export default {
  id: 'arrow_fly', version: 2, desc: 'Arrows in flight: Doppler + aeolian tone + turbulence + fletching flutter (flyby / whistle / volley)',
  params: {
    kind: {values: ['flyby', 'whistle', 'volley'], def: 'flyby'},
  },
  cases: {flyby: {kind: 'flyby'}, whistle: {kind: 'whistle'}, volley: {kind: 'volley'}},
  variants: 6,
  render,
  // v2 (brightness pass): centroid about 1 kHz, 95% band under ~3 kHz, shelf -10 dB above 3.5 kHz; validated on 36 seeds (1-24, 44291-44296, 6 large)
  criteria: {
    flyby: {durMs: [420, 600], attackMs: [40, 260], t60Ms: [300, 800], centroidHz: [650, 1500], lowHz: [150, 500], highHz: [1700, 3200], flatness: [0, .03], clickEnd: [0, .01]},
    whistle: {durMs: [850, 1150], attackMs: [300, 700], centroidHz: [1000, 2200], lowHz: [300, 1000], highHz: [1600, 3200], flatness: [0, .03], clickEnd: [0, .01]},
    volley: {durMs: [500, 780], attackMs: [0, 100], centroidHz: [650, 1300], lowHz: [150, 400], highHz: [1700, 3200], flatness: [0, .03], clickEnd: [0, .01]},
  },
  notes: 'moving-source model: Strouhal f=0.2v/d aeolian tone, Doppler 1/(1-vr/c), dipole level (d⊥/r)^k, flutter AM 20-60 Hz (Selfridge/Moffat/Reiss)',
};
