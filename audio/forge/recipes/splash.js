// SPLASH recipe v2: a plain, conventional game splash, as mono one-shots (docs/AUDIO.md §2.3, water).
// (v1, the tonal bubbly entry with the cavity "bloop", lives on unchanged as recipes/plunk.js.)
//
// A splash heard from a few metres is mostly NOISE: the slap of the contact, the sheet of water thrown up and torn into
// droplets (spray), the displaced water sloshing back, and the droplets pattering down. Bubbles are there, but small,
// damped and buried, so nothing rings or "bloops". Layers (all shaped noise, shared randomness `energy` per variant):
//   1. SLAP: LP noise 2-12 ms (cutoff falls with size: a blunt body has a longer, duller contact) + a short low "thup"
//      for a foot or body.
//   2. SPRAY: BP noise (~1.5-8 kHz) under a fast swell/decay, multiplied by a droplet-grain texture (a dense Poisson
//      train of 0.4-2 ms micro-bursts, 400-2500/s) so it crackles wetly instead of hissing.
//   3. SLOSH: noise through a band-pass that slides down (≈1.6 kHz -> 250 Hz for a body, 2.5 kHz -> 600 Hz for an
//      arrow): the vowel-like "sh-ooosh" of water moving, with a 3-6 Hz wobble. Deeper entries get more of it.
//   4. FALL-BACK PATTER: the thrown water landing 120-700 ms later as many small ticks plus a faint rain-like hiss.
//   5. FIZZ: a few tiny, heavily damped bubbles (no pitch rise to speak of), 12+ dB under the noise.
// Params are continuous (size, depth); the cases pick presets. Render < 20 ms.
import {Biquad, bubble, sweep, peak, scale, saturate} from '../dsp.js';

const MM = .001;
// noise burst with a linear attack and an exponential decay (1/e time d), mixed into out at t0, optional LP/HP
function addBurst(out, sr, R, t0, {a = .0004, d = .005, len = 7 * d, g = 1, lp = null, hp = null, q = .7071} = {}) {
  const i0 = Math.round(t0 * sr), n = Math.min(out.length - i0, Math.round((a + len) * sr)), na = Math.max(1, Math.round(a * sr));
  if (n <= 0) return;
  const fl = lp ? new Biquad('lowpass', lp, q, sr) : null, fh = hp ? new Biquad('highpass', hp, q, sr) : null;
  for (let i = 0; i < n; i++) {
    let v = R() * 2 - 1; if (fl) v = fl.process(v); if (fh) v = fh.process(v);
    out[i0 + i] += v * g * (i < na ? i / na : Math.exp(-(i - na) / (d * sr)));
  }
}
// droplet-grain texture: Poisson micro-bursts (rate(t) per second, decreasing so rate(0) is the max, 1/e decay dec s), unit mean, length n
function grains(n, sr, R, rate, dec) {
  const g = new Float32Array(n), k = Math.exp(-1 / (dec * sr)), rmax = rate(0); let v = 0, sum = 0;
  for (let t = R.exp(1 / rmax); t * sr < n; t += R.exp(1 / rmax)) if (R() * rmax < rate(t)) g[Math.floor(t * sr)] += R.range(.3, 1);   // thinning
  for (let i = 0; i < n; i++) { v = v * k + g[i]; g[i] = v; sum += v; }
  const m = sum / n || 1; for (let i = 0; i < n; i++) g[i] /= m;
  return g;
}

