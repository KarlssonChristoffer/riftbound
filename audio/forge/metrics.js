// FORGE METRICS: objective measurements of a rendered sound, so a designer who can't hear can still check it.
// Shared by tools/sfx/forge.mjs (Node) and the lab page (browser). Everything works on Float32Arrays.
//
//   analyze(ch, sr) -> {durMs, peakDb, truePeakDb, rmsDb, lufsM, crest, attackMs, t60Ms, centroidHz, rolloffHz,
//                       flatness, flux, onsets[], onsetRate, lowHz, highHz, dc, clickStart, clickEnd}
//       ch: Float32Array (mono) or [L, R]
//       lufsM       momentary-max loudness (400 ms window; short sounds are zero-padded to 400 ms), ITU-R BS.1770 K-weighting
//       attackMs    10% -> 90% of the peak of a 1 ms envelope
//       t60Ms       Schroeder backward integration, extrapolated from the -5..-25 dB slope (or -5..-15 if the tail is short)
//       centroidHz / rolloffHz (85%) / flatness (0 tonal .. 1 noise) / flux: from the energy-weighted average spectrum
//       lowHz/highHz the band holding the middle 90% of the energy (5% .. 95%)
//       onsets      times (s) where the 5 ms envelope jumps (event structure: steps, debris, crackles)
//   spectrumProfile(ch, sr) -> Float32Array(48)   log-band average spectrum (dB), for similarity between sounds
//   similarity(a, b) -> 0..1                      1 = identical spectral profile (variants should NOT all be ≈1)
//   check(metrics, criteria) -> {pass, fails}     criteria: {metric: [min, max]} (null = no bound)
//   stft(x, sr, {n, hop}) -> {mags: Float32Array[] (per frame, n/2+1 bins, linear), freqs, hop, n}
//   fft(re, im)                                   in-place radix-2

export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
const hann = n => { const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (n - 1)); return w; };
export function stft(x, sr, {n = 1024, hop = 256} = {}) {
  const w = hann(n), mags = [], re = new Float64Array(n), im = new Float64Array(n);
  for (let s = 0; s + n <= Math.max(x.length, n); s += hop) {
    for (let i = 0; i < n; i++) { re[i] = (x[s + i] || 0) * w[i]; im[i] = 0; }
    fft(re, im);
    const m = new Float32Array(n / 2 + 1); for (let k = 0; k <= n / 2; k++) m[k] = Math.hypot(re[k], im[k]) * 2 / n * 2; mags.push(m);
  }
  const freqs = new Float32Array(n / 2 + 1); for (let k = 0; k <= n / 2; k++) freqs[k] = k * sr / n;
  return {mags, freqs, hop, n};
}
const mono = ch => Array.isArray(ch) ? (ch.length === 1 ? ch[0] : ch[0].map((v, i) => (v + ch[1][i]) * .5)) : ch;
const db = v => 20 * Math.log10(Math.max(1e-12, v));

