// WESTERN INSTRUMENTS: the desert score's band (western.js), rendered once into Float32Arrays with plain seeded JS DSP
// (no Web Audio), like music.js's pluck / bell / drums. OWNER: music (docs/AUDIO.md §3.5).
//
// Every renderer is (sr, f, R, opts) -> {data: Float32Array, f0}: mono, peak-normalised, a natural decay ending in a
// raised-cosine fade (never a cut tail), all randomness from R. They run in the browser and in Node (tests).
// Dark by rule (audio/forge/RECIPE_GUIDE.md): the energy sits in ~80 Hz..3 kHz with a steep roll-off above, no hiss
// beds, and the percussion is dense and damped (short, low-q "thocks", not hollow rings).
//   renderGuitar    nylon string: extended Karplus-Strong (dark finger excitation, pick-position comb, fractional
//                   delay) + a guitar body (air / top-plate resonances)
//   renderTwang     the baritone "twang" string for the bass: brighter pick near the bridge, a pitch that settles
//                   from sharp (tension modulation), the highs rolled off for the low register
//   renderMute      a palm-muted string (the gallop's chug): the same string, damped to ~0.2 s, with a thump
//   renderHarmonic  a natural harmonic (flageolet): a near-sine with two faint partials and a slow shimmer
//   renderTremolo   a tremolo-picked held note: the string re-plucked ~10 times a second, each pick damping it a little
//   renderReed      a harmonica-like free reed: additive odd-leaning harmonics whose brightness follows the breath,
//                   a bend up into the note, hand vibrato, a nasal formant, a faint breath band
//   renderBell      a distant mission bell: church-bell partials (hum, prime, tierce, quint, nominal) with beating twins
//   renderPerc      clip / clop (hooves: damped knocks), tom and boom (felt mallets), shaker (a few seed grains)
import {Biquad} from '../../audio/forge/dsp.js';

const TAU = 2 * Math.PI;

