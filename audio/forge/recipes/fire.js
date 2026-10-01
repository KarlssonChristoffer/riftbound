// FIRE recipe v2: seamless stereo fire loops, after Farnell's fire (docs/AUDIO.md §2.3 "Fire / embers").
// v2 (second listening pass: "disturbing white noise"): the Farnell hiss is now only a faint, dark shimmer (BP ~0.9-2.4 kHz, steep
// roll-off) at about -20 dB under the body; the fire is lapping + roar (low-mid, 24 dB/oct roll-off) + discrete crackles whose
// resonances sit mostly 0.9-6 kHz, with a gentle roll-off on top. Nothing broadband and static is left above ~2.5 kHz.
// Layers (campfire mix hiss .25 / crackle .2 / lapping .6, each layer first set to a known RMS so the ratios hold):
//   1. HISS      (faint shimmer only) noise band-passed ~0.9-2.4 kHz, times a slow random modulator raised to the 4th power over a floor (the flame's
//                breathing: mostly quiet, with surges). Independent per ear, the same modulator in both.
//   2. LAPPING   noise -> band-pass 30 Hz (Q 5) -> hard clip: a ragged square-ish low flutter whose harmonics (90-400 Hz) are the
//                audible 'whump' of the flame; its smoothed envelope also modulates the ROAR (pink noise, band-pass 150-1200 Hz),
//                the continuous mid body that keeps the fire a texture rather than a list of pops.
//   3. CRACKLE   Poisson snaps (0.5-3 ms) and pops (6-25 ms) of noise through resonant band-passes (1.5-16.5 kHz, Q 4-12),
//                power-law amplitudes (many tiny, few loud), clustered micro-snaps after a pop, rate following the flame's surges.
// Cases: campfire (all three), embers (sparse 4-12 kHz ticks, low hiss, faint low roar), torch (steady flutter of a small
// flame + few crackles), brazier (a bigger campfire: lower roar, more and louder pops).
// SEAMLESS: circular timeline, circular filters, whole-cycle LFOs, ringing events folded back onto the start.
import {Biquad} from '../dsp.js';
// ------------------------------------------------------------------ circular loop toolkit (copied locally; kernel candidates)
// Everything lives on a circular timeline of L samples: noise is a length-L sequence, IIR filters run circularly (state
// warmed on the tail), every LFO has a whole number of cycles per loop, and ringing events fold back onto the start.
const fold = (b, L) => { const o = new Float32Array(L); for (let i = 0; i < b.length; i++) o[i % L] += b[i]; return o; };
function circBiquad(b, type, f, q, sr, {gainDb = 0, warm = sr} = {}) {
  const bq = new Biquad(type, f, q, sr, gainDb), n = b.length;
  for (let i = Math.max(0, n - warm); i < n; i++) bq.process(b[i]);
  return bq.run(b);
}
// time-varying biquad, circular: fAt(t)/qAt(t) in seconds; warm-up replays the last `warm` samples with their true times
function circSweep(b, type, fAt, qAt, sr, {every = 32, warm = Math.round(.5 * sr)} = {}) {
  const n = b.length, bq = new Biquad(type, fAt(0), qAt(0), sr), w0 = Math.max(0, n - warm);
  for (let i = w0; i < n; i++) { if (i % every === 0) bq.set(type, fAt(i / sr), qAt(i / sr)); bq.process(b[i]); }
  for (let i = 0; i < n; i++) { if (i % every === 0) bq.set(type, fAt(i / sr), qAt(i / sr)); b[i] = bq.process(b[i]); }
  return b;
}
function circOnePoleLP(b, fc, sr) {
  const k = 1 - Math.exp(-2 * Math.PI * fc / sr), n = b.length; let y = 0;
  for (let i = Math.max(0, n - sr); i < n; i++) y += (b[i] - y) * k;
  for (let i = 0; i < n; i++) { y += (b[i] - y) * k; b[i] = y; }
  return b;
}
function circWhite(n, R) { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = R() * 2 - 1; return b; }
function circBrown(n, R) {
  const w = circWhite(n, R); let v = 0; const step = i => (v = (v + .02 * w[i]) / 1.02);
  for (let i = Math.max(0, n - 20000); i < n; i++) step(i);
  const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = step(i) * 3.5;
  return b;
}
function circPink(n, R) {
  const w = circWhite(n, R); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; const o = new Float32Array(n);
  const step = x => { b0 = .99886 * b0 + x * .0555179; b1 = .99332 * b1 + x * .0750759; b2 = .969 * b2 + x * .153852; b3 = .8665 * b3 + x * .3104856; b4 = .55 * b4 + x * .5329522; b5 = -.7616 * b5 - x * .016898; const y = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * .5362) * .11; b6 = x * .115926; return y; };
  for (let i = Math.max(0, n - 96000); i < n; i++) step(w[i]);
  for (let i = 0; i < n; i++) o[i] = step(w[i]);
  return o;
}
// smooth random LFO periodic in Lsec: k sines at whole cycles/loop within [lo, hi] Hz; t -> value with unit RMS
function loopLfo(R, Lsec, lo, hi, k = 5) {
  const parts = []; let p = 0;
  for (let j = 0; j < k; j++) {
    const m = Math.max(1, Math.round(Math.exp(R.range(Math.log(lo), Math.log(hi))) * Lsec)), a = R.range(.4, 1);
    parts.push([2 * Math.PI * m / Lsec, R() * 2 * Math.PI, a]); p += a * a / 2;
  }
  const s = 1 / Math.sqrt(p);
  return t => { let v = 0; for (const [w, ph, a] of parts) v += a * Math.sin(w * t + ph); return v * s; };
}
// control-rate curve (every `every` samples, linear interpolation) of fn(t), n samples long
function ctrl(n, sr, fn, every = 64) {
  const m = Math.ceil(n / every) + 2, c = new Float32Array(m); for (let j = 0; j < m; j++) c[j] = fn(j * every / sr);
  const o = new Float32Array(n); for (let i = 0; i < n; i++) { const j = i / every, j0 = j | 0, u = j - j0; o[i] = c[j0] + (c[j0 + 1] - c[j0]) * u; }
  return o;
}
function poissonT(R, T, rate, rmax) { const out = []; let t = 0; while ((t += R.exp(1 / rmax)) < T) if (R() * rmax < rate(t)) out.push(t); return out; }
const rmsOf = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length) + 1e-12; };
const unit = b => { const g = 1 / rmsOf(b); for (let i = 0; i < b.length; i++) b[i] *= g; return b; };   // unit RMS
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), lerp = (a, b, u) => a + (b - a) * u;