// ============================================================================================ v4: lava and rift (new code paths only)
// Not water: these two cases are mono one-shots with their own models and never touch the water layers below.
const TAU = Math.PI * 2, clampF = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const whiteN = (n, R) => { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = R() * 2 - 1; return b; };
const bqRun = (b, type, f, q, sr, g = 0) => new Biquad(type, f, q, sr, g).run(b);
const lp24 = (b, f, sr) => { bqRun(b, 'lowpass', f, .5412, sr); bqRun(b, 'lowpass', f, 1.3066, sr); return b; };   // 4th-order Butterworth
const endFadeB = (b, sr, ms) => { const f = Math.min(b.length, Math.round(ms * sr / 1000)); for (let i = 0; i < f; i++) b[b.length - 1 - i] *= .5 - .5 * Math.cos(Math.PI * i / f); return b; };
const addAtB = (dst, src, at, g = 1) => { at = Math.round(at); for (let i = Math.max(0, -at); i < src.length && i + at < dst.length; i++) dst[i + at] += src[i] * g; return dst; };
// a thick, heavily damped bubble as a recursive phasor: f0 Hz, damping d /s (decays to -80 dB in 9.2/d), pitch rising xi, `ramp` s soft onset;
// run through tanh so the low fundamentals have harmonics a small speaker can reproduce
function blubB(sr, f0, d, xi, amp, ramp, sat = 3) {
  const n = Math.round(Math.min(1.6, 9.2 / d) * sr), out = new Float32Array(n), dec = Math.exp(-d / sr), rn = Math.max(2, Math.round(ramp * sr));
  let re = 1, im = 0, cr = 1, ci = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0) { const f = f0 * (1 + xi * d * (i + 7.5) / sr); if (f > sr * .45) break; const w = TAU * f / sr; cr = dec * Math.cos(w); ci = dec * Math.sin(w); }
    const nr = re * cr - im * ci; im = re * ci + im * cr; re = nr;
    out[i] = im * (i < rn ? .5 - .5 * Math.cos(Math.PI * i / rn) : 1);
  }
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * sat) / sat * amp;
  return endFadeB(out, sr, 20);
}
// a short dark noise pop: band-passed, 1/e decay `dec` s, raised-cosine end
function popB(sr, R, f, dec, amp, q = 1, lp = 2800) {
  const n = Math.round((dec * 8 + .004) * sr), b = whiteN(n, R); for (let i = 0; i < n; i++) b[i] *= Math.exp(-i / (dec * sr)) * Math.min(1, i / 24);
  bqRun(b, 'bandpass', f, q, sr); lp24(b, lp, sr); let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(b[i])); for (let i = 0; i < n; i++) b[i] *= amp / (pk + 1e-9);
  return endFadeB(b, sr, 4);
}
// final tone stage for the two: 40 Hz high-pass, -9 dB shelf above 4.5 kHz, 4th-order low-pass; a soft tanh glue
function finishB(out, sr, lp) {
  bqRun(out, 'highpass', 55, .7071, sr); bqRun(out, 'highshelf', 4500, .7071, sr, -9); lp24(out, lp, sr);
  let pk = 0; for (let i = 0; i < out.length; i++) pk = Math.max(pk, Math.abs(out[i])); if (pk > 0) for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] / pk * 1.4) / 1.4 * pk;
  return out;
}