// ---------------------------------------------------------------- shared helpers
// 1.5 ms fade-in, a raised-cosine fade over the last `fade` seconds, peak-normalise
function finish(d, sr, peak = .9, fade = .3) {
  const fi = Math.max(1, sr * .0015 | 0), fo = Math.min(d.length - fi, Math.max(1, fade * sr | 0));
  for (let i = 0; i < fi; i++) d[i] *= i / fi;
  for (let i = 0; i < fo; i++) d[d.length - 1 - i] *= .5 - .5 * Math.cos(Math.PI * i / fo);
  let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  if (pk > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / pk;
  return d;
}
const run = (d, ...fs) => { for (let i = 0; i < d.length; i++) { let v = d[i]; for (const f of fs) v = f.process(v); d[i] = v; } return d; };
// 4th-order low-pass (two Butterworth sections): the steep roll-off the brightness rules ask for
const lp4 = (f, sr) => [new Biquad('lowpass', f, .5412, sr), new Biquad('lowpass', f, 1.3066, sr)];
function body(d, sr, modes) {   // parallel band-pass resonances [f, q, gain] added to the dry string
  const bs = modes.map(([f, q]) => new Biquad('bandpass', f, q, sr));
  for (let i = 0; i < d.length; i++) { const x = d[i]; let v = x; for (let k = 0; k < bs.length; k++) v += bs[k].process(x) * modes[k][2]; d[i] = v; }
  return d;
}
// a plucked string: a circular delay line read at a fractional, optionally moving, length L (linear interpolation);
// loop filter (1-s)·y[n-L] + s·y[n-L-1] (s = .5: the classic two-point average, highs die first), loop gain from T60
function makeString(sr, f, T60, {s = .5, Lmax = 1} = {}) {
  const L0 = sr / f - s, M = Math.ceil(L0 * Lmax) + 8, d = new Float32Array(M), g = Math.pow(10, -3 / (T60 * f));
  let w = 0, prev = 0;
  return {
    L0, N: Math.max(2, Math.round(L0)),
    step(x, L = L0) {
      let rp = w - L; if (rp < 0) rp += M;
      const i0 = rp | 0, fr = rp - i0, a = d[i0], b = d[i0 + 1 === M ? 0 : i0 + 1], y = a + (b - a) * fr;
      const v = x + g * ((1 - s) * y + s * prev);
      prev = y; d[w] = v; if (++w === M) w = 0;
      return v;
    },
    damp(k) { for (let i = 0; i < M; i++) d[i] *= k; prev *= k; },
  };
}
// one period of excitation: low-passed noise (`bright` = the smoothing step; lower = a softer finger), DC removed,
// through the pick-position comb (the harmonics with a node at the pick are cut), blended with a smooth bump
function pluckExc(N, R, bright, pick, smooth = .3) {
  const e = new Float32Array(N); let lp = 0, m = 0;
  for (let i = 0; i < N; i++) { lp += (R() * 2 - 1 - lp) * bright; e[i] = lp; m += lp; }
  m /= N; let pk = 1e-9; for (let i = 0; i < N; i++) { e[i] -= m; pk = Math.max(pk, Math.abs(e[i])); }
  const P = Math.max(1, Math.round(N * pick)), W = Math.max(2, 2 * P), o = new Float32Array(N); let bm = 0;
  for (let i = 0; i < N; i++) {   // the comb, then a finger-shaped bump (a half sine over twice the pick distance)
    const bump = i < W ? Math.sin(Math.PI * i / W) : 0;
    o[i] = (1 - smooth) * (e[i] - .85 * e[(i + P) % N]) / pk + smooth * bump; bm += o[i];
  }
  bm /= N; for (let i = 0; i < N; i++) o[i] -= bm;
  return o;
}

// ---------------------------------------------------------------- strings
export function renderGuitar(sr, f, R, {dur = 3, T60 = 2.6, bright = .38, pick = .17, lp = 3200} = {}) {
  const n = dur * sr | 0, out = new Float32Array(n), S = makeString(sr, f, T60 * (f < 110 ? 1.3 : 1)), exc = pluckExc(S.N, R, bright, pick);
  for (let i = 0; i < n; i++) out[i] = S.step(i < exc.length ? exc[i] : 0);
  body(out, sr, [[98, 3.5, .3], [204, 3, .26], [392, 2.2, .14]]);
  run(out, new Biquad('highpass', 70, .7, sr), ...lp4(lp, sr), new Biquad('highshelf', 2200, .7, sr, -4));
  return {data: finish(out, sr, .9, .45), f0: f};
}
export function renderTwang(sr, f, R, {dur = 2.6, T60 = 2.1, bright = .7, pick = .09, glide = -.012, lp = 1900} = {}) {
  const n = dur * sr | 0, out = new Float32Array(n), S = makeString(sr, f, T60), exc = pluckExc(S.N, R, bright, pick, .15), gT = .06 * sr;
  for (let i = 0; i < n; i++) out[i] = S.step(i < exc.length ? exc[i] : 0, S.L0 * (1 + glide * Math.exp(-i / gT)));
  body(out, sr, [[86, 3, .25], [180, 2.5, .2]]);
  run(out, new Biquad('highpass', 38, .7, sr), ...lp4(lp, sr), new Biquad('peak', 900, 1.2, sr, 2.5));   // a little "twang" bite at 900 Hz
  return {data: finish(out, sr, .9, .4), f0: f};
}
export function renderMute(sr, f, R, {dur = .5, T60 = .19} = {}) {
  const n = dur * sr | 0, out = new Float32Array(n), S = makeString(sr, f, T60), exc = pluckExc(S.N, R, .5, .12, .2);
  for (let i = 0; i < n; i++) out[i] = S.step(i < exc.length ? exc[i] : 0);
  let ph = 0; for (let i = 0; i < n; i++) { ph += TAU * f / sr; out[i] += .35 * Math.sin(ph) * Math.exp(-i / (.035 * sr)); }   // the palm's thump
  body(out, sr, [[98, 3, .3], [204, 3, .2]]);
  run(out, new Biquad('highpass', 60, .7, sr), ...lp4(1700, sr));
  return {data: finish(out, sr, .9, .08), f0: f};
}
export function renderHarmonic(sr, f, R, {dur = 3.2} = {}) {
  const n = dur * sr | 0, out = new Float32Array(n);
  const P = [[1, 1, 3.4], [1 + (.3 + R() * .3) / f, .35, 3], [2, .09, 1.3], [3, .03, .7]];   // [ratio, amp, T60]: the twin shimmers
  for (const [r, a, T] of P) {
    const w = TAU * f * r / sr, k = Math.exp(-6.9078 / (T * sr)), cw = Math.cos(w), sw = Math.sin(w);
    let c = 1, s = 0, e = a;
    for (let i = 0; i < n; i++) { const c2 = c * cw - s * sw; s = s * cw + c * sw; c = c2; out[i] += e * s; e *= k; }
  }
  const na = .004 * sr | 0; for (let i = 0; i < na; i++) out[i] *= .5 - .5 * Math.cos(Math.PI * i / na);   // a touched string: a soft onset
  const tick = [new Biquad('lowpass', 1800, .7, sr)], nt = .004 * sr | 0;
  for (let i = 0; i < nt; i++) out[i] += .05 * tick[0].process((R() * 2 - 1) * (1 - i / nt));
  run(out, ...lp4(3500, sr));
  return {data: finish(out, sr, .85, .5), f0: f};
}
export function renderTremolo(sr, f, R, {dur = 4.4, rate = 10.5, T60 = 1.1} = {}) {
  const n = dur * sr | 0, out = new Float32Array(n), S = makeString(sr, f, T60);
  const swell = t => Math.min(1, t / .45) * (t > dur - 1.2 ? Math.max(0, (dur - .2 - t) / 1) : 1);
  let next = 0, k = 0, exc = null, ei = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (t >= next) {   // a pick: it damps the string a little and excites it again (down-strokes a bit stronger)
      const v = swell(t) * (k % 2 ? .72 : 1) * (.88 + R() * .24);
      exc = pluckExc(S.N, R, .42, .15 + R() * .04, .25); for (let j = 0; j < exc.length; j++) exc[j] *= v;
      S.damp(.82); ei = 0; k++; next += (1 + (R() - .5) * .14) / rate;
    }
    out[i] = S.step(exc && ei < exc.length ? exc[ei++] : 0);
  }
  body(out, sr, [[98, 3.5, .25], [204, 3, .22], [392, 2.2, .12]]);
  run(out, new Biquad('highpass', 80, .7, sr), ...lp4(3000, sr));
  return {data: finish(out, sr, .9, .25), f0: f};
}

