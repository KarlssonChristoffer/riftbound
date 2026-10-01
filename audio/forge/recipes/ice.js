// ICE recipe v1: frost-biome one-shots (docs/AUDIO.md §2.3, modal impacts + fracture). Mono, dry, warm (no shrill tops).
//   tinkle   ice crystals tinkling: 3-8 small pieces settling against each other. Each is a short glassy modal ping (f0 1.1-3.2 kHz,
//            ratios 1 : 2.2 : 3.9 : 5.9, a detuned twin per mode so it beats, t60 60-450 ms) struck by a 0.15 ms click; levels follow a
//            power law and the pieces thin out over time
//   crack    shifting ice: a sharp snap (BP 0.9-2.8 kHz, 2-6 ms), one or two dispersive 'zings' (a tone sweeping 3 kHz -> 300 Hz in
//            70-160 ms, the way flexural waves travel in an ice sheet), a low stick-slip groan (25-70 Hz pulse train, 110-650 Hz
//            resonances, swelling over 0.35-0.9 s) and a low thud
//   shatter  an icicle breaking: snap + the parent's short ring, then 8-20 fragments (modes ∝ 1/√size, level ∝ size) that land after
//            √(2h/g) and bounce with restitution 0.3-0.5, over a quiet grit of tiny shards
// Every ring is sized from its own decay and closed by a short raised-cosine fade; a gentle high shelf keeps the top warm.
import {Biquad, bounces} from '../dsp.js';

const TAU = Math.PI * 2, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), lerp = (a, b, u) => a + (b - a) * u;
const whiteN = (n, R) => { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = R() * 2 - 1; return b; };
const endFade = (b, sr, ms) => { const f = Math.min(b.length, Math.round(ms * sr / 1000)); for (let i = 0; i < f; i++) b[b.length - 1 - i] *= .5 - .5 * Math.cos(Math.PI * i / f); return b; };
const bq = (b, type, f, q, sr, g = 0) => new Biquad(type, f, q, sr, g).run(b);
const addAt = (dst, src, at, g = 1) => { at = Math.round(at); for (let i = Math.max(0, -at); i < src.length && i + at < dst.length; i++) dst[i + at] += src[i] * g; return dst; };
const ICE = [1, 2.2, 3.9, 5.9];

// modal ping: sparse 2-pole resonators driven by a click; each mode runs until ~-80 dB; twins detuned by `beat` Hz
function ping(out, sr, R, t0, {f0, amp = 1, t60 = .3, beat = 2, tc = .00015, ratios = ICE}) {
  const i0 = Math.round(t0 * sr), nx = Math.max(2, Math.round(tc * sr)), x = new Float32Array(nx);
  for (let i = 0; i < nx; i++) x[i] = Math.sin(Math.PI * (i + .5) / nx) * (1 + .3 * (R() * 2 - 1));
  ratios.forEach((r, k) => {
    const f = f0 * r * R.jit(.004), a = amp / (1 + k * 1.1) * R.jit(.2), tt = t60 / (1 + .55 * k);
    if (f > sr * .4 || f > 6200) return;
    for (const [df, ga] of [[0, 1], [R.range(.6, 1.3) * beat * (1 + k * .5), .75]]) {
      const w = TAU * (f + df) / sr, rr = Math.exp(-6.9078 / (Math.max(1e-3, tt) * sr)), c1 = 2 * rr * Math.cos(w), c2 = -rr * rr, g = a * ga * Math.sin(w) * 2.2;
      const len = Math.min(out.length - i0, nx + Math.round(tt * 1.25 * sr)); let y1 = 0, y2 = 0, x1 = 0;
      for (let i = 0; i < len; i++) { const y = c1 * y1 + c2 * y2 + g * x1; x1 = i < nx ? x[i] : 0; y2 = y1; y1 = y; out[i0 + i] += y * (i > len - 240 ? (len - i) / 240 : 1); }
    }
  });
}
// a short noise snap (attack .1 ms, 1/e decay d), band-passed
function snap(out, sr, R, t0, {d = .003, amp = 1, f = 1800, q = .8, lp = 0}) {
  const n = Math.round(d * 8 * sr) + 16, b = whiteN(n, R), na = Math.max(2, Math.round(.0001 * sr));
  for (let i = 0; i < n; i++) b[i] *= i < na ? i / na : Math.exp(-(i - na) / (d * sr));
  bq(b, 'bandpass', f, q, sr); if (lp) { bq(b, 'lowpass', lp, .7, sr); bq(b, 'lowpass', lp, 1.3, sr); }
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(b[i])); for (let i = 0; i < n; i++) b[i] *= amp / (pk + 1e-9);
  endFade(b, sr, 3); addAt(out, b, t0 * sr, 1);
}
const warm = (b, sr) => { bq(b, 'highshelf', 4500, .7, sr, -9); bq(b, 'lowpass', 9000, .6, sr); return b; };

