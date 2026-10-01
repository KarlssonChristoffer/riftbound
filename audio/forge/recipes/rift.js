// RIFT recipe v1: the eerie biome's ambience, as seamless stereo loops (docs/AUDIO.md §2.3 "Rift drone / whispers").
// All three cases are loops (a recipe is either a loop or a one-shot): one-shot rift whispers/shimmers live in creature.js
// ('rift_whisper', 'rift_shimmer'). The arena's rift ambience drones on A, so the drone's partials are A (55/110/220 Hz) and E
// (82.4/164.8/329.6 Hz); the loop length is a multiple of 9600 samples so 55 Hz and 110 Hz have a WHOLE number of cycles per
// loop, and every other tone is rounded to a whole number of cycles per loop (<= 0.05 Hz off): seamless by construction.
//   drone    detuned beating partials (each root carries 3 voices, ±0.1-3 Hz apart, beats 0.1-3 Hz) with slowly drifting levels,
//            slow band-passed brown noise (a breathing 100-450 Hz 'wind in the rift', steep roll-off), sparse sub swells (A, E)
//            and a very faint glassy A/E pair far above (440/659 Hz) so the rift reads as 'crystal' without any brightness
//   whisper  a distant murmur: 3-5 phrases per loop; white noise through three vowel formants that hop at 3-6 syllables/s with
//            smooth glides (no real words), occasional soft fricatives (BP 2.2-3.4 kHz, quiet), decorrelated between the ears,
//            over a very low dark murmur floor so it stays a texture, not a list of events
//   shimmer  a crystalline swell: 2-3 slow swells per loop (rise 1.2-2.5 s, fall 1.5-3 s) of detuned A-major partials
//            (440 / 659 / 880 / 1109 / 1319 Hz, beating 0.8-4 Hz, 4-7 Hz tremolo) with a few soft sparkle pings far under it
// Brightness rules: continuous layers are low-mid (<= ~1.4 kHz) with steep roll-offs; highs only as sparse quiet grains.
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


const lp24 = (x, f, sr) => { circBiquad(x, 'lowpass', f, .54, sr); circBiquad(x, 'lowpass', f, 1.3, sr); return x; };
const VOWELS = {   // [F1, F2, F3] Hz (a whisper keeps the formants but has no pitch)
  a: [730, 1090, 2440], e: [530, 1840, 2480], i: [270, 2290, 3010], o: [570, 840, 2410], u: [300, 870, 2240], ae: [660, 1720, 2410], er: [490, 1350, 1690],
};

// rotating-phasor oscillator bank helper: adds amp(i) * [sin(ph) + h2 sin(2ph + p2) + h3 sin(3ph + p3)] to the outputs, f an exact cycles-per-loop frequency
function voice(outs, gains, sr, f, ph0, ampCtrl, every, hs) {
  const L = outs[0].length, w = 2 * Math.PI * f / sr, cr = Math.cos(w), ci = Math.sin(w);
  let c = Math.cos(ph0), s = Math.sin(ph0);
  let c2 = Math.cos(2 * ph0 + (hs[1] || 0)), s2 = Math.sin(2 * ph0 + (hs[1] || 0)), cr2 = Math.cos(2 * w), ci2 = Math.sin(2 * w);
  let c3 = Math.cos(3 * ph0 + (hs[3] || 0)), s3 = Math.sin(3 * ph0 + (hs[3] || 0)), cr3 = Math.cos(3 * w), ci3 = Math.sin(3 * w);
  const h2 = hs[0] || 0, h3 = hs[2] || 0, g0 = gains[0], g1 = gains[1];
  for (let i = 0; i < L; i++) {
    const j = i / every, j0 = j | 0, u = j - j0, a = ampCtrl[j0] + (ampCtrl[j0 + 1] - ampCtrl[j0]) * u;
    const y = s + (h2 ? h2 * s2 : 0) + (h3 ? h3 * s3 : 0);
    outs[0][i] += y * a * g0; outs[1][i] += y * a * g1;
    let t = c * cr - s * ci; s = c * ci + s * cr; c = t;
    if (h2) { t = c2 * cr2 - s2 * ci2; s2 = c2 * ci2 + s2 * cr2; c2 = t; }
    if (h3) { t = c3 * cr3 - s3 * ci3; s3 = c3 * ci3 + s3 * cr3; c3 = t; }
  }
}
// coarse control points (one per `every` samples) of a slow periodic drift; `voice` interpolates between them
const slowAmp = (n, sr, every, R, Lsec, base, depth, lo = .04, hi = .3) => { const f = loopLfo(R, Lsec, lo, hi, 3), m = Math.ceil(n / every) + 2, a = new Float32Array(m); for (let j = 0; j < m; j++) a[j] = base * Math.exp(depth * f(j * every / sr)); return a; };

