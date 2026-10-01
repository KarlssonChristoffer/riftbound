// FORGE DSP KERNEL: small, deterministic sound-synthesis building blocks on plain Float32Arrays.
// The same module runs in the browser (lab page, Worker baking) and in Node (tools/sfx/forge.mjs). No Web Audio: a
// Web Audio graph renders a few dB differently per implementation, while this is bit-identical everywhere.
// See docs/AUDIO.md §2 for the models. Conventions:
//   - buffers are mono Float32Array unless noted; stereo = [L, R]
//   - time in seconds, frequency in Hz, sr = sample rate; functions that make buffers take (sec | n, sr)
//   - all randomness comes from an rng made by makeRng(seed): never Math.random, so a (recipe, params, seed) is a sound
//   - "in place" functions return the same buffer so calls can chain

// ============================================================================================ random
export function makeRng(seed = 1) {
  let a = (seed >>> 0) || 1;
  const R = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  R.range = (lo, hi) => lo + R() * (hi - lo);
  R.int = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
  R.pick = arr => arr[Math.floor(R() * arr.length)];
  R.sign = () => R() < .5 ? -1 : 1;
  R.gauss = () => { let u = 0, v = 0; while (!u) u = R(); v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  R.jit = p => 1 + (R() * 2 - 1) * p;                  // multiplicative jitter: 1 ± p
  R.exp = mean => -Math.log(1 - R()) * mean;           // exponential interval (Poisson process)
  R.pow = (lo, hi, alpha) => {                         // power-law sample in [lo, hi], density ∝ x^-alpha
    const u = R(); if (Math.abs(alpha - 1) < 1e-6) return lo * Math.pow(hi / lo, u);
    const a1 = 1 - alpha; return Math.pow(Math.pow(lo, a1) + u * (Math.pow(hi, a1) - Math.pow(lo, a1)), 1 / a1);
  };
  R.fork = k => makeRng((Math.imul(a ^ (k * 0x9E3779B9), 0x85EBCA6B) >>> 0) || 7);   // an independent stream
  return R;
}

// ============================================================================================ buffers
export const buf = (sec, sr) => new Float32Array(Math.max(1, Math.round(sec * sr)));
export const dbToGain = db => Math.pow(10, db / 20);
export const gainToDb = g => 20 * Math.log10(Math.max(1e-12, Math.abs(g)));
export function add(dst, src, at = 0, g = 1) {         // mix src into dst starting at sample `at`
  at = Math.round(at); const i0 = Math.max(0, -at), i1 = Math.min(src.length, dst.length - at);
  for (let i = i0; i < i1; i++) dst[i + at] += src[i] * g;
  return dst;
}
export function scale(b, g) { for (let i = 0; i < b.length; i++) b[i] *= g; return b; }
export function peak(b) { let p = 0; for (let i = 0; i < b.length; i++) { const v = Math.abs(b[i]); if (v > p) p = v; } return p; }
export function normalize(b, target = .9) { const p = peak(b); return p > 0 ? scale(b, target / p) : b; }
export function fades(b, sr, inMs = 1, outMs = 5) {    // click-free edges
  const fi = Math.min(b.length, Math.round(inMs * sr / 1000)), fo = Math.min(b.length, Math.round(outMs * sr / 1000));
  for (let i = 0; i < fi; i++) b[i] *= i / fi;
  for (let i = 0; i < fo; i++) b[b.length - 1 - i] *= i / fo;
  return b;
}
export function trim(b, sr, {thresh = -70, tailMs = 5} = {}) {   // cut trailing silence below thresh dB of the peak
  const t = peak(b) * dbToGain(thresh); let e = b.length - 1; while (e > 0 && Math.abs(b[e]) < t) e--;
  return fades(b.slice(0, Math.min(b.length, e + Math.round(tailMs * sr / 1000))), sr, 0, tailMs);
}
export function dcBlock(b, r = .995) { let x1 = 0, y1 = 0; for (let i = 0; i < b.length; i++) { const y = b[i] - x1 + r * y1; x1 = b[i]; y1 = y; b[i] = y; } return b; }
export function saturate(b, drive = 1.5) {             // tanh glue: unity gain for small signals, peaks rounded off
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * drive) / drive; return b;
}
export function reverse(b) { return b.reverse(); }
export function concat(...bs) { const n = bs.reduce((s, b) => s + b.length, 0), o = new Float32Array(n); let k = 0; for (const b of bs) { o.set(b, k); k += b.length; } return o; }