// LAVA: something falls into molten lava. Layers (all dark, nothing above ~3 kHz that sits on top):
//   1. the contact: a dull, pitch-dropping "thup" (the mass pushing into thick fluid, 70-140 Hz) and a soft LP-noise slap (5-10 ms, 450-900 Hz)
//   2. the PLOP: the cavity closing over it, a thick gloopy bubble (f0 105-190 Hz, damping 12-28 /s, pitch rising xi .35-.55), 25-60 ms in
//   3. the BIG BUBBLE: a damped heavy blob (f0 52-95 Hz, damping 12-22 /s) welling up 150-300 ms later, and its dull pop (BP 500-1500 Hz)
//   4. SIZZLE: a short, quiet hiss (HP 650 Hz, 4th-order LP 2.1 kHz) x droplet grains over a fast swell and 0.16-0.32 s decay
//   5. SPATTERS: 3-7 small damped blobs (200-450 Hz, damping 28-62) with tiny pops, 100-650 ms after, shrinking
function splashLava(p, R, sr) {
  const size = clampF(p.size, 0, 1), energy = R.range(.9, 1.1), out = new Float32Array(Math.round(2 * sr));
  // 1. contact
  { const f = R.range(70, 140), T = .05 + .05 * size, n = Math.round(T * 7 * sr), th = new Float32Array(n); let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / sr; ph += TAU * f * (1 + .6 * Math.exp(-t / .025)) / sr; th[i] = Math.sin(ph) * Math.exp(-t / T) * Math.min(1, t / .006); }
    for (let i = 0; i < n; i++) th[i] = Math.tanh(th[i] * 2) / 2;
    addAtB(out, endFadeB(th, sr, 30), 0, .6 * energy); }
  addAtB(out, popB(sr, R, R.range(500, 1000), R.range(.004, .009), 1, .7, 1800), 0, .8 * energy);
  // 2. the plop
  const tp = R.range(.025, .06), f1 = R.range(105, 190), r1 = 3 / f1;
  addAtB(out, blubB(sr, f1, clampF((.13 / r1 + .0072 * Math.pow(r1, -1.5)) * R.range(2.2, 3.5), 12, 28), R.range(.35, .55), 1, R.range(.006, .014)), tp * sr, 1.4 * energy);
  // 3. the big damped bubble and its pop
  const tb = tp + R.range(.15, .3), f2 = R.range(52, 95), r2 = 3 / f2, d2 = clampF((.13 / r2 + .0072 * Math.pow(r2, -1.5)) * R.range(2.2, 3.5), 12, 22);
  addAtB(out, blubB(sr, f2, d2, R.range(.35, .5), 1, R.range(.015, .03), 3.5), tb * sr, .95 * energy * (.8 + .4 * size));
  addAtB(out, popB(sr, R, R.range(500, 1500), R.range(.01, .02), 1, 1, 2400), (tb + R.range(.05, .1)) * sr, .8 * energy);
  // 4. sizzle: gas escaping, short, low-passed, quiet
  { const Rz = R.fork(7), n = Math.round(.75 * sr), b = whiteN(n, Rz); bqRun(b, 'highpass', 650, .7071, sr); lp24(b, 2100, sr);
    const gr = grains(n, sr, Rz, t => 1800 * Math.exp(-t / .2) + 250, .0006), sa = .012, sd = R.range(.16, .32);
    for (let i = 0; i < n; i++) { const t = i / sr, env = (t < sa ? t / sa : Math.exp(-(t - sa) / sd)) * (.35 + .65 * gr[i]); b[i] *= env * .38; }
    addAtB(out, endFadeB(b, sr, 120), (tp + .01) * sr, energy); }
  // 5. spatters
  { let t = tp + R.range(.1, .22), a = R.range(.55, .8);
    for (let k = R.int(3, 7); k > 0; k--, t += R.range(.04, .16), a *= R.range(.6, .85)) {
      const f = R.range(200, 450), r = 3 / f;
      addAtB(out, blubB(sr, f, clampF((.13 / r + .0072 * Math.pow(r, -1.5)) * R.range(2.5, 4), 28, 62), R.range(.2, .5), 1, .003, 2.5), t * sr, a * 1.0);
      addAtB(out, popB(sr, R, R.range(900, 2200), R.range(.002, .005), 1, 1.2, 2600), (t - .003) * sr, a * .4);
    } }
  return finishB(out, sr, 4200);
}

