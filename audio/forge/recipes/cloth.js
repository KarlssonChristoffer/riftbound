// CLOTH: the ranger's cloak and soft leathers in motion. Light and airy: cloth moves air, it does not thump.
// Model (docs/AUDIO.md §2.3 "Roll / jump / climb"): a cloth whoosh = white noise through a band-pass whose centre is
// swept by a 200-400 ms bell (the cloak sails out then folds back), the amplitude following the same skewed bell, and a
// fine "fabric grain" (the noise multiplied by a 100-250 Hz low-passed random modulator: threads, folds, never a clean
// hiss). A higher airy band an octave above rides at -9 dB. Body contacts are soft, heavily damped thuds (low-q modes
// 110-300 Hz, long half-sine contact 6-14 ms: leather and wool, no ring); ground contact is a quiet LP pink brush with
// sparse grit. Nothing is below ~110 Hz: a light, agile body.
//   roll:    whoosh 0.3-0.4 s + shoulder thud, back thud, a brush over the ground, a soft two-foot recovery
//   jump:    push-off scuff + sole thud + a short swish
//   swish:   a quick arm / cloak movement, 120-200 ms rising sweep
//   flutter: the cloak catching a gust: a 0.5-0.8 s whoosh whose level is chopped by peaky flaps, each ending in a snap
import {add, scale, peak, filter, sweep, halfSine, modal, burst, pink, white, poisson, saturate, t60FromQ} from '../dsp.js';

const lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, to = 1) => { const p = peak(b); return p > 0 ? scale(b, to / p) : b; };
const rms = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / Math.max(1, b.length)); };
const unitRms = b => { const r = rms(b); return r > 0 ? scale(b, 1 / r) : b; };

// skewed bell on u in [0,1]: peak at `pk`, sin^p both sides (cloth: fast fill, slower fall)
function bell(u, pk = .4, p = 2) {
  if (u <= 0 || u >= 1) return 0;
  const v = u < pk ? .5 * u / pk : .5 + .5 * (u - pk) / (1 - pk);
  return Math.pow(Math.sin(Math.PI * v), p);
}

// the cloth whoosh: returns a buffer of n samples with the sweep placed at `at` (s)
function whoosh(R, sr, n, {at = 0, dur = .3, fLo = 250, fHi = 900, q = .7, pk = .4, p = 2, grain = .55, air = 0, level = 1, rise = true}) {
  const m = Math.max(8, Math.round(dur * sr)), tail = Math.round(.03 * sr), L = Math.min(n - Math.round(at * sr), m + tail);
  if (L <= 8) return new Float32Array(n);
  const x = pink(L, R), y = new Float32Array(L);   // the airy octave layer is gone (air = 0)
  // centre follows a bell (or rises monotonically for quick swishes)
  const fAt = t => { const u = t / dur; return lerp(fLo, fHi, rise ? bell(u, pk, 1.4) : Math.min(1, Math.max(0, u))); };
  sweep(x, 'bandpass', fAt, q, sr, {every: 24}); for (let k = 0; k < 2; k++) sweep(x, 'lowpass', t => Math.min(2000, fAt(t) * 2.2), .7, sr, {every: 48});   // steep (24 dB/oct) roll-off above ~2 kHz
  unitRms(x); unitRms(y);
  // fabric grain: random modulator 100-250 Hz low-passed noise, rectified into 1 + g * m
  const g = filter(white(L, R), 'lowpass', R.range(110, 230), .7, sr), gn = 1 / (rms(g) + 1e-9);
  const out = new Float32Array(n);
  for (let i = 0; i < L; i++) {
    const env = bell(i / sr / dur, pk, p), mod = Math.max(0.05, 1 + grain * g[i] * gn * .6);
    out[i + Math.round(at * sr)] = (x[i] + air * y[i]) * env * mod * level;
  }
  return out;
}

