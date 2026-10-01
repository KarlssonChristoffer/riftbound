// MAGIC: ability and feedback cues. Fantasy but grounded: air, wood, strings and light; nothing digital or sci-fi.
// All voices are physical-ish: noise through band-passes (air), dead plucked strings (Karplus-Strong), small struck
// bells (modal, pentatonic, +-1-2 cent beating twins) and additive "singing string" tones.
//   respawn:       a soft poof (LP noise puff opening 400 -> 2200 Hz + a tiny pitch-dropping thump), a swirl of air
//                  rising 800 -> 3000 Hz, then 10-16 rising pentatonic glints and a faint airy shimmer
//   multishot:     three arrow whooshes fanning out 25-35 ms apart; each a noise band falling 3.5 -> 1.8 kHz as the arrow
//                  recedes, with a tiny dead-string tup; each successive arrow a little lower/darker (the fan angle)
//   rain_cast:     a rush of many bowstrings into the sky: a continuous airy bed (BP noise rising 500 -> 3800 Hz, swelling),
//                  and on top Poisson events (10 -> 100 /s) each a dead plucked string (140 -> 400 Hz, rising) with a
//                  short whoosh; ends with a soft airy fade
//   pierce_charge: a 0.8-0.9 s "singing string" hum under rising tension (110 -> 230 Hz additive partials, vibrato,
//                  beating twin, brightening) with a rising air band, released by a crack: a sharp HP burst + a wooden
//                  limb snap + a short air-zing
//   levelup:       a short warm stinger: a plucked/bell arpeggio on a major pentatonic ladder (root, 3rd, 5th, octave) that
//                  blooms into a soft chord with beating twins, plus a few high glints
import {add, scale, peak, filter, sweep, halfSine, modal, burst, karplus, pink, white, poisson, saturate} from '../dsp.js';

const lerp = (a, b, u) => a + (b - a) * u;
const norm = (b, to = 1) => { const p = peak(b); return p > 0 ? scale(b, to / p) : b; };
const rms = b => { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / Math.max(1, b.length)); };
const unitRms = b => { const r = rms(b); return r > 0 ? scale(b, 1 / r) : b; };
const INV = [0, 1, 1 / Math.pow(2, 1.2), 1 / Math.pow(3, 1.2), 1 / Math.pow(4, 1.2), 1 / Math.pow(5, 1.2), 1 / Math.pow(6, 1.2)];
const ksDamp = (f0, t60) => Math.pow(10, -3 / (f0 * t60));
const PENT = [0, 2, 4, 7, 9];
const penta = (root, k) => root * Math.pow(2, (PENT[((k % 5) + 5) % 5] + 12 * Math.floor(k / 5)) / 12);

// small bell note (modal, partials on the scale, +-1-2 cent twins) as a unit-peak buffer
function bellNote(R, sr, f, T, {tc = .0004, partials = [[1, 1], [2, .5], [3.005, .25], [4.01, .12]], warm = 1} = {}) {
  const modes = [];
  partials.forEach(([r, a], i) => {
    const f0 = f * r, t60 = T / (1 + .7 * warm * i) * R.jit(.08), cents = R.range(1, 2) * R.sign();
    modes.push({f: f0, t60, a: a * R.jit(.1)}); if (i < 2) modes.push({f: f0 * Math.pow(2, cents / 1200), t60: t60 * 1.05, a: a * .7});   // beating twin on the two lowest partials
  });
  return norm(modal(halfSine(tc, sr), modes, sr, Math.round(Math.min(2.2, T * 1.2 + .02) * sr)));
}
// a noise band with a sweeping centre and an envelope function env(u), u in [0,1] over dur; added into out at `at` s
function airBand(out, sr, R, at, dur, fAt, q, env, level, color = 'pink', {wob = 0, lp = 2200} = {}) {
  const m = Math.max(8, Math.round(dur * sr)), x = color === 'pink' ? pink(m, R) : white(m, R);
  sweep(x, 'bandpass', t => fAt(t / dur), q, sr, {every: 64});
  for (let k = 0; k < 2; k++) sweep(x, 'lowpass', t => Math.min(lp, fAt(t / dur) * 2.2), .7, sr, {every: 96});   // 24 dB/oct above the band: no hiss
  unitRms(x);
  const w = wob ? filter(white(m, R), 'lowpass', 5, .7, sr) : null, wr = w ? rms(w) + 1e-9 : 1;   // slow organic modulation
  for (let i = 0; i < m; i++) x[i] *= env(i / m) * (w ? Math.max(.15, 1 + wob * w[i] / wr * .7) : 1);
  add(out, x, at * sr, level);
}
// a dead plucked string (a bowstring tup): unit-peak, t60 seconds
function tup(R, sr, f0, t60, bright = .5) {
  const m = Math.round((t60 * 1.3 + .01) * sr), y = karplus(m, sr, f0, R, {damp: ksDamp(f0, t60), bright, pick: R.range(.1, .2), glide: -R.range(.02, .05), glideT: .01});
  return norm(y);
}
const skew = (u, pk = .4, p = 2) => { if (u <= 0 || u >= 1) return 0; const v = u < pk ? .5 * u / pk : .5 + .5 * (u - pk) / (1 - pk); return Math.pow(Math.sin(Math.PI * v), p); };