// ------------------------------------------------------------------------------------------------ drone
function drone(p, R, sr, L, Lsec, qf) {
  const out = [new Float32Array(L), new Float32Array(L)], every = 256;
  const A = [[55, .7, [.5, 0, .3, 0]], [82.407, .6, [.45, .5, .25, 1]], [110, .8, [.4, 1, .22, 2]], [164.81, .8, [.3, 0, .1, 1]], [220, .7, [.25, 1, 0, 0]], [329.63, .32, [.15, 0, 0, 0]]];
  const Rv = R.fork(3), tilt = A.map(() => R.range(.55, 1.6)), vb = [new Float32Array(L), new Float32Array(L)];
  A.forEach(([f0, g, hs], k) => {
    for (let v = 0; v < 3; v++) {
      const d = v ? Rv.range(.1, 3) * (v === 1 ? 1 : -1) : 0, f = qf(f0 + d), pan = clamp(Rv.range(-.55, .55) + (v === 1 ? .25 : v === 2 ? -.25 : 0), -1, 1), ang = (pan + 1) * Math.PI / 4;
      const ac = slowAmp(L + 2 * every, sr, every, Rv.fork(k * 3 + v), Lsec, g * (v ? .62 : 1) * Rv.range(.55, 1.6) * tilt[k], .3);
      voice(vb, [Math.cos(ang), Math.sin(ang)], sr, f, Rv() * 6.283, ac, every, hs);
    }
  });
  unit(vb[0]); unit(vb[1]);
  // faint glassy pair
  const gl = [new Float32Array(L), new Float32Array(L)];
  for (const [f0, g] of [[440, .02], [659.26, .014], [880, .008]]) for (let v = 0; v < 2; v++) { const ac = slowAmp(L + 2 * every, sr, every, Rv.fork(40 + v), Lsec, g, .6, .05, .25); voice(gl, [v ? .4 : 1, v ? 1 : .4], sr, qf(f0 + (v ? Rv.range(.4, 2.5) : 0)), Rv() * 6.283, ac, every, [0, 0, 0, 0]); }
  // slow noise: brown -> BP drifting 100-450 Hz
  const Rn = R.fork(7), lf = loopLfo(Rn.fork(1), Lsec, .06, .25, 3), am = loopLfo(Rn.fork(2), Lsec, .08, .4, 3);
  const nz = [0, 1].map(c => { const x = circBrown(L, Rn.fork(10 + c)); circSweep(x, 'bandpass', t => 260 + 120 * lf(t + c * 1.3) , () => 2.2, sr); lp24(x, 800, sr); unit(x); const e = ctrl(L, sr, t => Math.exp(.3 * am(t + c * .7))); for (let i = 0; i < L; i++) x[i] *= e[i]; return x; });
  // sparse sub swells: A + E bells on the circular timeline
  const sw = [new Float32Array(L), new Float32Array(L)], Rs = R.fork(9);
  for (let k = R.int(2, 4); k > 0; k--) {
    const tc = Rs.range(0, Lsec), w = Rs.range(2.2, 4.2), fs = [[qf(55), 1], [qf(110), .7], [qf(82.407), .5]];
    const dur = Math.round(w * sr), i0 = Math.round(tc * sr - dur / 2);
    for (const [f, g] of fs) { const ph = Rs() * 6.283, ww = 2 * Math.PI * f / sr; for (let i = 0; i < dur; i++) { const u = i / dur, e = Math.pow(Math.sin(Math.PI * u), 2) * g, ii = (((i0 + i) % L) + L) % L; const v = Math.sin(ww * (i0 + i) + ph) * e; sw[0][ii] += v; sw[1][ii] += v; } }
  }
  for (let c = 0; c < 2; c++) for (let i = 0; i < L; i++) out[c][i] = vb[c][i] * .8 + gl[c][i] * 1.3 + nz[c][i] * .3 + sw[c][i] * .22;
  return out;
}