// ---- K-weighting (BS.1770), coefficients computed for any sample rate (as pyloudnorm does)
function kFilters(sr) {
  const mk = (G, Q, fc, type) => {
    const A = Math.pow(10, G / 40), w0 = 2 * Math.PI * fc / sr, al = Math.sin(w0) / (2 * Q), c = Math.cos(w0);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'shelf') { b0 = A * ((A + 1) + (A - 1) * c + 2 * Math.sqrt(A) * al); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - 2 * Math.sqrt(A) * al); a0 = (A + 1) - (A - 1) * c + 2 * Math.sqrt(A) * al; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - 2 * Math.sqrt(A) * al; }
    else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  };
  return [mk(3.99984385397, .7071752369554193, 1681.9744509555319, 'shelf'), mk(0, .5003270373253953, 38.13547087613982, 'hp')];
}
function kWeight(x, sr) {
  let y = Float64Array.from(x);
  for (const [b0, b1, b2, a1, a2] of kFilters(sr)) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0; const o = new Float64Array(y.length);
    for (let i = 0; i < y.length; i++) { const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; o[i] = v; }
    y = o;
  }
  return y;
}
export function lufsMomentaryMax(ch, sr) {
  const chans = Array.isArray(ch) ? ch : [ch], W = Math.round(.4 * sr), step = Math.round(.1 * sr);
  const kw = chans.map(c => { const k = kWeight(c, sr); if (k.length >= W) return k; const p = new Float64Array(W); p.set(k); return p; });
  const n = kw[0].length; let best = -Infinity;
  for (let s = 0; s + W <= n; s += step) {
    let z = 0; for (const k of kw) { let ss = 0; for (let i = s; i < s + W; i++) ss += k[i] * k[i]; z += ss / W; }
    // a mono signal is played on both speakers: count it twice, like a centred stereo source
    if (chans.length === 1) z *= 2;
    best = Math.max(best, -.691 + 10 * Math.log10(Math.max(1e-12, z)));
  }
  return best;
}
function truePeak(x) {   // 4x oversampled (Catmull-Rom) peak, a close estimate of the inter-sample peak
  let p = 0;
  for (let i = 1; i < x.length - 2; i++) {
    const a = x[i - 1], b = x[i], c = x[i + 1], d = x[i + 2];
    for (let k = 0; k < 4; k++) { const t = k / 4, v = .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t); if (Math.abs(v) > p) p = Math.abs(v); }
  }
  for (const v of x) if (Math.abs(v) > p) p = Math.abs(v);
  return p;
}
function envelope(x, sr, ms) { const h = Math.max(1, Math.round(ms * sr / 1000)), e = []; for (let s = 0; s < x.length; s += h) { let m = 0; for (let i = s; i < Math.min(x.length, s + h); i++) m = Math.max(m, Math.abs(x[i])); e.push(m); } return {e, h}; }