// ============================================================================================ noise
export function white(n, R) { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = R() * 2 - 1; return b; }
export function pink(n, R) {                           // Paul Kellet's refined filter, ≈ -3 dB/octave
  const b = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = R() * 2 - 1;
    b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852;
    b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898;
    b[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11; b6 = w * .115926;
  }
  return b;
}
export function brown(n, R) { const b = new Float32Array(n); let v = 0; for (let i = 0; i < n; i++) { v = (v + .02 * (R() * 2 - 1)) / 1.02; b[i] = v * 3.5; } return b; }
export const noise = (n, R, color = 'white') => color === 'pink' ? pink(n, R) : color === 'brown' ? brown(n, R) : white(n, R);

// ============================================================================================ filters
// RBJ biquad. type: lowpass | highpass | bandpass (0 dB peak) | notch | peak | lowshelf | highshelf | allpass
export class Biquad {
  constructor(type, f, q = .7071, sr = 48000, gainDb = 0) { this.sr = sr; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(type, f, q, gainDb); }
  set(type, f, q = .7071, gainDb = 0) {
    const w = 2 * Math.PI * Math.min(Math.max(f, 1), this.sr * .49) / this.sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * Math.max(q, .01)), A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lowpass': b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case 'highpass': b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case 'bandpass': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case 'notch': b0 = 1; b1 = -2 * cs; b2 = 1; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case 'allpass': b0 = 1 - al; b1 = -2 * cs; b2 = 1 + al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case 'peak': b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; break;
      case 'lowshelf': { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cs + s); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - s); a0 = (A + 1) + (A - 1) * cs + s; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - s; break; }
      case 'highshelf': { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cs + s); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - s); a0 = (A + 1) - (A - 1) * cs + s; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - s; break; }
      default: throw new Error('biquad type ' + type);
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  process(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
  run(b) { for (let i = 0; i < b.length; i++) b[i] = this.process(b[i]); return b; }
}
export const filter = (b, type, f, q = .7071, sr = 48000, gainDb = 0) => new Biquad(type, f, q, sr, gainDb).run(b);
// time-varying filter: fAt(tSec) → Hz (and optional qAt), coefficients refreshed every `every` samples
export function sweep(b, type, fAt, q = .7071, sr = 48000, {every = 32, qAt = null} = {}) {
  const bq = new Biquad(type, fAt(0), qAt ? qAt(0) : q, sr);
  for (let i = 0; i < b.length; i++) { if (i % every === 0) bq.set(type, fAt(i / sr), qAt ? qAt(i / sr) : q); b[i] = bq.process(b[i]); }
  return b;
}
export function onePoleLP(b, fc, sr) { const k = 1 - Math.exp(-2 * Math.PI * fc / sr); let y = 0; for (let i = 0; i < b.length; i++) { y += (b[i] - y) * k; b[i] = y; } return b; }
export function onePoleHP(b, fc, sr) { const k = 1 - Math.exp(-2 * Math.PI * fc / sr); let y = 0; for (let i = 0; i < b.length; i++) { y += (b[i] - y) * k; b[i] -= y; } return b; }

// ============================================================================================ envelopes
// exponential decay to -60 dB after t60 seconds, with a linear attack
export function envExp(n, sr, attack, t60) {
  const e = new Float32Array(n), na = Math.max(1, Math.round(attack * sr)), k = 6.9078 / Math.max(1e-4, t60 * sr);
  for (let i = 0; i < n; i++) e[i] = i < na ? i / na : Math.exp(-k * (i - na));
  return e;
}
// piecewise envelope through [t, v] points; shape 'lin' or 'exp' (exp interpolates in log space, floor 1e-4)
export function envPts(n, sr, pts, shape = 'lin') {
  const e = new Float32Array(n); let j = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr; while (j < pts.length - 2 && t > pts[j + 1][0]) j++;
    const [t0, v0] = pts[j], [t1, v1] = pts[Math.min(j + 1, pts.length - 1)];
    const u = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
    e[i] = shape === 'exp' ? Math.exp(Math.log(Math.max(v0, 1e-4)) * (1 - u) + Math.log(Math.max(v1, 1e-4)) * u) : v0 + (v1 - v0) * u;
    if (t > pts[pts.length - 1][0]) e[i] = pts[pts.length - 1][1];
  }
  return e;
}
export function applyEnv(b, e) { for (let i = 0; i < b.length; i++) b[i] *= i < e.length ? e[i] : e[e.length - 1]; return b; }
// a smooth bell over [0, dur]: sin^p (cloth whooshes, swells)
export function envBell(n, sr, dur, p = 2, at = 0) { const e = new Float32Array(n); for (let i = 0; i < n; i++) { const u = (i / sr - at) / dur; e[i] = u > 0 && u < 1 ? Math.pow(Math.sin(Math.PI * u), p) : 0; } return e; }

