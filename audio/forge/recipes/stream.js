// STREAM recipe: a shallow stream over stones, as a seamless stereo loop (docs/AUDIO.md §2.3, water).
//
// Model (van den Doel, "Physically-based models for liquid sounds", 2005): the sound of running water is mostly a
// population of Minnaert bubbles, f0 ≈ 3/r, each a damped sine whose pitch rises as it nears the surface
// (dsp.bubble). Layers:
//   1. EMITTERS: 3-5 "stones", each a clustered Poisson process of bubbles (a Neyman-Scott process: cluster centres
//      are Poisson, each spawns a short train of 1..n similar-sized bubbles 8-45 ms apart, the "glug-lug" that makes
//      water sound like water rather than frying). Radii are power-law (density ∝ r^-α, α 2.2-2.8) over 0.3-5 mm
//      (≈ 600 Hz-10 kHz); each stone has its own rate LFO, radius range, loudness, pan, distance low-pass, and a tiny
//      inter-channel delay, so the two sides are decorrelated.
//   2. BLURPS: occasional larger bubbles (r 5.5-11 mm, ≈ 270-550 Hz), sometimes as a 2-3 bubble gulp, from a stone.
//   3. GURGLE BED: brown noise -> LP 300-600 Hz, slow peaky AM plus a faster churn AM; L/R partially correlated.
//   4. SPRAY: HP noise 4-8 kHz with short Poisson "sheet" bursts, independent per side, scaled by flow².
//
// SEAMLESS LOOP by construction, not by crossfade: everything lives on a circular timeline of L samples.
//   - events are scheduled in [0, L); a bubble ringing past L is folded back onto the start (fold)
//   - noise is a length-L sequence; every IIR filter runs circularly (it is warmed up on the tail of the buffer
//     first, so its state at sample 0 equals its state after sample L-1)
//   - every LFO is a sum of sines with a whole number of cycles per loop
//   - a final circular 30 Hz high-pass, then the loop is rotated so that the forge's (zero-state, non-circular) DC
//     blocker starts exactly where its steady state would be, so it adds no step at the wrap (rotateForDcBlock)
// Verified by a seam check (level of the last vs first 50 ms, the sample step across the wrap vs the step
// distribution, the HF energy around the wrap vs elsewhere): see `notes` and the report.
import {Biquad, bubble} from '../dsp.js';