export function analyze(ch, sr) {
  const x = mono(ch), n = x.length;
  let pk = 0, ss = 0, sum = 0; for (let i = 0; i < n; i++) { const v = x[i]; pk = Math.max(pk, Math.abs(v)); ss += v * v; sum += v; }
  const rms = Math.sqrt(ss / n);
  const tp = Array.isArray(ch) ? Math.max(...ch.map(truePeak)) : truePeak(x);
  // attack: 10% -> 90% of the 1 ms envelope peak
  const {e, h} = envelope(x, sr, 1); let ep = 0, epi = 0; e.forEach((v, i) => { if (v > ep) { ep = v; epi = i; } });
  let a10 = 0; while (a10 < epi && e[a10] < ep * .1) a10++; let a90 = a10; while (a90 < epi && e[a90] < ep * .9) a90++;
  // T60: Schroeder backward integration
  const edc = new Float64Array(n); let acc = 0; for (let i = n - 1; i >= 0; i--) { acc += x[i] * x[i]; edc[i] = acc; }
  const e0 = edc[0] || 1e-12, lvl = i => 10 * Math.log10(Math.max(1e-12, edc[i] / e0));
  const find = d => { let i = 0; while (i < n - 1 && lvl(i) > d) i++; return i; };
  const i5 = find(-5), i25 = find(-25), i15 = find(-15);
  let t60 = null;
  if (lvl(n - 1) < -26 && i25 > i5) t60 = (i25 - i5) / sr * 3;
  else if (lvl(n - 1) < -16 && i15 > i5) t60 = (i15 - i5) / sr * 6;
  // spectrum: energy-weighted average of the STFT, plus flux between frames
  const S = stft(x, sr, {n: 2048, hop: 512}), K = S.freqs.length, avg = new Float64Array(K); let wsum = 0, flux = 0, prev = null;
  for (const m of S.mags) {
    let fe = 0; for (let k = 0; k < K; k++) fe += m[k] * m[k];
    for (let k = 0; k < K; k++) avg[k] += m[k] * m[k]; wsum += fe;
    if (prev) { let f = 0; for (let k = 0; k < K; k++) { const d = m[k] - prev[k]; if (d > 0) f += d * d; } flux += Math.sqrt(f) / Math.sqrt(fe + 1e-12); }
    prev = m;
  }
  let tot = 0, cen = 0; for (let k = 1; k < K; k++) { tot += avg[k]; cen += avg[k] * S.freqs[k]; }
  const band = q => { let c = 0; for (let k = 1; k < K; k++) { c += avg[k]; if (c >= tot * q) return S.freqs[k]; } return sr / 2; };
  let lg = 0, ar = 0, cnt = 0; for (let k = 1; k < K; k++) if (S.freqs[k] > 40 && S.freqs[k] < 16000) { lg += Math.log(avg[k] + 1e-20); ar += avg[k]; cnt++; }
  const flat = cnt ? Math.exp(lg / cnt) / (ar / cnt + 1e-20) : 0;
  // onsets: 5 ms envelope jumps above 2.2x its recent mean and above 15% of the max
  const E5 = envelope(x, sr, 5), on = [], mx = Math.max(...E5.e);
  for (let k = 3; k < E5.e.length; k++) { const pm = (E5.e[k - 1] + E5.e[k - 2] + E5.e[k - 3]) / 3; if (E5.e[k] > mx * .15 && E5.e[k] > pm * 2.2 && (!on.length || k * E5.h / sr - on[on.length - 1] > .04)) on.push(+(k * E5.h / sr).toFixed(3)); }
  return {
    durMs: Math.round(n / sr * 1000), peakDb: +db(pk).toFixed(1), truePeakDb: +db(tp).toFixed(1), rmsDb: +db(rms).toFixed(1),
    lufsM: +lufsMomentaryMax(ch, sr).toFixed(1), crest: +(db(pk) - db(rms)).toFixed(1),
    attackMs: +((a90 - a10) * h / sr * 1000).toFixed(2), t60Ms: t60 === null ? null : Math.round(t60 * 1000),
    centroidHz: Math.round(tot ? cen / tot : 0), rolloffHz: Math.round(band(.85)), lowHz: Math.round(band(.05)), highHz: Math.round(band(.95)),
    flatness: +flat.toFixed(3), flux: +(S.mags.length > 1 ? flux / (S.mags.length - 1) : 0).toFixed(3),
    onsets: on, onsetRate: +(on.length / (n / sr)).toFixed(1),
    dc: +(sum / n).toFixed(5), clickStart: +Math.abs(x[0]).toFixed(4), clickEnd: +Math.abs(x[n - 1]).toFixed(4),
  };
}

export function spectrumProfile(ch, sr, bands = 48) {
  const x = mono(ch), S = stft(x, sr, {n: 2048, hop: 512}), out = new Float32Array(bands), lo = Math.log(40), hi = Math.log(Math.min(16000, sr / 2));
  const acc = new Float64Array(bands);
  for (const m of S.mags) for (let k = 1; k < m.length; k++) { const f = S.freqs[k]; if (f < 40 || f > 16000) continue; const b = Math.min(bands - 1, Math.floor((Math.log(f) - lo) / (hi - lo) * bands)); acc[b] += m[k] * m[k]; }
  let mx = 0; for (let b = 0; b < bands; b++) mx = Math.max(mx, acc[b]);
  for (let b = 0; b < bands; b++) out[b] = Math.max(-60, 10 * Math.log10((acc[b] + 1e-20) / (mx + 1e-20)));
  return out;
}
export function similarity(a, b) {   // 1 - mean abs difference of dB profiles / 30 dB, clamped
  let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return Math.max(0, 1 - d / a.length / 30);
}
export function check(m, criteria = {}) {
  const fails = [];
  for (const [k, [lo, hi]] of Object.entries(criteria)) {
    const v = k === 'onsetCount' ? m.onsets.length : m[k];
    if (v === null || v === undefined) { fails.push(`${k}: n/a`); continue; }
    if (lo !== null && lo !== undefined && v < lo) fails.push(`${k} ${v} < ${lo}`);
    if (hi !== null && hi !== undefined && v > hi) fails.push(`${k} ${v} > ${hi}`);
  }
  return {pass: !fails.length, fails};
}