const lp24 = (x, f, sr) => { circBiquad(x, 'lowpass', f, .54, sr); circBiquad(x, 'lowpass', f, 1.3, sr); return x; };   // 4th order, 24 dB/oct

export default {
  id: 'fire', version: 2, desc: 'Fire: seamless stereo loops. Farnell hiss (4th-power modulator) + crackle bursts + clipped lapping/roar',
  params: {
    hiss: {min: 0, max: 1, def: .25}, hissHP: {min: 500, max: 6000, def: 1500},
    crackle: {min: 0, max: 1, def: .2}, rate: {min: 0, max: 80, def: 22}, fLo: {min: 800, max: 12000, def: 1500}, fHi: {min: 2000, max: 16500, def: 16500},
    pops: {min: 0, max: 1, def: .3}, big: {min: .3, max: 2, def: 1},
    lap: {min: 0, max: 1, def: .6}, roar: {min: 0, max: 1, def: .6}, roarLo: {min: 40, max: 600, def: 150}, roarHi: {min: 150, max: 3000, def: 1200},
    flutter: {min: 0, max: 1, def: 0}, flutterHz: {min: 3, max: 16, def: 8},
  },
  cases: {
    campfire: {hiss: .05, hissHP: 900, crackle: .2, rate: 22, fLo: 800, fHi: 4300, pops: .3, lap: .6, roar: .6, roarLo: 130, roarHi: 1000},
    embers: {hiss: .02, hissHP: 700, crackle: .08, rate: 5.5, fLo: 3000, fHi: 9000, pops: 0, big: .6, lap: .12, roar: .4, roarLo: 70, roarHi: 650},
    torch: {hiss: .03, hissHP: 800, crackle: .1, rate: 4, fLo: 1500, fHi: 6000, pops: .1, big: .7, lap: .35, roar: .8, roarLo: 200, roarHi: 1300, flutter: .8, flutterHz: 9},
    brazier: {hiss: .06, hissHP: 700, crackle: .22, rate: 36, fLo: 700, fHi: 3800, pops: .5, big: 1.4, lap: .8, roar: .8, roarLo: 80, roarHi: 750},
  },
  variants: 4,
  loop: true,
  render(p, R, sr) {
    const Lsec = R.range(8.6, 10.4), L = Math.round(Lsec * sr), TAIL = Math.round(.12 * sr);
    const out = [new Float32Array(L), new Float32Array(L)];
    const Jg = R.fork(5), jg = () => Jg.range(.65, 1.5), J = {hiss: jg(), crackle: jg(), lap: jg(), roar: jg(), hissHP: jg(), roarLo: jg(), roarHi: jg()};
    // flame 'breathing': one shared slow modulator (0.3-2.5 Hz) squashed to 0..1; hiss follows its 4th power, crackle rate follows it
    const flareL = loopLfo(R.fork(1), Lsec, .25, 1.8, 9);
    const u = t => 1 / (1 + Math.exp(-1.5 * flareL(t)));
    const hissEnv = ctrl(L, sr, t => .22 + .78 * Math.pow(u(t), 4) * 1.9), flareC = ctrl(L, sr, t => u(t));
    // ---- 2. lapping + roar envelope source (shared by both ears so the flame breathes as one thing)
    const lapCom = circWhite(L, R.fork(29));
    const lapSrc = [0, 1].map(c => { const x = circWhite(L, R.fork(30 + c)); for (let i = 0; i < L; i++) x[i] = .55 * lapCom[i] + .83 * x[i]; circBiquad(x, 'bandpass', 30, 5, sr); unit(x); for (let i = 0; i < L; i++) x[i] = Math.max(-1, Math.min(1, x[i] * 2.4)); return x; });
    // ---- 3. crackle events (mono events, panned slightly: the fire is a point source)
    const Rk = R.fork(60), cb = [new Float32Array(L + TAIL), new Float32Array(L + TAIL)];
    const evBurst = (t0, a, {dec, f, q, pan}) => {
      const n = Math.round(dec * sr * 7) + 8, b = new Float32Array(n), k = 1 / (dec * sr), na = Math.max(2, Math.round(.0002 * sr));
      for (let i = 0; i < n; i++) b[i] = (Rk() * 2 - 1) * (i < na ? i / na : Math.exp(-(i - na) * k));
      new Biquad('bandpass', f, q, sr).run(b);
      let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(b[i])); const g = a / (pk + 1e-9);
      const ang = (clamp(pan, -1, 1) + 1) * Math.PI / 4, gl = Math.cos(ang), gr = Math.sin(ang), i0 = Math.round(t0 * sr);
      for (let i = 0; i < n && i0 + i < L + TAIL; i++) { const v = b[i] * g * Math.min(1, (n - i) / (.004 * sr)); cb[0][i0 + i] += v * gl; cb[1][i0 + i] += v * gr; }
    };
    const rate = p.rate * J.crackle;
    const logF = (lo, hi) => Math.exp(Rk.range(Math.log(lo), Math.log(hi)));
    if (rate > 0) for (const t of poissonT(Rk, Lsec, t => rate * (.1 + 1.8 * u(t)), rate * 2)) {
      const a = Rk.pow(.04, 1, 1.7) * p.big, pan = Rk.range(-.45, .45), isPop = Rk() < p.pops * .5;
      if (isPop) {   // a pop: longer, lower, with a cluster of micro-snaps in its wake
        evBurst(t, a * .8, {dec: Rk.range(.004, .011), f: logF(p.fLo * .5, Math.min(p.fHi, 5000)), q: Rk.range(3, 8), pan});
        for (let k = Rk.int(1, 4), tt = t; k > 0; k--) { tt += Rk.range(.003, .03); evBurst(tt, a * Rk.range(.1, .5), {dec: Rk.range(.0006, .002), f: logF(p.fLo, p.fHi), q: Rk.range(5, 12), pan: pan + Rk.range(-.15, .15)}); }
      } else evBurst(t, a, {dec: Rk.range(.0005, .0035), f: logF(p.fLo, p.fHi), q: Rk.range(4, 12), pan});
    }
    const roarCom = circPink(L, R.fork(28));
    // ---- per ear
    for (let c = 0; c < 2; c++) {
      const Rc = R.fork(100 + c), o = out[c], ck = fold(cb[c], L);
      // 1. hiss: faint dark shimmer, x (floor + 4th-power surge)
      if (p.hiss > 0) { const x = circWhite(L, Rc.fork(1)); circBiquad(x, 'highpass', p.hissHP * J.hissHP, .7, sr); lp24(x, 2400, sr); unit(x);
        for (let i = 0; i < L; i++) o[i] += x[i] * hissEnv[i] * p.hiss * J.hiss * .9; }
      // 2. lapping + roar
      const lap = lapSrc[c].slice(); circBiquad(lap, 'lowpass', 420, .7, sr); unit(lap);
      if (p.lap > 0) for (let i = 0; i < L; i++) o[i] += lap[i] * p.lap * J.lap * .34;
      if (p.roar > 0 || p.flutter > 0) {
        const lo = p.roarLo * J.roarLo, hi = p.roarHi * J.roarHi;
        const x = circPink(L, Rc.fork(2)); for (let i = 0; i < L; i++) x[i] = .8 * x[i] + .6 * roarCom[i]; circBiquad(x, 'highpass', lo, .7, sr); lp24(x, hi, sr); unit(x);
        const env = lapSrc[c].slice(); circOnePoleLP(env, 12, sr); unit(env);
        let fl = null;
        if (p.flutter > 0) { const f = loopLfo(Rc.fork(3), Lsec, p.flutterHz * .45, p.flutterHz * 1.6, 7); fl = ctrl(L, sr, t => f(t)); }
        for (let i = 0; i < L; i++) o[i] += x[i] * p.roar * J.roar * .45 * Math.max(.08, .78 + .26 * env[i] + (fl ? p.flutter * .42 * fl[i] : 0)) * (.55 + .6 * flareC[i]);
      }
      // 3. crackle
      circBiquad(ck, 'lowpass', 4800, .6, sr); circBiquad(ck, 'lowpass', 6000, .6, sr);
      for (let i = 0; i < L; i++) o[i] += ck[i] * p.crackle * 24;
      circBiquad(o, 'highpass', 35, .7, sr);
    }
    return out;
  },
  criteria: {   // dark textures: no broadband haze (highHz = 95% band edge), low flatness; crackle onsets give the event rate
    campfire: {centroidHz: [350, 1100], highHz: [1200, 3300], flatness: [0, .01], onsetRate: [2.5, 7.5], durMs: [8000, 11000]},
    embers: {centroidHz: [180, 500], highHz: [350, 1200], flatness: [0, .01], onsetRate: [2, 7], durMs: [8000, 11000]},
    torch: {centroidHz: [330, 1000], highHz: [700, 2300], flatness: [0, .01], onsetRate: [1.5, 7], durMs: [8000, 11000]},
    brazier: {centroidHz: [400, 1200], highHz: [1300, 3500], flatness: [0, .01], onsetRate: [3.5, 10], durMs: [8000, 11000]},
  },
  notes: 'Farnell: hiss x surge^4 + resonant crackle bursts (Poisson, power-law amplitudes) + clipped 30 Hz lapping / roar; stereo; seamless circular loop',
};