// ============================================================================================ oscillators
// freq: number or fAt(tSec); type sine | tri | saw | square (naive; fine below ~2 kHz for SFX, not for music leads)
export function osc(n, sr, freq, {type = 'sine', phase = 0} = {}) {
  const b = new Float32Array(n), fn = typeof freq === 'function'; let ph = phase;
  for (let i = 0; i < n; i++) {
    const f = fn ? freq(i / sr) : freq; ph += f / sr; ph -= Math.floor(ph);
    b[i] = type === 'sine' ? Math.sin(2 * Math.PI * ph) : type === 'tri' ? 1 - 4 * Math.abs(ph - .5) : type === 'saw' ? 2 * ph - 1 : ph < .5 ? 1 : -1;
  }
  return b;
}

// ============================================================================================ excitation
// half-sine contact force of duration tc (s): the contact time sets brightness (≈ low-pass at 1/tc)
// Unit AREA (sum = 1), so a mode's amplitude ≈ its `a` whatever tc is; a longer tc only removes the high modes.
export function halfSine(tc, sr) { const n = Math.max(1, Math.round(tc * sr)), b = new Float32Array(n); let s = 0; for (let i = 0; i < n; i++) s += b[i] = Math.sin(Math.PI * (i + .5) / n); return scale(b, 1 / s); }
// a noise burst: attack a, 1/e decay d (s), colour, optional band-pass
export function burst(sec, sr, R, {a = .0005, d = .01, color = 'white', bp = null, q = 1} = {}) {
  const n = Math.round(sec * sr), b = noise(n, R, color), na = Math.max(1, Math.round(a * sr));
  for (let i = 0; i < n; i++) b[i] *= i < na ? i / na : Math.exp(-(i - na) / (d * sr));
  return bp ? filter(b, 'bandpass', bp, q, sr) : b;
}

// ============================================================================================ modal synthesis
// modes: [{f, t60, a}] (Hz, seconds to -60 dB, amplitude). Each mode is a two-pole resonator whose impulse response
// is a·e^(-t/τ)·sin(2πft), driven by the excitation `exc` (e.g. halfSine + a noise residue). Modes above 0.45·sr skip.
export function modal(exc, modes, sr, n) {
  const out = new Float32Array(n);
  for (const m of modes) {
    if (!(m.f > 0) || m.f > sr * .45 || !(m.a)) continue;
    const w = 2 * Math.PI * m.f / sr, r = Math.exp(-6.9078 / (Math.max(1e-4, m.t60) * sr)), c1 = 2 * r * Math.cos(w), c2 = -r * r, g = m.a * Math.sin(w);
    let y1 = 0, y2 = 0, x1 = 0;
    for (let i = 0; i < n; i++) { const y = c1 * y1 + c2 * y2 + g * x1; x1 = i < exc.length ? exc[i] : 0; y2 = y1; y1 = y; out[i] += y; }
  }
  return out;
}
// quality factor ↔ decay: q = π·f·te (te = 1/e time); t60 = 6.9078·te
export const t60FromQ = (q, f) => 6.9078 * q / (Math.PI * f);
// mode set from frequency ratios: {f0, ratios, amps?, q | t60 (per mode or number), hiDamp (extra decay per octave up), jitter}
export function modesFrom({f0, ratios, amps = null, q = null, t60 = null, hiDamp = 0, jitter = 0, R = null, beat = 0}) {
  const out = [];
  ratios.forEach((r, i) => {
    const f = f0 * r * (R && jitter ? R.jit(jitter) : 1), a = amps ? amps[i] : 1 / (1 + i * .6);
    let T = t60 !== null ? (Array.isArray(t60) ? t60[i] : t60) : t60FromQ(Array.isArray(q) ? q[i] : q, f);
    T /= 1 + hiDamp * Math.log2(Math.max(1, r));
    out.push({f, t60: T, a});
    if (beat) out.push({f: f + (R ? R.range(.5, 1) : .75) * beat, t60: T, a: a * .6});   // near-degenerate twin: beating
  });
  return out;
}

