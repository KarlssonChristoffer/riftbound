// PROP recipe v1: physical world props, WOODEN and STURDY (docs/AUDIO.md §2.3 "Impacts", "Breaking", RECIPE_GUIDE 'hollow'/'clinky').
// All cases are mono one-shots (the barrel roll is a ~2 s one-shot, not a loop). The material rule from the user's ratings:
// solid wood is DENSE and HEAVILY DAMPED: a strong transient and a short 'thock', never a ringing box. So every wooden hit here is
//   - a bank of ~25 modes from the beam family plus a dense scatter of lossy modes, every mode with a short t60 (the fundamental
//     <= ~110 ms, the rest falling with frequency to ~8 ms): no sustained cavity tone
//   - excited by a half-sine contact of 1.5-4 ms (soft + heavy = dark), plus a noise residue that follows the contact
//   - a short low thump (the body's mass), and nothing metallic (no hoop ring, no clink)
// Cases:
//   tip      a barrel tipping over: a pivot creak, then the fall (~0.3 s), the heavy side impact (thud + stave knocks), and 2-4 rocking
//            settles at shrinking intervals (restitution ~0.35)
//   kick     a boot into a barrel: short hard contact, dull leather thud, body knock, a small shuffle of the barrel
//   scrape   a crate pushed over stone (~0.35 s): stick-slip slips (35 -> 90 Hz, jittered) each knocking the panel, over a stone-grit
//            grind that follows the push speed
//   roll     a barrel rolling over stone (~2 s): stave knocks at (staves x revolutions/s), a heavier once-per-revolution bump, a
//            stone rumble; the revolution rate decays (rolling friction) so the knocks thin out and the last few clunk to a stop
//   drop     a crate dropped from ~2 m onto stone: heavy impact, stone crunch, slat rattle (3-6 loose knocks), a small rebound
// Everything is closed by a short raised-cosine fade, a gentle -9 dB high shelf above 4.5 kHz and a low-pass at ~6 kHz.
import {Biquad, halfSine} from '../dsp.js';

const TAU = Math.PI * 2, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), lerp = (a, b, u) => a + (b - a) * u;
const whiteN = (n, R) => { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = R() * 2 - 1; return b; };
const endFade = (b, sr, ms) => { const f = Math.min(b.length, Math.round(ms * sr / 1000)); for (let i = 0; i < f; i++) b[b.length - 1 - i] *= .5 - .5 * Math.cos(Math.PI * i / f); return b; };
const bq = (b, type, f, q, sr, g = 0) => new Biquad(type, f, q, sr, g).run(b);
const addAt = (dst, src, at, g = 1) => { at = Math.round(at); for (let i = Math.max(0, -at); i < src.length && i + at < dst.length; i++) dst[i + at] += src[i] * g; return dst; };
const BEAM = [1, 2.756, 5.404, 8.933, 13.345, 18.638];

