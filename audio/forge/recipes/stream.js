// STREAM recipe v3: a shallow stream over stones, as a seamless stereo loop (docs/AUDIO.md §2.3, water).
//
// History: v1 (audible bubble chirps) was "water dripping on wetness"; v2 (a broadband pink rush up to 8 kHz) was
// "disturbing white noise". v3 follows the brightness rules in RECIPE_GUIDE.md: a DARK, low-mid flowing body with the
// babble on top, and nothing static or shrill above ~2-3 kHz. Layers, loudest first:
//   1. RUSH (the body): pink noise tilted toward brown (+4 dB shelf at 300 Hz) in two bands: a low churn/gurgle band
//      (~60-450 Hz, with a 1.5-6 Hz churn) and the flowing body (~380 Hz up to a 6th-order, 36 dB/oct low-pass at
//      1.3-2.1 kHz). Each band surges slowly and organically (0.04-0.4 Hz); the body also gets a ~15 Hz turbulence
//      roughness so it churns. L/R share part of the noise (width sets how much). Flow sets its weight: a trickle is a
//      thinner body under its babble, rapids a heavy roar.
//   2. BABBLE: a dense, quiet population of van den Doel bubbles (Minnaert f0 = 3/r) of 1-5 mm (about 0.6-3 kHz), 300
//      to 1500 per second, low pitch rise (xi .02-.05), extra damping: a granular low-mid babble, not chirps. Its rate
//      follows the body's surges (shared cause); spread over six pan positions.
//   3. GLUGS: rare (0.8-2.2/s), quiet trains of 1-3 bigger bubbles (3-8 mm).
//   4. DROPLETS: the only spray: sparse, quiet noise ticks low-passed at 1.8-3.2 kHz, more with flow.
//   Master: 30 Hz high-pass and a 4.5 kHz 24 dB/oct low-pass. Energy above 4 kHz is about -40 dB re total.
// fastBubble is dsp.bubble's model as a recursive phasor, about 7x cheaper, for dense populations.
//
// SEAMLESS LOOP by construction: everything lives on a circular timeline of L samples. Events are scheduled in [0, L)
// and anything ringing past L is folded onto the start; noise is a length-L sequence and every IIR filter runs
// circularly (warmed on the tail); every LFO has a whole number of cycles per loop. The forge DC-blocks loops
// circularly too, so the wrap is exact (checked: baked loop vs ideal circular signal, see notes).
import {Biquad} from '../dsp.js';