// a soft body thud: low-q modes, long contact. f in Hz, returns buffer of n samples with the hit at `at`
function thud(R, sr, n, {at, f = 180, amp = 1, t60 = .06, tc = .01}) {
  const modes = [{f, t60, a: 1}, {f: f * R.range(1.55, 1.9), t60: t60 * .6, a: .5 * R.jit(.2)}, {f: f * R.range(2.6, 3.2), t60: t60 * .35, a: .2 * R.jit(.3)}];
  const m = Math.round((t60 * 1.2 + tc + .01) * sr), o = new Float32Array(n);
  const body = modal(halfSine(tc, sr), modes, sr, m), p = peak(body) || 1;
  add(o, body, at * sr, amp / p);
  // dull noise residue: cloth and padding absorb the impact
  add(o, burst(.04, sr, R, {a: .0006, d: R.range(.006, .012), color: 'pink', bp: f * R.range(2, 3.5), q: .7}), at * sr, amp * .35);
  return o;
}
// ground / skin brush: pink band with raised-sine window and fine grit
function brush(R, sr, n, {at, dur, f = 2600, q = .6, level = 1, lp = 5200, grit = .4}) {
  const m = Math.round(dur * sr), b = pink(m, R);
  filter(b, 'bandpass', f, q, sr); filter(b, 'lowpass', lp, .7, sr);
  for (let i = 0; i < m; i++) b[i] *= Math.pow(Math.sin(Math.PI * i / m), 1.6);
  unitRms(b);
  for (const t of poisson(R, 0, dur, 220 * grit)) { const i0 = Math.round(t * sr), a = R.pow(.3, 1, 2) * R.sign() * Math.sin(Math.PI * t / dur); for (let k = 0; k < 14 && i0 + k < m; k++) b[i0 + k] += .9 * a * (R() * 2 - 1) * (1 - k / 14); }
  const o = new Float32Array(n); filter(b, 'lowpass', lp * 1.1, .7, sr); add(o, filter(b, 'highpass', 700, .7, sr), at * sr, level); return o;
}

const CASES = {
  roll(R, sr, p) {
    const dur = R.range(.34, .4), n = Math.round((dur + .33) * sr), out = new Float32Array(n);
    add(out, whoosh(R.fork(1), sr, n, {at: .0, dur, fLo: 250 * R.jit(.2), fHi: 880 * R.jit(.2), q: R.range(.65, .85), pk: R.range(.35, .45), level: 1}));
    // tumble: shoulder, back, then the feet. Each lighter than a footstep would be.
    const t1 = R.range(.07, .11), t2 = t1 + R.range(.07, .11), t3 = dur * R.range(.78, .88);
    add(out, thud(R.fork(2), sr, n, {at: t1, f: R.range(150, 230), amp: .85, t60: .055, tc: R.range(.008, .014)}), 0, .55);
    add(out, thud(R.fork(3), sr, n, {at: t2, f: R.range(130, 200), amp: .8, t60: .06, tc: R.range(.01, .016)}), 0, .45);
    // ground brush under the tumble, then the recovery
    add(out, brush(R.fork(4), sr, n, {at: t1, dur: t3 - t1 + .03, f: R.range(900, 1500), lp: 2400, level: .55, grit: .7}));
    const f1 = R.range(190, 260);
    add(out, thud(R.fork(5), sr, n, {at: t3, f: f1, amp: .8, t60: .05, tc: R.range(.005, .009)}), 0, .5);
    add(out, thud(R.fork(6), sr, n, {at: t3 + R.range(.03, .05), f: f1 * 1.1, amp: .7, t60: .045, tc: R.range(.005, .009)}), 0, .38);
    add(out, brush(R.fork(7), sr, n, {at: t3 - .005, dur: R.range(.06, .09), f: R.range(1000, 1600), lp: 2400, level: .4, grit: .8}));
    // the cloak settling after the tumble: a short low-level swish
    add(out, whoosh(R.fork(8), sr, n, {at: t3 - .02, dur: R.range(.14, .2), fLo: 280, fHi: 650, q: .75, pk: .3, level: .32}));
    return out;
  },
  jump(R, sr, p) {
    const n = Math.round(.4 * sr), out = new Float32Array(n);
    // push-off: sole scuff, a small thud and a brief leather creak-grit
    add(out, brush(R.fork(1), sr, n, {at: 0, dur: R.range(.035, .055), f: R.range(900, 1600), lp: 2600, q: .7, level: 1.6, grit: 1}));
    add(out, thud(R.fork(2), sr, n, {at: .004, f: R.range(190, 260), amp: .7, t60: .045, tc: R.range(.005, .008)}), 0, .9);
    // cloth swish as the body rises
    add(out, whoosh(R.fork(3), sr, n, {at: R.range(.015, .035), dur: R.range(.16, .24), fLo: 300, fHi: R.range(900, 1150), q: .8, pk: .35, level: .8}));
    return out;
  },
  swish(R, sr, p) {
    const dur = R.range(.12, .19), n = Math.round((dur + .05) * sr), out = new Float32Array(n);
    const up = R() < .75, a = R.range(260, 400), b = R.range(850, 1200);
    add(out, whoosh(R.fork(1), sr, n, {at: 0, dur, fLo: up ? a : b, fHi: up ? b : a, q: R.range(.7, 1), pk: R.range(.45, .6), p: 2, grain: .6, rise: false}));
    return out;
  },
  flutter(R, sr, p) {
    const dur = R.range(.55, .75), n = Math.round((dur + .12) * sr), out = new Float32Array(n);
    const bed = whoosh(R.fork(1), sr, n, {at: 0, dur: dur + .08, fLo: 260, fHi: R.range(800, 1050), q: .7, pk: R.range(.4, .55), p: 1.5, grain: .4, level: 1});
    // flaps: a peaky random modulator (flap rate 9-16 Hz, wandering), squared so it chops the bed into gusts
    const rf = R.fork(2), mod = filter(white(n, rf), 'lowpass', rf.range(9, 15), .9, sr); const mr = rms(mod) + 1e-9;
    const snaps = [];
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, mod[i] / mr * .7 + .45), e = v * v;
      out[i] = bed[i] * Math.min(1.4, .22 + e);
      if (i > 2 && mod[i - 1] > mod[i - 2] && mod[i - 1] >= mod[i] && mod[i - 1] / mr > 1.15 && (!snaps.length || i / sr - snaps[snaps.length - 1] > .05)) snaps.push(i / sr);
    }
    // a snap where the cloth is pulled taut at the top of a flap: short HP burst, only in the body of the gust
    for (const t of snaps) {
      const w = Math.pow(Math.sin(Math.PI * Math.min(1, t / dur)), 1.2); if (w < .3) continue;
      add(out, burst(.05, sr, R, {a: .0004, d: R.range(.004, .009), color: 'pink', bp: R.range(700, 1300), q: .7}), t * sr, R.range(.25, .45) * w);
    }
    return out;
  },
};