// ------------------------------------------------------------------ circular helpers (worth promoting to dsp.js)
// fold a buffer rendered past the loop length back onto the start: circular time
function fold(b, L) { const o = new Float32Array(L); for (let i = 0; i < b.length; i++) o[i % L] += b[i]; return o; }
// run an IIR biquad circularly: warm the state on the last `warm` samples, then filter in place
function circBiquad(b, type, f, q, sr, {gainDb = 0, warm = sr} = {}) {
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
// leaky-integrated (brown) noise that is periodic in n samples
function circBrown(n, R) {
  const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = R() * 2 - 1;
  let v = 0; const step = i => (v = (v + .02 * w[i]) / 1.02);
  for (let i = Math.max(0, n - 20000); i < n; i++) step(i);
  const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = step(i) * 3.5;
  return b;
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
// The forge DC-blocks loops from a zero state (dsp.dcBlock, r = .995), which is not circular: at sample 0 its output
// misses the steady-state correction δ = r·y[L-1] - x[L-1] (y = the circular DC-blocked signal), and that δ shows up
// as a step across the wrap. The loop is circular, so rotate it (free) so the last sample is where |δ| is smallest.
function rotateForDcBlock(chs, r = .995) {
  const L = chs[0].length, cost = new Float64Array(L);
  for (const x of chs) {
    let x1 = 0, y1 = 0; for (let i = Math.max(0, L - 48000); i < L; i++) { const y = x[i] - x1 + r * y1; x1 = x[i]; y1 = y; }
    for (let i = 0; i < L; i++) { const y = x[i] - x1 + r * y1; x1 = x[i]; y1 = y; cost[i] += Math.abs(r * y - x[i]); }
  }
  let k = L - 1; for (let i = 0; i < L; i++) if (cost[i] < cost[k]) k = i;
  return chs.map(x => { const o = new Float32Array(L); for (let i = 0; i < L; i++) o[i] = x[(k + 1 + i) % L]; return o; });
}
// inhomogeneous Poisson times in [0, T) for rate(t) <= rmax (thinning)
function poissonT(R, T, rate, rmax) { const out = []; let t = 0; while ((t += R.exp(1 / rmax)) < T) if (R() * rmax < rate(t)) out.push(t); return out; }

const MM = .001;

export default {
  id: 'stream', version: 1, desc: 'Shallow stream over stones: seamless stereo bubble-population loop',
  params: {
    flow: {min: 0, max: 1, def: .55},     // bubble rate (50-500/s), loudness of the churn, spray and blurps
    width: {min: 0, max: 1, def: .8},     // stereo spread of the stones and decorrelation of the beds
  },
  cases: {
    brook: {flow: .55, width: .8},        // the priority: small, fast, shallow stream over stones
    calm: {flow: .18, width: .75},        // slower, sparser: individual plinks and glugs
    rapids: {flow: .95, width: 1},        // dense, more spray and churn
  },
  variants: 4,
  loop: true,
  render(p, R, sr) {
    const flow = Math.min(1, Math.max(0, p.flow)), width = Math.min(1, Math.max(0, p.width));
    const Lsec = R.range(8.6, 9.6), L = Math.round(Lsec * sr), TAIL = Math.round(.8 * sr);   // rings past the loop end fold back onto the start
    const outL = new Float32Array(L), outR = new Float32Array(L);
    const solo = p._solo || null, G = k => !solo || solo === k ? 1 : 0;   // _solo: measure one layer (bubbles | blurps | bed | spray)

    // ---- 1 + 2. stones: clustered bubble populations, plus the stones' occasional blurps
    const rate = 50 + 450 * Math.pow(flow, 1.15);          // bubbles / s, all stones together
    const alpha = 2 + .5 * flow;                         // faster water breaks up into more small bubbles
    const nE = 3 + Math.round(2 * flow);
    const blurpRate = .35 + 1.1 * flow;                    // per second, all stones
    const shares = []; for (let e = 0; e < nE; e++) shares.push(R.range(.6, 1.4));
    const shSum = shares.reduce((a, b) => a + b, 0);
    for (let e = 0; e < nE; e++) {
      const Re = R.fork(e + 1);
      const pan = width * (-.85 + 1.7 * (e + Re.range(.25, .75)) / nE);
      const rMin = .3 * MM * Re.jit(.1), rMax = (Re.range(3, 4.5) + 1.5 * flow) * MM;   // faster water entrains bigger bubbles
      const aE = alpha + Re.range(-.25, .25);
      const clusterMean = 1.4 + .8 * (1 - flow) * Re.range(.6, 1.4);  // calm water gulps in longer trains
      const bRate = rate * shares[e] / shSum, cRate = bRate / clusterMean;
      const lfo = loopLfo(Re, Lsec, .08, .9, 5), dep = .3 + .15 * (1 - flow);
      const rateAt = t => cRate * Math.exp(dep * lfo(t) - dep * dep / 2);  // peaky, mean ≈ cRate
      const gE = Re.range(.65, 1), beta = .45;
      const m = new Float32Array(L + TAIL), gB = G('bubbles'), gU = G('blurps');
      for (const t0 of poissonT(Re, Lsec, rateAt, cRate * 6)) {
        const r0 = Re.pow(rMin, rMax, aE);
        const nb = 1 + Math.floor(Re.exp(clusterMean - 1) + .5);
        const gap = Re.range(.008, .045); let t = t0, a0 = gE * Math.pow(r0 / MM, beta) * Math.pow(Re.range(.3, 1), 1.2);
        const dm = 1 + Math.pow(r0 / (4 * MM), 1.5);   // bigger bubbles in turbulent flow wobble and break up: extra damping
        for (let k = 0; k < nb && t < Lsec + .25; k++) {   // a train may run over the end: it wraps
          const r = r0 * Re.jit(.12);
          const a = a0 * Re.range(.6, 1) * gB, xi = Re.range(.06, .14); if (a) bubble(m, sr, t, r, a, {xi, dampMul: dm});
          t += gap * Re.jit(.35); a0 *= Re.range(.7, 1);
        }
      }
      // blurps: bigger, slower bubbles from this stone (a gulp is 1-3 of them)
      for (const t0 of poissonT(Re, Lsec, () => blurpRate / nE, blurpRate / nE)) {
        const r0 = Re.pow(5.5 * MM, 11 * MM, 2), nb = Re() < .35 ? Re.int(2, 3) : 1; let t = t0;
        for (let k = 0; k < nb; k++) {
          const r = r0 * Re.jit(.1), a = gE * Re.range(.25, .5) * (k ? .6 : 1) * gU, xi = Re.range(.08, .16), dm = Re.range(1.6, 2.6); if (a) bubble(m, sr, t, r, a, {xi, dampMul: dm});   // non-spherical big bubbles break up fast: extra damping
          t += Re.range(.05, .12);
        }
      }
      const mf = circOnePoleLP(fold(m, L), Re.range(7000, 15000), sr);   // distance / occlusion per stone
      const ang = (pan + 1) * Math.PI / 4, gl = Math.cos(ang), gr = Math.sin(ang);
      const d = Math.round(Re.range(0, .3) * width * sr / 1000), dl = pan > 0 ? d : 0, dr = pan > 0 ? 0 : d;   // far ear lags
      for (let i = 0; i < L; i++) { outL[(i + dl) % L] += mf[i] * gl; outR[(i + dr) % L] += mf[i] * gr; }
    }

    // ---- 3. gurgle bed: brown noise -> LP 300-600 Hz, slow peaky AM + faster churn
    const Rb = R.fork(101), lpF = 320 + 260 * flow, bedG = (.045 + .14 * flow) * G('bed');
    const common = circBrown(L, Rb.fork(1)), sides = [circBrown(L, Rb.fork(2)), circBrown(L, Rb.fork(3))];
    const slow = loopLfo(Rb, Lsec, .1, .5, 4), churn = loopLfo(Rb, Lsec, 1.5, 6, 6);
    const am = ctrl(L, sr, t => Math.exp(.35 * slow(t) + (.25 + .2 * flow) * churn(t)));
    const cw = Math.sqrt(1 - .75 * width), sw = Math.sqrt(.75 * width);
    for (let c = 0; c < 2; c++) {
      const b = new Float32Array(L), s = sides[c];
      for (let i = 0; i < L; i++) b[i] = cw * common[i] + sw * s[i];
      circBiquad(b, 'lowpass', lpF, .75, sr); circBiquad(b, 'lowpass', lpF * 1.3, .6, sr); circBiquad(b, 'highpass', 45, .7, sr);
      const o = c ? outR : outL; for (let i = 0; i < L; i++) o[i] += b[i] * am[i] * bedG;
    }

    // ---- 4. spray: HP noise 4-8 kHz, bursty
    const Rs = R.fork(202), sprayG = (.03 + .3 * flow * flow) * G('spray');
    const sLfo = loopLfo(Rs, Lsec, .15, 1.2, 4), env = new Float32Array(Math.ceil(L / 64) + 2);
    for (let j = 0; j < env.length; j++) env[j] = .45 * Math.exp(.4 * sLfo(j * 64 / sr));
    for (const t0 of poissonT(Rs, Lsec, () => 1.5 + 9 * flow, 1.5 + 9 * flow)) {   // water sheets tearing over a stone
      const dur = Rs.range(.03, .16), a = Rs.range(.3, 1.1), j0 = Math.round(t0 * sr / 64), nj = Math.round(dur * sr / 64);
      for (let j = 0; j < nj; j++) env[(j0 + j) % (env.length - 2)] += a * Math.pow(Math.sin(Math.PI * j / nj), 2) * Math.exp(-3 * j / nj);
    }
    env[env.length - 2] = env[0]; env[env.length - 1] = env[1];
    for (let c = 0; c < 2; c++) {
      const Rc = Rs.fork(c + 1), b = new Float32Array(L); for (let i = 0; i < L; i++) b[i] = Rc() * 2 - 1;
      circBiquad(b, 'highpass', 4000, .7, sr); circBiquad(b, 'lowpass', 8500, .7, sr);
      const o = c ? outR : outL;
      for (let i = 0; i < L; i++) { const j = i / 64, j0 = j | 0; o[i] += b[i] * sprayG * (env[j0] + (env[j0 + 1] - env[j0]) * (j - j0)); }
    }

    // ---- master: circular 30 Hz high-pass, then rotate the loop so the forge's zero-state DC blocker adds no wrap step
    circBiquad(outL, 'highpass', 30, .7, sr); circBiquad(outR, 'highpass', 30, .7, sr);
    return rotateForDcBlock([outL, outR]);
  },
  criteria: {   // from 12 seeds each, with margin. onsetRate counts the loud glugs/blurps standing out of the texture
    brook: {durMs: [8500, 9700], centroidHz: [1350, 2300], lowHz: [200, 650], highHz: [3800, 6600], flatness: [.06, .17], onsetRate: [8, 17]},
    calm: {durMs: [8500, 9700], centroidHz: [1250, 2550], lowHz: [200, 700], highHz: [3400, 6800], flatness: [.03, .12], onsetRate: [8, 17]},
    rapids: {durMs: [8500, 9700], centroidHz: [1900, 3000], lowHz: [140, 350], highHz: [6800, 8800], flatness: [.17, .32], onsetRate: [5, 11]},
  },
  notes: 'van den Doel 2005 bubble populations (Minnaert f0=3/r, rising pitch), clustered Poisson per stone, brown-noise gurgle, HP spray. '
    + 'Seamless by construction (circular timeline, circular filters, whole-cycle LFOs, rotation against the forge DC blocker). Seam check '
    + '(12 baked loops): baked vs ideal circular signal over the first 20 ms differs by -76..-96 dB re RMS; the step across the wrap and the '
    + 'first/last 50 ms levels fall inside the loop\'s own distribution; without the rotation the DC blocker left a -30 dB (median) LF step. '
    + 'Steadiness (400 ms windows): sd ≈ 1.6-2.3 dB brook, 0.9-1.6 rapids, 2.8-4.5 calm (sparse by design).',
};