const KINDS = {
  tinkle(R, sr) {
    const out = new Float32Array(Math.round(3.2 * sr)), n = R.int(3, 8); let t = 0;
    for (let k = 0; k < n; k++) {
      const a = Math.pow(1 - k / (n + 1), 1.3) * R.range(.5, 1);
      ping(out, sr, R, t, {f0: Math.exp(R.range(Math.log(1100), Math.log(3200))), amp: a, t60: R.range(.07, .45) * R.range(.8, 1.2), beat: R.range(1.5, 4)});
      snap(out, sr, R, t, {d: .0008, amp: .15 * a, f: R.range(2000, 4000), q: 1, lp: 5000});
      t += R.exp(.07 * (1 + k * .5)) + .02;
    }
    return warm(out, sr);
  },
  crack(R, sr) {
    const out = new Float32Array(Math.round(2.4 * sr));
    snap(out, sr, R, .004, {d: R.range(.002, .005), amp: 1, f: R.range(900, 2800), q: .8, lp: 5200});
    snap(out, sr, R, .004, {d: .0008, amp: .2, f: R.range(2200, 3400), q: .9, lp: 4600});
    // dispersive zings: a tone sweeping down as flexural waves spread
    for (let k = R.int(1, 2); k > 0; k--) {
      const t0 = .006 + k * R.range(.0, .05) * (k > 1 ? 1 : 0), dur = R.range(.07, .16), fa = R.range(1800, 3200), fb = R.range(260, 520), n = Math.round((dur * 1.6) * sr), z = new Float32Array(n);
      let ph = R() * TAU; for (let i = 0; i < n; i++) { const u = i / (dur * sr), f = fb + (fa - fb) / (1 + 14 * Math.min(u, 3)); ph += TAU * f / sr; z[i] = Math.sin(ph) * Math.exp(-u * 3.2) * Math.min(1, i / 40) * (1 + .15 * (R() * 2 - 1)); }
      endFade(z, sr, 8); addAt(out, z, t0 * sr, R.range(.3, .5));
    }
    // groan: stick-slip pulse train through low resonances, swelling then fading
    const gd = R.range(.35, .9), gs = R.range(.01, .08), n = Math.round((gd + .3) * sr), ex = new Float32Array(n); let t = 0;
    while (t < gd) { const u = t / gd, f = lerp(R.range(50, 70), R.range(24, 40), u) * R.jit(.12), i = Math.round(t * sr), env = Math.pow(Math.sin(Math.PI * Math.min(1, u)), 1.4); if (i < n) ex[i] += env * R.range(.6, 1); t += 1 / f; }
    const r1 = new Biquad('bandpass', R.range(110, 220), 5, sr), r2 = new Biquad('bandpass', R.range(280, 460), 5, sr), r3 = new Biquad('bandpass', R.range(520, 700), 4, sr), g = new Float32Array(n);
    for (let i = 0; i < n; i++) { const e = ex[i]; g[i] = r1.process(e) * 1.2 + r2.process(e) * .6 + r3.process(e) * .3; }
    bq(g, 'lowpass', 1500, .7, sr); endFade(g, sr, 60); addAt(out, g, gs * sr, R.range(.5, .8));
    const th = new Float32Array(Math.round(.5 * sr)); for (let i = 0; i < th.length; i++) { const t2 = i / sr; th[i] = Math.sin(TAU * R.range(70, 110) * t2) * Math.exp(-t2 / .09) * Math.min(1, i / 30); } endFade(th, sr, 40); addAt(out, th, .004 * sr, .25);
    return warm(out, sr);
  },
  shatter(R, sr) {
    const out = new Float32Array(Math.round(2.4 * sr)), fP = R.range(700, 1500);
    snap(out, sr, R, .002, {d: .003, amp: 1, f: R.range(1400, 3200), q: .8, lp: 5200});
    ping(out, sr, R, 0, {f0: fP, amp: .35, t60: R.range(.1, .22), beat: 3, tc: .0004});       // the parent's short ring
    const h = R.range(.4, 1), tFall = Math.sqrt(2 * h / 9.81) * R.range(.8, 1.1), nF = R.int(8, 20);
    for (let k = 0; k < nF; k++) {
      const size = R.pow(.15, 1, 1.6), f0 = clamp(fP * 1.6 / Math.sqrt(size) * R.range(.6, 1.2), 900, 4200), a0 = Math.pow(size, .7) * .8;
      for (const b of bounces(R, {t0: tFall + R.range(-.06, .12) + k * .004, v0: R.range(.7, 1), e: R.range(.3, .5), dt0: R.range(.08, .16), minV: .12, max: 5}))
        ping(out, sr, R, b.t, {f0: f0 * R.jit(.01), amp: a0 * b.v * b.v * .55, t60: R.range(.03, .14) * (1.3 - size * .6), beat: R.range(2, 5), tc: .0003});
    }
    // grit of tiny shards around the landings
    for (let k = 0, m = R.int(30, 60); k < m; k++) snap(out, sr, R, tFall + R.exp(.1), {d: R.range(.0006, .0022), amp: R.range(.05, .22) * R.range(.4, 1), f: R.range(1500, 3600), q: 1.2, lp: 4800});
    for (let k = 0, m = R.int(8, 16); k < m; k++) snap(out, sr, R, .004 + R.range(0, .07), {d: R.range(.0006, .002), amp: R.range(.1, .35), f: R.range(1200, 3200), q: 1.1, lp: 4800});   // crunch right after the break
    return warm(out, sr);
  },
};

export default {
  id: 'ice', version: 1, desc: 'Ice one-shots: tinkle (crystals), crack (snap + zing + groan), shatter (icicle break + fragments)',
  params: {kind: {values: Object.keys(KINDS), def: 'tinkle'}},
  cases: Object.fromEntries(Object.keys(KINDS).map(k => [k, {kind: k}])),
  variants: 6,
  loop: false,
  render(p, R, sr) { return (KINDS[p.kind] || KINDS.tinkle)(R, sr); },
  criteria: {'*': {clickEnd: [0, .01]}},
  notes: 'glassy twin-mode pings (beating), dispersive down-swept zings + stick-slip groan, fragment landings with bounces; warm shelf',
};