const CASES = {
  respawn(R, sr) {
    const n = Math.round(1.25 * sr), out = new Float32Array(n);
    // poof: a puff of air opening up, + a tiny thump (a soft "pomf" at 160 -> 80 Hz)
    const pm = Math.round(.3 * sr), puff = pink(pm, R.fork(1));
    sweep(puff, 'lowpass', t => lerp(300, 1400, Math.min(1, t / .1)), .8, sr, {every: 24});
    for (let i = 0; i < pm; i++) { const t = i / sr; puff[i] *= (t < .012 ? t / .012 : Math.exp(-(t - .012) / R.range(.06, .09))); }
    add(out, unitRms(puff), 0, .32);
    let ph = 0; const th = new Float32Array(Math.round(.12 * sr)), f0 = R.range(140, 190);
    for (let i = 0; i < th.length; i++) { const t = i / sr; ph += 2 * Math.PI * lerp(f0, f0 * .5, Math.min(1, t / .08)) / sr; th[i] = Math.sin(ph) * Math.exp(-t / .03) * Math.min(1, t / .004); }
    add(out, th, 0, .5);
    // swirl: air rising around the body
    airBand(out, sr, R.fork(2), .03, R.range(.5, .65), u => lerp(400, 1400, u), 1.2, u => skew(u, .35, 2), .16);
    // shimmer: rising pentatonic glints, then a very faint airy veil
    const root = R.pick([523.25, 587.33, 659.25]), K = R.int(10, 14);
    for (let k = 0; k < K; k++) {
      const u = k / (K - 1), f = penta(root, Math.floor(u * 7 + R.range(-.6, .6))), t = .06 + u * R.range(.45, .6) + R.range(0, .03);
      if (f > 6500) continue;
      add(out, bellNote(R.fork(10 + k), sr, f, R.range(.1, .22), {partials: [[1, 1], [2.01, .3]]}), Math.round(t * sr), R.range(.5, .85) * (1 - .3 * u));
    }
    return out;
  },
  multishot(R, sr) {
    const n = Math.round(.6 * sr), out = new Float32Array(n);
    const offs = [0, R.range(.06, .075), R.range(.125, .15)], lv = [1, R.range(.78, .9), R.range(.64, .8)], dk = [1, R.range(.8, .88), R.range(.62, .74)];
    offs.forEach((o, k) => {
      const Rk = R.fork(1 + k), D = Rk.range(.14, .18);
      // arrow: noise band recedes 1.6 -> 0.8 kHz (darker for each fan angle), fast attack and a decaying swell
      airBand(out, sr, Rk, o, D, u => lerp(1600, 800, Math.pow(u, .7)) * dk[k], Rk.range(.8, 1.1), u => (u < .04 ? u / .04 : Math.exp(-(u - .04) * 7.5)) * (1 - Math.pow(Math.max(0, (u - .8) / .2), 2)), lv[k]);
      // a very light flutter of fletching: sparse tick-grain
      add(out, tup(Rk, sr, Rk.range(150, 230), .035, .4), Math.round(o * sr), lv[k] * .35);
    });
    return out;
  },
  rain_cast(R, sr) {
    const T = R.range(.85, 1.0), n = Math.round((T + .55) * sr), out = new Float32Array(n);
    const bedLo = R.range(220, 320), bedHi = R.range(800, 1300);
    // the bed: a sky-ward rush. Rising centre, swelling level, then a soft fall
    airBand(out, sr, R.fork(1), 0, T + .45, u => bedLo * Math.pow(bedHi / bedLo, Math.min(1, u * 1.15)), 1.0, u => u < .62 ? Math.pow(u / .62, 1.7) * .9 + .1 * (u / .62) : Math.pow(Math.cos(Math.PI / 2 * (u - .62) / .38), 2), .2, 'pink', {wob: 1, lp: 1800});
    // events: bowstrings loosed, denser and higher as the volley climbs
    const Re = R.fork(2), rate = t => 8 + 95 * Math.pow(Math.min(1, t / T), 1.6);
    for (const t of poisson(Re, 0, T, rate)) {
      const u = t / T, f0 = lerp(180, 520, u) * Re.jit(.25), a = (.25 + .75 * u) * Re.range(.4, 1);
      add(out, tup(Re, sr, f0, .06, .5), Math.round(t * sr), a * 2.2);
      add(out, burst(.07, sr, Re, {a: .004, d: Re.range(.012, .025), color: 'pink', bp: lerp(700, 1500, u) * Re.jit(.2), q: 1}), Math.round(t * sr), a * .5);   // the string's air
    }
    return out;
  },
  pierce_charge(R, sr) {
    const D = R.range(.78, .9), tail = .45, n = Math.round((D + tail) * sr), out = new Float32Array(n);
    // the singing string: additive partials of a string under tension, f rises 110 -> 230 Hz; higher partials come in
    // with the tension; vibrato grows; a twin 0.5-1.2 Hz sharp of the fundamental beats
    const f0 = R.range(105, 125), f1 = f0 * R.range(1.9, 2.15), vib = R.range(5, 6.5), tw = R.range(.5, 1.2), K = 6;
    const ph = new Float64Array(K + 1), tph = R.range(0, 6.28); let twp = tph;
    const rel = t => (t < D ? 1 : Math.exp(-(t - D) / .03));
    const hum = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr, u = Math.min(1, t / D), f = lerp(f0, f1, Math.pow(u, 1.3)) * (1 + .004 * u * Math.sin(2 * Math.PI * vib * t));
      let y = 0, gk = 1; const g = .25 + .75 * u;
      for (let k = 1; k <= K; k++) { ph[k] += 2 * Math.PI * f * k / sr; y += Math.sin(ph[k]) * INV[k] * gk; gk *= g; }
      twp += 2 * Math.PI * (f + tw) / sr; y += .5 * Math.sin(twp);
      const env = Math.min(1, t / .07) * (.3 + .7 * Math.pow(u, 1.1)) * rel(t);
      hum[i] = y * env;
    }
    add(out, norm(hum), 0, .75);
    // rising air: the tension singing in the wood, 600 -> 2800 Hz, quadratic
    const am = Math.round((D + .05) * sr), air = pink(am, R.fork(2));
    sweep(air, 'bandpass', t => lerp(400, 1500, Math.pow(Math.min(1, t / D), 1.5)), 3, sr, {every: 64});
    unitRms(air); for (let i = 0; i < am; i++) { const u = i / sr / D; air[i] *= Math.pow(Math.min(1, u), 2) * rel(i / sr); }
    add(out, air, 0, .22);
    // the crack: sharp air click + wooden limb snap + an air-zing
    const c = Math.round((D + .004) * sr), Rc = R.fork(3);
    add(out, filter(burst(.012, sr, Rc, {a: .00004, d: .0007, color: 'white'}), 'highpass', 900, .7, sr), c, 1.5);
    add(out, burst(.05, sr, Rc, {a: .0002, d: Rc.range(.005, .009), color: 'pink', bp: Rc.range(700, 1100), q: .6}), c, 1.1);
    const fl = Rc.range(330, 480), snap = modal(halfSine(.0006, sr), [{f: fl, t60: .035, a: 1}, {f: fl * 1.8, t60: .025, a: .7}, {f: fl * 3.1, t60: .015, a: .4}, {f: 150 * Rc.jit(.1), t60: .05, a: .5}], sr, Math.round(.12 * sr));
    add(out, norm(snap), c, .7);
    airBand(out, sr, Rc, D + .004, .3, u => lerp(1500, 1000, u), 2.5, u => Math.exp(-u * 6) * Math.min(1, u / .02), .3);
    return out;
  },
  levelup(R, sr) {
    const n = Math.round(1.9 * sr), out = new Float32Array(n);
    const root = R.pick([261.63, 293.66, 329.63]), step = R.range(.085, .1), t0 = 0;
    const ladder = [0, 2, 3, 5];   // pentatonic degrees: root, 3rd, 5th, octave
    ladder.forEach((k, i) => {
      const f = penta(root, k), t = t0 + i * step, Rk = R.fork(1 + i), last = i === ladder.length - 1;
      const T = last ? R.range(.65, .8) : R.range(.3, .42);
      add(out, bellNote(Rk, sr, f, T, {tc: .0007, partials: [[1, 1], [2, .5], [3.005, .22], [4.01, .08]]}), Math.round(t * sr), last ? .95 : .75);
      // the woody pluck underneath: a real string for warmth
      const pl = karplus(Math.round((T * .8 + .05) * sr), sr, f, Rk, {damp: ksDamp(f, T * .7), bright: .3, pick: .14});
      add(out, norm(pl), Math.round(t * sr), (last ? .5 : .4));
    });
    // the chord blooms under the last note: root, 3rd, 5th a little behind it, soft
    const tb = t0 + ladder.length * step * .9;
    [0, 2, 3].forEach((k, i) => add(out, bellNote(R.fork(20 + i), sr, penta(root * 2, k), R.range(.55, .8), {tc: .0009, partials: [[1, 1], [2, .35], [3.005, .12]]}), Math.round((tb + i * .012) * sr), .38));
    // a few high glints
    for (let k = 0; k < 4; k++) add(out, bellNote(R.fork(30 + k), sr, penta(root * 4, k + 1), R.range(.12, .22), {partials: [[1, 1], [2.01, .3]]}), Math.round((tb + .05 + k * R.range(.05, .09)) * sr), R.range(.1, .18));
    return out;
  },
};