// ============================================================================================ plucked string
// Extended Karplus-Strong: dark noise excitation, pick-position comb, loop damping, optional pitch glide (tension
// relaxing right after the pluck: glide = +0.05 starts 5% flat and settles to f0 over ~glideT). The output buffer is
// its own delay line: y[i] = damp · ½(y[i-L] + y[i-L-1]), with a fractional, time-varying L.
export function karplus(n, sr, f0, R, {damp = .996, bright = .5, pick = .13, glide = 0, glideT = .02} = {}) {
  const out = new Float32Array(n), N = Math.max(2, Math.round(sr / f0)), exc = new Float32Array(N); let lp = 0;
  for (let i = 0; i < N; i++) { lp += (R() * 2 - 1 - lp) * bright; exc[i] = lp; }
  const pk = Math.max(1, Math.round(N * pick));
  for (let i = 0; i < N && i < n; i++) out[i] = exc[i] - .8 * exc[(i + pk) % N];
  const at = p => { const i = Math.floor(p), f = p - i; return i < 0 ? 0 : out[i] + ((out[i + 1] ?? 0) - out[i]) * f; };
  for (let i = N; i < n; i++) {
    const L = sr / f0 * (1 + glide * Math.exp(-i / sr / glideT)) - .5;   // -0.5: the averaging filter's half-sample delay
    out[i] = damp * .5 * (at(i - L) + at(i - L - 1));
  }
  return out;
}

// ============================================================================================ PhISEM (Cook)
// Particle collisions → noise impulses through resonances. Presets: see docs/AUDIO.md (STK Shakers).
// opts: {objects, soundDecay, systemDecay, res: [[f, poleRadius, gain]], energy: Float32Array|null (drives the
//        shake energy per sample instead of the decaying shake, e.g. a footstep's ground-reaction force), gain}
export function phisem(n, sr, R, {objects = 32, soundDecay = .95, systemDecay = .999, res = [[3000, .9, 1]], energy = null, gain = 1, rate = 1} = {}) {
  const out = new Float32Array(n), srK = 44100 / sr;   // presets are tuned at 44.1 kHz
  const sd = Math.pow(soundDecay, srK), yd = Math.pow(systemDecay, srK);
  const bank = res.map(([f, r, g]) => { const rr = Math.pow(r, srK); return {c1: 2 * rr * Math.cos(2 * Math.PI * f / sr), c2: -rr * rr, g, y1: 0, y2: 0}; });
  let shake = 1, snd = 0; const p = objects / 1024 * srK * rate;
  for (let i = 0; i < n; i++) {
    const E = energy ? (i < energy.length ? energy[i] : 0) : (shake *= yd);
    if (R() < p) snd += gain * E * E;
    const x = snd * (R() * 2 - 1); snd *= sd;
    let y = 0; for (const f of bank) { const v = f.c1 * f.y1 + f.c2 * f.y2 + x * f.g; f.y2 = f.y1; f.y1 = v; y += v; }
    out[i] = y;
  }
  return out;
}
export const PHISEM = {   // STK presets (objects, soundDecay, systemDecay, resonances)
  crunch: {objects: 7, soundDecay: .95, systemDecay: .99806, res: [[800, .95, 1]]},
  littleRocks: {objects: 1600, soundDecay: .98, systemDecay: .99586, res: [[9000, .843, 1]]},
  bigRocks: {objects: 23, soundDecay: .98, systemDecay: .9965, res: [[6460, .932, 1]]},
  sandpaper: {objects: 128, soundDecay: .999, systemDecay: .999, res: [[4500, .6, 1]]},
  sleighBells: {objects: 32, soundDecay: .97, systemDecay: .9994, res: [[2500, .99, 1], [5300, .99, 1], [6500, .99, 1], [8300, .99, 1], [9800, .99, 1]]},
};