// ---------------------------------------------------------------- the reed (harmonica)
// Additive: the harmonics' amplitudes k^-α (α falls as the breath pressure p rises: a soft note is mellow, a pushed one
// brassy), even harmonics at 45 % (a free reed leans odd), a nasal formant near 1.2 kHz (the cupped hands), nothing
// above ~3.5 kHz. Sines by the Chebyshev recursion (one sin/cos per sample). The note bends up ~75 cents into pitch;
// hand vibrato (amplitude + a little pitch) after 0.5 s.
export function renderReed(sr, f0, R, {dur = 4.6} = {}) {
  const n = dur * sr | 0, out = new Float32Array(n), K = Math.max(3, Math.min(12, Math.floor(3800 / f0))), amp = new Float32Array(K + 1), B = 32;
  const vph = R() * TAU, aph = R() * TAU, late = t => Math.min(1, Math.max(0, (t - .5) / .7)), lnk = new Float32Array(K + 1), wk = new Float32Array(K + 1);
  for (let k = 1; k <= K; k++) { const F = k * f0; lnk[k] = Math.log(k); wk[k] = (k % 2 ? 1 : .45) * (1 + 1.1 * Math.exp(-Math.pow(Math.log2(F / 1200), 2) / (2 * .3 * .3))) / (1 + Math.pow(F / 3000, 4)); }
  const press = t => (1 - Math.exp(-t / .05)) * (1 + .08 * Math.min(1, t / 1.6)) * (1 + .1 * late(t) * Math.sin(TAU * 5.1 * t + aph)) * (t > dur - .7 ? .5 + .5 * Math.cos(Math.PI * (t - dur + .7) / .7) : 1);
  const inc = t => TAU * f0 * Math.pow(2, (-75 * Math.exp(-t / .075) + 6 * late(t) * Math.sin(TAU * 4.6 * t + vph)) / 1200) / sr;
  let ph = R() * TAU;
  for (let i0 = 0; i0 < n; i0 += B) {   // the envelopes per 32-sample block, interpolated; sines per sample
    const i1 = Math.min(n, i0 + B), t0 = i0 / sr, t1 = i1 / sr, p0 = press(t0), p1 = press(t1), w0 = inc(t0), w1 = inc(t1);
    const a = 2 - 1.1 * Math.min(1, (p0 + p1) / 2);   // the spectrum follows the breath
    for (let k = 1; k <= K; k++) amp[k] = Math.exp(-a * lnk[k]) * wk[k];
    for (let i = i0; i < i1; i++) {
      const u = (i - i0) / B, p = p0 + (p1 - p0) * u;
      ph += w0 + (w1 - w0) * u; if (ph > TAU) ph -= TAU;
      const s1 = Math.sin(ph), c2 = 2 * Math.cos(ph); let sm2 = 0, sm1 = s1, v = amp[1] * s1;
      for (let k = 2; k <= K; k++) { const sk = c2 * sm1 - sm2; v += amp[k] * sk; sm2 = sm1; sm1 = sk; }
      out[i] = p * v;
    }
  }
  // breath: a faint band of noise that follows the pressure (no broadband hiss)
  const bp = new Biquad('bandpass', 1400, 1.4, sr); let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
  for (let i = 0; i < n; i++) { const t = i / sr, e = (1 - Math.exp(-t / .03)) * (t > dur - .7 ? Math.max(0, (dur - t) / .7) : 1); out[i] += pk * .04 * e * bp.process(R() * 2 - 1); }
  run(out, new Biquad('highpass', 120, .7, sr), ...lp4(3400, sr));
  return {data: finish(out, sr, .9, .3), f0};
}

