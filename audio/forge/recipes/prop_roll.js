// PROP_ROLL recipe v1: a wooden barrel rolling over a hard floor at a steady medium speed, as a seamless stereo loop
// (docs/AUDIO.md §2.3 "Roll"; the one-shot ~2 s roll in prop.js is the older, chained version). The runtime varies
// playbackRate 0.7-1.4 and the gain with the speed, so the loop is one steady speed and nothing else.
// The model follows the user's material rules (RECIPE_GUIDE.md): solid wood is DENSE and HEAVILY DAMPED. Every knock is a short
// "thock" (a strong transient, low q, t60 <= ~90 ms, no sustained cavity tone) and nothing is metallic (no hoop ring, no clink).
//   1. STAVE KNOCKS   `staves` (12-16) per revolution: each stave edge meets the floor once a turn. Each stave is a lossy beam-mode
//                     bank (1 : 2.76 : 5.4 : 8.9 plus a few dense lossy modes) with a short t60 (20-45 ms), a half-sine contact of
//                     2-3.5 ms, a noise residue and a tiny low thump. Each stave has its own pitch and weight (the barrel's
//                     construction, fixed across turns); timing and level wobble a little each turn (an uneven floor)
//   2. THE BUMP       once per revolution a heavier knock: the bung / a flat spot, lower (80-125 Hz), t60 ~90 ms, 2.2x the weight,
//                     with the barrel's mass thump
//   3. RUMBLE         brown noise low-passed (~220 Hz for stone), amplitude-modulated at the revolution rate and at the stave
//                     rate (the body breathing with the contact), plus slow irregularity
//   4. GRIT           sparse, quiet grains of stone dust / grit (BP 0.9-2.8 kHz, 1-4 ms); on dirt a dull soft crunch instead
// Cases: stone (crisper contact, more grit) and dirt (softer 4-6 ms contact, shorter t60, dull rumble, soft crunch).
// SEAMLESS by construction: the loop is a whole number of revolutions (N turns at rev = N / Lsec, so the bump and every stave
// land on the same grid at the wrap), knocks live on a circular timeline and wrap, noise and IIR filters run circularly, every
// LFO has whole cycles per loop. Master: 38 Hz high-pass, -9 dB shelf above 4.5 kHz and a 6 kHz low-pass.
import {Biquad, halfSine} from '../dsp.js';

const TAU = Math.PI * 2, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const whiteN = (n, R) => { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = R() * 2 - 1; return b; };
const BEAM = [1, 2.756, 5.404, 8.933, 13.345];

// ------------------------------------------------------------------ circular helpers (copied from stream.js / lava.js)
function circBiquad(b, type, f, q, sr, {gainDb = 0, warm = sr >> 1} = {}) {
  const bq = new Biquad(type, f, q, sr, gainDb), n = b.length;
  for (let i = Math.max(0, n - warm); i < n; i++) bq.process(b[i]);
  return bq.run(b);
}
function circBrown(n, R) {
  const w = whiteN(n, R); let v = 0; const step = i => (v = (v + .02 * w[i]) / 1.02);
  for (let i = Math.max(0, n - 20000); i < n; i++) step(i);
  const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = step(i) * 3.5;
  return b;
}
function loopLfo(R, Lsec, lo, hi, k = 5) {
  const parts = []; let p = 0;
  for (let j = 0; j < k; j++) {
    const m = Math.max(1, Math.round(Math.exp(R.range(Math.log(lo), Math.log(hi))) * Lsec)), a = R.range(.4, 1);
    parts.push([TAU * m / Lsec, R() * TAU, a]); p += a * a / 2;
  }
  const s = 1 / Math.sqrt(p);
  return t => { let v = 0; for (const [w, ph, a] of parts) v += a * Math.sin(w * t + ph); return v * s; };
}
function ctrl(n, sr, fn, every = 64) {
  const m = Math.ceil(n / every) + 2, c = new Float32Array(m); for (let j = 0; j < m; j++) c[j] = fn(j * every / sr);
  const o = new Float32Array(n); for (let i = 0; i < n; i++) { const j = i / every, j0 = j | 0, u = j - j0; o[i] = c[j0] + (c[j0 + 1] - c[j0]) * u; }
  return o;
}
const rmsOf = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length) + 1e-12; };