// sparse modal bank: each mode runs until ~-80 dB (len from its t60) driven by the contact force x
function ring(out, sr, i0, modes, x, amp) {
  for (const m of modes) {
    if (!(m.f > 0) || m.f > sr * .45 || !m.a) continue;
    const len = Math.min(out.length - i0, x.length + Math.round(m.t60 * 1.3 * sr)); if (len <= 0) continue;
    const w = TAU * m.f / sr, r = Math.exp(-6.9078 / (Math.max(1e-4, m.t60) * sr)), c1 = 2 * r * Math.cos(w), c2 = -r * r, g = amp * m.a * Math.sin(w);
    let y1 = 0, y2 = 0, x1 = 0;
    for (let i = 0; i < len; i++) { const y = c1 * y1 + c2 * y2 + g * x1; x1 = i < x.length ? x[i] : 0; y2 = y1; y1 = y; out[i0 + i] += y * (i > len - 120 ? (len - i) / 120 : 1); }
  }
}
// solid wood: heavily damped beam modes + dense lossy scatter; t60 of the fundamental `t0` (<= .11 s), higher modes shorter
function woodModes(f0, R, {t0 = .08, dense = 14, count = 6} = {}) {
  const m = [];
  BEAM.slice(0, count).forEach((r, i) => { const f = f0 * r * R.jit(.03); m.push({f, a: (i ? 1.3 / (1 + .3 * i) : .5) * R.jit(.25), t60: Math.max(.008, t0 * Math.pow(f0 / f, .75))}); });
  for (let k = 0; k < dense; k++) { const r = R.range(1.6, 12), f = f0 * r; m.push({f, a: R.range(.8, 1.6) / Math.sqrt(r), t60: Math.max(.006, t0 * .7 * Math.pow(f0 / f, .75)) * R.range(.7, 1.2)}); }
  return m;
}
// one wooden impact at t0: modal body + low thump (mass) + contact noise. size scales pitch down; hard sets brightness (short tc)
function woodHit(out, sr, R, t0, {amp = 1, f0 = 160, tc = .0025, t60 = .08, dense = 14, count = 6, noise = .5, thump = .6, noiseHz = 1400}) {
  const T = R.tone || {b: 1, th: 1, f: 1}; f0 *= T.f; thump *= T.th; noiseHz *= T.b; dense = Math.round(dense * T.b);
  const i0 = Math.round(t0 * sr), x = halfSine(tc, sr);
  for (let i = 0; i < x.length; i++) x[i] *= 1 + .2 * (R() * 2 - 1);
  ring(out, sr, i0, woodModes(f0, R, {t0: t60, dense, count}), x, amp * 2.2);
  // mass thump: a short, low, pitch-dropping sine (~0.45 f0), fully damped
  const nT = Math.round(.2 * sr), th = new Float32Array(nT), ft = f0 * R.range(.7, .9); let ph = 0;
  for (let i = 0; i < nT; i++) { const t = i / sr; ph += TAU * ft * (1 + .25 * Math.exp(-t / .02)) / sr; th[i] = Math.sin(ph) * Math.exp(-t / .022) * Math.min(1, i / 40); }
  endFade(th, sr, 30); addAt(out, th, i0, amp * thump * .4);
  if (noise > 0) {
    const tau = .005 + tc * 2, n = Math.round((9 * tau + .01) * sr), b = whiteN(n, R); for (let i = 0; i < n; i++) b[i] *= Math.exp(-i / (sr * tau)) * Math.min(1, i / 16);
    bq(b, 'lowpass', noiseHz, .7, sr); bq(b, 'highpass', 90, .7, sr); endFade(b, sr, 8); addAt(out, b, i0, amp * noise * 4);
  }
}
const warm = (b, sr) => { bq(b, 'highpass', 62, .7, sr); bq(b, 'highpass', 62, .7, sr); bq(b, 'highshelf', 4500, .7, sr, -9); bq(b, 'lowpass', 6200, .6, sr); return b; };
// stone/dust grit: tiny noise grains (BP), dark
function grit(out, sr, R, t0, t1, rate, amp, f0 = 1200, f1 = 3500) {
  for (let t = t0 + R.exp(1 / rate); t < t1; t += R.exp(1 / rate)) {
    const d = R.range(.0008, .004), n = Math.round(d * 8 * sr) + 8, b = whiteN(n, R); for (let i = 0; i < n; i++) b[i] *= Math.exp(-i / (d * sr)) * Math.min(1, i / 8);
    bq(b, 'bandpass', R.range(f0, f1), 1.1, sr); endFade(b, sr, 3); addAt(out, b, t * sr, amp * R.pow(.15, 1, 1.6));
  }
}