// ---------------------------------------------------------------- the mission bell
export function renderBell(sr, f, R, {dur = 6} = {}) {
  const n = dur * sr | 0, out = new Float32Array(n);
  const P = [[.5, .45, 5.5], [1, .8, 4], [1.19, .42, 3], [1.5, .22, 2.2], [2, .45, 2.6], [2.51, .16, 1.5], [3.01, .1, 1.1], [4.1, .05, .6]];
  for (const [r, a, T] of P) for (const tw of r === .5 || r === 1 || r === 2 ? [0, 1] : [0]) {
    const fr = f * r + (tw ? .3 + R() * .6 : 0), w = TAU * fr / sr, k = Math.exp(-6.9078 / (T * sr)), cw = Math.cos(w), sw = Math.sin(w), ph = R() * TAU;
    let c = Math.cos(ph), s = Math.sin(ph), e = a * (tw ? .5 : 1);
    for (let i = 0; i < n; i++) { const c2 = c * cw - s * sw; s = s * cw + c * sw; c = c2; out[i] += e * s; e *= k; }
  }
  const na = .003 * sr | 0; for (let i = 0; i < na; i++) out[i] *= i / na;   // a soft clapper
  const bp = new Biquad('bandpass', 1200, 1, sr), nt = .006 * sr | 0;
  for (let i = 0; i < nt; i++) out[i] += .12 * bp.process((R() * 2 - 1) * (1 - i / nt));
  run(out, ...lp4(2400, sr));   // far away: the highs are gone
  return {data: finish(out, sr, .85, .6), f0: f};
}