// ------------------------------------------------------------------ one wooden knock (heavily damped beam modes + dense lossy scatter)
// modes run until ~-80 dB (len from t60), driven by the contact force x; written circularly into out (the buffer is the loop)
function ring(out, i0, modes, x, amp) {
  const L = out.length;
  for (const m of modes) {
    const sr = m.sr; if (!(m.f > 0) || m.f > sr * .45 || !m.a) continue;
    const len = x.length + Math.round(m.t60 * 1.35 * sr);
    const w = TAU * m.f / sr, r = Math.exp(-6.9078 / (Math.max(1e-4, m.t60) * sr)), c1 = 2 * r * Math.cos(w), c2 = -r * r, g = amp * m.a * Math.sin(w);
    let y1 = 0, y2 = 0, x1 = 0, j = i0 % L;
    for (let i = 0; i < len; i++) { const y = c1 * y1 + c2 * y2 + g * x1; x1 = i < x.length ? x[i] : 0; y2 = y1; y1 = y; out[j] += y * (i > len - 120 ? (len - i) / 120 : 1); if (++j === L) j = 0; }
  }
}
function woodModes(sr, f0, R, {t0 = .04, dense = 4, count = 4} = {}) {
  const m = [];
  BEAM.slice(0, count).forEach((r, i) => { const f = f0 * r * R.jit(.03); m.push({sr, f, a: (i ? 1.3 / (1 + .3 * i) : .5) * R.jit(.25), t60: Math.max(.008, t0 * Math.pow(f0 / f, .75))}); });
  for (let k = 0; k < dense; k++) { const r = R.range(1.6, 12), f = f0 * r; m.push({sr, f, a: R.range(.8, 1.6) / Math.sqrt(r), t60: Math.max(.006, t0 * .7 * Math.pow(f0 / f, .75)) * R.range(.7, 1.2)}); }
  return m;
}
// the mass thump: a short, low, pitch-dropping sine, fully damped
function thump(out, sr, i0, f, T, amp) {
  const L = out.length, n = Math.round(T * 7 * sr); let ph = 0, j = i0 % L;
  for (let i = 0; i < n; i++) { const t = i / sr; ph += TAU * f * (1 + .25 * Math.exp(-t / .02)) / sr; out[j] += amp * Math.sin(ph) * Math.exp(-t / T) * Math.min(1, i / 40) * (i > n - 200 ? (n - i) / 200 : 1); if (++j === L) j = 0; }
}
function knock(out, sr, R, t0, {amp = 1, f0 = 220, tc = .0028, t60 = .04, dense = 4, count = 4, noise = .5, thump: th = .1, noiseHz = 1300, tf = 0}) {
  const i0 = ((Math.round(t0 * sr) % out.length) + out.length) % out.length, x = halfSine(tc, sr);
  for (let i = 0; i < x.length; i++) x[i] *= 1 + .2 * (R() * 2 - 1);
  ring(out, i0, woodModes(sr, f0, R, {t0: t60, dense, count}), x, amp * 2.2);
  if (th > 0) thump(out, sr, i0, tf || f0 * R.range(.55, .8), .022, amp * th * .4);
  if (noise > 0) {   // contact residue: LP noise that follows the contact
    const tau = .004 + tc * 1.6, n = Math.round((8 * tau + .008) * sr), b = whiteN(n, R); for (let i = 0; i < n; i++) b[i] *= Math.exp(-i / (sr * tau)) * Math.min(1, i / 14);
    new Biquad('lowpass', noiseHz, .7, sr).run(b); new Biquad('highpass', 90, .7, sr).run(b);
    const L = out.length; let j = i0; for (let i = 0; i < n; i++) { out[j] += b[i] * amp * noise * 4 * (i > n - 100 ? (n - i) / 100 : 1); if (++j === L) j = 0; }
  }
}

