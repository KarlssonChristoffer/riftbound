// CANID recipe v1: the night's dogs for wildlife's fight reactions (features/wildlife/coyotes.js: the event wildlife.howl).
// A voice is a HARMONIC source (a phase accumulator, the partials falling off ~1/k^tilt) whose partials are weighted by a
// smooth vocal-tract envelope (two broad formant humps, computed on the partials' frequencies every 64 samples: no
// resonant filter, so nothing rings or sounds hollow), with vibrato, a little pitch jitter, a breath layer (noise
// low-passed under ~2.4 kHz, following the voice) and, for barks, a rasp (the source's amplitude roughened). Every case
// ends in the creature recipe's warm tilt (-9 dB above 4.5 kHz, LP 7 kHz) and a raised-cosine fade (docs: RECIPE_GUIDE).
//   coyote_howl   a rising howl that wavers at the top and falls away, a couple of yips tacked on (~1.6-2.6 s)
//   coyote_yips   the pack answering: two voices of quick yips and short barks tumbling over each other (~1.2-2 s)
//   wolf_howl     long, low and smooth: a slow rise, a long held note with a slow vibrato, a slow fall (~2.6-3.6 s)
//   fox_bark      a red fox's hoarse bark: 2-4 short rough "wow"s (~.5-1.2 s)
import {Biquad} from '../dsp.js';

const TAU = Math.PI * 2, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const whiteN = (n, R) => { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = R() * 2 - 1; return b; };
const bq = (b, type, f, q, sr, g = 0) => new Biquad(type, f, q, sr, g).run(b);
const endFade = (b, sr, ms) => { const f = Math.min(b.length, Math.round(ms * sr / 1000)); for (let i = 0; i < f; i++) b[b.length - 1 - i] *= .5 - .5 * Math.cos(Math.PI * i / f); return b; };
const addAt = (dst, src, at, g = 1) => { at = Math.round(at); for (let i = Math.max(0, -at); i < src.length && i + at < dst.length; i++) dst[i + at] += src[i] * g; return dst; };
const smooth = u => { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); };

// one voiced call into out at t0. f(u) -> Hz over the call (u 0..1); env(u) -> 0..1; o: {dur, amp, H (partials), tilt,
// F (formant centres Hz), W (their widths Hz), vib (depth, ratio), vibRate, jit, breath, rasp}
function voice(out, sr, R, t0, o) {
  const n = Math.round(o.dur * sr), x = new Float32Array(n), H = o.H || 8;
  const br = whiteN(n, R); bq(br, 'lowpass', 2400, .6, sr); bq(br, 'lowpass', 2400, 1.1, sr); bq(br, 'highpass', 300, .7, sr);
  const rn = whiteN(n, R); bq(rn, 'lowpass', 70, .7, sr);   // a slow random wander (pitch jitter, rasp)
  let rr = 0; for (let i = 0; i < n; i++) rr = Math.max(rr, Math.abs(rn[i])); const rk = 1 / (rr || 1);
  const ph = new Float64Array(H + 1), g = new Float32Array(H + 1), vp = R() * TAU, F = o.F, W = o.W;
  for (let k = 1; k <= H; k++) ph[k] = R() * TAU;
  let f = o.f(0);
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / o.dur;
    if ((i & 63) === 0) {   // the partials' weights: the source tilt x the tract's humps at their frequency now
      f = o.f(u) * (1 + (o.vib || 0) * Math.sin(TAU * (o.vibRate || 5) * t + vp));
      for (let k = 1; k <= H; k++) {
        const fk = f * k; let w = 0;
        for (let q = 0; q < F.length; q++) { const d = (fk - F[q]) / W[q]; w += Math.exp(-d * d) * (q ? .6 : 1); }
        g[k] = fk > 5200 ? 0 : (.25 + w) / Math.pow(k, o.tilt || 1.2);
      }
    }
    const fj = f * (1 + (o.jit || .004) * rn[i] * rk);
    let s = 0;
    for (let k = 1; k <= H; k++) { ph[k] += TAU * fj * k / sr; s += Math.sin(ph[k]) * g[k]; }
    const e = o.env(u), ra = o.rasp ? 1 - o.rasp * .5 + o.rasp * .5 * Math.abs(rn[(i * 7) % n] * rk) * Math.sin(TAU * 31 * t) : 1;
    x[i] = e * (s * ra + br[i] * (o.breath || .08) * 3);
  }
  endFade(x, sr, Math.min(60, o.dur * 300));
  addAt(out, x, t0 * sr, o.amp ?? 1);
}
// a yip: a short chirp up then down, bright-ish but short
function yip(out, sr, R, t0, {f0 = 800, dur = .09, amp = 1, up = 1.3}) {
  voice(out, sr, R, t0, {dur, amp, H: 7, tilt: 1.3, F: [1100, 2300], W: [700, 900], jit: .006, breath: .1,
    f: u => f0 * (1 + (up - 1) * Math.sin(Math.PI * Math.min(1, u * 1.2))), env: u => Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), .7)});
}