// ============================================================================================ liquids
// one van den Doel bubble added into `out` at t0: Minnaert f0 ≈ 3/r (r in metres), damping d, rising pitch
export function bubble(out, sr, t0, r, amp, {xi = .1, dampMul = 1, fMul = 1} = {}) {
  const f0 = 3 / r * fMul, d = (.13 / r + .0072 * Math.pow(r, -1.5)) * dampMul, dur = Math.min(1.5, 6.9 / d);
  const i0 = Math.round(t0 * sr), n = Math.min(out.length - i0, Math.round(dur * sr)); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, f = f0 * (1 + xi * d * t); if (f > sr * .45) break;
    ph += 2 * Math.PI * f / sr;
    const a = amp * Math.exp(-d * t) * Math.min(1, t * sr / 12);   // ~0.25 ms onset: no click
    out[i0 + i] += a * Math.sin(ph);
  }
  return out;
}

// ============================================================================================ events / physics
// bounce sequence: first contact at t0 with speed v0, restitution e (times shrink by e, speeds by e) until v < minV
export function bounces(R, {t0 = 0, v0 = 1, e = .5, dt0 = .12, minV = .08, jitter = .15, max = 12} = {}) {
  const out = []; let t = t0, v = v0, dt = dt0;
  for (let k = 0; k < max && v >= minV; k++) { out.push({t, v}); t += dt * R.jit(jitter); dt *= e; v *= e; }
  return out;
}
// Poisson event times in [t0, t1) at `rate` (events/s; a number or rateAt(t))
export function poisson(R, t0, t1, rate) {
  const out = []; let t = t0;
  if (typeof rate === 'number') { while ((t += R.exp(1 / rate)) < t1) out.push(t); return out; }
  const rmax = 2000; while ((t += R.exp(1 / rmax)) < t1) if (R() < rate(t) / rmax) out.push(t);   // thinning
  return out;
}

// ============================================================================================ space
// equal-power pan to stereo
export function toStereo(mono, pan = 0) {
  const a = (Math.max(-1, Math.min(1, pan)) + 1) * Math.PI / 4, L = new Float32Array(mono.length), Rc = new Float32Array(mono.length), gl = Math.cos(a), gr = Math.sin(a);
  for (let i = 0; i < mono.length; i++) { L[i] = mono[i] * gl; Rc[i] = mono[i] * gr; }
  return [L, Rc];
}
// a small Schroeder/Freeverb-style room (previews, baked tails). Returns stereo [L, R] = dry + wet. rt: seconds.
export function room(ch, sr, {rt = .8, mix = .2, damp = .35, pre = .012, width = 1} = {}) {
  const mono = Array.isArray(ch) ? ch[0].map((v, i) => (v + ch[1][i]) * .5) : ch;
  const tail = Math.round(rt * sr * 1.1), n = mono.length + tail, s = sr / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(d => Math.round(d * s)), aps = [556, 441, 341, 225].map(d => Math.round(d * s));
  const wet = [new Float32Array(n), new Float32Array(n)], preN = Math.round(pre * sr);
  for (let c = 0; c < 2; c++) {
    const acc = new Float32Array(n), spread = c ? Math.round(23 * s) : 0;
    for (const d0 of combs) {
      const d = d0 + spread, fb = Math.pow(10, -3 * d / (rt * sr)), line = new Float32Array(d); let k = 0, lp = 0;
      for (let i = 0; i < n; i++) { const x = i - preN >= 0 && i - preN < mono.length ? mono[i - preN] : 0, y = line[k]; lp = y * (1 - damp) + lp * damp; line[k] = x + lp * fb; k = (k + 1) % d; acc[i] += y; }
    }
    for (const d0 of aps) { const d = d0 + spread, line = new Float32Array(d); let k = 0; for (let i = 0; i < n; i++) { const y = line[k], x = acc[i]; line[k] = x + y * .5; acc[i] = y - x * .5; k = (k + 1) % d; } }
    wet[c] = acc;
  }
  const L = new Float32Array(n), Rr = new Float32Array(n), g = mix * .12, dryL = Array.isArray(ch) ? ch[0] : mono, dryR = Array.isArray(ch) ? ch[1] : mono;
  for (let i = 0; i < n; i++) {
    const wl = wet[0][i], wr = wet[1][i], m = (wl + wr) * .5;
    L[i] = (i < dryL.length ? dryL[i] : 0) + g * (m + (wl - m) * width);
    Rr[i] = (i < dryR.length ? dryR[i] : 0) + g * (m + (wr - m) * width);
  }
  return [L, Rr];
}