// ------------------------------------------------------------------ circular helpers (worth promoting to dsp.js)
// fold a buffer rendered past the loop length back onto the start: circular time
function fold(b, L) { const o = new Float32Array(L); for (let i = 0; i < b.length; i++) o[i % L] += b[i]; return o; }
// run an IIR biquad circularly: warm the state on the last `warm` samples, then filter in place
function circBiquad(b, type, f, q, sr, {gainDb = 0, warm = sr >> 2} = {}) {   // 0.25 s warm-up: far longer than any response here
  const bq = new Biquad(type, f, q, sr, gainDb), n = b.length;
  for (let i = Math.max(0, n - warm); i < n; i++) bq.process(b[i]);
  return bq.run(b);
}
function circOnePoleLP(b, fc, sr) {
  const k = 1 - Math.exp(-2 * Math.PI * fc / sr), n = b.length; let y = 0;
  for (let i = Math.max(0, n - sr); i < n; i++) y += (b[i] - y) * k;
  for (let i = 0; i < n; i++) { y += (b[i] - y) * k; b[i] = y; }
  return b;
}
// pink noise (Kellet filter, as dsp.pink) that is periodic in n samples
function circPink(n, R) {
  const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = R() * 2 - 1;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; const o = new Float32Array(n);
  const step = x => { b0 = .99886 * b0 + x * .0555179; b1 = .99332 * b1 + x * .0750759; b2 = .969 * b2 + x * .153852; b3 = .8665 * b3 + x * .3104856; b4 = .55 * b4 + x * .5329522; b5 = -.7616 * b5 - x * .016898; const y = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * .5362) * .11; b6 = x * .115926; return y; };
  for (let i = Math.max(0, n - 96000); i < n; i++) step(w[i]);
  for (let i = 0; i < n; i++) o[i] = step(w[i]);
  return o;
}
// a smooth random LFO periodic in Lsec: sum of k sines, each with a whole number of cycles per loop, in [lo, hi] Hz.
// Returns t -> value with unit RMS (roughly gaussian for k >= 4).
function loopLfo(R, Lsec, lo, hi, k = 5) {
  const parts = []; let p = 0;
  for (let j = 0; j < k; j++) {
    const m = Math.max(1, Math.round(Math.exp(R.range(Math.log(lo), Math.log(hi))) * Lsec)), a = R.range(.4, 1);
    parts.push([2 * Math.PI * m / Lsec, R() * 2 * Math.PI, a]); p += a * a / 2;
  }
  const s = 1 / Math.sqrt(p);
  return t => { let v = 0; for (const [w, ph, a] of parts) v += a * Math.sin(w * t + ph); return v * s; };
}
// control-rate curve (every 64 samples, linear interpolation) of fn(t) over n samples
function ctrl(n, sr, fn, every = 64) {
  const m = Math.ceil(n / every) + 1, c = new Float32Array(m); for (let j = 0; j < m; j++) c[j] = fn(j * every / sr);
  const o = new Float32Array(n); for (let i = 0; i < n; i++) { const j = i / every, j0 = j | 0, u = j - j0; o[i] = c[j0] + (c[j0 + 1] - c[j0]) * u; }
  return o;
}
// inhomogeneous Poisson times in [0, T) for rate(t) <= rmax (thinning)
function poissonT(R, T, rate, rmax) { const out = []; let t = 0; while ((t += R.exp(1 / rmax)) < T) if (R() * rmax < rate(t)) out.push(t); return out; }
// dsp.bubble's model (Minnaert f0 = 3/r, damping d = .13/r + .0072 r^-1.5, f(t) = f0 (1 + xi d t), ~0.25 ms onset) as
// a recursive damped phasor, re-tuned every 16 samples at the block-midpoint frequency: no sin/exp per sample, ~7x cheaper
export function fastBubble(out, sr, t0, r, amp, xi = .1, dampMul = 1) {
  const f0 = 3 / r, d = (.13 / r + .0072 * Math.pow(r, -1.5)) * dampMul, i0 = Math.round(t0 * sr);
  const n = Math.min(out.length - i0, Math.round(Math.min(1.5, 6.9 / d) * sr)), dec = Math.exp(-d / sr);
  let re = amp, im = 0, cr = 1, ci = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0) { const f = f0 * (1 + xi * d * (i + 7.5) / sr); if (f > sr * .45) break; const w = 2 * Math.PI * f / sr; cr = dec * Math.cos(w); ci = dec * Math.sin(w); }
    const nr = re * cr - im * ci; im = re * ci + im * cr; re = nr;
    out[i0 + i] += i < 12 ? im * i / 12 : im;
  }
  return out;
}

const MM = .001;