const KINDS = {
  coyote_howl(R, sr) {
    const dur = R.range(1.2, 1.9), out = new Float32Array(Math.round((dur + 1.3) * sr));
    const lo = R.range(480, 560), hi = lo * R.range(1.55, 1.8), end = lo * R.range(1.05, 1.25), rise = R.range(.3, .42), fall = R.range(.66, .8), wv = R.range(2.2, 3.4), wp = R() * TAU;
    voice(out, sr, R, .03, {dur, amp: 1, H: 9, tilt: 1.25, F: [900, 2100], W: [650, 900], vib: .012, vibRate: R.range(5, 7), jit: .005, breath: .07,
      f: u => u < rise ? lo + (hi - lo) * Math.pow(smooth(u / rise), .8) : u < fall ? hi * (1 + .04 * Math.sin(TAU * wv * u * dur + wp) * smooth((u - rise) / .1)) : hi + (end - hi) * smooth((u - fall) / (1 - fall)),
      env: u => smooth(u / .12) * (u > .82 ? Math.pow(1 - (u - .82) / .18, 1.4) : 1)});
    for (let k = R.int(1, 3), t = dur + R.range(.08, .2); k > 0; k--) { yip(out, sr, R, t, {f0: R.range(700, 900), dur: R.range(.07, .11), amp: R.range(.45, .7)}); t += R.range(.13, .22); }
    return out;
  },
  coyote_yips(R, sr) {
    const len = R.range(1.1, 1.8), out = new Float32Array(Math.round((len + .6) * sr));
    for (let v = 0; v < 2; v++) {   // two voices, one a little lower and farther
      const base = v ? R.range(620, 760) : R.range(760, 920), amp = v ? .65 : 1;
      for (let t = v * R.range(.05, .2); t < len; t += R.range(.09, .2)) {
        if (R() < .18) voice(out, sr, R, t, {dur: R.range(.18, .32), amp: amp * .8, H: 8, tilt: 1.3, F: [950, 2100], W: [650, 900], vib: .02, vibRate: 9, breath: .08,   // a short wavering howl in the yips
          f: u => base * (1.1 + .35 * Math.sin(Math.PI * u)), env: u => Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), .8)});
        else yip(out, sr, R, t, {f0: base * R.range(.9, 1.15), dur: R.range(.06, .12), amp: amp * R.range(.6, 1), up: R.range(1.15, 1.45)});
      }
    }
    return out;
  },
  wolf_howl(R, sr) {
    const dur = R.range(2.4, 3.3), out = new Float32Array(Math.round((dur + .4) * sr));
    const lo = R.range(300, 360), hi = lo * R.range(1.35, 1.55), end = lo * R.range(.85, 1), rise = R.range(.15, .25), fall = R.range(.7, .82);
    voice(out, sr, R, .03, {dur, amp: 1, H: 8, tilt: 1.45, F: [650, 1500], W: [450, 700], vib: .01, vibRate: R.range(3.5, 5), jit: .003, breath: .06,
      f: u => u < rise ? lo + (hi - lo) * smooth(u / rise) : u < fall ? hi * (1 + .03 * Math.sin(Math.PI * (u - rise) / (fall - rise)) - .03 * smooth((u - rise) / (fall - rise))) : hi * .97 + (end - hi * .97) * smooth((u - fall) / (1 - fall)),
      env: u => smooth(u / .16) * (u > .78 ? Math.pow(1 - (u - .78) / .22, 1.6) : 1)});
    return out;
  },
  fox_bark(R, sr) {
    const n = R.int(2, 4), out = new Float32Array(Math.round((n * .32 + .4) * sr)), f0 = R.range(480, 620);
    for (let k = 0, t = .02; k < n; k++) {
      const dur = R.range(.12, .2);
      voice(out, sr, R, t, {dur, amp: k ? R.range(.75, .95) : 1, H: 10, tilt: 1.05, F: [1000, 2200], W: [600, 800], jit: .02, breath: .2, rasp: .8,
        f: u => f0 * (1 + .25 * Math.sin(Math.PI * Math.min(1, u * 1.3))), env: u => smooth(u / .15) * Math.pow(1 - clamp((u - .3) / .7, 0, 1), 1.3)});
      t += dur + R.range(.1, .2);
    }
    return out;
  },
};

export default {
  id: 'canid', version: 1, desc: 'Night canids: a coyote howl, the pack\'s yips, a wolf howl, a fox bark (wildlife.howl)',
  params: {kind: {values: Object.keys(KINDS), def: 'coyote_howl'}},
  cases: Object.fromEntries(Object.keys(KINDS).map(k => [k, {kind: k}])),
  variants: 4,
  loop: false,
  render(p, R, sr) { const out = (KINDS[p.kind] || KINDS.coyote_howl)(R, sr); bq(out, 'highshelf', 4500, .7, sr, -9); bq(out, 'lowpass', 7000, .6, sr); endFade(out, sr, 30); return out; },
  criteria: {
    // dark, tonal, natural tails (clickEnd); howls long
    coyote_howl: {clickEnd: [0, .01], durMs: [1300, 3400], centroidHz: [500, 1800], highHz: [900, 4000]},
    coyote_yips: {clickEnd: [0, .01], durMs: [900, 2600], centroidHz: [600, 2000], highHz: [1100, 4000]},
    wolf_howl: {clickEnd: [0, .01], durMs: [2200, 3900], centroidHz: [300, 1100], highHz: [500, 2600]},
    fox_bark: {clickEnd: [0, .01], durMs: [350, 1500], centroidHz: [600, 2000], highHz: [1200, 4000]},
  },
  notes: 'additive harmonic voice weighted by smooth formant humps (no resonators: no ring), vibrato + jitter, breath noise LP 2.4 kHz, rasp AM for barks',
};