// RIFT: falling into a glowing crack in the world, a magical void (not water). Layers:
//   1. the SUCK: a breath inward: noise band-passed with a centre sliding up 170 -> 650 Hz while the level swells over 120-220 ms
//   2. the WHUMP: soft, low, at the end of the suck: a sine gliding 100 -> 44 Hz (8-12 ms attack, 0.12 s decay), lightly saturated
//   3. the dark SWELL: two detuned low partials (a fifth apart, 90-140 Hz, beating 2-5 Hz) and a sub, rising over 0.2-0.3 s and falling over ~0.7-1 s
//   4. the SHIMMER: 5-9 faint crystalline pings (1.1-2.8 kHz, twin pairs beating 2-6 Hz, T60 0.25-0.6 s, 4-8 Hz tremolo), over 0.3-1.4 s, 18-26 dB under the whump
function splashRift(p, R, sr) {
  const size = clampF(p.size, 0, 1), energy = R.range(.9, 1.1), out = new Float32Array(Math.round(2.3 * sr));
  // 1. suck
  const tS = R.range(.12, .22), up = R.range(.55, .8);
  { const n = Math.round((tS + .25) * sr), b = whiteN(n, R), bp = new Biquad('bandpass', 170, 1.6, sr), lpf = new Biquad('lowpass', 1500, .6, sr), f0 = R.range(150, 210), f1 = R.range(560, 760);
    for (let i = 0; i < n; i++) {
      const t = i / sr, u = clampF(t / tS, 0, 1);
      if (i % 32 === 0) bp.set('bandpass', f0 + (f1 - f0) * u * u, 1.6);
      const env = t < tS ? Math.pow(Math.sin(Math.PI / 2 * u), 2.2) : Math.exp(-(t - tS) / .05);
      b[i] = lpf.process(bp.process(b[i])) * env;
    }
    let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(b[i])); for (let i = 0; i < n; i++) b[i] *= .9 * up / (pk + 1e-9);
    addAtB(out, endFadeB(b, sr, 60), 0, energy); }
  // 2. whump
  { const T = R.range(.1, .15), n = Math.round(T * 8 * sr), w = new Float32Array(n), f0 = R.range(115, 150), f1 = R.range(52, 66), at = R.range(.008, .012); let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / sr; ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / .07)) / sr; w[i] = Math.sin(ph) * (t < at ? Math.pow(t / at, 1.5) : Math.exp(-(t - at) / T)); }
    for (let i = 0; i < n; i++) w[i] = Math.tanh(w[i] * 1.8) / 1.8;
    addAtB(out, endFadeB(w, sr, 40), (tS - .02) * sr, 1.0 * energy * (.85 + .3 * size)); }
  // 3. dark swell
  { const rise = R.range(.2, .3), fall = R.range(.1, .15), F = fall * 6.9, n = Math.round((rise + F) * sr), s = new Float32Array(n), fa = R.range(125, 185), bt = R.range(2, 5), ph = [R() * TAU, R() * TAU, R() * TAU, R() * TAU];
    for (let i = 0; i < n; i++) {
      const t = i / sr, e = t < rise ? Math.pow(Math.sin(Math.PI / 2 * t / rise), 2) : Math.exp(-(t - rise) / fall);   // natural decay, closed by a short fade at -60 dB
      s[i] = e * (Math.sin(TAU * fa * t + ph[0]) + .8 * Math.sin(TAU * (fa + bt) * t + ph[1]) + .55 * Math.sin(TAU * fa * 1.5 * t + ph[2]) + .25 * Math.sin(TAU * fa * .5 * t + ph[3]));
    }
    lp24(s, 600, sr); endFadeB(s, sr, 200); addAtB(out, s, (tS - .04) * sr, .16 * energy); }
  // 4. shimmer: faint crystalline pings
  { const SC = [1, 1.125, 1.25, 1.5, 1.667, 1.875, 2], base = R.range(1100, 1450);
    for (let k = R.int(5, 9); k > 0; k--) {
      const f = base * R.pick(SC) * R.pick([1, 1, 1.5, 2]) * R.jit(.003), t0 = tS + R.range(.05, .9), T = R.range(.2, .5), a = R.range(.4, 1) * Math.pow(.8, (t0 - tS) * 1.5), beat = R.range(2, 6), trm = R.range(4, 8), ph = R() * TAU, tp = R() * TAU;
      const n = Math.round(T * 1.4 * sr), x = new Float32Array(n), at = R.range(.003, .008), kd = 6.9078 / T;
      // rotating phasors (one mul-add each instead of a sin()): the two twin partials and the tremolo
      const w1 = TAU * f / sr, w2 = TAU * (f + beat) / sr, w3 = TAU * trm / sr, c1 = Math.cos(w1), s1 = Math.sin(w1), c2 = Math.cos(w2), s2 = Math.sin(w2), c3 = Math.cos(w3), s3 = Math.sin(w3), dk = Math.exp(-kd / sr);
      let a1 = Math.cos(ph), b1 = Math.sin(ph), a2 = Math.cos(ph * 1.7), b2 = Math.sin(ph * 1.7), a3 = Math.cos(tp), b3 = Math.sin(tp), ev = 1;
      for (let i = 0; i < n; i++) {
        x[i] = ev * Math.min(1, i / (at * sr)) * (.75 + .25 * b3) * (b1 + .7 * b2);
        let q = a1 * c1 - b1 * s1; b1 = a1 * s1 + b1 * c1; a1 = q; q = a2 * c2 - b2 * s2; b2 = a2 * s2 + b2 * c2; a2 = q; q = a3 * c3 - b3 * s3; b3 = a3 * s3 + b3 * c3; a3 = q; ev *= dk;
      }
      lp24(x, 3200, sr); addAtB(out, endFadeB(x, sr, 60), t0 * sr, a * .2 * energy);
    } }
  return finishB(out, sr, 3600);
}