// ------------------------------------------------------------------------------------------------ whisper
function whisper(p, R, sr, L, Lsec, qf) {
  const out = [new Float32Array(L), new Float32Array(L)], every = 64, M = Math.ceil(L / every) + 2;
  const F1 = new Float32Array(M), F2 = new Float32Array(M), F3 = new Float32Array(M), G = new Float32Array(M), FR = new Float32Array(M), PAN = new Float32Array(M);
  const Rw = R.fork(5), names = Object.keys(VOWELS);
  G.fill(.1); F1.fill(500); F2.fill(1300); F3.fill(2400); PAN.fill(0);
  const nPh = R.int(5, 8), sizeF = Rw.range(.84, 1.2); let tlast = 0;
  const set = (arr, j, v) => { arr[((j % (M - 2)) + (M - 2)) % (M - 2)] = v; };
  const phrases = [];
  for (let k = 0; k < nPh; k++) phrases.push({t0: (Lsec / nPh) * (k + Rw.range(.05, .8)), dur: Rw.range(1.1, 2.6), rate: Rw.range(3, 6), pan: Rw.range(-.8, .8), amp: Rw.range(.55, 1)});
  // control tracks: formant frequencies glide between syllable vowels; gain = syllable bell; fricative level
  const gAcc = new Float32Array(M - 2).fill(.1), frAcc = new Float32Array(M - 2), panW = new Float32Array(M - 2), f1 = new Float32Array(M - 2).fill(500), f2 = new Float32Array(M - 2).fill(1300), f3 = new Float32Array(M - 2).fill(2400), wsum = new Float32Array(M - 2);
  const MM = M - 2;
  for (const ph of phrases) {
    const nSy = Math.max(2, Math.round(ph.dur * ph.rate)); let vow = Rw.pick(names);
    for (let s = 0; s < nSy; s++) {
      const t0 = ph.t0 + s / ph.rate, dur = 1 / ph.rate * Rw.range(.85, 1.15), nxt = Rw.pick(names), vw = VOWELS[vow], jf = Rw.range(.94, 1.08) * sizeF;
      const env = pu => Math.pow(Math.sin(Math.PI * clamp(pu, 0, 1)), 1.6) * Math.sin(Math.PI * clamp((s + .5) / nSy, 0, 1)) ** .5;
      const fr = Rw() < .45 ? Rw.range(.5, 1) : 0;
      const j0 = Math.floor(t0 * sr / every), jn = Math.round(dur * sr / every);
      for (let j = 0; j < jn; j++) {
        const jj = ((j0 + j) % MM + MM) % MM, pu = j / jn, e = env(pu) * ph.amp, wv = VOWELS[pu < .5 ? vow : nxt];
        const sm = pu * pu * (3 - 2 * pu), a = VOWELS[vow], b = VOWELS[nxt];
        // formants glide from this vowel towards the next one over the syllable
        const ff = [0, 1, 2].map(q => (a[q] + (b[q] - a[q]) * sm) * jf);
        if (e > gAcc[jj]) { gAcc[jj] = e; f1[jj] = ff[0]; f2[jj] = ff[1]; f3[jj] = ff[2]; }
        panW[jj] = ph.pan * e + panW[jj]; wsum[jj] += e;
        if (fr && pu < .3) frAcc[jj] = Math.max(frAcc[jj], fr * Math.sin(Math.PI * pu / .3));
      }
      vow = nxt;
    }
  }
  for (let j = 0; j < MM; j++) { G[j] = gAcc[j]; F1[j] = f1[j]; F2[j] = f2[j]; F3[j] = f3[j]; FR[j] = frAcc[j]; PAN[j] = wsum[j] > 0 ? panW[j] / wsum[j] : 0; }
  G[MM] = G[0]; G[MM + 1] = G[1]; F1[MM] = F1[0]; F1[MM + 1] = F1[1]; F2[MM] = F2[0]; F2[MM + 1] = F2[1]; F3[MM] = F3[0]; F3[MM + 1] = F3[1]; FR[MM] = FR[0]; FR[MM + 1] = FR[1]; PAN[MM] = PAN[0]; PAN[MM + 1] = PAN[1];
  // smooth the control tracks a little (circular) so formants glide rather than step
  const smoothC = a => { for (let pass = 0; pass < 3; pass++) { const c = a.slice(); for (let j = 0; j < MM; j++) a[j] = (c[(j + MM - 1) % MM] + 2 * c[j] + c[(j + 1) % MM]) / 4; a[MM] = a[0]; a[MM + 1] = a[1]; } };
  [F1, F2, F3, G, FR, PAN].forEach(smoothC);
  const at = (a, i) => { const j = i / every, j0 = j | 0; return a[j0] + (a[j0 + 1] - a[j0]) * (j - j0); };
  for (let c = 0; c < 2; c++) {
    const Rc = R.fork(30 + c), x = circWhite(L, Rc), parts = [];
    for (const [fa, Q, g] of [[F1, 7, 1], [F2, 9, .7], [F3, 10, .25]]) {
      const y = x.slice(); const bq = new Biquad('bandpass', 500, Q, sr), n = L;
      for (let i = Math.max(0, n - sr / 2); i < n; i++) { if (i % every === 0) bq.set('bandpass', clamp(at(fa, i), 150, 3600), Q); bq.process(y[i]); }
      for (let i = 0; i < n; i++) { if (i % every === 0) bq.set('bandpass', clamp(at(fa, i), 150, 3600), Q); y[i] = bq.process(y[i]); }
      parts.push([y, g]);
    }
    const body = new Float32Array(L); for (const [y, g] of parts) { unit(y); for (let i = 0; i < L; i++) body[i] += y[i] * g; }
    lp24(body, 3300, sr);
    // fricatives: soft band-limited noise 2.2-3.4 kHz at the syllable onsets
    const fz = circWhite(L, Rc.fork(9)); circBiquad(fz, 'bandpass', 2800, 1.2, sr); lp24(fz, 3600, sr); unit(fz);
    // murmur floor: dark pink
    const fl = circPink(L, Rc.fork(10)); circBiquad(fl, 'highpass', 120, .7, sr); lp24(fl, 700, sr); unit(fl);
    for (let i = 0; i < L; i++) {
      const g = at(G, i), pn = at(PAN, i), gain = Math.SQRT2 * (c ? Math.sin((pn + 1) * Math.PI / 4) : Math.cos((pn + 1) * Math.PI / 4));
      const ge = .3 + .7 * g;
      out[c][i] = body[i] * ge * gain * .55 + fz[i] * at(FR, i) * g * .05 + fl[i] * (.05 + .05 * g);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ shimmer
function shimmer(p, R, sr, L, Lsec, qf) {
  const out = [new Float32Array(L), new Float32Array(L)], Rs = R.fork(3), nS = R.int(3, 4), every = 256;
  const SETS = [[[440, 1], [659.26, .8], [880, .55], [1108.7, .3], [1318.5, .18]], [[440, 1], [523.25, .7], [659.26, .8], [880, .5], [1046.5, .25]], [[220, .7], [440, 1], [659.26, .6], [880, .5], [1318.5, .15]], [[329.63, .8], [440, 1], [554.37, .5], [880, .45], [1108.7, .25]]];
  const PART = R.pick(SETS).map(([f, g]) => [f, g * R.range(.6, 1.4)]);
  const vb = [new Float32Array(L), new Float32Array(L)];
  for (let k = 0; k < nS; k++) {
    const tc = (Lsec / nS) * (k + Rs.range(.15, .85)), rise = Rs.range(1.8, 3), fall = Rs.range(2, 3.5), tr = Rs.range(4, 7), trD = Rs.range(.15, .35);
    const total = Math.round((rise + fall) * sr), i0 = Math.round((tc - rise) * sr), shift = Rs.pick([1, 1, 1.5, .75]);
    for (const [f0, g] of PART) for (let v = 0; v < 2; v++) {
      const f = qf(f0 * (shift === 1 ? 1 : shift === 1.5 ? 1 : 1) + (v ? Rs.range(.8, 4) : 0)), w = 2 * Math.PI * f / sr, ph = Rs() * 6.283, pan = Rs.range(-.8, .8), ang = (pan + 1) * Math.PI / 4, gl = Math.cos(ang), gr = Math.sin(ang), tph = Rs() * 6.283;
      if (f > 1500 && Rs() < .4) continue;
      for (let i = 0; i < total; i++) {
        const t = i / sr, e = .28 + .72 * (t < rise ? Math.pow(Math.sin(Math.PI / 2 * t / rise), 2) : Math.pow(Math.cos(Math.PI / 2 * (t - rise) / fall), 2)) ;
        const ii = (((i0 + i) % L) + L) % L, val = Math.sin(w * (i0 + i) + ph) * e * g * (v ? .7 : 1) * (1 - trD + trD * Math.sin(2 * Math.PI * tr * t + tph));
        vb[0][ii] += val * gl; vb[1][ii] += val * gr;
      }
    }
  }
  // sparse sparkle pings under the swells: tiny glassy sine grains (<= 2.8 kHz), 1.5-4 per second, quiet
  const sp = [new Float32Array(L + 24000), new Float32Array(L + 24000)], Rp = R.fork(8);
  for (const t of poissonT(Rp, Lsec, () => 2.4, 3)) {
    const f = qf(Rp.pick([880, 1318.5, 1760, 2217.5, 2637])) * Rp.range(.997, 1.003), d = Rp.range(.05, .14), n = Math.round(d * 7 * sr), a = Rp.pow(.2, 1, 1.6) * .09, pan = Rp.range(-.9, .9), ang = (pan + 1) * Math.PI / 4, i0 = Math.round(t * sr), w = 2 * Math.PI * f / sr;
    for (let i = 0; i < n && i0 + i < L + 24000; i++) { const v = Math.sin(w * i) * Math.exp(-i / (d * sr)) * Math.min(1, i / 90) * a; sp[0][i0 + i] += v * Math.cos(ang); sp[1][i0 + i] += v * Math.sin(ang); }
  }
  const Rn = R.fork(11);
  for (let c = 0; c < 2; c++) {
    const s = fold(sp[c], L); circBiquad(s, 'lowpass', 3500, .6, sr);
    // a quiet dark breath of air under it so the loop never goes silent
    const br = circPink(L, Rn.fork(c)); circBiquad(br, 'highpass', 200, .7, sr); lp24(br, 900, sr); unit(br);
    const bam = loopLfo(Rn.fork(5 + c), Lsec, .08, .3, 3), be = ctrl(L, sr, t => Math.exp(.4 * bam(t)));
    unit(vb[c]); for (let i = 0; i < L; i++) out[c][i] = vb[c][i] * .45 + s[i] + br[i] * be[i] * .1;
  }
  return out;
}

export default {
  id: 'rift', version: 1, desc: 'Rift ambience loops: A/E detuned drone, distant formant whispers, crystalline shimmer swells',
  params: {kind: {values: ['drone', 'whisper', 'shimmer'], def: 'drone'}},
  cases: {drone: {kind: 'drone'}, whisper: {kind: 'whisper'}, shimmer: {kind: 'shimmer'}},
  variants: 4,
  loop: true,
  render(p, R, sr) {
    const m = R.int(44, 52), L = Math.round(9600 * m * sr / 48000), Lsec = L / sr, qf = f => Math.max(1, Math.round(f * Lsec)) / Lsec;
    const fn = {drone, whisper, shimmer}[p.kind] || drone;
    return fn(p, R, sr, L, Lsec, qf);
  },
  criteria: {   // dark loops: nothing above ~3.2 kHz, no hiss (flatness ~0); drone is mostly < 400 Hz by design (A 55 Hz root)
    drone: {centroidHz: [100, 300], highHz: [250, 550], flatness: [0, .01], durMs: [8000, 11000]},
    whisper: {centroidHz: [750, 1400], highHz: [2000, 3200], flatness: [0, .02], durMs: [8000, 11000]},
    shimmer: {centroidHz: [350, 850], highHz: [550, 1450], flatness: [0, .01], durMs: [8000, 11000]},
  },
  notes: 'detuned A/E partials with beats (whole cycles per loop) + drifting dark noise + sub swells; formant-hopping noise whispers; detuned A-major swell partials with sparse pings',
};