export default {
  id: 'magic', version: 2, desc: 'Ability and feedback cues: respawn, multishot, rain_cast, pierce_charge, levelup (airy, woody, strings and light)',
  params: {kind: {values: ['respawn', 'multishot', 'rain_cast', 'pierce_charge', 'levelup'], def: 'respawn'}},
  cases: {respawn: {kind: 'respawn'}, multishot: {kind: 'multishot'}, rain_cast: {kind: 'rain_cast'}, pierce_charge: {kind: 'pierce_charge'}, levelup: {kind: 'levelup'}},
  variants: 6,
  render(p, R, sr) {
    const out = CASES[p.kind](R, sr);
    filter(out, 'highpass', p.kind === 'levelup' ? 150 : 110, .7, sr);
    filter(out, 'highshelf', 4500, .7, sr, -8); filter(filter(out, 'lowpass', 3800, .7, sr), 'lowpass', 3800, .7, sr);   // v2 warm mix
    return saturate(norm(out, .9), 1.2);
  },
  criteria: {
    // v2. Ranges cover seeds 1-24, 44291-44296 and 12 large random seeds (42 per case), with margin. v2 darker: rain_cast bed is a dark 220-1300 Hz rush (24 dB/oct above, slow wobble) with the string tups carrying it; no cue has a noise layer above ~2 kHz; shelf -8 dB above 4.5 kHz, LP 3.8 kHz. The forge render ms includes the metrics pass; render() alone is 8-15 ms.
    respawn: {attackMs: [3, 321], crest: [10, 17], t60Ms: [486, 1637], centroidHz: [541, 989], lowHz: [102, 263], highHz: [1031, 1864], flatness: [0, 0.01], durMs: [645, 1031], onsetCount: [1, 8], clickEnd: [0, .01]},
    multishot: {attackMs: [0, 106], crest: [12, 19], t60Ms: [116, 452], centroidHz: [806, 1162], lowHz: [227, 499], highHz: [1422, 2126], flatness: [0, 0.01], durMs: [258, 376], onsetCount: [1, 4], clickEnd: [0, .01]},
    rain_cast: {attackMs: [197, 1150], crest: [14, 22], t60Ms: [432, 1598], centroidHz: [743, 1477], lowHz: [185, 395], highHz: [1855, 3308], flatness: [0, 0.011], durMs: [1179, 1600], onsetCount: [4, 15], clickEnd: [0, .01]},
    pierce_charge: {attackMs: [385, 1053], crest: [10, 17], t60Ms: [272, 912], centroidHz: [305, 609], lowHz: [102, 211], highHz: [1155, 1786], flatness: [0, 0.01], durMs: [996, 1346], onsetCount: [0, 2], clickEnd: [0, .01]},
    levelup: {attackMs: [0, 376], crest: [11, 18], t60Ms: [500, 1263], centroidHz: [459, 750], lowHz: [227, 395], highHz: [701, 1471], flatness: [0, 0.01], durMs: [982, 1458], onsetCount: [2, 6], clickEnd: [0, .01]},
  },
  notes: 'Air bands + dead KS strings + pentatonic bell glints with beating twins; singing-string additive hum into a crack; see docs/AUDIO.md §2.3',
};