export default {
  id: 'prop_roll', version: 1, desc: 'Wooden barrel rolling over a hard floor: seamless stereo loop, stave knocks + once-per-turn bump + rumble + grit',
  params: {
    soft: {min: 0, max: 1, def: 0},        // 0 = stone (crisp contact, grit), 1 = dirt (soft contact, dull rumble, soft crunch)
    staves: {min: 10, max: 18, def: 14},   // staves per revolution (varied +-2 per variant)
    rev: {min: .8, max: 2, def: 1.35},     // revolutions per second (adjusted so the loop holds a whole number of turns)
  },
  cases: {
    stone: {soft: 0},
    dirt: {soft: 1},
  },
  variants: 4,
  loop: true,
  render(p, R, sr) {
    const solo = p._solo || null, G = k => !solo || solo === k ? 1 : 0;   // _solo: measure one layer (hits|rumble|grit)
    const soft = p.soft, Lt = R.range(8.2, 10.4), rev0 = p.rev * R.range(.92, 1.1), N = Math.round(Lt * rev0);
    const Lsec = N / rev0, L = Math.round(Lsec * sr);   // N whole revolutions
    const staves = clamp(Math.round(p.staves + R.range(-2, 2)), 10, 18), per = 1 / (staves * rev0);
    const out = [new Float32Array(L), new Float32Array(L)];
    const Rb = R.fork(11), f0 = Rb.range(150, 215);   // the barrel's character: stave pitch + weight (fixed across turns)
    const stave = [];
    for (let s = 0; s < staves; s++) stave.push({f: f0 * Rb.range(1.0, 1.9), w: Rb.range(.75, 1.25), tc: Rb.range(.002, .0033) * (1 + 1.1 * soft)});
    const hits = new Float32Array(L);   // mono knocks (the barrel is one source in the middle of the image)
    // ---- 1 + 2. stave knocks and the once-per-turn bump, on a circular timeline
    const Rk = R.fork(21), bumpF = Rb.range(80, 120), bumpPos = Rb.int(0, staves - 1);
    for (let r = 0; r < N; r++) for (let s = 0; s < staves; s++) {
      const t = (r * staves + s) * per + Rk.range(-.11, .11) * per, st = stave[s], uneven = Rk.range(.75, 1.2);
      const isBump = s === bumpPos;
      if (isBump) {
        knock(hits, sr, Rk, t, {amp: 1.15 * uneven * (1 - .15 * soft), f0: bumpF * Rk.jit(.04), tc: (.0058 + .002 * soft) * Rk.range(.9, 1.1), t60: (.085 - .02 * soft) * Rk.range(.9, 1.1), dense: 8, count: 5, noise: .35 * (1 - .4 * soft), thump: .8, noiseHz: 1000, tf: bumpF * .62});
      } else {
        knock(hits, sr, Rk, t, {amp: .6 * st.w * uneven * (1 - .12 * soft), f0: st.f * Rk.jit(.03), tc: st.tc * Rk.range(.9, 1.1), t60: (.05 - .012 * soft) * Rk.range(.85, 1.15), dense: 3, count: 3, noise: .85 * (1 - .45 * soft), thump: .1 + .1 * soft, noiseHz: (soft ? 900 : 1600) * Rk.jit(.1)});
      }
    }
    // ---- 3. rumble: brown noise, LP, modulated at the revolution and stave rates; slow irregularity
    const Rr = R.fork(31), lfoSlow = loopLfo(Rr.fork(1), Lsec, .15, 1.2, 4), irr = ctrl(L, sr, t => Math.exp(.18 * lfoSlow(t)));
    const ph1 = Rr() * TAU, ph2 = Rr() * TAU;
    const am = new Float32Array(L); for (let i = 0; i < L; i++) { const t = i / sr; am[i] = (1 + .32 * Math.cos(TAU * rev0 * t + ph1) + .14 * Math.cos(TAU * staves * rev0 * t + ph2)) * irr[i]; }
    // ---- 4. grit: sparse grains. stone: BP .9-2.8 kHz; dirt: dull soft crunch BP .4-1.2 kHz
    const grit = [new Float32Array(L), new Float32Array(L)], Rg = R.fork(41), gRate = (soft ? 55 : 85) * Rg.range(.8, 1.2), gAmp = soft ? 1.0 : 1.5;
    for (let t = Rg.exp(1 / gRate); t < Lsec; t += Rg.exp(1 / gRate)) {
      const d = (soft ? Rg.range(.002, .006) : Rg.range(.0008, .004)) * sr, n = Math.round(d * 8) + 8, b = whiteN(n, Rg);
      for (let i = 0; i < n; i++) b[i] *= Math.exp(-i / d) * Math.min(1, i / 8);
      new Biquad('bandpass', soft ? Rg.range(400, 1200) : Rg.range(900, 2800), 1.1, sr).run(b);
      const a = gAmp * Rg.pow(.15, 1, 1.6) * (1 + .5 * Math.cos(TAU * staves * rev0 * t + ph2)), pan = Rg.range(-.5, .5), gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4), i0 = Math.round(t * sr);
      for (let i = 0; i < n; i++) { const e = i > n - 60 ? (n - i) / 60 : 1; grit[0][(i0 + i) % L] += b[i] * a * gl * e; grit[1][(i0 + i) % L] += b[i] * a * gr * e; }
    }
    const hr = rmsOf(hits);
    for (let c = 0; c < 2; c++) {
      const o = out[c], Rn = R.fork(51 + c), common = circBrown(L, Rr.fork(2));
      const own = circBrown(L, Rn); for (let i = 0; i < L; i++) own[i] = .7 * common[i] + .3 * own[i];   // mostly shared: one barrel
      circBiquad(own, 'lowpass', soft ? 150 : 230, .7, sr); circBiquad(own, 'lowpass', soft ? 150 : 230, .9, sr); circBiquad(own, 'highpass', 48, .7, sr);
      const g = .3 * hr / rmsOf(own) * (soft ? 1.15 : 1);
      for (let i = 0; i < L; i++) o[i] = hits[i] * G('hits') + own[i] * am[i] * g * G('rumble') + grit[c][i] * G('grit');
      circBiquad(o, 'highpass', 38, .7, sr); circBiquad(o, 'highshelf', 4500, .7, sr, {gainDb: -9}); circBiquad(o, 'lowpass', soft ? 4200 : 6000, .6, sr);
    }
    return out;
  },
  criteria: {   // 33 seeds each (1-24, 44291-44296, 3 large), with margin. Dark by design: the 95% band edge sits near 1.2 kHz (stone) / 0.6 kHz (dirt)
    stone: {durMs: [7900, 11200], centroidHz: [200, 420], lowHz: [30, 80], highHz: [850, 1900], flatness: [0, .01], hf4kDb: [-60, -24], crest: [14, 30]},
    dirt: {durMs: [7900, 11200], centroidHz: [110, 230], lowHz: [30, 80], highHz: [330, 950], flatness: [0, .01], hf4kDb: [-70, -34], crest: [14, 30]},
  },
  notes: 'N whole revolutions per loop; staves x rev knocks of damped beam+dense wood modes (t60 20-45 ms, half-sine 2-3.5 ms), once-per-turn bump (80-125 Hz, t60 ~90 ms), brown rumble AM at rev and stave rates, sparse dark grit; stone vs dirt = contact softness',
};