export default {
  id: 'stream', version: 3, desc: 'Shallow stream over stones: seamless stereo loop, dark flowing body + low-mid babble',
  params: {
    flow: {min: 0, max: 1, def: .55},     // body weight and roar, babble rate (0.3-1.5k/s), glugs, droplets, top of the body
    width: {min: 0, max: 1, def: .8},     // stereo decorrelation of the body, spread of the babble
  },
  cases: {
    brook: {flow: .55, width: .8},        // the priority: a steady babbling brook over stones
    calm: {flow: .18, width: .75},        // a gentle trickle-flow
    rapids: {flow: .95, width: 1},        // a strong rushing roar with spray
  },
  variants: 4,
  loop: true,
  render(p, R, sr) {
    const flow = Math.min(1, Math.max(0, p.flow)), width = Math.min(1, Math.max(0, p.width));
    const Lsec = R.range(8.6, 9.6), L = Math.round(Lsec * sr), TAIL = Math.round(.6 * sr);
    const outL = new Float32Array(L), outR = new Float32Array(L);
    const solo = p._solo || null, G = k => !solo || solo === k ? 1 : 0;   // _solo: measure one layer (rush|mass|glugs|spray)
    const cw = Math.sqrt(1 - .7 * width), sw = Math.sqrt(.7 * width);   // common / per-side noise mix

    // ---- 1. rush: a DARK flowing body (brown + pink), two bands with slow organic surges; the upper band is closed by
    //      a 6th-order (36 dB/oct) low-pass at 1.3-2.1 kHz, so there is no hiss at all. The low band carries a faster
    //      1.5-6 Hz churn: the gurgle under the water
    const Rr = R.fork(301);
    const src = Rx => circBiquad(circPink(L, Rx), 'lowshelf', 300, .7, sr, {gainDb: 4});   // pink tilted toward brown
    const common = src(Rr.fork(1)), sides = [src(Rr.fork(2)), src(Rr.fork(3))];
    const top = (1300 + 800 * flow) * Rr.jit(.1), swell = .4 - .16 * flow;   // calm surges; rapids roar steadily
    const bands = [   // per-variant jitter: each variant is a slightly different stretch of water
      {lo: (85 - 25 * flow) * Rr.jit(.1), hi: 450 * Rr.jit(.1), g: (.45 + .75 * flow) * Rr.jit(.2)},   // low churn / gurgle (rapids roar)
      {lo: 380 * Rr.jit(.1), hi: top, g: Rr.jit(.2)},                                               // the flowing body
    ].map((b, k) => ({...b, lfo: loopLfo(Rr.fork(10 + k), Lsec, .04, .4, 5)}));
    const churn = loopLfo(Rr.fork(12), Lsec, 1.5, 6, 6);
    const rough = .3 + .2 * flow, gRush = .5 * (.4 + .9 * flow) * G('rush');   // a trickle: a thinner body under its babble
    for (let c = 0; c < 2; c++) {
      const Rc = Rr.fork(20 + c), x = new Float32Array(L), s = sides[c];
      for (let i = 0; i < L; i++) x[i] = cw * common[i] + sw * s[i];
      const tb = new Float32Array(L); for (let i = 0; i < L; i++) tb[i] = Rc() * 2 - 1;   // turbulence: ~15 Hz LP noise
      circOnePoleLP(tb, 15, sr); circOnePoleLP(tb, 15, sr);
      let tr = 0; for (let i = 0; i < L; i++) tr += tb[i] * tb[i]; tr = 1 / Math.sqrt(tr / L);
      const o = c ? outR : outL;
      bands.forEach((b, k) => {
        const y = x.slice(); circBiquad(y, 'highpass', b.lo, .7, sr); circBiquad(y, 'highpass', b.lo, .7, sr);
        if (k) for (const q of [.52, .71, 1.93]) circBiquad(y, 'lowpass', b.hi, q, sr);   // Butterworth 6th order
        else circBiquad(y, 'lowpass', b.hi, .6, sr);
        const am = ctrl(L, sr, t => Math.exp(swell * b.lfo(t + c * .07 * width) + (k ? 0 : .2 * churn(t))));   // the sides surge slightly apart
        const rg = k ? rough : rough * .4;
        for (let i = 0; i < L; i++) o[i] += y[i] * b.g * am[i] * (1 + rg * tb[i] * tr) * gRush;
      });
    }

    // ---- 2. babble: a dense, quiet low-mid bubble mass (1-5 mm: about 0.6-3 kHz), spread over six pan positions
    const Rm = R.fork(401), massRate = (300 + 1200 * Math.pow(flow, 1.1)) * Rm.jit(.2), K = 6;
    const pans = []; for (let k = 0; k < K; k++) pans.push(width * (-.9 + 1.8 * (k + .5) / K));
    const pb = pans.map(() => new Float32Array(L + TAIL)), midLfo = bands[1].lfo, gMass = .11 * G('mass');
    for (const t of poissonT(Rm, Lsec, t => massRate * Math.exp(.5 * midLfo(t) - .125), massRate * 3)) {
      const r = Rm.pow(1 * MM, 5 * MM, 2.4), a = gMass * Math.pow(r / MM, .3) * Rm.range(.2, 1);
      if (a) fastBubble(pb[Math.floor(Rm() * K)], sr, t, r, a, Rm.range(.02, .05), Rm.range(1.4, 2.2));
    }

    // ---- 3. glugs: rare, quiet gurgle trains of 1-3 bigger bubbles (3-8 mm)
    const Rg = R.fork(501), glugRate = .8 + 1.4 * flow, gGlug = .32 * G('glugs');
    for (const t0 of poissonT(Rg, Lsec, () => glugRate, glugRate)) {
      const r0 = Rg.pow(3 * MM, 8 * MM, 2), nb = Rg() < .5 ? 1 : Rg.int(2, 3), buf = pb[Math.floor(Rg() * K)];
      let t = t0, a = gGlug * Rg.range(.4, 1);
      for (let k = 0; k < nb; k++) { fastBubble(buf, sr, t, r0 * Rg.jit(.12), a, Rg.range(.04, .08), Rg.range(1.5, 2.2)); t += Rg.range(.03, .08); a *= Rg.range(.6, .9); }
    }

    // ---- 4. droplets (the only "spray"): sparse, quiet ticks, LP ~3 kHz, more with flow
    const Rs = R.fork(202), dropRate = 2 + 14 * flow * flow, gDrop = .7 * G('spray');
    for (const t0 of poissonT(Rs, Lsec, () => dropRate, dropRate)) {
      const b = pb[Math.floor(Rs() * K)], i0 = Math.round(t0 * sr), d = Rs.range(.0006, .0015) * sr, n = Math.round(7 * d), a = gDrop * Rs.range(.3, 1), k1 = 1 - Math.exp(-2 * Math.PI * Rs.range(1800, 3200) / sr);
      let y1 = 0, y2 = 0; for (let i = 0; i < n; i++) { y1 += (Rs() * 2 - 1 - y1) * k1; y2 += (y1 - y2) * k1; b[i0 + i] += y2 * a * Math.exp(-i / d) * Math.min(1, i / 8); }
    }
    pb.forEach((b, k) => {
      const m = circOnePoleLP(fold(b, L), 4000, sr), ang = (pans[k] + 1) * Math.PI / 4, gl = Math.cos(ang), gr = Math.sin(ang);
      const d = Math.round(.25 * Math.abs(pans[k]) * sr / 1000), dl = pans[k] > 0 ? d : 0, dr = pans[k] > 0 ? 0 : d;   // far ear lags
      for (let i = 0; i < L; i++) { outL[(i + dl) % L] += m[i] * gl; outR[(i + dr) % L] += m[i] * gr; }
    });

    // ---- master: circular 30 Hz high-pass and a 4th-order 4.5 kHz low-pass (brightness rule: nothing shrill on top)
    for (const o of [outL, outR]) { circBiquad(o, 'highpass', 30, .7, sr); circBiquad(o, 'lowpass', 4500, .54, sr); circBiquad(o, 'lowpass', 4500, 1.31, sr); }
    return [outL, outR];
  },
  criteria: {   // v3 (dark), from 33 seeds each (1-24, 44291-44296, 3 large), with margin. Energy above 4 kHz is about -40 dB re total
    brook: {durMs: [8500, 9700], centroidHz: [650, 1150], lowHz: [70, 180], highHz: [1700, 2600], flatness: [0, .05], onsetRate: [0, 3]},
    calm: {durMs: [8500, 9700], centroidHz: [850, 1200], lowHz: [90, 350], highHz: [1900, 2600], flatness: [0, .05], onsetRate: [1, 7]},
    rapids: {durMs: [8500, 9700], centroidHz: [520, 1000], lowHz: [50, 120], highHz: [1600, 2500], flatness: [0, .05], onsetRate: [0, 2]},
  },
  notes: 'v3 (dark, after the second listening pass): pink tilted to brown in two bands, 6th-order LP at 1.3-2.1 kHz, slow organic surges + 1.5-6 Hz low churn + turbulence roughness; dense quiet low-mid bubble babble (1-5 mm, 0.3-1.5k/s, fastBubble); rare quiet glugs (3-8 mm); sparse LP droplet ticks; master 4.5 kHz 24 dB/oct LP. highHz about 2 kHz, energy above 4 kHz about -40 dB. Seamless by construction (circular timeline and filters, whole-cycle LFOs).',
};