export default {
  id: 'cloth', version: 2, desc: 'Cloak and leather movement: roll, jump, swish, flutter (swept cloth whoosh + soft body contacts)',
  params: {kind: {values: ['roll', 'jump', 'swish', 'flutter'], def: 'roll'}},
  cases: {roll: {kind: 'roll'}, jump: {kind: 'jump'}, swish: {kind: 'swish'}, flutter: {kind: 'flutter'}},
  variants: 6,
  render(p, R, sr) {
    const out = CASES[p.kind](R, sr, p);
    filter(out, 'highpass', 110, .7, sr);
    filter(filter(out, 'lowpass', 3200, .7, sr), 'lowpass', 3200, .7, sr);   // warm mix: nothing shrill
    return saturate(norm(out, .9), 1.2);
  },
  criteria: {
    // v2. Ranges cover seeds 1-24, 44291-44296 and 12 large random seeds (42 per case), with margin. Darkened in v2: centre 250-900 Hz, 24 dB/oct above 2 kHz.
    roll: {attackMs: [29, 228], crest: [11, 19], t60Ms: [291, 819], centroidHz: [634, 1039], lowHz: [165, 368], highHz: [1320, 1969], flatness: [0, 0.01], durMs: [371, 593], onsetCount: [0, 4], clickEnd: [0, .01]},
    jump: {attackMs: [5, 35], crest: [12, 20], t60Ms: [153, 471], centroidHz: [786, 1324], lowHz: [227, 473], highHz: [1444, 2495], flatness: [0, 0.01], durMs: [185, 317], onsetCount: [0, 4], clickEnd: [0, .01]},
    swish: {attackMs: [12, 113], crest: [9, 18], t60Ms: [58, 216], centroidHz: [440, 830], lowHz: [144, 342], highHz: [845, 1549], flatness: [0, 0.01], durMs: [127, 234], onsetCount: [0, 4], clickEnd: [0, .01]},
    flutter: {attackMs: [50, 508], crest: [13, 22], t60Ms: [253, 1432], centroidHz: [532, 911], lowHz: [165, 289], highHz: [1092, 1759], flatness: [0, 0.01], durMs: [594, 927], onsetCount: [1, 9], clickEnd: [0, .01]},
  },
  notes: 'Cloth whoosh = BP noise (Q~.7) swept 250-900 Hz by a skewed bell + fabric grain, 24 dB/oct roll-off above 2 kHz, no airy layer; soft damped body thuds; see docs/AUDIO.md §2.3',
};