const KINDS = {
  tip(R, sr) {
    const out = new Float32Array(Math.round(2.2 * sr)), f0 = R.range(95, 150), tFall = R.range(.26, .42);
    // pivot creak: the rim grinding as it leans, a short stick-slip of the staves (wood on wood, dull)
    { const cd = R.range(.1, .24), n = Math.round(cd * sr), ex = new Float32Array(n); let t = 0;
      while (t < cd) { const i = Math.round(t * sr); if (i < n) ex[i] += R.range(.4, 1) * Math.sin(Math.PI * t / cd); t += 1 / (R.range(38, 70) * R.jit(.2)); }
      const a = new Biquad('bandpass', R.range(160, 260), 3.5, sr), b = new Biquad('bandpass', R.range(380, 600), 3.5, sr), c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = a.process(ex[i]) + .6 * b.process(ex[i]); endFade(c, sr, 25); addAt(out, c, .02 * sr, .55);
      const gn = Math.round((cd + .1) * sr), g = whiteN(gn, R); bq(g, 'lowpass', 900, .7, sr); for (let i = 0; i < gn; i++) g[i] *= Math.pow(Math.sin(Math.PI * i / gn), 2) * .12; addAt(out, g, .02 * sr, 1); }
    // the side impact, then rocking settles (restitution ~.35)
    woodHit(out, sr, R, tFall, {amp: 1.1, f0, tc: R.range(.0025, .004), t60: R.range(.08, .11), dense: 16, noise: .6, thump: 1});
    woodHit(out, sr, R, tFall + .002, {amp: .55, f0: f0 * R.range(1.6, 2.2), tc: .0022, t60: .06, dense: 10, noise: .3, thump: .1});   // stave knock
    let t = tFall, dt = R.range(.1, .15), v = .42;
    for (let k = R.int(2, 4); k > 0; k--) { t += dt; woodHit(out, sr, R, t, {amp: v * R.range(.8, 1.1), f0: f0 * R.range(.95, 1.1), tc: .003, t60: .07, dense: 10, noise: .35, thump: .7}); dt *= R.range(.55, .72); v *= .5; }
    const gr = new Float32Array(out.length); grit(gr, sr, R, tFall, tFall + .25, 70, .05, 900, 2600); addAt(out, gr, 0, 1);
    return warm(out, sr);
  },
  kick(R, sr) {
    const out = new Float32Array(Math.round(1.1 * sr)), f0 = R.range(105, 165);
    woodHit(out, sr, R, .004, {amp: 1.1, f0, tc: R.range(.0012, .002), t60: R.range(.06, .09), dense: 18, noise: .9, thump: .9, noiseHz: 1700});
    woodHit(out, sr, R, .006, {amp: .5, f0: f0 * R.range(1.7, 2.3), tc: .0016, t60: .05, dense: 10, noise: .3, thump: 0});
    // leather boot thud: dull noise, no click
    { const n = Math.round(.06 * sr), b = whiteN(n, R); for (let i = 0; i < n; i++) b[i] *= Math.exp(-i / (.012 * sr)) * Math.min(1, i / 20); bq(b, 'lowpass', 520, .7, sr); endFade(b, sr, 12); addAt(out, b, 0, 1.1); }
    // the barrel shifts: one or two soft knocks and a short slide
    woodHit(out, sr, R, R.range(.09, .15), {amp: .3, f0: f0 * 1.05, tc: .003, t60: .06, dense: 8, noise: .2, thump: .5});
    if (R() < .6) woodHit(out, sr, R, R.range(.2, .3), {amp: .16, f0: f0 * .98, tc: .003, t60: .05, dense: 6, noise: .15, thump: .5});
    const sn = Math.round(.2 * sr), g = whiteN(sn, R); bq(g, 'bandpass', 700, .8, sr); for (let i = 0; i < sn; i++) g[i] *= Math.pow(Math.sin(Math.PI * i / sn), 2) * .1; addAt(out, g, .05 * sr, 1);
    return warm(out, sr);
  },
  scrape(R, sr) {
    const dur = R.range(.32, .4), out = new Float32Array(Math.round((dur + .35) * sr)), f0 = R.range(150, 300);
    const speed = t => Math.pow(clamp(t / .05, 0, 1), 1.5) * Math.exp(-Math.max(0, t - dur * .55) / (dur * .3));
    // stick-slip train: each slip knocks the panel (a damped wood hit), amplitude peaky
    let t = .0; const times = [];
    while (t < dur) { const v = speed(t); times.push([t, v]); const fss = lerp(35, 95, clamp(v, 0, 1)); t += 1 / (fss * R.range(.75, 1.3)); }
    for (const [tt, v] of times) if (v > .04) woodHit(out, sr, R, tt, {amp: .32 * v * R.pow(.3, 1, 1.4), f0: f0 * R.range(.9, 1.15), tc: R.range(.0018, .004), t60: R.range(.03, .06), dense: 6, count: 4, noise: .5, thump: 0, noiseHz: 1800});
    // stone grit grind, follows the speed (dark band)
    const n = out.length, gr = whiteN(n, R); bq(gr, 'bandpass', R.range(600, 1100), .7, sr); bq(gr, 'lowpass', 2400, .7, sr);
    const rough = whiteN(n, R); bq(rough, 'lowpass', 60, .7, sr); let rr = 0; for (let i = 0; i < n; i++) rr += rough[i] * rough[i]; rr = 1 / Math.sqrt(rr / n);
    for (let i = 0; i < n; i++) gr[i] *= speed(i / sr) * .5 * Math.max(.2, 1 + .9 * rough[i] * rr);
    endFade(gr, sr, 60); addAt(out, gr, 0, 1);
    return warm(out, sr);
  },
  roll(R, sr) {
    const dur = R.range(1.8, 2.3), out = new Float32Array(Math.round((dur + .5) * sr)), f0 = R.range(95, 145), staves = R.int(12, 16), rev0 = R.range(1.2, 1.7);
    // revolution rate decays with rolling friction (linear to a stop at T): phase(t) = rev0 (t - t^2/(2T))
    const T = dur * R.range(.95, 1.05), rev = t => Math.max(0, rev0 * (1 - t / T)), phase = t => rev0 * (t - t * t / (2 * T));
    // events on the unrolled phase: a stave edge every 1/staves of a turn, a heavier bump once per turn
    const nTurns = phase(T), steps = Math.floor(nTurns * staves), t0s = [];
    const tAtPhase = p => T * (1 - Math.sqrt(Math.max(0, 1 - p / (rev0 * T / 2))));   // inverse of phase()
    for (let k = 1; k <= steps; k++) t0s.push([tAtPhase(k / staves), k]);
    for (const [t, k] of t0s) {
      const v = clamp(rev(t) / rev0, 0, 1), onTurn = k % staves === 0;
      woodHit(out, sr, R, t, {amp: (onTurn ? .9 : .3 + .2 * R()) * (.25 + .75 * v), f0: f0 * (onTurn ? 1 : R.range(1.6, 2.8)), tc: R.range(.002, .004), t60: onTurn ? .08 : .03, dense: onTurn ? 12 : 4, count: onTurn ? 6 : 3, noise: .4, thump: onTurn ? .9 : .15, noiseHz: 1200});
    }
    // stone rumble: brown noise whose level follows the speed, low-passed
    const n = out.length, rm = new Float32Array(n); let v1 = 0; for (let i = 0; i < n; i++) { v1 = (v1 + .02 * (R() * 2 - 1)) / 1.02; rm[i] = v1 * 3.5; }
    bq(rm, 'lowpass', 320 * R.tone.b, .7, sr); bq(rm, 'highpass', 55, .7, sr);
    for (let i = 0; i < n; i++) { const t = i / sr, sp = clamp(rev(t) / rev0, 0, 1); rm[i] *= Math.pow(sp, 1.2) * Math.min(1, t / .06) * .55; }
    const gr = whiteN(n, R); bq(gr, 'bandpass', 700 * R.tone.b, .7, sr); bq(gr, 'lowpass', 1800, .7, sr); for (let i = 0; i < n; i++) gr[i] *= Math.pow(clamp(rev(i / sr) / rev0, 0, 1), 1.6) * .14 * R.tone.b * Math.min(1, i / sr / .06);
    endFade(rm, sr, 40); endFade(gr, sr, 40); addAt(out, rm, 0, 1); addAt(out, gr, 0, 1);
    return warm(out, sr);
  },
  drop(R, sr) {
    const out = new Float32Array(Math.round(1.4 * sr)), f0 = R.range(130, 240);
    woodHit(out, sr, R, .003, {amp: 1.2, f0, tc: R.range(.0016, .0028), t60: R.range(.08, .11), dense: 20, noise: .7, thump: 1, noiseHz: 1800});
    woodHit(out, sr, R, .004, {amp: .55, f0: f0 * R.range(1.8, 2.5), tc: .0015, t60: .05, dense: 12, noise: .25, thump: 0});
    // stone contact: a dull crunch of grit under the corner, not a click
    { const n = Math.round(.05 * sr), b = whiteN(n, R); for (let i = 0; i < n; i++) b[i] *= Math.exp(-i / (.007 * sr)) * Math.min(1, i / 12); bq(b, 'bandpass', R.range(900, 1700), .8, sr); endFade(b, sr, 8); addAt(out, b, 0, .55); }
    const gr = new Float32Array(out.length); grit(gr, sr, R, 0, .14, 140, .1, 1000, 3000); addAt(out, gr, 0, 1);
    // loose slats / planks knock after the main hit
    for (let k = R.int(3, 6), t = .02; k > 0; k--) { t += R.range(.012, .05); woodHit(out, sr, R, t, {amp: R.range(.12, .35) * Math.pow(.8, 6 - k), f0: f0 * R.range(1.4, 3), tc: R.range(.0015, .0025), t60: R.range(.02, .045), dense: 4, count: 3, noise: .25, thump: 0}); }
    // small rebound
    woodHit(out, sr, R, R.range(.1, .14), {amp: .38, f0: f0 * R.range(.95, 1.05), tc: .003, t60: .07, dense: 10, noise: .3, thump: .6});
    woodHit(out, sr, R, R.range(.19, .24), {amp: .12, f0: f0 * .98, tc: .003, t60: .05, dense: 6, noise: .15, thump: .5});
    return warm(out, sr);
  },
};

export default {
  id: 'prop', version: 1, desc: 'Wooden props: tip (barrel falls over), kick, scrape (crate on stone), roll (barrel, ~2 s), drop (crate from 2 m)',
  params: {kind: {values: Object.keys(KINDS), def: 'tip'}},
  cases: Object.fromEntries(Object.keys(KINDS).map(k => [k, {kind: k}])),
  variants: 6,
  loop: false,
  render(p, R, sr) { R.tone = {b: R.range(.65, 1.5), th: R.range(.55, 1.5), f: R.range(.9, 1.15)}; return (KINDS[p.kind] || KINDS.tip)(R, sr); },   // per-variant tone: brightness, mass thump, pitch
  criteria: {'*': {clickEnd: [0, .01]}},
  notes: 'damped beam+dense wood modes (short t60), half-sine contact 1.5-4 ms, mass thump, stick-slip, rolling phase decay; no metal, no sustained cavity',
};