// ---------------------------------------------------------------- percussion
// modes [f, T60, amp] as decaying sines, a pitch-falling body, a short low-passed contact noise
function knock(sr, R, {dur, modes, bodyF = 0, bodyF1 = 0, bodyPt = .03, bodyT = .1, bodyA = 0, noiseA = .3, noiseLP = 2500, noiseT = .002}) {
  const n = dur * sr | 0, out = new Float32Array(n);
  for (const [f, T, a] of modes) { const w = TAU * f * (1 + (R() - .5) * .03) / sr, k = 6.9078 / (T * sr); for (let i = 0; i < n; i++) out[i] += a * Math.exp(-k * i) * Math.sin(w * i); }
  if (bodyA) { let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr, fb = bodyF1 + (bodyF - bodyF1) * Math.exp(-t / bodyPt); ph += TAU * fb / sr; out[i] += bodyA * Math.exp(-6.9078 * t / bodyT) * Math.sin(ph); } }
  const lp = new Biquad('lowpass', noiseLP, .7, sr);
  for (let i = 0; i < n; i++) out[i] += noiseA * Math.exp(-i / (noiseT * sr)) * lp.process(R() * 2 - 1);
  return out;
}
export function renderPerc(sr, kind, R) {
  let d;
  if (kind === 'clip' || kind === 'clop') {   // a shod hoof on hard dirt: dense, damped, a low thud under it
    const hi = kind === 'clip' ? 1.3 : 1;
    d = knock(sr, R, {dur: .22, modes: [[520 * hi, .045, 1], [1150 * hi, .028, .55], [1900 * hi, .016, .25]], bodyF: 140 * hi, bodyF1: 100 * hi, bodyPt: .015, bodyT: .06, bodyA: .4, noiseA: .4, noiseLP: 3000, noiseT: .0015});
    run(d, new Biquad('highpass', 70, .7, sr), ...lp4(3200, sr));
    return {data: finish(d, sr, .9, .05), f0: 1};
  }
  if (kind === 'tom') {   // a felt-mallet floor tom
    d = knock(sr, R, {dur: .9, modes: [[168, .14, .3]], bodyF: 112, bodyF1: 82, bodyPt: .035, bodyT: .55, bodyA: 1, noiseA: .25, noiseLP: 900, noiseT: .006});
    run(d, new Biquad('highpass', 40, .7, sr), ...lp4(2200, sr));
    return {data: finish(d, sr, .9, .2), f0: 1};
  }
  if (kind === 'boom') {   // a big bass drum, soft beater
    d = knock(sr, R, {dur: 1.4, modes: [[112, .2, .35]], bodyF: 70, bodyF1: 48, bodyPt: .05, bodyT: 1, bodyA: 1, noiseA: .2, noiseLP: 400, noiseT: .01});
    run(d, new Biquad('highpass', 30, .7, sr), ...lp4(1200, sr));
    return {data: finish(d, sr, .9, .3), f0: 1};
  }
  // shaker: a few seed grains (no hiss bed), band-passed low for a shaker, a soft "sh" swell
  const n = .16 * sr | 0; d = new Float32Array(n);
  const bp = new Biquad('bandpass', 2400, 1.2, sr), bp2 = new Biquad('bandpass', 1800, .9, sr);
  const grains = []; let t = .004; for (let k = 0; k < 9; k++) { grains.push([t, .4 + R() * .6]); t += .004 + R() * .009; }
  for (let i = 0; i < n; i++) {
    const tt = i / sr; let x = 0;
    for (const [g0, a] of grains) { const u = tt - g0; if (u >= 0 && u < .006) x += a * (R() * 2 - 1) * Math.exp(-u / .0015); }
    const sw = Math.sin(Math.PI * Math.min(1, tt / .08)) * Math.exp(-tt / .05);
    d[i] = bp.process(x) + .35 * sw * bp2.process(R() * 2 - 1);
  }
  run(d, ...lp4(4000, sr));
  return {data: finish(d, sr, .9, .03), f0: 1};
}