export default {
  id: 'splash', version: 4, desc: 'Game splash one-shots: slap, spray, slosh, patter (noise-led, no bloop); v4 adds lava and rift cases',
  params: {
    size: {min: 0, max: 1, def: .15},     // 0 = arrow/pebble, 1 = a whole body: slap cutoff, spray length, slosh pitch/length, patter
    kind: {values: ['water', 'lava', 'rift'], def: 'water'},   // v4: water = the layered splash below; lava and rift are their own mono one-shot models
    depth: {min: 0, max: 1, def: .6},     // shallow (0) = slap + spray; deep (1) = more slosh body and fizz
  },
  cases: {
    small: {size: .15, depth: .6},        // an arrow into the stream: quick "plip-splash"
    big: {size: 1, depth: .8},            // the player falling in: broad splash with sloshing
    step: {size: .45, depth: .2},         // a foot at the shallow edge: wet slap and slosh
    lava: {kind: 'lava', size: .5, depth: .7},   // something falling into molten lava: gloopy plop, damped big bubble, sizzle, spatters
    rift: {kind: 'rift', size: .5, depth: .7},   // falling into a glowing void crack: inward suck + whump, dark swell, crystalline shimmer
  },
  variants: 6,
  render(p, R, sr) {
    if (p.kind === 'lava') return splashLava(p, R, sr);
    if (p.kind === 'rift') return splashRift(p, R, sr);
    const size = Math.min(1, Math.max(0, p.size)), depth = Math.min(1, Math.max(0, p.depth)), energy = R.range(.85, 1.15);
    const solo = p._solo || null, G = k => !solo || solo === k ? 1 : 0;   // _solo: measure one layer (slap|spray|slosh|patter|fizz)
    // layer timings first, so the buffer holds every tail down past -60 dB (the forge trims at -80 dB)
    const sA = .004 + .012 * size, sD = (.03 + .12 * size) * R.jit(.15);                                  // spray
    const wT = (.035 + .2 * Math.pow(size, 1.3)) * (.6 + .6 * depth) * R.jit(.15), wPk = .015 + .07 * size;   // slosh
    const pEnd = .25 + .45 * size;                                                                        // patter
    const dur = Math.max(sA + 7 * sD, wPk + 8 * wT, pEnd + .12) + .03, n = Math.round(dur * sr), out = new Float32Array(n);

    // ---- 1. slap
    const Ri = R.fork(1), impD = (.0018 + .007 * size) * Ri.jit(.2), fc = 1100 / (.2 + size) * Ri.jit(.15);   // darker since v3: the slap is crisp but short, not shrill
    addBurst(out, sr, Ri, 0, {a: .0002 + .001 * size, d: impD, g: (3 + 1.5 * (1 - size)) * energy * G('slap'), lp: Math.min(4500, fc), hp: 120, q: .8});
    addBurst(out, sr, Ri, .001, {a: .0002, d: impD * .4, g: .8 * energy * G('slap'), lp: Math.min(6000, fc * 1.6), hp: fc * .6});   // the crisp edge, very short
    if (size > .3) {   // the "thup" of a foot / body pushing the water: a damped low pulse
      const f = Ri.range(90, 150) - 40 * size, T = .03 + .06 * size, g = .5 * (size - .2) * energy * G('slap');
      for (let i = 0, N = Math.round(4 * T * sr); i < N; i++) { const t = i / sr; out[i] += g * Math.sin(2 * Math.PI * f * t) * Math.min(1, t / .004) * Math.exp(-t / T); }
    }

    // ---- 2. spray: BP noise x droplet grains under a fast swell / decay
    const Rs = R.fork(2), sN = Math.min(n, Math.round((sA + 7 * sD) * sr));
    {
      const b = new Float32Array(sN); for (let i = 0; i < sN; i++) b[i] = Rs() * 2 - 1;
      const lo = 700 + 500 * (1 - size), hi = 2800 + 1000 * (1 - size);   // v3: spray band down (was 1.1-2 .. 5-7.5 kHz)
      new Biquad('highpass', lo, .7, sr).run(b); new Biquad('lowpass', hi, .54, sr).run(b); new Biquad('lowpass', hi, 1.31, sr).run(b);
      const gr = grains(sN, sr, Rs, t => 2500 * Math.exp(-t / (sD * 2)) + 400, .0004 + .0008 * size);
      const g = .5 * (1 + .8 * size) * (.5 + .5 * depth) * energy * G('spray');
      for (let i = 0; i < sN; i++) { const t = i / sr, env = t < sA ? t / sA : Math.exp(-(t - sA) / sD); out[i] += b[i] * env * (.4 + .6 * gr[i]) * g; }
    }

    // ---- 3. slosh: a band-pass sliding down, with a wobble
    const Rw = R.fork(3), wN = n;   // the slosh runs to the end: no edge where it stops
    {
      const b = new Float32Array(wN); for (let i = 0; i < wN; i++) b[i] = Rw() * 2 - 1;
      const f0 = 2600 - 1000 * size, f1 = 650 - 400 * size, tau = wT * .6;
      sweep(b, 'bandpass', t => f1 + (f0 - f1) * Math.exp(-t / tau), .75, sr);
      sweep(b, 'lowpass', t => 1.6 * (f1 + (f0 - f1) * Math.exp(-t / tau)), .7, sr);
      const w1 = Rw.range(3, 6), w2 = Rw.range(1.5, 3), ph = Rw() * 6, g = (2 + 2 * depth) * (.6 + .4 * size) * energy * G('slosh');
      for (let i = 0; i < wN; i++) {
        const t = i / sr, env = t < wPk ? Math.pow(t / wPk, 1.3) : Math.exp(-(t - wPk) / wT);
        out[i] += b[i] * env * g * (1 + .3 * Math.sin(2 * Math.PI * w1 * t + ph) + .15 * Math.sin(2 * Math.PI * w2 * t));
      }
    }

    // ---- 4. fall-back patter: many small ticks + a faint rain hiss, 120-700 ms
    const Rp = R.fork(4), nd = Math.round((3 + 45 * Math.pow(size, 1.2)) * energy), gP = G('patter');
    for (let k = 0; k < nd; k++) {
      const t = .1 + (pEnd - .1) * Math.pow(Rp(), 1.3), g = Rp.range(.2, .6) * (1.15 - t / (pEnd + .1)) * gP;
      addBurst(out, sr, Rp, t, {a: .0002, d: Rp.range(.0003, .0012), g, lp: Rp.range(1800, 3500), hp: 300});
    }
    if (size > .3) addBurst(out, sr, Rp, .1, {a: .08 * size, d: .06 + .1 * size, g: .12 * size * energy * gP, lp: 3500, hp: 1000});

    // ---- 5. fizz: tiny damped bubbles, buried
    const Rf = R.fork(5), nf = Math.round((4 + 26 * size) * (.3 + .7 * depth));
    for (let k = 0; k < nf; k++) {
      const t = .005 + Rf.exp(.04 + .15 * size), r = Rf.pow(.9 * MM, (1.6 + 1.5 * size) * MM, 2.5);   // 1-3 kHz, not 12 kHz sparkle
      if (t < dur - .1) bubble(out, sr, t, r, Rf.range(.02, .07) * G('fizz'), {xi: .03, dampMul: Rf.range(2.5, 4)});
    }

    // gentle tanh glue (realism checklist): rounds the slap's spike so variants sit at an even loudness
    new Biquad('highshelf', 5000, .7, sr, -9).run(out);   // brightness rule: gentle -9 dB shelf above 5 kHz
    const pk = peak(out); if (pk > 0) scale(saturate(scale(out, 1 / pk), 1.6), pk);
    return out;
  },
  criteria: {   // v3 (darker), from 33 seeds each (1-24, 44291-44296, 3 large), with margin. big's attack can run to the slosh peak
    small: {attackMs: [0, 5], durMs: [350, 600], t60Ms: [220, 550], centroidHz: [1100, 1700], lowHz: [300, 700], highHz: [2300, 3700], flatness: [0, .02], clickEnd: [0, .01]},
    big: {attackMs: [0, 130], durMs: [1600, 2600], t60Ms: [1000, 2000], centroidHz: [820, 1200], lowHz: [40, 160], highHz: [1950, 2800], flatness: [0, .01], clickEnd: [0, .01]},
    step: {attackMs: [0, 5], durMs: [550, 850], t60Ms: [380, 800], centroidHz: [1000, 1450], lowHz: [100, 400], highHz: [2200, 3300], flatness: [0, .015], clickEnd: [0, .01]},
    // v4 (new cases, 33 seeds each: 1-24, 44291-44296, 3 large). Both are dark by design (95% band edge about 1-1.7 kHz, energy above 4 kHz -35..-58 dB re total)
    lava: {attackMs: [0, 150], durMs: [750, 1300], t60Ms: [400, 1800], centroidHz: [240, 520], lowHz: [40, 130], highHz: [900, 2200], hf4kDb: [-70, -28], flatness: [0, .01], clickEnd: [0, .01]},
    rift: {attackMs: [40, 200], durMs: [1000, 1900], t60Ms: [700, 3000], centroidHz: [140, 450], lowHz: [30, 100], highHz: [450, 2000], hf4kDb: [-80, -28], flatness: [0, .01], clickEnd: [0, .01]},
  },
  notes: 'noise-led game splash, v3 darkened (brightness rules): short LP-noise slap + thup, BP spray (0.7-3.8 kHz, 24 dB/oct) x droplet grains, down-sliding BP slosh, patter (LP 1.8-3.5 kHz), buried fizz, -9 dB shelf above 5 kHz. Energy above 4 kHz -17..-28 dB re total. v1 = plunk.js. v4 adds lava (thup + gloopy plop + damped big bubble + quiet sizzle + spatters) and rift (inward suck + whump + dark swell + faint crystalline shimmer) as separate mono models (params.kind)',
};
